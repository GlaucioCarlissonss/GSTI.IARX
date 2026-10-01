/**
 * A conciliação que impede a carga de dobrar a base.
 *
 * O que se prova aqui: o que já existe é reconhecido como igual; o que existe
 * com campo faltando entra como atualização, dizendo QUAL campo; o que não
 * existe é novo; cinco cobranças do mesmo valor no mesmo dia continuam cinco;
 * o documento manda sobre a ordem; e o que está na base e não veio na carga
 * aparece como sobra, em vez de sumir em silêncio.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, idTipoDespesa, mesRelativo } from './apoio.js';
import { db } from '../src/db/index.js';
import { criarLancamento } from '../src/domain/financeiro.js';
import { conciliarLancamentos, type LinhaResolvida } from '../src/domain/conciliacao-lancamentos.js';
import type { Contexto } from '../src/domain/contexto.js';

const COMP = mesRelativo(0);
const INTERNA = `${COMP.slice(3)}-${COMP.slice(0, 2)}`;

function naBase(ctx: Contexto, valor: number, extra: Record<string, unknown> = {}) {
  const criado = criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: COMP,
    valor,
    natureza: 'fixa',
    classificacao: 'despesa',
    descricao: String(extra.descricao ?? 'Linha da base'),
  });
  if (extra.documento !== undefined) {
    db().prepare('UPDATE lancamentos SET documento = ? WHERE id = ?').run(extra.documento, criado.id);
  }
  return criado.id;
}

function daCarga(ctx: Contexto, linha: number, valor: number, extra: Partial<LinhaResolvida> = {}): LinhaResolvida {
  return {
    linha,
    empresaId: ctx.empresaId,
    filialId: null,
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: INTERNA,
    valorCentavos: Math.round(valor * 100),
    descricao: 'Da carga',
    documento: '',
    fornecedor: 'VIVO',
    dataPagamento: null,
    usuarioOrigem: 'MIQUEIASSILVA',
    reconhecido: false,
    ...extra,
  };
}

test('o que já está na base não entra de novo', () => {
  const { ctx } = ambienteLimpo();
  const id = naBase(ctx, 100, { descricao: 'Da carga' });

  const r = conciliarLancamentos(ctx.clienteId!, [
    daCarga(ctx, 2, 100, { fornecedor: '', usuarioOrigem: '' }),
  ]);
  assert.equal(r.novo, 0, 'importar isto duplicaria a base');
  assert.equal(r.igual, 1);
  assert.equal(r.itens[0]!.lancamentoId, id);
});

test('o que existe com campo faltando vira atualização, e diz qual campo', () => {
  const { ctx } = ambienteLimpo();
  naBase(ctx, 250, { descricao: 'Da carga' });

  const r = conciliarLancamentos(ctx.clienteId!, [
    daCarga(ctx, 2, 250, { documento: '3014', usuarioOrigem: 'KAUAROCHA', reconhecido: true }),
  ]);
  assert.equal(r.atualiza, 1);
  assert.deepEqual(r.itens[0]!.diferencas.sort(), ['documento', 'fornecedor', 'reconhecido', 'usuario_origem']);
});

test('o que a base não tem é novo', () => {
  const { ctx } = ambienteLimpo();
  naBase(ctx, 100);

  const r = conciliarLancamentos(ctx.clienteId!, [daCarga(ctx, 2, 999)]);
  assert.equal(r.novo, 1);
  assert.equal(r.itens[0]!.lancamentoId, null);
});

test('cinco cobranças do mesmo valor no mesmo dia continuam cinco', () => {
  const { ctx } = ambienteLimpo();
  // A base tem as cinco, sem documento — é o estado real dos 1.898.
  const ids = [0, 1, 2, 3, 4].map(() => naBase(ctx, 574.55));

  const linhas = ['2037842770', '2031289657', '2024729762', '2011393556', '2004566312'].map((doc, i) =>
    daCarga(ctx, i + 2, 574.55, { documento: doc, fornecedor: '', usuarioOrigem: '' }),
  );
  const r = conciliarLancamentos(ctx.clienteId!, linhas);

  assert.equal(r.novo, 0, 'nenhuma das cinco é nova');
  assert.equal(r.atualiza, 5, 'as cinco ganham o número do documento');
  assert.equal(r.pareados_por_ordem, 5, 'sem documento na base, o par é por ordem');
  assert.deepEqual(
    r.itens.map((i) => i.lancamentoId),
    ids,
    'cada linha consome um lançamento distinto',
  );
});

test('o documento manda sobre a ordem', () => {
  const { ctx } = ambienteLimpo();
  naBase(ctx, 300, { documento: '1106' });
  const segundo = naBase(ctx, 300, { documento: '1107' });

  // A carga traz o 1107 primeiro: o par tem de ser por documento, não pela
  // ordem em que a base os devolve.
  const r = conciliarLancamentos(ctx.clienteId!, [
    daCarga(ctx, 2, 300, { documento: '1107', fornecedor: '', usuarioOrigem: '' }),
  ]);
  assert.equal(r.itens[0]!.lancamentoId, segundo);
  assert.equal(r.itens[0]!.pareadoPor, 'documento');
});

test('cobrança de documento diferente não rouba o par de outra', () => {
  const { ctx } = ambienteLimpo();
  naBase(ctx, 300, { documento: '1106' });

  // A base já tem o 1106; a carga traz o 1107, do mesmo valor. São duas
  // cobranças, e parear seria perder uma.
  const r = conciliarLancamentos(ctx.clienteId!, [daCarga(ctx, 2, 300, { documento: '1107' })]);
  assert.equal(r.novo, 1);
});

test('o que está na base e não veio na carga aparece como sobra', () => {
  const { ctx } = ambienteLimpo();
  naBase(ctx, 100, { descricao: 'Lançado à mão, não existe no ERP' });
  naBase(ctx, 200, { descricao: 'Da carga' });

  const r = conciliarLancamentos(ctx.clienteId!, [daCarga(ctx, 2, 200, { fornecedor: '', usuarioOrigem: '' })]);
  assert.equal(r.igual, 1);
  assert.equal(r.sobras_na_base.length, 1);
  assert.match(String(r.sobras_na_base[0]!.descricao), /à mão/);
});

test('a conciliação olha só as competências que a carga cobre', () => {
  const { ctx } = ambienteLimpo();
  // Lançamento de outro mês: não é sobra desta carga, e não pode ser contado.
  const outroMes = criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(1),
    valor: 400,
    natureza: 'fixa',
    classificacao: 'despesa',
    descricao: 'Mês que vem',
  });
  naBase(ctx, 200, { descricao: 'Da carga' });

  const r = conciliarLancamentos(ctx.clienteId!, [daCarga(ctx, 2, 200, { fornecedor: '', usuarioOrigem: '' })]);
  assert.equal(r.sobras_na_base.length, 0);
  assert.ok(outroMes.id);
});

test('carga vazia não acusa nada', () => {
  const { ctx } = ambienteLimpo();
  naBase(ctx, 100);
  const r = conciliarLancamentos(ctx.clienteId!, []);
  assert.deepEqual([r.total, r.igual, r.atualiza, r.novo, r.sobras_na_base.length], [0, 0, 0, 0, 0]);
});
