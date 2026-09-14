// Indicadores Gerais: três blocos com filtros próprios, o switch de
// reconhecimento recalculando o bloco inteiro, e o termômetro contra a meta.
//
// A tela existe porque a leitura estratégica não cabia na de Integrações, que é
// operação. Cada conferência aqui é uma promessa que ela faz ao gestor.
const { chromium } = require('playwright');
const { irPara, usarEmpresas } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const falhas = [];
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  await irPara(pag, 'Indicadores Gerais', 1500);

  console.log('\n--- três blocos, dois indicadores cada ---');
  const estrutura = await pag.evaluate(() => ({
    blocos: [...document.querySelectorAll('#pagina > .bloco > header h2')].map((h) => h.textContent.trim()),
    kpis: document.querySelectorAll('.kpi').length,
    termometro: !!document.querySelector('#i-termometro svg'),
    serie: !!document.querySelector('#i-reducao svg'),
  }));
  ok('os três blocos estão na tela', JSON.stringify(estrutura.blocos) === JSON.stringify(['Financeiro', 'SLA', 'Projetos']),
    estrutura.blocos.join(' · '));
  ok('dois indicadores por bloco', estrutura.kpis === 6, `${estrutura.kpis}`);
  ok('a série do custo recorrente é desenhada', estrutura.serie);
  ok('e o termômetro do SLA também', estrutura.termometro);

  console.log('\n--- o termômetro marca a meta, e a cor não anda sozinha ---');
  const term = await pag.evaluate(() => {
    const svg = document.querySelector('#i-termometro svg');
    const textos = [...svg.querySelectorAll('text')].map((t) => t.textContent);
    return { rotulo: svg.getAttribute('aria-label'), textos, traco: svg.querySelectorAll('line').length };
  });
  ok('a meta vem rotulada sobre o traço', term.textos.some((t) => /meta 80%/.test(t)), term.textos.join(' · '));
  ok('o traço da meta existe', term.traco >= 1);
  ok('e o leitor de tela recebe o número', /\d+% contra a meta de 80%/.test(term.rotulo || ''), term.rotulo);

  console.log('\n--- os filtros são do bloco, e não do sistema ---');
  const antesGlobal = await pag.evaluate(() => [...E.competencias].join(','));
  await pag.fill('#i-financeiro-de', '01/2026');
  await pag.dispatchEvent('#i-financeiro-de', 'change');
  await pag.waitForTimeout(900);
  const depois = await pag.evaluate(() => ({
    global: [...E.competencias].join(','),
    doBloco: E.filtrosInd.financeiro.de,
    slaIntacto: E.filtrosInd.sla.de,
  }));
  ok('o recorte fica no bloco', depois.doBloco === '2026-01', depois.doBloco);
  ok('o filtro global do sistema não é tocado', depois.global === antesGlobal, `${antesGlobal} → ${depois.global}`);
  ok('e o bloco vizinho tampouco', depois.slaIntacto === '', `"${depois.slaIntacto}"`);

  // Memória de sessão: recarregar limpa. Um filtro de leitura que sobrevive ao
  // F5 faria o gestor voltar dias depois a um recorte que não escolheu.
  await pag.reload();
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  await irPara(pag, 'Indicadores Gerais', 1200);
  const aposRecarregar = await pag.evaluate(() => E.filtrosInd.financeiro.de);
  ok('recarregar devolve o bloco ao período livre', aposRecarregar === '', `"${aposRecarregar}"`);

  console.log('\n--- o switch de reconhecimento recalcula o bloco inteiro ---');
  const comTudo = await pag.evaluate(() => ({
    nota: document.querySelector('#pagina > .bloco > header .nota').textContent.trim(),
    serie: [...document.querySelectorAll('#i-reducao svg circle')].length,
    kpi: document.querySelectorAll('.kpi .n')[0].textContent.trim(),
  }));
  await pag.selectOption('#i-rec', 'rec');
  await pag.waitForTimeout(1200);
  const soReconhecidas = await pag.evaluate(() => ({
    nota: document.querySelector('#pagina > .bloco > header .nota').textContent.trim(),
    serie: [...document.querySelectorAll('#i-reducao svg circle')].length,
    kpi: document.querySelectorAll('.kpi .n')[0].textContent.trim(),
    aviso: document.querySelector('#pagina').textContent.includes('Exibindo apenas despesas reconhecidas'),
    vazio: !!document.querySelector('#i-reducao .vazio'),
  }));
  ok('o cabeçalho do bloco diz o que está sendo exibido',
    /apenas despesas reconhecidas/.test(soReconhecidas.nota), soReconhecidas.nota);
  ok('o gráfico avisa no rodapé', soReconhecidas.aviso);
  // A base de teste não tem nada reconhecido: a série tem de esvaziar, e é essa
  // a prova de que o gráfico recalculou junto com o indicador.
  ok('a série recalcula junto com o indicador',
    soReconhecidas.serie !== comTudo.serie || soReconhecidas.vazio,
    `${comTudo.serie} pontos → ${soReconhecidas.vazio ? 'vazio' : soReconhecidas.serie + ' pontos'}`);
  await pag.selectOption('#i-rec', 'tudo');
  await pag.waitForTimeout(900);

  console.log('\n--- por reconhecer se agrupa por centro de custo ---');
  const centros = await pag.evaluate(() => {
    const linhas = [...document.querySelectorAll('tr[data-centro]')];
    const total = document.querySelector('#pagina tfoot td:last-child');
    return {
      quantos: linhas.length,
      ordenado: linhas.map((l) => Number(l.querySelector('td:last-child').textContent.replace(/[^\d,]/g, '').replace(',', '.'))),
      total: total ? total.textContent.trim() : '',
      kpi: document.querySelectorAll('.kpi .n')[1].textContent.trim(),
    };
  });
  ok('há centro de custo na tabela', centros.quantos > 0, `${centros.quantos}`);
  ok('do maior valor para o menor',
    centros.ordenado.every((v, i) => i === 0 || centros.ordenado[i - 1] >= v), centros.ordenado.slice(0, 4).join(' ≥ '));
  ok('o total da tabela bate com o indicador', centros.total === centros.kpi, `${centros.total} vs ${centros.kpi}`);

  console.log('\n--- o detalhamento abre e reconhece em lote ---');
  const antesPendentes = await pag.evaluate(() => document.querySelectorAll('.kpi .n')[1].textContent.trim());
  await pag.evaluate(() => document.querySelectorAll('.kpi')[1].click());
  await pag.waitForTimeout(1000);
  const modal = await pag.evaluate(() => {
    const m = document.querySelector('.modal');
    return m ? {
      titulo: m.querySelector('h2, .tit') ? m.textContent.slice(0, 40) : '',
      linhas: m.querySelectorAll('tbody tr').length,
      destacadas: m.querySelectorAll('tr[data-sem-reconhecer]').length,
      botao: m.querySelector('[data-reconhecer]') ? m.querySelector('[data-reconhecer]').disabled : null,
    } : null;
  });
  ok('o detalhamento abre com os lançamentos', modal && modal.linhas > 0, `${modal && modal.linhas} linha(s)`);
  ok('todos aparecem destacados como por reconhecer', modal && modal.destacadas === modal.linhas,
    `${modal && modal.destacadas}/${modal && modal.linhas}`);
  ok('e o botão começa desabilitado, sem seleção', modal && modal.botao === true);

  await pag.evaluate(() => {
    const c = document.querySelector('.modal input[data-sel-lanc]:not([disabled])');
    c.checked = true; c.dispatchEvent(new Event('change'));
  });
  await pag.waitForTimeout(300);
  const habilitado = await pag.evaluate(() => {
    const b = document.querySelector('.modal [data-reconhecer]');
    return { desabilitado: b.disabled, rotulo: b.textContent.trim() };
  });
  ok('marcar um habilita a ação, dizendo quantos', !habilitado.desabilitado && /1 selecionado/.test(habilitado.rotulo),
    habilitado.rotulo);

  await pag.click('.modal [data-reconhecer]');
  await pag.waitForTimeout(1500);
  const depoisRec = await pag.evaluate(async () => {
    const trilha = await E.db.doc('auditoria/' + empresaAtiva()).get();
    return {
      kpi: document.querySelectorAll('.kpi .n')[1].textContent.trim(),
      auditado: (trilha.exists ? trilha.data().itens : []).some((a) => a.acao === 'reconhecer'),
      modalFechado: !document.querySelector('.modal'),
    };
  });
  ok('a tela fecha e o indicador cai', depoisRec.modalFechado && depoisRec.kpi !== antesPendentes,
    `${antesPendentes} → ${depoisRec.kpi}`);
  ok('e o reconhecimento deixa trilha', depoisRec.auditado);

  console.log('\n--- a despesa reconhecida perde o destaque na listagem ---');
  await irPara(pag, 'Lançamentos', 1200);
  const listagem = await pag.evaluate(() => {
    const linhas = [...document.querySelectorAll('#pagina tbody tr')];
    const reconhecida = linhas.find((l) => !l.hasAttribute('data-sem-reconhecer'));
    const pendente = linhas.find((l) => l.hasAttribute('data-sem-reconhecer'));
    const cor = (tr) => tr && getComputedStyle(tr.querySelector('td.n')).color;
    return { temReconhecida: !!reconhecida, corPendente: cor(pendente), corReconhecida: cor(reconhecida),
      pesoPendente: pendente ? getComputedStyle(pendente.querySelector('td.n')).fontWeight : '' };
  });
  ok('a linha reconhecida existe e não carrega a marca', listagem.temReconhecida);
  ok('a pendente sai em negrito', Number(listagem.pesoPendente) >= 700, listagem.pesoPendente);
  ok('e em laranja, diferente da reconhecida', listagem.corPendente !== listagem.corReconhecida,
    `${listagem.corPendente} vs ${listagem.corReconhecida}`);

  console.log('\n--- sem erro de console no caminho todo ---');
  ok('nenhum erro de página', erros.length === 0, erros.slice(0, 3).join(' | '));

  console.log(`\n${falhas.length ? '✗ ' + falhas.length + ' falha(s):\n  - ' + falhas.join('\n  - ') : '✓ tudo certo'}`);
  await nav.close();
  process.exit(falhas.length ? 1 : 0);
})();
