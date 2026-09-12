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

  // Detalhamento do lançamento: de onde veio o custo, para onde foi o
  // pagamento e o documento vinculado. Anuláveis — o lançamento antigo segue
  // válido sem elas, e o relatório mostra travessão onde não há informação.
  for (const [nome, tipo] of [
    ['origem_custo', 'TEXT'],
    ['destino_pagamento', 'TEXT'],
    ['documento', 'TEXT'],
  ] as Array<[string, string]>) {
    if (!colunas.has(nome)) db.exec(`ALTER TABLE lancamentos ADD COLUMN ${nome} ${tipo}`);
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
  // Tarefa principal: coluna anulável, então a tarefa existente continua
  // sendo uma tarefa de primeiro nível sem nenhum ajuste.
  const tarefas = new Set(
    (db.prepare('PRAGMA table_info(tarefas)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!tarefas.has('parent_task_id')) {
    // Sem REFERENCES: o SQLite não aceita chave estrangeira em ADD COLUMN.
    // A integridade fica no domínio, que já valida projeto, ciclo e profundidade.
    db.exec('ALTER TABLE tarefas ADD COLUMN parent_task_id INTEGER');
  }
  db.exec('CREATE INDEX IF NOT EXISTS ix_tarefas_pai ON tarefas(parent_task_id)');

  // Integração com os sistemas de suporte: origem, identidade lá, e o resto do
  // modelo unificado. Tudo anulável, então o registro agregado mensal e o
  // chamado já importado do osTicket continuam válidos sem nenhum ajuste.
  const integracao: Array<[string, string]> = [
    ['source_system', 'TEXT'],
    ['external_id', 'TEXT'],
    ['descricao', 'TEXT'],
    ['prioridade', 'TEXT'],
    ['setor_id', 'INTEGER'],
    ['solicitante_externo_id', 'TEXT'],
    ['solicitante_email', 'TEXT'],
    ['atendente_externo_id', 'TEXT'],
    ['synced_at', 'TEXT'],
    ['raw_payload', 'TEXT'],
  ];
  for (const [nome, tipo] of integracao) {
    if (!sla.has(nome)) db.exec(`ALTER TABLE tickets_sla ADD COLUMN ${nome} ${tipo}`);
  }

  // Os chamados carregados da extração do osTicket nasceram antes de existir
  // `source_system`: são todos OSTICK, e o `external_id` é o próprio ticket_id.
  db.exec(`UPDATE tickets_sla SET source_system = 'OSTICK', external_id = CAST(ticket_id AS TEXT)
            WHERE ticket_id IS NOT NULL AND source_system IS NULL`);

  // O índice único vive no schema, mas um banco anterior às colunas não pôde
  // criá-lo: só agora `ticket_id` existe.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_sla_ticket ON tickets_sla(empresa_id, ticket_id)
             WHERE ticket_id IS NOT NULL AND excluido_em IS NULL`);

  // Idempotência da integração. A chave inclui a empresa porque o sistema é
  // multi-tenant por regra: duas empresas podem usar instâncias separadas do
  // mesmo helpdesk, cujos ids colidem sem nenhuma relação entre si.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_sla_origem
             ON tickets_sla(empresa_id, source_system, external_id)
             WHERE external_id IS NOT NULL AND excluido_em IS NULL`);
  db.exec('CREATE INDEX IF NOT EXISTS ix_sla_setor ON tickets_sla(setor_id)');
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
