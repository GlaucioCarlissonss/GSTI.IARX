import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caminhoDoProjeto } from '../lib/ambiente.js';

const aquiDir = dirname(fileURLToPath(import.meta.url));
const CAMINHO_SCHEMA = resolve(aquiDir, 'schema.sql');

export type Conexao = Database.Database;

let instancia: Conexao | null = null;

export function abrirBanco(caminho: string): Conexao {
  if (caminho !== ':memory:') mkdirSync(dirname(resolve(caminho)), { recursive: true });
  const db = new Database(caminho);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(CAMINHO_SCHEMA, 'utf8'));
  migrar(db);
  return db;
}

/**
 * Ajustes em bancos que já existiam antes de uma coluna nova. `CREATE TABLE IF
 * NOT EXISTS` não altera tabela criada, então cada coluna acrescentada depois
 * precisa entrar aqui — de forma idempotente, porque roda em toda abertura.
 */
function migrar(db: Conexao): void {
  const colunas = new Set(
    (db.prepare('PRAGMA table_info(lancamentos)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!colunas.has('origem')) {
    // Sem CHECK: o SQLite não aceita restrição em ALTER TABLE ADD COLUMN.
    db.exec(`ALTER TABLE lancamentos ADD COLUMN origem TEXT NOT NULL DEFAULT 'manual'`);
  }

  // Detalhe do chamado no SLA: todas as colunas são anuláveis, então o banco
  // existente ganha cada uma sem tocar nos registros agregados que já tem.
  const sla = new Set(
    (db.prepare('PRAGMA table_info(tickets_sla)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  const detalhe: Array<[string, string]> = [
    ['ticket_id', 'INTEGER'],
    ['numero', 'TEXT'],
    ['assunto', 'TEXT'],
    ['solicitante', 'TEXT'],
    ['responsavel', 'TEXT'],
    ['nivel', 'TEXT'],
    ['status', 'TEXT'],
    ['origem_chamado', 'TEXT'],
    ['aberto_em', 'TEXT'],
    ['fechado_em', 'TEXT'],
    ['prazo_em', 'TEXT'],
    ['horas', 'REAL'],
  ];
  for (const [nome, tipo] of detalhe) {
    if (!sla.has(nome)) db.exec(`ALTER TABLE tickets_sla ADD COLUMN ${nome} ${tipo}`);
  }
  // O índice único vive no schema, mas um banco anterior às colunas não pôde
  // criá-lo: só agora `ticket_id` existe.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_sla_ticket ON tickets_sla(empresa_id, ticket_id)
             WHERE ticket_id IS NOT NULL AND excluido_em IS NULL`);
}

export function db(): Conexao {
  if (!instancia) {
    instancia = abrirBanco(caminhoDoProjeto(process.env.DATABASE_PATH, 'data/gsti.sqlite'));
  }
  return instancia;
}

/** Usado nos testes para injetar um banco em memória. */
export function definirBanco(conexao: Conexao): void {
  instancia = conexao;
}

/** Executa uma função dentro de uma transação. */
export function emTransacao<T>(fn: () => T): T {
  return db().transaction(fn)();
}
