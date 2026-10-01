/**
 * O FAVORECIDO — a quem se pagou — em todo o financeiro.
 *
 * A coluna `lancamentos.fornecedor` existia e era gravada desde sempre pela
 * carga de Contas a Pagar. O que faltava era leitura: o mapeador de linha a
 * descartava, e daí para a frente nenhuma tela tinha o que mostrar. Quem
 * precisava do favorecido digitava-o dentro da Descrição — e por isso ele não
 * somava, não filtrava e não conciliava.
 *
 * O que se prova aqui é o caminho inteiro: volta da consulta, entra pela rota,
 * é corrigido na edição, é encontrado pela busca, aparece no detalhamento que
 * quatro telas consomem, e sai e volta pela planilha.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, idTipoDespesa, mesRelativo } from './apoio.js';
import {
  atualizarLancamento,
  criarLancamento,
  listarLancamentos,
  obterLancamento,
} from '../src/domain/financeiro.js';
import { lancamentosDoRelatorio } from '../src/domain/relatorio.js';
import { escopoDoCliente } from '../src/domain/escopo-operacao.js';
import { exportarXlsx } from '../src/domain/exportacao.js';
import { importarPlanilha } from '../src/domain/importacao.js';
import { lerXlsx } from '../src/lib/planilha.js';
import { ABAS } from '../src/domain/templates.js';
import type { Contexto } from '../src/domain/contexto.js';

const COMP = mesRelativo(0);

function lancar(ctx: Contexto, descricao: string, fornecedor: string | null) {
  return criarLancamento(ctx, {
    filialId: null,
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: COMP,
    valor: 1000,
    natureza: 'fixa',
    classificacao: 'despesa',
    descricao,
    fornecedor,
  });
}

const porDescricao = (ctx: Contexto, d: string) =>
  listarLancamentos(ctx, {}).itens.find((l) => l.descricao === d)!;

test('o fornecedor volta da listagem e da ficha', () => {
  const { ctx } = ambienteLimpo();
  const l = lancar(ctx, 'Link dedicado', 'TELECOM ATLÂNTICO');

  // Era exatamente aqui que o campo morria: o SELECT trazia e o mapeador
  // descartava, então nenhuma tela tinha o que mostrar.
  assert.equal(porDescricao(ctx, 'Link dedicado').fornecedor, 'TELECOM ATLÂNTICO');
  assert.equal(obterLancamento(ctx, l.id).fornecedor, 'TELECOM ATLÂNTICO');
});

test('lançamento sem fornecedor volta nulo, e não em branco disfarçado', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, 'Sem favorecido', null);
  assert.equal(porDescricao(ctx, 'Sem favorecido').fornecedor, null);
});

test('editar corrige o favorecido, e não mexe no que não foi enviado', () => {
  const { ctx } = ambienteLimpo();
  const l = lancar(ctx, 'Com erro de digitação', 'TELECON ATLANTICO');

  atualizarLancamento(ctx, l.id, { fornecedor: 'TELECOM ATLÂNTICO' });
  const depois = obterLancamento(ctx, l.id);
  assert.equal(depois.fornecedor, 'TELECOM ATLÂNTICO');
  assert.equal(depois.descricao, 'Com erro de digitação', 'o resto da linha fica como estava');

  // Campo não enviado permanece — a mesma regra de origem do custo e destino.
  atualizarLancamento(ctx, l.id, { descricao: 'Corrigida' });
  assert.equal(obterLancamento(ctx, l.id).fornecedor, 'TELECOM ATLÂNTICO');

  // `null` explícito limpa, que é diferente de não enviar.
  atualizarLancamento(ctx, l.id, { fornecedor: null });
  assert.equal(obterLancamento(ctx, l.id).fornecedor, null);
});

test('a busca encontra pelo fornecedor — o que o campo já prometia', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, 'Circuito principal', 'TELECOM ATLÂNTICO');
  lancar(ctx, 'Licença de gestão', 'SOFTWARE ANDORINHA');

  // O placeholder das telas diz "fornecedor, motivo…" desde sempre, e a busca
  // procurava em tudo menos nele.
  const achados = listarLancamentos(ctx, { busca: 'ANDORINHA' }).itens;
  assert.equal(achados.length, 1);
  assert.equal(achados[0]!.descricao, 'Licença de gestão');
});

test('o detalhamento que quatro telas abrem traz o fornecedor', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, 'Link dedicado', 'TELECOM ATLÂNTICO');

  // Conferência, Financeiro, Painel Executivo e Relatório consomem esta mesma
  // consulta: uma coluna aqui aparece nas quatro.
  const { itens } = lancamentosDoRelatorio(ctx, {});
  const alvo = (itens as unknown as Array<Record<string, unknown>>).find(
    (l) => l.descricao === 'Link dedicado',
  )!;
  assert.equal(alvo.fornecedor, 'TELECOM ATLÂNTICO');
});

test('a planilha leva e traz o favorecido', async () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, 'Link dedicado', 'TELECOM ATLÂNTICO');
  assert.ok(ABAS.Financeiro.colunas.includes('Fornecedor'));
  assert.ok(!ABAS.Financeiro.obrigatorias.includes('Fornecedor'), 'arquivo antigo continua entrando');

  const { buffer } = await exportarXlsx(ctx, escopoDoCliente(ctx), 'financeiro');
  const aba = (await lerXlsx(buffer)).find((a) => a.nome === 'Financeiro')!;
  assert.equal(aba.linhas[0]!['Fornecedor'], 'TELECOM ATLÂNTICO');

  const destino = ambienteLimpo();
  const r = await importarPlanilha(destino.ctx, buffer, { modulo: 'financeiro', arquivoNome: 'ida.xlsx' });
  assert.equal(r.com_erro, 0, JSON.stringify(r.erros));
  assert.equal(porDescricao(destino.ctx, 'Link dedicado').fornecedor, 'TELECOM ATLÂNTICO');
});

test('o apelido "Favorecido" no cabeçalho é aceito', async () => {
  const { ctx } = ambienteLimpo();
  const csv = [
    'Tipo de Despesa;Competência;Valor;Natureza;Classificação;Descrição;Favorecido',
    `Licenças de Softwares;${COMP};1000,00;Fixa;Despesa;Pelo apelido;NUVEM MERIDIANA`,
  ].join('\n');

  const r = await importarPlanilha(ctx, Buffer.from(csv, 'utf8'), {
    modulo: 'financeiro',
    arquivoNome: 'apelido.csv',
  });
  assert.equal(r.com_erro, 0, JSON.stringify(r.erros));
  assert.equal(porDescricao(ctx, 'Pelo apelido').fornecedor, 'NUVEM MERIDIANA');
});
