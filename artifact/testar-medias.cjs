// A MÉDIA DO PERÍODO nos gráficos do módulo Financeiro.
//
// A reta responde "este mês está acima ou abaixo do que este período vem
// custando?". Três conferências decidem a entrega: ela sai só dos meses
// REALIZADOS, ela não alcança teto nem projeção (compromisso e repetição não
// têm média), e o traço dela é próprio — pontilhado —, porque o tracejado longo
// já significa outra coisa em dois gráficos.
const { chromium } = require('playwright');
const { irPara } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };
  const repintar = async () => {
    await pag.evaluate(async () => { await render(); });
    await pag.waitForTimeout(1200);
    await pag.evaluate(() => [...document.querySelectorAll('.bloco.dobrado > header .bloco-dobra')]
      .forEach((b) => b.click()));
    await pag.waitForTimeout(700);
  };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });

  // Base com o que cada gráfico precisa: meta de Objetivo 01, teto, despesas
  // reconhecidas e despesas classificadas como compartilhadas.
  await pag.evaluate(async () => {
    await Loja.gravarCatalogo('metas', [
      { cliente: E.clienteSel, nome: 'Alvo do custo fixo', modulo: 'financeiro', tipoMeta: 'objetivo-01',
        alvoPct: 5, vigenciaInicio: null, vigenciaFim: null, ativo: true },
      { cliente: E.clienteSel, nome: 'Teto fixas', modulo: 'financeiro', tipoMeta: 'objetivo-03',
        contextoTeto: 'fixas', valorTeto: 120000, alvoPct: 0, vigenciaInicio: null, vigenciaFim: null, ativo: true },
    ]);
    const fechado = mesSoma(mesHoje(), -1);
    const filiais = filiaisDoEscopo().map((f) => f.nome);
    for (const emp of escopoEmpresas()) {
      for (const k of [...E.lanc.keys()].filter((x) => x.startsWith(emp + '__'))) {
        const comp = k.slice(emp.length + 2);
        if (comp > fechado) continue;
        const itens = Loja.itens(emp, comp);
        if (!itens.length) continue;
        await Loja.gravarMes(emp, comp, itens.map((x, i) => ({
          ...x, reconhecido: true,
          // Um em cada dez vira compartilhado, para o Objetivo 02 ter gráfico.
          ...(i % 10 === 0 && x.natureza === 'fixa'
            ? { tipoConsumo: 'compartilhado', beneficiaTodas: true,
              beneficiadas: filiais.filter((n) => n !== x.filial) }
            : {}),
        })));
      }
    }
  });
  await pag.waitForTimeout(800);
  await irPara(pag, 'Indicadores Gerais', 2500);
  await repintar();

  console.log('\nCOBERTURA — os cinco blocos com gráfico têm média e interruptor');
  const BLOCOS = [
    ['plano-reducao', 'Objetivo 01', 1],
    ['rateio', 'Objetivo 02', 1],
    ['teto-gasto', 'Objetivo 03', 4],
    ['custo-recorrente', 'Farol 1', 2],
    ['custo-mes-a-mes', 'Farol 3', 3],
  ];
  for (const [chave, nome, esperadas] of BLOCOS) {
    const b = await pag.evaluate((k) => {
      const sec = document.querySelector(`[data-kpi="${k}"]`).closest('section.bloco-indicador');
      return {
        temGrafico: !!sec.querySelector('svg'),
        // Pontilhado `2 3` é a marca EXCLUSIVA da média: o tracejado `6 4` é
        // compromisso (teto) ou projeção.
        pontilhadas: sec.querySelectorAll('svg [stroke-dasharray="2 3"]').length,
        tracejadas: sec.querySelectorAll('svg [stroke-dasharray="6 4"]').length,
        interruptor: !!sec.querySelector('[data-medias]'),
        ligado: !!(sec.querySelector('[data-medias]') || {}).checked,
        rotulo: [...sec.querySelectorAll('svg text')].some((t) => /^média \d+m$/.test(t.textContent)),
      };
    }, chave);
    ok(`${nome}: tem gráfico`, b.temGrafico);
    ok(`${nome}: ${esperadas} linha(s) de média, pontilhadas`,
      b.pontilhadas === esperadas, String(b.pontilhadas));
    ok(`${nome}: interruptor presente e ligado por padrão`, b.interruptor && b.ligado);
    ok(`${nome}: a média leva rótulo com o nº de meses`, b.rotulo);
  }

  console.log('\nO QUE NÃO TEM MÉDIA — teto e projeção');
  const excecoes = await pag.evaluate(() => {
    const f = calcularFarol3(recorteDoBloco('financeiro'));
    const sec = document.querySelector('[data-kpi="custo-mes-a-mes"]').closest('section.bloco-indicador');
    return {
      // Três médias (total, variáveis, fixas) e nenhuma para os quatro tetos
      // nem para a projeção.
      pontilhadas: sec.querySelectorAll('svg [stroke-dasharray="2 3"]').length,
      tracejadas: sec.querySelectorAll('svg [stroke-dasharray="6 4"]').length,
      // Mês projetado não recebe comparação: ele não foi medido.
      projetadoSemComparacao: f.projetados.every((p) => p.vsMedia === null),
      realizadoComComparacao: f.realizados.every((p) => !!p.vsMedia),
    };
  });
  ok('o Farol 3 tem três médias', excecoes.pontilhadas === 3, String(excecoes.pontilhadas));
  ok('e cinco tracejadas — a projeção e os quatro tetos, sem média nenhuma',
    excecoes.tracejadas === 5, String(excecoes.tracejadas));
  ok('mês projetado não é comparado com a média', excecoes.projetadoSemComparacao);
  ok('e todo mês realizado é', excecoes.realizadoComComparacao);

  console.log('\nO CÁLCULO — só realizados, e acompanha o filtro');
  const calculo = await pag.evaluate(() => {
    const f = calcularFarol3(recorteDoBloco('financeiro'));
    const o = calcularObjetivo03(recorteDoBloco('financeiro'));
    const soma = f.realizados.reduce((s, p) => s + p.total, 0);
    return {
      meses: f.mediaTotal.meses, realizados: f.realizados.length,
      // Média simples dos meses realizados.
      confere: Math.abs(f.mediaTotal.valor - soma / f.realizados.length) < 0.01,
      // O Objetivo 03 mede sobre o universo dele (só reconhecidas), então a
      // média dele é a dele — não a do Farol 3, por acaso igual ou não.
      obj3: o.mediaTotal.meses,
      // A distância é percentual e traz o sinal.
      exemplo: f.realizados[0].vsMedia.texto,
      sinal: f.realizados.some((p) => p.vsMedia.acima) && f.realizados.some((p) => p.vsMedia.abaixo),
    };
  });
  ok('a média é sobre os meses realizados', calculo.meses === calculo.realizados,
    `${calculo.meses} de ${calculo.realizados}`);
  ok('e é a média simples deles', calculo.confere);
  ok('cada indicador tem a média do próprio universo', calculo.obj3 > 0, String(calculo.obj3));
  ok('a distância vem em percentual, com acima e abaixo',
    /%/.test(calculo.exemplo) && calculo.sinal, calculo.exemplo);

  // Apertar o filtro muda a média: ela é do período em tela, e o rótulo diz
  // sobre quantos meses ela foi feita.
  const antes = calculo.meses;
  await pag.evaluate(async () => {
    const r = recorteDoBloco('financeiro');
    r.de = '2026-05';
    await render();
  });
  await pag.waitForTimeout(1200);
  const depois = await pag.evaluate(() =>
    calcularFarol3(recorteDoBloco('financeiro')).mediaTotal.meses);
  ok('apertar o filtro refaz a média', depois < antes, `${antes} → ${depois} mês(es)`);
  await pag.evaluate(async () => {
    E.filtrosInd.financeiro = recorteInicial('financeiro');
    await render();
  });
  await pag.waitForTimeout(1200);

  console.log('\nPOUCOS MESES — sem base, sem reta');
  const poucos = await pag.evaluate(() => ({
    um: mediaDoPeriodo([100]),
    dois: mediaDoPeriodo([100, 200]),
    comVazio: mediaDoPeriodo([100, null, 300]),
  }));
  // A "média" de um mês é o próprio mês: a reta afirmaria uma referência que
  // não existe.
  ok('um mês não produz média', poucos.um === null);
  ok('dois produzem', poucos.dois && poucos.dois.valor === 150, JSON.stringify(poucos.dois));
  ok('e mês sem dado não conta como zero',
    poucos.comVazio && poucos.comVazio.valor === 200 && poucos.comVazio.meses === 2,
    JSON.stringify(poucos.comVazio));

  // O BALÃO DA PRÓPRIA RETA. Uma linha que atravessa o gráfico não tem um mês
  // para apontar: sem balão próprio, "média 8m" fica sem como ser conferida —
  // não dá para saber a soma nem QUAIS meses entraram nela.
  console.log('\nBALÃO DA LINHA DE MÉDIA');
  await repintar();
  const faixas = await pag.evaluate(() => {
    const por = {};
    for (const sec of document.querySelectorAll('section.bloco-indicador')) {
      const k = (sec.querySelector('[data-kpi]') || {}).dataset;
      const f = sec.querySelectorAll('svg line[stroke="transparent"][tabindex="0"]');
      if (k && k.kpi && f.length) por[k.kpi] = [...f].map((x) => x.getAttribute('aria-label'));
    }
    return por;
  });
  // Os cinco gráficos do Financeiro que ganharam média: Objetivo 01, Objetivo
  // 02, Objetivo 03, os dois do Farol 1 e o Farol 3.
  ok('toda reta de média tem faixa de captura', Object.keys(faixas).length >= 5,
    Object.keys(faixas).join(', '));
  const todos = Object.values(faixas).flat();
  ok('e todas anunciam o conteúdo ao leitor de tela',
    todos.length > 0 && todos.every((r) => /média do período/i.test(r)
      && /Soma dos meses/.test(r) && /Meses somados/.test(r) && /Quais/.test(r)),
    todos[0] || '(nenhuma)');

  const balao = await pag.evaluate(async () => {
    const sec = document.querySelector('[data-kpi="custo-mes-a-mes"]').closest('section.bloco-indicador');
    const f = sec.querySelector('svg line[stroke="transparent"][tabindex="0"]');
    const c = f.getBoundingClientRect();
    f.dispatchEvent(new MouseEvent('mousemove', { bubbles: true,
      clientX: c.left + c.width / 2, clientY: c.top }));
    await new Promise((r) => setTimeout(r, 60));
    const d = document.querySelector('#dica');
    return { ligado: d.classList.contains('on'), texto: d.textContent };
  });
  ok('passar o mouse na reta abre o balão', balao.ligado);
  // Os quatro dados que o pedido nomeia: o valor da posição da linha, o valor
  // total somado, quantos meses e QUAIS.
  ok('com o valor da posição da linha', /Valor da linha/.test(balao.texto), balao.texto);
  ok('com o total somado', /Soma dos meses/.test(balao.texto));
  ok('com a quantidade de meses', /Meses somados/.test(balao.texto));
  ok('e com os meses, nomeados', /Quais/.test(balao.texto) && /\d\d\/\d{4}/.test(balao.texto),
    balao.texto);

  const conta = await pag.evaluate(() => {
    const m = mediaDoPeriodo([100, 200, 300], ['01/2026', '02/2026', '03/2026']);
    return { valor: m.valor, soma: m.soma, meses: m.meses, rotulos: m.rotulos };
  });
  // A soma dividida pelos meses tem de dar a posição da reta: é a conferência
  // que o balão passa a permitir a olho.
  ok('a soma ÷ meses é a posição da reta', conta.soma / conta.meses === conta.valor,
    `${conta.soma} / ${conta.meses} = ${conta.valor}`);
  ok('e os meses saem nomeados na ordem',
    JSON.stringify(conta.rotulos) === JSON.stringify(['01/2026', '02/2026', '03/2026']),
    JSON.stringify(conta.rotulos));
  // Mês sem dado não entra na média nem na lista: ele não foi medido.
  const lacuna = await pag.evaluate(() =>
    mediaDoPeriodo([100, null, 300], ['01/2026', '02/2026', '03/2026']).rotulos);
  ok('mês sem dado fica fora da lista',
    JSON.stringify(lacuna) === JSON.stringify(['01/2026', '03/2026']), JSON.stringify(lacuna));

  // A faixa fica POR CIMA das barras: se ela engolisse o clique, seis pixels no
  // meio do gráfico deixariam de abrir o mês, sem nada na tela explicando.
  const clicou = await pag.evaluate(async () => {
    const sec = document.querySelector('[data-kpi="custo-recorrente"]').closest('section.bloco-indicador');
    const f = sec.querySelector('svg line[stroke="transparent"][tabindex="0"]');
    const c = f.getBoundingClientRect();
    f.dispatchEvent(new MouseEvent('click', { bubbles: true,
      clientX: c.left + c.width / 2, clientY: c.top + c.height / 2 }));
    await new Promise((r) => setTimeout(r, 500));
    const m = document.querySelectorAll('#modais .modal');
    return { n: m.length, txt: m.length ? m[0].textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : '' };
  });
  ok('clicar na faixa ainda abre o mês que está embaixo dela',
    /Custos (fixos|variáveis) de \d\d\/\d{4}/.test(clicou.txt), clicou.txt || '(nada abriu)');
  // O cartão inteiro também é gatilho: sem barrar a subida do clique, abririam
  // DUAS telas, uma sobre a outra.
  ok('e abre UMA tela só', clicou.n === 1, `${clicou.n} modal(is)`);
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(400);

  await pag.evaluate(() => document.querySelector('#dica').classList.remove('on'));

  console.log('\nRACIONAL E INTERRUPTOR');
  await repintar();
  const racional = await pag.evaluate(() => {
    const sec = document.querySelector('[data-kpi="custo-mes-a-mes"]').closest('section.bloco-indicador');
    return {
      coluna: [...sec.querySelectorAll('thead th')].some((t) => /vs\. média/i.test(t.textContent)),
      celulas: [...sec.querySelectorAll('tbody tr')].map((tr) =>
        [...tr.children].map((td) => td.textContent.trim())).filter((c) => c.some((x) => /%/.test(x))).length,
    };
  });
  ok('o racional do Farol 3 tem a coluna vs. média', racional.coluna);
  ok('e ela vem preenchida', racional.celulas > 0, `${racional.celulas} linha(s)`);

  await pag.locator('[data-medias="custo-mes-a-mes"]').click();
  await pag.waitForTimeout(1400);
  await pag.evaluate(() => [...document.querySelectorAll('.bloco.dobrado > header .bloco-dobra')]
    .forEach((b) => b.click()));
  await pag.waitForTimeout(700);
  const desligado = await pag.evaluate(() => {
    const sec = document.querySelector('[data-kpi="custo-mes-a-mes"]').closest('section.bloco-indicador');
    return {
      pontilhadas: sec.querySelectorAll('svg [stroke-dasharray="2 3"]').length,
      // As demais séries continuam: o interruptor é das médias, não do gráfico.
      linhas: sec.querySelectorAll('svg path[stroke]').length,
      marcado: (sec.querySelector('[data-medias]') || {}).checked,
      // E o estado sobrevive ao repintar, porque é guardado.
      guardado: JSON.parse(localStorage.getItem('iarx-medias-ocultas') || '[]'),
    };
  });
  ok('desligar tira as médias do gráfico', desligado.pontilhadas === 0, String(desligado.pontilhadas));
  ok('sem levar as demais séries junto', desligado.linhas >= 8, String(desligado.linhas));
  ok('a caixa fica desmarcada', desligado.marcado === false);
  // Guarda-se a EXCEÇÃO ao padrão, que é "ligado": um bloco novo nasce
  // mostrando a média, e o armazenamento só cresce com o que foi desligado.
  ok('e o que se guarda é o que foi DESLIGADO',
    JSON.stringify(desligado.guardado) === JSON.stringify(['custo-mes-a-mes']),
    JSON.stringify(desligado.guardado));

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
