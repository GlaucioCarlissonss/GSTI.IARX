import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, idTipoDespesa, mesRelativo } from './apoio.js';
import { db } from '../src/db/index.js';
import {
  atualizarLancamento,
  criarLancamento,
  excluirLancamento,
  listarLancamentos,
  listarSerie,
  reclassificarLancamento,
} from '../src/domain/financeiro.js';
import { fecharCompetencia } from '../src/domain/fechamento.js';
import { criarFilial } from '../src/domain/cadastros.js';
import { listarAuditoria } from '../src/domain/auditoria.js';

test('despesa parcelada projeta uma parcela por mês subsequente', () => {
  const { ctx } = ambienteLimpo();
  const criado = criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(0),
    valor: 1000,
    natureza: 'pontual_parcelada',
    classificacao: 'investimento',
    qtdParcelas: 3,
  });

  assert.equal(criado.ocorrencias, 3);
  const serie = listarSerie(ctx, criado.id);
  assert.equal(serie.length, 3);
  assert.deepEqual(
    serie.map((p) => p.competencia),
    [mesRelativo(0), mesRelativo(1), mesRelativo(2)],
  );
  assert.deepEqual(serie.map((p) => p.parcela_numero), [1, 2, 3]);
  assert.equal(
    serie.reduce((s, p) => s + p.valor_centavos, 0),
    100000,
    'a soma das parcelas preserva o total contratado',
  );
  // As parcelas referenciam o lançamento de origem.
  assert.equal(serie[0]!.lancamento_origem_id, null);
  assert.deepEqual(serie.slice(1).map((p) => p.lancamento_origem_id), [criado.id, criado.id]);
});

test('valor pode se referir à parcela em vez do total', () => {
  const { ctx } = ambienteLimpo();
  const criado = criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(0),
    valor: 500,
    natureza: 'pontual_parcelada',
    classificacao: 'despesa',
    qtdParcelas: 4,
    valorRefereSe: 'parcela',
  });
  const serie = listarSerie(ctx, criado.id);
  assert.deepEqual(serie.map((p) => p.valor), [500, 500, 500, 500]);
});

test('parcelamento exige ao menos duas parcelas', () => {
  const { ctx } = ambienteLimpo();
  assert.throws(
    () =>
      criarLancamento(ctx, {
        tipoDespesaId: idTipoDespesa(ctx),
        competencia: mesRelativo(0),
        valor: 100,
        natureza: 'pontual_parcelada',
        classificacao: 'despesa',
        qtdParcelas: 1,
      }),
    /quantidade de parcelas/i,
  );
});

test('despesa fixa se replica mês a mês até o limite informado', () => {
  const { ctx } = ambienteLimpo();
  const criado = criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx, 'Pessoas'),
    competencia: mesRelativo(0),
    valor: 10000,
    natureza: 'fixa',
    classificacao: 'despesa',
    repetirAte: mesRelativo(5),
  });
  assert.equal(criado.ocorrencias, 6);
  assert.equal(listarSerie(ctx, criado.id).every((l) => l.valor === 10000), true);
});

test('reclassificação em competência futura é livre e alcança as parcelas futuras', () => {
  const { ctx } = ambienteLimpo();
  const criado = criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx, 'Equipamentos de TI'),
    competencia: mesRelativo(1),
    valor: 3000,
    natureza: 'pontual_parcelada',
    classificacao: 'investimento',
    qtdParcelas: 3,
  });

  const resultado = reclassificarLancamento(ctx, criado.id, { classificacao: 'despesa' });
  assert.equal(resultado.alterados, 3);
  assert.equal(
    listarSerie(ctx, criado.id).every((p) => p.classificacao === 'despesa'),
    true,
  );
});

test('reclassificação em competência não futura exige justificativa', () => {
  const { ctx } = ambienteLimpo();
  const criado = criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(0),
    valor: 800,
    natureza: 'pontual_unica',
    classificacao: 'despesa',
  });

  assert.throws(
    () => reclassificarLancamento(ctx, criado.id, { classificacao: 'investimento' }),
    /exige justificativa/,
  );

  const ok = reclassificarLancamento(ctx, criado.id, {
    classificacao: 'investimento',
    justificativa: 'Reenquadramento contábil aprovado pela controladoria.',
  });
  assert.equal(ok.alterados, 1);
});

test('alteração em competência passada exige justificativa registrada', () => {
  const { ctx } = ambienteLimpo();
  const criado = criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(-2),
    valor: 400,
    natureza: 'pontual_unica',
    classificacao: 'despesa',
    justificativa: 'Carga inicial da base histórica.',
  });

  assert.throws(() => atualizarLancamento(ctx, criado.id, { valor: 500 }), /exigem justificativa/);

  const atualizado = atualizarLancamento(ctx, criado.id, {
    valor: 500,
    justificativa: 'Nota fiscal retificada pelo fornecedor.',
  });
  assert.equal(atualizado.valor, 500);

  const trilha = listarAuditoria(ctx, { entidade: 'lancamento', entidadeId: criado.id });
  const alteracao = trilha.find((t) => t.acao === 'atualizar');
  assert.equal(alteracao?.justificativa, 'Nota fiscal retificada pelo fornecedor.');
  assert.equal(alteracao?.usuario_email, 'gestor@exemplo.com');
});

test('competência fechada bloqueia qualquer alteração, mesmo justificada', () => {
  const { ctx } = ambienteLimpo();
  const criado = criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(0),
    valor: 900,
    natureza: 'pontual_unica',
    classificacao: 'despesa',
  });
  fecharCompetencia(ctx, mesRelativo(0).split('/').reverse().join('-'), 'Fechamento mensal.');

  assert.throws(
    () => atualizarLancamento(ctx, criado.id, { valor: 950, justificativa: 'ajuste' }),
    /está fechada/,
  );
  assert.throws(
    () =>
      criarLancamento(ctx, {
        tipoDespesaId: idTipoDespesa(ctx),
        competencia: mesRelativo(0),
        valor: 10,
        natureza: 'pontual_unica',
        classificacao: 'despesa',
      }),
    /está fechada/,
  );
});

test('exclusão é lógica, alcança as parcelas e deixa trilha', () => {
  const { ctx } = ambienteLimpo();
  const criado = criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(0),
    valor: 600,
    natureza: 'pontual_parcelada',
    classificacao: 'despesa',
    qtdParcelas: 3,
  });

  const resultado = excluirLancamento(ctx, criado.id, { justificativa: 'Contrato cancelado.' });
  assert.equal(resultado.excluidos, 3);
  assert.equal(listarLancamentos(ctx).total, 0);

  const remanescentes = db()
    .prepare('SELECT COUNT(*) AS n FROM lancamentos WHERE empresa_id = ? AND excluido_em IS NOT NULL')
    .get(ctx.empresaId) as { n: number };
  assert.equal(remanescentes.n, 3, 'os registros permanecem no banco para auditoria');
  assert.equal(listarAuditoria(ctx, { entidade: 'lancamento' }).filter((a) => a.acao === 'excluir').length, 3);
});

test('lançamento não aceita filial de outra empresa', () => {
  const primeira = ambienteLimpo();
  const filialAlheia = criarFilial(primeira.ctx, { nome: 'Filial da outra empresa' });

  const outraEmpresaId = Number(
    db().prepare("INSERT INTO empresas (nome) VALUES ('Outra')").run().lastInsertRowid,
  );
  db()
    .prepare("INSERT INTO usuario_empresas (usuario_id, empresa_id, papel) VALUES (?, ?, 'gestor')")
    .run(primeira.ctx.usuarioId, outraEmpresaId);
  db().prepare('INSERT INTO tipos_despesa (empresa_id, nome) VALUES (?, ?)').run(outraEmpresaId, 'Pessoas');
  const tipoOutra = db()
    .prepare('SELECT id FROM tipos_despesa WHERE empresa_id = ?')
    .get(outraEmpresaId) as { id: number };

  const ctxOutra = { ...primeira.ctx, empresaId: outraEmpresaId };
  assert.throws(
    () =>
      criarLancamento(ctxOutra, {
        filialId: filialAlheia.id,
        tipoDespesaId: tipoOutra.id,
        competencia: mesRelativo(0),
        valor: 100,
        natureza: 'pontual_unica',
        classificacao: 'despesa',
      }),
    /não pertence à empresa em contexto/,
  );
});

test('consulta filtra por competência, natureza e classificação dentro do tenant', () => {
  const { ctx } = ambienteLimpo();
  const tipo = idTipoDespesa(ctx);
  criarLancamento(ctx, {
    tipoDespesaId: tipo,
    competencia: mesRelativo(0),
    valor: 100,
    natureza: 'fixa',
    classificacao: 'despesa',
  });
  criarLancamento(ctx, {
    tipoDespesaId: tipo,
    competencia: mesRelativo(0),
    valor: 250,
    natureza: 'pontual_unica',
    classificacao: 'investimento',
  });

  assert.equal(listarLancamentos(ctx, { competencia: mesRelativo(0) }).total, 2);
  assert.equal(listarLancamentos(ctx, { classificacao: 'investimento' }).total_valor, 250);
  assert.equal(listarLancamentos(ctx, { natureza: 'fixa' }).total_valor, 100);
  assert.equal(listarLancamentos(ctx, { competencia: mesRelativo(6) }).total, 0);
});
