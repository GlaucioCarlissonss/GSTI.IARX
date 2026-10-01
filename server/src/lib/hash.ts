import { createHash } from 'node:crypto';

/**
 * Chave de deduplicação estável para importação idempotente.
 * Normaliza cada parte (trim + minúsculas + colapso de espaços) para que
 * diferenças cosméticas na planilha não gerem registros duplicados.
 */
export function chaveDedup(partes: Array<string | number | null | undefined>): string {
  const normalizado = partes
    .map((p) => (p === null || p === undefined ? '' : String(p).trim().toLowerCase().replace(/\s+/g, ' ')))
    .join('|');
  return createHash('sha256').update(normalizado).digest('hex');
}

export function hashArquivo(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
