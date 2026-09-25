/**
 * O histórico de reclassificação de prioridade.
 *
 * O que se prova aqui: a mudança vinda da origem deixa rastro (antes passava
 * em silêncio no upsert); a reclassificação manual exige quem pediu, com cargo
 * e nome; a prioridade vigente passa a valer para o SLA; e o prazo que o
 * helpdesk prometeu NÃO é reescrito por decisão interna.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, contextoDe } from './apoio.js';
import { criarEmpresa } from '../src/domain/empresas.js';
import { criarSla } from '../src/domain/slas.js';
import { gravarChamado, listarChamados, obterChamado } from '../src/domain/suporte.js';
import { listarReclassificacoes, reclassificarChamado } from '../src/domain/reclassificacao.js';
import { listarAuditoria } from '../src/domain/auditoria.js';

function chamado(extra: Record<string, unknown> = {}) {
  return {
    source_system: 'OSTICK' as const,
    external_id: 'T-1',
    title: 'Impressora parada',
    description: null,
    status: 'open',
    priority: 'low',
    sector: 'Enfermagem',
    branch: null,
    queue: 'Infraestrutura',
    topic: 'Rede',
    requester_id: null,
    requester_name: 'Maria',
    requester_email: null,
    attendant_id: null,
    attendant_name: null,
    opened_at: '2026-03-10T09:00:00Z',
    closed_at: null,
    due_at: null,
    hours: null,
    ...extra,
  };
}

const QUEM = 'Coordenador de Enfermagem — Maria Souza';

test('a mudança de prioridade vinda da origem deixa rastro', () => {
  const { ctx, empresaId } = ambienteLimpo();
  const { ticket_id } = gravarChamado(empresaId, chamado(), {});
  assert.equal(listarReclassificacoes(ctx, ticket_id).length, 0, 'o chamado novo não é uma reclassificação');

  gravarChamado(empresaId, chamado({ priority: 'high' }), {});
  const historico = listarReclassificacoes(ctx, ticket_id);
  assert.equal(historico.length, 1);
  assert.equal(historico[0]!.prioridade_anterior, 'low');
  assert.equal(historico[0]!.prioridade_nova, 'high');
  assert.equal(historico[0]!.origem, 'integracao');
  assert.equal(historico[0]!.solicitante, null, 'a origem não diz quem pediu — e não se inventa');
});

test('sincronizar sem mudar a prioridade não enche a ficha de linhas', () => {
  const { ctx, empresaId } = ambienteLimpo();
  const { ticket_id } = gravarChamado(empresaId, chamado(), {});
  gravarChamado(empresaId, chamado(), {});
  gravarChamado(empresaId, chamado(), {});
  assert.equal(listarReclassificacoes(ctx, ticket_id).length, 0);
});

test('a reclassificação manual registra cargo e nome de quem pediu', () => {
  const { ctx, empresaId } = ambienteLimpo();
  const { ticket_id } = gravarChamado(empresaId, chamado(), {});

  reclassificarChamado(ctx, ticket_id, {
    prioridade: 'high',
    motivo: 'Paciente aguardando laudo.',
    solicitante: QUEM,
  });

  const [registro] = listarReclassificacoes(ctx, ticket_id);
  assert.equal(registro!.prioridade_anterior_rotulo, 'Baixa');
  assert.equal(registro!.prioridade_nova_rotulo, 'Alta');
  assert.equal(registro!.solicitante, QUEM);
  assert.equal(registro!.motivo, 'Paciente aguardando laudo.');
  assert.equal(registro!.origem, 'manual');
  assert.ok(registro!.usuario_email, 'quem operou o sistema fica registrado junto de quem pediu');
});

test('sem dizer quem pediu, a reclassificação é recusada', () => {
  const { ctx, empresaId } = ambienteLimpo();
  const { ticket_id } = gravarChamado(empresaId, chamado(), {});
  assert.throws(
    () => reclassificarChamado(ctx, ticket_id, { prioridade: 'high', motivo: 'urgente' }),
    /cargo e nome/i,
  );
  assert.throws(
    () => reclassificarChamado(ctx, ticket_id, { prioridade: 'low', solicitante: QUEM }),
    /já está na prioridade/i,
  );
});

test('a prioridade vigente passa a valer para o cálculo do SLA', () => {
  const { ctx, empresaId } = ambienteLimpo();
  criarSla(ctx, { prioridade: 'low', horas: 48 });
  criarSla(ctx, { prioridade: 'high', horas: 2 });

  const { ticket_id } = gravarChamado(empresaId, chamado({ closed_at: '2026-03-10T15:00:00Z', status: 'closed' }), {});
  const antes = listarChamados(ctx, {}).itens[0]!;
  assert.equal(antes.prazo_em, '2026-03-12T09:00:00.000Z', '09:00 + 48h de Baixa');
  assert.equal(antes.dentro_sla, 1);

  // Elevado para Alta, o mesmo chamado passa a correr contra 2h — e fechou em 6h.
  reclassificarChamado(ctx, ticket_id, { prioridade: 'high', solicitante: QUEM });
  const depois = listarChamados(ctx, {}).itens[0]!;
  assert.equal(depois.prazo_em, '2026-03-10T11:00:00.000Z', '09:00 + 2h de Alta');
  assert.equal(depois.dentro_sla, 0, 'fechou 15:00, e o prazo passou a ser 11:00');
  assert.equal(depois.prioridade, 'high');
});

test('a reclassificação refaz o prazo pelo acordo, mesmo tendo vindo da origem', () => {
  const { ctx, empresaId } = ambienteLimpo();
  const { ticket_id } = gravarChamado(empresaId, chamado({ due_at: '2026-03-20T09:00:00Z' }), {});
  // O acordo nasce DEPOIS do chamado: na entrada, o prazo veio da origem.
  criarSla(ctx, { prioridade: 'urgent', horas: 1 });

  reclassificarChamado(ctx, ticket_id, { prioridade: 'urgent', solicitante: QUEM });
  const depois = listarChamados(ctx, {}).itens[0]!;
  // Elevar para Urgente sem encurtar o prazo seria elevação só no rótulo.
  assert.equal(depois.prazo_em, '2026-03-10T10:00:00.000Z', '09:00 + 1h de Urgente');
  assert.equal(depois.prazo_origem, '2026-03-20T09:00:00Z', 'a promessa da origem continua guardada');
});

test('sem acordo para a prioridade nova, o chamado volta ao prazo da origem', () => {
  const { ctx, empresaId } = ambienteLimpo();
  criarSla(ctx, { prioridade: 'high', horas: 1 });
  const { ticket_id } = gravarChamado(empresaId, chamado({ due_at: '2026-03-20T09:00:00Z' }), {});
  // Entrou como Alta e correu contra o acordo de 1h; passa a Urgente, que não
  // tem acordo. Manter o prazo do acordo ANTERIOR mediria a prioridade nova
  // pela regra da antiga.
  reclassificarChamado(ctx, ticket_id, { prioridade: 'urgent', solicitante: QUEM });
  const depois = listarChamados(ctx, {}).itens[0]!;
  assert.equal(depois.prazo_em, '2026-03-20T09:00:00Z');
  assert.equal(depois.prazo_do_acordo, 0);
});

test('sem acordo cadastrado, reclassificar muda a prioridade e não inventa prazo', () => {
  const { ctx, empresaId } = ambienteLimpo();
  const { ticket_id } = gravarChamado(empresaId, chamado(), {});
  reclassificarChamado(ctx, ticket_id, { prioridade: 'urgent', solicitante: QUEM });
  const depois = listarChamados(ctx, {}).itens[0]!;
  assert.equal(depois.prioridade, 'urgent');
  assert.equal(depois.prazo_em, null);
});

test('a reclassificação também entra na trilha administrativa', () => {
  const { ctx, empresaId } = ambienteLimpo();
  const { ticket_id } = gravarChamado(empresaId, chamado(), {});
  reclassificarChamado(ctx, ticket_id, { prioridade: 'high', solicitante: QUEM });
  const trilha = listarAuditoria(ctx, { entidade: 'ticket_sla' }).filter((a) => a.acao === 'reclassificar');
  assert.equal(trilha.length, 1);
});

test('o histórico de um chamado de outro cliente é recusado', () => {
  const { ctx, empresaId } = ambienteLimpo();
  const { ticket_id } = gravarChamado(empresaId, chamado(), {});
  const alheia = criarEmpresa(ctx.usuarioId, { nome: 'Outra contratante' });
  const deFora = contextoDe(ctx, alheia.id);

  assert.throws(() => listarReclassificacoes(deFora, ticket_id), /não encontrado/i);
  assert.throws(
    () => reclassificarChamado(deFora, ticket_id, { prioridade: 'high', solicitante: QUEM }),
    /não encontrado/i,
  );
});

test('a ficha do chamado devolve a prioridade, que antes não saía', () => {
  const { ctx, empresaId } = ambienteLimpo();
  const { ticket_id } = gravarChamado(empresaId, chamado({ priority: 'high' }), {});
  const ficha = obterChamado(ctx, ticket_id) as Record<string, unknown>;
  assert.equal(ficha.prioridade, 'high');
});
