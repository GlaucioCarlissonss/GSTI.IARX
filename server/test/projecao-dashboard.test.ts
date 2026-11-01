/**
 * A projeção dos próximos 12 meses, vista pela tela.
 *
 * O que se prova aqui é o pedido do gestor, na forma em que ele chega ao
 * dashboard: **toda despesa que se repete todo mês é projetada em todo mês**,
 * e um mês sem lançamento nenhum EXISTE como projeção em vez de valer zero.
 *
 * Antes desta entrega a projeção somava apenas o que já estava lançado à
 * frente. Um mês sem linha devolvia zero — e "o custo de TI cai a zero em
 * março" é falso de um jeito que ninguém acredita, o que fazia a projeção
 * inteira deixar de ser olhada.
 *
 * As competências são relativas a hoje: suíte presa a data envelhece e passa
 * a falhar sozinha meses depois.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, idTipoDespesa, mesRelativo } from './apoio.js';
import { criarLancamento } from '../src/domain/financeiro.js';
import { dashboardFinanceiro } from '../src/domain/dashboards.js';

type Projetado = {
  competencia: string;
  fixo: number;
  total: number;
  recorrente_projetado: number;
  contratos_projetados: number;
};

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

/** A projeção do dashboard, ancorada no mês em que o lançamento está. */
function projecao(ctx: ReturnType<typeof ambienteLimpo>['ctx']): Projetado[] {
  const d = dashboardFinanceiro(ctx, { competencia: mesRelativo(0) }) as unknown as {
    projecao_12_meses: Projetado[];
  };
  return d.projecao_12_meses;
}

test('uma despesa fixa sem vigência é projetada em TODOS os doze meses', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, {
    competencia: mesRelativo(0),
    valor: 1000,
    natureza: 'fixa',
    descricao: 'Link dedicado',
    fornecedor: 'TELECOM',
  });

  const p = projecao(ctx);
  assert.equal(p.length, 12);
  for (const mes of p) {
    assert.equal(mes.recorrente_projetado, 1000, `${mes.competencia} ficou sem a recorrência`);
    assert.equal(mes.contratos_projetados, 1);
    assert.equal(mes.total, 1000, 'mês sem lançamento tem de EXISTIR como projeção, não valer zero');
  }
});

test('despesa pontual NÃO é projetada: ela aconteceu uma vez', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, {
    competencia: mesRelativo(0),
    valor: 9999,
    natureza: 'pontual_unica',
    descricao: 'Nobreak',
  });
  for (const mes of projecao(ctx)) {
    assert.equal(mes.total, 0, 'projetar uma compra avulsa seria adivinhar uma decisão que ninguém tomou');
  }
});

test('o mês que JÁ tem a linha do contrato não recebe a projeção por cima', () => {
  const { ctx } = ambienteLimpo();
  // Repetir até 3 meses à frente materializa as linhas; os meses seguintes
  // ficam a cargo da projeção.
  lancar(ctx, {
    competencia: mesRelativo(0),
    valor: 1000,
    natureza: 'fixa',
    descricao: 'Link dedicado',
    fornecedor: 'TELECOM',
    repetirAte: mesRelativo(3),
  });

  const p = projecao(ctx);
  const porMes = new Map(p.map((m) => [m.competencia, m]));
  // Os três primeiros meses à frente têm linha real: valem 1000, e nada é
  // projetado em cima deles.
  for (const d of [1, 2, 3]) {
    const m = porMes.get(mesRelativo(d))!;
    assert.equal(m.recorrente_projetado, 0, `${m.competencia} recebeu projeção sobre linha real`);
    assert.equal(m.total, 1000, 'o valor continua sendo o lançado, contado UMA vez');
  }
  // E o quarto em diante é projeção — mas o contrato tem vigência até o
  // terceiro, porque "repetir até" É a vigência.
  const quarto = porMes.get(mesRelativo(4))!;
  assert.equal(quarto.total, 0, 'a vigência encerrou o contrato no terceiro mês');
});

test('a vigência encerra a projeção no mês certo, e não no seguinte', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, {
    competencia: mesRelativo(0),
    valor: 500,
    natureza: 'fixa',
    descricao: 'Licença sazonal',
    fornecedor: 'SOFT',
    recorrenciaAte: mesRelativo(5),
  });

  const porMes = new Map(projecao(ctx).map((m) => [m.competencia, m]));
  assert.equal(porMes.get(mesRelativo(5))!.total, 500, 'o mês da vigência ainda vale');
  assert.equal(porMes.get(mesRelativo(6))!.total, 0, 'o seguinte não');
});

test('dois contratos somam, e o reajuste projeta o preço novo — não os dois', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, {
    competencia: mesRelativo(-1), valor: 1000, natureza: 'fixa',
    descricao: 'Link dedicado', fornecedor: 'TELECOM',
    justificativa: 'histórico do contrato, para o teste do reajuste',
  });
  // Mesmo contrato, mês seguinte, mais caro: é reajuste, não contrato novo.
  lancar(ctx, {
    competencia: mesRelativo(0), valor: 1150, natureza: 'fixa',
    descricao: 'Link dedicado', fornecedor: 'TELECOM',
  });
  lancar(ctx, {
    competencia: mesRelativo(0), valor: 400, natureza: 'fixa',
    descricao: 'Telefonia móvel', fornecedor: 'CLARO',
  });

  const p = projecao(ctx);
  for (const mes of p) {
    assert.equal(mes.contratos_projetados, 2, 'o reajuste não pode virar um terceiro contrato');
    assert.equal(mes.total, 1550, 'projeta 1150 + 400 — o preço que vale hoje, uma vez cada');
  }
});
