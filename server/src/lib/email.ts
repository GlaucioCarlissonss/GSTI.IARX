/**
 * Envio de e-mail.
 *
 * Sem SMTP configurado a mensagem NÃO é enviada — e o sistema diz isso, em vez
 * de fingir. A mensagem fica gravada, com o motivo, para o administrador ver o
 * que teria sido mandado e para o link de redefinição não se perder enquanto o
 * SMTP não é ligado.
 */
import nodemailer from 'nodemailer';
import { db } from '../db/index.js';

export interface Mensagem {
  para: string;
  assunto: string;
  corpo: string;
}

/** Configurado quando há servidor e remetente: um sem o outro não envia. */
export const smtpConfigurado = () => !!(process.env.SMTP_URL?.trim() && process.env.SMTP_DE?.trim());

export async function enviarEmail(msg: Mensagem): Promise<{ enviado: boolean; motivo?: string }> {
  let enviado = false;
  let motivo: string | undefined;

  if (!smtpConfigurado()) {
    motivo = 'SMTP não configurado (defina SMTP_URL e SMTP_DE).';
  } else {
    try {
      const transporte = nodemailer.createTransport(process.env.SMTP_URL!);
      await transporte.sendMail({
        from: process.env.SMTP_DE!,
        to: msg.para,
        subject: msg.assunto,
        text: msg.corpo,
      });
      enviado = true;
    } catch (erro) {
      motivo = erro instanceof Error ? erro.message : String(erro);
    }
  }

  db()
    .prepare(
      'INSERT INTO emails_enviados (destinatario, assunto, corpo, enviado, erro) VALUES (?, ?, ?, ?, ?)',
    )
    .run(msg.para, msg.assunto, msg.corpo, enviado ? 1 : 0, motivo ?? null);

  // Uma linha por tentativa, para um coletor de logs acompanhar sem abrir o
  // banco. O CORPO não entra: ele carrega o link de redefinição.
  console.log(
    JSON.stringify({ evento: 'email', para: msg.para, assunto: msg.assunto, enviado, motivo, em: new Date().toISOString() }),
  );
  return { enviado, motivo };
}
