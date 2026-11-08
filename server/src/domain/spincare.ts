/**
 * O CONTROLE ÚNICO do projeto de implantação.
 *
 * A Visão Macro pergunta se a unidade virou no dia combinado. Esta pergunta é
 * a outra: **atividade a atividade, como está cada unidade?**
 *
 * A linha é uma ATIVIDADE, e cada unidade acompanhada tem uma situação dentro
 * dela. Uma atividade concluída em três unidades e não iniciada em outras três
 * é UMA linha, não seis.
 *
 * Estas regras existem duas vezes — aqui e em `artifact/app-js21.js` —, e é
 * por isso que têm conferência própria: duas cópias divergem na primeira
 * correção feita de um lado só, e a divergência é silenciosa.
 *
 * NADA DE DERIVADO É GRAVADO. Status consolidado, avanço, peso e farol saem
 * calculados a cada leitura, contra o dia pedido. A planilha traz oito colunas
 * já calculadas e todas são descartadas na carga, pelo mesmo motivo que "fora
 * do SLA" nunca é gravado: um valor calculado contra o dia em que alguém abriu
 * o arquivo envelhece em silêncio.
 */
import { db } from '../db/index.js';
import type { Contexto } from './contexto.js';
import { ONDAS } from './cronograma.js';

/**
 * As colunas de unidade do Controle Único, na ordem em que a planilha as traz.
 *
 * A ONDA NÃO É ESCRITA AQUI: é derivada do cronograma. Escrevê-la à mão foi o
 * que deixou o artifact afirmando, por meses, que UC RJ virava na 2ª onda
 * enquanto a Visão Macro já dizia 1ª.
 */
const UNIDADES_BASE = [
  { chave: 'hr_pb', rotulo: 'HR PB', nome: 'HR João Pessoa/PB' },
  { chave: 'hm_pb', rotulo: 'HM PB', nome: 'MHC João Pessoa/PB' },
  { chave: 'hr_cg', rotulo: 'HR CG', nome: 'HR Campina Grande/PB' },
  { chave: 'uc_rj', rotulo: 'UC RJ', nome: 'UC Rio de Janeiro/RJ' },
  { chave: 'uc_sp', rotulo: 'UC SP', nome: 'UC São Paulo/SP' },
  { chave: 'hm_ro', rotulo: 'HM RO', nome: 'MHC Porto Velho/RO' },
  { chave: 'unidade_7', rotulo: '(unidade 7)', nome: '' },
  { chave: 'unidade_8', rotulo: '(unidade 8)', nome: '' },
  { chave: 'unidade_9', rotulo: '(unidade 9)', nome: '' },
  { chave: 'unidade_10', rotulo: '(unidade 10)', nome: '' },
];

/** A onda de uma unidade, pelo cronograma — a única fonte dela. */
export function ondaDaUnidade(nome: string): number | null {
  if (!nome) return null;
  return ONDAS.find((o) => o.unidades.includes(nome))?.n ?? null;
}

export interface UnidadeDoControle {
  chave: string;
  rotulo: string;
  nome: string;
  onda: number | null;
}

export const UNIDADES: UnidadeDoControle[] = UNIDADES_BASE.map((u) => ({
  ...u, onda: ondaDaUnidade(u.nome),
}));

const POR_CHAVE = new Map(UNIDADES.map((u) => [u.chave, u]));

/**
 * As situações, no vocabulário DA PLANILHA.
 *
 * Ela diz "Não iniciado" onde o sistema diz "Pendente", e traz um "Bloqueado"
 * que o sistema não tem. Traduzir na carga apagaria a diferença justamente na
 * tela que existe para refletir a planilha.
 */
export const SITUACOES = ['Concluído', 'Em andamento', 'Não iniciado', 'Bloqueado', 'Cancelado'] as const;
export type Situacao = (typeof SITUACOES)[number];

/** O peso de cada criticidade, como a aba Parâmetros define. */
export const PESOS: Record<string, number> = {
  'GO-LIVE': 3, 'ESTABILIZAÇÃO': 2, 'EVOLUÇÃO': 1,
};

/** O deslocamento do prazo em dias, a partir da data-base da onda. */
export const DESLOCAMENTO: Record<string, number> = {
  'GO-LIVE': -10, 'ESTABILIZAÇÃO': 15, 'EVOLUÇÃO': 45,
};

/** O critério de aceite padrão por tipo de entrega. */
export const CRITERIOS_PADRAO: Record<string, string> = {
  'Cadastro': 'Registros cadastrados nas unidades ativas, conferidos por amostragem e aprovados pelo líder do grupo.',
  'Importação de dados': 'Carga conferida contra a base de origem (contagem e amostragem) e aprovada pelo líder do grupo.',
  'Parametrização / Regra': 'Regra configurada nas unidades ativas, testada em um caso real e aprovada pelo líder do grupo.',
  'Conciliação': 'Bases conciliadas, divergências tratadas ou registradas, e aprovação do líder do grupo.',
  'Teste integrado (tracer)': 'Jornada ponta a ponta sem bloqueio, com as não conformidades registradas e tratadas.',
};

export type Farol = 'VERDE' | 'AMARELO' | 'VERMELHO' | 'N/A';

export interface AtividadeDoControle {
  id?: number;
  id_origem: string;
  chave: string;
  fonte: string;
  grupo_time: string;
  frente: string;
  replicavel: string;
  atividade: string;
  tipo_entrega: string;
  caminho: string;
  criticidade: string;
  lider: string;
  executante: string;
  data_base_onda: string | null;
  prazo_repactuado: string | null;
  pendencia: string;
  proxima_acao: string;
  evidencia: string;
  criterio_especifico: string;
  observacoes: string;
  /** chave da unidade → situação. */
  unidades: Record<string, string>;
  /** número da onda → prazo e situação. */
  ondas: Record<string, { prazo?: string; situacao?: string }>;
}

export interface AtividadeDerivada extends AtividadeDoControle {
  criterio_aceite: string;
  executantes: string[];
  status_consolidado: string;
  unidades_sem_status: number;
  status_igual_em_todas: string;
  /** 0 a 1, ou `null` quando a atividade não entra no cálculo. */
  avanco: number | null;
  peso: number | null;
  avanco_ponderado: number | null;
  farol: Farol;
  dias_para_prazo: number | null;
}

/** Hoje em ISO. Função, e não constante: o processo fica de pé e o dia vira. */
export const hojeISO = (agora: Date = new Date()): string => agora.toISOString().slice(0, 10);

/** Soma dias a uma data ISO, devolvendo ISO. */
function diaSoma(iso: string, dias: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return '';
  return new Date(t + dias * 86400000).toISOString().slice(0, 10);
}

/**
 * Os executantes de uma atividade.
 *
 * A célula pode trazer MAIS DE UMA pessoa, separadas por quebra de linha ou
 * ponto e vírgula. "-" é uma marca explícita de "ninguém", e vira lista vazia
 * como o branco: as duas dizem a mesma coisa.
 */
export function executantesDe(bruto: string): string[] {
  return String(bruto || '')
    .split(/[\n;]+/)
    .map((x) => x.trim())
    .filter((x) => x && x !== '-');
}

/** O critério de aceite: o específico manda; sem ele, o padrão do tipo. */
export const criterioDeAceite = (a: Pick<AtividadeDoControle, 'criterio_especifico' | 'tipo_entrega'>) =>
  a.criterio_especifico || CRITERIOS_PADRAO[a.tipo_entrega] || '';

/** As unidades com situação preenchida nesta atividade. */
const situacoesDe = (a: Pick<AtividadeDoControle, 'unidades'>) =>
  Object.entries(a.unidades || {}).filter(([, v]) => v).map(([unidade, situacao]) => ({ unidade, situacao }));

/**
 * O status consolidado: o PIOR entre as unidades.
 *
 * A ordem da planilha é Bloqueado › Não iniciado › Em andamento › Concluído —
 * uma atividade só está concluída quando está concluída em todas. Tomar a
 * melhor situação, ou a mais frequente, diria que a atividade acabou enquanto
 * uma unidade ainda não começou.
 */
export function statusConsolidado(a: Pick<AtividadeDoControle, 'unidades'>): string {
  const sit = situacoesDe(a).map((s) => s.situacao);
  if (!sit.length) return '';
  for (const alvo of ['Bloqueado', 'Não iniciado', 'Em andamento', 'Concluído', 'Cancelado']) {
    if (sit.includes(alvo)) return alvo;
  }
  return sit[0]!;
}

/**
 * O avanço de 0 a 1. `null` quando a atividade não entra no cálculo.
 *
 * Cancelada e criticidade desconhecida ficam FORA: é o que define as
 * "atividades válidas" do painel, e incluí-las mudaria o denominador de todo
 * percentual.
 */
export function avancoDe(a: Pick<AtividadeDoControle, 'unidades' | 'criticidade'>): number | null {
  const st = statusConsolidado(a);
  if (!st || st === 'Cancelado' || !PESOS[a.criticidade]) return null;
  if (st === 'Concluído') return 1;
  if (st === 'Em andamento') return 0.5;
  if (st === 'Bloqueado') return 0.25;
  return 0;
}

export const pesoDe = (a: Pick<AtividadeDoControle, 'unidades' | 'criticidade'>) =>
  (avancoDe(a) === null ? null : PESOS[a.criticidade] ?? null);

/**
 * Dias até o prazo — negativo é vencido.
 *
 * Sai do prazo repactuado quando ele existe; senão, da data-base da onda mais
 * o deslocamento da criticidade, como a planilha faz. A referência é HOJE, e
 * não a data congelada na planilha: um painel que mede o atraso contra uma
 * data antiga envelhece em silêncio.
 */
export function diasParaPrazo(
  a: Pick<AtividadeDoControle, 'prazo_repactuado' | 'data_base_onda' | 'criticidade'>,
  dia: string,
): number | null {
  const base = a.prazo_repactuado
    || (a.data_base_onda && DESLOCAMENTO[a.criticidade] !== undefined
      ? diaSoma(a.data_base_onda, DESLOCAMENTO[a.criticidade]!)
      : '');
  if (!base) return null;
  const t = Date.parse(`${base}T00:00:00Z`);
  const r = Date.parse(`${dia}T00:00:00Z`);
  if (Number.isNaN(t) || Number.isNaN(r)) return null;
  return Math.round((t - r) / 86400000);
}

/** O farol: VERDE concluído, VERMELHO bloqueado ou vencido em aberto. */
export function farolDe(a: AtividadeDoControle, dia: string): Farol {
  if (pesoDe(a) === null) return 'N/A';
  const st = statusConsolidado(a);
  if (st === 'Bloqueado') return 'VERMELHO';
  if (st === 'Concluído') return 'VERDE';
  const dias = diasParaPrazo(a, dia);
  return dias !== null && dias < 0 ? 'VERMELHO' : 'AMARELO';
}

/** A atividade com tudo o que se calcula dela. Nenhum derivado é gravado. */
export function derivar(a: AtividadeDoControle, dia: string): AtividadeDerivada {
  const status = statusConsolidado(a);
  const preenchidas = situacoesDe(a);
  const avanco = avancoDe(a);
  const peso = pesoDe(a);
  return {
    ...a,
    criterio_aceite: criterioDeAceite(a),
    executantes: executantesDe(a.executante),
    status_consolidado: status,
    unidades_sem_status: UNIDADES.filter((u) => u.onda).length - preenchidas.length,
    status_igual_em_todas: preenchidas.length < 2
      ? ''
      : (preenchidas.every((s) => s.situacao === status) ? 'SIM' : 'NÃO'),
    avanco,
    peso,
    avanco_ponderado: avanco === null || peso === null ? null : avanco * peso,
    farol: farolDe(a, dia),
    dias_para_prazo: diasParaPrazo(a, dia),
  };
}

// ------------------------------------------------------------- o placar

export interface PlacarDoControle {
  total: number;
  validas: number;
  por_status: Record<string, number>;
  por_farol: Record<string, number>;
  /** Média PONDERADA pelo peso da criticidade, em percentual. */
  avanco_ponderado: number | null;
  /** A mesma conta sem o peso, para comparar. */
  avanco_simples: number | null;
}

export function placar(acoes: AtividadeDerivada[]): PlacarDoControle {
  const validas = acoes.filter((a) => a.avanco !== null);
  const porStatus: Record<string, number> = {};
  const porFarol: Record<string, number> = {};
  for (const a of acoes) {
    const st = a.status_consolidado || '(sem situação)';
    porStatus[st] = (porStatus[st] ?? 0) + 1;
    porFarol[a.farol] = (porFarol[a.farol] ?? 0) + 1;
  }
  const somaPeso = validas.reduce((s, a) => s + (a.peso ?? 0), 0);
  const somaPonderada = validas.reduce((s, a) => s + (a.avanco_ponderado ?? 0), 0);
  const media = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
  return {
    total: acoes.length,
    validas: validas.length,
    por_status: porStatus,
    por_farol: porFarol,
    avanco_ponderado: media(somaPonderada, somaPeso),
    avanco_simples: media(validas.reduce((s, a) => s + (a.avanco ?? 0), 0), validas.length),
  };
}

export interface UnidadeMedida extends UnidadeDoControle {
  acompanhada: boolean;
  por_status: Record<string, number>;
  /** Percentual de avanço desta unidade, pelos pesos das atividades. */
  avanco: number | null;
  atividades: number;
}

/**
 * O avanço de cada unidade.
 *
 * Por UNIDADE, e não só consolidado: o consolidado é o pior caso, e uma
 * unidade que já terminou tudo desapareceria dentro dele.
 */
export function porUnidade(acoes: AtividadeDerivada[]): UnidadeMedida[] {
  return UNIDADES.map((u) => {
    const porStatus: Record<string, number> = {};
    let somaPeso = 0;
    let somaPonderada = 0;
    let quantas = 0;
    for (const a of acoes) {
      const s = a.unidades?.[u.chave];
      if (!s) continue;
      quantas += 1;
      porStatus[s] = (porStatus[s] ?? 0) + 1;
      // O mesmo critério do consolidado, aplicado à situação DESTA unidade.
      if (s === 'Cancelado' || !PESOS[a.criticidade]) continue;
      const av = s === 'Concluído' ? 1 : s === 'Em andamento' ? 0.5 : s === 'Bloqueado' ? 0.25 : 0;
      somaPeso += PESOS[a.criticidade]!;
      somaPonderada += av * PESOS[a.criticidade]!;
    }
    return {
      ...u,
      acompanhada: quantas > 0,
      por_status: porStatus,
      avanco: somaPeso ? Math.round((somaPonderada / somaPeso) * 1000) / 10 : null,
      atividades: quantas,
    };
  });
}

// ---------------------------------------------------------- persistência

interface LinhaAtividade {
  id: number;
  id_origem: string;
  chave: string;
  fonte: string;
  grupo_time: string;
  frente: string;
  replicavel: string;
  atividade: string;
  tipo_entrega: string;
  caminho: string;
  criticidade: string;
  lider: string;
  executante: string;
  data_base_onda: string | null;
  prazo_repactuado: string | null;
  pendencia: string;
  proxima_acao: string;
  evidencia: string;
  criterio_especifico: string;
  observacoes: string;
}

/** As atividades do cliente em contexto, com unidades e ondas montadas. */
export function atividadesDoCliente(ctx: Contexto): AtividadeDoControle[] {
  const linhas = db().prepare(
    `SELECT id, id_origem, chave, fonte, grupo_time, frente, replicavel, atividade,
            tipo_entrega, caminho, criticidade, lider, executante, data_base_onda,
            prazo_repactuado, pendencia, proxima_acao, evidencia, criterio_especifico,
            observacoes
       FROM spin_atividades WHERE cliente_id IS ? ORDER BY id_origem, chave`,
  ).all(ctx.clienteId) as LinhaAtividade[];
  if (!linhas.length) return [];

  const ids = linhas.map((l) => l.id);
  const marcas = ids.map(() => '?').join(',');
  const sits = db().prepare(
    `SELECT atividade_id, unidade, situacao FROM spin_situacoes WHERE atividade_id IN (${marcas})`,
  ).all(...ids) as Array<{ atividade_id: number; unidade: string; situacao: string }>;
  const ondas = db().prepare(
    `SELECT atividade_id, onda, prazo, situacao FROM spin_ondas WHERE atividade_id IN (${marcas})`,
  ).all(...ids) as Array<{ atividade_id: number; onda: number; prazo: string | null; situacao: string }>;

  const porAtividade = new Map<number, AtividadeDoControle>();
  for (const l of linhas) porAtividade.set(l.id, { ...l, unidades: {}, ondas: {} });
  for (const s of sits) porAtividade.get(s.atividade_id)!.unidades[s.unidade] = s.situacao;
  for (const o of ondas) {
    porAtividade.get(o.atividade_id)!.ondas[String(o.onda)] = {
      ...(o.prazo ? { prazo: o.prazo } : {}),
      ...(o.situacao ? { situacao: o.situacao } : {}),
    };
  }
  return [...porAtividade.values()];
}

export interface PainelDoControle {
  hoje: string;
  placar: PlacarDoControle;
  unidades: UnidadeMedida[];
  atividades: AtividadeDerivada[];
}

/** O painel inteiro, medido contra um dia. */
export function painel(ctx: Contexto, dia: string = hojeISO()): PainelDoControle {
  const atividades = atividadesDoCliente(ctx).map((a) => derivar(a, dia));
  return { hoje: dia, placar: placar(atividades), unidades: porUnidade(atividades), atividades };
}

export interface ResultadoDaCarga {
  gravadas: number;
  removidas: number;
}

/**
 * Grava o Controle Único do cliente, substituindo o que havia.
 *
 * SUBSTITUIÇÃO, e não acréscimo: o arquivo é a íntegra do controle, e mesclar
 * faria uma atividade removida do documento continuar cobrando prazo na tela.
 * Numa transação só — um controle meio gravado é pior que nenhum.
 */
export function substituirControle(ctx: Contexto, atividades: AtividadeDoControle[]): ResultadoDaCarga {
  const conexao = db();
  return conexao.transaction(() => {
    const antes = (conexao.prepare(
      'SELECT COUNT(*) AS n FROM spin_atividades WHERE cliente_id IS ?',
    ).get(ctx.clienteId) as { n: number }).n;
    // As filhas somem por ON DELETE CASCADE.
    conexao.prepare('DELETE FROM spin_atividades WHERE cliente_id IS ?').run(ctx.clienteId);

    const inserir = conexao.prepare(
      `INSERT INTO spin_atividades
         (cliente_id, id_origem, chave, fonte, grupo_time, frente, replicavel, atividade,
          tipo_entrega, caminho, criticidade, lider, executante, data_base_onda,
          prazo_repactuado, pendencia, proxima_acao, evidencia, criterio_especifico, observacoes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const inserirSit = conexao.prepare(
      'INSERT INTO spin_situacoes (atividade_id, unidade, situacao) VALUES (?, ?, ?)',
    );
    const inserirOnda = conexao.prepare(
      'INSERT INTO spin_ondas (atividade_id, onda, prazo, situacao) VALUES (?, ?, ?, ?)',
    );

    for (const a of atividades) {
      const r = inserir.run(
        ctx.clienteId, a.id_origem, a.chave, a.fonte ?? '', a.grupo_time ?? '', a.frente ?? '',
        a.replicavel ?? '', a.atividade, a.tipo_entrega ?? '', a.caminho ?? '',
        a.criticidade ?? '', a.lider ?? '', a.executante ?? '',
        a.data_base_onda || null, a.prazo_repactuado || null,
        a.pendencia ?? '', a.proxima_acao ?? '', a.evidencia ?? '',
        a.criterio_especifico ?? '', a.observacoes ?? '',
      );
      const id = Number(r.lastInsertRowid);
      for (const [unidade, situacao] of Object.entries(a.unidades ?? {})) {
        if (situacao) inserirSit.run(id, unidade, situacao);
      }
      for (const [onda, dados] of Object.entries(a.ondas ?? {})) {
        inserirOnda.run(id, Number(onda), dados.prazo ?? null, dados.situacao ?? '');
      }
    }
    return { gravadas: atividades.length, removidas: antes };
  })();
}

/** Apaga o Controle Único do cliente. Devolve quantas atividades saíram. */
export function removerControle(ctx: Contexto): number {
  return db().prepare('DELETE FROM spin_atividades WHERE cliente_id IS ?')
    .run(ctx.clienteId).changes;
}

/** A unidade por chave, para as telas rotularem sem repetir a lista. */
export const unidadePorChave = (chave: string) => POR_CHAVE.get(chave) ?? null;
