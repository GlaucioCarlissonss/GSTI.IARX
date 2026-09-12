import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo } from './apoio.js';
import {
  ABA_INSTRUCOES,
  ABA_TICKETS,
  abasDeTickets,
  COLUNAS_TICKET,
  importarTickets,
  previewDeTickets,
} from '../src/domain/planilha-tickets.js';
import { escreverXlsx, type Aba } from '../src/lib/planilha.js';
import { gravarChamado, listarChamados, normalizarOstick } from '../src/domain/suporte.js';
import { SETOR_NAO_CLASSIFICADO } from '../src/domain/cadastros.js';

/** Monta um arquivo com as linhas dadas, como o gestor enviaria. */
async function arquivoCom(linhas: Array<Record<string, unknown>>): Promise<Buffer> {
  const abas: Aba[] = [{ nome: ABA_TICKETS, colunas: [...COLUNAS_TICKET], linhas }];
  return escreverXlsx(abas);
}

const LINHA_BOA = {
  external_id: '21734',
  source_system: 'OSTICK',
  title: 'Impressora sem toner',
  description: 'Parou de imprimir no 3º andar.',
  status: 'closed',
  priority: 'high',
  sector: 'Enfermagem',
  attendant_name: 'Carlos',
  requester_name: 'Ana',
  requester_email: 'ana@empresa.com',
  created_at: '10/09/2026 08:30',
};

test('o template tem a aba de dados e a de instruções', () => {
  const { ctx } = ambienteLimpo();
  const abas = abasDeTickets(ctx, {}, true);
  assert.deepEqual(abas.map((a) => a.nome), [ABA_TICKETS, ABA_INSTRUCOES]);
  assert.deepEqual(abas[0].colunas, [...COLUNAS_TICKET]);
  assert.equal(abas[0].linhas.length, 0, 'o modelo vem vazio: é para preencher');

  // Sem a aba de instruções, quem preenche à mão descobre as regras errando.
  const instrucoes = abas[1].linhas as Array<Record<string, string>>;
  assert.equal(instrucoes.length, COLUNAS_TICKET.length, 'uma linha de instrução por coluna');
  const doStatus = instrucoes.find((l) => l.Coluna === 'status');
  assert.match(String(doStatus?.['Valores aceitos']), /open/);
  assert.match(String(doStatus?.['Valores aceitos']), /closed/);
});

test('a exportação leva o recorte da tela, e não a base inteira', () => {
  const { ctx } = ambienteLimpo();
  for (const [id, sistema, assunto] of [
    ['1', 'OSTICK', 'Do OStick'],
    ['2', 'BITRIX24', 'Do Bitrix'],
  ] as Array<[string, 'OSTICK' | 'BITRIX24', string]>) {
    const bruto = { ticket_id: id, ID: id, subject: assunto, TITLE: assunto, status: 'open',
      STAGE_ID: 'NEW', created: '2026-08-01T09:00:00Z', CREATED_TIME: '2026-08-01T09:00:00Z' };
    gravarChamado(ctx.empresaId, { ...normalizarOstick(bruto), source_system: sistema }, bruto);
  }

  const tudo = abasDeTickets(ctx, {});
  assert.equal(tudo[0].linhas.length, 2);

  const soOstick = abasDeTickets(ctx, { sistemas: ['OSTICK'] });
  assert.equal(soOstick[0].linhas.length, 1);
  assert.equal((soOstick[0].linhas[0] as Record<string, string>).source_system, 'OSTICK');
});

test('a prévia diz linha a linha o que vai acontecer, sem gravar nada', async () => {
  const { ctx } = ambienteLimpo();
  const arquivo = await arquivoCom([LINHA_BOA, { ...LINHA_BOA, external_id: '21735', title: 'Outro' }]);

  const previa = await previewDeTickets(ctx, arquivo);
  assert.equal(previa.total, 2);
  assert.equal(previa.validas, 2);
  assert.equal(previa.a_criar, 2);
  assert.equal(previa.a_atualizar, 0);
  // A linha do arquivo, contando o cabeçalho: é o número que o Excel mostra.
  assert.deepEqual(previa.linhas.map((l) => l.linha), [2, 3]);

  // Prévia não grava: o gestor ainda não confirmou.
  assert.equal(listarChamados(ctx.empresaId, {}).paginacao.total, 0);
});

test('a prévia distingue criar de atualizar', async () => {
  const { ctx } = ambienteLimpo();
  await importarTickets(ctx, await arquivoCom([LINHA_BOA]));

  const previa = await previewDeTickets(ctx, await arquivoCom([
    { ...LINHA_BOA, title: 'Assunto corrigido' },
    { ...LINHA_BOA, external_id: '99999', title: 'Novo' },
  ]));
  assert.equal(previa.a_atualizar, 1);
  assert.equal(previa.a_criar, 1);
  assert.equal(previa.linhas[0].efeito, 'atualizar');
  assert.equal(previa.linhas[1].efeito, 'criar');
});

test('cada regra de validação tem mensagem que diz o que corrigir', async () => {
  const { ctx } = ambienteLimpo();
  const previa = await previewDeTickets(ctx, await arquivoCom([
    { ...LINHA_BOA, external_id: '' },
    { ...LINHA_BOA, external_id: 'a2', source_system: 'ZENDESK' },
    { ...LINHA_BOA, external_id: 'a3', title: '' },
    { ...LINHA_BOA, external_id: 'a4', status: 'pendente' },
    { ...LINHA_BOA, external_id: 'a5', priority: 'altíssima' },
    { ...LINHA_BOA, external_id: 'a6', requester_email: 'ana(arroba)empresa' },
    { ...LINHA_BOA, external_id: 'a7', created_at: 'ontem' },
  ]));

  assert.equal(previa.validas, 0);
  const motivos = previa.linhas.map((l) => l.mensagem ?? '');
  assert.match(motivos[0], /external_id.*obrigat/i);
  assert.match(motivos[1], /source_system.*OSTICK.*BITRIX24/i);
  assert.match(motivos[2], /title.*obrigat/i);
  assert.match(motivos[3], /status.*open/i);
  assert.match(motivos[4], /priority.*low/i);
  assert.match(motivos[5], /requester_email.*válido/i);
  assert.match(motivos[6], /created_at.*data/i);
  // Nenhuma mensagem pode expor detalhe técnico interno.
  assert.equal(motivos.some((m) => /undefined|SqliteError|at Object/.test(m)), false);
});

test('external_id repetido dentro do arquivo é erro, e aponta a outra linha', async () => {
  const { ctx } = ambienteLimpo();
  const previa = await previewDeTickets(ctx, await arquivoCom([LINHA_BOA, { ...LINHA_BOA, title: 'A mesma coisa' }]));
  // Das duas linhas, o sistema não tem como saber qual é a boa — então recusa
  // a segunda e diz onde está a primeira.
  assert.equal(previa.validas, 1);
  assert.equal(previa.linhas[1].valida, false);
  assert.match(String(previa.linhas[1].mensagem), /repetido.*linha 2/i);
});

test('importar cria, reimportar atualiza, e nunca duplica', async () => {
  const { ctx } = ambienteLimpo();
  const primeira = await importarTickets(ctx, await arquivoCom([LINHA_BOA]));
  assert.deepEqual(
    { criados: primeira.criados, atualizados: primeira.atualizados, rejeitados: primeira.rejeitados },
    { criados: 1, atualizados: 0, rejeitados: 0 },
  );

  const segunda = await importarTickets(ctx, await arquivoCom([{ ...LINHA_BOA, title: 'Assunto corrigido' }]));
  assert.deepEqual(
    { criados: segunda.criados, atualizados: segunda.atualizados, rejeitados: segunda.rejeitados },
    { criados: 0, atualizados: 1, rejeitados: 0 },
  );

  const lista = listarChamados(ctx.empresaId, {});
  assert.equal(lista.paginacao.total, 1, 'a mesma chave não pode virar dois chamados');
  assert.equal((lista.itens[0] as Record<string, string>).assunto, 'Assunto corrigido');
});

test('linha inválida é rejeitada sem derrubar as boas', async () => {
  const { ctx } = ambienteLimpo();
  const r = await importarTickets(ctx, await arquivoCom([
    LINHA_BOA,
    { ...LINHA_BOA, external_id: 'ruim', status: 'inventado' },
    { ...LINHA_BOA, external_id: '21736', title: 'Terceira' },
  ]));
  // Recusar o arquivo inteiro por um erro de digitação faria o gestor refazer
  // o trabalho todo.
  assert.equal(r.criados, 2);
  assert.equal(r.rejeitados, 1);
  assert.equal(r.erros[0].linha, 3);
  assert.equal(r.erros[0].external_id, 'ruim');
  assert.equal(listarChamados(ctx.empresaId, {}).paginacao.total, 2);
});

test('sector em branco entra como "Não classificado", e não recusa a linha', async () => {
  const { ctx } = ambienteLimpo();
  const r = await importarTickets(ctx, await arquivoCom([{ ...LINHA_BOA, sector: '' }]));
  assert.equal(r.criados, 1);
  const c = listarChamados(ctx.empresaId, {}).itens[0] as Record<string, string>;
  assert.equal(c.setor, SETOR_NAO_CLASSIFICADO);
});

test('status e priority em branco caem no padrão', async () => {
  const { ctx } = ambienteLimpo();
  await importarTickets(ctx, await arquivoCom([{ ...LINHA_BOA, status: '', priority: '' }]));
  const c = listarChamados(ctx.empresaId, {}).itens[0] as Record<string, string>;
  assert.equal(c.status, 'open');
  assert.equal(c.prioridade, 'medium');
});

test('data no formato brasileiro e em ISO dão o mesmo resultado', async () => {
  const { ctx } = ambienteLimpo();
  await importarTickets(ctx, await arquivoCom([
    { ...LINHA_BOA, external_id: 'br', created_at: '10/09/2026 08:30' },
    { ...LINHA_BOA, external_id: 'iso', created_at: '2026-09-10T08:30:00' },
  ]));
  const itens = listarChamados(ctx.empresaId, {}).itens as Array<Record<string, string>>;
  const br = itens.find((c) => c.external_id === 'br');
  const iso = itens.find((c) => c.external_id === 'iso');
  assert.equal(br?.competencia, iso?.competencia);
  assert.equal(br?.competencia, '2026-09');
});

test('arquivo sem a aba de dados explica o que fazer', async () => {
  const { ctx } = ambienteLimpo();
  const outro = await escreverXlsx([{ nome: 'Planilha1', colunas: ['a'], linhas: [{ a: 1 }] }]);
  await assert.rejects(() => previewDeTickets(ctx, outro), /aba "Tickets".*modelo/is);
});

test('arquivo sem coluna obrigatória diz quais faltam', async () => {
  const { ctx } = ambienteLimpo();
  const capenga = await escreverXlsx([
    { nome: ABA_TICKETS, colunas: ['external_id', 'status'], linhas: [{ external_id: '1', status: 'open' }] },
  ]);
  await assert.rejects(() => previewDeTickets(ctx, capenga), /source_system.*title|title.*source_system/s);
});

test('a exportação é por empresa', () => {
  const { ctx } = ambienteLimpo();
  const bruto = { ticket_id: '7', subject: 'Meu', status: 'open', created: '2026-08-01T09:00:00Z' };
  gravarChamado(ctx.empresaId, normalizarOstick(bruto), bruto);
  const outra = { ...ctx, empresaId: ctx.empresaId + 999 };
  assert.equal(abasDeTickets(outra as typeof ctx, {})[0].linhas.length, 0);
});
