import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, idTipoDespesa } from './apoio.js';
import { criarLancamento } from '../src/domain/financeiro.js';
import { criarFilial } from '../src/domain/cadastros.js';
import { lancamentosDoRelatorio, relatorioFinanceiro } from '../src/domain/relatorio.js';

/** Monta o cenário do anexo em miniatura: 2 filiais × 2 tipos × 3 meses. */
function baseDoRelatorio() {
  const { ctx } = ambienteLimpo();
  const norte = criarFilial(ctx, { nome: 'Filial Norte' });
  const sul = criarFilial(ctx, { nome: 'Filial Sul' });
  const licencas = idTipoDespesa(ctx, 'Licenças de Softwares');
  const telefonia = idTipoDespesa(ctx, 'Telefonia/Internet');

  const lancar = (filialId: number | null, tipoDespesaId: number, competencia: string, valor: number, extra = {}) =>
    criarLancamento(ctx, {
      filialId,
      tipoDespesaId,
      competencia,
      valor,
      natureza: 'pontual_unica',
      classificacao: 'despesa',
      // Meses de 2026 já passaram: lançar no passado exige justificativa, e é
      // assim que o gestor corrige uma base histórica.
      justificativa: 'carga histórica do relatório',
      ...extra,
    });

  lancar(norte.id, licencas, '01/2026', 1000);
  lancar(norte.id, licencas, '02/2026', 1500);
  lancar(norte.id, telefonia, '01/2026', 300);
  lancar(sul.id, licencas, '01/2026', 700);
  lancar(sul.id, telefonia, '03/2026', 200);
  // Nível empresa: sem filial. É o caso que `IN` não alcança sozinho.
  lancar(null, telefonia, '02/2026', 50);

  return { ctx, norte, sul, licencas, telefonia, lancar };
}

test('o relatório replica a estrutura do anexo: meses nas colunas, hierarquia nas linhas, total geral', () => {
  const { ctx, norte, licencas } = baseDoRelatorio();
  const r = relatorioFinanceiro(ctx);

  assert.deepEqual(r.colunas, ['01/2026', '02/2026', '03/2026']);

  // Primeiro nível: as filiais, maior custo primeiro.
  const nivel1 = r.linhas.filter((l) => l.nivel === 1);
  assert.deepEqual(
    nivel1.map((l) => l.rotulo),
    ['Filial Norte', 'Filial Sul', 'Nível empresa'],
  );

  // Segundo nível: os tipos de despesa, logo abaixo da sua filial.
  const posNorte = r.linhas.findIndex((l) => l.rotulo === 'Filial Norte');
  const filhasDeNorte = r.linhas.filter((l) => l.pai === r.linhas[posNorte]!.chave);
  assert.deepEqual(filhasDeNorte.map((l) => l.rotulo).sort(), ['Licenças de Softwares', 'Telefonia/Internet']);
  assert.equal(r.linhas[posNorte + 1]!.pai, r.linhas[posNorte]!.chave, 'a filha vem logo abaixo da filial');

  // Os valores por mês, em centavos.
  const linhaNorte = nivel1.find((l) => l.rotulo === 'Filial Norte')!;
  assert.deepEqual(linhaNorte.meses, { '01/2026': 130000, '02/2026': 150000 });
  assert.equal(linhaNorte.total_centavos, 280000);

  const linhaLicencasNorte = filhasDeNorte.find((l) => l.rotulo === 'Licenças de Softwares')!;
  assert.equal(linhaLicencasNorte.tipo_despesa_id, licencas);
  assert.equal(linhaLicencasNorte.filial_id, norte.id);
  assert.equal(linhaLicencasNorte.total_centavos, 250000);

  // Total geral: soma das linhas de primeiro nível, por mês e no todo.
  assert.deepEqual(r.total_geral.meses, { '01/2026': 200000, '02/2026': 155000, '03/2026': 20000 });
  assert.equal(r.total_geral.total_centavos, 375000);
  assert.equal(
    r.total_geral.total_centavos,
    nivel1.reduce((s, l) => s + l.total_centavos, 0),
    'o total geral é a soma do primeiro nível',
  );
});

test('o detalhamento bate com o número que estava na visão macro', () => {
  const { ctx, norte, licencas } = baseDoRelatorio();
  const r = relatorioFinanceiro(ctx);

  // Um tipo de despesa de uma filial: o total do detalhe tem de ser o mesmo.
  const linha = r.linhas.find((l) => l.filial_id === norte.id && l.tipo_despesa_id === licencas)!;
  const detalhe = lancamentosDoRelatorio(ctx, { filialId: norte.id, tipoDespesaId: licencas });
  assert.equal(detalhe.total_centavos, linha.total_centavos);
  assert.equal(detalhe.itens.length, linha.lancamentos);

  // Uma célula (tipo × mês) também fecha.
  const celula = lancamentosDoRelatorio(ctx, {
    filialId: norte.id,
    tipoDespesaId: licencas,
    competencia: '02/2026',
  });
  assert.equal(celula.total_centavos, linha.meses['02/2026']);
  assert.equal(celula.itens.length, 1);

  // E a filial inteira fecha com o primeiro nível.
  const linhaFilial = r.linhas.find((l) => l.nivel === 1 && l.filial_id === norte.id)!;
  const daFilial = lancamentosDoRelatorio(ctx, { filialId: norte.id });
  assert.equal(daFilial.total_centavos, linhaFilial.total_centavos);

  // O nível empresa, que `IN` não alcança sozinho, também fecha.
  const linhaEmpresa = r.linhas.find((l) => l.nivel === 1 && l.filial_id === null)!;
  const daEmpresa = lancamentosDoRelatorio(ctx, { filialId: null });
  assert.equal(daEmpresa.total_centavos, linhaEmpresa.total_centavos);
  assert.equal(daEmpresa.itens.length, 1);
});

test('o filtro recorta macro e detalhe pelo mesmo critério', () => {
  const { ctx, norte, licencas } = baseDoRelatorio();

  const soNorte = relatorioFinanceiro(ctx, { filiais: [norte.id] });
  assert.deepEqual(soNorte.linhas.filter((l) => l.nivel === 1).map((l) => l.rotulo), ['Filial Norte']);
  assert.equal(soNorte.total_geral.total_centavos, 280000);

  const soLicencas = relatorioFinanceiro(ctx, { tiposDespesa: [licencas] });
  assert.equal(soLicencas.total_geral.total_centavos, 320000);

  const janeiro = relatorioFinanceiro(ctx, { competenciaInicio: '01/2026', competenciaFim: '01/2026' });
  assert.deepEqual(janeiro.colunas, ['01/2026']);
  assert.equal(janeiro.total_geral.total_centavos, 200000);

  // O detalhe herda o mesmo recorte, e por isso não pode somar mais que o macro.
  const detalheJaneiro = lancamentosDoRelatorio(ctx, { competenciaInicio: '01/2026', competenciaFim: '01/2026' });
  assert.equal(detalheJaneiro.total_centavos, janeiro.total_geral.total_centavos);
});

test('o lançamento carrega origem do custo, destino do pagamento e documento', () => {
  const { ctx } = ambienteLimpo();
  const tipo = idTipoDespesa(ctx);
  criarLancamento(ctx, {
    filialId: null,
    tipoDespesaId: tipo,
    competencia: '01/2026',
    valor: 1200,
    natureza: 'pontual_parcelada',
    qtdParcelas: 3,
    valorRefereSe: 'total',
    classificacao: 'despesa',
    justificativa: 'carga histórica do relatório',
    descricao: 'Licença anual do antivírus',
    origemCusto: 'Fornecedor XYZ · Centro de custo TI',
    destinoPagamento: 'Conta corrente 1234 · XYZ Software Ltda',
    documento: 'NF 55821',
  });

  const detalhe = lancamentosDoRelatorio(ctx, {});
  assert.equal(detalhe.itens.length, 3, 'as 3 parcelas entram no relatório');
  for (const item of detalhe.itens) {
    // As parcelas herdam o contrato: é o mesmo custo, parcelado.
    assert.equal(item.origem_custo, 'Fornecedor XYZ · Centro de custo TI');
    assert.equal(item.destino_pagamento, 'Conta corrente 1234 · XYZ Software Ltda');
    assert.equal(item.documento, 'NF 55821');
    assert.equal(item.descricao, 'Licença anual do antivírus');
  }
  assert.equal(detalhe.total_centavos, 120000, 'o rateio fecha no total do contrato');
});
