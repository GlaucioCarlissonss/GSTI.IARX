// Varredura das telas do app local: 23 páginas × 2 temas × 2 larguras.
//
// Suba o servidor e rode com as credenciais do ambiente:
//   npm start
//   node web/verificar-telas.cjs        (usa gestora/varredura2026, da base v2)
//   USUARIO=... SENHA=... node web/verificar-telas.cjs   (outra base)
//
// Falha em erro de console, página vazia, rolagem horizontal, ou aviso cujos
// filhos viraram colunas (o sintoma de `display:flex` em texto corrido).
const { chromium } = require('playwright');

const PAGINAS = [
  ['/', 'Painel executivo'], ['/indicadores', 'Indicadores Gerais'],
  ['/financeiro', 'Dashboard financeiro'], ['/lancamentos', 'Lançamentos'],
  ['/fechamentos', 'Fechamento'], ['/conferencia', 'Conferência'], ['/relatorio', 'Relatório'],
  ['/projetos', 'Projetos'],
  ['/projetos/cadastro', 'Cadastro de projetos'], ['/sla', 'Indicadores de SLA'], ['/sla/registros', 'Chamados'],
  ['/suporte/ostick', 'Sistema OStick'], ['/suporte/bitrix24', 'Sistema Bitrix24'],
  ['/suporte/integracoes', 'Integrações'],
  ['/planilhas', 'Planilhas'], ['/clientes', 'Clientes e unidades'], ['/cadastros', 'Cadastros'],
  ['/metas', 'Metas'], ['/slas', 'SLAs'], ['/reducao', 'Plano de redução'],
  ['/reconhecedores', 'Quem reconhece despesa'],
  ['/acessos', 'Usuários e acessos'], ['/auditoria', 'Auditoria'],
];

// Os módulos do negócio, como o menu deve apresentá-los.
const MODULOS = ['Controle Financeiro', 'Gestão de Projetos', 'Gestão de Suporte TI', 'Sistema'];

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
      await pag.fill('input[autocomplete="username"], input[name="usuario"]', process.env.USUARIO || 'gestora');
      await pag.fill('input[type="password"], input[name="senha"]', process.env.SENHA || 'varredura2026');
      await pag.click('button[type="submit"], form button');
      await pag.waitForTimeout(2200);
      // A sessão começa escolhendo o cliente. Sem esse clique a varredura
      // ficaria na tela de boas-vindas e acusaria "menu vazio" em toda página.
      const escolha = await pag.$('.cartao button');
      if (escolha && !(await pag.$('.menu a'))) {
        await escolha.click();
        await pag.waitForTimeout(1800);
      }

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
          // o botão de tema é requisito em toda tela, não só no painel
          semTema: !document.querySelector('.bt-tema'),
          grupos: [...document.querySelectorAll('.menu-grupo')].map((g) => g.textContent.trim()),
        }));
        if (JSON.stringify(d.grupos) !== JSON.stringify(MODULOS)) {
          falhas.push(`${tema}/${largura}/${nome}: menu fora dos módulos — ${d.grupos.join(', ')}`);
        }
        const marcas = [d.vazio && 'VAZIA', d.rolagem && 'ROLAGEM-H', d.avisoQuebrado && 'AVISO-QUEBRADO',
          d.semTema && 'SEM-BOTAO-DE-TEMA'].filter(Boolean);
        console.log(`  ${nome.padEnd(22)} ${marcas.length ? marcas.join(' ') : 'ok'}`);
        marcas.forEach((m) => falhas.push(`${tema}/${largura}/${nome}: ${m}`));
      }
      if (erros.length) { console.log('  erros:', erros.join(' | ')); falhas.push(...erros.map((e) => `${tema}/${largura}: ${e}`)); }
      await pag.close();
    }
  }

  // A escolha explícita tem de vencer a preferência do aparelho — nos dois
  // sentidos. É o que o botão faz, e é onde um tema costuma falhar.
  for (const [preferencia, escolha, esperado] of [['dark', 'claro', 'claro'], ['light', 'escuro', 'escuro']]) {
    const pag = await nav.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme: preferencia });
    const erros = [];
    pag.on('pageerror', (e) => erros.push(e.message));
    await pag.goto(BASE + '/');
    await pag.waitForLoadState('networkidle');
    await pag.fill('input[autocomplete="username"], input[name="usuario"]', process.env.USUARIO || 'gestora');
    await pag.fill('input[type="password"], input[name="senha"]', process.env.SENHA || 'varredura2026');
    await pag.click('button[type="submit"], form button');
    await pag.waitForTimeout(2200);
    await pag.evaluate((t) => localStorage.setItem('gsti-tema', t), escolha);
    await pag.reload();
    await pag.waitForTimeout(2000);

    console.log(`\n== aparelho ${preferencia} · escolha ${escolha} ==`);
    for (const [rota, nome] of PAGINAS) {
      await pag.goto(BASE + rota);
      await pag.waitForTimeout(900);
      const d = await pag.evaluate(() => {
        const corpo = getComputedStyle(document.body);
        const rgb = (c) => (c.match(/\d+/g) || []).slice(0, 3).map(Number);
        const luz = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return {
          marca: document.documentElement.getAttribute('data-tema'),
          claro: luz(rgb(corpo.backgroundColor)) > 128,
          // fundo e tinta em lados opostos da escala: texto legível
          contraste: Math.abs(luz(rgb(corpo.backgroundColor)) - luz(rgb(corpo.color))) > 120,
        };
      });
      const ok = d.marca === escolha && d.claro === (esperado === 'claro') && d.contraste;
      console.log(`  ${nome.padEnd(22)} ${ok ? 'ok' : 'TEMA ERRADO'}`);
      if (!ok) falhas.push(`${preferencia}+${escolha}/${nome}: data-tema=${d.marca} claro=${d.claro} contraste=${d.contraste}`);
    }
    if (erros.length) falhas.push(...erros.map((e) => `${preferencia}+${escolha}: ${e}`));
    await pag.close();
  }

  // ------------------------------------------------------ árvore de clientes
  // A árvore de "Clientes e unidades" precisa expandir/recolher pelo teclado,
  // não só clique — e o número de linhas da tabela tem de acompanhar. Bloco à
  // parte porque só faz sentido havendo uma matriz com filial na base.
  {
    const pag = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
    const erros = [];
    pag.on('pageerror', (e) => erros.push(e.message));
    await pag.goto(BASE + '/');
    await pag.waitForLoadState('networkidle');
    await pag.fill('input[autocomplete="username"], input[name="usuario"]', process.env.USUARIO || 'gestora');
    await pag.fill('input[type="password"], input[name="senha"]', process.env.SENHA || 'varredura2026');
    await pag.click('button[type="submit"], form button');
    await pag.waitForTimeout(2200);
    const escolha = await pag.$('.cartao button');
    if (escolha && !(await pag.$('.menu a'))) { await escolha.click(); await pag.waitForTimeout(1800); }

    await pag.goto(BASE + '/clientes');
    await pag.waitForTimeout(1300);
    console.log('\n== árvore de clientes ==');
    const botao = await pag.$('[aria-expanded]');
    if (!botao) {
      console.log('  (nenhuma matriz com filial nesta base — bloco pulado)');
    } else {
      const antes = await botao.getAttribute('aria-expanded');
      const linhasAntes = await pag.$$eval('table tbody tr', (rs) => rs.length);
      await botao.focus();
      await pag.keyboard.press('Enter');
      await pag.waitForTimeout(400);
      const depois = await botao.getAttribute('aria-expanded');
      const linhasDepois = await pag.$$eval('table tbody tr', (rs) => rs.length);
      const ok = depois !== antes && linhasDepois !== linhasAntes;
      console.log(`  Enter alterna aria-expanded (${antes} → ${depois}) e as linhas (${linhasAntes} → ${linhasDepois}) ${ok ? 'ok' : 'FALHOU'}`);
      if (!ok) falhas.push(`árvore de clientes: Enter não alternou estado/linhas (${antes}→${depois}, ${linhasAntes}→${linhasDepois})`);
    }
    if (erros.length) { console.log('  erros:', erros.join(' | ')); falhas.push(...erros.map((e) => `árvore de clientes: ${e}`)); }
    await pag.close();
  }

  console.log('\n=== falhas: ' + (falhas.length ? '\n' + falhas.join('\n') : 'nenhuma') + ' ===');
  await nav.close();
  process.exit(falhas.length ? 1 : 0);
})();
