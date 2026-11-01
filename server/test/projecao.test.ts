/**
 * O motor de projeção: o que continua acontecendo se nada mudar.
 *
 * O que se prova aqui é a regra que o gestor pediu, nas quatro arestas em que
 * ela pode errar sem ninguém notar: um reajuste não pode virar um segundo
 * contrato; um mês já lançado não pode receber projeção por cima; a vigência
 * tem de encerrar de verdade; e o mês corrente tem de ficar INTEIRO — o que
 * foi lançado conta, e o que faltou entra projetado.
 *
 * O motor é puro: recebe ocorrências e devolve contratos e parcelas. Por isso
 * estes testes não tocam banco nenhum — eles medem a regra, não o SQL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chaveDoContrato,
  contratosDe,
  horizonte,
  projetadoPorMes,
  projetar,
  valeEm,
  type OcorrenciaFixa,
} from '../src/domain/projecao.js';

/** Uma ocorrência com o mínimo preenchido; cada teste muda só o que importa. */
const oc = (p: Partial<OcorrenciaFixa> & { competencia: string }): OcorrenciaFixa => ({
  empresaId: 1,
  filialId: null,
  tipoDespesaId: 7,
  fornecedor: 'TOTVS',
  descricao: 'Licença ERP',
  cenario: 'oficial',
  valorCentavos: 100_000,
  ...p,
});

// ---------------------------------------------------------------- identidade

test('reajuste é o MESMO contrato, mais caro — e projeta o preço novo', () => {
  const contratos = contratosDe([
    oc({ competencia: '2026-01', valorCentavos: 100_000 }),
    oc({ competencia: '2026-02', valorCentavos: 100_000 }),
    oc({ competencia: '2026-03', valorCentavos: 115_000 }), // reajuste
  ]);
  assert.equal(contratos.length, 1, 'o valor não pode fazer parte da identidade do contrato');
  assert.equal(contratos[0]!.valorCentavos, 115_000, 'projeta o preço que vale hoje, não o antigo');
  assert.equal(contratos[0]!.ultimaOcorrencia, '2026-03');
  assert.equal(contratos[0]!.primeiraOcorrencia, '2026-01');
  assert.equal(contratos[0]!.ocorrencias, 3);
});

test('a chave ignora espaço e caixa, que a planilha do cliente não padroniza', () => {
  assert.equal(
    chaveDoContrato(oc({ competencia: '2026-01', fornecedor: '  TOTVS  ' })),
    chaveDoContrato(oc({ competencia: '2026-02', fornecedor: 'totvs' })),
  );
});

test('fornecedor, filial, tipo e cenário diferentes são contratos diferentes', () => {
  const contratos = contratosDe([
    oc({ competencia: '2026-01' }),
    oc({ competencia: '2026-01', fornecedor: 'Outro' }),
    oc({ competencia: '2026-01', filialId: 9 }),
    oc({ competencia: '2026-01', tipoDespesaId: 8 }),
    oc({ competencia: '2026-01', cenario: 'otimista' }),
  ]);
  assert.equal(contratos.length, 5);
});

// ----------------------------------------------------------------- vigência

test('sem vigência, o contrato projeta indefinidamente', () => {
  const [c] = contratosDe([oc({ competencia: '2026-03' })]);
  assert.equal(c!.recorrenciaAte, null, 'a ausência de vigência significa "em aberto"');
  assert.equal(valeEm(c!, '2030-12'), true);
});

test('a vigência encerra: o mês seguinte a ela não projeta', () => {
  const [c] = contratosDe([oc({ competencia: '2026-03', recorrenciaAte: '2026-06' })]);
  assert.equal(valeEm(c!, '2026-06'), true, 'o mês da vigência ainda vale');
  assert.equal(valeEm(c!, '2026-07'), false);
  const meses = [...projetadoPorMes([c!], '2026-04', '2026-12').keys()].sort();
  assert.deepEqual(meses, ['2026-04', '2026-05', '2026-06']);
});

test('a vigência declarada MAIS RECENTE é a que vale', () => {
  // A ordem de chegada não pode decidir: a linha de março chega depois na
  // lista, mas é a de maio que carrega a última palavra.
  const [c] = contratosDe([
    oc({ competencia: '2026-05', recorrenciaAte: '2026-12' }),
    oc({ competencia: '2026-03', recorrenciaAte: '2026-06' }),
  ]);
  assert.equal(c!.recorrenciaAte, '2026-12');
});

test('projeção nunca anda para trás: antes da última ocorrência, não vale', () => {
  const [c] = contratosDe([oc({ competencia: '2026-05' })]);
  assert.equal(valeEm(c!, '2026-04'), false, 'projetar para trás inventaria despesa num passado já medido');
  assert.equal(valeEm(c!, '2026-05'), true);
});

// ------------------------------------------------- linha real vence projeção

test('mês que já tem a linha do contrato NÃO recebe a projeção dele', () => {
  const [c] = contratosDe([
    oc({ competencia: '2026-01' }),
    oc({ competencia: '2026-02' }),
    oc({ competencia: '2026-04' }), // lançado adiantado; março ficou vazio
  ]);
  const meses = [...projetadoPorMes([c!], '2026-01', '2026-06').keys()].sort();
  assert.deepEqual(meses, ['2026-05', '2026-06'],
    'abril já tem linha real, e março é anterior à última ocorrência');
  // A prova de que ninguém é contado duas vezes: nenhuma parcela projetada
  // cai num mês que o contrato já tem gravado.
  for (const p of projetar([c!], '2026-01', '2026-12')) {
    assert.equal(c!.lancados.has(p.competencia), false, `projetou por cima de ${p.competencia}`);
  }
});

test('lançar adiantado não é punido: o mês com linha real sai da projeção', () => {
  const [c] = contratosDe([
    oc({ competencia: '2026-06' }),
    oc({ competencia: '2026-07' }), // o gestor já lançou julho
  ]);
  const mapa = projetadoPorMes([c!], '2026-06', '2026-08');
  assert.equal(mapa.has('2026-06'), false);
  assert.equal(mapa.has('2026-07'), false);
  assert.equal(mapa.get('2026-08')?.centavos, 100_000);
});

// --------------------------------------------------------- o mês corrente

test('o mês corrente fica INTEIRO: o lançado conta, o que faltou é projetado', () => {
  // Dois contratos. Em 2026-06 (o corrente) só um deles foi lançado.
  const contratos = contratosDe([
    oc({ competencia: '2026-05', fornecedor: 'TOTVS', valorCentavos: 100_000 }),
    oc({ competencia: '2026-06', fornecedor: 'TOTVS', valorCentavos: 100_000 }),
    oc({ competencia: '2026-05', fornecedor: 'Claro', valorCentavos: 40_000 }),
  ]);
  const { de, ate } = horizonte('2026-06');
  assert.equal(de, '2026-06', 'o horizonte começa no mês corrente, que é completado e não ignorado');
  assert.equal(ate, '2027-06');

  const junho = projetadoPorMes(contratos, de, ate).get('2026-06');
  assert.equal(junho?.contratos, 1, 'só o que faltou entra projetado');
  assert.equal(junho?.centavos, 40_000, 'a TOTVS já está lançada em junho; a Claro é que falta');
});

test('mês corrente sem nada lançado recebe a projeção dos dois contratos', () => {
  const contratos = contratosDe([
    oc({ competencia: '2026-05', fornecedor: 'TOTVS', valorCentavos: 100_000 }),
    oc({ competencia: '2026-05', fornecedor: 'Claro', valorCentavos: 40_000 }),
  ]);
  const junho = projetadoPorMes(contratos, ...(Object.values(horizonte('2026-06')) as [string, string]))
    .get('2026-06');
  assert.equal(junho?.contratos, 2);
  assert.equal(junho?.centavos, 140_000, 'é o pedido do gestor: mês sem lançamento existe como projeção');
});

// -------------------------------------------------------------------- bordas

test('sem ocorrência nenhuma, não há contrato nem projeção', () => {
  assert.deepEqual(contratosDe([]), []);
  assert.deepEqual(projetar([], '2026-01', '2026-12'), []);
});

test('intervalo invertido devolve vazio em vez de explodir', () => {
  const [c] = contratosDe([oc({ competencia: '2026-01' })]);
  assert.deepEqual(projetar([c!], '2026-12', '2026-01'), []);
});

test('o contrato encerrado antes do horizonte não projeta nada', () => {
  const [c] = contratosDe([oc({ competencia: '2026-01', recorrenciaAte: '2026-02' })]);
  assert.equal(projetadoPorMes([c!], '2026-06', '2027-06').size, 0);
});
