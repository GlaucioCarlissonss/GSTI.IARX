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
  reconhecerLancamentos,
} from '../domain/financeiro.js';
import { ctx, exigir } from '../middleware/index.js';
import { filiaisDaQuery, listaDaQuery, numerosDaQuery } from '../lib/consulta.js';
import { empresasDoPedido } from '../domain/escopo.js';

export const rotasFinanceiro = Router();

/**
 * Cada filtro aceita lista: `natureza=fixa,pontual_unica`, o parâmetro
 * repetido, ou o valor único de sempre.
 */
function filtrosDaQuery(query: Record<string, unknown>) {
  return {
    // Filtro local de matriz: vazio é o cliente inteiro.
    empresas: empresasDoPedido(query),
    filiais: filiaisDaQuery(query.filial_id),
    tiposDespesaId: numerosDaQuery(query.tipo_despesa_id),
    naturezas: listaDaQuery(query.natureza) as never,
    classificacoes: listaDaQuery(query.classificacao) as never,
    competencias: listaDaQuery(query.competencia),
    competenciaInicio: query.competencia_inicio ? String(query.competencia_inicio) : undefined,
    competenciaFim: query.competencia_fim ? String(query.competencia_fim) : undefined,
    busca: query.busca ? String(query.busca) : undefined,
    cenarios: listaDaQuery(query.cenario),
    // Só 'true'/'false' explícitos recortam; ausente traz reconhecido e não
    // reconhecido, que é o total de verdade.
    reconhecido:
      query.reconhecido === undefined || query.reconhecido === ''
        ? undefined
        : String(query.reconhecido) === 'true',
    limite: query.limite ? Number(query.limite) : undefined,
    offset: query.offset ? Number(query.offset) : undefined,
  };
}

/**
 * Reconhecimento em lote. Vem ANTES de `/:id` de propósito: `/:id` casaria com
 * o literal `reconhecer` e engoliria esta rota — já aconteceu duas vezes neste
 * repositório, com `/tarefas` e com `/exportacao.xlsx`.
 */
rotasFinanceiro.post('/reconhecer', exigir('financeiro', 'edit'), (req, res) => {
  const corpo = req.body ?? {};
  const ids = Array.isArray(corpo.ids) ? corpo.ids.map(Number) : [];
  res.json(
    reconhecerLancamentos(ctx(req), ids, corpo.reconhecido !== false, corpo.justificativa ?? undefined),
  );
});

rotasFinanceiro.get('/', (req, res) => {
  res.json(listarLancamentos(ctx(req), filtrosDaQuery(req.query as Record<string, unknown>)));
});

rotasFinanceiro.get('/:id', (req, res) => {
  res.json(obterLancamento(ctx(req), Number(req.params.id)));
});

rotasFinanceiro.get('/:id/serie', (req, res) => {
  res.json(listarSerie(ctx(req), Number(req.params.id)));
});

/**
 * As filiais beneficiadas como a tela as manda.
 *
 * `'todas'` atravessa como intenção — o domínio é que a expande, na gravação,
 * para a lista congelada. `undefined` mantém o que está gravado (é o contrato
 * do PATCH); `null` e lista vazia limpam.
 */
function beneficiadasDoCorpo(valor: unknown): number[] | 'todas' | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (valor === 'todas') return 'todas';
  if (Array.isArray(valor)) return valor.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return undefined;
}

rotasFinanceiro.post('/', exigir('financeiro', 'create'), (req, res) => {
  const corpo = req.body ?? {};
  res.status(201).json(
    criarLancamento(ctx(req), {
      // A matriz vem do formulário: criar não depende do filtro da tela.
      empresaId: corpo.empresa_id === undefined || corpo.empresa_id === '' ? undefined : Number(corpo.empresa_id),
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
      fornecedor: corpo.fornecedor ?? null,
      documento: corpo.documento ?? null,
      tipoConsumo: corpo.tipo_consumo ?? null,
      beneficiadas: beneficiadasDoCorpo(corpo.filiais_beneficiadas) ?? null,
      cenario: corpo.cenario ?? null,
      justificativa: corpo.justificativa ?? null,
    }),
  );
});

rotasFinanceiro.get('/cenarios/lista', (req, res) =>
  res.json(listarCenarios(ctx(req), empresasDoPedido(req.query as Record<string, unknown>))),
);

rotasFinanceiro.get('/competencias/lista', (req, res) => {
  const query = req.query as Record<string, unknown>;
  res.json(listarCompetencias(ctx(req), listaDaQuery(query.cenario), empresasDoPedido(query)));
});

rotasFinanceiro.post('/cenarios', exigir('financeiro', 'create'), (req, res) => {
  res.status(201).json(criarCenario(ctx(req), req.body ?? {}));
});

rotasFinanceiro.patch('/:id', exigir('financeiro', 'edit'), (req, res) => {
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
      fornecedor: corpo.fornecedor,
      documento: corpo.documento,
      tipoConsumo: corpo.tipo_consumo,
      beneficiadas: beneficiadasDoCorpo(corpo.filiais_beneficiadas),
      justificativa: corpo.justificativa ?? null,
    }),
  );
});

rotasFinanceiro.post('/:id/reclassificar', exigir('financeiro', 'edit'), (req, res) => {
  const corpo = req.body ?? {};
  res.json(
    reclassificarLancamento(ctx(req), Number(req.params.id), {
      classificacao: corpo.classificacao,
      justificativa: corpo.justificativa ?? null,
      aplicarParcelasFuturas: corpo.aplicar_parcelas_futuras,
    }),
  );
});

rotasFinanceiro.delete('/:id', exigir('financeiro', 'delete'), (req, res) => {
  const corpo = (req.body ?? {}) as { justificativa?: string; incluir_parcelas?: boolean };
  res.json(
    excluirLancamento(ctx(req), Number(req.params.id), {
      justificativa: corpo.justificativa ?? (req.query.justificativa as string | undefined) ?? null,
      incluirParcelas: corpo.incluir_parcelas,
    }),
  );
});
