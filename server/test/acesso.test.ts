import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco, db, definirBanco } from '../src/db/index.js';
import { autenticar, registrar, registroAberto, verificarToken } from '../src/domain/auth.js';
import { acessoDoUsuario, criarEmpresa, listarEmpresasDoUsuario } from '../src/domain/empresas.js';
import { clienteDaEmpresa, vincularUsuario } from '../src/domain/clientes.js';
import { listarTiposDespesa, TIPOS_DESPESA_PADRAO } from '../src/domain/cadastros.js';
import { SEGREDO_DE_TESTE } from './apoio.js';

function bancoVazio() {
  process.env.JWT_SECRET = SEGREDO_DE_TESTE;
  definirBanco(abrirBanco(':memory:'));
  delete process.env.REGISTRO_ABERTO;
}

test('o cadastro aberto vale só para a primeira conta', () => {
  bancoVazio();
  assert.deepEqual(registroAberto(), { aberto: true, primeiroAcesso: true });

  registrar({ nome: 'Primeiro Gestor', email: 'gestor@exemplo.com', senha: 'senha-bem-forte-1' });

  assert.deepEqual(registroAberto(), { aberto: false, primeiroAcesso: false });
  assert.throws(
    () => registrar({ nome: 'Intruso', email: 'intruso@exemplo.com', senha: 'senha-bem-forte-1' }),
    /cadastro aberto está desativado/,
  );
});

test('a instalação pode manter o auto-cadastro ligado', () => {
  bancoVazio();
  registrar({ nome: 'Gestor', email: 'gestor@exemplo.com', senha: 'senha-bem-forte-1' });
  process.env.REGISTRO_ABERTO = 'true';
  try {
    assert.equal(registroAberto().aberto, true);
    const segundo = registrar({ nome: 'Colega', email: 'colega@exemplo.com', senha: 'senha-bem-forte-1' });
    assert.equal(segundo.email, 'colega@exemplo.com');
  } finally {
    delete process.env.REGISTRO_ABERTO;
  }
});

test('cadastro valida e-mail, nome e tamanho de senha', () => {
  bancoVazio();
  assert.throws(() => registrar({ nome: 'X', email: 'sem-arroba', senha: 'senha-bem-forte-1' }), /E-mail inválido/);
  assert.throws(() => registrar({ nome: '', email: 'a@b.com', senha: 'senha-bem-forte-1' }), /nome é obrigatório/);
  assert.throws(() => registrar({ nome: 'X', email: 'a@b.com', senha: 'curta' }), /ao menos 8 caracteres/);

  registrar({ nome: 'X', email: 'a@b.com', senha: 'senha-bem-forte-1' });
  process.env.REGISTRO_ABERTO = 'true';
  try {
    assert.throws(() => registrar({ nome: 'Y', email: 'A@B.com', senha: 'outra-senha-1' }), /já existe uma conta/i);
  } finally {
    delete process.env.REGISTRO_ABERTO;
  }
});

test('o login é por usuário, e o e-mail não serve como identificador', () => {
  bancoVazio();
  const criado = registrar({ nome: 'Gestor', email: 'gestor@exemplo.com', senha: 'senha-bem-forte-1' });
  // Sem username informado, ele sai do e-mail: o primeiro acesso não pede mais
  // um campo para quem está começando.
  assert.equal(criado.username, 'gestor');

  assert.throws(() => autenticar('gestor', 'errada'), /Usuário ou senha inválidos/);
  assert.throws(() => autenticar('ninguem', 'senha-bem-forte-1'), /Usuário ou senha inválidos/);
  // Quem sabe o e-mail de alguém não deve, por isso, saber como essa pessoa
  // entra no sistema.
  assert.throws(() => autenticar('gestor@exemplo.com', 'senha-bem-forte-1'), /Usuário ou senha inválidos/);

  const { token, usuario } = autenticar('GESTOR', 'senha-bem-forte-1');
  assert.equal(verificarToken(token).usuarioId, usuario.usuarioId);
  assert.equal(usuario.username, 'gestor');
  assert.throws(() => verificarToken('token-falso'), /Sessão inválida/);
});

test('a recusa não distingue usuário inexistente de senha errada', () => {
  bancoVazio();
  registrar({ nome: 'Gestor', email: 'gestor@exemplo.com', senha: 'senha-bem-forte-1' });
  const semConta = (() => { try { autenticar('ninguem', 'x1234567'); } catch (e) { return (e as Error).message; } })();
  const senhaErrada = (() => { try { autenticar('gestor', 'x1234567'); } catch (e) { return (e as Error).message; } })();
  // Uma mensagem que distingue os dois casos é uma lista de usuários válidos
  // entregue a quem tenta adivinhar.
  assert.equal(semConta, senhaErrada);
});

test('a política de senha exige letras e números', () => {
  bancoVazio();
  assert.throws(
    () => registrar({ nome: 'X', email: 'x@exemplo.com', senha: 'somenteletras' }),
    /letras e números/,
  );
  assert.throws(() => registrar({ nome: 'X', email: 'x@exemplo.com', senha: '1234567890' }), /letras e números/);
  registrar({ nome: 'X', email: 'x@exemplo.com', senha: 'com-letras-e-1' });
});

test('e-mail curto ainda gera um identificador válido', () => {
  bancoVazio();
  // `a@b.com` daria um nome de um caractere, que a regra recusa: o prefixo
  // curto é completado com o domínio.
  const criado = registrar({ nome: 'Curto', email: 'a@b.com', senha: 'senha-bem-forte-1' });
  assert.equal(criado.username, 'ab0');
  assert.ok(autenticar(criado.username, 'senha-bem-forte-1').token);
});

test('a primeira empresa nasce com os tipos padrão e o criador como gestor', () => {
  bancoVazio();
  const usuario = registrar({ nome: 'Gestor', email: 'gestor@exemplo.com', senha: 'senha-bem-forte-1' });
  const empresa = criarEmpresa(usuario.id, { nome: 'Minha Empresa' });

  assert.equal(empresa.papel, 'gestor');
  assert.equal(acessoDoUsuario(usuario.id, empresa.id), 'gestor');
  assert.deepEqual(listarEmpresasDoUsuario(usuario.id).map((e) => e.nome), ['Minha Empresa']);

  const ctx = {
    clienteId: clienteDaEmpresa(empresa.id),
    empresaId: empresa.id,
    empresaIds: [empresa.id],
    usuarioId: usuario.id,
    usuarioEmail: usuario.email,
    papel: 'gestor' as const,
  };
  const tipos = (listarTiposDespesa(ctx) as Array<{ nome: string }>).map((t) => t.nome).sort();
  assert.deepEqual(tipos, [...TIPOS_DESPESA_PADRAO].sort());
});

test('acesso concedido a outro usuário respeita o papel, em toda matriz do cliente', () => {
  bancoVazio();
  const dono = registrar({ nome: 'Gestor', email: 'gestor@exemplo.com', senha: 'senha-bem-forte-1' });
  process.env.REGISTRO_ABERTO = 'true';
  const convidado = registrar({ nome: 'Leitor', email: 'leitor@exemplo.com', senha: 'senha-bem-forte-1' });
  delete process.env.REGISTRO_ABERTO;

  const empresa = criarEmpresa(dono.id, { nome: 'Minha Empresa' });
  const clienteId = clienteDaEmpresa(empresa.id)!;
  assert.equal(acessoDoUsuario(convidado.id, empresa.id), null, 'sem vínculo, sem acesso');

  // O acesso é do CLIENTE: uma vez concedido, vale na matriz — e valeria em
  // qualquer outra que o mesmo cliente viesse a ter.
  vincularUsuario(convidado.id, clienteId, 'leitor');
  assert.equal(acessoDoUsuario(convidado.id, empresa.id), 'leitor');

  // `vincularUsuario` não pisa num papel já concedido — é `atualizarUsuario`
  // quem muda; aqui a conferência é direta no banco, sem passar pela rota.
  db()
    .prepare('UPDATE usuario_clientes SET papel = ? WHERE usuario_id = ? AND cliente_id = ?')
    .run('gestor', convidado.id, clienteId);
  assert.equal(acessoDoUsuario(convidado.id, empresa.id), 'gestor', 'o papel é atualizado, não duplicado');
});
