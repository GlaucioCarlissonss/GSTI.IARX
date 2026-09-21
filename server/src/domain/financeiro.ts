import { db, emTransacao } from '../db/index.js';
import { chaveDedup } from '../lib/hash.js';
import { erroConflito, erroNaoEncontrado, erroValidacao } from '../lib/erros.js';
import { auditar } from './auditoria.js';
import {
  competenciaAtual,
  paraExibicao,
  paraInterno,
  posicaoTemporal,
  somarMeses,
} from './competencia.js';
import type { Contexto } from './contexto.js';
import { filiaisDoCliente, validarFilial, validarFiliaisDoCliente } from './cadastros.js';
import { garantirCompetenciaEditavel } from './fechamento.js';
import { paraCentavos, paraReais, ratear } from './dinheiro.js';
import { clausulaEm, clausulaEmComNulo } from '../lib/consulta.js';
import { empresaDeEscrita, escopoDeLeitura, escopoSql } from './escopo.js';

export type Natureza = 'fixa' | 'pontual_unica' | 'pontual_parcelada';
export type Classificacao = 'despesa' | 'investimento';

/**
 * Procedência do lançamento. O total do sistema não é o total das planilhas
 * enviadas — há folha de TI rateada e projeção somadas por cima —, e é esta
 * coluna que permite decompor a diferença em vez de discutir o número final.
 */
export type Origem = 'planilha' | 'folha_ti' | 'projecao_spincare' | 'manual';

export const ROTULO_ORIGEM: Record<Origem, string> = {
  planilha: 'Planilhas do cliente',
  folha_ti: 'Folha de TI (rateio)',
  projecao_spincare: 'Projeção SpinCare',
  manual: 'Lançado no sistema',
};

/** Aceita a chave interna ou o rótulo exibido; devolve null se não reconhecer. */
export function interpretarOrigem(texto: string | null | undefined): Origem | null {
  const bruto = String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
  if (!bruto) return null;
  for (const chave of Object.keys(ROTULO_ORIGEM) as Origem[]) {
    if (bruto === chave) return chave;
    const rotulo = ROTULO_ORIGEM[chave]
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    if (bruto === rotulo) return chave;
  }
  return null;
}

/**
 * Quem CONSOME o que esta filial PAGA.
 *
 * O lançamento sempre soube quem pagou; nunca soube quem usou. Uma matriz que
 * centraliza licenças para seis filiais aparecia como a unidade cara, e as
 * filiais que consomem, como baratas — o número certo contando a história
 * errada. `compartilhado` é o que desfaz isso.
 */
export type TipoConsumo = 'integral' | 'compartilhado';

export const ROTULO_CONSUMO: Record<TipoConsumo, string> = {
  integral: '100% da filial',
  compartilhado: 'Paga pela filial, beneficia outras',
};

/** Aceita a chave interna, o rótulo exibido ou a grafia da planilha. */
export function interpretarTipoConsumo(texto: string | null | undefined): TipoConsumo | null {
  const bruto = String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (!bruto) return null;
  if (bruto === 'integral' || /100\s*%|somente|so\s+a\s+filial|exclusiv/.test(bruto)) return 'integral';
  if (bruto === 'compartilhado' || /beneficia|comparilh|compartilh|rate|central/.test(bruto)) return 'compartilhado';
  return null;
}

/**
 * A coluna "Reconhecido" da planilha: `true`, `false` ou `null` para "não disse".
 *
 * A distinção entre `false` e `null` é o ponto todo. "Não" escrito de propósito
 * é uma afirmação; célula vazia é ausência de afirmação, e tratá-las igual
 * faria reimportar um arquivo antigo desfazer a conferência de quem trabalhou.
 */
export function interpretarReconhecido(texto: string | null | undefined): boolean | null {
  const bruto = String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  if (!bruto) return null;
  if (bruto === 'sim' || bruto === 's' || bruto === '1' || bruto === 'true' || bruto === 'x') return true;
  if (bruto === 'nao' || bruto === 'n' || bruto === '0' || bruto === 'false') return false;
  return null;
}

/** Uma filial que consome o que outra pagou. A matriz vem junto: nomes repetem entre matrizes. */
export interface FilialBeneficiada {
  id: number;
  nome: string;
  empresa_nome: string;
}

/**
 * As beneficiadas de vários lançamentos numa consulta só.
 *
 * A lista tem 200 linhas por página; perguntar as beneficiadas de cada uma
 * separadamente seriam 200 consultas para responder uma pergunta.
 */
export function beneficiadasPorLancamento(ids: number[]): Map<number, FilialBeneficiada[]> {
  const mapa = new Map<number, FilialBeneficiada[]>();
  if (!ids.length) return mapa;
  const marcas = ids.map(() => '?').join(', ');
  const linhas = db()
    .prepare(
      `SELECT b.lancamento_id, f.id, f.nome, e.nome AS empresa_nome
         FROM lancamento_beneficiadas b
         JOIN filiais f ON f.id = b.filial_id
         JOIN empresas e ON e.id = f.empresa_id
        WHERE b.lancamento_id IN (${marcas})
        ORDER BY e.nome, f.nome`,
    )
    .all(...ids) as Array<{ lancamento_id: number; id: number; nome: string; empresa_nome: string }>;
  for (const l of linhas) {
    const lista = mapa.get(l.lancamento_id) ?? [];
    lista.push({ id: l.id, nome: l.nome, empresa_nome: l.empresa_nome });
    mapa.set(l.lancamento_id, lista);
  }
  return mapa;
}

/**
 * A lista definitiva de beneficiadas — já conferida e já congelada.
 *
 * "Todas as filiais do grupo" é resolvido AQUI, na gravação, e não na leitura:
 * uma filial cadastrada em março não pode passar a se beneficiar de um
 * lançamento de janeiro, senão o mês fechado muda de número sozinho.
 *
 * A filial pagadora sai da lista: ela não "se beneficia de outra", ela é a
 * outra. Deixá-la dentro faria o indicador de consumo cruzado contá-la como
 * destino do próprio dinheiro.
 */
export function resolverBeneficiadas(
  ctx: Contexto,
  tipoConsumo: TipoConsumo,
  beneficiadas: number[] | 'todas' | null | undefined,
  filialPagadora: number | null,
): number[] {
  if (tipoConsumo === 'integral') return [];
  const ids =
    beneficiadas === 'todas' ? filiaisDoCliente(ctx) : validarFiliaisDoCliente(ctx, beneficiadas ?? []);
  const semPagadora = ids.filter((id) => id !== filialPagadora);
  if (!semPagadora.length) {
    throw erroValidacao(
      'Um lançamento que beneficia outras filiais precisa de ao menos uma filial beneficiada além da que paga.',
    );
  }
  return semPagadora;
}

export function gravarBeneficiadas(lancamentoIds: number[], filiais: number[]): void {
  const apagar = db().prepare('DELETE FROM lancamento_beneficiadas WHERE lancamento_id = ?');
  const inserir = db().prepare(
    'INSERT OR IGNORE INTO lancamento_beneficiadas (lancamento_id, filial_id) VALUES (?, ?)',
  );
  for (const id of lancamentoIds) {
    apagar.run(id);
    for (const filial of filiais) inserir.run(id, filial);
  }
}

export interface EntradaLancamento {
  /**
   * Matriz em que o lançamento nasce. Escolhida no próprio formulário — o
   * registro não depende mais de um filtro no topo da tela. Ausente: a matriz
   * em foco.
   */
  empresaId?: number | null;
  filialId?: number | null;
  tipoDespesaId: number;
  competencia: string;              // "MM/AAAA"
  valor: number | string;           // reais
  natureza: Natureza;
  classificacao: Classificacao;
  qtdParcelas?: number | null;
  /** Para natureza parcelada: o valor informado é o total do contrato ou o de cada parcela. */
  valorRefereSe?: 'total' | 'parcela';
  /** Para natureza fixa: replica o lançamento mensalmente até esta competência (inclusive). */
  repetirAte?: string | null;       // "MM/AAAA"
  descricao?: string | null;
  observacoes?: string | null;
  /** Cenário de projeção. 'oficial' é o padrão e alimenta os dashboards. */
  cenario?: string | null;
  justificativa?: string | null;
  dedupHash?: string | null;
  /** Procedência do dado; ver docs/regras-de-negocio.md. Padrão: 'manual'. */
  origem?: Origem | null;
  /**
   * De onde o custo veio: fornecedor, setor, centro de custo. Não confundir
   * com `origem`, que é a procedência do DADO — de onde o registro entrou no
   * sistema, não de onde o dinheiro saiu.
   */
  origemCusto?: string | null;
  /** Para onde o pagamento foi: conta, beneficiário. */
  destinoPagamento?: string | null;
  /** Documento vinculado: nota, contrato, ordem de compra. */
  documento?: string | null;
  /** A quem se pagou, separado de `origemCusto` para poder ser conciliado. */
  fornecedor?: string | null;
  /** Grupo de gasto como a base do cliente o nomeia. */
  grupoGasto?: string | null;
  /** Data em que o pagamento saiu (`AAAA-MM-DD`); não é a competência. */
  dataPagamento?: string | null;
  /** Meta e projeções da carga: controle, nunca valor. Gravado como JSON. */
  planejamento?: Record<string, number> | null;
  /** Quem consome o que esta filial paga. Padrão: `integral`. */
  tipoConsumo?: TipoConsumo | null;
  /**
   * As filiais que consomem, quando o consumo é compartilhado.
   *
   * `'todas'` é a intenção "todas as filiais do grupo do cliente", expandida
   * na gravação para a lista que existe naquele momento.
   */
  beneficiadas?: number[] | 'todas' | null;
}

interface LinhaLancamento extends Record<string, unknown> {
  id: number;
  empresa_id: number;
  filial_id: number | null;
  tipo_despesa_id: number;
  competencia: string;
  valor_centavos: number;
  natureza: Natureza;
  classificacao: Classificacao;
  qtd_parcelas: number | null;
  parcela_numero: number | null;
  lancamento_origem_id: number | null;
  descricao: string | null;
  observacoes: string | null;
  cenario: string;
  origem: Origem;
  reconhecido: number;
  reconhecido_em: string | null;
  excluido_em: string | null;
}

/** Limite de segurança para geração automática de séries (parcelas/recorrência). */
const MAX_OCORRENCIAS = 240;

function apresentar(linha: LinhaLancamento & Record<string, unknown>, beneficiadas: FilialBeneficiada[] = []) {
  const tipoConsumo = ((linha.tipo_consumo as TipoConsumo) ?? 'integral') as TipoConsumo;
  return {
    id: linha.id,
    // A matriz vem junto: a lista mostra o cliente inteiro, e sem a unidade na
    // linha não dá para saber de qual delas é o número.
    empresa_id: linha.empresa_id,
    empresa_nome: (linha.empresa_nome as string | null) ?? null,
    filial_id: linha.filial_id,
    filial_nome: (linha.filial_nome as string | null) ?? null,
    tipo_despesa_id: linha.tipo_despesa_id,
    tipo_despesa: (linha.tipo_despesa as string | null) ?? null,
    competencia: paraExibicao(linha.competencia),
    valor: paraReais(linha.valor_centavos),
    valor_centavos: linha.valor_centavos,
    natureza: linha.natureza,
    classificacao: linha.classificacao,
    qtd_parcelas: linha.qtd_parcelas,
    parcela_numero: linha.parcela_numero,
    lancamento_origem_id: linha.lancamento_origem_id,
    grupo_id: linha.lancamento_origem_id ?? linha.id,
    descricao: linha.descricao,
    observacoes: linha.observacoes,
    cenario: linha.cenario,
    origem: linha.origem,
    origem_rotulo: ROTULO_ORIGEM[linha.origem] ?? linha.origem,
    origem_custo: (linha.origem_custo as string | null) ?? null,
    destino_pagamento: (linha.destino_pagamento as string | null) ?? null,
    documento: (linha.documento as string | null) ?? null,
    tipo_consumo: tipoConsumo,
    tipo_consumo_rotulo: ROTULO_CONSUMO[tipoConsumo] ?? tipoConsumo,
    // A intenção original, para a tela dizer "Todas as filiais do grupo" em vez
    // de listar catorze nomes. Quem responde de quem é o consumo é a lista.
    beneficia_todas: Number(linha.beneficia_todas ?? 0) === 1,
    filiais_beneficiadas: beneficiadas,
    // Quem criou o documento no sistema de ORIGEM (`CREATIONUSER` da carga de
    // Contas a Pagar). Vai para a tela porque é a resposta a "por que este
    // lançamento já está reconhecido?" — sem ele, o reconhecimento automático
    // é um carimbo sem procedência.
    usuario_origem: (linha.usuario_origem as string | null) ?? null,
    // O reconhecimento é, EM REGRA, do gestor: tudo que entra por planilha ou
    // projeção nasce por reconhecer, e a tela destaca isso. A exceção é a carga
    // de Contas a Pagar, em que o cadastro de quem reconhece despesa decide na
    // entrada — e é `reconhecido_via` que separa os dois casos, para ninguém
    // ler como conferência humana o que foi uma regra.
    reconhecido: Number(linha.reconhecido ?? 0) === 1,
    reconhecido_em: (linha.reconhecido_em as string | null) ?? null,
    reconhecido_via: (linha.reconhecido_via as string | null) ?? null,
  };
}

/**
 * O lançamento dentro do CLIENTE — não dentro da matriz em foco.
 *
 * Abrir um lançamento de outra matriz do mesmo contratante é rotina desde que a
 * tela lista o cliente inteiro; exigir que o filtro estivesse na matriz certa
 * faria o registro que a pessoa acabou de ver na lista "não existir" ao clicar.
 * A linha devolvida traz `empresa_id`, e é ele que toda escrita usa.
 */
function buscarLinha(ctx: Contexto, id: number): LinhaLancamento {
  const escopo = escopoSql(ctx);
  const linha = db()
    .prepare(`SELECT * FROM lancamentos WHERE id = ? AND ${escopo.sql} AND excluido_em IS NULL`)
    .get(id, ...escopo.params) as LinhaLancamento | undefined;
  if (!linha) throw erroNaoEncontrado(`Lançamento ${id} não encontrado neste cliente.`);
  return linha;
}

function garantirTipoDespesa(empresaId: number, tipoDespesaId: number): void {
  const linha = db()
    .prepare('SELECT id FROM tipos_despesa WHERE id = ? AND empresa_id = ?')
    .get(tipoDespesaId, empresaId);
  if (!linha) throw erroValidacao(`Tipo de despesa ${tipoDespesaId} não pertence à empresa em contexto.`);
}

/**
 * Cria um lançamento e, quando aplicável, projeta automaticamente a série:
 *
 * - `pontual_parcelada`: gera uma linha por parcela nos meses subsequentes.
 *   O total é rateado sem perda de centavos; a parcela 1 é o lançamento de
 *   origem e as demais referenciam-no por `lancamento_origem_id`.
 * - `fixa` com `repetirAte`: replica o mesmo valor mês a mês até o limite.
 * - `pontual_unica`: uma única linha.
 */
export function criarLancamento(ctx: Contexto, entrada: EntradaLancamento) {
  const competencia = paraInterno(entrada.competencia);
  const empresaId = empresaDeEscrita(ctx, entrada.empresaId);
  const filialId = validarFilial(empresaId, entrada.filialId);
  garantirTipoDespesa(empresaId, entrada.tipoDespesaId);
  garantirCompetenciaEditavel(ctx, competencia, entrada.justificativa, empresaId);

  const valorCentavos = paraCentavos(entrada.valor);
  if (valorCentavos < 0) throw erroValidacao('O valor do lançamento não pode ser negativo.');
  const cenario = garantirCenario(empresaId, entrada.cenario);
  const tipoConsumo: TipoConsumo = entrada.tipoConsumo ?? 'integral';
  const beneficiadas = resolverBeneficiadas(ctx, tipoConsumo, entrada.beneficiadas, filialId);

  const valores: Array<{ competencia: string; centavos: number; parcela: number | null }> = [];
  let qtdParcelas: number | null = null;

  if (entrada.natureza === 'pontual_parcelada') {
    const n = Number(entrada.qtdParcelas ?? 0);
    if (!Number.isInteger(n) || n < 2) {
      throw erroValidacao('Uma despesa pontual parcelada exige quantidade de parcelas maior ou igual a 2.');
    }
    if (n > MAX_OCORRENCIAS) {
      throw erroValidacao(`Quantidade de parcelas acima do limite de ${MAX_OCORRENCIAS}.`);
    }
    qtdParcelas = n;
    const rateio =
      (entrada.valorRefereSe ?? 'total') === 'parcela'
        ? Array.from({ length: n }, () => valorCentavos)
        : ratear(valorCentavos, n);
    rateio.forEach((centavos, i) => {
      valores.push({ competencia: somarMeses(competencia, i), centavos, parcela: i + 1 });
    });
  } else if (entrada.natureza === 'fixa' && entrada.repetirAte) {
    const fim = paraInterno(entrada.repetirAte);
    if (fim < competencia) throw erroValidacao('"Repetir até" deve ser igual ou posterior à competência inicial.');
    let mes = competencia;
    while (mes <= fim) {
      valores.push({ competencia: mes, centavos: valorCentavos, parcela: null });
      if (valores.length > MAX_OCORRENCIAS) {
        throw erroValidacao(`Recorrência acima do limite de ${MAX_OCORRENCIAS} meses.`);
      }
      mes = somarMeses(mes, 1);
    }
  } else {
    valores.push({ competencia, centavos: valorCentavos, parcela: null });
  }

  // Meses futuros de uma série não podem cair em competência fechada.
  for (const v of valores.slice(1)) {
    garantirCompetenciaEditavel(ctx, v.competencia, entrada.justificativa, empresaId);
  }

  return emTransacao(() => {
    const inserir = db().prepare(
      `INSERT INTO lancamentos
         (empresa_id, filial_id, tipo_despesa_id, competencia, valor_centavos, natureza, classificacao,
          qtd_parcelas, parcela_numero, lancamento_origem_id, descricao, observacoes, cenario, origem, dedup_hash,
          origem_custo, destino_pagamento, documento, fornecedor, grupo_gasto, data_pagamento, planejamento,
          tipo_consumo, beneficia_todas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const extras = [
      entrada.fornecedor ?? null,
      entrada.grupoGasto ?? null,
      entrada.dataPagamento ?? null,
      entrada.planejamento && Object.keys(entrada.planejamento).length
        ? JSON.stringify(entrada.planejamento)
        : null,
      // A classificação de consumo é do contrato, não da parcela: as duas
      // pontas do INSERT usam os mesmos extras, e por isso ela é herdada.
      tipoConsumo,
      entrada.beneficiadas === 'todas' ? 1 : 0,
    ];

    const primeiro = valores[0]!;
    const infoPrimeiro = inserir.run(
      empresaId,
      filialId,
      entrada.tipoDespesaId,
      primeiro.competencia,
      primeiro.centavos,
      entrada.natureza,
      entrada.classificacao,
      qtdParcelas,
      primeiro.parcela,
      null,
      entrada.descricao ?? null,
      entrada.observacoes ?? null,
      cenario,
      entrada.origem ?? 'manual',
      entrada.dedupHash ?? null,
      entrada.origemCusto ?? null,
      entrada.destinoPagamento ?? null,
      entrada.documento ?? null,
      ...extras,
    );
    const origemId = Number(infoPrimeiro.lastInsertRowid);

    const ids = [origemId];
    for (const v of valores.slice(1)) {
      const info = inserir.run(
        empresaId,
        filialId,
        entrada.tipoDespesaId,
        v.competencia,
        v.centavos,
        entrada.natureza,
        entrada.classificacao,
        qtdParcelas,
        v.parcela,
        origemId,
        entrada.descricao ?? null,
        entrada.observacoes ?? null,
        cenario,
        entrada.origem ?? 'manual',
        null, // a chave de dedup pertence ao lançamento de origem, não às projeções
        // As parcelas herdam origem, destino, documento, fornecedor e grupo de
        // gasto do lançamento de origem: é o mesmo contrato, parcelado.
        entrada.origemCusto ?? null,
        entrada.destinoPagamento ?? null,
        entrada.documento ?? null,
        ...extras,
      );
      ids.push(Number(info.lastInsertRowid));
    }

    // Toda a série compartilha as mesmas beneficiadas: parcelar um contrato não
    // muda quem o consome.
    if (beneficiadas.length) gravarBeneficiadas(ids, beneficiadas);

    auditar(ctx, {
      entidade: 'lancamento',
      entidadeId: origemId,
      acao: 'criar',
      justificativa: entrada.justificativa ?? null,
      depois: {
        competencia: paraExibicao(primeiro.competencia),
        natureza: entrada.natureza,
        classificacao: entrada.classificacao,
        valor_total: paraReais(valores.reduce((s, v) => s + v.centavos, 0)),
        ocorrencias_geradas: ids.length,
      },
    });

    return { ...obterLancamento(ctx, origemId), ids, ocorrencias: ids.length };
  });
}

export function obterLancamento(ctx: Contexto, id: number) {
  const escopo = escopoSql(ctx, null, 'l.empresa_id');
  const linha = db()
    .prepare(
      `SELECT l.*, t.nome AS tipo_despesa, f.nome AS filial_nome, e.nome AS empresa_nome
         FROM lancamentos l
         JOIN tipos_despesa t ON t.id = l.tipo_despesa_id
         JOIN empresas e ON e.id = l.empresa_id
         LEFT JOIN filiais f ON f.id = l.filial_id
        WHERE l.id = ? AND ${escopo.sql} AND l.excluido_em IS NULL`,
    )
    .get(id, ...escopo.params) as (LinhaLancamento & Record<string, unknown>) | undefined;
  if (!linha) throw erroNaoEncontrado(`Lançamento ${id} não encontrado neste cliente.`);
  return apresentar(linha, beneficiadasPorLancamento([linha.id]).get(linha.id) ?? []);
}

/**
 * Filtro de lançamentos.
 *
 * Cada dimensão aceita uma lista, porque a tela deixa marcar vários valores.
 * Os campos no singular continuam válidos — é o contrato antigo, e uma lista
 * de um item é o mesmo filtro.
 */
export interface FiltroLancamentos {
  /**
   * Filtro LOCAL de matriz. Vazio significa o cliente inteiro — o padrão de toda
   * tela desde que o recorte deixou de ser global. Matriz de outro cliente é
   * recusada no `escopoDeLeitura`, não filtrada em silêncio.
   */
  empresas?: number[];
  filialId?: number | null;
  filiais?: Array<number | null>;
  incluirFiliais?: boolean;
  tipoDespesaId?: number;
  tiposDespesaId?: number[];
  natureza?: Natureza;
  naturezas?: Natureza[];
  classificacao?: Classificacao;
  classificacoes?: Classificacao[];
  competenciaInicio?: string;
  competenciaFim?: string;
  competencia?: string;
  competencias?: string[];
  busca?: string;
  /** Padrão: apenas o cenário oficial. 'todos' traz as projeções alternativas junto. */
  cenario?: string;
  cenarios?: string[];
  /**
   * `true` deixa só o reconhecido, `false` só o que falta reconhecer. Ausente
   * traz os dois — que é o total de verdade, e o padrão de toda tela.
   */
  reconhecido?: boolean;
  limite?: number;
  offset?: number;
}

/** Junta o campo singular e o plural numa lista só. */
function comoLista<T>(unico: T | undefined, varios: T[] | undefined): T[] | undefined {
  const itens = [...(varios ?? []), ...(unico === undefined ? [] : [unico])];
  return itens.length ? itens : undefined;
}

function montarFiltro(ctx: Contexto, filtro: FiltroLancamentos) {
  const escopo = escopoSql(ctx, filtro.empresas, 'l.empresa_id');
  const condicoes = [escopo.sql, 'l.excluido_em IS NULL'];
  const params: unknown[] = [...escopo.params];
  const aplicar = (c: { sql: string; params: unknown[] } | null) => {
    if (!c) return;
    condicoes.push(c.sql);
    params.push(...c.params);
  };

  const cenarios = comoLista(filtro.cenario, filtro.cenarios);
  if (!cenarios?.includes('todos')) {
    aplicar(clausulaEm('l.cenario', cenarios ?? [CENARIO_OFICIAL]));
  }
  aplicar(clausulaEmComNulo('l.filial_id', comoLista(filtro.filialId, filtro.filiais)));
  aplicar(clausulaEm('l.tipo_despesa_id', comoLista(filtro.tipoDespesaId, filtro.tiposDespesaId)));
  aplicar(clausulaEm('l.natureza', comoLista(filtro.natureza, filtro.naturezas)));
  aplicar(clausulaEm('l.classificacao', comoLista(filtro.classificacao, filtro.classificacoes)));
  const competencias = comoLista(filtro.competencia, filtro.competencias);
  aplicar(clausulaEm('l.competencia', competencias?.map(paraInterno)));
  if (filtro.competenciaInicio) {
    condicoes.push('l.competencia >= ?');
    params.push(paraInterno(filtro.competenciaInicio));
  }
  if (filtro.competenciaFim) {
    condicoes.push('l.competencia <= ?');
    params.push(paraInterno(filtro.competenciaFim));
  }
  if (filtro.reconhecido !== undefined) {
    condicoes.push('l.reconhecido = ?');
    params.push(filtro.reconhecido ? 1 : 0);
  }
  if (filtro.busca?.trim()) {
    condicoes.push('(l.descricao LIKE ? OR l.observacoes LIKE ? OR t.nome LIKE ?)');
    const alvo = `%${filtro.busca.trim()}%`;
    params.push(alvo, alvo, alvo);
  }
  return { where: condicoes.join(' AND '), params };
}

export function listarLancamentos(ctx: Contexto, filtro: FiltroLancamentos = {}) {
  const { where, params } = montarFiltro(ctx, filtro);
  const limite = Math.min(filtro.limite ?? 200, 2000);
  const offset = filtro.offset ?? 0;

  const total = (
    db()
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(l.valor_centavos), 0) AS soma
           FROM lancamentos l JOIN tipos_despesa t ON t.id = l.tipo_despesa_id
          WHERE ${where}`,
      )
      .get(...params) as { n: number; soma: number }
  );

  const itens = db()
    .prepare(
      `SELECT l.*, t.nome AS tipo_despesa, f.nome AS filial_nome, e.nome AS empresa_nome
         FROM lancamentos l
         JOIN tipos_despesa t ON t.id = l.tipo_despesa_id
         JOIN empresas e ON e.id = l.empresa_id
         LEFT JOIN filiais f ON f.id = l.filial_id
        WHERE ${where}
        ORDER BY l.competencia DESC, t.nome, l.id
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limite, offset) as Array<LinhaLancamento & Record<string, unknown>>;
  const beneficiadas = beneficiadasPorLancamento(itens.map((l) => l.id));

  return {
    total: total.n,
    total_valor: paraReais(total.soma),
    limite,
    offset,
    itens: itens.map((l) => apresentar(l, beneficiadas.get(l.id) ?? [])),
  };
}

/**
 * Competências com movimento, para alimentar o seletor de múltipla escolha.
 * Sem lista, a tela só poderia oferecer um campo de texto livre.
 */
export function listarCompetencias(ctx: Contexto, cenarios?: string[], empresas?: number[]) {
  const alvo = cenarios?.length ? cenarios : [CENARIO_OFICIAL];
  const escopo = escopoSql(ctx, empresas);
  const linhas = db()
    .prepare(
      `SELECT competencia, COUNT(*) AS lancamentos, COALESCE(SUM(valor_centavos), 0) AS total
         FROM lancamentos
        WHERE ${escopo.sql} AND excluido_em IS NULL
          AND cenario IN (${alvo.map(() => '?').join(', ')})
        GROUP BY competencia ORDER BY competencia`,
    )
    .all(...escopo.params, ...alvo) as Array<{ competencia: string; lancamentos: number; total: number }>;
  return linhas.map((l) => ({
    competencia: paraExibicao(l.competencia),
    lancamentos: l.lancamentos,
    total: paraReais(l.total),
  }));
}

export interface AtualizacaoLancamento {
  filialId?: number | null;
  tipoDespesaId?: number;
  competencia?: string;
  valor?: number | string;
  classificacao?: Classificacao;
  descricao?: string | null;
  observacoes?: string | null;
  origemCusto?: string | null;
  destinoPagamento?: string | null;
  documento?: string | null;
  tipoConsumo?: TipoConsumo | null;
  beneficiadas?: number[] | 'todas' | null;
  justificativa?: string | null;
}

/** As beneficiadas gravadas hoje para este lançamento. */
function beneficiadasAtuais(lancamentoId: number): number[] {
  return (
    db()
      .prepare('SELECT filial_id FROM lancamento_beneficiadas WHERE lancamento_id = ?')
      .all(lancamentoId) as Array<{ filial_id: number }>
  ).map((b) => b.filial_id);
}

export function atualizarLancamento(ctx: Contexto, id: number, dados: AtualizacaoLancamento) {
  const antes = buscarLinha(ctx, id);
  // Lidas antes do UPDATE: depois dele, a trilha mostraria o estado novo nos
  // dois lados e o "antes" não diria nada.
  const beneficiadasAntes = beneficiadasPorLancamento([id]).get(id) ?? [];
  // A matriz é a DO REGISTRO: filial, tipo de despesa e mês fechado são dela,
  // não da que por acaso está em foco.
  const empresaDoRegistro = antes.empresa_id;
  garantirCompetenciaEditavel(ctx, antes.competencia, dados.justificativa, empresaDoRegistro);

  const novaCompetencia = dados.competencia ? paraInterno(dados.competencia) : antes.competencia;
  if (novaCompetencia !== antes.competencia) {
    if (antes.lancamento_origem_id !== null || antes.parcela_numero !== null) {
      throw erroConflito(
        'Não é possível mover a competência de uma parcela projetada. Reprograme o lançamento de origem.',
      );
    }
    garantirCompetenciaEditavel(ctx, novaCompetencia, dados.justificativa, empresaDoRegistro);
  }

  const filialId = dados.filialId !== undefined ? validarFilial(empresaDoRegistro, dados.filialId) : antes.filial_id;
  if (dados.tipoDespesaId !== undefined) garantirTipoDespesa(empresaDoRegistro, dados.tipoDespesaId);

  const valorCentavos = dados.valor !== undefined ? paraCentavos(dados.valor) : antes.valor_centavos;
  if (valorCentavos < 0) throw erroValidacao('O valor do lançamento não pode ser negativo.');

  // Campo não enviado permanece. Só se mexe na lista de beneficiadas quando o
  // pedido fala dela — corrigir um valor não pode apagar quem consome a despesa.
  const tipoConsumo: TipoConsumo =
    dados.tipoConsumo ?? ((antes.tipo_consumo as TipoConsumo | undefined) ?? 'integral');
  const mexeNoConsumo = dados.tipoConsumo !== undefined || dados.beneficiadas !== undefined;
  const beneficiadas = mexeNoConsumo
    ? resolverBeneficiadas(
        ctx,
        tipoConsumo,
        dados.beneficiadas !== undefined
          ? dados.beneficiadas
          : beneficiadasAtuais(id),
        filialId,
      )
    : null;

  db()
    .prepare(
      `UPDATE lancamentos
          SET filial_id = ?, tipo_despesa_id = ?, competencia = ?, valor_centavos = ?, classificacao = ?,
              descricao = ?, observacoes = ?, origem_custo = ?, destino_pagamento = ?, documento = ?,
              tipo_consumo = ?, beneficia_todas = ?,
              atualizado_em = datetime('now')
        WHERE id = ? AND empresa_id = ?`,
    )
    .run(
      filialId,
      dados.tipoDespesaId ?? antes.tipo_despesa_id,
      novaCompetencia,
      valorCentavos,
      dados.classificacao ?? antes.classificacao,
      dados.descricao !== undefined ? dados.descricao : antes.descricao,
      dados.observacoes !== undefined ? dados.observacoes : antes.observacoes,
      // Campo não enviado permanece: corrigir o valor não pode apagar de onde
      // veio o custo nem para onde foi o pagamento.
      dados.origemCusto !== undefined ? dados.origemCusto : antes.origem_custo,
      dados.destinoPagamento !== undefined ? dados.destinoPagamento : antes.destino_pagamento,
      dados.documento !== undefined ? dados.documento : antes.documento,
      tipoConsumo,
      dados.beneficiadas === 'todas' ? 1 : mexeNoConsumo ? 0 : Number(antes.beneficia_todas ?? 0),
      id,
      empresaDoRegistro,
    );

  if (beneficiadas !== null) gravarBeneficiadas([id], beneficiadas);

  const depois = obterLancamento(ctx, id);
  auditar(ctx, {
    entidade: 'lancamento',
    entidadeId: id,
    acao: 'atualizar',
    justificativa: dados.justificativa ?? null,
    antes: apresentar(antes, beneficiadasAntes),
    depois,
  });
  return depois;
}

/**
 * Reconhecimento da despesa pelo gestor.
 *
 * Não é edição do lançamento: o valor, a competência e a classificação seguem
 * intactos. O que muda é a afirmação de que alguém olhou aquilo e assumiu como
 * seu — por isso **não** passa pela trava de competência fechada: reconhecer um
 * mês já fechado é exatamente o trabalho de conferência que se espera, e
 * proibi-lo deixaria o passivo de não reconhecidos sem saída.
 *
 * Aceita uma lista porque o trabalho é em lote: ninguém reconhece 900
 * lançamentos um a um. Cada um vira uma entrada de trilha própria, porque é
 * disso que a auditoria precisa — quem reconheceu o quê, e quando.
 */
export function reconhecerLancamentos(
  ctx: Contexto,
  ids: number[],
  reconhecido: boolean,
  justificativa?: string,
) {
  if (!ids.length) throw erroValidacao('Informe ao menos um lançamento.');
  const alvo = reconhecido ? 1 : 0;
  const carimbo = reconhecido ? new Date().toISOString() : null;
  // `reconhecido_via = 'manual'` porque AQUI alguém olhou: é o caminho da tela
  // de Conferência. A carga tem caminho próprio e grava 'cadastro_origem' —
  // sem essa distinção, uma regra automática ficaria indistinguível de uma
  // conferência humana na hora em que alguém for auditar.
  const atualizar = db().prepare(
    `UPDATE lancamentos SET reconhecido = ?, reconhecido_em = ?, reconhecido_por = ?,
            reconhecido_via = ?, atualizado_em = datetime('now')
      WHERE id = ? AND empresa_id = ? AND excluido_em IS NULL AND reconhecido <> ?`,
  );

  let mudaram = 0;
  const jaEstavam: number[] = [];
  db().transaction(() => {
    for (const id of ids) {
      const antes = buscarLinha(ctx, id);
      if (Number(antes.reconhecido ?? 0) === alvo) {
        jaEstavam.push(id);
        continue;
      }
      atualizar.run(alvo, carimbo, ctx.usuarioId, alvo ? 'manual' : null, id, antes.empresa_id, alvo);
      mudaram += 1;
      auditar(ctx, {
        entidade: 'lancamento',
        entidadeId: id,
        acao: reconhecido ? 'reconhecer' : 'desfazer_reconhecimento',
        justificativa: justificativa ?? null,
        antes: { reconhecido: Number(antes.reconhecido ?? 0) === 1 },
        depois: { reconhecido },
      });
    }
  })();

  return { alterados: mudaram, ja_estavam: jaEstavam.length, reconhecido };
}

/**
 * Reclassificação Despesa <-> Investimento.
 *
 * Permitida livremente em competências futuras. Em competências passadas ou
 * na corrente exige justificativa (e a competência não pode estar fechada).
 * Em séries parceladas, a mudança se propaga por padrão às parcelas futuras
 * do mesmo grupo, mantendo a série coerente.
 */
export function reclassificarLancamento(
  ctx: Contexto,
  id: number,
  dados: { classificacao: Classificacao; justificativa?: string | null; aplicarParcelasFuturas?: boolean },
) {
  const alvo = buscarLinha(ctx, id);
  if (alvo.classificacao === dados.classificacao) {
    throw erroValidacao(`O lançamento já está classificado como "${dados.classificacao}".`);
  }

  const grupoId = alvo.lancamento_origem_id ?? alvo.id;
  const propagar = dados.aplicarParcelasFuturas ?? true;
  const atual = competenciaAtual();

  const alvos: LinhaLancamento[] = [alvo];
  if (propagar) {
    const irmas = db()
      .prepare(
        `SELECT * FROM lancamentos
          WHERE empresa_id = ? AND excluido_em IS NULL AND id <> ?
            AND (id = ? OR lancamento_origem_id = ?)
            AND competencia > ?`,
      )
      .all(alvo.empresa_id, alvo.id, grupoId, grupoId, atual) as LinhaLancamento[];
    alvos.push(...irmas.filter((l) => l.classificacao !== dados.classificacao));
  }

  for (const linha of alvos) {
    // Passado/corrente exigem justificativa; futuro é livre. Mês fechado bloqueia.
    const exigeJustificativa = posicaoTemporal(linha.competencia) !== 'futura';
    garantirCompetenciaEditavel(ctx, linha.competencia, exigeJustificativa ? dados.justificativa : 'reclassificação futura');
    if (exigeJustificativa && !dados.justificativa?.trim()) {
      throw erroValidacao(
        `Reclassificar a competência ${paraExibicao(linha.competencia)} (não futura) exige justificativa.`,
      );
    }
  }

  return emTransacao(() => {
    const atualizar = db().prepare(
      `UPDATE lancamentos SET classificacao = ?, atualizado_em = datetime('now') WHERE id = ? AND empresa_id = ?`,
    );
    for (const linha of alvos) {
      atualizar.run(dados.classificacao, linha.id, linha.empresa_id);
      auditar(ctx, {
        entidade: 'lancamento',
        entidadeId: linha.id,
        acao: 'reclassificar',
        justificativa: dados.justificativa ?? 'reclassificação de competência futura',
        antes: { classificacao: linha.classificacao, competencia: paraExibicao(linha.competencia) },
        depois: { classificacao: dados.classificacao, competencia: paraExibicao(linha.competencia) },
      });
    }
    return {
      alterados: alvos.length,
      itens: alvos.map((l) => obterLancamento(ctx, l.id)),
    };
  });
}

/**
 * Exclusão lógica com trilha de auditoria — nunca há exclusão silenciosa.
 * Excluir um lançamento de origem remove também as parcelas projetadas.
 */
export function excluirLancamento(
  ctx: Contexto,
  id: number,
  opcoes: { justificativa?: string | null; incluirParcelas?: boolean } = {},
) {
  const alvo = buscarLinha(ctx, id);
  garantirCompetenciaEditavel(ctx, alvo.competencia, opcoes.justificativa);

  const ehOrigem = alvo.lancamento_origem_id === null;
  const incluirParcelas = opcoes.incluirParcelas ?? true;

  const alvos: LinhaLancamento[] = [alvo];
  if (ehOrigem && incluirParcelas) {
    const filhas = db()
      .prepare('SELECT * FROM lancamentos WHERE empresa_id = ? AND lancamento_origem_id = ? AND excluido_em IS NULL')
      .all(alvo.empresa_id, alvo.id) as LinhaLancamento[];
    alvos.push(...filhas);
  }
  for (const linha of alvos.slice(1)) {
    garantirCompetenciaEditavel(ctx, linha.competencia, opcoes.justificativa);
  }

  return emTransacao(() => {
    const marcar = db().prepare(
      `UPDATE lancamentos SET excluido_em = datetime('now'), dedup_hash = NULL WHERE id = ? AND empresa_id = ?`,
    );
    for (const linha of alvos) {
      marcar.run(linha.id, linha.empresa_id);
      auditar(ctx, {
        entidade: 'lancamento',
        entidadeId: linha.id,
        acao: 'excluir',
        justificativa: opcoes.justificativa ?? null,
        antes: apresentar(linha),
      });
    }
    return { excluidos: alvos.length };
  });
}

/** Todas as parcelas de uma série, na ordem cronológica. */
export function listarSerie(ctx: Contexto, id: number) {
  const alvo = buscarLinha(ctx, id);
  const grupoId = alvo.lancamento_origem_id ?? alvo.id;
  const linhas = db()
    .prepare(
      `SELECT l.*, t.nome AS tipo_despesa, f.nome AS filial_nome
         FROM lancamentos l
         JOIN tipos_despesa t ON t.id = l.tipo_despesa_id
         LEFT JOIN filiais f ON f.id = l.filial_id
        WHERE l.empresa_id = ? AND l.excluido_em IS NULL AND (l.id = ? OR l.lancamento_origem_id = ?)
        ORDER BY l.competencia`,
    )
    .all(alvo.empresa_id, grupoId, grupoId) as Array<LinhaLancamento & Record<string, unknown>>;
  const beneficiadas = beneficiadasPorLancamento(linhas.map((l) => l.id));
  return linhas.map((l) => apresentar(l, beneficiadas.get(l.id) ?? []));
}


// ==========================================================================
// Cenários de projeção
// ==========================================================================

export const CENARIO_OFICIAL = 'oficial';

/**
 * O cenário 'oficial' é a projeção vigente e alimenta os dashboards por padrão.
 * Cenários alternativos (ex.: contrato com desconto condicionado) convivem no
 * mesmo módulo sem contaminar os totais oficiais.
 */
export function garantirCenario(empresaId: number, chave: string | null | undefined): string {
  const limpo = (chave ?? CENARIO_OFICIAL).trim() || CENARIO_OFICIAL;
  if (limpo === CENARIO_OFICIAL) return CENARIO_OFICIAL;
  const existente = db().prepare('SELECT chave FROM cenarios WHERE empresa_id = ? AND chave = ?').get(empresaId, limpo);
  if (!existente) {
    throw erroValidacao(`Cenário "${limpo}" não cadastrado nesta empresa.`);
  }
  return limpo;
}

/**
 * Os cenários do CLIENTE, um por chave.
 *
 * A tabela guarda uma linha por matriz — é assim que a validação de escrita
 * confere se a matriz conhece o cenário —, mas a lista é do cliente: o gestor
 * cadastra "contrato com desconto" uma vez, e ele vale para todas as unidades.
 * A contagem soma as matrizes, porque o número que interessa é o do cliente.
 */
export function listarCenarios(ctx: Contexto, empresas?: number[]) {
  const escopo = escopoSql(ctx, empresas);
  const escopoC = escopoSql(ctx, empresas, 'c.empresa_id');
  const alternativos = db()
    .prepare(
      `SELECT c.chave, MIN(c.nome) AS nome, MIN(c.descricao) AS descricao,
              (SELECT COUNT(*) FROM lancamentos l
                WHERE ${escopoSql(ctx, empresas, 'l.empresa_id').sql}
                  AND l.cenario = c.chave AND l.excluido_em IS NULL) AS lancamentos
         FROM cenarios c WHERE ${escopoC.sql}
        GROUP BY c.chave ORDER BY MIN(c.nome)`,
    )
    .all(...escopoSql(ctx, empresas, 'l.empresa_id').params, ...escopoC.params) as Array<{
    chave: string;
    nome: string;
    descricao: string | null;
    lancamentos: number;
  }>;
  const oficial = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM lancamentos WHERE ${escopo.sql} AND cenario = ? AND excluido_em IS NULL`,
    )
    .get(...escopo.params, CENARIO_OFICIAL) as { n: number };
  return [
    { chave: CENARIO_OFICIAL, nome: 'Oficial', descricao: 'Projeção vigente', lancamentos: oficial.n },
    ...alternativos,
  ];
}

export function criarCenario(ctx: Contexto, dados: { chave: string; nome: string; descricao?: string | null }) {
  const chave = dados.chave?.trim();
  if (!chave || chave === CENARIO_OFICIAL) {
    throw erroValidacao('Informe uma chave de cenário diferente de "oficial".');
  }
  // O cenário é do cliente: ele nasce em TODAS as matrizes dele. Criá-lo só na
  // matriz em foco faria o lançamento numa unidade irmã ser recusado por
  // "cenário não cadastrado" — com o cenário visível na lista, que é do cliente.
  const nome = dados.nome?.trim() || chave;
  const inserir = db().prepare(
    `INSERT INTO cenarios (empresa_id, chave, nome, descricao) VALUES (?, ?, ?, ?)
     ON CONFLICT (empresa_id, chave) DO NOTHING`,
  );
  let id = 0;
  emTransacao(() => {
    for (const empresaId of escopoDeLeitura(ctx)) {
      const info = inserir.run(empresaId, chave, nome, dados.descricao ?? null);
      if (empresaId === ctx.empresaId || id === 0) id = Number(info.lastInsertRowid) || id;
    }
  });
  auditar(ctx, { entidade: 'cenario', entidadeId: id, acao: 'criar', depois: dados });
  return { id, chave, nome, descricao: dados.descricao ?? null };
}
