PRAGMA foreign_keys = ON;

-- ============================================================
-- Identidade e acesso
-- ============================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nome         TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash   TEXT NOT NULL,
  ativo        INTEGER NOT NULL DEFAULT 1,
  criado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Multi-tenant: Empresa -> Filial
-- ============================================================
CREATE TABLE IF NOT EXISTS empresas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  cnpj       TEXT,
  status     TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','inativa')),
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Vínculo de acesso do usuário à empresa (isolamento multi-tenant)
CREATE TABLE IF NOT EXISTS usuario_empresas (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  papel      TEXT NOT NULL DEFAULT 'gestor' CHECK (papel IN ('gestor','leitor')),
  PRIMARY KEY (usuario_id, empresa_id)
);

CREATE TABLE IF NOT EXISTS filiais (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome       TEXT NOT NULL,
  cidade     TEXT,
  uf         TEXT,
  ativo      INTEGER NOT NULL DEFAULT 1,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (empresa_id, nome)
);
CREATE INDEX IF NOT EXISTS ix_filiais_empresa ON filiais(empresa_id);

-- ============================================================
-- Módulo Financeiro
-- ============================================================
CREATE TABLE IF NOT EXISTS tipos_despesa (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome       TEXT NOT NULL,
  ativo      INTEGER NOT NULL DEFAULT 1,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (empresa_id, nome)
);
CREATE INDEX IF NOT EXISTS ix_tipos_empresa ON tipos_despesa(empresa_id);

-- competencia é sempre armazenada como 'AAAA-MM' (ordenável); a API troca para 'MM/AAAA'
CREATE TABLE IF NOT EXISTS lancamentos (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id          INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  filial_id           INTEGER REFERENCES filiais(id) ON DELETE RESTRICT,
  tipo_despesa_id     INTEGER NOT NULL REFERENCES tipos_despesa(id) ON DELETE RESTRICT,
  competencia         TEXT NOT NULL CHECK (competencia GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  valor_centavos      INTEGER NOT NULL CHECK (valor_centavos >= 0),
  natureza            TEXT NOT NULL CHECK (natureza IN ('fixa','pontual_unica','pontual_parcelada')),
  classificacao       TEXT NOT NULL CHECK (classificacao IN ('despesa','investimento')),
  qtd_parcelas        INTEGER CHECK (qtd_parcelas IS NULL OR qtd_parcelas >= 1),
  parcela_numero      INTEGER CHECK (parcela_numero IS NULL OR parcela_numero >= 1),
  lancamento_origem_id INTEGER REFERENCES lancamentos(id) ON DELETE CASCADE,
  descricao           TEXT,
  observacoes         TEXT,
  -- 'oficial' é a projeção vigente; outros cenários convivem sem contaminar os totais
  cenario             TEXT NOT NULL DEFAULT 'oficial',
  dedup_hash          TEXT,
  excluido_em         TEXT,
  criado_em           TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em       TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (natureza <> 'pontual_parcelada' OR qtd_parcelas IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_lanc_escopo ON lancamentos(empresa_id, competencia, cenario, excluido_em);
CREATE INDEX IF NOT EXISTS ix_lanc_filial ON lancamentos(filial_id);
CREATE INDEX IF NOT EXISTS ix_lanc_origem ON lancamentos(lancamento_origem_id);
-- Idempotência de importação: a mesma linha não entra duas vezes
CREATE UNIQUE INDEX IF NOT EXISTS ux_lanc_dedup ON lancamentos(dedup_hash) WHERE dedup_hash IS NOT NULL;

-- Fechamento de competência: bloqueia alterações no mês fechado
-- Cenários de projeção (o 'oficial' é imutável e sempre existe)
CREATE TABLE IF NOT EXISTS cenarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id  INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  chave       TEXT NOT NULL,
  nome        TEXT NOT NULL,
  descricao   TEXT,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (empresa_id, chave)
);

CREATE TABLE IF NOT EXISTS fechamentos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id  INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  competencia TEXT NOT NULL CHECK (competencia GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  fechado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  fechado_por INTEGER REFERENCES usuarios(id),
  observacao  TEXT,
  UNIQUE (empresa_id, competencia)
);

-- ============================================================
-- Módulo de Projetos
-- ============================================================
CREATE TABLE IF NOT EXISTS projetos (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id        INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  filial_id         INTEGER REFERENCES filiais(id) ON DELETE RESTRICT,
  nome              TEXT NOT NULL,
  descricao         TEXT,
  mes_inicio        TEXT NOT NULL CHECK (mes_inicio GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  mes_fim_planejado TEXT NOT NULL CHECK (mes_fim_planejado GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  mes_fim_real      TEXT CHECK (mes_fim_real IS NULL OR mes_fim_real GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  status            TEXT NOT NULL DEFAULT 'planejado' CHECK (status IN ('planejado','em_andamento','concluido','cancelado')),
  excluido_em       TEXT,
  criado_em         TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  dedup_hash        TEXT,
  CHECK (mes_fim_planejado >= mes_inicio)
);
CREATE INDEX IF NOT EXISTS ix_proj_empresa ON projetos(empresa_id, excluido_em);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_dedup ON projetos(dedup_hash) WHERE dedup_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS tarefas (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  projeto_id        INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  nome              TEXT NOT NULL,
  mes_inicio        TEXT NOT NULL CHECK (mes_inicio GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  mes_fim_planejado TEXT NOT NULL CHECK (mes_fim_planejado GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  mes_fim_real      TEXT CHECK (mes_fim_real IS NULL OR mes_fim_real GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  responsavel       TEXT,
  status            TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_andamento','concluida','cancelada')),
  excluido_em       TEXT,
  criado_em         TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  dedup_hash        TEXT,
  CHECK (mes_fim_planejado >= mes_inicio)
);
CREATE INDEX IF NOT EXISTS ix_tarefas_projeto ON tarefas(projeto_id, excluido_em);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tarefa_dedup ON tarefas(dedup_hash) WHERE dedup_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS envolvidos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  projeto_id INTEGER NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  nome       TEXT NOT NULL,
  papel      TEXT,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (projeto_id, nome)
);

-- ============================================================
-- Módulo de SLA
-- ============================================================
CREATE TABLE IF NOT EXISTS topicos_ajuda (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome       TEXT NOT NULL,
  ativo      INTEGER NOT NULL DEFAULT 1,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (empresa_id, nome)
);

-- As filas nascem como Infraestrutura | Sistema | Dados em cada empresa e o
-- cadastro é expansível; como todo catálogo, pertencem a um tenant.
CREATE TABLE IF NOT EXISTS filas_ticket (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome       TEXT NOT NULL,
  ativo      INTEGER NOT NULL DEFAULT 1,
  ordem      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (empresa_id, nome)
);

CREATE TABLE IF NOT EXISTS tickets_sla (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id      INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  filial_id       INTEGER REFERENCES filiais(id) ON DELETE RESTRICT,
  competencia     TEXT NOT NULL CHECK (competencia GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  fila_id         INTEGER NOT NULL REFERENCES filas_ticket(id) ON DELETE RESTRICT,
  topico_ajuda_id INTEGER REFERENCES topicos_ajuda(id) ON DELETE RESTRICT,
  total_atendidos INTEGER NOT NULL CHECK (total_atendidos >= 0),
  dentro_sla      INTEGER NOT NULL CHECK (dentro_sla >= 0),
  fora_sla        INTEGER NOT NULL CHECK (fora_sla >= 0),
  observacoes     TEXT,
  dedup_hash      TEXT,
  excluido_em     TEXT,
  criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (dentro_sla + fora_sla = total_atendidos)
);
CREATE INDEX IF NOT EXISTS ix_sla_escopo ON tickets_sla(empresa_id, competencia, excluido_em);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sla_dedup ON tickets_sla(dedup_hash) WHERE dedup_hash IS NOT NULL;

-- ============================================================
-- Auditoria e importações
-- ============================================================
CREATE TABLE IF NOT EXISTS auditoria (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id    INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id    INTEGER REFERENCES usuarios(id),
  usuario_email TEXT,
  entidade      TEXT NOT NULL,
  entidade_id   INTEGER,
  acao          TEXT NOT NULL,
  justificativa TEXT,
  dados_antes   TEXT,
  dados_depois  TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_auditoria_escopo ON auditoria(empresa_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS importacoes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id      INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id      INTEGER REFERENCES usuarios(id),
  modulo          TEXT NOT NULL CHECK (modulo IN ('financeiro','projetos','sla')),
  template_versao TEXT NOT NULL,
  arquivo_nome    TEXT,
  arquivo_hash    TEXT,
  total_linhas    INTEGER NOT NULL DEFAULT 0,
  importadas      INTEGER NOT NULL DEFAULT 0,
  duplicadas      INTEGER NOT NULL DEFAULT 0,
  com_erro        INTEGER NOT NULL DEFAULT 0,
  relatorio       TEXT,
  criado_em       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_import_empresa ON importacoes(empresa_id, criado_em DESC);
