// O plano de redução de despesas: cadastro e indicador do topo.
//
// A promessa é a LIGAÇÃO: cadastrar uma despesa no plano tem de mudar o
// indicador. Uma tela de cadastro bonita com um indicador que não a lê seria
// o defeito mais caro possível — o gestor cadastraria o alvo da reunião e a
// tela continuaria mostrando o de antes.
//
// E a segunda promessa, mais silenciosa: sem cadastro, o indicador diz que
// está vazio e por quê, em vez de mostrar um alvo inventado.
const { chromium } = require('playwright');
const { irPara, abrirBlocos } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });

  // Base limpa: a suíte cadastra o que precisa, e um resto de execução
  // anterior faria o "vazio" nunca acontecer.
  await pag.evaluate(() => Loja.gravarCatalogo('reducao', []));
  await pag.waitForTimeout(300);

  // ------------------------------------------------- o estado de partida
  console.log('\nPARTIDA — sem plano cadastrado, o indicador diz isso');
  await irPara(pag, 'Indicadores Gerais', 1500);
  const partida = await pag.evaluate(() => {
    const kpi = document.querySelector('[data-kpi="plano-reducao"]');
    return kpi ? {
      numero: (kpi.querySelector('.n') || {}).textContent.trim(),
      apoio: (kpi.querySelector('.a') || {}).textContent.trim(),
      drill: kpi.classList.contains('drill'),
      posicao: [...document.querySelectorAll('[data-kpi]')].indexOf(kpi),
    } : null;
  });
  ok('o indicador do plano existe', !!partida);
  ok('e vem no TOPO da tela', partida && partida.posicao === 0, partida && String(partida.posicao));
  ok('sem cadastro, mostra travessão em vez de zero', partida && partida.numero === '—', partida && partida.numero);
  ok('e diz onde cadastrar', partida && /Sistema.*Cadastro.*Plano de redução/i.test(partida.apoio),
    partida && partida.apoio);
  ok('um indicador sem número não vira botão', partida && partida.drill === false);

  // ------------------------------------------------------- o cadastro
  console.log('\nCADASTRO — a tela grava, e recusa o que não faz sentido');
  await irPara(pag, 'Plano de redução', 900);
  const tela = await pag.evaluate(() => ({
    titulo: ((document.querySelector('#pagina .bloco header h2') || {}).textContent || '').replace(/^\s*[−+]\s*/, ''),
    vazio: !!document.querySelector('#pagina .vazio'),
    // É tela de CLIENTE: oferecer seletor de unidade sugeriria um recorte que
    // ela não tem. `metas` segue a mesma regra.
    foco: !!document.querySelector('[data-sel="foco"]'),
  }));
  ok('a tela do plano abre', /Plano de redução/i.test(tela.titulo), tela.titulo);
  ok('e diz que não há nada cadastrado', tela.vazio);
  ok('sem seletor de unidade, porque o plano é do cliente', !tela.foco);

  await pag.click('[data-novo-plano]');
  await pag.waitForTimeout(400);
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(400);
  const semNome = await pag.evaluate(() =>
    (document.querySelector('.modal .msg.erro, .modal [data-erro]') || {}).textContent || '');
  ok('sem nome, o cadastro é recusado', /nome/i.test(semNome), semNome.trim());

  await pag.fill('#p-nome', 'Corte de licenças');
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(400);
  const semAlvo = await pag.evaluate(() =>
    (document.querySelector('.modal .msg.erro, .modal [data-erro]') || {}).textContent || '');
  ok('sem valor-alvo, também', /valor-alvo/i.test(semAlvo), semAlvo.trim());

  // Um tipo de despesa de verdade, para o indicador ter o que casar.
  const tipoEscolhido = await pag.evaluate(() => {
    const sel = document.querySelector('#p-tipo');
    sel.selectedIndex = 1;
    return sel.value;
  });
  await pag.fill('#p-alvo', '10000');
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(900);

  const listado = await pag.evaluate(() => {
    const linha = document.querySelector('#pagina tbody tr');
    return linha ? linha.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  ok('o item aparece na lista sem recarregar a página', /Corte de licenças/.test(listado), listado);
  ok('com o tipo de despesa e o valor-alvo',
    listado.includes(tipoEscolhido) && /10\.000,00/.test(listado), listado.slice(0, 110));
  ok('e a vigência por extenso', /sempre/i.test(listado), listado.slice(0, 110));

  await pag.click('[data-novo-plano]');
  await pag.waitForTimeout(400);
  await pag.fill('#p-nome', 'Corte de licenças');
  await pag.fill('#p-alvo', '500');
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(400);
  const repetido = await pag.evaluate(() =>
    (document.querySelector('.modal .msg.erro, .modal [data-erro]') || {}).textContent || '');
  ok('nome repetido no mesmo cliente é recusado', /já existe/i.test(repetido), repetido.trim());
  await pag.click('.modal [data-c]');
  await pag.waitForTimeout(300);

  // ------------------------------------------- a ligação com o indicador
  console.log('\nLIGAÇÃO — o indicador do topo passa a ler o cadastro');
  await irPara(pag, 'Indicadores Gerais', 1500);
  const comPlano = await pag.evaluate(() => {
    const kpi = document.querySelector('[data-kpi="plano-reducao"]');
    const dados = calcularPlanoReducao(recorteDoBloco('financeiro'));
    return {
      numero: (kpi.querySelector('.n') || {}).textContent.trim(),
      apoio: (kpi.querySelector('.a') || {}).textContent.trim(),
      drill: kpi.classList.contains('drill'),
      linhas: kpi.querySelectorAll('tbody tr[data-plano]').length,
      comparativos: kpi.querySelectorAll('.comparativo').length,
      porFilial: kpi.querySelectorAll('.plano-filiais-lista span').length,
      alvo: dados.totalAlvo,
      atual: dados.totalAtual,
      pctReducao: dados.pctReducao,
      pctGrupo: dados.pctDoGrupo,
    };
  });
  ok('o indicador passa a mostrar atual → alvo',
    /→/.test(comPlano.numero) && comPlano.numero !== '—', comPlano.numero);
  ok('o alvo é exatamente o cadastrado', comPlano.alvo === 10000, String(comPlano.alvo));
  ok('o valor atual sai dos lançamentos, e não do cadastro', comPlano.atual > 0, String(comPlano.atual));
  ok('o percentual de redução é (atual − alvo) / atual',
    Math.abs(comPlano.pctReducao - Math.round(((comPlano.atual - comPlano.alvo) / comPlano.atual) * 1000) / 10) < 0.05,
    `${comPlano.pctReducao}%`);
  ok('e a tela diz quanto isso é do grupo',
    comPlano.pctGrupo > 0 && new RegExp(String(comPlano.pctGrupo).replace('.', ',')).test(comPlano.apoio),
    comPlano.apoio);
  ok('o item aparece na tabela do bloco', comPlano.linhas === 1, `${comPlano.linhas} linha(s)`);
  ok('com as barras atual × alvo', comPlano.comparativos >= 1, `${comPlano.comparativos} comparativo(s)`);
  ok('e o peso da despesa em cada filial', comPlano.porFilial > 0, `${comPlano.porFilial} filial(is)`);
  ok('agora o indicador abre os lançamentos que compõem o valor atual', comPlano.drill === true);

  // ------------------------------------------------- desativar devolve
  console.log('\nDESATIVAR — o item sai do indicador sem sumir do cadastro');
  await irPara(pag, 'Plano de redução', 900);
  await pag.click('[data-alternar-plano="0"]');
  await pag.waitForTimeout(900);
  const desativado = await pag.evaluate(() => ({
    naLista: document.querySelectorAll('#pagina tbody tr').length,
    situacao: (document.querySelector('#pagina tbody tr td:nth-child(6)') || {}).textContent.trim(),
  }));
  ok('o item continua no cadastro, para ser reativado', desativado.naLista === 1);
  ok('marcado como inativo', /Inativo/i.test(desativado.situacao), desativado.situacao);

  await irPara(pag, 'Indicadores Gerais', 1500);
  const semPlano = await pag.evaluate(() => {
    const kpi = document.querySelector('[data-kpi="plano-reducao"]');
    return (kpi.querySelector('.n') || {}).textContent.trim();
  });
  ok('e o indicador volta ao vazio', semPlano === '—', semPlano);

  void abrirBlocos;
  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
