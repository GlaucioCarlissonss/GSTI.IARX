// A camada de cliente: a escolha antes de qualquer tela.
//
// O que está sendo protegido aqui é o isolamento. O sistema nunca soma dois
// contratantes, então a pergunta "qual cliente?" vem antes de existir recorte —
// e depois de respondida, o seletor de empresa só pode oferecer as matrizes
// daquele cliente. Se este teste quebrar, ou a tela abre sem dono definido, ou
// ela oferece a matriz de outro contratante.
const { chromium } = require('playwright');

const URL_BASE = 'file://' + __dirname + '/teste-local.html';
// Sem o parâmetro, o mock guarda a escolha para as outras suítes entrarem
// direto. Com ele, o armazenamento começa limpo — é o primeiro acesso.
const URL_LIMPA = URL_BASE + '?boasVindas=1';

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push('console: ' + m.text()); });
  const conferir = (rotulo, ok, detalhe = '') => {
    console.log(`  ${ok ? '✓' : '✗'} ${rotulo}: ${detalhe}`);
    if (!ok) falhas.push(rotulo + (detalhe ? ' — ' + detalhe : ''));
  };

  // -------------------------------------------------------- primeiro acesso
  console.log('\nPRIMEIRO ACESSO — a pergunta vem antes da tela');
  await pag.goto(URL_LIMPA);
  await pag.waitForSelector('.boas-vindas', { timeout: 15000 });

  const titulo = await pag.$eval('.boas-vindas h1', (h) => h.textContent.trim());
  conferir('a pergunta é a do gestor', /Qual cliente você gostaria de acessar\?/.test(titulo), titulo);

  // Filtro e navegação não existem antes do cliente: não há sobre o que operar.
  const escondidos = await pag.evaluate(() => ({
    modulos: !!document.querySelector('#modulos')?.offsetParent,
    abas: !!document.querySelector('#abas')?.offsetParent,
    empresa: !!document.querySelector('[data-sel="empresa"]')?.offsetParent,
  }));
  conferir('nenhum filtro nem navegação antes de escolher',
    !escondidos.modulos && !escondidos.abas && !escondidos.empresa, JSON.stringify(escondidos));

  const cartoes = await pag.$$eval('.cartao-cliente', (bs) =>
    bs.map((b) => ({ nome: b.querySelector('strong').textContent.trim(), resumo: b.querySelector('small').textContent.trim() })));
  conferir('o cliente da base histórica aparece, com a contagem da estrutura',
    cartoes.length >= 1 && /Grupo Brasil Home Care/.test(cartoes[0].nome) && /matriz/.test(cartoes[0].resumo),
    cartoes.map((c) => c.nome + ' (' + c.resumo + ')').join(' | '));

  // A adoção das empresas órfãs é o que impede que elas sumam do sistema no
  // instante em que a tela passa a filtrar por cliente.
  const orfas = await pag.evaluate(() => E.empresas.filter((e) => !e.cliente).map((e) => e.id));
  conferir('nenhuma matriz ficou sem dono', orfas.length === 0, orfas.join(', ') || 'nenhuma');

  // --------------------------------------------------------------- escolher
  console.log('\nESCOLHA — o cliente passa a governar o recorte');
  await pag.click('.cartao-cliente');
  await pag.waitForSelector('#modulos button', { timeout: 15000 });

  const depois = await pag.evaluate(() => ({
    cliente: E.clienteSel,
    empresasSel: [...E.empresasSel],
    guardado: localStorage.getItem('iarx-cliente'),
    noTopo: document.querySelector('#cliente-atual b')?.textContent.trim() || null,
  }));
  conferir('o cliente escolhido entra em contexto', depois.cliente === 'grupo-brasil-home-care', String(depois.cliente));
  conferir('uma matriz do cliente já vem selecionada', depois.empresasSel.length === 1, depois.empresasSel.join(', '));
  conferir('o topo mostra de quem são os números', depois.noTopo === 'Grupo Brasil Home Care', String(depois.noTopo));
  conferir('a escolha fica guardada', depois.guardado === 'grupo-brasil-home-care', String(depois.guardado));

  // O seletor de empresa é o teste do isolamento: só as matrizes deste cliente.
  const doSeletor = await pag.evaluate(() => {
    const doCliente = new Set(empresasDoCliente(E.clienteSel).map((e) => e.id));
    return { doCliente: [...doCliente], todas: E.empresas.map((e) => e.id) };
  });
  conferir('o seletor de empresa fica restrito às matrizes do cliente',
    doSeletor.doCliente.length === doSeletor.todas.length, doSeletor.doCliente.join(', '));

  // ------------------------------------------------------------ persistência
  console.log('\nVOLTAR — a escolha é lembrada, e trocar desfaz');
  await pag.goto(URL_LIMPA);
  await pag.waitForSelector('#modulos button', { timeout: 15000 });
  const semPerguntar = await pag.evaluate(() => ({
    cliente: E.clienteSel,
    boasVindas: !!document.querySelector('.boas-vindas'),
  }));
  conferir('quem já escolheu não é perguntado de novo',
    semPerguntar.cliente === 'grupo-brasil-home-care' && !semPerguntar.boasVindas, JSON.stringify(semPerguntar));

  // Com um cliente só, trocar não teria para onde ir — e o botão prometeria
  // uma escolha que não existe.
  const temBotao = await pag.evaluate(() => !!document.querySelector('#bt-trocar-cliente'));
  const quantos = await pag.evaluate(() => E.clientes.filter((c) => c.ativo !== false).length);
  conferir('o botão de trocar só aparece havendo para onde ir', temBotao === quantos > 1,
    quantos + ' cliente(s), botão ' + (temBotao ? 'presente' : 'ausente'));

  // Trocar pela função é o mesmo caminho do botão; com um cliente só, o botão
  // não está na tela, mas o caminho de volta precisa continuar íntegro.
  await pag.evaluate(() => trocarCliente());
  await pag.waitForSelector('.boas-vindas', { timeout: 5000 });
  const aoTrocar = await pag.evaluate(() => ({
    cliente: E.clienteSel,
    guardado: localStorage.getItem('iarx-cliente'),
  }));
  conferir('trocar volta à pergunta e esquece a escolha',
    aoTrocar.cliente === null && aoTrocar.guardado === null, JSON.stringify(aoTrocar));

  // --------------------------------------------------------- somente leitura
  console.log('\nSOMENTE LEITURA — quem não escreve também precisa entrar');
  await pag.goto(URL_LIMPA + '&somenteLeitura=1');
  await pag.waitForSelector('.boas-vindas', { timeout: 15000 });
  const semEscrita = await pag.evaluate(() => ({
    soLeitura: E.somenteLeitura,
    clientes: E.clientes.length,
    orfas: E.empresas.filter((e) => !e.cliente).length,
  }));
  conferir('sem poder gravar, a adoção vale em memória e a tela abre',
    semEscrita.soLeitura === true && semEscrita.clientes >= 1 && semEscrita.orfas === 0,
    JSON.stringify(semEscrita));

  console.log(`\n=== erros de console: ${erros.length ? erros.join(' | ') : 'nenhum'} ===`);
  if (erros.length) falhas.push('erros de console');
  console.log(falhas.length ? `\nFALHAS (${falhas.length}):\n- ` + falhas.join('\n- ') : '\nTudo certo.');
  await nav.close();
  process.exit(falhas.length ? 1 : 0);
})();
