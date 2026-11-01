/**
 * O cadastro de metas e o alvo que os indicadores leem.
 *
 * O que se prova aqui: uma base sem nenhuma meta continua funcionando com o
 * mesmo 80 de sempre (é o estado de toda instalação existente); a meta
 * cadastrada substitui esse padrão; a vigência respeita o passado; e a meta de
 * um cliente não atravessa para outro.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, contextoDe, mesRelativo } from './apoio.js';
import { criarEmpresa } from '../src/domain/empresas.js';
import { criarFila } from '../src/domain/cadastros.js';
import { registrarTicketSla } from '../src/domain/sla.js';
import { conformidadeSla, META_SLA } from '../src/domain/indicadores.js';
import { alvoDe, atualizarMeta, criarMeta, leituraDeMeta, listarMetas, metaVigente } from '../src/domain/metas.js';
import { visaoExecutiva } from '../src/domain/dashboards.js';
import { listarAuditoria } from '../src/domain/auditoria.js';

test('sem meta cadastrada, o alvo de SLA é o padrão de sempre', () => {
  const { ctx } = ambienteLimpo();
  assert.equal(listarMetas(ctx).length, 0);
  assert.equal(alvoDe(ctx, 'sla'), 80);
  assert.equal(META_SLA, 80, 'o padrão do módulo não pode ter mudado por acidente');
});

test('a meta cadastrada substitui o padrão no indicador', () => {
  const { ctx } = ambienteLimpo();
  const fila = criarFila(ctx, 'Suporte').id;
  registrarTicketSla(ctx, { filaId: fila, competencia: mesRelativo(0), totalAtendidos: 10, dentroSla: 9 });

  // 90% atinge a meta de 80, e não atinge a de 95: é a mesma leitura contra
  // alvos diferentes, que é exatamente o que o cadastro existe para permitir.
  assert.equal(conformidadeSla(ctx, {}).meta, 80);
  criarMeta(ctx, { nome: 'SLA exigente', modulo: 'sla', alvo_pct: 95 });

  const r = conformidadeSla(ctx, {});
  assert.equal(r.meta, 95);
  assert.equal(r.pct_dentro, 90);
  assert.equal(r.atinge_meta, false);
  assert.equal(r.distancia_meta, -5);
});

test('meta desativada devolve o indicador ao padrão', () => {
  const { ctx } = ambienteLimpo();
  const meta = criarMeta(ctx, { nome: 'SLA exigente', modulo: 'sla', alvo_pct: 95 });
  assert.equal(alvoDe(ctx, 'sla'), 95);
  atualizarMeta(ctx, meta.id, { ativo: false });
  assert.equal(alvoDe(ctx, 'sla'), 80);
});

test('a vigência não deixa a meta de hoje reger o mês de ontem', () => {
  const { ctx } = ambienteLimpo();
  criarMeta(ctx, {
    nome: 'SLA a partir deste mês',
    modulo: 'sla',
    alvo_pct: 95,
    vigencia_inicio: mesRelativo(0),
  });
  assert.equal(alvoDe(ctx, 'sla', mesRelativo(0)), 95, 'no mês da virada, vale a nova');
  assert.equal(alvoDe(ctx, 'sla', mesRelativo(-1)), 80, 'o mês fechado continua lido pelo alvo antigo');
});

test('entre duas metas vigentes ganha a de início mais recente', () => {
  const { ctx } = ambienteLimpo();
  criarMeta(ctx, { nome: 'SLA base', modulo: 'sla', alvo_pct: 85 });
  criarMeta(ctx, { nome: 'SLA revisado', modulo: 'sla', alvo_pct: 92, vigencia_inicio: mesRelativo(-1) });
  assert.equal(alvoDe(ctx, 'sla', mesRelativo(0)), 92);
  // A meta sem início ("desde sempre") é o alvo genérico: só vale onde nenhum
  // específico alcança.
  assert.equal(alvoDe(ctx, 'sla', mesRelativo(-6)), 85);
});

test('a meta de um cliente não atravessa para outro', () => {
  const { ctx } = ambienteLimpo();
  criarMeta(ctx, { nome: 'SLA exigente', modulo: 'sla', alvo_pct: 95 });
  const outra = criarEmpresa(ctx.usuarioId, { nome: 'Outra contratante' });
  const deFora = contextoDe(ctx, outra.id);

  assert.equal(listarMetas(deFora).length, 0);
  assert.equal(alvoDe(deFora, 'sla'), 80, 'o outro cliente continua no padrão');
  assert.equal(metaVigente(deFora, 'sla'), null);
});

test('cada módulo lê a própria meta', () => {
  const { ctx } = ambienteLimpo();
  criarMeta(ctx, { nome: 'SLA exigente', modulo: 'sla', alvo_pct: 95 });
  assert.equal(alvoDe(ctx, 'sla'), 95);
  assert.equal(alvoDe(ctx, 'projetos'), 80, 'projetos não herda a meta do SLA');
  assert.equal(alvoDe(ctx, 'equilibrio'), null, 'sem padrão e sem cadastro, não há alvo');
});

test('nome repetido, módulo inválido e alvo fora da escala são recusados', () => {
  const { ctx } = ambienteLimpo();
  criarMeta(ctx, { nome: 'SLA exigente', modulo: 'sla', alvo_pct: 95 });
  assert.throws(() => criarMeta(ctx, { nome: 'SLA exigente', modulo: 'sla', alvo_pct: 90 }), /já existe/i);
  assert.throws(() => criarMeta(ctx, { nome: 'Outra', modulo: 'chutes', alvo_pct: 90 }), /Módulo/i);
  assert.throws(() => criarMeta(ctx, { nome: 'Outra', modulo: 'sla', alvo_pct: 140 }), /percentual/i);
  assert.throws(() => criarMeta(ctx, { nome: '', modulo: 'sla', alvo_pct: 90 }), /obrigatório/i);
  assert.throws(
    () => criarMeta(ctx, { nome: 'Invertida', modulo: 'sla', alvo_pct: 90, vigencia_inicio: '06/2026', vigencia_fim: '01/2026' }),
    /anterior/i,
  );
});

test('criar e alterar uma meta deixa trilha', () => {
  const { ctx } = ambienteLimpo();
  const meta = criarMeta(ctx, { nome: 'SLA exigente', modulo: 'sla', alvo_pct: 95 });
  atualizarMeta(ctx, meta.id, { alvo_pct: 90 });
  const trilha = listarAuditoria(ctx, { entidade: 'meta' });
  assert.equal(trilha.length, 2);
  assert.deepEqual(
    trilha.map((t) => t.acao).sort(),
    ['atualizar', 'criar'],
  );
});

// ------------------------------------------------- Meta vs Resultado (2.4)

test('o painel executivo devolve a meta ao lado do resultado de cada bloco', () => {
  const { ctx } = ambienteLimpo();
  const fila = criarFila(ctx, 'Suporte').id;
  registrarTicketSla(ctx, { filaId: fila, competencia: mesRelativo(0), totalAtendidos: 10, dentroSla: 9 });

  const v = visaoExecutiva(ctx, {});
  assert.equal(v.sla.meta?.alvo, 80, 'sem cadastro, o padrão de sempre');
  assert.equal(v.sla.meta?.atingido, 90);
  assert.equal(v.sla.meta?.atinge, true);
  assert.equal(v.sla.meta?.direcao, 'minimo');

  criarMeta(ctx, { nome: 'SLA exigente', modulo: 'sla', alvo_pct: 95 });
  const depois = visaoExecutiva(ctx, {});
  assert.equal(depois.sla.meta?.alvo, 95);
  assert.equal(depois.sla.meta?.atinge, false);
  assert.equal(depois.sla.meta?.distancia, -5, 'a distância é negativa quando falta chegar lá');
});

test('sem resultado no período, a meta existe mas não finge atingimento', () => {
  const { ctx } = ambienteLimpo();
  const v = visaoExecutiva(ctx, {});
  assert.equal(v.sla.meta?.alvo, 80);
  assert.equal(v.sla.meta?.atingido, null, 'nenhum chamado não é 0% de conformidade');
  assert.equal(v.sla.meta?.atinge, false);
});

test('a meta de custo é TETO, e a de SLA é PISO', () => {
  const { ctx } = ambienteLimpo();
  // Variação de 10% contra um teto de 5% NÃO atinge, mesmo sendo o maior número.
  assert.equal(leituraDeMeta(5, 10, 'financeiro')?.atinge, false);
  assert.equal(leituraDeMeta(5, 3, 'financeiro')?.atinge, true);
  // No SLA a leitura é a oposta.
  assert.equal(leituraDeMeta(80, 90, 'sla')?.atinge, true);
  assert.equal(leituraDeMeta(80, 70, 'sla')?.atinge, false);
  assert.equal(leituraDeMeta(null, 90, 'sla'), null, 'sem alvo, não há comparação a mostrar');
  assert.ok(ctx);
});
