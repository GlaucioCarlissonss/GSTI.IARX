import type { NextFunction, Request, Response } from 'express';
import { ErroHttp, erroNaoAutenticado, erroSemPermissao, erroValidacao } from '../lib/erros.js';
import { verificarToken, type Sessao } from '../domain/auth.js';
import { acessoDoUsuario } from '../domain/empresas.js';
import type { Contexto } from '../domain/contexto.js';

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

export function ctx(req: Request): Contexto {
  if (!req.contexto) throw erroNaoAutenticado();
  return req.contexto;
}

export function tratadorDeErros(erro: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (erro instanceof ErroHttp) {
    return res.status(erro.status).json({ erro: erro.message, detalhes: erro.detalhes ?? null });
  }
  const mensagem = erro instanceof Error ? erro.message : 'Erro inesperado.';
  // Violações de restrição do banco viram mensagens de negócio legíveis.
  if (/UNIQUE constraint failed/i.test(mensagem)) {
    return res.status(409).json({ erro: 'Registro duplicado.', detalhes: mensagem });
  }
  if (/CHECK constraint failed|FOREIGN KEY constraint failed/i.test(mensagem)) {
    return res.status(400).json({ erro: 'Dados inconsistentes para a regra de negócio.', detalhes: mensagem });
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
