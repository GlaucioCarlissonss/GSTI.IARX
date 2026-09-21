/**
 * Quem CONSOME o que a filial PAGA.
 *
 * O que se prova aqui é o que o enunciado pede: o lançamento aceita a
 * classificação e as filiais beneficiadas; a lista atravessa as matrizes do
 * mesmo cliente e para na fronteira dele; e "todas as filiais do grupo" é
 * CONGELADA na gravação — uma filial cadastrada depois não passa a consumir um
 * lançamento de antes, senão mês fechado mudaria de número sozinho.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, contextoDe, idTipoDespesa, mesRelativo } from './apoio.js';
import { criarEmpresa } from '../src/domain/empresas.js';
import { criarFilial } from '../src/domain/cadastros.js';
import { atualizarLancamento, criarLancamento, listarSerie, obterLancamento } from '../src/domain/financeiro.js';
import { comEmpresaEmFoco } from '../src/domain/escopo.js';
import { escopoDoCliente } from '../src/domain/escopo-operacao.js';
import { exportarXlsx } from '../src/domain/exportacao.js';
import { importarPlanilha } from '../src/domain/importacao.js';
import { lerXlsx } from '../src/lib/planilha.js';
import { despesaCentralizada } from '../src/domain/indicadores.js';
import type { Contexto } from '../src/domain/contexto.js';

/** Um cliente com duas matrizes e uma filial em cada — o caso da licença centralizada. */
function grupoComDuasMatrizes() {
  const { ctx } = ambienteLimpo();
  const segunda = criarEmpresa(ctx.usuarioId, { nome: 'Matriz Sul', clienteId: ctx.clienteId! });
  const cliente: Contexto = { ...ctx, empresaIds: [ctx.empresaId, segunda.id] };
  const filialA = criarFilial(cliente, { nome: 'Filial Norte', cidade: 'Natal', uf: 'RN' });
  const filialB = criarFilial(comEmpresaEmFoco(cliente, segunda.id), { nome: 'Filial Oeste', uf: 'MT' });
  return { ctx: cliente, matrizA: ctx.empresaId, matrizB: segunda.id, filialA, filialB };
}

function lancar(ctx: Contexto, extra: Record<string, unknown> = {}) {
  return criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(0),
    valor: 1200,
    natureza: 'fixa',
    classificacao: 'despesa',
    descricao: 'Licença centralizada',
    ...extra,
  });
}

test('o lançamento nasce 100% da filial, e a base existente continua lida assim', () => {
  const { ctx } = grupoComDuasMatrizes();
  const criado = lancar(ctx);
  assert.equal(criado.tipo_consumo, 'integral');
  assert.equal(criado.tipo_consumo_rotulo, '100% da filial');
  assert.deepEqual(criado.filiais_beneficiadas, []);
  assert.equal(criado.beneficia_todas, false);
});

test('beneficiar outras filiais grava quem consome, inclusive de outra matriz', () => {
  const { ctx, filialA, filialB } = grupoComDuasMatrizes();
  const criado = lancar(ctx, {
    filialId: filialA.id,
    tipoConsumo: 'compartilhado',
    beneficiadas: [filialB.id],
  });
  assert.equal(criado.tipo_consumo, 'compartilhado');
  assert.deepEqual(
    criado.filiais_beneficiadas.map((f) => f.nome),
    ['Filial Oeste'],
    'a licença comprada por uma matriz e usada pela outra é o caso que motiva o campo',
  );
  // A matriz vem junto porque nomes de filial se repetem entre matrizes.
  assert.equal(criado.filiais_beneficiadas[0]!.empresa_nome, 'Matriz Sul');
});

test('"beneficia outras" sem nenhuma beneficiada é recusado', () => {
  const { ctx, filialA } = grupoComDuasMatrizes();
  assert.throws(
    () => lancar(ctx, { filialId: filialA.id, tipoConsumo: 'compartilhado', beneficiadas: [] }),
    /ao menos uma filial beneficiada/i,
  );
});

test('a filial pagadora sai da lista: ela não se beneficia de si mesma', () => {
  const { ctx, filialA, filialB } = grupoComDuasMatrizes();
  const criado = lancar(ctx, {
    filialId: filialA.id,
    tipoConsumo: 'compartilhado',
    beneficiadas: [filialA.id, filialB.id],
  });
  assert.deepEqual(
    criado.filiais_beneficiadas.map((f) => f.id),
    [filialB.id],
    'contar a pagadora faria o indicador tratá-la como destino do próprio dinheiro',
  );
});

test('filial de outro cliente é recusada', () => {
  const { ctx } = grupoComDuasMatrizes();
  const alheia = criarEmpresa(ctx.usuarioId, { nome: 'Outra contratante' });
  const deFora = criarFilial(contextoDe(ctx, alheia.id), { nome: 'Filial de fora' });
  assert.throws(
    () => lancar(ctx, { tipoConsumo: 'compartilhado', beneficiadas: [deFora.id] }),
    /não tem acesso/i,
  );
});

test('"todas as filiais do grupo" é congelada na gravação', () => {
  const { ctx, filialA, filialB } = grupoComDuasMatrizes();
  const criado = lancar(ctx, { filialId: filialA.id, tipoConsumo: 'compartilhado', beneficiadas: 'todas' });
  assert.equal(criado.beneficia_todas, true, 'a intenção fica registrada, para a tela reexibir a frase');
  assert.deepEqual(criado.filiais_beneficiadas.map((f) => f.id), [filialB.id]);

  // A filial nova NÃO entra no lançamento de antes: é isso que impede um mês
  // fechado de mudar de número quando o cadastro cresce.
  const nova = criarFilial(ctx, { nome: 'Filial Nascente' });
  const relido = obterLancamento(ctx, criado.id);
  assert.deepEqual(relido.filiais_beneficiadas.map((f) => f.id), [filialB.id]);
  assert.ok(!relido.filiais_beneficiadas.some((f) => f.id === nova.id));
});

test('as parcelas herdam quem consome o contrato', () => {
  const { ctx, filialA, filialB } = grupoComDuasMatrizes();
  const criado = criarLancamento(ctx, {
    filialId: filialA.id,
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(0),
    valor: 3000,
    natureza: 'pontual_parcelada',
    qtdParcelas: 3,
    classificacao: 'investimento',
    tipoConsumo: 'compartilhado',
    beneficiadas: [filialB.id],
  });
  assert.equal(criado.ocorrencias, 3);
  const serie = listarSerie(ctx, criado.id);
  assert.equal(serie.length, 3);
  for (const parcela of serie) {
    assert.equal(parcela.tipo_consumo, 'compartilhado', 'parcelar um contrato não muda quem o consome');
    assert.deepEqual(parcela.filiais_beneficiadas.map((f) => f.id), [filialB.id]);
  }
});

test('corrigir o valor não apaga quem consome', () => {
  const { ctx, filialA, filialB } = grupoComDuasMatrizes();
  const criado = lancar(ctx, {
    filialId: filialA.id,
    tipoConsumo: 'compartilhado',
    beneficiadas: [filialB.id],
  });
  const depois = atualizarLancamento(ctx, criado.id, { valor: 1500 });
  assert.equal(depois.tipo_consumo, 'compartilhado');
  assert.deepEqual(depois.filiais_beneficiadas.map((f) => f.id), [filialB.id]);
});

test('voltar para 100% da filial limpa a lista', () => {
  const { ctx, filialA, filialB } = grupoComDuasMatrizes();
  const criado = lancar(ctx, {
    filialId: filialA.id,
    tipoConsumo: 'compartilhado',
    beneficiadas: [filialB.id],
  });
  const depois = atualizarLancamento(ctx, criado.id, { tipoConsumo: 'integral' });
  assert.equal(depois.tipo_consumo, 'integral');
  assert.deepEqual(depois.filiais_beneficiadas, []);
});

test('a planilha leva e traz a classificação de consumo', async () => {
  const { ctx, filialA, filialB } = grupoComDuasMatrizes();
  lancar(ctx, { filialId: filialA.id, tipoConsumo: 'compartilhado', beneficiadas: [filialB.id] });

  const { buffer } = await exportarXlsx(ctx, escopoDoCliente(ctx), 'financeiro');
  const abas = await lerXlsx(buffer);
  const financeiro = abas.find((a) => a.nome === 'Financeiro')!;
  const linha = financeiro.linhas.find((l) => String(l['Descrição']) === 'Licença centralizada')!;
  assert.equal(linha['Tipo de Consumo'], 'Paga pela filial, beneficia outras');
  assert.match(String(linha['Filiais Beneficiadas']), /Filial Oeste/);

  // De volta: é a mesma linha, então não entra de novo.
  const volta = await importarPlanilha(ctx, buffer, { modulo: 'financeiro', arquivoNome: 'volta.xlsx' });
  assert.equal(volta.com_erro, 0, JSON.stringify(volta.erros));
  assert.equal(volta.importadas, 0);
});

test('a planilha aceita a palavra Todas e nomes separados por barra', async () => {
  const { ctx, filialB } = grupoComDuasMatrizes();
  // A coluna Empresa é obrigatória quando o escopo tem mais de uma matriz.
  const csv = [
    'Empresa;Tipo de Despesa;Competência;Valor;Natureza;Classificação;Tipo de Consumo;Filiais Beneficiadas;Descrição',
    `Empresa Teste;Licenças de Softwares;${mesRelativo(0)};1000,00;Fixa;Despesa;Paga pela filial, beneficia outras;Filial Oeste;Da planilha`,
    `Empresa Teste;Licenças de Softwares;${mesRelativo(0)};2000,00;Fixa;Despesa;;Todas;Para o grupo`,
  ].join('\n');

  const r = await importarPlanilha(ctx, Buffer.from(csv, 'utf8'), {
    modulo: 'financeiro',
    arquivoNome: 'consumo.csv',
  });
  assert.equal(r.com_erro, 0, JSON.stringify(r.erros));
  assert.equal(r.importadas, 2);

  // Nomear beneficiadas sem preencher o tipo já diz o tipo: exigir as duas
  // colunas rejeitaria um arquivo cuja intenção é inequívoca.
  const { itens } = (await import('../src/domain/financeiro.js')).listarLancamentos(ctx, {});
  const doGrupo = itens.find((l) => l.descricao === 'Para o grupo')!;
  assert.equal(doGrupo.tipo_consumo, 'compartilhado');
  assert.equal(doGrupo.beneficia_todas, true);
  const daPlanilha = itens.find((l) => l.descricao === 'Da planilha')!;
  assert.deepEqual(daPlanilha.filiais_beneficiadas.map((f) => f.id), [filialB.id]);
});

test('beneficiada que não existe no cliente derruba a linha, e não a carga', async () => {
  const { ctx } = grupoComDuasMatrizes();
  const csv = [
    'Empresa;Tipo de Despesa;Competência;Valor;Natureza;Classificação;Tipo de Consumo;Filiais Beneficiadas',
    `Empresa Teste;Licenças de Softwares;${mesRelativo(0)};1000,00;Fixa;Despesa;Beneficia outras;Filial Que Nao Existe`,
  ].join('\n');

  const r = await importarPlanilha(ctx, Buffer.from(csv, 'utf8'), {
    modulo: 'financeiro',
    arquivoNome: 'ruim.csv',
  });
  assert.equal(r.importadas, 0);
  assert.equal(r.com_erro, 1);
  assert.match(r.erros[0]!.mensagem, /não encontrada/i);
});

// ------------------------------------ o indicador de despesa centralizada (2.2)

test('o indicador soma o valor INTEGRAL da pagadora, sem rateio', () => {
  const { ctx, filialA, filialB } = grupoComDuasMatrizes();
  lancar(ctx, { filialId: filialA.id, tipoConsumo: 'compartilhado', beneficiadas: [filialB.id] });
  lancar(ctx, { filialId: filialA.id, descricao: 'Só da filial' });

  const r = despesaCentralizada(ctx, {});
  assert.equal(r.total, 2400, 'o total do recorte são os dois lançamentos');
  assert.equal(r.centralizado, 1200, 'só o compartilhado é centralizado, e pelo valor cheio');
  assert.equal(r.pct_centralizado, 50);
  assert.equal(r.lancamentos, 1);
});

test('a pagadora aparece com quem consome, e sem número por filial', () => {
  const { ctx, filialA, filialB } = grupoComDuasMatrizes();
  lancar(ctx, { filialId: filialA.id, tipoConsumo: 'compartilhado', beneficiadas: 'todas' });

  const linha = despesaCentralizada(ctx, {}).por_pagadora[0]!;
  assert.equal(linha.filial_id, filialA.id);
  assert.equal(linha.valor, 1200);
  assert.equal(linha.pct_da_unidade, 100, 'tudo que esta filial paga é consumido por outras');
  assert.deepEqual(linha.beneficiadas, ['Filial Oeste']);
  // A decisão é explícita: o detalhamento diz QUEM consome, nunca QUANTO cada
  // uma consome. Um valor por filial seria o rateio que este desenho recusa.
  assert.ok(!Object.keys(linha).some((k) => /beneficiada.*valor|valor.*beneficiada/i.test(k)));
  assert.ok(filialB);
});

test('sem lançamento compartilhado, o indicador é zero e não some', () => {
  const { ctx, filialA } = grupoComDuasMatrizes();
  lancar(ctx, { filialId: filialA.id });
  const r = despesaCentralizada(ctx, {});
  assert.equal(r.centralizado, 0);
  assert.equal(r.pct_centralizado, 0);
  assert.deepEqual(r.por_pagadora, [], 'sem despesa centralizada, não há pagadora a listar');
});

test('o indicador não atravessa para outro cliente', () => {
  const { ctx, filialA, filialB } = grupoComDuasMatrizes();
  lancar(ctx, { filialId: filialA.id, tipoConsumo: 'compartilhado', beneficiadas: [filialB.id] });
  const alheia = criarEmpresa(ctx.usuarioId, { nome: 'Outra contratante' });
  assert.equal(despesaCentralizada(contextoDe(ctx, alheia.id), {}).centralizado, 0);
});
