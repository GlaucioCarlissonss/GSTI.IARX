// Tooltip e drill-down em todo gráfico e todo indicador do app local.
//
// O que este teste protege não é a existência do modal: é a promessa de que os
// números do detalhamento BATEM com o indicador clicado. Se o detalhe viesse
// de outra consulta, poderia divergir do que está na tela, e o gestor não
// teria como saber qual dos dois está certo.
//
// Uso: com o servidor no ar e uma base com movimento,
//   BASE_URL=http://127.0.0.1:3333 EMAIL=... SENHA=... node web/verificar-drill.cjs
const { chromium } = require('playwright');

const B = process.env.BASE_URL || 'http://127.0.0.1:3333';
(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const erros = [];
  pag.on('pageerror', (e) => erros.push(e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::|401/.test(m.text())) erros.push(m.text()); });
  await pag.goto(B + '/');
  await pag.fill('input[type=email]', process.env.EMAIL || 'gestor@gsti.local');
  await pag.fill('input[type=password]', process.env.SENHA || '');
  await pag.click('button[type=submit]');
  await pag.waitForTimeout(2200);

  const falhas = [];
  const ok = (r, v, e) => { const b = JSON.stringify(v) === JSON.stringify(e);
    console.log(`  ${b ? '✓' : '✗'} ${r}: ${JSON.stringify(v)}${b ? '' : ' (esperado ' + JSON.stringify(e) + ')'}`);
    if (!b) falhas.push(r); };

  for (const [rota, nome] of [['/', 'Painel executivo'], ['/financeiro', 'Dashboard financeiro'], ['/conferencia', 'Conferência'], ['/sla', 'SLA']]) {
    await pag.goto(B + rota);
    await pag.waitForTimeout(1600);
    const kpis = await pag.$$('.indicador');
    const drills = await pag.$$('.indicador.drill');
    const comDica = await pag.$$eval('.indicador[title]', (es) => es.length);
    console.log(`\n--- ${nome} ---`);
    ok('indicadores com drill-down', drills.length > 0, true);
    ok('indicadores com tooltip', comDica === kpis.length, true);
    if (!drills.length) continue;

    const acesso = await pag.$eval('.indicador.drill', (k) => [k.getAttribute('role'), k.getAttribute('tabindex'), /abrir os registros/.test(k.getAttribute('aria-label'))]);
    ok('o indicador é gatilho acessível', acesso, ['button', '0', true]);

    const valor = await pag.$eval('.indicador.drill .numero', (n) => n.textContent.trim());
    await drills[0].focus();
    await pag.keyboard.press('Enter');
    await pag.waitForTimeout(1400);
    const modal = await pag.$eval('.modal, [role=dialog]', (m) => m.textContent.replace(/\s+/g, ' ')).catch(() => '');
    console.log(`    indicador = ${valor}`);
    ok('o detalhe abre e confere com o indicador',
      [/registro\(s\)/.test(modal), /confere com o indicador/.test(modal), /diverge do indicador/.test(modal)],
      [true, true, false]);
    await pag.keyboard.press('Escape');
    await pag.waitForTimeout(400);
  }

  // Gráfico e ranking
  await pag.goto(B + '/financeiro');
  await pag.waitForTimeout(1600);
  console.log('\n--- gráficos ---');
  const barra = await pag.$('svg g[role=button]');
  ok('a barra é gatilho acessível', !!barra, true);
  if (barra) {
    await barra.focus(); await pag.keyboard.press('Enter'); await pag.waitForTimeout(1400);
    const m = await pag.$eval('.modal, [role=dialog]', (x) => x.textContent.replace(/\s+/g, ' ')).catch(() => '');
    ok('o detalhe da barra confere', [/confere com o indicador/.test(m), /diverge/.test(m)], [true, false]);
    await pag.keyboard.press('Escape'); await pag.waitForTimeout(400);
  }
  const rk = await pag.$('.cartao .drill[role=button]:not(.indicador)');
  ok('os itens do ranking são gatilhos', !!rk, true);
  if (rk) {
    const rot = await rk.$eval('span', (n) => n.textContent.trim());
    await rk.click(); await pag.waitForTimeout(1400);
    const m = await pag.$eval('.modal, [role=dialog]', (x) => x.textContent.replace(/\s+/g, ' ')).catch(() => '');
    console.log(`    item "${rot}"`);
    ok('o detalhe do ranking confere', [/confere com o indicador/.test(m), /diverge/.test(m)], [true, false]);
    const cols = await pag.$$eval('.modal thead th, [role=dialog] thead th', (ts) => ts.map((t) => t.textContent.trim()));
    ok('as colunas trazem origem e destino', ['Origem do custo', 'Destino', 'Procedência'].every((c) => cols.includes(c)), true);
    await pag.keyboard.press('Escape');
  }
  console.log('\nerros:', erros.length ? erros : 'nenhum');
  console.log(falhas.length ? `=== ${falhas.length} falha(s) ===` : '=== sem falhas ===');
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
