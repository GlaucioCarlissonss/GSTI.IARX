import { Router } from 'express';
import {
  conferenciaOrigem,
  dashboardFinanceiro,
  dashboardProjetos,
  dashboardSla,
  visaoExecutiva,
} from '../domain/dashboards.js';
import { ctx } from '../middleware/index.js';
import { lancamentosDoRelatorio, relatorioFinanceiro, type FiltroRelatorio } from '../domain/relatorio.js';
import { filiaisDaQuery, listaDaQuery, numerosDaQuery } from '../lib/consulta.js';
import type { EscopoDashboard } from '../domain/dashboards.js';

export const rotasDashboards = Router();

/** Filial, competência e cenário aceitam lista; ver `lib/consulta.ts`. */
function escopoDaQuery(query: Record<string, unknown>): EscopoDashboard {
  return {
    filiais: filiaisDaQuery(query.filial_id),
    competencias: listaDaQuery(query.competencia),
    competenciaInicio: query.competencia_inicio ? String(query.competencia_inicio) : undefined,
    competenciaFim: query.competencia_fim ? String(query.competencia_fim) : undefined,
    cenarios: listaDaQuery(query.cenario),
  };
}

/** O mesmo recorte alimenta o macro e o detalhe: se divergissem, os números não bateriam. */
function filtroDoRelatorio(q: Record<string, unknown>): FiltroRelatorio {
  return {
    competenciaInicio: q.competencia_inicio ? String(q.competencia_inicio) : undefined,
    competenciaFim: q.competencia_fim ? String(q.competencia_fim) : undefined,
    filiais: filiaisDaQuery(q.filial_id),
    cenarios: listaDaQuery(q.cenario),
    tiposDespesa: numerosDaQuery(q.tipo_despesa_id),
    origens: listaDaQuery(q.origem) as never,
    classificacoes: listaDaQuery(q.classificacao),
  };
}

rotasDashboards.get('/financeiro', (req, res) => {
  res.json(dashboardFinanceiro(ctx(req), escopoDaQuery(req.query as Record<string, unknown>)));
});

rotasDashboards.get('/projetos', (req, res) => {
  res.json(dashboardProjetos(ctx(req), escopoDaQuery(req.query as Record<string, unknown>)));
});

rotasDashboards.get('/sla', (req, res) => {
  res.json(dashboardSla(ctx(req), escopoDaQuery(req.query as Record<string, unknown>)));
});

rotasDashboards.get('/executivo', (req, res) => {
  res.json(visaoExecutiva(ctx(req), escopoDaQuery(req.query as Record<string, unknown>)));
});

/**
 * Relatório em tabela dinâmica: meses nas colunas, filial e tipo de despesa
 * nas linhas. É a visão macro — o detalhe vem por `/relatorio/lancamentos`.
 */
rotasDashboards.get('/relatorio', (req, res) => {
  res.json(relatorioFinanceiro(ctx(req), filtroDoRelatorio(req.query)));
});

/** Nível 3: os lançamentos de uma célula, sob demanda. */
rotasDashboards.get('/relatorio/lancamentos', (req, res) => {
  const q = req.query;
  res.json(
    lancamentosDoRelatorio(ctx(req), {
      ...filtroDoRelatorio(q),
      filialId:
        q.filial_id === undefined || q.filial_id === ''
          ? undefined
          : q.filial_id === 'nenhuma' || q.filial_id === 'null'
            ? null
            : Number(q.filial_id),
      tipoDespesaId: q.tipo_despesa_id ? Number(q.tipo_despesa_id) : undefined,
      competencia: q.competencia ? String(q.competencia) : undefined,
    }),
  );
});

rotasDashboards.get('/conferencia', (req, res) => {
  res.json(conferenciaOrigem(ctx(req), escopoDaQuery(req.query as Record<string, unknown>)));
});
