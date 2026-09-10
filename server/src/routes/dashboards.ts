import { Router } from 'express';
import { dashboardFinanceiro, dashboardProjetos, dashboardSla, visaoExecutiva } from '../domain/dashboards.js';
import { ctx } from '../middleware/index.js';
import type { EscopoDashboard } from '../domain/dashboards.js';

export const rotasDashboards = Router();

function escopoDaQuery(query: Record<string, unknown>): EscopoDashboard {
  const filial = query.filial_id;
  return {
    filialId:
      filial === undefined || filial === ''
        ? undefined
        : filial === 'nenhuma' || filial === 'null'
          ? null
          : Number(filial),
    competencia: query.competencia ? String(query.competencia) : undefined,
    competenciaInicio: query.competencia_inicio ? String(query.competencia_inicio) : undefined,
    competenciaFim: query.competencia_fim ? String(query.competencia_fim) : undefined,
    cenario: query.cenario ? String(query.cenario) : undefined,
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
