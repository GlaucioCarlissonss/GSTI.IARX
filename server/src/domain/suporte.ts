/**
 * Sistemas de suporte — o modelo unificado de chamado.
 *
 * OStick e Bitrix24 descrevem a mesma coisa com nomes diferentes. Aqui os dois
 * viram o mesmo registro: um chamado é um registro de SLA com `total = 1`,
 * o que faz toda a agregação já existente (fila, tópico, filial, percentual,
 * tendência) valer sem uma linha de mudança — e o detalhe da origem fica
 * junto, inclusive o payload como chegou.
 */
import { db } from '../db/index.js';
import { erroValidacao } from '../lib/erros.js';
import { resolverFila, resolverSetor, resolverTopicoAjuda, SETOR_NAO_CLASSIFICADO } from './cadastros.js';
import { urlDoChamado } from './sla.js';

export type SistemaOrigem = 'OSTICK' | 'BITRIX24';
export const SISTEMAS: SistemaOrigem[] = ['OSTICK', 'BITRIX24'];

export type StatusChamado = 'open' | 'in_progress' | 'resolved' | 'closed';
export type Prioridade = 'low' | 'medium' | 'high' | 'urgent';

const STATUS: StatusChamado[] = ['open', 'in_progress', 'resolved', 'closed'];
const PRIORIDADES: Prioridade[] = ['low', 'medium', 'high', 'urgent'];

/** Tamanho máximo aceito em um webhook, para o corpo não virar vetor de abuso. */
export const LIMITE_PAYLOAD_BYTES = 256 * 1024;

/** Chamado já normalizado — o formato que o resto do sistema enxerga. */
export interface ChamadoNormalizado {
  source_system: SistemaOrigem;
  external_id: string;
  title: string;
  description: string | null;
  status: StatusChamado;
  priority: Prioridade;
  sector: string;
  attendant_id: string | null;
  attendant_name: string | null;
  requester_id: string | null;
  requester_name: string | null;
  requester_email: string | null;
  queue: string | null;
  topic: string | null;
  branch: string | null;
  opened_at: string | null;
  closed_at: string | null;
  due_at: string | null;
  hours: number | null;
}

// --------------------------------------------------------------- normalização

/**
 * Controle C0/C1, marcas de direção e espaços de largura zero. Vêm colados em
 * texto copiado de outro sistema e não servem a nada aqui — o campo vai para
 * tela e para planilha, e nenhuma das duas ganha com eles no meio.
 */
const INVISIVEIS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;

const texto = (v: unknown, limite = 500): string | null => {
  if (v === null || v === undefined) return null;
  const limpo = String(v).replace(INVISIVEIS, ' ').trim();
  return limpo ? limpo.slice(0, limite) : null;
};

const primeiro = (...valores: unknown[]): string | null => {
  for (const v of valores) {
    const t = texto(v);
    if (t) return t;
  }
  return null;
};

/** Data/hora em ISO curto. Aceita ISO, `dd/mm/aaaa hh:mm` e epoch em segundos. */
function dataHora(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v > 1e12 ? v : v * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 16) + 'Z';
  }
  const t = String(v).trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/.exec(t);
  if (br) return `${br[3]}-${br[2]}-${br[1]}T${br[4] ?? '00'}:${br[5] ?? '00'}Z`;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 16) + 'Z';
}

const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Status de cada sistema para o vocabulário único. O que não casa vira
 * `open`: um chamado de status desconhecido está em aberto até prova em
 * contrário — tratá-lo como fechado esconderia trabalho pendente.
 */
function normalizarStatus(bruto: unknown): StatusChamado {
  const t = (texto(bruto) ?? '').toLowerCase();
  if (!t) return 'open';
  if (STATUS.includes(t as StatusChamado)) return t as StatusChamado;
  if (/fechad|closed|encerrad|cancelad|finalizad/.test(t)) return 'closed';
  if (/resolvid|resolved|conclu|atendid|success/.test(t)) return 'resolved';
  if (/andamento|progress|process|aguardando|em curso/.test(t)) return 'in_progress';
  return 'open';
}

/** Prioridade de cada sistema para o vocabulário único; sem nada, `medium`. */
function normalizarPrioridade(bruto: unknown): Prioridade {
  const t = (texto(bruto) ?? '').toLowerCase();
  if (!t) return 'medium';
  if (PRIORIDADES.includes(t as Prioridade)) return t as Prioridade;
  if (/urgen|critic|imediat/.test(t)) return 'urgent';
  if (/alta|high/.test(t)) return 'high';
  if (/baixa|low/.test(t)) return 'low';
  return 'medium';
}

type Bruto = Record<string, unknown>;

/**
 * Payload do OStick para o modelo unificado. Os nomes aceitos cobrem tanto o
 * que o osTicket exporta quanto o que o N8N costuma montar por cima dele.
 */
export function normalizarOstick(p: Bruto): ChamadoNormalizado {
  return {
    source_system: 'OSTICK',
    external_id: primeiro(p.external_id, p.ticket_id, p.ticketId, p.number, p.id) ?? '',
    title: primeiro(p.title, p.subject, p.assunto) ?? '',
    description: texto(p.description ?? p.body ?? p.message ?? p.descricao, 4000),
    status: normalizarStatus(p.status ?? p.status_name),
    priority: normalizarPrioridade(p.priority ?? p.priority_desc ?? p.prioridade),
    sector:
      primeiro(p.sector, p.setor, p.department, p.departamento, p.organizacao, p.organization) ??
      SETOR_NAO_CLASSIFICADO,
    attendant_id: primeiro(p.attendant_id, p.staff_id, p.assigned_id),
    attendant_name: primeiro(p.attendant_name, p.staff, p.assigned, p.atendente),
    requester_id: primeiro(p.requester_id, p.user_id),
    requester_name: primeiro(p.requester_name, p.user, p.name, p.solicitante),
    requester_email: primeiro(p.requester_email, p.email, p.user_email),
    queue: primeiro(p.queue, p.fila),
    topic: primeiro(p.topic, p.help_topic, p.topico, p.topic_name),
    branch: primeiro(p.branch, p.filial, p.unidade),
    opened_at: dataHora(p.opened_at ?? p.created ?? p.created_at ?? p.aberto_em),
    closed_at: dataHora(p.closed_at ?? p.closed ?? p.fechado_em),
    due_at: dataHora(p.due_at ?? p.duedate ?? p.est_duedate ?? p.prazo),
    hours: numero(p.hours ?? p.horas),
  };
}

/**
 * Payload do Bitrix24 para o mesmo modelo. O Bitrix nomeia em maiúsculas
 * (`ID`, `TITLE`, `STAGE_ID`), e o N8N costuma repassar assim.
 */
export function normalizarBitrix24(p: Bruto): ChamadoNormalizado {
  return {
    source_system: 'BITRIX24',
    external_id: primeiro(p.external_id, p.ID, p.id, p.TASK_ID, p.DEAL_ID) ?? '',
    title: primeiro(p.title, p.TITLE, p.NAME, p.assunto) ?? '',
    description: texto(p.description ?? p.DESCRIPTION ?? p.COMMENTS ?? p.descricao, 4000),
    status: normalizarStatus(p.status ?? p.STATUS ?? p.STAGE_ID ?? p.REAL_STATUS),
    priority: normalizarPrioridade(p.priority ?? p.PRIORITY ?? p.prioridade),
    sector:
      primeiro(p.sector, p.setor, p.DEPARTMENT, p.UF_DEPARTMENT, p.GROUP_NAME, p.CATEGORY) ??
      SETOR_NAO_CLASSIFICADO,
    attendant_id: primeiro(p.attendant_id, p.RESPONSIBLE_ID, p.ASSIGNED_BY_ID),
    attendant_name: primeiro(p.attendant_name, p.RESPONSIBLE_NAME, p.ASSIGNED_BY_NAME, p.atendente),
    requester_id: primeiro(p.requester_id, p.CREATED_BY, p.CREATED_BY_ID),
    requester_name: primeiro(p.requester_name, p.CREATED_BY_NAME, p.CONTACT_NAME, p.solicitante),
    requester_email: primeiro(p.requester_email, p.EMAIL, p.CONTACT_EMAIL),
    queue: primeiro(p.queue, p.fila, p.GROUP_NAME),
    topic: primeiro(p.topic, p.topico, p.CATEGORY, p.TAGS),
    branch: primeiro(p.branch, p.filial, p.UF_BRANCH),
    opened_at: dataHora(p.opened_at ?? p.CREATED_DATE ?? p.DATE_CREATE ?? p.aberto_em),
    closed_at: dataHora(p.closed_at ?? p.CLOSED_DATE ?? p.DATE_CLOSED ?? p.fechado_em),
    due_at: dataHora(p.due_at ?? p.DEADLINE ?? p.prazo),
    hours: numero(p.hours ?? p.TIME_SPENT_IN_LOGS ?? p.horas),
  };
}

export function normalizar(sistema: SistemaOrigem, payload: Bruto): ChamadoNormalizado {
  return sistema === 'OSTICK' ? normalizarOstick(payload) : normalizarBitrix24(payload);
}

/** Recusa o que não dá para gravar, com a lista do que falta. */
export function validarChamado(c: ChamadoNormalizado): void {
  const faltando: string[] = [];
  if (!c.external_id) faltando.push('external_id (identificador do chamado no sistema de origem)');
  if (!c.title) faltando.push('title (assunto do chamado)');
  if (faltando.length) {
    throw erroValidacao(`Payload incompleto. Faltando: ${faltando.join('; ')}.`);
  }
}

// ----------------------------------------------------------------- gravação

/**
 * Grava o chamado, criando ou atualizando pela identidade dele no sistema de
 * origem — `(empresa, source_system, external_id)`. É o que faz a reentrega do
 * webhook, que toda fila de integração pode fazer, atualizar o mesmo registro
 * em vez de criar um segundo.
 *
 * A empresa vem de fora porque o sistema é multi-tenant por regra: duas
 * empresas podem usar instâncias separadas do mesmo helpdesk, cujos ids
 * colidem sem nenhuma relação entre si.
 */
export function gravarChamado(
  empresaId: number,
  c: ChamadoNormalizado,
  bruto: unknown,
): { ticket_id: number; criado: boolean; setor: string } {
  validarChamado(c);

  const setorId = resolverSetor(empresaId, c.sector);
  const setor = (db().prepare('SELECT nome FROM setores WHERE id = ?').get(setorId) as { nome: string }).nome;
  const filialId = resolverFilialDoChamado(empresaId, c.branch);
  const filaId = resolverFilaDoChamado(empresaId, c.queue);
  const topicoId = c.topic ? resolverTopicoAjuda(empresaId, c.topic, true) : null;

  // O chamado é um registro de SLA de uma unidade. "Dentro do SLA" é derivado
  // do prazo quando ele existe; sem prazo informado, o chamado fechado conta
  // como dentro e o ainda aberto fica de fora — que é o que a operação sente.
  const referencia = c.closed_at ?? new Date().toISOString().slice(0, 16) + 'Z';
  const dentro = c.due_at ? (referencia <= c.due_at ? 1 : 0) : c.closed_at ? 1 : 0;
  const competencia = (c.opened_at ?? new Date().toISOString()).slice(0, 7);

  const anterior = db()
    .prepare(
      `SELECT id FROM tickets_sla
        WHERE empresa_id = ? AND source_system = ? AND external_id = ? AND excluido_em IS NULL`,
    )
    .get(empresaId, c.source_system, c.external_id) as { id: number } | undefined;

  const campos = {
    filial_id: filialId,
    competencia,
    fila_id: filaId,
    topico_ajuda_id: topicoId,
    total_atendidos: 1,
    dentro_sla: dentro,
    fora_sla: 1 - dentro,
    assunto: c.title,
    descricao: c.description,
    prioridade: c.priority,
    setor_id: setorId,
    status: c.status,
    solicitante: c.requester_name,
    solicitante_externo_id: c.requester_id,
    solicitante_email: c.requester_email,
    responsavel: c.attendant_name,
    atendente_externo_id: c.attendant_id,
    aberto_em: c.opened_at,
    fechado_em: c.closed_at,
    prazo_em: c.due_at,
    horas: c.hours,
    numero: c.external_id,
    origem_chamado: c.source_system,
    // O payload como chegou fica junto do registro: dá para reconferir contra
    // a origem sem depender de log, que rotaciona.
    raw_payload: JSON.stringify(bruto).slice(0, LIMITE_PAYLOAD_BYTES),
    synced_at: new Date().toISOString(),
  };

  if (anterior) {
    const colunas = Object.keys(campos);
    db()
      .prepare(
        `UPDATE tickets_sla SET ${colunas.map((c2) => `${c2} = ?`).join(', ')}, atualizado_em = datetime('now')
          WHERE id = ?`,
      )
      .run(...Object.values(campos), anterior.id);
    return { ticket_id: anterior.id, criado: false, setor };
  }

  const colunas = ['empresa_id', 'source_system', 'external_id', ...Object.keys(campos)];
  const info = db()
    .prepare(
      `INSERT INTO tickets_sla (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})`,
    )
    .run(empresaId, c.source_system, c.external_id, ...Object.values(campos));
  return { ticket_id: Number(info.lastInsertRowid), criado: true, setor };
}

/** Filial pelo nome; a que não existe é criada, como na importação. */
function resolverFilialDoChamado(empresaId: number, nome: string | null): number | null {
  const limpo = (nome ?? '').trim();
  if (!limpo) return null;
  const existente = db().prepare('SELECT id FROM filiais WHERE empresa_id = ? AND nome = ?').get(empresaId, limpo) as
    | { id: number }
    | undefined;
  if (existente) return existente.id;
  const info = db().prepare('INSERT INTO filiais (empresa_id, nome) VALUES (?, ?)').run(empresaId, limpo);
  return Number(info.lastInsertRowid);
}

/**
 * Fila pelo nome. Sem fila informada, o chamado cai na primeira fila da
 * empresa — a coluna é obrigatória no schema, e recusar o chamado por causa
 * disso perderia o registro que o webhook veio entregar.
 */
function resolverFilaDoChamado(empresaId: number, nome: string | null): number {
  const limpo = (nome ?? '').trim();
  if (limpo) {
    const achada = resolverFila(empresaId, limpo);
    if (achada) return achada;
    const info = db()
      .prepare('INSERT INTO filas_ticket (empresa_id, nome, ordem) VALUES (?, ?, (SELECT COALESCE(MAX(ordem), 0) + 1 FROM filas_ticket WHERE empresa_id = ?))')
      .run(empresaId, limpo, empresaId);
    return Number(info.lastInsertRowid);
  }
  const primeira = db()
    .prepare('SELECT id FROM filas_ticket WHERE empresa_id = ? ORDER BY ordem, id LIMIT 1')
    .get(empresaId) as { id: number } | undefined;
  if (primeira) return primeira.id;
  const info = db()
    .prepare('INSERT INTO filas_ticket (empresa_id, nome, ordem) VALUES (?, ?, 1)')
    .run(empresaId, 'Infraestrutura');
  return Number(info.lastInsertRowid);
}

// ----------------------------------------------------------------- consulta

export interface FiltroChamados {
  sistemas?: SistemaOrigem[];
  setorIds?: number[];
  atendentes?: string[];
  solicitantes?: string[];
  status?: StatusChamado[];
  prioridades?: Prioridade[];
  filaIds?: number[];
  topicoIds?: Array<number | null>;
  /** 'dentro' | 'fora' — o recorte que os gráficos de SLA usam. */
  sla?: string[];
  filialId?: number | null;
  competenciaInicio?: string;
  competenciaFim?: string;
  busca?: string;
  limite?: number;
  pagina?: number;
}

const SQL_CHAMADO = `
  SELECT s.id, s.source_system, s.external_id, s.ticket_id, s.numero, s.assunto, s.descricao, s.status, s.prioridade,
         s.setor_id, st.nome AS setor, s.solicitante, s.solicitante_email, s.solicitante_externo_id,
         s.responsavel, s.atendente_externo_id, s.filial_id, f.nome AS filial_nome,
         s.fila_id, q.nome AS fila, ta.nome AS topico_ajuda,
         s.competencia, s.aberto_em, s.fechado_em, s.prazo_em, s.horas,
         s.total_atendidos, s.dentro_sla, s.fora_sla, s.synced_at, s.criado_em, s.atualizado_em
    FROM tickets_sla s
    LEFT JOIN setores st ON st.id = s.setor_id
    LEFT JOIN filiais f ON f.id = s.filial_id
    LEFT JOIN filas_ticket q ON q.id = s.fila_id
    LEFT JOIN topicos_ajuda ta ON ta.id = s.topico_ajuda_id`;

/**
 * Acrescenta ao chamado o endereço dele no sistema de origem. O link sai do
 * servidor, e não de cada tela: assim a listagem, o detalhe e o detalhamento
 * de qualquer indicador apontam para o mesmo lugar.
 */
const comEndereco = (empresaId: number) => (linha: Record<string, unknown>) => ({
  ...linha,
  url_externa: urlDoChamado(
    empresaId,
    (linha.external_id as string | null) ?? (linha.ticket_id as number | null),
    linha.source_system as string | null,
  ),
});

function montarFiltro(empresaId: number, f: FiltroChamados) {
  // Só o que veio de um sistema de suporte: o registro agregado mensal, sem
  // `source_system`, pertence à tela de indicadores, não à de chamados.
  const condicoes = ['s.empresa_id = ?', 's.excluido_em IS NULL', 's.source_system IS NOT NULL'];
  const params: unknown[] = [empresaId];

  const emLista = (coluna: string, valores?: unknown[]) => {
    if (!valores?.length) return;
    condicoes.push(`${coluna} IN (${valores.map(() => '?').join(',')})`);
    params.push(...valores);
  };
  emLista('s.source_system', f.sistemas);
  emLista('s.setor_id', f.setorIds);
  emLista('s.responsavel', f.atendentes);
  emLista('s.solicitante', f.solicitantes);
  emLista('s.status', f.status);
  emLista('s.prioridade', f.prioridades);
  emLista('s.fila_id', f.filaIds);

  if (f.topicoIds?.length) {
    // "(sem tópico)" é `NULL`, que `IN` não alcança sozinho.
    const ids = f.topicoIds.filter((v): v is number => v !== null);
    const partes: string[] = [];
    if (ids.length) {
      partes.push(`s.topico_ajuda_id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
    if (f.topicoIds.includes(null)) partes.push('s.topico_ajuda_id IS NULL');
    condicoes.push(`(${partes.join(' OR ')})`);
  }

  if (f.sla?.length && f.sla.length < 2) {
    // Dentro do SLA é `dentro_sla >= total_atendidos`; o chamado tem total 1.
    condicoes.push(f.sla[0] === 'dentro' ? 's.dentro_sla >= s.total_atendidos' : 's.dentro_sla < s.total_atendidos');
  }

  if (f.filialId === null) condicoes.push('s.filial_id IS NULL');
  else if (f.filialId !== undefined) {
    condicoes.push('s.filial_id = ?');
    params.push(f.filialId);
  }
  if (f.competenciaInicio) {
    condicoes.push('s.competencia >= ?');
    params.push(f.competenciaInicio);
  }
  if (f.competenciaFim) {
    condicoes.push('s.competencia <= ?');
    params.push(f.competenciaFim);
  }
  if (f.busca?.trim()) {
    const alvo = `%${f.busca.trim().toLowerCase()}%`;
    condicoes.push(
      '(LOWER(s.assunto) LIKE ? OR LOWER(s.descricao) LIKE ? OR LOWER(s.solicitante) LIKE ?' +
        ' OR LOWER(s.responsavel) LIKE ? OR s.external_id LIKE ? OR s.numero LIKE ?)',
    );
    params.push(alvo, alvo, alvo, alvo, alvo, alvo);
  }
  return { where: condicoes.join(' AND '), params };
}

/**
 * Chamados no escopo, paginados. A contagem vem junto porque a tela precisa
 * dizer quantos existem, não só quantos couberam na página.
 */
export function listarChamados(empresaId: number, f: FiltroChamados = {}) {
  const { where, params } = montarFiltro(empresaId, f);
  const limite = Math.min(Math.max(f.limite ?? 100, 1), 500);
  const pagina = Math.max(f.pagina ?? 1, 1);

  const total = (
    db().prepare(`SELECT COUNT(*) AS n FROM tickets_sla s WHERE ${where}`).get(...params) as { n: number }
  ).n;
  const itens = (
    db()
      .prepare(`${SQL_CHAMADO} WHERE ${where} ORDER BY s.aberto_em DESC, s.id DESC LIMIT ? OFFSET ?`)
      .all(...params, limite, (pagina - 1) * limite) as Array<Record<string, unknown>>
  ).map(comEndereco(empresaId));

  return {
    itens,
    paginacao: { pagina, limite, total, paginas: Math.max(Math.ceil(total / limite), 1) },
    resumo: resumoDosChamados(empresaId, f),
  };
}

/** Totais do mesmo recorte, para os indicadores baterem com a lista. */
function resumoDosChamados(empresaId: number, f: FiltroChamados) {
  const { where, params } = montarFiltro(empresaId, f);
  const linha = db()
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN s.status IN ('open','in_progress') THEN 1 ELSE 0 END) AS em_aberto,
              SUM(s.dentro_sla) AS dentro_sla
         FROM tickets_sla s WHERE ${where}`,
    )
    .get(...params) as { total: number; em_aberto: number | null; dentro_sla: number | null };
  const total = linha.total ?? 0;
  const dentro = linha.dentro_sla ?? 0;
  return {
    total,
    em_aberto: linha.em_aberto ?? 0,
    dentro_sla: dentro,
    pct_dentro_sla: total > 0 ? Math.round((dentro / total) * 1000) / 10 : 0,
  };
}

/** Um chamado, com o payload de origem. */
export function obterChamado(empresaId: number, id: number) {
  const linha = db()
    .prepare(`${SQL_CHAMADO} WHERE s.id = ? AND s.empresa_id = ? AND s.excluido_em IS NULL`)
    .get(id, empresaId) as Record<string, unknown> | undefined;
  if (!linha) throw erroValidacao(`Chamado ${id} não encontrado nesta empresa.`);
  const chamado = comEndereco(empresaId)(linha);
  const bruto = db().prepare('SELECT raw_payload FROM tickets_sla WHERE id = ?').get(id) as
    | { raw_payload: string | null }
    | undefined;
  let payload: unknown = null;
  try {
    payload = bruto?.raw_payload ? JSON.parse(bruto.raw_payload) : null;
  } catch {
    // Payload ilegível não derruba a tela: o campo bruto ainda vale como texto.
    payload = bruto?.raw_payload ?? null;
  }
  return { ...chamado, raw_payload: payload };
}

/** Valores presentes no recorte, para montar os filtros sem inventar opções. */
export function opcoesDeFiltro(empresaId: number, sistemas?: SistemaOrigem[]) {
  const { where, params } = montarFiltro(empresaId, { sistemas });
  const distintos = (coluna: string) =>
    (
      db()
        .prepare(`SELECT DISTINCT ${coluna} AS v FROM tickets_sla s WHERE ${where} AND ${coluna} IS NOT NULL ORDER BY v`)
        .all(...params) as Array<{ v: string }>
    ).map((l) => l.v);
  return {
    setores: db()
      .prepare(
        `SELECT DISTINCT st.id, st.nome FROM tickets_sla s JOIN setores st ON st.id = s.setor_id
          WHERE ${where} ORDER BY st.nome`,
      )
      .all(...params),
    atendentes: distintos('s.responsavel'),
    solicitantes: distintos('s.solicitante'),
    status: distintos('s.status'),
    prioridades: distintos('s.prioridade'),
    competencias: distintos('s.competencia'),
  };
}
