/**
 * Importação da base FOC, em dois passos: analisar e, só depois, gravar.
 *
 * O primeiro passo não toca no banco — lê o arquivo, confere cada dimensão
 * contra o cadastro do cliente e devolve o que precisa de decisão. O segundo
 * recebe as decisões e grava tudo numa transação só. Nada entra pelo meio:
 * ou a carga inteira vale, ou nenhuma linha vale.
 *
 * A trava de "está tudo decidido?" é conferida AQUI, no servidor, e não na
 * tela. A tela pode ser contornada; quem responde pela base é este arquivo.
 */
import { db, emTransacao } from '../db/index.js';
import { chaveDedup, hashArquivo } from '../lib/hash.js';
import { erroValidacao } from '../lib/erros.js';
import { lerXlsx } from '../lib/planilha.js';
import { paraExibicao } from './competencia.js';
import { comEmpresaEmFoco } from './escopo.js';
import type { EscopoOperacao } from './escopo-operacao.js';
import { criarLancamento } from './financeiro.js';
import { criarFilial, resolverTipoDespesa } from './cadastros.js';
import { registrarImportacao, type ErroLinha, type ModoCarga } from './importacao.js';
import { apelidosDoCliente } from './mapeamentos.js';
import type { Contexto } from './contexto.js';
import {
  colunasFaltantesFoc,
  lerLinhasFoc,
  mapearColunasFoc,
  numerarOcorrencias,
  partesDaChave,
  type LinhaFoc,
  type ProblemaLinha,
} from './carga-foc.js';
import {
  conciliar,
  mapaDeDestino,
  pendencias,
  type BlocoConciliacao,
  type Decisao,
  type Dimensao,
} from './conciliacao.js';

export interface AnaliseFoc {
  arquivo: string | null;
  arquivo_hash: string;
  /** O mesmo arquivo já entrou antes? A carga segue permitida, só avisa. */
  arquivo_ja_importado: boolean;
  total_linhas: number;
  validas: number;
  invalidas: number;
  /** Quantas decisões ainda faltam para liberar a gravação. */
  pendentes: number;
  blocos: BlocoConciliacao[];
  erros: ProblemaLinha[];
  avisos: ProblemaLinha[];
}

export interface ResultadoFoc {
  importacao_id: number;
  total_linhas: number;
  importadas: number;
  atualizadas: number;
  duplicadas: number;
  rejeitadas: number;
  com_erro: number;
  cadastros_criados: { centros_custo: string[]; filiais: string[] };
  erros: ProblemaLinha[];
  avisos: ProblemaLinha[];
}

/** A natureza do lançamento a partir do "tipo" da base. */
const NATUREZAS: Record<string, 'fixa' | 'pontual_unica' | 'pontual_parcelada'> = {
  FIXO: 'fixa',
  FIXA: 'fixa',
  'PONTUAL UNICA': 'pontual_unica',
  'PONTUAL PARCELADA': 'pontual_parcelada',
};

function exigirCliente(ctx: Contexto): number {
  if (ctx.clienteId === null) throw erroValidacao('Esta empresa ainda não pertence a um cliente.');
  return ctx.clienteId;
}

/** Lê o arquivo e devolve as linhas, os problemas e o hash. */
async function lerArquivo(ctx: Contexto, buffer: Buffer) {
  // `preservarDatas`: a data de pagamento precisa do dia, e é ela que separa
  // duas despesas iguais dentro do mesmo mês.
  const abas = await lerXlsx(buffer, { preservarDatas: true });
  const aba = abas[0];
  if (!aba || aba.linhas.length === 0) {
    throw erroValidacao('A planilha não tem nenhuma aba com dados.');
  }
  // O adaptador de cabeçalhos do cliente vale aqui como vale no template: é o
  // mesmo contrato de "a planilha dele tem os nomes dele".
  const apelidos = ctx.clienteId ? apelidosDoCliente(ctx.clienteId, 'Financeiro') : {};
  const mapa = mapearColunasFoc(aba.colunas, apelidos);
  const faltando = colunasFaltantesFoc(mapa);
  if (faltando.length) {
    throw erroValidacao(
      `A planilha não tem a(s) coluna(s) obrigatória(s): ${faltando.join(', ')}. ` +
        'Confira se o arquivo é a base de despesas exportada do sistema do cliente.',
    );
  }
  return { aba, ...lerLinhasFoc(aba.linhas, mapa) };
}

/** Passo 1: analisa sem gravar nada. */
export async function analisarFoc(
  ctx: Contexto,
  buffer: Buffer,
  arquivoNome: string | null,
  escopo?: EscopoOperacao,
): Promise<AnaliseFoc> {
  exigirCliente(ctx);
  const hash = hashArquivo(buffer);
  const { aba, linhas, erros, avisos } = await lerArquivo(ctx, buffer);
  const blocos = conciliar(ctx, linhas, escopo?.empresas);

  const jaImportado =
    (
      db()
        .prepare(
          `SELECT COUNT(*) AS n FROM importacoes
            WHERE cliente_id = ? AND arquivo_hash = ? AND status = 'concluida'`,
        )
        .get(ctx.clienteId, hash) as { n: number }
    ).n > 0;

  return {
    arquivo: arquivoNome,
    arquivo_hash: hash,
    arquivo_ja_importado: jaImportado,
    total_linhas: aba.linhas.length,
    validas: linhas.length,
    invalidas: aba.linhas.length - linhas.length,
    pendentes: blocos.reduce((s, b) => s + b.pendentes, 0),
    blocos,
    erros,
    avisos,
  };
}

/** Resolve, criando quando autorizado, os cadastros que cada linha precisa. */
function prepararCadastros(
  ctx: Contexto,
  linhas: LinhaFoc[],
  destino: Map<string, string>,
  criados: { centros_custo: string[]; filiais: string[] },
) {
  const nomeFinal = (dim: Dimensao, valor: string) => destino.get(`${dim}\u0000${valor}`) ?? valor;

  const empresas = db()
    .prepare(`SELECT id, nome FROM empresas WHERE cliente_id = ?`)
    .all(ctx.clienteId) as Array<{ id: number; nome: string }>;
  const porEmpresa = new Map(empresas.map((e) => [e.nome, e.id]));

  const empresaDaLinha = new Map<number, number>();
  const filialDaLinha = new Map<number, number | null>();
  const tipoDaLinha = new Map<number, number>();

  for (const linha of linhas) {
    const nomeGrupo = nomeFinal('grupo', linha.grupo);
    const empresaId = porEmpresa.get(nomeGrupo);
    if (!empresaId) {
      throw erroValidacao(
        `A matriz "${nomeGrupo}" não existe na estrutura deste cliente. ` +
          'Cadastre-a em Clientes e unidades antes de importar.',
      );
    }
    empresaDaLinha.set(linha.linha, empresaId);

    const nomeFilial = nomeFinal('unidade', linha.unidade);
    const existente = db()
      .prepare('SELECT id FROM filiais WHERE empresa_id = ? AND nome = ? COLLATE NOCASE')
      .get(empresaId, nomeFilial) as { id: number } | undefined;
    if (existente) {
      filialDaLinha.set(linha.linha, existente.id);
    } else {
      const nova = criarFilial(comEmpresaEmFoco(ctx, empresaId), { nome: nomeFilial });
      criados.filiais.push(`${nomeGrupo} › ${nomeFilial}`);
      filialDaLinha.set(linha.linha, nova.id);
    }

    const nomeCentro = nomeFinal('centro_custo', linha.centroCusto);
    const tipo = resolverTipoDespesa(empresaId, nomeCentro, true)!;
    if (tipo.criado) criados.centros_custo.push(`${nomeGrupo} › ${nomeCentro}`);
    tipoDaLinha.set(linha.linha, tipo.id);
  }

  return { empresaDaLinha, filialDaLinha, tipoDaLinha, nomeFinal };
}

/**
 * Passo 2: grava. Tudo ou nada.
 *
 * O arquivo é lido de novo em vez de guardado entre os passos: assim não há
 * estado de meia-importação pendurado no servidor, e o hash confere que é o
 * mesmo arquivo que foi analisado.
 */
export async function importarFoc(
  ctx: Contexto,
  buffer: Buffer,
  opcoes: { decisoes: Decisao[]; arquivoNome?: string | null; modo?: ModoCarga; escopo?: EscopoOperacao },
): Promise<ResultadoFoc> {
  if (ctx.papel !== 'gestor') throw erroValidacao('Apenas gestores podem importar dados.');
  exigirCliente(ctx);

  const modo: ModoCarga = opcoes.modo === 'inicial' ? 'inicial' : 'incremental';
  const arquivoNome = opcoes.arquivoNome ?? null;
  const hash = hashArquivo(buffer);

  /** Toda tentativa deixa rastro, inclusive a recusada. */
  const registrar = (
    status: 'concluida' | 'recusada',
    mensagem: string | null,
    contagens: { total: number; importadas: number; atualizadas: number; duplicadas: number; rejeitadas: number; com_erro: number },
    relatorio: { erros: ProblemaLinha[]; avisos: ProblemaLinha[] },
  ) =>
    registrarImportacao(ctx, {
      modulo: 'financeiro',
      modo,
      versao: 'foc-1',
      arquivoNome,
      arquivoHash: hash,
      status,
      mensagem,
      contagens,
      relatorio: {
        erros: relatorio.erros.map(
          (e): ErroLinha => ({ aba: 'Base', linha: e.linha, mensagem: `${e.campo}: ${e.mensagem}` }),
        ),
        avisos: relatorio.avisos.map((a) => `Linha ${a.linha} — ${a.campo}: ${a.mensagem}`),
      },
      decisoes: opcoes.decisoes,
      escopo: opcoes.escopo,
    });

  let lido;
  try {
    lido = await lerArquivo(ctx, buffer);
  } catch (erro) {
    registrar('recusada', erro instanceof Error ? erro.message : String(erro), { total: 0, importadas: 0, atualizadas: 0, duplicadas: 0, rejeitadas: 0, com_erro: 0 }, { erros: [], avisos: [] });
    throw erro;
  }

  const { aba, linhas, erros, avisos } = lido;
  const blocos = conciliar(ctx, linhas, opcoes.escopo?.empresas);

  // A trava: nada é gravado enquanto houver divergência sem decisão.
  const faltando = pendencias(blocos, opcoes.decisoes);
  if (faltando.length) {
    const mensagem = `A importação não pode prosseguir: ${faltando.length} decisão(ões) pendente(s).`;
    registrar('recusada', mensagem, { total: aba.linhas.length, importadas: 0, atualizadas: 0, duplicadas: 0, rejeitadas: 0, com_erro: erros.length }, { erros, avisos });
    throw erroValidacao(`${mensagem} ${faltando.map((f) => f.mensagem).join(' ')}`);
  }

  const destino = mapaDeDestino(blocos, opcoes.decisoes);
  const criados = { centros_custo: [] as string[], filiais: [] as string[] };
  let importadas = 0;
  let atualizadas = 0;
  let duplicadas = 0;

  try {
    emTransacao(() => {
      const { empresaDaLinha, filialDaLinha, tipoDaLinha, nomeFinal } = prepararCadastros(ctx, linhas, destino, criados);

      for (const { linha, ocorrencia } of numerarOcorrencias(exigirCliente(ctx), linhas)) {
        const empresaId = empresaDaLinha.get(linha.linha)!;
        const natureza = NATUREZAS[linha.tipo.toUpperCase()] ?? 'fixa';
        const dedup = chaveDedup([...partesDaChave(exigirCliente(ctx), linha), ocorrencia]);

        const descricao = linha.motivo || null;
        const grupoGasto = nomeFinal('grupo_gasto', linha.grupoGasto) || null;
        const competencia = linha.competencia!;
        const plano = Object.keys(linha.planejamento).length ? JSON.stringify(linha.planejamento) : null;

        // A mesma linha já entrou numa carga anterior. A chave natural cobre
        // unidade, data, valor, origem, fornecedor e centro de custo — o que
        // sobra (motivo, competência, grupo de gasto, planejamento) PODE ter
        // sido corrigido na origem entre uma exportação e outra. Reimportar
        // então atualiza esses campos em vez de ignorar a linha, que é o que
        // faz a recarga valer a pena; se nada mudou, ela é só ignorada.
        const existente = db()
          .prepare(
            `SELECT id, competencia, descricao, grupo_gasto, planejamento
               FROM lancamentos WHERE dedup_hash = ?`,
          )
          .get(dedup) as
          | { id: number; competencia: string; descricao: string | null; grupo_gasto: string | null; planejamento: string | null }
          | undefined;

        if (existente) {
          const mudou =
            existente.competencia !== competencia ||
            existente.descricao !== descricao ||
            existente.grupo_gasto !== grupoGasto ||
            existente.planejamento !== plano;
          if (mudou) {
            db()
              .prepare(
                `UPDATE lancamentos
                    SET competencia = ?, descricao = ?, grupo_gasto = ?, planejamento = ?,
                        atualizado_em = datetime('now')
                  WHERE id = ?`,
              )
              .run(competencia, descricao, grupoGasto, plano, existente.id);
            atualizadas += 1;
          } else {
            duplicadas += 1;
          }
          continue;
        }

        criarLancamento(comEmpresaEmFoco(ctx, empresaId), {
          empresaId,
          filialId: filialDaLinha.get(linha.linha) ?? null,
          tipoDespesaId: tipoDaLinha.get(linha.linha)!,
          competencia: paraExibicao(competencia),
          valor: linha.valorCentavos / 100,
          natureza,
          classificacao: 'despesa',
          cenario: 'oficial',
          origem: 'planilha',
          descricao,
          // A procedência FOC fica escrita: é o que distingue, depois, uma
          // despesa realizada de um valor que ainda era só "a aprovar".
          observacoes:
            linha.origem === 'FOC_APROVACAO'
              ? 'Carga FOC_APROVACAO — valor a aprovar na data do pagamento.'
              : 'Carga FOC_DESPESAS — despesa realizada.',
          fornecedor: linha.fornecedor || null,
          grupoGasto,
          dataPagamento: linha.dataPagamento,
          planejamento: linha.planejamento,
          dedupHash: dedup,
        });
        importadas += 1;
      }
    });
  } catch (erro) {
    registrar('recusada', erro instanceof Error ? erro.message : String(erro), { total: aba.linhas.length, importadas: 0, atualizadas: 0, duplicadas: 0, rejeitadas: 0, com_erro: erros.length }, { erros, avisos });
    throw erro;
  }

  const contagens = {
    total: aba.linhas.length,
    importadas,
    atualizadas,
    duplicadas,
    rejeitadas: erros.length,
    com_erro: erros.length,
  };
  const id = registrar('concluida', null, contagens, { erros, avisos });

  return {
    importacao_id: id,
    total_linhas: contagens.total,
    importadas,
    atualizadas,
    duplicadas,
    rejeitadas: erros.length,
    com_erro: erros.length,
    cadastros_criados: criados,
    erros,
    avisos,
  };
}
