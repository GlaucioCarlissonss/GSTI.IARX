import { db, emTransacao } from '../db/index.js';
import { chaveDedup, hashArquivo } from '../lib/hash.js';
import { erroNaoEncontrado, erroValidacao } from '../lib/erros.js';
import { auditar } from './auditoria.js';
import { ehCompetenciaValida, paraInterno } from './competencia.js';
import type { Contexto } from './contexto.js';
import { escopoSql, clausulaEmpresas, comEmpresaEmFoco } from './escopo.js';
import { escopoDoCliente, escopoParaLog, type EscopoOperacao } from './escopo-operacao.js';
import { paraCentavos } from './dinheiro.js';
import {
  criarLancamento,
  garantirCenario,
  gravarBeneficiadas,
  interpretarOrigem,
  interpretarTipoConsumo,
  resolverBeneficiadas,
  type Origem,
  type TipoConsumo,
} from './financeiro.js';
import { criarFilial, resolverFila, resolverTipoDespesa, resolverTopicoAjuda } from './cadastros.js';
import { apelidosDoCliente } from './mapeamentos.js';
import { atualizarTarefa } from './projetos.js';
import { competenciaEstaFechada } from './fechamento.js';
import { decodificarTexto, lerCsv, lerXlsx, type Aba } from '../lib/planilha.js';
import {
  ABA_INSTRUCOES,
  ABAS,
  ABAS_POR_MODULO,
  COLUNA_EMPRESA,
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

/**
 * Como a carga foi pedida.
 *
 * `inicial` é o histórico inteiro do cliente entrando de uma vez, e só faz
 * sentido numa base ainda sem aquele módulo. `incremental` é o arquivo do mês.
 * A distinção não muda o que é gravado — a deduplicação por linha já protege —,
 * ela muda o que o sistema DEIXA acontecer sem confirmação, e fica no registro
 * para quem for entender depois de onde veio cada bloco de dado.
 */
export type ModoCarga = 'inicial' | 'incremental';

export interface ResultadoImportacao {
  template_versao: string;
  modo: ModoCarga;
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
  /**
   * As unidades sobre as quais esta carga opera. Sem escopo, a carga é do
   * cliente inteiro — o padrão de toda operação de arquivo.
   */
  escopo?: EscopoOperacao;
  arquivoNome?: string | null;
  /** Cadastra automaticamente tipos de despesa/tópicos/filiais ausentes. */
  criarCadastrosAusentes?: boolean;
  /** Valida sem gravar nada (pré-visualização). */
  simular?: boolean;
  /** Carga inicial (histórico) ou incremental (o arquivo do período). */
  modo?: ModoCarga;
  /** Autoriza a carga inicial mesmo com o módulo já povoado. */
  confirmarSobrescrita?: boolean;
}

/**
 * Grava a linha do registro de importação (o ImportLog).
 *
 * Toda tentativa de carga que não é simulação passa por aqui — a concluída e a
 * recusada. O registro é o que responde, semanas depois, de onde veio cada
 * bloco de dado e por que uma carga não entrou.
 */
export function registrarImportacao(
  ctx: Contexto,
  dados: {
    modulo: Modulo;
    modo: ModoCarga;
    versao: string;
    arquivoNome: string | null;
    arquivoHash: string;
    status: 'concluida' | 'recusada';
    mensagem: string | null;
    contagens: {
      total: number;
      importadas: number;
      duplicadas: number;
      com_erro: number;
      /** Linha que já existia e foi atualizada — só a conciliação produz. */
      atualizadas?: number;
      /** Linha que quem importou decidiu não trazer. */
      rejeitadas?: number;
    };
    relatorio: { erros: ErroLinha[]; avisos: string[] };
    /** O que se decidiu em cada divergência, quando a carga foi conciliada. */
    decisoes?: unknown;
    /** As unidades que a carga atingiu — o que o histórico filtra depois. */
    escopo?: EscopoOperacao;
  },
): number {
  const info = db()
    .prepare(
      `INSERT INTO importacoes
         (empresa_id, cliente_id, usuario_id, modulo, modo, status, mensagem, template_versao, arquivo_nome,
          arquivo_hash, total_linhas, importadas, atualizadas, duplicadas, rejeitadas, com_erro, relatorio, decisoes,
          escopo, escopo_unidades)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ctx.empresaId,
      // O dono vai gravado na linha, e não só no backfill da abertura do banco:
      // entre uma reinicialização e outra, a carga ficaria sem cliente e sumiria
      // do histórico de quem a fez.
      ctx.clienteId,
      ctx.usuarioId,
      dados.modulo === 'completo' ? 'financeiro' : dados.modulo,
      dados.modo,
      dados.status,
      dados.mensagem,
      dados.versao,
      dados.arquivoNome,
      dados.arquivoHash,
      dados.contagens.total,
      dados.contagens.importadas,
      dados.contagens.atualizadas ?? 0,
      dados.contagens.duplicadas,
      dados.contagens.rejeitadas ?? 0,
      dados.contagens.com_erro,
      JSON.stringify({ erros: dados.relatorio.erros.slice(0, 500), avisos: dados.relatorio.avisos }),
      dados.decisoes === undefined ? null : JSON.stringify(dados.decisoes),
      dados.escopo?.modo ?? 'cliente',
      dados.escopo ? escopoParaLog(dados.escopo) : null,
    );
  const id = Number(info.lastInsertRowid);
  auditar(ctx, {
    entidade: 'importacao',
    entidadeId: id,
    acao: 'importar',
    depois: {
      modulo: dados.modulo,
      modo: dados.modo,
      status: dados.status,
      arquivo: dados.arquivoNome,
      importadas: dados.contagens.importadas,
      duplicadas: dados.contagens.duplicadas,
      com_erro: dados.contagens.com_erro,
      escopo: dados.escopo?.modo ?? 'cliente',
      empresas: dados.escopo?.empresas.length ?? 1,
    },
  });
  return id;
}

/**
 * Quantos registros o módulo já tem NO ESCOPO — é o que decide se a carga
 * inicial precisa de confirmação.
 *
 * Conta o escopo inteiro, e não a matriz em foco: uma carga do cliente inteiro
 * sobre uma base povoada é exatamente o engano que a confirmação existe para
 * pegar, e olhar uma matriz só a deixaria passar.
 */
function jaTemDados(escopo: EscopoOperacao, modulo: Modulo): number {
  const { sql, params } = clausulaEmpresas(escopo.empresas);
  const conta = (consulta: string) => (db().prepare(consulta).get(...params) as { n: number }).n;
  if (modulo === 'sla') return conta(`SELECT COUNT(*) n FROM tickets_sla WHERE ${sql}`);
  if (modulo === 'projetos') return conta(`SELECT COUNT(*) n FROM projetos WHERE ${sql}`);
  return conta(`SELECT COUNT(*) n FROM lancamentos WHERE ${sql} AND excluido_em IS NULL`);
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

/**
 * Data/hora do chamado. Aceita ISO (`2026-09-10T20:31Z`), `dd/mm/aaaa hh:mm` e
 * `dd/mm/aaaa`, que é o que sai tanto do helpdesk quanto do Excel. Guarda em
 * ISO, para comparar e ordenar com operador de string.
 */
function interpretarDataHora(bruto: unknown): string | null {
  const texto = String(bruto ?? '').trim();
  if (!texto) return null;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/.exec(texto);
  if (br) {
    const [, d, m, a, hh, mm] = br;
    return `${a}-${m}-${d}T${hh ?? '00'}:${mm ?? '00'}Z`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(texto);
  if (iso) {
    const [, a, m, d, hh, mm] = iso;
    return `${a}-${m}-${d}T${hh ?? '00'}:${mm ?? '00'}Z`;
  }
  throw new Error(`Data "${texto}" inválida. Use dd/mm/aaaa hh:mm ou AAAA-MM-DDThh:mm.`);
}

function interpretarDecimal(bruto: unknown): number | null {
  const texto = String(bruto ?? '').trim().replace(',', '.');
  if (!texto) return null;
  const n = Number(texto);
  if (!Number.isFinite(n) || n < 0) throw new Error(`"Horas" com valor "${bruto}" inválido.`);
  return n;
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
    const linhas = lerCsv(decodificarTexto(buffer));
    const colunas = linhas.length > 0 ? Object.keys(linhas[0]!) : [];
    return [{ nome: abaPadrao ?? 'Financeiro', colunas, linhas }];
  }
  return lerXlsx(buffer);
}

/**
 * De qual MATRIZ é esta linha.
 *
 * Até a versão 1.3 do template a pergunta não existia: quem importava escolhia
 * a unidade na tela e o arquivo inteiro ia para ela. Com a carga passando a ser
 * do cliente, cada linha diz a quem pertence pela coluna `Empresa` — e o nome
 * casa sem acento, sem caixa e sem pontuação, como todo cabeçalho já casa.
 *
 * Nome de fora do escopo é recusa, e não criação: matriz é decisão de estrutura
 * do contratante, nunca consequência de uma planilha.
 */
function resolvedorDeEmpresa(escopo: EscopoOperacao): (bruto: string) => number {
  const { sql, params } = clausulaEmpresas(escopo.empresas, 'id');
  const linhas = db().prepare(`SELECT id, nome FROM empresas WHERE ${sql}`).all(...params) as Array<{
    id: number;
    nome: string;
  }>;
  const porNome = new Map(linhas.map((e) => [normalizarCabecalho(e.nome), e.id]));
  const disponiveis = linhas.map((e) => e.nome).join(', ');

  return (bruto: string): number => {
    const nome = (bruto ?? '').trim();
    if (!nome) {
      // Sem a coluna, a linha só tem destino possível se o escopo tiver uma
      // unidade. Com várias, adivinhar seria escolher no lugar de quem importa.
      if (escopo.empresas.length === 1) return escopo.empresas[0]!;
      throw new Error(
        `A coluna "${COLUNA_EMPRESA}" está vazia nesta linha e o escopo desta carga tem ` +
          `${escopo.empresas.length} empresas. Informe a empresa da linha ou refaça a carga com uma unidade só.`,
      );
    }
    const id = porNome.get(normalizarCabecalho(nome));
    if (!id) {
      throw new Error(
        `A empresa "${nome}" não está no escopo desta carga. Empresas do escopo: ${disponiveis}.`,
      );
    }
    return id;
  };
}

/**
 * A trava do enunciado: escopo com várias unidades exige a coluna `Empresa`.
 *
 * É conferida ANTES de a transação começar, e bloqueia o arquivo inteiro em vez
 * de recusar linha a linha. Um arquivo sem a coluna num escopo múltiplo não tem
 * uma linha certa: tem o destino de todas indefinido.
 */
function abaSemColunaEmpresa(
  ctx: Contexto,
  escopo: EscopoOperacao,
  abas: Aba[],
  abasEsperadas: NomeAba[],
): string | null {
  if (escopo.empresas.length <= 1) return null;
  for (const aba of abas) {
    const reconhecida = reconhecerAba(aba.nome);
    if (!reconhecida || !abasEsperadas.includes(reconhecida)) continue;
    const mapa = mapearColunas(reconhecida, aba.colunas, apelidosDoCliente(ctx.clienteId, reconhecida));
    if (!mapa.has(COLUNA_EMPRESA)) {
      return (
        `O escopo desta carga tem ${escopo.empresas.length} empresas, e a aba "${aba.nome}" não traz a coluna ` +
        `"${COLUNA_EMPRESA}" — sem ela não há como saber de qual unidade é cada linha. ` +
        `Acrescente a coluna ao arquivo, ou escolha uma unidade só no escopo da operação.`
      );
    }
  }
  return null;
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
  const modo: ModoCarga = opcoes.modo === 'inicial' ? 'inicial' : 'incremental';
  // Sem escolha explícita, a carga é do cliente inteiro — o padrão de toda
  // operação de arquivo desde que o escopo deixou de ser uma matriz só.
  const escopo = opcoes.escopo ?? escopoDoCliente(ctx);

  const abasEsperadas = ABAS_POR_MODULO[opcoes.modulo];
  const abaPadrao = abasEsperadas[abasEsperadas.length - 1];
  const arquivoHash = hashArquivo(buffer);

  // Arquivo ilegível é tentativa de carga, e tentativa de carga deixa rastro:
  // sem a linha de registro, "por que os dados não entraram?" não teria onde
  // ser respondido depois — e é justamente a carga que falha que se investiga.
  let abas;
  try {
    abas = await interpretarArquivo(buffer, opcoes.arquivoNome ?? null, abaPadrao);
  } catch (erro) {
    if (!opcoes.simular) {
      registrarImportacao(ctx, {
        modulo: opcoes.modulo,
        modo,
        versao: TEMPLATE_VERSAO_ATUAL,
        arquivoNome: opcoes.arquivoNome ?? null,
        arquivoHash,
        status: 'recusada',
        mensagem: erro instanceof Error ? erro.message : String(erro),
        contagens: { total: 0, importadas: 0, duplicadas: 0, com_erro: 0 },
        relatorio: { erros: [], avisos: [] },
        escopo: escopo,
      });
    }
    throw erro;
  }
  const versao = detectarVersao(abas);

  // A trava do escopo múltiplo vem ANTES de qualquer gravação: um arquivo sem a
  // coluna de empresa não tem uma linha errada, tem o destino de todas indefinido.
  const semEmpresa = abaSemColunaEmpresa(ctx, escopo, abas, abasEsperadas);
  if (semEmpresa) {
    if (!opcoes.simular) {
      registrarImportacao(ctx, {
        modulo: opcoes.modulo,
        modo,
        versao,
        arquivoNome: opcoes.arquivoNome ?? null,
        arquivoHash,
        status: 'recusada',
        mensagem: semEmpresa,
        contagens: { total: 0, importadas: 0, duplicadas: 0, com_erro: 0 },
        relatorio: { erros: [], avisos: [] },
        escopo: escopo,
      });
    }
    throw erroValidacao(semEmpresa);
  }

  // A carga inicial é o histórico inteiro entrando de uma vez. Sobre um módulo
  // que já tem dado, ela quase sempre é engano de quem escolheu o modo — e a
  // recusa vem com o número na frente, para a confirmação ser informada.
  if (modo === 'inicial' && !opcoes.simular && !opcoes.confirmarSobrescrita) {
    const existentes = jaTemDados(escopo, opcoes.modulo);
    if (existentes > 0) {
      const mensagem =
        `O escopo desta carga já tem ${existentes} registro(s) neste módulo, e ela foi marcada como INICIAL. ` +
        `Use a carga incremental, ou confirme a inicial se a intenção é recarregar o histórico ` +
        `(nada é duplicado: a deduplicação por linha continua valendo).`;
      registrarImportacao(ctx, {
        modulo: opcoes.modulo,
        modo,
        versao,
        arquivoNome: opcoes.arquivoNome ?? null,
        arquivoHash,
        status: 'recusada',
        mensagem,
        contagens: { total: 0, importadas: 0, duplicadas: 0, com_erro: 0 },
        relatorio: { erros: [], avisos: [] },
        escopo: escopo,
      });
      throw erroValidacao(mensagem);
    }
  }

  // O mesmo arquivo pode ter sido carregado por outra unidade do cliente: o
  // aviso é do CLIENTE, como a carga passou a ser.
  const jaImportado =
    db()
      .prepare('SELECT id FROM importacoes WHERE cliente_id IS ? AND arquivo_hash = ?')
      .get(ctx.clienteId, arquivoHash) !== undefined;

  const resultado: ResultadoImportacao = {
    template_versao: versao,
    modo,
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
        // `_meta` e `Instruções` são partes do próprio template: avisar que
        // foram ignoradas faria o relatório apontar problema onde não há.
        const chave = normalizarCabecalho(aba.nome);
        if (chave !== 'meta' && chave !== normalizarCabecalho(ABA_INSTRUCOES)) resultado.abas_ignoradas.push(aba.nome);
        continue;
      }
      // O adaptador do cliente entra aqui: o cabeçalho que ELE usa passa a ser
      // aceito, sem que ninguém precise reescrever a planilha antes de enviar.
      const mapa = mapearColunas(reconhecida, aba.colunas, apelidosDoCliente(ctx.clienteId, reconhecida));
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
      processarAba(ctx, escopo, reconhecida, aba, ler, opcoes, resultado);
    }

    if (!opcoes.simular) {
      registrarImportacao(ctx, {
        modulo: opcoes.modulo,
        modo,
        versao,
        arquivoNome: opcoes.arquivoNome ?? null,
        arquivoHash,
        status: 'concluida',
        mensagem: null,
        contagens: {
          total: resultado.total_linhas,
          importadas: resultado.importadas,
          duplicadas: resultado.duplicadas,
          com_erro: resultado.com_erro,
        },
        relatorio: { erros: resultado.erros, avisos: resultado.avisos },
        escopo: escopo,
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
  escopo: EscopoOperacao,
  aba: NomeAba,
  dados: Aba,
  ler: Leitor,
  opcoes: OpcoesImportacao,
  resultado: ResultadoImportacao,
): void {
  const criar = opcoes.criarCadastrosAusentes ?? true;
  // A matriz é resolvida uma vez por LINHA e entra num contexto próprio. Daí
  // para baixo nada muda: cada rotina continua lendo `ctx.empresaId`, só que
  // agora ele é o da linha, e não o de um foco escolhido na tela.
  const daEmpresa = resolvedorDeEmpresa(escopo);
  const gruposFinanceiros = new Map<string, number>();
  // A planilha pode citar a tarefa principal antes de a linha dela existir,
  // ou até depois. O vínculo é resolvido numa segunda passada, ao fim da aba.
  const vinculosDeTarefa: Array<{ empresaId: number; projetoId: number; filha: string; pai: string; linha: number }> = [];

  dados.linhas.forEach((linha, indice) => {
    const numeroLinha = indice + 2; // linha 1 = cabeçalho
    resultado.total_linhas += 1;
    try {
      const ctxLinha = comEmpresaEmFoco(ctx, daEmpresa(ler(linha, COLUNA_EMPRESA)));
      switch (aba) {
        case 'Filiais':
          importarFilial(ctxLinha, ler, linha, resultado);
          break;
        case 'TiposDespesa':
          importarTipoDespesa(ctxLinha, ler, linha, resultado);
          break;
        case 'Cenarios':
          importarCenario(ctxLinha, ler, linha, resultado);
          break;
        case 'Financeiro':
          importarLancamento(ctxLinha, ler, linha, criar, resultado, gruposFinanceiros);
          break;
        case 'Projetos':
          importarProjeto(ctxLinha, ler, linha, criar, resultado);
          break;
        case 'Tarefas':
          importarTarefa(ctxLinha, ler, linha, resultado, vinculosDeTarefa, numeroLinha);
          break;
        case 'Envolvidos':
          importarEnvolvido(ctxLinha, ler, linha, resultado);
          break;
        case 'TopicosAjuda':
          importarTopico(ctxLinha, ler, linha, resultado);
          break;
        case 'SLA':
          importarSla(ctxLinha, ler, linha, criar, resultado);
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

  if (aba === 'Tarefas') aplicarVinculosDeTarefa(ctx, vinculosDeTarefa, resultado);
}

/**
 * Segunda passada da aba Tarefas: liga cada filha à sua tarefa principal,
 * agora que todas as linhas existem. A linha inválida entra no relatório com
 * o motivo, sem desfazer a tarefa em si — ela vale mesmo sem o agrupamento.
 */
function aplicarVinculosDeTarefa(
  ctx: Contexto,
  vinculos: Array<{ empresaId: number; projetoId: number; filha: string; pai: string; linha: number }>,
  resultado: ResultadoImportacao,
) {
  for (const v of vinculos) {
    try {
      const acharNoProjeto = (nome: string) =>
        db()
          .prepare(
            'SELECT id FROM tarefas WHERE projeto_id = ? AND excluido_em IS NULL AND nome = ? COLLATE NOCASE ORDER BY id LIMIT 1',
          )
          .get(v.projetoId, nome) as { id: number } | undefined;
      const filha = acharNoProjeto(v.filha);
      const pai = acharNoProjeto(v.pai);
      if (!filha) continue;
      if (!pai) throw new Error(`Tarefa principal "${v.pai}" não existe neste projeto.`);
      // Passa pelo domínio, para herdar as validações de ciclo e profundidade
      // em vez de gravar direto e deixar a planilha criar uma árvore inválida.
      atualizarTarefa(comEmpresaEmFoco(ctx, v.empresaId), filha.id, { parentTaskId: pai.id });
    } catch (erro) {
      resultado.com_erro += 1;
      resultado.erros.push({
        aba: 'Tarefas',
        linha: v.linha,
        mensagem: erro instanceof Error ? erro.message : String(erro),
        dados: { Tarefa: v.filha, 'Tarefa Principal': v.pai },
      });
    }
  }
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

/**
 * As filiais beneficiadas nomeadas na planilha.
 *
 * Separadas por `|`, `;` ou `/`, ou a palavra "Todas" para o grupo inteiro.
 * A busca atravessa as matrizes do cliente — quem consome uma licença
 * centralizada pode estar em outra matriz —, e por isso o nome pode vir
 * qualificado como "Matriz Sul > Filial Oeste" quando duas filiais de matrizes
 * diferentes se chamam igual.
 *
 * Diferente de `resolverFilialPorNome`, aqui NUNCA se cria cadastro: uma
 * beneficiada é sempre uma unidade que já existe, e criar filial a partir de um
 * erro de digitação nesta coluna encheria o cadastro de fantasmas.
 */
function resolverBeneficiadasPorNome(ctx: Contexto, texto: string): number[] | 'todas' | null {
  const bruto = texto.trim();
  if (!bruto) return null;
  const semAcento = (t: string) =>
    t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (semAcento(bruto) === 'todas' || semAcento(bruto) === 'todas as filiais') return 'todas';

  const alcance = escopoSql(ctx, null, 'f.empresa_id');
  const conhecidas = db()
    .prepare(
      `SELECT f.id, f.nome, e.nome AS empresa_nome
         FROM filiais f JOIN empresas e ON e.id = f.empresa_id
        WHERE ${alcance.sql}`,
    )
    .all(...alcance.params) as Array<{ id: number; nome: string; empresa_nome: string }>;

  const ids: number[] = [];
  for (const parte of bruto.split(/[|;/]/)) {
    const nome = parte.trim();
    if (!nome) continue;
    const alvo = semAcento(nome);
    const achadas = conhecidas.filter(
      (f) => semAcento(f.nome) === alvo || semAcento(`${f.empresa_nome} > ${f.nome}`) === alvo,
    );
    if (!achadas.length) {
      throw new Error(`Filial beneficiada "${nome}" não encontrada neste cliente.`);
    }
    if (achadas.length > 1) {
      throw new Error(
        `Filial beneficiada "${nome}" existe em mais de uma matriz. Qualifique como "Matriz > Filial".`,
      );
    }
    ids.push(achadas[0]!.id);
  }
  return ids;
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
  // Arquivo sem a coluna Origem (modelo 1.0, ou planilha do próprio gestor) é
  // planilha por definição: veio de fora, não foi lançado aqui.
  const origem = interpretarOrigem(ler(linha, 'Origem')) ?? 'planilha';

  // Consumo (modelo 1.5). Coluna ausente vale 'integral', que é a leitura que o
  // sistema fazia antes de a pergunta existir — o arquivo 1.4 entra igual.
  // Nomear beneficiadas sem dizer o tipo já diz o tipo: exigir as duas colunas
  // rejeitaria um arquivo cuja intenção é inequívoca.
  const beneficiadasArquivo = resolverBeneficiadasPorNome(ctx, ler(linha, 'Filiais Beneficiadas'));
  const tipoConsumo: TipoConsumo =
    interpretarTipoConsumo(ler(linha, 'Tipo de Consumo')) ?? (beneficiadasArquivo ? 'compartilhado' : 'integral');
  if (tipoConsumo === 'compartilhado' && !beneficiadasArquivo) {
    throw new Error('Tipo de consumo "beneficia outras" exige a coluna "Filiais Beneficiadas" preenchida.');
  }

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
      origem,
      descricao,
      observacoes,
      dedup,
      tipoConsumo,
      beneficiadas: beneficiadasArquivo,
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
          qtd_parcelas, parcela_numero, lancamento_origem_id, cenario, origem, descricao, observacoes, dedup_hash,
          tipo_consumo, beneficia_todas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      origem,
      descricao,
      observacoes,
      dedup,
      tipoConsumo,
      beneficiadasArquivo === 'todas' ? 1 : 0,
    );
  const idNovo = Number(info.lastInsertRowid);
  if (tipoConsumo === 'compartilhado') {
    // A lista é congelada aqui, na carga: reimportar o mesmo arquivo depois de
    // cadastrar uma filial nova não pode mudar quem consumia um mês fechado.
    gravarBeneficiadas([idNovo], resolverBeneficiadas(ctx, tipoConsumo, beneficiadasArquivo, filialId));
  }
  if (chaveGrupo && (parcelaNumero === null || parcelaNumero === 1)) {
    grupos.set(chaveGrupo, idNovo);
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
    origem: Origem;
    descricao: string | null;
    observacoes: string | null;
    dedup: string;
    tipoConsumo: TipoConsumo;
    beneficiadas: number[] | 'todas' | null;
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
    origem: entrada.origem,
    dedupHash: entrada.dedup,
    tipoConsumo: entrada.tipoConsumo,
    beneficiadas: entrada.beneficiadas,
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

function importarTarefa(
  ctx: Contexto,
  ler: Leitor,
  linha: Record<string, unknown>,
  resultado: ResultadoImportacao,
  vinculos: Array<{ empresaId: number; projetoId: number; filha: string; pai: string; linha: number }>,
  numeroLinha: number,
) {
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
  const pai = ler(linha, 'Tarefa Principal');
  if (pai && pai.toLowerCase() === nome.toLowerCase()) {
    throw new Error('Uma tarefa não pode ser a própria tarefa principal.');
  }
  if (pai) vinculos.push({ empresaId: ctx.empresaId, projetoId, filha: nome, pai, linha: numeroLinha });

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
  const observacoes = ler(linha, 'Observações') || null;

  // Linha com `Ticket` é UM chamado do helpdesk, e a identidade dele é o id de
  // lá — não o conteúdo. É o que torna a recarga da mesma extração idempotente
  // e ainda assim capaz de trazer o que mudou (fechamento, status, horas).
  const ticketId = interpretarInteiro(ler(linha, 'Ticket'));
  if (ticketId !== null) {
    const chamado = {
      ticket_id: ticketId,
      numero: ler(linha, 'Número') || null,
      assunto: ler(linha, 'Assunto') || null,
      solicitante: ler(linha, 'Solicitante') || null,
      responsavel: ler(linha, 'Responsável') || null,
      nivel: ler(linha, 'Nível') || null,
      status: ler(linha, 'Status') || null,
      origem_chamado: ler(linha, 'Origem') || null,
      aberto_em: interpretarDataHora(ler(linha, 'Aberto em')),
      fechado_em: interpretarDataHora(ler(linha, 'Fechado em')),
      prazo_em: interpretarDataHora(ler(linha, 'Prazo')),
      horas: interpretarDecimal(ler(linha, 'Horas')),
    };
    const anterior = db()
      .prepare('SELECT * FROM tickets_sla WHERE empresa_id = ? AND ticket_id = ? AND excluido_em IS NULL')
      .get(ctx.empresaId, ticketId) as Record<string, unknown> | undefined;

    if (anterior) {
      const igual =
        anterior.filial_id === filialId &&
        anterior.competencia === competencia &&
        anterior.fila_id === filaId &&
        (anterior.topico_ajuda_id ?? null) === topicoId &&
        anterior.total_atendidos === total &&
        anterior.dentro_sla === dentro &&
        (anterior.observacoes ?? null) === observacoes &&
        Object.entries(chamado).every(([k, v]) => (anterior[k] ?? null) === v);
      if (igual) {
        resultado.duplicadas += 1;
        return;
      }
      db()
        .prepare(
          `UPDATE tickets_sla SET filial_id = ?, competencia = ?, fila_id = ?, topico_ajuda_id = ?,
                  total_atendidos = ?, dentro_sla = ?, fora_sla = ?, observacoes = ?,
                  numero = ?, assunto = ?, solicitante = ?, responsavel = ?, nivel = ?, status = ?,
                  origem_chamado = ?, aberto_em = ?, fechado_em = ?, prazo_em = ?, horas = ?,
                  atualizado_em = datetime('now')
            WHERE id = ?`,
        )
        .run(
          filialId, competencia, filaId, topicoId, total, dentro, fora, observacoes,
          chamado.numero, chamado.assunto, chamado.solicitante, chamado.responsavel,
          chamado.nivel, chamado.status, chamado.origem_chamado,
          chamado.aberto_em, chamado.fechado_em, chamado.prazo_em, chamado.horas,
          anterior.id,
        );
      resultado.importadas += 1;
      return;
    }

    db()
      .prepare(
        `INSERT INTO tickets_sla
           (empresa_id, filial_id, competencia, fila_id, topico_ajuda_id, total_atendidos, dentro_sla, fora_sla, observacoes,
            ticket_id, numero, assunto, solicitante, responsavel, nivel, status, origem_chamado, aberto_em, fechado_em, prazo_em, horas)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ctx.empresaId, filialId, competencia, filaId, topicoId, total, dentro, fora, observacoes,
        ticketId, chamado.numero, chamado.assunto, chamado.solicitante, chamado.responsavel,
        chamado.nivel, chamado.status, chamado.origem_chamado,
        chamado.aberto_em, chamado.fechado_em, chamado.prazo_em, chamado.horas,
      );
    resultado.importadas += 1;
    return;
  }

  // Registro agregado mensal: a identidade é o próprio conteúdo.
  const dedup = chaveDedup(['sla', ctx.empresaId, filialId ?? '', competencia, filaId, topicoId ?? '']);
  const jaExiste = db()
    .prepare(
      `SELECT id FROM tickets_sla
        WHERE empresa_id = ? AND excluido_em IS NULL AND ticket_id IS NULL AND filial_id IS ? AND competencia = ?
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
    .run(ctx.empresaId, filialId, competencia, filaId, topicoId, total, dentro, fora, observacoes, dedup);
  resultado.importadas += 1;
}

/**
 * O histórico de cargas do CLIENTE, não o da matriz em foco.
 *
 * Quem pergunta "por que os dados não entraram?" não sabe de antemão em qual
 * unidade a carga foi feita — e era exatamente essa a pergunta que o histórico
 * existe para responder. A coluna da unidade vem junto para distinguir as linhas.
 */
/**
 * Quando a base deste cliente foi atualizada pela última vez.
 *
 * É o que as telas do financeiro mostram no canto: sem isso, quem abre o painel
 * não tem como saber se está olhando o fechamento de ontem ou o do mês passado.
 * Só carga CONCLUÍDA conta — uma tentativa recusada não atualizou nada.
 */
export function ultimaCarga(ctx: Contexto): { em: string | null; arquivo: string | null } {
  const linha = db()
    .prepare(
      `SELECT criado_em, arquivo_nome FROM importacoes
        WHERE cliente_id = ? AND status = 'concluida'
        ORDER BY criado_em DESC, id DESC LIMIT 1`,
    )
    .get(ctx.clienteId) as { criado_em: string; arquivo_nome: string | null } | undefined;
  return { em: linha?.criado_em ?? null, arquivo: linha?.arquivo_nome ?? null };
}

/** Recorte do histórico de cargas. Campo vazio não filtra. */
export interface FiltroImportacoes {
  /** 'inicial' | 'incremental' */
  modo?: string | null;
  /** 'concluida' | 'recusada' */
  status?: string | null;
  usuario_id?: number | null;
  /** Data ISO (AAAA-MM-DD) — inclusive nas duas pontas. */
  de?: string | null;
  ate?: string | null;
  /** 'cliente' | 'empresas' | 'unidades' — o escopo com que a carga rodou. */
  escopo?: string | null;
}

export function listarImportacoes(ctx: Contexto, empresas?: number[], filtro: FiltroImportacoes = {}) {
  const alcance = escopoSql(ctx, empresas, 'i.empresa_id');
  const condicoes = [alcance.sql];
  const params: unknown[] = [...alcance.params];

  // O histórico responde "por que os dados não entraram?", e quem pergunta
  // isso já sabe mais ou menos quando e quem — por isso o recorte é por modo,
  // situação, responsável e período.
  const juntar = (sql: string, valor: unknown) => {
    if (valor === null || valor === undefined || valor === '') return;
    condicoes.push(sql);
    params.push(valor);
  };
  juntar('i.modo = ?', filtro.modo);
  juntar('i.status = ?', filtro.status);
  juntar('i.usuario_id = ?', filtro.usuario_id);
  juntar('i.escopo = ?', filtro.escopo);
  juntar('date(i.criado_em) >= date(?)', filtro.de);
  juntar('date(i.criado_em) <= date(?)', filtro.ate);

  return db()
    .prepare(
      `SELECT i.id, i.modulo, i.modo, i.status, i.mensagem, i.template_versao, i.arquivo_nome,
              i.total_linhas, i.importadas, i.atualizadas, i.duplicadas, i.rejeitadas, i.com_erro,
              i.criado_em, u.nome AS usuario, i.usuario_id, i.escopo, i.escopo_unidades,
              i.empresa_id, e.nome AS empresa_nome
         FROM importacoes i
         -- LEFT: a carga vale pelo cliente, e uma matriz removida depois não
         -- pode apagar o registro de que ela aconteceu.
         LEFT JOIN empresas e ON e.id = i.empresa_id
         LEFT JOIN usuarios u ON u.id = i.usuario_id
        WHERE ${condicoes.join(' AND ')} ORDER BY i.id DESC LIMIT 50`,
    )
    .all(...params);
}

/**
 * Uma carga, com o relatório inteiro. É de onde sai a lista de linhas
 * recusadas — o gestor corrige o arquivo olhando o motivo de cada uma.
 */
export function obterImportacao(
  ctx: Contexto,
  id: number,
): Record<string, unknown> & { id: number; relatorio: { erros: ErroLinha[]; avisos: string[] } } {
  const alcance = escopoSql(ctx, null, 'i.empresa_id');
  const linha = db()
    .prepare(
      `SELECT i.*, u.nome AS usuario FROM importacoes i LEFT JOIN usuarios u ON u.id = i.usuario_id
        WHERE i.id = ? AND ${alcance.sql}`,
    )
    .get(id, ...alcance.params) as (Record<string, unknown> & { id: number; relatorio: string | null }) | undefined;
  if (!linha) throw erroNaoEncontrado(`Importação ${id} não encontrada neste cliente.`);
  let relatorio: { erros: ErroLinha[]; avisos: string[] } = { erros: [], avisos: [] };
  try {
    if (linha.relatorio) relatorio = JSON.parse(linha.relatorio);
  } catch {
    // Relatório ilegível não pode esconder a carga: o resto da linha vale.
  }
  return { ...linha, relatorio };
}
