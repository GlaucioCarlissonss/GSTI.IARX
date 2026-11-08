/**
 * A VIGÊNCIA DO CONTRATO na planilha, nas duas pontas.
 *
 * A coluna "Contrato Vale Até" nasceu na versão hospedada, junto com o motor
 * de projeção, e o servidor ficou sem ela. As duas pontas passaram a declarar
 * o MESMO modelo `1.7` aceitando colunas diferentes — e isso é pior do que
 * faltar a coluna: um arquivo exportado de lá e importado aqui perdia a
 * vigência **em silêncio**, e todo contrato encerrado voltava a ser projetado
 * para sempre sem que ninguém visse o momento em que a informação sumiu.
 *
 * O que se prova aqui é a paridade: a coluna existe, sai, volta, aceita os
 * mesmos apelidos da outra ponta, e recusa o que não faz sentido em vez de
 * gravar calado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, idTipoDespesa, mesRelativo } from './apoio.js';
import { criarLancamento } from '../src/domain/financeiro.js';
import { exportarXlsx } from '../src/domain/exportacao.js';
import { importarPlanilha } from '../src/domain/importacao.js';
import { escopoDoCliente } from '../src/domain/escopo-operacao.js';
import { lerXlsx } from '../src/lib/planilha.js';
import { ABAS } from '../src/domain/templates.js';
import { db } from '../src/db/index.js';
import { paraInterno } from '../src/domain/competencia.js';
import type { Contexto } from '../src/domain/contexto.js';

const COMP = mesRelativo(0);

function lancar(ctx: Contexto, descricao: string, extra: Record<string, unknown> = {}) {
  return criarLancamento(ctx, {
    filialId: null,
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: COMP,
    valor: 1000,
    natureza: 'fixa',
    classificacao: 'despesa',
    descricao,
    ...extra,
  } as never);
}

const vigenciaDe = (ctx: Contexto, descricao: string) =>
  (db()
    .prepare('SELECT recorrencia_ate FROM lancamentos WHERE empresa_id = ? AND descricao = ?')
    .get(ctx.empresaId, descricao) as { recorrencia_ate: string | null } | undefined)?.recorrencia_ate ?? null;

test('a coluna existe no modelo, e fora das obrigatórias', () => {
  assert.ok(ABAS.Financeiro.colunas.includes('Contrato Vale Até'));
  assert.ok(
    !ABAS.Financeiro.obrigatorias.includes('Contrato Vale Até'),
    'arquivo sem a coluna continua entrando: em branco é "contrato em aberto"',
  );
});

test('a planilha leva e traz a vigência', async () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, 'Licença sazonal', { recorrenciaAte: mesRelativo(5) });
  lancar(ctx, 'Link dedicado');

  const { buffer } = await exportarXlsx(ctx, escopoDoCliente(ctx), 'financeiro');
  const aba = (await lerXlsx(buffer)).find((a) => a.nome === 'Financeiro')!;
  const porDesc = (d: string) => aba.linhas.find((l) => l['Descrição'] === d)!;
  // MM/AAAA, como toda competência que sai daqui.
  assert.match(String(porDesc('Licença sazonal')['Contrato Vale Até']), /^\d{2}\/\d{4}$/);
  assert.equal(porDesc('Link dedicado')['Contrato Vale Até'], '',
    'em aberto sai VAZIO, e não como uma data inventada');

  const destino = ambienteLimpo();
  const r = await importarPlanilha(destino.ctx, buffer, { modulo: 'financeiro', arquivoNome: 'ida.xlsx' });
  assert.equal(r.com_erro, 0, JSON.stringify(r.erros));
  assert.equal(vigenciaDe(destino.ctx, 'Licença sazonal'), paraInterno(mesRelativo(5)));
  assert.equal(vigenciaDe(destino.ctx, 'Link dedicado'), null, 'continua em aberto');
});

test('os apelidos da outra ponta são aceitos', async () => {
  const { ctx } = ambienteLimpo();
  // "Vigência" é como a versão hospedada chama o campo no formulário; um
  // arquivo preenchido lá tem de entrar aqui sem retrabalho.
  const csv = [
    'Tipo de Despesa;Competência;Valor;Natureza;Classificação;Descrição;Vigência',
    `Licenças de Softwares;${COMP};1000,00;Fixa;Despesa;Pelo apelido;${mesRelativo(3)}`,
  ].join('\n');

  const r = await importarPlanilha(ctx, Buffer.from(csv, 'utf8'), {
    modulo: 'financeiro',
    arquivoNome: 'apelido.csv',
  });
  assert.equal(r.com_erro, 0, JSON.stringify(r.erros));
  assert.equal(vigenciaDe(ctx, 'Pelo apelido'), paraInterno(mesRelativo(3)));
});

test('coluna ausente não apaga nem inventa: tudo nasce em aberto', async () => {
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
  assert.equal(vigenciaDe(ctx, 'Sem a coluna'), null);
});

test('data inválida é RECUSADA, e não gravada calada', async () => {
  const { ctx } = ambienteLimpo();
  const csv = [
    'Tipo de Despesa;Competência;Valor;Natureza;Classificação;Descrição;Contrato Vale Até',
    `Licenças de Softwares;${COMP};1000,00;Fixa;Despesa;Data torta;2027-13`,
  ].join('\n');
  const r = await importarPlanilha(ctx, Buffer.from(csv, 'utf8'), {
    modulo: 'financeiro',
    arquivoNome: 'torta.csv',
  });
  assert.equal(r.com_erro, 1);
  assert.match(JSON.stringify(r.erros), /Contrato Vale Até/);
});

test('vigência anterior à competência é recusada', async () => {
  const { ctx } = ambienteLimpo();
  const anterior = mesRelativo(-3);
  const csv = [
    'Tipo de Despesa;Competência;Valor;Natureza;Classificação;Descrição;Contrato Vale Até',
    `Licenças de Softwares;${COMP};1000,00;Fixa;Despesa;Acaba antes de começar;${anterior}`,
  ].join('\n');
  const r = await importarPlanilha(ctx, Buffer.from(csv, 'utf8'), {
    modulo: 'financeiro',
    arquivoNome: 'invertida.csv',
  });
  assert.equal(r.com_erro, 1);
  assert.match(JSON.stringify(r.erros), /anterior à competência/);
});

test('vigência em despesa PONTUAL é recusada: não há recorrência para encerrar', async () => {
  const { ctx } = ambienteLimpo();
  const futura = mesRelativo(4);
  const csv = [
    'Tipo de Despesa;Competência;Valor;Natureza;Classificação;Descrição;Contrato Vale Até',
    `Licenças de Softwares;${COMP};1000,00;Pontual única;Despesa;Compra avulsa;${futura}`,
  ].join('\n');
  const r = await importarPlanilha(ctx, Buffer.from(csv, 'utf8'), {
    modulo: 'financeiro',
    arquivoNome: 'pontual.csv',
  });
  assert.equal(r.com_erro, 1);
  assert.match(JSON.stringify(r.erros), /só vale para despesa fixa/);
});

test('a vigência importada chega ao motor de projeção', async () => {
  const { ctx } = ambienteLimpo();
  const csv = [
    'Tipo de Despesa;Competência;Valor;Natureza;Classificação;Descrição;Fornecedor;Contrato Vale Até',
    `Licenças de Softwares;${COMP};500,00;Fixa;Despesa;Licença sazonal;SOFT;${mesRelativo(4)}`,
    `Licenças de Softwares;${COMP};1000,00;Fixa;Despesa;Link dedicado;TELECOM;`,
  ].join('\n');
  const r = await importarPlanilha(ctx, Buffer.from(csv, 'utf8'), {
    modulo: 'financeiro',
    arquivoNome: 'projecao.csv',
  });
  assert.equal(r.com_erro, 0, JSON.stringify(r.erros));

  // Importar não pode ser um caminho paralelo: a vigência que entra pela
  // planilha tem de encerrar a projeção exatamente como a cadastrada na tela.
  const { contratosProjetados } = await import('../src/domain/dashboards.js');
  const lista = contratosProjetados(ctx, { competencia: COMP });
  const soft = lista.itens.find((i) => i.fornecedor === 'SOFT')!;
  const telecom = lista.itens.find((i) => i.fornecedor === 'TELECOM')!;
  assert.equal(soft.em_aberto, false);
  assert.equal(soft.meses_projetados, 4, 'para no mês da vigência');
  assert.equal(telecom.em_aberto, true);
  assert.equal(telecom.meses_projetados, 12, 'em aberto atravessa o horizonte');
});
