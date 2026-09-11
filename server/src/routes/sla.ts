import { Router } from 'express';
import {
  atualizarTicketSla,
  excluirTicketSla,
  listarTicketsSla,
  obterTicketSla,
  lerConfiguracao,
  registrarTicketSla,
  gravarUrlHelpdesk,
} from '../domain/sla.js';
import { ctx, somenteGestor } from '../middleware/index.js';

export const rotasSla = Router();

/** Detalhe do chamado no corpo da requisição, só com o que veio preenchido. */
function detalheDoChamado(corpo: Record<string, unknown>) {
  const mapa: Array<[string, string]> = [
    ['ticket_id', 'ticketId'], ['numero', 'numero'], ['assunto', 'assunto'],
    ['solicitante', 'solicitante'], ['responsavel', 'responsavel'], ['nivel', 'nivel'],
    ['status', 'status'], ['origem_chamado', 'origemChamado'], ['aberto_em', 'abertoEm'],
    ['fechado_em', 'fechadoEm'], ['prazo_em', 'prazoEm'], ['horas', 'horas'],
  ];
  const saida: Record<string, unknown> = {};
  for (const [deFora, interno] of mapa) {
    if (corpo[deFora] !== undefined) saida[interno] = corpo[deFora];
  }
  return saida;
}

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

// Precisa vir antes de `/:id`, senão "configuracao" seria lido como um id.
rotasSla.get('/configuracao', (req, res) => res.json(lerConfiguracao(ctx(req))));

rotasSla.put('/configuracao', somenteGestor, (req, res) => {
  res.json(gravarUrlHelpdesk(ctx(req), req.body?.url_helpdesk ?? null));
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
      ...detalheDoChamado(corpo),
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
      ...detalheDoChamado(corpo),
      justificativa: corpo.justificativa,
    }),
  );
});

rotasSla.delete('/:id', somenteGestor, (req, res) => {
  res.json(excluirTicketSla(ctx(req), Number(req.params.id), req.body?.justificativa));
});
