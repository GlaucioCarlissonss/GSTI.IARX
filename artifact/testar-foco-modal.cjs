// O foco dentro e fora da tela flutuante.
//
// Um diálogo que se declara `aria-modal="true"` promete que o resto da página
// está inerte. Se o Tab sai dele, a promessa é falsa: a terceira tabulação já
// está no menu, mexendo numa tela que o diálogo diz estar bloqueada — e quem
// navega por teclado não tem como perceber que saiu, porque o modal continua
// desenhado por cima.
//
// E fechar precisa DEVOLVER o foco a quem abriu. Sem isso a pessoa volta para
// o começo da página a cada confirmação, e perde o lugar onde estava lendo.
const { chromium } = require('playwright');
const { irPara } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const conferir = (r, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!ok) falhas.push(r); };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });

  // ------------------------------------------- confirmação, que não tem campo
  console.log('\nCONFIRMAÇÃO SEM CAMPO — o foco tem de entrar assim mesmo');
  await pag.focus('#bt-trocar-cliente');
  await pag.click('#bt-trocar-cliente');
  await pag.waitForSelector('.fundo .modal', { timeout: 8000 });
  await pag.waitForTimeout(300);
  conferir('o foco entra na tela flutuante',
    await pag.evaluate(() => !!document.querySelector('.fundo')?.contains(document.activeElement)));

  // Oito tabulações: mais do que o diálogo tem de controles, de propósito —
  // é depois da volta que um trap mal feito deixa escapar.
  for (let i = 0; i < 8; i += 1) await pag.keyboard.press('Tab');
  conferir('oito tabulações não saem do diálogo',
    await pag.evaluate(() => !!document.querySelector('.fundo')?.contains(document.activeElement)),
    await pag.evaluate(() => (document.activeElement.textContent || '').trim().slice(0, 30)));

  // E para trás também: Shift+Tab a partir do primeiro volta para o último.
  for (let i = 0; i < 10; i += 1) await pag.keyboard.press('Shift+Tab');
  conferir('dez tabulações para trás também não saem',
    await pag.evaluate(() => !!document.querySelector('.fundo')?.contains(document.activeElement)),
    await pag.evaluate(() => (document.activeElement.textContent || '').trim().slice(0, 30)));

  console.log('\nFECHAR DEVOLVE O FOCO A QUEM ABRIU');
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(300);
  conferir('Escape fecha', (await pag.$$('.fundo .modal')).length === 0);
  conferir('o foco voltou para o botão que abriu',
    await pag.evaluate(() => document.activeElement?.id === 'bt-trocar-cliente'),
    await pag.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));

  // --------------------------------------------- formulário, que tem campo
  console.log('\nFORMULÁRIO — o foco entra no primeiro campo');
  await irPara(pag, 'Feriados', 700);
  await pag.focus('#fer-novo');
  await pag.click('#fer-novo');
  await pag.waitForSelector('.fundo .modal', { timeout: 8000 });
  await pag.waitForTimeout(300);
  const primeiro = await pag.evaluate(() => {
    const a = document.activeElement;
    const campos = [...document.querySelectorAll('.fundo [data-corpo] input,.fundo [data-corpo] select,.fundo [data-corpo] textarea')];
    return { ehCampo: campos.includes(a), ehOPrimeiro: campos[0] === a, nome: a?.name || a?.tagName };
  });
  conferir('o foco entra no primeiro campo do formulário',
    primeiro.ehCampo && primeiro.ehOPrimeiro, JSON.stringify(primeiro));
  for (let i = 0; i < 12; i += 1) await pag.keyboard.press('Tab');
  conferir('doze tabulações não saem do formulário',
    await pag.evaluate(() => !!document.querySelector('.fundo')?.contains(document.activeElement)));
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(300);
  conferir('o foco voltou para o botão que abriu o formulário',
    await pag.evaluate(() => document.activeElement?.id === 'fer-novo'),
    await pag.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));

  // ------------------------------------------------------- modais empilhados
  console.log('\nEMPILHADOS — Tab circula só no de cima, e fechar volta ao de baixo');
  await pag.click('#fer-novo');
  await pag.waitForSelector('.fundo .modal', { timeout: 8000 });
  const abriuSegundo = await pag.evaluate(() => {
    // Um segundo diálogo por cima do primeiro, como uma confirmação faria.
    abrirModal({ titulo: 'Segundo', corpo: '<p class="msg">por cima</p>',
      acoes: '<button type="button" class="bt" data-ok>Ok</button>' });
    return document.querySelectorAll('#modais .fundo').length;
  });
  conferir('dois diálogos empilhados', abriuSegundo === 2, String(abriuSegundo));
  await pag.waitForTimeout(200);
  for (let i = 0; i < 6; i += 1) await pag.keyboard.press('Tab');
  conferir('o Tab fica no de cima, não desce para o de baixo',
    await pag.evaluate(() => {
      const todos = [...document.querySelectorAll('#modais .fundo')];
      return todos[todos.length - 1].contains(document.activeElement);
    }));
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(300);
  conferir('Escape fecha só o de cima', (await pag.$$('#modais .fundo')).length === 1);
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(300);
  conferir('o segundo Escape fecha o de baixo', (await pag.$$('#modais .fundo')).length === 0);

  console.log('\n=== erros de console: ' + (erros.length ? erros.join(' | ') : 'nenhum') + ' ===');
  await nav.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S): ` + falhas.join(' · ') : '\nTudo certo.');
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
