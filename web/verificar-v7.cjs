// O que a carga grava aparecendo na tela, e os indicadores agrupados por módulo.
//
// As duas coisas que o cliente disse não estar vendo: o número do documento
// (IDDOC/DOCNUMBER) e o registro de por que a despesa está reconhecida. Mais o
// agrupamento por módulo nos Indicadores Gerais.
//
//   DATABASE_PATH=... npx tsx server/src/db/preparar-verificacao-v2.ts
//   DATABASE_PATH=... PORT=3399 node server/dist/index.js
//   BASE_URL=http://127.0.0.1:3399 node web/verificar-v7.cjs
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3399';
const SENHA = process.env.SENHA || 'varredura2026';
const ARQUIVO = path.join(__dirname, '..', 'server', 'test', 'dados', 'contas-pagar-exemplo.csv');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || '/opt/pw-browsers/chromium' });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/ERR_|net::|favicon|Failed to load resource/.test(t)) erros.push('console: ' + t);
  });
  const ok = (r, b, d = '') => {
    console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`);
    if (!b) falhas.push(r + (d ? ' — ' + d : ''));
  };

  await pag.goto(BASE + '/');
  await pag.waitForLoadState('networkidle');
  await pag.fill('input[autocomplete="username"], input[name="usuario"]', process.env.USUARIO || 'gestora');
  await pag.fill('input[type="password"]', SENHA);
  await pag.click('button[type="submit"]');
  await pag.waitForSelector('.menu a, .cartao, h1', { timeout: 15000 });
  await pag.waitForTimeout(800);
  if (!(await pag.$('.menu a'))) {
    await pag.locator('.cartao button').filter({ hasNotText: 'Sair de' }).first().click();
  }
  await pag.waitForSelector('.menu a', { timeout: 15000 });

  const abrirCartoes = async () => {
    for (let v = 0; v < 8; v++) {
      const d = await pag.$$('.cartao.dobrado > header .cartao-dobra');
      if (!d.length) return;
      for (const b of d) { await b.click(); await pag.waitForTimeout(150); }
    }
  };
  const irPara = async (rota, espera = 1500) => {
    await pag.goto(BASE + rota);
    await pag.waitForTimeout(espera);
  };
  const texto = () => pag.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));

  // ============================================ 1. os indicadores agrupados
  console.log('\nINDICADORES — agrupados pelo módulo a que pertencem');
  await irPara('/indicadores', 2500);

  const grupos = await pag.evaluate(() => {
    const mods = [...document.querySelectorAll('.cartao-modulo')];
    return {
      modulos: mods.map((m) => ({
        titulo: (m.querySelector(':scope > header h2') || {}).textContent.replace(/^\s*[+−]\s*/, '').trim(),
        aberto: m.querySelector(':scope > header .cartao-dobra').getAttribute('aria-expanded'),
        dentro: m.querySelectorAll(':scope > .cartao-corpo > .grade > .cartao, :scope > .cartao-corpo > .cartao').length,
        abertosDentro: [...m.querySelectorAll(':scope > .cartao-corpo > .grade > .cartao, :scope > .cartao-corpo > .cartao')]
          .filter((c) => !c.classList.contains('dobrado')).length,
      })),
      soltos: [...document.querySelectorAll('.grade.empilhada > .cartao')].filter((c) => !c.classList.contains('cartao-modulo')).length,
    };
  });
  ok('há um módulo para cada negócio', grupos.modulos.length === 3,
    grupos.modulos.map((m) => m.titulo).join(', '));
  ok('e nenhum indicador ficou solto fora de um módulo', grupos.soltos === 0, String(grupos.soltos));
  ok('o módulo chega aberto, mostrando os indicadores dele',
    grupos.modulos.every((m) => m.aberto === 'true' && m.dentro > 0),
    grupos.modulos.map((m) => `${m.titulo}:${m.dentro}`).join(' · '));
  ok('e os indicadores dentro chegam fechados, um por linha',
    grupos.modulos.every((m) => m.abertosDentro === 0),
    grupos.modulos.map((m) => `${m.titulo}:${m.abertosDentro} abertos`).join(' · '));

  // Fechar o módulo tem de fechar os indicadores dele — é o pedido.
  const antes = await pag.evaluate(() =>
    [...document.querySelectorAll('.cartao-modulo')][0]
      .querySelectorAll(':scope > .cartao-corpo > .grade > .cartao, :scope > .cartao-corpo > .cartao').length);
  await pag.evaluate(() =>
    document.querySelector('.cartao-modulo > header .cartao-dobra').click());
  await pag.waitForTimeout(500);
  const depois = await pag.evaluate(() => {
    const m = document.querySelector('.cartao-modulo');
    return {
      aberto: m.querySelector(':scope > header .cartao-dobra').getAttribute('aria-expanded'),
      visiveis: [...m.querySelectorAll(':scope > .cartao-corpo > .grade > .cartao, :scope > .cartao-corpo > .cartao')]
        .filter((c) => c.offsetParent !== null).length,
    };
  });
  ok('fechar o módulo recolhe os indicadores dele',
    depois.aberto === 'false' && depois.visiveis === 0, `${antes} dentro → ${depois.visiveis} visíveis`);
  await pag.evaluate(() => document.querySelector('.cartao-modulo > header .cartao-dobra').click());
  await pag.waitForTimeout(400);
  ok('e reabrir devolve os indicadores',
    (await pag.evaluate(() => [...document.querySelector('.cartao-modulo')
      .querySelectorAll(':scope > .cartao-corpo > .grade > .cartao, :scope > .cartao-corpo > .cartao')]
      .filter((c) => c.offsetParent !== null).length)) === antes);

  // ================================= 2. a carga, e o que ela deixa visível
  console.log('\nCARGA — subir o arquivo para haver o que olhar');
  await irPara('/planilhas');
  await abrirCartoes();
  const bloco = () => pag.locator('.cartao', { hasText: 'Carga de Contas a Pagar' });
  await bloco().locator('input[type="file"]').setInputFiles(ARQUIVO);
  await bloco().locator('button:text-is("Analisar")').click();
  await pag.waitForTimeout(2500);
  const fechados = () => bloco().locator('.cartao-dobra[aria-expanded="false"]');
  for (let v = 0; v < 12 && (await fechados().count()) > 0; v++) {
    await fechados().first().click();
    await pag.waitForTimeout(200);
  }
  const novos = () => bloco().locator('button:text-is("Cadastrar todos os novos")');
  for (let i = 0, n = await novos().count(); i < n; i++) { await novos().nth(i).click(); await pag.waitForTimeout(200); }
  const umAUm = () => bloco().locator('button:text-is("Criar novo")');
  for (let i = 0, n = await umAUm().count(); i < n; i++) { await umAUm().nth(i).click(); await pag.waitForTimeout(120); }
  await pag.waitForTimeout(400);
  // Numa base que já recebeu esta carga não sobra decisão nenhuma, e a tela vai
  // direto ao confronto. O roteiro aceita os dois caminhos para poder rodar
  // duas vezes seguidas sem recriar o banco.
  const prosseguir = bloco().locator('button', { hasText: 'Prosseguir com a importação' });
  if (await prosseguir.count()) {
    await prosseguir.click();
    await pag.waitForTimeout(2500);
  }
  await bloco().locator('button:text-is("Importar")').click();
  await pag.waitForTimeout(3000);
  ok('a carga entrou', /lançamento\(s\) novo\(s\)|já estava\(m\) igual\(is\)/.test(await texto()));

  console.log('\nLANÇAMENTOS — o número do documento e o criador na origem');
  await irPara('/lancamentos', 2200);
  await abrirCartoes();
  const cab = await pag.evaluate(() =>
    [...document.querySelectorAll('table thead th')].map((t) => t.textContent.trim()));
  ok('a tabela tem a coluna Documento', cab.includes('Documento'), cab.join(' · '));

  const corpo = await texto();
  ok('e um número de documento da carga aparece', /550120/.test(corpo));
  ok('o criador na origem aparece na linha', /por MIQUEIASSILVA/.test(corpo));
  ok('e a linha diz que o reconhecimento veio do cadastro',
    /reconhecido pelo cadastro/.test(corpo));

  console.log('\nRELATÓRIO — a ficha do lançamento');
  await irPara('/relatorio', 2500);
  await abrirCartoes();
  // O relatório é um pivô: a linha do LANÇAMENTO só existe depois de expandir
  // a hierarquia até ela. Quem verifica faz o que o usuário faz.
  for (let v = 0; v < 8; v++) {
    const fechados = await pag.$$('table [aria-expanded="false"]');
    if (!fechados.length) break;
    for (const f of fechados) { await f.click().catch(() => {}); await pag.waitForTimeout(120); }
  }
  await pag.waitForTimeout(600);
  const linha = pag.locator('tr.lancamento').first();
  ok('o pivô chega ao nível do lançamento', (await linha.count()) > 0);
  if (await linha.count()) {
    await linha.click();
    await pag.waitForTimeout(1200);
    const ficha = await texto();
    ok('a ficha traz o criador na origem', /Criador na origem/.test(ficha));
    ok('e traz a linha de reconhecimento', /Reconhecimento/.test(ficha));
    ok('com o número do documento junto', /Documento vinculado/.test(ficha));
  }

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
