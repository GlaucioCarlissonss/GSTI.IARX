export class ErroHttp extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detalhes?: unknown,
  ) {
    super(message);
    this.name = 'ErroHttp';
  }
}

export const erroValidacao = (msg: string, detalhes?: unknown) => new ErroHttp(400, msg, detalhes);
export const erroNaoAutenticado = (msg = 'Autenticação necessária.') => new ErroHttp(401, msg);
export const erroSemPermissao = (msg = 'Sem permissão para esta operação.') => new ErroHttp(403, msg);
export const erroNaoEncontrado = (msg = 'Registro não encontrado.') => new ErroHttp(404, msg);
export const erroConflito = (msg: string, detalhes?: unknown) => new ErroHttp(409, msg, detalhes);
