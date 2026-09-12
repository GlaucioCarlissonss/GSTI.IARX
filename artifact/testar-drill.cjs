// Tooltip e drill-down em todo gráfico e todo indicador.
//
// O que este teste protege não é a existência do modal: é a promessa de que os
// números do detalhamento BATEM com o indicador clicado. Se o detalhe viesse
// de outra consulta, poderia divergir do que está na tela, e o gestor não
// teria como saber qual dos dois está certo.
const { chromium } = require('playwright');
const { irPara, usarEmpresas } = require('./ajuda-testes.cjs');

/** Telas com gráfico ou indicador e o que cada uma deve oferecer. */
const TELAS = ['Painel', 'Conferência', 'Projetos', 'Indicadores'];

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push('console: ' + m.text()); });
  const confere = (rotulo, obtido, esperado) => {
    const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
    console.log(`  ${ok ? '✓' : '✗'} ${rotulo}: ${JSON.stringify(obtido)}${ok ? '' : ' (esperado ' + JSON.stringify(esperado) + ')'}`);
    if (!ok) falhas.push(rotulo);
  };
  const fecharModal = async () => {
    await pag.keyboard.press('Escape');
    await pag.waitForTimeout(350);
  };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 15000 });

  // ------------------------------------------------------------- tooltips
  console.log('\nTOOLTIP — todo gráfico responde ao ponteiro');
  for (const tela of TELAS) {
    await irPara(pag, tela, 900);
    const alvos = await pag.$$('svg g[role="button"], svg rect[fill="transparent"], .rank .it');
    if (alvos.length) {
      await alvos[0].hover();
      await pag.waitForTimeout(300);
      const dica = await pag.$eval('#dica', (d) => ({ visivel: d.classList.contains('on'), texto: d.textContent.trim() }));
      confere(`${tela}: o tooltip aparece com conteúdo`, [dica.visivel, dica.texto.length > 3], [true, true]);
      continue;
    }
    // O Gantt não é SVG: as barras levam `title` nativo, que é tooltip do
    // mesmo jeito e ainda funciona com leitor de tela.
    const comTitle = await pag.$$eval('.gantt .barra[title], .gantt td.nome[title]', (es) => es.length);
    confere(`${tela}: os elementos do cronograma têm tooltip`, comTitle > 0, true);
  }

  // ---------------------------------------------------------- drill-down
  console.log('\nDRILL-DOWN — todo indicador abre os registros que o compõem');
  for (const tela of TELAS) {
    await irPara(pag, tela, 900);
    const gatilhos = await pag.$$('.kpi.drill');
    const kpis = await pag.$$('.kpi');
    if (!kpis.length) { console.log(`  · ${tela}: sem indicadores`); continue; }
    confere(`${tela}: há indicadores com drill-down (${gatilhos.length} de ${kpis.length})`, gatilhos.length > 0, true);

    // Acessibilidade: papel, foco e rótulo que diz o que vai abrir.
    const acesso = await pag.$eval('.kpi.drill', (k) => ({
      papel: k.getAttribute('role'),
      foco: k.getAttribute('tabindex'),
      rotulo: k.getAttribute('aria-label'),
    }));
    confere(`${tela}: o indicador é um gatilho acessível`,
      [acesso.papel, acesso.foco, /abrir os registros/.test(acesso.rotulo)], ['button', '0', true]);
  }

  // ------------------------------------------------ os números têm de bater
  console.log('\nCOERÊNCIA — o detalhamento bate com o indicador');
  const conferirKpi = async (tela, indice, nome) => {
    await irPara(pag, tela, 900);
    const kpis = await pag.$$('.kpi.drill');
    if (!kpis[indice]) { console.log(`  · ${tela}/${nome}: indicador ausente neste recorte`); return; }

    const valorNaTela = await kpis[indice].$eval('.n', (n) => n.textContent.trim());
    // Abre pelo TECLADO, que é o caminho que costuma faltar.
    await kpis[indice].focus();
    await pag.keyboard.press('Enter');
    await pag.waitForTimeout(700);

    const modal = await pag.$eval('.modal, [role="dialog"]', (m) => m.textContent.replace(/\s+/g, ' ')).catch(() => '');
    const confere1 = /confere com o indicador/.test(modal);
    const diverge = /diverge do indicador/.test(modal);
    const temRecorte = /Recorte aplicado/.test(modal);
    const temRegistros = /registro\(s\)/.test(modal);
    console.log(`    ${tela} · ${nome} = ${valorNaTela}`);
    confere(`${tela}/${nome}: o detalhe confere com o indicador`, [confere1, diverge], [true, false]);
    confere(`${tela}/${nome}: o detalhe diz o recorte e a contagem`, [temRecorte, temRegistros], [true, true]);
    await fecharModal();
  };

  await conferirKpi('Painel', 0, 'Total do período');
  await conferirKpi('Painel', 1, 'Despesa');
  await conferirKpi('Painel', 2, 'Investimento');
  await conferirKpi('Conferência', 0, 'Base enviada por você');
  await conferirKpi('Conferência', 1, 'Acrescentado pelo sistema');
  await conferirKpi('Conferência', 2, 'Total exibido no painel');
  await conferirKpi('Indicadores', 0, 'Tickets atendidos');
  await conferirKpi('Indicadores', 1, 'Dentro do SLA');

  // ------------------------------------------------------ clique no gráfico
  console.log('\nGRÁFICO — clicar numa barra abre os registros daquele ponto');
  await irPara(pag, 'Painel', 900);
  const barra = await pag.$('svg g[role="button"]');
  confere('a barra é um gatilho acessível',
    await barra.evaluate((g) => [g.getAttribute('role'), g.getAttribute('tabindex'), /abrir os registros/.test(g.getAttribute('aria-label'))]),
    ['button', '0', true]);
  await barra.focus();
  await pag.keyboard.press('Enter');
  await pag.waitForTimeout(700);
  const doGrafico = await pag.$eval('.modal, [role="dialog"]', (m) => m.textContent.replace(/\s+/g, ' ')).catch(() => '');
  confere('o detalhe do gráfico traz registros e confere',
    [/registro\(s\)/.test(doGrafico), /confere com o indicador/.test(doGrafico)], [true, true]);
  await fecharModal();

  console.log('\nRANKING — clicar num item abre os lançamentos dele');
  const item = await pag.$('.rank .it.drill');
  confere('os itens do ranking são gatilhos', !!item, true);
  if (item) {
    const rotulo = await item.$eval('.nm', (n) => n.textContent.trim());
    await item.click();
    await pag.waitForTimeout(700);
    const doRanking = await pag.$eval('.modal, [role="dialog"]', (m) => m.textContent.replace(/\s+/g, ' ')).catch(() => '');
    console.log(`    item "${rotulo}"`);
    confere('o detalhe do ranking confere com a barra',
      [/confere com o indicador/.test(doRanking), /diverge do indicador/.test(doRanking)], [true, false]);
    await fecharModal();
  }

  // As colunas do detalhamento financeiro precisam trazer origem e destino:
  // é a pergunta que motivou o módulo.
  console.log('\nCOLUNAS — o detalhamento financeiro mostra origem e destino');
  await irPara(pag, 'Painel', 900);
  const kpi0 = await pag.$('.kpi.drill');
  await kpi0.click();
  await pag.waitForTimeout(700);
  const cabecalhos = await pag.$$eval('.modal thead th, [role="dialog"] thead th', (ts) => ts.map((t) => t.textContent.trim()));
  confere('as colunas incluem origem do custo e destino',
    ['Origem do custo', 'Destino', 'Procedência', 'Valor'].every((c) => cabecalhos.includes(c)), true);
  await fecharModal();

  // Multi-empresa: o detalhamento acompanha o escopo consolidado.
  console.log('\nESCOPO — o detalhamento acompanha o recorte, inclusive consolidado');
  await usarEmpresas(pag, ['alianca', 'moove']);
  await irPara(pag, 'Painel', 1100);
  const kpiMulti = await pag.$('.kpi.drill');
  if (kpiMulti) {
    await kpiMulti.click();
    await pag.waitForTimeout(700);
    const texto = await pag.$eval('.modal, [role="dialog"]', (m) => m.textContent.replace(/\s+/g, ' ')).catch(() => '');
    confere('o recorte de duas empresas aparece e os números conferem',
      [/Empresa:.*,/.test(texto), /confere com o indicador/.test(texto)], [true, true]);
    await fecharModal();
  }

  console.log('\n=== falhas: ' + (falhas.length ? falhas.join('; ') : 'nenhuma') + ' ===');
  console.log('=== erros de console: ' + (erros.length ? '\n' + erros.join('\n') : 'nenhum') + ' ===');
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
