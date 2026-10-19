// O BLOCO "RESULTADOS" — ENTREGA 1: ESTRUTURA E REGRA DO ATINGIMENTO.
//
// Os indicadores de cada módulo respondem bem a pergunta de dentro dele.
// Nenhum responde a de cima: das três frentes, quais fecharam o mês dentro do
// que foi combinado? O bloco Resultados responde isso, e esta suíte protege
// duas promessas.
//
// A PRIMEIRA é de LAYOUT, e é a que o enunciado chamou de crítica: o bloco é
// IRMÃO das caixas de módulo, nunca filho. Um `.cartao-resultado` dentro de um
// `.bloco-modulo` é o defeito que esta suíte existe para pegar — e `closest`
// é o que prova parentesco, porque "está embaixo na tela" não distingue um
// irmão posicionado de um filho.
//
// A SEGUNDA é a REGRA: atingimento = resultado ÷ meta onde maior é melhor, e
// meta ÷ resultado onde menor é melhor. Inverter a direção num módulo faria o
// mês mais caro do ano aparecer em verde — e é um erro que a tela não denuncia
// sozinha, porque o número continua parecendo um percentual plausível. Por
// isso a regra é medida pela função, com casos construídos, e não só pelo que
// a base do dia produz.
//
//   node montar-teste.cjs
//   CHROMIUM_BIN=/opt/pw-browsers/chromium node testar-resultados.cjs
const { chromium } = require('playwright');
const { irPara, congelarRelogio } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1480, height: 1000 } });
  await congelarRelogio(pag);
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  await irPara(pag, 'Indicadores Gerais', 1600);

  // ------------------------------------------------------------- layout
  console.log('\nPOSIÇÃO — o bloco é irmão das caixas de módulo, nunca filho');
  const pos = await pag.evaluate(() => {
    const b = document.querySelector('.bloco-resultados');
    if (!b) return null;
    const irmaos = [...document.querySelectorAll('#pagina > .bloco')];
    const modulos = [...document.querySelectorAll('.bloco-modulo')];
    const topo = (e) => e.getBoundingClientRect().top + window.scrollY;
    return {
      ehFilhoDeModulo: !!b.closest('.bloco-modulo'),
      indice: irmaos.indexOf(b), total: irmaos.length,
      // Abaixo de TODAS as caixas de módulo, e não só da última do DOM.
      abaixoDeTodos: modulos.every((m) => topo(b) > topo(m)),
      largura: Math.round(b.getBoundingClientRect().width),
      larguraPagina: Math.round(document.querySelector('#pagina').clientWidth),
      titulo: (b.querySelector('h2') || {}).textContent,
      temSubtitulo: !!(b.querySelector('header .nota') || {}).textContent,
      // Nenhum cartão de resultado pode ter nascido dentro de um módulo.
      cartoesDentroDeModulo: document.querySelectorAll('.bloco-modulo .cartao-resultado').length,
      cartoes: [...b.querySelectorAll('.cartao-resultado')].map((c) => c.dataset.modulo),
    };
  });
  if (!pos) {
    ok('o bloco Resultados existe na página inicial', false, 'nenhum .bloco-resultados');
  } else {
    ok('o bloco Resultados existe na página inicial', true);
    ok('ele NÃO está dentro de nenhuma caixa de módulo', !pos.ehFilhoDeModulo);
    ok('nenhum cartão de resultado foi duplicado dentro dos módulos',
      pos.cartoesDentroDeModulo === 0, `${pos.cartoesDentroDeModulo} encontrado(s)`);
    ok('ele vem abaixo de TODAS as caixas de módulo', pos.abaixoDeTodos);
    ok('ele é o último bloco da página', pos.indice === pos.total - 1,
      `${pos.indice + 1} de ${pos.total}`);
    ok('ele ocupa a largura da página',
      Math.abs(pos.largura - pos.larguraPagina) <= 44,
      `${pos.largura}px de ${pos.larguraPagina}px`);
    ok('o título é "Resultados"', (pos.titulo || '').replace(/[+−]/g, '').trim() === 'Resultados',
      pos.titulo);
    ok('há subtítulo explicando o que ele consolida', pos.temSubtitulo);
    ok('são exatamente três cartões, na ordem Financeiro / Projetos / SLA',
      pos.cartoes.join(',') === 'financeiro,projetos,sla', pos.cartoes.join(' · '));
  }

  console.log('\nGRADE — três colunas no desktop, uma no celular');
  const colunas = () => pag.evaluate(() => {
    const g = document.querySelector('.grade-resultados');
    if (!g) return null;
    return {
      colunas: getComputedStyle(g).gridTemplateColumns.split(' ').length,
      // Empilhado de verdade: cada cartão começa onde o anterior terminou.
      empilhado: [...g.children].every((c, i, a) =>
        i === 0 || c.getBoundingClientRect().top >= a[i - 1].getBoundingClientRect().bottom - 1),
    };
  });
  const desktop = await colunas();
  ok('no desktop são três colunas', !!desktop && desktop.colunas === 3,
    desktop ? String(desktop.colunas) : 'sem grade');
  await pag.setViewportSize({ width: 390, height: 900 });
  await pag.waitForTimeout(250);
  const celular = await colunas();
  ok('a 390px vira uma coluna', !!celular && celular.colunas === 1,
    celular ? String(celular.colunas) : 'sem grade');
  ok('a 390px os cartões ficam empilhados', !!celular && celular.empilhado);
  const semRolagemLateral = await pag.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  ok('a 390px a página não rola para o lado', semRolagemLateral);
  await pag.setViewportSize({ width: 1480, height: 1000 });
  await pag.waitForTimeout(250);

  // ------------------------------------------------------------ conteúdo
  console.log('\nCARTÃO — resultado, meta e atingimento');
  const cartoes = await pag.evaluate(() => [...document.querySelectorAll('.cartao-resultado')]
    .map((c) => ({
      mod: c.dataset.modulo,
      faixa: ([...c.classList].find((x) => x.startsWith('faixa-')) || '').replace('faixa-', ''),
      valor: c.querySelector('.res-valor').textContent.trim(),
      rotulos: [...c.querySelectorAll('.res-linha dt')].map((d) => d.textContent.trim()),
      texto: (c.querySelector('.res-texto') || {}).textContent,
    })));
  ok('cada cartão traz Meta e Atingimento rotulados',
    cartoes.every((c) => c.rotulos.join(',') === 'Meta,Atingimento'),
    cartoes.map((c) => c.rotulos.join('/')).join(' · '));
  ok('cada cartão traz o texto do estado da meta',
    cartoes.every((c) => (c.texto || '').trim().length > 0),
    cartoes.map((c) => `${c.mod}: ${c.texto}`).join(' · '));
  ok('nenhum cartão fica sem faixa declarada',
    cartoes.every((c) => c.faixa), cartoes.map((c) => `${c.mod}=${c.faixa}`).join(' · '));

  console.log('\nMÊS — o seletor é do bloco, e repinta só os cartões');
  const mes = await pag.evaluate(async () => {
    const sel = document.querySelector('[data-mes-resultados]');
    if (!sel || sel.options.length < 2) return null;
    const antes = sel.value;
    const area = document.querySelector('[data-cartoes-resultado]');
    const htmlAntes = area.innerHTML;
    // O bloco tem identidade própria: se o seletor repintasse a página, este
    // nó deixaria de ser o mesmo objeto.
    const noAntes = area;
    sel.value = sel.options[1].value;
    sel.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 200));
    return {
      antes, depois: sel.value,
      mudouConteudo: area.innerHTML !== htmlAntes,
      mesmoNo: document.querySelector('[data-cartoes-resultado]') === noAntes,
      aindaTresCartoes: area.querySelectorAll('.cartao-resultado').length === 3,
      // Os filtros dos módulos não podem ter sido tocados.
      filtrosIntactos: !!document.querySelector('.bloco-modulo'),
    };
  });
  if (!mes) {
    console.log('  · a base de teste tem um mês só; o seletor não pode ser exercido');
  } else {
    ok('trocar o mês muda os cartões', mes.mudouConteudo, `${mes.antes} → ${mes.depois}`);
    ok('o container não é remontado', mes.mesmoNo);
    ok('continuam sendo três cartões', mes.aindaTresCartoes);
    ok('as caixas de módulo seguem na página', mes.filtrosIntactos);
  }

  // ------------------------------------------------- a regra, caso a caso
  //
  // Construídos, e não colhidos da base: a base do dia não oferece os três
  // estados ao mesmo tempo, e um teste que só passa quando o dado colabora
  // não protege a regra.
  console.log('\nREGRA — atingimento, direção e faixas');
  const regra = await pag.evaluate(() => {
    const casos = [
      // maior é melhor (SLA, Projetos): resultado ÷ meta.
      { nome: 'sla acima da meta', mod: 'sla', resultado: 90, meta: 80, pct: 112.5, faixa: 'VERDE' },
      { nome: 'sla na meta exata', mod: 'sla', resultado: 80, meta: 80, pct: 100, faixa: 'VERDE' },
      { nome: 'sla parcialmente', mod: 'sla', resultado: 60, meta: 80, pct: 75, faixa: 'LARANJA' },
      { nome: 'sla na borda de 70%', mod: 'sla', resultado: 56, meta: 80, pct: 70, faixa: 'LARANJA' },
      { nome: 'sla logo abaixo de 70%', mod: 'sla', resultado: 55, meta: 80, pct: 68.8, faixa: 'VERMELHO' },
      { nome: 'projetos abaixo', mod: 'projetos', resultado: 40, meta: 80, pct: 50, faixa: 'VERMELHO' },
      // menor é melhor (Financeiro): meta ÷ resultado. Gastar MENOS que o teto
      // é atingir; gastar mais é não atingir — o inverso do caso acima.
      { nome: 'financeiro abaixo do teto', mod: 'financeiro', resultado: 80, meta: 100, pct: 125, faixa: 'VERDE' },
      { nome: 'financeiro no teto', mod: 'financeiro', resultado: 100, meta: 100, pct: 100, faixa: 'VERDE' },
      { nome: 'financeiro estourando pouco', mod: 'financeiro', resultado: 120, meta: 100, pct: 83.3, faixa: 'LARANJA' },
      { nome: 'financeiro estourando muito', mod: 'financeiro', resultado: 200, meta: 100, pct: 50, faixa: 'VERMELHO' },
      // estados neutros
      { nome: 'sem meta', mod: 'sla', resultado: 90, meta: null, pct: undefined, faixa: 'SEM_META' },
      { nome: 'meta zero não vira divisão por zero', mod: 'sla', resultado: 90, meta: 0, pct: undefined, faixa: 'SEM_META' },
      { nome: 'sem resultado', mod: 'sla', resultado: null, meta: 80, pct: undefined, faixa: 'SEM_DADOS' },
      { nome: 'gasto zero não vira meta superada', mod: 'financeiro', resultado: 0, meta: 100, pct: undefined, faixa: 'SEM_DADOS' },
    ];
    return casos.map((c) => {
      const a = atingimentoDaMeta(c.mod, { resultado: c.resultado, meta: c.meta });
      return { nome: c.nome, esperado: [c.pct, c.faixa], obtido: [a.pct, a.faixa] };
    });
  });
  for (const c of regra) {
    ok(c.nome, JSON.stringify(c.obtido) === JSON.stringify(c.esperado),
      JSON.stringify(c.obtido) === JSON.stringify(c.esperado) ? ''
        : `obtido ${JSON.stringify(c.obtido)}, esperado ${JSON.stringify(c.esperado)}`);
  }

  console.log('\nTEXTO — a frase que acompanha cada faixa');
  const textos = await pag.evaluate(() => [
    { f: textoDaMeta({ faixa: 'VERDE', meta: 80 }, false), e: /^Meta 80,0% atingida$/ },
    { f: textoDaMeta({ faixa: 'LARANJA', meta: 80 }, false), e: /^Meta 80,0% parcialmente atingida$/ },
    { f: textoDaMeta({ faixa: 'VERMELHO', meta: 80 }, false), e: /^Meta 80,0% não atingida$/ },
    { f: textoDaMeta({ faixa: 'SEM_META' }, false), e: /^Sem meta cadastrada$/ },
    { f: textoDaMeta({ faixa: 'SEM_DADOS' }, false), e: /^Sem dados no período$/ },
    // `brl` separa o símbolo do número com espaço INSEPARÁVEL (U+00A0), que é
    // o certo para moeda — um espaço comum aqui deixaria "R$" sozinho no fim
    // da linha. Daí o `\s` no lugar de um espaço literal.
    { f: textoDaMeta({ faixa: 'VERDE', meta: 1000 }, true), e: /^Meta R\$\s1\.000,00 atingida$/ },
  ].map((x) => ({ frase: x.f, bate: x.e.test(x.f) })));
  for (const t of textos) ok(`texto: "${t.frase}"`, t.bate);

  // ------------------------------------- o número bate com o do módulo
  //
  // A conferência que importa: o Resultados não pode ter a sua própria conta.
  console.log('\nCOERÊNCIA — o resultado vem do mesmo cálculo do módulo');
  const coerente = await pag.evaluate(() => {
    const comp = document.querySelector('[data-mes-resultados]').value;
    const doBloco = resultadoDoMes('financeiro', comp);
    // O mesmo número pelo caminho do próprio Objetivo 03, sem passar pelo
    // atalho do bloco.
    const r = { ...recorteVazio(), de: comp, ate: comp };
    const p = calcularObjetivo03(r).serie.find((x) => x.comp === comp);
    return { comp, bloco: doBloco.resultado, modulo: p ? p.total : null,
      metaBloco: doBloco.meta, metaModulo: p ? p.teto : null };
  });
  ok('o resultado financeiro do bloco é o do Objetivo 03',
    coerente.bloco === coerente.modulo, `${coerente.bloco} × ${coerente.modulo}`);
  ok('a meta financeira do bloco é o teto do Objetivo 03',
    coerente.metaBloco === coerente.metaModulo, `${coerente.metaBloco} × ${coerente.metaModulo}`);

  // --------------------------------- as três faixas, no DOM de verdade
  //
  // A base de teste não oferece verde, laranja e vermelho ao mesmo tempo — ela
  // nem tem teto cadastrado. Então o teto é SEMEADO, dimensionado contra o
  // resultado real do mês para cair em cada faixa, e desfeito ao final. É a
  // diferença entre provar a função e provar o que a tela pinta.
  console.log('\nFAIXAS NO CARTÃO — verde, laranja e vermelho pintados de verdade');
  const pintadas = await pag.evaluate(async () => {
    const comp = document.querySelector('[data-mes-resultados]').value;
    const resultado = resultadoDoMes('financeiro', comp).resultado;
    if (!(resultado > 0)) return { semBase: true };
    const original = E.metas;
    const saida = [];
    // menor é melhor: teto acima do gasto atinge; abaixo, não.
    for (const [faixa, fator] of [['verde', 1.2], ['laranja', 0.8], ['vermelho', 0.5]]) {
      E.metas = [{
        nome: 'teto de verificação', modulo: 'financeiro', tipoMeta: 'objetivo-03',
        contextoTeto: 'fixas', valorTeto: resultado * fator, ativo: true,
        cliente: E.clienteSel, alvoPct: 0,
      }];
      const area = document.querySelector('[data-cartoes-resultado]');
      area.innerHTML = cartoesDeResultadoHtml(comp);
      ligarBlocoResultados();
      await new Promise((r) => setTimeout(r, 60));
      const c = area.querySelector('.cartao-resultado[data-modulo="financeiro"]');
      const cor = getComputedStyle(c).borderLeftColor;
      saida.push({
        faixa,
        classe: ([...c.classList].find((x) => x.startsWith('faixa-')) || '').replace('faixa-', ''),
        texto: c.querySelector('.res-texto').textContent.trim(),
        corTexto: getComputedStyle(c.querySelector('.res-texto')).color,
        cor,
        ating: c.querySelector('.res-ating').textContent.trim(),
      });
    }
    E.metas = original;
    document.querySelector('[data-cartoes-resultado]').innerHTML = cartoesDeResultadoHtml(comp);
    ligarBlocoResultados();
    // Três cores distintas: se duas faixas pintassem igual, a cor não seria canal.
    // Vai como campo do objeto, e não pendurado no array: a serialização entre
    // o navegador e o Node descarta chave não-numérica de array.
    return { semBase: false, saida, distintas: new Set(saida.map((s) => s.cor)).size === 3 };
  });
  if (pintadas.semBase) {
    console.log('  · o mês em foco não tem despesa reconhecida; as faixas não podem ser exercidas');
  } else {
    for (const s of pintadas.saida) {
      ok(`faixa ${s.faixa} no cartão`, s.classe === s.faixa, `classe ${s.classe} · ${s.ating} · ${s.cor}`);
    }
    ok('verde diz "atingida"', /\batingida$/.test(pintadas.saida[0].texto), pintadas.saida[0].texto);
    ok('laranja diz "parcialmente atingida"',
      /parcialmente atingida$/.test(pintadas.saida[1].texto), pintadas.saida[1].texto);
    ok('vermelho diz "não atingida"',
      /não atingida$/.test(pintadas.saida[2].texto), pintadas.saida[2].texto);
    ok('as três faixas têm cores distintas', pintadas.distintas,
      pintadas.saida.map((s) => s.cor).join(' · '));
    // O texto colorido da faixa só existe quando há meta, então `testar-contraste`
    // — que varre a tela como ela está — nunca o alcança. Medido aqui, com o
    // teto semeado, nos dois temas.
    console.log('\nCONTRASTE DAS FAIXAS — medido com meta cadastrada, nos dois temas');
    for (const tema of ['light', 'dark']) {
      const pares = await pag.evaluate(async (t) => {
        document.documentElement.setAttribute('data-theme', t);
        const comp = document.querySelector('[data-mes-resultados]').value;
        const resultado = resultadoDoMes('financeiro', comp).resultado;
        const original = E.metas;
        const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
          .map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const fundo = (e) => { let n = e; while (n) { const c = getComputedStyle(n).backgroundColor;
          if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; n = n.parentElement; }
          return 'rgb(255,255,255)'; };
        const razao = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const saida = [];
        for (const [faixa, fator] of [['verde', 1.2], ['laranja', 0.8], ['vermelho', 0.5]]) {
          E.metas = [{ nome: 'teto', modulo: 'financeiro', tipoMeta: 'objetivo-03',
            contextoTeto: 'fixas', valorTeto: resultado * fator, ativo: true,
            cliente: E.clienteSel, alvoPct: 0 }];
          const area = document.querySelector('[data-cartoes-resultado]');
          area.innerHTML = cartoesDeResultadoHtml(comp);
          ligarBlocoResultados();
          const c = area.querySelector('.cartao-resultado[data-modulo="financeiro"]');
          for (const sel of ['.res-texto', '.res-valor', '.res-ating', '.res-oque']) {
            const e = c.querySelector(sel);
            if (!e) continue;
            const s = getComputedStyle(e);
            const px = parseFloat(s.fontSize);
            const grande = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700);
            saida.push({ faixa, sel, px, r: +razao(s.color, fundo(e)).toFixed(2), regua: grande ? 3 : 4.5 });
          }
        }
        E.metas = original;
        document.querySelector('[data-cartoes-resultado]').innerHTML = cartoesDeResultadoHtml(comp);
        ligarBlocoResultados();
        document.documentElement.removeAttribute('data-theme');
        return saida;
      }, tema);
      const abaixo = pares.filter((p) => p.r < p.regua);
      ok(`tema ${tema}: as faixas passam na régua AA`, abaixo.length === 0,
        abaixo.length ? abaixo.map((p) => `${p.faixa}${p.sel} ${p.r}<${p.regua}`).join(', ')
          : `${pares.length} par(es) medidos`);
    }

    ok('o estado da meta volta ao normal depois do teste',
      await pag.evaluate(() => /Sem meta cadastrada|Meta/.test(
        document.querySelector('.cartao-resultado[data-modulo="financeiro"] .res-texto').textContent)));
  }

  // ------------------------------------------- a faixa mês a mês
  console.log('\nFAIXA MÊS A MÊS — cores por status, seleção e drill-down');
  const faixa = await pag.evaluate(() => {
    const c = document.querySelector('.cartao-resultado[data-modulo="financeiro"]');
    const meses = [...c.querySelectorAll('.res-mes')];
    return {
      quantos: meses.length,
      selecionado: document.querySelector('[data-mes-resultados]').value,
      marcados: meses.filter((m) => m.getAttribute('aria-pressed') === 'true')
        .map((m) => m.dataset.mesFaixa),
      // Cada mês tem rótulo escrito, ponto colorido, rótulo acessível e balão.
      completos: meses.every((m) => m.querySelector('.res-mes-rot').textContent.trim()
        && m.querySelector('.res-mes-pt') && (m.getAttribute('aria-label') || '').length > 8),
      comDica: meses.filter((m) => m.dataset.dica).length,
      // O rótulo é o mesmo dos dois lados — "jul/26", e não "07". Duas
      // superfícies que nomeiam o mesmo mês de formas diferentes obrigam a
      // traduzir de cabeça ao comparar o celular com o navegador.
      rotulos: meses.map((m) => m.querySelector('.res-mes-rot').textContent.trim()),
      cores: [...new Set(meses.map((m) =>
        ([...m.classList].find((x) => x.startsWith('faixa-')) || '').replace('faixa-', '')))],
      // Cronológica: o mês mais antigo primeiro.
      ordem: meses.map((m) => m.dataset.mesFaixa),
      todosOsCartoes: [...document.querySelectorAll('.cartao-resultado')]
        .map((x) => x.querySelectorAll('.res-mes').length),
    };
  });
  ok('a faixa existe nos três cartões', faixa.todosOsCartoes.every((n) => n === faixa.quantos),
    faixa.todosOsCartoes.join(' · '));
  ok('a faixa vem em ordem cronológica',
    faixa.ordem.every((m, i, a) => i === 0 || a[i - 1] < m), faixa.ordem.join(' '));
  ok('no máximo treze meses', faixa.quantos <= 13, `${faixa.quantos} mês(es)`);
  ok('exatamente um mês vem marcado, e é o do seletor',
    faixa.marcados.length === 1 && faixa.marcados[0] === faixa.selecionado,
    `${faixa.marcados.join(',')} × ${faixa.selecionado}`);
  ok('cada mês traz rótulo, ponto e nome acessível', faixa.completos);
  ok('cada mês traz balão com os números', faixa.comDica === faixa.quantos,
    `${faixa.comDica} de ${faixa.quantos}`);
  // O mesmo rótulo do app: mês abreviado e ano de dois dígitos. "07" sozinho
  // obrigaria a traduzir de cabeça ao comparar as duas telas.
  ok('o rótulo do mês é o mesmo do app (mmm/aa)',
    faixa.rotulos.every((r) => /^[a-z]{3}\/\d{2}$/.test(r)), faixa.rotulos.join(' · '));

  console.log('\nFAIXA — clicar num mês move o bloco inteiro');
  const clique = await pag.evaluate(async () => {
    const c = document.querySelector('.cartao-resultado[data-modulo="financeiro"]');
    const meses = [...c.querySelectorAll('.res-mes')];
    const antes = document.querySelector('[data-mes-resultados]').value;
    const alvo = meses.find((m) => m.dataset.mesFaixa !== antes);
    if (!alvo) return null;
    const querido = alvo.dataset.mesFaixa;
    alvo.click();
    await new Promise((r) => setTimeout(r, 300));
    const sel = document.querySelector('[data-mes-resultados]');
    return { antes, querido, seletor: sel.value,
      // Os TRÊS cartões moveram juntos.
      marcadosPorCartao: [...document.querySelectorAll('.cartao-resultado')].map((x) => {
        const m = x.querySelector('.res-mes[aria-pressed="true"]');
        return m ? m.dataset.mesFaixa : null;
      }) };
  });
  if (!clique) {
    console.log('  · a base tem um mês só; o clique na faixa não pode ser exercido');
  } else {
    ok('clicar move o seletor do bloco', clique.seletor === clique.querido,
      `${clique.antes} → ${clique.seletor} (queria ${clique.querido})`);
    ok('os três cartões movem juntos',
      clique.marcadosPorCartao.every((m) => m === clique.querido),
      clique.marcadosPorCartao.join(' · '));
  }

  // A FAIXA PELO TECLADO. Repintar troca o HTML inteiro da área, e o botão
  // que tinha o foco deixa de existir: sem cuidado, o foco volta ao `body` e
  // quem navega por teclado precisa tabular desde o topo da página a cada mês
  // que escolhe — justamente na peça feita para se percorrer mês a mês.
  console.log('\nFAIXA — percorrível pelo teclado, e o foco não se perde ao escolher');
  const porTeclado = await pag.evaluate(async () => {
    const c = document.querySelector('.cartao-resultado[data-modulo="sla"]');
    const meses = [...c.querySelectorAll('.res-mes')];
    const alvo = meses.find((m) => m.getAttribute('aria-pressed') !== 'true');
    if (!alvo) return null;
    const querido = alvo.dataset.mesFaixa;
    alvo.focus();
    const focou = document.activeElement === alvo;
    return { focou, querido, ehBotao: alvo.tagName === 'BUTTON',
      // Um botão nativo já está na ordem de tabulação; um `tabindex="-1"` o
      // tiraria dela sem mudar nada do que se vê.
      foraDaTabulacao: alvo.getAttribute('tabindex') === '-1' };
  });
  if (!porTeclado) {
    console.log('  · todos os meses já selecionados; o teclado não pôde ser exercido');
  } else {
    ok('o mês é um botão nativo, na ordem de tabulação',
      porTeclado.ehBotao && !porTeclado.foraDaTabulacao);
    ok('o mês recebe foco', porTeclado.focou);
    await pag.keyboard.press('Enter');
    await pag.waitForTimeout(400);
    const depois = await pag.evaluate(() => {
      const f = document.activeElement;
      return { ehBody: f === document.body,
        naFaixa: !!(f && f.classList && f.classList.contains('res-mes')),
        mes: f && f.dataset ? f.dataset.mesFaixa : null,
        modulo: f && f.closest ? (f.closest('[data-modulo]') || {}).dataset?.modulo : null,
        selecionado: document.querySelector('[data-mes-resultados]').value };
    });
    ok('Enter escolhe o mês', depois.selecionado === porTeclado.querido,
      `${depois.selecionado} (queria ${porTeclado.querido})`);
    ok('e o foco continua no mesmo botão, e não volta ao topo da página',
      depois.naFaixa && !depois.ehBody && depois.mes === porTeclado.querido
        && depois.modulo === 'sla',
      `foco em ${depois.modulo || '—'}/${depois.mes || (depois.ehBody ? 'body' : '?')}`);
  }

  console.log('\nDELTA — a variação do atingimento contra o mês anterior');
  const delta = await pag.evaluate(() => [...document.querySelectorAll('.cartao-resultado')]
    .map((c) => ({ mod: c.dataset.modulo,
      texto: ((c.querySelector('.res-delta') || {}).textContent || '').replace(/\s+/g, ' ').trim() })));
  ok('todo cartão diz a variação, ou por que não há',
    delta.every((d) => /p\.p\./.test(d.texto) || /Sem comparação com \d{2}\/\d{4}/.test(d.texto)),
    delta.map((d) => `${d.mod}: ${d.texto}`).join(' · ').slice(0, 150));
  ok('a variação é em pontos percentuais, não em percentual de percentual',
    delta.every((d) => !/p\.p\./.test(d.texto) || /\d+,\d p\.p\./.test(d.texto)));

  console.log('\nREGISTROS — o botão abre o que compõe o resultado do mês');
  const reg = await pag.evaluate(async () => {
    const c = document.querySelector('.cartao-resultado[data-modulo="financeiro"]');
    const bt = c.querySelector('[data-ver-mes]');
    if (!bt) return null;
    const rotulo = bt.textContent.trim();
    bt.click();
    await new Promise((r) => setTimeout(r, 600));
    const m = document.querySelector('.modal');
    // O detalhamento financeiro abre em ÁRVORE: a última coluna é a barra de
    // representatividade, não o valor, e os níveis se intercalam. A ordem que
    // se confere é a do nível 1, que é onde a árvore promete decrescente.
    const vals = [...document.querySelectorAll('.modal tbody tr.nivel-1')]
      .map((tr) => {
        const t = tr.querySelector('td.num');
        return t ? Number(t.textContent.replace(/[^\d,]/g, '').replace(',', '.')) : null;
      }).filter((v) => v !== null);
    return { rotulo, abriu: !!m,
      titulo: m ? (m.querySelector('h2, .tit') || {}).textContent.trim() : '',
      nota: m ? m.querySelector('.msg').textContent.replace(/\s+/g, ' ').trim().slice(0, 100) : '',
      decrescente: vals.every((v, i, a) => i === 0 || a[i - 1] >= v), amostra: vals.length };
  });
  if (!reg) {
    ok('o cartão tem o botão de registros', false);
  } else {
    ok('o botão nomeia o mês', /Ver registros de \d{2}\/\d{4}/.test(reg.rotulo), reg.rotulo);
    ok('ele abre a tela flutuante', reg.abriu);
    ok('com o módulo e o mês no título', /— registros de \d{2}\/\d{4}$/.test(reg.titulo), reg.titulo);
    ok('do maior para o menor valor', reg.decrescente, `${reg.amostra} valor(es) conferidos`);
    await pag.evaluate(() => {
      const b = document.querySelector('.modal [data-c]'); if (b) b.click();
    });
    await pag.waitForTimeout(250);
  }

  // ------------------------------------------- a barra de atingimento
  //
  // O preenchimento para em 100%: uma barra que passasse da caixa perderia a
  // referência, e duas metas superadas por margens diferentes ficariam com a
  // mesma aparência de transbordo.
  console.log('\nBARRA — preenchimento, teto em 100% e o excedente marcado');
  const barras = await pag.evaluate(async () => {
    const comp = document.querySelector('[data-mes-resultados]').value;
    const res = resultadoDoMes('financeiro', comp).resultado;
    if (!(res > 0)) return { semBase: true };
    const original = E.metas;
    const saida = [];
    // menor é melhor: teto acima do gasto atinge; muito acima, supera.
    for (const [caso, fator, faixa] of [['superada', 1.25, 'verde'], ['na-meta', 1, 'verde'],
      ['parcial', 0.8, 'laranja'], ['nao-atingida', 0.5, 'vermelho']]) {
      E.metas = [{ nome: 't', modulo: 'financeiro', tipoMeta: 'objetivo-03', contextoTeto: 'fixas',
        valorTeto: res * fator, ativo: true, cliente: E.clienteSel, alvoPct: 0 }];
      const area = document.querySelector('[data-cartoes-resultado]');
      area.innerHTML = cartoesDeResultadoHtml(comp);
      ligarBlocoResultados();
      ligarDicasDaTela(area);
      await new Promise((r) => setTimeout(r, 60));
      const c = area.querySelector('.cartao-resultado[data-modulo="financeiro"]');
      const b = c.querySelector('.res-barra');
      const i = c.querySelector('.res-trilha > i');
      saida.push({ caso, faixaEsperada: faixa,
        faixa: ([...c.classList].find((x) => x.startsWith('faixa-')) || '').replace('faixa-', ''),
        papel: b.getAttribute('role'),
        agora: Number(b.getAttribute('aria-valuenow')),
        min: b.getAttribute('aria-valuemin'), max: b.getAttribute('aria-valuemax'),
        rotulo: b.getAttribute('aria-label') || '',
        largura: parseFloat(i.style.width),
        corFundo: i.style.background,
        pct: c.querySelector('.res-pct').textContent.trim(),
        excedeu: !!c.querySelector('.res-excedeu'),
        excesso: (c.querySelector('.res-excesso') || {}).textContent || '',
        temDica: !!b.dataset.dica,
        dica: b.dataset.dica || '' });
    }
    E.metas = original;
    const area = document.querySelector('[data-cartoes-resultado]');
    area.innerHTML = cartoesDeResultadoHtml(comp);
    ligarBlocoResultados();
    ligarDicasDaTela(area);
    const semMeta = area.querySelector('.cartao-resultado[data-modulo="projetos"] .res-barra');
    return { semBase: false, saida, barraVazia: !!(semMeta && semMeta.classList.contains('vazia')) };
  });
  if (barras.semBase) {
    console.log('  · o mês em foco não tem despesa reconhecida; a barra não pode ser exercida');
  } else {
    for (const b of barras.saida) {
      ok(`${b.caso}: a faixa é ${b.faixaEsperada}`, b.faixa === b.faixaEsperada, b.faixa);
    }
    ok('o preenchimento é proporcional ao atingimento',
      barras.saida.every((b) => Math.abs(b.largura - Math.min(100, b.agora)) < 0.2),
      barras.saida.map((b) => `${b.caso}:${b.largura}%/${b.agora}`).join(' · '));
    ok('o preenchimento NUNCA passa de 100%', barras.saida.every((b) => b.largura <= 100),
      barras.saida.map((b) => b.largura).join(' · '));
    ok('quem supera a meta é marcado',
      barras.saida.find((b) => b.caso === 'superada').excedeu
        && !barras.saida.find((b) => b.caso === 'parcial').excedeu);
    ok('e a frase diz de quanto foi a superação',
      /Meta superada em 25,0%/.test(barras.saida.find((b) => b.caso === 'superada').excesso),
      barras.saida.find((b) => b.caso === 'superada').excesso.trim());
    ok('exatamente na meta não conta como superada',
      !barras.saida.find((b) => b.caso === 'na-meta').excedeu);
    ok('o percentual sai com uma casa decimal',
      barras.saida.every((b) => /^\d+,\d%$/.test(b.pct)), barras.saida.map((b) => b.pct).join(' · '));
    // Acessibilidade: a barra se anuncia.
    ok('a barra é um progressbar', barras.saida.every((b) => b.papel === 'progressbar'));
    ok('com valor, mínimo e máximo',
      barras.saida.every((b) => Number.isFinite(b.agora) && b.min === '0' && b.max === '100'));
    ok('e com a frase da meta no rótulo',
      barras.saida.every((b) => /Meta .+ (atingida|parcialmente atingida|não atingida) — atingimento de/.test(b.rotulo)),
      barras.saida[0].rotulo.slice(0, 70));
    // O balão traz as cinco informações do enunciado.
    const d = barras.saida[0].dica;
    ok('o balão traz resultado, meta, atingimento, direção e mês',
      ['Resultado', 'Meta', 'Atingimento', 'Direção da meta', 'Mês de referência']
        .every((x) => d.includes(x)), d.slice(0, 120));
    ok('sem atingimento, a barra fica neutra e vazia', barras.barraVazia);
  }

  console.log(`\n=== erros de console: ${erros.length ? erros.slice(0, 5).join(' | ') : 'nenhum'} ===`);
  console.log(`=== ✗=${falhas.length} ===`);
  if (falhas.length) falhas.forEach((f) => console.log('  ✗ ' + f));
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
