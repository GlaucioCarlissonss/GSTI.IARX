import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, idTipoDespesa, mesRelativo } from './apoio.js';
import { criarLancamento, listarLancamentos } from '../src/domain/financeiro.js';
import { criarProjeto, criarTarefa, listarProjetos, listarTarefas } from '../src/domain/projetos.js';
import { registrarTicketSla, listarTicketsSla } from '../src/domain/sla.js';
import { criarFilial, criarTopicoAjuda, listarFilas } from '../src/domain/cadastros.js';
import { exportarXlsx } from '../src/domain/exportacao.js';
import { importarPlanilha } from '../src/domain/importacao.js';
import { escreverCsv, lerCsv } from '../src/lib/planilha.js';

test('CSV é lido com separador ";", aspas e BOM', () => {
  const csv = escreverCsv(['Tipo de Despesa', 'Competência', 'Valor'], [
    { 'Tipo de Despesa': 'Serviços Técnicos; urgentes', Competência: '03/2026', Valor: '1.234,56' },
  ]);
  const linhas = lerCsv(csv);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0]!['Tipo de Despesa'], 'Serviços Técnicos; urgentes');
  assert.equal(linhas[0]!['Valor'], '1.234,56');
});

test('exportar e reimportar não duplica nem perde registros', async () => {
  const { ctx } = ambienteLimpo();
  const filial = criarFilial(ctx, { nome: 'Filial Norte', cidade: 'Natal', uf: 'RN' });

  criarLancamento(ctx, {
    filialId: filial.id,
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(0),
    valor: 1500.5,
    natureza: 'fixa',
    classificacao: 'despesa',
    descricao: 'Contrato anual',
  });
  criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx, 'Equipamentos de TI'),
    competencia: mesRelativo(1),
    valor: 9000,
    natureza: 'pontual_parcelada',
    classificacao: 'investimento',
    qtdParcelas: 3,
    descricao: 'Renovação de notebooks',
  });

  const antes = listarLancamentos(ctx, { limite: 500 });
  assert.equal(antes.total, 4); // 1 fixa + 3 parcelas

  const planilha = await exportarXlsx(ctx, 'completo');
  const resultado = await importarPlanilha(ctx, planilha, {
    modulo: 'completo',
    arquivoNome: 'reimportacao.xlsx',
  });

  assert.equal(resultado.com_erro, 0, JSON.stringify(resultado.erros));
  assert.equal(resultado.importadas, 0, 'nada novo deve entrar');
  assert.ok(resultado.duplicadas >= 4, 'todas as linhas já existiam');

  const depois = listarLancamentos(ctx, { limite: 500 });
  assert.equal(depois.total, antes.total);
  assert.equal(depois.total_valor, antes.total_valor);
});

test('exportação completa preserva projetos, tarefas e SLA na reimportação', async () => {
  const { ctx } = ambienteLimpo();
  const projeto = criarProjeto(ctx, {
    nome: 'Migração de ERP',
    mesInicio: mesRelativo(-2),
    mesFimPlanejado: mesRelativo(4),
  });
  criarTarefa(ctx, projeto.id, {
    nome: 'Levantamento de requisitos',
    mesInicio: mesRelativo(-2),
    mesFimPlanejado: mesRelativo(-1),
    responsavel: 'Equipe de TI',
  });
  const topico = criarTopicoAjuda(ctx, 'Acesso e senha');
  const fila = (listarFilas(ctx) as Array<{ id: number; nome: string }>)[0]!;
  registrarTicketSla(ctx, {
    competencia: mesRelativo(-1),
    filaId: fila.id,
    topicoAjudaId: topico.id,
    totalAtendidos: 120,
    dentroSla: 108,
  });

  const planilha = await exportarXlsx(ctx, 'completo');
  const resultado = await importarPlanilha(ctx, planilha, { modulo: 'completo', arquivoNome: 'base.xlsx' });

  assert.equal(resultado.com_erro, 0, JSON.stringify(resultado.erros));
  assert.equal(listarProjetos(ctx).length, 1);
  assert.equal(listarTarefas(ctx, projeto.id).length, 1);
  assert.equal(listarTicketsSla(ctx).itens.length, 1);
});

test('linhas inválidas entram no relatório sem abortar o lote', async () => {
  const { ctx } = ambienteLimpo();
  const csv = escreverCsv(
    ['Filial', 'Tipo de Despesa', 'Competência', 'Valor', 'Natureza', 'Classificação'],
    [
      { Filial: '', 'Tipo de Despesa': 'Licenças de Softwares', Competência: '03/2026', Valor: '1.000,00', Natureza: 'fixa', Classificação: 'despesa' },
      { Filial: '', 'Tipo de Despesa': 'Licenças de Softwares', Competência: '2026-03-15', Valor: '500', Natureza: 'fixa', Classificação: 'despesa' },
      { Filial: '', 'Tipo de Despesa': 'Licenças de Softwares', Competência: '04/2026', Valor: 'mil reais', Natureza: 'fixa', Classificação: 'despesa' },
      { Filial: '', 'Tipo de Despesa': 'Licenças de Softwares', Competência: '05/2026', Valor: '300', Natureza: 'eventual', Classificação: 'despesa' },
      { Filial: '', 'Tipo de Despesa': 'Novíssimo tipo', Competência: '06/2026', Valor: '200', Natureza: 'fixa', Classificação: 'investimento' },
    ],
  );

  const resultado = await importarPlanilha(ctx, Buffer.from(csv, 'utf8'), {
    modulo: 'financeiro',
    arquivoNome: 'lote.csv',
  });

  assert.equal(resultado.total_linhas, 5);
  assert.equal(resultado.importadas, 2, 'as linhas válidas entram');
  assert.equal(resultado.com_erro, 3);
  assert.deepEqual(
    resultado.erros.map((e) => e.linha),
    [3, 4, 5],
  );
  assert.match(resultado.erros[0]!.mensagem, /Competência/);
  assert.match(resultado.erros[1]!.mensagem, /Valor/);
  assert.match(resultado.erros[2]!.mensagem, /Natureza/);
  assert.deepEqual(resultado.cadastros_criados.tipos_despesa, ['Novíssimo tipo']);
});

test('importar o mesmo arquivo duas vezes é idempotente', async () => {
  const { ctx } = ambienteLimpo();
  const csv = Buffer.from(
    escreverCsv(
      ['Tipo de Despesa', 'Competência', 'Valor', 'Natureza', 'Classificação', 'Descrição'],
      [
        { 'Tipo de Despesa': 'Telefonia/Internet', Competência: '03/2026', Valor: '400,00', Natureza: 'fixa', Classificação: 'despesa', Descrição: 'Link matriz' },
        { 'Tipo de Despesa': 'Telefonia/Internet', Competência: '03/2026', Valor: '400,00', Natureza: 'fixa', Classificação: 'despesa', Descrição: 'Link filial' },
      ],
    ),
    'utf8',
  );

  const primeira = await importarPlanilha(ctx, csv, { modulo: 'financeiro', arquivoNome: 'mes.csv' });
  assert.equal(primeira.importadas, 2);

  const segunda = await importarPlanilha(ctx, csv, { modulo: 'financeiro', arquivoNome: 'mes.csv' });
  assert.equal(segunda.importadas, 0);
  assert.equal(segunda.duplicadas, 2);
  assert.equal(segunda.arquivo_ja_importado, true);
  assert.equal(listarLancamentos(ctx).total, 2);
});

test('simulação valida sem gravar', async () => {
  const { ctx } = ambienteLimpo();
  const csv = Buffer.from(
    escreverCsv(
      ['Tipo de Despesa', 'Competência', 'Valor', 'Natureza', 'Classificação'],
      [{ 'Tipo de Despesa': 'Pessoas', Competência: '03/2026', Valor: '10.000,00', Natureza: 'fixa', Classificação: 'despesa' }],
    ),
    'utf8',
  );
  const simulacao = await importarPlanilha(ctx, csv, { modulo: 'financeiro', arquivoNome: 'x.csv', simular: true });
  assert.equal(simulacao.importadas, 1);
  assert.equal(listarLancamentos(ctx).total, 0, 'nada foi gravado');
});

test('cabeçalho com apelidos e acentuação diferente ainda é aceito', async () => {
  const { ctx } = ambienteLimpo();
  const csv = Buffer.from(
    escreverCsv(
      ['FILIAL', 'TIPO', 'MES', 'VALOR', 'NATUREZA', 'CLASSIFICACAO'],
      [{ FILIAL: '', TIPO: 'Materiais de TI', MES: '07/2026', VALOR: 'R$ 89,90', NATUREZA: 'Pontual Única', CLASSIFICACAO: 'Despesa' }],
    ),
    'utf8',
  );
  const resultado = await importarPlanilha(ctx, csv, { modulo: 'financeiro', arquivoNome: 'apelidos.csv' });
  assert.equal(resultado.com_erro, 0, JSON.stringify(resultado.erros));
  assert.equal(resultado.importadas, 1);
  assert.equal(listarLancamentos(ctx).total_valor, 89.9);
});

test('importação não entra em competência fechada', async () => {
  const { ctx } = ambienteLimpo();
  const { fecharCompetencia } = await import('../src/domain/fechamento.js');
  fecharCompetencia(ctx, '2026-03', 'Fechado.');
  const csv = Buffer.from(
    escreverCsv(
      ['Tipo de Despesa', 'Competência', 'Valor', 'Natureza', 'Classificação'],
      [{ 'Tipo de Despesa': 'Pessoas', Competência: '03/2026', Valor: '100', Natureza: 'fixa', Classificação: 'despesa' }],
    ),
    'utf8',
  );
  const resultado = await importarPlanilha(ctx, csv, { modulo: 'financeiro', arquivoNome: 'fechado.csv' });
  assert.equal(resultado.importadas, 0);
  assert.equal(resultado.com_erro, 1);
  assert.match(resultado.erros[0]!.mensagem, /fechada/);
});
