/**
 * Sistemas de suporte — listagem e detalhe dos chamados.
 *
 * As duas telas (OStick e Bitrix24) usam estas mesmas rotas: o que muda é o
 * filtro `sistema`, e não a estrutura. Foi essa a decisão que evitou duplicar
 * tela, componente e consulta para dizer a mesma coisa duas vezes.
 */
import { Router } from 'express';
import multer from 'multer';
import { listarChamados, obterChamado, opcoesDeFiltro, SISTEMAS, type SistemaOrigem } from '../domain/suporte.js';
import { listarSetores, criarSetor, atualizarSetor } from '../domain/cadastros.js';
import { paraInterno } from '../domain/competencia.js';
import { ctx, exigir } from '../middleware/index.js';
import { listaDaQuery, numerosDaQuery } from '../lib/consulta.js';
import {
  ABA_TICKETS,
  abaDeErros,
  abasDeTickets,
  importarTickets,
  previewDeTickets,
} from '../domain/planilha-tickets.js';
import { escreverXlsx } from '../lib/planilha.js';
import { assincrono } from '../middleware/index.js';
import { erroValidacao } from '../lib/erros.js';
import { empresasDoPedido } from '../domain/escopo.js';

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

/**
 * Traduz a query em filtro. Vive à parte porque a listagem e a exportação
 * precisam do MESMO recorte: um arquivo com tudo, quando a tela mostrava um
 * recorte, não é o que o gestor pediu ao clicar em exportar.
 */
export function filtroDaQuery(q: Record<string, unknown>) {
  return {
      // Filtro local de matriz: vazio é o cliente inteiro.
      empresas: empresasDoPedido(q),
      sistemas: sistemasDaQuery(q.sistema ?? q.source_system),
      setorIds: numerosDaQuery(q.setor_id),
      atendentes: listaDaQuery(q.atendente),
      solicitantes: listaDaQuery(q.solicitante),
      status: listaDaQuery(q.status) as never,
      prioridades: listaDaQuery(q.prioridade) as never,
      filaIds: numerosDaQuery(q.fila_id),
      // `sem` representa o tópico ausente, que `IN` não alcança.
      topicoIds: listaDaQuery(q.topico_ajuda_id)?.map((v) => (v === 'sem' || v === 'null' ? null : Number(v))),
      sla: listaDaQuery(q.sla),
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
  };
}

rotasSuporte.get('/chamados', (req, res) => {
  res.json(listarChamados(ctx(req), filtroDaQuery(req.query as Record<string, unknown>)));
});

/** Valores presentes na base, para a tela montar os filtros sem inventar opções. */
rotasSuporte.get('/chamados/opcoes', (req, res) => {
  res.json(
    opcoesDeFiltro(
      ctx(req),
      sistemasDaQuery(req.query.sistema ?? req.query.source_system),
      empresasDoPedido(req.query as Record<string, unknown>),
    ),
  );
});

// Antes de `/chamados/:id`, e não depois: Express casa na ordem de declaração,
// e `:id` engoliria "exportacao.xlsx" como se fosse o identificador de um chamado.
/** Exporta o recorte em foco, com as duas abas do template. */
rotasSuporte.get(
  '/chamados/exportacao.xlsx',
  exigir('suporte_ostick', 'export'),
  assincrono(async (req, res) => {
    const abas = abasDeTickets(ctx(req), filtroDaQuery(req.query as Record<string, unknown>));
    const hoje = new Date().toISOString().slice(0, 10);
    enviarXlsx(res, `chamados-${hoje}.xlsx`, await escreverXlsx(abas));
  }),
);

/** O modelo oficial: aba de dados vazia, aba de instruções preenchida. */
rotasSuporte.get(
  '/chamados/modelo.xlsx',
  assincrono(async (req, res) => {
    enviarXlsx(res, 'modelo-chamados.xlsx', await escreverXlsx(abasDeTickets(ctx(req), {}, true)));
  }),
);

rotasSuporte.get('/chamados/:id', (req, res) => {
  res.json(obterChamado(ctx(req), Number(req.params.id)));
});

// ------------------------------------------------------------------ setores

rotasSuporte.get('/setores', (req, res) => {
  res.json(listarSetores(ctx(req), req.query.incluir_inativos === 'true'));
});

rotasSuporte.post('/setores', exigir('suporte_ostick', 'create'), (req, res) => {
  res.status(201).json(criarSetor(ctx(req), String(req.body?.nome ?? '')));
});

rotasSuporte.patch('/setores/:id', exigir('suporte_ostick', 'edit'), (req, res) => {
  res.json(atualizarSetor(ctx(req), Number(req.params.id), { nome: req.body?.nome, ativo: req.body?.ativo }));
});

// ------------------------------------------------------- planilha de chamados

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const enviarXlsx = (res: Parameters<Parameters<typeof rotasSuporte.get>[1]>[1], nome: string, dados: Buffer) =>
  res
    .setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .setHeader('Content-Disposition', `attachment; filename="${nome}"`)
    .send(dados);

/**
 * Valida sem gravar. É o que alimenta a pré-visualização: o gestor vê linha a
 * linha o que vai acontecer antes de confirmar.
 */
rotasSuporte.post(
  '/chamados/importacao/previa',
  exigir('suporte_ostick', 'create'),
  upload.single('arquivo'),
  assincrono(async (req, res) => {
    if (!req.file) throw erroValidacao(`Envie o arquivo no campo "arquivo" (multipart/form-data).`);
    res.json(await previewDeTickets(ctx(req), req.file.buffer));
  }),
);

rotasSuporte.post(
  '/chamados/importacao',
  exigir('suporte_ostick', 'create'),
  upload.single('arquivo'),
  assincrono(async (req, res) => {
    if (!req.file) throw erroValidacao(`Envie o arquivo no campo "arquivo" (multipart/form-data).`);
    res.json(await importarTickets(ctx(req), req.file.buffer));
  }),
);

/**
 * Planilha só com as linhas recusadas, para corrigir e reenviar apenas elas.
 * Recebe os erros de volta porque o relatório é da importação que acabou de
 * rodar — guardá-lo no servidor seria estado sem dono.
 */
rotasSuporte.post(
  '/chamados/importacao/erros.xlsx',
  assincrono(async (req, res) => {
    const erros = ((req.body ?? {}).erros ?? []) as Array<{ linha: number; external_id: string; mensagem: string }>;
    if (!Array.isArray(erros) || erros.length === 0) {
      throw erroValidacao('Nenhum erro informado para gerar a planilha.');
    }
    enviarXlsx(res, `erros-importacao-${ABA_TICKETS.toLowerCase()}.xlsx`, await escreverXlsx(abaDeErros(erros)));
  }),
);
