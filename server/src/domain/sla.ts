import { db } from '../db/index.js';
import { erroNaoEncontrado, erroValidacao } from '../lib/erros.js';
import { auditar } from './auditoria.js';
import { paraExibicao, paraInterno } from './competencia.js';
import type { Contexto } from './contexto.js';
import { empresaDeEscrita, escopoSql } from './escopo.js';
import { validarFilial } from './cadastros.js';

interface LinhaTicket {
  id: number;
  empresa_id: number;
  filial_id: number | null;
  competencia: string;
  fila_id: number;
  topico_ajuda_id: number | null;
  total_atendidos: number;
  dentro_sla: number;
  fora_sla: number;
  observacoes: string | null;
  ticket_id: number | null;
  numero: string | null;
  assunto: string | null;
  solicitante: string | null;
  responsavel: string | null;
  nivel: string | null;
  status: string | null;
  origem_chamado: string | null;
  aberto_em: string | null;
  fechado_em: string | null;
  prazo_em: string | null;
  horas: number | null;
}

/** Campos que só existem quando o registro é um chamado, não um agregado. */
const CAMPOS_CHAMADO = [
  'ticket_id', 'numero', 'assunto', 'solicitante', 'responsavel',
  'nivel', 'status', 'origem_chamado', 'aberto_em', 'fechado_em', 'prazo_em', 'horas',
] as const;

export function percentual(parte: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((parte / total) * 1000) / 10;
}

function apresentar(linha: LinhaTicket & Record<string, unknown>, empresaId: number) {
  return {
    id: linha.id,
    filial_id: linha.filial_id,
    filial_nome: (linha.filial_nome as string | null) ?? null,
    competencia: paraExibicao(linha.competencia),
    fila_id: linha.fila_id,
    fila: (linha.fila as string | null) ?? null,
    topico_ajuda_id: linha.topico_ajuda_id,
    topico_ajuda: (linha.topico_ajuda as string | null) ?? null,
    total_atendidos: linha.total_atendidos,
    dentro_sla: linha.dentro_sla,
    fora_sla: linha.fora_sla,
    pct_dentro_sla: percentual(linha.dentro_sla, linha.total_atendidos),
    pct_fora_sla: percentual(linha.fora_sla, linha.total_atendidos),
    observacoes: linha.observacoes,
    ticket_id: linha.ticket_id,
    numero: linha.numero,
    assunto: linha.assunto,
    solicitante: linha.solicitante,
    responsavel: linha.responsavel,
    nivel: linha.nivel,
    status: linha.status,
    origem_chamado: linha.origem_chamado,
    aberto_em: linha.aberto_em,
    fechado_em: linha.fechado_em,
    prazo_em: linha.prazo_em,
    horas: linha.horas,
    source_system: (linha.source_system as string | null) ?? null,
    external_id: (linha.external_id as string | null) ?? null,
    // O endereço sai daqui, e não de cada tela: assim a listagem, o detalhe e
    // o detalhamento de qualquer indicador apontam para o mesmo lugar, e um
    // helpdesk novo não exige mexer em cada consumidor.
    // `external_id` é o id no sistema de origem, e é o que completa a URL. O
    // chamado que chega por webhook grava só ele; `ticket_id` cobre a carga
    // antiga do osTicket, importada antes do campo existir.
    url_externa: urlDoChamado(
      empresaId,
      (linha.external_id as string | null) ?? linha.ticket_id,
      (linha.source_system as string | null) ?? null,
    ),
  };
}

const CHAVE_URL_POR_SISTEMA: Record<string, string> = {
  OSTICK: 'url_helpdesk',
  BITRIX24: 'url_bitrix24',
};

/**
 * Endereço do chamado no sistema de origem. Sem base configurada não há link:
 * um endereço adivinhado levaria o gestor a uma página que não existe.
 */
export function urlDoChamado(
  empresaId: number,
  idExterno: string | number | null,
  sistema: string | null,
): string | null {
  if (idExterno === null || idExterno === undefined || idExterno === '') return null;
  const chave = CHAVE_URL_POR_SISTEMA[sistema ?? 'OSTICK'] ?? 'url_helpdesk';
  const linha = db()
    .prepare('SELECT valor FROM configuracoes WHERE empresa_id = ? AND chave = ?')
    .get(empresaId, chave) as { valor: string | null } | undefined;
  // Só o osTicket tem endereço padrão: é o helpdesk em uso hoje.
  const base = linha?.valor || (chave === 'url_helpdesk' ? URL_HELPDESK_PADRAO : null);
  return base ? base + encodeURIComponent(String(idExterno)) : null;
}

const SQL_BASE = `
  SELECT s.*, q.nome AS fila, ta.nome AS topico_ajuda, f.nome AS filial_nome
    FROM tickets_sla s
    JOIN filas_ticket q ON q.id = s.fila_id
    LEFT JOIN topicos_ajuda ta ON ta.id = s.topico_ajuda_id
    LEFT JOIN filiais f ON f.id = s.filial_id`;

export interface EntradaTicketSla {
  /** Matriz em que o chamado é registrado. Ausente: a matriz em foco. */
  empresaId?: number | null;
  filialId?: number | null;
  competencia: string;
  filaId: number;
  topicoAjudaId?: number | null;
  totalAtendidos: number;
  dentroSla: number;
  foraSla?: number | null;
  observacoes?: string | null;
  dedupHash?: string | null;
  // Detalhe do chamado: presente quando o registro veio do helpdesk.
  ticketId?: number | null;
  numero?: string | null;
  assunto?: string | null;
  solicitante?: string | null;
  responsavel?: string | null;
  nivel?: string | null;
  status?: string | null;
  origemChamado?: string | null;
  abertoEm?: string | null;
  fechadoEm?: string | null;
  prazoEm?: string | null;
  horas?: number | null;
}

/** Valores do detalhe do chamado, na ordem de CAMPOS_CHAMADO. */
function valoresDoChamado(e: Partial<EntradaTicketSla>): unknown[] {
  return [
    e.ticketId ?? null, e.numero ?? null, e.assunto ?? null, e.solicitante ?? null,
    e.responsavel ?? null, e.nivel ?? null, e.status ?? null, e.origemChamado ?? null,
    e.abertoEm ?? null, e.fechadoEm ?? null, e.prazoEm ?? null,
    e.horas === null || e.horas === undefined ? null : Number(e.horas),
  ];
}

function validarNumeros(entrada: EntradaTicketSla) {
  const total = Number(entrada.totalAtendidos);
  const dentro = Number(entrada.dentroSla);
  const fora = entrada.foraSla === null || entrada.foraSla === undefined ? total - dentro : Number(entrada.foraSla);
  for (const [rotulo, valor] of [['total atendidos', total], ['dentro do SLA', dentro], ['fora do SLA', fora]] as const) {
    if (!Number.isInteger(valor) || valor < 0) {
      throw erroValidacao(`O campo "${rotulo}" deve ser um inteiro maior ou igual a zero.`);
    }
  }
  if (dentro + fora !== total) {
    throw erroValidacao(
      `Inconsistência no registro de SLA: dentro (${dentro}) + fora (${fora}) deve totalizar ${total} atendidos.`,
    );
  }
  return { total, dentro, fora };
}

function garantirFila(empresaId: number, filaId: number) {
  const linha = db().prepare('SELECT id FROM filas_ticket WHERE id = ? AND empresa_id = ?').get(filaId, empresaId);
  if (!linha) throw erroValidacao(`Fila ${filaId} não pertence à empresa em contexto.`);
}

function garantirTopico(empresaId: number, topicoId: number | null | undefined): number | null {
  if (topicoId === null || topicoId === undefined) return null;
  const linha = db().prepare('SELECT id FROM topicos_ajuda WHERE id = ? AND empresa_id = ?').get(topicoId, empresaId);
  if (!linha) throw erroValidacao(`Tópico de ajuda ${topicoId} não pertence à empresa em contexto.`);
  return topicoId;
}

export function registrarTicketSla(ctx: Contexto, entrada: EntradaTicketSla) {
  const competencia = paraInterno(entrada.competencia);
  const empresaId = empresaDeEscrita(ctx, entrada.empresaId);
  const filialId = validarFilial(empresaId, entrada.filialId);
  garantirFila(empresaId, entrada.filaId);
  const topicoId = garantirTopico(empresaId, entrada.topicoAjudaId);
  const { total, dentro, fora } = validarNumeros(entrada);

  // O chamado é único por empresa. O banco já garante isso com um índice; aqui
  // a recusa vem com o motivo, em vez de um erro de restrição.
  if (entrada.ticketId !== null && entrada.ticketId !== undefined) {
    if (buscarPorTicketId(ctx, Number(entrada.ticketId), empresaId)) {
      throw erroValidacao(`O chamado ${entrada.ticketId} já está registrado nesta empresa.`);
    }
  }

  const info = db()
    .prepare(
      `INSERT INTO tickets_sla
         (empresa_id, filial_id, competencia, fila_id, topico_ajuda_id, total_atendidos, dentro_sla, fora_sla, observacoes, dedup_hash,
          ${CAMPOS_CHAMADO.join(', ')})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${CAMPOS_CHAMADO.map(() => '?').join(', ')})`,
    )
    .run(
      empresaId,
      filialId,
      competencia,
      entrada.filaId,
      topicoId,
      total,
      dentro,
      fora,
      entrada.observacoes ?? null,
      entrada.dedupHash ?? null,
      ...valoresDoChamado(entrada),
    );
  const id = Number(info.lastInsertRowid);
  auditar(ctx, {
    entidade: 'ticket_sla',
    entidadeId: id,
    acao: 'criar',
    depois: { competencia: paraExibicao(competencia), total, dentro, fora },
  });
  return obterTicketSla(ctx, id);
}

export function obterTicketSla(ctx: Contexto, id: number) {
  const escopo = escopoSql(ctx, null, 's.empresa_id');
  const linha = db()
    .prepare(`${SQL_BASE} WHERE s.id = ? AND ${escopo.sql} AND s.excluido_em IS NULL`)
    .get(id, ...escopo.params) as (LinhaTicket & Record<string, unknown>) | undefined;
  if (!linha) throw erroNaoEncontrado(`Registro de SLA ${id} não encontrado neste cliente.`);
  // O endereço do chamado sai da configuração da matriz DONA do registro: cada
  // unidade tem a própria instância do helpdesk.
  return apresentar(linha, linha.empresa_id);
}

/**
 * Registro do chamado `ticketId` nesta empresa, se existir. É o que permite
 * recarregar a mesma extração do helpdesk atualizando em vez de duplicar.
 */
export function buscarPorTicketId(ctx: Contexto, ticketId: number, empresaId?: number) {
  // A busca é por MATRIZ, não pelo cliente: cada unidade tem a própria
  // instância do helpdesk, e o chamado 4812 de uma não é o 4812 da outra.
  return db()
    .prepare('SELECT id FROM tickets_sla WHERE empresa_id = ? AND ticket_id = ? AND excluido_em IS NULL')
    .get(empresaId ?? ctx.empresaId, ticketId) as { id: number } | undefined;
}

export interface FiltroSla {
  /** Filtro local de matriz. Vazio: o cliente inteiro. */
  empresas?: number[];
  filialId?: number | null;
  filaId?: number;
  topicoAjudaId?: number | null;
  competencia?: string;
  competenciaInicio?: string;
  competenciaFim?: string;
  /** 'dentro' | 'fora' — o recorte que os gráficos de conformidade usam. */
  sla?: string;
}

export function montarFiltroSla(ctx: Contexto, filtro: FiltroSla) {
  const escopo = escopoSql(ctx, filtro.empresas, 's.empresa_id');
  const condicoes = [escopo.sql, 's.excluido_em IS NULL'];
  const params: unknown[] = [...escopo.params];
  if (filtro.filialId === null) condicoes.push('s.filial_id IS NULL');
  else if (filtro.filialId !== undefined) {
    condicoes.push('s.filial_id = ?');
    params.push(filtro.filialId);
  }
  if (filtro.filaId !== undefined) {
    condicoes.push('s.fila_id = ?');
    params.push(filtro.filaId);
  }
  if (filtro.topicoAjudaId === null) condicoes.push('s.topico_ajuda_id IS NULL');
  else if (filtro.topicoAjudaId !== undefined) {
    condicoes.push('s.topico_ajuda_id = ?');
    params.push(filtro.topicoAjudaId);
  }
  if (filtro.sla === 'dentro') condicoes.push('s.dentro_sla >= s.total_atendidos');
  else if (filtro.sla === 'fora') condicoes.push('s.dentro_sla < s.total_atendidos');
  if (filtro.competencia) {
    condicoes.push('s.competencia = ?');
    params.push(paraInterno(filtro.competencia));
  }
  if (filtro.competenciaInicio) {
    condicoes.push('s.competencia >= ?');
    params.push(paraInterno(filtro.competenciaInicio));
  }
  if (filtro.competenciaFim) {
    condicoes.push('s.competencia <= ?');
    params.push(paraInterno(filtro.competenciaFim));
  }
  return { where: condicoes.join(' AND '), params };
}

export function listarTicketsSla(ctx: Contexto, filtro: FiltroSla = {}) {
  const { where, params } = montarFiltroSla(ctx, filtro);
  const linhas = db()
    .prepare(`${SQL_BASE} WHERE ${where} ORDER BY s.competencia DESC, q.ordem, ta.nome`)
    .all(...params) as Array<LinhaTicket & Record<string, unknown>>;
  const itens = linhas.map((l) => apresentar(l, l.empresa_id));
  const total = itens.reduce((s, i) => s + i.total_atendidos, 0);
  const dentro = itens.reduce((s, i) => s + i.dentro_sla, 0);
  return {
    itens,
    resumo: {
      total_atendidos: total,
      dentro_sla: dentro,
      fora_sla: total - dentro,
      pct_dentro_sla: percentual(dentro, total),
      pct_fora_sla: percentual(total - dentro, total),
    },
  };
}

export function atualizarTicketSla(
  ctx: Contexto,
  id: number,
  dados: Partial<EntradaTicketSla> & { justificativa?: string },
) {
  const escopo = escopoSql(ctx);
  const antes = db()
    .prepare(`SELECT * FROM tickets_sla WHERE id = ? AND ${escopo.sql} AND excluido_em IS NULL`)
    .get(id, ...escopo.params) as LinhaTicket | undefined;
  if (!antes) throw erroNaoEncontrado(`Registro de SLA ${id} não encontrado neste cliente.`);
  // Fila, filial e tópico são da matriz DO REGISTRO, não da que está em foco.
  const empresaDoRegistro = antes.empresa_id;

  const competencia = dados.competencia ? paraInterno(dados.competencia) : antes.competencia;
  const filialId = dados.filialId !== undefined ? validarFilial(empresaDoRegistro, dados.filialId) : antes.filial_id;
  const filaId = dados.filaId ?? antes.fila_id;
  garantirFila(empresaDoRegistro, filaId);
  const topicoId =
    dados.topicoAjudaId !== undefined ? garantirTopico(empresaDoRegistro, dados.topicoAjudaId) : antes.topico_ajuda_id;

  const { total, dentro, fora } = validarNumeros({
    competencia: paraExibicao(competencia),
    filaId,
    totalAtendidos: dados.totalAtendidos ?? antes.total_atendidos,
    dentroSla: dados.dentroSla ?? antes.dentro_sla,
    foraSla: dados.foraSla !== undefined ? dados.foraSla : dados.totalAtendidos !== undefined || dados.dentroSla !== undefined ? null : antes.fora_sla,
  });

  // Campo do detalhe não enviado permanece como está: editar o total de um
  // chamado não pode apagar o assunto nem o link de volta ao helpdesk.
  const chamado: Partial<EntradaTicketSla> = {
    ticketId: dados.ticketId !== undefined ? dados.ticketId : antes.ticket_id,
    numero: dados.numero !== undefined ? dados.numero : antes.numero,
    assunto: dados.assunto !== undefined ? dados.assunto : antes.assunto,
    solicitante: dados.solicitante !== undefined ? dados.solicitante : antes.solicitante,
    responsavel: dados.responsavel !== undefined ? dados.responsavel : antes.responsavel,
    nivel: dados.nivel !== undefined ? dados.nivel : antes.nivel,
    status: dados.status !== undefined ? dados.status : antes.status,
    origemChamado: dados.origemChamado !== undefined ? dados.origemChamado : antes.origem_chamado,
    abertoEm: dados.abertoEm !== undefined ? dados.abertoEm : antes.aberto_em,
    fechadoEm: dados.fechadoEm !== undefined ? dados.fechadoEm : antes.fechado_em,
    prazoEm: dados.prazoEm !== undefined ? dados.prazoEm : antes.prazo_em,
    horas: dados.horas !== undefined ? dados.horas : antes.horas,
  };

  db()
    .prepare(
      `UPDATE tickets_sla SET filial_id = ?, competencia = ?, fila_id = ?, topico_ajuda_id = ?,
              total_atendidos = ?, dentro_sla = ?, fora_sla = ?, observacoes = ?,
              ${CAMPOS_CHAMADO.map((c) => `${c} = ?`).join(', ')},
              atualizado_em = datetime('now')
        WHERE id = ? AND empresa_id = ?`,
    )
    .run(
      filialId,
      competencia,
      filaId,
      topicoId,
      total,
      dentro,
      fora,
      dados.observacoes !== undefined ? dados.observacoes : antes.observacoes,
      ...valoresDoChamado(chamado),
      id,
      empresaDoRegistro,
    );
  const depois = obterTicketSla(ctx, id);
  auditar(ctx, {
    entidade: 'ticket_sla',
    entidadeId: id,
    acao: 'atualizar',
    justificativa: dados.justificativa ?? null,
    antes,
    depois,
  });
  return depois;
}

export function excluirTicketSla(ctx: Contexto, id: number, justificativa?: string) {
  const escopo = escopoSql(ctx);
  const antes = db()
    .prepare(`SELECT * FROM tickets_sla WHERE id = ? AND ${escopo.sql} AND excluido_em IS NULL`)
    .get(id, ...escopo.params) as LinhaTicket | undefined;
  if (!antes) throw erroNaoEncontrado(`Registro de SLA ${id} não encontrado neste cliente.`);
  db().prepare(`UPDATE tickets_sla SET excluido_em = datetime('now'), dedup_hash = NULL WHERE id = ?`).run(id);
  auditar(ctx, { entidade: 'ticket_sla', entidadeId: id, acao: 'excluir', justificativa: justificativa ?? null, antes });
  return { excluido: true };
}


/** Endereço base do helpdesk de origem: o id do chamado completa a URL. */
export const URL_HELPDESK_PADRAO = 'https://www.suportehr.com.br/scp/tickets.php?id=';

const CHAVE_URL = 'url_helpdesk';

export function lerConfiguracao(ctx: Contexto) {
  const linha = db()
    .prepare('SELECT valor FROM configuracoes WHERE empresa_id = ? AND chave = ?')
    .get(ctx.empresaId, CHAVE_URL) as { valor: string | null } | undefined;
  return { url_helpdesk: linha?.valor || URL_HELPDESK_PADRAO };
}

export function gravarUrlHelpdesk(ctx: Contexto, url: string | null) {
  const valor = (url ?? '').trim();
  if (valor && !/^https?:\/\//i.test(valor)) {
    throw erroValidacao('O endereço do helpdesk precisa começar com http:// ou https://.');
  }
  db()
    .prepare(
      `INSERT INTO configuracoes (empresa_id, chave, valor) VALUES (?, ?, ?)
         ON CONFLICT(empresa_id, chave) DO UPDATE SET valor = excluded.valor`,
    )
    .run(ctx.empresaId, CHAVE_URL, valor || null);
  auditar(ctx, {
    entidade: 'configuracao',
    entidadeId: 0,
    acao: 'atualizar',
    depois: { chave: CHAVE_URL, valor: valor || null },
  });
  return lerConfiguracao(ctx);
}
