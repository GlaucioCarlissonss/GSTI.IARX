// A carga de dados na versão hospedada: modo, registro e adaptador.
//
// Três perguntas que a tela precisa responder: esta carga é o histórico ou o
// arquivo do mês? o que aconteceu nas cargas anteriores — inclusive nas que
// não entraram? e como aceitar o cabeçalho que a planilha DESTE cliente usa?
const { chromium } = require('playwright');
const { irPara } = require('./ajuda-testes.cjs');

const URL = 'file://' + __dirname + '/teste-local.html';

/** Uma planilha do cliente, com o nome que ELE dá à coluna de valor. */
const csvDoCliente = (cabecalhoValor) =>
  [
    ['Tipo de Despesa', 'Competência', cabecalhoValor, 'Natureza', 'Classificação'].join(';'),
    ['Licenças de teste', '01/2031', '250,00', 'Fixa', 'Despesa'].join(';'),
  ].join('\n');

/** Entrega um arquivo ao campo de upload sem depender do disco. */
async function enviarCsv(pag, nome, conteudo) {
  await pag.setInputFiles('#d-arquivo', { name: nome, mimeType: 'text/csv', buffer: Buffer.from(conteudo, 'utf8') });
  await pag.waitForTimeout(200);
}

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push('console: ' + m.text()); });
  const conferir = (rotulo, ok, detalhe = '') => {
    console.log(`  ${ok ? '✓' : '✗'} ${rotulo}: ${detalhe}`);
    if (!ok) falhas.push(rotulo + (detalhe ? ' — ' + detalhe : ''));
  };

  await pag.goto(URL);
  await pag.waitForSelector('#modulos button', { timeout: 15000 });
  await irPara(pag, 'Dados', 900);

  // ------------------------------------------------- adaptador de cabeçalho
  console.log('\nADAPTADOR — o cabeçalho que a planilha do cliente usa');
  await pag.uncheck('#d-simular');
  await enviarCsv(pag, 'do-cliente.csv', csvDoCliente('Vlr Total'));
  await pag.click('#d-importar');
  await pag.waitForTimeout(1500);
  let saida = await pag.textContent('#d-saida-imp');
  conferir('sem o cabeçalho cadastrado, falta coluna obrigatória',
    /obrigat[óo]ri/i.test(saida), (saida.match(/Faltam[^<]{0,60}/) || ['(não apareceu)'])[0].trim());

  await pag.selectOption('#mp-aba', 'Financeiro');
  await pag.selectOption('#mp-coluna', 'Valor');
  await pag.fill('#mp-apelido', 'Vlr Total');
  await pag.click('#mp-criar');
  await pag.waitForTimeout(1200);
  const cadastrado = await pag.evaluate(() =>
    (E.mapeamentos || []).filter((m) => m.cliente === E.clienteSel).map((m) => m.coluna + '←' + m.apelido));
  conferir('o cabeçalho fica cadastrado no cliente', cadastrado.includes('Valor←Vlr Total'), cadastrado.join(', '));

  await pag.uncheck('#d-simular');
  await enviarCsv(pag, 'do-cliente.csv', csvDoCliente('Vlr Total'));
  await pag.click('#d-importar');
  await pag.waitForTimeout(1800);
  saida = await pag.textContent('#d-saida-imp');
  conferir('com o cabeçalho cadastrado, a mesma planilha entra',
    !/Faltam colunas obrigat/i.test(saida) && /1 registro|criado/i.test(saida), saida.replace(/\s+/g, ' ').slice(0, 90));

  // ------------------------------------------------------------------ modo
  console.log('\nMODO — inicial sobre base povoada pede confirmação');
  await pag.selectOption('#d-modo', 'inicial');
  await pag.uncheck('#d-simular');
  await enviarCsv(pag, 'historico.csv', csvDoCliente('Valor'));
  await pag.click('#d-importar');
  await pag.waitForTimeout(1500);
  saida = await pag.textContent('#d-saida-imp');
  conferir('a carga inicial é recusada, com o número na frente',
    /marcada como INICIAL/i.test(saida), saida.replace(/\s+/g, ' ').slice(0, 110));
  conferir('a recusa oferece confirmar, em vez de virar beco',
    (await pag.$('#d-confirmar')) !== null);

  await pag.click('#d-confirmar');
  await pag.waitForTimeout(2000);

  // -------------------------------------------------------------- histórico
  console.log('\nHISTÓRICO — toda tentativa deixa rastro, a recusada inclusive');
  const registro = await pag.evaluate(() =>
    (E.cargas.get(empresaAtiva()) || []).map((c) => c.status + ':' + c.modo + ':' + (c.arquivo || '')));
  conferir('a recusa entrou no registro', registro.some((r) => /^recusada:inicial/.test(r)), registro.join(' | '));
  conferir('a carga confirmada entrou como concluída e inicial',
    registro.some((r) => /^concluida:inicial/.test(r)));
  conferir('a carga do adaptador entrou como incremental',
    registro.some((r) => /^concluida:incremental/.test(r)));

  // A prévia não pode encher o registro: ela não muda nada na base.
  const antes = registro.length;
  await pag.check('#d-simular');
  await enviarCsv(pag, 'previa.csv', csvDoCliente('Valor'));
  await pag.click('#d-importar');
  await pag.waitForTimeout(1500);
  const depois = await pag.evaluate(() => (E.cargas.get(empresaAtiva()) || []).length);
  conferir('a conferência não entra no registro: prévia não é carga', depois === antes, `${antes} → ${depois}`);

  const naTela = await pag.$$eval('.bloco', (bs) => {
    const b = bs.find((x) => /Histórico de cargas/.test(x.textContent));
    return b ? [...b.querySelectorAll('tbody tr')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()) : [];
  });
  conferir('o histórico aparece na tela, com situação e tipo',
    naTela.some((l) => /Recusada/.test(l)) && naTela.some((l) => /Concluída/.test(l) && /Inicial/.test(l)),
    naTela.length + ' linha(s)');

  console.log(`\n=== erros de console: ${erros.length ? erros.join(' | ') : 'nenhum'} ===`);
  if (erros.length) falhas.push('erros de console');
  console.log(falhas.length ? `\nFALHAS (${falhas.length}):\n- ` + falhas.join('\n- ') : '\nTudo certo.');
  await nav.close();
  process.exit(falhas.length ? 1 : 0);
})();
