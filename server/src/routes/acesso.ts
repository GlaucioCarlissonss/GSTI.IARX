/**
 * Usuários, perfis e permissões.
 *
 * Toda rota aqui exige o módulo `usuarios`. O gestor da empresa passa por
 * definição: fosse preciso um perfil para administrar acessos, uma
 * configuração errada trancaria todo mundo para fora.
 */
import { Router } from 'express';
import {
  atualizarPerfil,
  criarPerfil,
  duplicarPerfil,
  excluirPerfil,
  exigirPermissao,
  listarPerfis,
  MODULOS,
  ACOES,
  permissoesDoUsuario,
} from '../domain/acesso.js';
import {
  atualizarUsuario,
  criarUsuario,
  listarUsuarios,
  redefinirSenhaDeUsuario,
  removerAcesso,
} from '../domain/usuarios.js';
import { situacaoDoEmail } from '../domain/senha.js';
import { ctx } from '../middleware/index.js';

export const rotasAcesso = Router();

/** O que o usuário da sessão pode neste cliente — o front usa para se ajustar. */
rotasAcesso.get('/minhas-permissoes', (req, res) => {
  const c = ctx(req);
  res.json({
    ...(c.clienteId === null
      ? { papel: null, perfil: null, permissoes: {}, campos_bloqueados: {} }
      : permissoesDoUsuario(c.usuarioId, c.clienteId)),
    papel: c.papel,
    modulos: MODULOS,
    acoes: ACOES,
  });
});

const soAdmin = (req: Parameters<typeof ctx>[0], acao: Parameters<typeof exigirPermissao>[2] = 'view') => {
  exigirPermissao(ctx(req), 'usuarios', acao);
  return ctx(req);
};

// ----------------------------------------------------------------- usuários

rotasAcesso.get('/usuarios', (req, res) => res.json(listarUsuarios(soAdmin(req))));

rotasAcesso.post('/usuarios', (req, res) => {
  res.status(201).json(criarUsuario(soAdmin(req, 'create'), req.body ?? {}));
});

rotasAcesso.patch('/usuarios/:id', (req, res) => {
  res.json(atualizarUsuario(soAdmin(req, 'edit'), Number(req.params.id), req.body ?? {}));
});

rotasAcesso.post('/usuarios/:id/senha', (req, res) => {
  res.json(redefinirSenhaDeUsuario(soAdmin(req, 'edit'), Number(req.params.id), String((req.body ?? {}).senha ?? '')));
});

rotasAcesso.delete('/usuarios/:id', (req, res) => {
  res.json(removerAcesso(soAdmin(req, 'delete'), Number(req.params.id)));
});

// ------------------------------------------------------------------- perfis

rotasAcesso.get('/perfis', (req, res) => res.json(listarPerfis(soAdmin(req))));

rotasAcesso.post('/perfis', (req, res) => {
  res.status(201).json(criarPerfil(soAdmin(req, 'create'), req.body ?? {}));
});

rotasAcesso.post('/perfis/:id/duplicar', (req, res) => {
  res.status(201).json(duplicarPerfil(soAdmin(req, 'create'), Number(req.params.id), String((req.body ?? {}).nome ?? '')));
});

rotasAcesso.patch('/perfis/:id', (req, res) => {
  res.json(atualizarPerfil(soAdmin(req, 'edit'), Number(req.params.id), req.body ?? {}));
});

rotasAcesso.delete('/perfis/:id', (req, res) => {
  res.json(excluirPerfil(soAdmin(req, 'delete'), Number(req.params.id)));
});

/** Situação do envio de e-mail: o administrador precisa saber se está de pé. */
rotasAcesso.get('/email/situacao', (req, res) => {
  soAdmin(req);
  res.json(situacaoDoEmail());
});
