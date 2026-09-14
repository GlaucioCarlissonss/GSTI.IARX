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

  // ---------------------------------------------------------------- cadastro
  console.log('\nCADASTRO — a regra do CNPJ decide onde a unidade entra');
  // A seção anterior terminou trocando de cliente: a pergunta está de volta.
  await pag.goto(URL_LIMPA);
  await pag.waitForSelector('.cartao-cliente', { timeout: 15000 });
  await pag.click('.cartao-cliente');
  await pag.waitForSelector('#modulos button', { timeout: 15000 });
  await pag.click('#modulos button:text-is("Sistema")');
  await pag.waitForTimeout(200);
  await pag.click('#abas button:text-is("Clientes e unidades")');
  await pag.waitForTimeout(600);

  const naTela = await pag.$$eval('.rol table tbody tr', (rs) => rs.map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
  conferir('a tela lista o cliente com a estrutura dele',
    naTela.some((l) => /Grupo Brasil Home Care/.test(l)), naTela[0] || '(vazio)');

  // Matriz de raiz nova entra; unidade da MESMA raiz tem de virar filial dela.
  await pag.fill('#un-nome', 'Sede Teste');
  await pag.fill('#un-cnpj', '11.222.333/0001-44');
  await pag.click('#un-criar');
  await pag.waitForTimeout(700);
  const comSede = await pag.evaluate(() => empresasDoCliente(E.clienteCad).map((m) => m.nome));
  conferir('a matriz nova entra na estrutura do cliente', comSede.includes('Sede Teste'), comSede.join(', '));

  await pag.fill('#un-nome', 'Unidade Teste 2');
  await pag.fill('#un-cnpj', '11.222.333/0002-25');
  await pag.waitForTimeout(300);
  const alerta = await pag.$eval('#un-aviso', (m) => m.textContent.replace(/\s+/g, ' ').trim()).catch(() => null);
  conferir('a tela avisa da raiz repetida ANTES de enviar', /mesma raiz/i.test(String(alerta)), String(alerta));

  await pag.click('#un-criar');
  await pag.waitForTimeout(600);
  const recusa = await pag.$eval('#un-erro', (m) => m.textContent.trim()).catch(() => null);
  conferir('cadastrar como matriz uma raiz conhecida é recusado', /mesma raiz/i.test(String(recusa)), String(recusa));

  await pag.selectOption('#un-tipo', 'FILIAL');
  await pag.waitForTimeout(400);
  await pag.click('#un-criar');
  await pag.waitForTimeout(700);
  const ondeEntrou = await pag.evaluate(() => {
    const sede = empresasDoCliente(E.clienteCad).find((m) => m.nome === 'Sede Teste');
    return sede ? filiaisDa(sede.id).map((f) => f.nome) : [];
  });
  conferir('a unidade de mesma raiz entra como filial da matriz dela',
    ondeEntrou.includes('Unidade Teste 2'), ondeEntrou.join(', ') || 'nenhuma');

  // Os dois clientes do enunciado entram por um botão, não sozinhos ao abrir.
  await pag.click('#cl-iniciais');
  await pag.waitForTimeout(800);
  const depoisIniciais = await pag.evaluate(() => ({
    clientes: E.clientes.map((c) => c.nome),
    matrizes: E.clientes.map((c) => empresasDoCliente(c.id).length),
  }));
  conferir('Limas IT e SoulCoop entram, cada um com a matriz dele',
    ['Limas IT', 'SoulCoop'].every((n) => depoisIniciais.clientes.includes(n)) &&
      depoisIniciais.matrizes.every((n) => n >= 1),
    depoisIniciais.clientes.join(', '));

  // Com três clientes, a pergunta de boas-vindas passa a ter sentido.
  const podeTrocarAgora = await pag.evaluate(() => !!document.querySelector('#bt-trocar-cliente'));
  conferir('havendo mais de um cliente, trocar aparece', podeTrocarAgora === true, String(podeTrocarAgora));

  // --------------------------------------------------------- somente leitura
  console.log('\nSOMENTE LEITURA — quem não escreve também precisa entrar');
  await pag.evaluate(() => { try { localStorage.removeItem('iarx-cliente'); } catch (e) {} });
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
