// A carga de dados na versão hospedada: modo, registro e adaptador.
//
// Três perguntas que a tela precisa responder: esta carga é o histórico ou o
// arquivo do mês? o que aconteceu nas cargas anteriores — inclusive nas que
// não entraram? e como aceitar o cabeçalho que a planilha DESTE cliente usa?
const { chromium } = require('playwright');
const { irPara, abrirBlocos } = require('./ajuda-testes.cjs');

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

  // ------------------------------------------------------------------ escopo
  //
  // O padrão da tela é o CLIENTE INTEIRO, e este cliente tem várias matrizes.
  // Um arquivo sem a coluna "Empresa" não tem, aí, uma linha errada: tem o
  // destino de todas indefinido — e a carga é recusada antes de gravar nada.
  console.log('\nESCOPO — cliente inteiro exige a coluna Empresa');
  await pag.uncheck('#d-simular');
  await enviarCsv(pag, 'sem-empresa.csv', csvDoCliente('Valor'));
  await pag.click('#d-importar');
  await pag.waitForTimeout(1500);
  let saida = await pag.textContent('#d-saida-imp');
  conferir('sem a coluna Empresa, a carga do cliente inteiro é recusada',
    /coluna "Empresa"/i.test(saida), saida.replace(/\s+/g, ' ').slice(0, 100));

  // Daqui para a frente, o escopo é UMA unidade: é assim que entra o arquivo
  // no formato antigo, que não traz a coluna.
  await pag.click('input[name="d-escopo"][value="empresas"]');
  await pag.waitForTimeout(800);
  // Trocar o escopo remonta a tela, e os blocos nascem fechados: reabrir é o
  // mesmo passo que `irPara` já dá ao chegar numa tela.
  await abrirBlocos(pag);
  const marcadasNoInicio = (await pag.$$('#d-esc-emp input:checked')).length;
  conferir('trocar para "Empresas" marca todas, em vez de deixar o escopo vazio',
    marcadasNoInicio > 1, String(marcadasNoInicio));

  // Desmarcar remonta a tela — o escopo é global —, então a caixa é buscada de
  // novo a cada volta em vez de guardada numa referência que já saiu do DOM.
  for (let i = marcadasNoInicio; i > 1; i--) {
    await pag.locator('#d-esc-emp input:checked').last().click();
    await pag.waitForTimeout(700);
    await abrirBlocos(pag);
  }
  const resumo = await pag.textContent('#d-escopo-resumo');
  conferir('o contador diz o que está marcado', /^1 empresa,/.test(resumo.trim()), resumo.trim());

  // ------------------------------------------------- adaptador de cabeçalho
  console.log('\nADAPTADOR — o cabeçalho que a planilha do cliente usa');
  await pag.uncheck('#d-simular');
  await enviarCsv(pag, 'do-cliente.csv', csvDoCliente('Vlr Total'));
  await pag.click('#d-importar');
  await pag.waitForTimeout(1500);
  saida = await pag.textContent('#d-saida-imp');
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
    empresasDoEscopoOp().flatMap((id) => E.cargas.get(id) || [])
      .map((c) => c.status + ':' + c.modo + ':' + (c.arquivo || '')));
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
  const depois = await pag.evaluate(() =>
    empresasDoEscopoOp().flatMap((id) => E.cargas.get(id) || []).length);
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
