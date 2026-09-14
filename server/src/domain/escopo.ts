/**
 * O escopo de leitura de toda consulta: as matrizes do CLIENTE em contexto.
 *
 * Antes, o recorte vinha de um filtro global no topo do sistema — uma empresa
 * de cada vez, e toda tela obedecia a ele. Isso tinha dois defeitos: a tela de
 * Integrações, que é do cliente, ficava refém de um seletor de empresa; e mexer
 * no filtro para olhar um número num módulo recortava o sistema inteiro.
 *
 * Agora o escopo é o cliente, e cada tela aplica o SEU filtro local por cima —
 * um subconjunto das matrizes do cliente, nunca algo fora dele. A conferência
 * está aqui, num lugar só: uma tela que peça empresa alheia é recusada, e a
 * recusa é a mesma dada a uma empresa inexistente.
 */
import { erroSemPermissao } from '../lib/erros.js';
import type { Contexto } from './contexto.js';

/**
 * As empresas que esta consulta pode ler.
 *
 * Sem filtro local, é o cliente inteiro. Com filtro, é a interseção — e pedir
 * empresa de fora do cliente é 403, não uma lista vazia em silêncio.
 */
export function escopoDeLeitura(ctx: Contexto, filtro?: number[] | null): number[] {
  const permitidas = ctx.empresaIds.length ? ctx.empresaIds : [ctx.empresaId];
  if (!filtro || filtro.length === 0) return permitidas;
  const conjunto = new Set(permitidas);
  const dentro = filtro.filter((e) => conjunto.has(e));
  if (dentro.length !== filtro.length) {
    // A mesma recusa para empresa de outro cliente e para empresa inexistente:
    // distinguir as duas contaria a quem tenta qual id existe.
    throw erroSemPermissao('Você não tem acesso a uma das empresas informadas no filtro.');
  }
  return dentro;
}

/**
 * A matriz em que um registro NOVO nasce.
 *
 * Criar exige uma só — um lançamento não pertence a duas matrizes. Quem informa
 * escolheu no formulário; quem não informa cai na matriz em foco. A conferência
 * é a mesma da leitura: matriz de outro cliente é 403.
 */
export function empresaDeEscrita(ctx: Contexto, empresaId?: number | null): number {
  if (empresaId === undefined || empresaId === null) return ctx.empresaId;
  const [alvo] = escopoDeLeitura(ctx, [empresaId]);
  return alvo!;
}

/** `IN (?, ?, …)` com os parâmetros na ordem — o par que toda consulta usa. */
export function clausulaEmpresas(empresas: number[], coluna = 'empresa_id'): { sql: string; params: number[] } {
  if (empresas.length === 1) return { sql: `${coluna} = ?`, params: [empresas[0]!] };
  return { sql: `${coluna} IN (${empresas.map(() => '?').join(', ')})`, params: [...empresas] };
}

/**
 * O par pronto para entrar numa consulta: escopo do cliente, filtro local
 * conferido, cláusula e parâmetros na ordem.
 *
 * É o atalho de quase toda consulta — `escopoDeLeitura` + `clausulaEmpresas`
 * num passo só, para que ninguém monte a cláusula sem passar pela conferência.
 */
export function escopoSql(
  ctx: Contexto,
  filtro?: number[] | null,
  coluna = 'empresa_id',
): { sql: string; params: number[] } {
  return clausulaEmpresas(escopoDeLeitura(ctx, filtro), coluna);
}

/**
 * Lê o filtro local de empresa que a tela mandou.
 *
 * Aceita `empresas=1,2` e `empresa_id=1` — o segundo é o contrato antigo, e
 * mantê-lo evita quebrar quem já chama assim. Vazio significa "o cliente
 * inteiro", que é o padrão de toda tela.
 */
export function empresasDoPedido(query: Record<string, unknown>): number[] {
  const bruto = query.empresas ?? query.empresa_id ?? query.empresaId;
  if (bruto === undefined || bruto === null || bruto === '') return [];
  const lista = String(bruto)
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(lista)];
}
