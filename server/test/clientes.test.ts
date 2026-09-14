import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, idTipoDespesa, mesRelativo } from './apoio.js';
import { db } from '../src/db/index.js';
import {
  clientesDoUsuario,
  criarCliente,
  criarMatriz,
  criarUnidade,
  ehMatriz,
  estruturaDoCliente,
  exigirCliente,
  matrizPeloCnpj,
  raizDoCnpj,
  usuarioTemCliente,
  vincularUsuario,
} from '../src/domain/clientes.js';
import { semearClientes, UNIDADES_GRUPO } from '../src/db/clientes-seed.js';
import { criarLancamento } from '../src/domain/financeiro.js';
import { criarProjeto } from '../src/domain/projetos.js';
import { criarEmpresa } from '../src/domain/empresas.js';

// ------------------------------------------------------------------- CNPJ

test('a raiz do CNPJ é o que diz se duas unidades são a mesma matriz', () => {
  ambienteLimpo();
  assert.equal(raizDoCnpj('29.521.159/0002-14'), '29521159');
  assert.equal(raizDoCnpj('29.521.159/0005-67'), '29521159');
  assert.notEqual(raizDoCnpj('29.843.964/0001-83'), raizDoCnpj('29.521.159/0002-14'));
  // Pontuação não pode decidir identidade: os dois são o mesmo CNPJ.
  assert.equal(raizDoCnpj('29521159000214'), raizDoCnpj('29.521.159/0002-14'));
});

test('sufixo 0001 é matriz; o resto é filial', () => {
  ambienteLimpo();
  assert.equal(ehMatriz('29.843.964/0001-83'), true);
  assert.equal(ehMatriz('29.521.159/0005-67'), false);
});

// ------------------------------------------------------------------ acesso

test('o usuário só enxerga os clientes a que está vinculado', () => {
  const { ctx } = ambienteLimpo();
  const alheio = criarCliente({ nome: 'Cliente de outro' });
  const meus = clientesDoUsuario(ctx.usuarioId);
  assert.ok(meus.length >= 1, 'o cliente da própria empresa aparece');
  assert.ok(!meus.some((c) => c.id === alheio.id), 'o cliente alheio não aparece');
});

test('pedir um cliente alheio é recusado, e a recusa não diz se ele existe', () => {
  const { ctx } = ambienteLimpo();
  const alheio = criarCliente({ nome: 'Cliente de outro' });
  assert.equal(usuarioTemCliente(ctx.usuarioId, alheio.id), false);
  assert.throws(() => exigirCliente(ctx.usuarioId, alheio.id), /não tem acesso a este cliente/i);
  // Id que nunca existiu dá a MESMA recusa: a diferença contaria qual id existe.
  assert.throws(() => exigirCliente(ctx.usuarioId, 999_999), /não tem acesso a este cliente/i);
});

test('vincular dá acesso, e é idempotente', () => {
  const { ctx } = ambienteLimpo();
  const outro = criarCliente({ nome: 'Segundo cliente' });
  vincularUsuario(ctx.usuarioId, outro.id);
  vincularUsuario(ctx.usuarioId, outro.id);
  assert.equal(usuarioTemCliente(ctx.usuarioId, outro.id), true);
  assert.equal(clientesDoUsuario(ctx.usuarioId).filter((c) => c.id === outro.id).length, 1);
});

// ------------------------------------------------------------- isolamento

test('toda empresa nasce com dono, e o registro herda o dono dela', () => {
  const { ctx } = ambienteLimpo();
  assert.ok(ctx.clienteId, 'a empresa do ambiente tem cliente');

  const lanc = criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(0),
    valor: 100,
    natureza: 'fixa',
    classificacao: 'despesa',
  });
  const projeto = criarProjeto(ctx, {
    nome: 'Projeto',
    mesInicio: mesRelativo(0),
    mesFimPlanejado: mesRelativo(2),
  });

  // O carimbo é do BANCO, por gatilho: nenhum INSERT precisa lembrar dele, e é
  // isso que impede um caminho de escrita novo de criar registro sem dono.
  const donoLanc = db().prepare('SELECT cliente_id FROM lancamentos WHERE id = ?').get(lanc.id) as {
    cliente_id: number | null;
  };
  const donoProj = db().prepare('SELECT cliente_id FROM projetos WHERE id = ?').get(projeto.id) as {
    cliente_id: number | null;
  };
  assert.equal(donoLanc.cliente_id, ctx.clienteId);
  assert.equal(donoProj.cliente_id, ctx.clienteId);
});

test('dois clientes não se enxergam: cada registro fica no dono certo', () => {
  const { ctx } = ambienteLimpo();
  const segunda = criarEmpresa(ctx.usuarioId, { nome: 'Outra contratante' });
  const donoA = ctx.clienteId;
  const donoB = (
    db().prepare('SELECT cliente_id FROM empresas WHERE id = ?').get(segunda.id) as {
      cliente_id: number;
    }
  ).cliente_id;
  assert.notEqual(donoA, donoB, 'empresa sem cliente informado vira cliente de si mesma');

  criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: mesRelativo(0),
    valor: 100,
    natureza: 'fixa',
    classificacao: 'despesa',
  });
  const porCliente = db()
    .prepare('SELECT cliente_id, COUNT(*) n FROM lancamentos GROUP BY cliente_id')
    .all() as Array<{ cliente_id: number; n: number }>;
  assert.equal(porCliente.length, 1);
  assert.equal(porCliente[0]!.cliente_id, donoA);
});

// ------------------------------------------------------------------- seed

test('o seed monta o grupo pela raiz do CNPJ, e é idempotente', () => {
  ambienteLimpo();
  const primeira = semearClientes();
  assert.equal(primeira.clientes, 3, 'três clientes: o grupo, Limas IT e SoulCoop');

  const grupo = db().prepare("SELECT id FROM clientes WHERE nome = 'Grupo Brasil Home Care'").get() as {
    id: number;
  };
  const arvore = estruturaDoCliente(grupo.id);

  // Seis matrizes: as cinco de raiz própria mais o Hospital Milagres, cuja
  // primeira unidade conhecida (HM-CE) vira a cabeça — a tabela do gestor não
  // traz o 0001 dele.
  assert.equal(arvore.length, 6, `matrizes: ${arvore.map((m) => m.codigo).join(', ')}`);

  const milagres = arvore.find((m) => raizDoCnpj(m.cnpj) === '29521159')!;
  assert.ok(milagres, 'o Hospital Milagres tem matriz');
  assert.equal(milagres.filiais.length, 2, 'HM-DF e HM-MT penduram nela');
  assert.deepEqual(
    milagres.filiais.map((f) => f.codigo).sort(),
    ['HM-DF', 'HM-MT'],
  );

  const alianca = arvore.find((m) => m.codigo === 'AHC-RN')!;
  assert.equal(alianca.filiais.length, 0, 'matriz de raiz própria não ganha filial de outra raiz');

  // Endereço em branco na tabela entra nulo, e não como texto inventado.
  const union = arvore.find((m) => m.codigo === 'UC-SP')!;
  assert.equal(union.endereco, null);
  assert.equal(union.cep, null);

  // Rodar de novo não duplica nada.
  const segunda = semearClientes();
  assert.equal(segunda.matrizes, 0);
  assert.equal(segunda.filiais, 0);
  assert.equal(estruturaDoCliente(grupo.id).length, 6);
});

test('Limas IT e SoulCoop entram como cliente de matriz única', () => {
  ambienteLimpo();
  semearClientes();
  for (const nome of ['Limas IT', 'SoulCoop']) {
    const c = db().prepare('SELECT id FROM clientes WHERE nome = ?').get(nome) as { id: number };
    const arvore = estruturaDoCliente(c.id);
    assert.equal(arvore.length, 1, `${nome} tem uma matriz`);
    assert.equal(arvore[0]!.filiais.length, 0, `${nome} ainda não tem filial cadastrada`);
  }
});

test('a tabela do gestor entra inteira: nenhuma unidade fica de fora', () => {
  ambienteLimpo();
  semearClientes();
  const grupo = db().prepare("SELECT id FROM clientes WHERE nome = 'Grupo Brasil Home Care'").get() as {
    id: number;
  };
  const arvore = estruturaDoCliente(grupo.id);
  const codigos = new Set([
    ...arvore.map((m) => m.codigo),
    ...arvore.flatMap((m) => m.filiais.map((f) => f.codigo as string)),
  ]);
  for (const u of UNIDADES_GRUPO) {
    assert.ok(codigos.has(u.codigo), `${u.codigo} está cadastrada`);
  }
  assert.equal(codigos.size, UNIDADES_GRUPO.length);
});

// -------------------------------------------------------- cadastro manual

test('a matriz se acha pelo CNPJ, que é o que a carga usa para pendurar a filial', () => {
  const { ctx } = ambienteLimpo();
  const cliente = criarCliente({ nome: 'Cliente com CNPJ' });
  vincularUsuario(ctx.usuarioId, cliente.id);
  criarMatriz(cliente.id, { nome: 'Matriz A', cnpj: '11.222.333/0001-44' });

  const achada = matrizPeloCnpj(cliente.id, '11.222.333/0009-00');
  assert.ok(achada, 'a filial encontra a matriz pela raiz');
  assert.equal(matrizPeloCnpj(cliente.id, '99.888.777/0001-00'), null, 'raiz desconhecida não casa');
});

test('nome repetido é recusado na matriz e na filial', () => {
  const { ctx } = ambienteLimpo();
  const cliente = criarCliente({ nome: 'Cliente repetido' });
  vincularUsuario(ctx.usuarioId, cliente.id);
  const matriz = criarMatriz(cliente.id, { nome: 'Matriz A' }) as { id: number };
  assert.throws(() => criarMatriz(cliente.id, { nome: 'Matriz A' }), /Já existe uma matriz/i);

  criarUnidade(matriz.id, { nome: 'Unidade 1' });
  assert.throws(() => criarUnidade(matriz.id, { nome: 'Unidade 1' }), /Já existe uma filial/i);
});
