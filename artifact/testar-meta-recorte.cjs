// A meta atravessando vigências: o placar de meses, e o cabeçalho que a cita.
//
// O defeito que isto guarda: o sistema escolhia UMA meta — a do último mês do
// recorte — e julgava o período inteiro por ela. Com 01/2026 a 01/2027 e duas
// metas, treze meses eram medidos contra uma regra que valia para cinco, e a
// outra meta sumia da tela sem explicação nenhuma.
const { chromium } = require('playwright');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const falhas = [], erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });

  // As metas exatamente como o gestor as cadastrou.
  const seed = (metas) => pag.evaluate(async (ms) => {
    await Loja.gravarCatalogo('metas', ms.map((m) => ({ ...m, cliente: E.clienteSel })));
    E.aba = 'indicadores_gerais';
    await render();
  }, metas);

  const DUAS = [
    { nome: 'Glaucio', modulo: 'financeiro', alvoPct: 90, vigenciaInicio: '2026-01', vigenciaFim: '2026-08', ativo: true },
    { nome: 'TESTE', modulo: 'financeiro', alvoPct: 1, vigenciaInicio: '2026-08', vigenciaFim: null, ativo: true },
  ];

  console.log('\nDUAS METAS NO PERÍODO — o placar de meses, não uma comparação falsa');
  await seed(DUAS);
  await pag.waitForTimeout(1200);

  const cab = () => pag.evaluate(() => {
    const b = [...document.querySelectorAll('#pagina section.bloco-modulo')]
      .find((x) => /Financeiro/.test((x.querySelector('header h2') || {}).textContent || ''));
    return b ? (b.querySelector('header .nota') || {}).textContent.replace(/\s+/g, ' ').trim() : '';
  });
  const nota = await cab();
  ok('o cabeçalho do Financeiro cita as DUAS metas',
    /90%/.test(nota) && /1%/.test(nota), nota);
  ok('e diz a vigência de cada uma', /01\/2026 a 08\/2026/.test(nota) && /08\/2026 em diante/.test(nota), nota);

  const cardFin = () => pag.evaluate(() => {
    const b = [...document.querySelectorAll('#pagina section.bloco')]
      .find((x) => /Custo recorrente — variação/.test((x.querySelector('header h2') || {}).textContent || ''));
    const k = b && b.querySelector('.meta-kpi');
    return k ? k.textContent.replace(/\s+/g, ' ').trim() : '(sem meta no card)';
  });
  const card = await cardFin();
  ok('o card mostra o placar de meses, e não um alvo único',
    /de \d+ mes(es)? dentro da meta/.test(card), card);
  ok('e nomeia as duas metas na própria leitura',
    /Glaucio/.test(card) && /TESTE/.test(card), card.slice(0, 120));

  console.log('\nUMA META SÓ — a comparação de sempre, sem mudar de forma');
  await seed([DUAS[1]]);
  await pag.waitForTimeout(1200);
  const umaSo = await cardFin();
  ok('volta ao alvo único quando só uma meta rege o período',
    /teto 1%/.test(umaSo) && !/meses dentro/.test(umaSo), umaSo);
  ok('e o cabeçalho cita essa meta', /1%/.test(await cab()), await cab());

  console.log('\nNENHUMA META — o indicador continua, sem inventar alvo');
  await seed([]);
  await pag.waitForTimeout(1200);
  ok('sem meta cadastrada, o card não finge comparação',
    (await cardFin()) === '(sem meta no card)', await cardFin());

  console.log(`\n=== falhas: ${falhas.length ? falhas.join(' | ') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? erros.join(' | ') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
