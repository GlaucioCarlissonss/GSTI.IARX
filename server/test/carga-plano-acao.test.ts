/**
 * A CARGA DO PLANO DE AÇÃO.
 *
 * O arquivo de verdade do cliente NÃO entra aqui: ele traz nomes de
 * funcionários e o cronograma comercial, e um teste não é lugar para isso. As
 * planilhas destas conferências são montadas na hora, com nomes inventados, e
 * reproduzem o LAYOUT — que é o que a carga precisa aguentar: o cabeçalho
 * algumas linhas abaixo do topo, a linha de go-live acima dele, o número da
 * onda no nome da aba.
 *
 * O que se exige da carga é que ela NÃO INVENTE. Campo vazio fica vazio e é
 * contado; status desconhecido não vira um balde novo; go-live divergente do
 * cronograma é denunciado em vez de sobrescrever o cronograma. Uma carga
 * silenciosa é pior que uma recusa: ela entrega um plano plausível e errado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  PLANO_CABECALHO, chaveDeNome, dataISO, lerPlanoDeAcao, linhaDoCabecalho, numeroDaOnda,
} from '../src/domain/carga-plano-acao.js';

type Linha = Array<string | number | null>;

/**
 * Monta um arquivo com o layout do plano: título, go-live, cabeçalho e ações.
 *
 * `antesDoCabecalho` permite empurrar o cabeçalho para baixo — é como se
 * confere que a carga o PROCURA em vez de contar linhas.
 */
async function arquivo(abas: Array<{
  nome: string; goLive?: string; acoes: Linha[]; antesDoCabecalho?: number;
}>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const a of abas) {
    const ws = wb.addWorksheet(a.nome);
    ws.addRow([`${a.nome} • Go-live: ${a.goLive ?? '01/10/2026'} • Unidades: Unidade Alfa, Unidade Beta`]);
    for (let i = 0; i < (a.antesDoCabecalho ?? 1); i += 1) ws.addRow(['']);
    ws.addRow(PLANO_CABECALHO);
    for (const linha of a.acoes) ws.addRow(linha as never[]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Uma linha de ação no layout do arquivo. */
const linha = (n: number, p: Partial<{
  tarefa: string; area: string; lider: string; inicio: string; fim: string;
  dias: string; status: string;
}> = {}): Linha => [
  n, p.tarefa ?? `Ação ${n}`, p.area ?? 'Infraestrutura', p.lider ?? 'Equipe Alfa',
  p.inicio ?? '01/09/2026', p.fim ?? '30/09/2026', p.dias ?? '29', p.status ?? 'Não iniciado',
];

// ------------------------------------------------------------------ pedaços

test('o número da onda sai do nome da aba, e só dele', () => {
  assert.equal(numeroDaOnda('Onda 3'), 3);
  assert.equal(numeroDaOnda('  ONDA  12 '), 12);
  assert.equal(numeroDaOnda('Dashboard'), null);
  assert.equal(numeroDaOnda('Onda piloto'), null);
});

test('as datas entram em qualquer das três formas do arquivo', () => {
  assert.equal(dataISO('01/10/2026'), '2026-10-01', 'texto brasileiro');
  assert.equal(dataISO('2026-10-01'), '2026-10-01', 'ISO, como o leitor já devolve');
  assert.equal(dataISO(46296), '2026-10-01', 'número de série do Excel');
  assert.equal(dataISO(''), '');
  assert.equal(dataISO('Em definição'), '', 'texto que não é data não vira data');
  assert.equal(dataISO(12), '', 'número pequeno é quantidade, não data');
});

test('o cabeçalho é procurado, e não contado', () => {
  const grade = [
    ['Plano de Ação — Onda 1'],
    ['Unidades: Alfa, Beta'],
    ['Go-live: 01/10/2026'],
    PLANO_CABECALHO,
    ['1', 'Ação'],
  ];
  assert.equal(linhaDoCabecalho(grade), 3);
  assert.equal(linhaDoCabecalho([['Nada'], ['aqui']]), -1);
});

test('o casamento de rótulos ignora acento e caixa', () => {
  assert.equal(chaveDeNome('Área  Responsável'), 'area responsavel');
  assert.equal(chaveDeNome('STATUS DA AÇÃO'), 'status da acao');
});

// ------------------------------------------------------------- o arquivo todo

test('lê as ações de cada aba de onda', async () => {
  const r = await lerPlanoDeAcao(await arquivo([
    { nome: 'Onda 1', goLive: '01/10/2026', acoes: [linha(1), linha(2)] },
    { nome: 'Onda 2', goLive: '03/11/2026', acoes: [linha(1), linha(2), linha(3)] },
  ]));
  assert.equal(r.acoes.length, 5);
  assert.deepEqual(r.ondas.map((o) => [o.onda, o.lidas]), [[1, 2], [2, 3]]);
  assert.equal(r.acoes[0]!.inicio, '2026-09-01');
  assert.equal(r.acoes[0]!.fim, '2026-09-30');
  assert.deepEqual(r.problemas, []);
});

test('abas que não são onda são ignoradas, e não derrubam a carga', async () => {
  // O arquivo real traz um Dashboard e uma aba BASE. Elas não são ondas, e
  // tropeçar nelas faria a importação exigir um arquivo mutilado.
  const r = await lerPlanoDeAcao(await arquivo([
    { nome: 'Dashboard', acoes: [linha(1)] },
    { nome: 'Onda 1', acoes: [linha(1)] },
  ]));
  assert.equal(r.acoes.length, 1);
  assert.equal(r.acoes[0]!.onda, 1);
});

test('o cabeçalho pode estar mais abaixo — a carga o encontra', async () => {
  const r = await lerPlanoDeAcao(await arquivo([
    { nome: 'Onda 1', acoes: [linha(1)], antesDoCabecalho: 4 },
  ]));
  assert.equal(r.acoes.length, 1);
});

test('arquivo que não é o plano é recusado dizendo o que falta', async () => {
  // "Formato inválido" obrigaria o gestor a adivinhar, e ele não tem como.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Lançamentos');
  ws.addRow(['Fornecedor', 'Valor']);
  ws.addRow(['Alfa', 100]);
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  await assert.rejects(() => lerPlanoDeAcao(bytes), /Onda 1/);
  await assert.rejects(() => lerPlanoDeAcao(bytes), /Status da Ação/);
});

// --------------------------------------------------- o que a carga denuncia

test('go-live diferente do cronograma é denunciado, e o cronograma prevalece', async () => {
  // Uma planilha trocada por engano não pode remontar as ondas sozinha.
  const r = await lerPlanoDeAcao(await arquivo([
    { nome: 'Onda 1', goLive: '15/10/2026', acoes: [linha(1)] },
  ]));
  assert.equal(r.acoes.length, 1, 'as ações entram mesmo assim');
  assert.match(r.problemas.join(' '), /15\/10\/2026/);
  assert.match(r.problemas.join(' '), /01\/10\/2026/);
  assert.match(r.problemas.join(' '), /Vale o cronograma/);
});

test('onda que o cronograma não tem entra avisada', async () => {
  const r = await lerPlanoDeAcao(await arquivo([
    { nome: 'Onda 9', acoes: [linha(1)] },
  ]));
  assert.equal(r.acoes.length, 1);
  assert.match(r.problemas.join(' '), /onda que o cronograma não tem/);
});

test('número repetido na aba: a segunda linha é recusada, e dito por quê', async () => {
  const r = await lerPlanoDeAcao(await arquivo([
    { nome: 'Onda 1', acoes: [linha(7, { tarefa: 'A primeira' }), linha(7, { tarefa: 'A segunda' })] },
  ]));
  assert.equal(r.acoes.length, 1);
  assert.equal(r.acoes[0]!.tarefa, 'A primeira');
  assert.match(r.problemas.join(' '), /número repetido/);
});

test('status desconhecido vira "não iniciado", e aparece no aviso', async () => {
  const r = await lerPlanoDeAcao(await arquivo([
    { nome: 'Onda 1', acoes: [linha(1, { status: 'Aguardando terceiro' })] },
  ]));
  assert.equal(r.acoes[0]!.status, 'Não iniciado');
  assert.match(r.problemas.join(' '), /Aguardando terceiro/);
});

test('sem data de fim a ação entra, contada no diagnóstico', async () => {
  // Inventar um prazo cobraria alguém por uma data que ninguém combinou.
  const r = await lerPlanoDeAcao(await arquivo([
    { nome: 'Onda 1', acoes: [linha(1, { fim: '' }), linha(2)] },
  ]));
  assert.equal(r.acoes.length, 2);
  assert.equal(r.acoes[0]!.fim, null);
  assert.equal(r.diagnostico.sem_fim, 1);
  assert.match(r.problemas.join(' '), /sem data de fim/i);
});

test('fim antes do início é denunciado', async () => {
  const r = await lerPlanoDeAcao(await arquivo([
    { nome: 'Onda 1', acoes: [linha(1, { inicio: '30/09/2026', fim: '01/09/2026' })] },
  ]));
  assert.match(r.problemas.join(' '), /vem antes/);
});

test('linha sem tarefa é ignorada e dita; linha sem número é silêncio', async () => {
  // Sem número não é ação: é espaçamento ou rodapé, e avisar sobre cada uma
  // afogaria os avisos que importam.
  const r = await lerPlanoDeAcao(await arquivo([
    { nome: 'Onda 1', acoes: [linha(1), [2, '', 'Infra', 'Alfa', '', '', '', ''], ['', 'Total', '', '', '', '', '', '']] },
  ]));
  assert.equal(r.acoes.length, 1);
  assert.equal(r.problemas.filter((p) => /sem descrição/.test(p)).length, 1);
  assert.equal(r.problemas.filter((p) => /Total/.test(p)).length, 0);
});

test('área e líder vazios são contados, e o traço conta como vazio', async () => {
  const r = await lerPlanoDeAcao(await arquivo([
    { nome: 'Onda 1', acoes: [linha(1, { area: '', lider: '-' }), linha(2)] },
  ]));
  assert.equal(r.diagnostico.total, 2);
  assert.equal(r.diagnostico.sem_area, 1);
  assert.equal(r.diagnostico.sem_lider, 1);
});

test('a coluna "Qtd Dias" do arquivo não vira verdade', async () => {
  // Ela diverge do intervalo entre as pontas em várias linhas do arquivo real.
  // O que vale são as datas, e nada da carga deve carregá-la adiante.
  const r = await lerPlanoDeAcao(await arquivo([
    { nome: 'Onda 1', acoes: [linha(1, { inicio: '01/09/2026', fim: '30/09/2026', dias: '999' })] },
  ]));
  const campos = Object.keys(r.acoes[0]!);
  assert.ok(!campos.some((c) => /dias/i.test(c)), `nenhum campo de dias: ${campos.join(', ')}`);
});
