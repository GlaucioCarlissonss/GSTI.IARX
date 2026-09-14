/**
 * Adaptador de colunas por cliente.
 *
 * Cada contratante manda a planilha com os cabeçalhos dele: onde o template diz
 * `Valor`, a planilha de um cliente diz `Vlr Total` e a de outro diz `Custo`.
 * Guardar a equivalência é o que evita pedir, todo mês, que alguém reescreva o
 * cabeçalho do arquivo — e ela é POR CLIENTE porque o apelido de um não
 * descreve a planilha do outro.
 *
 * O apelido não substitui a coluna canônica: ele se soma aos nomes aceitos. Uma
 * planilha já no padrão continua entrando sem cadastro nenhum.
 */
import { db } from '../db/index.js';
import { erroValidacao } from '../lib/erros.js';
import { ABAS, normalizarCabecalho, type NomeAba } from './templates.js';

export interface Mapeamento {
  id: number;
  aba: string;
  coluna: string;
  apelido: string;
  criado_em: string;
}

export function listarMapeamentos(clienteId: number, aba?: string): Mapeamento[] {
  const condicao = aba ? ' AND aba = ?' : '';
  const params: unknown[] = aba ? [clienteId, aba] : [clienteId];
  return db()
    .prepare(
      `SELECT id, aba, coluna, apelido, criado_em FROM mapeamentos_importacao
        WHERE cliente_id = ?${condicao} ORDER BY aba, coluna, apelido`,
    )
    .all(...params) as Mapeamento[];
}

/** Os apelidos do cliente para uma aba, no formato que `mapearColunas` espera. */
export function apelidosDoCliente(clienteId: number | null | undefined, aba: NomeAba): Record<string, string[]> {
  if (!clienteId) return {};
  const linhas = db()
    .prepare('SELECT coluna, apelido FROM mapeamentos_importacao WHERE cliente_id = ? AND aba = ?')
    .all(clienteId, aba) as Array<{ coluna: string; apelido: string }>;
  const saida: Record<string, string[]> = {};
  for (const l of linhas) (saida[l.coluna] ??= []).push(l.apelido);
  return saida;
}

export function criarMapeamento(
  clienteId: number,
  dados: { aba: string; coluna: string; apelido: string },
): Mapeamento {
  const aba = String(dados.aba ?? '').trim() as NomeAba;
  const coluna = String(dados.coluna ?? '').trim();
  const apelido = String(dados.apelido ?? '').trim();
  if (!ABAS[aba]) throw erroValidacao(`Aba "${aba}" não faz parte do template.`);
  if (!ABAS[aba].colunas.includes(coluna)) {
    throw erroValidacao(`A aba ${aba} não tem a coluna "${coluna}". Colunas: ${ABAS[aba].colunas.join(', ')}.`);
  }
  if (!apelido) throw erroValidacao('Informe o cabeçalho usado na planilha do cliente.');
  // Apelido que já é o nome canônico de OUTRA coluna faria a planilha entrar
  // com o dado na coluna errada — e sem erro nenhum, que é o pior jeito.
  const conflito = ABAS[aba].colunas.find(
    (c) => c !== coluna && normalizarCabecalho(c) === normalizarCabecalho(apelido),
  );
  if (conflito) {
    throw erroValidacao(`"${apelido}" já é o nome da coluna "${conflito}" nesta aba. Escolha outro cabeçalho.`);
  }

  const existente = db()
    .prepare('SELECT id, coluna FROM mapeamentos_importacao WHERE cliente_id = ? AND aba = ? AND apelido = ?')
    .get(clienteId, aba, apelido) as { id: number; coluna: string } | undefined;
  if (existente) {
    if (existente.coluna === coluna) return obterMapeamento(existente.id);
    throw erroValidacao(`"${apelido}" já está apontando para a coluna "${existente.coluna}" nesta aba.`);
  }

  const info = db()
    .prepare('INSERT INTO mapeamentos_importacao (cliente_id, aba, coluna, apelido) VALUES (?, ?, ?, ?)')
    .run(clienteId, aba, coluna, apelido);
  return obterMapeamento(Number(info.lastInsertRowid));
}

function obterMapeamento(id: number): Mapeamento {
  return db()
    .prepare('SELECT id, aba, coluna, apelido, criado_em FROM mapeamentos_importacao WHERE id = ?')
    .get(id) as Mapeamento;
}

export function removerMapeamento(clienteId: number, id: number): { removidos: number } {
  const info = db()
    .prepare('DELETE FROM mapeamentos_importacao WHERE id = ? AND cliente_id = ?')
    .run(id, clienteId);
  return { removidos: info.changes };
}
