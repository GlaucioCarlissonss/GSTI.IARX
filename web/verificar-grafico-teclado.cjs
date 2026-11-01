// A MESMA RÉGUA de `artifact/testar-grafico-teclado.cjs`, no app React.
//
// A série temporal tinha o clique no `<svg>` inteiro, que descobria o mês pela
// posição do cursor, com `role="img"` e sem `tabindex`: pelo teclado não havia
// como abrir o detalhamento de mês nenhum. A barra e o ranking já estavam
// certos; a linha ficou para trás, e ninguém percebeu porque a conferência de
// drill-down nunca chegou a olhar — ela media os cartões FECHADOS, onde
// gráfico nenhum existe no DOM.
//
//   DATABASE_PATH=... PORT=3401 JWT_SECRET=... node server/dist/index.js
//   BASE_URL=http://localhost:3401 node web/verificar-grafico-teclado.cjs
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3401';
const SENHA = process.env.SENHA || 'varredura2026';

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || '/opt/pw-browsers/chromium' });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/ERR_|net::|favicon|Failed to load resource/.test(t)) erros.push(t);
  });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto(BASE + '/');
  await pag.fill('input[autocomplete="username"], input[name="usuario"]', 'gestora');
  await pag.fill('input[type=password]', SENHA);
  await pag.click('button[type=submit]');
  await pag.waitForTimeout(1200);
  if (await pag.$('.cartao button')) await pag.click('.cartao button');
  await pag.waitForSelector('.menu a', { timeout: 15000 });

  await pag.goto(BASE + '/financeiro');
  await pag.waitForTimeout(1800);
  // Cartão fechado não tem gráfico no DOM. Sem abrir, esta suíte passaria
  // sem medir nada — que é exatamente como o defeito sobreviveu até aqui.
  await pag.evaluate(() => {
    document.querySelectorAll('.cartao-dobra[aria-expanded="false"]').forEach((b) => b.click());
  });
  await pag.waitForTimeout(1000);

  console.log('\nTODO GRÁFICO CLICÁVEL TEM ALVO DE TECLADO');
  const svgs = await pag.evaluate(() =>
    [...document.querySelectorAll('svg')].map((s) => ({
      cartao: s.closest('.cartao')?.querySelector('h2,h3')?.textContent.replace(/[+−]/g, '').trim() || '(sem título)',
      // `cursor: pointer` é a marca de que a peça se considera clicável.
      clicavel: getComputedStyle(s).cursor === 'pointer'
        || !!s.querySelector('[role=button]'),
      gatilhos: s.querySelectorAll('[role=button]').length,
    })));
  for (const s of svgs) {
    if (!s.clicavel) continue;
    ok(`"${s.cartao}" tem alvo focável`, s.gatilhos > 0, `${s.gatilhos} gatilho(s)`);
  }
  ok('há gráfico clicável nesta tela', svgs.some((s) => s.clicavel), `${svgs.length} svg(s)`);

  console.log('\nA SÉRIE TEMPORAL ABRE PELO TECLADO');
  const serie = await pag.evaluate(() => {
    const s = [...document.querySelectorAll('svg')].find((x) =>
      /Série temporal/.test(x.closest('.cartao')?.querySelector('h2,h3')?.textContent || ''));
    if (!s) return { ausente: true };
    const alvos = [...s.querySelectorAll('[role=button]')];
    return {
      n: alvos.length,
      comRotulo: alvos.every((a) => /abrir os registros/.test(a.getAttribute('aria-label') || '')),
      focaveis: alvos.every((a) => a.getAttribute('tabindex') === '0'),
    };
  });
  if (serie.ausente) {
    ok('cartão de série temporal presente', false, 'não encontrado nesta tela');
  } else {
    ok('há um alvo por ponto', serie.n > 0, `${serie.n} alvos`);
    ok('todos anunciam o que fazem', serie.comRotulo);
    ok('todos entram na ordem de Tab', serie.focaveis);

    const focou = await pag.evaluate(() => {
      const s = [...document.querySelectorAll('svg')].find((x) =>
        /Série temporal/.test(x.closest('.cartao')?.querySelector('h2,h3')?.textContent || ''));
      const a = s.querySelector('[role=button]');
      a.focus();
      return document.activeElement === a;
    });
    ok('o alvo recebe foco', focou);

    await pag.keyboard.press('Enter');
    await pag.waitForTimeout(1400);
    const modal = await pag.$eval('.modal, [role=dialog]', (x) => x.textContent.replace(/\s+/g, ' ').slice(0, 90))
      .catch(() => null);
    ok('e Enter abre a tela de registros', !!modal, modal || 'não abriu');
    // A conferência do detalhamento tem de bater, como em qualquer drill-down:
    // abrir a tela errada seria pior do que não abrir.
    ok('e o detalhamento confere com o indicador',
      !!modal && /confere com o indicador/.test(modal) && !/diverge/.test(modal), modal || '');
    await pag.keyboard.press('Escape');
    await pag.waitForTimeout(400);
  }

  console.log('\nERROS DE CONSOLE: ' + (erros.length ? erros.join(' | ') : 'nenhum'));
  await nav.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S): ` + falhas.join(' · ') : '\nTUDO VERDE');
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
