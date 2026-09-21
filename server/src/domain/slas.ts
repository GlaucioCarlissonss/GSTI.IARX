/**
 * ACORDOS DE NÍVEL DE SERVIÇO — quantas horas um chamado tem.
 *
 * Antes deste cadastro, o prazo vinha pronto da origem (`due_at` do helpdesk).
 * Quando a origem não mandava, o sistema contava o chamado fechado como dentro
 * e o aberto como fora — que não é um acordo, é a ausência de um.
 *
 * A regra é por (tópico de ajuda, prioridade), e o tópico nulo é a REGRA GERAL
 * daquela prioridade. A integração cria tópico sozinha (`resolverTopicoAjuda`
 * com `criarSeAusente`), então exigir uma linha por tópico deixaria chamados
 * sem acordo sem ninguém perceber; a regra geral cobre o que aparecer.
 *
 * O cadastro NÃO reescreve o passado: ele decide o prazo do chamado na hora em
 * que o chamado entra. Recalcular meses fechados a partir de uma regra
 * cadastrada hoje mudaria número que já foi olhado e conferido.
 */
import { db } from '../db/index.js';
import { erroConflito, erroNaoEncontrado, erroValidacao } from '../lib/erros.js';
import { auditar } from './auditoria.js';
import type { Contexto } from './contexto.js';

export type Prioridade = 'low' | 'medium' | 'high' | 'urgent';

export const PRIORIDADES: Prioridade[] = ['low', 'medium', 'high', 'urgent'];

export const ROTULO_PRIORIDADE: Record<Prioridade, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente',
};

export interface LinhaSla {
  id: number;
  topico_ajuda_id: number | null;
  topico: string | null;
  prioridade: Prioridade;
  horas: number;
  ativo: number;
}

function validarPrioridade(valor: unknown): Prioridade {
  const texto = String(valor ?? '').trim().toLowerCase();
  const porRotulo = (Object.keys(ROTULO_PRIORIDADE) as Prioridade[]).find(
    (k) => ROTULO_PRIORIDADE[k].toLowerCase() === texto,
  );
  const chave = PRIORIDADES.includes(texto as Prioridade) ? (texto as Prioridade) : porRotulo;
  if (!chave) throw erroValidacao(`Prioridade inválida. Use uma de: ${PRIORIDADES.join(', ')}.`);
  return chave;
}

function validarHoras(valor: unknown): number {
  const n = Number(String(valor ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) throw erroValidacao('As horas de atendimento precisam ser um número maior que zero.');
  return Math.round(n * 100) / 100;
}

/** O tópico precisa ser da mesma unidade. Nulo é a regra geral, e é válido. */
function validarTopico(empresaId: number, valor: unknown): number | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const id = Number(valor);
  if (!Number.isInteger(id)) throw erroValidacao('Tópico de ajuda inválido.');
  const linha = db().prepare('SELECT id FROM topicos_ajuda WHERE id = ? AND empresa_id = ?').get(id, empresaId);
  if (!linha) throw erroValidacao(`Tópico de ajuda ${id} não pertence a esta unidade.`);
  return id;
}

export function listarSlas(ctx: Contexto, incluirInativos = false): LinhaSla[] {
  return db()
    .prepare(
      `SELECT s.id, s.topico_ajuda_id, t.nome AS topico, s.prioridade, s.horas, s.ativo
         FROM slas s
         LEFT JOIN topicos_ajuda t ON t.id = s.topico_ajuda_id
        WHERE s.empresa_id = ? ${incluirInativos ? '' : 'AND s.ativo = 1'}
        ORDER BY COALESCE(t.nome, ''), s.prioridade`,
    )
    .all(ctx.empresaId) as LinhaSla[];
}

export interface EntradaSla {
  topico_ajuda_id?: unknown;
  prioridade?: unknown;
  horas?: unknown;
}

export function criarSla(ctx: Contexto, dados: EntradaSla): LinhaSla {
  const topicoId = validarTopico(ctx.empresaId, dados.topico_ajuda_id);
  const prioridade = validarPrioridade(dados.prioridade);
  const horas = validarHoras(dados.horas);

  // `UNIQUE` não serve aqui: no SQLite dois NULL são distintos, e a regra geral
  // (tópico nulo) poderia ser cadastrada duas vezes para a mesma prioridade.
  const existente = db()
    .prepare(
      `SELECT id FROM slas
        WHERE empresa_id = ? AND prioridade = ? AND topico_ajuda_id IS ?`,
    )
    .get(ctx.empresaId, prioridade, topicoId);
  if (existente) {
    throw erroConflito(
      topicoId
        ? 'Já existe um acordo para este tópico nesta prioridade.'
        : 'Já existe uma regra geral para esta prioridade.',
    );
  }

  const info = db()
    .prepare('INSERT INTO slas (empresa_id, topico_ajuda_id, prioridade, horas) VALUES (?, ?, ?, ?)')
    .run(ctx.empresaId, topicoId, prioridade, horas);
  const id = Number(info.lastInsertRowid);
  auditar(ctx, { entidade: 'sla', entidadeId: id, acao: 'criar', depois: { prioridade, horas, topico_ajuda_id: topicoId } });
  return obterSla(ctx, id);
}

export function obterSla(ctx: Contexto, id: number): LinhaSla {
  const linha = db()
    .prepare(
      `SELECT s.id, s.topico_ajuda_id, t.nome AS topico, s.prioridade, s.horas, s.ativo
         FROM slas s
         LEFT JOIN topicos_ajuda t ON t.id = s.topico_ajuda_id
        WHERE s.id = ? AND s.empresa_id = ?`,
    )
    .get(id, ctx.empresaId) as LinhaSla | undefined;
  if (!linha) throw erroNaoEncontrado(`Acordo de SLA ${id} não encontrado nesta unidade.`);
  return linha;
}

export function atualizarSla(ctx: Contexto, id: number, dados: EntradaSla & { ativo?: unknown }): LinhaSla {
  const antes = obterSla(ctx, id);
  const horas = dados.horas === undefined ? antes.horas : validarHoras(dados.horas);
  const ativo = dados.ativo === undefined ? antes.ativo : dados.ativo ? 1 : 0;
  db()
    .prepare("UPDATE slas SET horas = ?, ativo = ? WHERE id = ? AND empresa_id = ?")
    .run(horas, ativo, id, ctx.empresaId);
  const depois = obterSla(ctx, id);
  auditar(ctx, { entidade: 'sla', entidadeId: id, acao: 'atualizar', antes, depois });
  return depois;
}

/**
 * As horas que valem para este chamado — ou `null` se não há acordo.
 *
 * O acordo do tópico ganha do geral: cadastrar "Rede: 4h para alta" e "geral:
 * 24h para alta" quer dizer que rede é mais exigente, não que as duas regras
 * competem. `null` devolve o comportamento anterior ao cadastro, que é o que
 * mantém toda base existente lendo como lia.
 */
export function horasDoAcordo(
  empresaId: number,
  prioridade: string | null | undefined,
  topicoAjudaId: number | null,
): number | null {
  const chave = String(prioridade ?? '').trim().toLowerCase();
  if (!PRIORIDADES.includes(chave as Prioridade)) return null;
  const linha = db()
    .prepare(
      `SELECT horas FROM slas
        WHERE empresa_id = ? AND prioridade = ? AND ativo = 1
          AND (topico_ajuda_id IS ? OR topico_ajuda_id IS NULL)
        ORDER BY topico_ajuda_id IS NULL
        LIMIT 1`,
    )
    .get(empresaId, chave, topicoAjudaId) as { horas: number } | undefined;
  return linha?.horas ?? null;
}

/**
 * O prazo derivado do acordo: abertura + horas, em ISO.
 *
 * Horas corridas, e não horas úteis: o sistema não tem calendário de
 * expediente cadastrado, e inventar um (segunda a sexta, 9 às 18) criaria um
 * prazo que nenhum contrato assinou.
 */
export function prazoDoAcordo(
  empresaId: number,
  abertoEm: string | null | undefined,
  prioridade: string | null | undefined,
  topicoAjudaId: number | null,
): string | null {
  if (!abertoEm) return null;
  const horas = horasDoAcordo(empresaId, prioridade, topicoAjudaId);
  if (horas === null) return null;
  const inicio = new Date(abertoEm);
  if (Number.isNaN(inicio.getTime())) return null;
  return new Date(inicio.getTime() + horas * 3600_000).toISOString();
}
