import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco, definirBanco } from '../src/db/index.js';
import { autenticar, registrar, registroAberto, verificarToken } from '../src/domain/auth.js';
import { acessoDoUsuario, concederAcesso, criarEmpresa, listarEmpresasDoUsuario } from '../src/domain/empresas.js';
import { listarTiposDespesa, TIPOS_DESPESA_PADRAO } from '../src/domain/cadastros.js';

function bancoVazio() {
  definirBanco(abrirBanco(':memory:'));
  delete process.env.REGISTRO_ABERTO;
}

test('o cadastro aberto vale só para a primeira conta', () => {
  bancoVazio();
  assert.deepEqual(registroAberto(), { aberto: true, primeiroAcesso: true });

  registrar({ nome: 'Primeiro Gestor', email: 'gestor@exemplo.com', senha: 'senha-bem-forte' });

  assert.deepEqual(registroAberto(), { aberto: false, primeiroAcesso: false });
  assert.throws(
    () => registrar({ nome: 'Intruso', email: 'intruso@exemplo.com', senha: 'senha-bem-forte' }),
    /cadastro aberto está desativado/,
  );
});

test('a instalação pode manter o auto-cadastro ligado', () => {
  bancoVazio();
  registrar({ nome: 'Gestor', email: 'gestor@exemplo.com', senha: 'senha-bem-forte' });
  process.env.REGISTRO_ABERTO = 'true';
  try {
    assert.equal(registroAberto().aberto, true);
    const segundo = registrar({ nome: 'Colega', email: 'colega@exemplo.com', senha: 'senha-bem-forte' });
    assert.equal(segundo.email, 'colega@exemplo.com');
  } finally {
    delete process.env.REGISTRO_ABERTO;
  }
});

test('cadastro valida e-mail, nome e tamanho de senha', () => {
  bancoVazio();
  assert.throws(() => registrar({ nome: 'X', email: 'sem-arroba', senha: 'senha-bem-forte' }), /E-mail inválido/);
  assert.throws(() => registrar({ nome: '', email: 'a@b.com', senha: 'senha-bem-forte' }), /nome é obrigatório/);
  assert.throws(() => registrar({ nome: 'X', email: 'a@b.com', senha: 'curta' }), /ao menos 8 caracteres/);

  registrar({ nome: 'X', email: 'a@b.com', senha: 'senha-bem-forte' });
  process.env.REGISTRO_ABERTO = 'true';
  try {
    assert.throws(() => registrar({ nome: 'Y', email: 'A@B.com', senha: 'outra-senha-1' }), /já existe uma conta/i);
  } finally {
    delete process.env.REGISTRO_ABERTO;
  }
});

test('autenticação recusa senha errada e emite sessão válida', () => {
  bancoVazio();
  registrar({ nome: 'Gestor', email: 'gestor@exemplo.com', senha: 'senha-bem-forte' });

  assert.throws(() => autenticar('gestor@exemplo.com', 'errada'), /E-mail ou senha inválidos/);
  assert.throws(() => autenticar('ninguem@exemplo.com', 'senha-bem-forte'), /E-mail ou senha inválidos/);

  const { token, usuario } = autenticar('GESTOR@exemplo.com', 'senha-bem-forte');
  assert.equal(verificarToken(token).usuarioId, usuario.usuarioId);
  assert.throws(() => verificarToken('token-falso'), /Sessão inválida/);
});

test('a primeira empresa nasce com os tipos padrão e o criador como gestor', () => {
  bancoVazio();
  const usuario = registrar({ nome: 'Gestor', email: 'gestor@exemplo.com', senha: 'senha-bem-forte' });
  const empresa = criarEmpresa(usuario.id, { nome: 'Minha Empresa' });

  assert.equal(empresa.papel, 'gestor');
  assert.equal(acessoDoUsuario(usuario.id, empresa.id), 'gestor');
  assert.deepEqual(listarEmpresasDoUsuario(usuario.id).map((e) => e.nome), ['Minha Empresa']);

  const ctx = { empresaId: empresa.id, usuarioId: usuario.id, usuarioEmail: usuario.email, papel: 'gestor' as const };
  const tipos = (listarTiposDespesa(ctx) as Array<{ nome: string }>).map((t) => t.nome).sort();
  assert.deepEqual(tipos, [...TIPOS_DESPESA_PADRAO].sort());
});

test('acesso concedido a outro usuário respeita o papel', () => {
  bancoVazio();
  const dono = registrar({ nome: 'Gestor', email: 'gestor@exemplo.com', senha: 'senha-bem-forte' });
  process.env.REGISTRO_ABERTO = 'true';
  const convidado = registrar({ nome: 'Leitor', email: 'leitor@exemplo.com', senha: 'senha-bem-forte' });
  delete process.env.REGISTRO_ABERTO;

  const empresa = criarEmpresa(dono.id, { nome: 'Minha Empresa' });
  assert.equal(acessoDoUsuario(convidado.id, empresa.id), null, 'sem vínculo, sem acesso');

  concederAcesso(empresa.id, 'leitor@exemplo.com', 'leitor');
  assert.equal(acessoDoUsuario(convidado.id, empresa.id), 'leitor');

  concederAcesso(empresa.id, 'leitor@exemplo.com', 'gestor');
  assert.equal(acessoDoUsuario(convidado.id, empresa.id), 'gestor', 'o papel é atualizado, não duplicado');
});
