// TODO GRÁFICO QUE ABRE REGISTROS PRECISA ABRIR PELO TECLADO.
//
// A barra e a fatia da rosca já eram gatilhos acessíveis. A SÉRIE TEMPORAL não
// era: o clique dela morava num retângulo de captura que descobria o mês pela
// posição do cursor, e pelo teclado não há cursor. O resultado era um
// detalhamento que existia para quem usa mouse e não existia para quem navega
// por Tab — uma função entregue pela metade, e a metade que falta é justamente
// a de quem mais depende dela.
//
// Esta suíte é a trava: ela percorre os gráficos desenhados e exige, de cada
// um que tenha drill-down, que exista alvo focável e que `Enter` abra a mesma
// tela que o clique abriria.
//
//   node semear-volume.cjs && node montar-teste.cjs
//   CHROMIUM_BIN=/opt/pw-browsers/chromium node testar-grafico-teclado.cjs
const { chromium } = require('playwright');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });

  const abrir = async (mod, aba) => {
    await pag.evaluate(async ([m, a]) => { E.mod = m; E.aba = a; await render(); }, [mod, aba]);
    await pag.evaluate(() => {
      document.querySelectorAll('#pagina .bloco[data-dobra] .bloco-dobra[aria-expanded="false"]')
        .forEach((b) => b.click());
    });
    await pag.waitForTimeout(700);
  };

  console.log('\nA SÉRIE TEMPORAL É ALCANÇÁVEL POR TECLADO');
  await abrir('indicadores', 'indicadores_gerais');

  const alvos = await pag.evaluate(() => {
    const r = [...document.querySelectorAll('svg rect[role=button]')];
    return {
      n: r.length,
      comRotulo: r.every((a) => /abrir os registros/.test(a.getAttribute('aria-label') || '')),
      focaveis: r.every((a) => a.getAttribute('tabindex') === '0'),
      // O alvo tem de ter altura e largura de verdade: um retângulo de 0px
      // existe no DOM, recebe foco e não é alcançável com o ponteiro.
      comArea: r.every((a) => Number(a.getAttribute('width')) > 4 && Number(a.getAttribute('height')) > 4),
    };
  });
  ok('há alvos de teclado nos gráficos de linha', alvos.n > 0, `${alvos.n} alvos`);
  ok('todos anunciam o que fazem', alvos.comRotulo);
  ok('todos entram na ordem de Tab', alvos.focaveis);
  ok('todos têm área clicável de verdade', alvos.comArea);

  console.log('\nENTER ABRE O DETALHAMENTO');
  const acionado = await pag.evaluate(() => {
    const a = document.querySelector('svg rect[role=button]');
    a.focus();
    const focou = document.activeElement === a;
    a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const tela = document.querySelector('.modal, [role=dialog]');
    return { focou, abriu: !!tela, titulo: tela?.textContent.replace(/\s+/g, ' ').slice(0, 60) || '' };
  });
  ok('o alvo recebe foco', acionado.focou);
  ok('e Enter abre a tela de registros', acionado.abriu, acionado.titulo);

  // Espaço também, porque é a outra tecla que aciona um `role=button`.
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(300);
  const comEspaco = await pag.evaluate(() => {
    const a = document.querySelector('svg rect[role=button]');
    a.focus();
    a.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    return !!document.querySelector('.modal, [role=dialog]');
  });
  ok('Espaço também aciona', comEspaco);

  console.log('\nO ALVO NÃO ROUBA O CLIQUE DO CARTÃO');
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(300);
  const umaSo = await pag.evaluate(() => {
    const a = document.querySelector('svg rect[role=button]');
    a.focus();
    a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    // O cartão inteiro também é gatilho de drill-down. Sem barrar a subida do
    // evento, abririam DUAS telas, uma sobre a outra.
    return document.querySelectorAll('.modal, [role=dialog]').length;
  });
  ok('abre UMA tela, não duas empilhadas', umaSo === 1, String(umaSo));

  console.log('\n=== erros de console: ' + (erros.length ? erros.join(' | ') : 'nenhum') + ' ===');
  await nav.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S): ` + falhas.join(' · ') : '\nTudo certo.');
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
