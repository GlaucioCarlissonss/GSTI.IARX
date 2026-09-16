/**
 * Carga FOC de ponta a ponta: arquivo real → conciliação → gravação.
 *
 * O alvo é reproduzir a tabela dinâmica do gestor. Se estes números mudarem, o
 * que o sistema mostra deixou de bater com o que ele fecha no Excel — e é por
 * isso que eles estão escritos aqui em vez de serem lidos do próprio código.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ambienteLimpo } from './apoio.js';
import { db } from '../src/db/index.js';
import { criarEmpresa } from '../src/domain/empresas.js';
import { analisarFoc, importarFoc } from '../src/domain/importacao-foc.js';
import { previaLimpeza, limparLancamentos } from '../src/domain/limpeza.js';
import type { Decisao } from '../src/domain/conciliacao.js';
import type { Contexto } from '../src/domain/contexto.js';

const ARQUIVO = join(import.meta.dirname, '..', '..', 'dados-origem', 'Base_setembro_Rodrigo_15092026H20M10.xlsx');
const semBase = { skip: existsSync(ARQUIVO) ? false : 'base real ausente (dados-origem/ não versionado)' };

const TOTAL_DESPESAS = 8608925; // R$ 86.089,25 — "Vr. Gasto" do anexo
const TOTAL_APROVACAO = 882141; // R$ 8.821,41 — "Pgto de Hoje" do anexo

/** As matrizes que o arquivo cita, todas sob o mesmo cliente. */
function ambienteFoc(): Contexto {
  const { ctx } = ambienteLimpo();
  const ids = [ctx.empresaId];
  for (const nome of ['RESIDENCIAL', 'MILAGRES', 'ALIANÇA', 'UNION']) {
    const e = criarEmpresa(ctx.usuarioId, { nome });
    db().prepare('UPDATE empresas SET cliente_id = ? WHERE id = ?').run(ctx.clienteId, e.id);
    ids.push(e.id);
  }
  return { ...ctx, empresaIds: ids };
}

const arquivo = () => readFileSync(ARQUIVO);

/**
 * O caminho de quem aceita o que o sistema sugeriu: vincula onde há sugestão,
 * cria onde não há. É o fluxo normal da tela, feito em código.
 */
function decidirTudo(blocos: Awaited<ReturnType<typeof analisarFoc>>['blocos']): Decisao[] {
  const decisoes: Decisao[] = [];
  for (const bloco of blocos) {
    for (const item of bloco.itens) {
      if (item.situacao === 'DIVERGENTE' && item.sugestao) {
        decisoes.push({ dimensao: bloco.dimensao, valor: item.valor, acao: 'vincular', alvo: item.sugestao.nome });
      } else if (item.situacao === 'NOVO') {
        decisoes.push({ dimensao: bloco.dimensao, valor: item.valor, acao: 'criar' });
      }
    }
  }
  return decisoes;
}

test('a análise encontra as divergências de centro de custo sem tocar na base', semBase, async () => {
  const ctx = ambienteFoc();
  const analise = await analisarFoc(ctx, arquivo(), 'base.xlsx');

  assert.equal(analise.total_linhas, 110);
  assert.equal(analise.validas, 110);
  assert.equal(analise.invalidas, 0);
  assert.equal(analise.arquivo_ja_importado, false);

  const centro = analise.blocos.find((b) => b.dimensao === 'centro_custo')!;
  const divergentes = centro.itens.filter((i) => i.situacao === 'DIVERGENTE');
  const porValor = new Map(divergentes.map((i) => [i.valor, i.sugestao!.nome]));
  assert.equal(porValor.get('Licencas de Softwares'), 'Licenças de Softwares');
  assert.equal(porValor.get('Telefonia / Internet'), 'Telefonia/Internet');
  assert.equal(porValor.get('Serviços Tecnicos'), 'Serviços Técnicos');
  assert.equal(porValor.get('Locacao de Impressora'), 'Locação de Impressora');
  assert.equal(porValor.get('Serviços de Desencolvimento'), 'Serviços de Desenvolvimento');

  // Analisar não grava: a base continua vazia.
  assert.equal((db().prepare('SELECT COUNT(*) AS n FROM lancamentos').get() as { n: number }).n, 0);
  assert.equal((db().prepare('SELECT COUNT(*) AS n FROM importacoes').get() as { n: number }).n, 0);
});

test('sem decidir as divergências, nada é gravado', semBase, async () => {
  const ctx = ambienteFoc();
  await assert.rejects(() => importarFoc(ctx, arquivo(), { decisoes: [] }), /decis/i);

  assert.equal((db().prepare('SELECT COUNT(*) AS n FROM lancamentos').get() as { n: number }).n, 0);
  // A tentativa recusada deixa rastro — é a carga que falha que se investiga.
  const log = db().prepare('SELECT status, importadas FROM importacoes').get() as { status: string; importadas: number };
  assert.equal(log.status, 'recusada');
  assert.equal(log.importadas, 0);
});

test('com as decisões tomadas, as 110 linhas entram e os totais batem com o anexo', semBase, async () => {
  const ctx = ambienteFoc();
  const analise = await analisarFoc(ctx, arquivo(), 'base.xlsx');
  const resultado = await importarFoc(ctx, arquivo(), { decisoes: decidirTudo(analise.blocos), arquivoNome: 'base.xlsx' });

  assert.equal(resultado.importadas, 110, 'nenhuma linha pode se perder pelo caminho');
  assert.equal(resultado.duplicadas, 0);
  assert.equal(resultado.com_erro, 0);

  const linhas = db()
    .prepare(`SELECT valor_centavos, observacoes FROM lancamentos WHERE excluido_em IS NULL`)
    .all() as Array<{ valor_centavos: number; observacoes: string }>;
  assert.equal(linhas.length, 110);

  const soma = (marca: string) =>
    linhas.filter((l) => l.observacoes.includes(marca)).reduce((s, l) => s + l.valor_centavos, 0);
  assert.equal(soma('FOC_DESPESAS'), TOTAL_DESPESAS);
  assert.equal(soma('FOC_APROVACAO'), TOTAL_APROVACAO);
});

test('a conciliação não duplica o cadastro: os cinco divergentes vão para o que já existia', semBase, async () => {
  const ctx = ambienteFoc();
  const analise = await analisarFoc(ctx, arquivo(), 'base.xlsx');
  await importarFoc(ctx, arquivo(), { decisoes: decidirTudo(analise.blocos) });

  const nomes = (
    db()
      .prepare(`SELECT DISTINCT nome FROM tipos_despesa ORDER BY nome`)
      .all() as Array<{ nome: string }>
  ).map((t) => t.nome);

  for (const errado of ['Licencas de Softwares', 'Telefonia / Internet', 'Serviços Tecnicos', 'Locacao de Impressora', 'Serviços de Desencolvimento']) {
    assert.ok(!nomes.includes(errado), `"${errado}" não podia virar cadastro`);
  }
  assert.ok(nomes.includes('Licenças de Softwares'));
  assert.ok(nomes.includes('Serviços de Desenvolvimento'));
});

test('reimportar o mesmo arquivo não duplica nada', semBase, async () => {
  const ctx = ambienteFoc();
  const analise = await analisarFoc(ctx, arquivo(), 'base.xlsx');
  const decisoes = decidirTudo(analise.blocos);
  await importarFoc(ctx, arquivo(), { decisoes });

  const segunda = await importarFoc(ctx, arquivo(), { decisoes });
  assert.equal(segunda.importadas, 0);
  assert.equal(segunda.duplicadas, 110);
  assert.equal((db().prepare('SELECT COUNT(*) AS n FROM lancamentos WHERE excluido_em IS NULL').get() as { n: number }).n, 110);

  // Na segunda vez o sistema sabe que o arquivo já passou por aqui.
  const denovo = await analisarFoc(ctx, arquivo(), 'base.xlsx');
  assert.equal(denovo.arquivo_ja_importado, true);
});

test('as oito linhas do mesmo fornecedor e data sobrevivem à gravação', semBase, async () => {
  const ctx = ambienteFoc();
  const analise = await analisarFoc(ctx, arquivo(), 'base.xlsx');
  await importarFoc(ctx, arquivo(), { decisoes: decidirTudo(analise.blocos) });

  const n = (
    db()
      .prepare(
        `SELECT COUNT(*) AS n FROM lancamentos
          WHERE data_pagamento = '2026-09-03' AND fornecedor = 'CAIXA ADMINISTRATIVO' AND excluido_em IS NULL`,
      )
      .get() as { n: number }
  ).n;
  assert.equal(n, 8, 'a chave com centro de custo é o que impede o colapso');
});

test('o planejamento é gravado como metadado, fora do valor', semBase, async () => {
  const ctx = ambienteFoc();
  const analise = await analisarFoc(ctx, arquivo(), 'base.xlsx');
  await importarFoc(ctx, arquivo(), { decisoes: decidirTudo(analise.blocos) });

  const comPlano = (
    db()
      .prepare(`SELECT COUNT(*) AS n FROM lancamentos WHERE planejamento IS NOT NULL`)
      .get() as { n: number }
  ).n;
  assert.ok(comPlano > 0, 'meta e projeções precisam ficar guardadas');
  const total = (
    db().prepare(`SELECT SUM(valor_centavos) AS s FROM lancamentos WHERE excluido_em IS NULL`).get() as { s: number }
  ).s;
  assert.equal(total, TOTAL_DESPESAS + TOTAL_APROVACAO, 'planejamento não pode ter entrado no valor');
});

// ------------------------------------------------------------------ limpeza

test('a prévia da limpeza conta sem apagar, e o total exige o nome do cliente', semBase, async () => {
  const ctx = ambienteFoc();
  const analise = await analisarFoc(ctx, arquivo(), 'base.xlsx');
  await importarFoc(ctx, arquivo(), { decisoes: decidirTudo(analise.blocos) });

  const previa = previaLimpeza(ctx, {});
  assert.equal(previa.lancamentos, 110);
  assert.deepEqual(previa.competencias, ['2026-09']);
  assert.ok(previa.confirmacao_exigida, 'a limpeza total pede o nome digitado');
  // A prévia não apaga.
  assert.equal((db().prepare('SELECT COUNT(*) AS n FROM lancamentos WHERE excluido_em IS NULL').get() as { n: number }).n, 110);

  assert.throws(() => limparLancamentos(ctx, { confirmacao: 'nome errado' }), /digite exatamente o nome/i);
  assert.equal((db().prepare('SELECT COUNT(*) AS n FROM lancamentos WHERE excluido_em IS NULL').get() as { n: number }).n, 110);
});

test('limpar por período tira só o período, e não apaga cadastro nenhum', semBase, async () => {
  const ctx = ambienteFoc();
  const analise = await analisarFoc(ctx, arquivo(), 'base.xlsx');
  await importarFoc(ctx, arquivo(), { decisoes: decidirTudo(analise.blocos) });
  const tiposAntes = (db().prepare('SELECT COUNT(*) AS n FROM tipos_despesa').get() as { n: number }).n;
  const filiaisAntes = (db().prepare('SELECT COUNT(*) AS n FROM filiais').get() as { n: number }).n;

  // Um mês que não tem nada: não pode levar nada junto.
  const vazio = limparLancamentos(ctx, { de: '01/2026', ate: '08/2026' });
  assert.equal(vazio.removidos, 0);
  assert.equal((db().prepare('SELECT COUNT(*) AS n FROM lancamentos WHERE excluido_em IS NULL').get() as { n: number }).n, 110);

  const setembro = limparLancamentos(ctx, { de: '09/2026', ate: '09/2026' });
  assert.equal(setembro.removidos, 110);
  assert.equal((db().prepare('SELECT COUNT(*) AS n FROM lancamentos WHERE excluido_em IS NULL').get() as { n: number }).n, 0);

  assert.equal((db().prepare('SELECT COUNT(*) AS n FROM tipos_despesa').get() as { n: number }).n, tiposAntes);
  assert.equal((db().prepare('SELECT COUNT(*) AS n FROM filiais').get() as { n: number }).n, filiaisAntes);
});

test('depois de limpar, o mesmo arquivo pode ser recarregado', semBase, async () => {
  const ctx = ambienteFoc();
  const analise = await analisarFoc(ctx, arquivo(), 'base.xlsx');
  const decisoes = decidirTudo(analise.blocos);
  await importarFoc(ctx, arquivo(), { decisoes });
  limparLancamentos(ctx, { de: '09/2026', ate: '09/2026' });

  // A chave de dedup foi zerada na limpeza: sem isso a base ficaria vazia
  // para sempre, porque o índice único recusaria a recarga.
  const recarga = await importarFoc(ctx, arquivo(), { decisoes });
  assert.equal(recarga.importadas, 110);
  assert.equal(recarga.duplicadas, 0);
});
