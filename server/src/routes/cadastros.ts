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
  tiposDespesaDoCliente,
  listarTopicosAjuda,
} from '../domain/cadastros.js';
import { atualizarMeta, criarMeta, listarMetas } from '../domain/metas.js';
import {
  aplicarReconhecimento,
  atualizarReconhecedor,
  criarReconhecedor,
  listarReconhecedores,
  previaReconhecimento,
} from '../domain/reconhecedores.js';
import {
  atualizarSla,
  criarSla,
  listarSlas,
  previaReaplicacao,
  reaplicarAcordos,
} from '../domain/slas.js';
import { atualizarPlano, criarPlano, listarPlanos } from '../domain/reducao.js';
import { atualizarEmpresa } from '../domain/empresas.js';
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
  const incluirInativos = req.query.incluir_inativos === 'true';
  // `cliente=true` pede a lista do grupo, qualificada pela matriz — é o que o
  // cadastro do plano de redução precisa, porque o plano é do cliente. Sem o
  // parâmetro, segue valendo a lista da unidade em foco, como sempre.
  res.json(
    req.query.cliente === 'true'
      ? tiposDespesaDoCliente(ctx(req), incluirInativos)
      : listarTiposDespesa(unidade(req), incluirInativos),
  );
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

// ------------------------------------------------------------------ Metas
// A meta é do CLIENTE, e não da unidade em foco: por isso `ctx(req)` direto,
// sem `unidade(req)` — o alvo de SLA de um contratante não muda de matriz
// para matriz.
rotasCadastros.get('/metas', (req, res) => {
  res.json(listarMetas(ctx(req), req.query.incluir_inativos === 'true'));
});

rotasCadastros.post('/metas', exigir('configuracoes', 'create'), (req, res) => {
  res.status(201).json(criarMeta(ctx(req), req.body ?? {}));
});

rotasCadastros.patch('/metas/:id', exigir('configuracoes', 'edit'), (req, res) => {
  res.json(atualizarMeta(ctx(req), Number(req.params.id), req.body ?? {}));
});

// ----------------------------------------------------------- Acordos de SLA
// Ao contrário das metas, o acordo é da UNIDADE: a hora de atendimento de um
// hospital não é a do outro. Daí `unidade(req)`, como nos demais cadastros.
rotasCadastros.get('/slas', (req, res) => {
  res.json(listarSlas(unidade(req), req.query.incluir_inativos === 'true'));
});

rotasCadastros.post('/slas', exigir('configuracoes', 'create'), (req, res) => {
  res.status(201).json(criarSla(unidade(req), req.body ?? {}));
});

rotasCadastros.patch('/slas/:id', exigir('configuracoes', 'edit'), (req, res) => {
  res.json(atualizarSla(unidade(req), Number(req.params.id), req.body ?? {}));
});

// Aplicar o acordo ao que JÁ está gravado. A prévia vem antes por desenho:
// "recalcular 412 chamados, 37 saem de dentro para fora" é uma decisão;
// "recalcular" sozinho é um susto — o mesmo motivo que fez a limpeza de base
// ter prévia própria.
rotasCadastros.get('/slas/reaplicacao', exigir('configuracoes', 'edit'), (req, res) => {
  res.json(previaReaplicacao(unidade(req), req.query.competencia));
});

rotasCadastros.post('/slas/reaplicacao', exigir('configuracoes', 'edit'), (req, res) => {
  const corpo = req.body ?? {};
  res.json(reaplicarAcordos(unidade(req), corpo.competencia, corpo.justificativa));
});

// ------------------------------------------- Quem reconhece despesa
// Do CLIENTE, como as metas e o plano: a mesma pessoa lança para todas as
// unidades do grupo, e repetir o cadastro por matriz criaria seis listas para
// manter em sincronia.
rotasCadastros.get('/reconhecedores', (req, res) => {
  res.json(listarReconhecedores(ctx(req), req.query.incluir_inativos === 'true'));
});

rotasCadastros.post('/reconhecedores', exigir('configuracoes', 'create'), (req, res) => {
  res.status(201).json(criarReconhecedor(ctx(req), req.body ?? {}));
});

rotasCadastros.patch('/reconhecedores/:id', exigir('configuracoes', 'edit'), (req, res) => {
  res.json(atualizarReconhecedor(ctx(req), Number(req.params.id), req.body ?? {}));
});

// Aplicar o cadastro ao que já está gravado. Prévia antes, pelo mesmo motivo
// da limpeza de base: "reconhecer 612 lançamentos" é uma decisão;
// "reconhecer" sozinho é um susto.
const recorteDoPedido = (q: Record<string, unknown>) => ({
  de: q.de ? paraInterno(q.de) : null,
  ate: q.ate ? paraInterno(q.ate) : null,
});

rotasCadastros.get('/reconhecedores/aplicacao', exigir('configuracoes', 'edit'), (req, res) => {
  res.json(previaReconhecimento(ctx(req), recorteDoPedido(req.query as Record<string, unknown>)));
});

rotasCadastros.post('/reconhecedores/aplicacao', exigir('configuracoes', 'edit'), (req, res) => {
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  res.json(aplicarReconhecimento(ctx(req), recorteDoPedido(corpo), String(corpo.justificativa ?? '')));
});

// -------------------------------------------- Plano de redução de despesas
// Do CLIENTE, como as metas: o plano de corte é negociado para o grupo, e um
// item que valesse só numa matriz não responderia "quanto isso é do grupo?",
// que é metade da leitura pedida.
rotasCadastros.get('/planos-reducao', (req, res) => {
  res.json(listarPlanos(ctx(req), req.query.incluir_inativos === 'true'));
});

rotasCadastros.post('/planos-reducao', exigir('configuracoes', 'create'), (req, res) => {
  res.status(201).json(criarPlano(ctx(req), req.body ?? {}));
});

rotasCadastros.patch('/planos-reducao/:id', exigir('configuracoes', 'edit'), (req, res) => {
  res.json(atualizarPlano(ctx(req), Number(req.params.id), req.body ?? {}));
});

// -------------------------------------------------------------- Auditoria
rotasCadastros.get('/auditoria', (req, res) => {
  res.json(
    listarAuditoria(ctx(req), {
      // O filtro local de matriz que a tela manda — antes ficava para trás
      // aqui, e a auditoria sempre voltava o cliente inteiro mesmo com uma
      // unidade escolhida (compare com `/filiais`, que já chama isto).
      empresas: empresasDoPedido(req.query as Record<string, unknown>),
      entidade: req.query.entidade ? String(req.query.entidade) : undefined,
      entidadeId: req.query.entidade_id ? Number(req.query.entidade_id) : undefined,
      limite: req.query.limite ? Number(req.query.limite) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    }),
  );
});
