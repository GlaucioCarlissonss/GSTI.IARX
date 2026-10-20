/**
 * Indicadores Gerais.
 *
 * Cada bloco tem rota própria porque os filtros da tela são por bloco: quem
 * mexe no período do financeiro não deve fazer o SLA recarregar. `/` devolve os
 * três de uma vez, para a primeira pintura da tela não custar três idas.
 */
import { Router } from 'express';
import {
  arvoreDeDespesas,
  conformidadeSla,
  despesaCentralizada,
  despesasPorReconhecer,
  equilibrioDeDespesas,
  entregaDeTarefas,
  indicadoresGerais,
  planoDeReducao,
  rateioDeCompartilhadas,
  reducaoDeCusto,
  type RecorteIndicadores,
} from '../domain/indicadores.js';
import { filiaisDaQuery, listaDaQuery } from '../lib/consulta.js';
import { ctx, exigir } from '../middleware/index.js';
import { empresasDoPedido } from '../domain/escopo.js';
import { cronograma, entregaAte } from '../domain/cronograma.js';
import { competenciaAtual, intervalo, paraExibicao, paraInterno } from '../domain/competencia.js';

export const rotasIndicadores = Router();

function recorteDaQuery(query: Record<string, unknown>, prefixo = ''): RecorteIndicadores {
  const campo = (nome: string) => query[prefixo ? `${prefixo}_${nome}` : nome];
  const reconhecido = campo('reconhecido');
  return {
    // Filtro local de matriz, por bloco: `empresas` ou, com prefixo,
    // `financeiro_empresas`. Vazio é o cliente inteiro.
    empresas: empresasDoPedido({
      empresas: campo('empresas'),
      empresa_id: campo('empresa_id'),
    }),
    filiais: filiaisDaQuery(campo('filial_id')),
    competencias: listaDaQuery(campo('competencia')),
    competenciaInicio: campo('competencia_inicio') ? String(campo('competencia_inicio')) : undefined,
    competenciaFim: campo('competencia_fim') ? String(campo('competencia_fim')) : undefined,
    cenarios: listaDaQuery(campo('cenario')),
    // Ausente quer dizer "tudo". Só 'true'/'false' explícitos recortam — um
    // parâmetro vazio não pode virar filtro, senão a tela filtraria sem pedir.
    reconhecido: reconhecido === undefined || reconhecido === '' ? undefined : String(reconhecido) === 'true',
  };
}

rotasIndicadores.get('/', exigir('relatorios', 'view'), (req, res) => {
  const q = req.query as Record<string, unknown>;
  res.json(
    indicadoresGerais(ctx(req), {
      financeiro: recorteDaQuery(q, 'financeiro'),
      sla: recorteDaQuery(q, 'sla'),
      projetos: recorteDaQuery(q, 'projetos'),
    }),
  );
});

rotasIndicadores.get('/financeiro', exigir('financeiro', 'view'), (req, res) => {
  const recorte = recorteDaQuery(req.query as Record<string, unknown>);
  res.json({
    reducao_custo: reducaoDeCusto(ctx(req), recorte),
    por_reconhecer: despesasPorReconhecer(ctx(req), recorte),
  });
});

rotasIndicadores.get('/consumo', exigir('financeiro', 'view'), (req, res) => {
  const recorte = recorteDaQuery(req.query as Record<string, unknown>);
  res.json({
    ...despesaCentralizada(ctx(req), recorte),
    equilibrio: equilibrioDeDespesas(ctx(req), recorte),
    // O rateio vem junto: ele é a mesma despesa lida de outro jeito, e pedi-lo
    // numa segunda ida deixaria o "antes" e o "depois" fora de sincronia
    // enquanto a segunda resposta não chegasse.
    rateio: rateioDeCompartilhadas(ctx(req), recorte),
  });
});

/**
 * As despesas do recorte em três níveis: empresa → filial → lançamento.
 *
 * Rota própria porque a árvore é grande e nem toda tela a quer — quem só
 * mostra os cartões não paga por ela.
 */
rotasIndicadores.get('/unidades', exigir('financeiro', 'view'), (req, res) => {
  res.json(arvoreDeDespesas(ctx(req), recorteDaQuery(req.query as Record<string, unknown>)));
});

rotasIndicadores.get('/plano-reducao', exigir('financeiro', 'view'), (req, res) => {
  res.json(planoDeReducao(ctx(req), recorteDaQuery(req.query as Record<string, unknown>)));
});

rotasIndicadores.get('/sla', exigir('suporte_ostick', 'view'), (req, res) => {
  res.json(conformidadeSla(ctx(req), recorteDaQuery(req.query as Record<string, unknown>)));
});

rotasIndicadores.get('/projetos', exigir('projetos', 'view'), (req, res) => {
  res.json(entregaDeTarefas(ctx(req), recorteDaQuery(req.query as Record<string, unknown>)));
});

/**
 * O CRONOGRAMA DE ONDAS e a entrega acumulada até uma competência.
 *
 * Rota própria, e não um campo de `/indicadores`: ela não depende de recorte
 * de empresa nem de filial — o cronograma é do programa inteiro —, e
 * pendurá-la no bloco faria toda troca de filtro recarregar algo que não muda
 * com filtro nenhum.
 *
 * `ate` é a competência de corte (MM/AAAA ou AAAA-MM). Sem ela, a posição de
 * hoje.
 */
rotasIndicadores.get('/cronograma', exigir('relatorios', 'view'), (req, res) => {
  const bruto = req.query.ate ? String(req.query.ate) : '';
  const comp = bruto ? paraInterno(bruto) : competenciaAtual();
  const c = cronograma(`${comp}-31`);
  const entrega = entregaAte(comp);
  res.json({
    competencia: paraExibicao(comp),
    pacientes: c.pacientes,
    unidades: c.unidades,
    // A divisão de pacientes por onda não existe no plano novo: o total vale,
    // porque são as mesmas unidades, mas repartir seria palpite.
    pacientes_por_onda_conhecido: false,
    ondas: c.ondas.map((o) => ({
      onda: o.n,
      go_live: o.virada,
      mes: paraExibicao(o.mes),
      unidades: o.unidades,
      virada_realizada: o.viradaRealizada,
      planejadas: o.planejadas,
      viradas: o.viradas,
      // `null` enquanto a onda não vence: zero reprovaria um prazo que não
      // passou, e pintaria de vermelho a onda de janeiro em outubro.
      resultado: o.resultado,
      meta: o.meta,
      venceu: o.venceu,
      estado: o.estado,
      detalhe: o.unidadesDetalhe,
    })),
    entrega,
    // A SÉRIE da entrega, um ponto por competência da janela pedida.
    //
    // Sem ela a faixa mês a mês do bloco Resultados custaria uma ida por mês
    // — o N+1 que aquela entrega existe para não cometer. A conta é a mesma
    // de `entrega`, rodada para cada mês: uma segunda fórmula aqui divergiria
    // da primeira na correção seguinte.
    serie: mesesDaJanela(req.query.de, req.query.ate).map((m) => {
      const e = entregaAte(m);
      return {
        competencia: paraExibicao(m),
        competencia_interna: m,
        planejadas: e.planejadas,
        viradas: e.viradas,
        resultado: e.resultado,
        meta: e.meta,
      };
    }),
  });
});

/**
 * Os meses entre duas competências, inclusive. Sem `de`, só o mês de corte —
 * quem não pediu série não paga por uma.
 */
function mesesDaJanela(de: unknown, ate: unknown): string[] {
  const fim = ate ? paraInterno(String(ate)) : competenciaAtual();
  if (!de) return [fim];
  return intervalo(paraInterno(String(de)), fim);
}
