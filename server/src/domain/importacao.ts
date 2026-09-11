import { db, emTransacao } from '../db/index.js';
import { chaveDedup, hashArquivo } from '../lib/hash.js';
import { erroValidacao } from '../lib/erros.js';
import { auditar } from './auditoria.js';
import { ehCompetenciaValida, paraInterno } from './competencia.js';
import type { Contexto } from './contexto.js';
import { paraCentavos } from './dinheiro.js';
import { criarLancamento, garantirCenario } from './financeiro.js';
import { criarFilial, resolverFila, resolverTipoDespesa, resolverTopicoAjuda } from './cadastros.js';
import { competenciaEstaFechada } from './fechamento.js';
import { lerCsv, lerXlsx, type Aba } from '../lib/planilha.js';
import {
  ABAS,
  ABAS_POR_MODULO,
  colunasFaltantes,
  mapearColunas,
  normalizarCabecalho,
  TEMPLATE_VERSAO_ATUAL,
  type Modulo,
  type NomeAba,
} from './templates.js';

export interface ErroLinha {
  aba: string;
  linha: number;
  mensagem: string;
  dados?: Record<string, unknown>;
}

export interface ResultadoImportacao {
  template_versao: string;
  arquivo: string | null;
  arquivo_ja_importado: boolean;
  total_linhas: number;
  importadas: number;
  duplicadas: number;
  com_erro: number;
  abas_processadas: string[];
  abas_ignoradas: string[];
  cadastros_criados: { tipos_despesa: string[]; topicos_ajuda: string[]; filiais: string[] };
  avisos: string[];
  erros: ErroLinha[];
}

interface OpcoesImportacao {
  modulo: Modulo;
  arquivoNome?: string | null;
  /** Cadastra automaticamente tipos de despesa/tópicos/filiais ausentes. */
  criarCadastrosAusentes?: boolean;
  /** Valida sem gravar nada (pré-visualização). */
  simular?: boolean;
}

const NATUREZAS = new Set(['fixa', 'pontual_unica', 'pontual_parcelada']);
const CLASSIFICACOES = new Set(['despesa', 'investimento']);

function interpretarNatureza(bruto: string): string | null {
  const chave = normalizarCabecalho(bruto);
  const mapa: Record<string, string> = {
    fixa: 'fixa',
    despesafixa: 'fixa',
    recorrente: 'fixa',
    pontualunica: 'pontual_unica',
    pontual: 'pontual_unica',
    despesapontualunica: 'pontual_unica',
    unica: 'pontual_unica',
    pontualparcelada: 'pontual_parcelada',
    parcelada: 'pontual_parcelada',
    despesapontualparcelada: 'pontual_parcelada',
  };
  const valor = mapa[chave];
  return valor && NATUREZAS.has(valor) ? valor : null;
}

function interpretarClassificacao(bruto: string): string | null {
  const chave = normalizarCabecalho(bruto);
  const mapa: Record<string, string> = {
    despesa: 'despesa',
    custo: 'despesa',
    investimento: 'investimento',
    capex: 'investimento',
    opex: 'despesa',
  };
  const valor = mapa[chave];
  return valor && CLASSIFICACOES.has(valor) ? valor : null;
}

function interpretarBooleano(bruto: string | undefined, padrao = true): boolean {
  if (bruto === undefined || bruto === null || String(bruto).trim() === '') return padrao;
  return ['1', 'sim', 's', 'true', 'verdadeiro', 'ativo', 'x'].includes(normalizarCabecalho(String(bruto)));
}

function interpretarInteiro(bruto: unknown): number | null {
  if (bruto === null || bruto === undefined || String(bruto).trim() === '') return null;
  const texto = String(bruto).trim().replace(/\.0+$/, '');
  if (!/^-?\d+$/.test(texto)) return null;
  return Number(texto);
}

/** Detecta a versão do template a partir de uma aba `_meta`, se presente. */
function detectarVersao(abas: Aba[]): string {
  const meta = abas.find((a) => normalizarCabecalho(a.nome) === 'meta');
  const linha = meta?.linhas[0];
  if (!linha) return TEMPLATE_VERSAO_ATUAL;
  for (const [chave, valor] of Object.entries(linha)) {
    if (normalizarCabecalho(chave).includes('versao') && String(valor).trim()) return String(valor).trim();
  }
  return TEMPLATE_VERSAO_ATUAL;
}

function reconhecerAba(nome: string): NomeAba | null {
  const chave = normalizarCabecalho(nome);
  const nomes = Object.keys(ABAS) as NomeAba[];
  return nomes.find((n) => normalizarCabecalho(n) === chave) ?? null;
}

export async function interpretarArquivo(
  buffer: Buffer,
  nomeArquivo: string | null,
  abaPadrao?: NomeAba,
): Promise<Aba[]> {
  const ehCsv = (nomeArquivo ?? '').toLowerCase().endsWith('.csv') || (nomeArquivo ?? '').toLowerCase().endsWith('.txt');
  if (ehCsv) {
    const linhas = lerCsv(buffer.toString('utf8'));
    const colunas = linhas.length > 0 ? Object.keys(linhas[0]!) : [];
    return [{ nome: abaPadrao ?? 'Financeiro', colunas, linhas }];
  }
  return lerXlsx(buffer);
}

/**
 * Importação mensal por planilha.
 *
 * - Linhas válidas são gravadas; linhas inválidas entram no relatório de erros
 *   sem abortar o lote.
 * - A operação é idempotente: cada linha tem uma chave de deduplicação, e
 *   reimportar o mesmo arquivo não duplica registros.
 */
export async function importarPlanilha(
  ctx: Contexto,
  buffer: Buffer,
  opcoes: OpcoesImportacao,
): Promise<ResultadoImportacao> {
  if (ctx.papel !== 'gestor') throw erroValidacao('Apenas gestores podem importar dados.');

  const abasEsperadas = ABAS_POR_MODULO[opcoes.modulo];
  const abaPadrao = abasEsperadas[abasEsperadas.length - 1];
  const abas = await interpretarArquivo(buffer, opcoes.arquivoNome ?? null, abaPadrao);
  const versao = detectarVersao(abas);
  const arquivoHash = hashArquivo(buffer);

  const jaImportado =
    db()
      .prepare('SELECT id FROM importacoes WHERE empresa_id = ? AND arquivo_hash = ?')
      .get(ctx.empresaId, arquivoHash) !== undefined;

  const resultado: ResultadoImportacao = {
    template_versao: versao,
    arquivo: opcoes.arquivoNome ?? null,
    arquivo_ja_importado: jaImportado,
    total_linhas: 0,
    importadas: 0,
    duplicadas: 0,
    com_erro: 0,
    abas_processadas: [],
    abas_ignoradas: [],
    cadastros_criados: { tipos_despesa: [], topicos_ajuda: [], filiais: [] },
    avisos: [],
    erros: [],
  };

  if (jaImportado) {
    resultado.avisos.push(
      'Este arquivo já foi importado anteriormente. A deduplicação por linha garante que nada será duplicado.',
    );
  }

  const executar = () => {
    for (const aba of abas) {
      const reconhecida = reconhecerAba(aba.nome);
      if (!reconhecida || !abasEsperadas.includes(reconhecida)) {
        if (normalizarCabecalho(aba.nome) !== 'meta') resultado.abas_ignoradas.push(aba.nome);
        continue;
      }
      const mapa = mapearColunas(reconhecida, aba.colunas);
      const faltantes = colunasFaltantes(reconhecida, mapa);
      if (faltantes.length > 0) {
        resultado.erros.push({
          aba: aba.nome,
          linha: 1,
          mensagem: `Cabeçalho incompleto. Colunas obrigatórias ausentes: ${faltantes.join(', ')}.`,
        });
        resultado.com_erro += 1;
        continue;
      }
      resultado.abas_processadas.push(reconhecida);
      const ler = (linha: Record<string, unknown>, coluna: string): string => {
        const origem = mapa.get(coluna);
        if (!origem) return '';
        const valor = linha[origem];
        return valor === null || valor === undefined ? '' : String(valor).trim();
      };
      processarAba(ctx, reconhecida, aba, ler, opcoes, resultado);
    }

    if (!opcoes.simular) {
      const info = db()
        .prepare(
          `INSERT INTO importacoes
             (empresa_id, usuario_id, modulo, template_versao, arquivo_nome, arquivo_hash,
              total_linhas, importadas, duplicadas, com_erro, relatorio)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ctx.empresaId,
          ctx.usuarioId,
          opcoes.modulo === 'completo' ? 'financeiro' : opcoes.modulo,
          versao,
          opcoes.arquivoNome ?? null,
          arquivoHash,
          resultado.total_linhas,
          resultado.importadas,
          resultado.duplicadas,
          resultado.com_erro,
          JSON.stringify({ erros: resultado.erros.slice(0, 200), avisos: resultado.avisos }),
        );
      auditar(ctx, {
        entidade: 'importacao',
        entidadeId: Number(info.lastInsertRowid),
        acao: 'importar',
        depois: {
          modulo: opcoes.modulo,
          arquivo: opcoes.arquivoNome,
          importadas: resultado.importadas,
          duplicadas: resultado.duplicadas,
          com_erro: resultado.com_erro,
        },
      });
    }
    return resultado;
  };

  if (opcoes.simular) {
    // Simulação: roda dentro de uma transação e desfaz tudo ao final.
    const conexao = db();
    conexao.exec('BEGIN');
    try {
      return executar();
    } finally {
      conexao.exec('ROLLBACK');
    }
  }
  return emTransacao(executar);
}

type Leitor = (linha: Record<string, unknown>, coluna: string) => string;

function processarAba(
  ctx: Contexto,
  aba: NomeAba,
  dados: Aba,
  ler: Leitor,
  opcoes: OpcoesImportacao,
  resultado: ResultadoImportacao,
): void {
  const criar = opcoes.criarCadastrosAusentes ?? true;
  const gruposFinanceiros = new Map<string, number>();

  dados.linhas.forEach((linha, indice) => {
    const numeroLinha = indice + 2; // linha 1 = cabeçalho
    resultado.total_linhas += 1;
    try {
      switch (aba) {
        case 'Filiais':
          importarFilial(ctx, ler, linha, resultado);
          break;
        case 'TiposDespesa':
          importarTipoDespesa(ctx, ler, linha, resultado);
          break;
        case 'Cenarios':
          importarCenario(ctx, ler, linha, resultado);
          break;
        case 'Financeiro':
          importarLancamento(ctx, ler, linha, criar, resultado, gruposFinanceiros);
          break;
        case 'Projetos':
          importarProjeto(ctx, ler, linha, criar, resultado);
          break;
        case 'Tarefas':
          importarTarefa(ctx, ler, linha, resultado);
          break;
        case 'Envolvidos':
          importarEnvolvido(ctx, ler, linha, resultado);
          break;
        case 'TopicosAjuda':
          importarTopico(ctx, ler, linha, resultado);
          break;
        case 'SLA':
          importarSla(ctx, ler, linha, criar, resultado);
          break;
      }
    } catch (erro) {
      resultado.com_erro += 1;
      resultado.erros.push({
        aba,
        linha: numeroLinha,
        mensagem: erro instanceof Error ? erro.message : String(erro),
        dados: linha as Record<string, unknown>,
      });
    }
  });
}

/**
 * Cenários vêm da aba `Cenarios`. Quando a planilha não a traz (recorte só do
 * módulo financeiro), o cenário citado é criado junto com os demais cadastros.
 */
function resolverCenario(ctx: Contexto, bruto: string, criar: boolean): string {
  const chave = bruto.trim();
  if (!chave || chave === 'oficial') return 'oficial';
  const existente = db().prepare('SELECT id FROM cenarios WHERE empresa_id = ? AND chave = ?').get(ctx.empresaId, chave);
  if (existente) return garantirCenario(ctx.empresaId, chave);
  if (!criar) throw new Error(`Cenário "${chave}" não cadastrado. Cadastre-o ou habilite a criação automática.`);
  db().prepare('INSERT INTO cenarios (empresa_id, chave, nome) VALUES (?, ?, ?)').run(ctx.empresaId, chave, chave);
  return chave;
}

function resolverFilialPorNome(
  ctx: Contexto,
  nome: string,
  criar: boolean,
  resultado: ResultadoImportacao,
): number | null {
  if (!nome.trim()) return null;
  const existente = db()
    .prepare('SELECT id FROM filiais WHERE empresa_id = ? AND nome = ? COLLATE NOCASE')
    .get(ctx.empresaId, nome.trim()) as { id: number } | undefined;
  if (existente) return existente.id;
  if (!criar) throw new Error(`Filial "${nome}" não cadastrada. Cadastre-a ou habilite a criação automática.`);
  const nova = criarFilial(ctx, { nome: nome.trim() });
  resultado.cadastros_criados.filiais.push(nova.nome);
  return nova.id;
}

function importarFilial(ctx: Contexto, ler: Leitor, linha: Record<string, unknown>, resultado: ResultadoImportacao) {
  const nome = ler(linha, 'Filial');
  if (!nome) throw new Error('Nome da filial é obrigatório.');
  const existente = db()
    .prepare('SELECT id FROM filiais WHERE empresa_id = ? AND nome = ? COLLATE NOCASE')
    .get(ctx.empresaId, nome) as { id: number } | undefined;
  if (existente) {
    resultado.duplicadas += 1;
    return;
  }
  db()
    .prepare('INSERT INTO filiais (empresa_id, nome, cidade, uf, ativo) VALUES (?, ?, ?, ?, ?)')
    .run(ctx.empresaId, nome, ler(linha, 'Cidade') || null, ler(linha, 'UF') || null, interpretarBooleano(ler(linha, 'Ativo')) ? 1 : 0);
  resultado.importadas += 1;
}

function importarTipoDespesa(ctx: Contexto, ler: Leitor, linha: Record<string, unknown>, resultado: ResultadoImportacao) {
  const nome = ler(linha, 'Tipo de Despesa');
  if (!nome) throw new Error('Nome do tipo de despesa é obrigatório.');
  const existente = resolverTipoDespesa(ctx.empresaId, nome, false);
  if (existente) {
    resultado.duplicadas += 1;
    return;
  }
  db()
    .prepare('INSERT INTO tipos_despesa (empresa_id, nome, ativo) VALUES (?, ?, ?)')
    .run(ctx.empresaId, nome, interpretarBooleano(ler(linha, 'Ativo')) ? 1 : 0);
  resultado.importadas += 1;
}

function importarCenario(ctx: Contexto, ler: Leitor, linha: Record<string, unknown>, resultado: ResultadoImportacao) {
  const chave = ler(linha, 'Cenário');
  if (!chave) throw new Error('A chave do cenário é obrigatória.');
  if (chave === 'oficial') {
    resultado.duplicadas += 1; // o cenário oficial existe sempre
    return;
  }
  const existente = db()
    .prepare('SELECT id FROM cenarios WHERE empresa_id = ? AND chave = ?')
    .get(ctx.empresaId, chave);
  if (existente) {
    resultado.duplicadas += 1;
    return;
  }
  db()
    .prepare('INSERT INTO cenarios (empresa_id, chave, nome, descricao) VALUES (?, ?, ?, ?)')
    .run(ctx.empresaId, chave, ler(linha, 'Nome') || chave, ler(linha, 'Descrição') || null);
  resultado.importadas += 1;
}

function importarTopico(ctx: Contexto, ler: Leitor, linha: Record<string, unknown>, resultado: ResultadoImportacao) {
  const nome = ler(linha, 'Tópico de Ajuda');
  if (!nome) throw new Error('Nome do tópico de ajuda é obrigatório.');
  const existente = db()
    .prepare('SELECT id FROM topicos_ajuda WHERE empresa_id = ? AND nome = ? COLLATE NOCASE')
    .get(ctx.empresaId, nome);
  if (existente) {
    resultado.duplicadas += 1;
    return;
  }
  db()
    .prepare('INSERT INTO topicos_ajuda (empresa_id, nome, ativo) VALUES (?, ?, ?)')
    .run(ctx.empresaId, nome, interpretarBooleano(ler(linha, 'Ativo')) ? 1 : 0);
  resultado.importadas += 1;
}

/**
 * Cada linha financeira é gravada como uma ocorrência. Quando a coluna
 * "Parcela" está preenchida, a linha representa uma parcela já projetada e é
 * inserida como tal — é isso que permite exportar e reimportar sem perda.
 * Sem "Parcela", uma linha parcelada gera a série completa.
 */
function importarLancamento(
  ctx: Contexto,
  ler: Leitor,
  linha: Record<string, unknown>,
  criar: boolean,
  resultado: ResultadoImportacao,
  grupos: Map<string, number>,
) {
  const competenciaBruta = ler(linha, 'Competência');
  if (!ehCompetenciaValida(competenciaBruta)) {
    throw new Error(`Competência "${competenciaBruta}" inválida. Use o formato MM/AAAA.`);
  }
  const competencia = paraInterno(competenciaBruta);
  if (competenciaEstaFechada(ctx.empresaId, competencia)) {
    throw new Error(`Competência ${competenciaBruta} está fechada e não aceita importação.`);
  }

  const nomeTipo = ler(linha, 'Tipo de Despesa');
  if (!nomeTipo) throw new Error('Tipo de despesa é obrigatório.');
  const tipo = resolverTipoDespesa(ctx.empresaId, nomeTipo, criar);
  if (!tipo) {
    throw new Error(`Tipo de despesa "${nomeTipo}" não cadastrado. Cadastre-o ou habilite a criação automática.`);
  }
  if (tipo.criado) resultado.cadastros_criados.tipos_despesa.push(nomeTipo);

  const natureza = interpretarNatureza(ler(linha, 'Natureza'));
  if (!natureza) {
    throw new Error(
      `Natureza "${ler(linha, 'Natureza')}" inválida. Use fixa, pontual_unica ou pontual_parcelada.`,
    );
  }
  const classificacao = interpretarClassificacao(ler(linha, 'Classificação'));
  if (!classificacao) {
    throw new Error(`Classificação "${ler(linha, 'Classificação')}" inválida. Use despesa ou investimento.`);
  }

  let valorCentavos: number;
  try {
    valorCentavos = paraCentavos(ler(linha, 'Valor'));
  } catch {
    throw new Error(`Valor "${ler(linha, 'Valor')}" inválido.`);
  }
  if (valorCentavos < 0) throw new Error('Valor não pode ser negativo.');

  const filialId = resolverFilialPorNome(ctx, ler(linha, 'Filial'), criar, resultado);
  const parcelaNumero = interpretarInteiro(ler(linha, 'Parcela'));
  const qtdParcelas = interpretarInteiro(ler(linha, 'Qtd Parcelas'));
  const grupoArquivo = ler(linha, 'Grupo');
  const cenario = resolverCenario(ctx, ler(linha, 'Cenário'), criar);
  const descricao = ler(linha, 'Descrição') || null;
  const observacoes = ler(linha, 'Observações') || null;

  if (natureza === 'pontual_parcelada' && parcelaNumero === null && (qtdParcelas === null || qtdParcelas < 2)) {
    throw new Error('Despesa pontual parcelada exige "Qtd Parcelas" maior ou igual a 2.');
  }

  // Deduplicação por conteúdo (e não por uma chave gravada), para que a
  // reimportação de uma exportação reconheça também os registros criados pela
  // interface. Linhas idênticas repetidas no arquivo são legítimas (duas notas
  // iguais no mês): a n-ésima repetição casa com a n-ésima já existente.
  const chaveConteudo = [
    ctx.empresaId,
    filialId ?? '',
    tipo.id,
    competencia,
    valorCentavos,
    natureza,
    classificacao,
    parcelaNumero ?? '',
    cenario,
    descricao ?? '',
    observacoes ?? '',
  ].join('|');
  const ocorrencia = (grupos.get(`#${chaveConteudo}`) ?? 0) + 1;
  grupos.set(`#${chaveConteudo}`, ocorrencia);

  const existentes = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM lancamentos
        WHERE empresa_id = ? AND excluido_em IS NULL AND filial_id IS ? AND tipo_despesa_id = ?
          AND competencia = ? AND valor_centavos = ? AND natureza = ? AND classificacao = ?
          AND parcela_numero IS ? AND cenario = ?
          AND COALESCE(descricao, '') = ? AND COALESCE(observacoes, '') = ?`,
    )
    .get(
      ctx.empresaId,
      filialId,
      tipo.id,
      competencia,
      valorCentavos,
      natureza,
      classificacao,
      parcelaNumero,
      cenario,
      descricao ?? '',
      observacoes ?? '',
    ) as { n: number };

  if (ocorrencia <= existentes.n) {
    resultado.duplicadas += 1;
    return;
  }
  const dedup = chaveDedup(['lancamento', chaveConteudo, ocorrencia]);

  // Série completa: linha sem número de parcela e natureza parcelada.
  if (natureza === 'pontual_parcelada' && parcelaNumero === null) {
    const criado = criarLancamentoImportado(ctx, {
      filialId,
      tipoDespesaId: tipo.id,
      competencia: competenciaBruta,
      valorCentavos,
      natureza,
      classificacao,
      qtdParcelas: qtdParcelas!,
      cenario,
      descricao,
      observacoes,
      dedup,
    });
    resultado.importadas += criado;
    return;
  }

  const chaveGrupo = grupoArquivo ? `${tipo.id}|${grupoArquivo}` : '';
  const origemId = chaveGrupo && parcelaNumero !== null && parcelaNumero > 1 ? grupos.get(chaveGrupo) ?? null : null;

  const info = db()
    .prepare(
      `INSERT INTO lancamentos
         (empresa_id, filial_id, tipo_despesa_id, competencia, valor_centavos, natureza, classificacao,
          qtd_parcelas, parcela_numero, lancamento_origem_id, cenario, descricao, observacoes, dedup_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ctx.empresaId,
      filialId,
      tipo.id,
      competencia,
      valorCentavos,
      natureza,
      classificacao,
      qtdParcelas,
      parcelaNumero,
      origemId,
      cenario,
      descricao,
      observacoes,
      dedup,
    );
  if (chaveGrupo && (parcelaNumero === null || parcelaNumero === 1)) {
    grupos.set(chaveGrupo, Number(info.lastInsertRowid));
  }
  resultado.importadas += 1;
}

/** Gera a série de parcelas na importação, reaproveitando as regras de rateio. */
function criarLancamentoImportado(
  ctx: Contexto,
  entrada: {
    filialId: number | null;
    tipoDespesaId: number;
    competencia: string;
    valorCentavos: number;
    natureza: string;
    classificacao: string;
    qtdParcelas: number;
    cenario: string;
    descricao: string | null;
    observacoes: string | null;
    dedup: string;
  },
): number {
  const criado = criarLancamento(ctx, {
    filialId: entrada.filialId,
    tipoDespesaId: entrada.tipoDespesaId,
    competencia: entrada.competencia,
    valor: entrada.valorCentavos / 100,
    natureza: 'pontual_parcelada',
    classificacao: entrada.classificacao as 'despesa' | 'investimento',
    qtdParcelas: entrada.qtdParcelas,
    valorRefereSe: 'total',
    cenario: entrada.cenario,
    descricao: entrada.descricao,
    observacoes: entrada.observacoes,
    dedupHash: entrada.dedup,
  });
  return criado.ocorrencias;
}

function importarProjeto(
  ctx: Contexto,
  ler: Leitor,
  linha: Record<string, unknown>,
  criar: boolean,
  resultado: ResultadoImportacao,
) {
  const nome = ler(linha, 'Projeto');
  if (!nome) throw new Error('Nome do projeto é obrigatório.');
  for (const coluna of ['Mês Início', 'Mês Fim Planejado'] as const) {
    if (!ehCompetenciaValida(ler(linha, coluna))) {
      throw new Error(`"${coluna}" com valor "${ler(linha, coluna)}" inválido. Use o formato MM/AAAA.`);
    }
  }
  const fimRealBruto = ler(linha, 'Mês Fim Real');
  if (fimRealBruto && !ehCompetenciaValida(fimRealBruto)) {
    throw new Error(`"Mês Fim Real" com valor "${fimRealBruto}" inválido. Use o formato MM/AAAA.`);
  }
  const inicio = paraInterno(ler(linha, 'Mês Início'));
  const fimPlanejado = paraInterno(ler(linha, 'Mês Fim Planejado'));
  if (fimPlanejado < inicio) throw new Error('Fim planejado anterior ao início.');
  const fimReal = fimRealBruto ? paraInterno(fimRealBruto) : null;
  const filialId = resolverFilialPorNome(ctx, ler(linha, 'Filial'), criar, resultado);

  const dedup = chaveDedup(['projeto', ctx.empresaId, filialId ?? '', nome, inicio]);
  const jaExiste = db()
    .prepare(
      `SELECT id FROM projetos
        WHERE empresa_id = ? AND excluido_em IS NULL AND filial_id IS ? AND nome = ? COLLATE NOCASE AND mes_inicio = ?`,
    )
    .get(ctx.empresaId, filialId, nome, inicio);
  if (jaExiste) {
    resultado.duplicadas += 1;
    return;
  }
  const statusBruto = normalizarCabecalho(ler(linha, 'Status'));
  const status =
    ['planejado', 'emandamento', 'concluido', 'cancelado'].includes(statusBruto)
      ? statusBruto.replace('emandamento', 'em_andamento')
      : fimReal
        ? 'concluido'
        : 'planejado';

  db()
    .prepare(
      `INSERT INTO projetos (empresa_id, filial_id, nome, descricao, mes_inicio, mes_fim_planejado, mes_fim_real, status, dedup_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ctx.empresaId,
      filialId,
      nome,
      ler(linha, 'Descrição') || null,
      inicio,
      fimPlanejado,
      fimReal,
      fimReal ? 'concluido' : status,
      dedup,
    );
  resultado.importadas += 1;
}

function acharProjeto(ctx: Contexto, nome: string): number {
  const linha = db()
    .prepare('SELECT id FROM projetos WHERE empresa_id = ? AND nome = ? COLLATE NOCASE AND excluido_em IS NULL ORDER BY id LIMIT 1')
    .get(ctx.empresaId, nome.trim()) as { id: number } | undefined;
  if (!linha) throw new Error(`Projeto "${nome}" não encontrado. Importe a aba Projetos antes de Tarefas/Envolvidos.`);
  return linha.id;
}

function importarTarefa(ctx: Contexto, ler: Leitor, linha: Record<string, unknown>, resultado: ResultadoImportacao) {
  const projetoId = acharProjeto(ctx, ler(linha, 'Projeto'));
  const nome = ler(linha, 'Tarefa');
  if (!nome) throw new Error('Nome da tarefa é obrigatório.');
  for (const coluna of ['Mês Início', 'Mês Fim Planejado'] as const) {
    if (!ehCompetenciaValida(ler(linha, coluna))) {
      throw new Error(`"${coluna}" com valor "${ler(linha, coluna)}" inválido. Use o formato MM/AAAA.`);
    }
  }
  const fimRealBruto = ler(linha, 'Mês Fim Real');
  if (fimRealBruto && !ehCompetenciaValida(fimRealBruto)) {
    throw new Error(`"Mês Fim Real" com valor "${fimRealBruto}" inválido. Use o formato MM/AAAA.`);
  }
  const inicio = paraInterno(ler(linha, 'Mês Início'));
  const fimPlanejado = paraInterno(ler(linha, 'Mês Fim Planejado'));
  if (fimPlanejado < inicio) throw new Error('Fim planejado da tarefa anterior ao início.');
  const fimReal = fimRealBruto ? paraInterno(fimRealBruto) : null;

  const dedup = chaveDedup(['tarefa', projetoId, nome, inicio]);
  const jaExiste = db()
    .prepare(
      `SELECT id FROM tarefas
        WHERE projeto_id = ? AND excluido_em IS NULL AND nome = ? COLLATE NOCASE AND mes_inicio = ?`,
    )
    .get(projetoId, nome, inicio);
  if (jaExiste) {
    resultado.duplicadas += 1;
    return;
  }
  db()
    .prepare(
      `INSERT INTO tarefas (projeto_id, nome, mes_inicio, mes_fim_planejado, mes_fim_real, responsavel, status, dedup_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(projetoId, nome, inicio, fimPlanejado, fimReal, ler(linha, 'Responsável') || null, fimReal ? 'concluida' : 'pendente', dedup);
  resultado.importadas += 1;
}

function importarEnvolvido(ctx: Contexto, ler: Leitor, linha: Record<string, unknown>, resultado: ResultadoImportacao) {
  const projetoId = acharProjeto(ctx, ler(linha, 'Projeto'));
  const nome = ler(linha, 'Envolvido');
  if (!nome) throw new Error('Nome do envolvido é obrigatório.');
  const info = db()
    .prepare('INSERT OR IGNORE INTO envolvidos (projeto_id, nome, papel) VALUES (?, ?, ?)')
    .run(projetoId, nome, ler(linha, 'Papel') || null);
  if (info.changes === 0) resultado.duplicadas += 1;
  else resultado.importadas += 1;
}

function importarSla(
  ctx: Contexto,
  ler: Leitor,
  linha: Record<string, unknown>,
  criar: boolean,
  resultado: ResultadoImportacao,
) {
  const competenciaBruta = ler(linha, 'Competência');
  if (!ehCompetenciaValida(competenciaBruta)) {
    throw new Error(`Competência "${competenciaBruta}" inválida. Use o formato MM/AAAA.`);
  }
  const competencia = paraInterno(competenciaBruta);

  const nomeFila = ler(linha, 'Fila');
  const filaId = resolverFila(ctx.empresaId, nomeFila);
  if (!filaId) throw new Error(`Fila "${nomeFila}" inválida. Filas válidas: Infraestrutura, Sistema, Dados.`);

  const nomeTopico = ler(linha, 'Tópico de Ajuda');
  const topicoId = resolverTopicoAjuda(ctx.empresaId, nomeTopico, criar);
  if (nomeTopico && !topicoId) {
    throw new Error(`Tópico de ajuda "${nomeTopico}" não cadastrado.`);
  }
  if (nomeTopico && topicoId && criar) {
    const jaRegistrado = resultado.cadastros_criados.topicos_ajuda.includes(nomeTopico);
    if (!jaRegistrado) {
      const contagem = db()
        .prepare("SELECT COUNT(*) AS n FROM tickets_sla WHERE topico_ajuda_id = ?")
        .get(topicoId) as { n: number };
      if (contagem.n === 0) resultado.cadastros_criados.topicos_ajuda.push(nomeTopico);
    }
  }

  const total = interpretarInteiro(ler(linha, 'Total Atendidos'));
  const dentro = interpretarInteiro(ler(linha, 'Dentro SLA'));
  const foraBruto = interpretarInteiro(ler(linha, 'Fora SLA'));
  if (total === null || total < 0) throw new Error(`"Total Atendidos" com valor "${ler(linha, 'Total Atendidos')}" inválido.`);
  if (dentro === null || dentro < 0) throw new Error(`"Dentro SLA" com valor "${ler(linha, 'Dentro SLA')}" inválido.`);
  const fora = foraBruto === null ? total - dentro : foraBruto;
  if (fora < 0) throw new Error('"Fora SLA" não pode ser negativo.');
  if (dentro + fora !== total) {
    throw new Error(`Inconsistência: dentro (${dentro}) + fora (${fora}) difere do total (${total}).`);
  }

  const filialId = resolverFilialPorNome(ctx, ler(linha, 'Filial'), criar, resultado);
  const dedup = chaveDedup(['sla', ctx.empresaId, filialId ?? '', competencia, filaId, topicoId ?? '']);
  const jaExiste = db()
    .prepare(
      `SELECT id FROM tickets_sla
        WHERE empresa_id = ? AND excluido_em IS NULL AND filial_id IS ? AND competencia = ?
          AND fila_id = ? AND topico_ajuda_id IS ?`,
    )
    .get(ctx.empresaId, filialId, competencia, filaId, topicoId);
  if (jaExiste) {
    resultado.duplicadas += 1;
    return;
  }
  db()
    .prepare(
      `INSERT INTO tickets_sla
         (empresa_id, filial_id, competencia, fila_id, topico_ajuda_id, total_atendidos, dentro_sla, fora_sla, observacoes, dedup_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(ctx.empresaId, filialId, competencia, filaId, topicoId, total, dentro, fora, ler(linha, 'Observações') || null, dedup);
  resultado.importadas += 1;
}

export function listarImportacoes(ctx: Contexto) {
  return db()
    .prepare(
      `SELECT id, modulo, template_versao, arquivo_nome, total_linhas, importadas, duplicadas, com_erro, criado_em
         FROM importacoes WHERE empresa_id = ? ORDER BY id DESC LIMIT 50`,
    )
    .all(ctx.empresaId);
}
