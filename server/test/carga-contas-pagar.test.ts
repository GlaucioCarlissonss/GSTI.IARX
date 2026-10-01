/**
 * O leitor do layout "Contas a Pagar" contra um arquivo de verdade.
 *
 * A fixture é ANÔNIMA e gerada à mão — o arquivo do cliente tem nome de
 * fornecedor, valor e unidade reais e não entra no repositório. O que ela
 * reproduz do original é a ESTRUTURA, que é o que quebra: Windows-1252, campos
 * omitidos (linhas de 84, 85 e 86 campos), competência só no vencimento,
 * centro de custo dentro do texto de rateio e valor em pt-BR com milhar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodificarTexto, lerCsvBruto } from '../src/lib/planilha.js';
import {
  ancorasDoCabecalho,
  centroDoRateio,
  dataDoCarimbo,
  ehLayoutContasPagar,
  lerLinhasContasPagar,
  numerarOcorrenciasContasPagar,
  partesDaChaveContasPagar,
  realinhar,
} from '../src/domain/carga-contas-pagar.js';

const CAMINHO = fileURLToPath(new URL('./dados/contas-pagar-exemplo.csv', import.meta.url));
const BRUTO = readFileSync(CAMINHO);

function ler() {
  const brutas = lerCsvBruto(decodificarTexto(BRUTO));
  return { brutas, ...lerLinhasContasPagar(brutas) };
}

test('o arquivo em Windows-1252 chega com os acentos inteiros', () => {
  const texto = decodificarTexto(BRUTO);
  assert.ok(texto.includes('CLÍNICA AURORA - SP'), 'lido como UTF-8, viraria CL�NICA');
  assert.ok(texto.includes('Serviços Técnicos'));
  assert.ok(!texto.includes('�'), 'nenhum caractere ficou irrecuperável');
});

test('o cabeçalho identifica o layout, e o da outra carga não', () => {
  const { brutas } = ler();
  assert.equal(ehLayoutContasPagar(brutas[0]!), true);
  assert.equal(ehLayoutContasPagar(['Unidade', 'Valor', 'Centro de Custo']), false);
});

test('as três larguras chegam e todas são realinhadas para 86 posições', () => {
  const { brutas, realinhadas } = ler();
  const larguras = new Set(brutas.slice(1).map((l) => l.length));
  assert.deepEqual([...larguras].sort(), [84, 85, 86], 'a fixture precisa cobrir as três');
  assert.equal(realinhadas, 13, 'as 13 linhas estreitas foram recolocadas');
});

test('o realinhamento só INSERE posições vazias — nada muda de lugar', () => {
  const { brutas } = ler();
  const a = ancorasDoCabecalho(brutas[0]!.map((c) => c.trim()));
  for (const bruta of brutas.slice(1)) {
    const antes = bruta.map((c) => c.trim()).filter((c) => c !== '');
    const depois = realinhar(bruta, a).filter((c) => c !== '');
    assert.deepEqual(depois, antes, 'a sequência de valores não vazios tem de ser a mesma');
  }
});

test('sem realinhar, o criador do documento receberia o carimbo de data', () => {
  const { brutas } = ler();
  const cabecalho = brutas[0]!.map((c) => c.trim());
  const posicao = cabecalho.indexOf('CREATIONUSER');
  const estreita = brutas.slice(1).find((l) => l.length === 85)!;
  // É o defeito que o realinhamento existe para consertar: casando pela
  // esquerda, a cauda desliza uma posição e CREATIONUSER vira data.
  assert.match(estreita[posicao]!.trim(), /^\d{12}-\d{4}$/);
  assert.equal(realinhar(estreita, ancorasDoCabecalho(cabecalho))[posicao], 'DAYVSONSILVA');
});

test('a competência sai do VENCIMENTO, não da emissão', () => {
  const { linhas } = ler();
  const janeiro = linhas.find((l) => l.documento === '550120')!;
  assert.equal(janeiro.dataEmissao, '2026-01-05');
  assert.equal(janeiro.dataVencimento, '2026-02-10');
  assert.equal(janeiro.competencia, '2026-02', 'emitida em janeiro, vencida em fevereiro');
});

test('o valor em pt-BR mantém o milhar', () => {
  const { linhas } = ler();
  const garantia = linhas.find((l) => l.documento === '550160')!;
  assert.equal(garantia.valorCentavos, 1248075, 'R$ 12.480,75, e não R$ 12,48');
});

test('o centro de custo sai do texto de rateio, sem o prefixo numérico', () => {
  assert.deepEqual(centroDoRateio('07.05 Serviços Técnicos: R$ 2.630,00 (100,00%)'), {
    centro: 'Serviços Técnicos',
    multiplo: false,
  });
  assert.deepEqual(centroDoRateio(''), { centro: '', multiplo: false });
});

test('rateio entre vários centros não divide o lançamento, e avisa', () => {
  const { linhas, avisos } = ler();
  const nuvem = linhas.find((l) => l.documento === '550140')!;
  assert.equal(nuvem.valorCentavos, 100000, 'o valor fica inteiro');
  assert.equal(nuvem.centroCusto, 'Licenças de Softwares', 'fica no centro de maior peso');
  assert.ok(
    avisos.some((a) => a.linha === nuvem.linha && /vários centros/.test(a.mensagem)),
    'e o relatório diz nominalmente que houve rateio',
  );
});

test('vencimento, valor e centro de custo em falta recusam a linha, sem derrubar o arquivo', () => {
  const { linhas, erros } = ler();
  assert.deepEqual(erros.map((e) => e.campo).sort(), ['ACTUALDUEDATE', 'LISTOFPRORATEBYCC', 'ORIGINALVALUE']);
  assert.equal(linhas.length, 13, 'as outras treze entraram normalmente');
});

test('o carimbo do ERP vira data, e lixo vira nulo', () => {
  assert.equal(dataDoCarimbo('260826000000-0300'), '2026-08-26');
  assert.equal(dataDoCarimbo(''), null);
  assert.equal(dataDoCarimbo('261326000000-0300'), null, 'mês 13 não existe');
});

test('cinco cobranças do mesmo valor no mesmo dia ficam cinco chaves distintas', () => {
  const { linhas } = ler();
  const moveis = linhas.filter((l) => l.descricao === 'Linha móvel corporativa');
  assert.equal(moveis.length, 5);
  const chaves = new Set(moveis.map((l) => partesDaChaveContasPagar(1, l).join('|')));
  assert.equal(chaves.size, 5, 'é o número do documento que as separa');
});

test('cobrança repetida do mesmo documento é numerada, não descartada', () => {
  const { linhas } = ler();
  const ajustes = linhas.filter((l) => l.documento === '550170');
  assert.equal(ajustes.length, 2);
  const numeradas = numerarOcorrenciasContasPagar(1, ajustes);
  assert.deepEqual(
    numeradas.map((n) => n.ocorrencia),
    [1, 2],
  );
});

test('o criador na origem chega limpo, para o cadastro de reconhecimento ler', () => {
  const { linhas } = ler();
  assert.deepEqual(
    [...new Set(linhas.map((l) => l.usuarioOrigem))].sort(),
    // A string vazia está na lista de propósito: uma linha da amostra chega sem
    // CREATIONUSER. Ela ENTRA na base — o que falta é o reconhecimento, não o
    // lançamento —, e nasce por reconhecer, que é o estado certo de uma despesa
    // que ninguém conferiu.
    ['', 'CELICEALVES', 'DAYVSONSILVA', 'JOSÉ BARBOSA', 'KAUAROCHA', 'MARIELITONBARBOSA', 'MIQUEIASSILVA'],
  );
});

test('DOCISSUBSTITUTE é lida e contada, mas não decide o reconhecimento', () => {
  const r = ler();
  // Na base real esta coluna vem "0" nas 1.148 linhas: sempre preenchida e
  // sempre igual, portanto incapaz de separar o que quer que seja. A amostra
  // repete esse valor e guarda UMA linha com ela vazia.
  assert.deepEqual(
    [...new Set(r.linhas.map((l) => l.docSubstituto))].sort(),
    ['', '0'],
  );
  assert.equal(r.semDocSubstituto, 1, 'a linha sem a coluna é contada');
  assert.equal(r.semCriador, 1, 'e a linha sem criador também');

  // A linha sem DOCISSUBSTITUTE não perde o criador: é o nome que decide, e
  // ela continua elegível ao reconhecimento.
  const semColuna = r.linhas.find((l) => !l.docSubstituto)!;
  assert.equal(semColuna.usuarioOrigem, 'MARIELITONBARBOSA');
});
