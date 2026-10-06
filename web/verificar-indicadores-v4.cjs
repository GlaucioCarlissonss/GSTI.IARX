// A tela de Indicadores Gerais no navegador: empilhamento, hierarquia,
// barras, cor da despesa compartilhada e tooltip flutuante.
//
// Compilar não é abrir. `tsc` e `vite build` não veem um indicador que ficou
// lado a lado, uma árvore cujo segundo nível nunca aparece, um balão que não
// abre no hover ou um `useDados` que não recarrega — e é exatamente aí que
// esta tela poderia falhar sem ninguém notar.
//
// O que se confere é a LIGAÇÃO e a GEOMETRIA, não a beleza: um indicador que
// divide a linha é o defeito que motivou esta entrega, e ele só aparece em
// pixels.
//
//   DATABASE_PATH=/tmp/verif-v4.sqlite npx tsx server/src/db/preparar-verificacao-v2.ts
//   DATABASE_PATH=/tmp/verif-v4.sqlite PORT=3399 node server/dist/index.js
//   BASE_URL=http://127.0.0.1:3399 node web/verificar-indicadores-v4.cjs
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3399';
const SENHA = process.env.SENHA || 'varredura2026';

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

  // ------------------------------------------------------------------ entrar
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

  // O cartão abre RECOLHIDO e lembra o que foi aberto — é a convenção global.
  // Quem verifica precisa fazer o que o usuário faz: abrir.
  const abrirCartoes = async () => {
    for (let volta = 0; volta < 3; volta += 1) {
      const dobras = await pag.$$('.cartao.dobrado .cartao-dobra');
      if (!dobras.length) break;
      for (const d of dobras) {
        await d.click();
        await pag.waitForTimeout(180);
      }
    }
  };

  // ------------------------------------------------ 1. empilhado, sem vizinho
  console.log('\nLAYOUT — cada indicador ocupa a linha inteira');
  await pag.goto(BASE + '/indicadores');
  await pag.waitForTimeout(1800);

  const antesDeAbrir = await pag.evaluate(() => ({
    cartoes: document.querySelectorAll('.grade.empilhada > .cartao').length,
    dobrados: document.querySelectorAll('.grade.empilhada > .cartao.dobrado').length,
    titulos: [...document.querySelectorAll('.grade.empilhada > .cartao > header h2')].map((h) =>
      h.textContent.replace(/^\s*[−+]\s*/, '').trim()),
  }));
  ok('a tela traz os indicadores empilhados', antesDeAbrir.cartoes >= 6, `${antesDeAbrir.cartoes} bloco(s)`);
  ok('todos abrem COMPRIMIDOS, só com o cabeçalho',
    antesDeAbrir.dobrados === antesDeAbrir.cartoes,
    `${antesDeAbrir.dobrados} de ${antesDeAbrir.cartoes}`);
  ok('o plano de redução vem no topo',
    /Plano de redução/i.test(antesDeAbrir.titulos[0] || ''), antesDeAbrir.titulos[0]);
  ok('e o rateio logo abaixo dele',
    /compartilhadas regularizadas/i.test(antesDeAbrir.titulos[1] || ''), antesDeAbrir.titulos[1]);

  const geometria = await pag.evaluate(() => {
    const caixas = [...document.querySelectorAll('.grade.empilhada > .cartao')].map((c) => c.getBoundingClientRect());
    const ladoALado = caixas.some((a, i) =>
      caixas.slice(i + 1).some((b) => a.top < b.bottom - 1 && b.top < a.bottom - 1));
    const grade = document.querySelector('.grade.empilhada').getBoundingClientRect();
    return { ladoALado, cheios: caixas.every((c) => c.width >= grade.width - 2) };
  });
  ok('nenhum indicador divide a linha com outro', !geometria.ladoALado);
  ok('cada um ocupa 100% da largura disponível', geometria.cheios);

  await abrirCartoes();

  // ------------------------------------------- 2. o indicador de rateio
  console.log('\nRATEIO — o comparativo antes → depois, e a soma que fecha');
  const rateio = await pag.evaluate(() => {
    const bloco = [...document.querySelectorAll('.cartao')].find((c) =>
      /compartilhadas regularizadas/i.test((c.querySelector('header h2') || {}).textContent || ''));
    if (!bloco) return null;
    const dinheiro = (t) => Number(String(t).replace(/[^\d,-]/g, '').replace(/\./g, '').replace(',', '.'));
    const linhas = [...bloco.querySelectorAll('tbody tr')].map((tr) => ({
      empresa: tr.children[0].textContent.trim(),
      proprio: dinheiro(tr.children[1].textContent),
      recebido: dinheiro(tr.children[2].textContent),
      pagadora: /pagadora/.test(tr.children[0].textContent),
      comparativo: !!tr.querySelector('.comparativo'),
    }));
    return {
      linhas,
      criterio: bloco.textContent.includes('proporcional à despesa própria'),
      legenda: !!bloco.querySelector('.legenda-consumo'),
      barras: bloco.querySelectorAll('.comparativo-linha').length,
    };
  });
  ok('o bloco de rateio existe e lista as empresas', rateio && rateio.linhas.length >= 2,
    rateio ? `${rateio.linhas.length} empresa(s)` : '(bloco ausente)');
  if (rateio && rateio.linhas.length) {
    ok('a pagadora original vem marcada', rateio.linhas.some((l) => l.pagadora),
      rateio.linhas.filter((l) => l.pagadora).map((l) => l.empresa).join(', '));
    ok('cada empresa mostra o comparativo antes → depois',
      rateio.linhas.every((l) => l.comparativo), `${rateio.barras} barra(s)`);
    // O lançamento compartilhado da base é de R$ 12.000; a soma das parcelas
    // tem de ser exatamente isso, ou o comparativo mente.
    const soma = Math.round(rateio.linhas.reduce((s, l) => s + l.recebido, 0) * 100) / 100;
    ok('a soma das parcelas é exatamente o valor compartilhado', soma === 12000, `R$ ${soma}`);
    ok('o critério do rateio está escrito na tela', rateio.criterio);
    ok('e a legenda dos dois tons está no bloco', rateio.legenda);
  }

  // ---------------------------------- 3. o indicador de plano de redução
  console.log('\nPLANO DE REDUÇÃO — atual × alvo, e o peso no grupo');
  const plano = await pag.evaluate(() => {
    const bloco = [...document.querySelectorAll('.cartao')].find((c) =>
      /Plano de redução/i.test((c.querySelector('header h2') || {}).textContent || ''));
    if (!bloco) return null;
    const linha = bloco.querySelector('tbody tr');
    return {
      vazio: !!bloco.querySelector('.vazio'),
      texto: linha ? linha.textContent.replace(/\s+/g, ' ').trim() : '',
      comparativo: !!bloco.querySelector('.comparativo'),
      cabecalho: [...bloco.querySelectorAll('thead th')].map((t) => t.textContent.trim()),
    };
  });
  ok('o plano cadastrado aparece', plano && !plano.vazio && plano.texto.length > 0, plano && plano.texto.slice(0, 90));
  ok('com as colunas de atual, alvo, redução e peso no grupo',
    plano && ['Atual', 'Alvo', 'Redução', '% do grupo'].every((c) => plano.cabecalho.includes(c)),
    plano && plano.cabecalho.join(', '));
  ok('e as barras atual × alvo lado a lado', plano && plano.comparativo);

  // --------------------------------------- 4. a árvore empresa → filial
  console.log('\nHIERARQUIA — empresa → filial → lançamentos, um nível por vez');
  const arvoreInicial = await pag.evaluate(() => {
    const t = document.querySelector('.arvore-unidades');
    if (!t) return null;
    return {
      empresas: t.querySelectorAll('tr.nivel-1').length,
      filiais: t.querySelectorAll('tr.nivel-2').length,
      controles: t.querySelectorAll('tr.nivel-1 [aria-expanded="false"]').length,
      barras: t.querySelectorAll('tr.nivel-1 .barra-rep').length,
      comPercentual: [...t.querySelectorAll('tr.nivel-1 .barra-rep b')].every((b) => /%$/.test(b.textContent.trim())),
    };
  });
  ok('a árvore existe e começa no nível de EMPRESA',
    arvoreInicial && arvoreInicial.empresas > 0 && arvoreInicial.filiais === 0,
    arvoreInicial && `${arvoreInicial.empresas} empresa(s), ${arvoreInicial.filiais} filial(is) à mostra`);
  ok('cada empresa tem o seu controle, anunciado por aria-expanded',
    arvoreInicial && arvoreInicial.controles === arvoreInicial.empresas,
    arvoreInicial && `${arvoreInicial.controles} controle(s)`);
  ok('cada empresa traz a barra de representatividade',
    arvoreInicial && arvoreInicial.barras === arvoreInicial.empresas);
  ok('com o percentual escrito ao lado, e não só a cor', arvoreInicial && arvoreInicial.comPercentual);

  await pag.click('.arvore-unidades tr.nivel-1 .arv-abrir');
  await pag.waitForTimeout(400);
  const comFiliais = await pag.evaluate(() => {
    const t = document.querySelector('.arvore-unidades');
    return {
      filiais: t.querySelectorAll('tr.nivel-2').length,
      expandido: t.querySelector('tr.nivel-1 [aria-expanded]').getAttribute('aria-expanded'),
      mesmoFormato: [...t.querySelectorAll('tr.nivel-2')].every((tr) =>
        tr.querySelector('.barra-rep') && tr.querySelector('td.n')),
      lancamentos: t.querySelectorAll('tr.nivel-3').length,
    };
  });
  ok('expandir a empresa revela as filiais dela', comFiliais.filiais > 0, `${comFiliais.filiais} filial(is)`);
  ok('e o controle se anuncia expandido', comFiliais.expandido === 'true');
  ok('a filial usa o MESMO formato da empresa', comFiliais.mesmoFormato);
  ok('o nível 3 ainda não existe — carrega sob demanda', comFiliais.lancamentos === 0,
    String(comFiliais.lancamentos));

  const temBotaoFilial = await pag.$('.arvore-unidades tr.nivel-2 .arv-abrir');
  if (temBotaoFilial) {
    await temBotaoFilial.click();
    await pag.waitForTimeout(400);
    const nivel3 = await pag.evaluate(() => {
      const t = document.querySelector('.arvore-unidades');
      const itens = [...t.querySelectorAll('tr.nivel-3')];
      return {
        quantos: itens.length,
        mesmoFormato: itens.filter((tr) => !tr.querySelector('.vazio-no')).every((tr) =>
          tr.querySelector('.barra-rep') && tr.querySelector('td.n')),
      };
    });
    ok('expandir a filial revela os lançamentos', nivel3.quantos > 0, `${nivel3.quantos} lançamento(s)`);
    ok('e o lançamento usa o mesmo formato dos níveis de cima', nivel3.mesmoFormato);
  } else {
    ok('expandir a filial revela os lançamentos', false, 'nenhuma filial com lançamento na base');
  }

  // ------------------------------------------ 5. o tooltip flutuante
  console.log('\nTOOLTIP — flutuante, com atraso, e alcançável por teclado');
  const semDica = await pag.evaluate(() => !document.querySelector('.dica'));
  ok('nada de balão antes do hover', semDica);

  await pag.hover('.arvore-unidades tr.nivel-1 .barra-rep');
  const logoApos = await pag.evaluate(() => !document.querySelector('.dica'));
  ok('o balão NÃO aparece instantaneamente (o atraso existe)', logoApos);
  await pag.waitForTimeout(400);
  const comDica = await pag.evaluate(() => {
    const d = document.querySelector('.dica');
    if (!d) return null;
    const c = d.getBoundingClientRect();
    return {
      texto: d.textContent.replace(/\s+/g, ' ').trim(),
      papel: d.getAttribute('role'),
      dentroDaTela: c.left >= 0 && c.top >= 0 && c.right <= window.innerWidth + 1 && c.bottom <= window.innerHeight + 1,
    };
  });
  ok('depois do atraso o balão abre', !!comDica, comDica && comDica.texto.slice(0, 80));
  if (comDica) {
    ok('anunciado como tooltip', comDica.papel === 'tooltip');
    ok('e posicionado sem cortar na borda da tela', comDica.dentroDaTela);
    ok('com valor e percentual dentro', /R\$|%/.test(comDica.texto), comDica.texto.slice(0, 60));
  }

  await pag.mouse.move(5, 5);
  await pag.waitForTimeout(300);
  ok('sair do hover fecha o balão', await pag.evaluate(() => !document.querySelector('.dica')));

  // Teclado: quem navega por Tab alcança o mesmo balão pelo foco.
  await pag.evaluate(() => document.querySelector('.arvore-unidades tr.nivel-1 .barra-rep').focus());
  await pag.waitForTimeout(250);
  ok('o foco de teclado abre o balão, sem esperar atraso',
    await pag.evaluate(() => !!document.querySelector('.dica')));

  // ------------------------------- 6. a cor da despesa compartilhada
  console.log('\nCOR — a compartilhada sai em tom escurecido, em todo o financeiro');
  const legendas = await pag.evaluate(() => document.querySelectorAll('.legenda-consumo').length);
  ok('a tela de indicadores traz a legenda dos dois tons', legendas > 0, `${legendas} legenda(s)`);

  await pag.goto(BASE + '/lancamentos');
  await pag.waitForTimeout(1600);
  await abrirCartoes();
  const emLancamentos = await pag.evaluate(() => {
    const etiqueta = document.querySelector('.etiqueta.compartilhada');
    return {
      temEtiqueta: !!etiqueta,
      cor: etiqueta ? getComputedStyle(etiqueta).color : '',
      temLegenda: !!document.querySelector('.legenda-consumo'),
      texto: etiqueta ? etiqueta.textContent.trim() : '',
    };
  });
  ok('Lançamentos marca a despesa compartilhada', emLancamentos.temEtiqueta, emLancamentos.texto);
  ok('com o texto junto da cor — a cor nunca é o único canal',
    /Beneficia/i.test(emLancamentos.texto), emLancamentos.texto);
  ok('e a legenda dos dois tons está na tela', emLancamentos.temLegenda);

  await pag.goto(BASE + '/relatorio');
  await pag.waitForTimeout(1800);
  await abrirCartoes();
  const emRelatorio = await pag.evaluate(() => !!document.querySelector('.legenda-consumo'));
  ok('o Relatório também traz a legenda', emRelatorio);

  // ---------------------------- 7. a ligação cadastro → indicador
  console.log('\nLIGAÇÃO — cadastrar no plano muda o indicador do topo');
  await pag.goto(BASE + '/reducao');
  await pag.waitForTimeout(1600);
  await abrirCartoes();
  const telaPlano = await pag.evaluate(() => ({
    linhas: document.querySelectorAll('tbody tr').length,
    // É tela de CLIENTE: oferecer seletor de unidade sugeriria um recorte que
    // ela não tem.
    foco: /Unidade em foco/i.test(document.body.textContent),
  }));
  ok('a tela do plano lista o que já está cadastrado', telaPlano.linhas > 0, `${telaPlano.linhas} item(ns)`);
  ok('e não oferece seletor de unidade', !telaPlano.foco);

  await pag.fill('form input[type="text"]', 'Corte de telefonia');
  await pag.fill('form input[type="number"]', '1500');
  await pag.click('form button[type="submit"]');
  await pag.waitForTimeout(1600);
  const apos = await pag.evaluate(() =>
    [...document.querySelectorAll('tbody tr')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()));
  ok('o item novo aparece na lista sem recarregar a página',
    apos.some((l) => /Corte de telefonia/.test(l)), apos.join(' | ').slice(0, 120));

  await pag.goto(BASE + '/indicadores');
  await pag.waitForTimeout(1800);
  await abrirCartoes();
  const noIndicador = await pag.evaluate(() => {
    const bloco = [...document.querySelectorAll('.cartao')].find((c) =>
      /Plano de redução/i.test((c.querySelector('header h2') || {}).textContent || ''));
    return bloco ? bloco.textContent.replace(/\s+/g, ' ') : '';
  });
  ok('e o indicador do topo passa a contá-lo',
    /Corte de telefonia/.test(noIndicador), noIndicador.slice(0, 140));

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
