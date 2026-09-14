// Isolamento multi-tenant e cadastros.
// A regra "nada atravessa a empresa" é a mais cara de violar: o pior caso é
// um número de uma empresa aparecer no painel de outra. Aqui ela é exercitada
// justamente no estado mais arriscado — com TODAS as empresas carregadas na
// memória ao mesmo tempo, que é o que a aba Conferência provoca.
const { chromium } = require('playwright');
const { usarEmpresas, usarBase, usarCompetencias, irPara } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1280, height: 1000 } });
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

  // totais de referência, cada empresa carregada sozinha
  console.log('ISOLAMENTO — totais com uma empresa por vez');
  const sozinhas = {};
  for (const id of ['alianca', 'milagres', 'moove', 'residencial', 'union']) {
    await usarEmpresas(pag, id);
    await pag.waitForTimeout(600);
    sozinhas[id] = await pag.evaluate(() => Loja.todos(empresaAtiva())
      .filter((l) => l.cenario === 'oficial').reduce((s, l) => s + Math.round(l.valor * 100), 0));
    console.log(`    ${id.padEnd(12)} ${String(sozinhas[id]).padStart(10)}`);
  }

  // agora força TODAS na memória e repete
  await ir('Conferência');
  const bt = await pag.$('#c-carregar');
  if (bt) { await bt.click(); await pag.waitForTimeout(4000); }
  const carregadas = await pag.evaluate(() => E.mesesCarregados.size);
  console.log(`\n  empresas na memória: ${carregadas}`);
  confere('todas carregadas', carregadas, 5);

  console.log('\n  totais com todas carregadas');
  for (const id of Object.keys(sozinhas)) {
    await usarEmpresas(pag, id);
    await pag.waitForTimeout(500);
    const agora = await pag.evaluate(() => Loja.todos(empresaAtiva())
      .filter((l) => l.cenario === 'oficial').reduce((s, l) => s + Math.round(l.valor * 100), 0));
    confere(`${id} não mudou`, agora, sozinhas[id]);
  }

  // catálogos também são por empresa
  console.log('\n  catálogos por empresa');
  const cat = await pag.evaluate(() => {
    const por = {};
    for (const e of E.empresas) por[e.id] = {
      filiais: filiaisDa(e.id).map((f) => f.nome).sort(),
      tipos: tiposDa(e.id).length,
    };
    return por;
  });
  const todasFiliais = Object.values(cat).flatMap((c) => c.filiais);
  confere('nenhuma filial repetida entre empresas', new Set(todasFiliais).size, todasFiliais.length);
  for (const [id, c] of Object.entries(cat)) console.log(`    ${id.padEnd(12)} ${c.tipos} tipos, filiais: ${c.filiais.join(', ') || '(nenhuma)'}`);

  // escrita numa empresa não toca a outra
  console.log('\n  escrita isolada');
  await usarEmpresas(pag, 'moove');
  await pag.waitForTimeout(500);
  const antesUnion = sozinhas.union;
  await pag.evaluate(async () => {
    const itens = [...Loja.itens('moove', '2026-06')];
    itens.push({ id:'iso1', grupo:'giso1', filial:null, tipo:'Licenças de Softwares', valor:999,
      natureza:'fixa', classificacao:'despesa', cenario:'oficial', origem:'manual',
      descricao:'só da MOOVE', obs:null, parcela:null, qtdParcelas:null });
    await Loja.gravarMes('moove', '2026-06', itens);
  });
  await usarEmpresas(pag, 'union');
  await pag.waitForTimeout(600);
  const depoisUnion = await pag.evaluate(() => Loja.todos(empresaAtiva())
    .filter((l) => l.cenario === 'oficial').reduce((s, l) => s + Math.round(l.valor * 100), 0));
  confere('UNION intacta após escrita na MOOVE', depoisUnion, antesUnion);
  confere('lançamento da MOOVE não aparece na UNION',
    await pag.evaluate(() => Loja.todos(empresaAtiva()).some((l) => l.descricao === 'só da MOOVE')), false);
  await usarEmpresas(pag, 'moove');
  await pag.waitForTimeout(500);
  confere('lançamento aparece na MOOVE',
    await pag.evaluate(() => Loja.todos(empresaAtiva()).some((l) => l.descricao === 'só da MOOVE')), true);

  // ------------------------------------------------------------- Cadastros
  //
  // Cadastro é escrita numa unidade, e a unidade se escolhe NA TELA: o filtro
  // de leitura de outra aba não decide onde a filial nova vai nascer.
  console.log('\nCADASTROS');
  await ir('Cadastros');
  await pag.selectOption('#f-foco', 'moove').catch(() => {});
  await pag.waitForTimeout(500);
  const criar = async (tipo, campos) => {
    await pag.click(`#pagina [data-novo="${tipo}"]`);
    await pag.waitForSelector('.modal', { timeout: 6000 });
    for (const [n, v] of Object.entries(campos)) {
      const sel = `.modal [name="${n}"]`;
      if (await pag.$(sel)) { await pag.fill(sel, ''); await pag.fill(sel, v); }
    }
    await pag.click('.modal .acoes .bt.pri');
    await pag.waitForTimeout(700);
    const e = await pag.$eval('.modal [data-erro]', (x) => x.hidden ? '' : x.textContent).catch(() => '');
    if (e) { console.log('    erro: ' + e); await pag.keyboard.press('Escape'); }
    return !e;
  };

  await criar('filial', { nome: 'Filial Teste', cidade: 'Natal', uf: 'RN' });
  await criar('tipo', { nome: 'Tipo Teste' });
  await criar('fila', { nome: 'Fila Teste' });
  await criar('cenario', { chave: 'cenario_teste', nome: 'Cenário Teste' });

  const novo = await pag.evaluate(() => ({
    filial: filiaisDa('moove').some((f) => f.nome === 'Filial Teste'),
    tipo: tiposDa('moove').some((t) => t.nome === 'Tipo Teste'),
    fila: filasDa('moove').some((f) => f.nome === 'Fila Teste'),
    cenario: cenariosDa('moove').some((c) => c.chave === 'cenario_teste' || c.nome === 'Cenário Teste'),
    vazouParaUnion: filiaisDa('union').some((f) => f.nome === 'Filial Teste')
      || tiposDa('union').some((t) => t.nome === 'Tipo Teste'),
  }));
  confere('filial criada', novo.filial, true);
  confere('tipo criado', novo.tipo, true);
  confere('fila criada', novo.fila, true);
  confere('cenário criado', novo.cenario, true);
  confere('cadastro não vazou para outra empresa', novo.vazouParaUnion, false);

  console.log('\n=== falhas: ' + (falhas.length ? falhas.join('; ') : 'nenhuma') + ' ===');
  console.log('=== erros de console: ' + (erros.length ? '\n' + erros.join('\n') : 'nenhum') + ' ===');
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
