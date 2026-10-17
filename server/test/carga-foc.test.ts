/**
 * Leitura do layout FOC — a base que o cliente exporta do sistema dele.
 *
 * O arquivo real tem nome de fornecedor, valor contratado e unidade: ele NÃO
 * entra no repositório. Fica em `dados-origem/`, que é ignorado pelo git, e as
 * conferências que dependem dele se declaram puladas quando ele não está —
 * assim o CI roda sobre as amostras sintéticas abaixo, que cobrem a mesma
 * lógica, e a máquina de quem tem a base confere também os números reais.
 *
 * Os números esperados vieram da tabela dinâmica DO GESTOR, não do que este
 * código produz: é o que prova que a leitura reproduz o que ele já fecha no
 * Excel, em vez de apenas ser coerente consigo mesma.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lerXlsx } from '../src/lib/planilha.js';
import {
  colunasFaltantesFoc,
  lerLinhasFoc,
  mapearColunasFoc,
  normalizarCompetencia,
  normalizarData,
  numerarOcorrencias,
  partesDaChave,
  type LinhaFoc,
} from '../src/domain/carga-foc.js';

const ARQUIVO = join(
  import.meta.dirname,
  '..',
  '..',
  'dados-origem',
  'Base_setembro_Rodrigo_15092026H20M10.xlsx',
);
const temBase = existsSync(ARQUIVO);
const semBase = { skip: temBase ? false : 'base real ausente (dados-origem/ não versionado)' };

/** Totais da dinâmica do gestor: "Vr. Gasto" e "Pgto de Hoje". */
const TOTAL_DESPESAS = 8608925; // R$ 86.089,25
const TOTAL_APROVACAO = 882141; // R$ 8.821,41

async function lerBase() {
  // `preservarDatas`: sem ele a data de pagamento chega como `MM/AAAA` e o dia
  // se perde — e é o dia que separa duas despesas dentro do mesmo mês.
  const abas = await lerXlsx(readFileSync(ARQUIVO), { preservarDatas: true });
  const aba = abas[0]!;
  const mapa = mapearColunasFoc(aba.colunas);
  return { aba, mapa, leitura: lerLinhasFoc(aba.linhas, mapa) };
}

// ------------------------------------------------------------ base sintética
// Reproduz a FORMA do arquivo real — inclusive as oito linhas que só diferem
// no centro de custo — sem carregar nenhum dado de gente de verdade.
const CABECALHO = [
  'ORIGEM', 'COMPETENCIA', 'GRUPO', 'UNIDADE', 'GRUPO_GASTO', 'TIPO', 'CENTRO_CUSTO',
  'VALOR_GASTO', 'META', 'PGTO_DIA', 'PROJ_DIARIAS', 'PROJ_PACIENTES', 'DATA_PGTO',
  'FORNECEDOR', 'MOTIVO', 'Meta Mês',
];

const linhaSintetica = (over: Record<string, unknown>) => ({
  ORIGEM: 'FOC_DESPESAS', COMPETENCIA: 'set./26', GRUPO: 'GRUPO A', UNIDADE: 'UN 1',
  GRUPO_GASTO: 'TECNOLOGIA DA INFORMACAO - TI', TIPO: 'FIXO', CENTRO_CUSTO: 'Materiais de TI',
  VALOR_GASTO: 10, META: 0, PGTO_DIA: '', PROJ_DIARIAS: 0, PROJ_PACIENTES: 0,
  DATA_PGTO: '2026-09-03', FORNECEDOR: 'FORNECEDOR X', MOTIVO: 'motivo', 'Meta Mês': '',
  ...over,
});

const CENTROS = [
  'Telefonia / Internet', 'Licencas de Softwares', 'Locacao de Impressora', 'Serviços Tecnicos',
  'Equipamentos de TI', 'Materiais de TI', 'Sistemas Gerenciais', 'Serviços de Desencolvimento',
];

function lerSintetica(linhas: Array<Record<string, unknown>>) {
  const mapa = mapearColunasFoc(CABECALHO);
  return { mapa, ...lerLinhasFoc(linhas, mapa) };
}

test('todas as 16 colunas do layout são reconhecidas, incluindo "Meta Mês"', () => {
  const mapa = mapearColunasFoc(CABECALHO);
  assert.deepEqual(colunasFaltantesFoc(mapa), []);
  // Só é achado porque o cabeçalho é normalizado sem acento nem espaço.
  assert.equal(mapa.get('meta_mes'), 'Meta Mês');
  assert.equal(mapa.get('centro_custo'), 'CENTRO_CUSTO');
});

test('o valor sai da coluna que a ORIGEM manda, e as duas nunca somam', () => {
  const { linhas } = lerSintetica([
    linhaSintetica({ ORIGEM: 'FOC_DESPESAS', VALOR_GASTO: 164.49, PGTO_DIA: '' }),
    linhaSintetica({ ORIGEM: 'FOC_APROVACAO', VALOR_GASTO: '', PGTO_DIA: 25.5, COMPETENCIA: '26/09/2026' }),
  ]);
  assert.equal(linhas.length, 2);
  assert.equal(linhas[0]!.valorCentavos, 16449);
  assert.equal(linhas[1]!.valorCentavos, 2550);
  assert.equal(linhas.reduce((s, l) => s + l.valorCentavos, 0), 18999);
});

test('meta e projeções ficam em planejamento, fora do valor', () => {
  const { linhas } = lerSintetica([linhaSintetica({ VALOR_GASTO: 10, META: 999, PROJ_PACIENTES: 42 })]);
  assert.equal(linhas[0]!.valorCentavos, 1000);
  assert.equal(linhas[0]!.planejamento.meta, 999);
  assert.equal(linhas[0]!.planejamento.proj_pacientes, 42);
});

test('oito linhas que só diferem no centro de custo continuam sendo oito', () => {
  const { linhas } = lerSintetica(
    CENTROS.map((c, i) => linhaSintetica({ CENTRO_CUSTO: c, VALOR_GASTO: i < 4 ? 1.52 : 1 })),
  );
  assert.equal(linhas.length, 8);

  // A chave da especificação (sem centro de custo) junta as repetições de valor.
  const semCentro = new Set(
    linhas.map((l) => [1, l.unidade, l.dataPagamento, l.valorCentavos, l.origem, l.fornecedor].join('|')),
  );
  assert.equal(semCentro.size, 2, 'a chave da especificação perderia seis linhas');

  // Com o centro de custo, as oito continuam distintas.
  assert.equal(new Set(linhas.map((l) => partesDaChave(1, l).join('|'))).size, 8);
});

test('repetição realmente idêntica ganha número de ocorrência, e a numeração é estável', () => {
  const iguais = [linhaSintetica({}), linhaSintetica({}), linhaSintetica({})];
  const { linhas } = lerSintetica(iguais);
  const chavear = (ls: LinhaFoc[]) =>
    numerarOcorrencias(1, ls).map(({ linha, ocorrencia }) => `${partesDaChave(1, linha).join('|')}#${ocorrencia}`);

  const chaves = chavear(linhas);
  assert.equal(new Set(chaves).size, 3, 'três cobranças iguais no mesmo dia são três despesas');
  // Reimportar o mesmo arquivo reproduz exatamente as mesmas chaves.
  assert.deepEqual(chavear(linhas), chaves);
});

test('competência é lida em todos os formatos que a base usa', () => {
  assert.equal(normalizarCompetencia('set./26'), '2026-09');
  assert.equal(normalizarCompetencia('26/09/2026'), '2026-09');
  assert.equal(normalizarCompetencia('setembro/2026'), '2026-09');
  assert.equal(normalizarCompetencia('09/2026'), '2026-09');
  assert.equal(normalizarCompetencia('2026-09'), '2026-09');
  assert.equal(normalizarCompetencia('jan/27'), '2027-01');
  assert.equal(normalizarCompetencia('nada disso'), null);
  assert.equal(normalizarCompetencia(''), null);
});

// ------------------------------------------------------------- base real
test('a base real: 110 linhas, uma aba, nenhum erro', semBase, async () => {
  const { aba, mapa, leitura } = await lerBase();
  assert.equal(aba.linhas.length, 110);
  assert.deepEqual(colunasFaltantesFoc(mapa), []);
  assert.equal(leitura.linhas.length, 110, `erros: ${JSON.stringify(leitura.erros.slice(0, 3))}`);
  assert.equal(leitura.erros.length, 0);
});

test('a base real: os totais batem com a dinâmica do gestor', semBase, async () => {
  const { leitura } = await lerBase();
  const soma = (origem: string) =>
    leitura.linhas.filter((l) => l.origem === origem).reduce((s, l) => s + l.valorCentavos, 0);

  assert.equal(leitura.linhas.filter((l) => l.origem === 'FOC_DESPESAS').length, 94);
  assert.equal(leitura.linhas.filter((l) => l.origem === 'FOC_APROVACAO').length, 16);
  assert.equal(soma('FOC_DESPESAS'), TOTAL_DESPESAS);
  assert.equal(soma('FOC_APROVACAO'), TOTAL_APROVACAO);
});

test('a base real: toda linha tem chave própria, e a competência é setembro', semBase, async () => {
  const { leitura } = await lerBase();
  const chaves = numerarOcorrencias(1, leitura.linhas).map(
    ({ linha, ocorrencia }) => `${partesDaChave(1, linha).join('|')}#${ocorrencia}`,
  );
  assert.equal(new Set(chaves).size, 110, 'toda linha do arquivo precisa de chave própria');
  assert.ok(leitura.linhas.every((l) => l.competencia === '2026-09'));

  // As oito do CAIXA ADMINISTRATIVO, que é o caso que motivou a chave.
  const grupo = leitura.linhas.filter(
    (l) => l.unidade === 'HR RN' && l.dataPagamento === '2026-09-03' && l.fornecedor === 'CAIXA ADMINISTRATIVO',
  );
  assert.equal(grupo.length, 8);
  assert.equal(new Set(grupo.map((l) => partesDaChave(1, l).join('|'))).size, 8);
});

test('data de pagamento aceita ISO e dd/mm/aaaa', () => {
  assert.equal(normalizarData('2026-09-02'), '2026-09-02');
  assert.equal(normalizarData('02/09/2026'), '2026-09-02');
  assert.equal(normalizarData('2/9/26'), '2026-09-02');
  assert.equal(normalizarData('sem data'), null);
});

test('linha sem valor na coluna da origem é recusada, não importada como zero', () => {
  const mapa = mapearColunasFoc(['ORIGEM', 'UNIDADE', 'TIPO', 'CENTRO_CUSTO', 'DATA_PGTO', 'VALOR_GASTO', 'PGTO_DIA']);
  const { linhas, erros } = lerLinhasFoc(
    [
      // FOC_DESPESAS com o valor na coluna errada: é erro, não soma de PGTO_DIA.
      { ORIGEM: 'FOC_DESPESAS', UNIDADE: 'HR JP', TIPO: 'FIXO', CENTRO_CUSTO: 'Materiais de TI', DATA_PGTO: '2026-09-01', VALOR_GASTO: '', PGTO_DIA: 500 },
      { ORIGEM: 'OUTRA_COISA', UNIDADE: 'HR JP', TIPO: 'FIXO', CENTRO_CUSTO: 'Materiais de TI', DATA_PGTO: '2026-09-01', VALOR_GASTO: 10 },
      { ORIGEM: 'FOC_APROVACAO', UNIDADE: '', TIPO: 'FIXO', CENTRO_CUSTO: 'Materiais de TI', DATA_PGTO: '2026-09-01', PGTO_DIA: 10 },
    ],
    mapa,
  );
  assert.equal(linhas.length, 0);
  assert.ok(erros.some((e) => e.campo === 'valor_gasto'));
  assert.ok(erros.some((e) => e.campo === 'origem'));
  assert.ok(erros.some((e) => e.campo === 'unidade'));
});

test('campo descritivo em branco vira aviso, e a linha entra assim mesmo', () => {
  const mapa = mapearColunasFoc(['ORIGEM', 'UNIDADE', 'TIPO', 'CENTRO_CUSTO', 'DATA_PGTO', 'VALOR_GASTO', 'FORNECEDOR', 'MOTIVO']);
  const { linhas, avisos } = lerLinhasFoc(
    [{ ORIGEM: 'FOC_DESPESAS', UNIDADE: 'HR JP', TIPO: 'FIXO', CENTRO_CUSTO: 'Materiais de TI', DATA_PGTO: '2026-09-01', VALOR_GASTO: 10, FORNECEDOR: '', MOTIVO: '' }],
    mapa,
  );
  assert.equal(linhas.length, 1, 'perder a despesa por falta de descrição seria pior que importá-la');
  assert.ok(avisos.some((a) => a.campo === 'fornecedor'));
  assert.ok(avisos.some((a) => a.campo === 'motivo'));
  // Sem competência, cai no mês do pagamento.
  assert.equal(linhas[0]!.competencia, '2026-09');
});
