// Sistemas de suporte na versão hospedada.
//
// Os dois sistemas caem no mesmo registro; o que separa as telas é o recorte,
// não a estrutura. O que este teste protege é justamente isso: filtrar por
// sistema e por setor recorta a MESMA lista, e os números acompanham.
const { chromium } = require('playwright');
const { irPara } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1000 } });
  const falhas = [], erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push('console: ' + m.text()); });
  const confere = (rotulo, obtido, esperado) => {
    const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
    console.log(`  ${ok ? '✓' : '✗'} ${rotulo}: ${JSON.stringify(obtido)}${ok ? '' : ' (esperado ' + JSON.stringify(esperado) + ')'}`);
    if (!ok) falhas.push(rotulo);
  };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 15000 });

  // Semeia chamados dos dois sistemas, com e sem setor.
  const semear = async () => {
    await irPara(pag, 'Chamados', 900);
    // O escopo é o CLIENTE: a tela mostra todas as unidades. Para conferir a
    // lista semeada, o filtro DESTA tela recorta a unidade em que ela entrou —
    // que é o uso normal do filtro local, e não um artifício do teste.
    const dono = await pag.evaluate(async () => {
      const dono = escopoEmpresas()[0];
      const comp = [...E.competencias][0];
      await Loja.gravarSlaMes(dono, comp, [
        { id: 'c1', fila: 'Infraestrutura', topico: 'Rede', total: 1, dentro: 1, ticketId: 111, numero: '111',
          assunto: 'VPN fora do ar', solicitante: 'Carlos', atendente: 'Ana', status: 'Fechado',
          sistema: 'OSTICK', setor: 'TI', criadoEm: '2026-08-01T09:00Z', horas: 4 },
        { id: 'c2', fila: 'Sistema', topico: 'ERP', total: 1, dentro: 0, ticketId: 222, numero: '222',
          assunto: 'Erro ao emitir nota', solicitante: 'Maria', atendente: 'João', status: 'Aberto',
          sistema: 'BITRIX24', setor: 'Financeiro', criadoEm: '2026-08-02T09:00Z', horas: null },
        { id: 'c3', fila: 'Sistema', topico: 'ERP', total: 1, dentro: 1, ticketId: 333, numero: '333',
          assunto: 'Sem setor informado', solicitante: 'Bruno', atendente: 'Ana', status: 'Fechado',
          sistema: 'BITRIX24', criadoEm: '2026-08-03T09:00Z', horas: 2 },
      ]);
      E.filtrosSla.sistemas = new Set();
      E.filtrosSla.setores = new Set();
      return dono;
    });
    await pag.evaluate(async (d) => {
      filtroDaTela('chamados').empresas = new Set([d]);
      await render();
    }, dono);
    await pag.waitForTimeout(700);
  };
  await semear();

  const linhas = () => pag.$$eval('#s-chamados tbody tr', (rs) =>
    rs.map((r) => [...r.cells].slice(0, 4).map((c) => c.textContent.trim())));

  console.log('\nMODELO ÚNICO — os dois sistemas na mesma tabela');
  const todas = await linhas();
  confere('os 3 chamados aparecem', todas.length, 3);
  confere('a coluna Sistema traz o nome de cada origem',
    todas.map((l) => l[1]).sort(), ['Sistema Bitrix24', 'Sistema Bitrix24', 'Sistema OStick']);
  confere('setor ausente aparece como "Não classificado"',
    todas.some((l) => l[3] === 'Não classificado'), true);

  const cab = await pag.$$eval('#s-chamados thead th', (ts) => ts.map((t) => t.textContent.trim()));
  confere('a tabela mostra sistema e setor', ['Sistema', 'Setor / área'].every((c) => cab.includes(c)), true);

  console.log('\nRECORTE — o filtro é o que separa as telas');
  const filtrar = async (campo, valores) => {
    await pag.evaluate(async ({ campo, valores }) => {
      E.filtrosSla[campo] = new Set(valores);
      await render();
    }, { campo, valores });
    await pag.waitForTimeout(700);
  };

  await filtrar('sistemas', ['OSTICK']);
  confere('só OStick', (await linhas()).map((l) => l[0]), ['#111']);
  await filtrar('sistemas', ['BITRIX24']);
  confere('só Bitrix24', (await linhas()).map((l) => l[0]).sort(), ['#222', '#333']);
  await filtrar('sistemas', []);

  await filtrar('setores', ['Financeiro']);
  confere('recorte por setor', (await linhas()).map((l) => l[0]), ['#222']);
  await filtrar('setores', ['Não classificado']);
  confere('recorte pelo setor não classificado', (await linhas()).map((l) => l[0]), ['#333']);
  await filtrar('setores', []);

  console.log('\nINDICADORES — os números acompanham o recorte');
  const kpis = async () => pag.$$eval('.kpi', (ks) =>
    ks.map((k) => k.querySelector('.r').textContent + '=' + k.querySelector('.n').textContent));
  await irPara(pag, 'Indicadores', 800);
  // Cada tela tem o SEU filtro: o recorte feito em Chamados não vale aqui —
  // é justamente essa a independência. Para comparar o mesmo conjunto, o
  // filtro desta tela é ajustado também.
  await pag.evaluate(async () => {
    filtroDaTela('sla').empresas = new Set(filtroDaTela('chamados').empresas);
    await render();
  });
  await pag.waitForTimeout(700);
  const todosKpis = await kpis();
  console.log('   ', todosKpis.join(' · '));
  confere('3 chamados no total, 2 dentro do SLA',
    [todosKpis[0].includes('3'), todosKpis[1].includes('66,7')], [true, true]);

  await filtrar('sistemas', ['BITRIX24']);
  const bitrixKpis = await kpis();
  console.log('   ', bitrixKpis.join(' · '));
  confere('com o recorte, o indicador cai para 2 chamados', bitrixKpis[0].includes('2'), true);

  console.log('\n=== falhas: ' + (falhas.length ? falhas.join('; ') : 'nenhuma') + ' ===');
  console.log('=== erros de console: ' + (erros.length ? '\n' + erros.join('\n') : 'nenhum') + ' ===');
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
