/**
 * A meta quando o recorte ATRAVESSA vigências.
 *
 * O cadastro de metas tem vigência e o recorte de um indicador é um PERÍODO:
 * pedir 01/2026 a 01/2027 pode cair sob duas metas diferentes. O sistema
 * escolhia uma só — a que regia o ÚLTIMO mês — e julgava o período inteiro por
 * ela: treze meses medidos contra uma regra que valia para cinco, e a outra
 * meta sumia da tela sem explicação.
 *
 * O que se prova aqui é a leitura mês a mês, e o limite dela: com uma meta só
 * (o caso comum) nada muda de forma.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo } from './apoio.js';
import {
  atualizarMeta,
  criarMeta,
  leituraMensalDeMeta,
  metasDoRecorte,
  type LeituraMeta,
  type LeituraMetaMensal,
} from '../src/domain/metas.js';
import type { Contexto } from '../src/domain/contexto.js';

const ehMensal = (l: unknown): l is LeituraMetaMensal =>
  !!l && typeof l === 'object' && 'varias' in (l as Record<string, unknown>);

/** As duas metas da tela do gestor: uma até 08/2026, outra de 08/2026 em diante. */
function duasMetas(ctx: Contexto) {
  criarMeta(ctx, {
    nome: 'Glaucio', modulo: 'financeiro', alvo_pct: 90,
    vigencia_inicio: '01/2026', vigencia_fim: '08/2026',
  });
  criarMeta(ctx, {
    nome: 'TESTE', modulo: 'financeiro', alvo_pct: 1,
    vigencia_inicio: '08/2026', vigencia_fim: null,
  });
}

const meses = (...cs: string[]) => cs.map((c) => ({ competencia: c, valor: 0 }));

test('as duas metas do período aparecem, e na ordem da vigência', () => {
  const { ctx } = ambienteLimpo();
  duasMetas(ctx);

  const achadas = metasDoRecorte(ctx, 'financeiro', ['2026-01', '2026-06', '2026-10', '2027-01']);
  assert.deepEqual(achadas.map((m) => m.nome), ['Glaucio', 'TESTE']);
});

test('cada mês é medido contra a meta que rege AQUELE mês', () => {
  const { ctx } = ambienteLimpo();
  duasMetas(ctx);

  // Financeiro é TETO: atinge quem fica ABAIXO do alvo.
  const leitura = leituraMensalDeMeta(ctx, 'financeiro', [
    { competencia: '2026-02', valor: 50 },   // teto 90 -> dentro
    { competencia: '2026-06', valor: 95 },   // teto 90 -> fora
    { competencia: '2026-10', valor: 0.5 },  // teto 1  -> dentro
    { competencia: '2026-12', valor: 8 },    // teto 1  -> fora
  ], 12);

  assert.ok(ehMensal(leitura));
  assert.equal(leitura.total, 4);
  assert.equal(leitura.dentro, 2);
  assert.equal(leitura.atinge, false, 'com um mês fora, o período não atingiu');
  assert.deepEqual(leitura.meses.map((m) => m.alvo), [90, 90, 1, 1]);
  assert.deepEqual(leitura.metas.map((m) => m.nome), ['Glaucio', 'TESTE']);
});

test('recorte inteiro sob UMA meta continua sendo a comparação de sempre', () => {
  const { ctx } = ambienteLimpo();
  duasMetas(ctx);

  // Só meses de 2026-09 em diante: apenas a "TESTE" rege.
  const leitura = leituraMensalDeMeta(ctx, 'financeiro', meses('2026-09', '2026-10', '2026-11'), 0.4);
  assert.ok(!ehMensal(leitura), 'não vira placar de meses quando há uma meta só');
  const simples = leitura as LeituraMeta;
  assert.equal(simples.alvo, 1);
  assert.equal(simples.atingido, 0.4);
  assert.equal(simples.atinge, true);
});

test('todos os meses dentro: o período atinge', () => {
  const { ctx } = ambienteLimpo();
  duasMetas(ctx);

  const leitura = leituraMensalDeMeta(ctx, 'financeiro', [
    { competencia: '2026-02', valor: 10 },
    { competencia: '2026-10', valor: 0.2 },
  ], 5);
  assert.ok(ehMensal(leitura));
  assert.equal(leitura.dentro, 2);
  assert.equal(leitura.atinge, true);
});

test('mês sem resultado não conta nem a favor nem contra', () => {
  const { ctx } = ambienteLimpo();
  duasMetas(ctx);

  const leitura = leituraMensalDeMeta(ctx, 'financeiro', [
    { competencia: '2026-02', valor: 10 },
    { competencia: '2026-06', valor: null },
    { competencia: '2026-10', valor: 0.2 },
  ], 5);
  assert.ok(ehMensal(leitura));
  assert.equal(leitura.total, 2, 'o mês sem valor fica de fora do placar');
  assert.equal(leitura.dentro, 2);
});

test('SLA é PISO: atinge quem fica acima do alvo', () => {
  const { ctx } = ambienteLimpo();
  criarMeta(ctx, { nome: 'Antes', modulo: 'sla', alvo_pct: 70, vigencia_inicio: '01/2026', vigencia_fim: '06/2026' });
  criarMeta(ctx, { nome: 'Depois', modulo: 'sla', alvo_pct: 95, vigencia_inicio: '07/2026', vigencia_fim: null });

  const leitura = leituraMensalDeMeta(ctx, 'sla', [
    { competencia: '2026-03', valor: 80 },  // piso 70 -> dentro
    { competencia: '2026-09', valor: 80 },  // piso 95 -> fora
  ], 80);
  assert.ok(ehMensal(leitura));
  assert.equal(leitura.direcao, 'minimo');
  assert.deepEqual(leitura.meses.map((m) => m.atinge), [true, false]);
});

test('sem meta nenhuma, o módulo sem alvo padrão não inventa comparação', () => {
  const { ctx } = ambienteLimpo();
  // 'financeiro' não tem alvo de base: sem cadastro, não há o que comparar.
  assert.equal(leituraMensalDeMeta(ctx, 'financeiro', meses('2026-01', '2026-02'), 3), null);
});

test('meta desativada sai da conta, e a outra assume o mês', () => {
  const { ctx } = ambienteLimpo();
  duasMetas(ctx);
  const glaucio = metasDoRecorte(ctx, 'financeiro', ['2026-03'])[0]!;
  assert.equal(glaucio.nome, 'Glaucio');

  atualizarMeta(ctx, glaucio.id, { ativo: false } as never);

  // 03/2026 ficava sob a "Glaucio". Desativada, e como a "TESTE" só vale de
  // 08/2026, aquele mês passa a não ter meta nenhuma — e não pode herdar uma.
  assert.deepEqual(metasDoRecorte(ctx, 'financeiro', ['2026-03']), []);
  assert.deepEqual(metasDoRecorte(ctx, 'financeiro', ['2026-10']).map((m) => m.nome), ['TESTE']);

  // Com uma meta só sobrando, a leitura volta à forma simples.
  const leitura = leituraMensalDeMeta(ctx, 'financeiro', [
    { competencia: '2026-03', valor: 50 },
    { competencia: '2026-10', valor: 0.5 },
  ], 10);
  assert.ok(!ehMensal(leitura));
});
