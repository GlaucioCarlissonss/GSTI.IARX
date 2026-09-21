/**
 * HISTÓRICO DE RECLASSIFICAÇÃO — quem pediu para mudar a prioridade, e por quê.
 *
 * A prioridade mudava sem deixar rastro: o upsert da integração sobrescrevia o
 * campo, e uma elevação de Baixa para Alta "a pedido de alguém" virava um
 * estado sem história. Quem conferisse o SLA depois não teria como saber por
 * que aquele chamado corria contra um prazo mais curto.
 *
 * O solicitante é TEXTO LIVRE, com cargo e nome ("Coordenador de Enfermagem —
 * Maria Souza"). Quem pede a elevação costuma ser de fora do sistema, e exigir
 * um usuário cadastrado faria a operação registrar o nome errado ou não
 * registrar nada.
 */
import { db } from '../db/index.js';
import { erroNaoEncontrado, erroValidacao } from '../lib/erros.js';
import { auditar } from './auditoria.js';
import type { Contexto } from './contexto.js';
import { escopoSql } from './escopo.js';
import { PRIORIDADES, prazoDoAcordo, ROTULO_PRIORIDADE, type Prioridade } from './slas.js';

export interface LinhaReclassificacao {
  id: number;
  prioridade_anterior: string | null;
  prioridade_anterior_rotulo: string | null;
  prioridade_nova: string;
  prioridade_nova_rotulo: string;
  ocorrido_em: string;
  motivo: string | null;
  solicitante: string | null;
  usuario_email: string | null;
  origem: 'manual' | 'integracao';
}

function rotulo(p: string | null): string | null {
  if (!p) return null;
  return ROTULO_PRIORIDADE[p as Prioridade] ?? p;
}

function normalizar(valor: unknown): Prioridade {
  const texto = String(valor ?? '').trim().toLowerCase();
  const porRotulo = (Object.keys(ROTULO_PRIORIDADE) as Prioridade[]).find(
    (k) => ROTULO_PRIORIDADE[k].toLowerCase() === texto,
  );
  const chave = PRIORIDADES.includes(texto as Prioridade) ? (texto as Prioridade) : porRotulo;
  if (!chave) throw erroValidacao(`Prioridade inválida. Use uma de: ${PRIORIDADES.join(', ')}.`);
  return chave;
}

/**
 * A mudança que veio da ORIGEM, no upsert da integração.
 *
 * Sem `Contexto`: o webhook não tem usuário nem cliente em foco, e é
 * exatamente por isso que este histórico é tabela própria e não `auditar()`.
 * Só grava quando houve mudança de fato — repetir o mesmo valor a cada
 * sincronização encheria a ficha de linhas que não contam nada.
 */
export function registrarReclassificacaoDaOrigem(
  ticketSlaId: number,
  anterior: string | null | undefined,
  nova: string | null | undefined,
): void {
  const de = anterior ?? null;
  const para = nova ?? null;
  if (!para || de === para) return;
  db()
    .prepare(
      `INSERT INTO ticket_reclassificacoes
         (ticket_sla_id, prioridade_anterior, prioridade_nova, motivo, origem)
       VALUES (?, ?, ?, ?, 'integracao')`,
    )
    .run(ticketSlaId, de, para, 'Prioridade alterada no sistema de origem.');
}

export function listarReclassificacoes(ctx: Contexto, ticketSlaId: number): LinhaReclassificacao[] {
  // O chamado tem de estar no escopo de quem pergunta — o id sozinho não é
  // autorização.
  const alcance = escopoSql(ctx, null, 's.empresa_id');
  const chamado = db()
    .prepare(`SELECT s.id FROM tickets_sla s WHERE s.id = ? AND ${alcance.sql}`)
    .get(ticketSlaId, ...alcance.params);
  if (!chamado) throw erroNaoEncontrado(`Chamado ${ticketSlaId} não encontrado neste cliente.`);

  return (
    db()
      .prepare(
        `SELECT r.id, r.prioridade_anterior, r.prioridade_nova, r.ocorrido_em, r.motivo,
                r.solicitante, r.origem, u.email AS usuario_email
           FROM ticket_reclassificacoes r
           LEFT JOIN usuarios u ON u.id = r.usuario_id
          WHERE r.ticket_sla_id = ?
          ORDER BY r.ocorrido_em DESC, r.id DESC`,
      )
      .all(ticketSlaId) as Array<Omit<LinhaReclassificacao, 'prioridade_anterior_rotulo' | 'prioridade_nova_rotulo'>>
  ).map((r) => ({
    ...r,
    prioridade_anterior_rotulo: rotulo(r.prioridade_anterior),
    prioridade_nova_rotulo: rotulo(r.prioridade_nova) ?? r.prioridade_nova,
  }));
}

export interface EntradaReclassificacao {
  prioridade?: unknown;
  motivo?: unknown;
  solicitante?: unknown;
}

/**
 * A reclassificação feita por alguém operando o sistema.
 *
 * A prioridade vigente passa a valer para o SLA: o prazo é recalculado a
 * partir do acordo da prioridade nova — mas SÓ quando o prazo era nosso. O que
 * o helpdesk prometeu ao solicitante não se reescreve por decisão interna, e é
 * `prazo_do_acordo` que distingue os dois casos.
 */
export function reclassificarChamado(ctx: Contexto, ticketSlaId: number, dados: EntradaReclassificacao) {
  const alcance = escopoSql(ctx, null, 's.empresa_id');
  const antes = db()
    .prepare(
      `SELECT s.id, s.empresa_id, s.prioridade, s.topico_ajuda_id, s.aberto_em, s.fechado_em,
              s.prazo_em, s.prazo_do_acordo, s.total_atendidos
         FROM tickets_sla s
        WHERE s.id = ? AND ${alcance.sql} AND s.excluido_em IS NULL`,
    )
    .get(ticketSlaId, ...alcance.params) as
    | {
        id: number;
        empresa_id: number;
        prioridade: string | null;
        topico_ajuda_id: number | null;
        aberto_em: string | null;
        fechado_em: string | null;
        prazo_em: string | null;
        prazo_do_acordo: number;
        total_atendidos: number;
      }
    | undefined;
  if (!antes) throw erroNaoEncontrado(`Chamado ${ticketSlaId} não encontrado neste cliente.`);

  const nova = normalizar(dados.prioridade);
  const solicitante = String(dados.solicitante ?? '').trim();
  // O enunciado pede cargo E nome: sem isso o histórico registra "alguém
  // pediu", que é o mesmo que não registrar.
  if (!solicitante) throw erroValidacao('Informe quem pediu a reclassificação, com cargo e nome.');
  const motivo = String(dados.motivo ?? '').trim() || null;
  if (antes.prioridade === nova) {
    throw erroValidacao(`O chamado já está na prioridade ${ROTULO_PRIORIDADE[nova]}.`);
  }

  // Só o prazo que saiu do nosso cadastro pode ser refeito.
  const prazo = antes.prazo_do_acordo
    ? prazoDoAcordo(antes.empresa_id, antes.aberto_em, nova, antes.topico_ajuda_id) ?? antes.prazo_em
    : antes.prazo_em;
  const referencia = antes.fechado_em ?? new Date().toISOString().slice(0, 16) + 'Z';
  const dentro = prazo ? (referencia <= prazo ? 1 : 0) : antes.fechado_em ? 1 : 0;
  const total = antes.total_atendidos || 1;

  db()
    .prepare(
      `UPDATE tickets_sla
          SET prioridade = ?, prazo_em = ?, dentro_sla = ?, fora_sla = ?, atualizado_em = datetime('now')
        WHERE id = ?`,
    )
    .run(nova, prazo, dentro ? total : 0, dentro ? 0 : total, ticketSlaId);

  db()
    .prepare(
      `INSERT INTO ticket_reclassificacoes
         (ticket_sla_id, prioridade_anterior, prioridade_nova, motivo, solicitante, usuario_id, origem)
       VALUES (?, ?, ?, ?, ?, ?, 'manual')`,
    )
    .run(ticketSlaId, antes.prioridade, nova, motivo, solicitante, ctx.usuarioId);

  // A trilha administrativa continua registrando o evento onde há usuário; o
  // histórico do chamado é outra coisa, e vive na tela dele.
  auditar(ctx, {
    entidade: 'ticket_sla',
    entidadeId: ticketSlaId,
    acao: 'reclassificar',
    justificativa: motivo,
    antes: { prioridade: antes.prioridade, prazo_em: antes.prazo_em },
    depois: { prioridade: nova, prazo_em: prazo, solicitante },
  });

  return { id: ticketSlaId, prioridade: nova, prazo_em: prazo, dentro_sla: dentro === 1 };
}
