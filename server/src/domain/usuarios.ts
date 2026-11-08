/**
 * Usuários e acessos — a tela do administrador.
 *
 * O usuário é global (uma conta, um login); o ACESSO é por CLIENTE, com papel
 * e perfil próprios, valendo em toda matriz e filial dele. É o que permite a
 * mesma pessoa administrar um contratante e só olhar outro.
 */
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { erroConflito, erroNaoEncontrado, erroValidacao } from '../lib/erros.js';
import type { Contexto } from './contexto.js';
import { auditar } from './auditoria.js';
import { normalizarUsername, validarSenha } from './auth.js';
import { garantirPerfisPadrao, PERFIL_EDICAO, PERFIL_LEITURA } from './acesso.js';

interface LinhaUsuario {
  id: number;
  nome: string;
  username: string | null;
  email: string;
  ativo: number;
  ultimo_login_em: string | null;
  criado_em: string;
  papel: string;
  perfil_id: number | null;
  perfil_nome: string | null;
}

function apresentar(l: LinhaUsuario) {
  return {
    id: l.id,
    nome: l.nome,
    username: l.username,
    email: l.email,
    ativo: l.ativo === 1,
    ultimo_login_em: l.ultimo_login_em,
    criado_em: l.criado_em,
    papel: l.papel,
    perfil_id: l.perfil_id,
    perfil_nome: l.perfil_nome,
  };
}

const SQL_BASE = `
  SELECT u.id, u.nome, u.username, u.email, u.ativo, u.ultimo_login_em, u.criado_em,
         uc.papel, uc.perfil_id, p.nome AS perfil_nome
    FROM usuario_clientes uc
    JOIN usuarios u ON u.id = uc.usuario_id
    LEFT JOIN perfis p ON p.id = uc.perfil_id`;

/** O cliente em contexto, ou recusa — mesma regra de `acesso.ts`. */
function exigirClienteEmContexto(ctx: Contexto): number {
  if (ctx.clienteId === null) throw erroValidacao('Não há cliente em contexto para esta operação.');
  return ctx.clienteId;
}

export function listarUsuarios(ctx: Contexto) {
  const clienteId = exigirClienteEmContexto(ctx);
  garantirPerfisPadrao(clienteId);
  const linhas = db()
    .prepare(`${SQL_BASE} WHERE uc.cliente_id = ? ORDER BY u.nome`)
    .all(clienteId) as LinhaUsuario[];
  return linhas.map(apresentar);
}

function obter(ctx: Contexto, usuarioId: number): LinhaUsuario {
  const linha = db()
    .prepare(`${SQL_BASE} WHERE uc.cliente_id = ? AND u.id = ?`)
    .get(exigirClienteEmContexto(ctx), usuarioId) as LinhaUsuario | undefined;
  // Quem não tem acesso a este cliente não existe para ele: responder
  // "usuário X não está neste cliente" já contaria que a conta existe.
  if (!linha) throw erroNaoEncontrado('Usuário não encontrado neste cliente.');
  return linha;
}

/** Perfil padrão correspondente ao papel, quando o admin não escolhe um. */
function perfilPadrao(clienteId: number, papel: string): number | null {
  const nome = papel === 'gestor' ? PERFIL_EDICAO : PERFIL_LEITURA;
  const p = db()
    .prepare('SELECT id FROM perfis WHERE cliente_id = ? AND nome = ?')
    .get(clienteId, nome) as { id: number } | undefined;
  return p?.id ?? null;
}

function validarPerfil(clienteId: number, perfilId: number | null | undefined): number | null | undefined {
  if (perfilId === undefined) return undefined;
  if (perfilId === null) return null;
  const existe = db()
    .prepare('SELECT id FROM perfis WHERE id = ? AND cliente_id = ?')
    .get(perfilId, clienteId);
  if (!existe) throw erroValidacao('O perfil escolhido não existe neste cliente.');
  return perfilId;
}

export interface EntradaUsuario {
  nome: string;
  username: string;
  email: string;
  senha: string;
  papel?: 'gestor' | 'leitor';
  perfil_id?: number | null;
}

/**
 * Cria a conta e já a vincula a esta empresa. A senha inicial é definida pelo
 * administrador e trocada por quem recebe — não há conta sem senha, nem senha
 * em branco esperando alguém entrar por ela.
 */
export function criarUsuario(ctx: Contexto, entrada: EntradaUsuario) {
  const clienteId = exigirClienteEmContexto(ctx);
  const nome = entrada.nome?.trim();
  if (!nome) throw erroValidacao('O nome é obrigatório.');
  const email = entrada.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw erroValidacao('E-mail inválido.');
  const username = normalizarUsername(entrada.username);
  validarSenha(entrada.senha);

  if (db().prepare('SELECT id FROM usuarios WHERE email = ?').get(email)) {
    throw erroConflito('Já existe uma conta com este e-mail.');
  }
  if (db().prepare('SELECT id FROM usuarios WHERE username = ?').get(username)) {
    throw erroConflito(`O usuário "${username}" já está em uso.`);
  }

  garantirPerfisPadrao(clienteId);
  const papel = entrada.papel === 'gestor' ? 'gestor' : 'leitor';
  const perfilId = validarPerfil(clienteId, entrada.perfil_id) ?? perfilPadrao(clienteId, papel);

  const info = db()
    .prepare(`INSERT INTO usuarios (nome, username, email, senha_hash, senha_em)
         VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
    .run(nome, username, email, bcrypt.hashSync(entrada.senha, 10));
  const id = Number(info.lastInsertRowid);

  db()
    .prepare('INSERT INTO usuario_clientes (usuario_id, cliente_id, papel, perfil_id) VALUES (?, ?, ?, ?)')
    .run(id, clienteId, papel, perfilId);

  auditar(ctx, {
    entidade: 'usuario',
    entidadeId: id,
    acao: 'criar',
    // A senha não entra na auditoria, nem como hash.
    depois: { nome, username, email, papel, perfil_id: perfilId },
    comEmpresa: false,
  });
  return apresentar(obter(ctx, id));
}

export function atualizarUsuario(
  ctx: Contexto,
  usuarioId: number,
  dados: { nome?: string; email?: string; ativo?: boolean; papel?: 'gestor' | 'leitor'; perfil_id?: number | null },
) {
  const clienteId = exigirClienteEmContexto(ctx);
  const antes = obter(ctx, usuarioId);

  if (dados.nome?.trim()) db().prepare('UPDATE usuarios SET nome = ? WHERE id = ?').run(dados.nome.trim(), usuarioId);
  if (dados.email?.trim()) {
    const email = dados.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw erroValidacao('E-mail inválido.');
    const outro = db().prepare('SELECT id FROM usuarios WHERE email = ? AND id <> ?').get(email, usuarioId);
    if (outro) throw erroConflito('Já existe outra conta com este e-mail.');
    db().prepare('UPDATE usuarios SET email = ? WHERE id = ?').run(email, usuarioId);
  }
  if (dados.ativo !== undefined) {
    if (!dados.ativo && usuarioId === ctx.usuarioId) {
      // Desativar a si mesmo tranca o administrador para fora da própria tela.
      throw erroValidacao('Você não pode desativar a sua própria conta.');
    }
    db().prepare('UPDATE usuarios SET ativo = ? WHERE id = ?').run(dados.ativo ? 1 : 0, usuarioId);
  }
  if (dados.papel) {
    if (usuarioId === ctx.usuarioId && dados.papel !== 'gestor' && antes.papel === 'gestor') {
      throw erroValidacao('Você não pode retirar o próprio papel de gestor. Peça a outro gestor.');
    }
    db()
      .prepare('UPDATE usuario_clientes SET papel = ? WHERE usuario_id = ? AND cliente_id = ?')
      .run(dados.papel, usuarioId, clienteId);
  }
  const perfil = validarPerfil(clienteId, dados.perfil_id);
  if (perfil !== undefined) {
    db()
      .prepare('UPDATE usuario_clientes SET perfil_id = ? WHERE usuario_id = ? AND cliente_id = ?')
      .run(perfil, usuarioId, clienteId);
  }

  const depois = apresentar(obter(ctx, usuarioId));
  auditar(ctx, {
    entidade: 'usuario',
    entidadeId: usuarioId,
    acao: 'atualizar',
    antes: apresentar(antes),
    depois,
    comEmpresa: false,
  });
  return depois;
}

/**
 * Redefinição feita pelo administrador. Derruba as sessões do usuário junto:
 * trocar a senha sem expulsar quem está dentro não troca nada de fato.
 */
export function redefinirSenhaDeUsuario(ctx: Contexto, usuarioId: number, novaSenha: string) {
  obter(ctx, usuarioId);
  validarSenha(novaSenha);
  db()
    .prepare(`UPDATE usuarios SET senha_hash = ?, senha_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .run(bcrypt.hashSync(novaSenha, 10), usuarioId);
  db()
    .prepare(`UPDATE tokens_redefinicao SET usado_em = datetime('now') WHERE usuario_id = ? AND usado_em IS NULL`)
    .run(usuarioId);
  auditar(ctx, {
    entidade: 'usuario',
    entidadeId: usuarioId,
    acao: 'atualizar',
    justificativa: 'senha redefinida pelo administrador',
    depois: { senha_redefinida: true },
    comEmpresa: false,
  });
  return { redefinida: true };
}

/**
 * Tira o acesso do usuário a ESTE CLIENTE; a conta segue existindo.
 *
 * Não há mais "remover só de uma matriz" — o acesso é do cliente inteiro, e
 * removê-lo tira todas as matrizes e filiais dele de uma vez.
 */
export function removerAcesso(ctx: Contexto, usuarioId: number) {
  const clienteId = exigirClienteEmContexto(ctx);
  const antes = obter(ctx, usuarioId);
  if (usuarioId === ctx.usuarioId) throw erroValidacao('Você não pode remover o próprio acesso a este cliente.');
  const gestores = db()
    .prepare(`SELECT COUNT(*) AS n FROM usuario_clientes WHERE cliente_id = ? AND papel = 'gestor'`)
    .get(clienteId) as { n: number };
  if (antes.papel === 'gestor' && gestores.n <= 1) {
    // Cliente sem gestor não tem quem conceda acesso de volta.
    throw erroValidacao('Esta é a última conta com papel de gestor neste cliente. Promova outra antes de remover.');
  }
  db()
    .prepare('DELETE FROM usuario_clientes WHERE usuario_id = ? AND cliente_id = ?')
    .run(usuarioId, clienteId);
  auditar(ctx, {
    entidade: 'usuario',
    entidadeId: usuarioId,
    acao: 'excluir',
    antes: apresentar(antes),
    comEmpresa: false,
  });
  return { removido: true };
}
