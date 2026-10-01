// A folha de TI sai da base do artifact, uma vez só e nunca em somente-leitura.
const { chromium } = require('playwright');
(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const falhas = [];
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  const contar = (pag) => pag.evaluate(() => {
    let n = 0, cent = 0;
    for (const [, v] of E.lanc) for (const it of (v.itens || []))
      if (it.origem === 'folha_ti' && it.tipo === 'Pessoas') { n++; cent += Math.round((it.valor || 0) * 100); }
    return { n, total: cent / 100 };
  });

  // ---- 1a abertura: a purga roda
  let pag = await nav.newPage({ viewport: { width: 1400, height: 900 } });
  const erros = [];
  pag.on('pageerror', (e) => erros.push(e.message));
  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  await pag.waitForTimeout(1500);
  const depois = await contar(pag);
  ok('depois de abrir, nao sobra folha_ti+Pessoas', depois.n === 0, JSON.stringify(depois));
  const marca = await pag.evaluate(async () => (await E.db.doc('sistema/purga-folha-ti').get()).data());
  ok('a marca guarda o que foi removido', marca && marca.removidos === 57,
    JSON.stringify(marca));
  ok('o valor removido confere', marca && marca.centavos === 27392960, String(marca && marca.centavos));
  const trilha = await pag.evaluate(async () => {
    const s = await E.db.doc('auditoria/cliente__' + E.clienteSel).get();
    return (s.exists ? (s.data().itens || []) : []).filter((a) => a.acao === 'excluir_definitivo').length;
  });
  ok('a exclusao deixa trilha', trilha >= 1, String(trilha));
  ok('sem erro de pagina', erros.length === 0, erros.join(' | '));
  await pag.close();

  // ---- somente leitura: nada é tocado
  const pag2 = await nav.newPage({ viewport: { width: 1400, height: 900 } });
  await pag2.goto('file://' + __dirname + '/teste-local.html?somenteLeitura=1');
  await pag2.waitForSelector('#modulos button, #pagina', { timeout: 20000 });
  await pag2.waitForTimeout(1200);
  const soLeitura = await pag2.evaluate(async () => {
    const s = await E.db.doc('sistema/purga-folha-ti').get();
    return { temMarca: s.exists, somenteLeitura: E.somenteLeitura };
  });
  ok('em somente-leitura a purga nao escreve', soLeitura.somenteLeitura && !soLeitura.temMarca,
    JSON.stringify(soLeitura));

  console.log(`\n=== falhas: ${falhas.length ? falhas.join(' | ') : 'nenhuma'} ===`);
  await nav.close();
  process.exit(falhas.length ? 1 : 0);
})();
