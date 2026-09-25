// Varredura de ponta a ponta: cada empresa, cada aba, sob volume real.
// Mede tempo de render e falha se qualquer tela produzir erro de console.
const { chromium } = require('playwright');
const { usarEmpresas, usarBase, usarCompetencias, irPara, todasAsAbas } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1280, height: 900 } });
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push('console: ' + m.text()); });

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#abas button', { timeout: 15000 });

  const empresas = await pag.$$eval('#f-empresa option', (os) => os.map((o) => ({ id: o.value, nome: o.textContent })));
  const abas = await todasAsAbas(pag);
  console.log('empresas:', empresas.map((e) => e.nome).join(', '));
  console.log('telas:', abas.map((a) => `${a.modulo} → ${a.aba}`).join(' | '));

  const lentas = [];
  for (const emp of empresas) {
    await usarEmpresas(pag, emp.id);
    await pag.waitForTimeout(600);
    const n = await pag.evaluate(() => Loja.todos(empresaAtiva()).length);
    const linha = [`\n== ${emp.nome} (${n} lançamentos) ==`];

    for (const { aba } of abas) {
      const t0 = Date.now();
      await irPara(pag, aba, 0);
      await pag.waitForFunction(() => !document.querySelector('#pagina .carregando'), null, { timeout: 20000 });
      await pag.waitForTimeout(120);
      const ms = Date.now() - t0;
      if (ms > 1500) lentas.push(`${emp.nome} / ${aba}: ${ms} ms`);

      const diag = await pag.evaluate(() => ({
        vazio: document.querySelector('#pagina').textContent.trim().length < 40,
        // caixa de erro oculta não é falha: várias telas já trazem a sua, vazia
        falha: [...document.querySelectorAll('#pagina .msg.erro')].some((e) => !e.hidden && e.textContent.trim()),
        texto: [...document.querySelectorAll('#pagina .msg.erro')]
          .find((e) => !e.hidden && e.textContent.trim())?.textContent.slice(0, 80) ?? '',
        larguraExcedida: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      }));
      const marca = diag.falha ? 'FALHA' : diag.vazio ? 'VAZIA' : 'ok';
      linha.push(`  ${aba.padEnd(12)} ${String(ms).padStart(5)} ms  ${marca}` +
        (diag.falha ? ' — ' + diag.texto : '') + (diag.larguraExcedida ? '  [rolagem horizontal]' : ''));
      if (diag.falha) erros.push(`${emp.nome}/${aba}: ${diag.texto}`);
    }
    console.log(linha.join('\n'));
  }

  // Largura de telefone, na empresa mais pesada.
  await pag.setViewportSize({ width: 400, height: 800 });
  await usarEmpresas(pag, 'residencial');
  await pag.waitForTimeout(600);
  console.log('\n== 400 px (RESIDENCIAL) ==');
  for (const { aba } of abas) {
    await irPara(pag, aba, 500);
    const excede = await pag.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    console.log(`  ${aba.padEnd(12)} ${excede ? 'ROLAGEM HORIZONTAL' : 'ok'}`);
    if (excede) erros.push(`400px ${aba}: rolagem horizontal`);
  }

  console.log('\n=== erros: ' + (erros.length ? '\n' + erros.join('\n') : 'nenhum') + ' ===');
  await nav.close();
  process.exit(erros.length ? 1 : 0);
})();
