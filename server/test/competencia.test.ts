import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  competenciaAtual,
  diferencaEmMeses,
  intervalo,
  paraExibicao,
  paraInterno,
  posicaoTemporal,
  somarMeses,
} from '../src/domain/competencia.js';
import { paraCentavos, ratear } from '../src/domain/dinheiro.js';

test('competência converte entre MM/AAAA e o formato interno ordenável', () => {
  assert.equal(paraInterno('03/2026'), '2026-03');
  assert.equal(paraExibicao('2026-03'), '03/2026');
  assert.equal(paraInterno('2026-03'), '2026-03');
});

test('competência rejeita formatos fora do padrão MM/AAAA', () => {
  for (const invalida of ['13/2026', '3/2026', '2026/03', 'março/2026', '', '00/2026']) {
    assert.throws(() => paraInterno(invalida), /Competência inválida/);
  }
});

test('soma de meses atravessa a virada de ano', () => {
  assert.equal(somarMeses('2026-11', 3), '2027-02');
  assert.equal(somarMeses('2026-02', -3), '2025-11');
  assert.equal(diferencaEmMeses('2026-01', '2027-01'), 12);
  assert.deepEqual(intervalo('2026-11', '2027-01'), ['2026-11', '2026-12', '2027-01']);
});

test('posição temporal separa passado, corrente e futuro', () => {
  const atual = competenciaAtual();
  assert.equal(posicaoTemporal(atual), 'corrente');
  assert.equal(posicaoTemporal(somarMeses(atual, -1)), 'passada');
  assert.equal(posicaoTemporal(somarMeses(atual, 1)), 'futura');
});

test('valores monetários aceitam os formatos usados nas planilhas', () => {
  assert.equal(paraCentavos('1.234,56'), 123456);
  assert.equal(paraCentavos('1,234.56'), 123456);
  assert.equal(paraCentavos('R$ 1.234,56'), 123456);
  assert.equal(paraCentavos(1234.56), 123456);
  assert.equal(paraCentavos('0,1'), 10);
  assert.throws(() => paraCentavos('abc'), /Valor monetário inválido/);
});

test('rateio de parcelas não perde centavos', () => {
  assert.deepEqual(ratear(10000, 3), [3334, 3333, 3333]);
  assert.equal(ratear(10000, 3).reduce((a, b) => a + b, 0), 10000);
  assert.deepEqual(ratear(12000, 4), [3000, 3000, 3000, 3000]);
  for (const total of [1, 7, 99, 100003]) {
    for (const n of [2, 3, 7, 12]) {
      assert.equal(ratear(total, n).reduce((a, b) => a + b, 0), total, `${total}/${n}`);
    }
  }
});
