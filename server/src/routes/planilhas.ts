import { Router } from 'express';
import multer from 'multer';
import { importarPlanilha, listarImportacoes, obterImportacao } from '../domain/importacao.js';
import { criarMapeamento, listarMapeamentos, removerMapeamento } from '../domain/mapeamentos.js';
import { escreverXlsx } from '../lib/planilha.js';
import { exportarCsv, exportarXlsx, nomeArquivoExportacao } from '../domain/exportacao.js';
import { ABAS, ABAS_POR_MODULO, TEMPLATE_VERSAO_ATUAL, type Modulo, type NomeAba } from '../domain/templates.js';
import { erroValidacao } from '../lib/erros.js';
import { assincrono, ctx, exigir } from '../middleware/index.js';

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
    const buffer = await exportarXlsx(ctx(req), modulo, true);
    res
      .status(200)
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${nomeArquivoExportacao(ctx(req), modulo, 'xlsx', true)}"`,
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
    const buffer = await exportarXlsx(ctx(req), modulo, false);
    res
      .status(200)
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', `attachment; filename="${nomeArquivoExportacao(ctx(req), modulo, 'xlsx')}"`);
    res.send(buffer);
  }),
);

rotasPlanilhas.get('/exportacao/:aba.csv', exigir('financeiro', 'export'), (req, res) => {
  const nomes = Object.keys(ABAS) as NomeAba[];
  const aba = nomes.find((n) => n.toLowerCase() === String(req.params.aba).toLowerCase());
  if (!aba) throw erroValidacao(`Aba "${req.params.aba}" inválida. Use: ${nomes.join(', ')}.`);
  res
    .status(200)
    .type('text/csv; charset=utf-8')
    .setHeader('Content-Disposition', `attachment; filename="${aba.toLowerCase()}.csv"`)
    .send(exportarCsv(ctx(req), aba, req.query.template === 'true'));
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
      arquivoNome: req.file.originalname,
      criarCadastrosAusentes: req.body?.criar_cadastros !== 'false',
      simular: req.body?.simular === 'true' || req.query.simular === 'true',
      modo: req.body?.modo === 'inicial' ? 'inicial' : 'incremental',
      confirmarSobrescrita: req.body?.confirmar === 'true',
    });
    res.status(resultado.com_erro > 0 ? 207 : 200).json(resultado);
  }),
);

rotasPlanilhas.get('/importacoes', (req, res) => res.json(listarImportacoes(ctx(req))));

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
