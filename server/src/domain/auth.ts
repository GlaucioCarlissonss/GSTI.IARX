import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { erroConflito, erroNaoAutenticado, erroSemPermissao, erroValidacao } from '../lib/erros.js';

const EXPIRACAO = '12h';

/**
 * Lê o carimbo da última troca de senha. É gravado com MILISSEGUNDOS de
 * propósito: `datetime('now')` tem resolução de um segundo, e trocar a senha
 * no mesmo segundo do login deixava a sessão antiga de pé — justamente o caso
 * de quem acabou de tomar a conta.
 */
const carimbo = (valor: string | null): number =>
  valor ? Date.parse(valor.endsWith('Z') ? valor : `${valor}Z`) : 0;

/**
 * Segredo de assinatura das sessões.
 *
 * Não há valor padrão: um segredo embutido no código é público e permitiria a
 * qualquer um forjar um token de gestor. Sem `JWT_SECRET` a aplicação recusa
 * subir, em vez de operar com uma sessão falsificável.
 */
export function segredoJwt(): string {
  const segredo = process.env.JWT_SECRET?.trim();
  if (!segredo) {
    throw new Error(
      'JWT_SECRET não está definido. Rode "npm run configurar" para gerar um, ' +
        'ou defina a variável de ambiente antes de subir a aplicação.',
    );
  }
  if (segredo.length < 32) {
    throw new Error('JWT_SECRET curto demais: use ao menos 32 caracteres.');
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
  username: string;
  /**
   * Momento em que a senha foi trocada pela última vez. Um token emitido antes
   * disso deixa de valer — é o que faz "redefinir a senha" derrubar as sessões
   * abertas, inclusive a de quem tomou a conta.
   */
  senhaEm?: number;
}

/** Política de senha. Mínimo configurável, com um piso que não se negocia. */
export function validarSenha(senha: string): void {
  const minimo = Math.max(Number(process.env.SENHA_MINIMA ?? 8), 8);
  if (!senha || senha.length < minimo) {
    throw erroValidacao(`A senha deve ter ao menos ${minimo} caracteres.`);
  }
  if (!/[a-zA-Z]/.test(senha) || !/\d/.test(senha)) {
    throw erroValidacao('A senha deve ter letras e números.');
  }
}

/**
 * Identificador derivado do e-mail, para o primeiro acesso não pedir mais um
 * campo. O prefixo curto demais é completado com o domínio — `a@b.com` daria
 * um nome de um caractere, que a regra recusa.
 */
export function derivarUsername(email: string): string {
  const limpar = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]/g, '');
  const [prefixo = '', dominio = ''] = String(email ?? '').split('@');
  let nome = limpar(prefixo);
  if (nome.length < 3) nome = `${nome}${limpar(dominio.split('.')[0] ?? '')}`;
  while (nome.length < 3) nome += '0';
  return nome.slice(0, 40);
}

/** Identificador de login: minúsculo, sem espaço e sem acento. */
export function normalizarUsername(bruto: string): string {
  const nome = String(bruto ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!/^[a-z0-9._-]{3,40}$/.test(nome)) {
    throw erroValidacao(
      'O usuário deve ter de 3 a 40 caracteres, apenas letras, números, ponto, hífen ou sublinhado.',
    );
  }
  return nome;
}

export function registrar(dados: { nome: string; email: string; senha: string; username?: string }) {
  if (!registroAberto().aberto) {
    throw erroSemPermissao(
      'O cadastro aberto está desativado nesta instalação. Peça a um gestor para conceder acesso ao seu e-mail.',
    );
  }
  const email = dados.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw erroValidacao('E-mail inválido.');
  if (!dados.nome?.trim()) throw erroValidacao('O nome é obrigatório.');
  validarSenha(dados.senha);

  // Sem username informado, ele sai do e-mail: é o primeiro acesso, e pedir
  // mais um campo ali só atrasa quem está começando.
  const username = normalizarUsername(dados.username || derivarUsername(email));

  const existente = db().prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
  if (existente) throw erroConflito('Já existe uma conta com este e-mail.');
  const mesmoUsuario = db().prepare('SELECT id FROM usuarios WHERE username = ?').get(username);
  if (mesmoUsuario) throw erroConflito(`O usuário "${username}" já está em uso.`);

  const info = db()
    .prepare('INSERT INTO usuarios (nome, email, username, senha_hash) VALUES (?, ?, ?, ?)')
    .run(dados.nome.trim(), email, username, bcrypt.hashSync(dados.senha, 10));
  return { id: Number(info.lastInsertRowid), nome: dados.nome.trim(), email, username };
}

// ------------------------------------------------------------ rate limiting
//
// Cinco tentativas erradas e a conta fica quinze minutos fora. A contagem é em
// memória e por processo — protege contra força bruta trivial, e está dito
// aqui para não parecer o que não é.
const TENTATIVAS_MAX = Number(process.env.LOGIN_TENTATIVAS ?? 5);
const BLOQUEIO_MS = Number(process.env.LOGIN_BLOQUEIO_MS ?? 15 * 60_000);
const tentativas = new Map<string, { erros: number; ate: number }>();

function conferirBloqueio(chave: string): void {
  const reg = tentativas.get(chave);
  if (!reg) return;
  if (reg.ate > Date.now()) {
    const minutos = Math.ceil((reg.ate - Date.now()) / 60_000);
    throw erroNaoAutenticado(`Muitas tentativas. Tente novamente em ${minutos} minuto(s).`);
  }
  if (reg.ate) tentativas.delete(chave);
}

function registrarErro(chave: string): void {
  const reg = tentativas.get(chave) ?? { erros: 0, ate: 0 };
  reg.erros += 1;
  if (reg.erros >= TENTATIVAS_MAX) reg.ate = Date.now() + BLOQUEIO_MS;
  tentativas.set(chave, reg);
}

/**
 * Login por USERNAME. O e-mail não autentica: quem sabe o e-mail de alguém não
 * deve, por isso, saber o identificador de login dessa pessoa.
 *
 * A recusa é sempre a mesma frase, exista a conta ou não — a mensagem que
 * distingue "usuário não existe" de "senha errada" é uma lista de usuários
 * válidos entregue a quem tenta adivinhar.
 */
export function autenticar(username: string, senha: string): { token: string; usuario: Sessao } {
  const nome = String(username ?? '').trim().toLowerCase();
  conferirBloqueio(nome);

  const usuario = db()
    .prepare('SELECT id, nome, email, username, senha_hash, ativo, senha_em FROM usuarios WHERE username = ?')
    .get(nome) as
    | { id: number; nome: string; email: string; username: string; senha_hash: string; ativo: number; senha_em: string | null }
    | undefined;

  if (!usuario || !usuario.ativo || !bcrypt.compareSync(senha ?? '', usuario.senha_hash)) {
    registrarErro(nome);
    throw erroNaoAutenticado('Usuário ou senha inválidos.');
  }
  tentativas.delete(nome);

  db().prepare(`UPDATE usuarios SET ultimo_login_em = datetime('now') WHERE id = ?`).run(usuario.id);

  const sessao: Sessao = {
    usuarioId: usuario.id,
    email: usuario.email,
    nome: usuario.nome,
    username: usuario.username,
    senhaEm: carimbo(usuario.senha_em),
  };
  const token = jwt.sign(sessao, segredoJwt(), { expiresIn: EXPIRACAO });
  return { token, usuario: sessao };
}

export function verificarToken(token: string): Sessao {
  try {
    const conteudo = jwt.verify(token, segredoJwt()) as Sessao;
    if (!conteudo?.usuarioId) throw new Error('token sem identificação');
    // A assinatura sozinha não basta: a conta pode ter sido desativada ou
    // removida depois que o token foi emitido.
    const usuario = db()
      .prepare('SELECT id, nome, email, username, ativo, senha_em FROM usuarios WHERE id = ?')
      .get(conteudo.usuarioId) as
      | { id: number; nome: string; email: string; username: string | null; ativo: number; senha_em: string | null }
      | undefined;
    if (!usuario || !usuario.ativo) throw new Error('conta inativa ou inexistente');
    // Senha trocada depois da emissão derruba o token: é o que faz "redefinir
    // a senha" expulsar quem já estava dentro, inclusive quem tomou a conta.
    const trocadaEm = carimbo(usuario.senha_em);
    if (trocadaEm && (conteudo.senhaEm ?? 0) < trocadaEm) throw new Error('sessão anterior à troca de senha');
    return {
      usuarioId: usuario.id,
      email: usuario.email,
      nome: usuario.nome,
      username: usuario.username ?? '',
      senhaEm: conteudo.senhaEm,
    };
  } catch {
    throw erroNaoAutenticado('Sessão inválida ou expirada.');
  }
}
