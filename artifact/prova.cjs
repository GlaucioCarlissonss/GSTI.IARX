// Prova de que a troca por token não moveu um pixel: compara o estilo
// COMPUTADO de cada elemento que tinha espaçamento inline.
const { chromium } = require('playwright');
const { irPara, congelarRelogio } = require('./ajuda-testes.cjs');
(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  await congelarRelogio(pag);
  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  const medir = async (rotulo) => {
    await irPara(pag, rotulo, 2500);
    return pag.evaluate(() => {
      const fora = [];
      for (const el of document.querySelectorAll('#pagina [style]')) {
        const s = getComputedStyle(el);
        const t = el.getAttribute('style');
        if (!/margin|padding|gap/.test(t)) continue;
        fora.push([s.marginTop, s.marginBottom, s.marginLeft, s.marginRight,
          s.paddingTop, s.paddingBottom, s.paddingLeft, s.paddingRight, s.gap].join('|'));
      }
      return fora;
    });
  };
  const telas = ['Indicadores Gerais', 'Lançamentos', 'Projetos', 'Chamados'];
  const r = {};
  for (const t of telas) r[t] = await medir(t);
  console.log(JSON.stringify(r));
  await nav.close();
})();
