/**
 * O Plano de Ação da implantação.
 *
 * Mora sob `/projetos/plano-acao` porque é lá que a tela vive, e porque o
 * plano é do programa de implantação, não um módulo à parte do sistema.
 *
 * A carga tem DOIS passos — analisar e gravar — e isso é de propósito. O
 * arquivo substitui o plano inteiro, e substituir sem mostrar antes o que
 * entraria é tirar do gestor a chance de recusar um arquivo trocado. Quem só
 * analisa não escreve nada.
 */
import { Router } from 'express';
import multer from 'multer';
import { erroValidacao } from '../lib/erros.js';
import { ctx, exigir } from '../middleware/index.js';
import { auditar } from '../domain/auditoria.js';
import { lerPlanoDeAcao } from '../domain/carga-plano-acao.js';
import { hojeISO, painel, removerPlano, substituirPlano } from '../domain/plano-acao.js';

export const rotasPlanoAcao = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

/**
 * O painel: ações derivadas, placar geral e placar por onda.
 *
 * `hoje` é aceito por parâmetro para a conferência poder medir um dia
 * escolhido. Em produção ele não vem, e vale o dia do servidor — nenhum
 * derivado está gravado, então a resposta é sempre do dia em que foi pedida.
 */
rotasPlanoAcao.get('/', exigir('projetos', 'view'), (req, res) => {
  const pedido = String((req.query as Record<string, unknown>).hoje ?? '');
  if (pedido && !/^\d{4}-\d{2}-\d{2}$/.test(pedido)) {
    throw erroValidacao('O parâmetro "hoje" deve estar no formato AAAA-MM-DD.');
  }
  res.json(painel(ctx(req), pedido || hojeISO()));
});

/**
 * Analisa o arquivo e devolve o que entraria — sem gravar nada.
 *
 * Devolve também os problemas encontrados: é o que permite ao gestor ver que
 * a planilha diz um go-live e o cronograma diz outro ANTES de o plano virar
 * verdade na tela.
 */
rotasPlanoAcao.post(
  '/analisar',
  exigir('projetos', 'edit'),
  upload.single('arquivo'),
  async (req, res) => {
    if (!req.file) throw erroValidacao('Envie o plano no campo "arquivo" (multipart/form-data).');
    res.json(await lerPlanoDeAcao(req.file.buffer));
  },
);

/**
 * Grava o plano, substituindo o que havia.
 *
 * O arquivo é a íntegra do plano, e mesclar faria uma ação removida do
 * documento continuar cobrando prazo na tela para sempre.
 */
rotasPlanoAcao.post(
  '/',
  exigir('projetos', 'edit'),
  upload.single('arquivo'),
  async (req, res) => {
    if (!req.file) throw erroValidacao('Envie o plano no campo "arquivo" (multipart/form-data).');
    const leitura = await lerPlanoDeAcao(req.file.buffer);
    if (!leitura.acoes.length) {
      // Gravar zero ação apagaria o plano que já estava lá, e o gestor pediu
      // uma importação, não uma exclusão.
      throw erroValidacao(
        'O arquivo foi reconhecido, mas nenhuma ação pôde ser lida — o plano atual '
        + 'foi mantido. Confira se as linhas têm número e descrição da tarefa.',
      );
    }
    const contexto = ctx(req);
    const r = substituirPlano(contexto, leitura.acoes);
    auditar(contexto, {
      entidade: 'plano_acao',
      acao: 'importar',
      comEmpresa: false,
      depois: {
        arquivo: req.file.originalname,
        gravadas: r.gravadas,
        removidas: r.removidas,
        ondas: leitura.ondas,
        problemas: leitura.problemas.length,
      },
    });
    res.json({ ...r, problemas: leitura.problemas, ondas: leitura.ondas, diagnostico: leitura.diagnostico });
  },
);

/** Apaga o plano do cliente. */
rotasPlanoAcao.delete('/', exigir('projetos', 'delete'), (req, res) => {
  const contexto = ctx(req);
  const removidas = removerPlano(contexto);
  auditar(contexto, {
    entidade: 'plano_acao', acao: 'excluir', comEmpresa: false, antes: { removidas },
  });
  res.json({ removidas });
});
