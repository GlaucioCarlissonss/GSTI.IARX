/**
 * O plano de redução de despesas: cadastro e indicador.
 *
 * O que se prova aqui:
 *   1. o cadastro é do CLIENTE, e um contratante não vê o plano do outro;
 *   2. a vigência rege o mês — trocar o alvo agora não reescreve o mês passado;
 *   3. o indicador lê o valor ATUAL dos lançamentos e o ALVO do cadastro, e
 *      diz quanto a despesa pesa no grupo e em cada filial;
 *   4. sem cadastro, a resposta vem vazia em vez de inventar um alvo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, contextoDe, idTipoDespesa, mesRelativo } from './apoio.js';
import { criarLancamento } from '../src/domain/financeiro.js';
import { criarFilial } from '../src/domain/cadastros.js';
import { criarEmpresa } from '../src/domain/empresas.js';
import { listarAuditoria } from '../src/domain/auditoria.js';
import {
  atualizarPlano,
  criarPlano,
  listarPlanos,
  planosVigentes,
} from '../src/domain/reducao.js';
import { planoDeReducao } from '../src/domain/indicadores.js';

test('sem plano cadastrado o indicador vem vazio, e não com um alvo inventado', () => {
  const { ctx } = ambienteLimpo();
  criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(0),
    valor: 5000,
    natureza: 'fixa',
    classificacao: 'despesa',
  });
  const r = planoDeReducao(ctx, { competencias: [mesRelativo(0)] });
  assert.deepEqual(r.itens, []);
  assert.equal(r.total_atual, 0);
  assert.equal(r.total_alvo, 0);
});

test('o indicador lê o atual dos lançamentos e o alvo do cadastro', () => {
  const { ctx } = ambienteLimpo();
  const mes = mesRelativo(0);
  const tipo = idTipoDespesa(ctx);
  criarLancamento(ctx, {
    tipoDespesaId: tipo,
    competencia: mes,
    valor: 50000,
    natureza: 'fixa',
    classificacao: 'despesa',
    descricao: 'Licenças',
  });
  // Uma segunda despesa, de outro tipo, para o "peso no grupo" não ser 100%.
  criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx, 'Telefonia/Internet'),
    competencia: mes,
    valor: 50000,
    natureza: 'fixa',
    classificacao: 'despesa',
  });

  criarPlano(ctx, { nome: 'Corte de licenças', tipo_despesa_id: tipo, valor_alvo: 35000 });

  const r = planoDeReducao(ctx, { competencias: [mes] });
  assert.equal(r.itens.length, 1);
  const item = r.itens[0]!;
  assert.equal(item.atual, 50000);
  assert.equal(item.alvo, 35000);
  assert.equal(item.reducao, 15000);
  assert.equal(item.pct_reducao, 30, 'de 50.000 para 35.000 são 30%');
  assert.equal(item.pct_do_grupo, 50, 'metade da despesa do recorte');
  assert.equal(item.sem_despesa_no_recorte, false);
});

test('o item diz quanto pesa em cada filial, e não só no grupo', () => {
  const { ctx } = ambienteLimpo();
  const mes = mesRelativo(0);
  const tipo = idTipoDespesa(ctx);
  const uma = criarFilial(ctx, { nome: 'Unidade A' });
  const outra = criarFilial(ctx, { nome: 'Unidade B' });

  // A unidade A gasta 1.000 disto e 1.000 de outra coisa: o plano pesa 50% nela.
  criarLancamento(ctx, {
    filialId: uma.id, tipoDespesaId: tipo, competencia: mes,
    valor: 1000, natureza: 'fixa', classificacao: 'despesa',
  });
  criarLancamento(ctx, {
    filialId: uma.id, tipoDespesaId: idTipoDespesa(ctx, 'Telefonia/Internet'), competencia: mes,
    valor: 1000, natureza: 'fixa', classificacao: 'despesa',
  });
  // A unidade B gasta 3.000 disto e nada de outra coisa: o plano pesa 100% nela.
  criarLancamento(ctx, {
    filialId: outra.id, tipoDespesaId: tipo, competencia: mes,
    valor: 3000, natureza: 'fixa', classificacao: 'despesa',
  });

  criarPlano(ctx, { nome: 'Corte', tipo_despesa_id: tipo, valor_alvo: 2000 });
  const item = planoDeReducao(ctx, { competencias: [mes] }).itens[0]!;
  const porNome = new Map(item.por_filial.map((f) => [f.unidade, f]));
  assert.equal(porNome.get('Unidade A')!.pct_da_filial, 50);
  assert.equal(porNome.get('Unidade B')!.pct_da_filial, 100);
  assert.equal(item.atual, 4000);
});

test('o item restrito a uma filial só conta aquela filial', () => {
  const { ctx } = ambienteLimpo();
  const mes = mesRelativo(0);
  const tipo = idTipoDespesa(ctx);
  const uma = criarFilial(ctx, { nome: 'Unidade A' });
  const outra = criarFilial(ctx, { nome: 'Unidade B' });
  for (const f of [uma, outra]) {
    criarLancamento(ctx, {
      filialId: f.id, tipoDespesaId: tipo, competencia: mes,
      valor: 1000, natureza: 'fixa', classificacao: 'despesa',
    });
  }
  criarPlano(ctx, { nome: 'Só na A', tipo_despesa_id: tipo, filial_id: uma.id, valor_alvo: 500 });
  const item = planoDeReducao(ctx, { competencias: [mes] }).itens[0]!;
  assert.equal(item.atual, 1000, 'a despesa da outra filial não entra');
  assert.equal(item.por_filial.length, 1);
});

test('item cadastrado sem despesa no recorte é dito, e não escondido', () => {
  const { ctx } = ambienteLimpo();
  const tipo = idTipoDespesa(ctx);
  criarPlano(ctx, { nome: 'Corte futuro', tipo_despesa_id: tipo, valor_alvo: 100 });
  const item = planoDeReducao(ctx, { competencias: [mesRelativo(0)] }).itens[0]!;
  assert.equal(item.atual, 0);
  assert.equal(item.sem_despesa_no_recorte, true);
  assert.equal(item.pct_reducao, 0, 'sem base não há percentual — 0 não é "não caiu"');
});

test('a vigência decide qual item rege qual mês', () => {
  const { ctx } = ambienteLimpo();
  criarPlano(ctx, {
    nome: 'Vale só deste mês em diante',
    tipo_despesa_id: idTipoDespesa(ctx),
    valor_alvo: 100,
    vigencia_inicio: mesRelativo(0),
  });
  assert.equal(planosVigentes(ctx, mesRelativo(0)).length, 1);
  assert.equal(planosVigentes(ctx, mesRelativo(-1)).length, 0);
});

test('desativar tira o item do indicador sem apagar o cadastro', () => {
  const { ctx } = ambienteLimpo();
  const plano = criarPlano(ctx, { nome: 'Corte', tipo_despesa_id: idTipoDespesa(ctx), valor_alvo: 100 });
  assert.equal(planosVigentes(ctx).length, 1);
  atualizarPlano(ctx, plano.id, { ativo: false });
  assert.equal(planosVigentes(ctx).length, 0);
  assert.equal(listarPlanos(ctx, true).length, 1, 'o cadastro continua lá, para ser reativado');
  assert.equal(listarPlanos(ctx).length, 0);
});

test('o plano de um cliente não aparece no outro', () => {
  const { ctx } = ambienteLimpo();
  criarPlano(ctx, { nome: 'Corte', tipo_despesa_id: idTipoDespesa(ctx), valor_alvo: 100 });
  const outra = criarEmpresa(ctx.usuarioId!, { nome: 'Empresa de fora' });
  const deFora = contextoDe(ctx, outra.id);
  assert.equal(listarPlanos(deFora, true).length, 0);
  assert.equal(planoDeReducao(deFora, {}).itens.length, 0);
});

test('nome repetido, alvo ausente e vigência invertida são recusados', () => {
  const { ctx } = ambienteLimpo();
  const tipo = idTipoDespesa(ctx);
  criarPlano(ctx, { nome: 'Corte', tipo_despesa_id: tipo, valor_alvo: 100 });
  assert.throws(() => criarPlano(ctx, { nome: 'Corte', tipo_despesa_id: tipo, valor_alvo: 200 }), /já existe/i);
  assert.throws(() => criarPlano(ctx, { nome: '', tipo_despesa_id: tipo, valor_alvo: 200 }), /obrigatório/i);
  assert.throws(() => criarPlano(ctx, { nome: 'Outro', tipo_despesa_id: tipo }), /obrigatório/i);
  assert.throws(() => criarPlano(ctx, { nome: 'Outro', tipo_despesa_id: tipo, valor_alvo: 'abc' }), /reais/i);
  assert.throws(
    () =>
      criarPlano(ctx, {
        nome: 'Invertido',
        tipo_despesa_id: tipo,
        valor_alvo: 100,
        vigencia_inicio: '06/2026',
        vigencia_fim: '01/2026',
      }),
    /anterior/i,
  );
});

test('tipo de despesa e filial de outro cliente são recusados', () => {
  const { ctx } = ambienteLimpo();
  const outra = criarEmpresa(ctx.usuarioId!, { nome: 'Empresa de fora' });
  const deFora = contextoDe(ctx, outra.id);
  const tipoDeFora = idTipoDespesa(deFora);
  const filialDeFora = criarFilial(deFora, { nome: 'Unidade de fora' });
  assert.throws(
    () => criarPlano(ctx, { nome: 'Invasor', tipo_despesa_id: tipoDeFora, valor_alvo: 100 }),
    /não encontrado/i,
  );
  assert.throws(
    () => criarPlano(ctx, { nome: 'Invasor', filial_id: filialDeFora.id, valor_alvo: 100 }),
    /não encontrada/i,
  );
});

test('criar e atualizar deixam rastro na auditoria', () => {
  const { ctx } = ambienteLimpo();
  const plano = criarPlano(ctx, { nome: 'Corte', tipo_despesa_id: idTipoDespesa(ctx), valor_alvo: 100 });
  atualizarPlano(ctx, plano.id, { valor_alvo: 80 });
  const trilha = listarAuditoria(ctx, { entidade: 'plano_reducao' });
  const linhas = Array.isArray(trilha) ? trilha : (trilha as { itens: unknown[] }).itens;
  assert.equal(linhas.length, 2);
});

test('o valor-alvo aceita a escrita do gestor, com R$ e vírgula', () => {
  const { ctx } = ambienteLimpo();
  const plano = criarPlano(ctx, {
    nome: 'Corte',
    tipo_despesa_id: idTipoDespesa(ctx),
    valor_alvo: 'R$ 1.234,56',
  });
  assert.equal(plano.valor_alvo, 1234.56);
  assert.equal(plano.valor_alvo_centavos, 123456);
});
