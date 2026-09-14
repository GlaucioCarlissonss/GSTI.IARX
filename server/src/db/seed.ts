/**
 * Carga inicial a partir das bases reais do gestor de TI.
 *
 * Os arquivos de origem ficam em `dados-origem/` (fora do controle de versão,
 * pois contêm dados de pessoas e valores contratuais). Rode com:
 *
 *   npm run seed -- --recriar
 */
import { randomBytes } from 'node:crypto';
import { clienteDaEmpresa } from '../domain/clientes.js';
import ExcelJS from 'exceljs';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { caminhoDoProjeto, carregarAmbiente } from '../lib/ambiente.js';
import { abrirBanco, db, definirBanco } from './index.js';

carregarAmbiente();
import { registrar } from '../domain/auth.js';
import { criarEmpresa } from '../domain/empresas.js';
import { criarFilial, resolverTipoDespesa } from '../domain/cadastros.js';
import { criarCenario, criarLancamento } from '../domain/financeiro.js';
import { adicionarEnvolvido, criarProjeto } from '../domain/projetos.js';
import { paraCentavos, ratear } from '../domain/dinheiro.js';
import { intervalo, paraExibicao, paraInterno } from '../domain/competencia.js';
import { chaveDedup } from '../lib/hash.js';
import type { Contexto } from '../domain/contexto.js';
import {
  EMPRESAS,
  enquadrar,
  listarUnidades,
  normalizarCompetencia,
  normalizarTipoDespesa,
  resolverUnidade,
} from './organograma.js';

const DIR_DADOS = caminhoDoProjeto(process.env.DADOS_ORIGEM, 'dados-origem');
const CAMINHO_BANCO = caminhoDoProjeto(process.env.DATABASE_PATH, 'data/gsti.sqlite');
const RECRIAR = process.argv.includes('--recriar');

/**
 * Credenciais da conta criada pela carga.
 *
 * Não há senha padrão no código: uma senha publicada no repositório daria
 * acesso de gestor a todas as empresas semeadas. Sem `SEED_SENHA`, o script
 * sorteia uma e a imprime uma única vez, ao final.
 */
const PLACEHOLDERS_DE_SENHA = new Set(['troque-esta-senha', 'gsti-2026-demo', 'senha', 'mudar']);

function senhaConfigurada(): string | null {
  const informada = process.env.SEED_SENHA?.trim();
  if (!informada) return null;
  if (PLACEHOLDERS_DE_SENHA.has(informada.toLowerCase()) || informada.length < 8) {
    throw new Error(
      'SEED_SENHA é um valor de exemplo ou curto demais. Defina uma senha real com ao menos 8 caracteres, ' +
        'ou remova a variável para que o script sorteie uma.',
    );
  }
  return informada;
}

const SENHA_INFORMADA = senhaConfigurada();
const SENHA_SORTEADA = SENHA_INFORMADA ? null : randomBytes(12).toString('base64url');

const USUARIO = {
  nome: process.env.SEED_NOME?.trim() || 'Gestor de TI',
  email: process.env.SEED_EMAIL?.trim() || 'gestor@gsti.local',
  senha: SENHA_INFORMADA ?? SENHA_SORTEADA!,
};

// --------------------------------------------------------------- utilidades

type Linha = Record<string, unknown>;

function valorCelula(celula: ExcelJS.Cell | undefined): unknown {
  let v: unknown = celula?.value;
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('result' in (v as object)) v = (v as { result: unknown }).result;
    else if ('richText' in (v as object)) v = (v as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join('');
    else if ('text' in (v as object)) v = (v as { text: string }).text;
  }
  return v;
}

async function lerAba(arquivo: string, aba: string): Promise<Linha[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(resolve(DIR_DADOS, arquivo));
  const ws = wb.getWorksheet(aba);
  if (!ws) throw new Error(`Aba "${aba}" não encontrada em ${arquivo}.`);
  const cabecalho: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => {
    cabecalho[i - 1] = String(valorCelula(c) ?? '').trim();
  });
  const linhas: Linha[] = [];
  ws.eachRow({ includeEmpty: false }, (row, numero) => {
    if (numero === 1) return;
    const registro: Linha = {};
    let vazia = true;
    cabecalho.forEach((coluna, i) => {
      if (!coluna) return;
      const v = valorCelula(row.getCell(i + 1));
      registro[coluna] = v;
      if (v !== null && v !== undefined && String(v).trim() !== '') vazia = false;
    });
    if (!vazia) linhas.push(registro);
  });
  return linhas;
}

const texto = (v: unknown) => String(v ?? '').trim();
const brl = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ------------------------------------------------------------------ contexto

interface Ambiente {
  contextos: Map<string, Contexto>;
  filiais: Map<string, number>; // "EMPRESA::FILIAL" -> id
  tipos: Map<string, number>; // "EMPRESA::Tipo" -> id
}

function contextoDe(amb: Ambiente, empresa: string): Contexto {
  const ctx = amb.contextos.get(empresa);
  if (!ctx) throw new Error(`Empresa "${empresa}" não preparada no ambiente.`);
  return ctx;
}

function idFilial(amb: Ambiente, empresa: string, filial: string): number {
  const id = amb.filiais.get(`${empresa}::${filial}`);
  if (!id) throw new Error(`Filial "${filial}" não cadastrada em ${empresa}.`);
  return id;
}

function idTipo(amb: Ambiente, empresa: string, nome: string): number {
  const chave = `${empresa}::${nome}`;
  const existente = amb.tipos.get(chave);
  if (existente) return existente;
  const ctx = contextoDe(amb, empresa);
  const resolvido = resolverTipoDespesa(ctx.empresaId, nome, true)!;
  amb.tipos.set(chave, resolvido.id);
  return resolvido.id;
}

function prepararAmbiente(usuarioId: number, email: string): Ambiente {
  const amb: Ambiente = { contextos: new Map(), filiais: new Map(), tipos: new Map() };
  for (const nome of EMPRESAS) {
    const empresa = criarEmpresa(usuarioId, { nome });
    const ctx: Contexto = {
      clienteId: clienteDaEmpresa(empresa.id),
      empresaId: empresa.id,
      usuarioId,
      usuarioEmail: email,
      papel: 'gestor',
    };
    amb.contextos.set(nome, ctx);
    for (const linha of db()
      .prepare('SELECT id, nome FROM tipos_despesa WHERE empresa_id = ?')
      .all(empresa.id) as Array<{ id: number; nome: string }>) {
      amb.tipos.set(`${nome}::${linha.nome}`, linha.id);
    }
  }
  for (const unidade of listarUnidades()) {
    const ctx = contextoDe(amb, unidade.empresa);
    const filial = criarFilial(ctx, {
      nome: unidade.filial,
      cidade: unidade.cidade ?? undefined,
      uf: unidade.uf ?? undefined,
    });
    amb.filiais.set(`${unidade.empresa}::${unidade.filial}`, filial.id);
  }
  return amb;
}

// ------------------------------------------------------- despesas de TI

interface FonteDespesas {
  arquivo: string;
  aba: string;
  colunas: { unidade: string; competencia: string; tipo: string; origemTipo: string; valor: string; fornecedor?: string; motivo?: string };
  filtro?: (l: Linha) => boolean;
}

const FONTES: FonteDespesas[] = [
  {
    arquivo: 'Despesas_TI_2026.xlsx',
    aba: 'BASE TI',
    colunas: {
      unidade: 'UNIDADE',
      competencia: 'COMPETENCIA',
      tipo: 'NOVO CENTRO CUSTO',
      origemTipo: 'TIPO',
      valor: 'VALOR_PAGO',
      fornecedor: 'Fornecedor',
      motivo: 'DESCRICAO',
    },
  },
  {
    arquivo: 'Despesas_de_TI_Junho_26.xlsx',
    aba: 'base2',
    colunas: {
      unidade: 'UNIDADE',
      competencia: 'COMPETENCIA',
      tipo: 'CENTRO_CUSTO',
      origemTipo: 'TIPO',
      valor: 'VALOR_GASTO',
      fornecedor: 'FORNECEDOR',
      motivo: 'MOTIVO',
    },
  },
  {
    arquivo: 'DESPESAS_TI_JULHO_26.xlsx',
    aba: 'JULHO',
    colunas: {
      unidade: 'UNIDADE',
      competencia: 'COMPETENCIA',
      tipo: 'CENTRO_CUSTO',
      origemTipo: 'TIPO',
      valor: 'VALOR_GASTO',
      fornecedor: 'FORNECEDOR',
      motivo: 'MOTIVO',
    },
  },
  {
    arquivo: 'Base_Despesas_Agosto__novo.xlsx',
    aba: 'Despesas (2)',
    colunas: {
      unidade: 'UNIDADE',
      competencia: 'Competencia',
      tipo: 'CENTRO_CUSTO',
      origemTipo: 'TIPO',
      valor: 'VALOR_GASTO',
      fornecedor: 'FORNECEDOR',
      motivo: 'MOTIVO',
    },
    // A base de agosto traz a empresa inteira; só interessa o grupo de gasto de TI.
    filtro: (l) => texto(l.GRUPO_GASTO).toUpperCase() === 'TECNOLOGIA DA INFORMACAO - TI',
  },
];

interface Resumo {
  inseridos: number;
  ignorados: number;
  centavos: number;
  porCompetencia: Map<string, number>;
  avisos: string[];
}

async function carregarDespesas(amb: Ambiente): Promise<Resumo> {
  const resumo: Resumo = { inseridos: 0, ignorados: 0, centavos: 0, porCompetencia: new Map(), avisos: [] };
  const ocorrencias = new Map<string, number>();

  const inserir = db().prepare(
    `INSERT INTO lancamentos
       (empresa_id, filial_id, tipo_despesa_id, competencia, valor_centavos, natureza, classificacao,
        descricao, observacoes, cenario, origem, dedup_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'oficial', 'planilha', ?)`,
  );

  for (const fonte of FONTES) {
    const caminho = resolve(DIR_DADOS, fonte.arquivo);
    if (!existsSync(caminho)) {
      resumo.avisos.push(`Arquivo ausente, ignorado: ${fonte.arquivo}`);
      continue;
    }
    const linhas = (await lerAba(fonte.arquivo, fonte.aba)).filter((l) => fonte.filtro?.(l) ?? true);

    for (const linha of linhas) {
      const unidade = resolverUnidade(texto(linha[fonte.colunas.unidade]));
      const competencia = normalizarCompetencia(linha[fonte.colunas.competencia]);
      const bruto = linha[fonte.colunas.valor];

      if (!unidade) {
        resumo.ignorados += 1;
        resumo.avisos.push(`Unidade não mapeada em ${fonte.arquivo}: "${texto(linha[fonte.colunas.unidade])}"`);
        continue;
      }
      if (!competencia) {
        resumo.ignorados += 1;
        resumo.avisos.push(`Competência inválida em ${fonte.arquivo}: "${texto(linha[fonte.colunas.competencia])}"`);
        continue;
      }
      const centavos = paraCentavos(typeof bruto === 'number' ? bruto : texto(bruto));
      if (centavos <= 0) {
        resumo.ignorados += 1;
        resumo.avisos.push(`Valor não positivo ignorado em ${fonte.arquivo} (${unidade.filial}, ${competencia}): ${bruto}`);
        continue;
      }

      const tipoDespesa = normalizarTipoDespesa(texto(linha[fonte.colunas.tipo]));
      const { natureza, classificacao } = enquadrar(tipoDespesa, texto(linha[fonte.colunas.origemTipo]));
      const fornecedor = fonte.colunas.fornecedor ? texto(linha[fonte.colunas.fornecedor]) : '';
      const motivo = fonte.colunas.motivo ? texto(linha[fonte.colunas.motivo]) : '';

      // Linhas idênticas são legítimas (duas notas iguais no mesmo mês):
      // a chave de dedup recebe o número da ocorrência para não colapsá-las.
      const base = [unidade.empresa, unidade.filial, competencia, tipoDespesa, centavos, fornecedor, motivo].join('|');
      const n = (ocorrencias.get(base) ?? 0) + 1;
      ocorrencias.set(base, n);

      const ctx = contextoDe(amb, unidade.empresa);
      inserir.run(
        ctx.empresaId,
        idFilial(amb, unidade.empresa, unidade.filial),
        idTipo(amb, unidade.empresa, tipoDespesa),
        paraInterno(competencia),
        centavos,
        natureza,
        classificacao,
        fornecedor || null,
        motivo || null,
        chaveDedup(['carga-inicial', base, n]),
      );
      resumo.inseridos += 1;
      resumo.centavos += centavos;
      resumo.porCompetencia.set(competencia, (resumo.porCompetencia.get(competencia) ?? 0) + centavos);
    }
  }
  return resumo;
}

// -------------------------------------------------------- folha da equipe de TI

/** Alocação nominal definida pelo gestor; os demais entram por rateio. */
const ALOCACAO_DIRETA: Record<string, { empresa: string; filial: string }> = {
  SARA: { empresa: 'MILAGRES', filial: 'HM PB' },
  ROBERTO: { empresa: 'MILAGRES', filial: 'HM PB' },
  KAUA: { empresa: 'RESIDENCIAL', filial: 'HR JP' },
};

function chaveColaborador(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/\s+/)[0]!;
}

async function carregarFolhaTI(amb: Ambiente, gastoPorEmpresaMes: Map<string, number>): Promise<Resumo> {
  const resumo: Resumo = { inseridos: 0, ignorados: 0, centavos: 0, porCompetencia: new Map(), avisos: [] };
  const caminho = resolve(DIR_DADOS, 'TI.xlsx');
  if (!existsSync(caminho)) {
    resumo.avisos.push('Arquivo TI.xlsx ausente: a folha da equipe de TI não foi carregada.');
    return resumo;
  }

  const linhas = await lerAba('TI.xlsx', 'Geral');
  const colaboradores = linhas
    .map((l) => ({
      nome: texto(l['COLABORADOR ']) || texto(l.COLABORADOR),
      admissao: l['ADMISSÃO '] ?? l['ADMISSÃO'],
      custo: l['CUSTO MÉDIO do COLABORADOR com TRIBUTO'],
      funcao: texto(l['FUNÇÃO']),
      vinculo: texto(l.VINCULO),
    }))
    // A linha de total da planilha não tem colaborador.
    .filter((c) => c.nome && c.custo !== null && c.custo !== undefined && String(c.custo).trim() !== '');

  const competencias = intervalo(paraInterno('01/2026'), paraInterno('08/2026'));
  const inserir = db().prepare(
    `INSERT INTO lancamentos
       (empresa_id, filial_id, tipo_despesa_id, competencia, valor_centavos, natureza, classificacao,
        descricao, observacoes, cenario, origem, dedup_hash)
     VALUES (?, ?, ?, ?, ?, 'fixa', 'despesa', ?, ?, 'oficial', 'folha_ti', ?)`,
  );

  for (const competencia of competencias) {
    const exibicao = paraExibicao(competencia);
    const ativos = colaboradores.filter((c) => {
      const admissao = c.admissao instanceof Date ? c.admissao : new Date(String(c.admissao));
      if (Number.isNaN(admissao.getTime())) return true;
      const mesAdmissao = `${admissao.getUTCFullYear()}-${String(admissao.getUTCMonth() + 1).padStart(2, '0')}`;
      return mesAdmissao <= competencia;
    });

    // 1) Alocação direta nas unidades indicadas pelo gestor.
    const rateaveis: typeof ativos = [];
    for (const colaborador of ativos) {
      const destino = ALOCACAO_DIRETA[chaveColaborador(colaborador.nome)];
      if (!destino) {
        rateaveis.push(colaborador);
        continue;
      }
      const ctx = contextoDe(amb, destino.empresa);
      const centavos = paraCentavos(colaborador.custo as number);
      inserir.run(
        ctx.empresaId,
        idFilial(amb, destino.empresa, destino.filial),
        idTipo(amb, destino.empresa, 'Pessoas'),
        competencia,
        centavos,
        `${colaborador.funcao || 'Equipe de TI'} — ${colaborador.nome}`,
        `Custo médio com tributos. Alocação direta em ${destino.filial}. Vínculo: ${colaborador.vinculo || 'n/d'}.`,
        chaveDedup(['folha-ti', competencia, colaborador.nome]),
      );
      resumo.inseridos += 1;
      resumo.centavos += centavos;
      resumo.porCompetencia.set(exibicao, (resumo.porCompetencia.get(exibicao) ?? 0) + centavos);
    }

    // 2) Equipe corporativa rateada proporcionalmente ao gasto de TI do mês.
    const totalRateavel = rateaveis.reduce((s, c) => s + paraCentavos(c.custo as number), 0);
    if (totalRateavel === 0) continue;

    const pesos = EMPRESAS.map((empresa) => gastoPorEmpresaMes.get(`${empresa}::${competencia}`) ?? 0);
    const somaPesos = pesos.reduce((a, b) => a + b, 0);
    // Sem gasto no mês (base ausente), o rateio cai para partes iguais.
    const cotas =
      somaPesos > 0
        ? distribuirProporcional(totalRateavel, pesos)
        : ratear(totalRateavel, EMPRESAS.length);

    EMPRESAS.forEach((empresa, i) => {
      const cota = cotas[i]!;
      if (cota <= 0) return;
      const ctx = contextoDe(amb, empresa);
      const participacao = somaPesos > 0 ? ((pesos[i]! / somaPesos) * 100).toFixed(1) : (100 / EMPRESAS.length).toFixed(1);
      inserir.run(
        ctx.empresaId,
        null, // rateio corporativo fica no nível empresa, sem filial
        idTipo(amb, empresa, 'Pessoas'),
        competencia,
        cota,
        'Equipe corporativa de TI (rateio)',
        `Rateio de ${rateaveis.length} colaborador(es) corporativo(s) de TI, proporcional ao gasto de TI do grupo no mês (${participacao}%).`,
        chaveDedup(['folha-ti-rateio', competencia, empresa]),
      );
      resumo.inseridos += 1;
      resumo.centavos += cota;
      resumo.porCompetencia.set(exibicao, (resumo.porCompetencia.get(exibicao) ?? 0) + cota);
    });
  }
  return resumo;
}

/** Rateio proporcional que fecha exatamente no total (sobras nos maiores pesos). */
export function distribuirProporcional(total: number, pesos: number[]): number[] {
  const soma = pesos.reduce((a, b) => a + b, 0);
  if (soma <= 0) return pesos.map(() => 0);
  const brutos = pesos.map((p) => (total * p) / soma);
  const cotas = brutos.map((b) => Math.floor(b));
  let resto = total - cotas.reduce((a, b) => a + b, 0);
  const ordem = brutos
    .map((b, i) => ({ i, frac: b - Math.floor(b) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of ordem) {
    if (resto <= 0) break;
    cotas[i] = cotas[i]! + 1;
    resto -= 1;
  }
  return cotas;
}

// --------------------------------------------------------------- SpinCare

const DESTINO_SPINCARE: Record<string, { empresa: string; filial: string | null }> = {
  'HM (HOSPITAL MILAGRES)': { empresa: 'MILAGRES', filial: null },
  'HR (HOSPITAL RESIDENCIAL)': { empresa: 'RESIDENCIAL', filial: null },
  LIFE: { empresa: 'RESIDENCIAL', filial: 'HR PE' },
  NATAL: { empresa: 'RESIDENCIAL', filial: 'HR RN' },
  ALIANÇA: { empresa: 'ALIANÇA', filial: null },
  UNION: { empresa: 'UNION', filial: null },
};

interface ConfigSpinCare {
  tipo_despesa: string;
  projeto?: {
    nome: string;
    descricao: string;
    mes_inicio: string;
    mes_fim_planejado: string;
    envolvidos?: Array<{ nome: string; papel?: string }>;
  };
  blocos: Array<{
    rotulo: string;
    competencia_inicio: string;
    competencia_fim: string;
    total_mensal_esperado: number;
    itens: Array<{ unidade: string; produto: string; valor: number }>;
  }>;
  cenario_alternativo: { chave: string; nome: string; descricao: string; fator_a_partir_de: string; fator: number };
}

function carregarSpinCare(amb: Ambiente): Resumo {
  const resumo: Resumo = { inseridos: 0, ignorados: 0, centavos: 0, porCompetencia: new Map(), avisos: [] };
  const caminho = resolve(DIR_DADOS, 'spincare.json');
  if (!existsSync(caminho)) {
    resumo.avisos.push('Arquivo spincare.json ausente: a projeção do ERP SpinCare não foi carregada.');
    return resumo;
  }
  const config = JSON.parse(readFileSync(caminho, 'utf8')) as ConfigSpinCare;

  // O cenário alternativo existe em todas as empresas envolvidas.
  const empresasEnvolvidas = new Set(Object.values(DESTINO_SPINCARE).map((d) => d.empresa));
  for (const empresa of empresasEnvolvidas) {
    criarCenario(contextoDe(amb, empresa), {
      chave: config.cenario_alternativo.chave,
      nome: config.cenario_alternativo.nome,
      descricao: config.cenario_alternativo.descricao,
    });
  }

  // A implantação é um projeto de TI — entra no módulo de projetos de cada
  // empresa envolvida, para aparecer no Gantt junto do compromisso financeiro.
  if (config.projeto) {
    for (const empresa of empresasEnvolvidas) {
      const ctx = contextoDe(amb, empresa);
      const projeto = criarProjeto(ctx, {
        nome: config.projeto.nome,
        descricao: config.projeto.descricao,
        mesInicio: config.projeto.mes_inicio,
        mesFimPlanejado: config.projeto.mes_fim_planejado,
        status: 'em_andamento',
      });
      for (const envolvido of config.projeto.envolvidos ?? []) {
        adicionarEnvolvido(ctx, projeto.id, { nome: envolvido.nome, papel: envolvido.papel ?? null });
      }
      resumo.avisos.push(`Projeto "${config.projeto.nome}" criado em ${empresa}.`);
    }
  }

  const cenarios: Array<{ chave: string; fatorApartirDe: string; fator: number }> = [
    { chave: 'oficial', fatorApartirDe: '9999-12', fator: 1 },
    {
      chave: config.cenario_alternativo.chave,
      fatorApartirDe: paraInterno(config.cenario_alternativo.fator_a_partir_de),
      fator: config.cenario_alternativo.fator,
    },
  ];

  for (const cenario of cenarios) {
    for (const bloco of config.blocos) {
      const meses = intervalo(paraInterno(bloco.competencia_inicio), paraInterno(bloco.competencia_fim));
      let totalBloco = 0;

      for (const item of bloco.itens) {
        const destino = DESTINO_SPINCARE[item.unidade.toUpperCase()];
        if (!destino) {
          resumo.ignorados += 1;
          resumo.avisos.push(`Unidade SpinCare não mapeada: "${item.unidade}"`);
          continue;
        }
        const ctx = contextoDe(amb, destino.empresa);
        const mesInicial = meses[0]!;
        const aplicaFator = mesInicial >= cenario.fatorApartirDe;
        const centavos = Math.round(paraCentavos(item.valor) * (aplicaFator ? cenario.fator : 1));

        criarLancamento(ctx, {
          filialId: destino.filial ? idFilial(amb, destino.empresa, destino.filial) : null,
          tipoDespesaId: idTipo(amb, destino.empresa, config.tipo_despesa),
          competencia: paraExibicao(mesInicial),
          valor: centavos / 100,
          natureza: 'fixa',
          classificacao: 'despesa',
          repetirAte: paraExibicao(meses[meses.length - 1]!),
          cenario: cenario.chave === 'oficial' ? null : cenario.chave,
          descricao: `Mensalidade ${item.produto} — ${item.unidade}`,
          origem: 'projecao_spincare',
          observacoes:
            `Projeto de migração do ERP SpinCare. ${bloco.rotulo}.` +
            (aplicaFator && cenario.fator !== 1
              ? ` Cenário com desconto de ${Math.round((1 - cenario.fator) * 100)}%.`
              : ''),
        });
        resumo.inseridos += meses.length;
        resumo.centavos += centavos * meses.length;
        totalBloco += centavos;
        for (const mes of meses) {
          const exibicao = paraExibicao(mes);
          resumo.porCompetencia.set(exibicao, (resumo.porCompetencia.get(exibicao) ?? 0) + centavos);
        }
      }

      // Confere o total mensal contra o informado no documento de origem.
      const esperado = Math.round(
        paraCentavos(bloco.total_mensal_esperado) *
          (paraInterno(bloco.competencia_inicio) >= cenario.fatorApartirDe ? cenario.fator : 1),
      );
      if (Math.abs(totalBloco - esperado) > 1) {
        resumo.avisos.push(
          `Divergência no bloco "${bloco.rotulo}" (cenário ${cenario.chave}): somado ${brl(totalBloco)}, esperado ${brl(esperado)}.`,
        );
      }
    }
  }
  return resumo;
}

// ------------------------------------------------------------------ execução

async function principal() {
  if (RECRIAR) {
    for (const sufixo of ['', '-wal', '-shm']) {
      const alvo = `${CAMINHO_BANCO}${sufixo}`;
      if (existsSync(alvo)) rmSync(alvo);
    }
  }
  definirBanco(abrirBanco(CAMINHO_BANCO));

  const jaPovoado = (db().prepare('SELECT COUNT(*) AS n FROM empresas').get() as { n: number }).n > 0;
  if (jaPovoado) {
    console.error('O banco já contém empresas. Use "npm run seed -- --recriar" para refazer a carga do zero.');
    process.exitCode = 1;
    return;
  }

  const usuario = registrar(USUARIO);
  const amb = prepararAmbiente(usuario.id, usuario.email);

  const despesas = await carregarDespesas(amb);

  // Base do rateio da folha: gasto de TI por empresa e competência.
  const gastoPorEmpresaMes = new Map<string, number>();
  for (const [empresa, ctx] of amb.contextos) {
    for (const linha of db()
      .prepare(
        `SELECT competencia, SUM(valor_centavos) AS total FROM lancamentos
          WHERE empresa_id = ? AND excluido_em IS NULL GROUP BY competencia`,
      )
      .all(ctx.empresaId) as Array<{ competencia: string; total: number }>) {
      gastoPorEmpresaMes.set(`${empresa}::${linha.competencia}`, linha.total);
    }
  }

  const folha = await carregarFolhaTI(amb, gastoPorEmpresaMes);
  const spincare = carregarSpinCare(amb);

  // ------------------------------------------------------------- relatório
  console.log('\n== Carga inicial concluída ==\n');
  console.log(
    `Usuário .......... ${usuario.email}` +
      (SENHA_SORTEADA
        ? `\n  Senha sorteada ... ${SENHA_SORTEADA}  (anote agora — não será exibida de novo)`
        : '  (senha definida em SEED_SENHA)'),
  );
  console.log(`Empresas ......... ${EMPRESAS.join(', ')}`);
  console.log(`Filiais .......... ${listarUnidades().length}`);
  console.log(
    `\nDespesas de TI ... ${despesas.inseridos} lançamentos, ${brl(despesas.centavos)} (${despesas.ignorados} ignorados)`,
  );
  console.log(`Folha de TI ...... ${folha.inseridos} lançamentos, ${brl(folha.centavos)}`);
  console.log(`SpinCare ......... ${spincare.inseridos} lançamentos projetados, ${brl(spincare.centavos)}`);

  console.log('\nRealizado por competência (despesas + folha):');
  const mensal = new Map<string, number>();
  for (const fonte of [despesas, folha]) {
    for (const [mes, v] of fonte.porCompetencia) mensal.set(mes, (mensal.get(mes) ?? 0) + v);
  }
  [...mensal.entries()]
    .sort((a, b) => paraInterno(a[0]).localeCompare(paraInterno(b[0])))
    .forEach(([mes, v]) => console.log(`  ${mes}: ${brl(v)}`));

  const avisos = [...despesas.avisos, ...folha.avisos, ...spincare.avisos];
  if (avisos.length > 0) {
    console.log(`\nAvisos (${avisos.length}):`);
    for (const aviso of [...new Set(avisos)].slice(0, 20)) console.log(`  - ${aviso}`);
  }
  console.log(`\nBanco: ${CAMINHO_BANCO}\n`);
}

emTransacaoSeguro(principal);

function emTransacaoSeguro(fn: () => Promise<void>) {
  fn().catch((erro) => {
    console.error('Falha na carga inicial:', erro);
    process.exitCode = 1;
  });
}
