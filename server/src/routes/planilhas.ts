import { Router } from 'express';
import multer from 'multer';
import { importarPlanilha, listarImportacoes, obterImportacao, ultimaCarga } from '../domain/importacao.js';
import { analisarFoc, importarFoc } from '../domain/importacao-foc.js';
import { analisarContasPagar, importarContasPagar } from '../domain/importacao-contas-pagar.js';
import { previaLimpeza, limparLancamentos } from '../domain/limpeza.js';
import type { Decisao } from '../domain/conciliacao.js';
import { criarMapeamento, listarMapeamentos, removerMapeamento } from '../domain/mapeamentos.js';
import { escreverXlsx } from '../lib/planilha.js';
import {
  exportarCsv,
  exportarXlsx,
  listarExportacoes,
  nomeArquivoExportacao,
  registrarExportacao,
} from '../domain/exportacao.js';
import { escopoDaOperacao, resumoEscopo } from '../domain/escopo-operacao.js';
import { ABAS, ABAS_POR_MODULO, TEMPLATE_VERSAO_ATUAL, type Modulo, type NomeAba } from '../domain/templates.js';
import { erroValidacao } from '../lib/erros.js';
import { assincrono, ctx, exigir } from '../middleware/index.js';

/**
 * O ESCOPO desta exportação ou carga.
 *
 * Antes, toda operação de arquivo era de UMA matriz: a unidade vinha do pedido
 * e o arquivo inteiro ia para ela. Isso obrigava a repetir a carga uma vez por
 * empresa do cliente — e cada repetição é uma chance a mais de mandar o arquivo
 * para a unidade errada.
 *
 * Agora o padrão é o cliente inteiro, e restringir é escolha de quem opera. A
 * conferência de que nada atravessa o cliente fica em `escopoDaOperacao`, não
 * aqui: a tela pode listar o que quiser; o que entra na operação passa por lá.
 */
function escopoDoPedido(req: Parameters<typeof ctx>[0]) {
  return escopoDaOperacao(ctx(req), {
    ...(req.query as Record<string, unknown>),
    ...((req.body ?? {}) as Record<string, unknown>),
  });
}

export const rotasPlanilhas = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const MODULOS: Modulo[] = ['financeiro', 'projetos', 'sla', 'completo'];

function validarModulo(valor: string): Modulo {
  if (!MODULOS.includes(valor as Modulo)) {
    throw erroValidacao(`Módulo "${valor}" inválido. Use: ${MODULOS.join(', ')}.`);
  }
  return valor as Modulo;
}

/** Descreve o template vigente — as colunas que a planilha deve conter. */
rotasPlanilhas.get('/templates', (_req, res) => {
  res.json({
    versao: TEMPLATE_VERSAO_ATUAL,
    modulos: Object.fromEntries(
      MODULOS.map((m) => [
        m,
        ABAS_POR_MODULO[m].map((aba) => ({
          aba,
          colunas: ABAS[aba].colunas,
          obrigatorias: ABAS[aba].obrigatorias,
        })),
      ]),
    ),
  });
});

/** Baixa o template em branco (mesmo layout da exportação). */
rotasPlanilhas.get(
  '/templates/:modulo.xlsx',
  assincrono(async (req, res) => {
    const modulo = validarModulo(String(req.params.modulo));
    const contexto = ctx(req);
    const escopo = escopoDoPedido(req);
    const { buffer } = await exportarXlsx(contexto, escopo, modulo, true);
    res
      .status(200)
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${nomeArquivoExportacao(contexto, escopo, modulo, 'xlsx', true)}"`,
      );
    res.send(buffer);
  }),
);

/** Exportação completa da base no mesmo template de importação. */
rotasPlanilhas.get(
  '/exportacao/:modulo.xlsx',
  // Exportar é escrita nenhuma, mas é saída de dado: tem ação própria.
  exigir('financeiro', 'export'),
  assincrono(async (req, res) => {
    const modulo = validarModulo(String(req.params.modulo));
    const contexto = ctx(req);
    const escopo = escopoDoPedido(req);
    const { buffer, linhas } = await exportarXlsx(contexto, escopo, modulo, false);
    const arquivo = nomeArquivoExportacao(contexto, escopo, modulo, 'xlsx');
    registrarExportacao(contexto, escopo, { modulo, formato: 'xlsx', arquivoNome: arquivo, totalLinhas: linhas });
    res
      .status(200)
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', `attachment; filename="${arquivo}"`)
      .setHeader('X-Escopo', encodeURIComponent(resumoEscopo(escopo)));
    res.send(buffer);
  }),
);

rotasPlanilhas.get('/exportacao/:aba.csv', exigir('financeiro', 'export'), (req, res) => {
  const nomes = Object.keys(ABAS) as NomeAba[];
  const aba = nomes.find((n) => n.toLowerCase() === String(req.params.aba).toLowerCase());
  if (!aba) throw erroValidacao(`Aba "${req.params.aba}" inválida. Use: ${nomes.join(', ')}.`);
  const contexto = ctx(req);
  const escopo = escopoDoPedido(req);
  const template = req.query.template === 'true';
  const { texto, linhas } = exportarCsv(contexto, escopo, aba, template);
  if (!template) {
    registrarExportacao(contexto, escopo, {
      modulo: 'financeiro',
      formato: 'csv',
      arquivoNome: `${aba.toLowerCase()}.csv`,
      totalLinhas: linhas,
    });
  }
  res
    .status(200)
    .type('text/csv; charset=utf-8')
    .setHeader('Content-Disposition', `attachment; filename="${aba.toLowerCase()}.csv"`)
    .send(texto);
});

/**
 * Importação: linhas válidas entram, inválidas voltam no relatório de erros.
 * `simular=true` valida sem gravar nada.
 */
rotasPlanilhas.post(
  '/importacao/:modulo',
  // A planilha geral escreve nos três módulos: permitir importar em um só
  // deixaria entrar pelo arquivo o que a permissão nega pela tela.
  exigir('financeiro', 'import'),
  exigir('projetos', 'import'),
  exigir('suporte_ostick', 'import'),
  upload.single('arquivo'),
  assincrono(async (req, res) => {
    const modulo = validarModulo(String(req.params.modulo));
    if (!req.file) throw erroValidacao('Envie a planilha no campo "arquivo" (multipart/form-data).');
    const resultado = await importarPlanilha(ctx(req), req.file.buffer, {
      modulo,
      escopo: escopoDoPedido(req),
      arquivoNome: req.file.originalname,
      criarCadastrosAusentes: req.body?.criar_cadastros !== 'false',
      simular: req.body?.simular === 'true' || req.query.simular === 'true',
      modo: req.body?.modo === 'inicial' ? 'inicial' : 'incremental',
      confirmarSobrescrita: req.body?.confirmar === 'true',
    });
    res.status(resultado.com_erro > 0 ? 207 : 200).json(resultado);
  }),
);

// ------------------------------------------------- carga FOC com conciliação
//
// Dois passos, de propósito. `/conciliacao` só lê: devolve o que diverge do
// cadastro e não toca na base. `/carga` recebe as decisões e grava numa
// transação só. O arquivo sobe de novo no segundo passo em vez de ficar
// guardado no servidor — assim não existe meia-importação pendurada, e o hash
// confere que é o mesmo arquivo que foi analisado.

rotasPlanilhas.post(
  '/foc/conciliacao',
  exigir('financeiro', 'import'),
  upload.single('arquivo'),
  assincrono(async (req, res) => {
    if (!req.file) throw erroValidacao('Envie a planilha no campo "arquivo" (multipart/form-data).');
    res.json(await analisarFoc(ctx(req), req.file.buffer, req.file.originalname, escopoDoPedido(req)));
  }),
);

rotasPlanilhas.post(
  '/foc/carga',
  exigir('financeiro', 'import'),
  upload.single('arquivo'),
  assincrono(async (req, res) => {
    if (!req.file) throw erroValidacao('Envie a planilha no campo "arquivo" (multipart/form-data).');
    let decisoes: Decisao[] = [];
    try {
      const bruto = req.body?.decisoes;
      decisoes = typeof bruto === 'string' ? JSON.parse(bruto) : Array.isArray(bruto) ? bruto : [];
    } catch {
      throw erroValidacao('As decisões da conciliação vieram num formato que não deu para ler.');
    }
    const resultado = await importarFoc(ctx(req), req.file.buffer, {
      decisoes,
      arquivoNome: req.file.originalname,
      modo: req.body?.modo === 'inicial' ? 'inicial' : 'incremental',
      escopo: escopoDoPedido(req),
    });
    res.status(resultado.com_erro > 0 ? 207 : 200).json(resultado);
  }),
);

// ------------------------------------- carga de Contas a Pagar (layout do ERP)
//
// Mesmos dois passos da carga FOC, e um a mais dentro do primeiro: quando não
// há decisão de cadastro pendente, `/conciliacao` já devolve o confronto
// LANÇAMENTO a lançamento contra a base do cliente. É o que impede a carga de
// dobrar uma base que já tem quase a mesma despesa vinda de outro relatório do
// mesmo ERP.

/** As decisões da conciliação, como a tela as manda (JSON num campo do form). */
function decisoesDoPedido(bruto: unknown): Decisao[] {
  try {
    return typeof bruto === 'string' ? JSON.parse(bruto) : Array.isArray(bruto) ? bruto : [];
  } catch {
    throw erroValidacao('As decisões da conciliação vieram num formato que não deu para ler.');
  }
}

rotasPlanilhas.post(
  '/contas-pagar/conciliacao',
  exigir('financeiro', 'import'),
  upload.single('arquivo'),
  assincrono(async (req, res) => {
    if (!req.file) throw erroValidacao('Envie o arquivo no campo "arquivo" (multipart/form-data).');
    res.json(
      analisarContasPagar(ctx(req), req.file.buffer, {
        arquivoNome: req.file.originalname,
        decisoes: decisoesDoPedido(req.body?.decisoes),
        escopo: escopoDoPedido(req),
      }),
    );
  }),
);

rotasPlanilhas.post(
  '/contas-pagar/carga',
  exigir('financeiro', 'import'),
  upload.single('arquivo'),
  assincrono(async (req, res) => {
    if (!req.file) throw erroValidacao('Envie o arquivo no campo "arquivo" (multipart/form-data).');
    const resultado = importarContasPagar(ctx(req), req.file.buffer, {
      decisoes: decisoesDoPedido(req.body?.decisoes),
      arquivoNome: req.file.originalname,
      modo: req.body?.modo === 'inicial' ? 'inicial' : 'incremental',
      escopo: escopoDoPedido(req),
    });
    res.status(resultado.com_erro > 0 ? 207 : 200).json(resultado);
  }),
);

// ----------------------------------------------------------- limpeza da base

/** Quantos registros a limpeza atingiria. Não apaga nada. */
rotasPlanilhas.get('/limpeza/previa', exigir('financeiro', 'delete'), (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(previaLimpeza(ctx(req), { de: q.de ?? null, ate: q.ate ?? null }));
});

rotasPlanilhas.post('/limpeza', exigir('financeiro', 'delete'), (req, res) => {
  const corpo = (req.body ?? {}) as Record<string, string | undefined>;
  res.json(
    limparLancamentos(ctx(req), {
      de: corpo.de ?? null,
      ate: corpo.ate ?? null,
      confirmacao: corpo.confirmacao ?? null,
    }),
  );
});

/** Data/hora da última carga concluída — o "Última atualização" das telas. */
rotasPlanilhas.get('/ultima-carga', (req, res) => res.json(ultimaCarga(ctx(req))));

rotasPlanilhas.get('/importacoes', (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(
    listarImportacoes(ctx(req), undefined, {
      modo: q.modo ?? null,
      status: q.status ?? null,
      usuario_id: q.usuario_id ? Number(q.usuario_id) : null,
      de: q.de ?? null,
      ate: q.ate ?? null,
      escopo: q.escopo ?? null,
    }),
  );
});

/** O histórico de exportações — o ExportLog, com os mesmos filtros do de cargas. */
rotasPlanilhas.get('/exportacoes', exigir('financeiro', 'export'), (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(
    listarExportacoes(ctx(req), {
      modulo: q.modulo ?? null,
      escopo: q.escopo ?? null,
      usuario_id: q.usuario_id ? Number(q.usuario_id) : null,
      de: q.de ?? null,
      ate: q.ate ?? null,
    }),
  );
});

rotasPlanilhas.get('/importacoes/:id', (req, res) =>
  res.json(obterImportacao(ctx(req), Number(req.params.id))),
);

/**
 * As linhas recusadas de uma carga, em planilha.
 *
 * É com este arquivo que o gestor corrige a origem: cada linha traz o número
 * que o Excel mostra e o motivo da recusa, lado a lado.
 */
rotasPlanilhas.get(
  '/importacoes/:id/erros.xlsx',
  assincrono(async (req, res) => {
    const registro = obterImportacao(ctx(req), Number(req.params.id));
    const buffer = await escreverXlsx([
      {
        nome: 'Erros',
        colunas: ['Aba', 'Linha', 'Motivo'],
        linhas: registro.relatorio.erros.map((e) => ({ Aba: e.aba, Linha: e.linha, Motivo: e.mensagem })),
      },
    ]);
    res
      .status(200)
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', `attachment; filename="erros-importacao-${registro.id}.xlsx"`);
    res.send(buffer);
  }),
);

// ------------------------------------------------- adaptador de cabeçalhos

rotasPlanilhas.get('/mapeamentos', exigir('configuracoes', 'view'), (req, res) => {
  const cliente = ctx(req).clienteId;
  res.json({
    cliente_id: cliente,
    abas: Object.fromEntries((Object.keys(ABAS) as NomeAba[]).map((a) => [a, ABAS[a].colunas])),
    mapeamentos: cliente ? listarMapeamentos(cliente) : [],
  });
});

rotasPlanilhas.post('/mapeamentos', exigir('configuracoes', 'edit'), (req, res) => {
  const cliente = ctx(req).clienteId;
  if (!cliente) throw erroValidacao('Esta empresa ainda não pertence a um cliente.');
  res.status(201).json(criarMapeamento(cliente, req.body ?? {}));
});

rotasPlanilhas.delete('/mapeamentos/:id', exigir('configuracoes', 'edit'), (req, res) => {
  const cliente = ctx(req).clienteId;
  if (!cliente) throw erroValidacao('Esta empresa ainda não pertence a um cliente.');
  res.json(removerMapeamento(cliente, Number(req.params.id)));
});
