/**
 * A carga de Contas a Pagar de ponta a ponta: arquivo → decisões → base.
 *
 * O que se prova aqui é o que separa esta carga de um `INSERT` em massa: nada
 * entra antes de as dimensões estarem decididas; o que a base já tem não entra
 * de novo; o vínculo decidido uma vez não é perguntado outra; quem a lista de
 * reconhecimento alcança já nasce conferido; e mês fechado recusa o lote
 * inteiro em vez de escrever por cima de número já auditado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ambienteLimpo } from './apoio.js';
import { db } from '../src/db/index.js';
import { listarLancamentos, reconhecerLancamentos } from '../src/domain/financeiro.js';
import { fecharCompetencia } from '../src/domain/fechamento.js';
import { criarReconhecedor } from '../src/domain/reconhecedores.js';
import { criarFilial } from '../src/domain/cadastros.js';
import { analisarContasPagar, importarContasPagar } from '../src/domain/importacao-contas-pagar.js';
import type { BlocoConciliacao, Decisao } from '../src/domain/conciliacao.js';
import type { Contexto } from '../src/domain/contexto.js';

const ARQUIVO = readFileSync(fileURLToPath(new URL('./dados/contas-pagar-exemplo.csv', import.meta.url)));

/** Decide "criar" em tudo o que estiver pendente — o caso da primeira carga. */
function criarTudo(blocos: BlocoConciliacao[]): Decisao[] {
  return blocos.flatMap((b) =>
    b.itens
      .filter((i) => i.situacao === 'NOVO' || i.situacao === 'DIVERGENTE')
      .map((i): Decisao => ({ dimensao: b.dimensao, valor: i.valor, acao: 'criar' })),
  );
}

function cargaCompleta(ctx: Contexto) {
  const previa = analisarContasPagar(ctx, ARQUIVO, { arquivoNome: 'contas-pagar.csv' });
  return importarContasPagar(ctx, ARQUIVO, {
    decisoes: criarTudo(previa.blocos),
    arquivoNome: 'contas-pagar.csv',
  });
}

test('arquivo que não é este layout é recusado dizendo o que falta', () => {
  const { ctx } = ambienteLimpo();
  const outro = Buffer.from('Unidade;Valor;Centro de Custo\nMatriz;10,00;TI\n', 'latin1');
  assert.throws(() => analisarContasPagar(ctx, outro), /IDPAYDOCBILL/);
});

test('a análise pede decisão para cada unidade e centro de custo desconhecidos', () => {
  const { ctx } = ambienteLimpo();
  const analise = analisarContasPagar(ctx, ARQUIVO, { arquivoNome: 'contas-pagar.csv' });

  assert.equal(analise.validas, 13);
  assert.equal(analise.realinhadas, 13, 'o aviso de arquivo torto chega à tela');
  const unidades = analise.blocos.find((b) => b.dimensao === 'unidade')!;
  assert.deepEqual(
    unidades.itens.map((i) => i.valor).sort(),
    ['CLÍNICA AURORA - SP', 'HOSPITAL BOA VISTA - RN', 'UNIDADE LITORAL'],
  );
  assert.equal(unidades.pendentes, 3, 'nenhuma delas existe no cadastro ainda');
  assert.ok(analise.pendentes > 0);
});

test('enquanto houver decisão pendente, a conciliação de lançamentos não é feita', () => {
  const { ctx } = ambienteLimpo();
  const analise = analisarContasPagar(ctx, ARQUIVO);
  assert.equal(analise.lancamentos, null, 'sem filial e centro resolvidos não há onde procurar');
});

test('a carga não grava nada com decisão pendente, e deixa a recusa no histórico', () => {
  const { ctx } = ambienteLimpo();
  assert.throws(() => importarContasPagar(ctx, ARQUIVO, { decisoes: [] }), /pendente\(s\)/);
  assert.equal(listarLancamentos(ctx, {}).itens.length, 0);
  const recusa = db().prepare("SELECT COUNT(*) AS n FROM importacoes WHERE status = 'recusada'").get() as {
    n: number;
  };
  assert.equal(recusa.n, 1);
});

test('decididas as dimensões, cada linha válida vira um lançamento', () => {
  const { ctx } = ambienteLimpo();
  const r = cargaCompleta(ctx);

  assert.equal(r.importadas, 13);
  assert.equal(r.duplicadas, 0);
  assert.equal(r.com_erro, 3, 'as três linhas recusadas seguem contadas');
  assert.deepEqual(r.cadastros_criados.filiais.sort(), [
    'CLÍNICA AURORA - SP',
    'HOSPITAL BOA VISTA - RN',
    'UNIDADE LITORAL',
  ]);

  const itens = listarLancamentos(ctx, {}).itens;
  assert.equal(itens.length, 13);
  const moveis = itens.filter((l) => l.descricao === 'Linha móvel corporativa');
  assert.equal(moveis.length, 5, 'cinco cobranças do mesmo valor continuam cinco');
  assert.equal(new Set(moveis.map((l) => l.documento)).size, 5);
});

test('reimportar o mesmo arquivo não duplica a base', () => {
  const { ctx } = ambienteLimpo();
  cargaCompleta(ctx);
  const segunda = cargaCompleta(ctx);

  assert.equal(segunda.importadas, 0, 'nada de novo');
  assert.equal(segunda.duplicadas, 13);
  assert.equal(listarLancamentos(ctx, {}).itens.length, 13);
});

test('a conciliação reconhece o que a base já tem, mesmo sem o número do documento', () => {
  const { ctx } = ambienteLimpo();
  cargaCompleta(ctx);
  // Apaga o documento de todos, que é o estado real da base do cliente: 1.898
  // lançamentos e nenhum número de documento.
  db().prepare('UPDATE lancamentos SET documento = NULL').run();

  const analise = analisarContasPagar(ctx, ARQUIVO);
  assert.equal(analise.pendentes, 0, 'os cadastros já existem depois da primeira carga');
  assert.equal(analise.lancamentos!.novo, 0, 'importar de novo duplicaria a base');
  assert.equal(analise.lancamentos!.atualiza, 13, 'o que falta é só o número do documento');
  assert.ok(analise.lancamentos!.pareados_por_ordem > 0);

  importarContasPagar(ctx, ARQUIVO, { decisoes: [] });
  const semDocumento = db()
    .prepare("SELECT COUNT(*) AS n FROM lancamentos WHERE documento IS NULL OR documento = ''")
    .get() as { n: number };
  assert.equal(semDocumento.n, 0, 'a carga devolve o documento a quem já estava lá');
});

test('o cadastro de quem reconhece marca a despesa já na entrada', () => {
  const { ctx } = ambienteLimpo();
  criarReconhecedor(ctx, { usuario_origem: 'MIQUEIASSILVA' });
  criarReconhecedor(ctx, { usuario_origem: 'KAUAROCHA' });

  const r = cargaCompleta(ctx);
  assert.equal(r.reconhecidos, 3, 'duas linhas de MIQUEIASSILVA e uma de KAUAROCHA');

  const itens = listarLancamentos(ctx, {}).itens;
  const doTime = itens.filter((l) => l.reconhecido);
  assert.equal(doTime.length, 3);
  assert.ok(
    itens.some((l) => l.descricao === 'Manutenção preventiva de rack' && !l.reconhecido),
    'quem não está na lista continua por reconhecer',
  );
});

test('o vínculo decidido fica guardado, e a carga seguinte não pergunta de novo', () => {
  const { ctx } = ambienteLimpo();
  criarFilial(ctx, { nome: 'HR RN' });

  const primeira = analisarContasPagar(ctx, ARQUIVO);
  const decisoes = criarTudo(primeira.blocos).map((d) =>
    d.dimensao === 'unidade' && d.valor === 'HOSPITAL BOA VISTA - RN'
      ? ({ ...d, acao: 'vincular', alvo: 'HR RN' } as Decisao)
      : d,
  );
  const r = importarContasPagar(ctx, ARQUIVO, { decisoes });
  assert.equal(r.vinculos_guardados, 1);
  assert.ok(!r.cadastros_criados.filiais.includes('HOSPITAL BOA VISTA - RN'), 'foi para a filial existente');

  const segunda = analisarContasPagar(ctx, ARQUIVO);
  assert.deepEqual(segunda.vinculos_aplicados, [
    { dimensao: 'unidade', valor: 'HOSPITAL BOA VISTA - RN', alvo: 'HR RN' },
  ]);
  assert.equal(segunda.pendentes, 0, 'ninguém precisa decidir a mesma coisa duas vezes');
});

test('competência fechada recusa a carga inteira, sem gravar meia carga', () => {
  const { ctx } = ambienteLimpo();
  fecharCompetencia(ctx, '2026-03', 'mês conferido');

  const previa = analisarContasPagar(ctx, ARQUIVO);
  assert.throws(
    () => importarContasPagar(ctx, ARQUIVO, { decisoes: criarTudo(previa.blocos) }),
    /03\/2026/,
  );
  assert.equal(listarLancamentos(ctx, {}).itens.length, 0, 'nem as competências abertas entraram');
});

test('a carga fica no histórico de importações, com o que atingiu', () => {
  const { ctx } = ambienteLimpo();
  const r = cargaCompleta(ctx);

  const linha = db()
    .prepare('SELECT modulo, status, template_versao, arquivo_nome, importadas, com_erro FROM importacoes WHERE id = ?')
    .get(r.importacao_id) as Record<string, unknown>;
  assert.equal(linha.status, 'concluida');
  assert.equal(linha.modulo, 'financeiro');
  assert.equal(linha.template_versao, 'contas-pagar-1');
  assert.equal(linha.arquivo_nome, 'contas-pagar.csv');
  assert.equal(linha.importadas, 13);
  assert.equal(linha.com_erro, 3);
});

test('o lançamento carrega o documento e o criador da origem até a tela', () => {
  const { ctx } = ambienteLimpo();
  criarReconhecedor(ctx, { usuario_origem: 'MIQUEIASSILVA' });
  cargaCompleta(ctx);

  const itens = listarLancamentos(ctx, {}).itens as unknown as Array<Record<string, unknown>>;
  const link = itens.find((l) => l.descricao === 'Link dedicado de internet — janeiro')!;
  // Sem estes três campos na resposta, a tela não tem como mostrar o número do
  // documento nem explicar por que a despesa já está reconhecida — foi
  // exatamente o que faltou na primeira entrega.
  assert.equal(link.documento, '550120');
  assert.equal(link.usuario_origem, 'MIQUEIASSILVA');
  assert.equal(link.reconhecido, true);
  assert.equal(link.reconhecido_via, 'cadastro_origem', 'quem decidiu foi o cadastro, não uma pessoa');

  const deFora = itens.find((l) => l.descricao === 'Manutenção preventiva de rack')!;
  assert.equal(deFora.reconhecido, false);
  assert.equal(deFora.reconhecido_via, null);
});

test('o reconhecimento pela carga não é creditado a quem rodou a carga', () => {
  const { ctx } = ambienteLimpo();
  criarReconhecedor(ctx, { usuario_origem: 'MIQUEIASSILVA' });
  cargaCompleta(ctx);

  // `reconhecido_por` apontando para o gestor faria a tela dizer que ELE
  // conferiu seiscentos lançamentos, quando ninguém conferiu nenhum.
  const creditados = db()
    .prepare("SELECT COUNT(*) AS n FROM lancamentos WHERE reconhecido = 1 AND reconhecido_por IS NOT NULL")
    .get() as { n: number };
  assert.equal(creditados.n, 0);
});

test('conferir na tela e reconhecer pela carga ficam distinguíveis', () => {
  const { ctx } = ambienteLimpo();
  cargaCompleta(ctx);

  const alvo = listarLancamentos(ctx, {}).itens[0]!;
  reconhecerLancamentos(ctx, [alvo.id], true, 'conferido na tela');

  const linha = db()
    .prepare('SELECT reconhecido_via, reconhecido_por FROM lancamentos WHERE id = ?')
    .get(alvo.id) as { reconhecido_via: string; reconhecido_por: number | null };
  assert.equal(linha.reconhecido_via, 'manual');
  assert.equal(linha.reconhecido_por, ctx.usuarioId, 'aqui alguém olhou, e fica registrado quem');
});

test('leitor não é gestor: a carga é recusada antes de tocar no arquivo', () => {
  const { ctx } = ambienteLimpo();
  assert.throws(
    () => importarContasPagar({ ...ctx, papel: 'leitor' }, ARQUIVO, { decisoes: [] }),
    /Apenas gestores/,
  );
});
