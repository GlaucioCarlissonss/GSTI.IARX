/**
 * O rateio proporcional das despesas compartilhadas.
 *
 * A promessa que este arquivo guarda tem duas metades, e a segunda é a que
 * custa caro se quebrar:
 *
 *   1. o rateio distribui como diz que distribui — proporcional à despesa
 *      PRÓPRIA de cada empresa, com divisão igual quando ninguém tem despesa
 *      própria, e sem perder centavo;
 *   2. a leitura INTEGRAL não mudou. `despesaCentralizada` continua contando o
 *      valor inteiro na pagadora, porque é o "antes" do comparativo — se o
 *      rateio a tivesse substituído, todo mês já fechado mudaria de número.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, contextoDe, idTipoDespesa, mesRelativo } from './apoio.js';
import { criarLancamento } from '../src/domain/financeiro.js';
import { criarFilial } from '../src/domain/cadastros.js';
import { criarMatriz } from '../src/domain/clientes.js';
import { comEmpresaEmFoco } from '../src/domain/escopo.js';
import { despesaCentralizada, ratear, rateioDeCompartilhadas } from '../src/domain/indicadores.js';
import { db } from '../src/db/index.js';
import type { Contexto } from '../src/domain/contexto.js';

/**
 * Um cliente com DUAS matrizes e uma filial em cada — é a forma mínima em que
 * "paga uma, consome outra" existe. Com uma matriz só, não haveria entre quem
 * ratear.
 */
function grupoComDuasMatrizes() {
  const { ctx } = ambienteLimpo();
  const segunda = criarMatriz(ctx.clienteId!, { nome: 'Hospital Norte' }) as { id: number };
  db()
    .prepare("INSERT INTO usuario_empresas (usuario_id, empresa_id, papel) VALUES (?, ?, 'gestor')")
    .run(ctx.usuarioId, segunda.id);
  const amplo: Contexto = { ...ctx, empresaIds: [ctx.empresaId, segunda.id] };
  const sede = criarFilial(amplo, { nome: 'Sede', cidade: 'Natal', uf: 'RN' });
  const norte = criarFilial(comEmpresaEmFoco(amplo, segunda.id), {
    nome: 'Unidade Norte',
    cidade: 'Cuiabá',
    uf: 'MT',
  });
  return { ctx: amplo, primeira: ctx.empresaId, segunda: segunda.id, sede: sede.id, norte: norte.id };
}

test('ratear devolve exatamente o valor de partida, sem centavo perdido', () => {
  // 100 centavos em três pesos iguais é o caso clássico: 33+33+33 = 99, e o
  // centavo que sobra precisa ir para alguém.
  const tres = ratear(100, [1, 1, 1]);
  assert.equal(tres.reduce((s, p) => s + p, 0), 100);
  assert.deepEqual([...tres].sort((a, b) => a - b), [33, 33, 34]);

  // E em pesos irregulares, com um valor que não divide bem.
  for (const [valor, pesos] of [
    [1234567, [3, 7, 11]],
    [1, [1, 1, 1, 1]],
    [999, [0, 5]],
    [7, [2]],
  ] as Array<[number, number[]]>) {
    const parcelas = ratear(valor, pesos);
    assert.equal(parcelas.reduce((s, p) => s + p, 0), valor, `perdeu centavo em ${valor} / ${pesos}`);
    assert.ok(parcelas.every((p) => p >= 0));
  }
});

test('todos os pesos em zero dividem igual, em vez de zerar tudo', () => {
  const parcelas = ratear(100, [0, 0, 0, 0]);
  assert.equal(parcelas.reduce((s, p) => s + p, 0), 100);
  assert.deepEqual([...parcelas].sort((a, b) => a - b), [25, 25, 25, 25]);
});

test('ratear é estável: a mesma entrada dá sempre a mesma saída', () => {
  const a = ratear(1000, [5, 5, 3]);
  const b = ratear(1000, [5, 5, 3]);
  assert.deepEqual(a, b);
});

test('a parcela é proporcional à despesa própria de cada empresa', () => {
  const { ctx, primeira, segunda, sede, norte } = grupoComDuasMatrizes();
  const mes = mesRelativo(0);

  // Despesa própria: 3.000 na primeira, 1.000 na segunda → pesos 3:1.
  criarLancamento(ctx, {
    empresaId: primeira,
    filialId: sede,
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mes,
    valor: 3000,
    natureza: 'fixa',
    classificacao: 'despesa',
    descricao: 'Telefonia da sede',
  });
  criarLancamento(comEmpresaEmFoco(ctx, segunda), {
    empresaId: segunda,
    filialId: norte,
    tipoDespesaId: idTipoDespesa(comEmpresaEmFoco(ctx, segunda)),
    competencia: mes,
    valor: 1000,
    natureza: 'fixa',
    classificacao: 'despesa',
    descricao: 'Telefonia do norte',
  });
  // E 4.000 compartilhados, pagos pela primeira.
  criarLancamento(ctx, {
    empresaId: primeira,
    filialId: sede,
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mes,
    valor: 4000,
    natureza: 'fixa',
    classificacao: 'despesa',
    descricao: 'Licença corporativa de antivírus',
    tipoConsumo: 'compartilhado',
    beneficiadas: [norte],
  });

  const r = rateioDeCompartilhadas(ctx, { competencias: [mes] });
  const porId = new Map(r.por_empresa.map((e) => [e.empresa_id, e]));
  const um = porId.get(primeira)!;
  const dois = porId.get(segunda)!;

  assert.equal(r.lancamentos, 1);
  assert.equal(r.compartilhado, 4000);
  // 3:1 sobre 4.000 → 3.000 e 1.000.
  assert.equal(um.rateado_recebido, 3000);
  assert.equal(dois.rateado_recebido, 1000);
  // A soma das parcelas é exatamente o valor compartilhado.
  assert.equal(r.sanidade_centavos, 400000);

  // O comparativo: quem pagava 7.000 passa a carregar 6.000; quem pagava 1.000
  // passa a carregar 2.000. É a regularização, e é o ponto do indicador.
  assert.equal(um.antes, 7000);
  assert.equal(um.depois, 6000);
  assert.equal(um.variacao, -1000);
  assert.equal(dois.antes, 1000);
  assert.equal(dois.depois, 2000);
  assert.equal(dois.variacao, 1000);
  assert.equal(um.pagadora, true);
  assert.equal(dois.pagadora, false);

  // O total do grupo não muda com o rateio: ele redistribui, não cria.
  assert.equal(
    um.antes + dois.antes,
    um.depois + dois.depois,
    'o rateio não pode criar nem destruir despesa',
  );
});

test('o segmento diz de onde veio e quem se beneficia', () => {
  const { ctx, primeira, segunda, sede, norte } = grupoComDuasMatrizes();
  const mes = mesRelativo(0);
  criarLancamento(ctx, {
    empresaId: primeira,
    filialId: sede,
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mes,
    valor: 1000,
    natureza: 'fixa',
    classificacao: 'despesa',
    descricao: 'Licença corporativa',
    tipoConsumo: 'compartilhado',
    beneficiadas: [norte],
  });

  const r = rateioDeCompartilhadas(ctx, { competencias: [mes] });
  const comSegmento = r.por_empresa.filter((e) => e.segmentos.length > 0);
  assert.ok(comSegmento.length > 0, 'alguém tem de receber a parcela');
  const seg = comSegmento[0]!.segmentos[0]!;
  assert.equal(seg.descricao, 'Licença corporativa');
  assert.equal(seg.origem_empresa_id, primeira);
  assert.ok(seg.beneficiadas.some((b) => /Unidade Norte/.test(b)), seg.beneficiadas.join(', '));
  assert.equal(seg.origem_empresa.length > 0, true);
  void segunda;
});

test('sem despesa própria em lugar nenhum, a divisão é igual e declarada', () => {
  const { ctx, primeira, segunda, sede, norte } = grupoComDuasMatrizes();
  const mes = mesRelativo(0);
  // Só compartilhado, em cada matriz: ninguém tem peso.
  criarLancamento(ctx, {
    empresaId: primeira,
    filialId: sede,
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mes,
    valor: 1000,
    natureza: 'fixa',
    classificacao: 'despesa',
    tipoConsumo: 'compartilhado',
    beneficiadas: [norte],
  });
  const ctxSegunda = comEmpresaEmFoco(ctx, segunda);
  criarLancamento(ctxSegunda, {
    empresaId: segunda,
    filialId: norte,
    tipoDespesaId: idTipoDespesa(ctxSegunda),
    competencia: mes,
    valor: 500,
    natureza: 'fixa',
    classificacao: 'despesa',
    tipoConsumo: 'compartilhado',
    beneficiadas: [sede],
  });

  const r = rateioDeCompartilhadas(ctx, { competencias: [mes] });
  assert.equal(r.divisao_igual, true, 'a tela precisa saber que a divisão saiu igual por falta de peso');
  assert.equal(r.sanidade_centavos, 150000);
  for (const e of r.por_empresa) assert.equal(e.rateado_recebido, 750);
});

test('a leitura integral NÃO muda: despesaCentralizada segue contando o valor inteiro', () => {
  const { ctx, primeira, sede, norte } = grupoComDuasMatrizes();
  const mes = mesRelativo(0);
  criarLancamento(ctx, {
    empresaId: primeira,
    filialId: sede,
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mes,
    valor: 4000,
    natureza: 'fixa',
    classificacao: 'despesa',
    tipoConsumo: 'compartilhado',
    beneficiadas: [norte],
  });

  const integral = despesaCentralizada(ctx, { competencias: [mes] });
  assert.equal(integral.centralizado, 4000, 'o "antes" do comparativo não pode ter mudado');
  assert.equal(integral.por_pagadora.length, 1);
  assert.equal(integral.por_pagadora[0]!.valor, 4000);
  assert.equal(integral.por_pagadora[0]!.pct_da_unidade, 100);
});

test('sem lançamento compartilhado, o indicador vem vazio em vez de inventar rateio', () => {
  const { ctx, primeira, sede } = grupoComDuasMatrizes();
  const mes = mesRelativo(0);
  criarLancamento(ctx, {
    empresaId: primeira,
    filialId: sede,
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mes,
    valor: 1000,
    natureza: 'fixa',
    classificacao: 'despesa',
  });
  const r = rateioDeCompartilhadas(ctx, { competencias: [mes] });
  assert.equal(r.lancamentos, 0);
  assert.equal(r.compartilhado, 0);
  assert.equal(r.sanidade_centavos, 0);
  for (const e of r.por_empresa) {
    assert.equal(e.rateado_recebido, 0);
    assert.equal(e.antes, e.depois, 'sem compartilhado, o antes e o depois são o mesmo número');
  }
});

test('o rateio de um cliente não alcança o outro', () => {
  const { ctx, primeira, sede, norte } = grupoComDuasMatrizes();
  const mes = mesRelativo(0);
  criarLancamento(ctx, {
    empresaId: primeira,
    filialId: sede,
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mes,
    valor: 4000,
    natureza: 'fixa',
    classificacao: 'despesa',
    tipoConsumo: 'compartilhado',
    beneficiadas: [norte],
  });

  // Outro contratante, criado do zero: não pode ver nada do primeiro.
  const outra = criarMatriz(
    (db().prepare("INSERT INTO clientes (nome) VALUES ('Outro contratante')").run().lastInsertRowid as number),
    { nome: 'Empresa de fora' },
  ) as { id: number };
  const deFora = contextoDe(ctx, outra.id);
  const r = rateioDeCompartilhadas(deFora, { competencias: [mes] });
  assert.equal(r.lancamentos, 0, 'nenhuma despesa do outro contratante entra');
  assert.equal(r.compartilhado, 0);
  // Ele enxerga o próprio grupo — e só ele. A lista sai do escopo de leitura,
  // então uma empresa do primeiro cliente aparecendo aqui seria vazamento.
  assert.deepEqual(r.por_empresa.map((e) => e.empresa), ['Empresa de fora']);
  assert.equal(r.por_empresa[0]!.antes, 0);
  assert.equal(r.por_empresa[0]!.depois, 0);
});

test('a empresa do grupo sem despesa própria continua na tabela, com zero', () => {
  const { ctx, primeira, segunda, sede, norte } = grupoComDuasMatrizes();
  const mes = mesRelativo(0);
  // Só a primeira matriz tem lançamento; a segunda não gastou nada ainda.
  // Uma despesa própria (que dá peso) e uma compartilhada (que é o que se
  // distribui): com peso 1.000 contra 0, tudo cabe à primeira.
  criarLancamento(ctx, {
    empresaId: primeira,
    filialId: sede,
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mes,
    valor: 500,
    natureza: 'fixa',
    classificacao: 'despesa',
    descricao: 'Telefonia da sede',
  });
  criarLancamento(ctx, {
    empresaId: primeira,
    filialId: sede,
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mes,
    valor: 1000,
    natureza: 'fixa',
    classificacao: 'despesa',
    tipoConsumo: 'compartilhado',
    beneficiadas: [norte],
  });

  const r = rateioDeCompartilhadas(ctx, { competencias: [mes] });
  assert.equal(r.divisao_igual, false, 'a primeira tem peso, então a divisão não é a igualitária');
  const ids = r.por_empresa.map((e) => e.empresa_id).sort((a, b) => a - b);
  assert.deepEqual(ids, [primeira, segunda].sort((a, b) => a - b),
    'a empresa que ainda não gastou é justamente a que mais depende do que o grupo paga por ela');
  const sem = r.por_empresa.find((e) => e.empresa_id === segunda)!;
  assert.equal(sem.proprio, 0);
  assert.equal(sem.antes, 0);
  // Peso zero recebe zero: é a conta, e a linha diz isso em vez de sumir.
  assert.equal(sem.rateado_recebido, 0);
  assert.equal(r.sanidade_centavos, 100000, 'a soma das parcelas continua fechando');
});
