// OBJETIVO 02 — Adequação dos custos compartilhados.
//
// A promessa em uma frase: classificar um contrato como compartilhado acende o
// indicador, e cadastrar o marco de adequação move valor de "ainda
// compartilhado" para "já regularizado" no mês certo — nem antes, nem depois.
//
// A segunda promessa, mais silenciosa: a base real NASCE sem nenhuma despesa
// compartilhada, e o indicador tem de dizer isso e oferecer a saída, em vez de
// mostrar um zero que se lê como "não há problema".
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

  // A tela flutuante é sempre a ÚLTIMA aberta: `[data-todos]` e `[data-c]`
  // existem em mais de um lugar da página, e um seletor solto pegaria o botão
  // "Todos" de um filtro de coluna.
  const ultima = () => pag.locator('.fundo').last();
  const preencher = (sel, v) => ultima().locator(sel).fill(v);
  const clicar = (sel) => ultima().locator(sel).click();

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  await irPara(pag, 'Indicadores Gerais', 1800);

  // ------------------------------------------------- o estado de partida
  console.log('\nPARTIDA — sem nada classificado, o indicador diz isso e oferece a saída');
  const partida = await pag.evaluate(() => {
    const kpi = document.querySelector('[data-kpi="rateio"]');
    const sec = kpi && kpi.closest('section.bloco-indicador');
    return kpi ? {
      posicao: [...document.querySelectorAll('[data-kpi]')].indexOf(kpi),
      titulo: sec.querySelector('h2').textContent.replace(/^\s*[−+]\s*/, '').trim(),
      descricao: (sec.querySelector('.descricao-indicador') || {}).textContent.trim(),
      numero: kpi.querySelector('.n').textContent.trim(),
      apoio: kpi.querySelector('.a').textContent.trim(),
      temSaida: !!sec.querySelector('[data-classificar]'),
      compartilhadas: Loja.todosDoEscopo().filter((l) => consumoDe(l) === 'compartilhado').length,
    } : null;
  });
  ok('o indicador existe', !!partida);
  ok('e está na ORDEM 2 da pilha', partida && partida.posicao === 1, partida && String(partida.posicao));
  ok('com o título do enunciado',
    partida && partida.titulo === 'Objetivo 02: Adequação dos Custos Compartilhados', partida && partida.titulo);
  ok('e a descrição recuada abaixo dele',
    partida && /Normalização dos Custos com Despesas FIXAS\(MENSAIS\)/.test(partida.descricao));
  ok('a base real não tem despesa compartilhada nenhuma',
    partida && partida.compartilhadas === 0, partida && String(partida.compartilhadas));
  // Um zero solto se leria como "não há problema". O indicador tem de dizer que
  // FALTA CLASSIFICAR, que é outra coisa.
  ok('e o vazio diz que falta classificar, em vez de mostrar zero',
    partida && partida.numero === '—' && /classificada como compartilhada/.test(partida.apoio),
    partida && partida.apoio);
  ok('com o caminho para resolver na própria tela', partida && partida.temSaida);

  // ------------------------------------------------- classificar em lote
  console.log('\nLOTE — classificar um contrato acende o indicador');
  await pag.locator('[data-classificar]').first().click();
  await pag.waitForSelector('.fundo #cc-busca', { timeout: 10000 });
  const lote = await pag.evaluate(() => ({
    contratos: document.querySelectorAll('input[data-cc]').length,
    lancamentos: Loja.todosDoEscopo().filter((l) => l.natureza === 'fixa').length,
    temBusca: !!document.querySelector('#cc-busca'),
  }));
  // Uma linha por CONTRATO, não por lançamento: o mesmo contrato se repete mês
  // a mês, e escolher doze vezes a mesma coisa é como se erra em alguma delas.
  ok('a lista é por contrato, e não por lançamento',
    lote.contratos > 0 && lote.contratos < lote.lancamentos,
    `${lote.contratos} contrato(s) para ${lote.lancamentos} lançamento(s) fixos`);
  ok('e tem busca, porque a lista é longa', lote.temBusca);

  await preencher('#cc-busca', 'brisanet');
  await pag.waitForTimeout(300);
  const filtrados = await pag.evaluate(() =>
    [...document.querySelectorAll('[data-cc-linha]')].filter((t) => !t.hidden).length);
  ok('a busca recorta a lista', filtrados > 0 && filtrados < lote.contratos,
    `${filtrados} de ${lote.contratos}`);
  await clicar('[data-todos]');
  const marcados = await pag.evaluate(() =>
    document.querySelectorAll('input[data-cc]:checked').length);
  // "Marcar todos" sobre a lista inteira seria um clique capaz de reclassificar
  // a base sem ninguém ver o que entrou.
  ok('e "marcar os visíveis" não alcança o que a busca escondeu',
    marcados === filtrados, `${marcados} marcado(s) para ${filtrados} visível(eis)`);

  await preencher('#cc-just', 'classificação do contrato compartilhado');
  await clicar('[data-aplicar]');
  await pag.waitForTimeout(2500);

  const aceso = await pag.evaluate(() => {
    const a = calcularAdequacao(recorteDoBloco('financeiro'));
    const kpi = document.querySelector('[data-kpi="rateio"]');
    const sec = kpi.closest('section.bloco-indicador');
    return {
      numero: kpi.querySelector('.n').textContent.trim(),
      apoio: kpi.querySelector('.a').textContent.trim(),
      cards: sec.querySelectorAll('.card-plano').length,
      barras: sec.querySelectorAll('#i-adequacao svg path').length,
      niveis: [1, 2].map((n) => sec.querySelectorAll(`.arvore-unidades tr.nivel-${n}`).length),
      lancamentos: a.lancamentos, pendentes: a.pendentesNoMes,
      compartilhado: a.compartilhado, regularizado: a.regularizado,
      pctReg: a.pctRegularizado, pctFixo: a.pctDoCustoFixo,
      ref: a.referencia, meses: a.serie.length,
      // A árvore mostra SÓ o que é compartilhado: é o critério do enunciado.
      soCompartilhadas: a.pendentes.every((l) => consumoDe(l) === 'compartilhado' && l.natureza === 'fixa'),
    };
  });
  ok('o indicador acende', aceso.lancamentos > 0 && aceso.numero !== '—', aceso.numero);
  ok('com os dois percentuais no apoio',
    /já regularizado/.test(aceso.apoio) && /do custo fixo mensal/.test(aceso.apoio), aceso.apoio);
  ok('os três cards da conta', aceso.cards === 3, String(aceso.cards));
  ok('a linha do tempo é desenhada', aceso.barras > 0 && aceso.meses > 1,
    `${aceso.barras} segmento(s) em ${aceso.meses} mês(es)`);
  ok('a árvore agrupa por empresa e filial',
    aceso.niveis[0] > 0 && aceso.niveis[1] > 0, aceso.niveis.join(' / '));
  ok('e só entra despesa fixa compartilhada', aceso.soCompartilhadas);
  ok('nada regularizado ainda, porque não houve marco',
    aceso.regularizado === 0 && aceso.pctReg === 0 && aceso.pctFixo === 0,
    `${aceso.regularizado} · ${aceso.pctReg}%`);
  ok('e o que está pendente é tudo o que foi classificado',
    aceso.compartilhado > 0 && aceso.pendentes > 0);

  // ------------------------------------------------- o marco da adequação
  console.log('\nMARCO — regularizar move valor de um estado para o outro, no mês certo');
  const meio = await pag.evaluate(() => {
    const a = calcularAdequacao(recorteDoBloco('financeiro'));
    return a.serie[Math.floor(a.serie.length / 2)].comp;
  });
  await pag.locator('[data-classificar]').first().click();
  await pag.waitForSelector('.fundo #cc-busca', { timeout: 10000 });
  await preencher('#cc-busca', 'brisanet');
  await pag.waitForTimeout(300);
  // O que já é compartilhado abre MARCADO: a tela mostra o estado de hoje, e
  // quem volta para cadastrar o marco não deveria ter de reencontrar o que já
  // classificou. Por isso não se clica em "marcar os visíveis" aqui — ele
  // alterna, e desmarcaria tudo.
  const prontos = await pag.evaluate(() =>
    [...document.querySelectorAll('[data-cc-linha]')].filter((t) => !t.hidden)
      .every((t) => t.querySelector('input[data-cc]').checked));
  ok('o que já é compartilhado reabre marcado', prontos);
  await preencher('#cc-reg', meio.slice(5) + '/' + meio.slice(0, 4));
  await preencher('#cc-just', 'adequação do contrato');
  await clicar('[data-aplicar]');
  await pag.waitForTimeout(2500);

  const comMarco = await pag.evaluate((marco) => {
    const a = calcularAdequacao(recorteDoBloco('financeiro'));
    const antes = a.serie.filter((p) => p.comp < marco);
    const depois = a.serie.filter((p) => p.comp >= marco);
    return {
      // Antes do marco, nada regularizado; do marco em diante, nada pendente.
      antesSoPendente: antes.length > 0 && antes.every((p) => p.regularizado === 0 && p.compartilhado > 0),
      depoisSoRegular: depois.length > 0 && depois.every((p) => p.compartilhado === 0 && p.regularizado > 0),
      // A altura da barra não muda: são dois estados da MESMA despesa.
      totalConstante: a.serie.every((p) => Math.abs(p.total - (p.compartilhado + p.regularizado)) < 0.01),
      pctReg: a.pctRegularizado, pctFixo: a.pctDoCustoFixo,
      compartilhado: a.compartilhado, regularizado: a.regularizado, total: a.total,
      custoFixo: a.custoFixoMes, ref: a.referencia,
      apoio: document.querySelector('[data-kpi="rateio"] .a').textContent.trim(),
    };
  }, meio);
  ok('antes do marco, tudo continua pendente', comMarco.antesSoPendente);
  ok('do marco em diante, tudo conta como regularizado', comMarco.depoisSoRegular);
  ok('e o total do mês não muda — são dois estados da mesma despesa',
    comMarco.totalConstante);
  // Os dois percentuais do enunciado, com DENOMINADORES diferentes: um sobre o
  // compartilhado, outro sobre o custo fixo. Trocá-los seria o erro fácil.
  ok('o % regularizado é sobre o compartilhado do mês',
    Math.abs(comMarco.pctReg - (comMarco.regularizado / comMarco.total) * 100) <= 0.06,
    `${comMarco.pctReg}% de ${comMarco.regularizado}/${comMarco.total}`);
  ok('e o % do custo fixo é sobre o custo fixo do mês',
    Math.abs(comMarco.pctFixo - (comMarco.regularizado / comMarco.custoFixo) * 100) <= 0.06,
    `${comMarco.pctFixo}% de ${comMarco.regularizado}/${comMarco.custoFixo}`);
  ok('os dois são diferentes, porque as bases são diferentes',
    comMarco.pctReg !== comMarco.pctFixo, `${comMarco.pctReg}% vs ${comMarco.pctFixo}%`);

  // ------------------------------------------------- desfazer
  console.log('\nDESFAZER — voltar para 100% da filial limpa o compartilhamento');
  await pag.locator('[data-classificar]').first().click();
  await pag.waitForSelector('.fundo #cc-busca', { timeout: 10000 });
  await preencher('#cc-busca', 'brisanet');
  await pag.waitForTimeout(300);
  await ultima().locator('#cc-todas').selectOption('integral');
  await preencher('#cc-just', 'reclassificação');
  await clicar('[data-aplicar]');
  await pag.waitForTimeout(2500);

  const desfeito = await pag.evaluate(() => {
    const a = calcularAdequacao(recorteDoBloco('financeiro'));
    const soltos = Loja.todosDoEscopo().filter((l) =>
      consumoDe(l) === 'integral' && (beneficiadasDe(l).length || l.regularizadaEm));
    return { lancamentos: a.lancamentos, soltos: soltos.length,
      numero: document.querySelector('[data-kpi="rateio"] .n').textContent.trim() };
  });
  ok('o indicador volta ao vazio', desfeito.lancamentos === 0 && desfeito.numero === '—');
  // Deixar a lista de beneficiadas para trás faria a próxima leitura encontrar
  // benefício sem despesa compartilhada que o justifique.
  ok('e não sobra beneficiada nem marco em despesa integral',
    desfeito.soltos === 0, `${desfeito.soltos} sobra(s)`);

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
