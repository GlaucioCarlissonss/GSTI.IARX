// QUANTO CUSTA DESENHAR CADA TELA da versão hospedada.
//
// Aqui não há pacote a dividir: o sistema inteiro é um arquivo só, e é assim
// de propósito — ele precisa abrir de um clique, sem servidor. O que sobra
// para medir é o TRABALHO: quanto tempo o navegador gasta para montar cada
// aba, e quanto desse tempo é recálculo do que já estava calculado.
//
//   node semear-projecao.cjs && node montar-teste.cjs   (se não houver base)
//   CHROMIUM_BIN=/opt/pw-browsers/chromium node medir-render.cjs
//
// Cada aba é medida TRÊS vezes e fica a mediana: a primeira volta de uma aba
// carrega o que as outras reaproveitam, e tomá-la sozinha mediria o acaso.
const { chromium } = require('playwright');


const ms = (n) => String(Math.round(n)).padStart(6) + ' ms';

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });

  // Os IDs das abas, na ordem da navegação. O módulo precisa ser trocado
  // junto: `render()` lê os dois, e só a aba daria a tela errada.
  const abas = await pag.evaluate(() =>
    MODULOS_NAV.flatMap((m) => m.abas.map((id) => ({ mod: m.id, aba: id }))));

  console.log(`\nTEMPO DE RENDER POR ABA (mediana de 3)\n`);
  console.log('  aba                                 render');
  console.log('  ' + '-'.repeat(50));

  const total = [];
  for (const { mod, aba } of abas) {
    const marcas = [];
    for (let v = 0; v < 3; v++) {
      const t = await pag.evaluate(async ([m, a]) => {
        // `render()` é a função que redesenha a tela inteira. Medir em volta
        // dela é medir exatamente o que o clique numa aba custa.
        //
        // O `await` NÃO é detalhe: `render` é assíncrona, e medir só a parte
        // síncrona dela dava 0 ms em telas que levam décimos de segundo — um
        // número que faria qualquer otimização parecer desnecessária.
        E.mod = m;
        E.aba = a;
        const antes = performance.now();
        await render();
        return performance.now() - antes;
      }, [mod, aba]);
      marcas.push(t);
      await pag.waitForTimeout(40);
    }
    const mediana = marcas.sort((a, b) => a - b)[1];
    total.push(mediana);
    console.log(`  ${aba.padEnd(33)} ${ms(mediana)}`);
  }

  const soma = total.reduce((s, n) => s + n, 0);
  console.log('  ' + '-'.repeat(50));
  console.log(`  ${('TOTAL das ' + abas.length + ' abas').padEnd(33)} ${ms(soma)}`);
  console.log(`  ${'a mais lenta'.padEnd(33)} ${ms(Math.max(...total))}`);

  console.log('\nerros: ' + (erros.length ? erros.join(' | ') : 'nenhum'));
  await nav.close();
  process.exit(erros.length ? 1 : 0);
})();
