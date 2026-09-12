import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autenticado, comEmpresa, tratadorDeErros } from './middleware/index.js';
import { rotasAuth } from './routes/auth.js';
import { rotasCadastros } from './routes/cadastros.js';
import { rotasFinanceiro } from './routes/financeiro.js';
import { rotasProjetos } from './routes/projetos.js';
import { rotasSla } from './routes/sla.js';
import { rotasDashboards } from './routes/dashboards.js';
import { rotasPlanilhas } from './routes/planilhas.js';
import { rotasWebhooks } from './routes/webhooks.js';
import { rotasSuporte } from './routes/suporte.js';

export function criarApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/api/saude', (_req, res) => res.json({ ok: true, servico: 'GSTI.IARX', versao: '1.0.0' }));

  app.use('/api/auth', rotasAuth);
  // Fora do router protegido por sessão: quem chama é uma automação (N8N),
  // autenticada por segredo em header, e não um usuário logado.
  app.use('/api/webhooks', rotasWebhooks);

  // Tudo abaixo exige sessão e empresa em contexto: nenhum dado vive fora do tenant.
  const protegido = express.Router();
  protegido.use(autenticado, comEmpresa);
  protegido.use('/', rotasCadastros);
  protegido.use('/lancamentos', rotasFinanceiro);
  protegido.use('/projetos', rotasProjetos);
  protegido.use('/sla', rotasSla);
  protegido.use('/suporte', rotasSuporte);
  protegido.use('/dashboards', rotasDashboards);
  protegido.use('/planilhas', rotasPlanilhas);
  app.use('/api', protegido);

  // Front-end compilado (implantação em um único processo).
  const aquiDir = dirname(fileURLToPath(import.meta.url));
  const web = resolve(aquiDir, '../../web/dist');
  if (existsSync(web)) {
    app.use(express.static(web));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(resolve(web, 'index.html')));
  }

  app.use(tratadorDeErros);
  return app;
}
