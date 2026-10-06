// O cadastro de metas e o Meta vs Resultado que ele alimenta.
//
// Três promessas que esta entrega faz:
//   1. uma base SEM meta cadastrada continua exatamente como era — o 80 do SLA
//      não era configurável, e virar cadastro não podia mudar número nenhum;
//   2. a meta cadastrada substitui esse padrão em toda leitura, incluindo o
//      termômetro e a coluna de conformidade por filial;
//   3. desativar devolve o indicador ao padrão, sem apagar o cadastro.
const { chromium } = require('playwright');
const { irPara } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1000 } });
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
  // Base limpa de metas: é o estado de toda instalação existente hoje.
  await pag.evaluate(async () => { await Loja.gravarCatalogo('metas', []); });

  // ------------------------------------------------- sem meta, nada muda
  console.log('\nSEM CADASTRO — o alvo de base continua valendo');
  await irPara(pag, 'Indicadores Gerais', 1200);
  const padrao = await pag.evaluate(() => ({
    alvo: alvoDe('sla'),
    nota: [...document.querySelectorAll('.bloco header .nota')].map((n) => n.textContent.trim()).join(' | '),
    barras: document.querySelectorAll('.meta-kpi').length,
  }));
  conferir('o alvo de SLA sem cadastro é o 80 de sempre', padrao.alvo === 80, String(padrao.alvo));
  conferir('o cabeçalho do bloco de SLA anuncia a meta vigente', /meta de 80%/.test(padrao.nota), padrao.nota);
  conferir('o card mostra a barra de Meta vs Resultado', padrao.barras > 0, `${padrao.barras} barra(s)`);

  // ------------------------------------------------------ cadastrar a meta
  console.log('\nCADASTRO — a tela existe e grava');
  await irPara(pag, 'Metas', 900);
  const telaVazia = await pag.evaluate(() => ({
    titulo: (document.querySelector('#pagina .bloco h2') || {}).textContent || '',
    vazio: !!document.querySelector('#pagina .vazio'),
    botao: !!document.querySelector('[data-nova-meta]'),
    // A tela é do cliente: não pode oferecer seletor de unidade em foco.
    foco: !!document.querySelector('[data-sel="foco"]'),
  }));
  conferir('a aba Metas abre a própria tela', /Metas/.test(telaVazia.titulo), telaVazia.titulo.trim());
  conferir('sem meta, a tela diz que não há', telaVazia.vazio);
  conferir('a tela oferece cadastrar', telaVazia.botao);
  conferir('a tela é do cliente, sem seletor de unidade', !telaVazia.foco);

  await pag.click('[data-nova-meta]');
  await pag.waitForTimeout(400);
  await pag.fill('#m-nome', 'SLA exigente');
  await pag.selectOption('#m-mod', 'sla');
  await pag.fill('#m-alvo', '95');
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(700);

  const gravada = await pag.evaluate(() => ({
    linhas: document.querySelectorAll('#pagina tbody tr').length,
    texto: (document.querySelector('#pagina tbody tr') || {}).textContent || '',
    alvo: alvoDe('sla'),
  }));
  conferir('a meta aparece na lista', gravada.linhas === 1, gravada.texto.replace(/\s+/g, ' ').trim());
  conferir('e passa a ser o alvo vigente', gravada.alvo === 95, String(gravada.alvo));

  // ------------------------------------------------ a meta rege o indicador
  console.log('\nLEITURA — a meta cadastrada atravessa a tela toda');
  await irPara(pag, 'Indicadores Gerais', 1200);
  const comMeta = await pag.evaluate(() => {
    const cards = [...document.querySelectorAll('.kpi')];
    const sla = cards.find((c) => /dentro do SLA/i.test(c.textContent));
    return {
      nota: [...document.querySelectorAll('.bloco header .nota')].map((n) => n.textContent.trim()).join(' | '),
      apoio: (sla.querySelector('.a') || {}).textContent || '',
      barra: (sla.querySelector('.meta-kpi .meta-texto') || {}).textContent || '',
      classe: (sla.querySelector('.meta-kpi') || {}).className || '',
    };
  });
  conferir('o cabeçalho passa a anunciar 95%', /meta de 95%/.test(comMeta.nota), comMeta.nota);
  conferir('o apoio do card cita a meta nova', /95%/.test(comMeta.apoio), comMeta.apoio.replace(/\s+/g, ' ').trim());
  conferir('a barra compara contra 95', /95/.test(comMeta.barra), comMeta.barra.replace(/\s+/g, ' ').trim());
  conferir('e diz se atingiu ou não', /dentro|fora/.test(comMeta.classe), comMeta.classe);

  // ------------------------------------------------------------ desativar
  console.log('\nDESATIVAR — o indicador volta ao padrão, sem perder o cadastro');
  await irPara(pag, 'Metas', 900);
  await pag.click('[data-alternar="0"]');
  await pag.waitForTimeout(700);
  const desativada = await pag.evaluate(() => ({
    alvo: alvoDe('sla'),
    guardadas: (E.metas || []).length,
    // A 6ª coluna desde que a listagem ganhou "Tipo": Meta | Módulo | Tipo |
    // Alvo | Vigência | Situação.
    situacao: (document.querySelector('#pagina tbody tr td:nth-child(6)') || {}).textContent || '',
  }));
  conferir('o alvo volta a 80', desativada.alvo === 80, String(desativada.alvo));
  conferir('a meta continua cadastrada, só inativa', desativada.guardadas === 1 && /Inativa/.test(desativada.situacao),
    desativada.situacao.trim());

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
