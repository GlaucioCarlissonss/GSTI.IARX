/**
 * Ensaio da migração sobre uma CÓPIA da base real.
 *
 * Roda a abertura (schema + migração) e imprime o que mudou nas integrações.
 * Nunca toca a base de verdade: o caminho vem por argumento.
 */
import { abrirBanco } from './index.js';

const caminho = process.argv[2];
if (!caminho) {
  console.error('Uso: tsx server/src/db/verificar-migracao.ts <caminho-da-copia.sqlite>');
  process.exit(1);
}
const db = abrirBanco(caminho);
const tabela = (sql: string) => db.prepare(sql).all();
console.log('clientes:', tabela('SELECT id, nome FROM clientes ORDER BY id'));
console.log('empresas:', tabela('SELECT id, cliente_id, nome FROM empresas ORDER BY id'));
console.log(
  'colunas integracao_config:',
  (db.prepare('PRAGMA table_info(integracao_config)').all() as Array<{ name: string }>).map((c) => c.name),
);
console.log('integracao_config:', tabela('SELECT * FROM integracao_config ORDER BY cliente_id, source_system'));
console.log(
  'eventos por cliente:',
  tabela('SELECT cliente_id, COUNT(*) AS n FROM integracao_evento GROUP BY cliente_id'),
);
console.log(
  'eventos sem cliente:',
  tabela('SELECT COUNT(*) AS n FROM integracao_evento WHERE cliente_id IS NULL'),
);
console.log('lançamentos:', tabela('SELECT cliente_id, COUNT(*) AS n FROM lancamentos GROUP BY cliente_id'));
console.log('chamados:', tabela('SELECT cliente_id, COUNT(*) AS n FROM tickets_sla GROUP BY cliente_id'));
