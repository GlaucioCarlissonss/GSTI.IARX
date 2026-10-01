/**
 * A integração passou a ser do CLIENTE.
 *
 * O que estas conferências protegem: a configuração que era repetida por
 * matriz vira uma só, a base que já existia não perde o segredo em uso, e o
 * chamado continua caindo na unidade certa — cada uma tem a própria instância
 * do helpdesk, e o mesmo número em duas delas não é o mesmo chamado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ambienteLimpo } from './apoio.js';
import { abrirBanco, db, definirBanco } from '../src/db/index.js';
import { criarEmpresa, empresasAcessiveis } from '../src/domain/empresas.js';
import { clienteDaEmpresa } from '../src/domain/clientes.js';
import {
  autorizarRecebimento,
  definirUrlBase,
  enviarPayloadDeTeste,
  listarEventos,
  listarIntegracoes,
  regenerarSegredo,
} from '../src/domain/integracoes.js';
import { listarChamados } from '../src/domain/suporte.js';
import type { Contexto } from '../src/domain/contexto.js';

function clienteComDuasMatrizes() {
  const { ctx, empresaId: matrizA } = ambienteLimpo();
  const clienteId = clienteDaEmpresa(matrizA)!;
  const matrizB = criarEmpresa(ctx.usuarioId, { nome: 'Segunda Unidade', clienteId }).id;
  const doCliente: Contexto = { ...ctx, empresaIds: empresasAcessiveis(ctx.usuarioId, clienteId) };
  return { ctx: doCliente, clienteId, matrizA, matrizB };
}

test('a integração é uma só para todas as unidades do cliente', () => {
  const { ctx, clienteId, matrizA, matrizB } = clienteComDuasMatrizes();

  const visao = listarIntegracoes(ctx);
  assert.equal(visao.cliente_id, clienteId);
  assert.equal(visao.integracoes.length, 2, 'uma por origem, não uma por unidade');
  // As unidades vêm na resposta: o chamado tem sempre uma de destino, e a tela
  // precisa oferecer a escolha sem depender de um filtro no topo.
  assert.deepEqual(visao.unidades.map((u) => u.id).sort(), [matrizA, matrizB].sort());

  // O segredo girado numa unidade vale para a outra — é o mesmo contrato.
  const segredo = regenerarSegredo(ctx, 'OSTICK').segredo;
  const daOutra = listarIntegracoes({ ...ctx, empresaId: matrizB });
  assert.equal(daOutra.integracoes.find((i) => i.source_system === 'OSTICK')?.tem_segredo, true);
  assert.deepEqual(autorizarRecebimento(clienteId, 'OSTICK', segredo), { ok: true });

  // E a linha de configuração no banco é uma só, não uma por matriz.
  const n = db().prepare('SELECT COUNT(*) AS n FROM integracao_config WHERE cliente_id = ?').get(clienteId) as {
    n: number;
  };
  assert.equal(n.n, 2);
});

test('o chamado de teste cai na unidade escolhida, e o log é do cliente', () => {
  const { ctx, matrizA, matrizB } = clienteComDuasMatrizes();

  enviarPayloadDeTeste(ctx, 'OSTICK', matrizB);
  const naB = listarChamados(ctx, { empresas: [matrizB] });
  const naA = listarChamados(ctx, { empresas: [matrizA] });
  assert.equal(naB.paginacao.total, 1, 'o chamado entrou na unidade escolhida');
  assert.equal(naA.paginacao.total, 0, 'e não na que estava em foco');

  // O log de eventos é do cliente: ver só os da matriz em foco esconderia
  // metade do que aconteceu na mesma conexão.
  assert.equal(listarEventos(ctx).itens.length, 1);
  assert.equal(listarEventos(ctx, { empresas: [matrizA] }).itens.length, 0);
});

test('o endereço do chamado pode vir do cliente, e a unidade ainda sobrepõe', () => {
  const { ctx, matrizB } = clienteComDuasMatrizes();
  definirUrlBase(ctx, 'OSTICK', 'https://helpdesk.exemplo.com/ticket.php?id=');

  enviarPayloadDeTeste(ctx, 'OSTICK', matrizB);
  const chamado = listarChamados(ctx, { empresas: [matrizB] }).itens[0] as Record<string, unknown>;
  assert.match(String(chamado.url_externa), /^https:\/\/helpdesk\.exemplo\.com\/ticket\.php\?id=/);

  // Endereço na unidade vence o do cliente: é a unidade que usa instância própria.
  db()
    .prepare(`INSERT INTO configuracoes (empresa_id, chave, valor) VALUES (?, 'url_helpdesk', ?)
              ON CONFLICT(empresa_id, chave) DO UPDATE SET valor = excluded.valor`)
    .run(matrizB, 'https://outro.exemplo.com/x?id=');
  const depois = listarChamados(ctx, { empresas: [matrizB] }).itens[0] as Record<string, unknown>;
  assert.match(String(depois.url_externa), /^https:\/\/outro\.exemplo\.com\/x\?id=/);
});

test('url_base precisa ser um endereço, e não um texto qualquer', () => {
  const { ctx } = clienteComDuasMatrizes();
  assert.throws(() => definirUrlBase(ctx, 'OSTICK', 'helpdesk.exemplo.com'), /http/);
  // Vazio limpa, e não vira string vazia guardada.
  assert.equal(definirUrlBase(ctx, 'OSTICK', '').url_base, null);
});

test('a base anterior não perde o segredo em uso ao subir a integração para o cliente', () => {
  // Uma base no formato ANTIGO: configuração por matriz, duas matrizes do mesmo
  // cliente, cada uma com a sua linha de OSTICK — e só uma delas em uso.
  const pasta = mkdtempSync(join(tmpdir(), 'gsti-migracao-'));
  const caminho = join(pasta, 'base.sqlite');
  try {
    const antigo = new Database(caminho);
    antigo.exec(`
      CREATE TABLE clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE,
                             documento TEXT, ativo INTEGER NOT NULL DEFAULT 1,
                             criado_em TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE empresas (id INTEGER PRIMARY KEY AUTOINCREMENT, cliente_id INTEGER, nome TEXT NOT NULL,
                             status TEXT NOT NULL DEFAULT 'ativa',
                             criado_em TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE integracao_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        empresa_id INTEGER NOT NULL,
        source_system TEXT NOT NULL,
        webhook_path TEXT NOT NULL,
        secret_hash TEXT,
        ativo INTEGER NOT NULL DEFAULT 1,
        ultimo_evento_em TEXT,
        ultimo_erro TEXT,
        criado_em TEXT NOT NULL DEFAULT (datetime('now')),
        atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (empresa_id, source_system));
      INSERT INTO clientes (id, nome) VALUES (1, 'Contratante Antigo');
      INSERT INTO empresas (id, cliente_id, nome) VALUES (1, 1, 'Matriz A'), (2, 1, 'Matriz B');
      -- A da matriz 2 é a que o N8N usa: tem segredo e evento recente.
      INSERT INTO integracao_config (empresa_id, source_system, webhook_path, secret_hash, ultimo_evento_em)
      VALUES (1, 'OSTICK', '/api/webhooks/ostick/tickets', NULL, NULL),
             (2, 'OSTICK', '/api/webhooks/ostick/tickets', 'hash-em-uso', '2026-09-01 10:00:00'),
             (1, 'BITRIX24', '/api/webhooks/bitrix24/tickets', NULL, NULL);
    `);
    antigo.close();

    const migrado = abrirBanco(caminho);
    definirBanco(migrado);

    const colunas = (migrado.prepare('PRAGMA table_info(integracao_config)').all() as Array<{ name: string }>)
      .map((c) => c.name);
    assert.ok(colunas.includes('cliente_id'), 'a dona virou o cliente');
    assert.ok(!colunas.includes('empresa_id'), 'e a matriz deixou de ser dona');

    const linhas = migrado
      .prepare('SELECT cliente_id, source_system, secret_hash FROM integracao_config ORDER BY source_system')
      .all() as Array<{ cliente_id: number; source_system: string; secret_hash: string | null }>;
    assert.deepEqual(linhas, [
      { cliente_id: 1, source_system: 'BITRIX24', secret_hash: null },
      // Das duas linhas de OSTICK ficou a que estava EM USO: descartar a que
      // nunca recebeu nada não perde nada; descartar a ativa quebraria a
      // integração em produção.
      { cliente_id: 1, source_system: 'OSTICK', secret_hash: 'hash-em-uso' },
    ]);

    // Reabrir de novo não muda nada: a migração é idempotente.
    migrado.close();
    const outraVez = abrirBanco(caminho);
    definirBanco(outraVez);
    const n = outraVez.prepare('SELECT COUNT(*) AS n FROM integracao_config').get() as { n: number };
    assert.equal(n.n, 2);
    outraVez.close();
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});
