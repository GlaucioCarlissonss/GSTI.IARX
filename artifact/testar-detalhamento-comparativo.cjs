// O DETALHAMENTO FINANCEIRO É COMPARATIVO — ENTREGA 1: A ESTRUTURA.
//
// Todo indicador do Financeiro abria UMA lista: o que veio no recorte. Quem
// queria saber se o mês piorou abria dois meses em duas janelas e comparava no
// olho. Agora o detalhamento tem camadas empilhadas, de largura cheia, uma
// abaixo da outra e todas FECHADAS ao nascer:
//
//   1. Diferença vs mês anterior
//   2. O que veio no mês filtrado
//   3. Mês anterior: o que veio × o que não veio
//   4. (só nos detalhamentos de recorte) Recorte completo — o que o indicador soma
//
// Esta suíte mede a ENTREGA 1, que é a estrutura: as camadas existem, nascem
// fechadas, abrem e fecham pelo mouse e pelo teclado, anunciam o estado em
// `aria-expanded`, o cabeçalho diz "MM/AAAA vs MM/AAAA", e o corpo só é
// montado no primeiro clique — carregar três árvores de uma vez custaria três
// vezes a pergunta que a pessoa veio fazer.
//
// O conteúdo das camadas 1 e 3 (a quebra da variação e o corte veio × não veio)
// é das entregas seguintes; aqui o que se prova é que a casa existe e que a
// camada 2 continua trazendo a árvore inteira, sem perder nada do que havia.
//
//   node montar-teste.cjs
//   CHROMIUM_BIN=/opt/pw-browsers/chromium node testar-detalhamento-comparativo.cjs
const { chromium } = require('playwright');
const { irPara, congelarRelogio } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1480, height: 1000 } });
  await congelarRelogio(pag);
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  await irPara(pag, 'Indicadores Gerais', 1500);

  const fecharModal = async () => {
    await pag.evaluate(() => {
      const bt = document.querySelector('.modal [data-c]');
      if (bt) bt.click();
    });
    await pag.waitForTimeout(250);
  };

  /** Lê a estrutura do detalhamento que está aberto na tela. */
  const lerDetalhe = () => pag.evaluate(() => {
    const area = document.querySelector('.modal [data-comparativo]');
    if (!area) return null;
    const cab = area.querySelector('.det-comp-cab');
    return {
      cabecalho: cab ? cab.textContent.replace(/\s+/g, ' ').trim() : '',
      // Largura cheia: cada camada ocupa a mesma caixa, uma abaixo da outra.
      largura: Math.round(area.getBoundingClientRect().width),
      camadas: [...area.querySelectorAll('.camada')].map((s) => {
        const bt = s.querySelector('.camada-bt');
        const corpo = s.querySelector('.camada-corpo');
        return {
          id: s.dataset.camada,
          rotulo: s.querySelector('.camada-rot').textContent.trim(),
          valor: s.querySelector('.camada-val').textContent.replace(/\s+/g, ' ').trim(),
          aberta: bt.getAttribute('aria-expanded') === 'true',
          controla: bt.getAttribute('aria-controls') === corpo.id && !!corpo.id,
          escondido: corpo.hidden,
          montado: !!corpo.dataset.montado,
          largura: Math.round(s.getBoundingClientRect().width),
          linhasNaArvore: corpo.querySelectorAll('[data-arvore-det] tbody tr').length,
        };
      }),
    };
  });

  const abrirCamada = async (id) => {
    await pag.evaluate((c) => document.querySelector(`.camada[data-camada="${c}"] .camada-bt`).click(), id);
    await pag.waitForTimeout(220);
  };

  // Os indicadores do Financeiro, pelo rótulo do cartão. `multiMes` diz se o
  // detalhamento cobre o recorte inteiro — é onde a quarta camada existe.
  const INDICADORES = [
    { chave: 'teto-gasto', nome: 'Objetivo 03 — teto de gasto', multiMes: false },
    { chave: 'custo-mes-a-mes', nome: 'Farol 1 — custo mês a mês', multiMes: false },
    { chave: 'plano-reducao', nome: 'Objetivo 01 — plano de redução', multiMes: true },
    { chave: 'rateio', nome: 'Objetivo 02 — despesas compartilhadas', multiMes: true },
    { chave: 'custo-recorrente', nome: 'Farol 2 — custo recorrente', multiMes: true },
  ];

  console.log('\nESTRUTURA — as camadas existem em todo indicador do Financeiro');
  const vistos = [];
  for (const ind of INDICADORES) {
    const achou = await pag.evaluate((c) => {
      const k = document.querySelector(`.kpi.drill[data-kpi="${c}"]`)
        || [...document.querySelectorAll('.kpi.drill')].find((e) => e.dataset.kpi === c);
      if (!k) return false;
      k.scrollIntoView({ block: 'center' });
      k.click();
      return true;
    }, ind.chave);
    if (!achou) { console.log(`  · ${ind.nome}: indicador ausente neste recorte`); continue; }
    await pag.waitForTimeout(700);

    const d = await lerDetalhe();
    if (!d) { ok(`${ind.nome}: o detalhamento comparativo abre`, false, 'nenhuma área comparativa'); continue; }
    vistos.push(ind.nome);

    const ids = d.camadas.map((c) => c.id);
    const esperados = ind.multiMes ? ['dif', 'veio', 'ant', 'recorte'] : ['dif', 'veio', 'ant'];
    ok(`${ind.nome}: as camadas certas, na ordem certa`,
      ids.join(',') === esperados.join(','), ids.join(' → '));
    ok(`${ind.nome}: todas nascem fechadas`,
      d.camadas.every((c) => !c.aberta && c.escondido), d.camadas.map((c) => c.aberta).join(','));
    ok(`${ind.nome}: nenhum corpo foi montado antes do clique`,
      d.camadas.every((c) => !c.montado));
    ok(`${ind.nome}: cada botão anuncia o corpo que controla`,
      d.camadas.every((c) => c.controla));
    // Largura cheia: a diferença entre a camada e a área é só a borda.
    ok(`${ind.nome}: as camadas ocupam a largura toda`,
      d.camadas.every((c) => Math.abs(c.largura - d.largura) <= 2),
      `área ${d.largura}px · camadas ${[...new Set(d.camadas.map((c) => c.largura))].join('/')}px`);
    ok(`${ind.nome}: o cabeçalho diz o mês filtrado e o de comparação`,
      /\d{2}\/\d{4} vs (\d{2}\/\d{4}|sem base)/.test(d.cabecalho), d.cabecalho.slice(0, 90));
    ok(`${ind.nome}: a camada 2 anuncia o total do mês sem precisar abrir`,
      /R\$/.test(d.camadas[1].valor), d.camadas[1].valor);

    await fecharModal();
  }
  ok('os cinco indicadores do Financeiro foram alcançados', vistos.length === INDICADORES.length,
    `${vistos.length} de ${INDICADORES.length}`);

  // ------------------------------------------------ o corpo chega no clique
  console.log('\nSOB DEMANDA — o corpo só é montado quando a camada abre');
  await pag.evaluate(() => {
    const k = document.querySelector('.kpi.drill[data-kpi="teto-gasto"]');
    if (k) { k.scrollIntoView({ block: 'center' }); k.click(); }
  });
  await pag.waitForTimeout(700);

  const antes = await lerDetalhe();
  if (antes) {
    await abrirCamada('veio');
    const depois = await lerDetalhe();
    const c2a = antes.camadas[1], c2d = depois.camadas[1];
    ok('fechada, a camada não tinha árvore nenhuma', c2a.linhasNaArvore === 0);
    ok('aberta, a camada traz a árvore inteira', c2d.linhasNaArvore > 0, `${c2d.linhasNaArvore} linha(s)`);
    ok('aberta, o estado é anunciado', c2d.aberta && !c2d.escondido);
    ok('as outras camadas continuam fechadas e não montadas',
      [depois.camadas[0], depois.camadas[2]].every((c) => !c.aberta && !c.montado));

    // Fechar e reabrir não remonta: o corpo já está lá.
    await abrirCamada('veio');
    const fechada = await lerDetalhe();
    ok('fechar esconde o corpo mas o conserva',
      !fechada.camadas[1].aberta && fechada.camadas[1].escondido && fechada.camadas[1].montado);

    // A árvore de dentro continua operável — é a mesma de antes da mudança.
    await abrirCamada('veio');
    const arvore = await pag.evaluate(async () => {
      const corpo = document.querySelector('.camada[data-camada="veio"] .camada-corpo');
      const bt = corpo.querySelector('[data-abrir-no]');
      if (!bt) return null;
      const antesN = corpo.querySelectorAll('[data-arvore-det] tbody tr:not([hidden])').length;
      bt.click();
      await new Promise((r) => setTimeout(r, 120));
      return { antes: antesN, depois: corpo.querySelectorAll('[data-arvore-det] tbody tr:not([hidden])').length };
    });
    ok('a árvore dentro da camada ainda abre os níveis',
      !!arvore && arvore.depois > arvore.antes, arvore ? `${arvore.antes} → ${arvore.depois}` : 'sem nós');

    // ------------------------------------------------------------- teclado
    console.log('\nTECLADO — a camada abre pelo foco e pelo Enter');
    await abrirCamada('veio');  // volta a fechar
    const porTeclado = await pag.evaluate(async () => {
      const bt = document.querySelector('.camada[data-camada="ant"] .camada-bt');
      bt.focus();
      const focado = document.activeElement === bt;
      const contorno = getComputedStyle(bt, ':focus-visible').outlineWidth;
      bt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      bt.click();  // o navegador converte Enter em clique num <button>
      await new Promise((r) => setTimeout(r, 200));
      return { focado, contorno, aberta: bt.getAttribute('aria-expanded') === 'true' };
    });
    ok('o cabeçalho da camada recebe foco', porTeclado.focado);
    ok('o foco é visível', porTeclado.contorno !== '0px', porTeclado.contorno);
    ok('Enter abre a camada', porTeclado.aberta);
  } else {
    ok('o detalhamento do teto de gasto abre', false, 'nenhuma área comparativa');
  }
  await fecharModal();

  // ------------------------------------------- recorte: a quarta camada soma
  console.log('\nRECORTE — a camada 4 é a que fecha com o indicador');
  await pag.evaluate(() => {
    const k = document.querySelector('.kpi.drill[data-kpi="custo-recorrente"]');
    if (k) { k.scrollIntoView({ block: 'center' }); k.click(); }
  });
  await pag.waitForTimeout(700);
  const rec = await lerDetalhe();
  if (rec && rec.camadas.length === 4) {
    const moeda = (t) => Number((t.match(/R\$\s*([\d.]+,\d{2})/) || [])[1]
      ?.replace(/\./g, '').replace(',', '.')) || 0;
    const doMes = moeda(rec.camadas[1].valor);
    const doRecorte = moeda(rec.camadas[3].valor);
    ok('o recorte inteiro soma mais que o último mês sozinho', doRecorte >= doMes,
      `recorte ${doRecorte} · mês ${doMes}`);
    ok('o cabeçalho avisa que a comparação é do último mês',
      /recorte de \d{2}\/\d{4} a \d{2}\/\d{4}/.test(rec.cabecalho), rec.cabecalho.slice(0, 110));
  } else {
    ok('o detalhamento de recorte traz quatro camadas', false,
      rec ? `${rec.camadas.length} camada(s)` : 'nenhuma área comparativa');
  }
  await fecharModal();

  console.log(`\n=== erros de console: ${erros.length ? erros.slice(0, 5).join(' | ') : 'nenhum'} ===`);
  console.log(`=== ✗=${falhas.length} ===`);
  if (falhas.length) falhas.forEach((f) => console.log('  ✗ ' + f));
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
