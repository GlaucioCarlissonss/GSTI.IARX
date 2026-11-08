/**
 * A vigência da recorrência, do cadastro à leitura.
 *
 * O que se prova aqui é o que o motor de projeção não consegue provar sozinho:
 * que a vigência ATRAVESSA o sistema. Antes desta entrega, "repetir até"
 * existia só no instante da criação — ele materializava uma linha por mês e
 * sumia, e depois disso ninguém conseguia distinguir "contrato mensal em
 * vigor" de "doze despesas iguais que por acaso se repetiram".
 *
 * As competências são relativas a hoje, nunca fixas: suíte presa a data
 * envelhece e passa a falhar sozinha meses depois — foi um dos achados da
 * auditoria deste projeto.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, idTipoDespesa, mesRelativo } from './apoio.js';
import {
  atualizarLancamento,
  criarLancamento,
  obterLancamento,
  listarLancamentos,
} from '../src/domain/financeiro.js';

/** Uma despesa fixa, com o mínimo preenchido. */
function fixa(ctx: ReturnType<typeof ambienteLimpo>['ctx'], extra: Record<string, unknown> = {}) {
  return criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(0),
    valor: 1000,
    natureza: 'fixa',
    classificacao: 'despesa',
    descricao: 'Link dedicado',
    fornecedor: 'TELECOM',
    ...extra,
  } as never);
}

test('"repetir até" passa a ser GRAVADO como vigência, em vez de morrer na criação', () => {
  const { ctx } = ambienteLimpo();
  const { ids } = fixa(ctx, { repetirAte: mesRelativo(3) }) as unknown as { ids: number[] };
  assert.equal(ids.length, 4, 'a série continua sendo materializada como antes');
  // E agora TODA linha da série carrega a vigência: ela é do contrato, não da
  // parcela — como já acontece com a classificação de consumo.
  for (const id of ids) {
    assert.equal(obterLancamento(ctx, id)!.recorrencia_ate, mesRelativo(3));
  }
});

test('despesa fixa sem vigência nasce EM ABERTO, e é isso que projeta para sempre', () => {
  const { ctx } = ambienteLimpo();
  const { ids } = fixa(ctx) as unknown as { ids: number[] };
  assert.equal(obterLancamento(ctx, ids[0]!)!.recorrencia_ate, null,
    'supor um fim que ninguém informou inventaria o encerramento de contratos em vigor');
});

test('a vigência pode ser cadastrada direto, sem repetir a série', () => {
  const { ctx } = ambienteLimpo();
  const { ids } = fixa(ctx, { recorrenciaAte: mesRelativo(6) }) as unknown as { ids: number[] };
  assert.equal(ids.length, 1, 'uma linha só: ela não materializa nada');
  assert.equal(obterLancamento(ctx, ids[0]!)!.recorrencia_ate, mesRelativo(6));
});

test('editar encerra e reabre o contrato, e campo não enviado não mexe nele', () => {
  const { ctx } = ambienteLimpo();
  const { ids } = fixa(ctx) as unknown as { ids: number[] };
  const id = ids[0]!;

  atualizarLancamento(ctx, id, { recorrenciaAte: mesRelativo(4) });
  assert.equal(obterLancamento(ctx, id)!.recorrencia_ate, mesRelativo(4));

  // Corrigir o valor NÃO pode encerrar nem reabrir um contrato por efeito
  // colateral — é a mesma promessa que fornecedor e documento já fazem.
  atualizarLancamento(ctx, id, { valor: 1234 });
  assert.equal(obterLancamento(ctx, id)!.recorrencia_ate, mesRelativo(4));

  atualizarLancamento(ctx, id, { recorrenciaAte: null });
  assert.equal(obterLancamento(ctx, id)!.recorrencia_ate, null, 'null reabre o contrato');
});

test('um contrato não acaba antes de começar', () => {
  const { ctx } = ambienteLimpo();
  const { ids } = fixa(ctx) as unknown as { ids: number[] };
  assert.throws(
    () => atualizarLancamento(ctx, ids[0]!, { recorrenciaAte: mesRelativo(-2) }),
    /não pode ser anterior à competência/i,
  );
});

test('só despesa FIXA tem vigência: a pontual recusa, dizendo por quê', () => {
  const { ctx } = ambienteLimpo();
  const { ids } = criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(0),
    valor: 500,
    natureza: 'pontual_unica',
    classificacao: 'despesa',
  } as never) as unknown as { ids: number[] };
  assert.throws(
    () => atualizarLancamento(ctx, ids[0]!, { recorrenciaAte: mesRelativo(3) }),
    /só despesa fixa/i,
  );
});

test('a vigência chega à listagem, que é de onde a tela lê', () => {
  const { ctx } = ambienteLimpo();
  fixa(ctx, { recorrenciaAte: mesRelativo(5) });
  const itens = listarLancamentos(ctx, {}).itens as unknown as Array<Record<string, unknown>>;
  assert.equal(itens[0]!.recorrencia_ate, mesRelativo(5),
    'sem isto a tela não tem como mostrar nem editar a vigência');
});
