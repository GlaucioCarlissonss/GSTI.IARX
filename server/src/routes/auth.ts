import { Router } from 'express';
import { autenticar, registrar, registroAberto } from '../domain/auth.js';
import { criarEmpresa, listarEmpresasDoUsuario } from '../domain/empresas.js';
import { pedirRedefinicao, redefinirSenha, situacaoDoEmail } from '../domain/senha.js';
import { assincrono, autenticado } from '../middleware/index.js';
import { baseDeLink } from '../lib/endereco.js';

export const rotasAuth = Router();

/** Estado da instalação — a tela de entrada usa para oferecer (ou não) o cadastro. */
rotasAuth.get('/estado', (_req, res) => {
  const { aberto, primeiroAcesso } = registroAberto();
  res.json({ registro_aberto: aberto, primeiro_acesso: primeiroAcesso });
});

rotasAuth.post('/registrar', (req, res) => {
  const usuario = registrar(req.body ?? {});
  const { token } = autenticar(usuario.username, req.body.senha);
  res.status(201).json({ usuario, token, empresas: [] });
});

/**
 * Login por `usuario`. `email` ainda é aceito no corpo por compatibilidade com
 * quem já tinha a tela antiga aberta — mas o que vale como identificador é o
 * username, e é o que a tela nova envia.
 */
rotasAuth.post('/login', (req, res) => {
  const { usuario, username, email, senha } = req.body ?? {};
  const resultado = autenticar(usuario ?? username ?? email, senha);
  res.json({ ...resultado, empresas: listarEmpresasDoUsuario(resultado.usuario.usuarioId) });
});

// -------------------------------------------------------- recuperação de senha

/**
 * A resposta é sempre a mesma, exista a conta ou não: dizer "não há usuário
 * com esse e-mail" entrega uma lista de e-mails cadastrados a quem adivinha.
 */
rotasAuth.post(
  '/senha/pedir',
  assincrono(async (req, res) => {
    // O endereço do link NÃO sai do cabeçalho `Host` quando há APP_URL: com
    // ele, um pedido forjado mandaria à pessoa certa um link para o site de
    // quem pediu, carregando um token válido.
    const base = baseDeLink(req);
    const r = await pedirRedefinicao(String((req.body ?? {}).email ?? ''), base);
    res.json({ aviso: r.aviso });
  }),
);

rotasAuth.post('/senha/redefinir', (req, res) => {
  const { token, senha } = req.body ?? {};
  res.json(redefinirSenha(String(token ?? ''), String(senha ?? '')));
});

/** Diz à tela de acesso se o envio de e-mail está de pé nesta instalação. */
rotasAuth.get('/senha/situacao', (_req, res) => res.json(situacaoDoEmail()));

rotasAuth.get('/eu', autenticado, (req, res) => {
  const sessao = req.sessao!;
  res.json({ usuario: sessao, empresas: listarEmpresasDoUsuario(sessao.usuarioId) });
});

rotasAuth.post('/empresas', autenticado, (req, res) => {
  const empresa = criarEmpresa(req.sessao!.usuarioId, req.body ?? {});
  res.status(201).json(empresa);
});
