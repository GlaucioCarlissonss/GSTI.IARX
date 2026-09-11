// Filtros de múltipla escolha: marcar mais de uma opção tem de refletir nos
// números, e a escolha tem de aparecer na tela sem reabrir o seletor.
const { chromium } = require('playwright');
const { irPara } = require('./ajuda-testes.cjs');

const centavos = (t) => { const m = /-?[\d.]+,\d{2}/.exec(String(t||'')); 
  return m ? Math.round(Number(m[0].replace(/\./g,'').replace(',','.')) * 100) : null; };

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1400, height: 1100 } });
  const falhas = [], erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push('console: ' + m.text()); });
  const confere = (nome, obtido, esperado) => {
    const ok = String(obtido) === String(esperado);
    console.log(`  ${ok ? '✓' : '✗'} ${nome}: ${obtido}${ok ? '' : ' (esperado ' + esperado + ')'}`);
    if (!ok) falhas.push(nome);
  };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#abas button', { timeout: 15000 });
  const ir = (r) => irPara(pag, r, 450);

  // abre um seletor pelo id do gatilho e marca/desmarca valores
  const marcar = async (id, valores, ligar = true) => {
    await pag.click(`#${id}`);
    await pag.waitForTimeout(250);
    for (const v of valores) {
      const cx = `.multi:has(#${id}) .lista input[value="${v}"]`;
      const jaMarcado = await pag.isChecked(cx);
      if (jaMarcado !== ligar) await pag.click(cx);
      await pag.waitForTimeout(220);
    }
    await pag.keyboard.press('Escape');
    await pag.waitForTimeout(450);
  };
  const rotulo = (id) => pag.$eval(`#${id}`, (b) => b.textContent.trim().replace(/\s+/g, ' '));
  const kpi = (i = 0) => pag.$$eval('.kpi .n', (ns) => ns.map((n) => n.textContent))
    .then((ns) => centavos(ns[i]));

  // ---------------------------------------------------------- competências
  console.log('COMPETÊNCIA — somar vários meses');
  const so08 = await kpi();
  confere('mês único (08/2026)', so08, 1806389);
  await marcar('p-comp', ['2026-07']);
  confere('rótulo do seletor', /^2 selecionados de \d+$/.test(await rotulo('p-comp')), true);
  const doisMeses = await kpi();
  console.log('    07+08/2026 =', doisMeses);
  confere('soma dos dois meses > mês único', doisMeses > so08, true);
  const fichas = await pag.$$eval('#p-fichas .ficha', (fs) => fs.map((f) => f.textContent.trim().replace(/\s+/g,' ')));
  console.log('    fichas:', fichas.join(' | '));
  confere('fichas mostram os dois meses', fichas.filter((f) => /2026/.test(f)).length, 2);

  // a ficha remove a seleção
  await pag.click('#p-fichas .ficha:has-text("07/2026") button');
  await pag.waitForTimeout(600);
  confere('remover ficha volta ao mês único', await kpi(), so08);

  // mínimo: não dá para ficar sem competência
  await marcar('p-comp', ['2026-08'], false);
  confere('mínimo impede esvaziar', await rotulo('p-comp'), '08/2026');

  // ------------------------------------------------------------------ base
  console.log('\nBASE — só o que veio das planilhas');
  await marcar('f-base', ['planilha']);
  confere('rótulo da base', await rotulo('f-base'), 'Planilhas do cliente');
  confere('total só com planilha', await kpi(), 1602884);
  const somaRanking = await pag.$$eval('#r3 .it', (its) => its.reduce((s, i) => {
    const m = /-?[\d.]+,\d{2}/.exec(i.textContent);
    return s + (m ? Math.round(Number(m[0].replace(/\./g,'').replace(',','.')) * 100) : 0); }, 0));
  confere('ranking por filial acompanha o recorte', somaRanking, 1602884);
  await marcar('f-base', ['planilha'], false);
  confere('base volta a "Todos"', await rotulo('f-base'), 'Todos');

  // --------------------------------------------------------------- empresa
  console.log('\nEMPRESA — consolidar mais de uma');
  await marcar('f-empresa', ['union']);
  await pag.waitForTimeout(900);
  confere('rótulo da empresa', await rotulo('f-empresa'), '2 selecionados de 5');
  const consolidado = await kpi();
  console.log('    ALIANÇA + UNION em 08/2026 =', consolidado);
  confere('consolidado maior que uma só', consolidado > so08, true);
  confere('ranking por empresa aparece', await pag.$$eval('#r4 .it', (i) => i.length), 2);

  // escrita exige empresa única
  await ir('Lançamentos');
  confere('botão de lançar desabilitado', await pag.$eval('#l-novo', (b) => b.disabled), true);
  await ir('Cadastros');
  confere('cadastros explicam a restrição',
    /uma empresa por vez/.test(await pag.$eval('#pagina', (e) => e.textContent)), true);
  await ir('Dados');
  confere('dados explicam a restrição',
    /uma empresa por vez/.test(await pag.$eval('#pagina', (e) => e.textContent)), true);
  await pag.evaluate(async () => {
    for (const e of ['alianca', 'union']) {
      await E.db.doc('auditoria/' + e).set({ itens: [{ acao:'criar', entidade:'lancamento',
        quando: new Date().toISOString(), justificativa:'semente do teste' }] });
    }
  });
  await ir('Auditoria');
  const cabAud = await pag.$$eval('#pagina thead th', (ts) => ts.map((t) => t.textContent));
  console.log('    colunas da auditoria:', cabAud.join(' | '));
  confere('auditoria ganha coluna de empresa', cabAud.includes('Empresa'), true);
  confere('auditoria junta as duas trilhas', await pag.$$eval('#pagina tbody tr', (r) => r.length), 2);

  await marcar('f-empresa', ['union'], false);
  await pag.waitForTimeout(900);
  await ir('Painel');
  confere('volta a uma empresa', await kpi(), so08);

  // --------------------------------------------------------------- cenário
  console.log('\nCENÁRIO — alternativas comparam, não somam');
  await marcar('p-comp', ['2027-06']);
  await marcar('p-comp', ['2026-08'], false);
  await marcar('p-cen', ['spincare_desconto_12']);
  confere('dois cenários marcados', await rotulo('p-cen'), 'Todos (2)');
  const texto = (await pag.$eval('#pagina', (e) => e.textContent)).replace(/\s+/g, ' ');
  confere('avisa que compara em vez de somar', /compara, em vez de somar/.test(texto), true);
  confere('rankings saem de cena com dois cenários', await pag.$$eval('#r1 .it', (i) => i.length).catch(() => 0), 0);
  const kpisCen = await pag.$$eval('.kpi', (ks) => ks.map((k) =>
    k.querySelector('.r').textContent + ' = ' + k.querySelector('.n').textContent));
  console.log('    ' + kpisCen.join('\n    '));
  confere('um indicador por cenário', kpisCen.length, 2);

  // ao ficar só no cenário de desconto, a competência tem de continuar válida
  await marcar('p-cen', ['oficial'], false);
  await pag.waitForTimeout(500);
  const rotCen = await rotulo('p-cen'), rotComp = await rotulo('p-comp');
  const cabecalho = await pag.$eval('.filtros div[style*="margin-left:auto"]', (e) => e.textContent.replace(/\s+/g,' ').trim());
  console.log('    cenário:', rotCen, '| competência:', rotComp, '|', cabecalho);
  confere('competência do cabeçalho bate com o seletor', cabecalho.includes(rotComp), true);
  confere('painel não fica zerado no cenário de desconto', await kpi() > 0, true);

  console.log('\n=== falhas: ' + (falhas.length ? falhas.join('; ') : 'nenhuma') + ' ===');
  console.log('=== erros: ' + (erros.length ? '\n' + erros.join('\n') : 'nenhum') + ' ===');
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
