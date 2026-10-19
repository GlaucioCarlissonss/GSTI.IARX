// O BLOCO "RESULTADOS" NO APP — ENTREGA 1: ESTRUTURA E REGRA.
//
// A irmã desta conferência é `artifact/testar-resultados.cjs`, e as duas medem
// a mesma promessa em duas pontas.
//
// A PRIMEIRA é de LAYOUT, e é a que o enunciado chamou de crítica: o bloco é
// IRMÃO das caixas de módulo, nunca filho. Um `.cartao-resultado` dentro de um
// cartão de módulo é o defeito que esta suíte existe para pegar — e `closest`
// é o que prova parentesco, porque "está embaixo na tela" não distingue um
// irmão posicionado de um filho.
//
// A SEGUNDA é a REGRA: atingimento = resultado ÷ meta onde maior é melhor, e
// meta ÷ resultado onde menor é melhor. Inverter a direção num módulo faria o
// mês mais caro do ano aparecer em verde, e é um erro que a tela não denuncia
// sozinha — o número continua parecendo um percentual plausível.
//
// Uso: com o servidor no ar sobre uma base de verificação (nunca a base real),
//   BASE_URL=http://127.0.0.1:3333 node web/verificar-resultados.cjs
const { chromium } = require('playwright');

const B = process.env.BASE_URL || 'http://127.0.0.1:3333';

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const erros = [];
  pag.on('pageerror', (e) => erros.push(e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::|401/.test(m.text())) erros.push(m.text()); });

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
  await pag.waitForSelector('.bloco-resultados', { timeout: 15000 });
  // O bloco faz duas consultas próprias depois de saber os meses.
  await pag.waitForTimeout(2000);

  // ------------------------------------------------------------- layout
  console.log('\nPOSIÇÃO — o bloco é irmão dos cartões de módulo, nunca filho');
  const pos = await pag.evaluate(() => {
    const b = document.querySelector('.bloco-resultados');
    if (!b) return null;
    const topo = (e) => e.getBoundingClientRect().top + window.scrollY;
    // Os cartões de módulo são os `.cartao` da página que NÃO são este bloco.
    const modulos = [...document.querySelectorAll('.pagina .cartao, main .cartao')]
      .filter((c) => c !== b && !b.contains(c) && !c.contains(b));
    return {
      ehFilhoDeCartao: !!(b.parentElement && b.parentElement.closest('.cartao')),
      abaixoDeTodos: modulos.every((m) => topo(b) >= topo(m)),
      quantosModulos: modulos.length,
      largura: Math.round(b.getBoundingClientRect().width),
      larguraIrmao: modulos.length
        ? Math.round(Math.max(...modulos.map((m) => m.getBoundingClientRect().width))) : 0,
      titulo: (b.querySelector('h2') || {}).textContent,
      temSubtitulo: !!(b.querySelector('.res-sub') || {}).textContent,
      cartoesDentroDeModulo: modulos.reduce(
        (n, m) => n + m.querySelectorAll('.cartao-resultado').length, 0),
      cartoes: [...b.querySelectorAll('.cartao-resultado')].map((c) => c.dataset.modulo),
    };
  });
  if (!pos) {
    ok('o bloco Resultados existe na tela', false, 'nenhum .bloco-resultados');
  } else {
    ok('o bloco Resultados existe na tela', true);
    ok('ele NÃO está dentro de nenhum cartão de módulo', !pos.ehFilhoDeCartao);
    ok('nenhum cartão de resultado foi duplicado dentro dos módulos',
      pos.cartoesDentroDeModulo === 0, `${pos.cartoesDentroDeModulo} encontrado(s)`);
    ok('ele vem abaixo de TODOS os cartões de módulo', pos.abaixoDeTodos,
      `${pos.quantosModulos} cartão(ões) acima`);
    ok('ele tem a largura de um bloco de página',
      Math.abs(pos.largura - pos.larguraIrmao) <= 2, `${pos.largura}px × ${pos.larguraIrmao}px`);
    ok('o título é "Resultados"', (pos.titulo || '').trim() === 'Resultados', pos.titulo);
    ok('há subtítulo explicando o que ele consolida', pos.temSubtitulo);
    ok('são exatamente três cartões, na ordem Financeiro / Projetos / SLA',
      pos.cartoes.join(',') === 'financeiro,projetos,sla', pos.cartoes.join(' · '));
  }

  console.log('\nGRADE — três colunas no desktop, uma no celular');
  const colunas = () => pag.evaluate(() => {
    const g = document.querySelector('.grade-resultados');
    if (!g) return null;
    return {
      colunas: getComputedStyle(g).gridTemplateColumns.split(' ').length,
      empilhado: [...g.children].every((c, i, a) =>
        i === 0 || c.getBoundingClientRect().top >= a[i - 1].getBoundingClientRect().bottom - 1),
    };
  });
  const desktop = await colunas();
  ok('no desktop são três colunas', !!desktop && desktop.colunas === 3,
    desktop ? String(desktop.colunas) : 'sem grade');
  for (const [nome, largura] of [['tablet', 760], ['celular', 390]]) {
    await pag.setViewportSize({ width: largura, height: 1000 });
    await pag.waitForTimeout(300);
    const c = await colunas();
    ok(`a ${largura}px (${nome}) vira uma coluna`, !!c && c.colunas === 1,
      c ? String(c.colunas) : 'sem grade');
    ok(`a ${largura}px os cartões ficam empilhados`, !!c && c.empilhado);
    const semLateral = await pag.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    ok(`a ${largura}px a página não rola para o lado`, semLateral);
    // O bloco continua fora dos módulos em todo breakpoint.
    const fora = await pag.evaluate(() => {
      const b = document.querySelector('.bloco-resultados');
      return !(b.parentElement && b.parentElement.closest('.cartao'));
    });
    ok(`a ${largura}px o bloco segue fora dos módulos`, fora);
  }
  await pag.setViewportSize({ width: 1500, height: 1100 });
  await pag.waitForTimeout(300);

  // ------------------------------------------------------------ conteúdo
  console.log('\nCARTÃO — resultado, meta e atingimento');
  const cartoes = await pag.evaluate(() => [...document.querySelectorAll('.cartao-resultado')]
    .map((c) => ({
      mod: c.dataset.modulo,
      faixa: ([...c.classList].find((x) => x.startsWith('faixa-')) || '').replace('faixa-', ''),
      valor: (c.querySelector('.res-valor') || {}).textContent,
      rotulos: [...c.querySelectorAll('.res-linha dt')].map((d) => d.textContent.trim()),
      texto: ((c.querySelector('.res-texto') || {}).textContent || '').trim(),
    })));
  ok('cada cartão traz Meta e Atingimento rotulados',
    cartoes.length === 3 && cartoes.every((c) => c.rotulos.join(',') === 'Meta,Atingimento'),
    cartoes.map((c) => c.rotulos.join('/')).join(' · '));
  ok('cada cartão traz o texto do estado da meta',
    cartoes.every((c) => c.texto.length > 0),
    cartoes.map((c) => `${c.mod}: ${c.texto}`).join(' · '));
  ok('nenhum cartão fica sem faixa declarada',
    cartoes.every((c) => c.faixa), cartoes.map((c) => `${c.mod}=${c.faixa}`).join(' · '));
  // O SLA tem meta padrão de 80% mesmo sem cadastro e mesmo sem chamado no
  // mês: o campo Meta do cartão tem de trazer um percentual. Conferir só a
  // faixa não serviria — "sem dados" passaria sem provar meta nenhuma.
  const metaSla = await pag.evaluate(() => {
    const c = document.querySelector('.cartao-resultado[data-modulo="sla"]');
    return c ? c.querySelectorAll('.res-linha dd')[0].textContent.trim() : null;
  });
  ok('o cartão de SLA traz a meta padrão de 80%', metaSla === '80,0%', String(metaSla));

  console.log('\nMÊS — o seletor é do bloco e não mexe nos filtros da tela');
  const mes = await pag.evaluate(async () => {
    const sel = document.querySelector('[data-mes-resultados]');
    if (!sel || sel.options.length < 2) return null;
    const antes = sel.value;
    const textoAntes = document.querySelector('.grade-resultados').textContent;
    const nativo = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    nativo.call(sel, sel.options[1].value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1800));
    return {
      antes, depois: document.querySelector('[data-mes-resultados]').value,
      mudou: document.querySelector('.grade-resultados').textContent !== textoAntes,
      tresCartoes: document.querySelectorAll('.cartao-resultado').length === 3,
    };
  });
  if (!mes) {
    console.log('  · a base de verificação tem um mês fechado só; o seletor não pode ser exercido');
  } else {
    ok('trocar o mês muda o seletor', mes.antes !== mes.depois, `${mes.antes} → ${mes.depois}`);
    ok('continuam sendo três cartões', mes.tresCartoes);
  }

  // A REGRA não é exercida aqui: ela é pura, mora em `src/lib/resultados.ts`
  // e é coberta por `web/testar-regra-resultados.mjs`, que roda sem navegador.
  // Importar o fonte de dentro da página servida falhava — o que o navegador
  // tem é o bundle — e deixava um erro de console que não era do produto.

  // ------------------------------------------------------------ contraste
  console.log('\nBARRA — preenchimento, acessibilidade e dica');
  // Procura um mês em que algum cartão tenha meta E resultado: no mês padrão a
  // base de verificação pode não ter nenhum, e uma asserção que nunca é
  // exercida não protege nada.
  const mesesDisponiveis = await pag.$$eval('[data-mes-resultados] option', (os) => os.map((o) => o.value));
  for (const m of mesesDisponiveis) {
    await pag.evaluate(async (valor) => {
      const sel = document.querySelector('[data-mes-resultados]');
      const nativo = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      nativo.call(sel, valor);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, m);
    await pag.waitForTimeout(1600);
    const achou = await pag.$$eval('.cartao-resultado .res-barra',
      (bs) => bs.some((b) => !b.classList.contains('vazia')));
    if (achou) { console.log(`  · mês com barra preenchida: ${m}`); break; }
  }
  const barras = await pag.evaluate(() => [...document.querySelectorAll('.cartao-resultado')]
    .map((c) => {
      const b = c.querySelector('.res-barra');
      const i = c.querySelector('.res-trilha > i');
      return { mod: c.dataset.modulo,
        faixa: ([...c.classList].find((x) => x.startsWith('faixa-')) || '').replace('faixa-', ''),
        temBarra: !!b, vazia: !!(b && b.classList.contains('vazia')),
        papel: b && b.getAttribute('role'),
        agora: b && b.getAttribute('aria-valuenow'),
        min: b && b.getAttribute('aria-valuemin'), max: b && b.getAttribute('aria-valuemax'),
        rotulo: (b && b.getAttribute('aria-label')) || '',
        dica: (b && b.getAttribute('title')) || '',
        largura: i ? parseFloat(i.style.width) : null,
        pct: (c.querySelector('.res-pct') || {}).textContent || '' };
    }));
  ok('todo cartão tem barra', barras.every((b) => b.temBarra), `${barras.length} cartão(ões)`);
  const comMeta = barras.filter((b) => !b.vazia);
  ok('sem atingimento, a barra fica neutra e vazia',
    barras.filter((b) => b.faixa === 'sem_dados' || b.faixa === 'sem_meta').every((b) => b.vazia),
    barras.map((b) => `${b.mod}=${b.vazia ? 'vazia' : 'cheia'}`).join(' · '));
  if (comMeta.length) {
    ok('o preenchimento nunca passa de 100%', comMeta.every((b) => b.largura <= 100),
      comMeta.map((b) => `${b.mod}:${b.largura}%`).join(' · '));
    ok('o preenchimento é proporcional ao atingimento',
      comMeta.every((b) => Math.abs(b.largura - Math.min(100, Number(b.agora))) < 0.2),
      comMeta.map((b) => `${b.largura}/${b.agora}`).join(' · '));
    ok('o percentual sai com uma casa decimal',
      comMeta.every((b) => /^\d+,\d%$/.test(b.pct.trim())), comMeta.map((b) => b.pct).join(' · '));
    ok('a barra é um progressbar com valor, mínimo e máximo',
      comMeta.every((b) => b.papel === 'progressbar' && b.min === '0' && b.max === '100'
        && Number.isFinite(Number(b.agora))));
    ok('com a frase da meta no rótulo',
      comMeta.every((b) => /atingimento de/.test(b.rotulo)), comMeta[0].rotulo.slice(0, 70));
    ok('a dica traz resultado, meta, atingimento, direção e mês',
      comMeta.every((b) => ['Resultado', 'Meta', 'Atingimento', 'Direção', 'Mês de referência']
        .every((x) => b.dica.includes(x))), comMeta[0].dica.replace(/\n/g, ' · ').slice(0, 120));
  } else {
    console.log('  · nenhum cartão com meta nesta base; o preenchimento não pôde ser exercido');
  }

  console.log('\nCONTRASTE — o bloco passa na régua AA, nos dois temas');
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
      for (const e of document.querySelectorAll('.bloco-resultados h2, .res-sub, .cartao-resultado h3, .res-oque, .res-valor, .res-linha dt, .res-linha dd, .res-texto, .res-ressalva')) {
        const s = getComputedStyle(e);
        const px = parseFloat(s.fontSize);
        const grande = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700);
        const r = razao(s.color, fundo(e));
        if (r < (grande ? 3 : 4.5)) ruins.push(`${e.className || e.tagName} ${px}px ${r.toFixed(2)}`);
      }
      return ruins;
    });
    ok(`tema ${tema}: nada abaixo da régua`, abaixo.length === 0, abaixo.join(', ') || 'tudo acima');
  }
  await pag.evaluate(() => document.documentElement.removeAttribute('data-theme'));

  console.log(`\n=== erros de console: ${erros.length ? erros.slice(0, 4).join(' | ') : 'nenhum'} ===`);
  console.log(`=== ✗=${falhas.length} ===`);
  if (falhas.length) falhas.forEach((f) => console.log('  ✗ ' + f));
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
