/**
 * Filtros de múltipla escolha na query.
 *
 * A tela passou a permitir marcar vários valores por filtro, então a API
 * precisa aceitar listas. O formato escolhido é o mais simples que mantém o
 * contrato antigo válido: `natureza=fixa` continua funcionando e
 * `natureza=fixa,pontual_unica` passa a funcionar, assim como o parâmetro
 * repetido (`?natureza=fixa&natureza=pontual_unica`), que o Express entrega
 * como array.
 */

/** Lista de textos vinda da query, em qualquer das três formas aceitas. */
export function listaDaQuery(valor: unknown): string[] | undefined {
  if (valor === undefined || valor === null || valor === '') return undefined;
  const bruto = Array.isArray(valor) ? valor : [valor];
  const itens = bruto
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter((v) => v !== '');
  return itens.length ? [...new Set(itens)] : undefined;
}

/** Mesma coisa para números; descarta o que não for número. */
export function numerosDaQuery(valor: unknown): number[] | undefined {
  const textos = listaDaQuery(valor);
  if (!textos) return undefined;
  const numeros = textos.map(Number).filter((n) => Number.isFinite(n));
  return numeros.length ? numeros : undefined;
}

/**
 * Filiais aceitam o sentinela `nenhuma` (ou `null`) para o nível empresa, que
 * no banco é `filial_id IS NULL` — e `IN` não casa com NULL.
 */
export function filiaisDaQuery(valor: unknown): Array<number | null> | undefined {
  const textos = listaDaQuery(valor);
  if (!textos) return undefined;
  const saida: Array<number | null> = [];
  for (const t of textos) {
    if (t === 'nenhuma' || t === 'null') saida.push(null);
    else if (Number.isFinite(Number(t))) saida.push(Number(t));
  }
  return saida.length ? saida : undefined;
}

/**
 * Condição SQL para "a coluna é um destes valores".
 * Devolve `null` quando não há filtro a aplicar.
 */
export function clausulaEm(coluna: string, valores: readonly unknown[] | undefined) {
  if (!valores || valores.length === 0) return null;
  const marcadores = valores.map(() => '?').join(', ');
  return { sql: `${coluna} IN (${marcadores})`, params: [...valores] };
}

/**
 * Como `clausulaEm`, mas aceitando `null` na lista para significar "sem valor"
 * — usado por filial, onde o nível empresa é a ausência de filial.
 */
export function clausulaEmComNulo(coluna: string, valores: ReadonlyArray<number | null> | undefined) {
  if (!valores || valores.length === 0) return null;
  const numeros = valores.filter((v): v is number => v !== null);
  const temNulo = valores.some((v) => v === null);
  const partes: string[] = [];
  const params: unknown[] = [];
  if (numeros.length) {
    partes.push(`${coluna} IN (${numeros.map(() => '?').join(', ')})`);
    params.push(...numeros);
  }
  if (temNulo) partes.push(`${coluna} IS NULL`);
  return { sql: `(${partes.join(' OR ')})`, params };
}
