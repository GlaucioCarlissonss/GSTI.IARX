/**
 * Importação da carga de Contas a Pagar, em dois passos: analisar e gravar.
 *
 * Mesma forma de `importacao-foc.ts` — analisar não toca no banco, gravar é
 * tudo ou nada dentro de uma transação —, mas com duas diferenças que vêm do
 * arquivo em si:
 *
 * 1. **O arquivo não traz a matriz.** Tem uma coluna de unidade só
 *    (`GLBCOMPANYCOMMERCIALNAME`), com 18 valores que NÃO se deduzem do
 *    cadastro: "NATAL HOME" é a filial "HR RN", "HOSPITAL MILAGRES - JP" é
 *    "HM PB". Um humano decide isso uma vez, e o vínculo fica guardado por
 *    cliente (`vinculos_importacao`) — sem isso, a carga do mês seguinte
 *    pediria as mesmas 18 decisões de novo.
 *
 * 2. **A base do cliente já tem quase a mesma despesa.** 1.125 das 1.148
 *    linhas do arquivo real encontram par de competência e valor entre os
 *    1.898 lançamentos existentes. Por isso a análise não pergunta só "estes
 *    nomes existem?": ela também confronta LANÇAMENTO a lançamento
 *    (`conciliacao-lancamentos.ts`) e diz quanto entraria de novo. Gravar sem
 *    esse passo dobraria a base.
 *
 * A análise acontece em duas ondas, e é de propósito: as dimensões primeiro,
 * porque sem saber em que filial e em que centro de custo cada linha cai não
 * há como procurá-la na base. Enquanto houver decisão pendente, a conciliação
 * de lançamentos vem vazia — e a tela mostra por quê.
 */
import { db, emTransacao } from '../db/index.js';
import { chaveDedup, hashArquivo } from '../lib/hash.js';
import { erroConflito, erroValidacao } from '../lib/erros.js';
import { decodificarTexto, lerCsvBruto } from '../lib/planilha.js';
import { paraExibicao } from './competencia.js';
import { comEmpresaEmFoco } from './escopo.js';
import { empresaDoEscopo, escopoDoCliente, type EscopoOperacao } from './escopo-operacao.js';
import { criarLancamento } from './financeiro.js';
import { criarFilial, resolverTipoDespesa } from './cadastros.js';
import { competenciaEstaFechada } from './fechamento.js';
import { registrarImportacao, type ErroLinha, type ModoCarga } from './importacao.js';
import { reconhecePorOrigem } from './reconhecedores.js';
import type { Contexto } from './contexto.js';
import type { ProblemaLinha } from './carga-foc.js';
import {
  ehLayoutContasPagar,
  lerLinhasContasPagar,
  numerarOcorrenciasContasPagar,
  partesDaChaveContasPagar,
  type LinhaContasPagar,
} from './carga-contas-pagar.js';
import {
  candidatosDoCliente,
  classificar,
  mapaDeDestino,
  pendencias,
  type BlocoConciliacao,
  type Decisao,
  type Dimensao,
  type ItemConciliacao,
  type Situacao,
} from './conciliacao.js';
import {
  conciliarLancamentos,
  type AnaliseLancamentos,
  type LinhaResolvida,
} from './conciliacao-lancamentos.js';

/**
 * As dimensões que ESTE layout tem.
 *
 * Não são as seis de `DIMENSOES` (`conciliacao.ts`): o arquivo não traz grupo
 * (matriz), nem tipo, nem grupo de gasto. Conferir dimensão que o arquivo não
 * tem produziria um bloco inteiro de itens vazios pedindo decisão.
 */
const DIMENSOES_AP: Array<{ chave: Dimensao; rotulo: string; obrigatoria: boolean; permiteCriar: boolean }> = [
  { chave: 'unidade', rotulo: 'Unidade (filial)', obrigatoria: true, permiteCriar: true },
  { chave: 'centro_custo', rotulo: 'Centro de Custo', obrigatoria: true, permiteCriar: true },
  { chave: 'fornecedor', rotulo: 'Fornecedor', obrigatoria: false, permiteCriar: true },
];

/** Um vínculo guardado de carga anterior. */
export interface VinculoGuardado {
  dimensao: Dimensao;
  valor: string;
  alvo: string;
}

export interface AnaliseContasPagar {
  arquivo: string | null;
  arquivo_hash: string;
  arquivo_ja_importado: boolean;
  total_linhas: number;
  validas: number;
  invalidas: number;
  /** Linhas que chegaram com campo omitido e foram recolocadas na coluna certa. */
  realinhadas: number;
  pendentes: number;
  blocos: BlocoConciliacao[];
  /** O de-para que já estava guardado e foi aplicado sozinho. */
  vinculos_aplicados: VinculoGuardado[];
  /** Nulo enquanto houver decisão pendente — sem elas não há onde procurar. */
  lancamentos: AnaliseLancamentos | null;
  erros: ProblemaLinha[];
  avisos: ProblemaLinha[];
}

export interface ResultadoContasPagar {
  importacao_id: number;
  total_linhas: number;
  importadas: number;
  atualizadas: number;
  duplicadas: number;
  rejeitadas: number;
  com_erro: number;
  /** Lançamentos que nasceram já reconhecidos por causa do cadastro de origem. */
  reconhecidos: number;
  cadastros_criados: { centros_custo: string[]; filiais: string[] };
  vinculos_guardados: number;
  erros: ProblemaLinha[];
  avisos: ProblemaLinha[];
}

function exigirCliente(ctx: Contexto): number {
  if (ctx.clienteId === null) throw erroValidacao('Esta empresa ainda não pertence a um cliente.');
  return ctx.clienteId;
}

const chave = (dimensao: Dimensao, valor: string) => `${dimensao}\u0000${valor}`;

// ===========================================================================
// O de-para guardado
// ===========================================================================

export function vinculosDoCliente(clienteId: number): Map<string, string> {
  const linhas = db()
    .prepare('SELECT dimensao, valor, alvo FROM vinculos_importacao WHERE cliente_id = ?')
    .all(clienteId) as Array<{ dimensao: Dimensao; valor: string; alvo: string }>;
  return new Map(linhas.map((l) => [chave(l.dimensao, l.valor), l.alvo]));
}

/**
 * Guarda os vínculos que a pessoa acabou de decidir.
 *
 * Só `vincular` vira registro: "criar" não é um de-para, é um cadastro novo, e
 * na carga seguinte o valor já existirá por si.
 */
export function guardarVinculos(clienteId: number, decisoes: Decisao[]): number {
  const gravar = db().prepare(
    `INSERT INTO vinculos_importacao (cliente_id, dimensao, valor, alvo) VALUES (?, ?, ?, ?)
     ON CONFLICT (cliente_id, dimensao, valor) DO UPDATE SET alvo = excluded.alvo`,
  );
  let n = 0;
  for (const d of decisoes) {
    if (d.acao !== 'vincular' || !d.alvo) continue;
    gravar.run(clienteId, d.dimensao, d.valor, d.alvo);
    n += 1;
  }
  return n;
}

/** O valor da dimensão numa linha deste layout. */
function valorDaLinha(linha: LinhaContasPagar, dimensao: Dimensao): string {
  switch (dimensao) {
    case 'unidade':
      return linha.unidade;
    case 'centro_custo':
      return linha.centroCusto;
    default:
      return linha.fornecedor;
  }
}

/**
 * Monta os blocos de conciliação de dimensão, já com o de-para aplicado.
 *
 * O vínculo guardado entra ANTES da classificação: o item aparece como IGUAL
 * porque, para efeito de carga, ele já é o nome do cadastro. O que a tela
 * mostra à parte é a lista de vínculos aplicados — o gestor precisa poder ver
 * que "NATAL HOME" virou "HR RN" sem ele ter clicado em nada.
 */
function conciliarDimensoes(
  ctx: Contexto,
  linhas: LinhaContasPagar[],
  vinculos: Map<string, string>,
  escopo?: number[],
): { blocos: BlocoConciliacao[]; aplicados: VinculoGuardado[] } {
  const aplicados: VinculoGuardado[] = [];
  const vistos = new Set<string>();

  const blocos = DIMENSOES_AP.map(({ chave: dim, rotulo, obrigatoria, permiteCriar }) => {
    const candidatos = candidatosDoCliente(ctx, dim, escopo);
    const porValor = new Map<string, ItemConciliacao>();

    for (const linha of linhas) {
      const original = valorDaLinha(linha, dim);
      const alvo = vinculos.get(chave(dim, original));
      if (alvo && !vistos.has(chave(dim, original))) {
        vistos.add(chave(dim, original));
        aplicados.push({ dimensao: dim, valor: original, alvo });
      }
      const valor = alvo ?? original;
      let item = porValor.get(valor);
      if (!item) {
        item = classificar(valor, candidatos);
        porValor.set(valor, item);
      }
      item.ocorrencias += 1;
      if (item.linhas.length < 20) item.linhas.push(linha.linha);
    }

    const ordem: Record<Situacao, number> = { INVALIDO: 0, NOVO: 1, DIVERGENTE: 2, IGUAL: 3 };
    const itens = [...porValor.values()].sort(
      (a, b) => ordem[a.situacao] - ordem[b.situacao] || b.ocorrencias - a.ocorrencias,
    );
    return {
      dimensao: dim,
      rotulo,
      obrigatoria,
      permiteCriar,
      itens,
      pendentes: itens.filter((i) => i.situacao === 'DIVERGENTE' || i.situacao === 'NOVO').length,
      candidatos,
    };
  });

  return { blocos, aplicados };
}

// ===========================================================================
// Da linha do arquivo para a linha do banco
// ===========================================================================

interface Resolucao {
  /** Por número de linha do arquivo. Ausente = a linha não pôde ser resolvida. */
  porLinha: Map<number, LinhaResolvida>;
  criados: { centros_custo: string[]; filiais: string[] };
  /** O nome final de cada valor, depois de vínculo e decisão. */
  nomeFinal: (dimensao: Dimensao, valor: string) => string;
}

/**
 * Resolve unidade e centro de custo em ids.
 *
 * `criar` separa os dois usos: a análise resolve SEM criar nada (a linha cujo
 * cadastro ainda não existe fica de fora e conta como nova, que é a verdade);
 * a gravação resolve criando o que a decisão autorizou.
 *
 * A filial que nasce aqui entra na matriz do escopo da carga
 * (`empresaDoEscopo`). É a única resposta possível: o arquivo não diz a que
 * matriz a unidade pertence, e adivinhar pelo nome é o erro que a conciliação
 * existe para evitar. Quando o cliente tem mais de uma matriz, o caminho certo
 * é VINCULAR a unidade a uma filial existente — e é por isso que o vínculo
 * fica guardado.
 */
function resolverLinhas(
  ctx: Contexto,
  linhas: LinhaContasPagar[],
  vinculos: Map<string, string>,
  decisoes: Decisao[],
  blocos: BlocoConciliacao[],
  escopo: EscopoOperacao,
  criar: boolean,
): Resolucao {
  const clienteId = exigirCliente(ctx);
  const destino = mapaDeDestino(blocos, decisoes);
  const nomeFinal = (dimensao: Dimensao, valor: string) => {
    const comVinculo = vinculos.get(chave(dimensao, valor)) ?? valor;
    return destino.get(chave(dimensao, comVinculo)) ?? comVinculo;
  };

  const criados = { centros_custo: [] as string[], filiais: [] as string[] };
  const porLinha = new Map<number, LinhaResolvida>();
  const empresaPadrao = empresaDoEscopo(ctx, escopo);
  const vagas = escopo.empresas.map(() => '?').join(',');
  const buscarFilial = db().prepare(
    `SELECT id, empresa_id FROM filiais WHERE empresa_id IN (${vagas}) AND nome = ? COLLATE NOCASE ORDER BY id`,
  );
  const cacheFilial = new Map<string, { id: number; empresa_id: number } | null>();
  const cacheTipo = new Map<string, number | null>();

  for (const linha of linhas) {
    const nomeFilial = nomeFinal('unidade', linha.unidade);
    let filial = cacheFilial.get(nomeFilial);
    if (filial === undefined) {
      filial = (buscarFilial.get(...escopo.empresas, nomeFilial) as { id: number; empresa_id: number } | undefined) ?? null;
      if (!filial && criar) {
        const nova = criarFilial(comEmpresaEmFoco(ctx, empresaPadrao), { nome: nomeFilial });
        criados.filiais.push(nomeFilial);
        filial = { id: nova.id, empresa_id: empresaPadrao };
      }
      cacheFilial.set(nomeFilial, filial);
    }
    if (!filial) continue;

    const nomeCentro = nomeFinal('centro_custo', linha.centroCusto);
    const chaveTipo = `${filial.empresa_id}\u0000${nomeCentro}`;
    let tipoId = cacheTipo.get(chaveTipo);
    if (tipoId === undefined) {
      const tipo = resolverTipoDespesa(filial.empresa_id, nomeCentro, criar);
      if (tipo?.criado) criados.centros_custo.push(nomeCentro);
      tipoId = tipo?.id ?? null;
      cacheTipo.set(chaveTipo, tipoId);
    }
    if (!tipoId) continue;

    porLinha.set(linha.linha, {
      linha: linha.linha,
      empresaId: filial.empresa_id,
      filialId: filial.id,
      tipoDespesaId: tipoId,
      competencia: linha.competencia,
      valorCentavos: linha.valorCentavos,
      descricao: linha.descricao,
      documento: linha.documento,
      fornecedor: nomeFinal('fornecedor', linha.fornecedor),
      dataPagamento: linha.dataPagamento,
      usuarioOrigem: linha.usuarioOrigem,
      reconhecido: reconhecePorOrigem(clienteId, linha.usuarioOrigem),
    });
  }

  return { porLinha, criados, nomeFinal };
}

// ===========================================================================
// Leitura
// ===========================================================================

function lerArquivo(buffer: Buffer) {
  const brutas = lerCsvBruto(decodificarTexto(buffer));
  if (brutas.length < 2) {
    throw erroValidacao('O arquivo não tem nenhuma linha de dados abaixo do cabeçalho.');
  }
  const cabecalho = (brutas[0] ?? []).map((c) => c.replace(/^"|"$/g, '').trim());
  if (!ehLayoutContasPagar(cabecalho)) {
    throw erroValidacao(
      'Este arquivo não é a exportação de Contas a Pagar: faltam as colunas IDPAYDOCBILL, ' +
        'CREATIONUSER e GLBCOMPANYCOMMERCIALNAME. Confira se não é a base FOC, que entra pela outra opção.',
    );
  }
  return { totalLinhas: brutas.length - 1, ...lerLinhasContasPagar(brutas) };
}

/** Passo 1: analisa sem gravar nada. */
export function analisarContasPagar(
  ctx: Contexto,
  buffer: Buffer,
  opcoes: { arquivoNome?: string | null; decisoes?: Decisao[]; escopo?: EscopoOperacao } = {},
): AnaliseContasPagar {
  const clienteId = exigirCliente(ctx);
  const escopo = opcoes.escopo ?? escopoDoCliente(ctx);
  const decisoes = opcoes.decisoes ?? [];
  const hash = hashArquivo(buffer);
  const { totalLinhas, linhas, erros, avisos, realinhadas } = lerArquivo(buffer);

  const vinculos = vinculosDoCliente(clienteId);
  const { blocos, aplicados } = conciliarDimensoes(ctx, linhas, vinculos, escopo.empresas);
  const faltando = pendencias(blocos, decisoes);

  // A conciliação de lançamentos só faz sentido depois que cada linha sabe em
  // que filial e centro de custo cai: é por eles que se procura o par na base.
  let lancamentos: AnaliseLancamentos | null = null;
  if (faltando.length === 0) {
    const { porLinha } = resolverLinhas(ctx, linhas, vinculos, decisoes, blocos, escopo, false);
    const resolvidas = linhas.map((l) => porLinha.get(l.linha)).filter((l): l is LinhaResolvida => Boolean(l));
    const parcial = conciliarLancamentos(clienteId, resolvidas);
    // A linha cujo cadastro ainda não existe não foi procurada — e não existe
    // mesmo na base, porque o tipo de despesa dela ainda vai nascer.
    const semCadastro = linhas.length - resolvidas.length;
    lancamentos = { ...parcial, total: linhas.length, novo: parcial.novo + semCadastro };
  }

  const jaImportado =
    (
      db()
        .prepare(
          `SELECT COUNT(*) AS n FROM importacoes
            WHERE cliente_id = ? AND arquivo_hash = ? AND status = 'concluida'`,
        )
        .get(clienteId, hash) as { n: number }
    ).n > 0;

  return {
    arquivo: opcoes.arquivoNome ?? null,
    arquivo_hash: hash,
    arquivo_ja_importado: jaImportado,
    total_linhas: totalLinhas,
    validas: linhas.length,
    invalidas: totalLinhas - linhas.length,
    realinhadas,
    pendentes: faltando.length,
    blocos,
    vinculos_aplicados: aplicados,
    lancamentos,
    erros,
    avisos,
  };
}

/**
 * Passo 2: grava. Tudo ou nada.
 *
 * O arquivo é lido de novo, como no FOC, para não haver estado de
 * meia-importação pendurado no servidor entre um passo e outro.
 */
export function importarContasPagar(
  ctx: Contexto,
  buffer: Buffer,
  opcoes: { decisoes?: Decisao[]; arquivoNome?: string | null; modo?: ModoCarga; escopo?: EscopoOperacao } = {},
): ResultadoContasPagar {
  if (ctx.papel !== 'gestor') throw erroValidacao('Apenas gestores podem importar dados.');
  const clienteId = exigirCliente(ctx);

  const escopo = opcoes.escopo ?? escopoDoCliente(ctx);
  const decisoes = opcoes.decisoes ?? [];
  const modo: ModoCarga = opcoes.modo === 'inicial' ? 'inicial' : 'incremental';
  const arquivoNome = opcoes.arquivoNome ?? null;
  const hash = hashArquivo(buffer);

  const registrar = (
    status: 'concluida' | 'recusada',
    mensagem: string | null,
    contagens: { total: number; importadas: number; atualizadas: number; duplicadas: number; rejeitadas: number; com_erro: number },
    relatorio: { erros: ProblemaLinha[]; avisos: ProblemaLinha[] },
  ) =>
    registrarImportacao(ctx, {
      modulo: 'financeiro',
      modo,
      versao: 'contas-pagar-1',
      arquivoNome,
      arquivoHash: hash,
      status,
      mensagem,
      contagens,
      relatorio: {
        erros: relatorio.erros.map(
          (e): ErroLinha => ({ aba: 'Contas a Pagar', linha: e.linha, mensagem: `${e.campo}: ${e.mensagem}` }),
        ),
        avisos: relatorio.avisos.map((a) => `Linha ${a.linha} — ${a.campo}: ${a.mensagem}`),
      },
      decisoes,
      escopo,
    });

  let lido;
  try {
    lido = lerArquivo(buffer);
  } catch (erro) {
    registrar(
      'recusada',
      erro instanceof Error ? erro.message : String(erro),
      { total: 0, importadas: 0, atualizadas: 0, duplicadas: 0, rejeitadas: 0, com_erro: 0 },
      { erros: [], avisos: [] },
    );
    throw erro;
  }

  const { totalLinhas, linhas, erros, avisos } = lido;
  const vinculos = vinculosDoCliente(clienteId);
  const { blocos } = conciliarDimensoes(ctx, linhas, vinculos, escopo.empresas);

  // A trava: nada é gravado enquanto houver divergência sem decisão.
  const faltando = pendencias(blocos, decisoes);
  if (faltando.length) {
    const mensagem = `A importação não pode prosseguir: ${faltando.length} decisão(ões) pendente(s).`;
    registrar(
      'recusada',
      mensagem,
      { total: totalLinhas, importadas: 0, atualizadas: 0, duplicadas: 0, rejeitadas: 0, com_erro: erros.length },
      { erros, avisos },
    );
    throw erroValidacao(`${mensagem} ${faltando.map((f) => f.mensagem).join(' ')}`);
  }

  let importadas = 0;
  let atualizadas = 0;
  let duplicadas = 0;
  let reconhecidos = 0;
  let vinculosGuardados = 0;
  let criados = { centros_custo: [] as string[], filiais: [] as string[] };
  const justificativaDaCarga = `Carga de Contas a Pagar — ${arquivoNome ?? 'arquivo sem nome'}.`;

  try {
    emTransacao(() => {
      vinculosGuardados = guardarVinculos(clienteId, decisoes);
      const resolucao = resolverLinhas(ctx, linhas, vinculos, decisoes, blocos, escopo, true);
      criados = resolucao.criados;

      const resolvidas = linhas
        .map((l) => resolucao.porLinha.get(l.linha))
        .filter((l): l is LinhaResolvida => Boolean(l));
      recusarCompetenciaFechada(resolvidas);
      const analise = conciliarLancamentos(clienteId, resolvidas);
      const porLinha = new Map(analise.itens.map((i) => [i.linha, i]));

      // Campos que a carga preenche depois da criação: `criarLancamento` não os
      // recebe, e mandá-los por `reconhecerLancamentos` geraria uma linha de
      // auditoria por lançamento — mil linhas para um ato só. Quem responde por
      // esta carga é o registro de importação.
      const carimbar = db().prepare(
        `UPDATE lancamentos
            SET usuario_origem = ?, reconhecido = ?, reconhecido_em = ?, reconhecido_por = ?
          WHERE id = ?`,
      );
      const agora = new Date().toISOString();

      for (const { linha, ocorrencia } of numerarOcorrenciasContasPagar(clienteId, linhas)) {
        const resolvida = resolucao.porLinha.get(linha.linha);
        if (!resolvida) continue;
        const item = porLinha.get(linha.linha);

        if (item && item.lancamentoId) {
          if (item.diferencas.length) {
            atualizarPareado(item.lancamentoId, item.diferencas, resolvida, agora, ctx.usuarioId);
            atualizadas += 1;
            if (item.diferencas.includes('reconhecido')) reconhecidos += 1;
          } else {
            duplicadas += 1;
          }
          continue;
        }

        const dedup = chaveDedup([...partesDaChaveContasPagar(clienteId, linha), ocorrencia]);
        const criado = criarLancamento(comEmpresaEmFoco(ctx, resolvida.empresaId), {
          empresaId: resolvida.empresaId,
          filialId: resolvida.filialId,
          tipoDespesaId: resolvida.tipoDespesaId,
          competencia: paraExibicao(resolvida.competencia),
          valor: resolvida.valorCentavos / 100,
          // Sempre única: no contas a pagar, CADA PARCELA já é uma linha do
          // arquivo. Ver o cabeçalho de `carga-contas-pagar.ts`.
          natureza: 'pontual_unica',
          classificacao: 'despesa',
          cenario: 'oficial',
          origem: 'planilha',
          descricao: resolvida.descricao || null,
          observacoes: observacaoDaLinha(linha),
          documento: resolvida.documento || null,
          fornecedor: resolvida.fornecedor || null,
          dataPagamento: resolvida.dataPagamento,
          dedupHash: dedup,
          // A carga É a justificativa da escrita em mês passado: o arquivo do
          // ERP cobre meses já encerrados por definição, e sem isto o porteiro
          // de competência (`garantirCompetenciaEditavel`) recusaria a carga
          // inteira. Mês FECHADO continua recusando — ver `recusarCompetenciaFechada`.
          justificativa: justificativaDaCarga,
        });
        carimbar.run(
          resolvida.usuarioOrigem || null,
          resolvida.reconhecido ? 1 : 0,
          resolvida.reconhecido ? agora : null,
          resolvida.reconhecido ? ctx.usuarioId : null,
          criado.id,
        );
        if (resolvida.reconhecido) reconhecidos += 1;
        importadas += 1;
      }
    });
  } catch (erro) {
    registrar(
      'recusada',
      erro instanceof Error ? erro.message : String(erro),
      { total: totalLinhas, importadas: 0, atualizadas: 0, duplicadas: 0, rejeitadas: 0, com_erro: erros.length },
      { erros, avisos },
    );
    throw erro;
  }

  const contagens = {
    total: totalLinhas,
    importadas,
    atualizadas,
    duplicadas,
    rejeitadas: erros.length,
    com_erro: erros.length,
  };
  const id = registrar('concluida', null, contagens, { erros, avisos });

  return {
    importacao_id: id,
    total_linhas: totalLinhas,
    importadas,
    atualizadas,
    duplicadas,
    rejeitadas: erros.length,
    com_erro: erros.length,
    reconhecidos,
    cadastros_criados: criados,
    vinculos_guardados: vinculosGuardados,
    erros,
    avisos,
  };
}

/**
 * Completa o lançamento que a base já tinha, sem tocar no que não mudou.
 *
 * Só os campos que a conciliação apontou como diferentes entram no UPDATE —
 * e cada um deles é sempre um campo que estava VAZIO na base ou que o arquivo
 * traz e ela não tem. Valor, competência e centro de custo não aparecem aqui
 * de propósito: eles formam a chave do pareamento, então divergir neles
 * significaria que não é o mesmo lançamento.
 *
 * O ganho que fica: preencher `documento` faz a próxima carga casar por número
 * de documento, sem heurística de ordem nenhuma.
 */
function atualizarPareado(
  id: number,
  diferencas: string[],
  l: LinhaResolvida,
  agora: string,
  usuarioId: number,
): void {
  const partes: string[] = [];
  const params: unknown[] = [];
  const por = (campo: string, valor: unknown) => {
    partes.push(`${campo} = ?`);
    params.push(valor);
  };
  if (diferencas.includes('documento')) por('documento', l.documento);
  if (diferencas.includes('descricao')) por('descricao', l.descricao);
  if (diferencas.includes('fornecedor')) por('fornecedor', l.fornecedor);
  if (diferencas.includes('data_pagamento')) por('data_pagamento', l.dataPagamento);
  if (diferencas.includes('usuario_origem')) por('usuario_origem', l.usuarioOrigem);
  if (diferencas.includes('reconhecido')) {
    por('reconhecido', 1);
    por('reconhecido_em', agora);
    por('reconhecido_por', usuarioId);
  }
  if (!partes.length) return;
  db()
    .prepare(`UPDATE lancamentos SET ${partes.join(', ')}, atualizado_em = datetime('now') WHERE id = ?`)
    .run(...params, id);
}

/**
 * Recusa a carga inteira quando alguma linha cai em competência FECHADA.
 *
 * Fechar um mês é dizer "os números deste mês estão conferidos"; deixar uma
 * carga escrever ali por cima esvaziaria o fechamento. A recusa é do lote, e
 * não da linha, porque este importador é tudo-ou-nada: gravar sete meses e
 * calar sobre o oitavo faria o total do arquivo não bater com o do sistema.
 */
function recusarCompetenciaFechada(linhas: LinhaResolvida[]): void {
  const fechadas = new Set<string>();
  const vistos = new Set<string>();
  for (const l of linhas) {
    const par = `${l.empresaId}\u0000${l.competencia}`;
    if (vistos.has(par)) continue;
    vistos.add(par);
    if (competenciaEstaFechada(l.empresaId, l.competencia)) fechadas.add(l.competencia);
  }
  if (!fechadas.size) return;
  const lista = [...fechadas].sort().map(paraExibicao).join(', ');
  throw erroConflito(
    `A carga toca competências fechadas (${lista}). Reabra-as antes de importar, ou recorte o arquivo.`,
  );
}

/** A procedência da linha, escrita onde quem abrir o lançamento vai ler. */
function observacaoDaLinha(l: LinhaContasPagar): string {
  const partes = [`Carga Contas a Pagar — documento ${l.idOrigem || 's/ id'} no ERP`];
  partes.push(`vencimento ${l.dataVencimento}`);
  const total = Number(l.qtdParcelas);
  if (Number.isFinite(total) && total > 1) partes.push(`parcela ${l.parcela || '?'} de ${l.qtdParcelas}`);
  return `${partes.join(', ')}.`;
}
