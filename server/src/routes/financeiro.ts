import { Router } from 'express';
import {
  atualizarLancamento,
  criarCenario,
  criarLancamento,
  excluirLancamento,
  listarCenarios,
  listarCompetencias,
  listarLancamentos,
  listarSerie,
  obterLancamento,
  reclassificarLancamento,
} from '../domain/financeiro.js';
import { ctx, somenteGestor } from '../middleware/index.js';
import { filiaisDaQuery, listaDaQuery, numerosDaQuery } from '../lib/consulta.js';

export const rotasFinanceiro = Router();

/**
 * Cada filtro aceita lista: `natureza=fixa,pontual_unica`, o parâmetro
 * repetido, ou o valor único de sempre.
 */
function filtrosDaQuery(query: Record<string, unknown>) {
  return {
    filiais: filiaisDaQuery(query.filial_id),
    tiposDespesaId: numerosDaQuery(query.tipo_despesa_id),
    naturezas: listaDaQuery(query.natureza) as never,
    classificacoes: listaDaQuery(query.classificacao) as never,
    competencias: listaDaQuery(query.competencia),
    competenciaInicio: query.competencia_inicio ? String(query.competencia_inicio) : undefined,
    competenciaFim: query.competencia_fim ? String(query.competencia_fim) : undefined,
    busca: query.busca ? String(query.busca) : undefined,
    cenarios: listaDaQuery(query.cenario),
    limite: query.limite ? Number(query.limite) : undefined,
    offset: query.offset ? Number(query.offset) : undefined,
  };
}

rotasFinanceiro.get('/', (req, res) => {
  res.json(listarLancamentos(ctx(req), filtrosDaQuery(req.query as Record<string, unknown>)));
});

rotasFinanceiro.get('/:id', (req, res) => {
  res.json(obterLancamento(ctx(req), Number(req.params.id)));
});

rotasFinanceiro.get('/:id/serie', (req, res) => {
  res.json(listarSerie(ctx(req), Number(req.params.id)));
});

rotasFinanceiro.post('/', somenteGestor, (req, res) => {
  const corpo = req.body ?? {};
  res.status(201).json(
    criarLancamento(ctx(req), {
      filialId: corpo.filial_id ?? null,
      tipoDespesaId: Number(corpo.tipo_despesa_id),
      competencia: String(corpo.competencia ?? ''),
      valor: corpo.valor,
      natureza: corpo.natureza,
      classificacao: corpo.classificacao,
      qtdParcelas: corpo.qtd_parcelas ?? null,
      valorRefereSe: corpo.valor_refere_se,
      repetirAte: corpo.repetir_ate ?? null,
      descricao: corpo.descricao ?? null,
      observacoes: corpo.observacoes ?? null,
      origemCusto: corpo.origem_custo ?? null,
      destinoPagamento: corpo.destino_pagamento ?? null,
      documento: corpo.documento ?? null,
      cenario: corpo.cenario ?? null,
      justificativa: corpo.justificativa ?? null,
    }),
  );
});

rotasFinanceiro.get('/cenarios/lista', (req, res) => res.json(listarCenarios(ctx(req))));

rotasFinanceiro.get('/competencias/lista', (req, res) => {
  res.json(listarCompetencias(ctx(req), listaDaQuery((req.query as Record<string, unknown>).cenario)));
});

rotasFinanceiro.post('/cenarios', somenteGestor, (req, res) => {
  res.status(201).json(criarCenario(ctx(req), req.body ?? {}));
});

rotasFinanceiro.patch('/:id', somenteGestor, (req, res) => {
  const corpo = req.body ?? {};
  res.json(
    atualizarLancamento(ctx(req), Number(req.params.id), {
      filialId: corpo.filial_id,
      tipoDespesaId: corpo.tipo_despesa_id !== undefined ? Number(corpo.tipo_despesa_id) : undefined,
      competencia: corpo.competencia,
      valor: corpo.valor,
      classificacao: corpo.classificacao,
      descricao: corpo.descricao,
      observacoes: corpo.observacoes,
      // `undefined` mantém o valor atual; `null` limpa o campo.
      origemCusto: corpo.origem_custo,
      destinoPagamento: corpo.destino_pagamento,
      documento: corpo.documento,
      justificativa: corpo.justificativa ?? null,
    }),
  );
});

rotasFinanceiro.post('/:id/reclassificar', somenteGestor, (req, res) => {
  const corpo = req.body ?? {};
  res.json(
    reclassificarLancamento(ctx(req), Number(req.params.id), {
      classificacao: corpo.classificacao,
      justificativa: corpo.justificativa ?? null,
      aplicarParcelasFuturas: corpo.aplicar_parcelas_futuras,
    }),
  );
});

rotasFinanceiro.delete('/:id', somenteGestor, (req, res) => {
  const corpo = (req.body ?? {}) as { justificativa?: string; incluir_parcelas?: boolean };
  res.json(
    excluirLancamento(ctx(req), Number(req.params.id), {
      justificativa: corpo.justificativa ?? (req.query.justificativa as string | undefined) ?? null,
      incluirParcelas: corpo.incluir_parcelas,
    }),
  );
});
