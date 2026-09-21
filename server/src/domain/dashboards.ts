import { db } from '../db/index.js';
import { CENARIO_OFICIAL, ROTULO_ORIGEM, type Origem } from './financeiro.js';
import { clausulaEm, clausulaEmComNulo } from '../lib/consulta.js';
import {
  competenciaAtual,
  diferencaEmMeses,
  intervalo,
  paraExibicao,
  paraInterno,
  somarMeses,
} from './competencia.js';
import type { Contexto } from './contexto.js';
import { paraReais } from './dinheiro.js';
import { calcularAtraso } from './projetos.js';
import { montarFiltroSla, percentual, type FiltroSla } from './sla.js';
import { escopoSql } from './escopo.js';
import { alvoDe, leituraDeMeta } from './metas.js';
import { despesaCentralizada, entregaDeTarefas, equilibrioDeDespesas } from './indicadores.js';

/**
 * Recorte de um painel.
 *
 * Cada dimensão aceita lista, porque os filtros da tela são de múltipla
 * escolha. Os campos no singular seguem válidos: uma lista de um item é o
 * mesmo recorte, e o contrato antigo continua de pé.
 */
export interface EscopoDashboard {
  /**
   * Filtro LOCAL de matriz do painel. Vazio significa o cliente inteiro — cada
   * painel escolhe o seu recorte, sem depender de um seletor no topo do sistema.
   */
  empresas?: number[];
  /** `undefined` = consolidado da empresa; `null` = apenas nível empresa (sem filial); número = filial específica. */
  filialId?: number | null;
  filiais?: Array<number | null>;
  competencia?: string;
  competencias?: string[];
  competenciaInicio?: string;
  competenciaFim?: string;
  /** Cenário de projeção financeira. Padrão: 'oficial'. */
  cenario?: string;
  cenarios?: string[];
}

function lista<T>(unico: T | undefined, varios: T[] | undefined): T[] | undefined {
  const itens = [...(varios ?? []), ...(unico === undefined ? [] : [unico])];
  return itens.length ? itens : undefined;
}

/** Cenários em foco; sem escolha, só o oficial. */
const cenariosDoEscopo = (e: EscopoDashboard) => lista(e.cenario, e.cenarios) ?? [CENARIO_OFICIAL];

/**
 * Sem competência informada, o painel abre no último mês **encerrado** com
 * movimento. O mês corrente ainda está em curso — abri-lo por padrão compara
 * um mês parcial com um mês completo e produz variações enganosas. O gestor
 * continua podendo consultá-lo informando a competência.
 */
function ultimaCompetenciaComDados(
  tabela: 'lancamentos' | 'tickets_sla',
  escopo: { sql: string; params: number[] },
  filtroExtra: { coluna: string; valor: unknown } | null,
  limite: string,
): string | null {
  const extra = filtroExtra ? `AND ${filtroExtra.coluna} = ?` : '';
  const params = filtroExtra
    ? [...escopo.params, filtroExtra.valor, limite]
    : [...escopo.params, limite];
  const linha = db()
    .prepare(
      `SELECT MAX(competencia) AS m FROM ${tabela}
        WHERE ${escopo.sql} AND excluido_em IS NULL ${extra} AND competencia < ?`,
    )
    .get(...params) as { m: string | null };
  return linha.m;
}

function competenciaReferencia(ctx: Contexto, escopo: EscopoDashboard, cenarios: string[]): string {
  if (escopo.competencia) return paraInterno(escopo.competencia);
  const cenario = cenarios[0]!;
  const atual = competenciaAtual();
  const alcance = escopoSql(ctx, escopo.empresas);
  const fechada = ultimaCompetenciaComDados('lancamentos', alcance, { coluna: 'cenario', valor: cenario }, atual);
  if (fechada) return fechada;
  // Sem histórico, cai no mês corrente (que pode conter apenas projeções).
  const qualquer = db()
    .prepare(
      `SELECT MAX(competencia) AS m FROM lancamentos
        WHERE ${alcance.sql} AND excluido_em IS NULL AND cenario = ? AND competencia <= ?`,
    )
    .get(...alcance.params, cenario, atual) as { m: string | null };
  return qualquer.m ?? atual;
}

function filtroFinanceiro(ctx: Contexto, escopo: EscopoDashboard, cenarios: string[]) {
  const alcance = escopoSql(ctx, escopo.empresas, 'l.empresa_id');
  const condicoes = [alcance.sql, 'l.excluido_em IS NULL'];
  const params: unknown[] = [...alcance.params];
  const aplicar = (c: { sql: string; params: unknown[] } | null) => {
    if (!c) return;
    condicoes.push(c.sql);
    params.push(...c.params);
  };
  aplicar(clausulaEm('l.cenario', cenarios));
  aplicar(clausulaEmComNulo('l.filial_id', lista(escopo.filialId, escopo.filiais)));
  return { condicoes, params };
}

// ==========================================================================
// Dashboard Financeiro
// ==========================================================================

export function dashboardFinanceiro(ctx: Contexto, escopo: EscopoDashboard = {}) {
  const cenarios = cenariosDoEscopo(escopo);
  // Os meses escolhidos formam o período; sem escolha, o último mês encerrado
  // com movimento. O mais recente deles ancora a série e a projeção.
  const escolhidos = lista(escopo.competencia, escopo.competencias)?.map(paraInterno).sort();
  const meses = escolhidos?.length ? escolhidos : [competenciaReferencia(ctx, escopo, cenarios)];
  const mesRef = meses[meses.length - 1]!;
  const emFoco = clausulaEm('l.competencia', meses)!;
  const inicioSerie = escopo.competenciaInicio ? paraInterno(escopo.competenciaInicio)
    : meses.length > 1 ? meses[0]! : somarMeses(mesRef, -11);
  const fimSerie = escopo.competenciaFim ? paraInterno(escopo.competenciaFim) : mesRef;

  const { condicoes, params } = filtroFinanceiro(ctx, escopo, cenarios);
  const where = condicoes.join(' AND ');
  const nosMeses = `${where} AND ${emFoco.sql}`;
  const paramsMeses = [...params, ...emFoco.params];

  // --- Totais do mês de referência
  const totaisMes = db()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN l.classificacao = 'despesa' THEN l.valor_centavos ELSE 0 END), 0) AS despesa,
         COALESCE(SUM(CASE WHEN l.classificacao = 'investimento' THEN l.valor_centavos ELSE 0 END), 0) AS investimento,
         COUNT(*) AS lancamentos
       FROM lancamentos l WHERE ${nosMeses}`,
    )
    .get(...paramsMeses) as { despesa: number; investimento: number; lancamentos: number };

  // Com vários meses em foco não há "mês anterior" comparável: comparar um
  // período de N meses com um único mês mediria coisas de tamanhos diferentes.
  const mesAnterior = somarMeses(meses[0]!, -1);
  const totaisAnterior = meses.length === 1
    ? (db()
        .prepare(
          `SELECT COALESCE(SUM(l.valor_centavos), 0) AS total
             FROM lancamentos l WHERE ${where} AND l.competencia = ?`,
        )
        .get(...params, mesAnterior) as { total: number })
    : { total: 0 };

  const totalMes = totaisMes.despesa + totaisMes.investimento;

  // --- Distribuição por tipo de despesa
  const porTipo = (
    db()
      .prepare(
        `SELECT t.id AS tipo_despesa_id, t.nome AS tipo,
                COALESCE(SUM(l.valor_centavos), 0) AS total,
                COALESCE(SUM(CASE WHEN l.classificacao = 'despesa' THEN l.valor_centavos ELSE 0 END), 0) AS despesa,
                COALESCE(SUM(CASE WHEN l.classificacao = 'investimento' THEN l.valor_centavos ELSE 0 END), 0) AS investimento
           FROM lancamentos l JOIN tipos_despesa t ON t.id = l.tipo_despesa_id
          WHERE ${nosMeses}
          GROUP BY t.id ORDER BY total DESC`,
      )
      .all(...paramsMeses) as Array<{ tipo_despesa_id: number; tipo: string; total: number; despesa: number; investimento: number }>
  ).map((l) => ({
    // O id vai junto para o drill-down pedir exatamente este tipo, sem depender
    // de casar pelo nome.
    tipo_despesa_id: l.tipo_despesa_id,
    tipo: l.tipo,
    total: paraReais(l.total),
    despesa: paraReais(l.despesa),
    investimento: paraReais(l.investimento),
    participacao_pct: percentual(l.total, totalMes),
  }));

  // --- Composição por natureza (fixa vs pontual única vs parcelada)
  const porNatureza = (
    db()
      .prepare(
        `SELECT l.natureza, COALESCE(SUM(l.valor_centavos), 0) AS total, COUNT(*) AS qtd
           FROM lancamentos l WHERE ${nosMeses}
          GROUP BY l.natureza`,
      )
      .all(...paramsMeses) as Array<{ natureza: string; total: number; qtd: number }>
  ).map((l) => ({
    natureza: l.natureza,
    total: paraReais(l.total),
    quantidade: l.qtd,
    participacao_pct: percentual(l.total, totalMes),
  }));

  // --- Evolução mensal (série temporal)
  const linhasSerie = db()
    .prepare(
      `SELECT l.competencia,
              COALESCE(SUM(CASE WHEN l.classificacao = 'despesa' THEN l.valor_centavos ELSE 0 END), 0) AS despesa,
              COALESCE(SUM(CASE WHEN l.classificacao = 'investimento' THEN l.valor_centavos ELSE 0 END), 0) AS investimento
         FROM lancamentos l WHERE ${where} AND l.competencia BETWEEN ? AND ?
        GROUP BY l.competencia`,
    )
    .all(...params, inicioSerie, fimSerie) as Array<{ competencia: string; despesa: number; investimento: number }>;
  const mapaSerie = new Map(linhasSerie.map((l) => [l.competencia, l]));
  const evolucaoMensal = intervalo(inicioSerie, fimSerie).map((mes) => {
    const l = mapaSerie.get(mes);
    return {
      competencia: paraExibicao(mes),
      despesa: paraReais(l?.despesa ?? 0),
      investimento: paraReais(l?.investimento ?? 0),
      total: paraReais((l?.despesa ?? 0) + (l?.investimento ?? 0)),
    };
  });

  // --- Projeção dos próximos 12 meses (compromissos já lançados: parcelas e fixas)
  const inicioProj = somarMeses(mesRef, 1);
  const fimProj = somarMeses(mesRef, 12);
  const linhasProj = db()
    .prepare(
      `SELECT l.competencia,
              COALESCE(SUM(CASE WHEN l.natureza = 'pontual_parcelada' THEN l.valor_centavos ELSE 0 END), 0) AS parcelado,
              COALESCE(SUM(CASE WHEN l.natureza = 'fixa' THEN l.valor_centavos ELSE 0 END), 0) AS fixo,
              COALESCE(SUM(CASE WHEN l.natureza = 'pontual_unica' THEN l.valor_centavos ELSE 0 END), 0) AS pontual,
              COALESCE(SUM(l.valor_centavos), 0) AS total
         FROM lancamentos l WHERE ${where} AND l.competencia BETWEEN ? AND ?
        GROUP BY l.competencia`,
    )
    .all(...params, inicioProj, fimProj) as Array<{
    competencia: string;
    parcelado: number;
    fixo: number;
    pontual: number;
    total: number;
  }>;
  const mapaProj = new Map(linhasProj.map((l) => [l.competencia, l]));
  const projecao12Meses = intervalo(inicioProj, fimProj).map((mes) => {
    const l = mapaProj.get(mes);
    return {
      competencia: paraExibicao(mes),
      parcelado: paraReais(l?.parcelado ?? 0),
      fixo: paraReais(l?.fixo ?? 0),
      pontual: paraReais(l?.pontual ?? 0),
      total: paraReais(l?.total ?? 0),
    };
  });

  // --- Quebra por unidade (matriz + filial)
  //
  // O agrupamento inclui a matriz, e não só a filial: o escopo é o cliente
  // inteiro, e duas matrizes podem ter filiais de mesmo nome — somá-las na
  // mesma linha juntaria dinheiro de unidades diferentes sem avisar.
  const alcanceFilial = escopoSql(ctx, escopo.empresas, 'l.empresa_id');
  const variasEmpresas = alcanceFilial.params.length > 1;
  const porFilial = (
    db()
      .prepare(
        `SELECT COALESCE(f.nome, '(sem filial / empresa)') AS filial, l.filial_id,
                l.empresa_id, e.nome AS empresa_nome,
                COALESCE(SUM(CASE WHEN l.classificacao = 'despesa' THEN l.valor_centavos ELSE 0 END), 0) AS despesa,
                COALESCE(SUM(CASE WHEN l.classificacao = 'investimento' THEN l.valor_centavos ELSE 0 END), 0) AS investimento,
                COALESCE(SUM(l.valor_centavos), 0) AS total
           FROM lancamentos l
           JOIN empresas e ON e.id = l.empresa_id
           LEFT JOIN filiais f ON f.id = l.filial_id
          WHERE ${alcanceFilial.sql} AND l.excluido_em IS NULL
            AND ${clausulaEm('l.cenario', cenarios)!.sql} AND ${emFoco.sql}
          GROUP BY l.empresa_id, l.filial_id ORDER BY total DESC`,
      )
      .all(...alcanceFilial.params, ...cenarios, ...emFoco.params) as Array<{
      filial: string;
      filial_id: number | null;
      empresa_id: number;
      empresa_nome: string;
      despesa: number;
      investimento: number;
      total: number;
    }>
  ).map((l) => ({
    filial_id: l.filial_id,
    empresa_id: l.empresa_id,
    empresa_nome: l.empresa_nome,
    // Com uma matriz só, o nome dela na frente seria ruído; com várias, é o que
    // distingue duas filiais homônimas.
    filial: variasEmpresas ? `${l.empresa_nome} — ${l.filial}` : l.filial,
    despesa: paraReais(l.despesa),
    investimento: paraReais(l.investimento),
    total: paraReais(l.total),
  }));

  return {
    escopo: {
      competencia: paraExibicao(mesRef),
      competencias: meses.map(paraExibicao),
      filial_id: escopo.filialId ?? null,
      filiais: lista(escopo.filialId, escopo.filiais) ?? null,
      consolidado: escopo.filialId === undefined && !escopo.filiais?.length,
      cenario: cenarios[0]!,
      cenarios,
      periodo_serie: { inicio: paraExibicao(inicioSerie), fim: paraExibicao(fimSerie) },
    },
    totais_mes: {
      despesa: paraReais(totaisMes.despesa),
      investimento: paraReais(totaisMes.investimento),
      total: paraReais(totalMes),
      lancamentos: totaisMes.lancamentos,
      variacao_mes_anterior_pct:
        totaisAnterior.total > 0
          ? Math.round(((totalMes - totaisAnterior.total) / totaisAnterior.total) * 1000) / 10
          : null,
      total_mes_anterior: paraReais(totaisAnterior.total),
    },
    por_tipo_despesa: porTipo,
    por_natureza: porNatureza,
    por_filial: porFilial,
    evolucao_mensal: evolucaoMensal,
    projecao_12_meses: projecao12Meses,
  };
}

// ==========================================================================
// Dashboard de Projetos
// ==========================================================================

interface LinhaProjetoGantt {
  id: number;
  nome: string;
  filial_id: number | null;
  filial_nome: string | null;
  mes_inicio: string;
  mes_fim_planejado: string;
  mes_fim_real: string | null;
  status: string;
}

export function dashboardProjetos(ctx: Contexto, escopo: EscopoDashboard = {}) {
  const alcance = escopoSql(ctx, escopo.empresas, 'p.empresa_id');
  const condicoes = [alcance.sql, 'p.excluido_em IS NULL'];
  const params: unknown[] = [...alcance.params];
  if (escopo.filialId === null) condicoes.push('p.filial_id IS NULL');
  else if (escopo.filialId !== undefined) {
    condicoes.push('p.filial_id = ?');
    params.push(escopo.filialId);
  }
  const where = condicoes.join(' AND ');

  const projetos = db()
    .prepare(
      `SELECT p.id, p.nome, p.filial_id, f.nome AS filial_nome, p.mes_inicio, p.mes_fim_planejado,
              p.mes_fim_real, p.status
         FROM projetos p LEFT JOIN filiais f ON f.id = p.filial_id
        WHERE ${where} ORDER BY p.mes_inicio, p.nome`,
    )
    .all(...params) as LinhaProjetoGantt[];

  const idsProjetos = projetos.map((p) => p.id);
  const tarefas =
    idsProjetos.length === 0
      ? []
      : (db()
          .prepare(
            `SELECT t.id, t.projeto_id, t.nome, t.mes_inicio, t.mes_fim_planejado, t.mes_fim_real, t.responsavel, t.status,
                    t.parent_task_id
               FROM tarefas t
              WHERE t.excluido_em IS NULL AND t.projeto_id IN (${idsProjetos.map(() => '?').join(',')})
              ORDER BY t.mes_inicio, t.id`,
          )
          .all(...idsProjetos) as Array<{
          id: number;
          projeto_id: number;
          nome: string;
          mes_inicio: string;
          mes_fim_planejado: string;
          mes_fim_real: string | null;
          responsavel: string | null;
          status: string;
          parent_task_id: number | null;
        }>);

/**
 * Tarefas de um projeto prontas para o Gantt: em ordem hierárquica (cada
 * principal seguida das suas subtarefas) e com o intervalo agregado do grupo,
 * que é a barra que a linha do pai mostra quando o grupo está comprimido.
 *
 * O agregado usa o menor início e o maior fim da subárvore, incluindo o
 * próprio pai — comprimir o grupo não pode encolher o que ele representa.
 */
function tarefasDoGantt(
  doProjeto: Array<{
    id: number;
    nome: string;
    mes_inicio: string;
    mes_fim_planejado: string;
    mes_fim_real: string | null;
    responsavel: string | null;
    status: string;
    parent_task_id: number | null;
  }>,
  inicioLinha: string,
) {
  const ids = new Set(doProjeto.map((t) => t.id));
  const paiDe = (t: (typeof doProjeto)[number]) =>
    t.parent_task_id !== null && ids.has(t.parent_task_id) ? t.parent_task_id : null;

  const porPai = new Map<number | null, typeof doProjeto>();
  for (const t of doProjeto) {
    const chave = paiDe(t);
    if (!porPai.has(chave)) porPai.set(chave, []);
    porPai.get(chave)!.push(t);
  }

  /** A subárvore inteira a partir de uma tarefa, ela inclusive. */
  const subarvore = (raiz: (typeof doProjeto)[number]): typeof doProjeto =>
    [raiz, ...(porPai.get(raiz.id) ?? []).flatMap(subarvore)];

  const saida: Array<Record<string, unknown>> = [];
  const descer = (paiId: number | null, nivel: number) => {
    for (const t of porPai.get(paiId) ?? []) {
      const filhos = porPai.get(t.id) ?? [];
      const grupo = subarvore(t);
      const inicioGrupo = grupo.map((x) => x.mes_inicio).sort()[0]!;
      const fimGrupo = grupo.map((x) => x.mes_fim_real ?? x.mes_fim_planejado).sort().pop()!;
      // O realizado do grupo só existe quando a subárvore inteira terminou:
      // um grupo com uma tarefa em aberto não está realizado.
      const todasConcluidas = grupo.every((x) => x.mes_fim_real);
      const fimRealGrupo = todasConcluidas ? grupo.map((x) => x.mes_fim_real!).sort().pop()! : null;

      saida.push({
        id: t.id,
        nome: t.nome,
        responsavel: t.responsavel,
        status: t.status,
        parent_task_id: paiId,
        nivel,
        total_subtarefas: filhos.length,
        mes_inicio: paraExibicao(t.mes_inicio),
        mes_fim_planejado: paraExibicao(t.mes_fim_planejado),
        mes_fim_real: t.mes_fim_real ? paraExibicao(t.mes_fim_real) : null,
        offset_meses: Math.max(diferencaEmMeses(inicioLinha, t.mes_inicio), 0),
        duracao_meses: diferencaEmMeses(t.mes_inicio, t.mes_fim_planejado) + 1,
        duracao_real_meses: t.mes_fim_real ? diferencaEmMeses(t.mes_inicio, t.mes_fim_real) + 1 : null,
        // Intervalo agregado do grupo — o que a barra do pai mostra comprimida.
        grupo_mes_inicio: paraExibicao(inicioGrupo),
        grupo_mes_fim: paraExibicao(fimGrupo),
        grupo_offset_meses: Math.max(diferencaEmMeses(inicioLinha, inicioGrupo), 0),
        grupo_duracao_meses: diferencaEmMeses(inicioGrupo, fimGrupo) + 1,
        grupo_duracao_real_meses: fimRealGrupo ? diferencaEmMeses(inicioGrupo, fimRealGrupo) + 1 : null,
        ...calcularAtraso(t.mes_fim_planejado, t.mes_fim_real, t.status),
      });
      descer(t.id, nivel + 1);
    }
  };
  descer(null, 1);
  return saida;
}

  const projetosComAtraso = projetos.map((p) => ({
    ...p,
    ...calcularAtraso(p.mes_fim_planejado, p.mes_fim_real, p.status),
  }));

  // --- Linha do tempo do Gantt (limites cobrindo todos os itens + mês corrente)
  const todosMeses = [
    competenciaAtual(),
    ...projetos.flatMap((p) => [p.mes_inicio, p.mes_fim_real ?? p.mes_fim_planejado]),
  ].sort();
  const inicioLinha = escopo.competenciaInicio ? paraInterno(escopo.competenciaInicio) : todosMeses[0] ?? competenciaAtual();
  const fimLinha =
    escopo.competenciaFim ? paraInterno(escopo.competenciaFim) : todosMeses[todosMeses.length - 1] ?? competenciaAtual();
  const linhaDoTempo = intervalo(inicioLinha, fimLinha).map(paraExibicao);

  const gantt = projetosComAtraso.map((p) => ({
    id: p.id,
    nome: p.nome,
    filial_id: p.filial_id,
    filial_nome: p.filial_nome,
    status: p.status,
    atrasado: p.atrasado,
    meses_atraso: p.meses_atraso,
    desvio_meses: p.desvio_meses,
    mes_inicio: paraExibicao(p.mes_inicio),
    mes_fim_planejado: paraExibicao(p.mes_fim_planejado),
    mes_fim_real: p.mes_fim_real ? paraExibicao(p.mes_fim_real) : null,
    offset_meses: Math.max(diferencaEmMeses(inicioLinha, p.mes_inicio), 0),
    duracao_meses: diferencaEmMeses(p.mes_inicio, p.mes_fim_planejado) + 1,
    duracao_real_meses: p.mes_fim_real ? diferencaEmMeses(p.mes_inicio, p.mes_fim_real) + 1 : null,
    tarefas: tarefasDoGantt(tarefas.filter((t) => t.projeto_id === p.id), inicioLinha),
  }));

  // --- Carga de trabalho por envolvido (tarefas atribuídas)
  const cargaPorEnvolvido = Object.values(
    tarefas.reduce<Record<string, { responsavel: string; total: number; concluidas: number; atrasadas: number; em_aberto: number }>>(
      (acc, t) => {
        const chave = t.responsavel?.trim() || '(não atribuído)';
        const registro = (acc[chave] ??= { responsavel: chave, total: 0, concluidas: 0, atrasadas: 0, em_aberto: 0 });
        registro.total += 1;
        if (t.mes_fim_real) registro.concluidas += 1;
        else registro.em_aberto += 1;
        if (calcularAtraso(t.mes_fim_planejado, t.mes_fim_real, t.status).atrasado) registro.atrasadas += 1;
        return acc;
      },
      {},
    ),
  ).sort((a, b) => b.total - a.total);

  // --- Desvio planejado x real (apenas projetos concluídos)
  const desvios = projetosComAtraso
    .filter((p) => p.mes_fim_real)
    .map((p) => ({
      id: p.id,
      nome: p.nome,
      mes_fim_planejado: paraExibicao(p.mes_fim_planejado),
      mes_fim_real: paraExibicao(p.mes_fim_real!),
      desvio_meses: p.desvio_meses,
    }))
    .sort((a, b) => b.desvio_meses - a.desvio_meses);

  const concluidos = projetosComAtraso.filter((p) => p.status === 'concluido');
  const desvioMedio =
    desvios.length > 0 ? Math.round((desvios.reduce((s, d) => s + d.desvio_meses, 0) / desvios.length) * 10) / 10 : 0;

  return {
    escopo: {
      filial_id: escopo.filialId ?? null,
      consolidado: escopo.filialId === undefined,
      linha_do_tempo: { inicio: paraExibicao(inicioLinha), fim: paraExibicao(fimLinha) },
    },
    indicadores: {
      total: projetosComAtraso.length,
      planejados: projetosComAtraso.filter((p) => p.status === 'planejado').length,
      em_andamento: projetosComAtraso.filter((p) => p.status === 'em_andamento').length,
      concluidos: concluidos.length,
      cancelados: projetosComAtraso.filter((p) => p.status === 'cancelado').length,
      atrasados: projetosComAtraso.filter((p) => p.atrasado).length,
      total_tarefas: tarefas.length,
      tarefas_atrasadas: tarefas.filter((t) => calcularAtraso(t.mes_fim_planejado, t.mes_fim_real, t.status).atrasado)
        .length,
      desvio_medio_meses: desvioMedio,
    },
    linha_do_tempo: linhaDoTempo,
    gantt,
    carga_por_envolvido: cargaPorEnvolvido,
    desvios,
  };
}

// ==========================================================================
// Dashboard de SLA
// ==========================================================================

function competenciaReferenciaSla(ctx: Contexto, escopo: EscopoDashboard): string {
  if (escopo.competencia) return paraInterno(escopo.competencia);
  const atual = competenciaAtual();
  const alcance = escopoSql(ctx, escopo.empresas);
  const fechada = ultimaCompetenciaComDados('tickets_sla', alcance, null, atual);
  if (fechada) return fechada;
  const qualquer = db()
    .prepare(
      `SELECT MAX(competencia) AS m FROM tickets_sla
        WHERE ${alcance.sql} AND excluido_em IS NULL AND competencia <= ?`,
    )
    .get(...alcance.params, atual) as { m: string | null };
  return qualquer.m ?? atual;
}

export function dashboardSla(ctx: Contexto, escopo: EscopoDashboard = {}) {
  const mesRef = competenciaReferenciaSla(ctx, escopo);
  const inicioSerie = escopo.competenciaInicio ? paraInterno(escopo.competenciaInicio) : somarMeses(mesRef, -11);
  const fimSerie = escopo.competenciaFim ? paraInterno(escopo.competenciaFim) : mesRef;

  const filtroBase: FiltroSla = { filialId: escopo.filialId, empresas: escopo.empresas };
  const { where, params } = montarFiltroSla(ctx, filtroBase);

  const totais = db()
    .prepare(
      `SELECT COALESCE(SUM(s.total_atendidos), 0) AS total, COALESCE(SUM(s.dentro_sla), 0) AS dentro
         FROM tickets_sla s WHERE ${where} AND s.competencia = ?`,
    )
    .get(...params, mesRef) as { total: number; dentro: number };

  const porFila = (
    db()
      .prepare(
        `SELECT q.id AS fila_id, q.nome AS fila, COALESCE(SUM(s.total_atendidos), 0) AS total, COALESCE(SUM(s.dentro_sla), 0) AS dentro
           FROM tickets_sla s JOIN filas_ticket q ON q.id = s.fila_id
          WHERE ${where} AND s.competencia = ?
          GROUP BY q.id ORDER BY q.ordem, q.nome`,
      )
      .all(...params, mesRef) as Array<{ fila_id: number; fila: string; total: number; dentro: number }>
  ).map((l) => ({
    // O id vai junto para o drill-down pedir exatamente esta fila.
    fila_id: l.fila_id,
    fila: l.fila,
    total_atendidos: l.total,
    dentro_sla: l.dentro,
    fora_sla: l.total - l.dentro,
    pct_dentro_sla: percentual(l.dentro, l.total),
    pct_fora_sla: percentual(l.total - l.dentro, l.total),
  }));

  const porTopico = (
    db()
      .prepare(
        `SELECT s.topico_ajuda_id, COALESCE(ta.nome, '(sem tópico)') AS topico, COALESCE(SUM(s.total_atendidos), 0) AS total,
                COALESCE(SUM(s.dentro_sla), 0) AS dentro
           FROM tickets_sla s LEFT JOIN topicos_ajuda ta ON ta.id = s.topico_ajuda_id
          WHERE ${where} AND s.competencia = ?
          GROUP BY s.topico_ajuda_id ORDER BY total DESC`,
      )
      .all(...params, mesRef) as Array<{ topico_ajuda_id: number | null; topico: string; total: number; dentro: number }>
  ).map((l) => ({
    topico_ajuda_id: l.topico_ajuda_id,
    topico: l.topico,
    total_atendidos: l.total,
    dentro_sla: l.dentro,
    fora_sla: l.total - l.dentro,
    pct_dentro_sla: percentual(l.dentro, l.total),
    pct_fora_sla: percentual(l.total - l.dentro, l.total),
  }));

  // Agrupa por matriz e filial pelo mesmo motivo do painel financeiro: no
  // escopo do cliente, duas matrizes podem ter filiais homônimas.
  const alcanceSla = escopoSql(ctx, escopo.empresas, 's.empresa_id');
  const variasEmpresasSla = alcanceSla.params.length > 1;
  const porFilial = (
    db()
      .prepare(
        `SELECT COALESCE(f.nome, '(sem filial / empresa)') AS filial, s.filial_id,
                s.empresa_id, e.nome AS empresa_nome,
                COALESCE(SUM(s.total_atendidos), 0) AS total, COALESCE(SUM(s.dentro_sla), 0) AS dentro
           FROM tickets_sla s
           JOIN empresas e ON e.id = s.empresa_id
           LEFT JOIN filiais f ON f.id = s.filial_id
          WHERE ${alcanceSla.sql} AND s.excluido_em IS NULL AND s.competencia = ?
          GROUP BY s.empresa_id, s.filial_id ORDER BY total DESC`,
      )
      .all(...alcanceSla.params, mesRef) as Array<{
      filial: string;
      filial_id: number | null;
      empresa_id: number;
      empresa_nome: string;
      total: number;
      dentro: number;
    }>
  ).map((l) => ({
    filial_id: l.filial_id,
    empresa_id: l.empresa_id,
    empresa_nome: l.empresa_nome,
    filial: variasEmpresasSla ? `${l.empresa_nome} — ${l.filial}` : l.filial,
    total_atendidos: l.total,
    dentro_sla: l.dentro,
    fora_sla: l.total - l.dentro,
    pct_dentro_sla: percentual(l.dentro, l.total),
  }));

  const linhasTend = db()
    .prepare(
      `SELECT s.competencia, COALESCE(SUM(s.total_atendidos), 0) AS total, COALESCE(SUM(s.dentro_sla), 0) AS dentro
         FROM tickets_sla s WHERE ${where} AND s.competencia BETWEEN ? AND ?
        GROUP BY s.competencia`,
    )
    .all(...params, inicioSerie, fimSerie) as Array<{ competencia: string; total: number; dentro: number }>;
  const mapaTend = new Map(linhasTend.map((l) => [l.competencia, l]));
  const tendenciaMensal = intervalo(inicioSerie, fimSerie).map((mes) => {
    const l = mapaTend.get(mes);
    const total = l?.total ?? 0;
    const dentro = l?.dentro ?? 0;
    return {
      competencia: paraExibicao(mes),
      total_atendidos: total,
      dentro_sla: dentro,
      fora_sla: total - dentro,
      pct_dentro_sla: percentual(dentro, total),
    };
  });

  return {
    escopo: {
      competencia: paraExibicao(mesRef),
      filial_id: escopo.filialId ?? null,
      consolidado: escopo.filialId === undefined,
      periodo_serie: { inicio: paraExibicao(inicioSerie), fim: paraExibicao(fimSerie) },
    },
    totais_mes: {
      total_atendidos: totais.total,
      dentro_sla: totais.dentro,
      fora_sla: totais.total - totais.dentro,
      pct_dentro_sla: percentual(totais.dentro, totais.total),
      pct_fora_sla: percentual(totais.total - totais.dentro, totais.total),
    },
    por_fila: porFila,
    por_topico: porTopico,
    por_filial: porFilial,
    tendencia_mensal: tendenciaMensal,
  };
}

// ==========================================================================
// Visão executiva consolidada
// ==========================================================================

/** Uma linha da quebra: de qual matriz, de qual filial, e quanto. */
export interface LinhaPorUnidade {
  empresa_id: number;
  empresa: string;
  filial_id: number | null;
  filial: string | null;
  valor: number;
  /** Só o SLA usa: o denominador e o que ficou dentro do prazo. */
  total?: number;
  dentro?: number;
}

/**
 * De QUEM é cada pedaço dos números do painel executivo.
 *
 * O indicador continua consolidado — é o que o gestor quer ler primeiro. Esta
 * quebra alimenta duas coisas em cima dele: a faixa de cores, que diz a
 * composição sem pedir nenhum clique, e a sanfona matriz → filial.
 *
 * As janelas são as MESMAS de `visaoExecutiva`: o mês de referência para o
 * gasto, os doze meses seguintes para o compromisso. Se divergissem, a soma da
 * sanfona não bateria com o número do card — e é justamente essa igualdade que
 * faz a quebra valer alguma coisa.
 */
export function quebraPorUnidade(ctx: Contexto, escopo: EscopoDashboard = {}) {
  const cenarios = cenariosDoEscopo(escopo);
  const escolhidos = lista(escopo.competencia, escopo.competencias)?.map(paraInterno).sort();
  const meses = escolhidos?.length ? escolhidos : [competenciaReferencia(ctx, escopo, cenarios)];
  const mesRef = meses[meses.length - 1]!;
  const emFoco = clausulaEm('l.competencia', meses)!;
  const { condicoes, params } = filtroFinanceiro(ctx, escopo, cenarios);
  const where = condicoes.join(' AND ');

  const porUnidade = (sqlExtra: string, extras: unknown[]): LinhaPorUnidade[] =>
    (
      db()
        .prepare(
          `SELECT l.empresa_id, e.nome AS empresa, l.filial_id, f.nome AS filial,
                  COALESCE(SUM(l.valor_centavos), 0) AS centavos
             FROM lancamentos l
             JOIN empresas e ON e.id = l.empresa_id
             LEFT JOIN filiais f ON f.id = l.filial_id
            WHERE ${where} AND ${sqlExtra}
            GROUP BY l.empresa_id, l.filial_id
            ORDER BY centavos DESC`,
        )
        .all(...params, ...extras) as Array<{
        empresa_id: number;
        empresa: string;
        filial_id: number | null;
        filial: string | null;
        centavos: number;
      }>
    ).map((r) => ({
      empresa_id: r.empresa_id,
      empresa: r.empresa,
      filial_id: r.filial_id,
      filial: r.filial,
      valor: paraReais(r.centavos),
    }));

  // Compromisso: os doze meses SEGUINTES ao de referência, como no card.
  const inicio = somarMeses(mesRef, 1);
  const fim = somarMeses(mesRef, 12);

  // O SLA usa o MESMO mês de referência do card, que é o do próprio painel de
  // SLA — e não o do financeiro: os dois podem divergir quando uma base tem
  // movimento num mês e a outra não.
  const mesSla = competenciaReferenciaSla(ctx, escopo);
  const filtroSla = montarFiltroSla(ctx, { filialId: escopo.filialId, empresas: escopo.empresas });
  const sla = (
    db()
      .prepare(
        `SELECT s.empresa_id, e.nome AS empresa, s.filial_id, f.nome AS filial,
                COALESCE(SUM(s.total_atendidos), 0) AS total,
                COALESCE(SUM(s.dentro_sla), 0) AS dentro
           FROM tickets_sla s
           JOIN empresas e ON e.id = s.empresa_id
           LEFT JOIN filiais f ON f.id = s.filial_id
          WHERE ${filtroSla.where} AND s.competencia = ?
          GROUP BY s.empresa_id, s.filial_id
          ORDER BY (SUM(s.total_atendidos) - SUM(s.dentro_sla)) DESC`,
      )
      .all(...filtroSla.params, mesSla) as Array<{
      empresa_id: number;
      empresa: string;
      filial_id: number | null;
      filial: string | null;
      total: number;
      dentro: number;
    }>
  ).map((r) => ({ ...r, valor: r.total }));

  const alcanceProj = escopoSql(ctx, escopo.empresas, 'p.empresa_id');
  const atrasados = (
    db()
      .prepare(
        `SELECT p.empresa_id, e.nome AS empresa, p.filial_id, f.nome AS filial,
                p.mes_fim_planejado, p.mes_fim_real, p.status
           FROM projetos p
           JOIN empresas e ON e.id = p.empresa_id
           LEFT JOIN filiais f ON f.id = p.filial_id
          WHERE ${alcanceProj.sql} AND p.excluido_em IS NULL`,
      )
      .all(...alcanceProj.params) as Array<{
      empresa_id: number;
      empresa: string;
      filial_id: number | null;
      filial: string | null;
      mes_fim_planejado: string;
      mes_fim_real: string | null;
      status: string;
    }>
  ).filter((p) => calcularAtraso(p.mes_fim_planejado, p.mes_fim_real, p.status).atrasado);

  const contar = (linhas: typeof atrasados): LinhaPorUnidade[] => {
    const mapa = new Map<string, LinhaPorUnidade>();
    for (const p of linhas) {
      const chave = `${p.empresa_id}:${p.filial_id ?? ''}`;
      const atual = mapa.get(chave) ?? {
        empresa_id: p.empresa_id, empresa: p.empresa, filial_id: p.filial_id, filial: p.filial, valor: 0,
      };
      atual.valor += 1;
      mapa.set(chave, atual);
    }
    return [...mapa.values()].sort((a, b) => b.valor - a.valor);
  };

  return {
    gasto_mes: porUnidade(emFoco.sql, emFoco.params),
    compromisso_proximos_12_meses: porUnidade('l.competencia BETWEEN ? AND ?', [inicio, fim]),
    projetos_atrasados: contar(atrasados),
    sla,
  };
}

export function visaoExecutiva(ctx: Contexto, escopo: EscopoDashboard = {}) {
  const financeiro = dashboardFinanceiro(ctx, escopo);
  const projetos = dashboardProjetos(ctx, escopo);
  const sla = dashboardSla(ctx, escopo);
  // A entrega no prazo mora em `entregaDeTarefas` e é chamada daqui em vez de
  // recalculada: a regra do que é "no prazo" tem de ter um dono só.
  const entrega = entregaDeTarefas(ctx, {
    empresas: escopo.empresas,
    filiais: escopo.filiais,
    competencias: escopo.competencias,
    competenciaInicio: escopo.competenciaInicio,
    competenciaFim: escopo.competenciaFim,
  });
  // O mês do recorte decide QUAL meta vale: uma meta que passou a valer em
  // março não pode reger a leitura de janeiro.
  const mes = financeiro.escopo.competencia;
  return {
    escopo: financeiro.escopo,
    financeiro: {
      total_mes: financeiro.totais_mes.total,
      despesa: financeiro.totais_mes.despesa,
      investimento: financeiro.totais_mes.investimento,
      variacao_mes_anterior_pct: financeiro.totais_mes.variacao_mes_anterior_pct,
      compromisso_proximos_12_meses: Math.round(
        financeiro.projecao_12_meses.reduce((s, m) => s + m.total, 0) * 100,
      ) / 100,
      // A meta do financeiro é TETO sobre a variação contra o mês anterior:
      // "não crescer mais que X%". Sem mês anterior não há o que comparar.
      meta: leituraDeMeta(
        alvoDe(ctx, 'financeiro', mes),
        financeiro.totais_mes.variacao_mes_anterior_pct,
        'financeiro',
      ),
    },
    projetos: {
      ...projetos.indicadores,
      pct_no_prazo: entrega.pct_no_prazo,
      tarefas_entregues: entrega.entregues,
      meta: leituraDeMeta(alvoDe(ctx, 'projetos', mes), entrega.entregues ? entrega.pct_no_prazo : null, 'projetos'),
    },
    sla: {
      ...sla.totais_mes,
      meta: leituraDeMeta(
        alvoDe(ctx, 'sla', mes),
        sla.totais_mes.total_atendidos ? sla.totais_mes.pct_dentro_sla : null,
        'sla',
      ),
    },
    // Pago por uma unidade, consumido por outras. Sem rateio: o valor é o
    // integral da pagadora, e o detalhe lista quem usa.
    consumo: despesaCentralizada(ctx, {
      empresas: escopo.empresas,
      filiais: escopo.filiais,
      cenarios: escopo.cenario ? [escopo.cenario] : undefined,
      competencias: [mes],
    }),
    // O equilíbrio mês a mês NÃO se prende ao mês em foco: a pergunta é "como
    // estava no mês anterior e como ficou neste", e um recorte de um mês só
    // não teria contra o que comparar.
    equilibrio: equilibrioDeDespesas(ctx, {
      empresas: escopo.empresas,
      filiais: escopo.filiais,
      cenarios: escopo.cenario ? [escopo.cenario] : undefined,
      competenciaFim: mes,
    }),
    // De quem é cada pedaço: alimenta a faixa de cores e a sanfona por unidade.
    por_unidade: quebraPorUnidade(ctx, escopo),
  };
}

// ==========================================================================
// Conferência de origem
// ==========================================================================

/**
 * Decompõe o total por procedência do dado.
 *
 * O total que o sistema mostra não é o total das planilhas enviadas pelo
 * gestor: além das linhas importadas, a base soma a folha de TI rateada e a
 * projeção do novo ERP, que não existiam como linha de despesa. Sem esta
 * visão, a única conversa possível sobre a diferença é "o número está errado";
 * com ela, o gestor confere parcela por parcela e decide o que é oficial.
 *
 * Ignora o recorte de filial de propósito: a conferência é da unidade inteira.
 */
export function conferenciaOrigem(ctx: Contexto, escopo: EscopoDashboard = {}) {
  const cenario = escopo.cenario ?? CENARIO_OFICIAL;
  const alcance = escopoSql(ctx, escopo.empresas);

  const linhas = db()
    .prepare(
      `SELECT origem, competencia,
              COUNT(*) AS n,
              SUM(valor_centavos) AS centavos
         FROM lancamentos
        WHERE ${alcance.sql} AND excluido_em IS NULL AND cenario = ?
        GROUP BY origem, competencia
        ORDER BY competencia`,
    )
    .all(...alcance.params, cenario) as Array<{ origem: Origem; competencia: string; n: number; centavos: number }>;

  const totalCentavos = linhas.reduce((s, l) => s + l.centavos, 0);
  const ordem: Origem[] = ['planilha', 'folha_ti', 'projecao_spincare', 'manual'];

  const porOrigem = ordem.map((origem) => {
    const minhas = linhas.filter((l) => l.origem === origem);
    const centavos = minhas.reduce((s, l) => s + l.centavos, 0);
    const meses = minhas.map((l) => l.competencia).sort();
    return {
      origem,
      rotulo: ROTULO_ORIGEM[origem],
      lancamentos: minhas.reduce((s, l) => s + l.n, 0),
      valor: paraReais(centavos),
      percentual: percentual(centavos, totalCentavos),
      competencia_inicio: meses.length ? paraExibicao(meses[0]!) : null,
      competencia_fim: meses.length ? paraExibicao(meses[meses.length - 1]!) : null,
    };
  });

  const meses = [...new Set(linhas.map((l) => l.competencia))].sort();
  const porCompetencia = meses.map((competencia) => {
    const doMes = linhas.filter((l) => l.competencia === competencia);
    return {
      competencia: paraExibicao(competencia),
      ...Object.fromEntries(ordem.map((o) => [o, paraReais(doMes.filter((l) => l.origem === o).reduce((s, l) => s + l.centavos, 0))])),
      total: paraReais(doMes.reduce((s, l) => s + l.centavos, 0)),
    };
  });

  const basePlanilha = linhas.filter((l) => l.origem === 'planilha').reduce((s, l) => s + l.centavos, 0);
  return {
    cenario,
    base_enviada: paraReais(basePlanilha),
    acrescentado: paraReais(totalCentavos - basePlanilha),
    total: paraReais(totalCentavos),
    peso_do_acrescimo: percentual(totalCentavos - basePlanilha, totalCentavos),
    por_origem: porOrigem,
    por_competencia: porCompetencia,
  };
}
