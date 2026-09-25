/**
 * Limpeza da base de lançamentos do cliente.
 *
 * É a operação mais perigosa do sistema, então ela é construída para ser
 * difícil de disparar por engano:
 *
 * - a contagem do que será afetado vem ANTES, e por um caminho que não apaga;
 * - apagar tudo exige digitar o nome do cliente, não só clicar em "confirmar";
 * - o escopo é sempre o cliente da sessão, nunca "a base";
 * - CADASTRO NÃO É APAGADO. Centro de custo, filial e fornecedor sobrevivem:
 *   quem limpa quer recomeçar a carga, não desmontar a estrutura — e recriá-la
 *   à mão depois seria trabalho de horas.
 *
 * A exclusão é lógica (`excluido_em`), e a chave de deduplicação é zerada junto:
 * sem isso, recarregar o mesmo arquivo depois da limpeza esbarraria no índice
 * único e não traria nada de volta.
 */
import { db, emTransacao } from '../db/index.js';
import { erroValidacao } from '../lib/erros.js';
import { auditar } from './auditoria.js';
import { ehCompetenciaValida, paraInterno } from './competencia.js';
import type { Contexto } from './contexto.js';

export interface PeriodoLimpeza {
  /** Competência inicial, "MM/AAAA". Ausente: desde o começo. */
  de?: string | null;
  /** Competência final, "MM/AAAA". Ausente: até o fim. */
  ate?: string | null;
}

export interface PreviaLimpeza {
  lancamentos: number;
  competencias: string[];
  de: string | null;
  ate: string | null;
  /** O nome que precisa ser digitado para confirmar a limpeza total. */
  confirmacao_exigida: string | null;
}

function exigirGestor(ctx: Contexto): number {
  if (ctx.papel !== 'gestor') throw erroValidacao('Apenas gestores podem limpar a base.');
  if (ctx.clienteId === null) throw erroValidacao('Esta empresa ainda não pertence a um cliente.');
  return ctx.clienteId;
}

function faixa(periodo: PeriodoLimpeza): { de: string | null; ate: string | null } {
  const converter = (v: string | null | undefined, rotulo: string) => {
    if (!v) return null;
    if (!ehCompetenciaValida(v)) throw erroValidacao(`Competência ${rotulo} inválida: "${v}". Use MM/AAAA.`);
    return paraInterno(v);
  };
  const de = converter(periodo.de, 'inicial');
  const ate = converter(periodo.ate, 'final');
  if (de && ate && de > ate) throw erroValidacao('A competência inicial é posterior à final.');
  return { de, ate };
}

function condicoes(clienteId: number, periodo: PeriodoLimpeza) {
  const { de, ate } = faixa(periodo);
  const partes = ['cliente_id = ?', 'excluido_em IS NULL'];
  const params: unknown[] = [clienteId];
  if (de) {
    partes.push('competencia >= ?');
    params.push(de);
  }
  if (ate) {
    partes.push('competencia <= ?');
    params.push(ate);
  }
  return { sql: partes.join(' AND '), params, de, ate };
}

const nomeDoCliente = (clienteId: number) =>
  (db().prepare('SELECT nome FROM clientes WHERE id = ?').get(clienteId) as { nome: string } | undefined)?.nome ?? '';

/**
 * Quantos registros a limpeza atingiria — sem apagar nada.
 *
 * Existe para que a confirmação seja informada: "apagar 1.898 lançamentos de
 * 01/2026 a 09/2026" é uma decisão; "apagar" sozinho é um susto.
 */
export function previaLimpeza(ctx: Contexto, periodo: PeriodoLimpeza = {}): PreviaLimpeza {
  const clienteId = exigirGestor(ctx);
  const { sql, params, de, ate } = condicoes(clienteId, periodo);

  const total = (
    db().prepare(`SELECT COUNT(*) AS n FROM lancamentos WHERE ${sql}`).get(...params) as { n: number }
  ).n;
  const competencias = (
    db()
      .prepare(`SELECT DISTINCT competencia FROM lancamentos WHERE ${sql} ORDER BY competencia`)
      .all(...params) as Array<{ competencia: string }>
  ).map((c) => c.competencia);

  return {
    lancamentos: total,
    competencias,
    de,
    ate,
    // Só a limpeza TOTAL pede o nome digitado: exigi-lo para apagar um mês
    // transformaria a trava em ritual, e ritual se cumpre no automático.
    confirmacao_exigida: de || ate ? null : nomeDoCliente(clienteId),
  };
}

export interface ResultadoLimpeza {
  removidos: number;
  de: string | null;
  ate: string | null;
}

/**
 * Apaga (logicamente) os lançamentos do cliente no período.
 *
 * Sem período é a base inteira do cliente, e aí `confirmacao` tem de ser o nome
 * dele, digitado. Os registros de importação do período vão junto: deixar o
 * histórico dizendo que 110 linhas entraram, quando nenhuma existe mais, é pior
 * do que não ter histórico.
 */
export function limparLancamentos(
  ctx: Contexto,
  periodo: PeriodoLimpeza & { confirmacao?: string | null } = {},
): ResultadoLimpeza {
  const clienteId = exigirGestor(ctx);
  const { sql, params, de, ate } = condicoes(clienteId, periodo);
  const total = periodo.de || periodo.ate ? null : nomeDoCliente(clienteId);

  if (total !== null) {
    const digitado = String(periodo.confirmacao ?? '').trim();
    if (digitado !== total) {
      throw erroValidacao(
        `Para apagar toda a base deste cliente, digite exatamente o nome dele: "${total}".`,
      );
    }
  }

  return emTransacao(() => {
    const antes = (
      db().prepare(`SELECT COUNT(*) AS n FROM lancamentos WHERE ${sql}`).get(...params) as { n: number }
    ).n;

    // `dedup_hash = NULL` junto: sem isso, recarregar o mesmo arquivo depois
    // bateria no índice único e a base ficaria vazia para sempre.
    db()
      .prepare(`UPDATE lancamentos SET excluido_em = datetime('now'), dedup_hash = NULL WHERE ${sql}`)
      .run(...params);

    auditar(ctx, {
      entidade: 'base_financeira',
      acao: 'limpar',
      justificativa: de || ate ? `Limpeza de ${de ?? 'início'} a ${ate ?? 'fim'}.` : 'Limpeza total da base do cliente.',
      depois: { lancamentos_removidos: antes, de, ate },
      comEmpresa: false,
    });

    return { removidos: antes, de, ate };
  });
}
