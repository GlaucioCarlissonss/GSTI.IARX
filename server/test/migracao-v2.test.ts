/**
 * A migração das Fases 2 e 3 sobre um banco que já existia.
 *
 * Toda esta entrega repousa numa promessa: nenhuma instalação muda de número
 * ao receber o código novo. O lançamento que já estava lá é `integral`, o
 * termômetro segue no 80, e o prazo dos chamados continua o que era. É isso
 * que se prova aqui — e mais: que `migrar()` roda duas vezes sem reclamar, que
 * é como ela roda de verdade (a cada abertura do banco).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ambienteLimpo, idTipoDespesa, mesRelativo } from './apoio.js';
import { criarLancamento, listarLancamentos } from '../src/domain/financeiro.js';
import { conformidadeSla } from '../src/domain/indicadores.js';
import { despesaCentralizada } from '../src/domain/indicadores.js';
import { db, migrar } from '../src/db/index.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCHEMA = resolve(AQUI, '../src/db/schema.sql');

test('migrar() roda duas vezes seguidas sem erro', () => {
  // É assim que ela roda de verdade: `abrirBanco` executa o schema e a
  // migração a cada abertura, e uma segunda passagem não pode quebrar nada.
  const banco = new Database(':memory:');
  banco.pragma('foreign_keys = ON');
  banco.exec(readFileSync(SCHEMA, 'utf8'));
  migrar(banco as unknown as Parameters<typeof migrar>[0]);
  migrar(banco as unknown as Parameters<typeof migrar>[0]);

  const colunas = (tabela: string) =>
    (banco.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string }>).map((c) => c.name);
  assert.ok(colunas('lancamentos').includes('tipo_consumo'));
  assert.ok(colunas('lancamentos').includes('beneficia_todas'));
  assert.ok(colunas('tickets_sla').includes('prazo_do_acordo'));
  // Uma coluna por nome, e não duas: é o que a segunda passagem testa.
  assert.equal(colunas('lancamentos').filter((c) => c === 'tipo_consumo').length, 1);
  banco.close();
});

test('as tabelas novas nascem com a abertura do banco', () => {
  ambienteLimpo();
  const tabelas = new Set(
    (db().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
      (t) => t.name,
    ),
  );
  for (const nova of ['metas', 'slas', 'lancamento_beneficiadas', 'ticket_reclassificacoes', 'planos_reducao']) {
    assert.ok(tabelas.has(nova), `falta a tabela ${nova}`);
  }
});

test('o lançamento que já existia continua lido como era', () => {
  const { ctx } = ambienteLimpo();
  // Escrito por fora do domínio, como está no banco de quem já usa o sistema:
  // sem nenhuma das colunas novas.
  db()
    .prepare(
      `INSERT INTO lancamentos (empresa_id, tipo_despesa_id, competencia, valor_centavos, natureza, classificacao)
       VALUES (?, ?, ?, ?, 'fixa', 'despesa')`,
    )
    .run(ctx.empresaId, idTipoDespesa(ctx), '2026-01', 100000);

  const [linha] = listarLancamentos(ctx, {}).itens;
  assert.equal(linha!.tipo_consumo, 'integral', 'o padrão da coluna é a leitura que o sistema já fazia');
  assert.equal(linha!.beneficia_todas, false);
  assert.deepEqual(linha!.filiais_beneficiadas, []);

  // E não entra no indicador de despesa centralizada, que é o correto: ele
  // conta o que foi CLASSIFICADO como compartilhado, e nada foi.
  const r = despesaCentralizada(ctx, {});
  assert.equal(r.centralizado, 0);
  assert.equal(r.pct_centralizado, 0);
});

test('o termômetro de uma base sem meta cadastrada continua no 80', () => {
  const { ctx } = ambienteLimpo();
  criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(0),
    valor: 100,
    natureza: 'fixa',
    classificacao: 'despesa',
  });
  assert.equal(conformidadeSla(ctx, {}).meta, 80);
});
