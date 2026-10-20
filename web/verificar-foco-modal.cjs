// O foco dentro e fora da tela flutuante, no app React.
//
// A MESMA régua de `artifact/testar-foco-modal.cjs`. Um diálogo que se declara
// `aria-modal="true"` promete que o resto da página está inerte: se o Tab sai
// dele, a terceira tabulação já está no menu, mexendo numa tela que o diálogo
// diz estar bloqueada — e quem navega por teclado não percebe que saiu, porque
// o modal continua desenhado por cima. Fechar precisa devolver o foco a quem
// abriu, ou a pessoa volta ao começo da página a cada confirmação.
//
//   DATABASE_PATH=/tmp/claude-0/verif-saida.sqlite PORT=3401 JWT_SECRET=<32+> node server/dist/index.js
//   BASE_URL=http://localhost:3401 node web/verificar-foco-modal.cjs
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3401';
const SENHA = process.env.SENHA || 'varredura2026';

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pag = await nav.newPage({ viewport: { width: 1440, height: 1000 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/ERR_|net::|favicon|Failed to load resource/.test(t)) erros.push(t);
  });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto(BASE + '/');
  await pag.waitForLoadState('networkidle');
  await pag.fill('input[autocomplete="username"], input[name="usuario"]', 'gestora');
  await pag.fill('input[type="password"]', SENHA);
  await pag.click('button[type="submit"]');
  await pag.waitForSelector('h1', { timeout: 15000 });
  await pag.waitForTimeout(700);
  if (await pag.$('.cartao button')) await pag.click('.cartao button');
  await pag.waitForSelector('.menu a', { timeout: 15000 });

  console.log('\nCONFIRMAÇÃO SEM CAMPO — o foco tem de entrar assim mesmo');
  await pag.focus('button:has-text("Trocar cliente")');
  await pag.click('button:has-text("Trocar cliente")');
  await pag.waitForSelector('.modal', { timeout: 8000 });
  await pag.waitForTimeout(400);
  ok('o foco entra na tela flutuante',
    await pag.evaluate(() => !!document.querySelector('.modal')?.contains(document.activeElement)));

  // Oito tabulações: mais do que o diálogo tem de controles, de propósito —
  // é depois da volta que um trap mal feito deixa escapar.
  for (let i = 0; i < 8; i += 1) await pag.keyboard.press('Tab');
  ok('oito tabulações não saem do diálogo',
    await pag.evaluate(() => !!document.querySelector('.modal')?.contains(document.activeElement)),
    await pag.evaluate(() => (document.activeElement.textContent || '').trim().slice(0, 30)));
  for (let i = 0; i < 10; i += 1) await pag.keyboard.press('Shift+Tab');
  ok('dez tabulações para trás também não saem',
    await pag.evaluate(() => !!document.querySelector('.modal')?.contains(document.activeElement)),
    await pag.evaluate(() => (document.activeElement.textContent || '').trim().slice(0, 30)));

  console.log('\nFECHAR DEVOLVE O FOCO A QUEM ABRIU');
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(400);
  ok('Escape fecha', (await pag.$$('.modal')).length === 0);
  ok('o foco voltou para o botão que abriu',
    await pag.evaluate(() => (document.activeElement?.textContent || '').trim() === 'Trocar cliente'),
    await pag.evaluate(() => (document.activeElement?.textContent || document.activeElement?.tagName || '').trim().slice(0, 30)));
  ok('o cliente continua em contexto (Escape não saiu)', (await pag.$$('.menu a')).length > 0);

  console.log('\nFORMULÁRIO — o foco entra no primeiro campo');
  // Os cadastros da web são formulários EM LINHA; quem usa tela flutuante com
  // campos é o lançamento. É nele que o primeiro campo tem de receber o foco.
  await pag.goto(BASE + '/lancamentos');
  await pag.waitForTimeout(1600);
  const abridor = await pag.$('button:has-text("Novo lançamento")');
  if (!abridor) {
    ok('há um formulário de cadastro para abrir', false, 'botão não encontrado em /lancamentos');
  } else {
    await abridor.focus();
    await abridor.click();
    await pag.waitForSelector('.modal', { timeout: 8000 });
    await pag.waitForTimeout(400);
    const primeiro = await pag.evaluate(() => {
      const a = document.activeElement;
      const campos = [...document.querySelectorAll('.modal-corpo input,.modal-corpo select,.modal-corpo textarea')];
      return { ehCampo: campos.includes(a), ehOPrimeiro: campos[0] === a, n: campos.length };
    });
    ok('o foco entra no primeiro campo do formulário',
      primeiro.ehCampo && primeiro.ehOPrimeiro, JSON.stringify(primeiro));
    for (let i = 0; i < 14; i += 1) await pag.keyboard.press('Tab');
    ok('catorze tabulações não saem do formulário',
      await pag.evaluate(() => !!document.querySelector('.modal')?.contains(document.activeElement)));
    await pag.keyboard.press('Escape');
    await pag.waitForTimeout(400);
    ok('o foco voltou para o botão que abriu o formulário',
      await pag.evaluate(() => /Novo lançamento/.test((document.activeElement?.textContent || '').trim())),
      await pag.evaluate(() => (document.activeElement?.textContent || document.activeElement?.tagName || '').trim().slice(0, 30)));
  }

  console.log('\nERROS DE CONSOLE: ' + (erros.length ? erros.join(' | ') : 'nenhum'));
  await nav.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S): ` + falhas.join(' · ') : '\nTUDO VERDE');
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
