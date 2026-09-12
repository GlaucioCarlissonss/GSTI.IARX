import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, idTipoDespesa, mesRelativo } from './apoio.js';
import {
  adicionarEnvolvido,
  atualizarProjeto,
  calcularAtraso,
  atualizarTarefa,
  criarProjeto,
  criarTarefa,
  excluirTarefa,
  listarProjetos,
  listarTarefas,
} from '../src/domain/projetos.js';
import {
  atualizarTicketSla,
  buscarPorTicketId,
  listarTicketsSla,
  percentual,
  registrarTicketSla,
} from '../src/domain/sla.js';
import { exportarXlsx } from '../src/domain/exportacao.js';
import { importarPlanilha } from '../src/domain/importacao.js';
import { listarFilas, criarTopicoAjuda, criarFilial } from '../src/domain/cadastros.js';
import { criarEmpresa } from '../src/domain/empresas.js';
import { dashboardFinanceiro, dashboardProjetos, dashboardSla } from '../src/domain/dashboards.js';
import { criarLancamento } from '../src/domain/financeiro.js';

import type { Contexto } from '../src/domain/contexto.js';

/** As filas pertencem ao tenant: toda consulta precisa do contexto. */
function filasDe(ctx: Contexto) {
  return listarFilas(ctx) as Array<{ id: number; nome: string }>;
}

test('atraso é derivado do mês corrente e do fim planejado', () => {
  const hoje = new Date(2026, 8, 15); // 09/2026
  assert.deepEqual(calcularAtraso('2026-07', null, 'em_andamento', hoje), {
    atrasado: true,
    meses_atraso: 2,
    desvio_meses: 2,
  });
  assert.deepEqual(calcularAtraso('2026-12', null, 'em_andamento', hoje), {
    atrasado: false,
    meses_atraso: 0,
    desvio_meses: 0,
  });
  // Entregue com atraso: não fica "atrasado", mas o desvio é registrado.
  assert.deepEqual(calcularAtraso('2026-06', '2026-08', 'concluido', hoje), {
    atrasado: false,
    meses_atraso: 0,
    desvio_meses: 2,
  });
  // Entregue adiantado: desvio negativo.
  assert.equal(calcularAtraso('2026-10', '2026-08', 'concluido', hoje).desvio_meses, -2);
  assert.equal(calcularAtraso('2020-01', null, 'cancelado', hoje).atrasado, false);
});

test('projeto concluído exige mês de fim real', () => {
  const { ctx } = ambienteLimpo();
  assert.throws(
    () =>
      criarProjeto(ctx, {
        nome: 'Sem data real',
        mesInicio: mesRelativo(-3),
        mesFimPlanejado: mesRelativo(-1),
        status: 'concluido',
      }),
    /exige o mês de fim real/,
  );
});

test('projeto rejeita fim planejado anterior ao início', () => {
  const { ctx } = ambienteLimpo();
  assert.throws(
    () => criarProjeto(ctx, { nome: 'Invertido', mesInicio: '05/2026', mesFimPlanejado: '02/2026' }),
    /anterior ao início/,
  );
});

test('dashboard de projetos monta Gantt, carga por envolvido e desvios', () => {
  const { ctx } = ambienteLimpo();
  const projeto = criarProjeto(ctx, {
    nome: 'Modernização de rede',
    mesInicio: mesRelativo(-3),
    mesFimPlanejado: mesRelativo(-1),
  });
  criarTarefa(ctx, projeto.id, {
    nome: 'Compra de switches',
    mesInicio: mesRelativo(-3),
    mesFimPlanejado: mesRelativo(-2),
    responsavel: 'Ana',
    mesFimReal: mesRelativo(-2),
  });
  criarTarefa(ctx, projeto.id, {
    nome: 'Configuração',
    mesInicio: mesRelativo(-2),
    mesFimPlanejado: mesRelativo(-1),
    responsavel: 'Bruno',
  });
  adicionarEnvolvido(ctx, projeto.id, { nome: 'Ana', papel: 'Infraestrutura' });

  const painel = dashboardProjetos(ctx);
  assert.equal(painel.indicadores.total, 1);
  assert.equal(painel.indicadores.atrasados, 1, 'passou do fim planejado sem fim real');
  assert.equal(painel.indicadores.tarefas_atrasadas, 1);
  assert.equal(painel.gantt[0]!.tarefas.length, 2);
  assert.equal(painel.gantt[0]!.offset_meses, 0);
  assert.equal(painel.gantt[0]!.duracao_meses, 3);

  const carga = Object.fromEntries(painel.carga_por_envolvido.map((c) => [c.responsavel, c]));
  assert.equal(carga.Ana!.concluidas, 1);
  assert.equal(carga.Bruno!.atrasadas, 1);

  atualizarProjeto(ctx, projeto.id, { mesFimReal: mesRelativo(0) });
  const depois = dashboardProjetos(ctx);
  assert.equal(depois.indicadores.concluidos, 1);
  assert.equal(depois.indicadores.atrasados, 0);
  assert.equal(depois.desvios[0]!.desvio_meses, 1);
  assert.equal(listarProjetos(ctx, { apenasAtrasados: true }).length, 0);
});

test('registro de SLA exige que dentro + fora feche com o total', () => {
  const { ctx } = ambienteLimpo();
  const fila = filasDe(ctx)[0]!;
  assert.throws(
    () =>
      registrarTicketSla(ctx, {
        competencia: mesRelativo(-1),
        filaId: fila.id,
        totalAtendidos: 100,
        dentroSla: 80,
        foraSla: 30,
      }),
    /Inconsistência no registro de SLA/,
  );
  // Sem "fora", o sistema deriva do total.
  const registro = registrarTicketSla(ctx, {
    competencia: mesRelativo(-1),
    filaId: fila.id,
    totalAtendidos: 100,
    dentroSla: 80,
  });
  assert.equal(registro.fora_sla, 20);
  assert.equal(registro.pct_dentro_sla, 80);
});

test('percentuais de SLA são consistentes e não dividem por zero', () => {
  assert.equal(percentual(0, 0), 0);
  assert.equal(percentual(37, 111), 33.3);
  assert.equal(percentual(1, 3), 33.3);
});

test('dashboard de SLA agrega por fila, tópico e filial', () => {
  const { ctx } = ambienteLimpo();
  const filial = criarFilial(ctx, { nome: 'Recife' });
  const filas = filasDe(ctx);
  const topico = criarTopicoAjuda(ctx, 'Impressora');
  const competencia = mesRelativo(-1);

  registrarTicketSla(ctx, { competencia, filaId: filas[0]!.id, totalAtendidos: 100, dentroSla: 90 });
  registrarTicketSla(ctx, {
    competencia,
    filaId: filas[1]!.id,
    filialId: filial.id,
    topicoAjudaId: topico.id,
    totalAtendidos: 50,
    dentroSla: 25,
  });

  const painel = dashboardSla(ctx, { competencia });
  assert.equal(painel.totais_mes.total_atendidos, 150);
  assert.equal(painel.totais_mes.dentro_sla, 115);
  assert.equal(painel.totais_mes.pct_dentro_sla, 76.7);
  assert.equal(painel.por_fila.find((f) => f.fila === filas[1]!.nome)!.pct_dentro_sla, 50);
  assert.equal(painel.por_topico.find((t) => t.topico === 'Impressora')!.total_atendidos, 50);
  assert.equal(painel.por_filial.length, 2);

  // Filtrar por filial isola o escopo.
  const soFilial = dashboardSla(ctx, { competencia, filialId: filial.id });
  assert.equal(soFilial.totais_mes.total_atendidos, 50);
});

test('dashboard financeiro projeta 12 meses e separa despesa de investimento', () => {
  const { ctx } = ambienteLimpo();
  criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx, 'Pessoas'),
    competencia: mesRelativo(0),
    valor: 10000,
    natureza: 'fixa',
    classificacao: 'despesa',
    repetirAte: mesRelativo(12),
  });
  criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx, 'Equipamentos de TI'),
    competencia: mesRelativo(0),
    valor: 24000,
    natureza: 'pontual_parcelada',
    classificacao: 'investimento',
    qtdParcelas: 12,
  });

  const painel = dashboardFinanceiro(ctx, { competencia: mesRelativo(0) });
  assert.equal(painel.totais_mes.despesa, 10000);
  assert.equal(painel.totais_mes.investimento, 2000);
  assert.equal(painel.projecao_12_meses.length, 12);
  // 12 meses de folha + 11 parcelas restantes
  const totalProjetado = painel.projecao_12_meses.reduce((s, m) => s + m.total, 0);
  assert.equal(totalProjetado, 12 * 10000 + 11 * 2000);
  assert.equal(painel.por_natureza.length, 2);
});

test('o escopo de um tenant nunca vaza para outro', () => {
  const primeiro = ambienteLimpo();
  criarLancamento(primeiro.ctx, {
    tipoDespesaId: idTipoDespesa(primeiro.ctx),
    competencia: mesRelativo(0),
    valor: 5000,
    natureza: 'fixa',
    classificacao: 'despesa',
  });
  criarProjeto(primeiro.ctx, { nome: 'Projeto A', mesInicio: mesRelativo(0), mesFimPlanejado: mesRelativo(2) });
  registrarTicketSla(primeiro.ctx, {
    competencia: mesRelativo(0),
    filaId: filasDe(primeiro.ctx)[0]!.id,
    totalAtendidos: 10,
    dentroSla: 10,
  });

  const outra = criarEmpresa(primeiro.ctx.usuarioId, { nome: 'Outra empresa' });
  const ctxOutra = { ...primeiro.ctx, empresaId: outra.id };

  assert.equal(dashboardFinanceiro(ctxOutra, { competencia: mesRelativo(0) }).totais_mes.total, 0);
  assert.equal(listarProjetos(ctxOutra).length, 0);
  assert.equal(listarTicketsSla(ctxOutra).itens.length, 0);
  assert.equal(dashboardFinanceiro(primeiro.ctx, { competencia: mesRelativo(0) }).totais_mes.total, 5000);
});

test('chamado é registro de SLA com detalhe e volta pela planilha sem duplicar', async () => {
  const { ctx } = ambienteLimpo();
  const fila = filasDe(ctx)[0]!;

  const chamado = registrarTicketSla(ctx, {
    competencia: mesRelativo(-1),
    filaId: fila.id,
    totalAtendidos: 1,
    dentroSla: 0,
    ticketId: 21734,
    numero: '966375',
    assunto: 'Impressora sem rede',
    solicitante: 'Maria',
    responsavel: 'João',
    status: 'Aberto',
    abertoEm: '2026-08-01T09:00Z',
    prazoEm: '2026-08-03T09:00Z',
    horas: null,
  });
  assert.equal(chamado.ticket_id, 21734);
  assert.equal(chamado.fora_sla, 1);
  assert.equal(chamado.assunto, 'Impressora sem rede');

  // Agregação não distingue chamado de registro mensal: o percentual é o mesmo.
  assert.equal(listarTicketsSla(ctx).resumo.pct_dentro_sla, 0);

  // Editar o total não pode apagar o detalhe do chamado.
  const editado = atualizarTicketSla(ctx, chamado.id, { dentroSla: 1, justificativa: 'fechou no prazo' });
  assert.equal(editado.dentro_sla, 1);
  assert.equal(editado.numero, '966375');
  assert.equal(editado.ticket_id, 21734);

  // Ida e volta pela planilha: a identidade é o ticket, então nada duplica.
  const arquivo = await exportarXlsx(ctx, 'sla');
  const antes = listarTicketsSla(ctx).itens.length;
  const relatorio = await importarPlanilha(ctx, arquivo, { modulo: 'sla', arquivoNome: 'sla.xlsx' });
  assert.equal(relatorio.duplicadas, antes);
  assert.equal(relatorio.importadas, 0);
  assert.equal(listarTicketsSla(ctx).itens.length, antes);

  // O mesmo chamado com o fechamento preenchido atualiza, não cria um segundo.
  assert.equal(buscarPorTicketId(ctx, 21734)!.id, chamado.id);
});

test('hierarquia de tarefas: até 3 níveis, sem ciclo e sem tarefa órfã de pai excluído', () => {
  const { ctx } = ambienteLimpo();
  const projeto = criarProjeto(ctx, {
    nome: 'Migração de ERP',
    mesInicio: mesRelativo(-2),
    mesFimPlanejado: mesRelativo(4),
  });
  const outro = criarProjeto(ctx, {
    nome: 'Outro projeto',
    mesInicio: mesRelativo(-1),
    mesFimPlanejado: mesRelativo(2),
  });
  const tarefa = (nome: string, parentTaskId: number | null = null, projetoId = projeto.id) =>
    criarTarefa(ctx, projetoId, {
      nome,
      mesInicio: mesRelativo(-1),
      mesFimPlanejado: mesRelativo(1),
      parentTaskId,
    });

  const n1 = tarefa('Levantamento');
  const n2 = tarefa('Entrevistas', n1.id);
  const n3 = tarefa('Roteiro', n2.id);
  assert.equal(n2.parent_task_id, n1.id);
  assert.equal(n3.parent_task_id, n2.id);

  // 4º nível é recusado, com o motivo.
  assert.throws(() => tarefa('Perguntas', n3.id), /até 3 níveis/);

  // A própria tarefa como principal.
  assert.throws(() => atualizarTarefa(ctx, n1.id, { parentTaskId: n1.id }), /não pode ser a própria/);

  // Ciclo: colocar o avô abaixo do neto.
  assert.throws(() => atualizarTarefa(ctx, n1.id, { parentTaskId: n3.id }), /ciclo/);

  // Tarefa principal de outro projeto.
  const alheia = tarefa('Tarefa de outro projeto', null, outro.id);
  assert.throws(() => atualizarTarefa(ctx, n2.id, { parentTaskId: alheia.id }), /mesmo projeto/);

  // Mover uma subárvore de 2 níveis para baixo de outra raiz estouraria o teto.
  const raiz2 = tarefa('Piloto');
  assert.throws(() => atualizarTarefa(ctx, n1.id, { parentTaskId: raiz2.id }), /até 3 níveis/);

  // Excluir tarefa com filhas é bloqueado, e a mensagem diz quais são.
  assert.throws(() => excluirTarefa(ctx, n1.id), /Entrevistas/);
  assert.throws(() => excluirTarefa(ctx, n1.id), /subtarefa/);

  // Desvincular libera a exclusão da folha, e o pai continua de pé.
  atualizarTarefa(ctx, n3.id, { parentTaskId: null });
  excluirTarefa(ctx, n2.id);
  assert.equal(listarTarefas(ctx, projeto.id).find((t) => t.id === n1.id)!.total_subtarefas, 0);

  // A ordem de leitura é hierárquica: pai antes das filhas, com o nível junto.
  const filha = tarefa('Checklist', n1.id);
  const lista = listarTarefas(ctx, projeto.id);
  const posPai = lista.findIndex((t) => t.id === n1.id);
  const posFilha = lista.findIndex((t) => t.id === filha.id);
  assert.ok(posFilha === posPai + 1, 'a subtarefa vem logo abaixo da principal');
  assert.equal(lista[posPai]!.nivel, 1);
  assert.equal(lista[posFilha]!.nivel, 2);
  assert.equal(lista[posPai]!.total_subtarefas, 1);
});
