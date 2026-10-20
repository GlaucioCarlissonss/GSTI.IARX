/**
 * O PLANO DE AÇÃO no servidor.
 *
 * Duas coisas são conferidas aqui, e elas respondem a riscos diferentes.
 *
 * A primeira é que as regras existem DUAS VEZES — aqui e em
 * `artifact/app-js23.js`. Duas cópias divergem na primeira correção feita de
 * um lado só, e a divergência é silenciosa: os dois lados seguem mostrando um
 * placar plausível, e ninguém descobre até alguém comparar o celular com o
 * navegador na frente do outro.
 *
 * A segunda é que NENHUM DERIVADO É GRAVADO. Farol e situação são calculados
 * contra um dia que entra por parâmetro, e é isso que permite medir a mesma
 * ação em dois dias diferentes e exigir respostas diferentes. Um teste que
 * usasse a data de hoje passaria a falhar sozinho na semana seguinte.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANO_DIAS_AMARELO, acoesDoCliente, derivar, diasEntre, farolDe, painel,
  placar, porOnda, removerPlano, situacaoDe, substituirPlano,
} from '../src/domain/plano-acao.js';
import type { AcaoDoPlano } from '../src/domain/plano-acao.js';
import { ambienteLimpo, contextoDe } from './apoio.js';
import { criarEmpresa } from '../src/domain/empresas.js';

/** Uma ação mínima, para não repetir doze campos em cada caso. */
const acao = (p: Partial<AcaoDoPlano> = {}): AcaoDoPlano => ({
  onda: 1, numero: 1, tarefa: 'Levantar inventário', area: 'Infraestrutura',
  lider: 'Equipe de campo', inicio: '2026-09-01', fim: '2026-09-30',
  status: 'Não iniciado', link: '', observacoes: '', evolucoes: '', ...p,
});

// ------------------------------------------------------------------ o farol

test('o farol conta dias corridos, e não úteis', () => {
  // De 19/10 a 31/10 são 12 dias corridos. Dias úteis dariam 8, e o plano do
  // cliente escreve 12 — o motor de horas úteis existe para o SLA, que é
  // outro compromisso.
  assert.equal(diasEntre('2026-10-19', '2026-10-31'), 12);
  assert.equal(diasEntre('2026-10-31', '2026-10-19'), -12);
  assert.equal(diasEntre(null, '2026-10-19'), null);
});

test('concluída e cancelada saem antes do prazo', () => {
  // Uma ação entregue na semana passada NÃO está atrasada: pintá-la de
  // vermelho encheria a lista de urgências de coisa resolvida.
  const vencida = { fim: '2026-09-01' };
  assert.equal(farolDe({ ...vencida, status: 'Concluído' }, '2026-10-20').chave, 'CONCLUIDO');
  assert.equal(farolDe({ ...vencida, status: 'Cancelado' }, '2026-10-20').chave, 'CANCELADO');
  assert.equal(farolDe({ ...vencida, status: 'Em andamento' }, '2026-10-20').chave, 'ATRASADO');
});

test('a régua do amarelo é de três dias, e o limite é inclusive', () => {
  const dia = '2026-10-20';
  const f = (fim: string) => farolDe({ status: 'Em andamento', fim }, dia).chave;
  assert.equal(f('2026-10-19'), 'ATRASADO');
  assert.equal(f('2026-10-20'), 'VENCE', 'vencer hoje ainda é zero dia, não atraso');
  assert.equal(f('2026-10-23'), 'VENCE', `${PLANO_DIAS_AMARELO} dias ainda é amarelo`);
  assert.equal(f('2026-10-24'), 'NO_PRAZO');
});

test('sem data de fim o farol é "sem data", e nunca atraso', () => {
  // Inventar um prazo seria indistinguível do dado real, e cobraria alguém
  // por uma data que ninguém combinou.
  const f = farolDe({ status: 'Em andamento', fim: null }, '2026-10-20');
  assert.equal(f.chave, 'SEM_DATA');
  assert.equal(f.dias, null);
});

test('o rótulo do farol diz o número de dias', () => {
  assert.equal(farolDe({ status: 'Em andamento', fim: '2026-10-15' }, '2026-10-20').rotulo,
    'Atrasado 5d');
  assert.equal(farolDe({ status: 'Em andamento', fim: '2026-10-22' }, '2026-10-20').rotulo,
    'Vence em 2d');
  assert.equal(farolDe({ status: 'Em andamento', fim: '2026-11-01' }, '2026-10-20').rotulo,
    'No prazo 12d');
});

test('a mesma ação muda de farol conforme o dia — porque nada é gravado', () => {
  const a = acao({ status: 'Em andamento', fim: '2026-10-22' });
  assert.equal(derivar(a, '2026-10-10').farol, 'NO_PRAZO');
  assert.equal(derivar(a, '2026-10-20').farol, 'VENCE');
  assert.equal(derivar(a, '2026-10-30').farol, 'ATRASADO');
});

// --------------------------------------------------------------- a situação

test('em aberto com prazo vencido conta como ATRASADO, não como o status', () => {
  const dia = '2026-10-20';
  assert.equal(situacaoDe({ status: 'Em andamento', fim: '2026-10-01' }, dia), 'Atrasado');
  assert.equal(situacaoDe({ status: 'Não iniciado', fim: '2026-10-01' }, dia), 'Atrasado');
  assert.equal(situacaoDe({ status: 'Em andamento', fim: '2026-11-01' }, dia), 'Em andamento');
  assert.equal(situacaoDe({ status: 'Concluído', fim: '2026-10-01' }, dia), 'Concluído');
});

test('status desconhecido cai em "não iniciado", e não inventa um balde', () => {
  assert.equal(situacaoDe({ status: 'Aguardando terceiro', fim: null }, '2026-10-20'),
    'Não iniciado');
});

// ----------------------------------------------------------------- o placar

test('os cinco baldes somam o total, sem contar ninguém duas vezes', () => {
  const dia = '2026-10-20';
  const acoes = [
    acao({ numero: 1, status: 'Concluído', fim: '2026-09-01' }),
    acao({ numero: 2, status: 'Em andamento', fim: '2026-09-01' }), // vencida → atrasada
    acao({ numero: 3, status: 'Em andamento', fim: '2026-12-01' }),
    acao({ numero: 4, status: 'Não iniciado', fim: '2026-12-01' }),
    acao({ numero: 5, status: 'Cancelado', fim: '2026-09-01' }),
  ].map((a) => derivar(a, dia));
  const p = placar(acoes);
  assert.equal(p.total, 5);
  assert.equal(p.concluidas, 1);
  assert.equal(p.atrasadas, 1);
  assert.equal(p.em_andamento, 1);
  assert.equal(p.nao_iniciadas, 1);
  assert.equal(p.canceladas, 1);
  const soma = Object.values(p.por_situacao).reduce((s, n) => s + n, 0);
  assert.equal(soma, p.total, 'os baldes somam o total');
});

test('o percentual exclui as canceladas do denominador', () => {
  // Mantê-las embaixo da divisão faria o plano nunca poder chegar a 100%,
  // por ações que foram tiradas dele de propósito.
  const dia = '2026-10-20';
  const acoes = [
    acao({ numero: 1, status: 'Concluído' }),
    acao({ numero: 2, status: 'Concluído' }),
    acao({ numero: 3, status: 'Cancelado' }),
  ].map((a) => derivar(a, dia));
  const p = placar(acoes);
  assert.equal(p.validas, 2);
  assert.equal(p.pct_concluido, 100);
});

test('plano vazio não dá zero por cento — dá nada', () => {
  // Zero diria que nada foi feito; o certo é que não há plano para medir.
  assert.equal(placar([]).pct_concluido, null);
  assert.equal(placar([]).total, 0);
});

test('as quatro ondas do cronograma aparecem, mesmo as sem ação', () => {
  // Sumir faria a ausência de plano parecer ausência de onda.
  const ondas = porOnda([derivar(acao({ onda: 1 }), '2026-10-20')]);
  assert.equal(ondas.length, 4);
  assert.deepEqual(ondas.map((o) => o.onda), [1, 2, 3, 4]);
  assert.equal(ondas[0]!.total, 1);
  assert.equal(ondas[1]!.total, 0);
  assert.equal(ondas[1]!.pct_concluido, null);
  assert.equal(ondas[0]!.em_producao, true, 'a 1ª onda já virou');
  assert.equal(ondas[1]!.em_producao, false);
});

// ------------------------------------------------------------ a persistência

test('a carga substitui o plano, e não soma ao que havia', () => {
  // O arquivo é a íntegra do plano. Mesclar faria uma ação removida do
  // documento continuar cobrando prazo na tela para sempre.
  const { ctx } = ambienteLimpo();
  substituirPlano(ctx, [acao({ numero: 1 }), acao({ numero: 2 }), acao({ numero: 3 })]);
  assert.equal(acoesDoCliente(ctx).length, 3);

  const r = substituirPlano(ctx, [acao({ numero: 1 })]);
  assert.equal(r.removidas, 3);
  assert.equal(r.gravadas, 1);
  assert.equal(acoesDoCliente(ctx).length, 1);
});

test('nenhum derivado vai para o banco', () => {
  const { ctx } = ambienteLimpo();
  substituirPlano(ctx, [acao()]);
  const colunas = (acoesDoCliente(ctx)[0] ?? {}) as Record<string, unknown>;
  for (const proibida of ['farol', 'situacao', 'farol_rotulo', 'dias_para_prazo', 'qtd_dias']) {
    assert.ok(!(proibida in colunas), `"${proibida}" é derivado e não pode ser lido do banco`);
  }
});

test('status fora da lista é gravado como "não iniciado"', () => {
  const { ctx } = ambienteLimpo();
  substituirPlano(ctx, [acao({ status: 'Aguardando terceiro' })]);
  assert.equal(acoesDoCliente(ctx)[0]!.status, 'Não iniciado');
});

test('o plano de um cliente não vaza para outro', () => {
  const { ctx } = ambienteLimpo();
  substituirPlano(ctx, [acao({ numero: 1 }), acao({ numero: 2 })]);

  const outra = criarEmpresa(ctx.usuarioId, { nome: 'Outro Contratante' });
  const alheio = contextoDe(ctx, outra.id);
  assert.notEqual(alheio.clienteId, ctx.clienteId, 'são clientes diferentes');
  assert.equal(acoesDoCliente(alheio).length, 0);

  substituirPlano(alheio, [acao({ numero: 9 })]);
  assert.equal(acoesDoCliente(ctx).length, 2, 'a carga do vizinho não apagou o nosso');
  assert.equal(acoesDoCliente(alheio).length, 1);
});

test('o painel devolve placar, ondas e ações derivadas contra o dia pedido', () => {
  const { ctx } = ambienteLimpo();
  substituirPlano(ctx, [
    acao({ numero: 1, status: 'Concluído', fim: '2026-09-15' }),
    acao({ numero: 2, status: 'Em andamento', fim: '2026-10-15' }),
    acao({ numero: 3, onda: 2, status: 'Não iniciado', fim: '2026-11-30' }),
  ]);

  const p = painel(ctx, '2026-10-20');
  assert.equal(p.hoje, '2026-10-20');
  assert.equal(p.placar.total, 3);
  assert.equal(p.placar.atrasadas, 1, 'a nº 2 venceu em 15/10');
  assert.equal(p.ondas.length, 4);
  assert.equal(p.ondas[0]!.total, 2);
  assert.equal(p.ondas[1]!.total, 1);
  assert.ok(p.acoes.every((a) => 'farol' in a && 'situacao' in a));

  // O mesmo plano, medido antes: a nº 2 ainda não tinha vencido.
  const antes = painel(ctx, '2026-10-01');
  assert.equal(antes.placar.atrasadas, 0);
  assert.equal(antes.placar.em_andamento, 1);
});

test('remover o plano devolve quantas ações saíram', () => {
  const { ctx } = ambienteLimpo();
  substituirPlano(ctx, [acao({ numero: 1 }), acao({ numero: 2 })]);
  assert.equal(removerPlano(ctx), 2);
  assert.equal(acoesDoCliente(ctx).length, 0);
  assert.equal(removerPlano(ctx), 0, 'remover de novo não é erro');
});

test('a mesma onda e o mesmo número não entram duas vezes', () => {
  // A identidade é (cliente, onda, nº): é como o cliente numera, e das duas
  // linhas repetidas não há como saber qual é a boa.
  const { ctx } = ambienteLimpo();
  assert.throws(
    () => substituirPlano(ctx, [acao({ numero: 7 }), acao({ numero: 7, tarefa: 'Outra' })]),
    /UNIQUE/,
  );
  assert.equal(acoesDoCliente(ctx).length, 0, 'a transação não deixou meio plano gravado');
});
