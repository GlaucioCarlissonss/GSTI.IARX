/**
 * Usuários, perfis e a ESCRITA de auditoria passaram a ser do CLIENTE, não da
 * matriz individual.
 *
 * O que estas conferências protegem: quem já era gestor numa matriz não perde
 * isso ao subir para o cliente; o perfil duplicado em cada matriz vira um só,
 * sem perder nenhuma permissão que alguma cópia já concedia; um campo só
 * continua bloqueado se estava bloqueado em TODAS as cópias; e a trilha
 * antiga, que era só de matriz, ganha o dono certo sem perder nenhuma linha.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { abrirBanco, definirBanco } from '../src/db/index.js';

/** Monta uma base no formato ANTIGO: perfis e acesso por matriz, auditoria sem cliente_id. */
function baseAntiga(caminho: string) {
  const antigo = new Database(caminho);
  antigo.exec(`
    CREATE TABLE usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, username TEXT UNIQUE,
      email TEXT NOT NULL UNIQUE, senha_hash TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1,
      senha_em TEXT, ultimo_login_em TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE,
      documento TEXT, ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE usuario_clientes (usuario_id INTEGER NOT NULL, cliente_id INTEGER NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (usuario_id, cliente_id));
    CREATE TABLE empresas (id INTEGER PRIMARY KEY AUTOINCREMENT, cliente_id INTEGER, nome TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ativa', criado_em TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE usuario_empresas (usuario_id INTEGER NOT NULL, empresa_id INTEGER NOT NULL,
      papel TEXT NOT NULL DEFAULT 'gestor', perfil_id INTEGER, PRIMARY KEY (usuario_id, empresa_id));
    CREATE TABLE perfis (id INTEGER PRIMARY KEY AUTOINCREMENT, empresa_id INTEGER NOT NULL, nome TEXT NOT NULL,
      tipo TEXT NOT NULL, padrao INTEGER NOT NULL DEFAULT 0, criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (empresa_id, nome));
    CREATE TABLE perfil_permissoes (id INTEGER PRIMARY KEY AUTOINCREMENT, perfil_id INTEGER NOT NULL,
      modulo TEXT NOT NULL, acao TEXT NOT NULL, permitido INTEGER NOT NULL DEFAULT 0,
      UNIQUE (perfil_id, modulo, acao));
    CREATE TABLE perfil_campos (id INTEGER PRIMARY KEY AUTOINCREMENT, perfil_id INTEGER NOT NULL,
      modulo TEXT NOT NULL, campo TEXT NOT NULL, pode_editar INTEGER NOT NULL DEFAULT 1,
      UNIQUE (perfil_id, modulo, campo));
    CREATE TABLE auditoria (id INTEGER PRIMARY KEY AUTOINCREMENT, empresa_id INTEGER NOT NULL,
      usuario_id INTEGER, usuario_email TEXT, entidade TEXT NOT NULL, entidade_id INTEGER, acao TEXT NOT NULL,
      justificativa TEXT, dados_antes TEXT, dados_depois TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now')));

    INSERT INTO clientes (id, nome) VALUES (1, 'Contratante Teste');
    INSERT INTO empresas (id, cliente_id, nome) VALUES (10, 1, 'Matriz A'), (11, 1, 'Matriz B');
    INSERT INTO usuarios (id, nome, username, email, senha_hash) VALUES (100, 'Ana', 'ana', 'ana@x.com', 'h');
    INSERT INTO usuario_clientes (usuario_id, cliente_id) VALUES (100, 1);

    -- Perfis padrão duplicados por matriz — o cenário real de hoje — mais um
    -- perfil customizado só na matriz A.
    INSERT INTO perfis (id, empresa_id, nome, tipo, padrao) VALUES
      (1, 10, 'Somente Visualização', 'VIEW_ONLY', 1),
      (2, 10, 'Edição', 'EDIT', 1),
      (3, 11, 'Somente Visualização', 'VIEW_ONLY', 1),
      (4, 11, 'Edição', 'EDIT', 1),
      (5, 10, 'Financeiro Só Leitura', 'VIEW_ONLY', 0);

    -- O padrão "Somente Visualização" da matriz A só vê financeiro; o da
    -- matriz B vê financeiro E projetos — a união dos dois é o que deve
    -- sobreviver na consolidação. "Edição" (2 e 4) tem a matriz de permissões
    -- de verdade que garantirPerfisPadrao concede — bem mais que o customizado
    -- de 1 permissão, para o desempate de "mais completo" ser inequívoco.
    INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido) VALUES
      (1, 'financeiro', 'view', 1),
      (3, 'financeiro', 'view', 1),
      (3, 'projetos', 'view', 1),
      (5, 'financeiro', 'view', 1),
      (2, 'financeiro', 'view', 1), (2, 'financeiro', 'create', 1), (2, 'financeiro', 'edit', 1),
      (2, 'projetos', 'view', 1), (2, 'projetos', 'create', 1),
      (4, 'financeiro', 'view', 1), (4, 'financeiro', 'create', 1), (4, 'financeiro', 'edit', 1),
      (4, 'projetos', 'view', 1), (4, 'projetos', 'create', 1);

    -- "Edição" bloqueia 'valor' nas duas matrizes (interseção = continua
    -- bloqueado) mas só a de B bloqueia 'descricao' (interseção = liberado).
    INSERT INTO perfil_campos (perfil_id, modulo, campo, pode_editar) VALUES
      (2, 'financeiro', 'valor', 0),
      (4, 'financeiro', 'valor', 0),
      (4, 'financeiro', 'descricao', 0);

    -- Ana: leitor na matriz A com o perfil customizado; GESTOR na matriz B,
    -- sem perfil explícito (cai no padrão "Edição" daquela matriz).
    INSERT INTO usuario_empresas (usuario_id, empresa_id, papel, perfil_id) VALUES
      (100, 10, 'leitor', 5),
      (100, 11, 'gestor', NULL);

    -- Trilha antiga, só por matriz.
    INSERT INTO auditoria (empresa_id, usuario_id, usuario_email, entidade, acao, dados_depois) VALUES
      (10, 100, 'ana@x.com', 'lancamento', 'criar', '{"valor":100}'),
      (11, 100, 'ana@x.com', 'lancamento', 'criar', '{"valor":200}');
  `);
  antigo.close();
}

test('perfis padrão de matrizes diferentes do mesmo cliente mesclam sem perder permissão', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'gsti-acesso-cliente-'));
  const caminho = join(pasta, 'base.sqlite');
  try {
    baseAntiga(caminho);
    const migrado = abrirBanco(caminho);
    definirBanco(migrado);

    const colunasPerfis = (migrado.prepare('PRAGMA table_info(perfis)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    assert.ok(colunasPerfis.includes('cliente_id'), 'perfis passou a ser do cliente');
    assert.ok(!colunasPerfis.includes('empresa_id'), 'e não mais da matriz');

    const perfis = migrado
      .prepare('SELECT id, nome, padrao FROM perfis WHERE cliente_id = 1 ORDER BY padrao DESC, nome')
      .all() as Array<{ id: number; nome: string; padrao: number }>;
    // Um "Edição", um "Somente Visualização" (mesclados), mais o customizado —
    // nunca dois perfis padrão de mesmo nome para o mesmo cliente.
    assert.deepEqual(
      perfis.map((p) => p.nome),
      ['Edição', 'Somente Visualização', 'Financeiro Só Leitura'],
    );

    const somenteVisualizacao = perfis.find((p) => p.nome === 'Somente Visualização')!;
    const permissoesSV = migrado
      .prepare(`SELECT modulo, acao FROM perfil_permissoes WHERE perfil_id = ? AND permitido = 1 ORDER BY modulo`)
      .all(somenteVisualizacao.id) as Array<{ modulo: string; acao: string }>;
    // União: financeiro (das duas cópias) + projetos (só da matriz B) — nenhuma
    // permissão que alguma cópia já concedia pode ter sumido.
    assert.deepEqual(permissoesSV, [
      { modulo: 'financeiro', acao: 'view' },
      { modulo: 'projetos', acao: 'view' },
    ]);

    const edicao = perfis.find((p) => p.nome === 'Edição')!;
    const camposEdicao = migrado
      .prepare('SELECT modulo, campo FROM perfil_campos WHERE perfil_id = ?')
      .all(edicao.id) as Array<{ modulo: string; campo: string }>;
    // Interseção: só 'valor' estava bloqueado nas DUAS cópias; 'descricao' só
    // numa delas, então deixa de estar bloqueado no perfil consolidado.
    assert.deepEqual(camposEdicao, [{ modulo: 'financeiro', campo: 'valor' }]);

    migrado.close();
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('o papel mais permissivo vence, e o perfil escolhido é o mais completo', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'gsti-acesso-cliente-'));
  const caminho = join(pasta, 'base.sqlite');
  try {
    baseAntiga(caminho);
    const migrado = abrirBanco(caminho);
    definirBanco(migrado);

    const vinculo = migrado
      .prepare('SELECT papel, perfil_id FROM usuario_clientes WHERE usuario_id = 100 AND cliente_id = 1')
      .get() as { papel: string; perfil_id: number | null };
    // Ana era leitor na matriz A e GESTOR na matriz B: o cliente não pode
    // rebaixá-la — vence o papel mais permissivo.
    assert.equal(vinculo.papel, 'gestor');

    // Na matriz A ela tinha um perfil EXPLÍCITO ("Financeiro Só Leitura", 1
    // permissão); na B, SEM perfil explícito — o padrão implícito daquela
    // matriz era "Edição" (várias permissões). A comparação por completude
    // escolhe a matriz B, e como a origem vencedora não tinha override, o
    // vínculo migrado também fica sem um — `perfil_id` continua nulo, e é o
    // fallback já existente ("sem perfil atribuído, o papel antigo responde")
    // que resolve para "Edição" em tempo de leitura. Gravar um id explícito
    // aqui inventaria uma escolha que a pessoa nunca fez.
    assert.equal(vinculo.perfil_id, null);

    migrado.close();
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('a trilha antiga ganha o cliente sem perder nenhuma linha', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'gsti-acesso-cliente-'));
  const caminho = join(pasta, 'base.sqlite');
  try {
    baseAntiga(caminho);
    const migrado = abrirBanco(caminho);
    definirBanco(migrado);

    const colunas = (migrado.prepare('PRAGMA table_info(auditoria)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    assert.ok(colunas.includes('cliente_id'), 'auditoria ganhou a dimensão de cliente');

    const linhas = migrado
      .prepare('SELECT cliente_id, empresa_id, entidade FROM auditoria ORDER BY id')
      .all() as Array<{ cliente_id: number; empresa_id: number; entidade: string }>;
    assert.equal(linhas.length, 2, 'nenhuma linha da trilha antiga se perdeu');
    assert.ok(
      linhas.every((l) => l.cliente_id === 1),
      'todas as linhas pré-existentes têm o cliente certo',
    );
    // A matriz de origem continua como CONTEXTO — não é apagada, só deixa de
    // ser a dimensão de filtro principal.
    assert.deepEqual(
      linhas.map((l) => l.empresa_id),
      [10, 11],
    );

    migrado.close();
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('reabrir a base já migrada não duplica nada', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'gsti-acesso-cliente-'));
  const caminho = join(pasta, 'base.sqlite');
  try {
    baseAntiga(caminho);
    const primeira = abrirBanco(caminho);
    definirBanco(primeira);
    const antes = {
      perfis: (primeira.prepare('SELECT COUNT(*) AS n FROM perfis').get() as { n: number }).n,
      vinculos: (primeira.prepare('SELECT COUNT(*) AS n FROM usuario_clientes').get() as { n: number }).n,
      auditoria: (primeira.prepare('SELECT COUNT(*) AS n FROM auditoria').get() as { n: number }).n,
    };
    primeira.close();

    const segunda = abrirBanco(caminho);
    definirBanco(segunda);
    const depois = {
      perfis: (segunda.prepare('SELECT COUNT(*) AS n FROM perfis').get() as { n: number }).n,
      vinculos: (segunda.prepare('SELECT COUNT(*) AS n FROM usuario_clientes').get() as { n: number }).n,
      auditoria: (segunda.prepare('SELECT COUNT(*) AS n FROM auditoria').get() as { n: number }).n,
    };
    assert.deepEqual(depois, antes);
    segunda.close();
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('vínculo de cliente sem nenhum acesso a matriz específica recebe leitor, não trava a migração', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'gsti-acesso-cliente-'));
  const caminho = join(pasta, 'base.sqlite');
  try {
    const antigo = new Database(caminho);
    antigo.exec(`
      CREATE TABLE usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, username TEXT UNIQUE,
        email TEXT NOT NULL UNIQUE, senha_hash TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1,
        senha_em TEXT, ultimo_login_em TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL UNIQUE,
        documento TEXT, ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE usuario_clientes (usuario_id INTEGER NOT NULL, cliente_id INTEGER NOT NULL,
        criado_em TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (usuario_id, cliente_id));
      CREATE TABLE empresas (id INTEGER PRIMARY KEY AUTOINCREMENT, cliente_id INTEGER, nome TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ativa', criado_em TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE usuario_empresas (usuario_id INTEGER NOT NULL, empresa_id INTEGER NOT NULL,
        papel TEXT NOT NULL DEFAULT 'gestor', perfil_id INTEGER, PRIMARY KEY (usuario_id, empresa_id));
      CREATE TABLE perfis (id INTEGER PRIMARY KEY AUTOINCREMENT, empresa_id INTEGER NOT NULL, nome TEXT NOT NULL,
        tipo TEXT NOT NULL, padrao INTEGER NOT NULL DEFAULT 0, criado_em TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (empresa_id, nome));
      CREATE TABLE perfil_permissoes (id INTEGER PRIMARY KEY AUTOINCREMENT, perfil_id INTEGER NOT NULL,
        modulo TEXT NOT NULL, acao TEXT NOT NULL, permitido INTEGER NOT NULL DEFAULT 0,
        UNIQUE (perfil_id, modulo, acao));
      CREATE TABLE perfil_campos (id INTEGER PRIMARY KEY AUTOINCREMENT, perfil_id INTEGER NOT NULL,
        modulo TEXT NOT NULL, campo TEXT NOT NULL, pode_editar INTEGER NOT NULL DEFAULT 1,
        UNIQUE (perfil_id, modulo, campo));
      CREATE TABLE auditoria (id INTEGER PRIMARY KEY AUTOINCREMENT, empresa_id INTEGER NOT NULL,
        usuario_id INTEGER, usuario_email TEXT, entidade TEXT NOT NULL, entidade_id INTEGER, acao TEXT NOT NULL,
        justificativa TEXT, dados_antes TEXT, dados_depois TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now')));

      INSERT INTO clientes (id, nome) VALUES (1, 'Contratante Sem Matriz Vinculada');
      INSERT INTO empresas (id, cliente_id, nome) VALUES (10, 1, 'Matriz A');
      INSERT INTO usuarios (id, nome, username, email, senha_hash) VALUES (100, 'Bia', 'bia', 'bia@x.com', 'h');
      -- Vínculo com o CLIENTE, mas nenhum acesso a matriz específica.
      INSERT INTO usuario_clientes (usuario_id, cliente_id) VALUES (100, 1);
    `);
    antigo.close();

    const migrado = abrirBanco(caminho);
    definirBanco(migrado);
    const vinculo = migrado
      .prepare('SELECT papel FROM usuario_clientes WHERE usuario_id = 100 AND cliente_id = 1')
      .get() as { papel: string } | undefined;
    assert.equal(vinculo?.papel, 'leitor');
    migrado.close();
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});
