import type { NextFunction, Request, Response } from 'express';
import { ErroHttp, erroNaoAutenticado, erroSemPermissao, erroValidacao } from '../lib/erros.js';
import { verificarToken, type Sessao } from '../domain/auth.js';
import { acessoDoUsuario } from '../domain/empresas.js';
import type { Contexto } from '../domain/contexto.js';
import { exigirPermissao, type Acao } from '../domain/acesso.js';
import { auditar } from '../domain/auditoria.js';

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
 * Resolve o tenant da requisição. Toda operação de negócio ocorre dentro de
 * uma empresa — sem contexto organizacional não há operação.
 */
export function comEmpresa(req: Request, _res: Response, next: NextFunction) {
  if (!req.sessao) return next(erroNaoAutenticado());
  const bruto = req.header('x-empresa-id') ?? (req.query.empresa_id as string | undefined);
  const empresaId = Number(bruto);
  if (!bruto || !Number.isInteger(empresaId) || empresaId <= 0) {
    return next(erroValidacao('Informe a empresa em contexto no cabeçalho X-Empresa-Id.'));
  }
  const papel = acessoDoUsuario(req.sessao.usuarioId, empresaId);
  if (!papel) return next(erroSemPermissao('Você não tem acesso a esta empresa.'));
  req.contexto = {
    empresaId,
    usuarioId: req.sessao.usuarioId,
    usuarioEmail: req.sessao.email,
    papel,
  };
  next();
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
