// Varredura das telas do app local: 12 páginas × 2 temas × 2 larguras.
//
// Suba o servidor e rode com as credenciais do ambiente:
//   npm start
//   EMAIL=gestor@gsti.local SENHA=... node web/verificar-telas.cjs
//
// Falha em erro de console, página vazia, rolagem horizontal, ou aviso cujos
// filhos viraram colunas (o sintoma de `display:flex` em texto corrido).
const { chromium } = require('playwright');

const PAGINAS = [
  ['/', 'Painel executivo'], ['/financeiro', 'Dashboard financeiro'], ['/lancamentos', 'Lançamentos'],
  ['/fechamentos', 'Fechamento'], ['/conferencia', 'Conferência'], ['/projetos', 'Projetos'],
  ['/projetos/cadastro', 'Cadastro de projetos'], ['/sla', 'SLA'], ['/sla/registros', 'Registros SLA'],
  ['/planilhas', 'Planilhas'], ['/cadastros', 'Cadastros'], ['/auditoria', 'Auditoria'],
];

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3333';

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const falhas = [];

  for (const tema of ['light', 'dark']) {
    for (const largura of [1400, 400]) {
      const pag = await nav.newPage({ viewport: { width: largura, height: 1000 }, colorScheme: tema });
      const erros = [];
      pag.on('pageerror', (e) => erros.push(e.message));
      pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::|favicon|401/.test(m.text())) erros.push(m.text()); });

      await pag.goto(BASE + '/');
      await pag.waitForLoadState('networkidle');
      await pag.fill('input[type="email"], input[name="email"]', process.env.EMAIL || 'gestor@gsti.local');
      await pag.fill('input[type="password"], input[name="senha"]', process.env.SENHA || '');
      await pag.click('button[type="submit"], form button');
      await pag.waitForTimeout(2200);

      console.log(`\n== ${tema} · ${largura}px ==`);
      for (const [rota, nome] of PAGINAS) {
        await pag.goto(BASE + rota);
        await pag.waitForTimeout(1300);
        const d = await pag.evaluate(() => ({
          vazio: document.querySelector('.pagina')?.textContent.trim().length < 40,
          rolagem: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          // aviso quebrado: filhos do bloco viram colunas lado a lado
          avisoQuebrado: [...document.querySelectorAll('.aviso')].some((a) => {
            const fs = [...a.children].filter((c) => c.getBoundingClientRect().width > 0);
            if (fs.length < 2) return false;
            const topos = new Set(fs.map((c) => Math.round(c.getBoundingClientRect().top)));
            return topos.size === 1 && fs.length > 2;
          }),
        }));
        const marcas = [d.vazio && 'VAZIA', d.rolagem && 'ROLAGEM-H', d.avisoQuebrado && 'AVISO-QUEBRADO'].filter(Boolean);
        console.log(`  ${nome.padEnd(22)} ${marcas.length ? marcas.join(' ') : 'ok'}`);
        marcas.forEach((m) => falhas.push(`${tema}/${largura}/${nome}: ${m}`));
      }
      if (erros.length) { console.log('  erros:', erros.join(' | ')); falhas.push(...erros.map((e) => `${tema}/${largura}: ${e}`)); }
      await pag.close();
    }
  }

  console.log('\n=== falhas: ' + (falhas.length ? '\n' + falhas.join('\n') : 'nenhuma') + ' ===');
  await nav.close();
  process.exit(falhas.length ? 1 : 0);
})();
