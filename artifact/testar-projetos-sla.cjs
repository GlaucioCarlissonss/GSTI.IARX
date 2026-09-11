// Projetos e SLA — os dois módulos ainda não exercitados pelos outros testes.
// O atraso e os percentuais são derivados, então o teste confere a derivação,
// não só se a tela monta.
const { chromium } = require('playwright');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1280, height: 1000 } });
  const falhas = [], erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push('console: ' + m.text()); });

  await pag.addInitScript(() => {
    window.__salvos = [];
    const espera = setInterval(() => {
      if (!window.claude) return;
      clearInterval(espera);
      const usar = window.claude.use;
      window.claude.use = async (n) => n === 'downloads'
        ? { save: async ({ filename, data }) => { window.__salvos.push({ filename, data }); return { status: 'saved' }; } }
        : usar(n);
    }, 5);
  });
  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#abas button', { timeout: 15000 });
  const ir = async (r) => { await pag.click(`#abas button:text-is("${r}")`); await pag.waitForTimeout(450); };
  const confere = (nome, obtido, esperado) => {
    const ok = String(obtido) === String(esperado);
    console.log(`  ${ok ? '✓' : '✗'} ${nome}: ${obtido}${ok ? '' : ' (esperado ' + esperado + ')'}`);
    if (!ok) falhas.push(nome);
  };
  const preencher = async (campos) => {
    for (const [nome, valor] of Object.entries(campos)) {
      const sel = `.modal [name="${nome}"]`;
      const tag = await pag.$eval(sel, (e) => e.tagName).catch(() => null);
      if (!tag) { falhas.push('campo ausente: ' + nome); continue; }
      if (tag === 'SELECT') await pag.selectOption(sel, valor);
      else { await pag.fill(sel, ''); await pag.fill(sel, valor); }
      await pag.waitForTimeout(70);
    }
  };
  const salvar = async () => {
    await pag.click('.modal .acoes .bt.pri');
    await pag.waitForTimeout(700);
    const e = await pag.$eval('.modal [data-erro]', (x) => x.hidden ? '' : x.textContent).catch(() => '');
    if (e) { console.log('    erro do formulário: ' + e); falhas.push('form: ' + e); await pag.keyboard.press('Escape'); }
  };

  await pag.selectOption('#f-empresa', 'moove');
  await pag.waitForTimeout(600);

  // ---------------------------------------------------------------- Projetos
  console.log('PROJETOS');
  await ir('Projetos');
  const antes = await pag.evaluate(() => (E.projetos.get(E.empresa) || []).length);

  await pag.click('#pagina button:text-matches("Novo projeto|Adicionar|Novo", "i")');
  await pag.waitForSelector('.modal', { timeout: 6000 });
  await preencher({ nome: 'Projeto atrasado', inicio: '01/2026', fimPlanejado: '03/2026', status: 'em_andamento' });
  await salvar();

  await pag.click('#pagina button:text-matches("Novo projeto|Adicionar|Novo", "i")');
  await pag.waitForSelector('.modal', { timeout: 6000 });
  await preencher({ nome: 'Projeto no prazo', inicio: '01/2027', fimPlanejado: '06/2027', status: 'planejado' });
  await salvar();

  await pag.click('#pagina button:text-matches("Novo projeto|Adicionar|Novo", "i")');
  await pag.waitForSelector('.modal', { timeout: 6000 });
  await preencher({ nome: 'Projeto concluído tarde', inicio: '01/2026', fimPlanejado: '03/2026',
    fimReal: '06/2026', status: 'concluido' });
  await salvar();

  confere('projetos criados', await pag.evaluate(() => (E.projetos.get(E.empresa) || []).length), antes + 3);

  // o atraso é derivado, nunca digitado
  const atrasos = await pag.evaluate(() => {
    const ps = E.projetos.get(E.empresa) || [];
    const de = (n) => { const p = ps.find((x) => x.nome === n); return p ? atrasoDe(p.fimPlanejado, p.fimReal, p.status) : null; };
    return { atrasado: de('Projeto atrasado'), noPrazo: de('Projeto no prazo'), tarde: de('Projeto concluído tarde') };
  });
  console.log('    atrasoDe →', JSON.stringify(atrasos));
  confere('projeto vencido sem fim real está atrasado', !!(atrasos.atrasado && atrasos.atrasado.meses > 0), true);
  confere('projeto futuro não está atrasado', !!(atrasos.noPrazo && atrasos.noPrazo.meses > 0), false);
  confere('concluído 3 meses tarde → desvio 3', atrasos.tarde && atrasos.tarde.desvio, 3);

  // tarefa e envolvido dentro do projeto
  const abriu = await pag.$('#pagina [data-proj], #pagina tbody tr');
  if (abriu) {
    await pag.click('#pagina tbody tr:has-text("Projeto atrasado")').catch(() => {});
    await pag.waitForTimeout(600);
  }
  const temDetalhe = await pag.evaluate(() => /Tarefas|Envolvidos/.test(document.querySelector('#pagina').textContent));
  confere('detalhe do projeto abre com tarefas e envolvidos', temDetalhe, true);

  // --------------------------------------------------------------------- SLA
  console.log('\nSLA');
  await ir('SLA');
  const slaAntes = await pag.evaluate(async () => (await Loja.slaDa(E.empresa)).length);

  const registrar = async (campos) => {
    await pag.click('#pagina button:text-matches("Registrar|Novo|Adicionar", "i")');
    await pag.waitForSelector('.modal', { timeout: 6000 });
    await preencher(campos);
    await salvar();
  };
  await registrar({ comp: '08/2026', fila: 'Infraestrutura', topico: 'Rede', total: '100', dentro: '90' });
  await registrar({ comp: '08/2026', fila: 'Sistema', topico: 'ERP', total: '50', dentro: '20' });

  const sla = await pag.evaluate(async () => {
    E.sla.delete(E.empresa);
    const its = await Loja.slaDa(E.empresa);
    return its.map((s) => ({ comp: s.competencia, fila: s.fila, total: s.total, dentro: s.dentro,
      guardaFora: Object.prototype.hasOwnProperty.call(s, 'fora') }));
  });
  console.log('    registros:', JSON.stringify(sla));
  confere('tickets registrados', sla.length, slaAntes + 2);
  confere('competência gravada', sla.every((s) => s.comp === '2026-08'), true);
  // `fora` é derivado de total − dentro; gravá-lo abriria espaço para discordar da conta
  confere('fora não é gravado', sla.some((s) => s.guardaFora), false);
  confere('fora derivado (100−90)', sla.find((s) => s.fila === 'Infraestrutura').total - sla.find((s) => s.fila === 'Infraestrutura').dentro, 10);
  confere('fora derivado (50−20)', sla.find((s) => s.fila === 'Sistema').total - sla.find((s) => s.fila === 'Sistema').dentro, 30);

  await ir('SLA');
  const texto = await pag.$eval('#pagina', (e) => e.textContent.replace(/\s+/g, ' '));
  const pct = /(\d{1,3},\d)%/.exec(texto);
  console.log('    percentual exibido:', pct ? pct[1] + '%' : '(nenhum)');
  // 110 dentro de 150 = 73,3%
  confere('percentual dentro do SLA', pct && pct[1], '73,3');

  // recusa incoerente: dentro > total
  await pag.click('#pagina button:text-matches("Registrar|Novo|Adicionar", "i")');
  await pag.waitForSelector('.modal', { timeout: 6000 });
  await preencher({ comp: '08/2026', fila: 'Dados', total: '10', dentro: '30' });
  await pag.click('.modal .acoes .bt.pri');

  await pag.waitForTimeout(600);
  const recusa = await pag.$eval('.modal [data-erro]', (x) => x.hidden ? '' : x.textContent.trim()).catch(() => '');
  console.log('    dentro(30) > total(10) →', recusa || '(aceitou!)');
  confere('recusa dentro > total', !!recusa, true);
  await pag.keyboard.press('Escape');

  // ------------------------------------------------ ciclo de planilha do SLA
  console.log('\nSLA — exportar e reimportar');
  await ir('Dados');
  await pag.selectOption('#d-modulo', 'sla');
  await pag.selectOption('#d-formato', 'xlsx');
  await pag.click('#d-exportar');
  await pag.waitForSelector('#d-saida-exp:not([hidden])', { timeout: 15000 });
  console.log('   ', (await pag.$eval('#d-saida-exp', (e) => e.textContent)).trim().replace(/\s+/g, ' '));
  const arq = await pag.evaluate(() => {
    const s = window.__salvos[window.__salvos.length - 1];
    return Array.from(s.data instanceof Uint8Array ? s.data : new TextEncoder().encode(s.data));
  });
  require('fs').writeFileSync('/tmp/claude-0/sla.xlsx', Buffer.from(arq));

  await pag.setInputFiles('#d-arquivo', '/tmp/claude-0/sla.xlsx');
  await pag.evaluate(() => { document.querySelector('#d-simular').checked = false; });
  await pag.click('#d-importar');
  await pag.waitForSelector('#d-saida-imp .msg', { timeout: 20000 });
  await pag.waitForTimeout(500);
  console.log('   ', (await pag.$eval('#d-saida-imp .msg', (e) => e.textContent)).trim().replace(/\s+/g, ' '));
  const depois = await pag.evaluate(async () => { E.sla.delete(E.empresa); return (await Loja.slaDa(E.empresa)).length; });
  confere('reimportar SLA não duplica', depois, slaAntes + 2);

  console.log('\n=== falhas: ' + (falhas.length ? falhas.join('; ') : 'nenhuma') + ' ===');
  console.log('=== erros de console: ' + (erros.length ? '\n' + erros.join('\n') : 'nenhum') + ' ===');
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
