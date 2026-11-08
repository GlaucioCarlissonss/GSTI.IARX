/**
 * O ESCOPO DE UMA OPERAÇÃO DE ARQUIVO — importar e exportar.
 *
 * `escopo.ts` responde "o que esta CONSULTA pode ler". Este arquivo responde
 * outra pergunta: "sobre quais unidades esta CARGA ou EXPORTAÇÃO opera".
 *
 * Antes, a resposta era sempre "uma": a rota resolvia uma matriz em foco e
 * daí para baixo tudo lia `ctx.empresaId`. Um cliente com seis matrizes exigia
 * seis exportações e seis cargas do mesmo arquivo — e cada repetição é uma
 * chance a mais de carregar o arquivo na unidade errada.
 *
 * Agora o padrão é o CLIENTE INTEIRO, e restringir é a exceção que a pessoa
 * escolhe. Três modos, nesta ordem de abrangência:
 *
 *   cliente   — todas as matrizes e filiais do cliente (o padrão de tudo)
 *   empresas  — as matrizes marcadas, com as filiais de cada uma junto
 *   unidades  — matrizes e/ou filiais marcadas uma a uma
 *
 * A conferência continua num lugar só, e é a mesma de sempre: pedir unidade de
 * outro cliente é 403, com a mesma recusa dada a uma unidade inexistente.
 */
import { db } from '../db/index.js';
import { erroSemPermissao } from '../lib/erros.js';
import type { Contexto } from './contexto.js';
import { clausulaEmpresas, escopoDeLeitura } from './escopo.js';

export type ModoEscopo = 'cliente' | 'empresas' | 'unidades';

export const MODOS_ESCOPO: ModoEscopo[] = ['cliente', 'empresas', 'unidades'];

/** O escopo já resolvido e conferido — o que o resto do código consome. */
export interface EscopoOperacao {
  modo: ModoEscopo;
  /** As matrizes atingidas. Nunca vazio: sem matriz não há operação. */
  empresas: number[];
  /**
   * As filiais atingidas. VAZIO significa "todas as filiais das matrizes acima",
   * e não "nenhuma" — é o mesmo acordo de `empresasDoPedido`, onde vazio é o
   * cliente inteiro. Só o modo `unidades` preenche esta lista.
   */
  filiais: number[];
}

/** O escopo como veio do pedido, ainda sem conferência. */
export interface EscopoBruto {
  modo: ModoEscopo;
  empresas: number[];
  filiais: number[];
}

function numeros(bruto: unknown): number[] {
  if (bruto === undefined || bruto === null || bruto === '') return [];
  const lista = (Array.isArray(bruto) ? bruto : String(bruto).split(','))
    .map((p) => Number(String(p).trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(lista)];
}

/**
 * Lê o escopo do pedido — query e corpo, porque exportar é GET e importar é POST.
 *
 * Sem `escopo`, é o cliente inteiro. Mandar `empresas=1,2` sem dizer o modo
 * também vale: é o contrato antigo da tela, e honrá-lo evita quebrar quem já
 * chama assim.
 */
export function escopoDoPedido(fonte: Record<string, unknown>): EscopoBruto {
  const empresas = numeros(fonte.empresas ?? fonte.empresa_id ?? fonte.empresaId);
  const filiais = numeros(fonte.filiais ?? fonte.filial_id ?? fonte.filiais_id);
  const pedido = String(fonte.escopo ?? '').trim() as ModoEscopo;
  const modo: ModoEscopo = MODOS_ESCOPO.includes(pedido)
    ? pedido
    : filiais.length > 0
      ? 'unidades'
      : empresas.length > 0
        ? 'empresas'
        : 'cliente';
  return { modo, empresas, filiais };
}

/**
 * Expande e confere o escopo contra o cliente da sessão.
 *
 * É aqui que mora a garantia do enunciado — "nenhuma unidade de outro cliente
 * aparece", validado no servidor. A tela pode listar o que quiser; o que entra
 * na operação passa por esta função.
 */
export function resolverEscopo(ctx: Contexto, bruto: EscopoBruto): EscopoOperacao {
  const doCliente = escopoDeLeitura(ctx);

  if (bruto.modo === 'cliente' || (bruto.empresas.length === 0 && bruto.filiais.length === 0)) {
    return { modo: 'cliente', empresas: doCliente, filiais: [] };
  }

  if (bruto.modo === 'empresas') {
    // `escopoDeLeitura` já recusa matriz de fora — a mesma 403 de toda consulta.
    return { modo: 'empresas', empresas: escopoDeLeitura(ctx, bruto.empresas), filiais: [] };
  }

  // Modo `unidades`: matrizes e filiais marcadas uma a uma. As filiais mandam
  // as matrizes delas para dentro do escopo, senão a linha filha entraria sem
  // que a mãe estivesse no filtro.
  const marcadas = bruto.empresas.length ? escopoDeLeitura(ctx, bruto.empresas) : [];
  if (bruto.filiais.length === 0) {
    return { modo: 'unidades', empresas: marcadas.length ? marcadas : doCliente, filiais: [] };
  }

  const { sql, params } = clausulaEmpresas(doCliente);
  const conhecidas = db()
    .prepare(`SELECT id, empresa_id FROM filiais WHERE ${sql}`)
    .all(...params) as Array<{ id: number; empresa_id: number }>;
  const porFilial = new Map(conhecidas.map((f) => [f.id, f.empresa_id]));

  const filiais: number[] = [];
  const empresas = new Set(marcadas);
  for (const id of bruto.filiais) {
    const dona = porFilial.get(id);
    // A mesma recusa para filial de outro cliente e para filial inexistente:
    // separar as duas contaria a quem tenta qual id existe.
    if (dona === undefined) throw erroSemPermissao('Você não tem acesso a uma das unidades informadas.');
    filiais.push(id);
    empresas.add(dona);
  }
  return { modo: 'unidades', empresas: [...empresas], filiais };
}

/**
 * O escopo padrão: o cliente inteiro.
 *
 * É o que vale quando ninguém escolheu nada — na tela, numa chamada antiga da
 * API ou num teste. O enunciado é explícito: cliente inteiro é o default de
 * toda importação e exportação.
 */
export function escopoDoCliente(ctx: Contexto): EscopoOperacao {
  return { modo: 'cliente', empresas: escopoDeLeitura(ctx), filiais: [] };
}

/** Atalho das rotas: lê o pedido e devolve o escopo já conferido. */
export function escopoDaOperacao(ctx: Contexto, fonte: Record<string, unknown>): EscopoOperacao {
  return resolverEscopo(ctx, escopoDoPedido(fonte));
}

/**
 * A cláusula que recorta uma consulta pelo escopo.
 *
 * A filial entra com `OR <coluna> IS NULL` de propósito: lançamento no nível da
 * matriz não tem filial, e recortar por filial não pode fazê-lo sumir da
 * exportação da própria matriz dele.
 */
export function filtroSql(
  escopo: EscopoOperacao,
  colunaEmpresa = 'empresa_id',
  colunaFilial = 'filial_id',
): { sql: string; params: number[] } {
  const empresa = clausulaEmpresas(escopo.empresas, colunaEmpresa);
  if (escopo.filiais.length === 0) return empresa;
  const lista = escopo.filiais.map(() => '?').join(', ');
  return {
    sql: `${empresa.sql} AND (${colunaFilial} IN (${lista}) OR ${colunaFilial} IS NULL)`,
    params: [...empresa.params, ...escopo.filiais],
  };
}

/** Quantas filiais o escopo atinge — o número que a tela mostra no contador. */
export function contarFiliais(escopo: EscopoOperacao): number {
  if (escopo.filiais.length > 0) return escopo.filiais.length;
  if (escopo.empresas.length === 0) return 0;
  const { sql, params } = clausulaEmpresas(escopo.empresas);
  return (db().prepare(`SELECT COUNT(*) AS n FROM filiais WHERE ${sql}`).get(...params) as { n: number }).n;
}

/**
 * O escopo em uma linha: "3 empresas, 12 filiais".
 *
 * Vai para a tela e para o log — e é de propósito que os dois digam a MESMA
 * frase: conferir depois o que uma carga atingiu não pode exigir reconstruir a
 * conta de cabeça.
 */
export function resumoEscopo(escopo: EscopoOperacao): string {
  const empresas = escopo.empresas.length;
  const filiais = contarFiliais(escopo);
  const parte = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  return `${parte(empresas, 'empresa', 'empresas')}, ${parte(filiais, 'filial', 'filiais')}`;
}

/** O JSON que o log guarda: o escopo REAL, já expandido, não o que foi pedido. */
export function escopoParaLog(escopo: EscopoOperacao): string {
  return JSON.stringify({ empresas: escopo.empresas, filiais: escopo.filiais });
}

/**
 * O contexto de escrita de uma operação de escopo único.
 *
 * Algumas gravações ainda precisam de UMA matriz (o registro do log, por
 * exemplo). Quando o escopo tem uma só, é ela; quando tem várias, fica a que já
 * estava em foco — o registro é do cliente de qualquer forma.
 */
export function empresaDoEscopo(ctx: Contexto, escopo: EscopoOperacao): number {
  return escopo.empresas.length === 1 ? escopo.empresas[0]! : ctx.empresaId;
}
