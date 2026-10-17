/**
 * A carga de dados: modo, registro e adaptador de cabeçalho.
 *
 * O que está sendo protegido aqui é a capacidade de responder, semanas depois,
 * "de onde veio este dado?" e "por que aquela carga não entrou?". Sem registro
 * da tentativa recusada, a segunda pergunta não tem onde ser respondida.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, idTipoDespesa, mesRelativo } from './apoio.js';
import { db } from '../src/db/index.js';
import { importarPlanilha, listarImportacoes, obterImportacao } from '../src/domain/importacao.js';
import { criarMapeamento, listarMapeamentos, removerMapeamento } from '../src/domain/mapeamentos.js';
import { criarLancamento, listarLancamentos } from '../src/domain/financeiro.js';
import { exportarXlsx } from '../src/domain/exportacao.js';
import { escopoDoCliente } from '../src/domain/escopo-operacao.js';
import { escreverCsv, lerXlsx } from '../src/lib/planilha.js';
import { ABA_INSTRUCOES, linhasDeInstrucoes } from '../src/domain/templates.js';

const csvFinanceiro = (colunas: string[], linhas: Array<Record<string, string>>) =>
  Buffer.from(escreverCsv(colunas, linhas), 'utf8');

// ------------------------------------------------------------------ registro

test('toda carga deixa registro, com quem fez, o modo e o resultado', async () => {
  const { ctx } = ambienteLimpo();
  const csv = csvFinanceiro(
    ['Tipo de Despesa', 'Competência', 'Valor', 'Natureza', 'Classificação'],
    [{ 'Tipo de Despesa': 'Licenças', Competência: mesRelativo(1), Valor: '100,00', Natureza: 'Fixa', Classificação: 'Despesa' }],
  );
  await importarPlanilha(ctx, csv, { modulo: 'financeiro', arquivoNome: 'mes.csv' });

  const registros = listarImportacoes(ctx) as Array<Record<string, unknown>>;
  assert.equal(registros.length, 1);
  assert.equal(registros[0]!.status, 'concluida');
  assert.equal(registros[0]!.modo, 'incremental', 'sem modo informado, a carga é do período');
  assert.equal(registros[0]!.importadas, 1);
  assert.ok(registros[0]!.usuario, 'o registro diz quem carregou');
});

test('a carga que falha ao ler o arquivo também deixa registro', async () => {
  const { ctx } = ambienteLimpo();
  await assert.rejects(
    () => importarPlanilha(ctx, Buffer.from('isto não é planilha nenhuma'), {
      modulo: 'financeiro',
      arquivoNome: 'quebrado.xlsx',
    }),
  );

  const registros = listarImportacoes(ctx) as Array<Record<string, unknown>>;
  assert.equal(registros.length, 1, 'a tentativa recusada é a que mais precisa de rastro');
  assert.equal(registros[0]!.status, 'recusada');
  assert.equal(registros[0]!.arquivo_nome, 'quebrado.xlsx');
  assert.ok(String(registros[0]!.mensagem).length > 0, 'o registro diz o motivo');
});

test('simular não deixa registro: prévia não é carga', async () => {
  const { ctx } = ambienteLimpo();
  const csv = csvFinanceiro(
    ['Tipo de Despesa', 'Competência', 'Valor', 'Natureza', 'Classificação'],
    [{ 'Tipo de Despesa': 'Licenças', Competência: '01/2030', Valor: '100,00', Natureza: 'Fixa', Classificação: 'Despesa' }],
  );
  await importarPlanilha(ctx, csv, { modulo: 'financeiro', arquivoNome: 'previa.csv', simular: true });
  assert.equal(listarImportacoes(ctx).length, 0);
  assert.equal(listarLancamentos(ctx, {}).total, 0, 'a simulação não grava nada');
});

test('o relatório da carga guarda as linhas recusadas, com o motivo', async () => {
  const { ctx } = ambienteLimpo();
  const csv = csvFinanceiro(
    ['Tipo de Despesa', 'Competência', 'Valor', 'Natureza', 'Classificação'],
    [
      { 'Tipo de Despesa': 'Licenças', Competência: '13/2030', Valor: '100,00', Natureza: 'Fixa', Classificação: 'Despesa' },
      { 'Tipo de Despesa': 'Licenças', Competência: '01/2030', Valor: 'abacaxi', Natureza: 'Fixa', Classificação: 'Despesa' },
    ],
  );
  const r = await importarPlanilha(ctx, csv, { modulo: 'financeiro', arquivoNome: 'com-erro.csv' });
  assert.equal(r.com_erro, 2);

  const registro = listarImportacoes(ctx)[0] as { id: number };
  const detalhe = obterImportacao(ctx, registro.id);
  assert.equal(detalhe.relatorio.erros.length, 2);
  // O número da linha é o que o Excel mostra: é por ele que se acha o erro.
  assert.ok(detalhe.relatorio.erros.every((e) => e.linha > 1), JSON.stringify(detalhe.relatorio.erros));
});

test('a carga de outra empresa não aparece nem é aberta', async () => {
  const { ctx } = ambienteLimpo();
  const csv = csvFinanceiro(
    ['Tipo de Despesa', 'Competência', 'Valor', 'Natureza', 'Classificação'],
    [{ 'Tipo de Despesa': 'Licenças', Competência: '01/2030', Valor: '100,00', Natureza: 'Fixa', Classificação: 'Despesa' }],
  );
  await importarPlanilha(ctx, csv, { modulo: 'financeiro', arquivoNome: 'minha.csv' });
  const minha = (listarImportacoes(ctx)[0] as { id: number }).id;

  const alheio = { ...ctx, empresaId: ctx.empresaId + 999, empresaIds: [ctx.empresaId + 999] };
  assert.throws(() => obterImportacao(alheio, minha), /não encontrada/i);
});

// --------------------------------------------------------------------- modo

test('carga inicial sobre módulo já povoado é recusada, dizendo quantos já existem', async () => {
  const { ctx } = ambienteLimpo();
  criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(1),
    valor: 500,
    natureza: 'fixa',
    classificacao: 'despesa',
  });
  const csv = csvFinanceiro(
    ['Tipo de Despesa', 'Competência', 'Valor', 'Natureza', 'Classificação'],
    [{ 'Tipo de Despesa': 'Licenças', Competência: '01/2030', Valor: '100,00', Natureza: 'Fixa', Classificação: 'Despesa' }],
  );

  await assert.rejects(
    () => importarPlanilha(ctx, csv, { modulo: 'financeiro', arquivoNome: 'historico.csv', modo: 'inicial' }),
    /já tem 1 registro/i,
  );
  // A recusa entra no registro: é o rastro de que alguém tentou recarregar.
  const registros = listarImportacoes(ctx) as Array<Record<string, unknown>>;
  assert.equal(registros[0]!.status, 'recusada');
  assert.equal(registros[0]!.modo, 'inicial');
  assert.equal(listarLancamentos(ctx, {}).total, 1, 'nada entrou');
});

test('confirmada, a carga inicial entra — e a deduplicação segue valendo', async () => {
  const { ctx } = ambienteLimpo();
  criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(1),
    valor: 500,
    natureza: 'fixa',
    classificacao: 'despesa',
  });
  const csv = csvFinanceiro(
    ['Tipo de Despesa', 'Competência', 'Valor', 'Natureza', 'Classificação'],
    [{ 'Tipo de Despesa': 'Licenças', Competência: '01/2030', Valor: '100,00', Natureza: 'Fixa', Classificação: 'Despesa' }],
  );
  const r = await importarPlanilha(ctx, csv, {
    modulo: 'financeiro',
    arquivoNome: 'historico.csv',
    modo: 'inicial',
    confirmarSobrescrita: true,
  });
  assert.equal(r.modo, 'inicial');
  assert.equal(r.importadas, 1);
  assert.equal((listarImportacoes(ctx)[0] as { status: string }).status, 'concluida');
});

test('numa base vazia, a carga inicial não pede confirmação', async () => {
  const { ctx } = ambienteLimpo();
  const csv = csvFinanceiro(
    ['Tipo de Despesa', 'Competência', 'Valor', 'Natureza', 'Classificação'],
    [{ 'Tipo de Despesa': 'Licenças', Competência: '01/2030', Valor: '100,00', Natureza: 'Fixa', Classificação: 'Despesa' }],
  );
  const r = await importarPlanilha(ctx, csv, { modulo: 'financeiro', arquivoNome: 'historico.csv', modo: 'inicial' });
  assert.equal(r.importadas, 1);
});

// --------------------------------------------------------------- adaptador

test('o cabeçalho do cliente é aceito depois de cadastrado, e só para ele', async () => {
  const { ctx } = ambienteLimpo();
  // A planilha deste cliente chama "Valor" de "Vlr Total". Sem o adaptador, a
  // coluna obrigatória some e o arquivo inteiro é recusado no cabeçalho.
  const csv = csvFinanceiro(
    ['Tipo de Despesa', 'Competência', 'Vlr Total', 'Natureza', 'Classificação'],
    [{ 'Tipo de Despesa': 'Licenças', Competência: '01/2030', 'Vlr Total': '250,00', Natureza: 'Fixa', Classificação: 'Despesa' }],
  );

  const semMapa = await importarPlanilha(ctx, csv, { modulo: 'financeiro', arquivoNome: 'cliente.csv' });
  assert.equal(semMapa.importadas, 0);
  assert.match(String(semMapa.erros[0]?.mensagem), /Valor/);

  criarMapeamento(ctx.clienteId!, { aba: 'Financeiro', coluna: 'Valor', apelido: 'Vlr Total' });
  const comMapa = await importarPlanilha(ctx, csv, { modulo: 'financeiro', arquivoNome: 'cliente2.csv' });
  assert.equal(comMapa.com_erro, 0, JSON.stringify(comMapa.erros));
  assert.equal(comMapa.importadas, 1);
  assert.equal(listarLancamentos(ctx, {}).itens[0]!.valor, 250);

  // O apelido é do cliente: outro contratante não herda o vocabulário deste.
  const outroCliente = Number(db().prepare("INSERT INTO clientes (nome) VALUES ('Outro')").run().lastInsertRowid);
  assert.equal(listarMapeamentos(outroCliente).length, 0);
});

test('apelido que já é o nome de outra coluna é recusado', () => {
  const { ctx } = ambienteLimpo();
  // "Descrição" apontando para "Observações" faria o dado entrar na coluna
  // errada, e sem erro nenhum — que é o pior jeito de errar.
  assert.throws(
    () => criarMapeamento(ctx.clienteId!, { aba: 'Financeiro', coluna: 'Observações', apelido: 'Descrição' }),
    /já é o nome da coluna "Descrição"/i,
  );
});

test('o mesmo apelido não pode apontar para duas colunas', () => {
  const { ctx } = ambienteLimpo();
  criarMapeamento(ctx.clienteId!, { aba: 'Financeiro', coluna: 'Valor', apelido: 'Custo Mensal' });
  // Repetir o mesmo par é inofensivo; mudar o destino é ambíguo.
  criarMapeamento(ctx.clienteId!, { aba: 'Financeiro', coluna: 'Valor', apelido: 'Custo Mensal' });
  assert.equal(listarMapeamentos(ctx.clienteId!).length, 1);
  assert.throws(
    () => criarMapeamento(ctx.clienteId!, { aba: 'Financeiro', coluna: 'Observações', apelido: 'Custo Mensal' }),
    /já está apontando/i,
  );
});

test('coluna que não existe na aba é recusada no cadastro', () => {
  const { ctx } = ambienteLimpo();
  assert.throws(
    () => criarMapeamento(ctx.clienteId!, { aba: 'Financeiro', coluna: 'Coluna Inventada', apelido: 'X' }),
    /não tem a coluna/i,
  );
  assert.throws(
    () => criarMapeamento(ctx.clienteId!, { aba: 'AbaInventada', coluna: 'Valor', apelido: 'X' }),
    /não faz parte do template/i,
  );
});

test('remover o apelido devolve o comportamento padrão', async () => {
  const { ctx } = ambienteLimpo();
  const m = criarMapeamento(ctx.clienteId!, { aba: 'Financeiro', coluna: 'Valor', apelido: 'Vlr Total' });
  assert.equal(removerMapeamento(ctx.clienteId!, m.id).removidos, 1);
  const csv = csvFinanceiro(
    ['Tipo de Despesa', 'Competência', 'Vlr Total', 'Natureza', 'Classificação'],
    [{ 'Tipo de Despesa': 'Licenças', Competência: '01/2030', 'Vlr Total': '250,00', Natureza: 'Fixa', Classificação: 'Despesa' }],
  );
  const r = await importarPlanilha(ctx, csv, { modulo: 'financeiro', arquivoNome: 'x.csv' });
  assert.equal(r.importadas, 0, 'sem o apelido, a coluna volta a faltar');
});

// -------------------------------------------------------------- instruções

test('o template traz a aba de instruções, derivada das próprias colunas', async () => {
  const { ctx } = ambienteLimpo();
  const buffer = (await exportarXlsx(ctx, escopoDoCliente(ctx), 'financeiro', true)).buffer;
  const abas = await lerXlsx(buffer);
  const instrucoes = abas.find((a) => a.nome === ABA_INSTRUCOES);
  assert.ok(instrucoes, 'abas: ' + abas.map((a) => a.nome).join(', '));

  const esperadas = linhasDeInstrucoes('financeiro');
  assert.equal(instrucoes!.linhas.length, esperadas.length);
  const valor = instrucoes!.linhas.find((l) => l['Coluna'] === 'Valor')!;
  assert.equal(valor['Obrigatória'], 'Sim');
  assert.match(String(valor['O que preencher']), /reais/i);
});

test('a aba de instruções não é reclamada como aba desconhecida ao reimportar', async () => {
  const { ctx } = ambienteLimpo();
  criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(1),
    valor: 500,
    natureza: 'fixa',
    classificacao: 'despesa',
  });
  const buffer = (await exportarXlsx(ctx, escopoDoCliente(ctx), 'financeiro')).buffer;
  const r = await importarPlanilha(ctx, buffer, { modulo: 'financeiro', arquivoNome: 'volta.xlsx' });
  assert.deepEqual(r.abas_ignoradas, [], 'a aba de instruções é parte do template, não sobra');
  assert.equal(r.com_erro, 0, JSON.stringify(r.erros));
});
