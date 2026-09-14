// A escolha de cliente no app local, conferida no navegador.
//
// O que está em jogo é o isolamento: escolhido um contratante, o seletor de
// empresa não pode oferecer a matriz de outro. O resto — lembrar a escolha,
// poder trocar — é o que faz a tela ser usável sem virar pedágio diário.
//
// Prepare uma base isolada com dois clientes e suba o servidor sobre ela:
//   DATABASE_PATH=/tmp/verif.sqlite npx tsx server/src/db/preparar-verificacao.ts
//   DATABASE_PATH=/tmp/verif.sqlite PORT=3349 JWT_SECRET=<32+ caracteres> node server/dist/index.js
//   BASE_URL=http://127.0.0.1:3349 node web/verificar-cliente.cjs
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3349';
const SENHA = process.env.SENHA || 'varredura2026';

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pag = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  // A recusa do servidor é exercitada de propósito aqui, e o navegador registra
  // toda resposta 4xx no console. O que importa é a recusa CHEGAR à tela — e
  // isso é conferido por asserção, não pela ausência da linha de console.
  pag.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/ERR_|net::|favicon|Failed to load resource/.test(t)) erros.push('console: ' + t);
  });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto(BASE + '/');
  await pag.waitForLoadState('networkidle');
  await pag.fill('input[autocomplete="username"], input[name="usuario"]', 'gestora');
  await pag.fill('input[type="password"]', SENHA);
  await pag.click('button[type="submit"]');

  await pag.waitForSelector('h1', { timeout: 15000 });
  await pag.waitForTimeout(800);
  const titulo = await pag.$eval('h1', (h) => h.textContent.trim());
  ok('depois do login vem a pergunta de cliente', /Qual cliente/.test(titulo), titulo);

  const cartoes = await pag.$$eval('.cartao button', (bs) => bs.map((b) => b.textContent.trim()));
  ok('os dois clientes aparecem', cartoes.filter((c) => /matriz/.test(c)).length === 2, cartoes.join(' | '));
  ok('nenhum menu antes de escolher', (await pag.$$('.menu a')).length === 0);

  await pag.click('.cartao button:has-text("Limas IT")');
  await pag.waitForSelector('.menu a', { timeout: 15000 });
  await pag.waitForTimeout(1000);
  const noTopo = await pag.$eval('.cliente-atual b, .cliente-atual strong', (b) => b.textContent.trim()).catch(() => null);
  ok('o cliente escolhido aparece na lateral', noTopo === 'Limas IT', String(noTopo));

  const empresas = await pag.$$eval('#sel-empresa option', (os) => os.map((o) => o.textContent.trim()));
  ok('o seletor de empresa só traz as matrizes do cliente',
    empresas.length === 1 && /Limas IT/.test(empresas[0]), empresas.join(' | '));

  const guardado = await pag.evaluate(() => localStorage.getItem('gsti.cliente'));
  ok('a escolha fica guardada', !!guardado, String(guardado));

  await pag.reload();
  await pag.waitForSelector('.menu a', { timeout: 15000 });
  await pag.waitForTimeout(600);
  ok('recarregar não pergunta de novo', (await pag.$$('.cartao button:has-text("Limas IT")')).length === 0);

  await pag.click('button:has-text("Trocar cliente")');
  await pag.waitForTimeout(800);
  const voltou = await pag.$eval('h1', (h) => h.textContent.trim());
  ok('trocar cliente volta à pergunta', /Qual cliente/.test(voltou), voltou);

  await pag.click('.cartao button:has-text("ALIANÇA")');
  await pag.waitForSelector('.menu a', { timeout: 15000 });
  await pag.waitForTimeout(1200);
  const outras = await pag.$$eval('#sel-empresa option', (os) => os.map((o) => o.textContent.trim()));
  ok('o outro cliente traz a matriz dele', outras.length === 1 && /ALIAN/.test(outras[0]), outras.join(' | '));

  // ------------------------------------------------- cadastro de estrutura
  console.log('\nCADASTRO — a regra do CNPJ decide onde a unidade entra');
  await pag.click('.menu a:has-text("Clientes e unidades")');
  await pag.waitForSelector('table', { timeout: 15000 });
  await pag.waitForTimeout(800);

  const linhas = await pag.$$eval('table tbody tr', (rs) => rs.map((r) => r.textContent.trim()));
  ok('a lista traz os clientes com a contagem da estrutura',
    linhas.some((l) => /ALIAN/.test(l)) && linhas.some((l) => /Limas IT/.test(l)), String(linhas.length) + ' linha(s)');

  // Uma matriz com CNPJ de raiz nova, e depois uma unidade da MESMA raiz: a
  // segunda tem de entrar como filial da primeira, sem ninguém dizer.
  const preencher = async (rotulo, valor) => {
    const campo = pag.locator('form .campo', { has: pag.locator(`label:text-is("${rotulo}")`) }).last();
    await campo.locator('input, select').fill(valor);
  };
  await pag.selectOption('form select', 'MATRIZ').catch(() => {});
  await preencher('Nome', 'Sede Teste');
  await preencher('CNPJ', '11.222.333/0001-44');
  await pag.click('button:has-text("Cadastrar unidade")');
  await pag.waitForTimeout(1200);
  let corpo = await pag.$$eval('table tbody tr', (rs) => rs.map((r) => r.textContent.trim()));
  ok('a matriz nova entra na estrutura', corpo.some((l) => /Sede Teste/.test(l)));

  await preencher('Nome', 'Unidade Teste 2');
  await preencher('CNPJ', '11.222.333/0002-25');
  await pag.waitForTimeout(400);
  const aviso = await pag.$eval('form .aviso', (a) => a.textContent.trim()).catch(() => null);
  ok('a tela avisa, antes de enviar, que a raiz já é conhecida', /mesma raiz/i.test(String(aviso)), String(aviso));

  // Como MATRIZ o servidor recusa; a tela mostra a recusa e explica o caminho.
  await pag.click('button:has-text("Cadastrar unidade")');
  await pag.waitForTimeout(1000);
  const recusa = await pag.$eval('.aviso.erro', (a) => a.textContent.trim()).catch(() => null);
  ok('cadastrar como matriz uma raiz já existente é recusado', /mesma raiz/i.test(String(recusa)), String(recusa));

  // Agora como filial, deixando o CNPJ decidir a matriz.
  await pag.selectOption('form select', 'FILIAL');
  await pag.waitForTimeout(300);
  await pag.click('button:has-text("Cadastrar unidade")');
  await pag.waitForTimeout(1200);
  corpo = await pag.$$eval('table tbody tr', (rs) => rs.map((r) => r.textContent.trim()));
  ok('a unidade de mesma raiz entra como filial', corpo.some((l) => /Unidade Teste 2/.test(l) && /Filial/.test(l)),
    corpo.filter((l) => /Unidade Teste 2/.test(l)).join(' | '));

  console.log(`\nerros de console: ${erros.length ? erros.join(' | ') : 'nenhum'}`);
  if (erros.length) falhas.push('erros de console');
  console.log(falhas.length ? `\nFALHAS (${falhas.length}):\n- ` + falhas.join('\n- ') : '\nTudo certo.');
  await nav.close();
  process.exit(falhas.length ? 1 : 0);
})();
