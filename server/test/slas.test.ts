/**
 * O cadastro de acordos de SLA e o prazo que ele passa a decidir.
 *
 * O que se prova aqui: sem cadastro, o cálculo é exatamente o de antes (é o
 * estado de toda instalação existente); com cadastro, o prazo do chamado
 * passa a sair de abertura + horas; o prazo que a ORIGEM manda continua tendo
 * a palavra final; e o acordo de uma unidade não atravessa para outra.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, contextoDe } from './apoio.js';
import { criarEmpresa } from '../src/domain/empresas.js';
import { criarTopicoAjuda } from '../src/domain/cadastros.js';
import { atualizarSla, criarSla, horasDoAcordo, listarSlas, prazoDoAcordo } from '../src/domain/slas.js';
import { gravarChamado, listarChamados } from '../src/domain/suporte.js';
import { listarAuditoria } from '../src/domain/auditoria.js';

const ABERTO = '2026-03-10T09:00:00Z';

function chamado(extra: Record<string, unknown> = {}) {
  return {
    source_system: 'OSTICK' as const,
    external_id: 'T-1',
    title: 'Impressora parada',
    description: null,
    status: 'closed',
    priority: 'high',
    sector: 'Enfermagem',
    branch: null,
    queue: 'Infraestrutura',
    topic: 'Rede',
    requester_id: null,
    requester_name: 'Maria',
    requester_email: null,
    attendant_id: null,
    attendant_name: null,
    opened_at: ABERTO,
    closed_at: '2026-03-10T12:00:00Z',
    due_at: null,
    hours: null,
    ...extra,
  };
}

test('sem acordo cadastrado, o cálculo é o mesmo de antes', () => {
  const { ctx, empresaId } = ambienteLimpo();
  assert.equal(listarSlas(ctx).length, 0);
  assert.equal(horasDoAcordo(empresaId, 'high', null), null);

  // Fechado sem prazo informado conta como dentro — a regra anterior ao cadastro.
  gravarChamado(empresaId, chamado(), {});
  const [t] = listarChamados(ctx, {}).itens;
  assert.equal(t!.dentro_sla, 1);
  assert.equal(t!.prazo_em, null, 'sem acordo, não se inventa prazo');
});

test('com acordo, o prazo sai de abertura + horas', () => {
  const { ctx, empresaId } = ambienteLimpo();
  criarSla(ctx, { prioridade: 'high', horas: 4 });

  gravarChamado(empresaId, chamado(), {});
  const [t] = listarChamados(ctx, {}).itens;
  assert.equal(t!.prazo_em, '2026-03-10T13:00:00.000Z', '09:00 + 4h');
  assert.equal(t!.dentro_sla, 1, 'fechou 12:00, dentro das 13:00');
});

test('fechar depois do prazo do acordo cai para fora do SLA', () => {
  const { ctx, empresaId } = ambienteLimpo();
  criarSla(ctx, { prioridade: 'high', horas: 1 });

  gravarChamado(empresaId, chamado(), {});
  const [t] = listarChamados(ctx, {}).itens;
  assert.equal(t!.dentro_sla, 0, 'fechou 12:00, e o prazo era 10:00');
  assert.equal(t!.fora_sla, 1);
});

test('o prazo que a origem manda continua tendo a palavra final', () => {
  const { ctx, empresaId } = ambienteLimpo();
  criarSla(ctx, { prioridade: 'high', horas: 1 });

  // O helpdesk prometeu 23:00 ao solicitante; a regra interna diria 10:00.
  // Sobrescrever faria o sistema discordar da tela que a pessoa viu.
  gravarChamado(empresaId, chamado({ due_at: '2026-03-10T23:00:00Z' }), {});
  const [t] = listarChamados(ctx, {}).itens;
  assert.equal(t!.prazo_em, '2026-03-10T23:00:00Z');
  assert.equal(t!.dentro_sla, 1);
});

test('o acordo do tópico ganha do acordo geral', () => {
  const { ctx, empresaId } = ambienteLimpo();
  const rede = criarTopicoAjuda(ctx, 'Rede');
  criarSla(ctx, { prioridade: 'high', horas: 24 });
  criarSla(ctx, { prioridade: 'high', horas: 4, topico_ajuda_id: rede.id });

  assert.equal(horasDoAcordo(empresaId, 'high', rede.id), 4, 'rede é mais exigente que o geral');
  assert.equal(horasDoAcordo(empresaId, 'high', null), 24, 'o tópico sem regra própria cai no geral');
});

test('a regra geral cobre o tópico que a integração criou sozinha', () => {
  const { ctx, empresaId } = ambienteLimpo();
  criarSla(ctx, { prioridade: 'high', horas: 2 });

  // 'Rede' não existe no cadastro: a integração o cria ao gravar o chamado.
  gravarChamado(empresaId, chamado(), {});
  const [t] = listarChamados(ctx, {}).itens;
  assert.equal(t!.prazo_em, '2026-03-10T11:00:00.000Z', 'o acordo geral alcançou o tópico novo');
});

test('desativar o acordo devolve o cálculo ao que era', () => {
  const { ctx, empresaId } = ambienteLimpo();
  const sla = criarSla(ctx, { prioridade: 'high', horas: 1 });
  assert.equal(horasDoAcordo(empresaId, 'high', null), 1);
  atualizarSla(ctx, sla.id, { ativo: false });
  assert.equal(horasDoAcordo(empresaId, 'high', null), null);
  assert.equal(prazoDoAcordo(empresaId, ABERTO, 'high', null), null);
});

test('acordo repetido na mesma prioridade é recusado', () => {
  const { ctx } = ambienteLimpo();
  criarSla(ctx, { prioridade: 'high', horas: 4 });
  assert.throws(() => criarSla(ctx, { prioridade: 'high', horas: 8 }), /regra geral/i);
  // Dois NULL são distintos num UNIQUE do SQLite: a conferência tem de ser do
  // domínio, e é ela que este caso protege.
  assert.equal(listarSlas(ctx).length, 1);
});

test('horas inválidas e prioridade desconhecida são recusadas', () => {
  const { ctx } = ambienteLimpo();
  assert.throws(() => criarSla(ctx, { prioridade: 'high', horas: 0 }), /maior que zero/i);
  assert.throws(() => criarSla(ctx, { prioridade: 'high', horas: 'muitas' }), /número/i);
  assert.throws(() => criarSla(ctx, { prioridade: 'urgentíssima', horas: 4 }), /Prioridade/i);
  // O rótulo em português também entra: é o que a tela mostra.
  assert.equal(criarSla(ctx, { prioridade: 'Alta', horas: 4 }).prioridade, 'high');
});

test('o acordo de uma unidade não atravessa para outra', () => {
  const { ctx } = ambienteLimpo();
  criarSla(ctx, { prioridade: 'high', horas: 4 });
  const outra = criarEmpresa(ctx.usuarioId, { nome: 'Outra contratante' });
  const deFora = contextoDe(ctx, outra.id);
  assert.equal(listarSlas(deFora).length, 0);
  assert.equal(horasDoAcordo(outra.id, 'high', null), null);
});

test('tópico de outra unidade é recusado no acordo', () => {
  const { ctx } = ambienteLimpo();
  const outra = criarEmpresa(ctx.usuarioId, { nome: 'Outra contratante' });
  const alheio = criarTopicoAjuda(contextoDe(ctx, outra.id), 'Rede de fora');
  assert.throws(() => criarSla(ctx, { prioridade: 'high', horas: 4, topico_ajuda_id: alheio.id }), /não pertence/i);
});

test('cadastrar e alterar um acordo deixa trilha', () => {
  const { ctx } = ambienteLimpo();
  const sla = criarSla(ctx, { prioridade: 'high', horas: 4 });
  atualizarSla(ctx, sla.id, { horas: 8 });
  const trilha = listarAuditoria(ctx, { entidade: 'sla' });
  assert.equal(trilha.length, 2);
});
