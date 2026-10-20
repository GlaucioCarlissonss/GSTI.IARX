/**
 * O PLANO DE AÇÃO DA IMPLANTAÇÃO — as ações que levam cada onda ao go-live.
 *
 * O módulo de Projetos responde "como está cada atividade em cada unidade".
 * Este plano responde outra coisa: "o que falta fazer, por quem, e até
 * quando". São as ações distribuídas pelas ondas do cronograma, com data de
 * início e de fim DIÁRIAS — não mensais —, área responsável e líder.
 *
 * Estas regras existem duas vezes, aqui e em `artifact/app-js23.js`, e é por
 * isso que têm conferência própria: duas cópias divergem na primeira correção
 * feita de um lado só, e a divergência é silenciosa — os dois lados seguem
 * mostrando um placar plausível.
 *
 * O QUE SE GUARDA É A FONTE, NUNCA O DERIVADO. Farol, situação e "quantos
 * dias" não moram no banco: foram calculados contra algum dia, e gravá-los
 * faria o painel envelhecer em silêncio, dizendo "vence em 2 dias" uma semana
 * depois. É a mesma razão de "fora do SLA" nunca ser gravado.
 */
import { db, emTransacao } from '../db/index.js';
import type { Contexto } from './contexto.js';
import { ONDAS } from './cronograma.js';

/** Os status que a planilha de origem usa na coluna "Status da Ação". */
export const PLANO_STATUS = ['Não iniciado', 'Em andamento', 'Concluído', 'Cancelado'] as const;
export type StatusAcao = (typeof PLANO_STATUS)[number];

/**
 * A régua do farol, em dias corridos até a data de fim.
 *
 * Três dias é o que o plano do cliente usa, e mudá-lo aqui faria a tela e o
 * documento dele discordarem sobre o que é urgente. Dias CORRIDOS, e não
 * úteis: o plano conta assim, e o motor de horas úteis existe para o SLA, que
 * é outro compromisso.
 */
export const PLANO_DIAS_AMARELO = 3;

export const PLANO_SITUACOES = [
  'Não iniciado', 'Em andamento', 'Atrasado', 'Concluído', 'Cancelado',
] as const;
export type SituacaoAcao = (typeof PLANO_SITUACOES)[number];

export type ChaveFarol = 'CONCLUIDO' | 'CANCELADO' | 'SEM_DATA' | 'ATRASADO' | 'VENCE' | 'NO_PRAZO';

export interface AcaoDoPlano {
  id?: number;
  onda: number;
  numero: number;
  tarefa: string;
  area: string;
  lider: string;
  inicio: string | null;
  fim: string | null;
  status: string;
  link: string;
  observacoes: string;
  evolucoes: string;
}

export interface AcaoDerivada extends AcaoDoPlano {
  farol: ChaveFarol;
  farol_rotulo: string;
  dias_para_prazo: number | null;
  situacao: SituacaoAcao;
  em_aberto: boolean;
}

/** Hoje em ISO. Função, e não constante: o processo fica de pé e o dia vira. */
export const hojeISO = (agora: Date = new Date()): string => agora.toISOString().slice(0, 10);

/** Dias corridos de `a` até `b`, pelas datas em ISO. */
export function diasEntre(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ms = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
    - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  return Math.round(ms / 86400000);
}

/**
 * O farol de uma ação, contra um dia.
 *
 * A ordem das perguntas importa: concluída e cancelada saem ANTES do prazo,
 * porque uma ação entregue na semana passada não está atrasada — ela está
 * pronta, e pintá-la de vermelho encheria a lista de urgências de coisa
 * resolvida.
 */
export function farolDe(acao: Pick<AcaoDoPlano, 'status' | 'fim'>, dia: string) {
  if (acao.status === 'Concluído') {
    return { chave: 'CONCLUIDO' as ChaveFarol, rotulo: 'Concluído', dias: null };
  }
  if (acao.status === 'Cancelado') {
    return { chave: 'CANCELADO' as ChaveFarol, rotulo: 'Cancelado', dias: null };
  }
  if (!acao.fim) return { chave: 'SEM_DATA' as ChaveFarol, rotulo: 'Sem data', dias: null };
  const dias = diasEntre(dia, acao.fim)!;
  if (dias < 0) {
    return { chave: 'ATRASADO' as ChaveFarol, rotulo: `Atrasado ${Math.abs(dias)}d`, dias };
  }
  if (dias <= PLANO_DIAS_AMARELO) {
    return { chave: 'VENCE' as ChaveFarol, rotulo: `Vence em ${dias}d`, dias };
  }
  return { chave: 'NO_PRAZO' as ChaveFarol, rotulo: `No prazo ${dias}d`, dias };
}

/**
 * A SITUAÇÃO da ação — o que o placar conta.
 *
 * É o status, com uma exceção: a ação em aberto cujo prazo venceu conta como
 * ATRASADA, e não como "em andamento" ou "não iniciada". É o que faz os cinco
 * baldes somarem o total sem contar ninguém duas vezes.
 */
export function situacaoDe(acao: Pick<AcaoDoPlano, 'status' | 'fim'>, dia: string): SituacaoAcao {
  const f = farolDe(acao, dia);
  if (f.chave === 'ATRASADO') return 'Atrasado';
  const s = acao.status as SituacaoAcao;
  return PLANO_SITUACOES.includes(s) ? s : 'Não iniciado';
}

/** A ação com os derivados prontos. Nenhum deles é gravado. */
export function derivar(acao: AcaoDoPlano, dia: string): AcaoDerivada {
  const f = farolDe(acao, dia);
  return {
    ...acao,
    farol: f.chave,
    farol_rotulo: f.rotulo,
    dias_para_prazo: f.dias,
    situacao: situacaoDe(acao, dia),
    // Concluída e cancelada não entram no "o que falta": a primeira acabou, e
    // a segunda foi tirada do plano de propósito.
    em_aberto: acao.status !== 'Concluído' && acao.status !== 'Cancelado',
  };
}

export interface PlacarDoPlano {
  total: number;
  validas: number;
  concluidas: number;
  em_andamento: number;
  nao_iniciadas: number;
  atrasadas: number;
  canceladas: number;
  /** `null` quando não há ação válida: zero diria que nada foi feito. */
  pct_concluido: number | null;
  por_situacao: Record<string, number>;
  por_farol: Record<string, number>;
}

/** O placar do plano, sempre recalculado — jamais lido de uma coluna. */
export function placar(acoes: AcaoDerivada[]): PlacarDoPlano {
  const porSituacao: Record<string, number> = {};
  for (const s of PLANO_SITUACOES) porSituacao[s] = 0;
  const porFarol: Record<string, number> = {};
  for (const a of acoes) {
    porSituacao[a.situacao] = (porSituacao[a.situacao] ?? 0) + 1;
    porFarol[a.farol] = (porFarol[a.farol] ?? 0) + 1;
  }
  const total = acoes.length;
  const concluidas = porSituacao['Concluído'] ?? 0;
  // O denominador EXCLUI as canceladas: elas saíram do plano, e mantê-las
  // embaixo da divisão faria o percentual nunca poder chegar a 100%.
  const validas = total - (porSituacao['Cancelado'] ?? 0);
  return {
    total,
    validas,
    concluidas,
    em_andamento: porSituacao['Em andamento'] ?? 0,
    nao_iniciadas: porSituacao['Não iniciado'] ?? 0,
    atrasadas: porSituacao['Atrasado'] ?? 0,
    canceladas: porSituacao['Cancelado'] ?? 0,
    pct_concluido: validas ? Math.round((concluidas / validas) * 1000) / 10 : null,
    por_situacao: porSituacao,
    por_farol: porFarol,
  };
}

export interface OndaDoPlano extends PlacarDoPlano {
  onda: number;
  virada: string;
  unidades: string[];
  em_producao: boolean;
  acoes: AcaoDerivada[];
}

/**
 * O placar de cada onda, na ordem do cronograma.
 *
 * As ondas vêm do cronograma, e não dos dados: uma onda sem nenhuma ação
 * cadastrada precisa aparecer zerada, e não sumir do painel — sumir faria a
 * ausência de plano parecer ausência de onda.
 */
export function porOnda(acoes: AcaoDerivada[]): OndaDoPlano[] {
  return ONDAS.map((o) => {
    const dela = acoes.filter((a) => a.onda === o.n);
    return {
      onda: o.n,
      virada: o.virada,
      unidades: o.unidades,
      em_producao: !!o.viradaRealizada,
      ...placar(dela),
      acoes: dela,
    };
  });
}

// ---------------------------------------------------------------- persistência

interface LinhaPlano {
  id: number;
  onda: number;
  numero: number;
  tarefa: string;
  area: string;
  lider: string;
  inicio: string | null;
  fim: string | null;
  status: string;
  link: string;
  observacoes: string;
  evolucoes: string;
}

/** As ações cadastradas do cliente em contexto, sem derivar. */
export function acoesDoCliente(ctx: Contexto): AcaoDoPlano[] {
  const linhas = db().prepare(
    `SELECT id, onda, numero, tarefa, area, lider, inicio, fim, status, link,
            observacoes, evolucoes
       FROM plano_acao
      WHERE cliente_id IS ?
      ORDER BY onda, numero`,
  ).all(ctx.clienteId) as LinhaPlano[];
  return linhas;
}

export interface PainelDoPlano {
  hoje: string;
  placar: PlacarDoPlano;
  ondas: OndaDoPlano[];
  acoes: AcaoDerivada[];
}

/** O painel inteiro: ações derivadas, placar geral e placar por onda. */
export function painel(ctx: Contexto, dia: string = hojeISO()): PainelDoPlano {
  const acoes = acoesDoCliente(ctx).map((a) => derivar(a, dia));
  return { hoje: dia, placar: placar(acoes), ondas: porOnda(acoes), acoes };
}

export interface ResultadoDaCarga {
  gravadas: number;
  removidas: number;
}

/**
 * Grava o plano do cliente, substituindo o que havia.
 *
 * SUBSTITUIÇÃO, e não acréscimo: o arquivo é a íntegra do plano, e mesclar
 * faria uma ação removida do documento continuar cobrando prazo na tela para
 * sempre. Numa transação só — um plano meio gravado é pior que nenhum.
 */
export function substituirPlano(ctx: Contexto, acoes: AcaoDoPlano[]): ResultadoDaCarga {
  return emTransacao(() => {
    const antes = (db().prepare(
      'SELECT COUNT(*) AS n FROM plano_acao WHERE cliente_id IS ?',
    ).get(ctx.clienteId) as { n: number }).n;
    db().prepare('DELETE FROM plano_acao WHERE cliente_id IS ?').run(ctx.clienteId);
    const inserir = db().prepare(
      `INSERT INTO plano_acao
         (cliente_id, onda, numero, tarefa, area, lider, inicio, fim, status,
          link, observacoes, evolucoes, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    );
    for (const a of acoes) {
      inserir.run(
        ctx.clienteId, a.onda, a.numero, a.tarefa, a.area ?? '', a.lider ?? '',
        a.inicio || null, a.fim || null,
        (PLANO_STATUS as readonly string[]).includes(a.status) ? a.status : 'Não iniciado',
        a.link ?? '', a.observacoes ?? '', a.evolucoes ?? '',
      );
    }
    return { gravadas: acoes.length, removidas: antes };
  });
}

/** Apaga o plano do cliente. Devolve quantas ações saíram. */
export function removerPlano(ctx: Contexto): number {
  const r = db().prepare('DELETE FROM plano_acao WHERE cliente_id IS ?').run(ctx.clienteId);
  return r.changes;
}
