// Contraste de texto medido NO NAVEGADOR, nos dois temas.
//
// Olhar para os tokens não basta: o que decide a legibilidade é a cor que o
// navegador calculou para aquele texto sobre o fundo que de fato ficou atrás
// dele — que pode vir de um ancestral, de um color-mix ou de uma regra de
// estado. Esta varredura percorre cada nó de texto visível, sobe até achar o
// primeiro fundo opaco e aplica a régua da WCAG: 4,5:1 no texto comum e 3:1 no
// texto grande (>=18,66px em negrito, ou >=24px).
//
//   DATABASE_PATH=/tmp/claude-0/verif-saida.sqlite PORT=3401 JWT_SECRET=<32+> node server/dist/index.js
//   BASE_URL=http://localhost:3401 node web/verificar-contraste.cjs
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3401';
const SENHA = process.env.SENHA || 'varredura2026';

const TELAS = [
  ['/', 'Painel executivo'],
  ['/indicadores', 'Indicadores Gerais'],
  ['/lancamentos', 'Lançamentos'],
  ['/relatorio', 'Relatório'],
  ['/sla', 'SLA'],
  ['/projetos', 'Projetos'],
  ['/cadastros', 'Cadastros'],
  ['/auditoria', 'Auditoria'],
];

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
    // Só nós que REALMENTE desenham texto próprio e estão visíveis.
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
        texto: el.textContent.trim().slice(0, 48),
        classe: (el.className && String(el.className).slice(0, 40)) || el.tagName.toLowerCase(),
        px, peso, obtido: Math.round(obtido * 100) / 100, exigido,
      });
    }
  }
  return achados;
};

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const falhas = [];
  for (const tema of ['claro', 'escuro']) {
    const ctx = await nav.newContext({ viewport: { width: 1440, height: 1000 } });
    const pag = await ctx.newPage();
    await pag.goto(BASE + '/');
    await pag.evaluate((t) => localStorage.setItem('gsti-tema', t), tema);
    await pag.reload();
    await pag.waitForLoadState('networkidle');
    await pag.fill('input[autocomplete="username"], input[name="usuario"]', 'gestora');
    await pag.fill('input[type="password"]', SENHA);
    await pag.click('button[type="submit"]');
    await pag.waitForSelector('h1', { timeout: 15000 });
    await pag.waitForTimeout(600);
    if (await pag.$('.cartao button')) await pag.click('.cartao button');
    await pag.waitForSelector('.menu a', { timeout: 15000 });

    console.log(`\n=== tema ${tema} ===`);
    for (const [rota, nome] of TELAS) {
      await pag.goto(BASE + rota);
      await pag.waitForTimeout(1400);
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
      console.log(`  ${lista.length ? '✗' : '✓'} ${nome}${lista.length ? ` — ${lista.length} par(es)` : ''}`);
      for (const a of lista) {
        console.log(`      ${a.obtido}:1 (precisa ${a.exigido}) · ${a.px}px/${a.peso} · ${a.classe} · "${a.texto}" ×${a.n}`);
        falhas.push(`${tema} ${nome}: ${a.classe} ${a.obtido}:1`);
      }
    }
    await ctx.close();
  }
  await nav.close();
  console.log(falhas.length ? `\n${falhas.length} PAR(ES) ABAIXO DA RÉGUA` : '\nTUDO ACIMA DA RÉGUA AA');
  process.exit(falhas.length ? 1 : 0);
})();
