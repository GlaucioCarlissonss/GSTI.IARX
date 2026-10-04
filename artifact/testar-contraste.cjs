// Contraste de texto medido NO NAVEGADOR, nos dois temas.
//
// Olhar para os tokens não basta: o que decide a legibilidade é a cor que o
// navegador calculou para aquele texto sobre o fundo que de fato ficou atrás
// dele — que pode vir de um ancestral, de um color-mix ou de uma regra de
// estado. Esta suíte percorre cada nó de texto visível, sobe até achar o
// primeiro fundo opaco e aplica a régua da WCAG: 4,5:1 no texto comum e 3:1 no
// texto grande (>=18,66px em negrito, ou >=24px).
//
// Ela é a rede da repaginada visual: qualquer token de tinta que alguém
// clarear sem medir cai aqui, em vez de cair no olho de quem lê a tela.
const { chromium } = require('playwright');
const { irPara, abrirBlocos } = require('./ajuda-testes.cjs');

const TELAS = ['Indicadores Gerais', 'Painel', 'Lançamentos', 'Relatório', 'Conferência',
  'Indicadores', 'Chamados', 'Projetos', 'Metas', 'SLAs', 'Auditoria'];

// Roda DENTRO da página: precisa do layout de verdade, não do CSS em texto.
const MEDIR = () => {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const razao = (a, b) => { const x = lum(a), y = lum(b); const hi = Math.max(x, y), lo = Math.min(x, y); return (hi + 0.05) / (lo + 0.05); };
  const rgb = (txt) => {
    const m = String(txt).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { cor: [p[0], p[1], p[2]], alfa: p.length > 3 ? p[3] : 1 };
  };
  // O primeiro ancestral com fundo OPACO é o que o olho enxerga atrás do texto.
  const fundoDe = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const f = rgb(getComputedStyle(n).backgroundColor);
      if (f && f.alfa >= 0.95) return f.cor;
    }
    const f = rgb(getComputedStyle(document.body).backgroundColor);
    return f ? f.cor : [255, 255, 255];
  };
  const achados = [];
  for (const el of document.querySelectorAll('body *')) {
    const proprio = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!proprio) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const e = getComputedStyle(el);
    if (e.visibility === 'hidden' || e.display === 'none' || Number(e.opacity) < 0.3) continue;
    const t = rgb(e.color);
    if (!t || t.alfa < 0.5) continue;
    const px = parseFloat(e.fontSize);
    const peso = parseInt(e.fontWeight, 10) || 400;
    const grande = px >= 24 || (px >= 18.66 && peso >= 700);
    const exigido = grande ? 3 : 4.5;
    const obtido = razao(t.cor, fundoDe(el));
    if (obtido + 0.005 < exigido) {
      achados.push({
        texto: el.textContent.trim().slice(0, 44),
        classe: (el.getAttribute('class') || el.tagName.toLowerCase()).slice(0, 38),
        tinta: e.color, fundo: `rgb(${fundoDe(el).join(',')})`,
        px, peso, obtido: Math.round(obtido * 100) / 100, exigido,
      });
    }
  }
  return achados;
};

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const falhas = [];
  for (const tema of ['claro', 'escuro']) {
    const pag = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
    await pag.goto('file://' + __dirname + '/teste-local.html');
    await pag.waitForSelector('#modulos button', { timeout: 20000 });
    await pag.evaluate((t) => {
      localStorage.setItem('iarx-tema', t);
      document.documentElement.setAttribute('data-theme', t === 'claro' ? 'light' : 'dark');
    }, tema);
    await pag.waitForTimeout(200);

    console.log(`\n=== tema ${tema} ===`);
    for (const tela of TELAS) {
      await irPara(pag, tela, 700);
      await abrirBlocos(pag);
      await pag.waitForTimeout(500);
      const achados = await pag.evaluate(MEDIR);
      // Um mesmo par cor/fundo repetido em 40 linhas de tabela é UM problema,
      // não 40: agrupa por classe + tamanho antes de contar.
      const porChave = new Map();
      for (const a of achados) {
        const k = `${a.classe}|${a.px}|${a.obtido}`;
        if (!porChave.has(k)) porChave.set(k, { ...a, n: 0 });
        porChave.get(k).n += 1;
      }
      const lista = [...porChave.values()];
      console.log(`  ${lista.length ? '✗' : '✓'} ${tela}${lista.length ? ` — ${lista.length} par(es)` : ''}`);
      for (const a of lista) {
        console.log(`      ${a.obtido}:1 (precisa ${a.exigido}) · ${a.px}px/${a.peso} · ${a.classe} · ${a.tinta} sobre ${a.fundo} · "${a.texto}" ×${a.n}`);
        falhas.push(`${tema} ${tela}: ${a.classe} ${a.obtido}:1`);
      }
    }
    await pag.close();
  }
  await nav.close();
  console.log(falhas.length ? `\n${falhas.length} PAR(ES) ABAIXO DA RÉGUA AA` : '\nTUDO ACIMA DA RÉGUA AA');
  process.exit(falhas.length ? 1 : 0);
})();
