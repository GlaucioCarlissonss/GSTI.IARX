import { Router } from 'express';
import {
  adicionarEnvolvido,
  atualizarProjeto,
  atualizarTarefa,
  criarProjeto,
  criarTarefa,
  excluirProjeto,
  excluirTarefa,
  listarEnvolvidos,
  listarProjetos,
  listarTarefas,
  obterProjeto,
  removerEnvolvido,
} from '../domain/projetos.js';
import { ctx, somenteGestor } from '../middleware/index.js';

export const rotasProjetos = Router();

function filialDaQuery(valor: unknown): number | null | undefined {
  if (valor === undefined || valor === '') return undefined;
  if (valor === 'nenhuma' || valor === 'null') return null;
  return Number(valor);
}

function corpoProjeto(corpo: Record<string, unknown>) {
  return {
    filialId: corpo.filial_id as number | null | undefined,
    nome: String(corpo.nome ?? ''),
    descricao: (corpo.descricao as string | null) ?? null,
    mesInicio: String(corpo.mes_inicio ?? ''),
    mesFimPlanejado: String(corpo.mes_fim_planejado ?? ''),
    mesFimReal: (corpo.mes_fim_real as string | null) ?? null,
    status: corpo.status as never,
  };
}

rotasProjetos.get('/', (req, res) => {
  res.json(
    listarProjetos(ctx(req), {
      filialId: filialDaQuery(req.query.filial_id),
      status: req.query.status ? (String(req.query.status) as never) : undefined,
      apenasAtrasados: req.query.atrasados === 'true',
      busca: req.query.busca ? String(req.query.busca) : undefined,
    }),
  );
});

rotasProjetos.get('/:id', (req, res) => res.json(obterProjeto(ctx(req), Number(req.params.id))));

rotasProjetos.post('/', somenteGestor, (req, res) => {
  res.status(201).json(criarProjeto(ctx(req), corpoProjeto(req.body ?? {})));
});

rotasProjetos.patch('/:id', somenteGestor, (req, res) => {
  const corpo = req.body ?? {};
  res.json(
    atualizarProjeto(ctx(req), Number(req.params.id), {
      filialId: corpo.filial_id,
      nome: corpo.nome,
      descricao: corpo.descricao,
      mesInicio: corpo.mes_inicio,
      mesFimPlanejado: corpo.mes_fim_planejado,
      mesFimReal: corpo.mes_fim_real,
      status: corpo.status,
      justificativa: corpo.justificativa,
    }),
  );
});

rotasProjetos.delete('/:id', somenteGestor, (req, res) => {
  res.json(excluirProjeto(ctx(req), Number(req.params.id), req.body?.justificativa));
});

// ------------------------------------------------------------------ Tarefas
rotasProjetos.get('/:id/tarefas', (req, res) => {
  res.json(listarTarefas(ctx(req), Number(req.params.id)));
});

rotasProjetos.post('/:id/tarefas', somenteGestor, (req, res) => {
  const corpo = req.body ?? {};
  res.status(201).json(
    criarTarefa(ctx(req), Number(req.params.id), {
      nome: String(corpo.nome ?? ''),
      mesInicio: String(corpo.mes_inicio ?? ''),
      mesFimPlanejado: String(corpo.mes_fim_planejado ?? ''),
      mesFimReal: corpo.mes_fim_real ?? null,
      responsavel: corpo.responsavel ?? null,
      status: corpo.status,
    }),
  );
});

rotasProjetos.patch('/tarefas/:tarefaId', somenteGestor, (req, res) => {
  const corpo = req.body ?? {};
  res.json(
    atualizarTarefa(ctx(req), Number(req.params.tarefaId), {
      nome: corpo.nome,
      mesInicio: corpo.mes_inicio,
      mesFimPlanejado: corpo.mes_fim_planejado,
      mesFimReal: corpo.mes_fim_real,
      responsavel: corpo.responsavel,
      status: corpo.status,
      justificativa: corpo.justificativa,
    }),
  );
});

rotasProjetos.delete('/tarefas/:tarefaId', somenteGestor, (req, res) => {
  res.json(excluirTarefa(ctx(req), Number(req.params.tarefaId), req.body?.justificativa));
});

// --------------------------------------------------------------- Envolvidos
rotasProjetos.get('/:id/envolvidos', (req, res) => {
  res.json(listarEnvolvidos(ctx(req), Number(req.params.id)));
});

rotasProjetos.post('/:id/envolvidos', somenteGestor, (req, res) => {
  res.status(201).json(adicionarEnvolvido(ctx(req), Number(req.params.id), req.body ?? {}));
});

rotasProjetos.delete('/:id/envolvidos/:envolvidoId', somenteGestor, (req, res) => {
  res.json(removerEnvolvido(ctx(req), Number(req.params.id), Number(req.params.envolvidoId)));
});
