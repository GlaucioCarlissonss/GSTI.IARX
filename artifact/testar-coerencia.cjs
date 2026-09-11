// Os números de uma tela têm de fechar entre si. Foi disso que o gestor
// reclamou, então vira verificação: para cada empresa e cada recorte de base,
// o KPI, os rankings, a conferência e o rodapé da tabela precisam somar igual.
const { chromium } = require('playwright');

const centavos = (txt) => {
  const m = /-?[\d.]+,\d{2}/.exec(String(txt || ''));
  return m ? Math.round(Number(m[0].replace(/\./g, '').replace(',', '.')) * 100) : null;
};

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1280, height: 1200 } });
  const falhas = [];
  pag.on('pageerror', (e) => falhas.push('pageerror: ' + e.message));

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#abas button', { timeout: 15000 });
  const ir = async (r) => { await pag.click(`#abas button:text-is("${r}")`); await pag.waitForTimeout(420); };
  const confere = (rotulo, a, b) => {
    const ok = a === b;
    if (!ok) falhas.push(`${rotulo}: ${a} ≠ ${b}`);
    return ok ? '✓' : `✗ (${a} ≠ ${b})`;
  };

  const empresas = await pag.$$eval('#f-empresa option', (os) => os.map((o) => ({ id: o.value, nome: o.textContent })));
  const bases = await pag.$$eval('#f-base option', (os) => os.map((o) => ({ v: o.value, nome: o.textContent })));

  for (const emp of empresas) {
    await pag.selectOption('#f-empresa', emp.id);
    await pag.waitForTimeout(600);
    console.log(`\n== ${emp.nome} ==`);

    for (const base of bases) {
      await pag.selectOption('#f-base', base.v);
      await ir('Painel');

      const kpis = await pag.$$eval('.kpi', (ks) => ks.map((k) => k.querySelector('.n').textContent));
      const total = centavos(kpis[0]), despesa = centavos(kpis[1]), invest = centavos(kpis[2]);
      const somaRanking = (sel) => pag.$$eval(sel + ' .it .nm', (ns) => ns.length)
        .then(() => pag.$$eval(sel + ' .it', (its) => its.map((i) => i.textContent)))
        .then((ts) => ts.reduce((s, t) => {
          const m = /-?[\d.]+,\d{2}/.exec(t);
          return s + (m ? Math.round(Number(m[0].replace(/\./g, '').replace(',', '.')) * 100) : 0);
        }, 0));

      const rTipo = await somaRanking('#r1'), rNat = await somaRanking('#r2'), rFil = await somaRanking('#r3');
      const linha = [
        `  ${base.nome.padEnd(24)} total ${String(total).padStart(10)}`,
        `desp+inv ${confere(`${emp.nome}/${base.nome} despesa+investimento`, despesa + invest, total)}`,
        `tipo ${confere(`${emp.nome}/${base.nome} ranking por tipo`, rTipo, total)}`,
        `natureza ${confere(`${emp.nome}/${base.nome} ranking por natureza`, rNat, total)}`,
        `filial ${confere(`${emp.nome}/${base.nome} ranking por filial`, rFil, total)}`,
      ];
      console.log(linha.join('  '));
    }

    // Conferência: o total tem de ser a soma das origens e a soma dos meses.
    // Cada bloco é localizado pelo próprio título, senão o seletor varre as
    // tabelas vizinhas e soma o que não deve.
    await pag.selectOption('#f-base', '0');
    await ir('Conferência');
    const c = await pag.evaluate(() => {
      const bloco = (titulo) => [...document.querySelectorAll('.bloco')]
        .find((b) => b.querySelector('h2')?.textContent.includes(titulo));
      const col = (tr, i) => tr.cells[i]?.textContent ?? '';
      const bOrigem = bloco('Composição por origem');
      const bMes = bloco('Mês a mês');
      const totOrigem = bOrigem?.querySelector('tr.tot');
      return {
        // o primeiro td tem colspan=2, então o valor cai em cells[2], não em cells[3]
        totalOrigem: totOrigem ? col(totOrigem, 2) : '',
        origens: [...(bOrigem?.querySelectorAll('tbody tr:not(.tot)') ?? [])].map((r) => col(r, 3)),
        totalMes: (() => { const t = bMes?.querySelector('tr.tot'); return t ? col(t, t.cells.length - 1) : ''; })(),
        meses: [...(bMes?.querySelectorAll('tbody tr:not(.tot)') ?? [])].map((r) => col(r, r.cells.length - 1)),
      };
    });
    const totalConf = centavos(c.totalOrigem);
    const somaOrigens = c.origens.reduce((s, t) => s + (centavos(t) ?? 0), 0);
    const somaMeses = c.meses.reduce((s, t) => s + (centavos(t) ?? 0), 0);
    const totalMes = centavos(c.totalMes);
    console.log(`  Conferência              total ${String(totalConf).padStart(10)}  ` +
      `origens ${confere(`${emp.nome} conferência por origem`, somaOrigens, totalConf)}  ` +
      `mês a mês ${confere(`${emp.nome} conferência mês a mês`, somaMeses, totalMes)}  ` +
      `os dois blocos ${confere(`${emp.nome} origem × mês a mês`, totalMes, totalConf)}`);

    // Lançamentos: o rodapé tem de somar as linhas exibidas.
    await ir('Lançamentos');
    const l = await pag.evaluate(() => ({
      rodape: document.querySelector('tfoot td.n')?.textContent ?? '',
      linhas: [...document.querySelectorAll('tbody tr')].map((r) => r.cells[r.cells.length - 2].textContent),
    }));
    const somaLinhas = l.linhas.reduce((s, t) => s + (centavos(t) ?? 0), 0);
    console.log(`  Lançamentos              rodapé ${String(centavos(l.rodape)).padStart(9)}  ` +
      `linhas ${confere(`${emp.nome} rodapé de lançamentos`, somaLinhas, centavos(l.rodape))}`);
  }

  console.log('\n=== incoerências: ' + (falhas.length ? '\n' + falhas.join('\n') : 'nenhuma') + ' ===');
  await nav.close();
  process.exit(falhas.length ? 1 : 0);
})();
