import { Router } from 'express';
import {
  atualizarFilial,
  atualizarTipoDespesa,
  atualizarTopicoAjuda,
  criarFila,
  criarFilial,
  criarTipoDespesa,
  criarTopicoAjuda,
  listarFiliais,
  listarFilas,
  listarTiposDespesa,
  listarTopicosAjuda,
} from '../domain/cadastros.js';
import { atualizarEmpresa, concederAcesso, listarAcessos } from '../domain/empresas.js';
import { listarAuditoria } from '../domain/auditoria.js';
import { fecharCompetencia, listarFechamentos, reabrirCompetencia } from '../domain/fechamento.js';
import { paraInterno } from '../domain/competencia.js';
import { ctx, exigir } from '../middleware/index.js';
import { comEmpresaEmFoco, empresasDoPedido } from '../domain/escopo.js';

export const rotasCadastros = Router();

// ------------------------------------------------------------------ Empresa
rotasCadastros.patch('/empresa', exigir('configuracoes', 'edit'), (req, res) => {
  res.json(atualizarEmpresa(ctx(req).empresaId, req.body ?? {}));
});

rotasCadastros.get('/empresa/acessos', (req, res) => {
  res.json(listarAcessos(ctx(req).empresaId));
});

rotasCadastros.post('/empresa/acessos', exigir('configuracoes', 'create'), (req, res) => {
  const { email, papel } = req.body ?? {};
  res.status(201).json(concederAcesso(ctx(req).empresaId, email, papel === 'leitor' ? 'leitor' : 'gestor'));
});

// ------------------------------------------------------------------ Filiais
rotasCadastros.get('/filiais', (req, res) =>
  res.json(listarFiliais(ctx(req), empresasDoPedido(req.query as Record<string, unknown>))),
);

rotasCadastros.post('/filiais', exigir('configuracoes', 'create'), (req, res) => {
  res.status(201).json(criarFilial(ctx(req), req.body ?? {}));
});

rotasCadastros.patch('/filiais/:id', exigir('configuracoes', 'edit'), (req, res) => {
  res.json(atualizarFilial(ctx(req), Number(req.params.id), req.body ?? {}));
});

// ------------------------------------------------------- Tipos de despesa
// O catálogo é da UNIDADE — tipo de despesa, tópico e fila pertencem à matriz.
// A unidade vem do pedido (o formulário escolhe onde o registro vai nascer) e,
// sem indicação, é a que está em foco. A conferência é a mesma da escrita: id de
// outro cliente é 403.
function unidade(req: Parameters<typeof ctx>[0]) {
  const [empresa] = empresasDoPedido(req.query as Record<string, unknown>);
  return comEmpresaEmFoco(ctx(req), empresa);
}

rotasCadastros.get('/tipos-despesa', (req, res) => {
  res.json(listarTiposDespesa(unidade(req), req.query.incluir_inativos === 'true'));
});

rotasCadastros.post('/tipos-despesa', exigir('configuracoes', 'create'), (req, res) => {
  res.status(201).json(criarTipoDespesa(ctx(req), String(req.body?.nome ?? '')));
});

rotasCadastros.patch('/tipos-despesa/:id', exigir('configuracoes', 'edit'), (req, res) => {
  res.json(atualizarTipoDespesa(ctx(req), Number(req.params.id), req.body ?? {}));
});

// -------------------------------------------------------- Tópicos de ajuda
rotasCadastros.get('/topicos-ajuda', (req, res) => {
  res.json(listarTopicosAjuda(unidade(req), req.query.incluir_inativos === 'true'));
});

rotasCadastros.post('/topicos-ajuda', exigir('configuracoes', 'create'), (req, res) => {
  res.status(201).json(criarTopicoAjuda(ctx(req), String(req.body?.nome ?? '')));
});

rotasCadastros.patch('/topicos-ajuda/:id', exigir('configuracoes', 'edit'), (req, res) => {
  res.json(atualizarTopicoAjuda(ctx(req), Number(req.params.id), req.body ?? {}));
});

// -------------------------------------------------------------- Filas SLA
rotasCadastros.get('/filas', (req, res) => res.json(listarFilas(unidade(req))));

rotasCadastros.post('/filas', exigir('configuracoes', 'create'), (req, res) => {
  res.status(201).json(criarFila(ctx(req), String(req.body?.nome ?? '')));
});

// ------------------------------------------------------------ Fechamentos
rotasCadastros.get('/fechamentos', (req, res) => res.json(listarFechamentos(ctx(req))));

rotasCadastros.post('/fechamentos', exigir('configuracoes', 'create'), (req, res) => {
  const { competencia, observacao } = req.body ?? {};
  res.status(201).json(fecharCompetencia(ctx(req), paraInterno(competencia), observacao));
});

rotasCadastros.post('/fechamentos/reabrir', exigir('configuracoes', 'create'), (req, res) => {
  const { competencia, justificativa } = req.body ?? {};
  res.json(reabrirCompetencia(ctx(req), paraInterno(competencia), String(justificativa ?? '')));
});

// -------------------------------------------------------------- Auditoria
rotasCadastros.get('/auditoria', (req, res) => {
  res.json(
    listarAuditoria(ctx(req), {
      entidade: req.query.entidade ? String(req.query.entidade) : undefined,
      entidadeId: req.query.entidade_id ? Number(req.query.entidade_id) : undefined,
      limite: req.query.limite ? Number(req.query.limite) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    }),
  );
});
