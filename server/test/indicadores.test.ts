import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, idTipoDespesa, mesRelativo } from './apoio.js';
import { criarLancamento, listarLancamentos, reconhecerLancamentos } from '../src/domain/financeiro.js';
import {
  conformidadeSla,
  despesasPorReconhecer,
  entregaDeTarefas,
  META_SLA,
  reducaoDeCusto,
} from '../src/domain/indicadores.js';
import { criarProjeto, criarTarefa } from '../src/domain/projetos.js';
import { listarAuditoria } from '../src/domain/auditoria.js';
import { registrarTicketSla } from '../src/domain/sla.js';
import { criarFila } from '../src/domain/cadastros.js';

// --------------------------------------------------------------- financeiro

test('o que entra nasce por reconhecer, e reconhecer deixa trilha', () => {
  const { ctx } = ambienteLimpo();
  const criado = criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(0),
    valor: 500,
    natureza: 'fixa',
    classificacao: 'despesa',
  });
  const antes = listarLancamentos(ctx, {}).itens[0]!;
  assert.equal(antes.reconhecido, false, 'lançamento novo nasce por reconhecer');

  const r = reconhecerLancamentos(ctx, [criado.id], true, 'Conferido com a nota.');
  assert.equal(r.alterados, 1);
  const depois = listarLancamentos(ctx, {}).itens[0]!;
  assert.equal(depois.reconhecido, true);
  assert.ok(depois.reconhecido_em, 'o reconhecimento carimba quando foi');

  const trilha = listarAuditoria(ctx, {}).filter((a) => a.acao === 'reconhecer');
  assert.equal(trilha.length, 1);
  assert.match(String(trilha[0]!.justificativa), /Conferido/);
});

test('reconhecer de novo o que já estava reconhecido não escreve nem audita', () => {
  const { ctx } = ambienteLimpo();
  const criado = criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(0),
    valor: 500,
    natureza: 'fixa',
    classificacao: 'despesa',
  });
  reconhecerLancamentos(ctx, [criado.id], true);
  const segunda = reconhecerLancamentos(ctx, [criado.id], true);
  assert.equal(segunda.alterados, 0);
  assert.equal(segunda.ja_estavam, 1);
  // Uma operação, uma linha de trilha. Refazer o que já estava feito mostraria
  // duas onde houve uma.
  assert.equal(listarAuditoria(ctx, {}).filter((a) => a.acao === 'reconhecer').length, 1);
});

test('o filtro de reconhecimento separa os dois lados, e ausente traz os dois', () => {
  const { ctx } = ambienteLimpo();
  const tipo = idTipoDespesa(ctx);
  const base = { tipoDespesaId: tipo, competencia: mesRelativo(0), natureza: 'fixa' as const, classificacao: 'despesa' as const };
  const a = criarLancamento(ctx, { ...base, valor: 100 });
  criarLancamento(ctx, { ...base, valor: 200, descricao: 'outro' });
  reconhecerLancamentos(ctx, [a.id], true);

  assert.equal(listarLancamentos(ctx, {}).total, 2, 'sem filtro, o total é o de verdade');
  assert.equal(listarLancamentos(ctx, { reconhecido: true }).total, 1);
  assert.equal(listarLancamentos(ctx, { reconhecido: false }).total, 1);
});

test('por reconhecer se agrupa por centro de custo, com contador e denominador', () => {
  const { ctx } = ambienteLimpo();
  const tipo = idTipoDespesa(ctx);
  const base = { tipoDespesaId: tipo, competencia: mesRelativo(0), natureza: 'fixa' as const, classificacao: 'despesa' as const };
  const reconhecido = criarLancamento(ctx, { ...base, valor: 100 });
  criarLancamento(ctx, { ...base, valor: 300, descricao: 'a' });
  criarLancamento(ctx, { ...base, valor: 200, descricao: 'b' });
  reconhecerLancamentos(ctx, [reconhecido.id], true);

  const r = despesasPorReconhecer(ctx, {});
  assert.equal(r.quantidade, 2);
  assert.equal(r.valor, 500);
  assert.equal(r.total_lancamentos, 3, 'o denominador é o universo do recorte');
  assert.equal(r.total_valor, 600);
  assert.equal(r.centros.length, 1);
  assert.equal(r.centros[0]!.quantidade, 2);
  assert.equal(r.centros[0]!.valor, 500);
});

test('a redução de custo olha só a recorrente, e a variação é contra o mês anterior', () => {
  const { ctx } = ambienteLimpo();
  const tipo = idTipoDespesa(ctx);
  criarLancamento(ctx, { tipoDespesaId: tipo, competencia: mesRelativo(0), valor: 1000, natureza: 'fixa', classificacao: 'despesa' });
  criarLancamento(ctx, { tipoDespesaId: tipo, competencia: mesRelativo(1), valor: 800, natureza: 'fixa', classificacao: 'despesa' });
  criarLancamento(ctx, { tipoDespesaId: tipo, competencia: mesRelativo(2), valor: 600, natureza: 'fixa', classificacao: 'despesa' });
  // Compra pontual: não entra na série. Comparar mês a mês uma compra que
  // aconteceu uma vez produziria uma "redução" que é só o fim da compra.
  criarLancamento(ctx, { tipoDespesaId: tipo, competencia: mesRelativo(2), valor: 50_000, natureza: 'pontual_unica', classificacao: 'investimento' });

  const r = reducaoDeCusto(ctx, {});
  assert.equal(r.meses, 3);
  assert.equal(r.valor_inicial, 1000);
  assert.equal(r.valor_final, 600);
  assert.equal(r.serie[0]!.variacao_pct, null, 'o primeiro mês não tem contra o que variar');
  assert.equal(r.serie[1]!.variacao_pct, -20);
  assert.equal(r.serie[2]!.variacao_pct, -25);
  assert.equal(r.variacao_total_pct, -40);
  assert.equal(r.economia, 400);
  assert.equal(r.tendencia, 'queda');
});

test('um mês só não vira tendência', () => {
  const { ctx } = ambienteLimpo();
  criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(0),
    valor: 1000,
    natureza: 'fixa',
    classificacao: 'despesa',
  });
  const r = reducaoDeCusto(ctx, {});
  assert.equal(r.tendencia, 'indefinida');
  assert.equal(r.variacao_total_pct, null);
});

// ---------------------------------------------------------------------- SLA

test('a conformidade compara com a meta de 80%', () => {
  const { ctx } = ambienteLimpo();
  const fila = criarFila(ctx, 'Suporte').id;
  registrarTicketSla(ctx, { filaId: fila, competencia: mesRelativo(0), totalAtendidos: 10, dentroSla: 9 });

  const r = conformidadeSla(ctx, {});
  assert.equal(r.total, 10);
  assert.equal(r.dentro, 9);
  assert.equal(r.fora, 1);
  assert.equal(r.pct_dentro, 90);
  assert.equal(r.meta, META_SLA);
  assert.equal(r.atinge_meta, true);
  assert.equal(r.distancia_meta, 10);
});

test('abaixo da meta o indicador diz de quanto foi a falta', () => {
  const { ctx } = ambienteLimpo();
  const fila = criarFila(ctx, 'Suporte').id;
  registrarTicketSla(ctx, { filaId: fila, competencia: mesRelativo(0), totalAtendidos: 10, dentroSla: 6 });
  const r = conformidadeSla(ctx, {});
  assert.equal(r.pct_dentro, 60);
  assert.equal(r.atinge_meta, false);
  assert.equal(r.distancia_meta, -20);
});

test('sem chamado nenhum, a meta não é atingida nem falhada', () => {
  const { ctx } = ambienteLimpo();
  const r = conformidadeSla(ctx, {});
  assert.equal(r.total, 0);
  assert.equal(r.atinge_meta, false);
  assert.equal(r.distancia_meta, null, 'sem base não há distância a declarar');
});

test('o registro agregado não é contado como chamado aberto', () => {
  const { ctx } = ambienteLimpo();
  const fila = criarFila(ctx, 'Suporte').id;
  registrarTicketSla(ctx, { filaId: fila, competencia: mesRelativo(0), totalAtendidos: 40, dentroSla: 30 });
  const r = conformidadeSla(ctx, {});
  assert.equal(r.situacao.abertos, 0);
  assert.equal(r.situacao.em_andamento, 0);
  assert.equal(r.situacao.resolvidos, 0);
  assert.equal(r.situacao.registros_sem_status, 40, 'o total agregado fica declarado como sem status');
});

// ----------------------------------------------------------------- projetos

test('entrega no prazo mede o que foi entregue, e pendente é o que resta', () => {
  const { ctx } = ambienteLimpo();
  const projeto = criarProjeto(ctx, {
    nome: 'Migração',
    mesInicio: mesRelativo(-2),
    mesFimPlanejado: mesRelativo(2),
  });
  criarTarefa(ctx, projeto.id, {
    nome: 'No prazo',
    mesInicio: mesRelativo(-2),
    mesFimPlanejado: mesRelativo(0),
    mesFimReal: mesRelativo(-1),
    status: 'concluida',
  });
  criarTarefa(ctx, projeto.id, {
    nome: 'Atrasada',
    mesInicio: mesRelativo(-2),
    mesFimPlanejado: mesRelativo(-1),
    mesFimReal: mesRelativo(0),
    status: 'concluida',
  });
  criarTarefa(ctx, projeto.id, {
    nome: 'Ainda em aberto',
    mesInicio: mesRelativo(-1),
    mesFimPlanejado: mesRelativo(0),
    status: 'em_andamento',
  });
  criarTarefa(ctx, projeto.id, {
    nome: 'Cancelada',
    mesInicio: mesRelativo(-1),
    mesFimPlanejado: mesRelativo(0),
    status: 'cancelada',
  });

  const r = entregaDeTarefas(ctx, {});
  assert.equal(r.entregues, 2);
  assert.equal(r.no_prazo, 1);
  assert.equal(r.fora_do_prazo, 1);
  assert.equal(r.pct_no_prazo, 50, 'o denominador é o entregue, não o total');
  assert.equal(r.pendentes, 1, 'a cancelada não é pendente');
  assert.equal(r.canceladas, 1);
});

test('o recorte de competência limita as tarefas pelo mês planejado', () => {
  const { ctx } = ambienteLimpo();
  const projeto = criarProjeto(ctx, {
    nome: 'Migração',
    mesInicio: mesRelativo(-5),
    mesFimPlanejado: mesRelativo(5),
  });
  criarTarefa(ctx, projeto.id, {
    nome: 'Antiga',
    mesInicio: mesRelativo(-5),
    mesFimPlanejado: mesRelativo(-4),
    status: 'pendente',
  });
  criarTarefa(ctx, projeto.id, {
    nome: 'Do período',
    mesInicio: mesRelativo(-1),
    mesFimPlanejado: mesRelativo(0),
    status: 'pendente',
  });

  const tudo = entregaDeTarefas(ctx, {});
  assert.equal(tudo.pendentes, 2);
  const recorte = entregaDeTarefas(ctx, { competenciaInicio: mesRelativo(-1), competenciaFim: mesRelativo(0) });
  assert.equal(recorte.pendentes, 1);
});
