/**
 * METAS — o alvo contra o qual cada indicador é lido.
 *
 * Um indicador que mostra só o resultado obriga quem lê a saber de cabeça o
 * que era esperado. Até aqui o sistema tinha um alvo só, `META_SLA = 80`,
 * escrito à mão em três lugares (`domain/indicadores.ts`, a tela do painel e o
 * artifact) — e nenhum deles configurável.
 *
 * Esta é a fonte única. Quem pergunta "qual é a meta?" pergunta a
 * `alvoDe(...)`, que devolve o cadastro quando existe e o padrão de base
 * quando não existe. Nenhuma instalação fica sem termômetro por não ter
 * cadastrado nada, e nenhuma fica presa ao 80 quando cadastrou.
 */
import { db } from '../db/index.js';
import { erroConflito, erroNaoEncontrado, erroValidacao } from '../lib/erros.js';
import { auditar } from './auditoria.js';
import { ehCompetenciaValida, paraExibicao, paraInterno } from './competencia.js';
import type { Contexto } from './contexto.js';

export type ModuloMeta = 'financeiro' | 'sla' | 'projetos' | 'equilibrio';

export const MODULOS_META: ModuloMeta[] = ['financeiro', 'sla', 'projetos', 'equilibrio'];

export const ROTULO_MODULO_META: Record<ModuloMeta, string> = {
  financeiro: 'Financeiro',
  sla: 'SLA',
  projetos: 'Projetos',
  equilibrio: 'Equilíbrio de despesas',
};

/**
 * Os alvos que valem quando ninguém cadastrou nada.
 *
 * O 80 do SLA não é um número novo: é exatamente o que estava escrito no
 * código antes desta tabela existir. Mantê-lo como padrão é o que permite
 * introduzir o cadastro sem mudar nenhum número de nenhuma instalação.
 */
export const ALVO_PADRAO: Record<ModuloMeta, number | null> = {
  sla: 80,
  projetos: 80,
  financeiro: null,
  equilibrio: null,
};

/**
 * O lado bom da meta.
 *
 * SLA e entrega no prazo são PISO: quanto mais alto, melhor. Variação de custo
 * e equilíbrio de despesas são TETO: passar do alvo é o problema. Sem esta
 * distinção, um indicador de custo acima da meta seria pintado de verde.
 *
 * É propriedade do módulo, e não escolha de quem cadastra: "quanto maior
 * melhor" não é opinião sobre o SLA.
 */
export type DirecaoMeta = 'minimo' | 'maximo';

export const DIRECAO_META: Record<ModuloMeta, DirecaoMeta> = {
  sla: 'minimo',
  projetos: 'minimo',
  financeiro: 'maximo',
  equilibrio: 'maximo',
};

export interface LeituraMeta {
  alvo: number;
  atingido: number | null;
  direcao: DirecaoMeta;
  atinge: boolean;
  /** Distância em pontos percentuais, sempre positiva a favor. `null` sem resultado. */
  distancia: number | null;
}

/**
 * O resultado lido contra o alvo — a forma que a tela consome.
 *
 * Devolve `null` quando não há meta: o indicador continua mostrando o número,
 * só não mostra a comparação. Inventar um alvo para ter o que comparar seria
 * pior do que não comparar.
 */
export function leituraDeMeta(
  alvo: number | null,
  atingido: number | null,
  modulo: ModuloMeta,
): LeituraMeta | null {
  if (alvo === null) return null;
  const direcao = DIRECAO_META[modulo];
  if (atingido === null) return { alvo, atingido: null, direcao, atinge: false, distancia: null };
  const bruto = direcao === 'minimo' ? atingido - alvo : alvo - atingido;
  return {
    alvo,
    atingido,
    direcao,
    atinge: bruto >= 0,
    distancia: Math.round(bruto * 10) / 10,
  };
}

/**
 * A leitura quando o recorte atravessa vigências.
 *
 * `varias` é a marca que a tela usa para escolher o desenho: em vez de uma
 * barra contra um alvo — que não existe para o período —, o placar de meses.
 */
export interface LeituraMetaMensal {
  varias: true;
  metas: LinhaMeta[];
  meses: Array<{ competencia: string; alvo: number; valor: number; atinge: boolean }>;
  dentro: number;
  total: number;
  direcao: DirecaoMeta;
  atinge: boolean;
}

export interface LinhaMeta {
  id: number;
  nome: string;
  modulo: ModuloMeta;
  alvo_pct: number;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  ativo: number;
}

function clienteDo(ctx: Contexto): number {
  if (ctx.clienteId === null) throw erroValidacao('Operação sem cliente em foco.');
  return ctx.clienteId;
}

/** Competência opcional: vazio vira nulo, preenchido tem de ser válido. */
function vigencia(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null || valor === '') return null;
  if (!ehCompetenciaValida(valor)) throw erroValidacao(`${campo} inválida. Use o formato MM/AAAA.`);
  return paraInterno(valor);
}

function validarAlvo(valor: unknown): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) throw erroValidacao('O valor-alvo da meta é obrigatório e precisa ser um número.');
  if (n < 0 || n > 100) throw erroValidacao('O valor-alvo da meta é um percentual entre 0 e 100.');
  return Math.round(n * 10) / 10;
}

function validarModulo(valor: unknown): ModuloMeta {
  const texto = String(valor ?? '').trim().toLowerCase();
  if (!MODULOS_META.includes(texto as ModuloMeta)) {
    throw erroValidacao(`Módulo da meta inválido. Use um de: ${MODULOS_META.join(', ')}.`);
  }
  return texto as ModuloMeta;
}

export function listarMetas(ctx: Contexto, incluirInativas = false): LinhaMeta[] {
  return db()
    .prepare(
      `SELECT id, nome, modulo, alvo_pct, vigencia_inicio, vigencia_fim, ativo
         FROM metas
        WHERE cliente_id = ? ${incluirInativas ? '' : 'AND ativo = 1'}
        ORDER BY modulo, nome`,
    )
    .all(clienteDo(ctx)) as LinhaMeta[];
}

export interface EntradaMeta {
  nome?: unknown;
  modulo?: unknown;
  alvo_pct?: unknown;
  vigencia_inicio?: unknown;
  vigencia_fim?: unknown;
}

export function criarMeta(ctx: Contexto, dados: EntradaMeta): LinhaMeta {
  const clienteId = clienteDo(ctx);
  const nome = String(dados.nome ?? '').trim();
  if (!nome) throw erroValidacao('Nome da meta é obrigatório.');
  const modulo = validarModulo(dados.modulo);
  const alvo = validarAlvo(dados.alvo_pct);
  const inicio = vigencia(dados.vigencia_inicio, 'Vigência inicial');
  const fim = vigencia(dados.vigencia_fim, 'Vigência final');
  if (inicio && fim && inicio > fim) throw erroValidacao('A vigência final é anterior à inicial.');

  const existente = db().prepare('SELECT id FROM metas WHERE cliente_id = ? AND nome = ?').get(clienteId, nome);
  if (existente) throw erroConflito(`A meta "${nome}" já existe neste cliente.`);

  const info = db()
    .prepare(
      `INSERT INTO metas (cliente_id, nome, modulo, alvo_pct, vigencia_inicio, vigencia_fim)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(clienteId, nome, modulo, alvo, inicio, fim);
  const id = Number(info.lastInsertRowid);
  const criada = obterMeta(ctx, id);
  auditar(ctx, { entidade: 'meta', entidadeId: id, acao: 'criar', depois: criada, comEmpresa: false });
  return criada;
}

export function obterMeta(ctx: Contexto, id: number): LinhaMeta {
  const linha = db()
    .prepare(
      `SELECT id, nome, modulo, alvo_pct, vigencia_inicio, vigencia_fim, ativo
         FROM metas WHERE id = ? AND cliente_id = ?`,
    )
    .get(id, clienteDo(ctx)) as LinhaMeta | undefined;
  if (!linha) throw erroNaoEncontrado(`Meta ${id} não encontrada neste cliente.`);
  return linha;
}

export function atualizarMeta(ctx: Contexto, id: number, dados: EntradaMeta & { ativo?: unknown }): LinhaMeta {
  const antes = obterMeta(ctx, id);
  const nome = dados.nome === undefined ? antes.nome : String(dados.nome).trim() || antes.nome;
  const modulo = dados.modulo === undefined ? antes.modulo : validarModulo(dados.modulo);
  const alvo = dados.alvo_pct === undefined ? antes.alvo_pct : validarAlvo(dados.alvo_pct);
  const inicio = dados.vigencia_inicio === undefined ? antes.vigencia_inicio : vigencia(dados.vigencia_inicio, 'Vigência inicial');
  const fim = dados.vigencia_fim === undefined ? antes.vigencia_fim : vigencia(dados.vigencia_fim, 'Vigência final');
  if (inicio && fim && inicio > fim) throw erroValidacao('A vigência final é anterior à inicial.');
  const ativo = dados.ativo === undefined ? antes.ativo : dados.ativo ? 1 : 0;

  if (nome !== antes.nome) {
    const existente = db()
      .prepare('SELECT id FROM metas WHERE cliente_id = ? AND nome = ? AND id <> ?')
      .get(clienteDo(ctx), nome, id);
    if (existente) throw erroConflito(`A meta "${nome}" já existe neste cliente.`);
  }

  db()
    .prepare(
      `UPDATE metas SET nome = ?, modulo = ?, alvo_pct = ?, vigencia_inicio = ?, vigencia_fim = ?, ativo = ?
        WHERE id = ? AND cliente_id = ?`,
    )
    .run(nome, modulo, alvo, inicio, fim, ativo, id, clienteDo(ctx));
  const depois = obterMeta(ctx, id);
  auditar(ctx, { entidade: 'meta', entidadeId: id, acao: 'atualizar', antes, depois, comEmpresa: false });
  return depois;
}

/**
 * A meta que vale para este módulo nesta competência — ou `null`.
 *
 * Havendo mais de uma vigente, ganha a de início mais recente: é a que foi
 * cadastrada para valer "de agora em diante". `ORDER BY ... DESC` deixa a de
 * início nulo ("desde sempre") por último, que é exatamente a precedência
 * desejada — o alvo genérico só vale onde nenhum específico alcança.
 */
export function metaVigente(ctx: Contexto, modulo: ModuloMeta, competencia?: string): LinhaMeta | null {
  if (ctx.clienteId === null) return null;
  const comp = competencia ? paraInterno(competencia) : null;
  const linha = db()
    .prepare(
      `SELECT id, nome, modulo, alvo_pct, vigencia_inicio, vigencia_fim, ativo
         FROM metas
        WHERE cliente_id = ? AND modulo = ? AND ativo = 1
          AND (vigencia_inicio IS NULL OR ? IS NULL OR vigencia_inicio <= ?)
          AND (vigencia_fim    IS NULL OR ? IS NULL OR vigencia_fim    >= ?)
        ORDER BY vigencia_inicio DESC
        LIMIT 1`,
    )
    .get(ctx.clienteId, modulo, comp, comp, comp, comp) as LinhaMeta | undefined;
  return linha ?? null;
}

/**
 * O alvo em pontos percentuais para este módulo — cadastro, ou o padrão.
 *
 * É esta função que o resto do sistema chama. Devolver o padrão em vez de
 * `null` é o que mantém o termômetro de pé numa base sem nenhuma meta
 * cadastrada, que é o estado de toda instalação existente hoje.
 */
export function alvoDe(ctx: Contexto, modulo: ModuloMeta, competencia?: string): number | null {
  return metaVigente(ctx, modulo, competencia)?.alvo_pct ?? ALVO_PADRAO[modulo];
}

/**
 * As metas que regem os meses dados, da mais antiga para a mais nova.
 *
 * Um recorte é um PERÍODO e o cadastro tem vigência: 01/2026 a 01/2027 pode
 * atravessar duas metas. Escolher uma só — a do último mês, como o sistema
 * fazia — julgava treze meses por uma regra que valia para cinco, e a outra
 * meta sumia da tela sem explicação.
 */
export function metasDoRecorte(ctx: Contexto, modulo: ModuloMeta, competencias: string[]): LinhaMeta[] {
  const vistas = new Map<number, LinhaMeta>();
  for (const c of competencias) {
    const m = metaVigente(ctx, modulo, c);
    if (m) vistas.set(m.id, m);
  }
  return [...vistas.values()].sort((a, b) =>
    String(a.vigencia_inicio ?? '').localeCompare(String(b.vigencia_inicio ?? '')));
}

/**
 * O resultado contra a meta, mês a mês.
 *
 * `pontos` são `{competencia, valor}` — um por mês do recorte. Cada um é medido
 * contra a meta que rege AQUELE mês, que é a única leitura honesta quando o
 * período atravessa vigências.
 *
 * Com zero ou uma meta no período devolve a leitura de sempre: o caso comum não
 * muda de forma, e trocar uma comparação única por um placar perderia
 * informação.
 */
export function leituraMensalDeMeta(
  ctx: Contexto,
  modulo: ModuloMeta,
  pontos: Array<{ competencia: string; valor: number | null }>,
  totalAtingido: number | null,
): LeituraMeta | LeituraMetaMensal | null {
  const metas = metasDoRecorte(ctx, modulo, pontos.map((p) => p.competencia));
  if (metas.length <= 1) {
    const ultima = pontos.length ? pontos[pontos.length - 1]!.competencia : undefined;
    return leituraDeMeta(alvoDe(ctx, modulo, ultima ? paraExibicao(ultima) : undefined), totalAtingido, modulo);
  }

  const direcao = DIRECAO_META[modulo];
  const meses = pontos
    .filter((p) => p.valor !== null)
    .map((p) => {
      const alvo = alvoDe(ctx, modulo, paraExibicao(p.competencia));
      if (alvo === null) return null;
      const bruto = direcao === 'minimo' ? p.valor! - alvo : alvo - p.valor!;
      return { competencia: p.competencia, alvo, valor: p.valor!, atinge: bruto >= 0 };
    })
    .filter((m): m is { competencia: string; alvo: number; valor: number; atinge: boolean } => m !== null);

  const dentro = meses.filter((m) => m.atinge).length;
  return {
    varias: true, metas, meses, dentro, total: meses.length, direcao,
    // `atinge` só quando TODOS os meses atingiram: o indicador é do período, e
    // dizer "atingiu" com um mês fora seria arredondar a favor.
    atinge: meses.length > 0 && dentro === meses.length,
  };
}
