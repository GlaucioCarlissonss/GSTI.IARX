import { db } from '../db/index.js';
import { erroConflito, erroValidacao } from '../lib/erros.js';
import { auditar } from './auditoria.js';
import { paraExibicao, posicaoTemporal } from './competencia.js';
import type { Contexto } from './contexto.js';

export function competenciaEstaFechada(empresaId: number, competencia: string): boolean {
  const linha = db()
    .prepare('SELECT 1 FROM fechamentos WHERE empresa_id = ? AND competencia = ?')
    .get(empresaId, competencia);
  return linha !== undefined;
}

/**
 * Porteiro de escrita para qualquer registro com competência.
 *
 * - Competência fechada  -> bloqueada (é preciso reabrir a competência).
 * - Competência passada  -> permitida somente com justificativa registrada.
 * - Corrente ou futura   -> livre.
 */
export function garantirCompetenciaEditavel(
  ctx: Contexto,
  competencia: string,
  justificativa?: string | null,
): void {
  if (competenciaEstaFechada(ctx.empresaId, competencia)) {
    throw erroConflito(
      `A competência ${paraExibicao(competencia)} está fechada. Reabra a competência para alterá-la.`,
    );
  }
  if (posicaoTemporal(competencia) === 'passada' && !justificativa?.trim()) {
    throw erroValidacao(
      `Alterações em competências passadas (${paraExibicao(competencia)}) exigem justificativa.`,
    );
  }
}

export function listarFechamentos(ctx: Contexto) {
  return db()
    .prepare(
      `SELECT f.id, f.competencia, f.fechado_em, f.observacao, u.email AS fechado_por
         FROM fechamentos f LEFT JOIN usuarios u ON u.id = f.fechado_por
        WHERE f.empresa_id = ? ORDER BY f.competencia DESC`,
    )
    .all(ctx.empresaId)
    .map((l) => {
      const r = l as Record<string, unknown>;
      return { ...r, competencia: paraExibicao(String(r.competencia)) };
    });
}

export function fecharCompetencia(ctx: Contexto, competencia: string, observacao?: string) {
  if (posicaoTemporal(competencia) === 'futura') {
    throw erroValidacao('Não é possível fechar uma competência futura.');
  }
  if (competenciaEstaFechada(ctx.empresaId, competencia)) {
    throw erroConflito(`A competência ${paraExibicao(competencia)} já está fechada.`);
  }
  const info = db()
    .prepare(
      'INSERT INTO fechamentos (empresa_id, competencia, fechado_por, observacao) VALUES (?, ?, ?, ?)',
    )
    .run(ctx.empresaId, competencia, ctx.usuarioId, observacao ?? null);
  auditar(ctx, {
    entidade: 'fechamento',
    entidadeId: Number(info.lastInsertRowid),
    acao: 'fechar',
    depois: { competencia: paraExibicao(competencia), observacao },
  });
  return { id: Number(info.lastInsertRowid), competencia: paraExibicao(competencia) };
}

export function reabrirCompetencia(ctx: Contexto, competencia: string, justificativa: string) {
  if (!justificativa?.trim()) {
    throw erroValidacao('Reabrir uma competência exige justificativa.');
  }
  const info = db()
    .prepare('DELETE FROM fechamentos WHERE empresa_id = ? AND competencia = ?')
    .run(ctx.empresaId, competencia);
  if (info.changes === 0) {
    throw erroConflito(`A competência ${paraExibicao(competencia)} não está fechada.`);
  }
  auditar(ctx, {
    entidade: 'fechamento',
    acao: 'reabrir',
    justificativa,
    antes: { competencia: paraExibicao(competencia) },
  });
  return { competencia: paraExibicao(competencia), reaberta: true };
}
