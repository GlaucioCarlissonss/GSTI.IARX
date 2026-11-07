// A projeção vista no NAVEGADOR, sobre uma base criada aqui mesmo.
//
// Ela lança o que precisa DENTRO da página, sobre a base que estiver montada,
// e por isso roda tanto sobre a base real do cliente quanto sobre a sintética
// de `semear-projecao.cjs` — que é a única forma de exercitá-la num contêiner
// onde `artifact/dados/` não veio.
//
// O que ela prova é o pedido: toda despesa que se repete todo mês é projetada
// em TODO mês, e um mês sem lançamento existe como projeção em vez de buraco.
const { chromium } = require('playwright');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  // Fornecedores PRÓPRIOS do roteiro. "TELECOM" e "CLARO" são nomes que a base
  // do cliente pode ter de verdade, e casar por eles faria o roteiro mexer em
  // contrato que não é dele.
  const FORN_ABERTO = 'TELECOM (roteiro)';
  const FORN_VIGENCIA = 'CLARO (roteiro)';

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  ok('a base sintética abre num cliente', await pag.evaluate(() => !!E.clienteSel));

  // A LINHA DE BASE, antes de mexer em nada.
  //
  // O roteiro mede a DIFERENÇA que ele mesmo causa, e não totais absolutos.
  // Ele cobrava "dois lançamentos" e "todo mês soma 1.400", números que só
  // valem na base sintética de `semear-projecao.cjs` — sobre a base do
  // cliente ele acusava o produto de ter 231 lançamentos, que é o que a base
  // tem. O cabeçalho sempre disse que ele roda sobre qualquer base; as
  // asserções é que não cumpriam isso.
  const antes = await pag.evaluate(() => {
    const f3 = calcularFarol3({ filiais: new Set(), somenteReconhecidas: false });
    const porMes = {};
    for (const p of f3.projetados) {
      porMes[p.comp] = { n: p.contratosProjetados, valor: p.fixaProjetada,
        lancados: p.lancadosNoMes || 0 };
    }
    return {
      quantos: Loja.todos(E.empresas[0].id).length,
      porMes,
      contratos: f3.contratosDoHorizonte.length,
      emAberto: f3.contratosEmAberto,
      // O total dos meses MENOS a soma da fila é o que já foi lançado dentro
      // do horizonte. É contra esse número que o lançamento adiantado de 1.000
      // tem de aparecer, e não contra zero.
      totalDosMeses: Math.round(f3.projetados.reduce((s, p) => s + p.fixaProjetada, 0)),
      somaDaLista: Math.round(f3.contratosDoHorizonte.reduce((s, c) => s + c.totalProjetado, 0)),
    };
  });

  // Dois contratos recorrentes, lançados UMA vez cada, no mês corrente.
  // Nenhum "repetir até": eles nascem em aberto, que é o estado que projeta.
  console.log('\nDOIS CONTRATOS, lançados uma vez cada no mês corrente');
  const criados = await pag.evaluate(async ([fornAberto, fornVigencia]) => {
    const emp = E.empresas[0].id;
    const comp = mesHoje();
    const tipo = (tiposDa(emp)[0] || {}).nome || 'Licenças de Softwares';
    // ACRESCENTA ao mês, e não substitui: apagar o que já existe mudaria a
    // própria linha de base contra a qual a diferença é medida.
    await Loja.gravarMes(emp, comp, [
      ...Loja.itens(emp, comp),
      { id: novoId(), grupo: novoId(), origem: 'manual', filial: null, tipo,
        natureza: 'fixa', classificacao: 'despesa', cenario: 'oficial',
        fornecedor: fornAberto, descricao: 'Link dedicado', valor: 1000,
        tipoConsumo: 'integral', beneficiadas: [], beneficiaTodas: false, recorrenciaAte: null },
      { id: novoId(), grupo: novoId(), origem: 'manual', filial: null, tipo,
        natureza: 'fixa', classificacao: 'despesa', cenario: 'oficial',
        fornecedor: fornVigencia, descricao: 'Telefonia móvel', valor: 400,
        tipoConsumo: 'integral', beneficiadas: [], beneficiaTodas: false, recorrenciaAte: null },
    ]);
    await Loja.catalogos();
    return Loja.todos(emp).length;
  }, [FORN_ABERTO, FORN_VIGENCIA]);
  ok('a base ganhou exatamente dois lançamentos',
    criados === antes.quantos + 2, `${antes.quantos} → ${criados}`);

  console.log('\nA PROJEÇÃO, contrato a contrato');
  const r = await pag.evaluate((base) => {
    const f3 = calcularFarol3({ filiais: new Set(), somenteReconhecidas: false });
    const delta = f3.projetados.map((p) => {
      const b = base[p.comp] || { n: 0, valor: 0 };
      return { comp: p.comp, rot: p.rot,
        dn: p.contratosProjetados - b.n,
        dvalor: Math.round(p.fixaProjetada - b.valor) };
    });
    return {
      projetados: f3.projetados.length,
      delta,
      todosGanharamDois: delta.every((d) => d.dn === 2),
      todosGanharam1400: delta.every((d) => d.dvalor === 1400),
      primeiro: delta[0],
      correnteRealizado: f3.realizados.some((p) => p.comp === mesHoje()),
    };
  }, antes.porMes);
  ok('doze meses projetados', r.projetados === 12, String(r.projetados));
  ok('TODO mês projetado ganhou os dois contratos', r.todosGanharamDois, JSON.stringify(r.primeiro));
  ok('TODO mês projetado ganhou 1.400 — nenhum ganhou zero', r.todosGanharam1400,
    JSON.stringify(r.delta.filter((d) => d.dvalor !== 1400).slice(0, 3)));
  ok('o mês corrente entra como realizado, e não some', r.correnteRealizado);

  console.log('\nA VIGÊNCIA ENCERRA');
  const v = await pag.evaluate(async ([base, fornVigencia]) => {
    const emp = E.empresas[0].id;
    const comp = mesHoje();
    const itens = Loja.itens(emp, comp).map((l) =>
      (l.fornecedor === fornVigencia ? { ...l, recorrenciaAte: mesSoma(comp, 3) } : l));
    await Loja.gravarMes(emp, comp, itens);
    const f3 = calcularFarol3({ filiais: new Set(), somenteReconhecidas: false });
    const delta = (comp2) => {
      const p = f3.projetados.find((x) => x.comp === comp2);
      const b = base[comp2] || { n: 0, valor: 0 };
      return p ? { dn: p.contratosProjetados - b.n, dvalor: Math.round(p.fixaProjetada - b.valor) }
        : null;
    };
    return { dentro: delta(mesSoma(comp, 3)), fora: delta(mesSoma(comp, 4)) };
  }, [antes.porMes, FORN_VIGENCIA]);
  ok('no mês da vigência os dois ainda valem',
    v.dentro && v.dentro.dn === 2 && v.dentro.dvalor === 1400, JSON.stringify(v.dentro));
  ok('no mês seguinte sobra só o contrato em aberto',
    v.fora && v.fora.dn === 1, JSON.stringify(v.fora));
  ok('e o valor cai para 1.000, não para zero',
    v.fora && v.fora.dvalor === 1000, JSON.stringify(v.fora));

  console.log('\nLINHA REAL VENCE A PROJEÇÃO');
  const d = await pag.evaluate(async ([base, fornAberto]) => {
    const emp = E.empresas[0].id;
    const prox = mesSoma(mesHoje(), 1);
    const modelo = Loja.itens(emp, mesHoje()).find((l) => l.fornecedor === fornAberto);
    // O gestor lança adiantado o mês seguinte: ele não pode ser contado duas
    // vezes por causa disso. ACRESCENTA ao que o mês já tiver.
    await Loja.gravarMes(emp, prox, [...Loja.itens(emp, prox),
      { ...modelo, id: novoId(), competencia: undefined }]);
    const f3 = calcularFarol3({ filiais: new Set(), somenteReconhecidas: false });
    const p = f3.pontos.find((x) => x.comp === prox);
    const b = base[prox] || { n: 0, valor: 0, lancados: 0 };
    return { projetado: p.projetado,
      dvalor: Math.round(p.fixaProjetada - b.valor),
      dProjetados: p.contratosProjetados - b.n,
      dLancados: (p.lancadosNoMes || 0) - b.lancados };
  }, [antes.porMes, FORN_ABERTO]);
  // Um mês FUTURO segue sendo projetado mesmo tendo linha: ele não aconteceu,
  // e marcá-lo como realizado afirmaria que sim. O que muda é o VALOR dele.
  ok('o mês futuro continua marcado como projeção', d.projetado === true, JSON.stringify(d));
  ok('o lançamento adiantado não vira projeção também', d.dProjetados === 1, String(d.dProjetados));
  ok('ele aparece como linha real do mês', d.dLancados === 1, String(d.dLancados));
  ok('e o mês soma 1.400 — o lançado mais o projetado, cada um UMA vez',
    d.dvalor === 1400, String(d.dvalor));

  // A soma tem de ter dono. Esta parte mede a lista que abre a projeção por
  // contrato — a que torna defensável projetar um contrato sem vigência.
  console.log('\nA FILA DE TRABALHO, CONTRATO A CONTRATO');
  const fila = await pag.evaluate((fornVigencia) => {
    const f3 = calcularFarol3({ filiais: new Set(), somenteReconhecidas: false });
    const q = f3.contratosDoHorizonte;
    return {
      n: q.length,
      emAberto: f3.contratosEmAberto,
      // A soma da lista tem de bater com a das parcelas projetadas mês a mês:
      // são a mesma conta vista por dono e por competência, e divergir faria a
      // auditoria não auditar nada. Note que ela NÃO é o total dos meses —
      // esse inclui a linha real lançada adiantado, que não é projeção.
      somaDaLista: Math.round(q.reduce((s, c) => s + c.totalProjetado, 0)),
      somaDosMeses: Math.round(f3.projetados.reduce(
        (s, p) => s + p.contratos.reduce((a, c) => a + c.valor, 0), 0)),
      // E o total dos meses tem de ser a projeção MAIS o que já foi lançado.
      totalDosMeses: Math.round(f3.projetados.reduce((s, p) => s + p.fixaProjetada, 0)),
      fornecedores: q.map((c) => c.fornecedor),
      primeiro: q[0] && { f: q[0].fornecedor, meses: q[0].mesesProjetados, aberto: q[0].emAberto },
      // O contrato com vigência de 3 meses é o do roteiro, e não um do cliente
      // que por acaso se chame igual.
      claro: q.find((c) => c.fornecedor === fornVigencia),
    };
  }, FORN_VIGENCIA);
  ok('a lista ganhou os dois contratos, uma linha cada',
    fila.n === antes.contratos + 2, `${antes.contratos} → ${fila.n}`);
  ok('ela soma exatamente as parcelas projetadas dos meses',
    fila.somaDaLista === fila.somaDosMeses, `${fila.somaDaLista} vs ${fila.somaDosMeses}`);
  // O lançamento adiantado de TELECOM (1.000) é a diferença, e ele não é
  // projeção: aparece no mês, não na fila de contratos a decidir.
  // O que o roteiro acrescentou ao "lançado dentro do horizonte" é exatamente
  // o 1.000 que ele lançou adiantado — nem mais, nem menos.
  const lancadoAntes = antes.totalDosMeses - antes.somaDaLista;
  const lancadoAgora = fila.totalDosMeses - fila.somaDaLista;
  ok('e o total dos meses é a projeção mais o lançado adiantado',
    lancadoAgora === lancadoAntes + 1000,
    `${lancadoAntes} → ${lancadoAgora}`);
  ok('o contrato sem vigência é contado como em aberto',
    fila.emAberto === antes.emAberto + 1, `${antes.emAberto} → ${fila.emAberto}`);
  ok('o contrato com vigência para no mês dela, e a lista mostra isso',
    fila.claro && fila.claro.mesesProjetados === 3 && fila.claro.emAberto === false,
    JSON.stringify(fila.claro && { m: fila.claro.mesesProjetados, a: fila.claro.emAberto }));

  console.log('\n=== erros de console: ' + (erros.length ? erros.join(' | ') : 'nenhum') + ' ===');
  await nav.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S): ` + falhas.join(' · ') : '\nTudo certo.');
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
