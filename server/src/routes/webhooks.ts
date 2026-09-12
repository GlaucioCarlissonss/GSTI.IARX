/**
 * Webhooks dos sistemas de suporte (N8N → SaaS).
 *
 * Ficam fora do router protegido por sessão: quem chama é uma automação, não
 * um usuário logado. A autenticação é um segredo compartilhado em header, e o
 * segredo vem de variável de ambiente — nunca do código.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import express from 'express';
import { db, emTransacao } from '../db/index.js';
import { erroValidacao } from '../lib/erros.js';
import {
  gravarChamado,
  LIMITE_PAYLOAD_BYTES,
  normalizar,
  type SistemaOrigem,
} from '../domain/suporte.js';
import { SETOR_NAO_CLASSIFICADO } from '../domain/cadastros.js';

export const rotasWebhooks = Router();

/** Corpo maior que isto é recusado antes de ser interpretado. */
rotasWebhooks.use(express.json({ limit: LIMITE_PAYLOAD_BYTES }));

// ------------------------------------------------------------- autenticação

const SEGREDO = () => process.env.WEBHOOK_SECRET ?? '';

/**
 * Comparação em tempo constante. Um `===` vaza o tamanho do prefixo correto
 * pelo tempo de resposta, e o segredo é justamente o que protege o endpoint.
 */
function segredoConfere(recebido: string, esperado: string): boolean {
  if (recebido.length !== esperado.length) return false;
  let diferenca = 0;
  for (let i = 0; i < recebido.length; i++) diferenca |= recebido.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diferenca === 0;
}

function autenticarWebhook(req: Request, res: Response, proximo: NextFunction) {
  const esperado = SEGREDO();
  if (!esperado) {
    // Sem segredo configurado o endpoint fica fechado, não aberto: um deploy
    // que esqueceu a variável não pode virar uma porta sem tranca.
    registrar(req, 503, 'WEBHOOK_SECRET não configurado no servidor');
    res.status(503).json({ erro: 'Integração de webhooks indisponível.' });
    return;
  }
  const recebido = String(req.header('X-Webhook-Secret') ?? '');
  if (!segredoConfere(recebido, esperado)) {
    registrar(req, 401, recebido ? 'segredo incorreto' : 'segredo ausente');
    res.status(401).json({ erro: 'Autenticação do webhook inválida.' });
    return;
  }
  proximo();
}

// -------------------------------------------------------------- rate limiting

/**
 * Janela deslizante simples, em memória. Protege contra reentrega em laço e
 * contra abuso trivial; não substitui um limitador de borda, e o processo é
 * único por instância — está dito aqui para não parecer o que não é.
 */
const JANELA_MS = 60_000;
const TETO_POR_JANELA = Number(process.env.WEBHOOK_RATE_LIMIT ?? 600);
const historico = new Map<string, number[]>();

function limitarTaxa(req: Request, res: Response, proximo: NextFunction) {
  const chave = req.ip ?? 'desconhecido';
  const agora = Date.now();
  const recentes = (historico.get(chave) ?? []).filter((t) => agora - t < JANELA_MS);
  if (recentes.length >= TETO_POR_JANELA) {
    historico.set(chave, recentes);
    registrar(req, 429, `acima de ${TETO_POR_JANELA} chamadas por minuto`);
    res.status(429).json({ erro: 'Muitas requisições. Tente novamente em instantes.' });
    return;
  }
  recentes.push(agora);
  historico.set(chave, recentes);
  proximo();
}

// ------------------------------------------------------------ observabilidade

/** Log estruturado de cada recebimento: uma linha JSON por requisição. */
function registrar(req: Request, status: number, detalhe?: string, extra: Record<string, unknown> = {}) {
  const linha = {
    evento: 'webhook',
    rota: req.path,
    metodo: req.method,
    status,
    ip: req.ip,
    em: new Date().toISOString(),
    ...(detalhe ? { detalhe } : null),
    ...extra,
  };
  // stderr para erro, stdout para o resto: é o que um coletor de logs espera.
  (status >= 400 ? console.error : console.log)(JSON.stringify(linha));
}

// ------------------------------------------------------------------ recepção

/**
 * A empresa vem do header `X-Empresa-Id`, como no resto da API. Num sistema
 * multi-tenant o chamado precisa saber a quem pertence, e a automação é quem
 * sabe: adivinhar pelo conteúdo criaria vazamento entre empresas.
 */
function empresaDaRequisicao(req: Request): number {
  const bruto = req.header('X-Empresa-Id') ?? (req.body as Record<string, unknown>)?.empresa_id;
  const id = Number(bruto);
  if (!Number.isInteger(id) || id <= 0) {
    throw erroValidacao('Informe a empresa em "X-Empresa-Id" (ou "empresa_id" no corpo).');
  }
  const existe = db().prepare('SELECT id FROM empresas WHERE id = ? AND status = ?').get(id, 'ativa');
  if (!existe) throw erroValidacao(`Empresa ${id} não encontrada ou inativa.`);
  return id;
}

/**
 * Um recebimento aceita tanto um chamado quanto um lote — o N8N envia dos dois
 * jeitos, e recusar o lote obrigaria a automação a fazer uma chamada por
 * chamado.
 */
function chamadosDoCorpo(corpo: unknown): Record<string, unknown>[] {
  if (Array.isArray(corpo)) return corpo as Record<string, unknown>[];
  const obj = (corpo ?? {}) as Record<string, unknown>;
  for (const chave of ['tickets', 'chamados', 'items', 'data']) {
    if (Array.isArray(obj[chave])) return obj[chave] as Record<string, unknown>[];
  }
  return [obj];
}

function receber(sistema: SistemaOrigem) {
  return (req: Request, res: Response) => {
    let empresaId: number;
    try {
      empresaId = empresaDaRequisicao(req);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      registrar(req, 422, mensagem, { sistema });
      res.status(422).json({ erro: mensagem });
      return;
    }

    const entrada = chamadosDoCorpo(req.body);
    if (!entrada.length) {
      registrar(req, 422, 'corpo sem nenhum chamado', { sistema });
      res.status(422).json({ erro: 'Nenhum chamado no corpo da requisição.' });
      return;
    }

    const aceitos: Array<{ external_id: string; ticket_id: number; criado: boolean }> = [];
    const recusados: Array<{ indice: number; external_id: string | null; motivo: string }> = [];
    const semSetor: string[] = [];

    // Uma transação por lote: ou o lote inteiro entra, ou nada entra pela
    // metade. A linha inválida não derruba as boas — ela vai para o relatório.
    emTransacao(() => {
      entrada.forEach((bruto, indice) => {
        try {
          const chamado = normalizar(sistema, bruto);
          const gravado = gravarChamado(empresaId, chamado, bruto);
          if (gravado.setor === SETOR_NAO_CLASSIFICADO) semSetor.push(chamado.external_id);
          aceitos.push({ external_id: chamado.external_id, ticket_id: gravado.ticket_id, criado: gravado.criado });
        } catch (erro) {
          recusados.push({
            indice,
            external_id: (bruto?.external_id ?? bruto?.ticket_id ?? bruto?.ID ?? null) as string | null,
            motivo: erro instanceof Error ? erro.message : String(erro),
          });
        }
      });
    });

    if (semSetor.length) {
      // Setor ausente não recusa o chamado — ele entra como "Não classificado"
      // e fica registrado aqui para revisão.
      registrar(req, 200, 'chamados sem setor identificado', { sistema, empresa_id: empresaId, external_ids: semSetor });
    }

    // Nenhum aceito é falha do lote inteiro; algum aceito é sucesso com
    // relatório, que é o que permite a automação seguir e corrigir depois.
    if (!aceitos.length) {
      registrar(req, 422, 'nenhum chamado válido', { sistema, empresa_id: empresaId, recusados });
      res.status(422).json({ received: false, erro: 'Nenhum chamado válido no payload.', recusados });
      return;
    }

    registrar(req, 200, undefined, {
      sistema,
      empresa_id: empresaId,
      recebidos: entrada.length,
      criados: aceitos.filter((a) => a.criado).length,
      atualizados: aceitos.filter((a) => !a.criado).length,
      recusados: recusados.length,
    });
    res.status(200).json({
      received: true,
      // Um chamado devolve `ticket_id` direto, como o contrato pede; o lote
      // devolve a lista, para a automação casar cada linha com o seu registro.
      ticket_id: aceitos[0]!.ticket_id,
      tickets: aceitos,
      ...(recusados.length ? { recusados } : null),
    });
  };
}

rotasWebhooks.post('/ostick/tickets', limitarTaxa, autenticarWebhook, receber('OSTICK'));
rotasWebhooks.post('/bitrix24/tickets', limitarTaxa, autenticarWebhook, receber('BITRIX24'));
