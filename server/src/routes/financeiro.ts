import { Router } from 'express';
import {
  atualizarLancamento,
  criarCenario,
  criarLancamento,
  excluirLancamento,
  listarCenarios,
  listarLancamentos,
  listarSerie,
  obterLancamento,
  reclassificarLancamento,
} from '../domain/financeiro.js';
import { ctx, somenteGestor } from '../middleware/index.js';

export const rotasFinanceiro = Router();

function filtrosDaQuery(query: Record<string, unknown>) {
  const filialBruta = query.filial_id;
  return {
    filialId:
      filialBruta === undefined || filialBruta === ''
        ? undefined
        : filialBruta === 'nenhuma' || filialBruta === 'null'
          ? null
          : Number(filialBruta),
    tipoDespesaId: query.tipo_despesa_id ? Number(query.tipo_despesa_id) : undefined,
    natureza: query.natureza ? (String(query.natureza) as never) : undefined,
    classificacao: query.classificacao ? (String(query.classificacao) as never) : undefined,
    competencia: query.competencia ? String(query.competencia) : undefined,
    competenciaInicio: query.competencia_inicio ? String(query.competencia_inicio) : undefined,
    competenciaFim: query.competencia_fim ? String(query.competencia_fim) : undefined,
    busca: query.busca ? String(query.busca) : undefined,
    cenario: query.cenario ? String(query.cenario) : undefined,
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
      cenario: corpo.cenario ?? null,
      justificativa: corpo.justificativa ?? null,
    }),
  );
});

rotasFinanceiro.get('/cenarios/lista', (req, res) => res.json(listarCenarios(ctx(req))));

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
