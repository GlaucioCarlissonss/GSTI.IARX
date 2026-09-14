/**
 * Clientes.
 *
 * `GET /meus` fica FORA do router protegido por empresa: é a lista da tela de
 * boas-vindas, e ela é anterior a haver empresa em contexto. As demais exigem o
 * módulo de configurações, porque cadastrar cliente é administração.
 */
import { Router } from 'express';
import {
  atualizarCliente,
  clientesDoUsuario,
  criarCliente,
  criarMatriz,
  criarUnidade,
  criarUnidadeDoCliente,
  estruturaDoCliente,
  exigirCliente,
  listarClientes,
  obterCliente,
  vincularUsuario,
  desvincularUsuario,
} from '../domain/clientes.js';
import { ctx, exigir } from '../middleware/index.js';
import type { Request } from 'express';

/** Rotas que dependem só da SESSÃO — não há empresa em contexto ainda. */
export const rotasClienteDaSessao = Router();

rotasClienteDaSessao.get('/meus', (req: Request, res) => {
  if (!req.sessao) return res.status(401).json({ erro: 'Sessão inválida.' });
  const clientes = clientesDoUsuario(req.sessao.usuarioId);
  res.json({
    clientes,
    // A tela precisa distinguir "nenhum cliente vinculado" de "erro ao buscar":
    // as duas telas vazias são iguais, e as saídas são opostas.
    vinculado: clientes.length > 0,
  });
});

rotasClienteDaSessao.get('/meus/:id/estrutura', (req: Request, res) => {
  if (!req.sessao) return res.status(401).json({ erro: 'Sessão inválida.' });
  const clienteId = exigirCliente(req.sessao.usuarioId, Number(req.params.id));
  res.json({ cliente: obterCliente(clienteId), matrizes: estruturaDoCliente(clienteId) });
});

/** Administração de clientes: vive dentro do router protegido por empresa. */
export const rotasClientes = Router();

rotasClientes.get('/', exigir('configuracoes', 'view'), (req, res) => {
  const q = req.query as Record<string, unknown>;
  res.json(
    listarClientes({
      ativo: q.ativo === undefined || q.ativo === '' ? undefined : String(q.ativo) === 'true',
    }),
  );
});

rotasClientes.post('/', exigir('configuracoes', 'create'), (req, res) => {
  const corpo = req.body ?? {};
  const cliente = criarCliente({
    nome: corpo.nome,
    documento: corpo.documento ?? null,
    ativo: corpo.ativo,
  });
  // Quem cria o cliente passa a enxergá-lo: sem isso, criar seria a forma mais
  // rápida de produzir um cliente que ninguém abre.
  vincularUsuario(ctx(req).usuarioId, cliente.id);
  res.status(201).json(cliente);
});

rotasClientes.get('/:id', exigir('configuracoes', 'view'), (req, res) => {
  const id = Number(req.params.id);
  res.json({ cliente: obterCliente(id), matrizes: estruturaDoCliente(id) });
});

rotasClientes.patch('/:id', exigir('configuracoes', 'edit'), (req, res) => {
  res.json(atualizarCliente(Number(req.params.id), req.body ?? {}));
});

rotasClientes.post('/:id/matrizes', exigir('configuracoes', 'create'), (req, res) => {
  res.status(201).json(criarMatriz(Number(req.params.id), req.body ?? {}, ctx(req).usuarioId));
});

/**
 * Cadastro de unidade com a regra do CNPJ aplicada no servidor: a tela informa
 * o que a pessoa escolheu, e é aqui que "mesma raiz, mesma matriz" vale.
 */
rotasClientes.post('/:id/unidades', exigir('configuracoes', 'create'), (req, res) => {
  const corpo = req.body ?? {};
  res.status(201).json(
    criarUnidadeDoCliente(
      Number(req.params.id),
      {
        ...corpo,
        matrizPaiId: corpo.matriz_pai_id === undefined ? corpo.matrizPaiId : Number(corpo.matriz_pai_id) || null,
      },
      ctx(req).usuarioId,
    ),
  );
});

rotasClientes.post('/matrizes/:matrizId/filiais', exigir('configuracoes', 'create'), (req, res) => {
  res.status(201).json(criarUnidade(Number(req.params.matrizId), req.body ?? {}));
});

rotasClientes.post('/:id/usuarios', exigir('usuarios', 'edit'), (req, res) => {
  const corpo = req.body ?? {};
  res.json(vincularUsuario(Number(corpo.usuario_id), Number(req.params.id)));
});

rotasClientes.delete('/:id/usuarios/:usuarioId', exigir('usuarios', 'edit'), (req, res) => {
  res.json(desvincularUsuario(Number(req.params.usuarioId), Number(req.params.id)));
});
