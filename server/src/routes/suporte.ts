/**
 * Sistemas de suporte — listagem e detalhe dos chamados.
 *
 * As duas telas (OStick e Bitrix24) usam estas mesmas rotas: o que muda é o
 * filtro `sistema`, e não a estrutura. Foi essa a decisão que evitou duplicar
 * tela, componente e consulta para dizer a mesma coisa duas vezes.
 */
import { Router } from 'express';
import { listarChamados, obterChamado, opcoesDeFiltro, SISTEMAS, type SistemaOrigem } from '../domain/suporte.js';
import { listarSetores, criarSetor, atualizarSetor } from '../domain/cadastros.js';
import { paraInterno } from '../domain/competencia.js';
import { ctx, somenteGestor } from '../middleware/index.js';
import { listaDaQuery, numerosDaQuery } from '../lib/consulta.js';

export const rotasSuporte = Router();

/**
 * Só os sistemas conhecidos entram no filtro. Sem nada informado, a consulta
 * traz os dois — é a mesma estrutura, e o recorte é quem separa as telas.
 */
const sistemasDaQuery = (v: unknown): SistemaOrigem[] | undefined => {
  const lista = listaDaQuery(v);
  if (!lista) return undefined;
  const validos = lista.filter((s): s is SistemaOrigem => SISTEMAS.includes(s as SistemaOrigem));
  return validos.length ? validos : undefined;
};

const competencia = (v: unknown) => (v ? paraInterno(String(v)) : undefined);

rotasSuporte.get('/chamados', (req, res) => {
  const q = req.query;
  res.json(
    listarChamados(ctx(req).empresaId, {
      sistemas: sistemasDaQuery(q.sistema ?? q.source_system),
      setorIds: numerosDaQuery(q.setor_id),
      atendentes: listaDaQuery(q.atendente),
      solicitantes: listaDaQuery(q.solicitante),
      status: listaDaQuery(q.status) as never,
      prioridades: listaDaQuery(q.prioridade) as never,
      filialId:
        q.filial_id === undefined || q.filial_id === ''
          ? undefined
          : q.filial_id === 'nenhuma' || q.filial_id === 'null'
            ? null
            : Number(q.filial_id),
      competenciaInicio: competencia(q.competencia_inicio),
      competenciaFim: competencia(q.competencia_fim),
      busca: q.busca ? String(q.busca) : undefined,
      limite: q.limite ? Number(q.limite) : undefined,
      pagina: q.pagina ? Number(q.pagina) : undefined,
    }),
  );
});

/** Valores presentes na base, para a tela montar os filtros sem inventar opções. */
rotasSuporte.get('/chamados/opcoes', (req, res) => {
  res.json(opcoesDeFiltro(ctx(req).empresaId, sistemasDaQuery(req.query.sistema ?? req.query.source_system)));
});

rotasSuporte.get('/chamados/:id', (req, res) => {
  res.json(obterChamado(ctx(req).empresaId, Number(req.params.id)));
});

// ------------------------------------------------------------------ setores

rotasSuporte.get('/setores', (req, res) => {
  res.json(listarSetores(ctx(req), req.query.incluir_inativos === 'true'));
});

rotasSuporte.post('/setores', somenteGestor, (req, res) => {
  res.status(201).json(criarSetor(ctx(req), String(req.body?.nome ?? '')));
});

rotasSuporte.patch('/setores/:id', somenteGestor, (req, res) => {
  res.json(atualizarSetor(ctx(req), Number(req.params.id), { nome: req.body?.nome, ativo: req.body?.ativo }));
});
