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
import { validarFilial } from './cadastros.js';
import { garantirCompetenciaEditavel } from './fechamento.js';
import { paraCentavos, paraReais, ratear } from './dinheiro.js';
import { clausulaEm, clausulaEmComNulo } from '../lib/consulta.js';

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

export interface EntradaLancamento {
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
  excluido_em: string | null;
}

/** Limite de segurança para geração automática de séries (parcelas/recorrência). */
const MAX_OCORRENCIAS = 240;

function apresentar(linha: LinhaLancamento & Record<string, unknown>) {
  return {
    id: linha.id,
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
  };
}

function buscarLinha(ctx: Contexto, id: number): LinhaLancamento {
  const linha = db()
    .prepare('SELECT * FROM lancamentos WHERE id = ? AND empresa_id = ? AND excluido_em IS NULL')
    .get(id, ctx.empresaId) as LinhaLancamento | undefined;
  if (!linha) throw erroNaoEncontrado(`Lançamento ${id} não encontrado nesta empresa.`);
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
  const filialId = validarFilial(ctx.empresaId, entrada.filialId);
  garantirTipoDespesa(ctx.empresaId, entrada.tipoDespesaId);
  garantirCompetenciaEditavel(ctx, competencia, entrada.justificativa);

  const valorCentavos = paraCentavos(entrada.valor);
  if (valorCentavos < 0) throw erroValidacao('O valor do lançamento não pode ser negativo.');
  const cenario = garantirCenario(ctx.empresaId, entrada.cenario);

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
    garantirCompetenciaEditavel(ctx, v.competencia, entrada.justificativa);
  }

  return emTransacao(() => {
    const inserir = db().prepare(
      `INSERT INTO lancamentos
         (empresa_id, filial_id, tipo_despesa_id, competencia, valor_centavos, natureza, classificacao,
          qtd_parcelas, parcela_numero, lancamento_origem_id, descricao, observacoes, cenario, origem, dedup_hash,
          origem_custo, destino_pagamento, documento)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const primeiro = valores[0]!;
    const infoPrimeiro = inserir.run(
      ctx.empresaId,
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
    );
    const origemId = Number(infoPrimeiro.lastInsertRowid);

    const ids = [origemId];
    for (const v of valores.slice(1)) {
      const info = inserir.run(
        ctx.empresaId,
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
        // As parcelas herdam origem, destino e documento do lançamento de
        // origem: é o mesmo contrato, parcelado.
        entrada.origemCusto ?? null,
        entrada.destinoPagamento ?? null,
        entrada.documento ?? null,
      );
      ids.push(Number(info.lastInsertRowid));
    }

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
  const linha = db()
    .prepare(
      `SELECT l.*, t.nome AS tipo_despesa, f.nome AS filial_nome
         FROM lancamentos l
         JOIN tipos_despesa t ON t.id = l.tipo_despesa_id
         LEFT JOIN filiais f ON f.id = l.filial_id
        WHERE l.id = ? AND l.empresa_id = ? AND l.excluido_em IS NULL`,
    )
    .get(id, ctx.empresaId) as (LinhaLancamento & Record<string, unknown>) | undefined;
  if (!linha) throw erroNaoEncontrado(`Lançamento ${id} não encontrado nesta empresa.`);
  return apresentar(linha);
}

/**
 * Filtro de lançamentos.
 *
 * Cada dimensão aceita uma lista, porque a tela deixa marcar vários valores.
 * Os campos no singular continuam válidos — é o contrato antigo, e uma lista
 * de um item é o mesmo filtro.
 */
export interface FiltroLancamentos {
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
  limite?: number;
  offset?: number;
}

/** Junta o campo singular e o plural numa lista só. */
function comoLista<T>(unico: T | undefined, varios: T[] | undefined): T[] | undefined {
  const itens = [...(varios ?? []), ...(unico === undefined ? [] : [unico])];
  return itens.length ? itens : undefined;
}

function montarFiltro(ctx: Contexto, filtro: FiltroLancamentos) {
  const condicoes = ['l.empresa_id = ?', 'l.excluido_em IS NULL'];
  const params: unknown[] = [ctx.empresaId];
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
      `SELECT l.*, t.nome AS tipo_despesa, f.nome AS filial_nome
         FROM lancamentos l
         JOIN tipos_despesa t ON t.id = l.tipo_despesa_id
         LEFT JOIN filiais f ON f.id = l.filial_id
        WHERE ${where}
        ORDER BY l.competencia DESC, t.nome, l.id
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limite, offset) as Array<LinhaLancamento & Record<string, unknown>>;

  return {
    total: total.n,
    total_valor: paraReais(total.soma),
    limite,
    offset,
    itens: itens.map(apresentar),
  };
}

/**
 * Competências com movimento, para alimentar o seletor de múltipla escolha.
 * Sem lista, a tela só poderia oferecer um campo de texto livre.
 */
export function listarCompetencias(ctx: Contexto, cenarios?: string[]) {
  const alvo = cenarios?.length ? cenarios : [CENARIO_OFICIAL];
  const linhas = db()
    .prepare(
      `SELECT competencia, COUNT(*) AS lancamentos, COALESCE(SUM(valor_centavos), 0) AS total
         FROM lancamentos
        WHERE empresa_id = ? AND excluido_em IS NULL
          AND cenario IN (${alvo.map(() => '?').join(', ')})
        GROUP BY competencia ORDER BY competencia`,
    )
    .all(ctx.empresaId, ...alvo) as Array<{ competencia: string; lancamentos: number; total: number }>;
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
  justificativa?: string | null;
}

export function atualizarLancamento(ctx: Contexto, id: number, dados: AtualizacaoLancamento) {
  const antes = buscarLinha(ctx, id);
  garantirCompetenciaEditavel(ctx, antes.competencia, dados.justificativa);

  const novaCompetencia = dados.competencia ? paraInterno(dados.competencia) : antes.competencia;
  if (novaCompetencia !== antes.competencia) {
    if (antes.lancamento_origem_id !== null || antes.parcela_numero !== null) {
      throw erroConflito(
        'Não é possível mover a competência de uma parcela projetada. Reprograme o lançamento de origem.',
      );
    }
    garantirCompetenciaEditavel(ctx, novaCompetencia, dados.justificativa);
  }

  const filialId = dados.filialId !== undefined ? validarFilial(ctx.empresaId, dados.filialId) : antes.filial_id;
  if (dados.tipoDespesaId !== undefined) garantirTipoDespesa(ctx.empresaId, dados.tipoDespesaId);

  const valorCentavos = dados.valor !== undefined ? paraCentavos(dados.valor) : antes.valor_centavos;
  if (valorCentavos < 0) throw erroValidacao('O valor do lançamento não pode ser negativo.');

  db()
    .prepare(
      `UPDATE lancamentos
          SET filial_id = ?, tipo_despesa_id = ?, competencia = ?, valor_centavos = ?, classificacao = ?,
              descricao = ?, observacoes = ?, origem_custo = ?, destino_pagamento = ?, documento = ?,
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
      id,
      ctx.empresaId,
    );

  const depois = obterLancamento(ctx, id);
  auditar(ctx, {
    entidade: 'lancamento',
    entidadeId: id,
    acao: 'atualizar',
    justificativa: dados.justificativa ?? null,
    antes: apresentar(antes),
    depois,
  });
  return depois;
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
      .all(ctx.empresaId, alvo.id, grupoId, grupoId, atual) as LinhaLancamento[];
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
      atualizar.run(dados.classificacao, linha.id, ctx.empresaId);
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
      .all(ctx.empresaId, alvo.id) as LinhaLancamento[];
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
      marcar.run(linha.id, ctx.empresaId);
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
    .all(ctx.empresaId, grupoId, grupoId) as Array<LinhaLancamento & Record<string, unknown>>;
  return linhas.map(apresentar);
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

export function listarCenarios(ctx: Contexto) {
  const alternativos = db()
    .prepare(
      `SELECT c.chave, c.nome, c.descricao,
              (SELECT COUNT(*) FROM lancamentos l
                WHERE l.empresa_id = c.empresa_id AND l.cenario = c.chave AND l.excluido_em IS NULL) AS lancamentos
         FROM cenarios c WHERE c.empresa_id = ? ORDER BY c.nome`,
    )
    .all(ctx.empresaId) as Array<{ chave: string; nome: string; descricao: string | null; lancamentos: number }>;
  const oficial = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM lancamentos WHERE empresa_id = ? AND cenario = ? AND excluido_em IS NULL`,
    )
    .get(ctx.empresaId, CENARIO_OFICIAL) as { n: number };
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
  const info = db()
    .prepare('INSERT INTO cenarios (empresa_id, chave, nome, descricao) VALUES (?, ?, ?, ?)')
    .run(ctx.empresaId, chave, dados.nome?.trim() || chave, dados.descricao ?? null);
  const id = Number(info.lastInsertRowid);
  auditar(ctx, { entidade: 'cenario', entidadeId: id, acao: 'criar', depois: dados });
  return { id, chave, nome: dados.nome?.trim() || chave, descricao: dados.descricao ?? null };
}
