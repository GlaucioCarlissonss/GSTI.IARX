/**
 * O escopo de leitura: o cliente, e o filtro local por cima.
 *
 * Estas conferências existem porque a mudança é invisível numa base de uma
 * matriz só — e é exatamente com duas matrizes do mesmo contratante que ela
 * muda o resultado de toda tela.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, contextoDe, idTipoDespesa, mesRelativo } from './apoio.js';
import { db } from '../src/db/index.js';
import { criarEmpresa, empresasAcessiveis } from '../src/domain/empresas.js';
import { clienteDaEmpresa } from '../src/domain/clientes.js';
import { criarLancamento, listarLancamentos, obterLancamento } from '../src/domain/financeiro.js';
import { escopoDeLeitura, empresaDeEscrita, empresasDoPedido } from '../src/domain/escopo.js';
import type { Contexto } from '../src/domain/contexto.js';
import type { Request } from 'express';
import { comEmpresa } from '../src/middleware/index.js';
import { criarCliente } from '../src/domain/clientes.js';

/** Duas matrizes do MESMO cliente, com o usuário ligado às duas. */
function clienteComDuasMatrizes() {
  const { ctx, empresaId: matrizA } = ambienteLimpo();
  const clienteId = clienteDaEmpresa(matrizA)!;
  const matrizB = criarEmpresa(ctx.usuarioId, { nome: 'Segunda Unidade', clienteId }).id;
  const doCliente: Contexto = { ...ctx, empresaIds: empresasAcessiveis(ctx.usuarioId, clienteId) };
  return { ctx: doCliente, clienteId, matrizA, matrizB };
}

function lancar(ctx: Contexto, empresaId: number, valor: number) {
  return criarLancamento(ctx, {
    empresaId,
    tipoDespesaId: idTipoDespesa({ ...ctx, empresaId }),
    competencia: mesRelativo(0),
    valor,
    natureza: 'fixa',
    classificacao: 'despesa',
  });
}

test('a tela lê o cliente inteiro, não a matriz em foco', () => {
  const { ctx, matrizA, matrizB } = clienteComDuasMatrizes();
  lancar(ctx, matrizA, 100);
  lancar(ctx, matrizB, 250);

  // Sem filtro local, as duas unidades aparecem — antes, só a matriz em foco.
  const tudo = listarLancamentos(ctx);
  assert.equal(tudo.total, 2);
  assert.deepEqual(
    tudo.itens.map((l) => l.empresa_id).sort(),
    [matrizA, matrizB].sort(),
  );
  // A unidade vem na linha: sem ela não dá para saber de quem é o número.
  assert.ok(tudo.itens.every((l) => l.empresa_nome));
});

test('o filtro local recorta sem trocar o contexto do sistema', () => {
  const { ctx, matrizA, matrizB } = clienteComDuasMatrizes();
  lancar(ctx, matrizA, 100);
  lancar(ctx, matrizB, 250);

  const soB = listarLancamentos(ctx, { empresas: [matrizB] });
  assert.equal(soB.total, 1);
  assert.equal(soB.itens[0]!.empresa_id, matrizB);
  // E o contexto continua o mesmo: o recorte foi da consulta, não do sistema.
  assert.equal(listarLancamentos(ctx).total, 2);
});

test('o registro de uma unidade abre a partir de qualquer outra do cliente', () => {
  const { ctx, matrizA, matrizB } = clienteComDuasMatrizes();
  const naB = lancar(ctx, matrizB, 250);

  // O contexto está na matriz A; o lançamento é da B. Exigir que o filtro
  // estivesse "certo" faria o registro recém-listado sumir ao clicar.
  assert.equal(ctx.empresaId, matrizA);
  assert.equal(obterLancamento(ctx, naB.id).id, naB.id);
});

test('filtro com matriz de outro cliente é recusado, e não filtrado em silêncio', () => {
  const { ctx } = clienteComDuasMatrizes();
  const alheia = criarEmpresa(ctx.usuarioId, { nome: 'Outro Contratante' }).id;

  assert.throws(
    () => listarLancamentos(ctx, { empresas: [alheia] }),
    (erro: unknown) => (erro as { status?: number }).status === 403,
    'lista vazia esconderia a tentativa; 403 a declara',
  );
  // A mesma recusa para um id que não existe: distinguir as duas contaria a
  // quem tenta quais clientes existem.
  assert.throws(
    () => escopoDeLeitura(ctx, [999999]),
    (erro: unknown) => (erro as { status?: number }).status === 403,
  );
});

test('criar em matriz alheia é recusado mesmo com o id no corpo do pedido', () => {
  const { ctx, matrizB } = clienteComDuasMatrizes();
  const alheia = criarEmpresa(ctx.usuarioId, { nome: 'Terceiro Contratante' }).id;

  assert.equal(empresaDeEscrita(ctx, matrizB), matrizB, 'a matriz do cliente passa');
  assert.throws(
    () => lancar(ctx, alheia, 10),
    (erro: unknown) => (erro as { status?: number }).status === 403,
  );
  // Nada entrou na base alheia.
  const n = db().prepare('SELECT COUNT(*) AS n FROM lancamentos WHERE empresa_id = ?').get(alheia) as {
    n: number;
  };
  assert.equal(n.n, 0);
});

test('o filtro local aceita lista e o contrato antigo de um id só', () => {
  assert.deepEqual(empresasDoPedido({ empresas: '3,7,3' }), [3, 7]);
  assert.deepEqual(empresasDoPedido({ empresa_id: '5' }), [5]);
  assert.deepEqual(empresasDoPedido({}), [], 'vazio significa o cliente inteiro');
  assert.deepEqual(empresasDoPedido({ empresas: 'abc' }), [], 'lixo não vira filtro');
});

test('escopo vazio cai na matriz em foco, e não no banco inteiro', () => {
  const { ctx } = ambienteLimpo();
  const semLista: Contexto = { ...ctx, empresaIds: [] };
  assert.deepEqual(escopoDeLeitura(semLista), [ctx.empresaId]);
  // E o contexto de outro tenant continua recusando o que não é dele.
  const outra = criarEmpresa(ctx.usuarioId, { nome: 'Vizinha' }).id;
  assert.throws(
    () => escopoDeLeitura(contextoDe(ctx, outra), [ctx.empresaId]),
    (erro: unknown) => (erro as { status?: number }).status === 403,
  );
});

test('pedir um cliente que não é seu é 403, e a tentativa fica registrada', () => {
  const { ctx } = ambienteLimpo();
  // Um cliente que existe e ao qual esta pessoa NÃO está vinculada: é o caso
  // em que um id adivinhado chegaria a dado real se ninguém conferisse.
  const clienteAlheio = (criarCliente({ nome: 'Cliente de Outra Pessoa' }) as { id: number }).id;

  const req = {
    sessao: { usuarioId: ctx.usuarioId, email: ctx.usuarioEmail },
    header: (nome: string) => (nome === 'x-cliente-id' ? String(clienteAlheio) : undefined),
    query: {},
    originalUrl: '/api/financeiro',
    method: 'GET',
  } as unknown as Request;

  let recusa: unknown;
  comEmpresa(req, {} as never, (erro?: unknown) => {
    recusa = erro;
  });
  assert.equal((recusa as { status?: number }).status, 403);
  assert.equal(req.contexto, undefined, 'contexto nenhum é montado a partir de um cliente alheio');

  const trilha = db()
    .prepare('SELECT cliente_id, usuario_id, rota, metodo FROM acesso_negado ORDER BY id DESC LIMIT 1')
    .get() as { cliente_id: number; usuario_id: number; rota: string; metodo: string } | undefined;
  assert.deepEqual(trilha, {
    cliente_id: clienteAlheio,
    usuario_id: ctx.usuarioId,
    rota: '/api/financeiro',
    metodo: 'GET',
  });
});
