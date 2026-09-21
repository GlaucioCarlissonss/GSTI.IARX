/**
 * Aplicar o acordo de SLA ao que JÁ está gravado.
 *
 * O cadastro decide o prazo na entrada do chamado. Esta é a única porta pela
 * qual ele alcança o passado — e ela é um ato: tem prévia, conta o que muda,
 * recusa mês fechado e exige justificativa em mês que já passou.
 *
 * O que se prova aqui: a prévia não grava; aplicar move dentro/fora e o prazo;
 * o registro agregado e o chamado sem prioridade ficam de fora e são contados
 * à parte; a trilha recebe UMA linha com os números; e nada disso atravessa
 * para outra unidade.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, contextoDe } from './apoio.js';
import { criarEmpresa } from '../src/domain/empresas.js';
import { criarSla, previaReaplicacao, reaplicarAcordos } from '../src/domain/slas.js';
import { gravarChamado, listarChamados } from '../src/domain/suporte.js';
import { listarFilas } from '../src/domain/cadastros.js';
import { listarTicketsSla, registrarTicketSla } from '../src/domain/sla.js';
import { fecharCompetencia } from '../src/domain/fechamento.js';
import { listarAuditoria } from '../src/domain/auditoria.js';

const ABERTO = '2026-03-10T09:00:00Z';
const COMP = '03/2026';

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
    // Fechou três horas depois: dentro de um acordo de 24h, fora de um de 1h.
    closed_at: '2026-03-10T12:00:00Z',
    due_at: null,
    hours: null,
    ...extra,
  };
}

/** Um chamado já gravado SEM acordo nenhum: é a base que o cliente carregou. */
function baseSemAcordo() {
  const ambiente = ambienteLimpo();
  gravarChamado(ambiente.empresaId, chamado(), {});
  return ambiente;
}

const POR_QUE = 'Acordo assinado em março, aplicado ao mês inteiro';

test('a prévia conta o que mudaria e não grava nada', () => {
  const { ctx, empresaId } = baseSemAcordo();
  criarSla(ctx, { prioridade: 'high', horas: 1 });

  const previa = previaReaplicacao(ctx, COMP);
  assert.equal(previa.avaliados, 1);
  assert.equal(previa.alterados, 1);
  assert.equal(previa.virou_fora, 1);

  // Nada gravado: o chamado segue sem prazo, como estava.
  const [t] = listarChamados(ctx, {}).itens;
  assert.equal(t!.prazo_em, null);
  assert.equal(t!.dentro_sla, 1, 'fechado sem prazo continua contando dentro');
  void empresaId;
});

test('aplicar move o prazo e o dentro/fora do chamado', () => {
  const { ctx } = baseSemAcordo();
  criarSla(ctx, { prioridade: 'high', horas: 1 });

  const resumo = reaplicarAcordos(ctx, COMP, POR_QUE);
  assert.equal(resumo.alterados, 1);
  assert.equal(resumo.virou_fora, 1);

  const [t] = listarChamados(ctx, {}).itens;
  assert.equal(t!.prazo_em, '2026-03-10T10:00:00.000Z');
  assert.equal(t!.dentro_sla, 0);
  assert.equal(t!.prazo_do_acordo, 1, 'o prazo passou a ser nosso, e a ficha precisa saber disso');
});

test('aplicar duas vezes não muda nada na segunda', () => {
  const { ctx } = baseSemAcordo();
  criarSla(ctx, { prioridade: 'high', horas: 1 });
  reaplicarAcordos(ctx, COMP, POR_QUE);

  const segunda = reaplicarAcordos(ctx, COMP, POR_QUE);
  assert.equal(segunda.alterados, 0, 'o que já está no lugar não conta como alteração');
  assert.equal(segunda.avaliados, 1);
});

test('um acordo mais generoso traz o chamado de volta para dentro', () => {
  const { ctx } = baseSemAcordo();
  const apertado = criarSla(ctx, { prioridade: 'high', horas: 1, vigencia_fim: '09/03/2026' });
  criarSla(ctx, { prioridade: 'high', horas: 24, vigencia_inicio: '10/03/2026' });
  void apertado;

  const resumo = reaplicarAcordos(ctx, COMP, POR_QUE);
  assert.equal(resumo.virou_dentro, 0, 'já estava dentro; o que muda é só o prazo');
  const [t] = listarChamados(ctx, {}).itens;
  assert.equal(t!.prazo_em, '2026-03-11T09:00:00.000Z', 'valeu o acordo vigente na abertura');
  assert.equal(t!.dentro_sla, 1);
});

test('chamado sem prioridade é contado à parte e não é tocado', () => {
  const { ctx, empresaId } = ambienteLimpo();
  gravarChamado(empresaId, chamado({ priority: null }), {});
  criarSla(ctx, { prioridade: 'high', horas: 1 });

  const resumo = reaplicarAcordos(ctx, COMP, POR_QUE);
  assert.equal(resumo.avaliados, 1);
  assert.equal(resumo.sem_prioridade, 1);
  assert.equal(resumo.alterados, 0);
  assert.equal(listarChamados(ctx, {}).itens[0]!.prazo_em, null);
});

test('prioridade sem acordo vigente é contada à parte', () => {
  const { ctx } = baseSemAcordo();
  // O acordo existe, mas para outra prioridade: o chamado é Alta.
  criarSla(ctx, { prioridade: 'low', horas: 1 });

  const resumo = reaplicarAcordos(ctx, COMP, POR_QUE);
  assert.equal(resumo.sem_acordo, 1);
  assert.equal(resumo.alterados, 0);
});

test('o registro agregado do mês fica de fora da conta', () => {
  const { ctx } = baseSemAcordo();
  criarSla(ctx, { prioridade: 'high', horas: 1 });
  const fila = listarFilas(ctx)[0]!;
  // Um mês inteiro numa linha: 40 atendimentos, 30 dentro. Não tem abertura
  // nem prioridade — não há chamado individual para medir.
  registrarTicketSla(ctx, {
    competencia: COMP,
    filaId: fila.id,
    totalAtendidos: 40,
    dentroSla: 30,
  });

  const resumo = reaplicarAcordos(ctx, COMP, POR_QUE);
  assert.equal(resumo.agregados_ignorados, 1);
  assert.equal(resumo.avaliados, 1, 'só o chamado individual entra na conta');

  // O agregado não entra em `listarChamados` (que só lista o que veio de um
  // helpdesk), então a conferência é no registro de SLA mesmo.
  const agregado = listarTicketsSla(ctx, {}).itens.find((t) => t.total_atendidos === 40);
  assert.equal(agregado!.dentro_sla, 30, 'o agregado saiu intacto');
});

test('competência fechada é recusada', () => {
  const { ctx } = baseSemAcordo();
  criarSla(ctx, { prioridade: 'high', horas: 1 });
  fecharCompetencia(ctx, '2026-03', 'fechamento de março');

  assert.throws(() => reaplicarAcordos(ctx, COMP, POR_QUE), /fechada/i);
  assert.equal(listarChamados(ctx, {}).itens[0]!.prazo_em, null, 'nada foi gravado');
});

test('competência passada exige justificativa', () => {
  const { ctx } = baseSemAcordo();
  criarSla(ctx, { prioridade: 'high', horas: 1 });
  assert.throws(() => reaplicarAcordos(ctx, COMP), /justificativa/i);
});

test('a aplicação deixa UMA linha de trilha, com os números', () => {
  const { ctx } = baseSemAcordo();
  criarSla(ctx, { prioridade: 'high', horas: 1 });
  reaplicarAcordos(ctx, COMP, POR_QUE);

  const trilha = listarAuditoria(ctx, { entidade: 'sla' }).filter((a) => a.acao === 'reaplicar');
  assert.equal(trilha.length, 1, 'uma linha por execução, não uma por chamado');
  const depois = trilha[0]!.dados_depois as Record<string, unknown>;
  assert.equal(depois.alterados, 1);
  assert.equal(depois.virou_fora, 1);
  assert.equal(depois.competencia, COMP);
  assert.equal(trilha[0]!.justificativa, POR_QUE);
});

test('a reaplicação de uma unidade não alcança a outra', () => {
  const { ctx, empresaId } = baseSemAcordo();
  const outra = criarEmpresa(ctx.usuarioId, { nome: 'Outra contratante' });
  const deFora = contextoDe(ctx, outra.id);
  gravarChamado(outra.id, chamado({ external_id: 'T-9' }), {});
  criarSla(ctx, { prioridade: 'high', horas: 1 });

  reaplicarAcordos(ctx, COMP, POR_QUE);
  const daOutra = listarChamados(deFora, {}).itens.filter((t) => t.empresa_id === outra.id);
  assert.equal(daOutra[0]!.prazo_em, null, 'o acordo é da unidade, e a reaplicação também');
  void empresaId;
});
