import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { erroConflito, erroNaoAutenticado, erroSemPermissao, erroValidacao } from '../lib/erros.js';

const EXPIRACAO = '12h';

export function segredoJwt(): string {
  const segredo = process.env.JWT_SECRET;
  if (!segredo) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET é obrigatório em produção.');
    }
    return 'segredo-de-desenvolvimento-nao-usar-em-producao';
  }
  return segredo;
}

/**
 * O cadastro aberto é liberado apenas enquanto não existe nenhuma conta — é o
 * que permite criar o primeiro gestor pela tela, sem script. Depois disso, só
 * fica aberto se a instalação declarar `REGISTRO_ABERTO=true`; caso contrário,
 * novos usuários entram por convite de um gestor (concessão de acesso).
 */
export function registroAberto(): { aberto: boolean; primeiroAcesso: boolean } {
  const total = (db().prepare('SELECT COUNT(*) AS n FROM usuarios').get() as { n: number }).n;
  const primeiroAcesso = total === 0;
  return { aberto: primeiroAcesso || process.env.REGISTRO_ABERTO === 'true', primeiroAcesso };
}

export interface Sessao {
  usuarioId: number;
  email: string;
  nome: string;
}

export function registrar(dados: { nome: string; email: string; senha: string }) {
  if (!registroAberto().aberto) {
    throw erroSemPermissao(
      'O cadastro aberto está desativado nesta instalação. Peça a um gestor para conceder acesso ao seu e-mail.',
    );
  }
  const email = dados.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw erroValidacao('E-mail inválido.');
  if (!dados.nome?.trim()) throw erroValidacao('O nome é obrigatório.');
  if (!dados.senha || dados.senha.length < 8) throw erroValidacao('A senha deve ter ao menos 8 caracteres.');

  const existente = db().prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
  if (existente) throw erroConflito('Já existe uma conta com este e-mail.');

  const info = db()
    .prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
    .run(dados.nome.trim(), email, bcrypt.hashSync(dados.senha, 10));
  return { id: Number(info.lastInsertRowid), nome: dados.nome.trim(), email };
}

export function autenticar(email: string, senha: string): { token: string; usuario: Sessao } {
  const usuario = db()
    .prepare('SELECT id, nome, email, senha_hash, ativo FROM usuarios WHERE email = ?')
    .get(email?.trim().toLowerCase() ?? '') as
    | { id: number; nome: string; email: string; senha_hash: string; ativo: number }
    | undefined;
  if (!usuario || !usuario.ativo || !bcrypt.compareSync(senha ?? '', usuario.senha_hash)) {
    throw erroNaoAutenticado('E-mail ou senha inválidos.');
  }
  const sessao: Sessao = { usuarioId: usuario.id, email: usuario.email, nome: usuario.nome };
  const token = jwt.sign(sessao, segredoJwt(), { expiresIn: EXPIRACAO });
  return { token, usuario: sessao };
}

export function verificarToken(token: string): Sessao {
  try {
    const conteudo = jwt.verify(token, segredoJwt()) as Sessao;
    if (!conteudo?.usuarioId) throw new Error('token sem identificação');
    return { usuarioId: conteudo.usuarioId, email: conteudo.email, nome: conteudo.nome };
  } catch {
    throw erroNaoAutenticado('Sessão inválida ou expirada.');
  }
}
