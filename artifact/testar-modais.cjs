// Item 5: toda tela flutuante redimensionável, com tela cheia, cabeçalho e
// rodapé presos, coluna ajustável e tamanho que persiste.
// Telas flutuantes: redimensionáveis, com tela cheia, cabeçalho e rodapé
// presos, coluna ajustável e tamanho que persiste entre aberturas.
//
// O gestor pediu isso depois de encontrar detalhamento com coluna cortada e
// sem jeito de alargar. Cada conferência aqui é um desses atritos.
const { chromium } = require('playwright');
const { irPara } = require('./ajuda-testes.cjs');
(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1000 } });
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const falhas = [];
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  await pag.evaluate(() => { try { localStorage.removeItem('iarx-modal-detalhamento'); } catch (e) {} });
  await irPara(pag, 'Painel', 1800);

  // Abre um detalhamento pelo primeiro indicador.
  await pag.click('.kpi.drill');
  await pag.waitForTimeout(1400);

  const base = await pag.evaluate(() => {
    const m = document.querySelector('.modal');
    return m ? {
      largura: m.offsetWidth, altura: m.offsetHeight,
      puxadores: m.querySelectorAll('[data-puxa]').length,
      temCheia: !!m.querySelector('[data-cheia]'),
      rotuloCheia: m.querySelector('[data-cheia]')?.getAttribute('aria-label'),
      rotulosPuxador: [...m.querySelectorAll('[data-puxa]')].map((p) => p.getAttribute('aria-label')),
    } : null;
  });
  console.log('\n--- estrutura ---');
  ok('a tela tem as três alças de redimensionar', base && base.puxadores === 3, `${base?.puxadores}`);
  ok('e botão de tela cheia com rótulo', base && base.temCheia && /tela cheia/i.test(base.rotuloCheia), base?.rotuloCheia);
  ok('cada alça se anuncia', base && base.rotulosPuxador.every((r) => /arraste/i.test(r || '')),
    (base?.rotulosPuxador || []).join(' · '));

  // Cabeçalho e rodapé presos: rolar o miolo não os move.
  const presos = await pag.evaluate(() => {
    const m = document.querySelector('.modal');
    const corpo = m.querySelector('[data-corpo]');
    const antes = { h: m.querySelector('header').getBoundingClientRect().top,
                    a: m.querySelector('.acoes').getBoundingClientRect().top };
    // A área de dados é a caixa da tabela: é ela que rola, e é o que mantém
    // cabeçalho e rodapé da tela flutuante parados.
    const dados = m.querySelector('.rol') || corpo;
    const rolavel = dados.scrollHeight > dados.clientHeight;
    dados.scrollTop = dados.scrollHeight;
    return { rolavel, antes,
      depois: { h: m.querySelector('header').getBoundingClientRect().top,
                a: m.querySelector('.acoes').getBoundingClientRect().top } };
  });
  console.log('\n--- cabeçalho e rodapé ---');
  ok('a área de dados rola por conta própria', presos.rolavel,
    presos.rolavel ? 'o conteúdo excede a caixa' : 'conteúdo curto — sem rolagem');
  ok('o cabeçalho não se move ao rolar', Math.abs(presos.antes.h - presos.depois.h) < 1);
  ok('o rodapé não se move ao rolar', Math.abs(presos.antes.a - presos.depois.a) < 1);

  // Arrastar o canto.
  console.log('\n--- redimensionar ---');
  const canto = await pag.$('.puxador.canto');
  const cx = await canto.boundingBox();
  await pag.mouse.move(cx.x + cx.width / 2, cx.y + cx.height / 2);
  await pag.mouse.down();
  // A altura já abre no teto da janela, então o movimento que prova o eixo
  // vertical é encolher; a largura cresce.
  await pag.mouse.move(cx.x + 200, cx.y - 260, { steps: 12 });
  await pag.mouse.up();
  await pag.waitForTimeout(500);
  const depois = await pag.evaluate(() => {
    const m = document.querySelector('.modal');
    return { largura: m.offsetWidth, altura: m.offsetHeight };
  });
  ok('arrastar o canto muda largura e altura',
    depois.largura > base.largura && depois.altura < base.altura,
    `${base.largura}×${base.altura} → ${depois.largura}×${depois.altura}`);

  const guardado = await pag.evaluate(() => {
    try { return localStorage.getItem('iarx-modal-detalhamento'); } catch (e) { return null; }
  });
  ok('o tamanho fica guardado', !!guardado && /largura/.test(guardado), guardado);

  // Coluna ajustável.
  const col = await pag.evaluate(() => {
    const th = document.querySelector('.modal thead th.ajustavel');
    return th ? { largura: th.offsetWidth, rotulo: th.getAttribute('aria-label') || th.textContent.trim(),
      alca: !!th.querySelector('.puxa-col'), rotuloAlca: th.querySelector('.puxa-col')?.getAttribute('aria-label') } : null;
  });
  console.log('\n--- coluna ajustável ---');
  ok('as colunas têm alça de largura', !!col && col.alca, col ? col.rotuloAlca : 'sem alça');
  if (col) {
    const alca = await pag.$('.modal thead th.ajustavel .puxa-col');
    const ab = await alca.boundingBox();
    await pag.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2);
    await pag.mouse.down();
    await pag.mouse.move(ab.x + 90, ab.y + ab.height / 2, { steps: 10 });
    await pag.mouse.up();
    await pag.waitForTimeout(400);
    const larg = await pag.$eval('.modal thead th.ajustavel', (th) => th.offsetWidth);
    ok('arrastar a alça alarga a coluna', larg > col.largura + 40, `${col.largura}px → ${larg}px`);
  }

  // Tela cheia e persistência entre aberturas.
  console.log('\n--- tela cheia e persistência ---');
  await pag.click('.modal [data-cheia]');
  await pag.waitForTimeout(600);
  const cheia = await pag.evaluate(() => {
    const m = document.querySelector('.modal');
    const r = m.getBoundingClientRect();
    return { ocupa: Math.round(r.width) === innerWidth - 28 || Math.round(r.width) >= innerWidth - 30,
      altura: Math.round(r.height), janela: innerHeight,
      pressionado: m.querySelector('[data-cheia]').getAttribute('aria-pressed'),
      rotulo: m.querySelector('[data-cheia]').getAttribute('aria-label') };
  });
  ok('a tela cheia se anuncia e restaura', cheia.pressionado === 'true' && /restaurar/i.test(cheia.rotulo),
    `${cheia.rotulo} · altura ${cheia.altura} de ${cheia.janela}`);

  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(500);
  await pag.click('.kpi.drill');
  await pag.waitForTimeout(1200);
  const reaberta = await pag.evaluate(() => {
    const m = document.querySelector('.modal');
    return { cheia: m.classList.contains('cheia'), largura: m.offsetWidth };
  });
  ok('reabre no estado escolhido', reaberta.cheia, `cheia=${reaberta.cheia} · ${reaberta.largura}px`);

  console.log('\n=== falhas: ' + (falhas.length ? '\n' + falhas.join('\n') : 'nenhuma') + ' ===');
  console.log('=== erros: ' + (erros.length ? erros.join(' | ') : 'nenhum') + ' ===');
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
