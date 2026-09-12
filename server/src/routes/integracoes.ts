/**
 * Tela de Integrações: configuração de cada conexão e log de eventos.
 *
 * Fica dentro do router protegido por sessão — quem mexe aqui é o gestor, e
 * não a automação. Os webhooks, que a automação chama, são outro arquivo.
 */
import { Router } from 'express';
import {
  definirAtivo,
  enviarPayloadDeTeste,
  listarEventos,
  listarIntegracoes,
  regenerarSegredo,
  reprocessarEvento,
  SISTEMAS,
  type StatusEvento,
} from '../domain/integracoes.js';
import type { SistemaOrigem } from '../domain/suporte.js';
import { erroValidacao } from '../lib/erros.js';
import { ctx, exigir } from '../middleware/index.js';

export const rotasIntegracoes = Router();

/** O sistema vem da URL; recusar cedo evita gravar lixo no log de eventos. */
function sistemaDaRota(valor: unknown): SistemaOrigem {
  const s = String(valor ?? '').toUpperCase() as SistemaOrigem;
  if (!SISTEMAS.includes(s)) throw erroValidacao(`Sistema de origem desconhecido: "${valor}".`);
  return s;
}

const listaDaQuery = (v: unknown): string[] | undefined => {
  if (v === undefined || v === '') return undefined;
  const bruto = Array.isArray(v) ? v : String(v).split(',');
  const itens = bruto.map((x) => String(x).trim()).filter(Boolean);
  return itens.length ? itens : undefined;
};

rotasIntegracoes.get('/', (req, res) => res.json(listarIntegracoes(ctx(req))));

/**
 * Gira o segredo e devolve o valor em claro — a única vez em que ele existe
 * fora do N8N. A resposta diz isso em voz alta, para o gestor copiar antes de
 * fechar a tela.
 */
rotasIntegracoes.post('/:sistema/segredo', exigir('integracoes', 'create'), (req, res) => {
  const r = regenerarSegredo(ctx(req), sistemaDaRota(req.params.sistema));
  res.json({
    ...r,
    aviso: 'Copie agora: o segredo é guardado como hash e não será exibido de novo.',
  });
});

rotasIntegracoes.patch('/:sistema', exigir('integracoes', 'edit'), (req, res) => {
  const ativo = (req.body ?? {}).ativo;
  if (typeof ativo !== 'boolean') throw erroValidacao('Informe "ativo" como verdadeiro ou falso.');
  res.json(definirAtivo(ctx(req), sistemaDaRota(req.params.sistema), ativo));
});

/** Dispara o payload de exemplo pelo mesmo pipeline do webhook. */
rotasIntegracoes.post('/:sistema/teste', exigir('integracoes', 'create'), (req, res) => {
  res.json(enviarPayloadDeTeste(ctx(req), sistemaDaRota(req.params.sistema)));
});

rotasIntegracoes.get('/eventos', (req, res) => {
  const q = req.query;
  res.json(
    listarEventos(ctx(req), {
      sistemas: listaDaQuery(q.sistema) as SistemaOrigem[] | undefined,
      status: listaDaQuery(q.status) as StatusEvento[] | undefined,
      de: q.de ? String(q.de) : undefined,
      ate: q.ate ? String(q.ate) : undefined,
      limite: q.limite ? Number(q.limite) : undefined,
    }),
  );
});

rotasIntegracoes.post('/eventos/:id/reprocessar', exigir('integracoes', 'create'), (req, res) => {
  res.json(reprocessarEvento(ctx(req), Number(req.params.id)));
});
