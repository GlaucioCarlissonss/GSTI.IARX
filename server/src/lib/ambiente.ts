/**
 * Carregamento de configuração.
 *
 * O `.env` fica na raiz do projeto, mas os scripts de workspace rodam com o
 * cwd em `server/`. Depender do cwd faria o arquivo passar despercebido e a
 * aplicação subir sem configuração — em silêncio. Por isso a raiz é resolvida
 * a partir da localização deste módulo.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Raiz do projeto — o diretório que contém o `package.json` do workspace.
 * Sobe a partir deste módulo (vale tanto para `src/lib` quanto para
 * `dist/lib`) procurando o marcador, em vez de confiar no cwd.
 */
export function raizProjeto(): string {
  let atual = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(atual, 'package-lock.json'))) return atual;
    const acima = dirname(atual);
    if (acima === atual) break;
    atual = acima;
  }
  return process.cwd();
}

export function carregarAmbiente(): void {
  const caminho = resolve(raizProjeto(), '.env');
  if (existsSync(caminho)) config({ path: caminho, quiet: true });
  else config({ quiet: true });
}

/**
 * Resolve um caminho de configuração contra a raiz do projeto.
 *
 * Scripts de workspace rodam com o cwd em `server/`; resolver contra o cwd
 * faria `./data/gsti.sqlite` apontar para dois bancos diferentes conforme de
 * onde a aplicação foi iniciada.
 */
export function caminhoDoProjeto(valor: string | undefined, padrao: string): string {
  return resolve(raizProjeto(), valor?.trim() || padrao);
}
