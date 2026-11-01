/**
 * A projeção aberta contrato a contrato.
 *
 * A soma do painel responde "quanto"; esta lista responde "de quem". Ela
 * existe por causa do custo conhecido da regra escolhida: contrato sem
 * vigência é projetado indefinidamente, inclusive um que acabou e ninguém
 * encerrou. Supor um fim que ninguém informou seria pior — mas só é defensável
 * se o sistema disser, por nome, quem está nessa situação e há quanto tempo.
 *
 * O que se mede aqui, então, não é só o total: é se a lista entrega o contrato
 * esquecido no topo, com os meses de silêncio contados, para virar fila de
 * trabalho em vez de risco calado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, idTipoDespesa, mesRelativo } from './apoio.js';
import { criarLancamento } from '../src/domain/financeiro.js';
import { contratosProjetados } from '../src/domain/dashboards.js';

function lancar(
  ctx: ReturnType<typeof ambienteLimpo>['ctx'],
  extra: Record<string, unknown>,
) {
  return criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    classificacao: 'despesa',
    ...extra,
  } as never);
}

const lista = (ctx: ReturnType<typeof ambienteLimpo>['ctx']) =>
  contratosProjetados(ctx, { competencia: mesRelativo(0) });

test('cada contrato aparece UMA vez, com o que ele soma nos doze meses', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, {
    competencia: mesRelativo(0), valor: 1000, natureza: 'fixa',
    descricao: 'Link dedicado', fornecedor: 'TELECOM',
  });
  lancar(ctx, {
    competencia: mesRelativo(0), valor: 400, natureza: 'fixa',
    descricao: 'Telefonia móvel', fornecedor: 'CLARO',
  });

  const r = lista(ctx);
  assert.equal(r.contratos, 2, 'doze parcelas de cada um não são 24 contratos');
  assert.equal(r.total_projetado, (1000 + 400) * 12);
  for (const i of r.itens) {
    assert.equal(i.meses_projetados, 12);
    assert.equal(i.meses_sem_lancamento, 0, 'lançado no mês de referência');
  }
});

test('o contrato esquecido vem primeiro, com os meses de silêncio contados', () => {
  const { ctx } = ambienteLimpo();
  // Visto pela última vez há cinco meses, e nunca encerrado: é exatamente o
  // caso que a lista existe para expor.
  lancar(ctx, {
    competencia: mesRelativo(-5), valor: 300, natureza: 'fixa',
    descricao: 'Antivírus legado', fornecedor: 'VELHO',
    justificativa: 'histórico do contrato, para o teste do esquecimento',
  });
  lancar(ctx, {
    competencia: mesRelativo(0), valor: 1000, natureza: 'fixa',
    descricao: 'Link dedicado', fornecedor: 'TELECOM',
  });

  const r = lista(ctx);
  assert.equal(r.itens[0]!.fornecedor, 'VELHO', 'o mais esquecido encabeça a fila');
  assert.equal(r.itens[0]!.meses_sem_lancamento, 5);
  assert.equal(r.itens[1]!.meses_sem_lancamento, 0);
});

test('em_aberto conta quem está sendo projetado sem vigência cadastrada', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, {
    competencia: mesRelativo(0), valor: 1000, natureza: 'fixa',
    descricao: 'Link dedicado', fornecedor: 'TELECOM',
  });
  lancar(ctx, {
    competencia: mesRelativo(0), valor: 500, natureza: 'fixa',
    descricao: 'Licença sazonal', fornecedor: 'SOFT',
    recorrenciaAte: mesRelativo(4),
  });

  const r = lista(ctx);
  assert.equal(r.contratos, 2);
  assert.equal(r.em_aberto, 1, 'só o que não tem vigência');
  const soft = r.itens.find((i) => i.fornecedor === 'SOFT')!;
  assert.equal(soft.em_aberto, false);
  assert.equal(soft.meses_projetados, 4, 'ele para na vigência, e a lista mostra isso');
  assert.equal(soft.total_projetado, 500 * 4);
});

test('contrato encerrado some da lista — a vigência é o que o tira de cena', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, {
    competencia: mesRelativo(0), valor: 500, natureza: 'fixa',
    descricao: 'Licença encerrada', fornecedor: 'SOFT',
    recorrenciaAte: mesRelativo(0),
  });

  const r = lista(ctx);
  assert.equal(r.contratos, 0, 'nada a projetar daqui para a frente');
  assert.equal(r.total_projetado, 0);
});

test('o reajuste é um contrato só, e a lista mostra o preço que vale hoje', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, {
    competencia: mesRelativo(-1), valor: 1000, natureza: 'fixa',
    descricao: 'Link dedicado', fornecedor: 'TELECOM',
    justificativa: 'histórico do contrato, para o teste do reajuste',
  });
  lancar(ctx, {
    competencia: mesRelativo(0), valor: 1150, natureza: 'fixa',
    descricao: 'Link dedicado', fornecedor: 'TELECOM',
  });

  const r = lista(ctx);
  assert.equal(r.contratos, 1, 'o valor não faz parte da identidade do contrato');
  assert.equal(r.itens[0]!.valor_mes, 1150);
  assert.equal(r.itens[0]!.ocorrencias, 2);
  assert.equal(r.itens[0]!.primeira_ocorrencia.length, 7, 'MM/AAAA, como tudo que sai daqui');
});

test('"sem lançar há" conta de HOJE, e não do mês que a tela está olhando', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, {
    competencia: mesRelativo(-4), valor: 300, natureza: 'fixa',
    descricao: 'Antivírus legado', fornecedor: 'VELHO',
    justificativa: 'histórico do contrato, para o teste da âncora',
  });

  // A tela olhando um mês passado não pode rejuvenescer o contrato: ancorar a
  // conta no recorte faria o esquecido aparecer como "lançado neste mês" —
  // justamente o que a lista existe para encontrar.
  const olhandoOPassado = contratosProjetados(ctx, { competencia: mesRelativo(-4) });
  assert.equal(olhandoOPassado.itens[0]!.meses_sem_lancamento, 4);

  const olhandoHoje = contratosProjetados(ctx, { competencia: mesRelativo(0) });
  assert.equal(olhandoHoje.itens[0]!.meses_sem_lancamento, 4, 'a resposta não depende do recorte');
});

test('contrato lançado adiantado não fica com atraso negativo', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, {
    competencia: mesRelativo(0), valor: 1000, natureza: 'fixa',
    descricao: 'Link dedicado', fornecedor: 'TELECOM',
    repetirAte: mesRelativo(2),
  });
  // Ele tem linha até dois meses à frente. "Atrasado há −2 meses" não é uma
  // frase que signifique alguma coisa para quem lê.
  const r = contratosProjetados(ctx, { competencia: mesRelativo(0) });
  for (const i of r.itens) assert.ok(i.meses_sem_lancamento >= 0, String(i.meses_sem_lancamento));
});

test('despesa pontual não entra: não há contrato para projetar', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, {
    competencia: mesRelativo(0), valor: 9999, natureza: 'pontual_unica',
    descricao: 'Nobreak',
  });
  assert.equal(lista(ctx).contratos, 0);
});

test('a lista explica exatamente a soma que o painel mostra', async () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, {
    competencia: mesRelativo(0), valor: 1000, natureza: 'fixa',
    descricao: 'Link dedicado', fornecedor: 'TELECOM',
  });
  lancar(ctx, {
    competencia: mesRelativo(0), valor: 500, natureza: 'fixa',
    descricao: 'Licença sazonal', fornecedor: 'SOFT',
    recorrenciaAte: mesRelativo(4),
  });

  const { dashboardFinanceiro } = await import('../src/domain/dashboards.js');
  const painel = dashboardFinanceiro(ctx, { competencia: mesRelativo(0) }) as unknown as {
    projecao_12_meses: Array<{ recorrente_projetado: number }>;
  };
  const doPainel = painel.projecao_12_meses.reduce((s, m) => s + m.recorrente_projetado, 0);
  // Se divergirem, a tela mostra um total que a lista não consegue justificar
  // — e a auditoria deixa de valer para a coisa que ela existe para auditar.
  assert.equal(lista(ctx).total_projetado, doPainel);
});
