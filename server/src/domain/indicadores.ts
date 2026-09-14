/**
 * Indicadores Gerais — a leitura estratégica, separada da operação.
 *
 * Três blocos independentes (financeiro, SLA e projetos), dois indicadores
 * cada. São independentes de propósito: cada bloco recebe o próprio recorte,
 * e um bloco sem dado não zera os outros. Quem responde "a integração está
 * viva?" é a tela de Integrações; aqui se responde "como vai o gasto, o
 * atendimento e a entrega".
 *
 * Nada aqui inventa número: todo valor sai de uma consulta aos registros, e
 * cada indicador devolve junto o recorte que o produziu, para o detalhamento
 * abrir exatamente os mesmos registros.
 */
import { db } from '../db/index.js';
import { clausulaEm, clausulaEmComNulo } from '../lib/consulta.js';
import { paraExibicao, paraInterno } from './competencia.js';
import type { Contexto } from './contexto.js';
import { paraReais } from './dinheiro.js';
import { CENARIO_OFICIAL } from './financeiro.js';
import { percentual } from './sla.js';

/** Meta de conformidade de SLA, em pontos percentuais. */
export const META_SLA = 80;

/**
 * Recorte de um bloco. Cada bloco manda o seu — os filtros da tela são por
 * bloco, e misturá-los num recorte só faria o financeiro seguir o SLA.
 */
export interface RecorteIndicadores {
  filiais?: Array<number | null>;
  competenciaInicio?: string;
  competenciaFim?: string;
  competencias?: string[];
  cenarios?: string[];
  /** Bloco financeiro: `true` deixa só o reconhecido. Ausente traz tudo. */
  reconhecido?: boolean;
}

function janela(recorte: RecorteIndicadores, coluna: string) {
  const condicoes: string[] = [];
  const params: unknown[] = [];
  const comps = recorte.competencias?.map(paraInterno);
  const dentro = clausulaEm(coluna, comps);
  if (dentro) {
    condicoes.push(dentro.sql);
    params.push(...dentro.params);
  }
  if (recorte.competenciaInicio) {
    condicoes.push(`${coluna} >= ?`);
    params.push(paraInterno(recorte.competenciaInicio));
  }
  if (recorte.competenciaFim) {
    condicoes.push(`${coluna} <= ?`);
    params.push(paraInterno(recorte.competenciaFim));
  }
  return { condicoes, params };
}

// =========================================================== bloco financeiro

/**
 * Redução de custo na linha do tempo.
 *
 * Olha só a despesa **recorrente** (`natureza = 'fixa'`): é a que se compara
 * mês a mês com sentido. Uma compra pontual num mês e nenhuma no seguinte
 * produziria uma "redução" que não é redução de nada — é o fim de uma compra.
 *
 * A variação é sempre contra o mês anterior da própria série, e a tendência
 * compara as duas metades do período: dizer "caiu" por causa do último mês
 * isolado seria ler ruído como direção.
 */
export function reducaoDeCusto(ctx: Contexto, recorte: RecorteIndicadores = {}) {
  const condicoes = ['l.empresa_id = ?', 'l.excluido_em IS NULL', "l.natureza = 'fixa'"];
  const params: unknown[] = [ctx.empresaId];
  const aplicar = (c: { sql: string; params: unknown[] } | null) => {
    if (!c) return;
    condicoes.push(c.sql);
    params.push(...c.params);
  };
  aplicar(clausulaEm('l.cenario', recorte.cenarios?.length ? recorte.cenarios : [CENARIO_OFICIAL]));
  aplicar(clausulaEmComNulo('l.filial_id', recorte.filiais));
  if (recorte.reconhecido !== undefined) {
    condicoes.push('l.reconhecido = ?');
    params.push(recorte.reconhecido ? 1 : 0);
  }
  const j = janela(recorte, 'l.competencia');
  condicoes.push(...j.condicoes);
  params.push(...j.params);

  const linhas = db()
    .prepare(
      `SELECT l.competencia AS competencia, COUNT(*) AS n,
              COALESCE(SUM(l.valor_centavos), 0) AS soma
         FROM lancamentos l
        WHERE ${condicoes.join(' AND ')}
        GROUP BY l.competencia
        ORDER BY l.competencia`,
    )
    .all(...params) as Array<{ competencia: string; n: number; soma: number }>;

  const serie = linhas.map((linha, i) => {
    const anterior = i > 0 ? linhas[i - 1]!.soma : null;
    return {
      competencia: paraExibicao(linha.competencia),
      competencia_interna: linha.competencia,
      lancamentos: linha.n,
      valor: paraReais(linha.soma),
      valor_centavos: linha.soma,
      // Sem mês anterior não há variação — e 0 % diria que ficou igual.
      variacao_pct: anterior === null || anterior === 0 ? null : Math.round(((linha.soma - anterior) / anterior) * 1000) / 10,
    };
  });

  const primeiro = linhas[0]?.soma ?? 0;
  const ultimo = linhas[linhas.length - 1]?.soma ?? 0;
  const metade = Math.floor(linhas.length / 2);
  const media = (fatia: typeof linhas) =>
    fatia.length ? fatia.reduce((s, l) => s + l.soma, 0) / fatia.length : 0;
  const inicioMedio = media(linhas.slice(0, metade || 1));
  const fimMedio = media(linhas.slice(metade));
  const variacaoMedia = inicioMedio === 0 ? 0 : ((fimMedio - inicioMedio) / inicioMedio) * 100;

  return {
    serie,
    meses: linhas.length,
    valor_inicial: paraReais(primeiro),
    valor_final: paraReais(ultimo),
    variacao_total_pct:
      linhas.length < 2 || primeiro === 0 ? null : Math.round(((ultimo - primeiro) / primeiro) * 1000) / 10,
    economia: paraReais(Math.max(primeiro - ultimo, 0)),
    // A tendência é da média das metades, não do último ponto: um mês atípico
    // no fim não deve virar "tendência de alta".
    tendencia:
      linhas.length < 2 ? 'indefinida' : variacaoMedia <= -2 ? 'queda' : variacaoMedia >= 2 ? 'alta' : 'estavel',
  };
}

/**
 * Despesas por reconhecer, agrupadas por centro de custo.
 *
 * Neste sistema o **centro de custo é o tipo de despesa** — é assim que as
 * bases do cliente vêm rotuladas, e a importação já traduz um pelo outro. O
 * agrupamento é explícito porque a carga inicial concentra quase tudo por
 * reconhecer: sem o contador por centro, o gestor veria um número grande e
 * nenhum caminho por onde começar.
 */
export function despesasPorReconhecer(ctx: Contexto, recorte: RecorteIndicadores = {}) {
  // O recorte é montado uma vez SEM o filtro de reconhecimento: ele serve às
  // duas consultas, e a de universo é justamente a mesma sem essa condição.
  const condicoes = ['l.empresa_id = ?', 'l.excluido_em IS NULL'];
  const params: unknown[] = [ctx.empresaId];
  const aplicar = (c: { sql: string; params: unknown[] } | null) => {
    if (!c) return;
    condicoes.push(c.sql);
    params.push(...c.params);
  };
  aplicar(clausulaEm('l.cenario', recorte.cenarios?.length ? recorte.cenarios : [CENARIO_OFICIAL]));
  aplicar(clausulaEmComNulo('l.filial_id', recorte.filiais));
  const j = janela(recorte, 'l.competencia');
  condicoes.push(...j.condicoes);
  params.push(...j.params);
  const recorteBase = condicoes.join(' AND ');
  const where = `${recorteBase} AND l.reconhecido = 0`;

  const centros = db()
    .prepare(
      `SELECT t.id AS tipo_despesa_id, t.nome AS centro, COUNT(*) AS n,
              COALESCE(SUM(l.valor_centavos), 0) AS soma
         FROM lancamentos l
         JOIN tipos_despesa t ON t.id = l.tipo_despesa_id
        WHERE ${where}
        GROUP BY t.id, t.nome
        ORDER BY soma DESC, t.nome`,
    )
    .all(...params) as Array<{ tipo_despesa_id: number; centro: string; n: number; soma: number }>;

  // O universo do mesmo recorte, para o "de quantos" ter denominador honesto.
  const universo = db()
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(l.valor_centavos), 0) AS soma
         FROM lancamentos l
         JOIN tipos_despesa t ON t.id = l.tipo_despesa_id
        WHERE ${recorteBase}`,
    )
    .get(...params) as { n: number; soma: number };

  const quantidade = centros.reduce((s, c) => s + c.n, 0);
  const total = centros.reduce((s, c) => s + c.soma, 0);
  return {
    quantidade,
    valor: paraReais(total),
    valor_centavos: total,
    total_lancamentos: universo.n,
    total_valor: paraReais(universo.soma),
    pct_quantidade: percentual(quantidade, universo.n),
    pct_valor: percentual(total, universo.soma),
    centros: centros.map((c) => ({
      tipo_despesa_id: c.tipo_despesa_id,
      centro: c.centro,
      quantidade: c.n,
      valor: paraReais(c.soma),
      valor_centavos: c.soma,
    })),
  };
}

// ================================================================= bloco SLA

/**
 * Conformidade contra a meta, e a situação dos chamados.
 *
 * O percentual vem de `dentro_sla` sobre `total_atendidos`, que é a mesma
 * conta de todas as telas de SLA — não há uma segunda definição aqui.
 *
 * "Vencido" não é status de origem: é o chamado cujo prazo passou e que
 * ninguém resolveu. Ele **convive** com aberto e em andamento, e por isso é
 * contado à parte em vez de virar uma quarta fatia do mesmo bolo: somar as
 * quatro daria mais que o total, e a tela precisa dizer isso.
 */
export function conformidadeSla(ctx: Contexto, recorte: RecorteIndicadores = {}) {
  const condicoes = ['s.empresa_id = ?', 's.excluido_em IS NULL'];
  const params: unknown[] = [ctx.empresaId];
  const filiais = clausulaEmComNulo('s.filial_id', recorte.filiais);
  if (filiais) {
    condicoes.push(filiais.sql);
    params.push(...filiais.params);
  }
  const j = janela(recorte, 's.competencia');
  condicoes.push(...j.condicoes);
  params.push(...j.params);
  const where = condicoes.join(' AND ');

  const totais = db()
    .prepare(
      `SELECT COALESCE(SUM(s.total_atendidos), 0) AS total,
              COALESCE(SUM(s.dentro_sla), 0) AS dentro
         FROM tickets_sla s WHERE ${where}`,
    )
    .get(...params) as { total: number; dentro: number };

  // A situação só existe para o chamado vindo de helpdesk: o registro agregado
  // do mês não tem status, e contá-lo como "aberto" seria invenção.
  const situacao = db()
    .prepare(
      `SELECT
         SUM(CASE WHEN s.status = 'open' THEN 1 ELSE 0 END) AS abertos,
         SUM(CASE WHEN s.status = 'in_progress' THEN 1 ELSE 0 END) AS em_andamento,
         SUM(CASE WHEN s.status IN ('resolved','closed') THEN 1 ELSE 0 END) AS resolvidos,
         SUM(CASE WHEN s.status NOT IN ('resolved','closed')
                   AND s.prazo_em IS NOT NULL
                   AND s.prazo_em < strftime('%Y-%m-%dT%H:%M:%SZ','now') THEN 1 ELSE 0 END) AS vencidos,
         COUNT(*) AS com_status
       FROM tickets_sla s WHERE ${where} AND s.status IS NOT NULL`,
    )
    .get(...params) as {
    abertos: number | null;
    em_andamento: number | null;
    resolvidos: number | null;
    vencidos: number | null;
    com_status: number;
  };

  const pct = percentual(totais.dentro, totais.total);
  return {
    total: totais.total,
    dentro: totais.dentro,
    fora: totais.total - totais.dentro,
    pct_dentro: pct,
    meta: META_SLA,
    atinge_meta: totais.total > 0 && pct >= META_SLA,
    // Distância até a meta em pontos percentuais: é o que o termômetro mostra.
    distancia_meta: totais.total > 0 ? Math.round((pct - META_SLA) * 10) / 10 : null,
    situacao: {
      abertos: situacao.abertos ?? 0,
      em_andamento: situacao.em_andamento ?? 0,
      resolvidos: situacao.resolvidos ?? 0,
      // Vencido atravessa aberto e em andamento; não é uma quarta fatia.
      vencidos: situacao.vencidos ?? 0,
      com_status: situacao.com_status,
      registros_sem_status: totais.total - situacao.com_status,
    },
  };
}

// ============================================================ bloco projetos

/**
 * Entrega de tarefas na competência.
 *
 * "No prazo" é `mes_fim_real <= mes_fim_planejado` — a granularidade do módulo
 * é o mês, e comparar dia com mês daria atraso onde não há. A tarefa cancelada
 * fica de fora das duas contas: ela não foi entregue nem está pendente.
 */
export function entregaDeTarefas(ctx: Contexto, recorte: RecorteIndicadores = {}) {
  // O mês corrente entra como PRIMEIRO parâmetro porque o `?` dele está no
  // SELECT, antes de qualquer `?` do WHERE: em SQLite a ligação é posicional,
  // e mandá-lo por último desalinharia a lista inteira.
  const condicoes = ['p.empresa_id = ?', 'p.excluido_em IS NULL', 't.excluido_em IS NULL'];
  const params: unknown[] = [new Date().toISOString().slice(0, 7), ctx.empresaId];
  const filiais = clausulaEmComNulo('p.filial_id', recorte.filiais);
  if (filiais) {
    condicoes.push(filiais.sql);
    params.push(...filiais.params);
  }
  const j = janela(recorte, 't.mes_fim_planejado');
  condicoes.push(...j.condicoes);
  params.push(...j.params);

  const linha = db()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN t.status = 'cancelada' THEN 1 ELSE 0 END) AS canceladas,
         SUM(CASE WHEN t.status = 'concluida' AND t.mes_fim_real IS NOT NULL THEN 1 ELSE 0 END) AS entregues,
         SUM(CASE WHEN t.status = 'concluida' AND t.mes_fim_real IS NOT NULL
                   AND t.mes_fim_real <= t.mes_fim_planejado THEN 1 ELSE 0 END) AS no_prazo,
         SUM(CASE WHEN t.status IN ('pendente','em_andamento') THEN 1 ELSE 0 END) AS pendentes,
         SUM(CASE WHEN t.status IN ('pendente','em_andamento')
                   AND t.mes_fim_planejado < ? THEN 1 ELSE 0 END) AS atrasadas
       FROM tarefas t
       JOIN projetos p ON p.id = t.projeto_id
      WHERE ${condicoes.join(' AND ')}`,
    )
    .get(...params) as {
    total: number;
    canceladas: number | null;
    entregues: number | null;
    no_prazo: number | null;
    pendentes: number | null;
    atrasadas: number | null;
  };

  const entregues = linha.entregues ?? 0;
  const noPrazo = linha.no_prazo ?? 0;
  return {
    total: linha.total,
    canceladas: linha.canceladas ?? 0,
    entregues,
    no_prazo: noPrazo,
    fora_do_prazo: entregues - noPrazo,
    // O denominador é o que foi entregue: uma tarefa ainda em aberto não é
    // "fora do prazo" enquanto o mês planejado não passou.
    pct_no_prazo: percentual(noPrazo, entregues),
    pendentes: linha.pendentes ?? 0,
    pendentes_atrasadas: linha.atrasadas ?? 0,
  };
}

/** Os três blocos numa resposta só, cada um com o próprio recorte. */
export function indicadoresGerais(
  ctx: Contexto,
  recortes: { financeiro?: RecorteIndicadores; sla?: RecorteIndicadores; projetos?: RecorteIndicadores } = {},
) {
  return {
    financeiro: {
      reducao_custo: reducaoDeCusto(ctx, recortes.financeiro),
      por_reconhecer: despesasPorReconhecer(ctx, recortes.financeiro),
    },
    sla: conformidadeSla(ctx, recortes.sla),
    projetos: entregaDeTarefas(ctx, recortes.projetos),
  };
}
