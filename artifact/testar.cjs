const { chromium } = require('playwright');
(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage();
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error') erros.push('console: ' + m.text()); });
  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#abas button', { timeout: 10000 });

  const abas = await pag.$$eval('#abas button', (bs) => bs.map((b) => b.textContent));
  console.log('abas:', abas.join(' | '));

  const clicar = async (rot) => {
    await pag.click(`#abas button:text-is("${rot}")`);
    await pag.waitForTimeout(400);
  };

  // 1. Conferência
  await clicar('Conferência');
  const kpis = await pag.$$eval('.kpi', (ks) => ks.map((k) => k.querySelector('.r').textContent + ' = ' + k.querySelector('.n').textContent));
  console.log('\n-- Conferência (ALIANÇA) --'); kpis.forEach((k) => console.log('  ' + k));
  const comp = await pag.$$eval('.bloco table tbody tr', (rs) => rs.slice(0, 5).map((r) => [...r.cells].map((c) => c.textContent.trim().replace(/\s+/g,' ').slice(0,40)).join(' | ')));
  console.log('  composição:'); comp.forEach((c) => console.log('    ' + c));

  // carrega todas as empresas e lê o total do grupo
  const bt = await pag.$('#c-carregar');
  if (bt) { await bt.click(); await pag.waitForTimeout(3000); }
  const grupo = await pag.evaluate(() => {
    const tr = [...document.querySelectorAll('tr.tot')].find((t) => t.cells[0].textContent.includes('Grupo'));
    return tr ? [...tr.cells].map((c) => c.textContent.trim()).join(' | ') : 'não encontrado';
  });
  console.log('  GRUPO: ' + grupo);

  // 2. Painel com cada recorte de base
  await clicar('Painel');
  for (let i = 0; i < 4; i++) {
    await pag.selectOption('#f-base', String(i));
    await pag.waitForTimeout(350);
    const t = await pag.$eval('.kpi .n', (n) => n.textContent);
    const rot = await pag.$eval('#f-base option:checked', (o) => o.textContent);
    const comp = await pag.$eval('#p-comp option:checked', (o) => o.textContent).catch(() => '?');
    console.log(`\n  base "${rot}" · ${comp} · total do mês = ${t}`);
  }
  await pag.selectOption('#f-base', '0'); await pag.waitForTimeout(300);

  // 3. Lançamentos: coluna Origem
  await clicar('Lançamentos');
  const cab = await pag.$$eval('.bloco table thead th', (ts) => ts.map((t) => t.textContent.trim()));
  console.log('\n-- Lançamentos --\n  colunas:', cab.join(' | '));
  const orig = await pag.$$eval('.bloco table tbody tr', (rs) => rs.slice(0,4).map((r) => r.cells[0].textContent + ' → ' + r.cells[4].textContent.trim()));
  orig.forEach((o) => console.log('  ' + o));

  // 4. as demais abas montam sem erro
  for (const a of ['Projetos', 'SLA', 'Cadastros', 'Auditoria']) {
    await clicar(a);
    const h = await pag.$eval('#pagina', (p) => p.textContent.slice(0, 60).replace(/\s+/g, ' '));
    console.log(`\n  ${a}: ${h}…`);
  }

  console.log('\n=== erros de console: ' + (erros.length ? '\n' + erros.join('\n') : 'nenhum') + ' ===');
  await nav.close();
  process.exit(erros.length ? 1 : 0);
})();
