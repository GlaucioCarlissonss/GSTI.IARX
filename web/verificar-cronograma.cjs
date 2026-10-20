// A VISÃO MACRO — a virada de sistema — na tela de Indicadores Gerais.
//
// A irmã desta conferência é `artifact/testar-cronograma-ondas.cjs`, e as duas
// medem a mesma promessa em duas pontas. O servidor já tem
// `server/test/cronograma.test.ts`; ele prova a REGRA, e não o que só existe
// em pixels.
//
// O QUE ESTA SUÍTE EXISTE PARA PEGAR é a onda que ainda não venceu mostrando
// ZERO. Zero afirma um fracasso que ninguém mediu, e é um defeito que a tela
// não denuncia sozinha — "0,0%" continua parecendo um percentual plausível,
// e pinta de vermelho uma frente cujo prazo é daqui a três meses.
//
// Uso: com o servidor no ar sobre uma base de verificação (nunca a base real),
//   CHROMIUM_BIN=/opt/pw-browsers/chromium BASE_URL=http://127.0.0.1:3333 \
//     node web/verificar-cronograma.cjs
const { chromium } = require('playwright');

const B = process.env.BASE_URL || 'http://127.0.0.1:3333';

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const erros = [];
  pag.on('pageerror', (e) => erros.push(e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::|401|favicon/.test(m.text())) erros.push(m.text()); });

  const falhas = [];
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto(B + '/');
  await pag.fill('input[autocomplete="username"], input[name="usuario"]', process.env.USUARIO || 'gestora');
  await pag.fill('input[type=password]', process.env.SENHA || 'varredura2026');
  await pag.click('button[type=submit]');
  await pag.waitForTimeout(1200);
  if (await pag.$('.cartao button')) await pag.click('.cartao button');
  await pag.waitForSelector('.menu a', { timeout: 15000 });
  await pag.click('.menu a:has-text("Indicadores Gerais")');
  await pag.waitForTimeout(2500);

  // Os blocos são acordeão. Medir num bloco fechado acharia nada, e "nada"
  // passaria por "está certo" — é a asserção vazia que esta abertura evita.
  const abrirTudo = async () => {
    for (let i = 0; i < 14; i += 1) {
      const fechado = await pag.$('.cartao.dobrado .cartao-dobra');
      if (!fechado) break;
      await fechado.click();
      await pag.waitForTimeout(150);
    }
  };
  await abrirTudo();
  await pag.waitForTimeout(800);

  // ----------------------------------------------------------- a separação
  console.log('\nAS DUAS VISÕES — a Macro pergunta se virou; a Micro, se saiu no prazo');
  const titulos = await pag.$$eval('.cartao h2', (hs) => hs.map((h) => h.textContent.replace(/[−+]/g, '').trim()));
  ok('a Visão Macro está na tela', titulos.some((t) => /Visão Macro/.test(t)), titulos.filter((t) => /Visão/.test(t)).join(' | '));
  ok('e a Micro também, separada dela', titulos.some((t) => /Visão Micro/.test(t)));
  const macro = await pag.evaluateHandle(() => [...document.querySelectorAll('.cartao')]
    .find((c) => /Visão Macro/.test((c.querySelector('h2') || {}).textContent || '')));
  ok('a Macro é um cartão próprio', !!(await macro.asElement()));
  if (!(await macro.asElement())) { await nav.close(); process.exit(1); }

  // ------------------------------------------------------------ os números
  console.log('\nOS TRÊS NÚMEROS DO TOPO');
  const topo = await pag.evaluate(() => {
    const c = [...document.querySelectorAll('.cartao')]
      .find((x) => /Visão Macro/.test((x.querySelector('h2') || {}).textContent || ''));
    const saida = {};
    for (const i of c.querySelectorAll('.indicador')) {
      const r = (i.querySelector('.rotulo') || {}).textContent;
      if (r) {
        saida[r.trim()] = {
          numero: ((i.querySelector('.numero') || {}).textContent || '').trim(),
          apoio: ((i.querySelector('.apoio') || {}).textContent || '').trim(),
        };
      }
    }
    return saida;
  });
  console.log('  ·', JSON.stringify(topo));
  ok('o total de pacientes é 1.922', (topo['Total de pacientes'] || {}).numero === '1.922');
  ok('são 17 unidades em 4 ondas',
    (topo['Unidades a migrar'] || {}).numero === '17'
    && /4 ondas/.test((topo['Unidades a migrar'] || {}).apoio || ''),
    `${(topo['Unidades a migrar'] || {}).numero} · ${(topo['Unidades a migrar'] || {}).apoio}`);
  ok('a tela DIZ que a divisão de pacientes por onda não veio no plano',
    /não veio no plano/.test((topo['Total de pacientes'] || {}).apoio || ''),
    (topo['Total de pacientes'] || {}).apoio);
  ok('as duas unidades já em produção aparecem', (topo['Já em produção'] || {}).numero === '2',
    (topo['Já em produção'] || {}).numero);

  // ------------------------------------------------------------- a tabela
  console.log('\nAS ONDAS — quatro linhas, e a 1ª é Porto Velho e Rio');
  const ondas = await pag.evaluate(() => {
    const c = [...document.querySelectorAll('.cartao')]
      .find((x) => /Visão Macro/.test((x.querySelector('h2') || {}).textContent || ''));
    const t = c.querySelector('table');
    // As linhas de unidade existem sempre e ficam ESCONDIDAS quando a onda
    // está fechada — é o que mantém o `aria-controls` apontando para algo real.
    // A conferência mede o que está à vista.
    return [...t.querySelectorAll('tbody tr:not([hidden])')]
      .map((tr) => [...tr.children].map((td) => td.textContent.trim()));
  });
  ok('as quatro ondas estão lá', ondas.length === 4, `${ondas.length} linha(s)`);
  if (ondas.length === 4) {
    console.log(ondas.map((o) => '     ' + o.join(' | ')).join('\n'));
    ok('a 1ª onda é Porto Velho e Rio, e NÃO a Paraíba',
      /Porto Velho/.test(ondas[0][2]) && /Rio de Janeiro/.test(ondas[0][2]) && !/\/PB/.test(ondas[0][2]),
      ondas[0][2]);
    ok('a Paraíba é a 2ª, e vira no dia 3', /\/PB/.test(ondas[1][2]) && /03\/11\/2026/.test(ondas[1][1]),
      `${ondas[1][1]} — ${ondas[1][2]}`);
    ok('São Paulo saiu de outubro e foi para a 4ª', /São Paulo/.test(ondas[3][2]), ondas[3][2]);
    ok('o go-live traz o DIA, e não só o mês', ondas.every((o) => /\d{2}\/\d{2}\/\d{4}/.test(o[1])),
      ondas.map((o) => o[1]).join(' · '));

    // O defeito que esta suíte existe para pegar.
    console.log('\nONDA QUE NÃO VENCEU — sem resultado, e nunca zero');
    ok('a 1ª, que venceu e virou, mostra 100%', /100,0%/.test(ondas[0][4]), ondas[0][4]);
    ok('a 1ª está CUMPRIDO', /CUMPRIDO/.test(ondas[0][5]) && !/NÃO/.test(ondas[0][5]), ondas[0][5]);
    for (const i of [1, 2, 3]) {
      ok(`a ${i + 1}ª ainda não vence: diz isso, e não 0,0%`,
        /ainda não vence/.test(ondas[i][4]) && !/0,0%/.test(ondas[i][4]), ondas[i][4]);
      ok(`e a ${i + 1}ª fica PENDENTE, não "não cumprido"`,
        /PENDENTE/.test(ondas[i][5]), ondas[i][5]);
    }
    ok('as entregas aparecem como "virou de planejado"',
      ondas.every((o) => /\d+ de \d+/.test(o[3])), ondas.map((o) => o[3]).join(' · '));
  }

  // --------------------------------------------------------- o detalhamento
  console.log('\nABRIR A ONDA — só unidades e prazos de virada, nunca tarefa');
  const antes = ondas.length;
  await pag.click('.cartao:has(h2:has-text("Visão Macro")) tbody .arv-abrir');
  await pag.waitForTimeout(500);
  const abertas = await pag.evaluate(() => {
    const c = [...document.querySelectorAll('.cartao')]
      .find((x) => /Visão Macro/.test((x.querySelector('h2') || {}).textContent || ''));
    const t = c.querySelector('table');
    return {
      linhas: t.querySelectorAll('tbody tr:not([hidden])').length,
      cabecalho: [...t.querySelectorAll('thead th')].map((h) => h.textContent.trim()),
      novas: [...t.querySelectorAll('tbody tr:not([hidden])')].slice(1, 3)
        .map((tr) => [...tr.children].map((td) => td.textContent.trim())),
      aria: (t.querySelector('.arv-abrir') || {}).getAttribute
        ? t.querySelector('.arv-abrir').getAttribute('aria-expanded') : null,
    };
  });
  ok('as duas unidades da 1ª onda aparecem', abertas.linhas === antes + 2,
    `${antes} → ${abertas.linhas}`);
  ok('o botão anuncia que abriu', abertas.aria === 'true', String(abertas.aria));
  ok('nenhuma coluna de tarefa ou atividade na tabela',
    !abertas.cabecalho.some((h) => /tarefa|atividade/i.test(h)), abertas.cabecalho.join(' | '));
  if (abertas.novas.length === 2) {
    console.log(abertas.novas.map((n) => '     ' + n.join(' | ')).join('\n'));
    ok('a linha da unidade traz o prazo e a virada realizada',
      abertas.novas.every((n) => /01\/10\/2026/.test(n[1]) && /realizada/.test(n[1])),
      abertas.novas.map((n) => n[1]).join(' // '));
    ok('e diz "virou", com a situação por extenso',
      abertas.novas.every((n) => /virou/.test(n[3]) && /CUMPRIDO/.test(n[5])),
      abertas.novas.map((n) => `${n[3]} ${n[5]}`).join(' // '));
  }

  // Uma onda que não venceu: a unidade aguarda, e não reprova.
  await pag.click('.cartao:has(h2:has-text("Visão Macro")) tbody tr:nth-child(4) .arv-abrir');
  await pag.waitForTimeout(500);
  const pendentes = await pag.evaluate(() => {
    const c = [...document.querySelectorAll('.cartao')]
      .find((x) => /Visão Macro/.test((x.querySelector('h2') || {}).textContent || ''));
    return [...c.querySelectorAll('table tbody tr:not([hidden])')]
      .map((tr) => [...tr.children].map((td) => td.textContent.trim()))
      .filter((l) => /\/PB/.test(l[0]));
  });
  ok('a unidade de onda não vencida AGUARDA, e não reprova',
    pendentes.length === 3 && pendentes.every((l) => /aguarda/.test(l[3]) && /PENDENTE/.test(l[5])),
    pendentes.map((l) => `${l[0]}=${l[3]}`).join(' · '));

  // ---------------------------------------------------------------- a nota
  const nota = await pag.evaluate(() => {
    const c = [...document.querySelectorAll('.cartao')]
      .find((x) => /Visão Macro/.test((x.querySelector('h2') || {}).textContent || ''));
    return (c.querySelector('.nota') || {}).textContent || '';
  });
  console.log('\nA NOTA — explica a regra em palavras, e não só em cor');
  ok('a nota diz que a entrega da onda é uma meta', /é uma meta/.test(nota));
  ok('e que zero afirmaria um fracasso que ninguém mediu', /ninguém mediu/.test(nota));
  ok('e separa tarefa pendente de virada', /[Tt]arefa pendente não muda/.test(nota));

  // --------------------------------------------------------- acessibilidade
  console.log('\nACESSIBILIDADE E CONTRASTE');
  const a11y = await pag.evaluate(() => {
    const c = [...document.querySelectorAll('.cartao')]
      .find((x) => /Visão Macro/.test((x.querySelector('h2') || {}).textContent || ''));
    const bts = [...c.querySelectorAll('.arv-abrir')];
    return {
      quantos: bts.length,
      semAria: bts.filter((b) => b.getAttribute('aria-expanded') === null).length,
      semRotulo: bts.filter((b) => !b.getAttribute('aria-label')).length,
      etiquetasSemTexto: [...c.querySelectorAll('.etiqueta')].filter((e) => !e.textContent.trim()).length,
    };
  });
  ok('toda onda tem botão que anuncia se está aberta',
    a11y.quantos === 4 && a11y.semAria === 0, `${a11y.quantos} botão(ões), ${a11y.semAria} sem aria-expanded`);
  ok('e cada um diz, por extenso, que onda abre', a11y.semRotulo === 0, `${a11y.semRotulo} sem aria-label`);
  ok('a cor nunca é o único canal: toda etiqueta tem texto', a11y.etiquetasSemTexto === 0);

  // id repetido é HTML inválido, e `aria-controls` seguiria só o primeiro —
  // anunciando que o botão controla uma linha quando controla três.
  const ids = await pag.evaluate(() => {
    const c = [...document.querySelectorAll('.cartao')]
      .find((x) => /Visão Macro/.test((x.querySelector('h2') || {}).textContent || ''));
    const todos = [...c.querySelectorAll('[id]')].map((e) => e.id);
    const alvos = [...c.querySelectorAll('.arv-abrir[aria-controls]')]
      .flatMap((b) => b.getAttribute('aria-controls').split(/\s+/).filter(Boolean));
    return {
      repetidos: todos.filter((v, i) => todos.indexOf(v) !== i),
      orfaos: alvos.filter((a) => !c.querySelector(`#${CSS.escape(a)}`)),
      alvos: alvos.length,
    };
  });
  ok('nenhum id repetido na visão', ids.repetidos.length === 0, ids.repetidos.join(', '));
  ok('e todo aria-controls aponta para uma linha que existe',
    ids.alvos > 0 && ids.orfaos.length === 0, `${ids.alvos} alvo(s), ${ids.orfaos.length} órfão(s)`);

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
      const c = [...document.querySelectorAll('.cartao')]
        .find((x) => /Visão Macro/.test((x.querySelector('h2') || {}).textContent || ''));
      const ruins = [];
      for (const e of c.querySelectorAll('h2, .rotulo, .numero, .apoio, .nota, .etiqueta, .arv-comp, td, th')) {
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
