// Relatório financeiro — a tabela dinâmica que o gestor enviou como modelo.
//
// O teste confere contra os NÚMEROS DO ANEXO, não contra o que o código
// produz: é a única forma de garantir que o relatório reproduz o que ele já
// monta no Excel, e não apenas que é internamente consistente.
const { chromium } = require('playwright');
const { irPara } = require('./ajuda-testes.cjs');

/** Recorte Jan..Mai/26 do anexo, por filial e, dentro de AHC-SE, por categoria. */
const ANEXO = {
  filiais: {
    'AHC SE': { '01/2026': 5413.23, '02/2026': 3056.83, '03/2026': 3492.28, '04/2026': 3580.15, '05/2026': 3739.28, total: 19281.77 },
    'AHC RN': { '01/2026': 9088.81, '02/2026': 11357.38, '03/2026': 6654.08, '04/2026': 21911.26, '05/2026': 11668.39, total: 60679.92 },
  },
  categoriasDeAhcSe: {
    'Equipamentos de TI': { '01/2026': 1008.0, '02/2026': 2506.94, '03/2026': 2642.49, '04/2026': 2592.13, '05/2026': 1307.2, total: 10056.76 },
    'Licenças de Softwares': { '01/2026': 1692.24, '05/2026': 1732.24, total: 3424.48 },
    'Locação de Impressora': { '01/2026': 600.0, '04/2026': 834.4, total: 1434.4 },
    'Materiais de TI': { '01/2026': 210.0, total: 210.0 },
    'Serviços Técnicos': { '01/2026': 1200.0, total: 1200.0 },
    'Telefonia/Internet': { '01/2026': 702.99, '02/2026': 549.89, '03/2026': 849.79, '04/2026': 153.62, '05/2026': 699.84, total: 2956.13 },
  },
};

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1600, height: 1100 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push('console: ' + m.text()); });
  const confere = (rotulo, obtido, esperado) => {
    const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
    console.log(`  ${ok ? '✓' : '✗'} ${rotulo}: ${JSON.stringify(obtido)}${ok ? '' : ' (esperado ' + JSON.stringify(esperado) + ')'}`);
    if (!ok) falhas.push(rotulo);
  };
  const num = (t) => Number(String(t).replace(/[^\d,]/g, '').replace(',', '.')) || 0;

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 15000 });
  await pag.evaluate(() => localStorage.removeItem('iarx-relatorio-expandidos'));
  // Recorta Jan..Mai/26, como no anexo.
  await pag.evaluate(() => { E.filtros.de = '2026-01'; E.filtros.ate = '2026-05'; });
  await irPara(pag, 'Relatório', 1300);

  const colunas = await pag.$$eval('table.pivot thead th', (ts) => ts.map((t) => t.textContent.trim()));
  const lerLinhas = (seletor) =>
    pag.$$eval(seletor, (rs) =>
      rs.map((r) =>
        [...r.cells].map((c) =>
          c.textContent.trim().replace(/\s+/g, ' ').replace(/^[−+]\s*/, '').replace(/ \d+ lanç\.$/, ''),
        ),
      ),
    );

  console.log('\nESTRUTURA — igual à tabela dinâmica do anexo');
  confere(
    'meses nas colunas, Total Geral na ponta',
    [colunas[0], colunas.slice(1, 6), colunas[colunas.length - 1]],
    ['Rótulos de linha', ['01/2026', '02/2026', '03/2026', '04/2026', '05/2026'], 'Total Geral'],
  );
  confere(
    'abre recolhido, como o anexo',
    (await pag.$$eval('.pivot-grupo', (bs) => bs.map((b) => b.getAttribute('aria-expanded')))).every((v) => v === 'false'),
    true,
  );
  confere('há linha de Total Geral no rodapé', (await pag.$$('table.pivot tfoot tr')).length, 1);

  console.log('\nNÍVEL 1 — os totais por filial batem com o anexo');
  const nivel1 = await lerLinhas('table.pivot tbody tr.grupo-1');
  for (const [nome, esperado] of Object.entries(ANEXO.filiais)) {
    const linha = nivel1.find((l) => l[0] === nome);
    if (!linha) {
      falhas.push(`filial ${nome} não apareceu`);
      console.log(`  ✗ ${nome}: não apareceu`);
      continue;
    }
    const obtido = Object.fromEntries(
      Object.keys(esperado).filter((k) => k !== 'total').map((m) => [m, num(linha[colunas.indexOf(m)])]),
    );
    obtido.total = num(linha[colunas.length - 1]);
    confere(nome, obtido, esperado);
  }

  console.log('\nNÍVEL 2 — as categorias de AHC-SE batem com o anexo');
  const btSe = await pag.$('.pivot-grupo[aria-label*="AHC SE"]');
  await btSe.focus();
  await pag.keyboard.press('Enter'); // pelo TECLADO
  await pag.waitForTimeout(600);
  const nivel2 = await lerLinhas('table.pivot tbody tr.grupo-2');
  for (const [nome, esperado] of Object.entries(ANEXO.categoriasDeAhcSe)) {
    const linha = nivel2.find((l) => l[0] === nome);
    if (!linha) {
      falhas.push(`categoria ${nome} não apareceu`);
      console.log(`  ✗ ${nome}: não apareceu`);
      continue;
    }
    const obtido = Object.fromEntries(
      Object.keys(esperado).filter((k) => k !== 'total').map((m) => [m, num(linha[colunas.indexOf(m)])]),
    );
    obtido.total = num(linha[colunas.length - 1]);
    confere(nome, obtido, esperado);
  }
  confere(
    'a soma das categorias é o total da filial',
    Math.round(nivel2.reduce((s, l) => s + num(l[colunas.length - 1]), 0) * 100) / 100,
    ANEXO.filiais['AHC SE'].total,
  );

  console.log('\nNÍVEL 3 — o lançamento, com tooltip e clique');
  const btCat = await pag.$('tr.grupo-2 .pivot-grupo');
  await btCat.click();
  await pag.waitForTimeout(700);
  confere('a categoria aberta mostra os lançamentos', (await pag.$$('tr.lancamento')).length > 0, true);

  const soma = await pag.$eval('tr.soma-detalhe', (r) => r.textContent.replace(/\s+/g, ' ').trim());
  console.log('    ' + soma);
  confere('a soma do detalhe confere com o total da linha', /confere com o total da linha/.test(soma), true);

  const tip = await pag.$eval('tr.lancamento', (r) => r.title);
  confere(
    'o tooltip traz origem do custo e destino do pagamento',
    [/Origem do custo:/.test(tip), /Destino do pagamento:/.test(tip), /Clique para ver/.test(tip)],
    [true, true, true],
  );

  await pag.click('tr.lancamento');
  await pag.waitForTimeout(600);
  const ficha = await pag.$$eval('.ficha dt', (ds) => ds.map((d) => d.textContent.trim()));
  confere(
    'o clique abre o detalhamento completo',
    ['Descrição', 'Origem do custo', 'Destino do pagamento', 'Documento vinculado'].every((r) => ficha.includes(r)),
    true,
  );

  console.log('\nPERSISTÊNCIA');
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(400);
  await irPara(pag, 'Painel', 500);
  await irPara(pag, 'Relatório', 900);
  confere('o que estava aberto continua aberto ao voltar', (await pag.$$('tr.lancamento')).length > 0, true);

  // ------------------------------------------------ cabeçalho e total presos
  //
  // São 24 colunas de mês e centenas de linhas: rolar sem isso faz perder de
  // vista de que competência é a coluna e quanto dá o total.
  console.log('\nFIXOS — o que não pode sumir ao rolar');
  await pag.click('#r-abrir');
  await pag.waitForTimeout(1200);

  const medir = () => pag.evaluate(() => {
    const c = document.querySelector('.rol-fixo');
    const cx = c.getBoundingClientRect();
    const th = document.querySelector('.pivot thead th').getBoundingClientRect();
    const tf = document.querySelector('.pivot tfoot th').getBoundingClientRect();
    const rot = document.querySelector('.pivot tbody tr th:first-child, .pivot tbody tr td:first-child');
    return {
      rola: c.scrollHeight > c.clientHeight,
      topo: Math.round(th.top - cx.top),
      base: Math.round(cx.bottom - tf.bottom),
      esquerda: Math.round(rot.getBoundingClientRect().left - cx.left),
      fundoDoRotulo: getComputedStyle(rot).backgroundColor,
      competencia: [...document.querySelectorAll('.pivot thead th')][1].textContent.trim(),
    };
  });

  confere('a tabela rola por dentro da própria caixa', (await medir()).rola, true);
  await pag.evaluate(() => { const c = document.querySelector('.rol-fixo'); c.scrollTop = 900; c.scrollLeft = 700; });
  await pag.waitForTimeout(500);
  const fixos = await medir();
  confere('o cabeçalho fica preso no topo, com a competência à vista',
    [Math.abs(fixos.topo) <= 2, /^\d\d\/\d{4}$/.test(fixos.competencia)], [true, true]);
  confere('o total geral fica preso na base', Math.abs(fixos.base) <= 2, true);
  confere('a coluna de rótulos acompanha a rolagem lateral', Math.abs(fixos.esquerda) <= 2, true);
  // Sem fundo próprio, o número da coluna seguinte passaria por baixo do rótulo.
  confere('e o rótulo tem fundo opaco', /rgba\(0, 0, 0, 0\)/.test(fixos.fundoDoRotulo), false);

  console.log('\nTELA CHEIA');
  await pag.click('#r-tela');
  await pag.waitForTimeout(700);
  const cheia = await pag.evaluate(() => {
    const r = document.querySelector('#r-bloco').getBoundingClientRect();
    return { ocupaTudo: Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight,
      pressionado: document.querySelector('#r-tela').getAttribute('aria-pressed') };
  });
  confere('a tela cheia ocupa a janela e se anuncia', [cheia.ocupaTudo, cheia.pressionado], [true, 'true']);
  await pag.evaluate(() => { document.querySelector('.rol-fixo').scrollTop = 1200; });
  await pag.waitForTimeout(400);
  confere('e o cabeçalho segue preso na tela cheia', Math.abs((await medir()).topo) <= 2, true);
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(600);
  confere('Esc devolve a tela',
    await pag.evaluate(() => !document.querySelector('#r-bloco').classList.contains('tela-cheia')), true);

  console.log('\n=== falhas: ' + (falhas.length ? falhas.join('; ') : 'nenhuma') + ' ===');
  console.log('=== erros de console: ' + (erros.length ? '\n' + erros.join('\n') : 'nenhum') + ' ===');
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
