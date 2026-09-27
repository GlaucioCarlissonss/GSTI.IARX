// O PAINEL DO SPINCARE nos Indicadores Gerais (Entregável 4).
//
// Quatro indicadores sobre a base do Controle Único: distribuição, contagem
// por status, avanço por unidade agrupado por onda, e os próximos passos.
//
// A conferência que decide a entrega é a aritmética: as partes somam o todo,
// e os percentuais por unidade reproduzem os do Status Report do cliente. O
// resto — rosca, colunas, barras, drill-down — é o que torna esses números
// utilizáveis.
//
// Exige SPINCARE_XLSX apontando para a planilha do cliente, que não está no
// repositório. Sem ela, confere o estado vazio e diz o que pulou.
const { chromium } = require('playwright');
const fs = require('fs');
const { irPara } = require('./ajuda-testes.cjs');

const ARQ = process.env.SPINCARE_XLSX || '';

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1200 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });

  console.log('\nSEM BASE — o painel diz o que fazer, não finge número');
  await irPara(pag, 'Indicadores Gerais', 2500);
  const vazio = await pag.evaluate(() => {
    const micro = [...document.querySelectorAll('section.bloco-grupo')]
      .find((g) => /Visão Micro/.test(g.querySelector('h2').textContent));
    return { aviso: /não foi carregada/.test(micro.textContent),
      indicadores: micro.querySelectorAll('[data-kpi^="spin-"]').length };
  });
  // Um painel zerado faria a diretoria ler "nenhuma atividade concluída" onde
  // o que há é ausência de base.
  ok('sem base, avisa em vez de mostrar zeros', vazio.aviso);
  ok('e nenhum indicador é desenhado', vazio.indicadores === 0, String(vazio.indicadores));

  if (!ARQ || !fs.existsSync(ARQ)) {
    console.log('\n[pulado] O painel com dados exige SPINCARE_XLSX apontando para a planilha do '
      + 'cliente, que não está no repositório.');
    console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
    console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
    await nav.close();
    process.exit(falhas.length || erros.length ? 1 : 0);
  }

  await irPara(pag, 'Projeto SpinCare', 1500);
  await pag.setInputFiles('#spin-arq', ARQ);
  await pag.click('#spin-carregar');
  await pag.waitForSelector('#spin-resultado .msg.ok', { timeout: 30000 });
  await pag.waitForTimeout(2000);
  await irPara(pag, 'Indicadores Gerais', 3000);

  console.log('\nOS QUATRO INDICADORES');
  const tela = await pag.evaluate(() => {
    const micro = [...document.querySelectorAll('section.bloco-grupo')]
      .find((g) => /Visão Micro/.test(g.querySelector('h2').textContent));
    return {
      kpis: [...micro.querySelectorAll('[data-kpi^="spin-"]')].map((k) => k.dataset.kpi),
      rosca: micro.querySelectorAll('#spin-rosca svg path[fill]').length,
      centro: (micro.querySelector('.rosca-total') || {}).textContent,
      colunas: micro.querySelectorAll('#spin-colunas svg g').length,
      barras: micro.querySelectorAll('[data-unidade]').length,
      ondas: [...micro.querySelectorAll('.faixa-onda > b')].map((b) => b.textContent.trim()),
      passos: micro.querySelectorAll('[data-passo]').length,
      legenda: [...micro.querySelectorAll('[data-fatia]')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
    };
  });
  ok('os quatro estão na tela',
    JSON.stringify(tela.kpis) === JSON.stringify(['spin-distribuicao', 'spin-status',
      'spin-unidades', 'spin-passos']), tela.kpis.join(', '));
  // Fatia de valor zero não é desenhada: um arco de largura nula vira um
  // risco na borda e sugere uma fatia mínima onde não há nenhuma.
  ok('a rosca desenha só as fatias com valor', tela.rosca === 3, `${tela.rosca} arco(s)`);
  ok('com o total das válidas no centro', tela.centro === '165', tela.centro);
  ok('a legenda nomeia as cinco situações', tela.legenda.length === 5,
    tela.legenda.map((t) => t.slice(0, 18)).join(' | '));
  ok('as colunas por status existem', tela.colunas >= 5, `${tela.colunas} coluna(s)`);
  ok('seis barras por unidade', tela.barras === 6, String(tela.barras));
  ok('agrupadas em duas ondas, com fase e mês',
    tela.ondas.length === 2 && /1ª ONDA — ABERTURA/.test(tela.ondas[0])
    && /2ª ONDA — VALIDAÇÃO/.test(tela.ondas[1]), tela.ondas.join(' | '));
  ok('os próximos passos vêm da base', tela.passos >= 4, `${tela.passos} passo(s)`);

  console.log('\nA ARITMÉTICA');
  const n = await pag.evaluate(() => {
    const p = calcularSpincare({});
    const validas = p.porStatus.filter((s) => !s.foraDoCalculo);
    return {
      validas: p.validas.length, total: p.todas.length,
      soma: validas.reduce((s, x) => s + x.valor, 0),
      somaPct: Math.round(validas.reduce((s, x) => s + x.pct, 0) * 10) / 10,
      concluidas: validas.find((s) => s.status === 'Concluído').valor,
      unidades: Object.fromEntries(p.unidades.map((u) => [u.rotulo,
        { pond: u.pctPonderado, concl: u.pctConclusao }])),
    };
  });
  ok('165 válidas de 172', n.validas === 165 && n.total === 172, `${n.validas} de ${n.total}`);
  // O erro do Status Report do cliente: as partes somam 172 e o denominador é
  // 165, e os percentuais fecham em 104,24%.
  ok('as partes somam as válidas', n.soma === n.validas, `${n.soma} = ${n.validas}`);
  ok('e os percentuais somam 100%', Math.abs(n.somaPct - 100) < 0.2, `${n.somaPct}%`);
  ok('127 concluídas', n.concluidas === 127, String(n.concluidas));
  // A conclusão por unidade é o número do Status Report, e tem de bater.
  ok('a conclusão da 1ª onda é 81,2%, como no Status Report',
    ['HR PB', 'HM PB', 'HR CG'].every((u) => n.unidades[u].concl === 81.2),
    JSON.stringify(['HR PB', 'HM PB', 'HR CG'].map((u) => n.unidades[u].concl)));
  ok('e a da 2ª é 77,0%',
    ['UC RJ', 'UC SP', 'HM RO'].every((u) => n.unidades[u].concl === 77),
    JSON.stringify(['UC RJ', 'UC SP', 'HM RO'].map((u) => n.unidades[u].concl)));
  // O ponderado é OUTRA medida, e é maior porque credita avanço parcial.
  ok('o avanço ponderado é distinto da conclusão, e maior',
    n.unidades['HR PB'].pond > n.unidades['HR PB'].concl,
    `${n.unidades['HR PB'].pond}% ponderado vs ${n.unidades['HR PB'].concl}% concluído`);

  console.log('\nDRILL-DOWN');
  const drill = await pag.evaluate(async () => {
    document.querySelector('#spin-rosca svg path[fill]').dispatchEvent(
      new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const m = document.querySelectorAll('#modais .modal');
    const linhas = m.length ? m[0].querySelectorAll('tbody tr').length : 0;
    // A ordem é por avanço ponderado decrescente: ordenar por ID devolveria a
    // ordem da planilha, que não responde pergunta nenhuma.
    const pond = m.length ? [...m[0].querySelectorAll('tbody tr')].map((tr) => {
      const tds = tr.querySelectorAll('td');
      return Number(String(tds[tds.length - 2].textContent).replace(',', '.'));
    }) : [];
    return { modais: m.length, titulo: m.length ? m[0].querySelector('h2').textContent.trim() : '',
      linhas, ordenado: pond.every((v, i) => i === 0 || pond[i - 1] >= v) };
  });
  ok('clicar na fatia abre os registros', drill.modais === 1 && drill.linhas > 0,
    `${drill.modais} tela, ${drill.linhas} linha(s)`);
  ok('com o nome da situação no título', /Concluídas/.test(drill.titulo), drill.titulo);
  ok('e ordenados do maior avanço ponderado para o menor', drill.ordenado);
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(400);

  const drillUnidade = await pag.evaluate(async () => {
    document.querySelector('[data-unidade="hr_pb"]').click();
    await new Promise((r) => setTimeout(r, 700));
    const m = document.querySelectorAll('#modais .modal');
    return { modais: m.length, titulo: m.length ? m[0].querySelector('h2').textContent.trim() : '' };
  });
  // UMA tela: o botão mora dentro do cartão, que também é gatilho de
  // drill-down, e sem barrar a subida abririam duas empilhadas.
  ok('clicar na unidade abre UMA tela', drillUnidade.modais === 1, String(drillUnidade.modais));
  ok('com a unidade no título', /HR PB/.test(drillUnidade.titulo), drillUnidade.titulo);
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(400);

  console.log('\nOS FILTROS DO CONTROLE ÚNICO');
  const filtrado = await pag.evaluate(async () => {
    const r = recorteDoBloco('projetos');
    const antes = calcularSpincare({}).validas.length;
    r.ondas = new Set(['1']);
    const soOnda1 = calcularSpincare({ ondas: r.ondas }).validas.length;
    r.ondas = new Set();
    const frente = spinAtividades()[0].frente;
    const porFrente = calcularSpincare({ frentes: new Set([frente]) });
    return { antes, soOnda1, frente,
      naFrente: porFrente.validas.length,
      todasDaFrente: porFrente.validas.every((a) => a.frente === frente) };
  });
  ok('filtrar por onda recorta o universo', filtrado.soOnda1 > 0 && filtrado.soOnda1 <= filtrado.antes,
    `${filtrado.antes} → ${filtrado.soOnda1}`);
  ok('filtrar por frente deixa só ela',
    filtrado.naFrente > 0 && filtrado.todasDaFrente,
    `${filtrado.naFrente} de ${filtrado.antes} em "${filtrado.frente}"`);

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
