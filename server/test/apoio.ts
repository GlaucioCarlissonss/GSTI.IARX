import { abrirBanco, definirBanco, db } from '../src/db/index.js';
import { clienteDaEmpresa } from '../src/domain/clientes.js';
import { criarEmpresa } from '../src/domain/empresas.js';
import { registrar } from '../src/domain/auth.js';
import type { Contexto } from '../src/domain/contexto.js';

/** Segredo fixo de teste: os testes não dependem do .env da máquina. */
export const SEGREDO_DE_TESTE = 'segredo-de-teste-com-comprimento-suficiente-1234';

export function ambienteLimpo(): { ctx: Contexto; empresaId: number } {
  process.env.JWT_SECRET = SEGREDO_DE_TESTE;
  definirBanco(abrirBanco(':memory:'));
  const usuario = registrar({ nome: 'Gestor de TI', email: 'gestor@exemplo.com', senha: 'senha-forte-123' });
  const empresa = criarEmpresa(usuario.id, { nome: 'Empresa Teste' });
  return {
    empresaId: empresa.id,
    ctx: {
      clienteId: clienteDaEmpresa(empresa.id),
      empresaIds: [empresa.id],
      empresaId: empresa.id,
      usuarioId: usuario.id,
      usuarioEmail: usuario.email,
      papel: 'gestor',
    },
  };
}

export function idTipoDespesa(ctx: Contexto, nome = 'Licenças de Softwares'): number {
  const linha = db()
    .prepare('SELECT id FROM tipos_despesa WHERE empresa_id = ? AND nome = ?')
    .get(ctx.empresaId, nome) as { id: number };
  return linha.id;
}

/**
 * O contexto de OUTRO tenant, para as conferências de isolamento.
 *
 * Trocar só `empresaId` deixaria `empresaIds` apontando para as matrizes do
 * cliente anterior — e a consulta, que hoje lê o cliente inteiro, continuaria
 * enxergando os dados de lá. O escopo inteiro troca junto.
 */
export function contextoDe(ctx: Contexto, empresaId: number): Contexto {
  return { ...ctx, empresaId, empresaIds: [empresaId], clienteId: clienteDaEmpresa(empresaId) };
}

/** Competência deslocada em N meses a partir de hoje, no formato MM/AAAA. */
export function mesRelativo(deslocamento: number): string {
  const hoje = new Date();
  const d = new Date(hoje.getFullYear(), hoje.getMonth() + deslocamento, 1);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
