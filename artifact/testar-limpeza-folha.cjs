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
  // A MARCA é o que impede a varredura de rodar de novo a cada abertura. Que
  // ela exista é a regra; quanto ela removeu depende da base, e já foi zero —
  // a base publicada saiu limpa, e a migração que tirou 57 lançamentos
  // aconteceu uma vez, meses atrás. Exigir aqueles 57 era exigir que o
  // trabalho nunca tivesse sido feito.
  ok('a marca fica gravada, para a varredura não repetir', !!marca, JSON.stringify(marca));
  ok('e ela registra o que foi removido nesta abertura',
    marca && Number.isInteger(marca.removidos) && Number.isInteger(marca.centavos)
      && (marca.removidos > 0) === (marca.centavos > 0),
    JSON.stringify(marca));
  ok('sem erro de pagina', erros.length === 0, erros.join(' | '));

  // ---- o caminho da REMOÇÃO, sobre uma condição plantada aqui
  //
  // A base publicada já não tem folha de TI, então abrir a página não exercita
  // mais a remoção: ela só confirma que não há nada a remover. O que ainda
  // precisa de prova é o caminho completo — contar, apagar as duas condições
  // juntas, poupar o que só casa com uma, e deixar trilha. Então a condição é
  // PLANTADA, e os números conferidos são os plantados.
  //
  // Plantar aqui não toca `dados/`: as escritas do `window.claude` de teste
  // ficam em memória e morrem com a página.
  const removeu = await pag.evaluate(async () => {
    const emp = E.empresas[0].id;
    const comp = mesHoje();
    const base = Loja.itens(emp, comp);
    const falsos = [
      { id: 'folha-t1', grupo: 'g-folha-t1', origem: 'folha_ti', tipo: 'Pessoas', filial: null,
        valor: 1234.56, natureza: 'fixa', classificacao: 'despesa', cenario: 'oficial', descricao: 'plantado' },
      { id: 'folha-t2', grupo: 'g-folha-t2', origem: 'folha_ti', tipo: 'Pessoas', filial: null,
        valor: 2000, natureza: 'fixa', classificacao: 'despesa', cenario: 'oficial', descricao: 'plantado' },
      // Só UMA das duas condições: tem de sobreviver. Uma despesa de "Pessoas"
      // digitada à mão nunca pode ser alcançada por uma limpeza de origem.
      { id: 'folha-t3', grupo: 'g-folha-t3', origem: 'manual', tipo: 'Pessoas', filial: null,
        valor: 500, natureza: 'fixa', classificacao: 'despesa', cenario: 'oficial', descricao: 'plantado' },
      { id: 'folha-t4', grupo: 'g-folha-t4', origem: 'folha_ti', tipo: 'Licenças de Softwares', filial: null,
        valor: 700, natureza: 'fixa', classificacao: 'despesa', cenario: 'oficial', descricao: 'plantado' },
    ];
    await Loja.gravarMes(emp, comp, [...base, ...falsos]);
    await E.db.doc('sistema/purga-folha-ti').delete();
    await purgarFolhaTI();
    const nova = await E.db.doc('sistema/purga-folha-ti').get();
    const sobrou = Loja.itens(emp, comp).filter((it) => /^folha-t/.test(it.id)).map((it) => it.id);
    const aud = await E.db.doc('auditoria/cliente__' + E.clienteSel).get();
    return {
      marca: nova.exists ? nova.data() : null,
      sobrou,
      trilha: (aud.exists ? (aud.data().itens || []) : [])
        .filter((a) => a.acao === 'excluir_definitivo').length,
    };
  });
  ok('a varredura remove os dois lançamentos plantados',
    removeu.marca && removeu.marca.removidos === 2, JSON.stringify(removeu.marca));
  ok('e soma o valor exato dos dois (1.234,56 + 2.000,00)',
    removeu.marca && removeu.marca.centavos === 323456, String(removeu.marca && removeu.marca.centavos));
  ok('o que casa com uma condição só sobrevive',
    removeu.sobrou.length === 2 && removeu.sobrou.includes('folha-t3') && removeu.sobrou.includes('folha-t4'),
    removeu.sobrou.join(', ') || '(nada)');
  ok('a exclusao deixa trilha', removeu.trilha >= 1, String(removeu.trilha));
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
