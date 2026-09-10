import { Router } from 'express';
import { autenticar, registrar } from '../domain/auth.js';
import { criarEmpresa, listarEmpresasDoUsuario } from '../domain/empresas.js';
import { autenticado } from '../middleware/index.js';

export const rotasAuth = Router();

rotasAuth.post('/registrar', (req, res) => {
  const usuario = registrar(req.body ?? {});
  const { token } = autenticar(usuario.email, req.body.senha);
  res.status(201).json({ usuario, token });
});

rotasAuth.post('/login', (req, res) => {
  const { email, senha } = req.body ?? {};
  const resultado = autenticar(email, senha);
  res.json({ ...resultado, empresas: listarEmpresasDoUsuario(resultado.usuario.usuarioId) });
});

rotasAuth.get('/eu', autenticado, (req, res) => {
  const sessao = req.sessao!;
  res.json({ usuario: sessao, empresas: listarEmpresasDoUsuario(sessao.usuarioId) });
});

rotasAuth.post('/empresas', autenticado, (req, res) => {
  const empresa = criarEmpresa(req.sessao!.usuarioId, req.body ?? {});
  res.status(201).json(empresa);
});
