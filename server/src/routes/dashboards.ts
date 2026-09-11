import { Router } from 'express';
import {
  conferenciaOrigem,
  dashboardFinanceiro,
  dashboardProjetos,
  dashboardSla,
  visaoExecutiva,
} from '../domain/dashboards.js';
import { ctx } from '../middleware/index.js';
import { filiaisDaQuery, listaDaQuery } from '../lib/consulta.js';
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

rotasDashboards.get('/conferencia', (req, res) => {
  res.json(conferenciaOrigem(ctx(req), escopoDaQuery(req.query as Record<string, unknown>)));
});
