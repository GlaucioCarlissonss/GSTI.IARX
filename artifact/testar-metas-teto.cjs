// ENTREGA 7 — tipo de meta no Financeiro e o teto de gasto do Objetivo 03.
//
// A conferência que decide a entrega é a do ISOLAMENTO: um teto cadastrado não
// pode ser lido como alvo percentual pelos Objetivos 01 e 02. O teto guarda
// `alvoPct: 0` junto, e lido pela porta errada ele reprovaria todo mês com um
// "0%" que ninguém cadastrou.
const { chromium } = require('playwright');
const { irPara } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };
  const ult = () => pag.locator('.fundo').last();

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  await pag.evaluate(() => Loja.gravarCatalogo('metas', []));
  await pag.waitForTimeout(300);
  await irPara(pag, 'Metas', 1200);

  console.log('\nFORMULÁRIO — o tipo aparece só no Financeiro');
  await pag.click('[data-nova-meta]');
  await pag.waitForSelector('.fundo #m-tipo', { timeout: 10000 });
  const form = await pag.evaluate(() => ({
    tipo: !document.querySelector('#m-tipo-campo').hidden,
    teto: !document.querySelector('#m-teto-campos').hidden,
    alvo: !document.querySelector('#m-alvo-campo').hidden,
    opcoes: [...document.querySelectorAll('#m-tipo option')].map((o) => o.value),
  }));
  ok('o tipo de meta aparece no Financeiro', form.tipo);
  ok('com as três opções do enunciado',
    JSON.stringify(form.opcoes) === JSON.stringify(['objetivo-01', 'objetivo-02', 'objetivo-03']),
    form.opcoes.join(' · '));
  ok('e o campo de teto começa escondido', !form.teto);
  ok('com o alvo percentual à vista', form.alvo);

  await ult().locator('#m-mod').selectOption('sla');
  await pag.waitForTimeout(250);
  // Nos outros módulos há um indicador só: oferecer a escolha seria pedir uma
  // decisão sem efeito.
  ok('fora do Financeiro o tipo some',
    await pag.evaluate(() => document.querySelector('#m-tipo-campo').hidden));
  await ult().locator('#m-mod').selectOption('financeiro');
  await ult().locator('#m-tipo').selectOption('objetivo-03');
  await pag.waitForTimeout(250);
  const obj3 = await pag.evaluate(() => ({
    teto: !document.querySelector('#m-teto-campos').hidden,
    alvo: !document.querySelector('#m-alvo-campo').hidden,
    contextos: [...document.querySelectorAll('#m-ctx option')].map((o) => o.value),
  }));
  ok('no Objetivo 03 o teto aparece', obj3.teto);
  // Pedir um percentual para um teto em reais é pedir um número que não será
  // usado.
  ok('e o alvo percentual some', !obj3.alvo);
  ok('com um contexto por natureza de gasto',
    JSON.stringify(obj3.contextos) === JSON.stringify(['fixas', 'variaveis', 'investimentos']),
    obj3.contextos.join(' · '));

  console.log('\nVALIDAÇÃO — sem valor não salva, e a recusa diz o que falta');
  await ult().locator('#m-nome').fill('Teto fixas');
  await ult().locator('[data-s]').click();
  await pag.waitForTimeout(600);
  const semValor = await pag.evaluate(() => ({
    erro: (document.querySelector('.modal [data-erro]') || {}).textContent,
    metas: (E.metas || []).length,
  }));
  ok('sem valor, não grava', semValor.metas === 0, `${semValor.metas} meta(s)`);
  ok('e a mensagem nomeia o campo e o formato',
    /Valor da meta/.test(semValor.erro) && /1\.234,56/.test(semValor.erro), semValor.erro);

  await ult().locator('#m-valor').fill('0');
  await ult().locator('[data-s]').click();
  await pag.waitForTimeout(600);
  // Zero não é um teto: seria um limite de gasto nenhum, reprovando todo mês.
  ok('zero também é recusado', await pag.evaluate(() => (E.metas || []).length) === 0);

  await ult().locator('#m-valor').fill('120.000,00');
  await ult().locator('[data-s]').click();
  await pag.waitForTimeout(1200);
  const salvo = await pag.evaluate(() => {
    const m = (E.metas || [])[0] || {};
    return { n: (E.metas || []).length, tipo: m.tipoMeta, ctx: m.contextoTeto, valor: m.valorTeto };
  });
  ok('com valor, grava', salvo.n === 1 && salvo.tipo === 'objetivo-03',
    `${salvo.tipo} · ${salvo.ctx} · ${salvo.valor}`);
  ok('e o valor entra em reais, não em centavos', salvo.valor === 120000, String(salvo.valor));

  console.log('\nLISTAGEM — tipo e valor à vista');
  const lista = await pag.evaluate(() => ({
    colunas: [...document.querySelectorAll('#pagina thead th')].map((t) => t.textContent.trim()),
    celulas: [...document.querySelectorAll('#pagina tbody tr td')].slice(0, 4)
      .map((t) => t.textContent.trim().replace(/\s+/g, ' ')),
  }));
  ok('a listagem tem coluna de tipo', lista.colunas.includes('Tipo'), lista.colunas.join(' | '));
  ok('que mostra o objetivo e o contexto',
    /Objetivo 03/.test(lista.celulas[2]) && /fixas/i.test(lista.celulas[2]), lista.celulas[2]);
  ok('e o alvo do teto é o valor em R$, não um percentual',
    /^R\$/.test(lista.celulas[3]), lista.celulas[3]);

  console.log('\nISOLAMENTO — o teto não vira alvo percentual dos outros objetivos');
  const iso = await pag.evaluate(() => {
    // Uma meta de Objetivo 01 convivendo com o teto: é ela que os indicadores
    // percentuais têm de encontrar.
    Loja.gravarCatalogo('metas', [
      ...(E.metas || []),
      { cliente: E.clienteSel, nome: 'Teto de custo fixo', modulo: 'financeiro',
        tipoMeta: 'objetivo-01', alvoPct: 5, vigenciaInicio: null, vigenciaFim: null, ativo: true },
    ]);
    return null;
  });
  void iso;
  await pag.waitForTimeout(500);
  const leitura = await pag.evaluate(() => ({
    vigente: (metaVigente('financeiro', '2026-08') || {}).nome,
    alvo: alvoDe('financeiro', '2026-08'),
    tetos: tetosVigentes('2026-08'),
  }));
  ok('a meta percentual vigente é a do Objetivo 01',
    leitura.vigente === 'Teto de custo fixo', String(leitura.vigente));
  ok('e o alvo percentual é o dela, não o zero do teto',
    leitura.alvo === 5, String(leitura.alvo));
  ok('o teto é lido por porta própria, em reais',
    leitura.tetos.fixas === 120000, String(leitura.tetos.fixas));
  // `null` é "sem meta", e não zero: zero seria um teto de gasto nenhum.
  ok('contexto sem meta é null, não zero',
    leitura.tetos.variaveis === null && leitura.tetos.investimentos === null);
  ok('e o teto geral é a soma dos vigentes',
    leitura.tetos.geral === 120000, String(leitura.tetos.geral));
  ok('com os contextos sem meta nomeados',
    JSON.stringify(leitura.tetos.contextosSemMeta) === JSON.stringify(['variaveis', 'investimentos']),
    leitura.tetos.contextosSemMeta.join(' · '));

  console.log('\nSOBREPOSIÇÃO — dois tetos vigentes no mesmo contexto são recusados');
  await pag.click('[data-nova-meta]');
  await pag.waitForSelector('.fundo #m-tipo', { timeout: 10000 });
  await ult().locator('#m-tipo').selectOption('objetivo-03');
  await pag.waitForTimeout(250);
  await ult().locator('#m-nome').fill('Outro teto de fixas');
  await ult().locator('#m-valor').fill('90.000,00');
  await ult().locator('[data-s]').click();
  await pag.waitForTimeout(700);
  const choque = await pag.evaluate(() => ({
    erro: (document.querySelector('.modal [data-erro]') || {}).textContent,
    metas: (E.metas || []).filter((m) => m.tipoMeta === 'objetivo-03').length,
  }));
  // Dois tetos vigentes no mesmo contexto dariam duas respostas para "qual é o
  // limite deste mês".
  ok('o segundo teto do mesmo contexto é recusado', choque.metas === 1, `${choque.metas} teto(s)`);
  ok('e a recusa nomeia o teto que já existe',
    /Teto fixas/.test(choque.erro), choque.erro.slice(0, 120));

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
