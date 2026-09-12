PRAGMA foreign_keys = ON;

-- ============================================================
-- Identidade e acesso
-- ============================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nome         TEXT NOT NULL,
  -- `username` é o identificador de LOGIN; o e-mail serve só à recuperação de
  -- senha. Quem sabe o e-mail de alguém não deve, por isso, saber como essa
  -- pessoa entra no sistema.
  username     TEXT UNIQUE COLLATE NOCASE,
  email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash   TEXT NOT NULL,
  ativo        INTEGER NOT NULL DEFAULT 1,
  -- Carimbo da última troca de senha: invalida os tokens emitidos antes dela.
  senha_em     TEXT,
  ultimo_login_em TEXT,
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
  -- Origem do custo e destino do pagamento: de onde o custo veio (fornecedor,
  -- setor, centro de custo) e para onde o pagamento foi (conta, beneficiário).
  -- Não confundir com `origem` abaixo, que é a PROCEDÊNCIA DO DADO — de onde o
  -- registro entrou no sistema, não de onde o dinheiro saiu.
  origem_custo        TEXT,
  destino_pagamento   TEXT,
  documento           TEXT,
  -- 'oficial' é a projeção vigente; outros cenários convivem sem contaminar os totais
  cenario             TEXT NOT NULL DEFAULT 'oficial',
  -- procedência do dado: o total do sistema não é o total das planilhas enviadas,
  -- e sem isto não há como mostrar ao gestor de onde vem cada diferença
  origem              TEXT NOT NULL DEFAULT 'manual'
                        CHECK (origem IN ('planilha','folha_ti','projecao_spincare','manual')),
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
  -- Tarefa principal. Auto-relacionamento opcional, limitado ao mesmo projeto
  -- e a 3 níveis (principal → subtarefa → subtarefa), verificado no domínio:
  -- profundidade e ciclo o SQLite não expressa em CHECK.
  parent_task_id    INTEGER REFERENCES tarefas(id) ON DELETE RESTRICT,
  excluido_em       TEXT,
  criado_em         TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  dedup_hash        TEXT,
  CHECK (mes_fim_planejado >= mes_inicio),
  CHECK (parent_task_id IS NULL OR parent_task_id <> id)
);
CREATE INDEX IF NOT EXISTS ix_tarefas_projeto ON tarefas(projeto_id, excluido_em);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tarefa_dedup ON tarefas(dedup_hash) WHERE dedup_hash IS NOT NULL;

-- O índice de filhos é criado em db/index.ts, junto das migrações: um banco
-- anterior a esta coluna ainda não tem `parent_task_id` quando este arquivo roda.

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

-- Setor: a área da empresa que fez a solicitação. Catálogo por tenant, como os
-- demais. "Não classificado" é o destino do chamado cuja origem o sistema de
-- suporte não informou — o registro entra e fica visível para revisão, em vez
-- de ser recusado na porta.
CREATE TABLE IF NOT EXISTS setores (
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
  -- Detalhe do chamado. Preenchido quando o registro representa UM chamado
  -- (total_atendidos = 1), vindo do helpdesk; nulo no registro agregado mensal.
  -- ticket_id é o id no sistema de origem, que compõe a URL do chamado lá.
  ticket_id       INTEGER,
  numero          TEXT,
  assunto         TEXT,
  solicitante     TEXT,
  responsavel     TEXT,
  nivel           TEXT,
  status          TEXT,
  origem_chamado  TEXT,
  aberto_em       TEXT,
  fechado_em      TEXT,
  prazo_em        TEXT,
  horas           REAL,
  -- Sistema de suporte de origem e a identidade do chamado lá. Juntos com a
  -- empresa formam a chave de idempotência da integração: reentrega do
  -- webhook atualiza o mesmo registro, nunca cria um segundo.
  source_system   TEXT,
  external_id     TEXT,
  descricao       TEXT,
  prioridade      TEXT,
  setor_id        INTEGER REFERENCES setores(id) ON DELETE RESTRICT,
  solicitante_externo_id TEXT,
  solicitante_email      TEXT,
  atendente_externo_id   TEXT,
  -- Momento da última sincronização e o payload como chegou, para o registro
  -- poder ser reconferido contra a origem sem depender de log.
  synced_at       TEXT,
  raw_payload     TEXT,
  dedup_hash      TEXT,
  excluido_em     TEXT,
  criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (dentro_sla + fora_sla = total_atendidos)
);
CREATE INDEX IF NOT EXISTS ix_sla_escopo ON tickets_sla(empresa_id, competencia, excluido_em);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sla_dedup ON tickets_sla(dedup_hash) WHERE dedup_hash IS NOT NULL;
-- O índice único de chamado (ux_sla_ticket) é criado em db/index.ts, depois das
-- migrações: um banco anterior a estas colunas ainda não tem `ticket_id` quando
-- este arquivo roda, e o CREATE INDEX falharia antes de a coluna existir.

-- ============================================================
-- Auditoria e importações
-- ============================================================
-- Configuração por empresa (chave/valor). Hoje guarda o endereço base do
-- helpdesk, que monta o link de volta para o chamado.
CREATE TABLE IF NOT EXISTS configuracoes (
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  chave      TEXT NOT NULL,
  valor      TEXT,
  PRIMARY KEY (empresa_id, chave)
);

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

-- ---------------------------------------------------------------- integrações
-- Cada conexão com um sistema de origem é uma linha: dá para ligar, desligar e
-- girar o segredo sem mexer em código.
--
-- O segredo é guardado como HASH, e não em texto: quem tem o banco não tem a
-- chave. O valor em claro aparece uma única vez, no momento em que é gerado —
-- é o mesmo trato de uma chave de API. Perdeu, gera outra.
CREATE TABLE IF NOT EXISTS integracao_config (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id    INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL CHECK (source_system IN ('OSTICK','BITRIX24')),
  webhook_path  TEXT NOT NULL,
  secret_hash   TEXT,
  ativo         INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  ultimo_evento_em TEXT,
  ultimo_erro   TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (empresa_id, source_system)
);

-- Log de eventos: auditoria, diagnóstico e reprocessamento. O payload bruto
-- fica aqui justamente para permitir refazer o processamento sem depender de
-- a origem reenviar.
CREATE TABLE IF NOT EXISTS integracao_evento (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id    INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL CHECK (source_system IN ('OSTICK','BITRIX24')),
  external_id   TEXT,
  tipo          TEXT NOT NULL CHECK (tipo IN ('ticket.created','ticket.updated','ticket.test')),
  payload       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('received','processed','error')),
  erro          TEXT,
  ticket_id     INTEGER,
  teste         INTEGER NOT NULL DEFAULT 0 CHECK (teste IN (0,1)),
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  processado_em TEXT
);
CREATE INDEX IF NOT EXISTS ix_evento_escopo ON integracao_evento(empresa_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS ix_evento_status ON integracao_evento(empresa_id, status, criado_em DESC);

-- ============================================================
-- Acesso: perfis, permissões e recuperação de senha
-- ============================================================
-- O perfil fica no VÍNCULO com a empresa, e não no usuário: o sistema é
-- multi-tenant por regra, e o mesmo usuário já podia ser gestor numa empresa e
-- leitor em outra. Um perfil por usuário faria quem é administrador numa
-- empresa virar administrador em todas.
CREATE TABLE IF NOT EXISTS perfis (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id   INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome         TEXT NOT NULL,
  tipo         TEXT NOT NULL CHECK (tipo IN ('VIEW_ONLY','EDIT')),
  padrao       INTEGER NOT NULL DEFAULT 0 CHECK (padrao IN (0,1)),
  criado_em    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (empresa_id, nome)
);

-- Uma linha por (perfil, módulo, ação). A ausência da linha é negação: o
-- padrão de um perfil novo é não poder nada além do que foi marcado.
CREATE TABLE IF NOT EXISTS perfil_permissoes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  perfil_id  INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  modulo     TEXT NOT NULL,
  acao       TEXT NOT NULL CHECK (acao IN ('view','create','edit','delete','export','import')),
  permitido  INTEGER NOT NULL DEFAULT 0 CHECK (permitido IN (0,1)),
  UNIQUE (perfil_id, modulo, acao)
);

-- Campos que um perfil de edição PODE alterar. Sem nenhuma linha para o
-- módulo, valem todos os campos — é o caso comum, e exigir a lista completa
-- transformaria cada campo novo numa permissão esquecida.
CREATE TABLE IF NOT EXISTS perfil_campos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  perfil_id  INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  modulo     TEXT NOT NULL,
  campo      TEXT NOT NULL,
  pode_editar INTEGER NOT NULL DEFAULT 1 CHECK (pode_editar IN (0,1)),
  UNIQUE (perfil_id, modulo, campo)
);

-- Token de redefinição: guardado como hash, de uso único e com prazo. Guardar
-- em texto faria de um vazamento do banco um vazamento de contas.
CREATE TABLE IF NOT EXISTS tokens_redefinicao (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expira_em   TEXT NOT NULL,
  usado_em    TEXT,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_token_usuario ON tokens_redefinicao(usuario_id, expira_em);

-- Correspondência que o sistema tentou enviar. Sem SMTP configurado, é aqui
-- que a mensagem fica — dizer que enviou sem ter enviado seria pior do que
-- não enviar.
CREATE TABLE IF NOT EXISTS emails_enviados (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  destinatario TEXT NOT NULL,
  assunto     TEXT NOT NULL,
  corpo       TEXT NOT NULL,
  enviado     INTEGER NOT NULL DEFAULT 0 CHECK (enviado IN (0,1)),
  erro        TEXT,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);
