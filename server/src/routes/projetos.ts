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
  listarTarefasDaEmpresa,
  obterProjeto,
  removerEnvolvido,
} from '../domain/projetos.js';
import { ctx, exigir } from '../middleware/index.js';
import { empresasDoPedido } from '../domain/escopo.js';

export const rotasProjetos = Router();

function filialDaQuery(valor: unknown): number | null | undefined {
  if (valor === undefined || valor === '') return undefined;
  if (valor === 'nenhuma' || valor === 'null') return null;
  return Number(valor);
}

function corpoProjeto(corpo: Record<string, unknown>) {
  return {
    // A matriz vem do formulário: criar não depende do filtro da tela.
    empresaId: corpo.empresa_id === undefined || corpo.empresa_id === '' ? undefined : Number(corpo.empresa_id),
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
      empresas: empresasDoPedido(req.query as Record<string, unknown>),
      filialId: filialDaQuery(req.query.filial_id),
      status: req.query.status ? (String(req.query.status) as never) : undefined,
      apenasAtrasados: req.query.atrasados === 'true',
      busca: req.query.busca ? String(req.query.busca) : undefined,
    }),
  );
});

// Antes de `/:id`, e não depois: Express casa na ordem de declaração, e
// `/:id` engoliria "tarefas" como se fosse o identificador de um projeto.
rotasProjetos.get('/tarefas', (req, res) => {
  res.json(
    listarTarefasDaEmpresa(ctx(req), {
      empresas: empresasDoPedido(req.query as Record<string, unknown>),
      projetoId: req.query.projeto_id ? Number(req.query.projeto_id) : undefined,
      filialId: filialDaQuery(req.query.filial_id),
      // `sem` representa a tarefa sem responsável. Um parâmetro vazio não
      // serve: o cliente descarta string vazia, e ela chegaria como ausente —
      // o que significaria "sem filtro" e devolveria todas as tarefas.
      responsavel: req.query.responsavel === undefined ? undefined : (
        req.query.responsavel === 'sem' ? '' : String(req.query.responsavel)
      ),
      status: req.query.status ? (String(req.query.status) as never) : undefined,
      apenasAtrasadas: req.query.atrasadas === 'true',
    }),
  );
});

rotasProjetos.get('/:id', (req, res) => res.json(obterProjeto(ctx(req), Number(req.params.id))));

rotasProjetos.post('/', exigir('projetos', 'create'), (req, res) => {
  res.status(201).json(criarProjeto(ctx(req), corpoProjeto(req.body ?? {})));
});

rotasProjetos.patch('/:id', exigir('projetos', 'edit'), (req, res) => {
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

rotasProjetos.delete('/:id', exigir('projetos', 'delete'), (req, res) => {
  res.json(excluirProjeto(ctx(req), Number(req.params.id), req.body?.justificativa));
});

// ------------------------------------------------------------------ Tarefas
rotasProjetos.get('/:id/tarefas', (req, res) => {
  res.json(listarTarefas(ctx(req), Number(req.params.id)));
});

rotasProjetos.post('/:id/tarefas', exigir('projetos', 'create'), (req, res) => {
  const corpo = req.body ?? {};
  res.status(201).json(
    criarTarefa(ctx(req), Number(req.params.id), {
      nome: String(corpo.nome ?? ''),
      mesInicio: String(corpo.mes_inicio ?? ''),
      mesFimPlanejado: String(corpo.mes_fim_planejado ?? ''),
      mesFimReal: corpo.mes_fim_real ?? null,
      responsavel: corpo.responsavel ?? null,
      status: corpo.status,
      parentTaskId: corpo.parent_task_id ?? null,
    }),
  );
});

rotasProjetos.patch('/tarefas/:tarefaId', exigir('projetos', 'edit'), (req, res) => {
  const corpo = req.body ?? {};
  res.json(
    atualizarTarefa(ctx(req), Number(req.params.tarefaId), {
      nome: corpo.nome,
      mesInicio: corpo.mes_inicio,
      mesFimPlanejado: corpo.mes_fim_planejado,
      mesFimReal: corpo.mes_fim_real,
      responsavel: corpo.responsavel,
      status: corpo.status,
      // `undefined` mantém o vínculo atual; `null` desvincula.
      parentTaskId: corpo.parent_task_id,
      justificativa: corpo.justificativa,
    }),
  );
});

rotasProjetos.delete('/tarefas/:tarefaId', exigir('projetos', 'delete'), (req, res) => {
  res.json(excluirTarefa(ctx(req), Number(req.params.tarefaId), req.body?.justificativa));
});

// --------------------------------------------------------------- Envolvidos
rotasProjetos.get('/:id/envolvidos', (req, res) => {
  res.json(listarEnvolvidos(ctx(req), Number(req.params.id)));
});

rotasProjetos.post('/:id/envolvidos', exigir('projetos', 'create'), (req, res) => {
  res.status(201).json(adicionarEnvolvido(ctx(req), Number(req.params.id), req.body ?? {}));
});

rotasProjetos.delete('/:id/envolvidos/:envolvidoId', exigir('projetos', 'delete'), (req, res) => {
  res.json(removerEnvolvido(ctx(req), Number(req.params.id), Number(req.params.envolvidoId)));
});
