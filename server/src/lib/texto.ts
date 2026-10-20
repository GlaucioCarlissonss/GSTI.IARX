/**
 * Normalizações de texto compartilhadas entre o domínio e a abertura do banco.
 *
 * Mora em `lib/` — e não no domínio — porque `db/index.ts` precisa dela para
 * semear a lista inicial de quem reconhece despesa, e `db/` é folha: importar
 * `domain/` de lá criaria um ciclo. Uma cópia da regra nos dois lados seria
 * pior: a chave gravada na semeadura deixaria de casar com a que o cadastro
 * calcula assim que uma das duas mudasse.
 */

/**
 * A forma comparável de um nome de usuário: maiúsculas, sem acento, sem espaço.
 *
 * O ERP escreve `MIQUEIASSILVA`; a pessoa cadastra `Miqueias Silva`. São o
 * mesmo usuário, e sem normalizar o cadastro nunca alcançaria a carga.
 *
 * É também o que o `UNIQUE (cliente_id, chave)` protege: comparar por função
 * não funciona em índice do SQLite, então a forma normalizada é COLUNA.
 */
export function chaveDoUsuario(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}
