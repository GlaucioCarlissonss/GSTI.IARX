/**
 * Base isolada para conferir, no navegador, o DETALHAMENTO COMPARATIVO.
 *
 * `preparar-verificacao-v2.ts` monta o cliente de duas matrizes, mas todos os
 * lançamentos dele caem no mês corrente — e um detalhamento que compara dois
 * meses não teria o que comparar. Este script roda sobre aquela base e
 * acrescenta o MÊS ANTERIOR: parte das despesas se repete (é o que a camada 3
 * chamará de "veio"), parte cessa, e parte só aparece agora.
 *
 *   DATABASE_PATH=.../verif.sqlite npx tsx src/db/preparar-verificacao-v2.ts
 *   DATABASE_PATH=.../verif.sqlite npx tsx src/db/preparar-comparativo.ts
 *
 * Nunca aponte para `data/gsti.sqlite`: este script escreve.
 */
import { carregarAmbiente } from '../lib/ambiente.js';
carregarAmbiente();
import { db } from './index.js';
import { criarLancamento } from '../domain/financeiro.js';
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

const anterior = paraExibicao(somarMeses(competenciaAtual(), -1));

// Repetidas: mesmo fornecedor, mesmo tipo, mesma filial — é o par que a
// camada 3 vai reconhecer como "veio" quando a entrega 3 chegar.
criarLancamento(ctx, { filialId: sede.id, tipoDespesaId: tipo, competencia: anterior,
  valor: 11500, natureza: 'fixa', classificacao: 'despesa',
  descricao: 'Licença corporativa de antivírus', justificativa: 'base de verificação' });
criarLancamento(ctx, { filialId: sede.id, tipoDespesaId: tipo, competencia: anterior,
  valor: 3000, natureza: 'fixa', classificacao: 'despesa', descricao: 'Telefonia da sede', justificativa: 'base de verificação' });
// Cessada: existe no mês anterior e não no filtrado.
criarLancamento(ctx, { filialId: sede.id, tipoDespesaId: tipo, competencia: anterior,
  valor: 4200, natureza: 'pontual_unica', classificacao: 'despesa',
  descricao: 'Consultoria de migração (encerrada)', justificativa: 'base de verificação' });

// A SEGUNDA MATRIZ, nos dois meses. Sem ela a hierarquia Empresa → Filial
// tem um galho só, e uma árvore de um galho não prova ordenação, nem subtotal
// por unidade, nem que fechar uma empresa recolhe as filiais dela.
const mes = paraExibicao(competenciaAtual());
const outra = filiais.find((f) => f.empresa_id !== sede.empresa_id);
// O tipo de despesa é POR EMPRESA: o da sede não vale para a outra matriz.
const tipo2 = outra && (db()
  .prepare('SELECT id FROM tipos_despesa WHERE empresa_id = ? ORDER BY id LIMIT 1')
  .get(outra.empresa_id) as { id: number } | undefined)?.id;
if (outra && tipo2) {
  const ctx2 = comEmpresaEmFoco(base, outra.empresa_id);
  // Mais barata que a sede: a ordem decrescente entre as duas é verificável.
  criarLancamento(ctx2, { filialId: outra.id, tipoDespesaId: tipo2, competencia: mes,
    valor: 5400, natureza: 'fixa', classificacao: 'despesa', descricao: 'Enlace da unidade' });
  criarLancamento(ctx2, { filialId: outra.id, tipoDespesaId: tipo2, competencia: mes,
    valor: 1800, natureza: 'fixa', classificacao: 'despesa', descricao: 'Suporte de impressão' });
  criarLancamento(ctx2, { filialId: outra.id, tipoDespesaId: tipo2, competencia: anterior,
    valor: 5400, natureza: 'fixa', classificacao: 'despesa', descricao: 'Enlace da unidade',
    justificativa: 'base de verificação' });
  console.log(`segunda matriz semeada: ${mes} (2) e ${anterior} (1)`);
}

console.log(`mês anterior semeado: ${anterior} — 3 lançamento(s)`);
