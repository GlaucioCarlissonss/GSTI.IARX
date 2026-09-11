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
import { conferenciaOrigem, dashboardFinanceiro } from '../src/domain/dashboards.js';

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

test('a conferência separa o que veio da planilha do que o sistema acrescentou', () => {
  const { ctx } = ambienteLimpo();
  const tipo = idTipoDespesa(ctx);
  const comum = { tipoDespesaId: tipo, natureza: 'fixa' as const, classificacao: 'despesa' as const,
    justificativa: 'carga de conferência' };

  criarLancamento(ctx, { ...comum, competencia: mesRelativo(-1), valor: 1000, origem: 'planilha' });
  criarLancamento(ctx, { ...comum, competencia: mesRelativo(0), valor: 500, origem: 'planilha' });
  criarLancamento(ctx, { ...comum, competencia: mesRelativo(0), valor: 300, origem: 'folha_ti' });
  criarLancamento(ctx, { ...comum, competencia: mesRelativo(1), valor: 200, origem: 'projecao_spincare' });
  criarLancamento(ctx, { ...comum, competencia: mesRelativo(0), valor: 50 });   // manual

  const c = conferenciaOrigem(ctx);
  assert.equal(c.total, 2050);
  assert.equal(c.base_enviada, 1500, 'só as linhas das planilhas');
  assert.equal(c.acrescentado, 550, 'folha + projeção + manual');

  const porChave = Object.fromEntries(c.por_origem.map((o) => [o.origem, o]));
  assert.equal(porChave.planilha!.lancamentos, 2);
  assert.equal(porChave.folha_ti!.valor, 300);
  assert.equal(porChave.projecao_spincare!.valor, 200);
  assert.equal(porChave.manual!.valor, 50);

  // As linhas mensais têm de fechar com o total.
  assert.equal(c.por_competencia.reduce((s, m) => s + m.total, 0), c.total);
});

test('filtros aceitam vários valores por dimensão', () => {
  const { ctx } = ambienteLimpo();
  const tipo = idTipoDespesa(ctx);
  const norte = criarFilial(ctx, { nome: 'Norte' });
  const sul = criarFilial(ctx, { nome: 'Sul' });
  const comum = { tipoDespesaId: tipo, justificativa: 'carga do teste' };

  criarLancamento(ctx, { ...comum, filialId: norte.id, competencia: mesRelativo(-2), valor: 100,
    natureza: 'fixa', classificacao: 'despesa' });
  criarLancamento(ctx, { ...comum, filialId: sul.id, competencia: mesRelativo(-1), valor: 200,
    natureza: 'pontual_unica', classificacao: 'investimento' });
  criarLancamento(ctx, { ...comum, filialId: null, competencia: mesRelativo(0), valor: 400,
    natureza: 'fixa', classificacao: 'despesa' });

  const soma = (f: Parameters<typeof listarLancamentos>[1]) => listarLancamentos(ctx, f).total_valor;

  assert.equal(soma({}), 700, 'sem filtro, tudo');
  assert.equal(soma({ filiais: [norte.id] }), 100);
  assert.equal(soma({ filiais: [norte.id, sul.id] }), 300, 'duas filiais somam as duas');
  // `null` na lista é o nível empresa, que em SQL é IS NULL e não entra num IN
  assert.equal(soma({ filiais: [norte.id, null] }), 500, 'filial mais o nível empresa');
  assert.equal(soma({ naturezas: ['fixa', 'pontual_unica'] }), 700);
  assert.equal(soma({ naturezas: ['pontual_unica'] }), 200);
  assert.equal(soma({ classificacoes: ['despesa', 'investimento'] }), 700);
  assert.equal(soma({ competencias: [mesRelativo(-2), mesRelativo(0)] }), 500, 'meses não contíguos');

  // o contrato antigo, de valor único, continua valendo
  assert.equal(soma({ filialId: norte.id }), 100);
  assert.equal(soma({ natureza: 'fixa' }), 500);
});

test('o painel financeiro soma o período escolhido', () => {
  const { ctx } = ambienteLimpo();
  const tipo = idTipoDespesa(ctx);
  const comum = { tipoDespesaId: tipo, natureza: 'fixa' as const, classificacao: 'despesa' as const,
    justificativa: 'carga do teste' };
  criarLancamento(ctx, { ...comum, competencia: mesRelativo(-2), valor: 100 });
  criarLancamento(ctx, { ...comum, competencia: mesRelativo(-1), valor: 200 });

  const um = dashboardFinanceiro(ctx, { competencias: [mesRelativo(-1)] });
  assert.equal(um.totais_mes.total, 200);
  assert.deepEqual(um.escopo.competencias, [mesRelativo(-1)]);

  const dois = dashboardFinanceiro(ctx, { competencias: [mesRelativo(-2), mesRelativo(-1)] });
  assert.equal(dois.totais_mes.total, 300, 'os dois meses somam');
  assert.equal(dois.escopo.competencias.length, 2);
  // a distribuição por tipo tem de fechar com o total do período
  assert.equal(dois.por_tipo_despesa.reduce((s, t) => s + t.total, 0), 300);
});
