/**
 * Prepara o arquivo .env na primeira execução.
 *
 * Gera um JWT_SECRET aleatório para que ninguém precise inventar um, e é
 * idempotente: rodar de novo não sobrescreve o que já está configurado.
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const caminhoEnv = resolve(raiz, '.env');
const caminhoExemplo = resolve(raiz, '.env.example');

const PLACEHOLDER = 'troque-por-um-segredo-longo-e-aleatorio';

if (!existsSync(caminhoEnv)) {
  copyFileSync(caminhoExemplo, caminhoEnv);
  console.log('Criado .env a partir de .env.example.');
}

let conteudo = readFileSync(caminhoEnv, 'utf8');
const segredoAtual = /^JWT_SECRET=(.*)$/m.exec(conteudo)?.[1]?.trim() ?? '';

if (segredoAtual === '' || segredoAtual === PLACEHOLDER) {
  const novo = randomBytes(48).toString('hex');
  conteudo = /^JWT_SECRET=/m.test(conteudo)
    ? conteudo.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${novo}`)
    : `${conteudo.trimEnd()}\nJWT_SECRET=${novo}\n`;
  writeFileSync(caminhoEnv, conteudo);
  console.log('JWT_SECRET gerado. Guarde o .env: trocá-lo invalida as sessões abertas.');
} else {
  console.log('JWT_SECRET já configurado — nada a fazer.');
}
