/**
 * A CARGA DO CONTROLE ÚNICO.
 *
 * O arquivo de verdade do cliente NÃO entra aqui: ele traz nomes de
 * funcionários e o cronograma comercial. As planilhas destas conferências são
 * montadas na hora, com nomes inventados, e reproduzem o LAYOUT — que é o que
 * a carga precisa aguentar: o cabeçalho na linha 2, as colunas por LETRA, e
 * as oito colunas calculadas que têm de ser ignoradas.
 *
 * O que se exige da carga é que ela NÃO INVENTE. Campo vazio fica vazio e é
 * contado; situação desconhecida entra como veio, com aviso; ID repetido não
 * perde a segunda atividade. Uma carga silenciosa é pior que uma recusa: ela
 * entrega um controle plausível e errado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  dataISO, indiceDaColuna, lerControleUnico, situacaoDe,
} from '../src/domain/carga-spincare.js';

/** Monta uma planilha com o layout do Controle Único. */
async function arquivo(
  linhas: Array<Record<string, string | number>>,
  nomeDaAba = 'Controle Mestre',
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(nomeDaAba);
  ws.addRow(['Controle Único do Projeto']);          // linha 1: título
  const cabecalho: string[] = [];
  cabecalho[indiceDaColuna('A')] = 'ID';
  cabecalho[indiceDaColuna('F')] = 'Atividade';
  ws.addRow(cabecalho);                               // linha 2: cabeçalho
  for (const celulas of linhas) {
    const linha: Array<string | number> = [];
    for (const [letra, valor] of Object.entries(celulas)) linha[indiceDaColuna(letra)] = valor;
    ws.addRow(linha);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Uma linha mínima: ID, atividade, criticidade e a situação de uma unidade. */
const linha = (p: Record<string, string | number> = {}) => ({
  A: 'PRE-1', F: 'Cadastrar convênios', J: 'GO-LIVE', AE: 'Concluído', ...p,
});

// ------------------------------------------------------------------ pedaços

test('a letra da coluna vira índice', () => {
  assert.equal(indiceDaColuna('A'), 0);
  assert.equal(indiceDaColuna('Z'), 25);
  assert.equal(indiceDaColuna('AA'), 26);
  assert.equal(indiceDaColuna('AE'), 30);
  assert.equal(indiceDaColuna('BB'), 53);
});

test('as datas entram em qualquer das três formas do arquivo', () => {
  assert.equal(dataISO('01/10/2026'), '2026-10-01', 'texto brasileiro');
  assert.equal(dataISO('2026-10-01'), '2026-10-01', 'ISO');
  assert.equal(dataISO(46296), '2026-10-01', 'número de série do Excel');
  assert.equal(dataISO(''), '');
  assert.equal(dataISO('A definir'), '', 'texto que não é data não vira data');
  assert.equal(dataISO(12), '', 'número pequeno é quantidade, não data');
});

test('a situação casa sem depender de acento nem de caixa', () => {
  assert.equal(situacaoDe('CONCLUIDO'), 'Concluído');
  assert.equal(situacaoDe('em andamento'), 'Em andamento');
  assert.equal(situacaoDe(''), '');
  // O que não casa volta COMO VEIO: traduzir inventaria uma situação que
  // ninguém escreveu, e descartar perderia o que a planilha diz.
  assert.equal(situacaoDe('Em homologação'), 'Em homologação');
});

// ------------------------------------------------------------- o arquivo

test('lê as atividades da aba Controle Mestre', async () => {
  const r = await lerControleUnico(await arquivo([
    linha({ A: 'PRE-1' }),
    linha({ A: 'PRE-2', F: 'Importar cadastros' }),
  ]));
  assert.equal(r.atividades.length, 2);
  assert.equal(r.atividades[0]!.id_origem, 'PRE-1');
  assert.equal(r.atividades[0]!.atividade, 'Cadastrar convênios');
  assert.deepEqual(r.atividades[0]!.unidades, { hr_pb: 'Concluído' });
  assert.deepEqual(r.problemas, []);
});

test('arquivo sem a aba Controle Mestre é recusado, dizendo o que achou', async () => {
  // "Formato inválido" obrigaria o gestor a adivinhar, e ele não tem como.
  const bytes = await arquivo([linha()], 'Resumo');
  await assert.rejects(() => lerControleUnico(bytes), /Controle Mestre/);
  await assert.rejects(() => lerControleUnico(bytes), /Resumo/);
});

test('cabeçalho fora do lugar é recusado', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Controle Mestre');
  ws.addRow(['ID', 'Atividade']);  // na linha 1, e não na 2
  ws.addRow(['PRE-1', 'Alguma coisa']);
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  await assert.rejects(() => lerControleUnico(bytes), /cabeçalho esperado na linha 2/);
});

test('o ID repetido não perde a segunda atividade', async () => {
  // O ID da planilha NÃO é único: ele é o rótulo do cliente. Recusar a segunda
  // linha perderia uma atividade de verdade.
  const r = await lerControleUnico(await arquivo([
    linha({ A: 'PRE-11', F: 'Cadastro de usuários externos' }),
    linha({ A: 'PRE-11', F: 'Cadastro de usuários internos' }),
  ]));
  assert.equal(r.atividades.length, 2);
  assert.equal(r.atividades[0]!.chave, 'PRE-11');
  assert.equal(r.atividades[1]!.chave, 'PRE-11#2', 'a segunda ganha sufixo na chave');
  assert.equal(r.atividades[1]!.id_origem, 'PRE-11', 'e o ID continua como veio');
  assert.match(r.problemas.map((p) => p.texto).join(' '), /nomeia mais de uma atividade/);
});

test('linha sem nome de atividade é recusada e dita', async () => {
  const r = await lerControleUnico(await arquivo([
    linha(),
    { A: 'PRE-9', J: 'GO-LIVE' },
  ]));
  assert.equal(r.atividades.length, 1);
  assert.equal(r.problemas.filter((p) => p.tipo === 'erro').length, 1);
  assert.match(r.problemas[0]!.texto, /sem o nome da atividade/i);
});

test('a situação desconhecida entra como veio, com aviso', async () => {
  const r = await lerControleUnico(await arquivo([
    linha({ AE: 'Em homologação' }),
  ]));
  assert.equal(r.atividades[0]!.unidades['hr_pb'], 'Em homologação');
  assert.match(r.problemas.map((p) => p.texto).join(' '), /não reconhecida em HR PB/);
});

test('sem criticidade a atividade entra, mas o aviso diz o preço', async () => {
  const r = await lerControleUnico(await arquivo([linha({ J: '' })]));
  assert.equal(r.atividades.length, 1);
  assert.equal(r.diagnostico.sem_criticidade, 1);
  assert.match(r.problemas.map((p) => p.texto).join(' '), /fora do avanço ponderado/);
});

test('as colunas de unidade entram na ordem da planilha', async () => {
  const r = await lerControleUnico(await arquivo([
    linha({ AE: 'Concluído', AF: 'Em andamento', AG: 'Bloqueado', AH: 'Não iniciado' }),
  ]));
  assert.deepEqual(r.atividades[0]!.unidades, {
    hr_pb: 'Concluído', hm_pb: 'Em andamento', hr_cg: 'Bloqueado', uc_rj: 'Não iniciado',
  });
});

test('prazo e situação por onda entram das colunas certas', async () => {
  const r = await lerControleUnico(await arquivo([
    linha({ N: '01/10/2026', O: 'Concluído', P: '03/11/2026' }),
  ]));
  const ondas = r.atividades[0]!.ondas;
  assert.deepEqual(ondas['1'], { prazo: '2026-10-01', situacao: 'Concluído' });
  assert.deepEqual(ondas['2'], { prazo: '2026-11-03' }, 'onda sem situação não inventa uma');
  assert.equal(ondas['3'], undefined, 'onda sem nada não aparece');
});

test('as datas da atividade saem das colunas M e AD', async () => {
  const r = await lerControleUnico(await arquivo([
    linha({ M: '11/11/2026', AD: '01/12/2026' }),
  ]));
  assert.equal(r.atividades[0]!.data_base_onda, '2026-11-11');
  assert.equal(r.atividades[0]!.prazo_repactuado, '2026-12-01');
});

test('o diagnóstico conta o que a planilha deixou vazio', async () => {
  // "- " é ausência escrita de propósito, e conta junto com o branco.
  const r = await lerControleUnico(await arquivo([
    linha({ A: 'P1', L: '', I: '' }),
    linha({ A: 'P2', L: '-', I: 'Menu > Cadastros' }),
    linha({ A: 'P3', L: 'Ana', I: 'Menu > Convênios' }),
  ]));
  assert.equal(r.diagnostico.total, 3);
  assert.equal(r.diagnostico.sem_executante, 2);
  assert.equal(r.diagnostico.sem_caminho, 1);
});

test('conta as unidades do cronograma que a planilha ainda não acompanha', async () => {
  // Elas não estão atrasadas: a planilha ainda não pergunta por elas.
  const r = await lerControleUnico(await arquivo([linha({ AE: 'Concluído' })]));
  // Seis colunas têm unidade do cronograma; só uma foi preenchida.
  assert.equal(r.diagnostico.unidades_sem_coluna, 5);
});

test('as oito colunas calculadas da planilha não viram campo', async () => {
  // Elas foram calculadas contra o dia em que alguém abriu o arquivo.
  const r = await lerControleUnico(await arquivo([linha()]));
  const campos = Object.keys(r.atividades[0]!);
  for (const proibido of ['farol', 'avanco', 'peso', 'status_consolidado']) {
    assert.ok(!campos.includes(proibido), `"${proibido}" é derivado e não pode vir da carga`);
  }
});
