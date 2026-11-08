/**
 * A folha de TI que o sistema inventava sai da base, e o que é legítimo fica.
 *
 * A carga inicial transformava `TI.xlsx` em 57 lançamentos de tipo "Pessoas" e
 * origem "folha_ti" — R$ 273.929,60 que não correspondem a linha nenhuma das
 * planilhas do cliente. Em 21/09/2026 o gestor os declarou incorretos e pediu
 * exclusão definitiva.
 *
 * O que se prova aqui é a limpeza E o limite dela. As duas condições são
 * exigidas juntas de propósito: uma despesa de "Pessoas" que alguém digitou na
 * tela, ou um lançamento de folha em outro tipo, não podem ser alcançados por
 * uma limpeza automática que roda a cada abertura do banco.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, idTipoDespesa, mesRelativo } from './apoio.js';
import { db, migrar } from '../src/db/index.js';
import { criarLancamento, listarLancamentos } from '../src/domain/financeiro.js';
import type { Contexto } from '../src/domain/contexto.js';

const COMP = mesRelativo(0);

/**
 * Cria um lançamento e força a origem — `criarLancamento` grava 'manual', e o
 * que esta suíte precisa provar depende justamente da origem.
 */
function lancar(ctx: Contexto, descricao: string, tipo: string, origem: string) {
  const l = criarLancamento(ctx, {
    filialId: null,
    tipoDespesaId: idTipoDespesa(ctx, tipo),
    competencia: COMP,
    valor: 1000,
    natureza: 'fixa',
    classificacao: 'despesa',
    descricao,
  });
  db().prepare('UPDATE lancamentos SET origem = ? WHERE id = ?').run(origem, l.id);
  return l;
}

const descricoes = (ctx: Contexto) => listarLancamentos(ctx, {}).itens.map((l) => l.descricao).sort();

test('a folha de TI sai, e só ela', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, 'Folha rateada da equipe', 'Pessoas', 'folha_ti');
  // Os dois vizinhos perigosos: cada um casa com METADE da condição.
  lancar(ctx, 'Pessoas digitada na tela', 'Pessoas', 'manual');
  lancar(ctx, 'Folha noutro tipo', 'Serviços Técnicos', 'folha_ti');
  lancar(ctx, 'Despesa comum de planilha', 'Licenças de Softwares', 'planilha');

  migrar(db() as never);

  assert.deepEqual(descricoes(ctx), [
    'Despesa comum de planilha',
    'Folha noutro tipo',
    'Pessoas digitada na tela',
  ]);
});

test('a exclusão é definitiva: não sobra nem como excluída', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, 'Folha rateada da equipe', 'Pessoas', 'folha_ti');
  migrar(db() as never);

  // Exclusão lógica deixaria a linha com `excluido_em`. Aqui não sobra linha:
  // foi decisão do gestor, e está declarado na documentação.
  const { n } = db().prepare('SELECT COUNT(*) AS n FROM lancamentos').get() as { n: number };
  assert.equal(n, 0);
});

test('a limpeza deixa uma linha de trilha com a contagem e o valor', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, 'Folha 1', 'Pessoas', 'folha_ti');
  lancar(ctx, 'Folha 2', 'Pessoas', 'folha_ti');
  migrar(db() as never);

  const linhas = db()
    .prepare("SELECT cliente_id, usuario_id, dados_antes FROM auditoria WHERE acao = 'excluir_definitivo'")
    .all() as Array<{ cliente_id: number; usuario_id: number | null; dados_antes: string }>;
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0]!.cliente_id, ctx.clienteId);
  // Não houve pessoa: foi a abertura da base, e inventar um autor seria pior
  // do que admitir que não há um.
  assert.equal(linhas[0]!.usuario_id, null);
  assert.deepEqual(JSON.parse(linhas[0]!.dados_antes), {
    lancamentos: 2,
    valor_centavos: 200000,
    origem: 'folha_ti',
    tipo: 'Pessoas',
  });
});

test('rodar de novo não apaga nada nem duplica a trilha', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, 'Folha rateada', 'Pessoas', 'folha_ti');
  lancar(ctx, 'Despesa comum', 'Licenças de Softwares', 'planilha');

  migrar(db() as never);
  migrar(db() as never);
  migrar(db() as never);

  assert.deepEqual(descricoes(ctx), ['Despesa comum']);
  const { n } = db()
    .prepare("SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'excluir_definitivo'")
    .get() as { n: number };
  assert.equal(n, 1, 'a trilha é do momento em que apagou, e não de cada abertura');
});

test('base sem folha de TI nenhuma não gera trilha', () => {
  const { ctx } = ambienteLimpo();
  lancar(ctx, 'Despesa comum', 'Licenças de Softwares', 'planilha');
  migrar(db() as never);

  const { n } = db()
    .prepare("SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'excluir_definitivo'")
    .get() as { n: number };
  assert.equal(n, 0);
  assert.deepEqual(descricoes(ctx), ['Despesa comum']);
});
