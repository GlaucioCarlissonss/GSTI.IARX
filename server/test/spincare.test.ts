/**
 * O CONTROLE ÚNICO no servidor.
 *
 * Duas coisas são conferidas aqui, e elas respondem a riscos diferentes.
 *
 * A primeira é que as regras existem DUAS VEZES — aqui e em
 * `artifact/app-js21.js`. Duas cópias divergem na primeira correção feita de
 * um lado só, e a divergência é silenciosa: os dois lados seguem mostrando um
 * avanço plausível.
 *
 * A segunda é que NENHUM DERIVADO É GRAVADO. Status consolidado, avanço, peso
 * e farol são calculados contra um dia que entra por parâmetro — é isso que
 * permite medir a mesma atividade em dois dias diferentes e exigir respostas
 * diferentes. Um teste que usasse "hoje" passaria hoje e falharia sozinho na
 * semana seguinte.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PESOS, UNIDADES, atividadesDoCliente, avancoDe, criterioDeAceite, derivar,
  diasParaPrazo, executantesDe, farolDe, ondaDaUnidade, painel, placar, porUnidade,
  removerControle, statusConsolidado, substituirControle,
} from '../src/domain/spincare.js';
import type { AtividadeDoControle } from '../src/domain/spincare.js';
import { ambienteLimpo, contextoDe } from './apoio.js';
import { criarEmpresa } from '../src/domain/empresas.js';

/** Uma atividade mínima, para não repetir vinte campos em cada caso. */
const atv = (p: Partial<AtividadeDoControle> = {}): AtividadeDoControle => ({
  id_origem: 'A1', chave: 'A1', fonte: '', grupo_time: 'Infra', frente: 'Cadastros',
  replicavel: 'Sim', atividade: 'Cadastrar convênios', tipo_entrega: 'Cadastro',
  caminho: '', criticidade: 'GO-LIVE', lider: 'Alfa', executante: 'Beta',
  data_base_onda: null, prazo_repactuado: null, pendencia: '', proxima_acao: '',
  evidencia: '', criterio_especifico: '', observacoes: '',
  unidades: {}, ondas: {}, ...p,
});

// ------------------------------------------------------------ as unidades

test('a onda da unidade sai do cronograma, e não de uma lista à parte', () => {
  // Escrevê-la à mão foi o que deixou o artifact afirmando, por meses, que
  // UC RJ virava na 2ª onda enquanto a Visão Macro já dizia 1ª.
  assert.equal(ondaDaUnidade('UC Rio de Janeiro/RJ'), 1);
  assert.equal(ondaDaUnidade('MHC Porto Velho/RO'), 1);
  assert.equal(ondaDaUnidade('HR João Pessoa/PB'), 2);
  assert.equal(ondaDaUnidade('UC São Paulo/SP'), 4);
  assert.equal(ondaDaUnidade(''), null);

  const rj = UNIDADES.find((u) => u.chave === 'uc_rj');
  assert.equal(rj?.onda, 1, 'a lista de colunas concorda com o cronograma');
  const sp = UNIDADES.find((u) => u.chave === 'uc_sp');
  assert.equal(sp?.onda, 4);
  // As colunas ainda sem unidade atribuída não inventam onda.
  assert.equal(UNIDADES.find((u) => u.chave === 'unidade_7')?.onda, null);
});

// ------------------------------------------------------- o consolidado

test('o status consolidado é o PIOR entre as unidades', () => {
  // Uma atividade só está concluída quando está concluída em todas. Tomar a
  // melhor diria que acabou enquanto uma unidade ainda não começou.
  assert.equal(statusConsolidado(atv({
    unidades: { uc_rj: 'Concluído', hm_ro: 'Não iniciado' },
  })), 'Não iniciado');
  assert.equal(statusConsolidado(atv({
    unidades: { uc_rj: 'Concluído', hm_ro: 'Em andamento' },
  })), 'Em andamento');
  assert.equal(statusConsolidado(atv({
    unidades: { uc_rj: 'Em andamento', hm_ro: 'Bloqueado' },
  })), 'Bloqueado', 'bloqueado vence todos');
  assert.equal(statusConsolidado(atv({
    unidades: { uc_rj: 'Concluído', hm_ro: 'Concluído' },
  })), 'Concluído');
  assert.equal(statusConsolidado(atv({ unidades: {} })), '', 'sem situação, sem consolidado');
});

test('o avanço segue o consolidado, e cancelada fica de fora', () => {
  // Cancelada e criticidade desconhecida ficam FORA: é o que define as
  // "atividades válidas", e incluí-las mudaria o denominador de todo percentual.
  assert.equal(avancoDe(atv({ unidades: { uc_rj: 'Concluído' } })), 1);
  assert.equal(avancoDe(atv({ unidades: { uc_rj: 'Em andamento' } })), 0.5);
  assert.equal(avancoDe(atv({ unidades: { uc_rj: 'Bloqueado' } })), 0.25);
  assert.equal(avancoDe(atv({ unidades: { uc_rj: 'Não iniciado' } })), 0);
  assert.equal(avancoDe(atv({ unidades: { uc_rj: 'Cancelado' } })), null);
  assert.equal(avancoDe(atv({ unidades: { uc_rj: 'Concluído' }, criticidade: 'N/A' })), null);
  assert.equal(avancoDe(atv({ unidades: {} })), null, 'sem situação não entra no cálculo');
});

test('o peso vem da criticidade, e o ponderado é o produto', () => {
  assert.equal(PESOS['GO-LIVE'], 3);
  const a = derivar(atv({ unidades: { uc_rj: 'Em andamento' }, criticidade: 'GO-LIVE' }), '2026-11-01');
  assert.equal(a.peso, 3);
  assert.equal(a.avanco, 0.5);
  assert.equal(a.avanco_ponderado, 1.5);
});

// ---------------------------------------------------------------- o prazo

test('o prazo sai do repactuado; sem ele, da data-base mais o deslocamento', () => {
  // GO-LIVE vence DEZ DIAS ANTES da data-base da onda: é o que a planilha faz,
  // e é o sinal de que a atividade precisa estar pronta antes da virada.
  const comBase = atv({ data_base_onda: '2026-11-11', criticidade: 'GO-LIVE' });
  assert.equal(diasParaPrazo(comBase, '2026-11-01'), 0, '11/11 − 10 dias = 01/11');

  const evolucao = atv({ data_base_onda: '2026-11-11', criticidade: 'EVOLUÇÃO' });
  assert.equal(diasParaPrazo(evolucao, '2026-11-01'), 55, '11/11 + 45 dias');

  // O repactuado manda sobre a conta.
  const repactuado = atv({
    data_base_onda: '2026-11-11', criticidade: 'GO-LIVE', prazo_repactuado: '2026-12-01',
  });
  assert.equal(diasParaPrazo(repactuado, '2026-11-01'), 30);

  // Sem nenhuma das duas pontas não se inventa prazo.
  assert.equal(diasParaPrazo(atv({}), '2026-11-01'), null);
});

test('o farol: concluído é verde, bloqueado é vermelho, vencido em aberto é vermelho', () => {
  const dia = '2026-11-01';
  assert.equal(farolDe(atv({ unidades: { uc_rj: 'Concluído' } }), dia), 'VERDE');
  assert.equal(farolDe(atv({ unidades: { uc_rj: 'Bloqueado' } }), dia), 'VERMELHO');
  // Em aberto e dentro do prazo: amarelo.
  assert.equal(farolDe(atv({
    unidades: { uc_rj: 'Em andamento' }, data_base_onda: '2026-12-01', criticidade: 'GO-LIVE',
  }), dia), 'AMARELO');
  // Em aberto e VENCIDO: vermelho.
  assert.equal(farolDe(atv({
    unidades: { uc_rj: 'Em andamento' }, data_base_onda: '2026-10-01', criticidade: 'GO-LIVE',
  }), dia), 'VERMELHO');
  // Fora do cálculo não tem farol.
  assert.equal(farolDe(atv({ unidades: { uc_rj: 'Cancelado' } }), dia), 'N/A');
});

test('a mesma atividade muda de farol conforme o dia — porque nada é gravado', () => {
  const a = atv({
    unidades: { uc_rj: 'Em andamento' }, data_base_onda: '2026-11-21', criticidade: 'GO-LIVE',
  });
  // O prazo é 11/11.
  assert.equal(derivar(a, '2026-11-01').farol, 'AMARELO');
  assert.equal(derivar(a, '2026-11-20').farol, 'VERMELHO');
});

// ------------------------------------------------------------- miudezas

test('o critério de aceite: o específico manda, senão o padrão do tipo', () => {
  assert.match(criterioDeAceite(atv({ tipo_entrega: 'Cadastro' })), /Registros cadastrados/);
  assert.equal(
    criterioDeAceite(atv({ tipo_entrega: 'Cadastro', criterio_especifico: 'O meu critério' })),
    'O meu critério',
  );
  assert.equal(criterioDeAceite(atv({ tipo_entrega: 'Tipo que não existe' })), '');
});

test('os executantes se separam por quebra de linha e por ponto e vírgula', () => {
  assert.deepEqual(executantesDe('Ana\nBruno'), ['Ana', 'Bruno']);
  assert.deepEqual(executantesDe('Ana; Bruno'), ['Ana', 'Bruno']);
  // "-" é uma marca explícita de "ninguém", e diz o mesmo que o branco.
  assert.deepEqual(executantesDe('-'), []);
  assert.deepEqual(executantesDe(''), []);
});

test('"igual em todas" só responde quando há mais de uma unidade', () => {
  const dia = '2026-11-01';
  assert.equal(derivar(atv({ unidades: { uc_rj: 'Concluído' } }), dia).status_igual_em_todas, '');
  assert.equal(derivar(atv({
    unidades: { uc_rj: 'Concluído', hm_ro: 'Concluído' },
  }), dia).status_igual_em_todas, 'SIM');
  assert.equal(derivar(atv({
    unidades: { uc_rj: 'Concluído', hm_ro: 'Em andamento' },
  }), dia).status_igual_em_todas, 'NÃO');
});

// ---------------------------------------------------------------- o placar

test('o avanço ponderado pesa a criticidade; o simples não', () => {
  const dia = '2026-11-01';
  const acoes = [
    // GO-LIVE (peso 3) concluída, EVOLUÇÃO (peso 1) não iniciada.
    atv({ chave: 'A1', criticidade: 'GO-LIVE', unidades: { uc_rj: 'Concluído' } }),
    atv({ chave: 'A2', criticidade: 'EVOLUÇÃO', unidades: { uc_rj: 'Não iniciado' } }),
  ].map((a) => derivar(a, dia));
  const p = placar(acoes);
  assert.equal(p.total, 2);
  assert.equal(p.validas, 2);
  // Ponderado: (1×3 + 0×1) / (3+1) = 75%. Simples: (1+0)/2 = 50%.
  assert.equal(p.avanco_ponderado, 75);
  assert.equal(p.avanco_simples, 50);
});

test('atividade cancelada sai do denominador, e o total continua a contando', () => {
  const dia = '2026-11-01';
  const acoes = [
    atv({ chave: 'A1', unidades: { uc_rj: 'Concluído' } }),
    atv({ chave: 'A2', unidades: { uc_rj: 'Cancelado' } }),
  ].map((a) => derivar(a, dia));
  const p = placar(acoes);
  assert.equal(p.total, 2, 'a cancelada aparece no total');
  assert.equal(p.validas, 1, 'mas não no denominador');
  assert.equal(p.avanco_ponderado, 100);
});

test('placar vazio não dá zero por cento — dá nada', () => {
  // Zero diria que nada foi feito; o certo é que não há base para medir.
  assert.equal(placar([]).avanco_ponderado, null);
  assert.equal(placar([]).total, 0);
});

test('o avanço por unidade não é o consolidado', () => {
  // O consolidado é o pior caso, e uma unidade que já terminou tudo
  // desapareceria dentro dele.
  const dia = '2026-11-01';
  const acoes = [
    atv({ chave: 'A1', criticidade: 'GO-LIVE', unidades: { uc_rj: 'Concluído', hm_ro: 'Não iniciado' } }),
  ].map((a) => derivar(a, dia));
  assert.equal(acoes[0]!.status_consolidado, 'Não iniciado');

  const unidades = porUnidade(acoes);
  const rj = unidades.find((u) => u.chave === 'uc_rj')!;
  const ro = unidades.find((u) => u.chave === 'hm_ro')!;
  assert.equal(rj.avanco, 100, 'no Rio está pronta');
  assert.equal(ro.avanco, 0, 'em Porto Velho não começou');
  assert.equal(rj.acompanhada, true);
  // A unidade sem coluna na planilha não é zero: é ausência de dado.
  const semColuna = unidades.find((u) => u.chave === 'unidade_7')!;
  assert.equal(semColuna.acompanhada, false);
  assert.equal(semColuna.avanco, null);
});

// ------------------------------------------------------------ persistência

test('a carga substitui o controle, e não soma ao que havia', () => {
  const { ctx } = ambienteLimpo();
  substituirControle(ctx, [atv({ chave: 'A1' }), atv({ chave: 'A2' }), atv({ chave: 'A3' })]);
  assert.equal(atividadesDoCliente(ctx).length, 3);

  const r = substituirControle(ctx, [atv({ chave: 'A1' })]);
  assert.equal(r.removidas, 3);
  assert.equal(r.gravadas, 1);
  assert.equal(atividadesDoCliente(ctx).length, 1);
});

test('as situações por unidade e por onda voltam montadas', () => {
  const { ctx } = ambienteLimpo();
  substituirControle(ctx, [atv({
    chave: 'A1',
    unidades: { uc_rj: 'Concluído', hm_ro: 'Em andamento' },
    ondas: { 1: { prazo: '2026-10-01', situacao: 'Concluído' }, 2: { prazo: '2026-11-03' } },
  })]);
  const [a] = atividadesDoCliente(ctx);
  assert.deepEqual(a!.unidades, { uc_rj: 'Concluído', hm_ro: 'Em andamento' });
  assert.deepEqual(a!.ondas['1'], { prazo: '2026-10-01', situacao: 'Concluído' });
  assert.deepEqual(a!.ondas['2'], { prazo: '2026-11-03' }, 'onda sem situação não inventa uma');
});

test('nenhum derivado vai para o banco', () => {
  const { ctx } = ambienteLimpo();
  substituirControle(ctx, [atv({ chave: 'A1', unidades: { uc_rj: 'Concluído' } })]);
  const colunas = (atividadesDoCliente(ctx)[0] ?? {}) as Record<string, unknown>;
  for (const proibida of ['farol', 'avanco', 'peso', 'status_consolidado', 'avanco_ponderado']) {
    assert.ok(!(proibida in colunas), `"${proibida}" é derivado e não pode sair do banco`);
  }
});

test('o controle de um cliente não vaza para outro', () => {
  const { ctx } = ambienteLimpo();
  substituirControle(ctx, [atv({ chave: 'A1' }), atv({ chave: 'A2' })]);

  const outra = criarEmpresa(ctx.usuarioId, { nome: 'Outro Contratante' });
  const alheio = contextoDe(ctx, outra.id);
  assert.equal(atividadesDoCliente(alheio).length, 0);

  substituirControle(alheio, [atv({ chave: 'Z9' })]);
  assert.equal(atividadesDoCliente(ctx).length, 2, 'a carga do vizinho não apagou o nosso');
});

test('o painel devolve placar, unidades e atividades derivadas contra o dia pedido', () => {
  const { ctx } = ambienteLimpo();
  substituirControle(ctx, [
    atv({ chave: 'A1', criticidade: 'GO-LIVE', unidades: { uc_rj: 'Concluído' } }),
    atv({
      chave: 'A2', criticidade: 'GO-LIVE', unidades: { uc_rj: 'Em andamento' },
      data_base_onda: '2026-11-21',
    }),
  ]);

  const antes = painel(ctx, '2026-11-01');
  assert.equal(antes.hoje, '2026-11-01');
  assert.equal(antes.placar.total, 2);
  assert.equal(antes.placar.por_farol['AMARELO'], 1);
  assert.equal(antes.placar.por_farol['VERDE'], 1);
  assert.equal(antes.unidades.length, UNIDADES.length);

  // O mesmo controle, medido depois do prazo: a aberta fica vermelha.
  const depois = painel(ctx, '2026-11-20');
  assert.equal(depois.placar.por_farol['VERMELHO'], 1);
  assert.equal(depois.placar.por_farol['AMARELO'], undefined);
});

test('remover devolve quantas atividades saíram', () => {
  const { ctx } = ambienteLimpo();
  substituirControle(ctx, [atv({ chave: 'A1' }), atv({ chave: 'A2' })]);
  assert.equal(removerControle(ctx), 2);
  assert.equal(atividadesDoCliente(ctx).length, 0);
  assert.equal(removerControle(ctx), 0, 'remover de novo não é erro');
});

test('a mesma chave não entra duas vezes', () => {
  const { ctx } = ambienteLimpo();
  assert.throws(
    () => substituirControle(ctx, [atv({ chave: 'A1' }), atv({ chave: 'A1', atividade: 'Outra' })]),
    /UNIQUE/,
  );
  assert.equal(atividadesDoCliente(ctx).length, 0, 'a transação não deixou meio controle gravado');
});
