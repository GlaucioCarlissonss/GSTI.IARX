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

  /**
   * Abre os cartões em acordeão da tela.
   *
   * Eles nascem FECHADOS, e o que está dentro de um cartão fechado não existe
   * no DOM: esperar por `table` numa tela recém-aberta espera para sempre. É a
   * mesma armadilha que já derrubou `verificar-drill` e `verificar-carga`.
   */
  const abrirBlocos = async () => {
    for (let i = 0; i < 10; i += 1) {
      const fechado = await pag.$('.cartao.dobrado .cartao-dobra');
      if (!fechado) break;
      await fechado.click();
      await pag.waitForTimeout(150);
    }
  };

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

  // O seletor GLOBAL de empresa não existe mais: o recorte é do cliente, e o
  // filtro de empresa é local de cada tela.
  ok('não há seletor global de empresa no topo', (await pag.$$('#sel-empresa')).length === 0);
  const subtitulo = await pag.$eval('.titulo small', (s) => s.textContent.trim()).catch(() => '');
  ok('o topo mostra a unidade do cliente de uma matriz só', /Limas IT/.test(subtitulo), subtitulo);
  // Com UM cliente só, trocar continua acessível: quem ganha acesso a um
  // segundo contratante precisa achar a saída sem descobrir que ela só existe
  // depois de ter dois.
  ok('o botão de trocar cliente está sempre visível',
    (await pag.$$('button:has-text("Trocar cliente")')).length === 1);

  const guardado = await pag.evaluate(() => localStorage.getItem('gsti.cliente'));
  ok('a escolha fica guardada', !!guardado, String(guardado));

  await pag.reload();
  await pag.waitForSelector('.menu a', { timeout: 15000 });
  await pag.waitForTimeout(600);
  // A pergunta de cliente é a tela que TEM o h1 "Qual cliente...". Procurar um
  // botão com o nome do cliente não distingue nada: o painel do contratante
  // tem um cartão chamado "Limas IT — Matriz está pronta para receber dados",
  // e o cabeçalho dele é um botão de dobra. A conferência passou a perguntar
  // pela tela, e não por um texto que aparece nas duas.
  const aposRecarregar = await pag.evaluate(() => ({
    h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
    temMenu: !!document.querySelector('.menu a'),
  }));
  ok('recarregar não pergunta de novo',
    aposRecarregar.temMenu && !aposRecarregar.h1.some((h) => /Qual cliente/.test(h)),
    aposRecarregar.h1.join(' | '));

  // Trocar de cliente passa por uma CONFIRMAÇÃO, de propósito: sair é perder o
  // contexto inteiro da tela, e um clique sem volta ao lado do menu seria fácil
  // demais de dar sem querer.
  await pag.click('button:has-text("Trocar cliente")');
  await pag.waitForSelector('.modal', { timeout: 10000 });
  await pag.waitForTimeout(400);
  const confirmacao = await pag.$eval('.modal', (m) => m.textContent.replace(/\s+/g, ' '));
  ok('trocar cliente pede confirmação antes de sair', /Sair deste cliente\?/.test(confirmacao),
    confirmacao.slice(0, 80));
  ok('e a confirmação diz que nada se perde', /nada é apagado/i.test(confirmacao));

  await pag.click('.modal button:has-text("Sair")');
  await pag.waitForTimeout(900);
  const voltou = await pag.evaluate(() => {
    const h = [...document.querySelectorAll('h1')].map((x) => x.textContent.trim());
    return { h1: h, pergunta: h.some((x) => /Qual cliente/.test(x)) };
  });
  ok('confirmar volta à pergunta', voltou.pergunta, voltou.h1.join(' | '));

  await pag.click('.cartao button:has-text("ALIANÇA")');
  await pag.waitForSelector('.menu a', { timeout: 15000 });
  await pag.waitForTimeout(1200);
  const doOutro = await pag.$eval('.titulo h1', (h) => h.textContent.trim());
  ok('o outro cliente entra em contexto', /ALIAN/.test(doOutro), doOutro);

  // ------------------------------------- o filtro de empresa é LOCAL da tela
  console.log('\nFILTRO LOCAL — o recorte é da tela, não do sistema');
  await pag.click('.menu a:has-text("Lançamentos")');
  await pag.waitForSelector('.barra-filtros', { timeout: 15000 });
  await pag.waitForTimeout(900);
  const rotulos = await pag.$$eval('.barra-filtros .campo label', (ls) => ls.map((l) => l.textContent.trim()));
  ok('a tela traz o filtro de empresa dela', rotulos.some((r) => /Empresa \(matriz\)/.test(r)), rotulos.join(' | '));
  ok('todo filtro da barra tem texto de apoio',
    (await pag.$$('.barra-filtros .campo.filtro')).length ===
      (await pag.$$('.barra-filtros .campo.filtro .dica-filtro')).length);
  const opcoesLocais = await pag.$$eval('.barra-filtros .seletor-multi .lista label', () => []).catch(() => []);
  void opcoesLocais;
  // Abre o seletor local e confere que ele só oferece as matrizes DESTE cliente.
  await pag.locator('.barra-filtros .seletor-multi button[aria-label="Empresa (matriz)"]').click();
  await pag.waitForTimeout(400);
  const matrizes = await pag.$$eval('.seletor-multi .painel .lista .rot', (rs) => rs.map((r) => r.textContent.trim()));
  ok('o filtro local só oferece as matrizes do cliente ativo',
    matrizes.length === 2 && matrizes.every((m) => /ALIAN/i.test(m)) && !matrizes.some((m) => /Limas/i.test(m)),
    matrizes.join(' | '));
  await pag.keyboard.press('Escape');

  // Recortar aqui não pode recortar outra tela: o estado é por tela.
  await pag.click('.seletor-multi button[aria-label="Empresa (matriz)"]');
  await pag.waitForTimeout(300);
  await pag.locator('.seletor-multi .painel .lista label').first().click();
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(800);
  await pag.click('.menu a:has-text("Dashboard financeiro")');
  await pag.waitForSelector('.barra-filtros', { timeout: 15000 });
  await pag.waitForTimeout(900);
  const resumoFin = await pag.$eval('.barra-filtros > div:last-child', (d) => d.textContent.trim()).catch(() => '');
  ok('o recorte de uma tela não vaza para a outra', /Todas as unidades/.test(resumoFin), resumoFin);

  // ------------------------------------------------- cadastro de estrutura
  console.log('\nCADASTRO — a regra do CNPJ decide onde a unidade entra');
  await pag.click('.menu a:has-text("Clientes e unidades")');
  await pag.waitForSelector('.cartao', { timeout: 15000 });
  await abrirBlocos();
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
