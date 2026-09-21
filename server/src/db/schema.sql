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
-- Multi-cliente: Cliente -> Matriz (empresa) -> Filial
-- ============================================================
-- O CLIENTE é o contratante. Abaixo dele, a hierarquia que o sistema já tinha
-- passa a ser lida com os nomes do negócio: `empresas` é a MATRIZ (CNPJ base,
-- 0001) e `filiais` são as unidades (CNPJ completo). Não foi renomeada nada:
-- a base inteira que existia é de um cliente só, e trocar os nomes das tabelas
-- quebraria todo o código por uma palavra.
CREATE TABLE IF NOT EXISTS clientes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  documento  TEXT,
  ativo      INTEGER NOT NULL DEFAULT 1,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (nome)
);

-- Vínculo usuário <-> cliente. Um usuário acessa vários clientes; um cliente
-- tem vários usuários. É contra ESTA tabela que o backend valida o cliente da
-- requisição — nunca contra o que a tela mandou.
--
-- `papel`/`perfil_id` são o que o usuário PODE, e valem para TODAS as matrizes
-- e filiais do cliente de uma vez: o contratante tem uma permissão só, não uma
-- por unidade. Antes disso morava em `usuario_empresas` (por matriz individual,
-- ver o comentário dela abaixo); a migração de bases antigas está em
-- `db/index.ts`.
CREATE TABLE IF NOT EXISTS usuario_clientes (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  papel      TEXT NOT NULL DEFAULT 'leitor' CHECK (papel IN ('gestor','leitor')),
  perfil_id  INTEGER REFERENCES perfis(id) ON DELETE SET NULL,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (usuario_id, cliente_id)
);
-- Os índices desta tabela (e os de `perfis`/`auditoria` mais abaixo) vivem em
-- `db/index.ts`, não aqui: numa base que já existia antes desta camada, a
-- coluna só nasce na migração, que roda DEPOIS deste arquivo — um índice
-- sobre ela aqui quebraria a abertura dessa base.

CREATE TABLE IF NOT EXISTS empresas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- O dono. Anulável só para o banco que existia antes do cliente existir; a
  -- migração preenche, e a criação exige.
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
  nome       TEXT NOT NULL,
  codigo     TEXT,
  cnpj       TEXT,
  endereco   TEXT,
  cep        TEXT,
  status     TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','inativa')),
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Vínculo de acesso do usuário à MATRIZ individual — histórico, congelado.
--
-- A permissão passou a ser do cliente inteiro (`usuario_clientes.papel`/
-- `perfil_id`, acima). Esta tabela continua existindo só pelo rastro forense
-- de quem tinha acesso a qual matriz antes da migração; nenhum código volta a
-- gravar ou ler daqui para decidir permissão. Fica no schema.sql (em vez de
-- ser removida) porque uma base que já a tem não pode perder a coluna, e uma
-- base nova não sofre por ter uma tabela extra e vazia.
CREATE TABLE IF NOT EXISTS usuario_empresas (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  papel      TEXT NOT NULL DEFAULT 'gestor' CHECK (papel IN ('gestor','leitor')),
  PRIMARY KEY (usuario_id, empresa_id)
);

CREATE TABLE IF NOT EXISTS filiais (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- `empresa_id` É a matriz-pai: a filial pendura na matriz, e a matriz no
  -- cliente. Não há auto-relacionamento porque as duas já são tabelas
  -- distintas, e juntá-las numa só trocaria clareza por uma coluna `tipo`.
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome       TEXT NOT NULL,
  codigo     TEXT,
  cnpj       TEXT,
  endereco   TEXT,
  cep        TEXT,
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
  -- Quem CONSOME o que esta filial PAGA.
  --
  -- 'integral'      o custo é todo da filial pagadora
  -- 'compartilhado' a filial paga, mas o benefício se estende a outras
  --
  -- Sem este campo, uma matriz que centraliza licenças para seis filiais
  -- aparece como a unidade cara e as filiais que consomem aparecem baratas —
  -- o número está certo e a leitura, errada.
  tipo_consumo        TEXT NOT NULL DEFAULT 'integral'
                        CHECK (tipo_consumo IN ('integral','compartilhado')),
  -- Só a INTENÇÃO "todas as filiais do grupo", para a tela reexibir a frase em
  -- vez de listar catorze nomes. Nenhuma conta usa esta coluna: quem responde
  -- "quem se beneficia" é sempre `lancamento_beneficiadas`, que é a lista
  -- congelada no momento da gravação.
  beneficia_todas     INTEGER NOT NULL DEFAULT 0 CHECK (beneficia_todas IN (0,1)),
  documento           TEXT,
  -- A quem se pagou, separado de `origem_custo` (que mistura setor e centro de
  -- custo): é o que permite conciliar o fornecedor da planilha contra os que o
  -- cliente já usou, em vez de gravar mais uma grafia nova a cada carga.
  fornecedor          TEXT,
  -- O grupo de gasto como a base do cliente o nomeia. Sem guardá-lo, conciliar
  -- essa dimensão não teria contra o que comparar na carga seguinte.
  grupo_gasto         TEXT,
  -- Quando o dinheiro saiu. Não se confunde com `competencia`, que é o mês a
  -- que a despesa pertence — a base do cliente traz as duas, e é esta data que
  -- separa dois pagamentos iguais dentro do mesmo mês.
  data_pagamento      TEXT,
  -- Meta e projeções que a base carrega junto (meta, proj_diarias,
  -- proj_pacientes, meta_mes). São controle, não valor: ficam em JSON
  -- justamente para não haver como somá-las a um total por descuido.
  planejamento        TEXT,
  -- 'oficial' é a projeção vigente; outros cenários convivem sem contaminar os totais
  cenario             TEXT NOT NULL DEFAULT 'oficial',
  -- procedência do dado: o total do sistema não é o total das planilhas enviadas,
  -- e sem isto não há como mostrar ao gestor de onde vem cada diferença
  origem              TEXT NOT NULL DEFAULT 'manual'
                        CHECK (origem IN ('planilha','folha_ti','projecao_spincare','manual')),
  dedup_hash          TEXT,
  -- Reconhecimento: o gestor confirmou que esta despesa é dele e está correta.
  -- Nasce 0 em tudo que entra por carga — a base do cliente veio sem essa
  -- conferência, e presumir reconhecido apagaria justamente o trabalho a fazer.
  -- Dono, desnormalizado da empresa. Existe pela PERFORMANCE: toda consulta de
  -- tela recorta por cliente, e escopar por join a cada uma custa caro. A
  -- migração preenche e a gravação mantém — divergir dele seria vazamento.
  cliente_id          INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
  reconhecido         INTEGER NOT NULL DEFAULT 0 CHECK (reconhecido IN (0,1)),
  reconhecido_em      TEXT,
  reconhecido_por     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  -- COMO o reconhecimento aconteceu. 'manual' (ou nulo, no histórico) é alguém
  -- que olhou e confirmou; 'cadastro_origem' é a carga aplicando o cadastro de
  -- quem reconhece despesa.
  --
  -- Existe porque `reconhecido_por` sozinho MENTE: numa carga, ele guarda quem
  -- rodou a importação, e a tela diria "gestora reconheceu 600 lançamentos"
  -- quando ninguém olhou lançamento nenhum — foi uma regra que decidiu. Quem
  -- audita precisa poder separar as duas coisas.
  -- 'planilha' é a terceira: a coluna "Reconhecido" do modelo 1.6 afirmou, e
  -- quem importou não é quem conferiu.
  reconhecido_via     TEXT CHECK (reconhecido_via IS NULL OR reconhecido_via IN ('manual','cadastro_origem','planilha')),
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

-- As filiais que CONSOMEM um lançamento pago por outra unidade.
--
-- É tabela e não lista em JSON porque a pergunta do indicador — "o que desta
-- filial é pago por outra?" — se responde filtrando por filial, e filtro em
-- JSON não usa índice.
--
-- A lista é CONGELADA na gravação: escolher "todas as filiais do grupo" grava
-- as que existiam naquele momento. Uma filial cadastrada em março não passa a
-- se beneficiar de um lançamento de janeiro, e o mês fechado não muda de
-- número sozinho.
CREATE TABLE IF NOT EXISTS lancamento_beneficiadas (
  lancamento_id INTEGER NOT NULL REFERENCES lancamentos(id) ON DELETE CASCADE,
  filial_id     INTEGER NOT NULL REFERENCES filiais(id) ON DELETE CASCADE,
  PRIMARY KEY (lancamento_id, filial_id)
);
CREATE INDEX IF NOT EXISTS ix_beneficiada_filial ON lancamento_beneficiadas(filial_id);
-- Índices compostos do recorte por cliente: é por eles que a tela de
-- indicadores deixa de varrer a base inteira.

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
  cliente_id        INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
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
-- Tarefa não guarda cliente: ela sempre entra pela junção com o projeto, e
-- duplicar o dono nela criaria um segundo lugar para ele divergir. O índice do
-- projeto é o que a consulta usa.
CREATE INDEX IF NOT EXISTS ix_tarefas_fim ON tarefas(mes_fim_planejado, excluido_em);



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
  cliente_id      INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
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
  -- O prazo saiu do CADASTRO de acordos, e não da origem? O acordo cadastrado
  -- passou a ter precedência sobre o prazo do helpdesk (é o contrato que o
  -- grupo negociou), e esta marca é o que permite refazê-lo quando a
  -- prioridade muda — e saber, na ficha, contra o que o chamado correu.
  prazo_do_acordo INTEGER NOT NULL DEFAULT 0 CHECK (prazo_do_acordo IN (0,1)),
  -- O prazo que a ORIGEM informou, guardado mesmo quando o acordo ganha dele.
  -- É a promessa que o solicitante viu ao abrir o chamado: descartá-la deixaria
  -- a contestação de um "fora do SLA" sem nenhuma referência para comparar.
  prazo_origem    TEXT,
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

-- `cliente_id` é a dimensão PRIMÁRIA — todo evento pertence a um cliente, e é
-- por ele que a trilha se filtra primeiro. `empresa_id` é só CONTEXTO do
-- evento: fica nulo para o que é do cliente inteiro (criar usuário, criar
-- perfil, criar matriz) e preenchido para o que pertence a uma matriz de fato
-- (lançamento, filial, tipo de despesa). `ON DELETE SET NULL`, não CASCADE: a
-- trilha não pode desaparecer se a matriz um dia puder ser removida.
CREATE TABLE IF NOT EXISTS auditoria (
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
);
-- Índices em `db/index.ts` — mesma razão do comentário em `usuario_clientes`.

-- Tentativa de acesso a um cliente que não é do usuário.
--
-- Fica fora de `auditoria` por um motivo de fato: a recusa acontece ANTES de
-- existir contexto nenhum — nem cliente, nem empresa, nem sessão validada.
-- Guardar em `auditoria` (que exige `cliente_id NOT NULL`) obrigaria a inventar
-- um dono para a linha, e um dono inventado na trilha vale menos que nenhum. E
-- `cliente_id` aqui NÃO tem chave estrangeira de propósito: quem sonda ids
-- manda números que não existem, e é justamente essa tentativa que precisa
-- ficar registrada.
CREATE TABLE IF NOT EXISTS acesso_negado (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id    INTEGER,
  usuario_id    INTEGER REFERENCES usuarios(id),
  usuario_email TEXT,
  rota          TEXT,
  metodo        TEXT,
  motivo        TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_acesso_negado_data ON acesso_negado(criado_em DESC);
CREATE INDEX IF NOT EXISTS ix_acesso_negado_usuario ON acesso_negado(usuario_id, criado_em DESC);

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

-- Registro de EXPORTAÇÃO (o ExportLog).
--
-- Exportar não grava dado nenhum, mas é saída de dado — e agora sai do cliente
-- inteiro, não de uma matriz. Sem este rastro, a única pergunta sem resposta
-- sobre um arquivo circulando por aí seria de onde ele veio e o que cobria.
--
-- `empresa_id` guarda a matriz quando o escopo tem uma só; com várias, fica a
-- que estava em foco, porque o dono de verdade da linha é o cliente.
CREATE TABLE IF NOT EXISTS exportacoes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id      INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
  cliente_id      INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
  usuario_id      INTEGER REFERENCES usuarios(id),
  modulo          TEXT NOT NULL,
  formato         TEXT NOT NULL,
  -- cliente | empresas | unidades
  escopo          TEXT NOT NULL DEFAULT 'cliente',
  -- JSON {empresas:[],filiais:[]} — o escopo REAL já expandido, não o pedido.
  escopo_unidades TEXT,
  arquivo_nome    TEXT,
  total_linhas    INTEGER NOT NULL DEFAULT 0,
  template_versao TEXT,
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
--
-- A configuração é do CLIENTE, não da matriz. Quem contrata o OStick é o
-- contratante: o endereço, o segredo e o interruptor são os mesmos para todas
-- as unidades dele. Guardá-los por matriz obrigava a repetir a configuração
-- cinco vezes e fazia a tela de Integrações depender de um seletor de empresa
-- para mostrar o que não varia com ela.
CREATE TABLE IF NOT EXISTS integracao_config (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id    INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL CHECK (source_system IN ('OSTICK','BITRIX24')),
  webhook_path  TEXT NOT NULL,
  secret_hash   TEXT,
  -- Endereço base do sistema de origem, para montar o link do chamado. Fica no
  -- cliente porque é dele o contrato; a matriz que usa instância própria pode
  -- sobrepor em `configuracoes`.
  url_base      TEXT,
  ativo         INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  ultimo_evento_em TEXT,
  ultimo_erro   TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cliente_id, source_system)
);

-- Log de eventos: auditoria, diagnóstico e reprocessamento. O payload bruto
-- fica aqui justamente para permitir refazer o processamento sem depender de
-- a origem reenviar.
-- O evento guarda as DUAS pontas: o cliente, que é dono da integração, e a
-- matriz, que é o destino do chamado — cada unidade tem a própria instância do
-- helpdesk, e o mesmo número de chamado em duas delas não é o mesmo chamado.
CREATE TABLE IF NOT EXISTS integracao_evento (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id    INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
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
-- O perfil fica no VÍNCULO com o CLIENTE, e não no usuário: o sistema é
-- multi-tenant por regra, e o mesmo usuário já podia ser gestor num cliente e
-- leitor em outro. Um perfil por usuário faria quem administra um contratante
-- virar administrador em todos. Já foi por EMPRESA (matriz individual) — a
-- migração de bases antigas, com a consolidação dos perfis duplicados por
-- matriz do mesmo cliente, está em `db/index.ts`.
CREATE TABLE IF NOT EXISTS perfis (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id   INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nome         TEXT NOT NULL,
  tipo         TEXT NOT NULL CHECK (tipo IN ('VIEW_ONLY','EDIT')),
  padrao       INTEGER NOT NULL DEFAULT 0 CHECK (padrao IN (0,1)),
  criado_em    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cliente_id, nome)
);
-- Índice em `db/index.ts` — mesma razão do comentário em `usuario_clientes`.

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

-- Meta de um indicador: o alvo contra o qual o resultado é lido.
--
-- Antes desta tabela, o único alvo do sistema era `META_SLA = 80` escrito à
-- mão em três arquivos (servidor, web e artifact). Três cópias de um número
-- que o cliente pode querer mudar são três chances de divergirem.
--
-- É do CLIENTE, e não da matriz: o enunciado fala em meta por contratante, e
-- uma meta de SLA que valesse só para uma matriz não responderia "como vai o
-- atendimento deste cliente". O precedente é `mapeamentos_importacao`.
--
-- A vigência é por competência e as duas pontas são anuláveis: sem início vale
-- desde sempre, sem fim vale até mudar. É o que permite trocar a meta em
-- janeiro sem reescrever a história dos meses já fechados.
CREATE TABLE IF NOT EXISTS metas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id      INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  modulo          TEXT NOT NULL CHECK (modulo IN ('financeiro','sla','projetos','equilibrio')),
  alvo_pct        REAL NOT NULL,
  vigencia_inicio TEXT,
  vigencia_fim    TEXT,
  ativo           INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cliente_id, nome)
);
CREATE INDEX IF NOT EXISTS ix_meta_cliente ON metas(cliente_id, modulo, ativo);

-- Acordo de nível de serviço: quantas horas um chamado tem para ser atendido.
--
-- Antes desta tabela o prazo vinha pronto da origem (`due_at` do helpdesk) e,
-- quando a origem não mandava, o sistema contava o chamado fechado como dentro
-- e o aberto como fora. Era a única leitura possível — e não é um acordo, é a
-- ausência de um.
--
-- A regra é da UNIDADE, como todo cadastro de operação: a hora de atendimento
-- de um hospital não é a do outro. `topico_ajuda_id` NULO é a regra geral
-- daquela prioridade, e vale para o chamado cujo tópico não tem regra própria
-- — a integração cria tópico sozinha, e exigir uma linha por tópico deixaria
-- chamados sem acordo sem ninguém perceber.
CREATE TABLE IF NOT EXISTS slas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id      INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  topico_ajuda_id INTEGER REFERENCES topicos_ajuda(id) ON DELETE CASCADE,
  prioridade      TEXT NOT NULL CHECK (prioridade IN ('low','medium','high','urgent')),
  horas           REAL NOT NULL CHECK (horas > 0),
  -- Vigência em DATA (AAAA-MM-DD), e não em competência como em `metas`: quem
  -- decide qual acordo vale é a ABERTURA do chamado. Um acordo que passou de
  -- 24h para 8h no dia 10 não pode julgar o chamado aberto no dia 2 — seria
  -- cobrar um compromisso que ainda não existia. Nulo dos dois lados é
  -- "desde sempre, sem fim".
  vigencia_inicio TEXT,
  vigencia_fim    TEXT,
  ativo           INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_sla_empresa ON slas(empresa_id, prioridade, ativo);

-- Mudança de prioridade de um chamado, com quem pediu.
--
-- A prioridade mudava sem deixar rastro: o upsert da integração sobrescrevia o
-- campo, e uma elevação de Baixa para Alta "a pedido de alguém" virava um
-- estado sem história. Quem conferisse o SLA depois não teria como saber por
-- que aquele chamado corria contra um prazo mais curto.
--
-- `solicitante` é texto livre de propósito: quem pede a elevação costuma ser
-- de fora do sistema ("Coordenador de Enfermagem — Maria Souza"), e exigir um
-- usuário cadastrado faria a operação registrar o nome errado ou não registrar.
--
-- Tabela dedicada, e não a auditoria, por três razões: a auditoria não tem
-- campo para cargo e nome do solicitante; ela é trilha administrativa por
-- cliente, não coleção consultável na tela do chamado; e reclassificação vinda
-- de webhook não tem `Contexto`, que `auditar()` exige.
CREATE TABLE IF NOT EXISTS ticket_reclassificacoes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_sla_id       INTEGER NOT NULL REFERENCES tickets_sla(id) ON DELETE CASCADE,
  prioridade_anterior TEXT,
  prioridade_nova     TEXT NOT NULL,
  ocorrido_em         TEXT NOT NULL DEFAULT (datetime('now')),
  motivo              TEXT,
  solicitante         TEXT,
  -- Nulo quando a mudança veio da origem, e não de alguém operando o sistema.
  usuario_id          INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  origem              TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','integracao'))
);
CREATE INDEX IF NOT EXISTS ix_reclassificacao_ticket ON ticket_reclassificacoes(ticket_sla_id, ocorrido_em);

-- Plano de redução de despesas: quanto uma despesa custa hoje, e para quanto
-- ela deve cair.
--
-- O sistema já sabia dizer se o custo subiu ou desceu; não sabia contra o que.
-- A meta percentual (`metas`) responde por indicador inteiro — "não crescer
-- mais que X%" —, e não serve aqui: o que o gestor negocia é uma despesa
-- específica, com um valor-alvo em reais.
--
-- Uma linha por despesa escolhida, e não uma linha com uma lista: é o que
-- permite o par atual → alvo POR despesa, que é a leitura pedida. Um alvo
-- único cobrindo cinco categorias não teria como mostrar de quanto para
-- quanto cai cada uma.
--
-- `tipo_despesa_id` e `filial_id` anuláveis: nulo é "vale para o que o recorte
-- alcançar". `cliente_id`, e não `empresa_id`, porque o plano é do grupo — é a
-- mesma fronteira de `metas`.
CREATE TABLE IF NOT EXISTS planos_reducao (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id          INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nome                TEXT NOT NULL,
  tipo_despesa_id     INTEGER REFERENCES tipos_despesa(id) ON DELETE CASCADE,
  filial_id           INTEGER REFERENCES filiais(id) ON DELETE CASCADE,
  valor_alvo_centavos INTEGER NOT NULL CHECK (valor_alvo_centavos >= 0),
  vigencia_inicio     TEXT,
  vigencia_fim        TEXT,
  ativo               INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cliente_id, nome)
);
CREATE INDEX IF NOT EXISTS ix_plano_cliente ON planos_reducao(cliente_id, ativo);

-- Quem, na origem, cria despesa que já nasce reconhecida.
--
-- A carga do ERP traz quem criou cada documento (`CREATIONUSER`). O gestor
-- sabe que o que a equipe de TI lançou já foi conferido na origem, e o que
-- veio de fora dela não foi. Antes desta tabela, essa lista existia como
-- constante num script de fora do sistema: bastava uma pessoa entrar ou sair
-- do time para a classificação sair errada sem ninguém perceber.
--
-- `cliente_id`, e não `empresa_id`: a mesma pessoa lança para todas as
-- unidades do grupo, e repetir o cadastro por matriz criaria seis linhas para
-- manter em sincronia.
--
-- `chave` é o nome normalizado (maiúsculas, sem acento, sem espaço). Existe
-- como coluna porque o UNIQUE precisa dela: "Miqueias Silva" e "MIQUEIASSILVA"
-- são a mesma pessoa, e índice de SQLite não chama função nossa.
CREATE TABLE IF NOT EXISTS reconhecedores_origem (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id     INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  usuario_origem TEXT NOT NULL,
  chave          TEXT NOT NULL,
  nome_exibicao  TEXT,
  ativo          INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cliente_id, chave)
);
CREATE INDEX IF NOT EXISTS ix_reconhecedor_cliente ON reconhecedores_origem(cliente_id, ativo);

-- O DE-PARA DE VALORES DA CARGA, guardado por cliente.
--
-- A conciliação (`domain/conciliacao.ts`) já resolve que "NATAL HOME" é a
-- filial "HR RN" — mas a decisão valia só para aquela carga. Com 18 unidades
-- e uma carga por mês, o gestor refazia 18 vínculos todo mês, e um engano em
-- qualquer um deles pendurava a despesa na unidade errada.
--
-- Não reusa `mapeamentos_importacao` porque aquela tabela é de CABEÇALHO: ela
-- valida contra as colunas do template (`criarMapeamento`), e a tela de
-- Administração a lista como "apelido de coluna". Guardar de-para de VALOR ali
-- faria as duas coisas aparecerem misturadas na mesma tela.
--
-- `alvo` é o nome do cadastro, não o id: a filial pode ser recriada, e o que o
-- vínculo afirma é "este texto do arquivo quer dizer aquele nome".
CREATE TABLE IF NOT EXISTS vinculos_importacao (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  dimensao   TEXT NOT NULL,
  valor      TEXT NOT NULL,
  alvo       TEXT NOT NULL,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cliente_id, dimensao, valor)
);
