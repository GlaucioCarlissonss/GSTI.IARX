import { db } from '../db/index.js';
import { CENARIO_OFICIAL } from './financeiro.js';
import {
  competenciaAtual,
  diferencaEmMeses,
  intervalo,
  paraExibicao,
  paraInterno,
  somarMeses,
} from './competencia.js';
import type { Contexto } from './contexto.js';
import { paraReais } from './dinheiro.js';
import { calcularAtraso } from './projetos.js';
import { montarFiltroSla, percentual, type FiltroSla } from './sla.js';

export interface EscopoDashboard {
  /** `undefined` = consolidado da empresa; `null` = apenas nível empresa (sem filial); número = filial específica. */
  filialId?: number | null;
  competencia?: string;
  competenciaInicio?: string;
  competenciaFim?: string;
  /** Cenário de projeção financeira. Padrão: 'oficial'. */
  cenario?: string;
}

/**
 * Sem competência informada, o painel abre no último mês **encerrado** com
 * movimento. O mês corrente ainda está em curso — abri-lo por padrão compara
 * um mês parcial com um mês completo e produz variações enganosas. O gestor
 * continua podendo consultá-lo informando a competência.
 */
function ultimaCompetenciaComDados(
  tabela: 'lancamentos' | 'tickets_sla',
  empresaId: number,
  filtroExtra: { coluna: string; valor: unknown } | null,
  limite: string,
): string | null {
  const extra = filtroExtra ? `AND ${filtroExtra.coluna} = ?` : '';
  const params = filtroExtra ? [empresaId, filtroExtra.valor, limite] : [empresaId, limite];
  const linha = db()
    .prepare(
      `SELECT MAX(competencia) AS m FROM ${tabela}
        WHERE empresa_id = ? AND excluido_em IS NULL ${extra} AND competencia < ?`,
    )
    .get(...params) as { m: string | null };
  return linha.m;
}

function competenciaReferencia(ctx: Contexto, escopo: EscopoDashboard, cenario: string): string {
  if (escopo.competencia) return paraInterno(escopo.competencia);
  const atual = competenciaAtual();
  const fechada = ultimaCompetenciaComDados('lancamentos', ctx.empresaId, { coluna: 'cenario', valor: cenario }, atual);
  if (fechada) return fechada;
  // Sem histórico, cai no mês corrente (que pode conter apenas projeções).
  const qualquer = db()
    .prepare(
      `SELECT MAX(competencia) AS m FROM lancamentos
        WHERE empresa_id = ? AND excluido_em IS NULL AND cenario = ? AND competencia <= ?`,
    )
    .get(ctx.empresaId, cenario, atual) as { m: string | null };
  return qualquer.m ?? atual;
}

function filtroFinanceiro(ctx: Contexto, escopo: EscopoDashboard, cenario: string) {
  const condicoes = ['l.empresa_id = ?', 'l.excluido_em IS NULL', 'l.cenario = ?'];
  const params: unknown[] = [ctx.empresaId, cenario];
  if (escopo.filialId === null) condicoes.push('l.filial_id IS NULL');
  else if (escopo.filialId !== undefined) {
    condicoes.push('l.filial_id = ?');
    params.push(escopo.filialId);
  }
  return { condicoes, params };
}

// ==========================================================================
// Dashboard Financeiro
// ==========================================================================

export function dashboardFinanceiro(ctx: Contexto, escopo: EscopoDashboard = {}) {
  const cenario = escopo.cenario?.trim() || CENARIO_OFICIAL;
  const mesRef = competenciaReferencia(ctx, escopo, cenario);
  const inicioSerie = escopo.competenciaInicio ? paraInterno(escopo.competenciaInicio) : somarMeses(mesRef, -11);
  const fimSerie = escopo.competenciaFim ? paraInterno(escopo.competenciaFim) : mesRef;

  const { condicoes, params } = filtroFinanceiro(ctx, escopo, cenario);
  const where = condicoes.join(' AND ');

  // --- Totais do mês de referência
  const totaisMes = db()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN l.classificacao = 'despesa' THEN l.valor_centavos ELSE 0 END), 0) AS despesa,
         COALESCE(SUM(CASE WHEN l.classificacao = 'investimento' THEN l.valor_centavos ELSE 0 END), 0) AS investimento,
         COUNT(*) AS lancamentos
       FROM lancamentos l WHERE ${where} AND l.competencia = ?`,
    )
    .get(...params, mesRef) as { despesa: number; investimento: number; lancamentos: number };

  const mesAnterior = somarMeses(mesRef, -1);
  const totaisAnterior = db()
    .prepare(
      `SELECT COALESCE(SUM(l.valor_centavos), 0) AS total
         FROM lancamentos l WHERE ${where} AND l.competencia = ?`,
    )
    .get(...params, mesAnterior) as { total: number };

  const totalMes = totaisMes.despesa + totaisMes.investimento;

  // --- Distribuição por tipo de despesa
  const porTipo = (
    db()
      .prepare(
        `SELECT t.nome AS tipo,
                COALESCE(SUM(l.valor_centavos), 0) AS total,
                COALESCE(SUM(CASE WHEN l.classificacao = 'despesa' THEN l.valor_centavos ELSE 0 END), 0) AS despesa,
                COALESCE(SUM(CASE WHEN l.classificacao = 'investimento' THEN l.valor_centavos ELSE 0 END), 0) AS investimento
           FROM lancamentos l JOIN tipos_despesa t ON t.id = l.tipo_despesa_id
          WHERE ${where} AND l.competencia = ?
          GROUP BY t.id ORDER BY total DESC`,
      )
      .all(...params, mesRef) as Array<{ tipo: string; total: number; despesa: number; investimento: number }>
  ).map((l) => ({
    tipo: l.tipo,
    total: paraReais(l.total),
    despesa: paraReais(l.despesa),
    investimento: paraReais(l.investimento),
    participacao_pct: percentual(l.total, totalMes),
  }));

  // --- Composição por natureza (fixa vs pontual única vs parcelada)
  const porNatureza = (
    db()
      .prepare(
        `SELECT l.natureza, COALESCE(SUM(l.valor_centavos), 0) AS total, COUNT(*) AS qtd
           FROM lancamentos l WHERE ${where} AND l.competencia = ?
          GROUP BY l.natureza`,
      )
      .all(...params, mesRef) as Array<{ natureza: string; total: number; qtd: number }>
  ).map((l) => ({
    natureza: l.natureza,
    total: paraReais(l.total),
    quantidade: l.qtd,
    participacao_pct: percentual(l.total, totalMes),
  }));

  // --- Evolução mensal (série temporal)
  const linhasSerie = db()
    .prepare(
      `SELECT l.competencia,
              COALESCE(SUM(CASE WHEN l.classificacao = 'despesa' THEN l.valor_centavos ELSE 0 END), 0) AS despesa,
              COALESCE(SUM(CASE WHEN l.classificacao = 'investimento' THEN l.valor_centavos ELSE 0 END), 0) AS investimento
         FROM lancamentos l WHERE ${where} AND l.competencia BETWEEN ? AND ?
        GROUP BY l.competencia`,
    )
    .all(...params, inicioSerie, fimSerie) as Array<{ competencia: string; despesa: number; investimento: number }>;
  const mapaSerie = new Map(linhasSerie.map((l) => [l.competencia, l]));
  const evolucaoMensal = intervalo(inicioSerie, fimSerie).map((mes) => {
    const l = mapaSerie.get(mes);
    return {
      competencia: paraExibicao(mes),
      despesa: paraReais(l?.despesa ?? 0),
      investimento: paraReais(l?.investimento ?? 0),
      total: paraReais((l?.despesa ?? 0) + (l?.investimento ?? 0)),
    };
  });

  // --- Projeção dos próximos 12 meses (compromissos já lançados: parcelas e fixas)
  const inicioProj = somarMeses(mesRef, 1);
  const fimProj = somarMeses(mesRef, 12);
  const linhasProj = db()
    .prepare(
      `SELECT l.competencia,
              COALESCE(SUM(CASE WHEN l.natureza = 'pontual_parcelada' THEN l.valor_centavos ELSE 0 END), 0) AS parcelado,
              COALESCE(SUM(CASE WHEN l.natureza = 'fixa' THEN l.valor_centavos ELSE 0 END), 0) AS fixo,
              COALESCE(SUM(CASE WHEN l.natureza = 'pontual_unica' THEN l.valor_centavos ELSE 0 END), 0) AS pontual,
              COALESCE(SUM(l.valor_centavos), 0) AS total
         FROM lancamentos l WHERE ${where} AND l.competencia BETWEEN ? AND ?
        GROUP BY l.competencia`,
    )
    .all(...params, inicioProj, fimProj) as Array<{
    competencia: string;
    parcelado: number;
    fixo: number;
    pontual: number;
    total: number;
  }>;
  const mapaProj = new Map(linhasProj.map((l) => [l.competencia, l]));
  const projecao12Meses = intervalo(inicioProj, fimProj).map((mes) => {
    const l = mapaProj.get(mes);
    return {
      competencia: paraExibicao(mes),
      parcelado: paraReais(l?.parcelado ?? 0),
      fixo: paraReais(l?.fixo ?? 0),
      pontual: paraReais(l?.pontual ?? 0),
      total: paraReais(l?.total ?? 0),
    };
  });

  // --- Quebra por filial (visão consolidada da empresa)
  const porFilial = (
    db()
      .prepare(
        `SELECT COALESCE(f.nome, '(sem filial / empresa)') AS filial, l.filial_id,
                COALESCE(SUM(CASE WHEN l.classificacao = 'despesa' THEN l.valor_centavos ELSE 0 END), 0) AS despesa,
                COALESCE(SUM(CASE WHEN l.classificacao = 'investimento' THEN l.valor_centavos ELSE 0 END), 0) AS investimento,
                COALESCE(SUM(l.valor_centavos), 0) AS total
           FROM lancamentos l LEFT JOIN filiais f ON f.id = l.filial_id
          WHERE l.empresa_id = ? AND l.excluido_em IS NULL AND l.cenario = ? AND l.competencia = ?
          GROUP BY l.filial_id ORDER BY total DESC`,
      )
      .all(ctx.empresaId, cenario, mesRef) as Array<{
      filial: string;
      filial_id: number | null;
      despesa: number;
      investimento: number;
      total: number;
    }>
  ).map((l) => ({
    filial_id: l.filial_id,
    filial: l.filial,
    despesa: paraReais(l.despesa),
    investimento: paraReais(l.investimento),
    total: paraReais(l.total),
  }));

  return {
    escopo: {
      competencia: paraExibicao(mesRef),
      filial_id: escopo.filialId ?? null,
      consolidado: escopo.filialId === undefined,
      cenario,
      periodo_serie: { inicio: paraExibicao(inicioSerie), fim: paraExibicao(fimSerie) },
    },
    totais_mes: {
      despesa: paraReais(totaisMes.despesa),
      investimento: paraReais(totaisMes.investimento),
      total: paraReais(totalMes),
      lancamentos: totaisMes.lancamentos,
      variacao_mes_anterior_pct:
        totaisAnterior.total > 0
          ? Math.round(((totalMes - totaisAnterior.total) / totaisAnterior.total) * 1000) / 10
          : null,
      total_mes_anterior: paraReais(totaisAnterior.total),
    },
    por_tipo_despesa: porTipo,
    por_natureza: porNatureza,
    por_filial: porFilial,
    evolucao_mensal: evolucaoMensal,
    projecao_12_meses: projecao12Meses,
  };
}

// ==========================================================================
// Dashboard de Projetos
// ==========================================================================

interface LinhaProjetoGantt {
  id: number;
  nome: string;
  filial_id: number | null;
  filial_nome: string | null;
  mes_inicio: string;
  mes_fim_planejado: string;
  mes_fim_real: string | null;
  status: string;
}

export function dashboardProjetos(ctx: Contexto, escopo: EscopoDashboard = {}) {
  const condicoes = ['p.empresa_id = ?', 'p.excluido_em IS NULL'];
  const params: unknown[] = [ctx.empresaId];
  if (escopo.filialId === null) condicoes.push('p.filial_id IS NULL');
  else if (escopo.filialId !== undefined) {
    condicoes.push('p.filial_id = ?');
    params.push(escopo.filialId);
  }
  const where = condicoes.join(' AND ');

  const projetos = db()
    .prepare(
      `SELECT p.id, p.nome, p.filial_id, f.nome AS filial_nome, p.mes_inicio, p.mes_fim_planejado,
              p.mes_fim_real, p.status
         FROM projetos p LEFT JOIN filiais f ON f.id = p.filial_id
        WHERE ${where} ORDER BY p.mes_inicio, p.nome`,
    )
    .all(...params) as LinhaProjetoGantt[];

  const idsProjetos = projetos.map((p) => p.id);
  const tarefas =
    idsProjetos.length === 0
      ? []
      : (db()
          .prepare(
            `SELECT t.id, t.projeto_id, t.nome, t.mes_inicio, t.mes_fim_planejado, t.mes_fim_real, t.responsavel, t.status
               FROM tarefas t
              WHERE t.excluido_em IS NULL AND t.projeto_id IN (${idsProjetos.map(() => '?').join(',')})
              ORDER BY t.mes_inicio, t.id`,
          )
          .all(...idsProjetos) as Array<{
          id: number;
          projeto_id: number;
          nome: string;
          mes_inicio: string;
          mes_fim_planejado: string;
          mes_fim_real: string | null;
          responsavel: string | null;
          status: string;
        }>);

  const projetosComAtraso = projetos.map((p) => ({
    ...p,
    ...calcularAtraso(p.mes_fim_planejado, p.mes_fim_real, p.status),
  }));

  // --- Linha do tempo do Gantt (limites cobrindo todos os itens + mês corrente)
  const todosMeses = [
    competenciaAtual(),
    ...projetos.flatMap((p) => [p.mes_inicio, p.mes_fim_real ?? p.mes_fim_planejado]),
  ].sort();
  const inicioLinha = escopo.competenciaInicio ? paraInterno(escopo.competenciaInicio) : todosMeses[0] ?? competenciaAtual();
  const fimLinha =
    escopo.competenciaFim ? paraInterno(escopo.competenciaFim) : todosMeses[todosMeses.length - 1] ?? competenciaAtual();
  const linhaDoTempo = intervalo(inicioLinha, fimLinha).map(paraExibicao);

  const gantt = projetosComAtraso.map((p) => ({
    id: p.id,
    nome: p.nome,
    filial_id: p.filial_id,
    filial_nome: p.filial_nome,
    status: p.status,
    atrasado: p.atrasado,
    meses_atraso: p.meses_atraso,
    desvio_meses: p.desvio_meses,
    mes_inicio: paraExibicao(p.mes_inicio),
    mes_fim_planejado: paraExibicao(p.mes_fim_planejado),
    mes_fim_real: p.mes_fim_real ? paraExibicao(p.mes_fim_real) : null,
    offset_meses: Math.max(diferencaEmMeses(inicioLinha, p.mes_inicio), 0),
    duracao_meses: diferencaEmMeses(p.mes_inicio, p.mes_fim_planejado) + 1,
    duracao_real_meses: p.mes_fim_real ? diferencaEmMeses(p.mes_inicio, p.mes_fim_real) + 1 : null,
    tarefas: tarefas
      .filter((t) => t.projeto_id === p.id)
      .map((t) => ({
        id: t.id,
        nome: t.nome,
        responsavel: t.responsavel,
        status: t.status,
        mes_inicio: paraExibicao(t.mes_inicio),
        mes_fim_planejado: paraExibicao(t.mes_fim_planejado),
        mes_fim_real: t.mes_fim_real ? paraExibicao(t.mes_fim_real) : null,
        offset_meses: Math.max(diferencaEmMeses(inicioLinha, t.mes_inicio), 0),
        duracao_meses: diferencaEmMeses(t.mes_inicio, t.mes_fim_planejado) + 1,
        duracao_real_meses: t.mes_fim_real ? diferencaEmMeses(t.mes_inicio, t.mes_fim_real) + 1 : null,
        ...calcularAtraso(t.mes_fim_planejado, t.mes_fim_real, t.status),
      })),
  }));

  // --- Carga de trabalho por envolvido (tarefas atribuídas)
  const cargaPorEnvolvido = Object.values(
    tarefas.reduce<Record<string, { responsavel: string; total: number; concluidas: number; atrasadas: number; em_aberto: number }>>(
      (acc, t) => {
        const chave = t.responsavel?.trim() || '(não atribuído)';
        const registro = (acc[chave] ??= { responsavel: chave, total: 0, concluidas: 0, atrasadas: 0, em_aberto: 0 });
        registro.total += 1;
        if (t.mes_fim_real) registro.concluidas += 1;
        else registro.em_aberto += 1;
        if (calcularAtraso(t.mes_fim_planejado, t.mes_fim_real, t.status).atrasado) registro.atrasadas += 1;
        return acc;
      },
      {},
    ),
  ).sort((a, b) => b.total - a.total);

  // --- Desvio planejado x real (apenas projetos concluídos)
  const desvios = projetosComAtraso
    .filter((p) => p.mes_fim_real)
    .map((p) => ({
      id: p.id,
      nome: p.nome,
      mes_fim_planejado: paraExibicao(p.mes_fim_planejado),
      mes_fim_real: paraExibicao(p.mes_fim_real!),
      desvio_meses: p.desvio_meses,
    }))
    .sort((a, b) => b.desvio_meses - a.desvio_meses);

  const concluidos = projetosComAtraso.filter((p) => p.status === 'concluido');
  const desvioMedio =
    desvios.length > 0 ? Math.round((desvios.reduce((s, d) => s + d.desvio_meses, 0) / desvios.length) * 10) / 10 : 0;

  return {
    escopo: {
      filial_id: escopo.filialId ?? null,
      consolidado: escopo.filialId === undefined,
      linha_do_tempo: { inicio: paraExibicao(inicioLinha), fim: paraExibicao(fimLinha) },
    },
    indicadores: {
      total: projetosComAtraso.length,
      planejados: projetosComAtraso.filter((p) => p.status === 'planejado').length,
      em_andamento: projetosComAtraso.filter((p) => p.status === 'em_andamento').length,
      concluidos: concluidos.length,
      cancelados: projetosComAtraso.filter((p) => p.status === 'cancelado').length,
      atrasados: projetosComAtraso.filter((p) => p.atrasado).length,
      total_tarefas: tarefas.length,
      tarefas_atrasadas: tarefas.filter((t) => calcularAtraso(t.mes_fim_planejado, t.mes_fim_real, t.status).atrasado)
        .length,
      desvio_medio_meses: desvioMedio,
    },
    linha_do_tempo: linhaDoTempo,
    gantt,
    carga_por_envolvido: cargaPorEnvolvido,
    desvios,
  };
}

// ==========================================================================
// Dashboard de SLA
// ==========================================================================

function competenciaReferenciaSla(ctx: Contexto, escopo: EscopoDashboard): string {
  if (escopo.competencia) return paraInterno(escopo.competencia);
  const atual = competenciaAtual();
  const fechada = ultimaCompetenciaComDados('tickets_sla', ctx.empresaId, null, atual);
  if (fechada) return fechada;
  const qualquer = db()
    .prepare(
      `SELECT MAX(competencia) AS m FROM tickets_sla
        WHERE empresa_id = ? AND excluido_em IS NULL AND competencia <= ?`,
    )
    .get(ctx.empresaId, atual) as { m: string | null };
  return qualquer.m ?? atual;
}

export function dashboardSla(ctx: Contexto, escopo: EscopoDashboard = {}) {
  const mesRef = competenciaReferenciaSla(ctx, escopo);
  const inicioSerie = escopo.competenciaInicio ? paraInterno(escopo.competenciaInicio) : somarMeses(mesRef, -11);
  const fimSerie = escopo.competenciaFim ? paraInterno(escopo.competenciaFim) : mesRef;

  const filtroBase: FiltroSla = { filialId: escopo.filialId };
  const { where, params } = montarFiltroSla(ctx, filtroBase);

  const totais = db()
    .prepare(
      `SELECT COALESCE(SUM(s.total_atendidos), 0) AS total, COALESCE(SUM(s.dentro_sla), 0) AS dentro
         FROM tickets_sla s WHERE ${where} AND s.competencia = ?`,
    )
    .get(...params, mesRef) as { total: number; dentro: number };

  const porFila = (
    db()
      .prepare(
        `SELECT q.nome AS fila, COALESCE(SUM(s.total_atendidos), 0) AS total, COALESCE(SUM(s.dentro_sla), 0) AS dentro
           FROM tickets_sla s JOIN filas_ticket q ON q.id = s.fila_id
          WHERE ${where} AND s.competencia = ?
          GROUP BY q.id ORDER BY q.ordem, q.nome`,
      )
      .all(...params, mesRef) as Array<{ fila: string; total: number; dentro: number }>
  ).map((l) => ({
    fila: l.fila,
    total_atendidos: l.total,
    dentro_sla: l.dentro,
    fora_sla: l.total - l.dentro,
    pct_dentro_sla: percentual(l.dentro, l.total),
    pct_fora_sla: percentual(l.total - l.dentro, l.total),
  }));

  const porTopico = (
    db()
      .prepare(
        `SELECT COALESCE(ta.nome, '(sem tópico)') AS topico, COALESCE(SUM(s.total_atendidos), 0) AS total,
                COALESCE(SUM(s.dentro_sla), 0) AS dentro
           FROM tickets_sla s LEFT JOIN topicos_ajuda ta ON ta.id = s.topico_ajuda_id
          WHERE ${where} AND s.competencia = ?
          GROUP BY s.topico_ajuda_id ORDER BY total DESC`,
      )
      .all(...params, mesRef) as Array<{ topico: string; total: number; dentro: number }>
  ).map((l) => ({
    topico: l.topico,
    total_atendidos: l.total,
    dentro_sla: l.dentro,
    fora_sla: l.total - l.dentro,
    pct_dentro_sla: percentual(l.dentro, l.total),
    pct_fora_sla: percentual(l.total - l.dentro, l.total),
  }));

  const porFilial = (
    db()
      .prepare(
        `SELECT COALESCE(f.nome, '(sem filial / empresa)') AS filial, s.filial_id,
                COALESCE(SUM(s.total_atendidos), 0) AS total, COALESCE(SUM(s.dentro_sla), 0) AS dentro
           FROM tickets_sla s LEFT JOIN filiais f ON f.id = s.filial_id
          WHERE s.empresa_id = ? AND s.excluido_em IS NULL AND s.competencia = ?
          GROUP BY s.filial_id ORDER BY total DESC`,
      )
      .all(ctx.empresaId, mesRef) as Array<{ filial: string; filial_id: number | null; total: number; dentro: number }>
  ).map((l) => ({
    filial_id: l.filial_id,
    filial: l.filial,
    total_atendidos: l.total,
    dentro_sla: l.dentro,
    fora_sla: l.total - l.dentro,
    pct_dentro_sla: percentual(l.dentro, l.total),
  }));

  const linhasTend = db()
    .prepare(
      `SELECT s.competencia, COALESCE(SUM(s.total_atendidos), 0) AS total, COALESCE(SUM(s.dentro_sla), 0) AS dentro
         FROM tickets_sla s WHERE ${where} AND s.competencia BETWEEN ? AND ?
        GROUP BY s.competencia`,
    )
    .all(...params, inicioSerie, fimSerie) as Array<{ competencia: string; total: number; dentro: number }>;
  const mapaTend = new Map(linhasTend.map((l) => [l.competencia, l]));
  const tendenciaMensal = intervalo(inicioSerie, fimSerie).map((mes) => {
    const l = mapaTend.get(mes);
    const total = l?.total ?? 0;
    const dentro = l?.dentro ?? 0;
    return {
      competencia: paraExibicao(mes),
      total_atendidos: total,
      dentro_sla: dentro,
      fora_sla: total - dentro,
      pct_dentro_sla: percentual(dentro, total),
    };
  });

  return {
    escopo: {
      competencia: paraExibicao(mesRef),
      filial_id: escopo.filialId ?? null,
      consolidado: escopo.filialId === undefined,
      periodo_serie: { inicio: paraExibicao(inicioSerie), fim: paraExibicao(fimSerie) },
    },
    totais_mes: {
      total_atendidos: totais.total,
      dentro_sla: totais.dentro,
      fora_sla: totais.total - totais.dentro,
      pct_dentro_sla: percentual(totais.dentro, totais.total),
      pct_fora_sla: percentual(totais.total - totais.dentro, totais.total),
    },
    por_fila: porFila,
    por_topico: porTopico,
    por_filial: porFilial,
    tendencia_mensal: tendenciaMensal,
  };
}

// ==========================================================================
// Visão executiva consolidada
// ==========================================================================

export function visaoExecutiva(ctx: Contexto, escopo: EscopoDashboard = {}) {
  const financeiro = dashboardFinanceiro(ctx, escopo);
  const projetos = dashboardProjetos(ctx, escopo);
  const sla = dashboardSla(ctx, escopo);
  return {
    escopo: financeiro.escopo,
    financeiro: {
      total_mes: financeiro.totais_mes.total,
      despesa: financeiro.totais_mes.despesa,
      investimento: financeiro.totais_mes.investimento,
      variacao_mes_anterior_pct: financeiro.totais_mes.variacao_mes_anterior_pct,
      compromisso_proximos_12_meses: Math.round(
        financeiro.projecao_12_meses.reduce((s, m) => s + m.total, 0) * 100,
      ) / 100,
    },
    projetos: projetos.indicadores,
    sla: sla.totais_mes,
  };
}
