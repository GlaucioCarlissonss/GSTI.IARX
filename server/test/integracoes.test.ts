import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo } from './apoio.js';
import {
  autorizarRecebimento,
  concluirEvento,
  definirAtivo,
  enviarPayloadDeTeste,
  gerarSegredo,
  listarEventos,
  listarIntegracoes,
  processarEvento,
  regenerarSegredo,
  registrarEvento,
  reprocessarEvento,
} from '../src/domain/integracoes.js';
import { listarChamados } from '../src/domain/suporte.js';

test('cada cliente nasce com as duas conexões, desligadas do segredo', () => {
  const { ctx } = ambienteLimpo();
  const itens = listarIntegracoes(ctx).integracoes;
  assert.deepEqual(itens.map((i) => i.source_system), ['BITRIX24', 'OSTICK']);
  assert.equal(itens.every((i) => i.ativo), true);
  // Nenhuma nasce com segredo próprio: até girar, vale o da variável de ambiente.
  assert.equal(itens.every((i) => i.tem_segredo === false), true);
  assert.deepEqual(itens.map((i) => i.webhook_path).sort(), [
    '/api/webhooks/bitrix24/tickets',
    '/api/webhooks/ostick/tickets',
  ]);
});

test('o segredo aparece uma vez e depois só existe como hash', () => {
  const { ctx } = ambienteLimpo();
  const r = regenerarSegredo(ctx, 'OSTICK');
  assert.equal(typeof r.segredo, 'string');
  assert.ok(r.segredo.length >= 24);

  // A listagem nunca devolve o segredo nem o hash: só diz que existe.
  const config = listarIntegracoes(ctx).integracoes.find((i) => i.source_system === 'OSTICK');
  assert.equal(config?.tem_segredo, true);
  assert.equal('segredo' in (config as object), false);
  assert.equal('secret_hash' in (config as object), false);

  assert.deepEqual(autorizarRecebimento(ctx.clienteId!, 'OSTICK', r.segredo), { ok: true });
  const errado = autorizarRecebimento(ctx.clienteId!, 'OSTICK', r.segredo + 'x');
  assert.equal(errado.ok, false);
  assert.equal(errado.ok === false && errado.status, 401);
});

test('girar o segredo invalida o anterior na hora', () => {
  const { ctx } = ambienteLimpo();
  const antigo = regenerarSegredo(ctx, 'OSTICK').segredo;
  const novo = regenerarSegredo(ctx, 'OSTICK').segredo;
  assert.notEqual(antigo, novo);
  assert.equal(autorizarRecebimento(ctx.clienteId!, 'OSTICK', novo).ok, true);
  assert.equal(autorizarRecebimento(ctx.clienteId!, 'OSTICK', antigo).ok, false);
});

test('conexão desligada recusa com 403, e não com 401', () => {
  const { ctx } = ambienteLimpo();
  const segredo = regenerarSegredo(ctx, 'OSTICK').segredo;
  definirAtivo(ctx, 'OSTICK', false);
  const r = autorizarRecebimento(ctx.clienteId!, 'OSTICK', segredo);
  // 401 diria "seu segredo está errado", e mandaria o operador caçar o que não
  // está quebrado. 403 diz o que é: a conexão foi desligada de propósito.
  assert.equal(r.ok === false && r.status, 403);

  definirAtivo(ctx, 'OSTICK', true);
  assert.equal(autorizarRecebimento(ctx.clienteId!, 'OSTICK', segredo).ok, true);
});

test('sem segredo por empresa e sem variável de ambiente, responde 503', () => {
  const { ctx } = ambienteLimpo();
  const antes = process.env.WEBHOOK_SECRET;
  delete process.env.WEBHOOK_SECRET;
  try {
    const r = autorizarRecebimento(ctx.clienteId!, 'BITRIX24', 'qualquer-coisa');
    // Fechado, não aberto: um deploy que esqueceu a variável não pode virar
    // uma porta sem tranca.
    assert.equal(r.ok === false && r.status, 503);
  } finally {
    if (antes !== undefined) process.env.WEBHOOK_SECRET = antes;
  }
});

test('o payload de teste percorre o mesmo pipeline e vira chamado de verdade', () => {
  const { ctx } = ambienteLimpo();
  const r = enviarPayloadDeTeste(ctx, 'OSTICK');
  assert.ok(r.ticket_id > 0);

  const chamados = listarChamados(ctx, {}).itens as Array<Record<string, unknown>>;
  const doTeste = chamados.find((c) => c.external_id === r.external_id);
  assert.ok(doTeste, 'o chamado de teste tem de aparecer na listagem');
  assert.equal(doTeste?.source_system, 'OSTICK');

  // E fica marcado como teste no log, para dar para achá-lo depois.
  const evento = listarEventos(ctx).itens.find((e) => e.id === r.evento_id);
  assert.equal(evento?.teste, true);
  assert.equal(evento?.tipo, 'ticket.test');
  assert.equal(evento?.status, 'processed');
});

test('o log guarda o payload como chegou, e o erro fica legível', () => {
  const { ctx } = ambienteLimpo();
  // Sem `external_id` a normalização recusa: é o caso que o log existe para
  // mostrar, em vez de sumir num 422 que ninguém leu.
  const bruto = { subject: 'Sem identificador', status: 'open' };
  const eventoId = registrarEvento({
    empresaId: ctx.empresaId,
    sistema: 'OSTICK',
    externalId: null,
    tipo: 'ticket.created',
    payload: bruto,
  });
  const r = processarEvento(ctx.empresaId, 'OSTICK', bruto, eventoId);
  assert.equal(r.ok, false);

  const lista = listarEventos(ctx, { status: ['error'] });
  assert.equal(lista.itens.length, 1);
  assert.equal(lista.itens[0].status, 'error');
  assert.ok(lista.itens[0].erro && lista.itens[0].erro.length > 0);
  assert.deepEqual(lista.itens[0].payload, bruto);
  assert.equal(lista.resumo.error, 1);
});

test('evento com erro pode ser reprocessado a partir do payload guardado', () => {
  const { ctx } = ambienteLimpo();
  const bruto = { ticket_id: '9001', subject: 'Chegou torto', status: 'open', created: '2026-08-01T09:00:00Z' };

  // Falha de propósito: um payload que a normalização recusa.
  const ruim = { ...bruto, ticket_id: '' };
  const eventoId = registrarEvento({
    empresaId: ctx.empresaId, sistema: 'OSTICK', externalId: null, tipo: 'ticket.created', payload: ruim,
  });
  assert.equal(processarEvento(ctx.empresaId, 'OSTICK', ruim, eventoId).ok, false);
  assert.throws(() => reprocessarEvento(ctx, eventoId), /identificador|external/i);

  // Agora um que dá certo: reprocessar fecha o evento e cria o chamado.
  const bomId = registrarEvento({
    empresaId: ctx.empresaId, sistema: 'OSTICK', externalId: '9001', tipo: 'ticket.created', payload: bruto,
  });
  concluirEvento(bomId, { ok: false, erro: 'falha simulada de rede' });
  const refeito = reprocessarEvento(ctx, bomId);
  assert.ok(refeito.ticket_id > 0);

  const evento = listarEventos(ctx).itens.find((e) => e.id === bomId);
  assert.equal(evento?.status, 'processed');
  assert.equal(evento?.erro, null);
});

test('evento já processado não é reprocessado', () => {
  const { ctx } = ambienteLimpo();
  const r = enviarPayloadDeTeste(ctx, 'BITRIX24');
  // Refazer o que deu certo criaria escrita sem motivo e confundiria a
  // auditoria, que passaria a mostrar duas operações onde houve uma.
  assert.throws(() => reprocessarEvento(ctx, r.evento_id), /já foi processado/i);
});

test('o último evento e o último erro ficam na configuração da origem', () => {
  const { ctx } = ambienteLimpo();
  enviarPayloadDeTeste(ctx, 'OSTICK');
  const depoisDoSucesso = listarIntegracoes(ctx).integracoes.find((i) => i.source_system === 'OSTICK');
  assert.ok(depoisDoSucesso?.ultimo_evento_em);
  assert.equal(depoisDoSucesso?.ultimo_erro, null);

  const ruim = { subject: 'sem id' };
  const eventoId = registrarEvento({
    empresaId: ctx.empresaId, sistema: 'OSTICK', externalId: null, tipo: 'ticket.created', payload: ruim,
  });
  processarEvento(ctx.empresaId, 'OSTICK', ruim, eventoId);
  const depoisDoErro = listarIntegracoes(ctx).integracoes.find((i) => i.source_system === 'OSTICK');
  assert.ok(depoisDoErro?.ultimo_erro, 'o último erro precisa aparecer na tela sem abrir o log');
});

test('o log é por empresa', () => {
  const { ctx } = ambienteLimpo();
  enviarPayloadDeTeste(ctx, 'OSTICK');
  const outra = { ...ctx, empresaId: ctx.empresaId + 999, empresaIds: [ctx.empresaId + 999] };
  assert.equal(listarEventos(outra as typeof ctx).itens.length, 0);
});

test('o segredo gerado não se repete', () => {
  const vistos = new Set<string>();
  for (let i = 0; i < 50; i++) vistos.add(gerarSegredo());
  assert.equal(vistos.size, 50);
});
