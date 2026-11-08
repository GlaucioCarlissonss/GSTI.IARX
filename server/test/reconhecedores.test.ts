/**
 * O cadastro de quem reconhece despesa, e o alcance dele sobre o passado.
 *
 * O que se prova aqui: o mesmo nome escrito de formas diferentes é a mesma
 * pessoa; desativar alguém não apaga o que já entrou; a prévia não grava;
 * aplicar marca só quem o cadastro alcança, e conta à parte o que não tem
 * origem registrada; e nada disso atravessa de um cliente para outro.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, contextoDe, idTipoDespesa, mesRelativo } from './apoio.js';
import { CLIENTE_HISTORICO, db, migrar, RECONHECEDORES_INICIAIS } from '../src/db/index.js';
import { criarEmpresa } from '../src/domain/empresas.js';
import { criarLancamento, listarLancamentos } from '../src/domain/financeiro.js';
import { listarAuditoria } from '../src/domain/auditoria.js';
import {
  aplicarReconhecimento,
  atualizarReconhecedor,
  chaveDoUsuario,
  criarReconhecedor,
  listarReconhecedores,
  previaReconhecimento,
  reconhecePorOrigem,
} from '../src/domain/reconhecedores.js';
import type { Contexto } from '../src/domain/contexto.js';

// Mês corrente: competência passada exigiria justificativa em cada criação, e
// o que esta suíte prova não tem nada a ver com o porteiro de fechamento.
const COMP = mesRelativo(0);
const INTERNA = COMP.slice(3) + '-' + COMP.slice(0, 2);

/** Um lançamento com o criador da origem gravado, como a carga o deixa. */
function lancamentoDaCarga(ctx: Contexto, usuarioOrigem: string | null, descricao = 'Licença') {
  const criado = criarLancamento(ctx, {
    tipoDespesaId: idTipoDespesa(ctx),
    competencia: COMP,
    valor: 100,
    natureza: 'fixa',
    classificacao: 'despesa',
    descricao,
  });
  db().prepare('UPDATE lancamentos SET usuario_origem = ? WHERE id = ?').run(usuarioOrigem, criado.id);
  return criado.id;
}

test('o mesmo nome escrito de outro jeito é a mesma pessoa', () => {
  const { ctx } = ambienteLimpo();
  criarReconhecedor(ctx, { usuario_origem: 'MIQUEIASSILVA' });

  assert.equal(chaveDoUsuario('Miqueias Silva'), 'MIQUEIASSILVA');
  // O ERP escreve tudo junto e em caixa alta; a pessoa cadastra com espaço.
  assert.throws(() => criarReconhecedor(ctx, { usuario_origem: 'Miqueias Silva' }), /mesmo usuário/i);
  assert.equal(listarReconhecedores(ctx).length, 1);
});

test('o cadastro responde pela carga, e só enquanto está ativo', () => {
  const { ctx } = ambienteLimpo();
  const r = criarReconhecedor(ctx, { usuario_origem: 'KAUAROCHA', nome_exibicao: 'Kauã Rocha' });
  assert.equal(reconhecePorOrigem(ctx.clienteId!, 'KAUAROCHA'), true);
  assert.equal(reconhecePorOrigem(ctx.clienteId!, 'kaua rocha'), true, 'a comparação é normalizada');
  assert.equal(reconhecePorOrigem(ctx.clienteId!, 'JOSEBARBOSA'), false);

  atualizarReconhecedor(ctx, r.id, { ativo: false });
  assert.equal(reconhecePorOrigem(ctx.clienteId!, 'KAUAROCHA'), false, 'quem saiu do time para de reconhecer');
  assert.equal(listarReconhecedores(ctx, true).length, 1, 'mas continua no cadastro, para o histórico');
});

test('usuário em branco é recusado', () => {
  const { ctx } = ambienteLimpo();
  assert.throws(() => criarReconhecedor(ctx, { usuario_origem: '  ' }), /Informe o usuário/i);
});

test('a prévia conta o que mudaria e não grava', () => {
  const { ctx } = ambienteLimpo();
  lancamentoDaCarga(ctx, 'MIQUEIASSILVA');
  criarReconhecedor(ctx, { usuario_origem: 'MIQUEIASSILVA' });

  const previa = previaReconhecimento(ctx);
  assert.equal(previa.avaliados, 1);
  assert.equal(previa.reconhecidos, 1);
  assert.equal(listarLancamentos(ctx, {}).itens[0]!.reconhecido, false, 'nada foi gravado');
});

test('aplicar marca quem o cadastro alcança, e só ele', () => {
  const { ctx } = ambienteLimpo();
  const doTime = lancamentoDaCarga(ctx, 'MIQUEIASSILVA', 'Do time');
  const deFora = lancamentoDaCarga(ctx, 'JOSEBARBOSA', 'De fora');
  const semOrigem = lancamentoDaCarga(ctx, null, 'Sem origem');
  criarReconhecedor(ctx, { usuario_origem: 'MIQUEIASSILVA' });

  const resumo = aplicarReconhecimento(ctx, {}, 'Equipe de TI confere na origem');
  assert.equal(resumo.avaliados, 3);
  assert.equal(resumo.reconhecidos, 1);
  assert.equal(resumo.fora_do_cadastro, 1);
  assert.equal(resumo.sem_usuario_origem, 1);

  const porId = new Map(listarLancamentos(ctx, {}).itens.map((l) => [l.id, l.reconhecido]));
  assert.equal(porId.get(doTime), true);
  assert.equal(porId.get(deFora), false);
  assert.equal(porId.get(semOrigem), false);
});

test('aplicar duas vezes não conta a mesma coisa de novo', () => {
  const { ctx } = ambienteLimpo();
  lancamentoDaCarga(ctx, 'KAUAROCHA');
  criarReconhecedor(ctx, { usuario_origem: 'KAUAROCHA' });
  aplicarReconhecimento(ctx, {}, 'primeira');

  const segunda = aplicarReconhecimento(ctx, {}, 'segunda');
  assert.equal(segunda.reconhecidos, 0);
  assert.equal(segunda.ja_reconhecidos, 1);
});

test('o recorte de competência limita o alcance', () => {
  const { ctx } = ambienteLimpo();
  const doMes = lancamentoDaCarga(ctx, 'KAUAROCHA', 'Deste mês');
  criarReconhecedor(ctx, { usuario_origem: 'KAUAROCHA' });

  // O recorte começa no ano seguinte; o lançamento deste mês fica de fora.
  const depoisDeTudo = `${Number(INTERNA.slice(0, 4)) + 1}-01`;
  const resumo = aplicarReconhecimento(ctx, { de: depoisDeTudo }, 'só do ano que vem');
  assert.equal(resumo.avaliados, 0);
  assert.equal(listarLancamentos(ctx, {}).itens.find((l) => l.id === doMes)!.reconhecido, false);
});

test('a aplicação deixa uma linha de trilha com os números', () => {
  const { ctx } = ambienteLimpo();
  lancamentoDaCarga(ctx, 'KAUAROCHA');
  criarReconhecedor(ctx, { usuario_origem: 'KAUAROCHA' });
  aplicarReconhecimento(ctx, {}, 'Equipe de TI confere na origem');

  const trilha = listarAuditoria(ctx, { entidade: 'reconhecedor_origem' }).filter((a) => a.acao === 'aplicar');
  assert.equal(trilha.length, 1);
  const depois = trilha[0]!.dados_depois as Record<string, unknown>;
  assert.equal(depois.reconhecidos, 1);
  assert.equal(trilha[0]!.justificativa, 'Equipe de TI confere na origem');
});

test('o cadastro de um cliente não reconhece a despesa de outro', () => {
  const { ctx } = ambienteLimpo();
  criarReconhecedor(ctx, { usuario_origem: 'MIQUEIASSILVA' });

  const outra = criarEmpresa(ctx.usuarioId, { nome: 'Outra contratante' });
  const deFora = contextoDe(ctx, outra.id);
  assert.equal(reconhecePorOrigem(deFora.clienteId!, 'MIQUEIASSILVA'), false);
  assert.equal(listarReconhecedores(deFora).length, 0);
});

// ===========================================================================
// A lista com que o cadastro nasce
// ===========================================================================
//
// Semear é conveniência, e conveniência que apaga decisão é defeito. O que
// estas provas guardam é a diferença entre as duas.

test('a equipe de TI já nasce na lista do cliente histórico', () => {
  ambienteLimpo();
  const conn = db();
  conn.prepare('INSERT INTO clientes (nome) VALUES (?)').run(CLIENTE_HISTORICO);
  migrar(conn as never);

  const nomes = (
    conn
      .prepare(
        `SELECT r.chave FROM reconhecedores_origem r
           JOIN clientes c ON c.id = r.cliente_id
          WHERE c.nome = ? AND r.ativo = 1 ORDER BY r.chave`,
      )
      .all(CLIENTE_HISTORICO) as Array<{ chave: string }>
  ).map((l) => l.chave);

  assert.deepEqual(nomes, [...RECONHECEDORES_INICIAIS].map(chaveDoUsuario).sort());
});

test('semear roda a cada abertura do banco e não duplica', () => {
  ambienteLimpo();
  const conn = db();
  conn.prepare('INSERT INTO clientes (nome) VALUES (?)').run(CLIENTE_HISTORICO);

  migrar(conn as never);
  migrar(conn as never);
  migrar(conn as never);

  const { n } = conn.prepare('SELECT COUNT(*) AS n FROM reconhecedores_origem').get() as { n: number };
  assert.equal(n, RECONHECEDORES_INICIAIS.length);
});

test('quem foi desativado NÃO volta ativo na próxima abertura do banco', () => {
  ambienteLimpo();
  const conn = db();
  conn.prepare('INSERT INTO clientes (nome) VALUES (?)').run(CLIENTE_HISTORICO);
  migrar(conn as never);

  // É o estrago que o `INSERT OR IGNORE` existe para evitar: quem saiu do time
  // voltaria a reconhecer sozinho, e ninguém perceberia.
  conn.prepare("UPDATE reconhecedores_origem SET ativo = 0 WHERE chave = 'KAUAROCHA'").run();
  migrar(conn as never);

  const linha = conn
    .prepare("SELECT ativo FROM reconhecedores_origem WHERE chave = 'KAUAROCHA'")
    .get() as { ativo: number };
  assert.equal(linha.ativo, 0);
});

test('a lista é de UM contratante: o cliente vizinho começa vazio', () => {
  ambienteLimpo();
  const conn = db();
  conn.prepare('INSERT INTO clientes (nome) VALUES (?)').run(CLIENTE_HISTORICO);
  conn.prepare('INSERT INTO clientes (nome) VALUES (?)').run('Limas IT');
  migrar(conn as never);

  const { n } = conn
    .prepare(
      `SELECT COUNT(*) AS n FROM reconhecedores_origem r
         JOIN clientes c ON c.id = r.cliente_id WHERE c.nome = ?`,
    )
    .get('Limas IT') as { n: number };
  assert.equal(n, 0, 'a equipe de um cliente não reconhece despesa de outro');
});

test('sem o cliente histórico na base, semear não inventa contratante', () => {
  const { ctx } = ambienteLimpo();
  const conn = db();
  migrar(conn as never);

  const { n } = conn.prepare('SELECT COUNT(*) AS n FROM clientes WHERE nome = ?').get(CLIENTE_HISTORICO) as {
    n: number;
  };
  assert.equal(n, 0);
  assert.equal(listarReconhecedores(ctx, true).length, 0);
});
