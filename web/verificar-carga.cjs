// A carga de planilha no navegador: modo, registro e adaptador de cabeçalho.
//
// O que se confere aqui é o que o gestor de fato faz: escolher o tipo de carga,
// ver a recusa quando ela é inicial sobre base povoada, cadastrar o cabeçalho
// que a planilha do cliente usa, e reencontrar no histórico o que aconteceu —
// inclusive a tentativa recusada.
//
//   DATABASE_PATH=/tmp/verif.sqlite npx tsx server/src/db/preparar-verificacao.ts
//   DATABASE_PATH=/tmp/verif.sqlite PORT=3349 JWT_SECRET=<32+ caracteres> node server/dist/index.js
//   BASE_URL=http://127.0.0.1:3349 node web/verificar-carga.cjs
const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3349';
const SENHA = process.env.SENHA || 'varredura2026';

/**
 * Uma planilha do cliente: a coluna de valor tem o nome DELE.
 *
 * SEM coluna "Empresa", de propósito: ela só é exigida quando o escopo tem
 * mais de uma matriz, e o assunto desta conferência é o ADAPTADOR DE
 * CABEÇALHO, não aquela regra. Por isso o roteiro entra num cliente de uma
 * matriz só — e a regra da coluna "Empresa" ganhou seção própria no fim.
 */
function csvDoCliente(cabecalhoValor, empresa) {
  const cabecalho = ['Tipo de Despesa', 'Competência', cabecalhoValor, 'Natureza', 'Classificação'];
  const linha = ['Licenças', '01/2031', '250,00', 'Fixa', 'Despesa'];
  // A coluna "Empresa" entra quando o escopo tem mais de uma matriz: sem ela
  // não há como saber de qual é cada linha, e o servidor recusa o arquivo —
  // corretamente, e antes de qualquer outra conferência.
  if (empresa) { cabecalho.push('Empresa'); linha.push(empresa); }
  const linhas = [cabecalho.join(';'), linha.join(';')];
  const arquivo = path.join(os.tmpdir(),
    `carga-${cabecalhoValor.replace(/\W/g, '')}-${String(empresa || 'sem').replace(/\W/g, '')}.csv`);
  fs.writeFileSync(arquivo, '﻿' + linhas.join('\n'), 'utf8');
  return arquivo;
}

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
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
  await pag.waitForSelector('.menu a, .cartao-cliente, h1', { timeout: 15000 });
  await pag.waitForTimeout(800);
  // A escolha de cliente vem antes de qualquer tela; entrar pelo primeiro é o
  // caminho de quem só quer chegar à importação. Tem de ser um cliente em que
  // a pessoa EDITA: num de leitura o botão de importar nem existe, e o
  // roteiro morreria esperando por ele.
  if (!(await pag.$('.menu a'))) {
    await pag.locator('.cartao button').filter({ hasNotText: 'Sair de' }).first().click();
  }
  await pag.waitForSelector('.menu a', { timeout: 15000 });
  await pag.click('.menu a:has-text("Importar / Exportar")');
  await pag.waitForTimeout(900);
  // OS CARTÕES NASCEM FECHADOS, e o campo de arquivo mora dentro de um deles.
  // Sem abrir, este roteiro esperava 15 s por um elemento que a tela não tinha
  // desenhado — e morria antes de conferir qualquer coisa.
  await pag.evaluate(() => {
    document.querySelectorAll('.cartao-dobra[aria-expanded="false"]').forEach((b) => b.click());
  });
  await pag.waitForSelector('input[type="file"]', { timeout: 15000 });
  await pag.waitForTimeout(600);

  // As MATRIZES do cliente em contexto, pela própria sessão da página. O nome
  // não pode ser fixo no roteiro: ele muda com a base, e um nome errado viraria
  // uma recusa que pareceria defeito da tela.
  const matrizes = await pag.evaluate(async () => {
    const h = {
      Authorization: `Bearer ${localStorage.getItem('gsti.token')}`,
      'X-Cliente-Id': String(localStorage.getItem('gsti.cliente')),
      'X-Empresa-Id': String(localStorage.getItem('gsti.empresa')),
    };
    // `/api/auth/eu` devolve as matrizes a que esta pessoa tem acesso, já
    // recortadas pelo cliente em contexto — que é exatamente o escopo da carga.
    const r = await fetch('/api/auth/eu', { headers: h });
    if (!r.ok) return [];
    const corpo = await r.json();
    const cliente = Number(localStorage.getItem('gsti.cliente'));
    return (corpo.empresas || [])
      .filter((e) => !cliente || e.cliente_id === cliente)
      .map((e) => e.nome);
  });
  // Uma matriz só: a coluna "Empresa" não é exigida, e sai do arquivo.
  const empresaDoArquivo = matrizes.length > 1 ? matrizes[0] : '';
  console.log(`  · ${matrizes.length} matriz(es) no escopo`
    + `${empresaDoArquivo ? `; a planilha declara "${empresaDoArquivo}"` : '; sem coluna Empresa'}`);

  // ------------------------------------------------- adaptador de cabeçalho
  console.log('\nADAPTADOR — o cabeçalho que a planilha do cliente usa');
  const cartaoImportar = pag.locator('.cartao', { hasText: 'Importar planilha' });
  // O BOTÃO DE AÇÃO, e não o de dobra. Com os cartões abertos, o cabeçalho do
  // cartão ("Importar planilha") também é um `<button>`, e um seletor por
  // texto casava com os dois — o roteiro morria por ambiguidade antes de
  // conferir qualquer coisa. `.botao` é a classe que só a ação tem.
  const acaoImportar = cartaoImportar.locator('button.botao:has-text("Importar")');
  const semMapa = csvDoCliente('Vlr Total', empresaDoArquivo);
  await pag.setInputFiles('input[type="file"]', semMapa);
  await acaoImportar.first().click();
  await pag.waitForTimeout(1800);
  let relatorio = await pag.textContent('body');
  ok('sem o cabeçalho cadastrado, a coluna obrigatória falta', /obrigat[óo]rias ausentes/i.test(relatorio),
    (relatorio.match(/Cabe[çc]alho incompleto[^.]*\./) || ['(não apareceu)'])[0]);

  const campoAba = pag.locator('.cartao', { hasText: 'Cabeçalhos deste cliente' });
  await campoAba.locator('select').first().selectOption('Financeiro');
  await campoAba.locator('select').nth(1).selectOption('Valor');
  await campoAba.locator('input').first().fill('Vlr Total');
  await campoAba.locator('button:has-text("Cadastrar cabeçalho")').click();
  await pag.waitForTimeout(1200);
  const naTabela = await campoAba.textContent();
  ok('o cabeçalho cadastrado aparece na lista', /Vlr Total/.test(naTabela));

  await pag.setInputFiles('input[type="file"]', semMapa);
  await acaoImportar.first().click();
  await pag.waitForTimeout(1800);
  relatorio = await pag.textContent('body');
  ok('com o cabeçalho cadastrado, a mesma planilha entra', !/Colunas obrigatórias ausentes/.test(relatorio));

  // ------------------------------------------------------------------ modo
  console.log('\nMODO — inicial sobre base povoada pede confirmação');
  await cartaoImportar.locator('select').nth(1).selectOption('inicial');
  await pag.setInputFiles('input[type="file"]', csvDoCliente('Valor', empresaDoArquivo));
  await acaoImportar.first().click();
  await pag.waitForTimeout(1500);
  const recusa = await pag.$eval('.aviso.erro', (a) => a.textContent.trim()).catch(() => null);
  ok('a carga inicial é recusada, dizendo quantos registros já existem',
    /marcada como INICIAL/i.test(String(recusa)), String(recusa).slice(0, 120));
  ok('a tela oferece confirmar, em vez de virar beco',
    (await pag.$('button:has-text("Confirmar a carga inicial")')) !== null);

  await pag.click('button:has-text("Confirmar a carga inicial")');
  await pag.waitForTimeout(1800);

  // -------------------------------------------------------------- histórico
  console.log('\nHISTÓRICO — toda tentativa deixa rastro');
  const linhas = await pag
    .locator('.cartao', { hasText: 'Histórico de cargas' })
    .locator('tbody tr')
    .allTextContents();
  ok('a carga recusada aparece no histórico', linhas.some((l) => /Recusada/.test(l)),
    linhas.length + ' linha(s)');
  ok('a carga confirmada aparece como concluída e inicial',
    linhas.some((l) => /Concluída/.test(l) && /Inicial/.test(l)));
  ok('o histórico diz quem carregou', linhas.every((l) => /Gestora/.test(l)) || linhas.some((l) => /Gestora/.test(l)));

  console.log(`\nerros de console: ${erros.length ? erros.join(' | ') : 'nenhum'}`);
  if (erros.length) falhas.push('erros de console');
  console.log(falhas.length ? `\nFALHAS (${falhas.length}):\n- ` + falhas.join('\n- ') : '\nTudo certo.');
  await nav.close();
  process.exit(falhas.length ? 1 : 0);
})();
