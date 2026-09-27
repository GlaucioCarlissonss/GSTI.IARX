// REVISÃO FINAL DE CONSISTÊNCIA DO MÓDULO SLA (Entrega 6).
//
// As entregas anteriores provaram cada peça por dentro. O que falta provar é
// que elas concordam entre si: o motor de horas úteis, a conformidade, os três
// dashboards, o termômetro e o detalhamento têm de dizer o MESMO número.
//
// Uma divergência aqui é do tipo pior: cada tela isolada parece certa, e a
// desconfiança só aparece na reunião, quando dois números que deviam bater
// não batem — e aí não há como saber qual dos dois está errado.
const { chromium } = require('playwright');
const { irPara } = require('./ajuda-testes.cjs');

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
  await irPara(pag, 'Indicadores Gerais', 4000);

  console.log('\nO MOTOR E A CONFORMIDADE DIZEM O MESMO');
  const motor = await pag.evaluate(() => {
    const d = conformidadeSegmentada(recorteDoBloco('sla'), 'geral');
    const feriados = feriadosDoCliente();
    // Recalcular cada chamado do zero, pelo motor, e conferir contra o que a
    // conformidade guardou: se as duas passagens divergirem, o percentual da
    // tela não é reproduzível.
    let divergentes = 0;
    let consumoErrado = 0;
    for (const c of d.chamados) {
      const m = medidaDoChamado(c, feriados);
      if (m.dentro !== c.m.dentro || m.resolvido !== c.m.resolvido) divergentes += 1;
      if (c.criadoEm && c.fechadoEm) {
        const h = horasUteis(c.criadoEm, c.fechadoEm, feriados);
        if (Math.abs((h || 0) - (c.m.consumo || 0)) > 0.002) consumoErrado += 1;
      }
    }
    return { n: d.chamados.length, divergentes, consumoErrado, pct: d.resumo.pct };
  });
  ok('medir de novo dá o mesmo veredito em todo chamado',
    motor.divergentes === 0, `${motor.divergentes} de ${motor.n}`);
  ok('e o mesmo consumo em horas úteis', motor.consumoErrado === 0, String(motor.consumoErrado));
  // Consumo negativo se espalharia como "dentro do prazo" por toda a
  // conformidade — é o erro que mais se esconde.
  ok('nenhum consumo é negativo', await pag.evaluate(() =>
    conformidadeSegmentada(recorteDoBloco('sla'), 'geral').chamados
      .every((c) => c.m.consumo === null || c.m.consumo >= 0)));

  console.log('\nO CARTÃO, OS DASHBOARDS E O DETALHAMENTO CONCORDAM');
  const telas = await pag.evaluate(async () => {
    const r = recorteDoBloco('sla');
    const d = conformidadeSegmentada(r, 'geral');
    const cartao = document.querySelector('[data-kpi="sla-painel"]');
    const texto = cartao.closest('.bloco-indicador').textContent.replace(/\s+/g, ' ');
    // A soma das células mensais do gráfico tem de ser o resumo do período.
    const somaGrafico = d.pontos.reduce((s, p) => {
      const c = Object.values(p.celulas);
      return { dentro: s.dentro + c.reduce((x, y) => x + y.dentro, 0),
        resolvidos: s.resolvidos + c.reduce((x, y) => x + y.resolvidos, 0) };
    }, { dentro: 0, resolvidos: 0 });
    // E o detalhamento de um mês tem de trazer exatamente os chamados dele.
    const mes = d.pontos[d.pontos.length - 1];
    const noMes = d.chamados.filter((c) => c.competencia === mes.comp).length;
    const noDrill = Object.values(mes.celulas).reduce((s, c) => s + c.itens.length, 0);
    return { texto, resumo: d.resumo, somaGrafico, mes: mes.comp, noMes, noDrill };
  });
  ok('o cartão mostra o percentual do resumo',
    telas.texto.includes(String(telas.resumo.pct).replace('.', ',')),
    `${telas.resumo.pct}%`);
  ok('a soma dos meses do gráfico é o resumo do período',
    telas.somaGrafico.dentro === telas.resumo.dentro
    && telas.somaGrafico.resolvidos === telas.resumo.resolvidos,
    `${telas.somaGrafico.dentro}/${telas.somaGrafico.resolvidos} vs ${telas.resumo.dentro}/${telas.resumo.resolvidos}`);
  ok('o detalhamento de um mês traz todos os chamados dele',
    telas.noDrill === telas.noMes, `${telas.noDrill} de ${telas.noMes} em ${telas.mes}`);

  console.log('\nO TERMÔMETRO E O CARTÃO ANTIGO');
  const term = await pag.evaluate(() => {
    const sla = calcularSla(recorteDoBloco('sla'));
    const t = document.querySelector('#i-termometro');
    return { desenhado: !!t && t.querySelectorAll('svg').length === 1,
      pct: sla.pct, meta: sla.meta,
      // O termômetro mede "atendidos dentro do SLA" sobre TODOS os atendidos —
      // outra pergunta que a conformidade, que mede só os resolvidos. Os dois
      // convivem, e é por isso que a nota do bloco diz qual é qual.
      texto: (t ? t.textContent : '').replace(/\s+/g, ' ') };
  });
  ok('o termômetro é desenhado uma vez só', term.desenhado);
  ok('com a meta cadastrada', term.meta > 0, `${term.meta}%`);

  console.log('\nO SEMÁFORO É O MESMO EM TODO PONTO');
  const semaforo = await pag.evaluate(() => {
    const casos = [100, 90, 89.9, 80, 70, 69.9, 0, null];
    return casos.map((p) => [p, faixaDaConformidade(p).curto]);
  });
  const esperado = [[100, 'excelente'], [90, 'excelente'], [89.9, 'atenção'], [80, 'atenção'],
    [70, 'atenção'], [69.9, 'crítico'], [0, 'crítico'], [null, 'sem base']];
  ok('as faixas do contrato, com a borda na faixa de cima',
    JSON.stringify(semaforo) === JSON.stringify(esperado),
    semaforo.map(([p, f]) => `${p}:${f}`).join(' '));

  console.log('\nACESSIBILIDADE');
  const a11y = await pag.evaluate(() => {
    const sels = [...document.querySelectorAll('[data-seg], [data-seg-chave]')];
    const svgs = [...document.querySelectorAll('#sla-g-conf svg, #sla-g-vol svg, #sla-g-status svg')];
    return {
      seletores: sels.length,
      // Um `select` sem nome acessível é lido como "combo box" e nada mais.
      comNome: sels.every((s) => s.getAttribute('aria-label')
        || (s.closest('label') && s.closest('label').textContent.trim())),
      focavel: sels.every((s) => !s.disabled),
      svgRotulados: svgs.length > 0 && svgs.every((s) => s.getAttribute('role') === 'img'
        && s.getAttribute('aria-label')),
      // O bloco inteiro abre e fecha por teclado, como todo bloco do sistema.
      dobra: !!document.querySelector('[data-kpi="sla-painel"]')
        .closest('.bloco-indicador').querySelector('header'),
    };
  });
  ok('todo seletor tem nome acessível', a11y.comNome, `${a11y.seletores} seletor(es)`);
  ok('e é alcançável pelo teclado', a11y.focavel);
  ok('os três gráficos têm role e rótulo', a11y.svgRotulados);

  const teclado = await pag.evaluate(async () => {
    const sel = document.querySelector('[data-seg="volume"]');
    sel.focus();
    const focado = document.activeElement === sel;
    sel.value = 'fila';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    return { focado, modais: document.querySelectorAll('#modais .modal').length,
      series: document.querySelectorAll('#sla-g-vol svg path[stroke]').length };
  });
  ok('o seletor recebe foco e opera sem abrir tela flutuante',
    teclado.focado && teclado.modais === 0, `${teclado.modais} tela(s)`);
  ok('e a troca por teclado redesenha o gráfico', teclado.series >= 3, String(teclado.series));

  console.log('\nRESPONSIVIDADE');
  await pag.setViewportSize({ width: 390, height: 900 });
  await pag.waitForTimeout(900);
  const estreito = await pag.evaluate(() => {
    const painel = document.querySelector('[data-kpi="sla-painel"] .painel-spin');
    const quadros = [...painel.querySelectorAll('.quadro')];
    return {
      // Num celular os quadros empilham: dois lado a lado em 390px espremeriam
      // o gráfico até o eixo virar um borrão.
      empilhados: quadros.every((q) => q.getBoundingClientRect().width > 250),
      semRolagemLateral: document.documentElement.scrollWidth <= window.innerWidth + 1,
      largura: document.documentElement.scrollWidth,
      janela: window.innerWidth,
    };
  });
  ok('os quadros empilham no celular', estreito.empilhados);
  ok('e a página não ganha rolagem lateral', estreito.semRolagemLateral,
    `${estreito.largura}px em ${estreito.janela}px`);
  await pag.setViewportSize({ width: 1500, height: 1200 });

  console.log('\nDESEMPENHO: o detalhamento é montado só ao clicar');
  const lazy = await pag.evaluate(async () => {
    const antes = document.querySelectorAll('#modais .modal').length;
    const t0 = performance.now();
    conformidadeSegmentada(recorteDoBloco('sla'), 'fila');
    const custo = performance.now() - t0;
    return { antes, custo: Math.round(custo),
      // Nenhuma linha de chamado existe no DOM antes do clique: são 10 mil.
      linhasNoDom: document.querySelectorAll('#pagina tbody tr[data-reclassificar]').length };
  });
  ok('nenhuma tela flutuante nasce aberta', lazy.antes === 0);
  ok('nenhuma linha de chamado é montada antes do clique', lazy.linhasNoDom === 0);
  ok('e uma passada de segmentação custa pouco', lazy.custo < 1500, `${lazy.custo} ms`);

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
