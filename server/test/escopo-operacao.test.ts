/**
 * O escopo de uma operação de arquivo.
 *
 * O que se prova aqui é o que o enunciado pede como critério de aceite: dá para
 * importar e exportar o cliente inteiro sem escolher unidade; dá para marcar
 * uma ou várias; e nenhuma unidade de outro cliente entra — conferido no
 * servidor, não na tela.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db/index.js';
import { ambienteLimpo, contextoDe, idTipoDespesa, mesRelativo } from './apoio.js';
import { criarEmpresa } from '../src/domain/empresas.js';
import { criarFilial } from '../src/domain/cadastros.js';
import { criarLancamento } from '../src/domain/financeiro.js';
import { comEmpresaEmFoco } from '../src/domain/escopo.js';
import {
  contarFiliais,
  escopoDaOperacao,
  escopoDoCliente,
  escopoDoPedido,
  filtroSql,
  resolverEscopo,
  resumoEscopo,
} from '../src/domain/escopo-operacao.js';
import { exportarXlsx } from '../src/domain/exportacao.js';
import { importarPlanilha } from '../src/domain/importacao.js';
import { lerXlsx } from '../src/lib/planilha.js';
import type { Contexto } from '../src/domain/contexto.js';

/** Um cliente com DUAS matrizes e uma filial em cada — o caso do enunciado. */
function clienteComDuasMatrizes() {
  const { ctx } = ambienteLimpo();
  const segunda = criarEmpresa(ctx.usuarioId, { nome: 'Matriz Sul', clienteId: ctx.clienteId! });
  const cliente: Contexto = { ...ctx, empresaIds: [ctx.empresaId, segunda.id] };
  const filialA = criarFilial(cliente, { nome: 'Filial Norte', cidade: 'Natal', uf: 'RN' });
  const filialB = criarFilial(comEmpresaEmFoco(cliente, segunda.id), {
    nome: 'Filial Oeste',
    cidade: 'Cuiabá',
    uf: 'MT',
  });
  return { ctx: cliente, matrizA: ctx.empresaId, matrizB: segunda.id, filialA, filialB };
}

test('sem escolha nenhuma, o escopo é o cliente inteiro', () => {
  const { ctx, matrizA, matrizB } = clienteComDuasMatrizes();
  const escopo = escopoDaOperacao(ctx, {});
  assert.equal(escopo.modo, 'cliente');
  assert.deepEqual(escopo.empresas.sort(), [matrizA, matrizB].sort());
  assert.deepEqual(escopo.filiais, [], 'filial vazia significa TODAS, não nenhuma');
  assert.equal(resumoEscopo(escopo), '2 empresas, 2 filiais');
});

test('o modo é deduzido do que veio, quando o pedido não o diz', () => {
  assert.equal(escopoDoPedido({}).modo, 'cliente');
  assert.equal(escopoDoPedido({ empresas: '3,4' }).modo, 'empresas');
  assert.equal(escopoDoPedido({ filiais: '7' }).modo, 'unidades');
  // O contrato antigo da tela — `empresa_id=1` — continua valendo.
  assert.deepEqual(escopoDoPedido({ empresa_id: '1' }).empresas, [1]);
});

test('empresas marcadas trazem as filiais delas junto', () => {
  const { ctx, matrizB } = clienteComDuasMatrizes();
  const escopo = escopoDaOperacao(ctx, { escopo: 'empresas', empresas: String(matrizB) });
  assert.deepEqual(escopo.empresas, [matrizB]);
  assert.deepEqual(escopo.filiais, []);
  assert.equal(contarFiliais(escopo), 1, 'a filial da matriz marcada entra sem ser marcada');
  assert.equal(resumoEscopo(escopo), '1 empresa, 1 filial');
});

test('uma filial marcada puxa a matriz dela para o escopo', () => {
  const { ctx, matrizB, filialB } = clienteComDuasMatrizes();
  const escopo = escopoDaOperacao(ctx, { escopo: 'unidades', filiais: String(filialB.id) });
  assert.deepEqual(escopo.empresas, [matrizB], 'sem a matriz, a filial ficaria fora do filtro');
  assert.deepEqual(escopo.filiais, [filialB.id]);
});

test('empresa de outro cliente é recusada, e não devolvida vazia', () => {
  const { ctx } = clienteComDuasMatrizes();
  const alheia = criarEmpresa(ctx.usuarioId, { nome: 'Outra contratante' });
  assert.throws(
    () => escopoDaOperacao(ctx, { escopo: 'empresas', empresas: String(alheia.id) }),
    /não tem acesso/i,
  );
});

test('filial de outro cliente recebe a MESMA recusa de uma filial inexistente', () => {
  const { ctx } = clienteComDuasMatrizes();
  const alheia = criarEmpresa(ctx.usuarioId, { nome: 'Outra contratante' });
  const outro = contextoDe(ctx, alheia.id);
  const filialAlheia = criarFilial(outro, { nome: 'Filial de fora' });

  const deFora = (() => {
    try {
      escopoDaOperacao(ctx, { escopo: 'unidades', filiais: String(filialAlheia.id) });
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  })();
  const inexistente = (() => {
    try {
      escopoDaOperacao(ctx, { escopo: 'unidades', filiais: '999999' });
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  })();

  assert.ok(deFora, 'filial de outro cliente não pode passar');
  // Distinguir as duas contaria a quem tenta qual id existe.
  assert.equal(deFora, inexistente);
});

test('o recorte por filial não some com o lançamento do nível da matriz', () => {
  const { ctx, matrizA, filialA } = clienteComDuasMatrizes();
  const escopo = resolverEscopo(ctx, { modo: 'unidades', empresas: [matrizA], filiais: [filialA.id] });
  const { sql } = filtroSql(escopo, 'l.empresa_id', 'l.filial_id');
  assert.match(sql, /l\.filial_id IS NULL/, 'o lançamento consolidado continua no escopo da matriz dele');
});

test('a exportação do cliente inteiro traz as duas matrizes, com a coluna Empresa', async () => {
  const { ctx, matrizA, matrizB } = clienteComDuasMatrizes();
  const lancar = (empresaId: number, descricao: string) =>
    criarLancamento(comEmpresaEmFoco(ctx, empresaId), {
      tipoDespesaId: idTipoDespesa(comEmpresaEmFoco(ctx, empresaId)),
      competencia: mesRelativo(0),
      valor: 1000,
      natureza: 'fixa',
      classificacao: 'despesa',
      descricao,
    });
  lancar(matrizA, 'Da matriz A');
  lancar(matrizB, 'Da matriz B');

  const { buffer, linhas } = await exportarXlsx(ctx, escopoDoCliente(ctx), 'financeiro');
  assert.ok(linhas > 0, 'o ExportLog precisa saber quantas linhas saíram');
  const abas = await lerXlsx(buffer);
  const financeiro = abas.find((a) => a.nome === 'Financeiro')!;
  const empresas = new Set(financeiro.linhas.map((l) => String(l['Empresa'] ?? '')));
  assert.equal(empresas.size, 2, `esperava duas matrizes, veio: ${[...empresas].join(', ')}`);
  assert.ok(!empresas.has(''), 'nenhuma linha pode sair sem dizer de qual matriz é');
});

test('o arquivo do cliente inteiro volta para as mesmas unidades, sem duplicar', async () => {
  const { ctx, matrizA, matrizB } = clienteComDuasMatrizes();
  for (const [empresaId, descricao] of [
    [matrizA, 'Da matriz A'],
    [matrizB, 'Da matriz B'],
  ] as Array<[number, string]>) {
    const doLado = comEmpresaEmFoco(ctx, empresaId);
    criarLancamento(doLado, {
      tipoDespesaId: idTipoDespesa(doLado),
      competencia: mesRelativo(0),
      valor: 1000,
      natureza: 'fixa',
      classificacao: 'despesa',
      descricao,
    });
  }

  const { buffer } = await exportarXlsx(ctx, escopoDoCliente(ctx), 'financeiro');
  const volta = await importarPlanilha(ctx, buffer, { modulo: 'financeiro', arquivoNome: 'volta.xlsx' });

  assert.equal(volta.com_erro, 0, JSON.stringify(volta.erros));
  assert.equal(volta.importadas, 0, 'nada novo: cada linha voltou para a matriz de onde saiu');
  assert.ok(volta.duplicadas >= 2);
});

test('a mesma linha em duas matrizes são DOIS lançamentos, não um', async () => {
  const { ctx, matrizA, matrizB } = clienteComDuasMatrizes();
  const nomeDe = (id: number) =>
    (
      db()
        .prepare('SELECT nome FROM empresas WHERE id = ?')
        .get(id) as { nome: string }
    ).nome;

  const cabecalho = ['Empresa', 'Tipo de Despesa', 'Competência', 'Valor', 'Natureza', 'Classificação'];
  const linha = (empresaId: number) => ({
    Empresa: nomeDe(empresaId),
    'Tipo de Despesa': 'Licenças de Softwares',
    'Competência': mesRelativo(0),
    Valor: '1000,00',
    Natureza: 'Fixa',
    'Classificação': 'Despesa',
  });
  const csv = [
    cabecalho.join(';'),
    cabecalho.map((c) => String(linha(matrizA)[c as keyof ReturnType<typeof linha>])).join(';'),
    cabecalho.map((c) => String(linha(matrizB)[c as keyof ReturnType<typeof linha>])).join(';'),
  ].join('\n');

  const r = await importarPlanilha(ctx, Buffer.from(csv, 'utf8'), {
    modulo: 'financeiro',
    arquivoNome: 'duas-matrizes.csv',
  });
  assert.equal(r.com_erro, 0, JSON.stringify(r.erros));
  assert.equal(r.importadas, 2, 'valores idênticos em matrizes diferentes não podem colapsar em um');
});

test('escopo com várias empresas e arquivo sem a coluna Empresa: carga recusada', async () => {
  const { ctx } = clienteComDuasMatrizes();
  const csv = [
    'Tipo de Despesa;Competência;Valor;Natureza;Classificação',
    `Licenças de Softwares;${mesRelativo(0)};1000,00;Fixa;Despesa`,
  ].join('\n');

  await assert.rejects(
    () =>
      importarPlanilha(ctx, Buffer.from(csv, 'utf8'), {
        modulo: 'financeiro',
        arquivoNome: 'sem-empresa.csv',
      }),
    /coluna "Empresa"/i,
  );
});

test('o mesmo arquivo sem a coluna Empresa entra quando o escopo tem uma unidade só', async () => {
  const { ctx, matrizA } = clienteComDuasMatrizes();
  const csv = [
    'Tipo de Despesa;Competência;Valor;Natureza;Classificação',
    `Licenças de Softwares;${mesRelativo(0)};1000,00;Fixa;Despesa`,
  ].join('\n');

  // É o arquivo de quem já tem planilha no formato 1.3: precisa continuar entrando.
  const r = await importarPlanilha(ctx, Buffer.from(csv, 'utf8'), {
    modulo: 'financeiro',
    arquivoNome: 'antigo.csv',
    escopo: resolverEscopo(ctx, { modo: 'empresas', empresas: [matrizA], filiais: [] }),
  });
  assert.equal(r.com_erro, 0, JSON.stringify(r.erros));
  assert.equal(r.importadas, 1);
});

test('empresa fora do escopo é recusada linha a linha, sem virar cadastro novo', async () => {
  const { ctx, matrizA } = clienteComDuasMatrizes();
  const csv = [
    'Empresa;Tipo de Despesa;Competência;Valor;Natureza;Classificação',
    `Empresa Que Nao Existe;Licenças de Softwares;${mesRelativo(0)};1000,00;Fixa;Despesa`,
  ].join('\n');

  const r = await importarPlanilha(ctx, Buffer.from(csv, 'utf8'), {
    modulo: 'financeiro',
    arquivoNome: 'fora.csv',
    escopo: resolverEscopo(ctx, { modo: 'empresas', empresas: [matrizA], filiais: [] }),
  });
  assert.equal(r.importadas, 0);
  assert.equal(r.com_erro, 1);
  assert.match(r.erros[0]!.mensagem, /não está no escopo/i);
});
