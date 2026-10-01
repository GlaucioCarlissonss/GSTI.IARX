/**
 * Valores monetários são sempre persistidos em centavos (inteiros),
 * eliminando erro de ponto flutuante em somatórios e rateios.
 */

export class ValorInvalidoError extends Error {
  constructor(valor: unknown) {
    super(`Valor monetário inválido: "${String(valor)}".`);
    this.name = 'ValorInvalidoError';
  }
}

/**
 * Converte entrada do usuário/planilha para centavos.
 * Aceita number (reais), "1234.56", "1.234,56", "R$ 1.234,56".
 */
export function paraCentavos(entrada: unknown): number {
  if (typeof entrada === 'number') {
    if (!Number.isFinite(entrada)) throw new ValorInvalidoError(entrada);
    return Math.round(entrada * 100);
  }
  if (typeof entrada !== 'string') throw new ValorInvalidoError(entrada);

  let texto = entrada.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (texto === '') throw new ValorInvalidoError(entrada);

  const temVirgula = texto.includes(',');
  const temPonto = texto.includes('.');
  if (temVirgula && temPonto) {
    // "1.234,56" (pt-BR) ou "1,234.56" (en-US): o último separador é o decimal
    texto = texto.lastIndexOf(',') > texto.lastIndexOf('.')
      ? texto.replace(/\./g, '').replace(',', '.')
      : texto.replace(/,/g, '');
  } else if (temVirgula) {
    texto = texto.replace(',', '.');
  }

  if (!/^-?\d+(\.\d+)?$/.test(texto)) throw new ValorInvalidoError(entrada);
  const numero = Number(texto);
  if (!Number.isFinite(numero)) throw new ValorInvalidoError(entrada);
  return Math.round(numero * 100);
}

export function paraReais(centavos: number): number {
  return Math.round(centavos) / 100;
}

export function formatarBRL(centavos: number): string {
  return paraReais(centavos).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Rateia um total em N parcelas sem perder centavos.
 * O resto é distribuído nas primeiras parcelas (padrão contábil brasileiro).
 * Ex.: 10000 / 3 -> [3334, 3333, 3333]
 */
export function ratear(totalCentavos: number, parcelas: number): number[] {
  if (!Number.isInteger(parcelas) || parcelas < 1) {
    throw new RangeError(`Quantidade de parcelas inválida: ${parcelas}`);
  }
  const base = Math.trunc(totalCentavos / parcelas);
  const resto = totalCentavos - base * parcelas;
  return Array.from({ length: parcelas }, (_, i) => base + (i < Math.abs(resto) ? Math.sign(resto) : 0));
}
