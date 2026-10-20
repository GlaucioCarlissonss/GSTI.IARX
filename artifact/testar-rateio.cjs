// O rateio das despesas compartilhadas, na versão hospedada.
//
// Duas promessas, e a segunda é a que custa caro se quebrar:
//
//   1. a soma das parcelas é EXATAMENTE o valor compartilhado — sem isso o
//      comparativo "antes → depois" mente por arredondamento;
//   2. a leitura integral NÃO mudou. O bloco "paga por uma unidade, consumida
//      por outras" continua contando o valor inteiro na pagadora, porque é o
//      "antes" do comparativo.
//
// E uma terceira, de coerência entre as pontas: `ratearPorPeso` aqui tem de
// dar o mesmo resultado de `ratear` em `server/src/domain/indicadores.ts`. As
// duas implementações existem porque o artifact tem cópia própria do modelo
// financeiro; divergirem seria o pior defeito possível.
const { chromium } = require('playwright');
const { irPara, usarEmpresas } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });

  // ------------------------------------------------ a aritmética, isolada
  console.log('\nARITMÉTICA — a soma das parcelas fecha, sempre');
  const conta = await pag.evaluate(() => {
    const casos = [
      [100, [1, 1, 1]],
      [1234567, [3, 7, 11]],
      [1, [1, 1, 1, 1]],
      [999, [0, 5]],
      [7, [2]],
      [100, [0, 0, 0, 0]],
    ];
    return casos.map(([valor, pesos]) => {
      const p = ratearPorPeso(valor, pesos);
      return { valor, pesos, parcelas: p, soma: p.reduce((s, x) => s + x, 0), negativa: p.some((x) => x < 0) };
    });
  });
  ok('nenhum centavo se perde em nenhum caso',
    conta.every((c) => c.soma === c.valor), conta.filter((c) => c.soma !== c.valor).map((c) => c.valor).join(', ') || 'todos fecham');
  ok('e nenhuma parcela sai negativa', conta.every((c) => !c.negativa));
  const tresIguais = conta[0].parcelas.slice().sort((a, b) => a - b);
  ok('o resto vai para alguém, e não some', JSON.stringify(tresIguais) === JSON.stringify([33, 33, 34]),
    tresIguais.join(' + '));
  const todosZero = conta[5].parcelas;
  ok('todos os pesos em zero dividem igual, em vez de zerar tudo',
    todosZero.every((x) => x === 25), todosZero.join(' · '));

  const estavel = await pag.evaluate(() =>
    JSON.stringify(ratearPorPeso(1000, [5, 5, 3])) === JSON.stringify(ratearPorPeso(1000, [5, 5, 3])));
  ok('a mesma entrada dá sempre a mesma saída', estavel);

  // ------------------------------------------------ o indicador na tela
  console.log('\nINDICADOR — o rateio aparece e fecha com o compartilhado');
  await irPara(pag, 'Indicadores Gerais', 1500);

  // A base de teste não tem despesa compartilhada: ela é anterior à
  // classificação de consumo existir. Marcar duas aqui é o que faz o
  // indicador ter o que mostrar — e é a única forma de conferir que a soma
  // das parcelas fecha com um valor de verdade, e não com zero.
  const marcados = await pag.evaluate(() => {
    // `Loja.todos` devolve CÓPIAS (`{ ...it }`), então marcar o que ele
    // devolve não muda nada. A marca vai no item dentro de `E.lanc`, que é
    // onde o dado mora de verdade.
    let n = 0;
    for (const [chave, mes] of E.lanc) {
      // O id da empresa é TEXTO neste modelo ('alianca', 'moove'): converter
      // para número daria NaN e nenhuma linha casaria.
      const empresa = chave.split('__')[0];
      if (!escopoEmpresas().includes(empresa)) continue;
      for (const it of mes.itens || []) {
        if (n >= 2) break;
        if (!it.filial) continue;
        it.tipoConsumo = 'compartilhado';
        it.beneficiadas = ['Outra unidade do grupo'];
        n += 1;
      }
      if (n >= 2) break;
    }
    return n;
  });
  ok('a base recebeu despesa compartilhada para o indicador ter o que mostrar',
    marcados === 2, `${marcados} lançamento(s)`);
  await pag.evaluate(() => render());
  await pag.waitForTimeout(900);

  const dados = await pag.evaluate(() => {
    const r = calcularRateio(recorteDoBloco('financeiro'));
    const c = calcularConsumo(recorteDoBloco('financeiro'));
    return {
      lancamentos: r.lancamentos,
      compartilhado: r.compartilhado,
      sanidade: r.sanidade,
      empresas: r.porEmpresa.length,
      empresasDoEscopo: escopoEmpresas().length,
      // O rateio redistribui: a soma do grupo antes é a soma do grupo depois.
      antes: Math.round(r.porEmpresa.reduce((s, e) => s + e.antes, 0) * 100),
      depois: Math.round(r.porEmpresa.reduce((s, e) => s + e.depois, 0) * 100),
      // A leitura integral, que é o "antes" — não pode ter mudado.
      integral: c.centralizado,
    };
  });
  ok('o grupo INTEIRO entra na tabela, e não só quem gastou',
    dados.empresas === dados.empresasDoEscopo,
    `${dados.empresas} de ${dados.empresasDoEscopo} empresa(s) do escopo`);
  ok('a soma das parcelas é exatamente o valor compartilhado',
    Math.round(dados.sanidade * 100) === Math.round(dados.compartilhado * 100),
    `${dados.sanidade} vs ${dados.compartilhado}`);
  ok('o rateio redistribui, não cria nem destrói', dados.antes === dados.depois,
    `${dados.antes} → ${dados.depois}`);
  ok('a leitura integral continua sendo a de sempre',
    Math.round(dados.integral * 100) === Math.round(dados.compartilhado * 100),
    `integral ${dados.integral} · compartilhado ${dados.compartilhado}`);

  // ------------------------------------------- o bloco, quando há dado
  const blocoRateio = await pag.evaluate(() => {
    const kpi = document.querySelector('[data-kpi="rateio"]');
    if (!kpi) return null;
    return {
      numero: (kpi.querySelector('.n') || {}).textContent.trim(),
      apoio: (kpi.querySelector('.a') || {}).textContent.trim(),
      linhas: kpi.querySelectorAll('tbody tr').length,
      comparativos: kpi.querySelectorAll('.comparativo').length,
      legenda: !!kpi.querySelector('.legenda-consumo'),
      pagadora: /pagadora/.test(kpi.textContent),
      criterio: /proporcional à despesa própria/.test(document.querySelector('#pagina').textContent),
    };
  });
  ok('o bloco de rateio existe', !!blocoRateio);
  if (blocoRateio) {
    const temDado = blocoRateio.numero !== '—';
    ok('o bloco diz o que tem para dizer', temDado || /nenhuma despesa compartilhada/.test(blocoRateio.apoio),
      `${blocoRateio.numero} · ${blocoRateio.apoio}`.slice(0, 90));
    if (temDado) {
      ok('lista uma linha por empresa', blocoRateio.linhas >= 1, `${blocoRateio.linhas} linha(s)`);
      ok('com o comparativo antes → depois em cada uma',
        blocoRateio.comparativos >= blocoRateio.linhas, `${blocoRateio.comparativos} comparativo(s)`);
      ok('a pagadora original vem marcada', blocoRateio.pagadora);
      ok('e a legenda dos dois tons está no bloco', blocoRateio.legenda);
      ok('o critério do rateio está escrito na tela', blocoRateio.criterio);
    }
  }

  // ----------------------------------- as duas leituras, agora no mesmo bloco
  //
  // O bloco solto "Despesa paga por uma unidade, consumida por outras" saiu da
  // tela a pedido do gestor. A leitura INTEGRAL não se perdeu: ela é o "antes"
  // do comparativo dentro do Objetivo 02, ao lado do "depois" rateado — que é
  // onde as duas deixam de poder ser somadas por engano.
  console.log('\nCONVIVÊNCIA — as duas leituras no mesmo comparativo');
  const convivem = await pag.evaluate(() => {
    const sec = document.querySelector('[data-kpi="rateio"]').closest('section.bloco-indicador');
    const texto = sec.textContent.replace(/\s+/g, ' ');
    return {
      // `calcularConsumo` é a leitura integral, e continua sendo a fonte do
      // "antes": o que saiu foi a seção que a exibia solta.
      integralViva: calcularConsumo(recorteDoBloco('financeiro')).lancamentos >= 0,
      antesEDepois: /antes/i.test(texto) && /depois/i.test(texto),
      criterioJunto: /proporcional à despesa própria/.test(texto),
      // E o bloco solto não pode ter sobrado em lugar nenhum da tela.
      blocoSolto: /paga por uma unidade, consumida por outras/i
        .test(document.querySelector('#pagina').textContent),
    };
  });
  ok('a leitura integral continua existindo, como fonte do "antes"', convivem.integralViva);
  ok('e as duas aparecem lado a lado no comparativo', convivem.antesEDepois);
  ok('com o critério do rateio junto delas', convivem.criterioJunto);
  ok('o bloco solto saiu da tela', !convivem.blocoSolto);

  // --------------------------------- recorte vazio não inventa rateio
  console.log('\nRECORTE VAZIO — sem compartilhada, o indicador não inventa');
  await pag.fill('#i-financeiro-de', '01/1990');
  await pag.dispatchEvent('#i-financeiro-de', 'change');
  await pag.waitForTimeout(400);
  await pag.fill('#i-financeiro-ate', '12/1990');
  await pag.dispatchEvent('#i-financeiro-ate', 'change');
  await pag.waitForTimeout(900);
  const vazio = await pag.evaluate(() => {
    const r = calcularRateio(recorteDoBloco('financeiro'));
    const kpi = document.querySelector('[data-kpi="rateio"]');
    return {
      lancamentos: r.lancamentos,
      sanidade: r.sanidade,
      numero: kpi ? (kpi.querySelector('.n') || {}).textContent.trim() : '',
      drill: kpi ? kpi.classList.contains('drill') : null,
    };
  });
  ok('sem lançamento compartilhado, não há rateio', vazio.lancamentos === 0 && vazio.sanidade === 0,
    `${vazio.lancamentos} lançamento(s)`);
  ok('e o indicador mostra um travessão em vez de zero', vazio.numero === '—', vazio.numero);
  ok('um número que não existe também não abre detalhamento', vazio.drill === false);

  void usarEmpresas;
  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
