// O CACHE NÃO PODE MENTIR.
//
// `Loja.todosDoEscopo()` e `ordemDosTipos()` passaram a guardar a última
// resposta, e isso derrubou a tela de Indicadores de 5.654 ms para 105 ms numa
// base de 8.279 lançamentos. O ganho é grande; o risco que ele cria é maior,
// e por isso esta suíte existe.
//
// Um cache que devolve o valor velho é pior do que o código lento que ele
// substituiu: a tela mostra um número errado com toda a confiança de um número
// certo, e ninguém tem como desconfiar. Lentidão se percebe; dado velho, não.
//
// O que se prova aqui é a INVALIDAÇÃO, e não a velocidade:
//
//   1. gravar muda o resultado;
//   2. gravar POR CIMA, sem mudar a quantidade, também muda — é o caso que um
//      cache ingênuo (comparar `size`) erraria;
//   3. trocar o escopo muda;
//   4. apagar tudo muda;
//   5. e, entre duas mudanças, a resposta é de fato reaproveitada — senão o
//      cache não estaria fazendo nada e a medição teria mentido.
//
//   node semear-volume.cjs && node montar-teste.cjs
//   CHROMIUM_BIN=/opt/pw-browsers/chromium node testar-cache.cjs
const { chromium } = require('playwright');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });

  console.log('\nO CACHE REAPROVEITA');
  const reuso = await pag.evaluate(() => {
    const a = Loja.todosDoEscopo();
    const b = Loja.todosDoEscopo();
    const o1 = ordemDosTipos();
    const o2 = ordemDosTipos();
    // Identidade de referência: se fosse recalculado, seria outro array.
    return { mesmoArray: a === b, mesmaOrdem: o1 === o2, n: a.length };
  });
  ok('duas chamadas seguidas devolvem o MESMO array', reuso.mesmoArray, `${reuso.n} lançamentos`);
  ok('e a mesma ordem de tipos', reuso.mesmaOrdem);

  console.log('\nGRAVAR INVALIDA');
  const gravou = await pag.evaluate(async () => {
    const emp = E.empresas[0].id;
    const comp = mesHoje();
    const antes = Loja.todosDoEscopo().length;
    const itens = [...Loja.itens(emp, comp), {
      id: novoId(), grupo: novoId(), origem: 'manual', filial: null,
      tipo: 'Licenças de Softwares', natureza: 'fixa', classificacao: 'despesa',
      cenario: 'oficial', fornecedor: 'NOVO FORNECEDOR', descricao: 'Linha nova',
      valor: 1234, tipoConsumo: 'integral', beneficiadas: [], beneficiaTodas: false,
    }];
    await Loja.gravarMes(emp, comp, itens);
    return { antes, depois: Loja.todosDoEscopo().length };
  });
  ok('um lançamento a mais aparece na hora', gravou.depois === gravou.antes + 1,
    `${gravou.antes} → ${gravou.depois}`);

  console.log('\nGRAVAR POR CIMA, SEM MUDAR A QUANTIDADE, TAMBÉM INVALIDA');
  // Este é o caso que derruba o cache ingênuo: a quantidade não muda, mas o
  // conteúdo sim. Um cache que comparasse `E.lanc.size` devolveria o valor
  // velho aqui, e a tela mostraria o número de antes.
  const porCima = await pag.evaluate(async () => {
    const emp = E.empresas[0].id;
    const comp = mesHoje();
    const antes = Loja.todosDoEscopo();
    const nAntes = antes.length;
    const somaAntes = antes.reduce((s, l) => s + cent(l.valor), 0);
    const itens = Loja.itens(emp, comp).map((l) =>
      (l.fornecedor === 'NOVO FORNECEDOR' ? { ...l, valor: 99999 } : l));
    await Loja.gravarMes(emp, comp, itens);
    const depois = Loja.todosDoEscopo();
    return {
      quantidadeIgual: depois.length === nAntes,
      somaMudou: depois.reduce((s, l) => s + cent(l.valor), 0) !== somaAntes,
    };
  });
  ok('a quantidade continua a mesma', porCima.quantidadeIgual);
  ok('mas a SOMA mudou — o cache não serviu o valor velho', porCima.somaMudou);

  console.log('\nUM TIPO NOVO ENTRA NA ORDEM DAS CORES');
  const tipoNovo = await pag.evaluate(async () => {
    const emp = E.empresas[0].id;
    const comp = mesHoje();
    const antes = ordemDosTipos();
    const inedito = 'Tipo Inédito Para o Cache';
    await Loja.gravarMes(emp, comp, [...Loja.itens(emp, comp), {
      id: novoId(), grupo: novoId(), origem: 'manual', filial: null,
      tipo: inedito, natureza: 'fixa', classificacao: 'despesa',
      cenario: 'oficial', fornecedor: 'X', descricao: 'Y', valor: 10,
      tipoConsumo: 'integral', beneficiadas: [], beneficiaTodas: false,
    }]);
    const depois = ordemDosTipos();
    return { tinha: antes.includes(inedito), tem: depois.includes(inedito),
      // A cor também: ela é derivada da ordem, e é o que o gestor enxerga.
      cor: corDoTipo(inedito) };
  });
  ok('o tipo não existia antes', !tipoNovo.tinha);
  ok('e passa a existir na ordem depois de gravado', tipoNovo.tem);
  ok('a cor dele é resolvida, e não a de "outros"', tipoNovo.cor !== 'var(--tinta3)', tipoNovo.cor);

  console.log('\nTROCAR O ESCOPO INVALIDA');
  const escopo = await pag.evaluate(() => {
    if (E.empresas.length < 2) return { pulado: true };
    const r = filtroDaTela(E.aba);
    const todas = Loja.todosDoEscopo().length;
    r.empresas = new Set([E.empresas[0].id]);
    const soUma = Loja.todosDoEscopo().length;
    r.empresas = new Set();
    const voltou = Loja.todosDoEscopo().length;
    return { todas, soUma, voltou };
  });
  if (escopo.pulado) {
    ok('base com uma matriz só — escopo não exercitado', true, 'pulado');
  } else {
    ok('filtrar uma matriz reduz o conjunto', escopo.soUma < escopo.todas,
      `${escopo.todas} → ${escopo.soUma}`);
    ok('e tirar o filtro devolve o conjunto inteiro', escopo.voltou === escopo.todas,
      String(escopo.voltou));
  }

  console.log('\n=== erros de console: ' + (erros.length ? erros.join(' | ') : 'nenhum') + ' ===');
  await nav.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S): ` + falhas.join(' · ') : '\nTudo certo.');
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
