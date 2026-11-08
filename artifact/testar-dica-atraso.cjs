// O BALÃO SÓ APARECE DEPOIS DE CINCO SEGUNDOS PARADO.
//
// Ele abria no primeiro movimento do cursor. Numa tela de indicadores isso
// quer dizer um texto de quatro linhas por cima do número a cada gesto:
// atravessar a tabela do farol para ler uma coluna piscava o balão no caminho,
// e ele tapava justamente o dado que se queria ler.
//
// O que esta suíte mede é o que o usuário vê, e não o valor da constante: ela
// põe o cursor sobre o indicador e olha o relógio. Os três casos que importam:
//
//   1. não aparece de imediato, nem a um segundo, nem a três;
//   2. aparece depois de cinco segundos PARADO;
//   3. um movimento no meio do caminho REINICIA a contagem — é "parado", e não
//      "faz cinco segundos que entrei aqui";
//   4. o teclado não espera: quem chegou por Tab já escolheu o elemento.
//
//   node semear-volume.cjs && node montar-teste.cjs
//   CHROMIUM_BIN=/opt/pw-browsers/chromium node testar-dica-atraso.cjs
const { chromium } = require('playwright');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  const falhas = [], erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };
  const visivel = () => pag.evaluate(() => {
    const d = document.querySelector('#dica');
    return !!d && d.classList.contains('on');
  });

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  await pag.evaluate(async () => { E.mod = 'indicadores'; E.aba = 'indicadores_gerais'; await render(); });
  await pag.evaluate(() => {
    document.querySelectorAll('#pagina .bloco[data-dobra] .bloco-dobra[aria-expanded="false"]')
      .forEach((b) => b.click());
  });
  await pag.waitForTimeout(1000);

  // Um indicador que de fato tem balão: `title` é o espelho textual da dica.
  //
  // Ele precisa estar DENTRO DA JANELA, e não só no documento: o ponteiro do
  // Playwright é coordenada de tela, e mirar um elemento que ficou abaixo da
  // dobra não acerta nada — o teste passaria por não haver balão, que é o
  // oposto de medir.
  const alvo = await pag.evaluate(() => {
    const k = [...document.querySelectorAll('#pagina .kpi[title]')]
      .find((x) => x.getBoundingClientRect().width > 0);
    if (!k) return null;
    k.scrollIntoView({ block: 'center' });
    const r = k.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    const em = document.elementFromPoint(x, y);
    return { x, y, naJanela: !!em && k.contains(em),
      titulo: (k.getAttribute('title') || '').slice(0, 44) };
  });
  if (!alvo) { console.log('nenhum indicador com dica nesta tela'); process.exit(1); }
  console.log(`alvo: "${alvo.titulo}…"`);
  ok('o alvo está sob o ponteiro — a medição vale', alvo.naJanela);

  console.log('\nPASSANDO O CURSOR, O BALÃO NÃO APARECE');
  await pag.mouse.move(alvo.x, alvo.y);
  ok('nem no primeiro movimento', !(await visivel()));
  await pag.waitForTimeout(1000);
  ok('nem a um segundo parado', !(await visivel()));
  await pag.waitForTimeout(2000);
  ok('nem a três', !(await visivel()));

  console.log('\nAOS CINCO SEGUNDOS PARADO, APARECE');
  await pag.waitForTimeout(2300);
  ok('o balão abre', await visivel());
  const texto = await pag.$eval('#dica', (d) => d.textContent.replace(/\s+/g, ' ').trim().slice(0, 50));
  ok('com o conteúdo do indicador', texto.length > 0, texto);

  console.log('\nJÁ ABERTO, ELE SEGUE O CURSOR SEM PISCAR');
  // Movimento CURTO, de propósito: sair do elemento é `mouseleave`, e aí o
  // balão deve mesmo sumir e a contagem recomeçar no vizinho. O que se mede
  // aqui é o outro caso — mexer DENTRO do mesmo alvo não pode fazer o balão
  // piscar nem reiniciar a espera.
  const antes = await pag.$eval('#dica', (d) => d.getBoundingClientRect().left);
  await pag.mouse.move(alvo.x + 3, alvo.y + 2);
  await pag.waitForTimeout(120);
  const mesmo = await pag.evaluate(([x, y]) => {
    const a = document.elementFromPoint(x, y), b = document.elementFromPoint(x + 3, y + 2);
    return !!a && !!b && a === b;
  }, [alvo.x, alvo.y]);
  const depois = await pag.$eval('#dica', (d) => d.getBoundingClientRect().left);
  if (!mesmo) {
    console.log('  · três pixels já caem em outro elemento aqui — caso não exercitado');
  } else {
    ok('continua na tela depois de mover', await visivel());
    ok('e acompanhou o cursor', Math.abs(depois - antes) >= 2, `${Math.round(antes)}px → ${Math.round(depois)}px`);
  }

  console.log('\nSAIR FECHA, E O MOVIMENTO REINICIA A CONTAGEM');
  await pag.mouse.move(5, 5);
  await pag.waitForTimeout(150);
  ok('sai de cima e o balão some', !(await visivel()));

  await pag.mouse.move(alvo.x, alvo.y);
  await pag.waitForTimeout(4000);
  // Um pixel é movimento: se a contagem fosse desde a ENTRADA, o balão abriria
  // em 1s a partir daqui. Como ela reinicia, ainda faltam cinco segundos.
  await pag.mouse.move(alvo.x + 1, alvo.y);
  await pag.waitForTimeout(1800);
  ok('mexer aos 4s adia o balão', !(await visivel()), 'nada na tela 5,8s após entrar');
  await pag.waitForTimeout(3500);
  ok('e ele abre 5s depois da ÚLTIMA parada', await visivel());

  console.log('\nO TECLADO NÃO ESPERA');
  await pag.mouse.move(5, 5);
  await pag.waitForTimeout(150);
  const focou = await pag.evaluate(() => {
    const k = [...document.querySelectorAll('#pagina .kpi[title]')]
      .find((x) => x.getBoundingClientRect().width > 0);
    k.scrollIntoView({ block: 'center' });
    k.focus();
    return document.activeElement === k;
  });
  ok('o indicador recebe foco', focou);
  await pag.waitForTimeout(120);
  ok('e o balão aparece na hora', await visivel(), 'sem os 5 segundos');

  console.log('\n=== erros de console: ' + (erros.length ? erros.join(' | ') : 'nenhum') + ' ===');
  await nav.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S): ` + falhas.join(' · ') : '\nTudo certo.');
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
