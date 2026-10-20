/**
 * Base isolada para conferir, no navegador, a FAIXA MÊS A MÊS do bloco
 * Resultados.
 *
 * As bases anteriores bastam para a estrutura e para a barra de atingimento,
 * mas não para a faixa: nelas o SLA tem um registro só — e no mês CORRENTE,
 * que a faixa não mede — e Projetos tem uma entrega só. Uma faixa com um
 * marcador não prova ordem cronológica, não prova semáforo, e não prova que
 * clicar num mês move os três cartões juntos.
 *
 * Este script dá a cada mês fechado uma cor diferente, de propósito:
 *
 *   -3  vermelho   (SLA 50% e Projetos 0% contra meta de 80%)
 *   -2  laranja    (SLA 70% e Projetos 75%)
 *   -1  verde      (SLA 90% e Projetos 100%)
 *
 * Três faixas distintas em três meses seguidos é o que torna verificável a
 * afirmação de que cada marcador tem a cor do SEU mês — uma faixa monocromática
 * passaria com o código pintando tudo da mesma cor.
 *
 * O mês entra na faixa pela lista de competências de LANÇAMENTOS, que é o
 * universo de meses do bloco; por isso o terceiro mês atrás também recebe
 * despesa, senão o SLA daquele mês não teria onde aparecer.
 *
 *   DATABASE_PATH=.../verif.sqlite npx tsx src/db/preparar-verificacao-v2.ts
 *   DATABASE_PATH=.../verif.sqlite npx tsx src/db/preparar-comparativo.ts
 *   DATABASE_PATH=.../verif.sqlite npx tsx src/db/preparar-resultados.ts
 *
 * Nunca aponte para `data/gsti.sqlite`: este script escreve.
 */
import { carregarAmbiente } from '../lib/ambiente.js';
carregarAmbiente();
import { db } from './index.js';
import { criarLancamento } from '../domain/financeiro.js';
import { criarTarefa, criarProjeto } from '../domain/projetos.js';
import { registrarTicketSla } from '../domain/sla.js';
import { comEmpresaEmFoco } from '../domain/escopo.js';
import { competenciaAtual, paraExibicao, somarMeses } from '../domain/competencia.js';
import type { Contexto } from '../domain/contexto.js';

const usuario = db().prepare('SELECT id, email FROM usuarios ORDER BY id LIMIT 1')
  .get() as { id: number; email: string };
const empresas = db().prepare('SELECT id, cliente_id FROM empresas ORDER BY id')
  .all() as Array<{ id: number; cliente_id: number }>;
const filiais = db().prepare('SELECT id, empresa_id FROM filiais ORDER BY id')
  .all() as Array<{ id: number; empresa_id: number }>;
const tipo = (db().prepare('SELECT id FROM tipos_despesa ORDER BY id LIMIT 1').get() as { id: number }).id;

const base: Contexto = {
  clienteId: empresas[0]!.cliente_id,
  empresaIds: empresas.map((e) => e.id),
  empresaId: empresas[0]!.id,
  usuarioId: usuario.id,
  usuarioEmail: usuario.email,
  papel: 'gestor',
};
const sede = filiais[0]!;
const ctx = comEmpresaEmFoco(base, sede.empresa_id);

const fila = db()
  .prepare('SELECT id FROM filas_ticket WHERE empresa_id = ? ORDER BY id LIMIT 1')
  .get(sede.empresa_id) as { id: number } | undefined;
if (!fila) throw new Error('Nenhuma fila de chamados na base — rode preparar-verificacao-v2 antes.');

/** Os três meses FECHADOS mais recentes, do mais antigo para o mais novo. */
const meses = [3, 2, 1].map((n) => paraExibicao(somarMeses(competenciaAtual(), -n)));
const [tres, dois, um] = meses as [string, string, string];

// O mês -3 ainda não tem despesa: sem ela ele não entra na lista de
// competências, e o SLA que este script vai lhe dar não teria onde aparecer.
criarLancamento(ctx, {
  filialId: sede.id, tipoDespesaId: tipo, competencia: tres,
  valor: 11500, natureza: 'fixa', classificacao: 'despesa',
  descricao: 'Licença corporativa de antivírus', justificativa: 'base de verificação',
});
criarLancamento(ctx, {
  filialId: sede.id, tipoDespesaId: tipo, competencia: tres,
  valor: 2600, natureza: 'fixa', classificacao: 'despesa',
  descricao: 'Telefonia da sede', justificativa: 'base de verificação',
});

// --- SLA: uma faixa por mês.
const chamados: Array<[string, number, number]> = [
  [tres, 10, 5],
  [dois, 10, 7],
  [um, 10, 9],
];
for (const [competencia, totalAtendidos, dentroSla] of chamados) {
  registrarTicketSla(ctx, {
    filialId: sede.id,
    competencia,
    filaId: fila.id,
    totalAtendidos,
    dentroSla,
    foraSla: totalAtendidos - dentroSla,
    observacoes: 'base de verificação',
  });
}

// --- Projetos: idem, pelo mês de fim PLANEJADO, que é por onde o indicador
// de entrega conta. O projeto é próprio para não misturar com as tarefas que
// a base v2 já criou — elas caem no mês -1 e desequilibrariam a conta dele.
const projeto = criarProjeto(ctx, {
  nome: 'Modernização do parque (base de verificação)',
  filialId: sede.id,
  mesInicio: tres,
  mesFimPlanejado: um,
  status: 'em_andamento',
});
/** [mês planejado, quantas entregues, quantas dentro do prazo] */
const entregas: Array<[string, number, number]> = [
  [tres, 2, 0],
  [dois, 4, 3],
];
for (const [competencia, quantas, noPrazo] of entregas) {
  for (let i = 0; i < quantas; i += 1) {
    criarTarefa(ctx, projeto.id, {
      nome: `Entrega ${competencia} #${i + 1}`,
      mesInicio: tres,
      mesFimPlanejado: competencia,
      // Fora do prazo é entregar DEPOIS do planejado; o mês seguinte basta.
      mesFimReal: i < noPrazo ? competencia : paraExibicao(somarMeses(competenciaAtual(), 0)),
      status: 'concluida',
    });
  }
}

console.log(
  `faixa semeada: ${tres} (SLA 50% · 0/2 no prazo) · ${dois} (SLA 70% · 3/4) · ${um} (SLA 90%)`,
);
