import type { NextFunction, Request, Response } from 'express';
import { ErroHttp, erroNaoAutenticado, erroSemPermissao, erroValidacao } from '../lib/erros.js';
import { verificarToken, type Sessao } from '../domain/auth.js';
import { acessoDoUsuario, empresasAcessiveis } from '../domain/empresas.js';
import { clienteDaEmpresa, usuarioTemCliente } from '../domain/clientes.js';
import type { Contexto } from '../domain/contexto.js';
import { exigirPermissao, type Acao } from '../domain/acesso.js';
import { auditar, registrarAcessoNegado } from '../domain/auditoria.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sessao?: Sessao;
      contexto?: Contexto;
    }
  }
}

export function autenticado(req: Request, _res: Response, next: NextFunction) {
  const cabecalho = req.header('authorization') ?? '';
  const token = cabecalho.toLowerCase().startsWith('bearer ') ? cabecalho.slice(7).trim() : '';
  if (!token) return next(erroNaoAutenticado());
  try {
    req.sessao = verificarToken(token);
    next();
  } catch (erro) {
    next(erro);
  }
}

/**
 * Resolve o tenant da requisição.
 *
 * O recorte é o CLIENTE: a requisição informa `X-Cliente-Id`, o servidor
 * confere o vínculo e monta o escopo com todas as matrizes daquele cliente a
 * que a pessoa tem acesso. A empresa deixou de ser o recorte do sistema e
 * passou a ser o filtro local de cada tela.
 *
 * `X-Empresa-Id` continua aceito: é o contrato antigo, e o cliente sai dela.
 * Quem manda os dois e eles discordam é recusado — a divergência é justamente
 * o que um pedido forjado produziria.
 */
export function comEmpresa(req: Request, _res: Response, next: NextFunction) {
  if (!req.sessao) return next(erroNaoAutenticado());
  const usuarioId = req.sessao.usuarioId;
  const brutoCliente = req.header('x-cliente-id') ?? (req.query.cliente_id as string | undefined);
  const brutoEmpresa = req.header('x-empresa-id') ?? (req.query.empresa_id as string | undefined);

  let clienteId: number | null = null;
  if (brutoCliente) {
    const pedido = Number(brutoCliente);
    if (!Number.isInteger(pedido) || pedido <= 0) {
      return next(erroValidacao('Cliente em contexto inválido.'));
    }
    if (!usuarioTemCliente(usuarioId, pedido)) {
      // A tentativa fica registrada: saber quem pediu um cliente que não é seu
      // é metade do valor de ter isolamento.
      registrarTentativa(req, pedido, 'cliente sem vínculo com o usuário');
      return next(erroSemPermissao('Você não tem acesso a este cliente.'));
    }
    clienteId = pedido;
  }

  const empresas = clienteId === null ? [] : empresasAcessiveis(usuarioId, clienteId);
  let empresaId = Number(brutoEmpresa);
  if (brutoEmpresa && (!Number.isInteger(empresaId) || empresaId <= 0)) {
    return next(erroValidacao('Empresa em contexto inválida.'));
  }

  if (!brutoCliente) {
    // Contrato antigo: só a empresa veio. O cliente sai DELA — o cabeçalho é a
    // pergunta, e a resposta está gravada.
    if (!brutoEmpresa) {
      return next(erroValidacao('Informe o cliente em contexto no cabeçalho X-Cliente-Id.'));
    }
    const papelDireto = acessoDoUsuario(usuarioId, empresaId);
    if (!papelDireto) return next(erroSemPermissao('Você não tem acesso a esta empresa.'));
    const donoDaEmpresa = clienteDaEmpresa(empresaId);
    if (donoDaEmpresa !== null && !usuarioTemCliente(usuarioId, donoDaEmpresa)) {
      registrarTentativa(req, donoDaEmpresa, 'empresa de cliente sem vínculo com o usuário');
      return next(erroSemPermissao('Você não tem acesso a este cliente.'));
    }
    req.contexto = {
      clienteId: donoDaEmpresa,
      empresaIds: donoDaEmpresa === null ? [empresaId] : empresasAcessiveis(usuarioId, donoDaEmpresa),
      empresaId,
      usuarioId,
      usuarioEmail: req.sessao.email,
      papel: papelDireto,
    };
    return next();
  }

  // Daqui para baixo o cliente veio no pedido e já passou pela conferência.
  const clienteAtivo = clienteId as number;

  if (brutoEmpresa) {
    // Empresa informada junto do cliente: ela tem de ser DELE. Aceitar uma
    // empresa de outro cliente aqui furaria o isolamento inteiro.
    if (!empresas.includes(empresaId)) {
      registrarTentativa(req, clienteAtivo, `empresa ${empresaId} fora do cliente em contexto`);
      return next(erroSemPermissao('Esta empresa não pertence ao cliente em contexto.'));
    }
  } else {
    empresaId = empresas[0] ?? 0;
  }
  if (!empresaId) {
    return next(erroValidacao('Este cliente ainda não tem matriz cadastrada à qual você tenha acesso.'));
  }

  const papel = acessoDoUsuario(usuarioId, empresaId);
  if (!papel) return next(erroSemPermissao('Você não tem acesso a esta empresa.'));

  req.contexto = {
    clienteId: clienteAtivo,
    empresaIds: empresas,
    empresaId,
    usuarioId,
    usuarioEmail: req.sessao.email,
    papel,
  };
  next();
}

/**
 * Tentativa de acesso a cliente não autorizado, na trilha.
 *
 * Não pode derrubar a recusa: se a auditoria falhar, a requisição continua
 * sendo recusada — o registro é o que se perde, nunca a barreira.
 */
function registrarTentativa(req: Request, clienteId: number, motivo: string) {
  try {
    registrarAcessoNegado({
      clienteId,
      usuarioId: req.sessao?.usuarioId ?? null,
      usuarioEmail: req.sessao?.email ?? null,
      rota: req.originalUrl,
      metodo: req.method,
      motivo,
    });
  } catch {
    // A trilha nunca bloqueia a recusa.
  }
}

/** Somente gestores escrevem; leitores têm acesso de consulta. */
export function somenteGestor(req: Request, _res: Response, next: NextFunction) {
  if (req.contexto?.papel !== 'gestor') {
    return next(erroSemPermissao('Esta operação exige o papel de gestor na empresa.'));
  }
  next();
}

/**
 * Autorização por módulo e ação, conferida no SERVIDOR. O que o front esconde
 * é conveniência; a regra é esta. Uma recusa vira 403 e entra na auditoria.
 */
export function exigir(modulo: string, acao: Acao) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const contexto = ctx(req);
      exigirPermissao(contexto, modulo, acao);
      next();
    } catch (erro) {
      if (erro instanceof Error && 'status' in erro && (erro as { status: number }).status === 403) {
        // A negação fica registrada: saber o que foi tentado e recusado é
        // metade do valor de ter permissão.
        try {
          auditar(ctx(req), {
            entidade: 'permissao',
            acao: 'negar',
            justificativa: `${acao} em ${modulo}`,
            depois: { rota: req.originalUrl, metodo: req.method },
          });
        } catch {
          // Auditar não pode ser o motivo de a recusa virar erro 500.
        }
      }
      next(erro);
    }
  };
}

export function ctx(req: Request): Contexto {
  if (!req.contexto) throw erroNaoAutenticado();
  return req.contexto;
}

export function tratadorDeErros(erro: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (erro instanceof ErroHttp) {
    return res.status(erro.status).json({ erro: erro.message, detalhes: erro.detalhes ?? null });
  }
  const mensagem = erro instanceof Error ? erro.message : 'Erro inesperado.';
  // Violações de restrição do banco viram mensagens de negócio legíveis. A
  // mensagem do driver carrega tabela e coluna — fica no log do servidor, não
  // na resposta, para não entregar o schema nem servir de oráculo de
  // existência de conta.
  if (/UNIQUE constraint failed/i.test(mensagem)) {
    console.error('[restrição]', mensagem);
    return res.status(409).json({ erro: 'Registro duplicado.', detalhes: null });
  }
  if (/CHECK constraint failed|FOREIGN KEY constraint failed/i.test(mensagem)) {
    console.error('[restrição]', mensagem);
    return res.status(400).json({ erro: 'Dados inconsistentes para a regra de negócio.', detalhes: null });
  }
  if (/Competência inválida|Valor monetário inválido/i.test(mensagem)) {
    return res.status(400).json({ erro: mensagem });
  }
  console.error('[erro]', erro);
  return res.status(500).json({ erro: 'Erro interno do servidor.' });
}

/** Envolve handlers assíncronos para que rejeições cheguem ao tratador. */
export function assincrono(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}
