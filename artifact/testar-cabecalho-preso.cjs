// O CABEÇALHO DA TABELA NÃO PODE SUBIR JUNTO COM AS LINHAS.
//
// As tabelas dos faróis rolam dentro do próprio cartão, com altura limitada.
// O cabeçalho ficava preso só dentro da tela flutuante, então no cartão ele
// saía de vista na primeira rolagem — e a tabela do Farol 3 tem dez colunas de
// número (total, variáveis, fixas, variação, vs. média e os quatro tetos).
// Sem os nomes à vista, para saber de que coluna é um valor era preciso voltar
// ao topo e descer contando, a cada linha.
//
// A suíte mede o que o usuário vê: rola a caixa até o fim e exige que o
// cabeçalho continue na MESMA altura de tela em que estava. Comparar `position`
// não bastaria — `sticky` sem uma caixa que role por dentro não gruda em nada.
//
//   node semear-volume.cjs && node montar-teste.cjs
//   CHROMIUM_BIN=/opt/pw-browsers/chromium node testar-cabecalho-preso.cjs
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

  const abrir = async (mod, aba) => {
    await pag.evaluate(async ([m, a]) => { E.mod = m; E.aba = a; await render(); }, [mod, aba]);
    await pag.evaluate(() => {
      document.querySelectorAll('#pagina .bloco[data-dobra] .bloco-dobra[aria-expanded="false"]')
        .forEach((b) => b.click());
    });
    await pag.waitForTimeout(800);
  };

  // Rola a caixa até o fim e devolve onde o cabeçalho estava e onde ficou.
  const medir = () => pag.evaluate(() => {
    const saida = [];
    for (const caixa of document.querySelectorAll('#pagina .rol-fixo')) {
      const tab = caixa.querySelector(':scope > table');
      const th = tab && tab.querySelector('thead th');
      if (!th) continue;
      const titulo = (caixa.closest('.bloco')?.querySelector('h2,h3')?.textContent || '(sem título)')
        .replace(/[+−]/g, '').trim().slice(0, 44);
      // Tem de estar NA TELA: a medição de quem está a sete mil pixels daqui
      // é aritmética, não é o que o usuário vê.
      caixa.scrollIntoView({ block: 'center' });
      const linhas = tab.querySelectorAll('tbody tr').length;
      const rolavel = caixa.scrollHeight - caixa.clientHeight;
      const antes = th.getBoundingClientRect().top;
      caixa.scrollTop = caixa.scrollHeight;          // até o fim, como o usuário faria
      const depois = th.getBoundingClientRect().top;
      const dentro = depois >= caixa.getBoundingClientRect().top - 1;
      caixa.scrollTop = 0;
      saida.push({ titulo, pivot: tab.classList.contains('pivot'), linhas, rolavel,
        antes: Math.round(antes), depois: Math.round(depois), dentro });
    }
    return saida;
  });

  for (const [mod, aba, rotulo] of [
    ['indicadores', 'indicadores_gerais', 'INDICADORES GERAIS'],
    ['financeiro', 'relatorio', 'RELATÓRIO (TABELA DINÂMICA)'],
  ]) {
    console.log('\n' + rotulo);
    await abrir(mod, aba);
    const caixas = await medir();
    if (!caixas.length) { ok('há tabela com rolagem própria nesta tela', false, 'nenhuma'); continue; }
    for (const c of caixas) {
      if (c.rolavel < 4) { console.log(`  · "${c.titulo}" cabe inteira (${c.linhas} linhas) — nada a prender`); continue; }
      ok(`"${c.titulo}" mantém o cabeçalho ao rolar${c.pivot ? ' (dinâmica)' : ''}`,
        Math.abs(c.depois - c.antes) <= 1 && c.dentro,
        `${c.linhas} linhas · topo ${c.antes}px → ${c.depois}px`);
    }
  }

  console.log('\nO FAROL 3 É O CASO DO RELATO');
  await abrir('indicadores', 'indicadores_gerais');
  const f3 = await pag.evaluate(() => {
    const bloco = [...document.querySelectorAll('#pagina .bloco')]
      .find((b) => /Farol 3/.test(b.querySelector('h2,h3')?.textContent || ''));
    if (!bloco) return { ausente: true };
    const caixa = bloco.querySelector('.rol-fixo');
    const th = caixa && caixa.querySelector(':scope > table thead th');
    if (!th) return { semTabela: true };
    // `elementFromPoint` só enxerga o que está dentro da janela: sem trazer o
    // cartão para a tela, a conferência de empilhamento mediria o nada.
    caixa.scrollIntoView({ block: 'center' });
    caixa.scrollTop = caixa.scrollHeight;
    const r = th.getBoundingClientRect();
    const c = caixa.getBoundingClientRect();
    // Em cima de tudo, e opaco: um cabeçalho preso e transparente deixa as
    // linhas passarem por baixo das letras, que é pior do que não prender.
    const est = getComputedStyle(th);
    const atras = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      naTela: r.top >= 0 && r.bottom <= innerHeight,
      colado: Math.abs(r.top - c.top) <= 1,
      opaco: est.backgroundColor !== 'rgba(0, 0, 0, 0)' && est.backgroundColor !== 'transparent',
      porCima: !!atras && (atras === th || th.contains(atras)),
      colunas: [...caixa.querySelectorAll(':scope > table thead th')].map((x) => x.textContent.trim()),
    };
  });
  if (f3.ausente || f3.semTabela) {
    ok('o cartão do Farol 3 tem tabela mês a mês', false, f3.ausente ? 'cartão ausente' : 'sem tabela');
  } else {
    ok('o cartão está visível na janela — a medição vale', f3.naTela);
    ok('o cabeçalho cola no topo da caixa', f3.colado);
    ok('e é opaco — a linha não passa por baixo das letras', f3.opaco);
    ok('e fica por cima do conteúdo rolado', f3.porCima);
    ok('com as colunas todas nomeadas', f3.colunas.length >= 5, f3.colunas.join(' · '));
  }

  console.log('\n=== erros de console: ' + (erros.length ? erros.join(' | ') : 'nenhum') + ' ===');
  await nav.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S): ` + falhas.join(' · ') : '\nTudo certo.');
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
