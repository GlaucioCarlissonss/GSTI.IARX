/**
 * Integrações com os sistemas de suporte (N8N → SaaS).
 *
 * Duas coisas moram aqui: a CONFIGURAÇÃO de cada conexão — endereço, segredo,
 * ligada ou não — e o LOG DE EVENTOS, que guarda o payload como chegou.
 *
 * O log não é enfeite: é o que permite diagnosticar uma falha sem depender de
 * a origem reenviar, e reprocessar o que falhou. Sem ele, um erro de
 * normalização significaria pedir ao operador do N8N que rodasse tudo de novo.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from '../db/index.js';
import { erroValidacao } from '../lib/erros.js';
import type { Contexto } from './contexto.js';
import { gravarChamado, normalizar, type SistemaOrigem } from './suporte.js';
import { SETOR_NAO_CLASSIFICADO } from './cadastros.js';

export const SISTEMAS: SistemaOrigem[] = ['OSTICK', 'BITRIX24'];

export type StatusEvento = 'received' | 'processed' | 'error';
export type TipoEvento = 'ticket.created' | 'ticket.updated' | 'ticket.test';

/** Caminho público do webhook de cada origem. */
export const caminhoDoWebhook = (sistema: SistemaOrigem) =>
  `/api/webhooks/${sistema === 'BITRIX24' ? 'bitrix24' : 'ostick'}/tickets`;

// ---------------------------------------------------------------- o segredo

/**
 * O segredo é guardado como hash, e não em texto: quem tem o banco não tem a
 * chave. O valor em claro aparece uma única vez, quando é gerado — é o mesmo
 * trato de uma chave de API.
 */
const hashDoSegredo = (valor: string) => createHash('sha256').update(valor, 'utf8').digest('hex');

/** Comparação em tempo constante: um `===` vaza o prefixo correto pelo tempo. */
export function segredoConfere(recebido: string, hashEsperado: string): boolean {
  const a = Buffer.from(hashDoSegredo(recebido), 'hex');
  const b = Buffer.from(hashEsperado, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Segredo novo, em claro. Quem chamar é responsável por mostrá-lo uma vez. */
export const gerarSegredo = () => randomBytes(24).toString('base64url');

// ------------------------------------------------------------ configuração

interface LinhaConfig {
  id: number;
  empresa_id: number;
  source_system: SistemaOrigem;
  webhook_path: string;
  secret_hash: string | null;
  ativo: number;
  ultimo_evento_em: string | null;
  ultimo_erro: string | null;
  criado_em: string;
  atualizado_em: string;
}

function apresentarConfig(linha: LinhaConfig) {
  return {
    id: linha.id,
    source_system: linha.source_system,
    webhook_path: linha.webhook_path,
    // Nunca o segredo, nem o hash: só se ele existe. O valor em claro vai
    // apenas na resposta de quem acabou de gerá-lo.
    tem_segredo: !!linha.secret_hash,
    ativo: linha.ativo === 1,
    ultimo_evento_em: linha.ultimo_evento_em,
    ultimo_erro: linha.ultimo_erro,
    criado_em: linha.criado_em,
    atualizado_em: linha.atualizado_em,
  };
}

/** Garante a linha de configuração de cada origem, criando o que faltar. */
function garantirConfigs(empresaId: number) {
  const inserir = db().prepare(
    `INSERT OR IGNORE INTO integracao_config (empresa_id, source_system, webhook_path)
       VALUES (?, ?, ?)`,
  );
  for (const s of SISTEMAS) inserir.run(empresaId, s, caminhoDoWebhook(s));
}

export function listarIntegracoes(ctx: Contexto) {
  garantirConfigs(ctx.empresaId);
  const linhas = db()
    .prepare('SELECT * FROM integracao_config WHERE empresa_id = ? ORDER BY source_system')
    .all(ctx.empresaId) as LinhaConfig[];
  return linhas.map(apresentarConfig);
}

function obterConfig(empresaId: number, sistema: SistemaOrigem): LinhaConfig {
  garantirConfigs(empresaId);
  const linha = db()
    .prepare('SELECT * FROM integracao_config WHERE empresa_id = ? AND source_system = ?')
    .get(empresaId, sistema) as LinhaConfig | undefined;
  if (!linha) throw erroValidacao(`Integração ${sistema} não encontrada nesta empresa.`);
  return linha;
}

/**
 * Gira o segredo e devolve o valor em claro — a ÚNICA vez em que ele existe
 * fora do N8N. A rotação não derruba nada: o segredo anterior deixa de valer
 * no instante da troca, e o operador cola o novo no workflow.
 */
export function regenerarSegredo(ctx: Contexto, sistema: SistemaOrigem) {
  obterConfig(ctx.empresaId, sistema);
  const segredo = gerarSegredo();
  db()
    .prepare(
      `UPDATE integracao_config SET secret_hash = ?, atualizado_em = datetime('now')
        WHERE empresa_id = ? AND source_system = ?`,
    )
    .run(hashDoSegredo(segredo), ctx.empresaId, sistema);
  return { source_system: sistema, segredo, webhook_path: caminhoDoWebhook(sistema) };
}

export function definirAtivo(ctx: Contexto, sistema: SistemaOrigem, ativo: boolean) {
  obterConfig(ctx.empresaId, sistema);
  db()
    .prepare(
      `UPDATE integracao_config SET ativo = ?, atualizado_em = datetime('now')
        WHERE empresa_id = ? AND source_system = ?`,
    )
    .run(ativo ? 1 : 0, ctx.empresaId, sistema);
  return apresentarConfig(obterConfig(ctx.empresaId, sistema));
}

/**
 * Autoriza um recebimento. Devolve o motivo da recusa em vez de lançar: quem
 * chama precisa distinguir 401 (segredo errado) de 503 (sem segredo algum) e
 * de 403 (conexão desligada de propósito).
 */
export function autorizarRecebimento(
  empresaId: number,
  sistema: SistemaOrigem,
  segredoRecebido: string,
): { ok: true } | { ok: false; status: 401 | 403 | 503; motivo: string } {
  const config = obterConfig(empresaId, sistema);
  if (!config.ativo) {
    return { ok: false, status: 403, motivo: 'Integração desativada para este sistema.' };
  }

  // Sem segredo por empresa, vale o da variável de ambiente — é o que sustenta
  // uma instalação de um tenant só, sem passar pela tela de integrações.
  const doAmbiente = process.env.WEBHOOK_SECRET ?? '';
  const esperado = config.secret_hash ?? (doAmbiente ? hashDoSegredo(doAmbiente) : null);
  if (!esperado) {
    // Sem segredo configurado o endpoint fica fechado, não aberto: um deploy
    // que esqueceu a variável não pode virar uma porta sem tranca.
    return { ok: false, status: 503, motivo: 'Nenhum segredo configurado para esta integração.' };
  }
  if (!segredoRecebido || !segredoConfere(segredoRecebido, esperado)) {
    return { ok: false, status: 401, motivo: segredoRecebido ? 'segredo incorreto' : 'segredo ausente' };
  }
  return { ok: true };
}

// -------------------------------------------------------------- log de eventos

interface LinhaEvento {
  id: number;
  empresa_id: number;
  source_system: SistemaOrigem;
  external_id: string | null;
  tipo: TipoEvento;
  payload: string;
  status: StatusEvento;
  erro: string | null;
  ticket_id: number | null;
  teste: number;
  criado_em: string;
  processado_em: string | null;
}

function apresentarEvento(linha: LinhaEvento) {
  let payload: unknown = null;
  try {
    payload = JSON.parse(linha.payload);
  } catch {
    // Payload ilegível não derruba a tela: o texto bruto ainda serve.
    payload = linha.payload;
  }
  return {
    id: linha.id,
    source_system: linha.source_system,
    external_id: linha.external_id,
    tipo: linha.tipo,
    status: linha.status,
    erro: linha.erro,
    ticket_id: linha.ticket_id,
    teste: linha.teste === 1,
    criado_em: linha.criado_em,
    processado_em: linha.processado_em,
    payload,
  };
}

/** Passo 1 do pipeline: o payload entra no log ANTES de ser interpretado. */
export function registrarEvento(entrada: {
  empresaId: number;
  sistema: SistemaOrigem;
  externalId: string | null;
  tipo: TipoEvento;
  payload: unknown;
  teste?: boolean;
}): number {
  const bruto = JSON.stringify(entrada.payload ?? null);
  const info = db()
    .prepare(
      `INSERT INTO integracao_evento (empresa_id, source_system, external_id, tipo, payload, status, teste)
         VALUES (?, ?, ?, ?, ?, 'received', ?)`,
    )
    .run(entrada.empresaId, entrada.sistema, entrada.externalId, entrada.tipo, bruto, entrada.teste ? 1 : 0);
  return Number(info.lastInsertRowid);
}

/** Passo 5: fecha o evento e atualiza a configuração da origem. */
export function concluirEvento(
  eventoId: number,
  resultado: { ok: true; ticketId: number } | { ok: false; erro: string },
) {
  const linha = db().prepare('SELECT * FROM integracao_evento WHERE id = ?').get(eventoId) as
    | LinhaEvento
    | undefined;
  if (!linha) return;

  db()
    .prepare(
      `UPDATE integracao_evento
          SET status = ?, erro = ?, ticket_id = ?, processado_em = datetime('now')
        WHERE id = ?`,
    )
    .run(
      resultado.ok ? 'processed' : 'error',
      resultado.ok ? null : resultado.erro.slice(0, 500),
      resultado.ok ? resultado.ticketId : null,
      eventoId,
    );

  // A linha de configuração pode ainda não existir — um payload de teste ou um
  // webhook podem chegar antes de alguém abrir a tela de Integrações. Sem isto,
  // o "último evento" ficaria vazio para sempre nesses casos.
  garantirConfigs(linha.empresa_id);
  db()
    .prepare(
      `UPDATE integracao_config
          SET ultimo_evento_em = datetime('now'), ultimo_erro = ?, atualizado_em = datetime('now')
        WHERE empresa_id = ? AND source_system = ?`,
    )
    .run(resultado.ok ? null : resultado.erro.slice(0, 500), linha.empresa_id, linha.source_system);
}

export interface FiltroEventos {
  sistemas?: SistemaOrigem[];
  status?: StatusEvento[];
  de?: string;
  ate?: string;
  limite?: number;
}

export function listarEventos(ctx: Contexto, filtro: FiltroEventos = {}) {
  const condicoes = ['empresa_id = ?'];
  const params: unknown[] = [ctx.empresaId];
  const emLista = (coluna: string, valores?: string[]) => {
    if (!valores?.length) return;
    condicoes.push(`${coluna} IN (${valores.map(() => '?').join(',')})`);
    params.push(...valores);
  };
  emLista('source_system', filtro.sistemas);
  emLista('status', filtro.status);
  if (filtro.de) {
    condicoes.push('criado_em >= ?');
    params.push(filtro.de);
  }
  if (filtro.ate) {
    // Data sem hora cobre o dia inteiro: quem filtra "até 12/09" espera que o
    // evento das 18h daquele dia entre.
    condicoes.push('criado_em <= ?');
    params.push(filtro.ate.length === 10 ? `${filtro.ate} 23:59:59` : filtro.ate);
  }
  const limite = Math.min(Math.max(filtro.limite ?? 100, 1), 500);
  const linhas = db()
    .prepare(
      `SELECT * FROM integracao_evento WHERE ${condicoes.join(' AND ')}
        ORDER BY criado_em DESC, id DESC LIMIT ?`,
    )
    .all(...params, limite) as LinhaEvento[];

  const resumo = db()
    .prepare(
      `SELECT status, COUNT(*) AS n FROM integracao_evento WHERE empresa_id = ? GROUP BY status`,
    )
    .all(ctx.empresaId) as Array<{ status: StatusEvento; n: number }>;

  return {
    itens: linhas.map(apresentarEvento),
    resumo: {
      received: resumo.find((r) => r.status === 'received')?.n ?? 0,
      processed: resumo.find((r) => r.status === 'processed')?.n ?? 0,
      error: resumo.find((r) => r.status === 'error')?.n ?? 0,
    },
  };
}

/**
 * Processa um payload já recebido: normaliza, grava o chamado e fecha o
 * evento. É o miolo compartilhado pelo webhook, pelo payload de teste e pelo
 * reprocessamento — os três precisam seguir exatamente o mesmo caminho, ou o
 * teste deixaria de provar o que a produção faz.
 */
export function processarEvento(
  empresaId: number,
  sistema: SistemaOrigem,
  bruto: Record<string, unknown>,
  eventoId: number,
): { ok: true; ticketId: number; criado: boolean; setor: string } | { ok: false; erro: string } {
  try {
    const chamado = normalizar(sistema, bruto);
    const gravado = gravarChamado(empresaId, chamado, bruto);
    concluirEvento(eventoId, { ok: true, ticketId: gravado.ticket_id });
    return { ok: true, ticketId: gravado.ticket_id, criado: gravado.criado, setor: gravado.setor };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    concluirEvento(eventoId, { ok: false, erro: mensagem });
    return { ok: false, erro: mensagem };
  }
}

/** Refaz o processamento de um evento com erro, a partir do payload guardado. */
export function reprocessarEvento(ctx: Contexto, eventoId: number) {
  const linha = db()
    .prepare('SELECT * FROM integracao_evento WHERE id = ? AND empresa_id = ?')
    .get(eventoId, ctx.empresaId) as LinhaEvento | undefined;
  if (!linha) throw erroValidacao(`Evento ${eventoId} não encontrado nesta empresa.`);
  if (linha.status === 'processed') {
    throw erroValidacao('Este evento já foi processado com sucesso. Não há o que refazer.');
  }

  let bruto: Record<string, unknown>;
  try {
    bruto = JSON.parse(linha.payload) as Record<string, unknown>;
  } catch {
    throw erroValidacao('O payload guardado não é um JSON legível; não há como reprocessar.');
  }

  const r = processarEvento(ctx.empresaId, linha.source_system, bruto, eventoId);
  if (!r.ok) throw erroValidacao(r.erro);
  return { evento_id: eventoId, ticket_id: r.ticketId, criado: r.criado, setor: r.setor };
}

/**
 * Payload de exemplo de cada origem, com os nomes de campo que o sistema de
 * verdade usa. O chamado de teste entra marcado como tal, para dar para achá-lo
 * e apagá-lo depois sem caçar por assunto.
 */
export function payloadDeTeste(sistema: SistemaOrigem): Record<string, unknown> {
  const agora = new Date().toISOString();
  const marca = Date.now().toString().slice(-6);
  return sistema === 'BITRIX24'
    ? {
        ID: `TESTE-${marca}`,
        TITLE: 'Chamado de teste da integração',
        COMMENTS: 'Disparado pela tela de Integrações para validar o fluxo ponta a ponta.',
        STAGE_ID: 'NEW',
        PRIORITY: '1',
        UF_DEPARTMENT: 'Tecnologia da Informação',
        ASSIGNED_BY_NAME: 'Integração',
        CONTACT_NAME: 'Teste',
        CONTACT_EMAIL: 'teste@exemplo.local',
        CREATED_TIME: agora,
      }
    : {
        ticket_id: `TESTE-${marca}`,
        number: `TESTE-${marca}`,
        subject: 'Chamado de teste da integração',
        body: 'Disparado pela tela de Integrações para validar o fluxo ponta a ponta.',
        status: 'open',
        priority: 'Normal',
        department: 'Tecnologia da Informação',
        staff: 'Integração',
        name: 'Teste',
        email: 'teste@exemplo.local',
        created: agora,
      };
}

/** Dispara o payload de exemplo pelo mesmo pipeline do webhook. */
export function enviarPayloadDeTeste(ctx: Contexto, sistema: SistemaOrigem) {
  const bruto = payloadDeTeste(sistema);
  const eventoId = registrarEvento({
    empresaId: ctx.empresaId,
    sistema,
    externalId: String(bruto.ticket_id ?? bruto.ID ?? ''),
    tipo: 'ticket.test',
    payload: bruto,
    teste: true,
  });
  const r = processarEvento(ctx.empresaId, sistema, bruto, eventoId);
  if (!r.ok) throw erroValidacao(r.erro);
  return {
    evento_id: eventoId,
    ticket_id: r.ticketId,
    external_id: String(bruto.ticket_id ?? bruto.ID ?? ''),
    setor: r.setor,
    sem_setor: r.setor === SETOR_NAO_CLASSIFICADO,
  };
}
