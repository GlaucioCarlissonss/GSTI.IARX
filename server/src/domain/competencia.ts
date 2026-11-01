/**
 * Competência (mês de referência).
 *
 * Formato de interface (API/planilhas): "MM/AAAA".
 * Formato interno (banco):              "AAAA-MM"  -> ordenável lexicograficamente.
 */

const RE_EXIBICAO = /^(0[1-9]|1[0-2])\/(\d{4})$/;
const RE_INTERNO = /^(\d{4})-(0[1-9]|1[0-2])$/;

export class CompetenciaInvalidaError extends Error {
  constructor(valor: unknown) {
    super(`Competência inválida: "${String(valor)}". Use o formato MM/AAAA.`);
    this.name = 'CompetenciaInvalidaError';
  }
}

/** Converte "MM/AAAA" (ou já "AAAA-MM") para o formato interno "AAAA-MM". */
export function paraInterno(valor: unknown): string {
  if (typeof valor !== 'string') throw new CompetenciaInvalidaError(valor);
  const texto = valor.trim();
  const exib = RE_EXIBICAO.exec(texto);
  if (exib) return `${exib[2]}-${exib[1]}`;
  if (RE_INTERNO.test(texto)) return texto;
  throw new CompetenciaInvalidaError(valor);
}

/** Converte o formato interno "AAAA-MM" para exibição "MM/AAAA". */
export function paraExibicao(interno: string): string {
  const m = RE_INTERNO.exec(interno);
  if (!m) throw new CompetenciaInvalidaError(interno);
  return `${m[2]}/${m[1]}`;
}

export function ehCompetenciaValida(valor: unknown): boolean {
  try {
    paraInterno(valor);
    return true;
  } catch {
    return false;
  }
}

/** Soma (ou subtrai, com meses negativos) meses a uma competência interna. */
export function somarMeses(interno: string, meses: number): string {
  const m = RE_INTERNO.exec(interno);
  if (!m) throw new CompetenciaInvalidaError(interno);
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const total = ano * 12 + (mes - 1) + meses;
  const novoAno = Math.floor(total / 12);
  const novoMes = total - novoAno * 12 + 1;
  return `${String(novoAno).padStart(4, '0')}-${String(novoMes).padStart(2, '0')}`;
}

/** Distância em meses entre duas competências internas (b - a). */
export function diferencaEmMeses(a: string, b: string): number {
  const ma = RE_INTERNO.exec(a);
  const mb = RE_INTERNO.exec(b);
  if (!ma) throw new CompetenciaInvalidaError(a);
  if (!mb) throw new CompetenciaInvalidaError(b);
  return (Number(mb[1]) - Number(ma[1])) * 12 + (Number(mb[2]) - Number(ma[2]));
}

/** Lista inclusiva de competências entre início e fim. */
export function intervalo(inicio: string, fim: string): string[] {
  const total = diferencaEmMeses(inicio, fim);
  if (total < 0) return [];
  return Array.from({ length: total + 1 }, (_, i) => somarMeses(inicio, i));
}

/** Competência corrente (mês atual) no formato interno. */
export function competenciaAtual(hoje: Date = new Date()): string {
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

export type PosicaoTemporal = 'passada' | 'corrente' | 'futura';

export function posicaoTemporal(interno: string, hoje: Date = new Date()): PosicaoTemporal {
  const atual = competenciaAtual(hoje);
  if (interno < atual) return 'passada';
  if (interno > atual) return 'futura';
  return 'corrente';
}
