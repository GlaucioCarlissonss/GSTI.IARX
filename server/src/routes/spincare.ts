/**
 * O Controle Único do projeto de implantação.
 *
 * Mora sob `/projetos/controle-unico` porque é lá que a tela vive, e porque o
 * controle é do programa de implantação, não um módulo à parte.
 *
 * A carga tem DOIS passos — analisar e gravar — e isso é de propósito. O
 * arquivo substitui o controle inteiro, e substituir sem mostrar antes o que
 * entraria é tirar do gestor a chance de recusar um arquivo trocado.
 */
import { Router } from 'express';
import multer from 'multer';
import { erroValidacao } from '../lib/erros.js';
import { ctx, exigir } from '../middleware/index.js';
import { auditar } from '../domain/auditoria.js';
import { lerControleUnico } from '../domain/carga-spincare.js';
import { UNIDADES, hojeISO, painel, removerControle, substituirControle } from '../domain/spincare.js';

export const rotasSpincare = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

/**
 * O painel: placar, avanço por unidade e as atividades derivadas.
 *
 * `hoje` é aceito por parâmetro para a conferência poder medir um dia
 * escolhido. Em produção ele não vem, e vale o dia do servidor — nenhum
 * derivado está gravado, então a resposta é sempre do dia em que foi pedida.
 */
rotasSpincare.get('/', exigir('projetos', 'view'), (req, res) => {
  const pedido = String((req.query as Record<string, unknown>).hoje ?? '');
  if (pedido && !/^\d{4}-\d{2}-\d{2}$/.test(pedido)) {
    throw erroValidacao('O parâmetro "hoje" deve estar no formato AAAA-MM-DD.');
  }
  res.json({ ...painel(ctx(req), pedido || hojeISO()), colunas: UNIDADES });
});

/** Analisa o arquivo e devolve o que entraria — sem gravar nada. */
rotasSpincare.post(
  '/analisar',
  exigir('projetos', 'edit'),
  upload.single('arquivo'),
  async (req, res) => {
    if (!req.file) throw erroValidacao('Envie o controle no campo "arquivo" (multipart/form-data).');
    const leitura = await lerControleUnico(req.file.buffer);
    // As ATIVIDADES não voltam inteiras: são centenas, e o que o gestor precisa
    // ver antes de gravar é quantas entrariam e o que a carga achou de errado.
    res.json({
      total: leitura.atividades.length,
      problemas: leitura.problemas,
      diagnostico: leitura.diagnostico,
    });
  },
);

/** Grava o controle, substituindo o que havia. */
rotasSpincare.post(
  '/',
  exigir('projetos', 'edit'),
  upload.single('arquivo'),
  async (req, res) => {
    if (!req.file) throw erroValidacao('Envie o controle no campo "arquivo" (multipart/form-data).');
    const leitura = await lerControleUnico(req.file.buffer);
    if (!leitura.atividades.length) {
      // Gravar zero atividade apagaria o controle que já estava lá, e o gestor
      // pediu uma importação, não uma exclusão.
      throw erroValidacao(
        'O arquivo foi reconhecido, mas nenhuma atividade pôde ser lida — o controle atual '
        + 'foi mantido. Confira se as linhas têm ID e nome da atividade.',
      );
    }
    const contexto = ctx(req);
    const r = substituirControle(contexto, leitura.atividades);
    auditar(contexto, {
      entidade: 'controle_unico',
      acao: 'importar',
      comEmpresa: false,
      depois: {
        arquivo: req.file.originalname,
        gravadas: r.gravadas,
        removidas: r.removidas,
        problemas: leitura.problemas.length,
      },
    });
    res.json({ ...r, problemas: leitura.problemas, diagnostico: leitura.diagnostico });
  },
);

/** Apaga o controle do cliente. */
rotasSpincare.delete('/', exigir('projetos', 'delete'), (req, res) => {
  const contexto = ctx(req);
  const removidas = removerControle(contexto);
  auditar(contexto, {
    entidade: 'controle_unico', acao: 'excluir', comEmpresa: false, antes: { removidas },
  });
  res.json({ removidas });
});
