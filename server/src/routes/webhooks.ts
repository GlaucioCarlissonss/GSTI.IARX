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
import { LIMITE_PAYLOAD_BYTES, type SistemaOrigem } from '../domain/suporte.js';
import { SETOR_NAO_CLASSIFICADO } from '../domain/cadastros.js';
import { autorizarRecebimento, processarEvento, registrarEvento } from '../domain/integracoes.js';

export const rotasWebhooks = Router();

/** Corpo maior que isto é recusado antes de ser interpretado. */
rotasWebhooks.use(express.json({ limit: LIMITE_PAYLOAD_BYTES }));

// ------------------------------------------------------------- autenticação

/**
 * A autorização é por CLIENTE e por origem: quem contrata o helpdesk é o
 * contratante, e o segredo e o interruptor são dele. O destino continua sendo
 * uma matriz — cada unidade tem a própria instância, e o chamado 4812 de uma
 * não é o 4812 da outra. O da variável de ambiente vale como reserva para a
 * instalação de um tenant só. A comparação, e a decisão entre 401, 403 e 503,
 * moram no domínio — aqui fica só o que é de HTTP.
 */
function autenticarWebhook(sistema: SistemaOrigem) {
  return (req: Request, res: Response, proximo: NextFunction) => {
    let destino: { empresaId: number; clienteId: number };
    try {
      destino = destinoDaRequisicao(req);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      registrar(req, 422, mensagem, { sistema });
      res.status(422).json({ erro: mensagem });
      return;
    }
    const { empresaId, clienteId } = destino;

    const veredito = autorizarRecebimento(clienteId, sistema, String(req.header('X-Webhook-Secret') ?? ''));
    if (!veredito.ok) {
      registrar(req, veredito.status, veredito.motivo, { sistema, empresa_id: empresaId, cliente_id: clienteId });
      const publico =
        veredito.status === 503
          ? 'Integração de webhooks indisponível.'
          : veredito.status === 403
            ? 'Integração desativada para este sistema.'
            : 'Autenticação do webhook inválida.';
      res.status(veredito.status).json({ erro: publico });
      return;
    }

    // A empresa já está resolvida e autorizada: quem recebe não repete o trabalho.
    (req as Request & { empresaId?: number }).empresaId = empresaId;
    proximo();
  };
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
 * A quem o chamado pertence: a unidade de destino e o cliente dono da conexão.
 *
 * A automação informa a unidade em `X-Empresa-Id`, como sempre. Com o cliente
 * em `X-Cliente-Id`, a unidade passa a ser opcional: um contratante de matriz
 * única não precisa saber o id dela para mandar um chamado — e com mais de uma,
 * a escolha continua obrigatória, porque adivinhar pelo conteúdo misturaria
 * chamados de unidades diferentes em silêncio.
 */
function destinoDaRequisicao(req: Request): { empresaId: number; clienteId: number } {
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const brutoEmpresa = req.header('X-Empresa-Id') ?? corpo.empresa_id;
  const brutoCliente = req.header('X-Cliente-Id') ?? corpo.cliente_id;

  if (brutoEmpresa !== undefined && brutoEmpresa !== null && brutoEmpresa !== '') {
    const id = Number(brutoEmpresa);
    if (!Number.isInteger(id) || id <= 0) {
      throw erroValidacao('Informe a empresa em "X-Empresa-Id" (ou "empresa_id" no corpo).');
    }
    const linha = db()
      .prepare('SELECT id, cliente_id FROM empresas WHERE id = ? AND status = ?')
      .get(id, 'ativa') as { id: number; cliente_id: number | null } | undefined;
    if (!linha) throw erroValidacao(`Empresa ${id} não encontrada ou inativa.`);
    if (!linha.cliente_id) throw erroValidacao(`Empresa ${id} ainda não pertence a um cliente.`);
    // Os dois informados e discordando: recusa. A divergência é justamente o
    // que um pedido forjado produziria.
    if (brutoCliente !== undefined && brutoCliente !== null && brutoCliente !== '') {
      if (Number(brutoCliente) !== linha.cliente_id) {
        throw erroValidacao('A empresa informada não pertence ao cliente informado.');
      }
    }
    return { empresaId: id, clienteId: linha.cliente_id };
  }

  const clienteId = Number(brutoCliente);
  if (!Number.isInteger(clienteId) || clienteId <= 0) {
    throw erroValidacao('Informe a empresa em "X-Empresa-Id" ou o cliente em "X-Cliente-Id".');
  }
  const matrizes = db()
    .prepare("SELECT id FROM empresas WHERE cliente_id = ? AND status = 'ativa' ORDER BY id")
    .all(clienteId) as Array<{ id: number }>;
  if (matrizes.length === 0) throw erroValidacao(`Cliente ${clienteId} não tem matriz ativa cadastrada.`);
  if (matrizes.length > 1) {
    throw erroValidacao(
      `O cliente ${clienteId} tem ${matrizes.length} unidades: informe a de destino em "X-Empresa-Id".`,
    );
  }
  return { empresaId: matrizes[0]!.id, clienteId };
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
    // A autenticação já resolveu a unidade; repetir aqui seria consultar duas vezes.
    const empresaId = (req as Request & { empresaId?: number }).empresaId as number;

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
        const idDaOrigem = (bruto?.external_id ?? bruto?.ticket_id ?? bruto?.ID ?? null) as string | null;
        // Passo 1 do pipeline: o payload entra no log ANTES de ser interpretado.
        // É isso que permite diagnosticar e reprocessar o que falhar adiante.
        const eventoId = registrarEvento({
          empresaId,
          sistema,
          externalId: idDaOrigem === null ? null : String(idDaOrigem),
          // Só dá para saber se criou ou atualizou depois do upsert; o tipo é
          // corrigido no fim, com o resultado em mãos.
          tipo: 'ticket.created',
          payload: bruto,
        });

        const r = processarEvento(empresaId, sistema, bruto, eventoId);
        if (r.ok) {
          if (r.setor === SETOR_NAO_CLASSIFICADO) semSetor.push(String(idDaOrigem ?? r.ticketId));
          if (!r.criado) {
            db().prepare(`UPDATE integracao_evento SET tipo = 'ticket.updated' WHERE id = ?`).run(eventoId);
          }
          aceitos.push({ external_id: String(idDaOrigem ?? ''), ticket_id: r.ticketId, criado: r.criado });
        } else {
          recusados.push({ indice, external_id: idDaOrigem === null ? null : String(idDaOrigem), motivo: r.erro });
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

rotasWebhooks.post('/ostick/tickets', limitarTaxa, autenticarWebhook('OSTICK'), receber('OSTICK'));
rotasWebhooks.post('/bitrix24/tickets', limitarTaxa, autenticarWebhook('BITRIX24'), receber('BITRIX24'));
