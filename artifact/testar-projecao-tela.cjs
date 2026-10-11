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

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  ok('a base sintética abre num cliente', await pag.evaluate(() => !!E.clienteSel));

  // Dois contratos recorrentes, lançados UMA vez cada, no mês corrente.
  // Nenhum "repetir até": eles nascem em aberto, que é o estado que projeta.
  console.log('\nDOIS CONTRATOS, lançados uma vez cada no mês corrente');
  const criados = await pag.evaluate(async () => {
    const emp = E.empresas[0].id;
    const comp = mesHoje();
    const tipo = (tiposDa(emp)[0] || {}).nome || 'Licenças de Softwares';
    await Loja.gravarMes(emp, comp, [
      { id: novoId(), grupo: novoId(), origem: 'manual', filial: null, tipo,
        natureza: 'fixa', classificacao: 'despesa', cenario: 'oficial',
        fornecedor: 'TELECOM', descricao: 'Link dedicado', valor: 1000,
        tipoConsumo: 'integral', beneficiadas: [], beneficiaTodas: false, recorrenciaAte: null },
      { id: novoId(), grupo: novoId(), origem: 'manual', filial: null, tipo,
        natureza: 'fixa', classificacao: 'despesa', cenario: 'oficial',
        fornecedor: 'CLARO', descricao: 'Telefonia móvel', valor: 400,
        tipoConsumo: 'integral', beneficiadas: [], beneficiaTodas: false, recorrenciaAte: null },
    ]);
    await Loja.catalogos();
    return Loja.todos(emp).length;
  });
  ok('dois lançamentos gravados', criados === 2, String(criados));

  console.log('\nA PROJEÇÃO, contrato a contrato');
  const r = await pag.evaluate(() => {
    const f3 = calcularFarol3({ filiais: new Set(), somenteReconhecidas: false });
    return {
      projetados: f3.projetados.length,
      // Todo mês projetado tem de ter os DOIS contratos e somar 1.400.
      todosComDois: f3.projetados.every((p) => p.contratosProjetados === 2),
      todosCom1400: f3.projetados.every((p) => Math.round(p.fixaProjetada) === 1400),
      primeiro: f3.projetados[0] && { rot: f3.projetados[0].rot,
        valor: f3.projetados[0].fixaProjetada, n: f3.projetados[0].contratosProjetados },
      ultimo: f3.projetados[f3.projetados.length - 1]?.rot,
      correnteRealizado: f3.realizados.some((p) => p.comp === mesHoje()),
    };
  });
  ok('doze meses projetados', r.projetados === 12, String(r.projetados));
  ok('TODO mês projetado tem os dois contratos', r.todosComDois, JSON.stringify(r.primeiro));
  ok('TODO mês projetado soma 1.400 — nenhum vale zero', r.todosCom1400);
  ok('o mês corrente entra como realizado, e não some', r.correnteRealizado);

  console.log('\nA VIGÊNCIA ENCERRA');
  const v = await pag.evaluate(async () => {
    const emp = E.empresas[0].id;
    const comp = mesHoje();
    const itens = Loja.itens(emp, comp).map((l) =>
      (l.fornecedor === 'CLARO' ? { ...l, recorrenciaAte: mesSoma(comp, 3) } : l));
    await Loja.gravarMes(emp, comp, itens);
    const f3 = calcularFarol3({ filiais: new Set(), somenteReconhecidas: false });
    const ate = mesSoma(comp, 3);
    const dentro = f3.projetados.find((p) => p.comp === ate);
    const fora = f3.projetados.find((p) => p.comp === mesSoma(comp, 4));
    return { dentro: dentro && dentro.contratosProjetados, fora: fora && fora.contratosProjetados,
      valorFora: fora && fora.fixaProjetada };
  });
  ok('no mês da vigência os dois ainda valem', v.dentro === 2, String(v.dentro));
  ok('no mês seguinte sobra só o contrato em aberto', v.fora === 1, String(v.fora));
  ok('e o valor cai para 1.000, não para zero', Math.round(v.valorFora) === 1000, String(v.valorFora));

  console.log('\nLINHA REAL VENCE A PROJEÇÃO');
  const d = await pag.evaluate(async () => {
    const emp = E.empresas[0].id;
    const prox = mesSoma(mesHoje(), 1);
    const modelo = Loja.itens(emp, mesHoje()).find((l) => l.fornecedor === 'TELECOM');
    // O gestor lança adiantado o mês seguinte: ele não pode ser contado duas
    // vezes por causa disso.
    await Loja.gravarMes(emp, prox, [{ ...modelo, id: novoId(), competencia: undefined }]);
    const f3 = calcularFarol3({ filiais: new Set(), somenteReconhecidas: false });
    const p = f3.pontos.find((x) => x.comp === prox);
    return { projetado: p.projetado, valor: p.fixaProjetada,
      nProjetados: p.contratosProjetados, nLancados: p.lancadosNoMes };
  });
  // Um mês FUTURO segue sendo projetado mesmo tendo linha: ele não aconteceu,
  // e marcá-lo como realizado afirmaria que sim. O que muda é o VALOR dele.
  ok('o mês futuro continua marcado como projeção', d.projetado === true, JSON.stringify(d));
  ok('o lançamento adiantado não vira projeção também', d.nProjetados === 1, String(d.nProjetados));
  ok('ele aparece como linha real do mês', d.nLancados === 1, String(d.nLancados));
  ok('e o mês soma 1.400 — o lançado mais o projetado, cada um UMA vez',
    Math.round(d.valor) === 1400, String(d.valor));

  // A soma tem de ter dono. Esta parte mede a lista que abre a projeção por
  // contrato — a que torna defensável projetar um contrato sem vigência.
  console.log('\nA FILA DE TRABALHO, CONTRATO A CONTRATO');
  const fila = await pag.evaluate(() => {
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
      // TELECOM é o contrato em aberto; CLARO tem vigência de 3 meses.
      claro: q.find((c) => c.fornecedor === 'CLARO'),
    };
  });
  ok('a lista traz os dois contratos, uma linha cada', fila.n === 2, String(fila.n));
  ok('ela soma exatamente as parcelas projetadas dos meses',
    fila.somaDaLista === fila.somaDosMeses, `${fila.somaDaLista} vs ${fila.somaDosMeses}`);
  // O lançamento adiantado de TELECOM (1.000) é a diferença, e ele não é
  // projeção: aparece no mês, não na fila de contratos a decidir.
  ok('e o total dos meses é a projeção mais o lançado adiantado',
    fila.totalDosMeses === fila.somaDaLista + 1000,
    `${fila.totalDosMeses} vs ${fila.somaDaLista}+1000`);
  ok('o contrato sem vigência é contado como em aberto', fila.emAberto === 1, String(fila.emAberto));
  ok('o contrato com vigência para no mês dela, e a lista mostra isso',
    fila.claro && fila.claro.mesesProjetados === 3 && fila.claro.emAberto === false,
    JSON.stringify(fila.claro && { m: fila.claro.mesesProjetados, a: fila.claro.emAberto }));

  console.log('\n=== erros de console: ' + (erros.length ? erros.join(' | ') : 'nenhum') + ' ===');
  await nav.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S): ` + falhas.join(' · ') : '\nTudo certo.');
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
