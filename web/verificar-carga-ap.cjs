// A carga de Contas a Pagar e o cadastro de quem reconhece, no navegador.
//
// Compilar não é abrir. O que se confere aqui é a LIGAÇÃO de ponta a ponta:
// subir o arquivo do ERP, ver o sistema pedir as decisões que faltam, ver o
// confronto com os lançamentos que já existem e, só então, gravar — e depois
// reenviar o MESMO arquivo e o sistema dizer que não há nada de novo.
//
// É esse último passo que importa: uma carga que passa verde na primeira vez e
// dobra a base na segunda seria o defeito mais caro desta entrega.
//
//   DATABASE_PATH=/tmp/claude-0/verif-v6.sqlite npx tsx server/src/db/preparar-verificacao-v2.ts
//   DATABASE_PATH=/tmp/claude-0/verif-v6.sqlite PORT=3399 node server/dist/index.js
//   BASE_URL=http://127.0.0.1:3399 node web/verificar-carga-ap.cjs
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3399';
const SENHA = process.env.SENHA || 'varredura2026';
const ARQUIVO = path.join(__dirname, '..', 'server', 'test', 'dados', 'contas-pagar-exemplo.csv');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || '/opt/pw-browsers/chromium' });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/ERR_|net::|favicon|Failed to load resource/.test(t)) erros.push('console: ' + t);
  });
  const ok = (r, b, d = '') => {
    console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`);
    if (!b) falhas.push(r + (d ? ' — ' + d : ''));
  };

  // ------------------------------------------------------------------ entrar
  await pag.goto(BASE + '/');
  await pag.waitForLoadState('networkidle');
  await pag.fill('input[autocomplete="username"], input[name="usuario"]', process.env.USUARIO || 'gestora');
  await pag.fill('input[type="password"]', SENHA);
  await pag.click('button[type="submit"]');
  await pag.waitForSelector('.menu a, .cartao, h1', { timeout: 15000 });
  await pag.waitForTimeout(800);
  if (!(await pag.$('.menu a'))) {
    await pag.locator('.cartao button').filter({ hasNotText: 'Sair de' }).first().click();
  }
  await pag.waitForSelector('.menu a', { timeout: 15000 });

  // O cartão abre RECOLHIDO: quem verifica faz o que o usuário faz.
  const abrirCartoes = async () => {
    const dobras = await pag.$$('.cartao.dobrado .cartao-dobra');
    for (const d of dobras) {
      await d.click();
      await pag.waitForTimeout(250);
    }
  };
  const irPara = async (rota, espera = 1400) => {
    await pag.goto(BASE + rota);
    await pag.waitForTimeout(espera);
    await abrirCartoes();
  };
  const texto = () => pag.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));

  /** O bloco da carga de Contas a Pagar, isolado dos outros cartões da tela. */
  const bloco = () => pag.locator('.cartao', { hasText: 'Carga de Contas a Pagar' });

  // --------------------------------------------- passo 1: as dimensões
  console.log('\nPASSO 1 — o arquivo torto é lido, e o que não existe vira decisão');
  await irPara('/planilhas');
  ok('a tela tem o bloco da carga de Contas a Pagar', (await bloco().count()) > 0);

  await bloco().locator('input[type="file"]').setInputFiles(ARQUIVO);
  await bloco().locator('button:text-is("Analisar")').click();
  await pag.waitForTimeout(2500);

  const aposAnalise = await texto();
  ok('o aviso de realinhamento aparece, com a contagem',
    /13 linha\(s\) chegaram com campo omitido/.test(aposAnalise),
    (aposAnalise.match(/\d+ linha\(s\) chegaram[^.]*\./) || [''])[0]);
  ok('a conciliação acusa decisões pendentes', /sem decisão/.test(aposAnalise),
    (aposAnalise.match(/\d+ divergência\(s\) ainda sem decisão/) || [''])[0]);

  // Os blocos de divergência abrem FECHADOS — cada carga é uma conferência
  // nova. Quem verifica faz o que o usuário faz: abre e decide. Cada clique
  // redesenha o bloco, então a lista é relida a cada volta.
  const fechados = () => bloco().locator('.cartao-dobra[aria-expanded="false"]');
  for (let volta = 0; volta < 12 && (await fechados().count()) > 0; volta++) {
    await fechados().first().click();
    await pag.waitForTimeout(200);
  }
  ok('abertos os blocos, as unidades do arquivo aparecem nominalmente',
    /CLÍNICA AURORA/.test(await texto()));

  // Decidir tudo como "criar": é a primeira carga deste cliente, e nenhum destes
  // nomes existe no cadastro ainda.
  const novos = () => bloco().locator('button:text-is("Cadastrar todos os novos")');
  for (let i = 0, n = await novos().count(); i < n; i++) {
    await novos().nth(i).click();
    await pag.waitForTimeout(200);
  }
  // O atalho em lote só aparece quando o bloco tem mais de uma pendência; o que
  // tem uma só se decide na linha dela. O botão continua na linha depois de
  // decidida (ao lado de "desfazer"), então percorrer por índice é o certo —
  // clicar sempre no primeiro repetiria a mesma linha.
  const umAUm = () => bloco().locator('button:text-is("Criar novo")');
  for (let i = 0, n = await umAUm().count(); i < n; i++) {
    await umAUm().nth(i).click();
    await pag.waitForTimeout(120);
  }
  await pag.waitForTimeout(400);
  ok('decidido tudo, o botão de prosseguir libera',
    /Tudo decidido/.test(await texto()));

  // ----------------------------------- passo 2: o confronto com a base
  console.log('\nPASSO 2 — o confronto com os lançamentos que já existem');
  await bloco().locator('button', { hasText: 'Prosseguir com a importação' }).click();
  await pag.waitForTimeout(2500);

  const confronto = await texto();
  ok('a tela mostra o que a carga faria na base', /O que esta carga faria na base/.test(confronto));
  ok('com as três contagens', /13 novo\(s\)/.test(confronto), (confronto.match(/\d+ novo\(s\)/) || [''])[0]);
  ok('e nada foi gravado ainda — o botão de importar é que grava',
    (await bloco().locator('button:text-is("Importar")').count()) === 1);

  // ------------------------------------------------- passo 3: gravar
  console.log('\nPASSO 3 — gravar, e ver o que entrou');
  await bloco().locator('button:text-is("Importar")').click();
  await pag.waitForTimeout(3000);

  const gravado = await texto();
  ok('o resultado diz quantos lançamentos novos entraram',
    /13 lançamento\(s\) novo\(s\)/.test(gravado), (gravado.match(/\d+ lançamento\(s\) novo\(s\)/) || [''])[0]);
  ok('e quantos já entraram reconhecidos pelo cadastro',
    /já entrou como reconhecido/.test(gravado),
    (gravado.match(/\d+ já entrou como reconhecido[^.]*\./) || [''])[0]);
  ok('as unidades criadas são nomeadas', /Unidades criadas:/.test(gravado));

  // -------------------------------- a promessa que importa: não dobrar
  console.log('\nREENVIO — o mesmo arquivo de novo não pode dobrar a base');
  await irPara('/planilhas');
  await bloco().locator('input[type="file"]').setInputFiles(ARQUIVO);
  await bloco().locator('button:text-is("Analisar")').click();
  await pag.waitForTimeout(2500);

  const segunda = await texto();
  // Os cadastros já existem, então não há decisão pendente e a tela vai direto
  // ao confronto.
  ok('a segunda análise não pede decisão nenhuma', /O que esta carga faria na base/.test(segunda));
  ok('e diz que NADA é novo', /0 novo\(s\)/.test(segunda), (segunda.match(/\d+ novo\(s\)/) || [''])[0]);

  // ------------------------------------ o cadastro de quem reconhece
  console.log('\nRECONHECEDORES — o cadastro alcança o que já está gravado');
  await irPara('/reconhecedores');
  const telaRec = await texto();
  ok('a tela abre com a pessoa da base de verificação', /MIQUEIASSILVA/.test(telaRec));
  ok('e não oferece seletor de unidade, porque é do cliente', !/Unidade em foco/i.test(telaRec));

  await pag.locator('button:text-is("Ver o que mudaria")').click();
  await pag.waitForTimeout(1200);
  const previa = await texto();
  ok('a prévia sai e diz que não gravou', /nada foi gravado/i.test(previa));
  ok('e conta quem está fora do cadastro à parte',
    /Criador fora do cadastro/.test(previa) && /Sem criador na origem/.test(previa));

  await pag.locator('button:text-is("Aplicar")').click();
  await pag.waitForTimeout(1500);
  ok('aplicar confirma na tela', /Reconhecimento aplicado/.test(await texto()));

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
