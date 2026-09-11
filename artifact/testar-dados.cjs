// Exercita a aba Dados num navegador: exportar xlsx → reimportar → conferir
// que nada duplica, e que uma planilha com lixo entra no relatório sem
// derrubar as linhas boas.
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage();
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push('console: ' + m.text()); });

  // O sandbox não deixa a página baixar: intercepta downloads.save e guarda os bytes.
  await pag.addInitScript(() => {
    window.__salvos = [];
    const espera = setInterval(() => {
      if (!window.claude) return;
      clearInterval(espera);
      const usar = window.claude.use;
      window.claude.use = async (n) => n === 'downloads'
        ? { save: async ({ filename, data }) => { window.__salvos.push({ filename, data }); return { status:'saved' }; } }
        : usar(n);
    }, 5);
  });

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#abas button', { timeout: 10000 });
  const ir = async (r) => { await pag.click(`#abas button:text-is("${r}")`); await pag.waitForTimeout(400); };

  const totalDe = async () => { await ir('Conferência'); return pag.$eval('.kpi:nth-child(3) .n', (n) => n.textContent); };
  const contar = () => pag.evaluate(() => Loja.todos(E.empresa).length);

  console.log('== ALIANÇA ==');
  console.log('lançamentos antes:', await contar(), '| total:', await totalDe());

  await ir('Dados');
  await pag.selectOption('#d-modulo', 'completo');
  await pag.selectOption('#d-formato', 'xlsx');
  await pag.click('#d-exportar');
  await pag.waitForSelector('#d-saida-exp:not([hidden])', { timeout: 15000 });
  console.log('\nexportação:', (await pag.$eval('#d-saida-exp', (e) => e.textContent)).trim().replace(/\s+/g,' '));

  const arq = await pag.evaluate(() => {
    const s = window.__salvos[0];
    return { nome: s.filename, bytes: Array.from(s.data instanceof Uint8Array ? s.data : new TextEncoder().encode(s.data)) };
  });
  fs.writeFileSync('/tmp/claude-0/exportado.xlsx', Buffer.from(arq.bytes));
  console.log('  salvo:', arq.nome, arq.bytes.length, 'bytes');

  const reimportar = async (caminho, simular) => {
    await pag.setInputFiles('#d-arquivo', caminho);
    await pag.evaluate((s) => { document.querySelector('#d-simular').checked = s; }, simular);
    await pag.click('#d-importar');
    await pag.waitForSelector('#d-saida-imp .msg', { timeout: 30000 });
    await pag.waitForTimeout(300);
    return {
      resumo: (await pag.$eval('#d-saida-imp .msg', (e) => e.textContent)).trim().replace(/\s+/g,' '),
      tabela: await pag.$$eval('#d-saida-imp table tbody tr', (rs) =>
        rs.map((r) => [...r.cells].map((c) => c.textContent.trim()).join(' | '))),
    };
  };

  console.log('\n-- reimportando a própria exportação (simulação) --');
  let r = await reimportar('/tmp/claude-0/exportado.xlsx', true);
  console.log(' ', r.resumo);
  r.tabela.forEach((l) => console.log('    ' + l));

  console.log('\n-- reimportando de verdade --');
  r = await reimportar('/tmp/claude-0/exportado.xlsx', false);
  console.log(' ', r.resumo);
  console.log('  lançamentos depois:', await contar(), '| total:', await totalDe());

  const csv = '﻿' + [
    'Filial;Centro de Custo;Mês;Valor;Natureza;Classificação;Origem;Descrição',
    'ALIANÇA;Link de Internet;09/2026;R$ 1.234,56;Fixa;Despesa;Planilhas do cliente;linha boa 1',
    'ALIANÇA;Link de Internet;13/2026;100,00;Fixa;Despesa;;mês inexistente',
    'ALIANÇA;Link de Internet;09/2026;abc;Fixa;Despesa;;valor ilegível',
    'ALIANÇA;Link de Internet;09/2026;50,00;Semanal;Despesa;;natureza desconhecida',
    'ALIANÇA;Link de Internet;09/2026;50,00;Fixa;Ativo;;classificação desconhecida',
    ';Serviço Novo em Folha;09/2026;(2.500,00);Pontual única;Investimento;;valor negativo entre parênteses',
    'ALIANÇA;Link de Internet;09/2026;1.234,56;Fixa;Despesa;Planilhas do cliente;linha boa 1',
  ].join('\r\n') + '\r\n';
  fs.writeFileSync('/tmp/claude-0/sujo.csv', csv, 'utf8');

  console.log('\n-- csv com linhas inválidas (simulação) --');
  await ir('Dados');
  r = await reimportar('/tmp/claude-0/sujo.csv', true);
  console.log(' ', r.resumo);
  const invalidas = await pag.$$eval('#d-saida-imp section table tbody tr', (rs) =>
    rs.map((x) => [...x.cells].map((c) => c.textContent.trim()).join(' | ')));
  invalidas.forEach((l) => console.log('    ' + l));

  console.log('\n-- gravando as boas --');
  r = await reimportar('/tmp/claude-0/sujo.csv', false);
  console.log(' ', r.resumo);
  console.log('  lançamentos depois:', await contar());

  console.log('\n-- reimportando o mesmo csv sujo outra vez (idempotência) --');
  await ir('Dados');
  r = await reimportar('/tmp/claude-0/sujo.csv', false);
  console.log(' ', r.resumo);
  console.log('  lançamentos depois:', await contar());

  await ir('Conferência');
  const comp = await pag.$$eval('.bloco table tbody tr', (rs) => rs.slice(0,4).map((x) =>
    [...x.cells].map((c) => c.textContent.trim().slice(0,30)).join(' | ')));
  console.log('\n-- conferência depois --');
  comp.forEach((l) => console.log('    ' + l));

  console.log('\n=== erros: ' + (erros.length ? '\n' + erros.join('\n') : 'nenhum') + ' ===');
  await nav.close();
  process.exit(erros.length ? 1 : 0);
})();
