import { Router } from 'express';
import {
  atualizarTicketSla,
  excluirTicketSla,
  listarTicketsSla,
  obterTicketSla,
  registrarTicketSla,
} from '../domain/sla.js';
import { ctx, somenteGestor } from '../middleware/index.js';

export const rotasSla = Router();

rotasSla.get('/', (req, res) => {
  const q = req.query;
  res.json(
    listarTicketsSla(ctx(req), {
      filialId:
        q.filial_id === undefined || q.filial_id === ''
          ? undefined
          : q.filial_id === 'nenhuma' || q.filial_id === 'null'
            ? null
            : Number(q.filial_id),
      filaId: q.fila_id ? Number(q.fila_id) : undefined,
      topicoAjudaId: q.topico_ajuda_id ? Number(q.topico_ajuda_id) : undefined,
      competencia: q.competencia ? String(q.competencia) : undefined,
      competenciaInicio: q.competencia_inicio ? String(q.competencia_inicio) : undefined,
      competenciaFim: q.competencia_fim ? String(q.competencia_fim) : undefined,
    }),
  );
});

rotasSla.get('/:id', (req, res) => res.json(obterTicketSla(ctx(req), Number(req.params.id))));

rotasSla.post('/', somenteGestor, (req, res) => {
  const corpo = req.body ?? {};
  res.status(201).json(
    registrarTicketSla(ctx(req), {
      filialId: corpo.filial_id ?? null,
      competencia: String(corpo.competencia ?? ''),
      filaId: Number(corpo.fila_id),
      topicoAjudaId: corpo.topico_ajuda_id ?? null,
      totalAtendidos: Number(corpo.total_atendidos),
      dentroSla: Number(corpo.dentro_sla),
      foraSla: corpo.fora_sla === undefined || corpo.fora_sla === null ? null : Number(corpo.fora_sla),
      observacoes: corpo.observacoes ?? null,
    }),
  );
});

rotasSla.patch('/:id', somenteGestor, (req, res) => {
  const corpo = req.body ?? {};
  res.json(
    atualizarTicketSla(ctx(req), Number(req.params.id), {
      filialId: corpo.filial_id,
      competencia: corpo.competencia,
      filaId: corpo.fila_id !== undefined ? Number(corpo.fila_id) : undefined,
      topicoAjudaId: corpo.topico_ajuda_id,
      totalAtendidos: corpo.total_atendidos !== undefined ? Number(corpo.total_atendidos) : undefined,
      dentroSla: corpo.dentro_sla !== undefined ? Number(corpo.dentro_sla) : undefined,
      foraSla: corpo.fora_sla !== undefined ? Number(corpo.fora_sla) : undefined,
      observacoes: corpo.observacoes,
      justificativa: corpo.justificativa,
    }),
  );
});

rotasSla.delete('/:id', somenteGestor, (req, res) => {
  res.json(excluirTicketSla(ctx(req), Number(req.params.id), req.body?.justificativa));
});
