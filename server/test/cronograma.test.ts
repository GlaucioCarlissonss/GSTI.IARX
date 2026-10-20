/**
 * O CRONOGRAMA DE ONDAS no servidor.
 *
 * Estas regras existem duas vezes — aqui e em `artifact/app-js21.js` —, e é
 * por isso que precisam de conferência própria: duas cópias divergem na
 * primeira correção feita de um lado só, e a divergência é silenciosa. Os dois
 * lados continuam desenhando um cronograma plausível, e ninguém descobre até
 * um gestor comparar o celular com o navegador na frente do outro.
 *
 * O cronograma é puro: nenhuma leitura de banco, nenhuma data de sistema. A
 * data de corte entra por parâmetro, que é o que permite medir agosto sem
 * contaminar com o que foi declarado em outubro.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ONDAS, PACIENTES_TOTAL, cronograma, entregaAte, unidadesDaOnda,
} from '../src/domain/cronograma.js';

test('o cronograma tem quatro ondas, e as 17 unidades', () => {
  assert.equal(ONDAS.length, 4);
  assert.equal(ONDAS.reduce((s, o) => s + o.unidades.length, 0), 17);
  assert.equal(PACIENTES_TOTAL, 1922);
});

test('a 1ª onda é Porto Velho e Rio, e não a Paraíba', () => {
  // A inversão é o erro que o cronograma antigo carregava, e o motivo de esta
  // conferência existir: a tela afirmava que a Paraíba virou em 01/10.
  const primeira = ONDAS[0]!;
  assert.equal(primeira.virada, '2026-10-01');
  assert.ok(primeira.unidades.some((u) => /Porto Velho/.test(u)));
  assert.ok(primeira.unidades.some((u) => /Rio de Janeiro/.test(u)));
  assert.ok(!primeira.unidades.some((u) => /PB$/.test(u)));

  const paraiba = ONDAS.find((o) => o.unidades.some((u) => /PB$/.test(u)));
  assert.equal(paraiba?.n, 2);
  assert.equal(paraiba?.virada, '2026-11-03');

  const sp = ONDAS.find((o) => o.unidades.some((u) => /São Paulo/.test(u)));
  assert.equal(sp?.n, 4, 'São Paulo saiu de outubro e foi para janeiro');
});

test('a virada declarada vale como fato, e respeita a data de corte', () => {
  const primeira = ONDAS[0]!;
  // Em outubro ela já virou.
  const emOutubro = unidadesDaOnda(primeira, '2026-10-31');
  assert.equal(emOutubro.length, 2);
  assert.ok(emOutubro.every((u) => u.virou));
  assert.ok(emOutubro.every((u) => u.estado === 'CUMPRIDO'));
  assert.ok(emOutubro.every((u) => u.realizada === '2026-10-01'));

  // Em AGOSTO, não: olhar o passado não pode mostrar o que ainda não tinha
  // acontecido. É o erro mais fácil de cometer aqui, e o mais difícil de ver.
  const emAgosto = unidadesDaOnda(primeira, '2026-08-31');
  assert.ok(emAgosto.every((u) => !u.virou));
  assert.ok(emAgosto.every((u) => u.realizada === null));
  assert.ok(emAgosto.every((u) => u.estado === 'PENDENTE'),
    'antes do prazo é pendente, e não reprovada');
});

test('a onda sem declaração e com prazo vencido não cumpriu', () => {
  const segunda = ONDAS[1]!;
  const depois = unidadesDaOnda(segunda, '2026-12-31');
  assert.ok(depois.every((u) => u.estado === 'NÃO CUMPRIDO'));
  const antes = unidadesDaOnda(segunda, '2026-10-31');
  assert.ok(antes.every((u) => u.estado === 'PENDENTE'));
});

test('a entrega acumula as ondas vencidas até a competência', () => {
  // Antes da 1ª virada não há resultado — e não há zero: zero reprovaria o
  // programa por um prazo que ainda não passou.
  const setembro = entregaAte('2026-09');
  assert.equal(setembro.planejadas, 0);
  assert.equal(setembro.resultado, null);
  assert.equal(setembro.meta, null);

  // Outubro: a 1ª onda venceu e virou.
  const outubro = entregaAte('2026-10');
  assert.equal(outubro.planejadas, 2);
  assert.equal(outubro.viradas, 2);
  assert.equal(outubro.resultado, 100);
  assert.equal(outubro.meta, 100);
  assert.deepEqual(outubro.ondas, [1]);

  // Novembro: entra a 2ª, que venceu em 03/11 e não virou. 2 de 5.
  const novembro = entregaAte('2026-11');
  assert.equal(novembro.planejadas, 5);
  assert.equal(novembro.viradas, 2);
  assert.equal(novembro.resultado, 40);
  assert.deepEqual(novembro.ondas, [1, 2]);
});

test('a entrega lista as unidades que a compõem, com prazo', () => {
  const outubro = entregaAte('2026-10');
  assert.equal(outubro.unidades.length, 2);
  assert.ok(outubro.unidades.every((u) => u.prazo === '2026-10-01'));
  assert.ok(outubro.unidades.every((u) => u.onda === 1));
});

test('o cronograma medido não dá zero para onda que não venceu', () => {
  const c = cronograma('2026-10-20');
  const porN = new Map(c.ondas.map((o) => [o.n, o]));
  assert.equal(porN.get(1)?.resultado, 100);
  assert.equal(porN.get(1)?.estado, 'CUMPRIDO');
  for (const n of [2, 3, 4]) {
    assert.equal(porN.get(n)?.resultado, null, `a ${n}ª onda não venceu: sem resultado`);
    assert.equal(porN.get(n)?.venceu, false);
    assert.equal(porN.get(n)?.estado, 'PENDENTE');
  }
  assert.equal(c.pacientes, 1922);
  assert.equal(c.unidades, 17);
});

test('nenhuma unidade aparece em duas ondas', () => {
  const todas = ONDAS.flatMap((o) => o.unidades);
  assert.equal(new Set(todas).size, todas.length);
});
