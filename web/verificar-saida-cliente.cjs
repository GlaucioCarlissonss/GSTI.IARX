// A saída do contratante, conferida no navegador.
//
// O que está em jogo não é o clique: é a PERGUNTA. Clicar no nome do cliente
// no meio de uma análise não pode jogar a pessoa na tela de escolha sem aviso,
// porque o que se perde — filtros, competência, unidade em foco — não volta
// sozinho. Então o cartão inteiro leva à confirmação, e só o "sim" sai.
//
// Suba uma base descartável e o servidor sobre ela — NUNCA data/gsti.sqlite:
//   DATABASE_PATH=/tmp/claude-0/verif-saida.sqlite npx tsx server/src/db/preparar-verificacao-v2.ts
//   DATABASE_PATH=/tmp/claude-0/verif-saida.sqlite PORT=3401 JWT_SECRET=<32+ caracteres> node server/dist/index.js
//   BASE_URL=http://localhost:3401 node web/verificar-saida-cliente.cjs
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3401';
const SENHA = process.env.SENHA || 'varredura2026';

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pag = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/ERR_|net::|favicon|Failed to load resource/.test(t)) erros.push('console: ' + t);
  });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto(BASE + '/');
  await pag.waitForLoadState('networkidle');
  await pag.fill('input[autocomplete="username"], input[name="usuario"]', 'gestora');
  await pag.fill('input[type="password"]', SENHA);
  await pag.click('button[type="submit"]');
  await pag.waitForSelector('h1', { timeout: 15000 });
  await pag.waitForTimeout(800);

  // Entra no cliente, seja pela pergunta (vários) ou direto (um só).
  if (await pag.$('.cartao button')) {
    await pag.click('.cartao button');
  }
  await pag.waitForSelector('.menu a', { timeout: 15000 });
  await pag.waitForTimeout(600);

  console.log('O CARTÃO DO CLIENTE');
  const cartao = await pag.$('.cliente-atual');
  ok('o cartão do cliente existe', !!cartao);
  ok('o cartão inteiro é operável', await cartao.getAttribute('role') === 'button');
  ok('o cartão recebe foco de teclado', await cartao.getAttribute('tabindex') === '0');
  const rotulo = await cartao.getAttribute('aria-label');
  ok('o rótulo diz o que o clique faz', /sair e escolher outro/i.test(rotulo || ''), String(rotulo));

  console.log('\nCLICAR PERGUNTA, NÃO SAI');
  await cartao.click();
  await pag.waitForTimeout(500);
  const titulo = await pag.$eval('.modal h2, .modal h3, dialog h2, dialog h3', (h) => h.textContent.trim()).catch(() => null);
  ok('abre a confirmação', /Sair deste cliente/i.test(titulo || ''), String(titulo));
  ok('a confirmação nomeia o cliente', /Você está em/i.test(await pag.innerText('body')));
  ok('ainda no cliente', (await pag.$$('.menu a')).length > 0);

  console.log('\nFICAR NÃO SAI');
  await pag.click('button:has-text("Ficar neste cliente")');
  await pag.waitForTimeout(500);
  ok('a confirmação fecha', (await pag.$$('button:has-text("Ficar neste cliente")')).length === 0);
  ok('o cliente continua em contexto', (await pag.$$('.menu a')).length > 0);
  ok('a escolha continua guardada', !!(await pag.evaluate(() => localStorage.getItem('gsti.cliente'))));

  console.log('\nTECLADO ABRE A MESMA PERGUNTA');
  await pag.focus('.cliente-atual');
  await pag.keyboard.press('Enter');
  await pag.waitForTimeout(500);
  ok('Enter no cartão abre a confirmação', (await pag.$$('button:has-text("Ficar neste cliente")')).length === 1);
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(400);

  console.log('\nO BOTÃO LEVA À MESMA PERGUNTA');
  await pag.click('button:has-text("Trocar cliente")');
  await pag.waitForTimeout(500);
  ok('o botão também pergunta', (await pag.$$('button:has-text("Ficar neste cliente")')).length === 1);

  console.log('\nSAIR VAI PARA A ESCOLHA DE CLIENTE');
  await pag.click('button:has-text("Sair e escolher outro")');
  await pag.waitForTimeout(900);
  const depois = await pag.$eval('h1', (h) => h.textContent.trim()).catch(() => '');
  ok('volta à tela de escolher cliente', /Qual cliente/i.test(depois), depois);
  ok('nenhum menu depois de sair', (await pag.$$('.menu a')).length === 0);
  const guardado = await pag.evaluate(() => localStorage.getItem('gsti.cliente'));
  ok('a escolha foi solta', !guardado || guardado === 'null', String(guardado));

  console.log('\nERROS DE CONSOLE: ' + (erros.length ? erros.join(' | ') : 'nenhum'));
  console.log(falhas.length ? `\n${falhas.length} FALHA(S): ` + falhas.join(' · ') : '\nTUDO VERDE');
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
