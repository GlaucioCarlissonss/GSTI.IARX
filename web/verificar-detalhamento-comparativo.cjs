// O DETALHAMENTO FINANCEIRO É COMPARATIVO — ENTREGA 1: A ESTRUTURA.
//
// A irmã desta conferência é `artifact/testar-detalhamento-comparativo.cjs`, e
// as duas medem a mesma promessa em duas pontas: o detalhamento de um número
// financeiro deixa de ser UMA lista e passa a ser camadas empilhadas —
//
//   1. Diferença vs mês anterior
//   2. O que veio no mês filtrado
//   3. Mês anterior: o que veio × o que não veio
//   4. (só no detalhamento de recorte) Recorte completo — o que o indicador soma
//
// — de largura cheia, uma abaixo da outra, todas FECHADAS ao nascer, com o
// total visível no cabeçalho de cada uma e o corpo montado só no primeiro
// clique.
//
// Aqui há uma diferença de meio que a conferência precisa cobrir: no artifact
// os lançamentos estão na memória; no app cada mês é uma consulta. Então esta
// suíte também CONTA as chamadas à API — o mês anterior tem de ser buscado uma
// vez, e não uma por linha.
//
// Uso: com o servidor no ar sobre uma base de verificação (nunca a base real),
//   BASE_URL=http://127.0.0.1:3333 node web/verificar-detalhamento-comparativo.cjs
const { chromium } = require('playwright');

const B = process.env.BASE_URL || 'http://127.0.0.1:3333';

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const erros = [];
  pag.on('pageerror', (e) => erros.push(e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::|401/.test(m.text())) erros.push(m.text()); });

  // Conta as consultas de lançamento: é o que prova que o mês anterior custa
  // UMA chamada, e não uma por linha.
  let consultas = [];
  pag.on('request', (r) => {
    if (r.url().includes('/relatorio/lancamentos')) consultas.push(r.url());
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

  const irPara = async (rotulo) => {
    await pag.click(`.menu a:has-text("${rotulo}")`);
    await pag.waitForTimeout(1400);
    await pag.evaluate(() => {
      document.querySelectorAll('.cartao-dobra[aria-expanded="false"]').forEach((b) => b.click());
    });
    await pag.waitForTimeout(700);
  };

  const lerCamadas = () => pag.evaluate(() => {
    const area = document.querySelector('.modal .det-comp, [role="dialog"] .det-comp');
    if (!area) return null;
    return {
      cabecalho: area.querySelector('.det-comp-cab').textContent.replace(/\s+/g, ' ').trim(),
      largura: Math.round(area.getBoundingClientRect().width),
      camadas: [...area.querySelectorAll('.camada')].map((s) => {
        const bt = s.querySelector('.camada-bt');
        const corpo = s.querySelector('.camada-corpo');
        return {
          rotulo: s.querySelector('.camada-rot').textContent.trim(),
          valor: s.querySelector('.camada-val').textContent.replace(/\s+/g, ' ').trim(),
          aberta: bt.getAttribute('aria-expanded') === 'true',
          controla: bt.getAttribute('aria-controls') === corpo.id && !!corpo.id,
          escondido: corpo.hidden,
          largura: Math.round(s.getBoundingClientRect().width),
          linhas: corpo.querySelectorAll('tbody tr').length,
        };
      }),
    };
  });

  const fechar = async () => {
    await pag.evaluate(() => {
      const bts = [...document.querySelectorAll('.modal button, [role="dialog"] button')];
      const f = bts.find((b) => b.textContent.trim() === 'Fechar');
      if (f) f.click();
    });
    await pag.waitForTimeout(300);
  };

  // ------------------------------------------------------------- estrutura
  console.log('\nESTRUTURA — Financeiro: todo indicador de lançamento abre em camadas');
  await irPara('Dashboard financeiro');

  const drills = await pag.$$('.indicador .drill, .indicador[role="button"], .drill');
  ok('a tela tem indicadores com detalhamento', drills.length > 0, `${drills.length}`);

  let medidos = 0;
  for (let i = 0; i < Math.min(drills.length, 4); i += 1) {
    consultas = [];
    await drills[i].scrollIntoViewIfNeeded();
    await drills[i].click();
    await pag.waitForTimeout(1600);
    const d = await lerCamadas();
    if (!d) { await fechar(); continue; }
    medidos += 1;
    const nome = (await pag.$eval('.modal h2, [role="dialog"] h2', (h) => h.textContent.trim())
      .catch(() => `indicador ${i}`)).slice(0, 48);

    const rotulos = d.camadas.map((c) => c.rotulo.toLowerCase());
    ok(`${nome}: a camada 1 é a diferença`, rotulos[0] === 'diferença vs mês anterior', rotulos[0]);
    ok(`${nome}: a camada 2 é o mês filtrado`, rotulos[1] === 'o que veio no mês filtrado', rotulos[1]);
    ok(`${nome}: a camada 3 é o mês anterior`,
      rotulos[2] === 'mês anterior: o que veio × o que não veio', rotulos[2]);
    ok(`${nome}: todas nascem fechadas`, d.camadas.every((c) => !c.aberta && c.escondido));
    ok(`${nome}: nenhum corpo foi montado antes do clique`, d.camadas.every((c) => c.linhas === 0));
    ok(`${nome}: cada botão anuncia o corpo que controla`, d.camadas.every((c) => c.controla));
    ok(`${nome}: as camadas ocupam a largura toda`,
      d.camadas.every((c) => Math.abs(c.largura - d.largura) <= 2),
      `área ${d.largura}px`);
    ok(`${nome}: o cabeçalho diz o mês filtrado e o de comparação`,
      /\d{2}\/\d{4} vs \d{2}\/\d{4}/.test(d.cabecalho), d.cabecalho.slice(0, 80));
    // O mês anterior é UMA consulta a mais. Num recorte de vários meses são
    // duas: o mês em foco também precisa vir separado, porque a resposta do
    // recorte pode chegar cortada e somaria menos do que o mês inteiro.
    const multiMes = d.camadas.length === 4;
    ok(`${nome}: a comparação custa ${multiMes ? 'duas consultas' : 'uma consulta'} a mais`,
      consultas.length === (multiMes ? 3 : 2), `${consultas.length} consulta(s)`);

    await fechar();
  }
  ok('pelo menos três indicadores abriram em camadas', medidos >= 3, `${medidos}`);

  // ------------------------------------------- o corpo chega só no clique
  console.log('\nSOB DEMANDA — o corpo é montado no primeiro clique');
  consultas = [];
  await drills[0].scrollIntoViewIfNeeded();
  await drills[0].click();
  await pag.waitForTimeout(1600);
  const antesDeAbrir = await lerCamadas();
  const consultasAoAbrirModal = consultas.length;

  await pag.evaluate(() => {
    [...document.querySelectorAll('.camada-bt')]
      .find((b) => /o que veio no mês filtrado/i.test(b.textContent)).click();
  });
  await pag.waitForTimeout(500);
  const depois = await lerCamadas();

  ok('fechada, a camada não tinha tabela', antesDeAbrir.camadas[1].linhas === 0);

  // ------------------------------------------- hierarquia Empresa → Filial
  console.log('\nHIERARQUIA — Empresa → Filial dentro de cada camada');
  const hier = await pag.evaluate(async () => {
    const corpo = [...document.querySelectorAll('.camada')]
      .find((s) => /o que veio no mês filtrado/i.test(s.textContent)).querySelector('.camada-corpo');
    const empresas = [...corpo.querySelectorAll('.grupo-unidade.nivel-1')];
    const antes = {
      empresas: empresas.length,
      filiais: corpo.querySelectorAll('.grupo-unidade.nivel-2').length,
      itens: corpo.querySelectorAll('tbody tr:not(.grupo-unidade)').length,
      fechadas: empresas.every((e) => e.querySelector('.arv-abrir').getAttribute('aria-expanded') === 'false'),
      // O subtotal de cada empresa aparece com o grupo fechado — é por ele que
      // se lê o peso da unidade sem abrir nada.
      comSubtotal: empresas.every((e) => /R\$/.test(e.querySelector('.grupo-valor').textContent)),
      // Valor decrescente entre as empresas.
      valores: empresas.map((e) => Number(e.querySelector('.grupo-valor').textContent
        .replace(/[^\d,]/g, '').replace(',', '.'))),
      nomeado: empresas.every((e) => e.querySelector('.grupo-nome').textContent.trim().length > 0),
    };
    empresas[0].querySelector('.arv-abrir').click();
    await new Promise((r) => setTimeout(r, 200));
    const comEmpresa = {
      filiais: corpo.querySelectorAll('.grupo-unidade.nivel-2').length,
      itens: corpo.querySelectorAll('tbody tr:not(.grupo-unidade)').length,
      anunciada: empresas[0].querySelector('.arv-abrir').getAttribute('aria-expanded') === 'true',
    };
    corpo.querySelector('.grupo-unidade.nivel-2 .arv-abrir').click();
    await new Promise((r) => setTimeout(r, 200));
    const comFilial = { itens: corpo.querySelectorAll('tbody tr:not(.grupo-unidade)').length };
    // Fechar a empresa recolhe as filiais dela.
    empresas[0].querySelector('.arv-abrir').click();
    await new Promise((r) => setTimeout(r, 200));
    const fechada = {
      filiais: corpo.querySelectorAll('.grupo-unidade.nivel-2').length,
      itens: corpo.querySelectorAll('tbody tr:not(.grupo-unidade)').length,
    };
    return { antes, comEmpresa, comFilial, fechada };
  });
  ok('a camada abre pela EMPRESA', hier.antes.empresas > 0, `${hier.antes.empresas} empresa(s)`);
  ok('as empresas nascem fechadas', hier.antes.fechadas);
  ok('nenhuma filial nem lançamento à vista antes do clique',
    hier.antes.filiais === 0 && hier.antes.itens === 0,
    `${hier.antes.filiais} filial(is) · ${hier.antes.itens} item(ns)`);
  ok('cada empresa diz o seu subtotal sem precisar abrir', hier.antes.comSubtotal);
  ok('as empresas vêm em valor decrescente',
    hier.antes.valores.every((v, i, a) => i === 0 || a[i - 1] >= v), JSON.stringify(hier.antes.valores));
  ok('cada empresa vem nomeada', hier.antes.nomeado);
  ok('abrir a empresa revela as FILIAIS, e só elas',
    hier.comEmpresa.filiais > 0 && hier.comEmpresa.itens === 0,
    `${hier.comEmpresa.filiais} filial(is) · ${hier.comEmpresa.itens} item(ns)`);
  ok('o estado da empresa é anunciado', hier.comEmpresa.anunciada);
  ok('abrir a filial revela os lançamentos', hier.comFilial.itens > 0, `${hier.comFilial.itens} item(ns)`);
  ok('fechar a empresa recolhe a filial que estava aberta',
    hier.fechada.filiais === 0 && hier.fechada.itens === 0,
    `${hier.fechada.filiais} filial(is) · ${hier.fechada.itens} item(ns)`);

  ok('aberta, a camada traz as linhas', depois.camadas[1].linhas > 0, `${depois.camadas[1].linhas} linha(s)`);
  ok('abrir a camada não dispara consulta nova', consultas.length === consultasAoAbrirModal,
    `${consultas.length} de ${consultasAoAbrirModal}`);
  ok('as outras camadas seguem fechadas e sem tabela',
    [depois.camadas[0], depois.camadas[2]].every((c) => !c.aberta && c.linhas === 0));

  // ---------------------------------------------------------------- teclado
  console.log('\nTECLADO — a camada abre pelo foco e pelo Enter, e o estado é anunciado');
  const porTeclado = await pag.evaluate(async () => {
    const bt = [...document.querySelectorAll('.camada-bt')]
      .find((b) => /mês anterior/i.test(b.textContent));
    bt.focus();
    const focado = document.activeElement === bt;
    const contorno = getComputedStyle(bt, ':focus-visible').outlineWidth;
    bt.click();
    await new Promise((r) => setTimeout(r, 400));
    return { focado, contorno, aberta: bt.getAttribute('aria-expanded') === 'true' };
  });
  ok('o cabeçalho da camada recebe foco', porTeclado.focado);
  ok('o foco é visível', porTeclado.contorno !== '0px', porTeclado.contorno);
  ok('Enter abre a camada', porTeclado.aberta);

  // --------------------------------------------- contraste das camadas novas
  console.log('\nCONTRASTE — o que foi acrescentado passa na régua AA, nos dois temas');
  for (const tema of ['light', 'dark']) {
    await pag.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
    await pag.waitForTimeout(250);
    const pares = await pag.evaluate(() => {
      const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
        .map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const fundo = (e) => { let n = e; while (n) { const c = getComputedStyle(n).backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; n = n.parentElement; }
        return 'rgb(255,255,255)'; };
      const razao = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const saida = [];
      for (const sel of ['.det-comp-cab', '.camada-rot', '.camada-val', '.camada-qtd', '.camada-sem', '.camada-seta', '.delta']) {
        for (const e of document.querySelectorAll('.modal ' + sel + ', [role="dialog"] ' + sel)) {
          const s = getComputedStyle(e);
          saida.push({ sel, px: parseFloat(s.fontSize), r: +razao(s.color, fundo(e)).toFixed(2) });
        }
      }
      return saida;
    });
    const abaixo = pares.filter((p) => p.r < 4.5);
    ok(`tema ${tema}: nada abaixo de 4,5:1`, abaixo.length === 0,
      abaixo.length ? abaixo.map((p) => `${p.sel} ${p.r}`).join(', ') : `${pares.length} par(es) medidos`);
  }
  await pag.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await fechar();

  // ----------------------------- sem janela de competência, nada muda
  console.log('\nSEM COMPETÊNCIA — a Conferência continua com a lista de sempre');
  await irPara('Conferência de origem');
  const drillConf = await pag.$('.drill');
  if (drillConf) {
    await drillConf.click();
    await pag.waitForTimeout(1500);
    const temCamadas = await pag.$('.modal .det-comp, [role="dialog"] .det-comp');
    const temTabela = await pag.$('.modal table, [role="dialog"] table');
    ok('o detalhamento sem janela de competência não ganha camadas', !temCamadas);
    ok('e segue mostrando a lista', !!temTabela);
    await fechar();
  } else {
    console.log('  · a Conferência não tem detalhamento nesta base');
  }

  console.log(`\n=== erros de console: ${erros.length ? erros.slice(0, 4).join(' | ') : 'nenhum'} ===`);
  console.log(`=== ✗=${falhas.length} ===`);
  if (falhas.length) falhas.forEach((f) => console.log('  ✗ ' + f));
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
