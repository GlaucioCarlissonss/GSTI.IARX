import { Router } from 'express';
import multer from 'multer';
import { importarPlanilha, listarImportacoes } from '../domain/importacao.js';
import { exportarCsv, exportarXlsx, nomeArquivoExportacao } from '../domain/exportacao.js';
import { ABAS, ABAS_POR_MODULO, TEMPLATE_VERSAO_ATUAL, type Modulo, type NomeAba } from '../domain/templates.js';
import { erroValidacao } from '../lib/erros.js';
import { assincrono, ctx, somenteGestor } from '../middleware/index.js';

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

rotasPlanilhas.get('/exportacao/:aba.csv', (req, res) => {
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
  somenteGestor,
  upload.single('arquivo'),
  assincrono(async (req, res) => {
    const modulo = validarModulo(String(req.params.modulo));
    if (!req.file) throw erroValidacao('Envie a planilha no campo "arquivo" (multipart/form-data).');
    const resultado = await importarPlanilha(ctx(req), req.file.buffer, {
      modulo,
      arquivoNome: req.file.originalname,
      criarCadastrosAusentes: req.body?.criar_cadastros !== 'false',
      simular: req.body?.simular === 'true' || req.query.simular === 'true',
    });
    res.status(resultado.com_erro > 0 ? 207 : 200).json(resultado);
  }),
);

rotasPlanilhas.get('/importacoes', (req, res) => res.json(listarImportacoes(ctx(req))));
