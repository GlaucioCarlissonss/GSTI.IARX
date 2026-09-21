/**
 * A coluna "Reconhecido" da planilha (modelo 1.6).
 *
 * O template promete "backup, migração e reimportação sem perda", e até aqui o
 * estado de conferência ficava de fora: exportar a base e reimportá-la noutro
 * lugar devolvia tudo por reconhecer, como se ninguém tivesse olhado nada.
 *
 * O que se prova aqui é a coluna E o limite dela. São três estados, não dois:
 * `Sim`, `Não` e VAZIO — e o vazio não é "não". Coluna ausente ou célula em
 * branco não afirmam coisa alguma, e é isso que impede um arquivo antigo,
 * reimportado por cima da base viva, de desfazer a conferência de quem
 * trabalhou.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, idTipoDespesa, mesRelativo } from './apoio.js';
import { criarLancamento, listarLancamentos, reconhecerLancamentos } from '../src/domain/financeiro.js';
import { escopoDoCliente } from '../src/domain/escopo-operacao.js';
import { exportarXlsx } from '../src/domain/exportacao.js';
import { importarPlanilha } from '../src/domain/importacao.js';
import { lerXlsx } from '../src/lib/planilha.js';
import { TEMPLATE_VERSAO_ATUAL, ABAS } from '../src/domain/templates.js';
import type { Contexto } from '../src/domain/contexto.js';

const COMP = mesRelativo(0);

function lancar(ctx: Contexto, descricao: string) {
  return criarLancamento(ctx, {
    filialId: null,
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: COMP,
    valor: 1000,
    natureza: 'fixa',
    classificacao: 'despesa',
    descricao,
  });
}

const porDescricao = (ctx: Contexto, descricao: string) =>
  listarLancamentos(ctx, {}).itens.find((l) => l.descricao === descricao)!;

test('a coluna existe no modelo, e fora das obrigatórias', () => {
  assert.equal(TEMPLATE_VERSAO_ATUAL, '1.6');
  assert.ok(ABAS.Financeiro.colunas.includes('Reconhecido'));
  // Fora das obrigatórias de propósito: um arquivo 1.5 continua entrando.
  assert.ok(!ABAS.Financeiro.obrigatorias.includes('Reconhecido'));
});

test('a exportação diz o estado de cada lançamento, sem deixar célula vazia', async () => {
  const { ctx } = ambienteLimpo();
  const conferido = lancar(ctx, 'Conferido na tela');
  lancar(ctx, 'Ainda por conferir');
  reconhecerLancamentos(ctx, [conferido.id], true);

  const { buffer } = await exportarXlsx(ctx, escopoDoCliente(ctx), 'financeiro');
  const financeiro = (await lerXlsx(buffer)).find((a) => a.nome === 'Financeiro')!;
  const de = (d: string) => financeiro.linhas.find((l) => String(l['Descrição']) === d)!;

  // Sempre Sim ou Não: vazio é o que a importação lê como "não mexa nisto", e
  // uma exportação precisa afirmar o estado que tem.
  assert.equal(de('Conferido na tela')['Reconhecido'], 'Sim');
  assert.equal(de('Ainda por conferir')['Reconhecido'], 'Não');
});

test('exportar e importar numa base nova preserva a conferência', async () => {
  const { ctx } = ambienteLimpo();
  const conferido = lancar(ctx, 'Conferido na tela');
  lancar(ctx, 'Ainda por conferir');
  reconhecerLancamentos(ctx, [conferido.id], true);
  const { buffer } = await exportarXlsx(ctx, escopoDoCliente(ctx), 'financeiro');

  // Base nova: é o caso de migração que o template promete atender.
  const destino = ambienteLimpo();
  const r = await importarPlanilha(destino.ctx, buffer, { modulo: 'financeiro', arquivoNome: 'ida.xlsx' });
  assert.equal(r.com_erro, 0, JSON.stringify(r.erros));
  assert.equal(r.importadas, 2);

  const veio = porDescricao(destino.ctx, 'Conferido na tela');
  assert.equal(veio.reconhecido, true);
  // Nem 'manual' nem 'cadastro_origem': foi a planilha que afirmou, e quem
  // importou não é quem conferiu.
  assert.equal(veio.reconhecido_via, 'planilha');
  assert.equal(porDescricao(destino.ctx, 'Ainda por conferir').reconhecido, false);
});

test('"Sim" na planilha faz a despesa entrar já reconhecida', async () => {
  const { ctx } = ambienteLimpo();
  const csv = [
    'Tipo de Despesa;Competência;Valor;Natureza;Classificação;Descrição;Reconhecido',
    `Licenças de Softwares;${COMP};1000,00;Fixa;Despesa;Com Sim;Sim`,
    `Licenças de Softwares;${COMP};2000,00;Fixa;Despesa;Com Nao;Não`,
    `Licenças de Softwares;${COMP};3000,00;Fixa;Despesa;Em branco;`,
  ].join('\n');

  const r = await importarPlanilha(ctx, Buffer.from(csv, 'utf8'), {
    modulo: 'financeiro',
    arquivoNome: 'rec.csv',
  });
  assert.equal(r.com_erro, 0, JSON.stringify(r.erros));
  assert.equal(r.importadas, 3);

  assert.equal(porDescricao(ctx, 'Com Sim').reconhecido, true);
  assert.equal(porDescricao(ctx, 'Com Nao').reconhecido, false);
  // Célula vazia não afirma nada, e o lançamento nasce como sempre nasceu.
  assert.equal(porDescricao(ctx, 'Em branco').reconhecido, false);
  assert.equal(porDescricao(ctx, 'Em branco').reconhecido_via, null);
});

test('arquivo 1.5, sem a coluna, continua entrando', async () => {
  const { ctx } = ambienteLimpo();
  const csv = [
    'Tipo de Despesa;Competência;Valor;Natureza;Classificação;Descrição',
    `Licenças de Softwares;${COMP};1000,00;Fixa;Despesa;Sem a coluna`,
  ].join('\n');

  const r = await importarPlanilha(ctx, Buffer.from(csv, 'utf8'), {
    modulo: 'financeiro',
    arquivoNome: 'antigo.csv',
  });
  assert.equal(r.com_erro, 0, JSON.stringify(r.erros));
  assert.equal(r.importadas, 1);
  assert.equal(porDescricao(ctx, 'Sem a coluna').reconhecido, false);
});

test('reimportar um arquivo antigo NÃO desfaz a conferência de ninguém', async () => {
  const { ctx } = ambienteLimpo();
  const lanc = lancar(ctx, 'Conferido depois de exportar');

  // O arquivo sai ANTES da conferência: nele a coluna diz "Não".
  const { buffer } = await exportarXlsx(ctx, escopoDoCliente(ctx), 'financeiro');
  const antes = (await lerXlsx(buffer)).find((a) => a.nome === 'Financeiro')!;
  assert.equal(antes.linhas[0]!['Reconhecido'], 'Não');

  reconhecerLancamentos(ctx, [lanc.id], true);
  assert.equal(porDescricao(ctx, 'Conferido depois de exportar').reconhecido, true);

  // Reimportar o arquivo velho: a linha já existe, sai por duplicada e nada é
  // tocado — é o mesmo tratamento de todo campo fora da chave de conteúdo.
  const r = await importarPlanilha(ctx, buffer, { modulo: 'financeiro', arquivoNome: 'velho.xlsx' });
  assert.equal(r.importadas, 0, 'nada entra de novo');
  assert.equal(
    porDescricao(ctx, 'Conferido depois de exportar').reconhecido,
    true,
    'a conferência feita na tela sobrevive à reimportação',
  );
});
