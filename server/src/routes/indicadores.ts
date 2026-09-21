/**
 * Indicadores Gerais.
 *
 * Cada bloco tem rota própria porque os filtros da tela são por bloco: quem
 * mexe no período do financeiro não deve fazer o SLA recarregar. `/` devolve os
 * três de uma vez, para a primeira pintura da tela não custar três idas.
 */
import { Router } from 'express';
import {
  conformidadeSla,
  despesaCentralizada,
  despesasPorReconhecer,
  equilibrioDeDespesas,
  entregaDeTarefas,
  indicadoresGerais,
  reducaoDeCusto,
  type RecorteIndicadores,
} from '../domain/indicadores.js';
import { filiaisDaQuery, listaDaQuery } from '../lib/consulta.js';
import { ctx, exigir } from '../middleware/index.js';
import { empresasDoPedido } from '../domain/escopo.js';

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
  });
});

rotasIndicadores.get('/sla', exigir('suporte_ostick', 'view'), (req, res) => {
  res.json(conformidadeSla(ctx(req), recorteDaQuery(req.query as Record<string, unknown>)));
});

rotasIndicadores.get('/projetos', exigir('projetos', 'view'), (req, res) => {
  res.json(entregaDeTarefas(ctx(req), recorteDaQuery(req.query as Record<string, unknown>)));
});
