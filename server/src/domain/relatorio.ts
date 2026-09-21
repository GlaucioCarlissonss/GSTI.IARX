/**
 * Relatório financeiro em tabela dinâmica, com drill-down em três níveis.
 *
 * Reproduz o que o gestor já monta no Excel: meses nas colunas, hierarquia nas
 * linhas, Total Geral nas duas pontas. A diferença é que aqui o detalhe está a
 * um clique — no Excel, expandir uma categoria mostra as linhas de origem; aqui
 * mostra os lançamentos, e clicar em um deles abre o registro inteiro.
 *
 * Os três níveis:
 *   1. macro    — totais por linha (filial) e por mês
 *   2. categoria — ao expandir uma filial, os tipos de despesa dela
 *   3. lançamento — ao expandir um tipo, os lançamentos daquele recorte
 *
 * O nível 3 é carregado sob demanda: trazer todos os lançamentos de todos os
 * meses de todas as filiais junto do macro tornaria a primeira tela lenta pelo
 * que quase nunca é olhado.
 */
import { db } from '../db/index.js';
import { paraExibicao, paraInterno } from './competencia.js';
import { paraReais } from './dinheiro.js';
import type { Contexto } from './contexto.js';
import { escopoSql } from './escopo.js';
import {
  beneficiadasPorLancamento,
  CENARIO_OFICIAL,
  ROTULO_CONSUMO,
  ROTULO_ORIGEM,
  type Origem,
  type TipoConsumo,
} from './financeiro.js';
import { clausulaEm } from '../lib/consulta.js';

export interface FiltroRelatorio {
  /** Filtro local de matriz. Vazio: o cliente inteiro. */
  empresas?: number[];
  competenciaInicio?: string;
  competenciaFim?: string;
  filiais?: Array<number | null>;
  cenarios?: string[];
  tiposDespesa?: number[];
  origens?: Origem[];
  classificacoes?: string[];
  naturezas?: string[];
}

/** Condições e parâmetros comuns ao macro e ao detalhe: o mesmo recorte. */
function recorte(ctx: Contexto, f: FiltroRelatorio) {
  const alcance = escopoSql(ctx, f.empresas, 'l.empresa_id');
  const condicoes = [alcance.sql, 'l.excluido_em IS NULL'];
  const params: unknown[] = [...alcance.params];

  const cenarios = f.cenarios?.length ? f.cenarios : [CENARIO_OFICIAL];
  const cen = clausulaEm('l.cenario', cenarios);
  if (cen) {
    condicoes.push(cen.sql);
    params.push(...cen.params);
  }

  if (f.competenciaInicio) {
    condicoes.push('l.competencia >= ?');
    params.push(paraInterno(f.competenciaInicio));
  }
  if (f.competenciaFim) {
    condicoes.push('l.competencia <= ?');
    params.push(paraInterno(f.competenciaFim));
  }

  if (f.filiais?.length) {
    // O nível empresa é `filial_id IS NULL`, que `IN` não alcança sozinho.
    const ids = f.filiais.filter((v): v is number => v !== null);
    const partes: string[] = [];
    if (ids.length) {
      partes.push(`l.filial_id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
    if (f.filiais.includes(null)) partes.push('l.filial_id IS NULL');
    condicoes.push(`(${partes.join(' OR ')})`);
  }

  for (const [coluna, valores] of [
    ['l.tipo_despesa_id', f.tiposDespesa],
    ['l.origem', f.origens],
    ['l.classificacao', f.classificacoes],
    ['l.natureza', f.naturezas],
  ] as Array<[string, unknown[] | undefined]>) {
    const c = clausulaEm(coluna, valores);
    if (c) {
      condicoes.push(c.sql);
      params.push(...c.params);
    }
  }

  return { where: condicoes.join(' AND '), params };
}

interface Celula {
  competencia: string;
  valor_centavos: number;
}

/** Uma linha do relatório, com o valor de cada mês e o total da linha. */
export interface LinhaRelatorio {
  chave: string;
  rotulo: string;
  nivel: 1 | 2;
  /** Chave da linha-pai; `null` no primeiro nível. */
  pai: string | null;
  /** Ids do recorte desta linha, para o detalhe pedir exatamente o mesmo. */
  filial_id: number | null;
  tipo_despesa_id: number | null;
  meses: Record<string, number>;
  total_centavos: number;
  total: string;
  lancamentos: number;
}

/**
 * Visão macro: filiais no primeiro nível, tipos de despesa no segundo, meses
 * nas colunas. Vem inteira porque é pequena — é a agregação, não o detalhe.
 */
export function relatorioFinanceiro(ctx: Contexto, f: FiltroRelatorio = {}) {
  const { where, params } = recorte(ctx, f);

  const linhas = db()
    .prepare(
      `SELECT l.filial_id, fi.nome AS filial_nome, l.tipo_despesa_id, td.nome AS tipo_despesa,
              l.competencia, SUM(l.valor_centavos) AS valor_centavos, COUNT(*) AS lancamentos
         FROM lancamentos l
         LEFT JOIN filiais fi ON fi.id = l.filial_id
         JOIN tipos_despesa td ON td.id = l.tipo_despesa_id
        WHERE ${where}
        GROUP BY l.filial_id, l.tipo_despesa_id, l.competencia
        ORDER BY fi.nome, td.nome, l.competencia`,
    )
    .all(...params) as Array<{
    filial_id: number | null;
    filial_nome: string | null;
    tipo_despesa_id: number;
    tipo_despesa: string;
    competencia: string;
    valor_centavos: number;
    lancamentos: number;
  }>;

  // As colunas são os meses que existem no recorte, em ordem. Meses sem
  // movimento não viram coluna vazia: o relatório mostra o que há.
  const competencias = [...new Set(linhas.map((l) => l.competencia))].sort();

  const porChave = new Map<string, LinhaRelatorio>();
  const garantir = (base: Omit<LinhaRelatorio, 'meses' | 'total_centavos' | 'total' | 'lancamentos'>) => {
    if (!porChave.has(base.chave)) {
      porChave.set(base.chave, { ...base, meses: {}, total_centavos: 0, total: String(paraReais(0)), lancamentos: 0 });
    }
    return porChave.get(base.chave)!;
  };

  for (const l of linhas) {
    const rotuloFilial = l.filial_nome ?? 'Nível empresa';
    const chaveFilial = `f${l.filial_id ?? 'null'}`;
    const chaveTipo = `${chaveFilial}:t${l.tipo_despesa_id}`;
    const mes = paraExibicao(l.competencia);

    for (const alvo of [
      garantir({
        chave: chaveFilial,
        rotulo: rotuloFilial,
        nivel: 1,
        pai: null,
        filial_id: l.filial_id,
        tipo_despesa_id: null,
      }),
      garantir({
        chave: chaveTipo,
        rotulo: l.tipo_despesa,
        nivel: 2,
        pai: chaveFilial,
        filial_id: l.filial_id,
        tipo_despesa_id: l.tipo_despesa_id,
      }),
    ]) {
      alvo.meses[mes] = (alvo.meses[mes] ?? 0) + l.valor_centavos;
      alvo.total_centavos += l.valor_centavos;
      alvo.lancamentos += l.lancamentos;
    }
  }

  const todas = [...porChave.values()].map((l) => ({ ...l, total: String(paraReais(l.total_centavos)) }));
  // Ordem de leitura: cada filial seguida dos seus tipos, filiais por valor
  // decrescente — o maior custo primeiro é o que o gestor procura.
  const primeiroNivel = todas.filter((l) => l.nivel === 1).sort((a, b) => b.total_centavos - a.total_centavos);
  const ordenadas = primeiroNivel.flatMap((f1) => [
    f1,
    ...todas.filter((l) => l.pai === f1.chave).sort((a, b) => b.total_centavos - a.total_centavos),
  ]);

  const totalGeral: Record<string, number> = {};
  let somaGeral = 0;
  let contagemGeral = 0;
  for (const l of primeiroNivel) {
    for (const [mes, v] of Object.entries(l.meses)) totalGeral[mes] = (totalGeral[mes] ?? 0) + v;
    somaGeral += l.total_centavos;
    contagemGeral += l.lancamentos;
  }

  return {
    colunas: competencias.map(paraExibicao),
    linhas: ordenadas,
    total_geral: {
      meses: totalGeral,
      total_centavos: somaGeral,
      total: String(paraReais(somaGeral)),
      lancamentos: contagemGeral,
    },
  };
}

/**
 * Nível 3: os lançamentos de uma célula do relatório. Carregado sob demanda,
 * pelo mesmo recorte da visão macro mais a linha escolhida — é o que garante
 * que a soma do detalhe bate com o número que estava na tela.
 */
export function lancamentosDoRelatorio(
  ctx: Contexto,
  f: FiltroRelatorio & { filialId?: number | null; tipoDespesaId?: number; competencia?: string },
) {
  const { where, params } = recorte(ctx, f);
  const condicoes = [where];

  if (f.filialId === null) condicoes.push('l.filial_id IS NULL');
  else if (f.filialId !== undefined) {
    condicoes.push('l.filial_id = ?');
    params.push(f.filialId);
  }
  if (f.tipoDespesaId !== undefined) {
    condicoes.push('l.tipo_despesa_id = ?');
    params.push(f.tipoDespesaId);
  }
  if (f.competencia) {
    condicoes.push('l.competencia = ?');
    params.push(paraInterno(f.competencia));
  }

  const itens = db()
    .prepare(
      `SELECT l.id, l.competencia, l.valor_centavos, l.natureza, l.classificacao,
              l.parcela_numero, l.qtd_parcelas, l.descricao, l.observacoes,
              l.origem, l.origem_custo, l.destino_pagamento, l.documento, l.cenario,
              l.tipo_consumo, l.beneficia_todas,
              l.filial_id, fi.nome AS filial_nome, l.tipo_despesa_id, td.nome AS tipo_despesa
         FROM lancamentos l
         LEFT JOIN filiais fi ON fi.id = l.filial_id
         JOIN tipos_despesa td ON td.id = l.tipo_despesa_id
        WHERE ${condicoes.join(' AND ')}
        ORDER BY l.competencia, td.nome, l.id`,
    )
    .all(...params) as Array<Record<string, unknown>>;

  // Este detalhe alimenta o drill-down de Conferência, Financeiro, Painel
  // Executivo e Relatório: a classificação de consumo aparece nas quatro telas
  // por sair daqui.
  const beneficiadas = beneficiadasPorLancamento(itens.map((l) => Number(l.id)));

  return {
    itens: itens.map((l) => ({
      ...l,
      competencia: paraExibicao(String(l.competencia)),
      valor: paraReais(Number(l.valor_centavos)),
      origem_rotulo: ROTULO_ORIGEM[l.origem as Origem] ?? l.origem,
      filial_nome: (l.filial_nome as string | null) ?? 'Nível empresa',
      tipo_consumo: (l.tipo_consumo as TipoConsumo) ?? 'integral',
      tipo_consumo_rotulo: ROTULO_CONSUMO[(l.tipo_consumo as TipoConsumo) ?? 'integral'],
      beneficia_todas: Number(l.beneficia_todas ?? 0) === 1,
      filiais_beneficiadas: beneficiadas.get(Number(l.id)) ?? [],
    })),
    // O total do detalhe vem da mesma consulta que o listou: se divergisse do
    // macro, a divergência apareceria aqui e não num lugar qualquer.
    total_centavos: itens.reduce((s, l) => s + Number(l.valor_centavos), 0),
    total: paraReais(itens.reduce((s, l) => s + Number(l.valor_centavos), 0)),
  };
}

/** Celula de origem do relatório: usado pelos gráficos no drill-down. */
export type { Celula };
