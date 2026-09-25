/**
 * Recuperação de senha.
 *
 * O token é aleatório, guardado como HASH, de uso único e com prazo. Guardar
 * em texto faria de um vazamento do banco um vazamento de contas.
 *
 * A resposta ao pedido é sempre a mesma, exista ou não a conta: dizer "não há
 * usuário com esse e-mail" entrega uma lista de e-mails cadastrados a quem
 * tenta adivinhar.
 */
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db/index.js';
import { erroValidacao } from '../lib/erros.js';
import { enviarEmail, smtpConfigurado } from '../lib/email.js';
import { validarSenha } from './auth.js';

const VALIDADE_MIN = Math.min(Math.max(Number(process.env.SENHA_TOKEN_MINUTOS ?? 45), 10), 120);

const hashDoToken = (valor: string) => createHash('sha256').update(valor, 'utf8').digest('hex');

/** Mensagem única do pedido — a mesma com ou sem conta. */
export const AVISO_GENERICO =
  'Se o e-mail estiver cadastrado, enviaremos as instruções de redefinição em instantes.';

export async function pedirRedefinicao(email: string, baseDoLink: string) {
  const alvo = String(email ?? '').trim().toLowerCase();
  const usuario = db()
    .prepare('SELECT id, nome, email, ativo FROM usuarios WHERE email = ?')
    .get(alvo) as { id: number; nome: string; email: string; ativo: number } | undefined;

  // Conta inexistente ou desativada segue o mesmo caminho até aqui e para em
  // silêncio: por fora, os dois casos são indistinguíveis do sucesso.
  if (!usuario || !usuario.ativo) return { aviso: AVISO_GENERICO, enviado: false };

  // Um pedido novo invalida os anteriores: dois links válidos ao mesmo tempo
  // dobram a janela de quem interceptar um deles.
  db()
    .prepare(`UPDATE tokens_redefinicao SET usado_em = datetime('now') WHERE usuario_id = ? AND usado_em IS NULL`)
    .run(usuario.id);

  const token = randomBytes(32).toString('base64url');
  const expira = new Date(Date.now() + VALIDADE_MIN * 60_000).toISOString();
  db()
    .prepare('INSERT INTO tokens_redefinicao (usuario_id, token_hash, expira_em) VALUES (?, ?, ?)')
    .run(usuario.id, hashDoToken(token), expira);

  const link = `${baseDoLink.replace(/\/+$/, '')}/redefinir-senha?token=${encodeURIComponent(token)}`;
  const envio = await enviarEmail({
    para: usuario.email,
    assunto: 'Redefinição de senha — Gestão de TI IARX',
    corpo:
      `Olá, ${usuario.nome}.\n\n` +
      `Alguém pediu a redefinição da senha desta conta. Para escolher uma nova senha, abra:\n\n${link}\n\n` +
      `O link vale por ${VALIDADE_MIN} minutos e só pode ser usado uma vez.\n` +
      `Se não foi você quem pediu, ignore esta mensagem: nada muda enquanto o link não for aberto.\n`,
  });

  return { aviso: AVISO_GENERICO, enviado: envio.enviado, motivo: envio.motivo };
}

/**
 * Consome o token e troca a senha. Todas as sessões abertas caem junto: se o
 * pedido veio de quem tomou a conta, deixá-lo dentro tornaria a troca inútil.
 */
export function redefinirSenha(token: string, novaSenha: string) {
  const linha = db()
    .prepare('SELECT * FROM tokens_redefinicao WHERE token_hash = ?')
    .get(hashDoToken(String(token ?? ''))) as
    | { id: number; usuario_id: number; expira_em: string; usado_em: string | null }
    | undefined;

  // Uma única mensagem para inexistente, usado e vencido: distinguir os três
  // contaria a quem tenta adivinhar quão perto chegou.
  const recusa = () =>
    erroValidacao('Este link de redefinição não vale mais. Peça um novo na tela de acesso.');
  if (!linha || linha.usado_em || Date.parse(linha.expira_em) < Date.now()) throw recusa();

  validarSenha(novaSenha);

  db()
    .prepare(`UPDATE usuarios SET senha_hash = ?, senha_em = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .run(bcrypt.hashSync(novaSenha, 10), linha.usuario_id);
  db().prepare(`UPDATE tokens_redefinicao SET usado_em = datetime('now') WHERE id = ?`).run(linha.id);

  return { redefinida: true };
}

/** Diz ao administrador se o envio de e-mail está de pé nesta instalação. */
export const situacaoDoEmail = () => ({
  configurado: smtpConfigurado(),
  aviso: smtpConfigurado()
    ? null
    : 'SMTP não configurado: os e-mails de redefinição ficam registrados no sistema, mas não são enviados. ' +
      'Defina SMTP_URL e SMTP_DE para ligar o envio.',
});
