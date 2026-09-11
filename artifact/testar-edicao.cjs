// Exercita os fluxos de edição que o gestor precisa: criar, parcelar, editar,
// reclassificar, excluir, fechar competência — e confere que cada um deixa
// rastro na auditoria e move os totais como esperado.
const { chromium } = require('playwright');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1280, height: 900 } });
  const erros = [];
  const falhas = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push('console: ' + m.text()); });

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#abas button', { timeout: 15000 });
  const ir = async (r) => { await pag.click(`#abas button:text-is("${r}")`); await pag.waitForTimeout(450); };
  const conta = () => pag.evaluate(() => Loja.todos(E.empresa).length);
  const soma = () => pag.evaluate(() => Loja.todos(E.empresa).reduce((s, l) => s + Math.round(l.valor * 100), 0));
  const auditoria = () => pag.evaluate(async () => (await E.db.doc('auditoria/' + E.empresa).get()).data()?.itens?.length ?? 0);
  const confere = (nome, obtido, esperado) => {
    const ok = obtido === esperado;
    console.log(`  ${ok ? '✓' : '✗'} ${nome}: ${obtido}${ok ? '' : ' (esperado ' + esperado + ')'}`);
    if (!ok) falhas.push(nome);
  };

  await pag.selectOption('#f-empresa', 'moove');
  await pag.waitForTimeout(600);
  const n0 = await conta(), s0 = await soma(), a0 = await auditoria();
  let deltaEdicao = 0;   // acumula o que a edição do passo 4b mexeu na soma
  console.log(`MOOVE: ${n0} lançamentos, R$ ${(s0/100).toFixed(2)}, ${a0} eventos na trilha\n`);

  const preencher = async (campos) => {
    for (const [nome, valor] of Object.entries(campos)) {
      const sel = `.modal [name="${nome}"]`;
      const tag = await pag.$eval(sel, (e) => e.tagName).catch(() => null);
      if (!tag) continue;
      if (tag === 'SELECT') await pag.selectOption(sel, valor);
      else { await pag.fill(sel, ''); await pag.fill(sel, valor); }
      await pag.waitForTimeout(80);
    }
  };
  const salvar = async () => {
    await pag.click('.modal .acoes .bt.pri');
    await pag.waitForTimeout(700);
    const erro = await pag.$eval('.modal [data-erro]', (e) => e.hidden ? '' : e.textContent).catch(() => '');
    if (erro) { console.log('    erro do formulário: ' + erro); falhas.push('formulário: ' + erro); await pag.keyboard.press('Escape'); }
  };

  // 1. lançamento pontual único
  console.log('1. criar lançamento pontual único');
  await ir('Lançamentos');
  await pag.click('button:text-matches("Novo|Lançar|Adicionar", "i")');
  await pag.waitForSelector('.modal', { timeout: 5000 });
  await preencher({ competencia: '03/2027', valor: '1.500,00', natureza: 'pontual_unica',
    classificacao: 'despesa', descricao: 'Teste — pontual única', just: 'verificação' });
  await salvar();
  confere('lançamentos', await conta(), n0 + 1);
  confere('soma (centavos)', await soma(), s0 + 150000);

  // 2. parcelamento em 4x sobre o total
  console.log('\n2. criar parcelamento 4x de R$ 4.000,00 (valor total)');
  await pag.click('button:text-matches("Novo|Lançar|Adicionar", "i")');
  await pag.waitForSelector('.modal', { timeout: 5000 });
  await preencher({ competencia: '05/2027', valor: '4.000,00', natureza: 'pontual_parcelada' });
  await preencher({ qtd: '4', ref: 'total', classificacao: 'investimento',
    descricao: 'Teste — parcelado', just: 'verificação' });
  await salvar();
  confere('lançamentos (4 parcelas)', await conta(), n0 + 5);
  confere('soma (centavos)', await soma(), s0 + 150000 + 400000);
  const parcelas = await pag.evaluate(() => Loja.todos(E.empresa)
    .filter((l) => l.descricao === 'Teste — parcelado')
    .sort((a, b) => a.competencia.localeCompare(b.competencia))
    .map((l) => `${l.competencia} ${l.valor} p${l.parcela}/${l.qtdParcelas}`));
  console.log('    ' + parcelas.join(' | '));
  const mesmoGrupo = await pag.evaluate(() => new Set(Loja.todos(E.empresa)
    .filter((l) => l.descricao === 'Teste — parcelado').map((l) => l.grupo)).size);
  confere('série num único grupo', mesmoGrupo, 1);

  // 3. origem dos lançamentos criados aqui
  const origens = await pag.evaluate(() => [...new Set(Loja.todos(E.empresa)
    .filter((l) => String(l.descricao || '').startsWith('Teste —')).map((l) => l.origem))]);
  console.log('\n3. origem dos criados na tela');
  confere('origem', origens.join(','), 'manual');

  // 4. reclassificar a série
  console.log('\n4. reclassificar a série (investimento → despesa)');
  await ir('Lançamentos');
  const idSerie = await pag.evaluate(() => Loja.todos(E.empresa)
    .find((l) => l.descricao === 'Teste — parcelado' && l.parcela === 1)?.id);
  const btRc = await pag.$(`tbody tr[data-id="${idSerie}"] [data-rc]`);
  if (btRc) {
    await btRc.click();
    await pag.waitForSelector('.modal', { timeout: 8000 });
    await pag.fill('.modal [name="just"]', 'verificação');
    await pag.click('.modal [data-sim]');
    await pag.waitForTimeout(900);
    const despesas = await pag.evaluate(() => Loja.todos(E.empresa)
      .filter((l) => l.descricao === 'Teste — parcelado' && l.classificacao === 'despesa').length);
    confere('parcelas reclassificadas', despesas, 4);
  } else { console.log('    linha da série não encontrada'); falhas.push('linha da série'); }

  // 4b. editar um lançamento existente
  console.log('\n4b. editar um lançamento das planilhas');
  await ir('Lançamentos');
  const alvo = await pag.evaluate(() => {
    const l = Loja.todos(E.empresa).find((x) => x.origem === 'planilha' && x.competencia < mesHoje());
    return l ? { id: l.id, comp: l.competencia, valor: l.valor, origem: l.origem, tipo: l.tipo } : null;
  });
  if (!alvo) { console.log('    nenhum lançamento de planilha para editar'); falhas.push('alvo de edição'); }
  else {
    const novoValor = Math.round(alvo.valor * 100) + 12345;   // sempre diferente do original
    const novoTexto = (novoValor / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    console.log(`    alvo: ${alvo.id} ${alvo.comp} R$ ${alvo.valor} (${alvo.origem}) → ${novoTexto}`);
    const somaAntes = await soma();
    const btEd = await pag.$(`tbody tr[data-id="${alvo.id}"] [data-ed]`);
    if (!btEd) { console.log('    linha não visível na tabela'); falhas.push('linha do alvo'); }
    else {
      // sem justificativa, competência passada tem de ser recusada
      await btEd.click();
      await pag.waitForSelector('.modal', { timeout: 8000 });
      await pag.fill('.modal [name="valor"]', '');
      await pag.fill('.modal [name="valor"]', novoTexto);
      await pag.fill('.modal [name="just"]', '');
      await pag.click('.modal .acoes .bt.pri');
      await pag.waitForTimeout(600);
      const recusa = await pag.$eval('.modal [data-erro]', (e) => e.hidden ? '' : e.textContent.trim()).catch(() => '');
      console.log('    sem justificativa →', recusa || '(aceitou!)');
      confere('exige justificativa em competência passada', /justificativa/i.test(recusa), true);

      // com justificativa, grava
      await pag.fill('.modal [name="just"]', 'correção conferida com o fornecedor');
      await pag.click('.modal .acoes .bt.pri');
      await pag.waitForTimeout(900);
      const depois = await pag.evaluate((id) => {
        const l = Loja.todos(E.empresa).find((x) => x.id === id);
        return l ? { valor: l.valor, origem: l.origem, comp: l.competencia } : null;
      }, alvo.id);
      console.log('    depois:', JSON.stringify(depois));
      confere('valor editado', depois && Math.round(depois.valor * 100), novoValor);
      confere('competência preservada', depois && depois.comp, alvo.comp);
      // editar corrige o número, não reescreve de onde ele veio
      confere('origem preservada', depois && depois.origem, 'planilha');
      deltaEdicao = novoValor - Math.round(alvo.valor * 100);
      confere('soma acompanha a edição', await soma(), somaAntes + deltaEdicao);
    }
  }

  // 5. excluir o pontual único
  console.log('\n5. excluir o lançamento pontual único');
  const idUnico = await pag.evaluate(() => Loja.todos(E.empresa)
    .find((l) => l.descricao === 'Teste — pontual única')?.id);
  const btEx = await pag.$(`tbody tr[data-id="${idUnico}"] [data-ex]`);
  if (btEx) {
    await btEx.click();
    await pag.waitForSelector('.modal', { timeout: 8000 });
    await pag.fill('.modal [name="just"]', 'verificação');
    await pag.click('.modal [data-sim]');
    await pag.waitForTimeout(900);
    confere('lançamentos após exclusão', await conta(), n0 + 4);
    confere('soma (centavos)', await soma(), s0 + 400000 + deltaEdicao);
  } else { console.log('    linha do pontual não encontrada'); falhas.push('linha do pontual'); }

  // 6. fechamento de competência: tem de bloquear de verdade
  console.log('\n6. fechar competência e tentar escrever nela');
  await ir('Cadastros');

  // futura é recusada, e a recusa precisa aparecer na tela (alert some no sandbox)
  await pag.fill('#fc-comp', '05/2027');
  await pag.click('#fc-fechar');
  await pag.waitForTimeout(500);
  const recusa = await pag.$eval('#fc-erro', (e) => e.hidden ? '' : e.textContent.trim());
  console.log('    fechar 05/2027 (futura) →', recusa || '(nenhuma mensagem)');
  if (!recusa) falhas.push('recusa de competência futura invisível');

  // passada é aceita e passa a bloquear escrita e importação
  await pag.fill('#fc-comp', '05/2026');
  await pag.click('#fc-fechar');
  await pag.waitForTimeout(900);
  const fechadas = await pag.evaluate(() => (E.fechamentos.get(E.empresa) || []).map((f) => f.comp || f));
  confere('competências fechadas', fechadas.join(','), '2026-05');

  const bloqueio = await pag.evaluate(() => {
    try { checarCompetencia('2026-05', 'com justificativa'); return 'PASSOU'; }
    catch (e) { return /fechada/.test(e.message) ? 'bloqueou' : 'erro diferente: ' + e.message; }
  });
  confere('escrita em competência fechada', bloqueio, 'bloqueou');
  confere('importação enxerga o fechamento',
    await pag.evaluate(() => competenciaFechada(E.empresa, '2026-05')), true);
  confere('competência aberta continua livre',
    await pag.evaluate(() => competenciaFechada(E.empresa, '2026-06')), false);

  // reabrir devolve a competência
  const btReabrir = await pag.$('tr[data-fc="2026-05"] [data-reabrir]');
  if (btReabrir) {
    await btReabrir.click();
    await pag.waitForSelector('.modal', { timeout: 8000 });
    await pag.fill('.modal [name="just"]', 'verificação');
    await pag.click('.modal [data-sim]');
    await pag.waitForTimeout(900);
    confere('após reabrir, escrita liberada',
      await pag.evaluate(() => competenciaFechada(E.empresa, '2026-05')), false);
  } else { console.log('    botão Reabrir não encontrado'); falhas.push('botão Reabrir'); }

  // 7. trilha de auditoria
  console.log('\n7. trilha de auditoria');
  const aFim = await auditoria();
  console.log(`    eventos: ${a0} → ${aFim}`);
  if (aFim <= a0) falhas.push('auditoria não registrou');
  await ir('Auditoria');
  const acoes = await pag.$$eval('#pagina tbody tr', (rs) => rs.slice(0, 6).map((r) =>
    [...r.cells].slice(1, 4).map((c) => c.textContent.trim().slice(0, 28)).join(' | ')));
  acoes.forEach((a) => console.log('    ' + a));

  console.log('\n=== falhas: ' + (falhas.length ? falhas.join('; ') : 'nenhuma') + ' ===');
  console.log('=== erros de console: ' + (erros.length ? '\n' + erros.join('\n') : 'nenhum') + ' ===');
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
