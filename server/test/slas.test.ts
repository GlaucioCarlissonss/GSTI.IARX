/**
 * O cadastro de acordos de SLA e o prazo que ele passa a decidir.
 *
 * O que se prova aqui: sem cadastro, o cálculo é exatamente o de antes (é o
 * estado de toda instalação existente); com cadastro, o prazo do chamado
 * passa a sair de abertura + horas; o acordo cadastrado GANHA do prazo que a
 * origem manda, sem apagá-lo; a vigência é escolhida pela abertura do
 * chamado; e o acordo de uma unidade não atravessa para outra.
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

test('o acordo cadastrado ganha do prazo que a origem manda', () => {
  const { ctx, empresaId } = ambienteLimpo();
  criarSla(ctx, { prioridade: 'high', horas: 1 });

  // O helpdesk prometeu 23:00; o acordo negociado diz 10:00. O chamado fechou
  // às 12:00 — dentro pela conta do helpdesk, fora pelo acordo. Quem manda é
  // o acordo, que é o compromisso que o grupo assinou.
  gravarChamado(empresaId, chamado({ due_at: '2026-03-10T23:00:00Z' }), {});
  const [t] = listarChamados(ctx, {}).itens;
  assert.equal(t!.prazo_em, '2026-03-10T10:00:00.000Z');
  assert.equal(t!.dentro_sla, 0, 'três horas para um acordo de uma hora é fora');
});

test('o prazo que a origem prometeu fica guardado, mesmo perdendo do acordo', () => {
  const { ctx, empresaId } = ambienteLimpo();
  criarSla(ctx, { prioridade: 'high', horas: 1 });
  gravarChamado(empresaId, chamado({ due_at: '2026-03-10T23:00:00Z' }), {});

  const [t] = listarChamados(ctx, {}).itens;
  // Sem isto, quem contesta o "fora do SLA" não teria contra o que comparar:
  // a promessa que o solicitante viu ao abrir o chamado desapareceria.
  assert.equal(t!.prazo_origem, '2026-03-10T23:00:00Z');
  assert.equal(t!.prazo_do_acordo, 1);
});

test('sem acordo vigente, o prazo da origem segue valendo', () => {
  const { ctx, empresaId } = ambienteLimpo();
  gravarChamado(empresaId, chamado({ due_at: '2026-03-10T23:00:00Z' }), {});
  const [t] = listarChamados(ctx, {}).itens;
  assert.equal(t!.prazo_em, '2026-03-10T23:00:00Z');
  assert.equal(t!.prazo_do_acordo, 0, 'quem não cadastrou acordo não vê nada mudar');
});

// ---------------------------------------------------------------- vigência

test('acordo fora de vigência não alcança o chamado', () => {
  const { ctx, empresaId } = ambienteLimpo();
  // Passou a valer DEPOIS da abertura (10/03): não pode julgá-la.
  criarSla(ctx, { prioridade: 'high', horas: 1, vigencia_inicio: '01/04/2026' });
  assert.equal(horasDoAcordo(empresaId, 'high', null, ABERTO), null);
  gravarChamado(empresaId, chamado(), {});
  const [t] = listarChamados(ctx, {}).itens;
  assert.equal(t!.prazo_em, null);
});

test('quem decide qual acordo vale é a abertura do chamado', () => {
  const { ctx, empresaId } = ambienteLimpo();
  criarSla(ctx, { prioridade: 'high', horas: 24, vigencia_fim: '28/02/2026' });
  criarSla(ctx, { prioridade: 'high', horas: 2, vigencia_inicio: '01/03/2026' });

  assert.equal(horasDoAcordo(empresaId, 'high', null, '2026-02-10T09:00:00Z'), 24);
  assert.equal(horasDoAcordo(empresaId, 'high', null, ABERTO), 2, 'em março vale o acordo novo');
  // O chamado de fevereiro continua medido pelo compromisso de fevereiro: é
  // isso que impede um cadastro de hoje de rejulgar o mês passado.
  assert.equal(prazoDoAcordo(empresaId, '2026-02-10T09:00:00Z', 'high', null), '2026-02-11T09:00:00.000Z');
});

test('dois acordos no mesmo período são recusados, em períodos diferentes não', () => {
  const { ctx } = ambienteLimpo();
  criarSla(ctx, { prioridade: 'high', horas: 24, vigencia_fim: '28/02/2026' });
  // Não sobrepõe: começa depois que o outro terminou.
  criarSla(ctx, { prioridade: 'high', horas: 2, vigencia_inicio: '01/03/2026' });
  assert.equal(listarSlas(ctx).length, 2);
  // Sobrepõe fevereiro: dois prazos para o mesmo chamado, e é isso que a
  // trava impede.
  assert.throws(
    () => criarSla(ctx, { prioridade: 'high', horas: 8, vigencia_inicio: '15/02/2026' }),
    /mesmo período/i,
  );
});

test('vigência invertida e data que não existe são recusadas', () => {
  const { ctx } = ambienteLimpo();
  assert.throws(
    () => criarSla(ctx, { prioridade: 'high', horas: 4, vigencia_inicio: '01/05/2026', vigencia_fim: '01/04/2026' }),
    /termina antes de começar/i,
  );
  assert.throws(
    () => criarSla(ctx, { prioridade: 'high', horas: 4, vigencia_inicio: '31/02/2026' }),
    /não existe/i,
  );
});

test('encerrar a vigência de um acordo abre espaço para o seguinte', () => {
  const { ctx, empresaId } = ambienteLimpo();
  const antigo = criarSla(ctx, { prioridade: 'high', horas: 24 });
  assert.throws(() => criarSla(ctx, { prioridade: 'high', horas: 2 }), /mesmo período/i);

  atualizarSla(ctx, antigo.id, { vigencia_fim: '28/02/2026' });
  const novo = criarSla(ctx, { prioridade: 'high', horas: 2, vigencia_inicio: '01/03/2026' });
  assert.equal(novo.vigencia_inicio, '2026-03-01');
  assert.equal(horasDoAcordo(empresaId, 'high', null, ABERTO), 2);
});

test('o acordo do tópico ganha do acordo geral', () => {
  const { ctx, empresaId } = ambienteLimpo();
  const rede = criarTopicoAjuda(ctx, 'Rede');
  criarSla(ctx, { prioridade: 'high', horas: 24 });
  criarSla(ctx, { prioridade: 'high', horas: 4, topico_ajuda_id: rede.id });

  assert.equal(horasDoAcordo(empresaId, 'high', rede.id, ABERTO), 4, 'rede é mais exigente que o geral');
  assert.equal(horasDoAcordo(empresaId, 'high', null, ABERTO), 24, 'o tópico sem regra própria cai no geral');
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
