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
/**
 * Cliente ao qual a base anterior ao multi-cliente pertence.
 *
 * Não é um nome escolhido: as cinco empresas que a base já tinha — Aliança,
 * Milagres, Moove, Residencial e Union Care — são as matrizes deste grupo.
 */
export const CLIENTE_HISTORICO = 'Grupo Brasil Home Care';

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
    // Reconhecimento do gestor. O banco que já existia ganha tudo como NÃO
    // reconhecido, que é a verdade: ninguém conferiu aqueles lançamentos ainda.
    ['reconhecido', "INTEGER NOT NULL DEFAULT 0"],
    ['reconhecido_em', 'TEXT'],
    ['reconhecido_por', 'INTEGER'],
    // A data em que o dinheiro saiu, que é diferente da competência a que a
    // despesa pertence: a base do cliente traz as duas, e é a data de pagamento
    // que distingue duas linhas iguais no mesmo mês.
    ['data_pagamento', 'TEXT'],
    // A quem se pagou. Ficava em `origem_custo` junto com setor e centro de
    // custo; separado, dá para conciliar fornecedor contra o que já se viu.
    ['fornecedor', 'TEXT'],
    // O grupo de gasto da base do cliente ("TECNOLOGIA DA INFORMACAO - TI").
    // Guardado para que a conciliação tenha contra o que comparar: sem coluna,
    // conferir essa dimensão seria encenação — todo valor pareceria novo.
    ['grupo_gasto', 'TEXT'],
    // Meta e projeções que a base carrega (meta, proj_diarias, proj_pacientes,
    // meta_mes). São controle, NÃO valor: entram como JSON para não serem
    // somadas por engano a nenhum total.
    ['planejamento', 'TEXT'],
    // Quem consome o que esta filial paga. O lançamento que já existia nasce
    // 'integral', que é a leitura que o sistema fazia antes de a pergunta
    // existir — nenhum número muda ao migrar. Sem CHECK: o SQLite não aceita
    // restrição em ADD COLUMN, e a validação fica no domínio.
    ['tipo_consumo', "TEXT NOT NULL DEFAULT 'integral'"],
    ['beneficia_todas', 'INTEGER NOT NULL DEFAULT 0'],
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
    // Marca se o prazo saiu do cadastro de acordos. Sem CHECK: o SQLite não
    // aceita restrição em ADD COLUMN. O chamado que já existia nasce 0, que é
    // a verdade — o prazo dele veio da origem ou não existe.
    ['prazo_do_acordo', 'INTEGER NOT NULL DEFAULT 0'],
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

  // ------------------------------------------------------------- multi-cliente
  //
  // O CLIENTE é a camada nova, acima da empresa. A base que existia é de um
  // cliente só — as cinco "empresas" dela são as matrizes do Grupo Brasil Home
  // Care —, então a migração cria o cliente, pendura as empresas nele e carimba
  // o dono nos registros. Nada é renomeado: `empresas` passa a ser lida como
  // MATRIZ e `filiais` como unidade, que é o que sempre foram no negócio.
  const colunasEmpresa = new Set(
    (db.prepare('PRAGMA table_info(empresas)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const [nome, tipo] of [
    ['cliente_id', 'INTEGER'],
    ['codigo', 'TEXT'],
    ['endereco', 'TEXT'],
    ['cep', 'TEXT'],
  ] as Array<[string, string]>) {
    if (!colunasEmpresa.has(nome)) db.exec(`ALTER TABLE empresas ADD COLUMN ${nome} ${tipo}`);
  }
  const colunasFilial = new Set(
    (db.prepare('PRAGMA table_info(filiais)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const [nome, tipo] of [
    ['codigo', 'TEXT'],
    ['cnpj', 'TEXT'],
    ['endereco', 'TEXT'],
    ['cep', 'TEXT'],
  ] as Array<[string, string]>) {
    if (!colunasFilial.has(nome)) db.exec(`ALTER TABLE filiais ADD COLUMN ${nome} ${tipo}`);
  }
  for (const tabela of ['lancamentos', 'tickets_sla', 'projetos', 'importacoes']) {
    const colunas = new Set(
      (db.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string }>).map((c) => c.name),
    );
    if (!colunas.has('cliente_id')) db.exec(`ALTER TABLE ${tabela} ADD COLUMN cliente_id INTEGER`);
  }

  // Registro da carga: como ela foi pedida e como terminou. A carga que FALHOU
  // é a que mais precisa de rastro — sem `status`, uma importação recusada não
  // deixava linha nenhuma, e a pergunta "por que os dados não entraram?" não
  // tinha onde ser respondida.
  const colunasImport = new Set(
    (db.prepare('PRAGMA table_info(importacoes)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const [nome, tipo] of [
    ['modo', "TEXT NOT NULL DEFAULT 'incremental'"],
    ['status', "TEXT NOT NULL DEFAULT 'concluida'"],
    ['mensagem', 'TEXT'],
    // A carga deixou de ser só "entrou ou não": com a conciliação, uma linha
    // pode ATUALIZAR um lançamento que já existia ou ser REJEITADA por decisão
    // de quem importou. Sem separá-las de `duplicadas`, o relatório final não
    // consegue dizer o que de fato aconteceu com cada linha do arquivo.
    ['atualizadas', 'INTEGER NOT NULL DEFAULT 0'],
    ['rejeitadas', 'INTEGER NOT NULL DEFAULT 0'],
    // O que a pessoa decidiu para cada divergência (criar cadastro novo ou
    // vincular a um existente). É o que responde, meses depois, por que este
    // lançamento foi parar neste centro de custo.
    ['decisoes', 'TEXT'],
    // A carga deixou de ser de UMA matriz: o mesmo arquivo atende o cliente
    // inteiro. Sem registrar o escopo, o histórico não consegue responder
    // quais unidades uma carga atingiu — e é exatamente isso que se pergunta
    // quando um número aparece onde não devia.
    ['escopo', "TEXT NOT NULL DEFAULT 'cliente'"],
    ['escopo_unidades', 'TEXT'],
  ] as Array<[string, string]>) {
    if (!colunasImport.has(nome)) db.exec(`ALTER TABLE importacoes ADD COLUMN ${nome} ${tipo}`);
  }

  // Adoção: empresa sem dono vai para o cliente da base histórica. Só acontece
  // uma vez — depois disso toda empresa nasce com cliente.
  const orfas = (
    db.prepare('SELECT COUNT(*) AS n FROM empresas WHERE cliente_id IS NULL').get() as { n: number }
  ).n;
  if (orfas > 0) {
    db.prepare('INSERT OR IGNORE INTO clientes (nome) VALUES (?)').run(CLIENTE_HISTORICO);
    const dono = db.prepare('SELECT id FROM clientes WHERE nome = ?').get(CLIENTE_HISTORICO) as { id: number };
    db.prepare('UPDATE empresas SET cliente_id = ? WHERE cliente_id IS NULL').run(dono.id);
    // Quem já tinha acesso à empresa passa a ter acesso ao cliente dela: a
    // migração não pode tirar de ninguém o que já estava aberto.
    db.exec(`INSERT OR IGNORE INTO usuario_clientes (usuario_id, cliente_id)
               SELECT DISTINCT ue.usuario_id, e.cliente_id
                 FROM usuario_empresas ue JOIN empresas e ON e.id = ue.empresa_id
                WHERE e.cliente_id IS NOT NULL`);
  }

  // Carimbo do dono nos registros, sempre pela empresa — é a única fonte, e
  // deixá-lo divergir dela seria vazamento entre clientes.
  for (const tabela of ['lancamentos', 'tickets_sla', 'projetos', 'importacoes']) {
    db.exec(`UPDATE ${tabela} SET cliente_id = (
               SELECT e.cliente_id FROM empresas e WHERE e.id = ${tabela}.empresa_id)
              WHERE cliente_id IS NULL`);
  }

  // Índices e gatilhos do recorte por cliente vivem AQUI, e não no schema: numa
  // base que já existia, `cliente_id` só nasce nas linhas acima, e o schema roda
  // antes delas. É a mesma razão de `ux_sla_ticket` estar aqui.
  db.exec(`CREATE INDEX IF NOT EXISTS ix_usuario_clientes_cliente ON usuario_clientes(cliente_id);
CREATE INDEX IF NOT EXISTS ix_empresas_cliente ON empresas(cliente_id);
CREATE INDEX IF NOT EXISTS ix_lanc_cliente_comp ON lancamentos(cliente_id, competencia);
CREATE INDEX IF NOT EXISTS ix_lanc_cliente_tipo ON lancamentos(cliente_id, tipo_despesa_id);
CREATE INDEX IF NOT EXISTS ix_lanc_cliente_criado ON lancamentos(cliente_id, criado_em);
CREATE INDEX IF NOT EXISTS ix_lanc_cliente_reconhecido ON lancamentos(cliente_id, reconhecido);
CREATE INDEX IF NOT EXISTS ix_proj_cliente ON projetos(cliente_id, status);
CREATE INDEX IF NOT EXISTS ix_proj_cliente_criado ON projetos(cliente_id, criado_em);
CREATE INDEX IF NOT EXISTS ix_sla_cliente_comp ON tickets_sla(cliente_id, competencia);
CREATE INDEX IF NOT EXISTS ix_sla_cliente_status ON tickets_sla(cliente_id, status);
CREATE INDEX IF NOT EXISTS ix_sla_cliente_externo ON tickets_sla(cliente_id, source_system, external_id);
CREATE INDEX IF NOT EXISTS ix_sla_cliente_aberto ON tickets_sla(cliente_id, aberto_em);
CREATE INDEX IF NOT EXISTS ix_import_cliente ON importacoes(cliente_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS ix_export_cliente ON exportacoes(cliente_id, criado_em DESC);
-- A conciliação procura o lançamento que já existe pela data de pagamento
-- dentro do cliente: sem este índice, cada linha do arquivo varre a base.
CREATE INDEX IF NOT EXISTS ix_lanc_cliente_pgto ON lancamentos(cliente_id, data_pagamento);

-- Adaptador de colunas por cliente: cada contratante manda a planilha com os
-- cabeçalhos dele ("Vlr Total" onde o template diz "Valor"). Guardar a
-- equivalência é o que evita pedir a ele que reescreva o arquivo todo mês — e
-- é por cliente porque o apelido de um não vale para outro.
CREATE TABLE IF NOT EXISTS mapeamentos_importacao (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  aba        TEXT NOT NULL,
  coluna     TEXT NOT NULL,
  apelido    TEXT NOT NULL,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cliente_id, aba, apelido)
);
CREATE INDEX IF NOT EXISTS ix_mapeamento_cliente ON mapeamentos_importacao(cliente_id, aba);

-- ============================================================
-- Carimbo do cliente: invariante do BANCO, não de cada consulta
-- ============================================================
-- O dono é desnormalizado da empresa por performance. Deixar cada INSERT
-- lembrar de preenchê-lo seria pedir para um deles esquecer — e um registro sem
-- dono, ou com o dono errado, é vazamento entre clientes. O gatilho tira a
-- escolha de quem escreve: importador, webhook e tela caem todos na mesma
-- regra, e ela vale para o código que ainda nem foi escrito.
CREATE TRIGGER IF NOT EXISTS tg_lanc_cliente_novo AFTER INSERT ON lancamentos
WHEN NEW.cliente_id IS NULL BEGIN
  UPDATE lancamentos SET cliente_id = (SELECT cliente_id FROM empresas WHERE id = NEW.empresa_id)
   WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS tg_lanc_cliente_mudou AFTER UPDATE OF empresa_id ON lancamentos BEGIN
  UPDATE lancamentos SET cliente_id = (SELECT cliente_id FROM empresas WHERE id = NEW.empresa_id)
   WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS tg_sla_cliente_novo AFTER INSERT ON tickets_sla
WHEN NEW.cliente_id IS NULL BEGIN
  UPDATE tickets_sla SET cliente_id = (SELECT cliente_id FROM empresas WHERE id = NEW.empresa_id)
   WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS tg_sla_cliente_mudou AFTER UPDATE OF empresa_id ON tickets_sla BEGIN
  UPDATE tickets_sla SET cliente_id = (SELECT cliente_id FROM empresas WHERE id = NEW.empresa_id)
   WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS tg_proj_cliente_novo AFTER INSERT ON projetos
WHEN NEW.cliente_id IS NULL BEGIN
  UPDATE projetos SET cliente_id = (SELECT cliente_id FROM empresas WHERE id = NEW.empresa_id)
   WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS tg_proj_cliente_mudou AFTER UPDATE OF empresa_id ON projetos BEGIN
  UPDATE projetos SET cliente_id = (SELECT cliente_id FROM empresas WHERE id = NEW.empresa_id)
   WHERE id = NEW.id;
END;`);

  // -------------------------------------------- integração ao nível do cliente
  //
  // A configuração das integrações era por MATRIZ. Estava errado: quem contrata
  // o OStick é o contratante, e o endereço, o segredo e o interruptor são os
  // mesmos para todas as unidades dele. Guardá-los por matriz obrigava a
  // repetir a configuração uma vez por unidade e prendia a tela de Integrações
  // a um seletor de empresa — que é justamente o defeito relatado.
  //
  // A tabela é RECONSTRUÍDA porque a dona muda de coluna e o índice único junto:
  // `ALTER TABLE` do SQLite não faz nem uma coisa nem outra.
  const configIntegracao = new Set(
    (db.prepare('PRAGMA table_info(integracao_config)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (configIntegracao.size > 0 && !configIntegracao.has('cliente_id')) {
    db.exec(`CREATE TABLE integracao_config_nova (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id    INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      source_system TEXT NOT NULL CHECK (source_system IN ('OSTICK','BITRIX24')),
      webhook_path  TEXT NOT NULL,
      secret_hash   TEXT,
      url_base      TEXT,
      ativo         INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
      ultimo_evento_em TEXT,
      ultimo_erro   TEXT,
      criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (cliente_id, source_system)
    )`);
    // Duas matrizes do mesmo cliente podiam ter configuração para a mesma
    // origem. Vira UMA: fica a que tem segredo, e entre as que têm, a de evento
    // mais recente — é a que o N8N está usando de verdade. Descartar a que
    // nunca recebeu nada não perde nada; descartar a ativa quebraria a
    // integração em produção.
    db.exec(`INSERT INTO integracao_config_nova
               (cliente_id, source_system, webhook_path, secret_hash, ativo, ultimo_evento_em, ultimo_erro, criado_em, atualizado_em)
             SELECT e.cliente_id, c.source_system, c.webhook_path, c.secret_hash, c.ativo,
                    c.ultimo_evento_em, c.ultimo_erro, c.criado_em, c.atualizado_em
               FROM integracao_config c
               JOIN empresas e ON e.id = c.empresa_id
              WHERE e.cliente_id IS NOT NULL
                AND c.id = (
                  SELECT c2.id FROM integracao_config c2
                    JOIN empresas e2 ON e2.id = c2.empresa_id
                   WHERE e2.cliente_id = e.cliente_id AND c2.source_system = c.source_system
                   ORDER BY (c2.secret_hash IS NULL), c2.ultimo_evento_em DESC, c2.id
                   LIMIT 1)`);
    db.exec('DROP TABLE integracao_config');
    db.exec('ALTER TABLE integracao_config_nova RENAME TO integracao_config');
  }
  if (configIntegracao.size > 0 && !configIntegracao.has('url_base')) {
    const atual = new Set(
      (db.prepare('PRAGMA table_info(integracao_config)').all() as Array<{ name: string }>).map((c) => c.name),
    );
    if (!atual.has('url_base')) db.exec('ALTER TABLE integracao_config ADD COLUMN url_base TEXT');
  }

  // O evento guarda as duas pontas: o cliente (dono da integração) e a matriz
  // (destino do chamado). O carimbo do cliente é gatilho, como nas demais.
  const colunasEvento = new Set(
    (db.prepare('PRAGMA table_info(integracao_evento)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (colunasEvento.size > 0 && !colunasEvento.has('cliente_id')) {
    db.exec('ALTER TABLE integracao_evento ADD COLUMN cliente_id INTEGER');
  }
  db.exec(`UPDATE integracao_evento SET cliente_id = (
             SELECT e.cliente_id FROM empresas e WHERE e.id = integracao_evento.empresa_id)
            WHERE cliente_id IS NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS ix_evento_cliente ON integracao_evento(cliente_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS ix_evento_cliente_status ON integracao_evento(cliente_id, status, criado_em DESC);
CREATE TRIGGER IF NOT EXISTS tg_evento_cliente_novo AFTER INSERT ON integracao_evento
WHEN NEW.cliente_id IS NULL BEGIN
  UPDATE integracao_evento SET cliente_id = (SELECT cliente_id FROM empresas WHERE id = NEW.empresa_id)
   WHERE id = NEW.id;
END;`);

  // ------------------------------------------------------------------ acesso
  //
  // Login por `username`. O e-mail sai da autenticação e passa a servir só à
  // recuperação de senha — quem sabe o e-mail de alguém não deve, por isso,
  // saber o identificador de login dessa pessoa.
  const colunasUsuario = new Set(
    (db.prepare('PRAGMA table_info(usuarios)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!colunasUsuario.has('username')) {
    db.exec('ALTER TABLE usuarios ADD COLUMN username TEXT');
    // A conta que já existia não pode perder o acesso: o identificador sai do
    // e-mail, e o desempate por sufixo cobre dois e-mails de mesmo prefixo.
    const usuarios = db.prepare('SELECT id, email FROM usuarios ORDER BY id').all() as Array<{
      id: number;
      email: string;
    }>;
    const usados = new Set<string>();
    const atualizar = db.prepare('UPDATE usuarios SET username = ? WHERE id = ?');
    for (const u of usuarios) {
      // Mesma derivação do cadastro: prefixo do e-mail, completado com o
      // domínio quando curto demais para valer como identificador.
      const limpar = (s: string) =>
        s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]/g, '');
      const partes = String(u.email).split('@');
      let base = limpar(partes[0] ?? '');
      if (base.length < 3) base = `${base}${limpar((partes[1] ?? '').split('.')[0] ?? '')}`;
      while (base.length < 3) base += '0';
      base = base.slice(0, 40) || `usuario${u.id}`;
      let nome = base;
      for (let i = 2; usados.has(nome); i++) nome = `${base}${i}`;
      usados.add(nome);
      atualizar.run(nome, u.id);
    }
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_usuario_username ON usuarios(username) WHERE username IS NOT NULL');
  if (!colunasUsuario.has('ultimo_login_em')) db.exec('ALTER TABLE usuarios ADD COLUMN ultimo_login_em TEXT');
  // Quando a senha foi trocada pela última vez. É o carimbo que invalida os
  // tokens emitidos antes — sem ele, redefinir a senha não expulsaria ninguém.
  if (!colunasUsuario.has('senha_em')) db.exec('ALTER TABLE usuarios ADD COLUMN senha_em TEXT');

  const colunasVinculo = new Set(
    (db.prepare('PRAGMA table_info(usuario_empresas)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!colunasVinculo.has('perfil_id')) db.exec('ALTER TABLE usuario_empresas ADD COLUMN perfil_id INTEGER');

  // ---------------------------------------------------- acesso por CLIENTE
  //
  // Usuário, perfil e permissão deixam de ser por MATRIZ e passam a valer para
  // TODAS as matrizes e filiais do cliente. Detecta a base antiga por uma
  // marca só (`usuario_clientes` sem `papel`) e faz o resto — `perfis` e
  // `auditoria` — na mesma passada, porque as três mudam juntas.
  const colunasUsuarioClientes = new Set(
    (db.prepare('PRAGMA table_info(usuario_clientes)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!colunasUsuarioClientes.has('papel')) {
    migrarAcessoParaCliente(db);
  }

  // Índices que dependem de colunas que só existem depois do schema atual OU
  // da migração acima — não podem estar em `schema.sql` (que roda ANTES desta
  // função: numa base antiga, indexar `usuario_clientes.papel` antes de ele
  // nascer quebraria a abertura) nem só dentro do `if`, porque uma base NOVA
  // já nasce com a coluna via `schema.sql` e nunca entra nesse bloco.
  db.exec(`
CREATE INDEX IF NOT EXISTS ix_usuario_clientes_papel ON usuario_clientes(cliente_id, papel);
CREATE INDEX IF NOT EXISTS ix_usuario_clientes_perfil ON usuario_clientes(perfil_id);
CREATE INDEX IF NOT EXISTS ix_perfis_cliente ON perfis(cliente_id, padrao, nome);
CREATE INDEX IF NOT EXISTS ix_auditoria_cliente ON auditoria(cliente_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS ix_auditoria_empresa ON auditoria(empresa_id, criado_em DESC);
`);
}

/**
 * Migra Usuários/Perfis/Permissões e a ESCRITA de Auditoria de escopo-por-
 * -matriz para escopo-por-cliente, sem perder nada do que já existia.
 *
 * Chamada uma vez só, quando `usuario_clientes` ainda não tem `papel` — a
 * marca de que a base é anterior a esta camada.
 */
function migrarAcessoParaCliente(db: Conexao): void {
  db.transaction(() => {
    // ------------------------------------------------------------- perfis
    //
    // Cada matriz tinha os PRÓPRIOS perfis "Somente Visualização"/"Edição",
    // mais os que alguém customizou. Consolidar por (cliente, nome):
    // - perfis PADRÃO do mesmo nome sempre mesclam — é a mesma pessoa lógica,
    //   só existiam duplicados porque a criação era por matriz;
    // - perfis CUSTOMIZADOS nunca mesclam entre si, mesmo com nome igual —
    //   não há hoje um caminho que produza intencionalmente "o mesmo perfil
    //   custom" em duas matrizes, então a coincidência é sempre acidental.
    interface PerfilAntigo {
      id: number;
      empresa_id: number;
      nome: string;
      tipo: 'VIEW_ONLY' | 'EDIT';
      padrao: number;
      cliente_id: number;
    }
    const perfisAntigos = db
      .prepare(
        `SELECT p.id, p.empresa_id, p.nome, p.tipo, p.padrao, e.cliente_id
           FROM perfis p JOIN empresas e ON e.id = p.empresa_id
          WHERE e.cliente_id IS NOT NULL`,
      )
      .all() as PerfilAntigo[];
    const permissoesAntigas = db
      .prepare('SELECT perfil_id, modulo, acao FROM perfil_permissoes WHERE permitido = 1')
      .all() as Array<{ perfil_id: number; modulo: string; acao: string }>;
    const camposAntigos = db
      .prepare('SELECT perfil_id, modulo, campo FROM perfil_campos WHERE pode_editar = 0')
      .all() as Array<{ perfil_id: number; modulo: string; campo: string }>;
    const nomesDaMatriz = new Map(
      (db.prepare('SELECT id, nome FROM empresas').all() as Array<{ id: number; nome: string }>).map((e) => [
        e.id,
        e.nome,
      ]),
    );

    interface PlanoPerfil {
      clienteId: number;
      nome: string;
      tipo: 'VIEW_ONLY' | 'EDIT';
      padrao: number;
      origens: number[];
    }
    const porGrupo = new Map<string, PerfilAntigo[]>();
    for (const p of perfisAntigos) {
      const chave = `${p.cliente_id}::${p.nome}`;
      const lista = porGrupo.get(chave);
      if (lista) lista.push(p);
      else porGrupo.set(chave, [p]);
    }

    const plano: PlanoPerfil[] = [];
    for (const grupo of porGrupo.values()) {
      const clienteId = grupo[0]!.cliente_id;
      const padroes = grupo.filter((p) => p.padrao === 1);
      const customizados = grupo.filter((p) => p.padrao !== 1);
      if (padroes.length) {
        // Mescla TODOS os padrão do grupo (mesmo cliente, mesmo nome) num só.
        plano.push({
          clienteId,
          nome: padroes[0]!.nome,
          tipo: padroes[0]!.tipo,
          padrao: 1,
          origens: padroes.map((p) => p.id),
        });
      }
      // Customizados NUNCA mesclam — cada cópia vira linha própria. A de menor
      // id mantém o nome puro (se não colidir com o padrão do grupo); as
      // demais recebem sufixo com a matriz de origem, determinístico.
      const ordenado = [...customizados].sort((a, b) => a.id - b.id);
      ordenado.forEach((p, i) => {
        const nomeMatriz = nomesDaMatriz.get(p.empresa_id) ?? `matriz ${p.empresa_id}`;
        const nome = i === 0 && !padroes.length ? p.nome : `${p.nome} — ${nomeMatriz}`;
        plano.push({ clienteId, nome, tipo: p.tipo, padrao: 0, origens: [p.id] });
      });
    }

    // Desambiguação final: garante nomes únicos por cliente, incluindo o caso
    // raro de duas cópias gerarem o mesmo sufixo (mesma matriz de origem citada
    // duas vezes não acontece, mas dois clientes com matrizes de mesmo nome sim
    // — aqui o agrupamento já é por clienteId, então só colisões DENTRO do
    // mesmo cliente importam).
    const nomesUsadosPorCliente = new Map<number, Set<string>>();
    for (const item of plano) {
      const usados = nomesUsadosPorCliente.get(item.clienteId) ?? new Set<string>();
      let nomeFinal = item.nome;
      let sufixo = 2;
      while (usados.has(nomeFinal)) nomeFinal = `${item.nome} (${sufixo++})`;
      usados.add(nomeFinal);
      nomesUsadosPorCliente.set(item.clienteId, usados);
      item.nome = nomeFinal;
    }

    db.exec(`CREATE TABLE perfis_nova (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('VIEW_ONLY','EDIT')),
      padrao INTEGER NOT NULL DEFAULT 0 CHECK (padrao IN (0,1)),
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (cliente_id, nome)
    )`);
    const inserirPerfilNovo = db.prepare(
      'INSERT INTO perfis_nova (cliente_id, nome, tipo, padrao) VALUES (?, ?, ?, ?)',
    );
    const oldParaNovo = new Map<number, number>();
    const origensPorNovo = new Map<number, number>();
    for (const item of plano) {
      const novoId = Number(
        inserirPerfilNovo.run(item.clienteId, item.nome, item.tipo, item.padrao).lastInsertRowid,
      );
      for (const origemId of item.origens) oldParaNovo.set(origemId, novoId);
      origensPorNovo.set(novoId, item.origens.length);
    }

    // Drop das filhas primeiro (não depende de cascade: já lemos tudo para a
    // memória), depois a mãe — nessa ordem não há FK pendente em nenhum passo.
    db.exec('DROP TABLE perfil_permissoes');
    db.exec('DROP TABLE perfil_campos');
    db.exec('DROP TABLE perfis');
    db.exec('ALTER TABLE perfis_nova RENAME TO perfis');
    db.exec('CREATE INDEX IF NOT EXISTS ix_perfis_cliente ON perfis(cliente_id, padrao, nome)');
    db.exec(`CREATE TABLE perfil_permissoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      perfil_id INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
      modulo TEXT NOT NULL,
      acao TEXT NOT NULL CHECK (acao IN ('view','create','edit','delete','export','import')),
      permitido INTEGER NOT NULL DEFAULT 0 CHECK (permitido IN (0,1)),
      UNIQUE (perfil_id, modulo, acao)
    )`);
    db.exec(`CREATE TABLE perfil_campos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      perfil_id INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
      modulo TEXT NOT NULL,
      campo TEXT NOT NULL,
      pode_editar INTEGER NOT NULL DEFAULT 1 CHECK (pode_editar IN (0,1)),
      UNIQUE (perfil_id, modulo, campo)
    )`);

    // Permissões: UNIÃO — o padrão é negado, então unir nunca reduz acesso.
    const gravarPermissao = db.prepare(
      `INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido) VALUES (?, ?, ?, 1)
         ON CONFLICT(perfil_id, modulo, acao) DO NOTHING`,
    );
    for (const linha of permissoesAntigas) {
      const novoId = oldParaNovo.get(linha.perfil_id);
      if (novoId) gravarPermissao.run(novoId, linha.modulo, linha.acao);
    }

    // Campos bloqueados: INTERSEÇÃO — a ausência de linha já significa "pode
    // editar"; unir bloqueios tiraria edição de quem podia numa das matrizes.
    // Um campo só continua bloqueado se estava bloqueado em TODAS as cópias.
    const contagemBloqueio = new Map<string, { novoId: number; modulo: string; campo: string; count: number }>();
    for (const linha of camposAntigos) {
      const novoId = oldParaNovo.get(linha.perfil_id);
      if (!novoId) continue;
      const chave = `${novoId}::${linha.modulo}::${linha.campo}`;
      const atual = contagemBloqueio.get(chave) ?? { novoId, modulo: linha.modulo, campo: linha.campo, count: 0 };
      atual.count += 1;
      contagemBloqueio.set(chave, atual);
    }
    const gravarCampo = db.prepare(
      'INSERT INTO perfil_campos (perfil_id, modulo, campo, pode_editar) VALUES (?, ?, ?, 0)',
    );
    for (const b of contagemBloqueio.values()) {
      if (b.count >= (origensPorNovo.get(b.novoId) ?? 1)) gravarCampo.run(b.novoId, b.modulo, b.campo);
    }

    // ---------------------------------------------------- usuario_clientes
    //
    // Ganha `papel`/`perfil_id`: o que o usuário PODE, agora do cliente
    // inteiro. Backfill a partir de `usuario_empresas`, agrupado por
    // (usuario_id, cliente_id) — nunca reduz o que a pessoa já tinha.
    db.exec('ALTER TABLE usuario_clientes ADD COLUMN papel TEXT');
    db.exec('ALTER TABLE usuario_clientes ADD COLUMN perfil_id INTEGER');

    interface VinculoAntigo {
      usuario_id: number;
      empresa_id: number;
      papel: 'gestor' | 'leitor';
      perfil_id: number | null;
      cliente_id: number;
    }
    const vinculos = db
      .prepare(
        `SELECT ue.usuario_id, ue.empresa_id, ue.papel, ue.perfil_id, e.cliente_id
           FROM usuario_empresas ue JOIN empresas e ON e.id = ue.empresa_id
          WHERE e.cliente_id IS NOT NULL`,
      )
      .all() as VinculoAntigo[];

    const contarPermissoesDoPerfil = (perfilId: number): number =>
      (
        db
          .prepare('SELECT COUNT(*) AS n FROM perfil_permissoes WHERE perfil_id = ? AND permitido = 1')
          .get(perfilId) as { n: number }
      ).n;
    const perfilPadraoDoCliente = (clienteId: number, papel: 'gestor' | 'leitor'): number | null => {
      const nome = papel === 'gestor' ? 'Edição' : 'Somente Visualização';
      const linha = db.prepare('SELECT id FROM perfis WHERE cliente_id = ? AND nome = ?').get(clienteId, nome) as
        | { id: number }
        | undefined;
      return linha?.id ?? null;
    };

    const porUsuarioCliente = new Map<string, VinculoAntigo[]>();
    for (const v of vinculos) {
      const chave = `${v.usuario_id}::${v.cliente_id}`;
      const lista = porUsuarioCliente.get(chave);
      if (lista) lista.push(v);
      else porUsuarioCliente.set(chave, [v]);
    }

    const upsertVinculo = db.prepare(
      `INSERT INTO usuario_clientes (usuario_id, cliente_id, papel, perfil_id) VALUES (?, ?, ?, ?)
         ON CONFLICT(usuario_id, cliente_id) DO UPDATE SET papel = excluded.papel, perfil_id = excluded.perfil_id`,
    );
    for (const grupo of porUsuarioCliente.values()) {
      const { usuario_id, cliente_id } = grupo[0]!;
      // Nunca reduz: gestor em QUALQUER matriz do cliente vence.
      const papel: 'gestor' | 'leitor' = grupo.some((v) => v.papel === 'gestor') ? 'gestor' : 'leitor';

      let melhor: { perfilId: number | null; pontos: number; explicito: boolean; empresaId: number } | null = null;
      for (const v of grupo) {
        const perfilNovoId = v.perfil_id ? (oldParaNovo.get(v.perfil_id) ?? null) : null;
        const efetivoId = perfilNovoId ?? perfilPadraoDoCliente(cliente_id, v.papel);
        const pontos = efetivoId ? contarPermissoesDoPerfil(efetivoId) : 0;
        const candidato = {
          perfilId: perfilNovoId,
          pontos,
          explicito: perfilNovoId !== null,
          empresaId: v.empresa_id,
        };
        if (
          !melhor ||
          candidato.pontos > melhor.pontos ||
          (candidato.pontos === melhor.pontos && candidato.explicito && !melhor.explicito) ||
          (candidato.pontos === melhor.pontos &&
            candidato.explicito === melhor.explicito &&
            candidato.empresaId < melhor.empresaId)
        ) {
          melhor = candidato;
        }
      }
      upsertVinculo.run(usuario_id, cliente_id, papel, melhor!.perfilId);
    }

    // Vínculos de cliente que a adoção de órfãs já criou (acima, sem papel) e
    // que não têm nenhum `usuario_empresas` correspondente: ganham o mínimo —
    // leitor, perfil padrão implícito. É a ÚNICA situação desta migração que é
    // estritamente um GANHO de acesso (antes viam zero matrizes do cliente),
    // não uma preservação exata — fica registrado para revisão.
    const semPapel = db.prepare('SELECT usuario_id, cliente_id FROM usuario_clientes WHERE papel IS NULL').all() as Array<{
      usuario_id: number;
      cliente_id: number;
    }>;
    for (const v of semPapel) {
      db.prepare('UPDATE usuario_clientes SET papel = ? WHERE usuario_id = ? AND cliente_id = ?').run(
        'leitor',
        v.usuario_id,
        v.cliente_id,
      );
      console.warn(
        `[migração acesso-por-cliente] usuário ${v.usuario_id} tinha vínculo com o cliente ${v.cliente_id} sem ` +
          'nenhum acesso a matriz específica; recebeu papel "leitor" em todas as matrizes do cliente. Revise se é o esperado.',
      );
    }

    // -------------------------------------------------------------- auditoria
    //
    // `cliente_id` vira a dimensão primária (NOT NULL); `empresa_id` vira
    // contexto opcional (nullable) — é o rebuild inteiro porque as duas coisas
    // mudam de coluna-chave ao mesmo tempo.
    db.prepare('INSERT OR IGNORE INTO clientes (nome) VALUES (?)').run(CLIENTE_HISTORICO);
    const donoHistorico = db.prepare('SELECT id FROM clientes WHERE nome = ?').get(CLIENTE_HISTORICO) as {
      id: number;
    };
    db.exec(`CREATE TABLE auditoria_nova (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id    INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      empresa_id    INTEGER REFERENCES empresas(id) ON DELETE SET NULL,
      usuario_id    INTEGER REFERENCES usuarios(id),
      usuario_email TEXT,
      entidade      TEXT NOT NULL,
      entidade_id   INTEGER,
      acao          TEXT NOT NULL,
      justificativa TEXT,
      dados_antes   TEXT,
      dados_depois  TEXT,
      criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.prepare(
      `INSERT INTO auditoria_nova
         (id, cliente_id, empresa_id, usuario_id, usuario_email, entidade, entidade_id, acao, justificativa, dados_antes, dados_depois, criado_em)
       SELECT a.id, COALESCE(e.cliente_id, ?), a.empresa_id, a.usuario_id, a.usuario_email,
              a.entidade, a.entidade_id, a.acao, a.justificativa, a.dados_antes, a.dados_depois, a.criado_em
         FROM auditoria a LEFT JOIN empresas e ON e.id = a.empresa_id`,
    ).run(donoHistorico.id);
    db.exec('DROP TABLE auditoria');
    db.exec('ALTER TABLE auditoria_nova RENAME TO auditoria');
  })();
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
