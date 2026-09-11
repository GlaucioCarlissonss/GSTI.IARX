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
import { ctx, somenteGestor } from '../middleware/index.js';

export const rotasCadastros = Router();

// ------------------------------------------------------------------ Empresa
rotasCadastros.patch('/empresa', somenteGestor, (req, res) => {
  res.json(atualizarEmpresa(ctx(req).empresaId, req.body ?? {}));
});

rotasCadastros.get('/empresa/acessos', (req, res) => {
  res.json(listarAcessos(ctx(req).empresaId));
});

rotasCadastros.post('/empresa/acessos', somenteGestor, (req, res) => {
  const { email, papel } = req.body ?? {};
  res.status(201).json(concederAcesso(ctx(req).empresaId, email, papel === 'leitor' ? 'leitor' : 'gestor'));
});

// ------------------------------------------------------------------ Filiais
rotasCadastros.get('/filiais', (req, res) => res.json(listarFiliais(ctx(req))));

rotasCadastros.post('/filiais', somenteGestor, (req, res) => {
  res.status(201).json(criarFilial(ctx(req), req.body ?? {}));
});

rotasCadastros.patch('/filiais/:id', somenteGestor, (req, res) => {
  res.json(atualizarFilial(ctx(req), Number(req.params.id), req.body ?? {}));
});

// ------------------------------------------------------- Tipos de despesa
rotasCadastros.get('/tipos-despesa', (req, res) => {
  res.json(listarTiposDespesa(ctx(req), req.query.incluir_inativos === 'true'));
});

rotasCadastros.post('/tipos-despesa', somenteGestor, (req, res) => {
  res.status(201).json(criarTipoDespesa(ctx(req), String(req.body?.nome ?? '')));
});

rotasCadastros.patch('/tipos-despesa/:id', somenteGestor, (req, res) => {
  res.json(atualizarTipoDespesa(ctx(req), Number(req.params.id), req.body ?? {}));
});

// -------------------------------------------------------- Tópicos de ajuda
rotasCadastros.get('/topicos-ajuda', (req, res) => {
  res.json(listarTopicosAjuda(ctx(req), req.query.incluir_inativos === 'true'));
});

rotasCadastros.post('/topicos-ajuda', somenteGestor, (req, res) => {
  res.status(201).json(criarTopicoAjuda(ctx(req), String(req.body?.nome ?? '')));
});

rotasCadastros.patch('/topicos-ajuda/:id', somenteGestor, (req, res) => {
  res.json(atualizarTopicoAjuda(ctx(req), Number(req.params.id), req.body ?? {}));
});

// -------------------------------------------------------------- Filas SLA
rotasCadastros.get('/filas', (req, res) => res.json(listarFilas(ctx(req))));

rotasCadastros.post('/filas', somenteGestor, (req, res) => {
  res.status(201).json(criarFila(ctx(req), String(req.body?.nome ?? '')));
});

// ------------------------------------------------------------ Fechamentos
rotasCadastros.get('/fechamentos', (req, res) => res.json(listarFechamentos(ctx(req))));

rotasCadastros.post('/fechamentos', somenteGestor, (req, res) => {
  const { competencia, observacao } = req.body ?? {};
  res.status(201).json(fecharCompetencia(ctx(req), paraInterno(competencia), observacao));
});

rotasCadastros.post('/fechamentos/reabrir', somenteGestor, (req, res) => {
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
