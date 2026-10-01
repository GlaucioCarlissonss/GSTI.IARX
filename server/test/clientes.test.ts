import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, idTipoDespesa, mesRelativo } from './apoio.js';
import { db } from '../src/db/index.js';
import {
  clientesDoUsuario,
  criarCliente,
  criarMatriz,
  criarUnidade,
  criarUnidadeDoCliente,
  ehMatriz,
  estruturaDoCliente,
  exigirCliente,
  matrizPeloCnpj,
  raizDoCnpj,
  usuarioTemCliente,
  vincularUsuario,
} from '../src/domain/clientes.js';
import { CLIENTE_GRUPO, semearClientes, UNIDADES_GRUPO } from '../src/db/clientes-seed.js';
import { criarLancamento } from '../src/domain/financeiro.js';
import { criarProjeto } from '../src/domain/projetos.js';
import { criarEmpresa, listarEmpresasDoUsuario } from '../src/domain/empresas.js';

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

test('a lista de matrizes diz de quem cada uma é: é como a tela separa os clientes', () => {
  const { ctx } = ambienteLimpo();
  const segunda = criarEmpresa(ctx.usuarioId, { nome: 'Outra contratante' });
  const minhas = listarEmpresasDoUsuario(ctx.usuarioId);
  const a = minhas.find((e) => e.id === ctx.empresaId)!;
  const b = minhas.find((e) => e.id === segunda.id)!;
  assert.equal(a.cliente_id, ctx.clienteId);
  assert.ok(b.cliente_id, 'a empresa nova também tem dono');
  assert.notEqual(a.cliente_id, b.cliente_id, 'sem isso a tela juntaria dois contratantes no mesmo seletor');
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

test('numa base que já tem as unidades, o seed completa em vez de duplicar', () => {
  const { ctx } = ambienteLimpo();
  // O retrato da base real: a matriz agrupadora e a unidade que veio pelas
  // planilhas, sem CNPJ nem endereço. A tabela do gestor descreve esta mesma
  // unidade — criar de novo daria duas "AHC RN" para o gestor escolher.
  const grupoId = criarCliente({ nome: CLIENTE_GRUPO }).id;
  vincularUsuario(ctx.usuarioId, grupoId);
  const alianca = criarMatriz(grupoId, { nome: 'ALIANÇA' }) as { id: number };
  criarUnidade(alianca.id, { nome: 'AHC RN' });
  criarUnidade(alianca.id, { nome: 'AHC SE' });

  const r = semearClientes();
  const arvore = estruturaDoCliente(grupoId);
  const nomes = arvore.map((m) => m.nome);
  assert.ok(!nomes.includes('Aliança Home Care Serviços Médicos LTDA'), 'nenhuma matriz duplicada: ' + nomes.join(', '));
  assert.ok(r.completadas >= 1, 'a unidade existente foi completada');

  const ahcRn = arvore.find((m) => m.id === alianca.id)!.filiais.find((f) => f.nome === 'AHC RN')!;
  assert.equal(ahcRn.cnpj, '29843964000183', 'o CNPJ da tabela entrou na unidade que já existia');
  assert.match(String(ahcRn.endereco), /Barro Vermelho/);

  // A matriz agrupadora NÃO recebe o CNPJ da unidade: RESIDENCIAL abriga
  // unidades de três pessoas jurídicas, e carimbar uma delas na matriz mentiria.
  assert.equal(arvore.find((m) => m.id === alianca.id)!.cnpj, null);

  // Só AHC-RN casou; as outras sete seguem o caminho normal de cadastro.
  assert.ok(!r.pendentes.includes('AHC-RN'), 'AHC-RN não ficou pendente');
  assert.equal(r.pendentes.length, UNIDADES_GRUPO.length - 1);
});

test('completar não sobrescreve o que já estava preenchido', () => {
  const { ctx } = ambienteLimpo();
  const grupoId = criarCliente({ nome: CLIENTE_GRUPO }).id;
  vincularUsuario(ctx.usuarioId, grupoId);
  const alianca = criarMatriz(grupoId, { nome: 'ALIANÇA' }) as { id: number };
  criarUnidade(alianca.id, { nome: 'AHC RN', endereco: 'Endereço conferido pelo gestor' });

  semearClientes();
  const ahcRn = estruturaDoCliente(grupoId)
    .find((m) => m.id === alianca.id)!
    .filiais.find((f) => f.nome === 'AHC RN')!;
  assert.equal(ahcRn.endereco, 'Endereço conferido pelo gestor', 'o que foi ajustado à mão fica');
  assert.equal(ahcRn.cnpj, '29843964000183', 'o que estava em branco é preenchido');
});

test('a unidade nova vai para a matriz que já abriga a raiz, mesmo sem CNPJ nela', () => {
  const { ctx } = ambienteLimpo();
  const grupoId = criarCliente({ nome: CLIENTE_GRUPO }).id;
  vincularUsuario(ctx.usuarioId, grupoId);
  const milagres = criarMatriz(grupoId, { nome: 'MILAGRES' }) as { id: number };
  criarUnidade(milagres.id, { nome: 'HM CE', cnpj: '29.521.159/0002-14' });

  // A matriz agrupadora não tem CNPJ; a raiz está na filial. Sem olhar para
  // ela, HM-DF abriria uma segunda matriz para a mesma pessoa jurídica.
  const achada = matrizPeloCnpj(grupoId, '29.521.159/0005-67');
  assert.equal(achada?.id, milagres.id);
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

test('a matriz nasce utilizável: aparece no seletor e aceita lançamento', () => {
  const { ctx } = ambienteLimpo();
  const cliente = criarCliente({ nome: 'Cliente novo' });
  vincularUsuario(ctx.usuarioId, cliente.id);
  const matriz = criarMatriz(cliente.id, { nome: 'Matriz nova' }, ctx.usuarioId) as { id: number };

  // Sem o vínculo, a matriz existiria no banco e não apareceria para ninguém.
  const minhas = listarEmpresasDoUsuario(ctx.usuarioId).map((e) => e.id);
  assert.ok(minhas.includes(matriz.id), 'a matriz criada aparece para quem a criou');

  // Sem tipo de despesa, o primeiro lançamento não teria a que se prender.
  const tipos = db().prepare('SELECT COUNT(*) n FROM tipos_despesa WHERE empresa_id = ?').get(matriz.id) as {
    n: number;
  };
  const filas = db().prepare('SELECT COUNT(*) n FROM filas_ticket WHERE empresa_id = ?').get(matriz.id) as {
    n: number;
  };
  assert.ok(tipos.n > 0, 'catálogo de despesa padrão');
  assert.ok(filas.n > 0, 'filas de chamado padrão');
});

test('o seed dá acesso a quem o rodou: cliente que ninguém abre é cadastro morto', () => {
  const { ctx } = ambienteLimpo();
  semearClientes(ctx.usuarioId);
  const meus = clientesDoUsuario(ctx.usuarioId).map((c) => c.nome);
  for (const nome of [CLIENTE_GRUPO, 'Limas IT', 'SoulCoop']) {
    assert.ok(meus.includes(nome), `${nome} está acessível (tem: ${meus.join(', ')})`);
  }
  // E as matrizes criadas aparecem no seletor de quem rodou.
  const empresas = listarEmpresasDoUsuario(ctx.usuarioId).map((e) => e.nome);
  assert.ok(empresas.includes('Limas IT'), empresas.join(', '));
});

test('a regra do CNPJ decide onde a unidade entra, sem ninguém dizer', () => {
  const { ctx } = ambienteLimpo();
  const cliente = criarCliente({ nome: 'Cliente com raiz' });
  vincularUsuario(ctx.usuarioId, cliente.id);

  // Raiz desconhecida: abre matriz.
  const matriz = criarUnidadeDoCliente(cliente.id, { nome: 'Sede', cnpj: '11.222.333/0001-44' }, ctx.usuarioId) as {
    id: number;
  };
  const arvore1 = estruturaDoCliente(cliente.id);
  assert.equal(arvore1.length, 1);

  // Mesma raiz: entra como filial da matriz dela, sem a tela ter de saber.
  criarUnidadeDoCliente(cliente.id, { nome: 'Unidade 2', cnpj: '11.222.333/0002-25' }, ctx.usuarioId);
  const arvore2 = estruturaDoCliente(cliente.id);
  assert.equal(arvore2.length, 1, 'nenhuma matriz nova para a mesma pessoa jurídica');
  assert.equal(arvore2[0]!.filiais.length, 1);
  assert.equal(arvore2[0]!.id, matriz.id);
});

test('pedir matriz para um CNPJ de raiz já cadastrada é recusado, dizendo onde ela entra', () => {
  const { ctx } = ambienteLimpo();
  const cliente = criarCliente({ nome: 'Cliente raiz repetida' });
  vincularUsuario(ctx.usuarioId, cliente.id);
  criarUnidadeDoCliente(cliente.id, { nome: 'Sede', cnpj: '11.222.333/0001-44' }, ctx.usuarioId);
  assert.throws(
    () =>
      criarUnidadeDoCliente(
        cliente.id,
        { tipo: 'MATRIZ', nome: 'Outra sede', cnpj: '11.222.333/0009-00' },
        ctx.usuarioId,
      ),
    /mesma raiz de "Sede".*filial/is,
  );
});

test('filial não se pendura na matriz de outro cliente', () => {
  const { ctx } = ambienteLimpo();
  const meu = criarCliente({ nome: 'Meu cliente' });
  vincularUsuario(ctx.usuarioId, meu.id);
  const alheio = criarCliente({ nome: 'Cliente alheio' });
  const matrizAlheia = criarMatriz(alheio.id, { nome: 'Matriz alheia' }) as { id: number };

  assert.throws(
    () => criarUnidadeDoCliente(meu.id, { tipo: 'FILIAL', nome: 'Invasora', matrizPaiId: matrizAlheia.id }),
    /não encontrada neste cliente/i,
  );
  assert.equal(estruturaDoCliente(alheio.id)[0]!.filiais.length, 0, 'a estrutura alheia fica intacta');
});

test('filial sem matriz e sem CNPJ conhecido é recusada, não adivinhada', () => {
  const { ctx } = ambienteLimpo();
  const cliente = criarCliente({ nome: 'Cliente sem raiz' });
  vincularUsuario(ctx.usuarioId, cliente.id);
  assert.throws(
    () => criarUnidadeDoCliente(cliente.id, { tipo: 'FILIAL', nome: 'Solta' }, ctx.usuarioId),
    /Informe a matriz/i,
  );
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
