// O histórico de prioridade de um chamado.
//
// A prioridade mudava sem deixar rastro. O que esta suíte protege:
//   1. a extração NÃO traz prioridade — o chamado começa sem uma, e dizer que
//      começa "Baixa" seria inventar um dado que ninguém informou;
//   2. reclassificar exige quem pediu, com cargo e nome;
//   3. o histórico fica na própria linha do chamado, e sobrevive a recarregar.
const { chromium } = require('playwright');
const { irPara } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1600, height: 1000 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push('console: ' + m.text()); });
  const conferir = (rotulo, ok, detalhe = '') => {
    console.log(`  ${ok ? '✓' : '✗'} ${rotulo}${detalhe ? ': ' + detalhe : ''}`);
    if (!ok) falhas.push(rotulo + (detalhe ? ' — ' + detalhe : ''));
  };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  await irPara(pag, 'Chamados', 1400);

  // --------------------------------------------------- o estado de partida
  console.log('\nPARTIDA — a extração não traz prioridade, e não se inventa uma');
  const inicial = await pag.evaluate(() => {
    const linha = document.querySelector('#s-chamados tbody tr');
    const celula = linha.children[11];
    return {
      cabecalho: [...document.querySelectorAll('#s-chamados thead th')].map((t) => t.textContent.trim()),
      texto: celula.textContent.replace(/\s+/g, ' ').trim(),
      botao: !!celula.querySelector('[data-reclassificar]'),
    };
  });
  conferir('a tabela tem coluna de prioridade', inicial.cabecalho.includes('Prioridade'),
    inicial.cabecalho.join(', '));
  conferir('o chamado começa sem prioridade definida', inicial.texto.startsWith('—'), inicial.texto);
  conferir('e oferece reclassificar na própria linha', inicial.botao);

  // ----------------------------------------------------- exige quem pediu
  console.log('\nQUEM PEDIU — cargo e nome são obrigatórios');
  await pag.click('#s-chamados tbody tr [data-reclassificar]');
  await pag.waitForTimeout(500);
  const semHistorico = await pag.evaluate(() =>
    !!document.querySelector('.modal .vazio'));
  conferir('o chamado novo abre com o histórico vazio', semHistorico);

  await pag.selectOption('#r-pri', 'high');
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(500);
  const recusa = await pag.evaluate(() => (document.querySelector('.modal .msg.erro, .modal [data-erro]') || {}).textContent || '');
  conferir('sem quem pediu, a reclassificação é recusada', /cargo e nome/i.test(recusa), recusa.trim());

  // --------------------------------------------------------- reclassificar
  console.log('\nRECLASSIFICAR — a mudança fica registrada com quem pediu');
  await pag.fill('#r-quem', 'Coordenador de Enfermagem — Maria Souza');
  await pag.fill('#r-mot', 'Paciente aguardando laudo.');
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(900);

  const depois = await pag.evaluate(() => {
    const celula = document.querySelector('#s-chamados tbody tr').children[11];
    return { texto: celula.textContent.replace(/\s+/g, ' ').trim() };
  });
  conferir('a linha passa a mostrar a prioridade', /Alta/.test(depois.texto), depois.texto);
  conferir('e marca que houve alteração', /↻/.test(depois.texto), depois.texto);

  await pag.click('#s-chamados tbody tr [data-reclassificar]');
  await pag.waitForTimeout(500);
  const ficha = await pag.evaluate(() => ({
    atual: (document.querySelector('.modal .msg') || {}).textContent || '',
    historico: (document.querySelector('.modal .ficha') || {}).textContent || '',
  }));
  conferir('o modal diz a prioridade vigente', /Alta/.test(ficha.atual), ficha.atual.replace(/\s+/g, ' ').trim());
  conferir('o histórico registra de onde partiu',
    /sem prioridade\s*→\s*Alta/.test(ficha.historico.replace(/\s+/g, ' ')),
    ficha.historico.replace(/\s+/g, ' ').trim().slice(0, 140));
  conferir('e quem pediu, com cargo e nome',
    /Coordenador de Enfermagem — Maria Souza/.test(ficha.historico));
  conferir('e o motivo', /Paciente aguardando laudo/.test(ficha.historico));

  // ------------------------------------------------ a mesma prioridade não
  await pag.selectOption('#r-pri', 'high');
  await pag.fill('#r-quem', 'Alguém');
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(500);
  const repetida = await pag.evaluate(() => (document.querySelector('.modal .msg.erro, .modal [data-erro]') || {}).textContent || '');
  conferir('reclassificar para a mesma prioridade é recusado', /já está na prioridade/i.test(repetida),
    repetida.trim());

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
