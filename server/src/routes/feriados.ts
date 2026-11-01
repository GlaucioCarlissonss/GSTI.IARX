/**
 * Feriados do cliente — os dias em que o relógio do SLA não corre.
 *
 * O cadastro é do CLIENTE, não da unidade, e por isso as rotas não aceitam
 * recorte de empresa: um feriado da lista vale para o contratante inteiro.
 */
import { Router } from 'express';
import { ctx, exigir } from '../middleware/index.js';
import { erroValidacao } from '../lib/erros.js';
import {
  atualizarFeriado, criarFeriado, excluirFeriado, feriadosVigentes, horasUteis,
  listarFeriados, prazoEmHorasUteis,
} from '../domain/horas-uteis.js';

export const rotasFeriados = Router();

rotasFeriados.get('/', exigir('configuracoes', 'view'), (req, res) => {
  res.json(listarFeriados(ctx(req)));
});

rotasFeriados.post('/', exigir('configuracoes', 'create'), (req, res) => {
  const corpo = req.body as { data?: string; descricao?: string; ativo?: boolean };
  res.status(201).json(criarFeriado(ctx(req), { data: String(corpo.data ?? ''), descricao: corpo.descricao, ativo: corpo.ativo }));
});

rotasFeriados.patch('/:id', exigir('configuracoes', 'edit'), (req, res) => {
  res.json(atualizarFeriado(ctx(req), Number(req.params.id), req.body as Record<string, never>));
});

rotasFeriados.delete('/:id', exigir('configuracoes', 'delete'), (req, res) => {
  res.json(excluirFeriado(ctx(req), Number(req.params.id)));
});

/**
 * O relógio, aplicado: quantas horas úteis entre duas pontas, e quando vence
 * um prazo de N horas úteis.
 *
 * Existe como rota para a tela não precisar de uma segunda cópia do motor. É
 * leitura pura — não grava nada e não altera chamado nenhum.
 */
rotasFeriados.get('/relogio', exigir('suporte_ostick', 'view'), (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const inicio = String(q.inicio ?? '');
  if (!inicio) throw erroValidacao('Informe "inicio" como data e hora ISO.');
  const feriados = feriadosVigentes(ctx(req));
  const horas = q.horas === undefined ? null : Number(q.horas);
  if (horas !== null && !Number.isFinite(horas)) {
    throw erroValidacao('"horas" deve ser um número de horas úteis.');
  }
  res.json({
    inicio,
    fim: q.fim ?? null,
    feriados_considerados: feriados.size,
    consumo_horas_uteis: q.fim ? horasUteis(inicio, String(q.fim), feriados) : null,
    prazo: horas === null ? null : prazoEmHorasUteis(inicio, horas, feriados),
  });
});
