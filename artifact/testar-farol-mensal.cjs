// FAROL 3 — custo recorrente mês a mês, com projeção do que é fixo.
// E o agrupamento OBJETIVOS / FARÓIS dentro do módulo Financeiro.
//
// A conferência que decide a entrega é a da PROJEÇÃO: ela tem de ser uma série
// à parte, com cor e tracejado próprios, ligada ao último mês realizado — e não
// a mesma linha pintada de outra cor, que mentiria sobre onde o realizado acaba.
const { chromium } = require('playwright');
const { irPara } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  await irPara(pag, 'Indicadores Gerais', 2000);

  console.log('\nAGRUPAMENTO — Objetivos e Faróis dentro do módulo');
  const grupos = await pag.evaluate(() => {
    // O título carrega a seta da dobra; o nome é o que sobra dela.
    const nome = (s) => s.querySelector('h2').textContent.replace(/^\s*[−+]\s*/, '').trim();
    const gs = [...document.querySelectorAll('section.bloco-grupo')];
    const de = (n) => {
      const g = gs.find((s) => nome(s) === n);
      return g ? [...g.querySelectorAll('[data-kpi]')].map((k) => k.dataset.kpi) : null;
    };
    return {
      nomes: gs.map(nome),
      objetivos: de('Objetivos'), farois: de('Faróis'),
      // Os grupos vivem DENTRO do módulo Financeiro, e não ao lado dele.
      dentroDoModulo: gs.every((g) => !!g.closest('section.bloco-modulo')),
      // Cada grupo dobra: é o mesmo acordeão de todo bloco com <h2>.
      dobram: gs.every((g) => !!g.querySelector('.bloco-corpo') && !!g.querySelector('.bloco-dobra')),
      // E os indicadores continuam dobrando dentro deles.
      indicadoresDobram: gs.every((g) =>
        [...g.querySelectorAll('section.bloco-indicador')].every((s) => !!s.querySelector('.bloco-dobra'))),
    };
  });
  ok('existem os dois grupos', grupos.nomes.join(' · ') === 'Objetivos · Faróis', grupos.nomes.join(' · '));
  ok('dentro do módulo Financeiro', grupos.dentroDoModulo);
  ok('os três objetivos estão em "Objetivos"',
    JSON.stringify(grupos.objetivos) === JSON.stringify(['plano-reducao', 'rateio', 'teto-gasto']),
    JSON.stringify(grupos.objetivos));
  ok('os três faróis estão em "Faróis"',
    JSON.stringify(grupos.farois) === JSON.stringify(['custo-recorrente', 'por-reconhecer', 'custo-mes-a-mes']),
    JSON.stringify(grupos.farois));
  ok('cada grupo abre e fecha', grupos.dobram);
  ok('e cada indicador continua abrindo dentro dele', grupos.indicadoresDobram);

  console.log('\nFAROL 3 — três séries e a projeção');
  const f3 = await pag.evaluate(() => {
    const kpi = document.querySelector('[data-kpi="custo-mes-a-mes"]');
    const sec = kpi && kpi.closest('section.bloco-indicador');
    const f = calcularFarol3(recorteDoBloco('financeiro'));
    const svg = sec && sec.querySelector('#i-reducao svg');
    return kpi ? {
      titulo: sec.querySelector('h2').textContent.replace(/^\s*[−+]\s*/, '').trim(),
      // Quatro caminhos com traço: as três séries realizadas mais a projeção.
      linhas: svg ? svg.querySelectorAll('path[stroke]').length : 0,
      tracejadas: svg ? svg.querySelectorAll('path[stroke-dasharray]').length : 0,
      colunas: [...sec.querySelectorAll('thead th')].map((t) => t.textContent.trim()),
      linhasTabela: sec.querySelectorAll('tr[data-mes-farol3]').length,
      projetadasNaTabela: sec.querySelectorAll('tr.linha-projetada').length,
      realizados: f.realizados.length, projetados: f.projetados.length,
      // O realizado para no último mês FECHADO — o corrente está pela metade.
      fechado: mesSoma(mesHoje(), -1),
      ultimoRealizado: f.ultimoRealizado,
      // Total = fixas + variáveis, em todo mês realizado.
      somaFecha: f.realizados.every((p) => Math.abs(p.fixa + p.variavel - p.total) < 0.01),
      // A projeção repete o nível fixo do último realizado, e só ele é projetado.
      projetaSoOFixo: f.projetados.every((p) =>
        p.total === null && p.variavel === null && p.fixaProjetada === f.nivelFixo),
      // O último realizado entra TAMBÉM na série projetada, para as linhas se ligarem.
      ligaNaPonta: f.realizados[f.realizados.length - 1].fixaProjetada === f.nivelFixo,
      // A projeção NÃO obedece ao filtro, que termina no passado.
      passaDoFiltro: f.projetados.length > 0 && f.projetados[0].comp > f.ultimoRealizado,
    } : null;
  });
  ok('o Farol 3 existe', !!f3);
  ok('com o título do enunciado', f3 && f3.titulo === 'Farol 3 - Custo recorrente Mês a Mês', f3 && f3.titulo);
  // Oito séries desde que os tetos entraram: total, variáveis, fixas, projeção
  // e os quatro tetos. As séries de teto existem mesmo sem meta cadastrada —
  // sem valor elas não chegam a ser desenhadas, e é a ausência da linha que
  // diz que não há limite.
  ok('oito linhas no gráfico: as quatro séries e os quatro tetos',
    f3 && f3.linhas === 8, f3 && String(f3.linhas));
  ok('e as tracejadas são a projeção mais os quatro tetos',
    f3 && f3.tracejadas === 5, f3 && String(f3.tracejadas));
  ok('o racional tem coluna para cada série',
    f3 && ['Total', 'Variáveis', 'Fixas'].every((c) => f3.colunas.includes(c)),
    f3 && f3.colunas.join(' | '));
  ok('o realizado para no último mês fechado',
    f3 && f3.ultimoRealizado <= f3.fechado, f3 && `${f3.ultimoRealizado} ≤ ${f3.fechado}`);
  ok('total = fixas + variáveis em todo mês', f3 && f3.somaFecha);
  ok('só o fixo é projetado', f3 && f3.projetaSoOFixo);
  ok('a projeção parte do último mês realizado', f3 && f3.ligaNaPonta);
  ok('e vai além do filtro, que termina no passado', f3 && f3.passaDoFiltro,
    f3 && `${f3.projetados} mês(es) projetado(s)`);
  ok('a tabela traz realizados e projetados, marcando os segundos',
    f3 && f3.linhasTabela === f3.realizados + f3.projetados && f3.projetadasNaTabela === f3.projetados,
    f3 && `${f3.linhasTabela} linhas · ${f3.projetadasNaTabela} projetadas`);

  console.log('\nTETOS — quatro linhas vermelhas, e cinza onde não há meta');
  await pag.evaluate(async () => {
    await Loja.gravarCatalogo('metas', [
      { cliente: E.clienteSel, nome: 'Teto fixas', modulo: 'financeiro', tipoMeta: 'objetivo-03',
        contextoTeto: 'fixas', valorTeto: 120000, alvoPct: 0, vigenciaInicio: null, vigenciaFim: null, ativo: true },
      { cliente: E.clienteSel, nome: 'Teto pontuais', modulo: 'financeiro', tipoMeta: 'objetivo-03',
        contextoTeto: 'variaveis', valorTeto: 30000, alvoPct: 0, vigenciaInicio: null, vigenciaFim: null, ativo: true },
    ]);
    await render();
  });
  await pag.waitForTimeout(1200);
  await pag.evaluate(() => [...document.querySelectorAll('.bloco.dobrado > header .bloco-dobra')]
    .forEach((b) => b.click()));
  await pag.waitForTimeout(600);
  const tetos = await pag.evaluate(() => {
    const sec = document.querySelector('[data-kpi="custo-mes-a-mes"]').closest('section.bloco-indicador');
    const svg = sec.querySelector('#i-reducao svg');
    const f = calcularFarol3(recorteDoBloco('financeiro'));
    const traco = [...svg.querySelectorAll('path[stroke]')].map((p) => p.getAttribute('stroke'));
    return {
      // 3 séries realizadas + projeção + 4 tetos.
      linhas: traco.length,
      // Tracejadas: a projeção mais os quatro tetos.
      tracejadas: svg.querySelectorAll('path[stroke-dasharray]').length,
      vermelhas: traco.filter((c) => /crit/.test(c)).length,
      cinzas: traco.filter((c) => /tinta3/.test(c)).length,
      colunas: [...sec.querySelectorAll('thead th')].map((t) => t.textContent.trim()),
      aviso: /Sem teto cadastrado/.test(sec.textContent),
      semMetaNaCelula: /sem meta/.test(sec.querySelector('tbody').textContent),
      // O geral é a SOMA dos três, e não um valor digitado à parte.
      geral: f.tetos.geral, fixas: f.tetos.fixas, variaveis: f.tetos.variaveis,
      investimentos: f.tetos.investimentos,
      // O teto atravessa os meses projetados: é lá que "este patamar cabe no
      // limite?" mais importa.
      noProjetado: f.projetados[0] ? f.projetados[0].tetoGeral : null,
      // E as séries do Farol 3 continuam todas lá.
      seriesAntigas: ['Total', 'Variáveis', 'Fixas'].every((c) =>
        [...sec.querySelectorAll('thead th')].some((t) => t.textContent.trim() === c)),
    };
  });
  ok('oito linhas: três séries, a projeção e os quatro tetos',
    tetos.linhas === 8, String(tetos.linhas));
  ok('cinco tracejadas: a projeção e os quatro tetos', tetos.tracejadas === 5, String(tetos.tracejadas));
  // O vermelho é o limite de alguém: pintar de vermelho a ausência de limite
  // inventaria um compromisso que ninguém assumiu.
  ok('três vermelhas — as que têm meta', tetos.vermelhas === 3, String(tetos.vermelhas));
  ok('e a sem meta fica cinza', tetos.cinzas === 1, String(tetos.cinzas));
  ok('o racional ganhou uma coluna por teto',
    ['Teto despesas fixas', 'Teto despesas variáveis', 'Teto investimentos', 'Teto geral']
      .every((c) => tetos.colunas.includes(c)), tetos.colunas.slice(-4).join(' | '));
  ok('o teto geral é a soma dos três',
    tetos.geral === tetos.fixas + tetos.variaveis, `${tetos.fixas} + ${tetos.variaveis} = ${tetos.geral}`);
  ok('contexto sem meta aparece como "sem meta", não como zero',
    tetos.investimentos === null && tetos.semMetaNaCelula);
  ok('com aviso no bloco', tetos.aviso);
  ok('o teto alcança também os meses projetados', tetos.noProjetado === tetos.geral,
    String(tetos.noProjetado));
  ok('e as séries do Farol 3 continuam todas', tetos.seriesAntigas);

  console.log('\nCLIQUE — lançamentos do maior para o menor');
  await pag.locator('tr[data-mes-farol3]').nth(3).click();
  await pag.waitForTimeout(800);
  const clique = await pag.evaluate(() => {
    const valores = [...document.querySelectorAll('.modal tr.nivel-1')]
      .map((tr) => Number((tr.children[1] || {}).textContent.replace(/[^\d,]/g, '').replace(',', '.')))
      .filter((n) => n > 0);
    return {
      fundos: document.querySelectorAll('.fundo').length,
      titulo: (document.querySelector('.modal h2') || {}).textContent,
      nota: (document.querySelector('.modal .msg') || {}).textContent.replace(/\s+/g, ' '),
      decrescente: valores.every((x, i) => i === 0 || valores[i - 1] >= x),
      valores: valores.slice(0, 4),
    };
  });
  // O cartão é gatilho: sem barrar a propagação, a linha abriria duas telas.
  ok('a linha abre UMA tela', clique.fundos === 1, `${clique.fundos}`);
  ok('do mês clicado', /^Custos de \d\d\/\d{4}$/.test(clique.titulo || ''), clique.titulo);
  ok('com os lançamentos do maior para o menor',
    clique.decrescente, clique.valores.join(' ≥ '));
  ok('e a nota diz a composição do mês',
    /em despesa fixa e .* em pontual/.test(clique.nota), clique.nota.slice(0, 110));
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(400);

  console.log('\nMÊS PROJETADO — a tela explica de onde ele vem');
  await pag.locator('tr.linha-projetada').first().click();
  await pag.waitForTimeout(800);
  const proj = await pag.evaluate(() => ({
    fundos: document.querySelectorAll('.fundo').length,
    titulo: (document.querySelector('.modal h2') || {}).textContent,
    nota: (document.querySelector('.modal .msg') || {}).textContent.replace(/\s+/g, ' '),
  }));
  // Um mês futuro não tem lançamento próprio: abrir a lista dele devolveria
  // vazio, e um detalhamento vazio faz duvidar do número.
  ok('o mês projetado abre os lançamentos da BASE', proj.fundos === 1
    && /projetado para .* base: /.test(proj.titulo || ''), proj.titulo);
  ok('e a tela diz que eles são da base, não do mês',
    /que é a base da projeção/.test(proj.nota), proj.nota.slice(0, 120));
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(400);

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
