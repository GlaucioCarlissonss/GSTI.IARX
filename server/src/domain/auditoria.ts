import { db } from '../db/index.js';
import type { Contexto } from './contexto.js';

export interface RegistroAuditoria {
  entidade: string;
  entidadeId?: number | null;
  acao: string;
  justificativa?: string | null;
  antes?: unknown;
  depois?: unknown;
}

/**
 * Nenhuma alteração relevante ocorre sem trilha: quem, quando e o quê.
 */
export function auditar(ctx: Contexto, registro: RegistroAuditoria): void {
  db()
    .prepare(
      `INSERT INTO auditoria
         (empresa_id, usuario_id, usuario_email, entidade, entidade_id, acao, justificativa, dados_antes, dados_depois)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ctx.empresaId,
      ctx.usuarioId,
      ctx.usuarioEmail,
      registro.entidade,
      registro.entidadeId ?? null,
      registro.acao,
      registro.justificativa ?? null,
      registro.antes === undefined ? null : JSON.stringify(registro.antes),
      registro.depois === undefined ? null : JSON.stringify(registro.depois),
    );
}

export interface FiltroAuditoria {
  entidade?: string;
  entidadeId?: number;
  limite?: number;
  offset?: number;
}

export function listarAuditoria(ctx: Contexto, filtro: FiltroAuditoria = {}) {
  const condicoes = ['empresa_id = ?'];
  const params: unknown[] = [ctx.empresaId];
  if (filtro.entidade) {
    condicoes.push('entidade = ?');
    params.push(filtro.entidade);
  }
  if (filtro.entidadeId !== undefined) {
    condicoes.push('entidade_id = ?');
    params.push(filtro.entidadeId);
  }
  const limite = Math.min(filtro.limite ?? 100, 500);
  const offset = filtro.offset ?? 0;
  return db()
    .prepare(
      `SELECT id, usuario_email, entidade, entidade_id, acao, justificativa, dados_antes, dados_depois, criado_em
         FROM auditoria
        WHERE ${condicoes.join(' AND ')}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limite, offset)
    .map((linha) => {
      const l = linha as Record<string, unknown>;
      return {
        ...l,
        dados_antes: l.dados_antes ? JSON.parse(String(l.dados_antes)) : null,
        dados_depois: l.dados_depois ? JSON.parse(String(l.dados_depois)) : null,
      };
    });
}
