// FERIADOS — o calendário que interrompe o relógio do SLA.
//
// A irmã desta conferência é `artifact/testar-horas-uteis.cjs`, e as duas
// medem a mesma promessa em duas pontas. O servidor já tem
// `server/test/horas-uteis.test.ts`, que prova a REGRA; aqui se confere o que
// só existe em pixels: a lista, o cadastro, e a diferença entre
// "desconsiderar" e "apagar".
//
// O QUE ESTA SUÍTE EXISTE PARA PEGAR é "desconsiderar" virando exclusão. Um
// feriado desconsiderado tem de CONTINUAR na lista: um prazo medido ontem saiu
// da lista de ontem, e sumir com a linha torna aquele cálculo inexplicável.
// Apagar e desconsiderar parecem a mesma coisa na tela — a diferença só
// aparece conferindo que a linha ficou.
//
// Uso: com o servidor no ar sobre uma base de verificação (nunca a base real),
//   CHROMIUM_BIN=/opt/pw-browsers/chromium BASE_URL=http://127.0.0.1:3333 \
//     node web/verificar-feriados.cjs
const { chromium } = require('playwright');

const B = process.env.BASE_URL || 'http://127.0.0.1:3333';

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const erros = [];
  pag.on('pageerror', (e) => erros.push(e.message));
  pag.on('console', (m) => {
    // "Failed to load resource" acompanha toda recusa do servidor, e esta
    // suíte PROVOCA uma de propósito (o dia repetido). Contá-la como erro de
    // console reprovaria a conferência por ela ter funcionado.
    const t = m.text();
    if (m.type() === 'error' && !/ERR_|net::|401|favicon|Failed to load resource/.test(t)) erros.push(t);
  });

  const falhas = [];
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto(B + '/');
  await pag.fill('input[autocomplete="username"], input[name="usuario"]', process.env.USUARIO || 'gestora');
  await pag.fill('input[type=password]', process.env.SENHA || 'varredura2026');
  await pag.click('button[type=submit]');
  await pag.waitForTimeout(1200);
  if (await pag.$('.cartao button')) await pag.click('.cartao button');
  await pag.waitForSelector('.menu a', { timeout: 15000 });

  console.log('\nCAMINHO — a tela existe, junto dos SLAs');
  const noMenu = await pag.$('.menu a:has-text("Feriados")');
  ok('o menu leva a Feriados', !!noMenu);
  if (!noMenu) { await nav.close(); process.exit(1); }
  await pag.click('.menu a:has-text("Feriados")');
  await pag.waitForSelector('.cartao', { timeout: 15000 });
  await pag.waitForTimeout(900);

  const abrirBlocos = async () => {
    for (let i = 0; i < 8; i += 1) {
      const fechado = await pag.$('.cartao.dobrado .cartao-dobra');
      if (!fechado) break;
      await fechado.click();
      await pag.waitForTimeout(150);
    }
  };
  await abrirBlocos();

  // --------------------------------------------------------------- a regra
  console.log('\nA REGRA — a tela diz, em palavras, por que a lista existe');
  const texto = await pag.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));
  ok('a tela explica que o relógio corre dentro do expediente',
    /dentro do expediente/i.test(texto));
  ok('e publica a janela do contrato: 08–18, e 08–17 na sexta',
    /08:00 às 18:00/.test(texto) && /08:00 às 17:00/.test(texto));
  ok('e dá o caso que motiva tudo: sexta 17h30 vence na segunda',
    /sexta às 17h30/i.test(texto) && /segunda de manhã/i.test(texto));

  // ------------------------------------------------------------- cadastrar
  console.log('\nCADASTRAR — a data, o dia da semana e a descrição');
  const antes = await pag.$$eval('tbody tr', (ts) => ts.length);
  await pag.click('button:has-text("Novo feriado")');
  await pag.waitForSelector('.modal', { timeout: 10000 });
  await pag.fill('#feriado-data', '2026-12-25');
  await pag.waitForTimeout(300);
  const diaDito = await pag.evaluate(() => {
    const c = document.querySelector('#feriado-data').closest('.campo');
    return (c.querySelector('.dica-filtro') || {}).textContent || '';
  });
  ok('a tela diz o dia da semana da data escolhida', /sexta-feira/i.test(diaDito), diaDito);
  await pag.fill('#feriado-descricao', 'Natal');
  await pag.click('.modal button:has-text("Gravar")');
  await pag.waitForTimeout(1500);
  await abrirBlocos();

  const linhas = await pag.$$eval('tbody tr', (ts) => ts.map((tr) => ({
    celulas: [...tr.children].map((td) => td.textContent.trim()),
  })));
  ok('o feriado entra na lista', linhas.length === antes + 1, `${antes} → ${linhas.length}`);
  const natal = linhas.find((l) => /Natal/.test(l.celulas.join(' ')));
  ok('com a data no formato brasileiro', !!natal && /25\/12\/2026/.test(natal.celulas[0]), natal && natal.celulas[0]);
  ok('e com o dia da semana ao lado', !!natal && /sexta/i.test(natal.celulas[1]), natal && natal.celulas[1]);
  ok('nascendo como "conta como feriado"', !!natal && /Conta como feriado/.test(natal.celulas[3]),
    natal && natal.celulas[3]);

  // ------------------------------------------------ o que a tela recusa
  console.log('\nRECUSAS — o calendário e a descrição');
  await pag.click('button:has-text("Novo feriado")');
  await pag.waitForSelector('.modal', { timeout: 10000 });
  await pag.fill('#feriado-data', '2027-01-02');
  await pag.waitForTimeout(300);
  const semDescricao = await pag.$eval('.modal button:has-text("Gravar")', (b) => b.disabled);
  ok('sem descrição, gravar fica indisponível', semDescricao === true, `disabled=${semDescricao}`);
  // Sábado: o feriado não tira hora útil nenhuma, e a tela tem de dizer isso
  // ANTES de gravar — depois seria tarde.
  await pag.fill('#feriado-data', '2026-12-26');
  await pag.waitForTimeout(300);
  const avisoFds = await pag.evaluate(() => {
    const c = document.querySelector('#feriado-data').closest('.campo');
    return (c.querySelector('.dica-filtro') || {}).textContent || '';
  });
  ok('a tela avisa quando o feriado cai em fim de semana',
    /não tira hora útil/i.test(avisoFds), avisoFds);
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(400);

  // -------------------------------------------------------------- repetido
  console.log('\nREPETIDO — o mesmo dia duas vezes é engano, e a recusa diz qual já está lá');
  await pag.click('button:has-text("Novo feriado")');
  await pag.waitForSelector('.modal', { timeout: 10000 });
  await pag.fill('#feriado-data', '2026-12-25');
  await pag.fill('#feriado-descricao', 'Natal de novo');
  await pag.click('.modal button:has-text("Gravar")');
  await pag.waitForTimeout(1200);
  const recusa = await pag.evaluate(() => {
    const a = [...document.querySelectorAll('.aviso')].map((x) => x.textContent.replace(/\s+/g, ' '));
    return a.find((x) => /já está cadastrado/i.test(x)) || '';
  });
  ok('a tela recusa o dia repetido', /já está cadastrado/i.test(recusa), recusa.slice(0, 110));
  ok('e nomeia o feriado que já ocupa o dia', /Natal/.test(recusa), recusa.slice(0, 110));
  const aindaAberto = await pag.$('.modal');
  if (aindaAberto) { await pag.keyboard.press('Escape'); await pag.waitForTimeout(400); }

  // -------------------------------------------------- desconsiderar ≠ apagar
  console.log('\nDESCONSIDERAR — sai da conta, FICA na lista');
  const quantasAntes = await pag.$$eval('tbody tr', (ts) => ts.length);
  await pag.click('tbody tr:has-text("Natal") button:has-text("Desconsiderar")');
  await pag.waitForTimeout(1500);
  await abrirBlocos();
  const depois = await pag.$$eval('tbody tr', (ts) => ts.map((tr) => [...tr.children].map((td) => td.textContent.trim())));
  ok('a linha CONTINUA na lista — não é exclusão', depois.length === quantasAntes,
    `${quantasAntes} → ${depois.length}`);
  const linhaNatal = depois.find((c) => /Natal/.test(c.join(' ')));
  ok('e passa a dizer "Desconsiderado"', !!linhaNatal && /Desconsiderado/.test(linhaNatal[3]),
    linhaNatal && linhaNatal[3]);
  ok('a tela explica por que desconsiderar não apaga',
    /inexplicável|não apagar o registro/i.test(
      await pag.evaluate(() => document.body.textContent.replace(/\s+/g, ' '))));

  // E o efeito tem de chegar ao MOTOR, não só à etiqueta.
  const noRelogio = await pag.evaluate(async () => {
    const h = {
      Authorization: `Bearer ${localStorage.getItem('gsti.token')}`,
      'X-Cliente-Id': String(localStorage.getItem('gsti.cliente')),
      'X-Empresa-Id': String(localStorage.getItem('gsti.empresa')),
    };
    const r = await fetch('/api/feriados/relogio?inicio=2026-12-24T09:00:00&horas=12', { headers: h });
    return r.ok ? r.json() : { erro: r.status };
  });
  ok('o motor deixa de contar o feriado desconsiderado',
    noRelogio.feriados_considerados === 0, JSON.stringify(noRelogio.feriados_considerados));

  console.log('\nREATIVAR — volta a contar');
  await pag.click('tbody tr:has-text("Natal") button:has-text("Reativar")');
  await pag.waitForTimeout(1500);
  await abrirBlocos();
  const reativado = await pag.evaluate(async () => {
    const h = {
      Authorization: `Bearer ${localStorage.getItem('gsti.token')}`,
      'X-Cliente-Id': String(localStorage.getItem('gsti.cliente')),
      'X-Empresa-Id': String(localStorage.getItem('gsti.empresa')),
    };
    const r = await fetch('/api/feriados/relogio?inicio=2026-12-24T09:00:00&horas=12', { headers: h });
    return r.ok ? r.json() : { erro: r.status };
  });
  ok('o motor volta a contá-lo', reativado.feriados_considerados === 1,
    JSON.stringify(reativado.feriados_considerados));
  ok('e o prazo de 12 horas úteis pula o dia 25',
    typeof reativado.prazo === 'string' && !reativado.prazo.startsWith('2026-12-25'),
    String(reativado.prazo));

  // -------------------------------------------------------- acessibilidade
  console.log('\nACESSIBILIDADE E CONTRASTE');
  await pag.click('button:has-text("Novo feriado")');
  await pag.waitForSelector('.modal', { timeout: 10000 });
  const a11y = await pag.evaluate(() => {
    const campos = [...document.querySelectorAll('.modal input')];
    return {
      semRotulo: campos.filter((c) => !c.id || !document.querySelector(`label[for="${CSS.escape(c.id)}"]`)).length,
      quantos: campos.length,
    };
  });
  ok('todo campo do formulário tem rótulo ligado por "for"',
    a11y.quantos > 0 && a11y.semRotulo === 0, `${a11y.quantos} campo(s), ${a11y.semRotulo} sem rótulo`);
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(400);

  const etiquetas = await pag.$$eval('.etiqueta', (es) => es.map((e) => e.textContent.trim()));
  ok('a situação vem por extenso, e não só por cor',
    etiquetas.length > 0 && etiquetas.every((t) => t.length > 1), etiquetas.join(' · '));

  for (const tema of ['light', 'dark']) {
    await pag.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
    await pag.waitForTimeout(250);
    const abaixo = await pag.evaluate(() => {
      const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
        .map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const fundo = (e) => { let n = e; while (n) { const c = getComputedStyle(n).backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; n = n.parentElement; }
        return 'rgb(255,255,255)'; };
      const razao = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const ruins = [];
      for (const e of document.querySelectorAll('.cartao h2, td, th, .etiqueta, .nota, .aviso')) {
        if (!e.textContent.trim()) continue;
        const s = getComputedStyle(e);
        const px = parseFloat(s.fontSize);
        const grande = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700);
        const r = razao(s.color, fundo(e));
        if (r < (grande ? 3 : 4.5)) ruins.push(`${e.className || e.tagName} ${px}px ${r.toFixed(2)}`);
      }
      return [...new Set(ruins)];
    });
    ok(`tema ${tema}: nada abaixo da régua AA`, abaixo.length === 0, abaixo.slice(0, 5).join(', ') || 'tudo acima');
  }
  await pag.evaluate(() => document.documentElement.removeAttribute('data-theme'));

  console.log(`\n=== erros de console: ${erros.length ? erros.slice(0, 4).join(' | ') : 'nenhum'} ===`);
  console.log(`=== ✗=${falhas.length} ===`);
  if (falhas.length) falhas.forEach((f) => console.log('  ✗ ' + f));
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
