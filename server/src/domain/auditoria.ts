import { db } from '../db/index.js';
import type { Contexto } from './contexto.js';
import { escopoSql } from './escopo.js';

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

export interface TentativaNegada {
  clienteId: number | null;
  usuarioId: number | null;
  usuarioEmail: string | null;
  rota?: string | null;
  metodo?: string | null;
  motivo?: string | null;
}

/**
 * Tentativa de acesso a cliente não autorizado.
 *
 * Fora de `auditar` porque não há contexto: a recusa acontece ANTES de existir
 * empresa em foco — é o próprio contexto que foi negado. Guardar em `auditoria`
 * exigiria inventar uma empresa para a linha, e uma empresa inventada na trilha
 * vale menos que nenhuma.
 */
export function registrarAcessoNegado(tentativa: TentativaNegada): void {
  db()
    .prepare(
      `INSERT INTO acesso_negado (cliente_id, usuario_id, usuario_email, rota, metodo, motivo)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      tentativa.clienteId,
      tentativa.usuarioId,
      tentativa.usuarioEmail,
      tentativa.rota ?? null,
      tentativa.metodo ?? null,
      tentativa.motivo ?? null,
    );
}

/** As tentativas recusadas, da mais recente para a mais antiga. */
export function listarAcessosNegados(limite = 100) {
  return db()
    .prepare(
      `SELECT id, cliente_id, usuario_id, usuario_email, rota, metodo, motivo, criado_em
         FROM acesso_negado ORDER BY id DESC LIMIT ?`,
    )
    .all(Math.min(limite, 500));
}

export interface FiltroAuditoria {
  /** Filtro local de matriz. Vazio: o cliente inteiro. */
  empresas?: number[];
  entidade?: string;
  entidadeId?: number;
  limite?: number;
  offset?: number;
}

export function listarAuditoria(ctx: Contexto, filtro: FiltroAuditoria = {}) {
  // A trilha é do cliente: quem audita procura um registro, e não sabe de
  // antemão em qual unidade ele foi alterado.
  const alcance = escopoSql(ctx, filtro.empresas);
  const condicoes = [alcance.sql];
  const params: unknown[] = [...alcance.params];
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
