// O DETALHAMENTO FINANCEIRO É COMPARATIVO — ENTREGA 1: A ESTRUTURA.
//
// Todo indicador do Financeiro abria UMA lista: o que veio no recorte. Quem
// queria saber se o mês piorou abria dois meses em duas janelas e comparava no
// olho. Agora o detalhamento tem camadas empilhadas, de largura cheia, uma
// abaixo da outra e todas FECHADAS ao nascer:
//
//   1. Diferença vs mês anterior
//   2. O que veio no mês filtrado
//   3. Mês anterior: o que veio × o que não veio
//   4. (só nos detalhamentos de recorte) Recorte completo — o que o indicador soma
//
// Esta suíte mede a ENTREGA 1, que é a estrutura: as camadas existem, nascem
// fechadas, abrem e fecham pelo mouse e pelo teclado, anunciam o estado em
// `aria-expanded`, o cabeçalho diz "MM/AAAA vs MM/AAAA", e o corpo só é
// montado no primeiro clique — carregar três árvores de uma vez custaria três
// vezes a pergunta que a pessoa veio fazer.
//
// O conteúdo das camadas 1 e 3 (a quebra da variação e o corte veio × não veio)
// é das entregas seguintes; aqui o que se prova é que a casa existe e que a
// camada 2 continua trazendo a árvore inteira, sem perder nada do que havia.
//
//   node montar-teste.cjs
//   CHROMIUM_BIN=/opt/pw-browsers/chromium node testar-detalhamento-comparativo.cjs
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
  await irPara(pag, 'Indicadores Gerais', 1500);

  const fecharModal = async () => {
    await pag.evaluate(() => {
      const bt = document.querySelector('.modal [data-c]');
      if (bt) bt.click();
    });
    await pag.waitForTimeout(250);
  };

  /** Lê a estrutura do detalhamento que está aberto na tela. */
  const lerDetalhe = () => pag.evaluate(() => {
    const area = document.querySelector('.modal [data-comparativo]');
    if (!area) return null;
    const cab = area.querySelector('.det-comp-cab');
    return {
      cabecalho: cab ? cab.textContent.replace(/\s+/g, ' ').trim() : '',
      // Largura cheia: cada camada ocupa a mesma caixa, uma abaixo da outra.
      largura: Math.round(area.getBoundingClientRect().width),
      camadas: [...area.querySelectorAll('.camada')].map((s) => {
        const bt = s.querySelector('.camada-bt');
        const corpo = s.querySelector('.camada-corpo');
        return {
          id: s.dataset.camada,
          rotulo: s.querySelector('.camada-rot').textContent.trim(),
          valor: s.querySelector('.camada-val').textContent.replace(/\s+/g, ' ').trim(),
          aberta: bt.getAttribute('aria-expanded') === 'true',
          controla: bt.getAttribute('aria-controls') === corpo.id && !!corpo.id,
          escondido: corpo.hidden,
          montado: !!corpo.dataset.montado,
          largura: Math.round(s.getBoundingClientRect().width),
          linhasNaArvore: corpo.querySelectorAll('[data-arvore-det] tbody tr').length,
        };
      }),
    };
  });

  const abrirCamada = async (id) => {
    await pag.evaluate((c) => document.querySelector(`.camada[data-camada="${c}"] .camada-bt`).click(), id);
    await pag.waitForTimeout(220);
  };

  // Os indicadores do Financeiro, pelo rótulo do cartão. `multiMes` diz se o
  // detalhamento cobre o recorte inteiro — é onde a quarta camada existe.
  const INDICADORES = [
    { chave: 'teto-gasto', nome: 'Objetivo 03 — teto de gasto', multiMes: false },
    { chave: 'custo-mes-a-mes', nome: 'Farol 1 — custo mês a mês', multiMes: false },
    { chave: 'plano-reducao', nome: 'Objetivo 01 — plano de redução', multiMes: true },
    { chave: 'rateio', nome: 'Objetivo 02 — despesas compartilhadas', multiMes: true },
    { chave: 'custo-recorrente', nome: 'Farol 2 — custo recorrente', multiMes: true },
  ];

  console.log('\nESTRUTURA — as camadas existem em todo indicador do Financeiro');
  const vistos = [];
  for (const ind of INDICADORES) {
    const achou = await pag.evaluate((c) => {
      const k = document.querySelector(`.kpi.drill[data-kpi="${c}"]`)
        || [...document.querySelectorAll('.kpi.drill')].find((e) => e.dataset.kpi === c);
      if (!k) return false;
      k.scrollIntoView({ block: 'center' });
      k.click();
      return true;
    }, ind.chave);
    if (!achou) { console.log(`  · ${ind.nome}: indicador ausente neste recorte`); continue; }
    await pag.waitForTimeout(700);

    const d = await lerDetalhe();
    if (!d) { ok(`${ind.nome}: o detalhamento comparativo abre`, false, 'nenhuma área comparativa'); continue; }
    vistos.push(ind.nome);

    const ids = d.camadas.map((c) => c.id);
    const esperados = ind.multiMes ? ['dif', 'veio', 'ant', 'recorte'] : ['dif', 'veio', 'ant'];
    ok(`${ind.nome}: as camadas certas, na ordem certa`,
      ids.join(',') === esperados.join(','), ids.join(' → '));
    ok(`${ind.nome}: todas nascem fechadas`,
      d.camadas.every((c) => !c.aberta && c.escondido), d.camadas.map((c) => c.aberta).join(','));
    ok(`${ind.nome}: nenhum corpo foi montado antes do clique`,
      d.camadas.every((c) => !c.montado));
    ok(`${ind.nome}: cada botão anuncia o corpo que controla`,
      d.camadas.every((c) => c.controla));
    // Largura cheia: a diferença entre a camada e a área é só a borda.
    ok(`${ind.nome}: as camadas ocupam a largura toda`,
      d.camadas.every((c) => Math.abs(c.largura - d.largura) <= 2),
      `área ${d.largura}px · camadas ${[...new Set(d.camadas.map((c) => c.largura))].join('/')}px`);
    ok(`${ind.nome}: o cabeçalho diz o mês filtrado e o de comparação`,
      /\d{2}\/\d{4} vs (\d{2}\/\d{4}|sem base)/.test(d.cabecalho), d.cabecalho.slice(0, 90));
    ok(`${ind.nome}: a camada 2 anuncia o total do mês sem precisar abrir`,
      /R\$/.test(d.camadas[1].valor), d.camadas[1].valor);

    await fecharModal();
  }
  ok('os cinco indicadores do Financeiro foram alcançados', vistos.length === INDICADORES.length,
    `${vistos.length} de ${INDICADORES.length}`);

  // ------------------------------------------------ o corpo chega no clique
  console.log('\nSOB DEMANDA — o corpo só é montado quando a camada abre');
  await pag.evaluate(() => {
    const k = document.querySelector('.kpi.drill[data-kpi="teto-gasto"]');
    if (k) { k.scrollIntoView({ block: 'center' }); k.click(); }
  });
  await pag.waitForTimeout(700);

  const antes = await lerDetalhe();
  if (antes) {
    await abrirCamada('veio');
    const depois = await lerDetalhe();
    const c2a = antes.camadas[1], c2d = depois.camadas[1];
    ok('fechada, a camada não tinha árvore nenhuma', c2a.linhasNaArvore === 0);
    ok('aberta, a camada traz a árvore inteira', c2d.linhasNaArvore > 0, `${c2d.linhasNaArvore} linha(s)`);
    ok('aberta, o estado é anunciado', c2d.aberta && !c2d.escondido);
    ok('as outras camadas continuam fechadas e não montadas',
      [depois.camadas[0], depois.camadas[2]].every((c) => !c.aberta && !c.montado));

    // Fechar e reabrir não remonta: o corpo já está lá.
    await abrirCamada('veio');
    const fechada = await lerDetalhe();
    ok('fechar esconde o corpo mas o conserva',
      !fechada.camadas[1].aberta && fechada.camadas[1].escondido && fechada.camadas[1].montado);

    // A árvore de dentro continua operável — é a mesma de antes da mudança.
    await abrirCamada('veio');
    const arvore = await pag.evaluate(async () => {
      const corpo = document.querySelector('.camada[data-camada="veio"] .camada-corpo');
      const bt = corpo.querySelector('[data-abrir-no]');
      if (!bt) return null;
      const antesN = corpo.querySelectorAll('[data-arvore-det] tbody tr:not([hidden])').length;
      bt.click();
      await new Promise((r) => setTimeout(r, 120));
      return { antes: antesN, depois: corpo.querySelectorAll('[data-arvore-det] tbody tr:not([hidden])').length };
    });
    ok('a árvore dentro da camada ainda abre os níveis',
      !!arvore && arvore.depois > arvore.antes, arvore ? `${arvore.antes} → ${arvore.depois}` : 'sem nós');

    // ------------------------------------------------------------- teclado
    console.log('\nTECLADO — a camada abre pelo foco e pelo Enter');
    await abrirCamada('veio');  // volta a fechar
    const porTeclado = await pag.evaluate(async () => {
      const bt = document.querySelector('.camada[data-camada="ant"] .camada-bt');
      bt.focus();
      const focado = document.activeElement === bt;
      const contorno = getComputedStyle(bt, ':focus-visible').outlineWidth;
      bt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      bt.click();  // o navegador converte Enter em clique num <button>
      await new Promise((r) => setTimeout(r, 200));
      return { focado, contorno, aberta: bt.getAttribute('aria-expanded') === 'true' };
    });
    ok('o cabeçalho da camada recebe foco', porTeclado.focado);
    ok('o foco é visível', porTeclado.contorno !== '0px', porTeclado.contorno);
    ok('Enter abre a camada', porTeclado.aberta);
  } else {
    ok('o detalhamento do teto de gasto abre', false, 'nenhuma área comparativa');
  }
  await fecharModal();

  // ----------- camada 1: a variação na MESMA árvore da composição, 4 níveis
  //
  // Tipo de despesa → empresa → filial → título lançado, igual à camada 2:
  // quem desce a árvore de uma não pode ter de reaprender a da outra. O que
  // muda são as colunas — ali um valor, aqui os dois meses e a diferença.
  //
  // A conferência que importa é a SOMA, em cada nível: se os deltas dos filhos
  // não fecharem com o pai, uma das contas está errada e a tela não denuncia
  // qual.
  console.log('\nCAMADA 1 — a variação na árvore de quatro níveis');
  await pag.evaluate(() => {
    const k = document.querySelector('.kpi.drill[data-kpi="teto-gasto"]');
    k.scrollIntoView({ block: 'center' }); k.click();
  });
  await pag.waitForTimeout(700);
  await abrirCamada('dif');

  const lerArvore = () => pag.evaluate(() => {
    const corpo = document.querySelector('.camada[data-camada="dif"] .camada-corpo');
    const moeda = (t) => {
      const m = t.match(/R\$\s*([\d.]+,\d{2})/);
      return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null;
    };
    const linha = (tr) => {
      const td = [...tr.querySelectorAll('td')];
      const cls = (td[3].querySelector('.delta') || {}).className || '';
      return {
        nivel: Number(([...tr.classList].find((c) => c.startsWith('nivel-')) || '').replace('nivel-', '')),
        nome: td[0].textContent.replace(/\s+/g, ' ').trim(),
        pai: tr.dataset.pai || null, no: tr.dataset.no || null,
        atual: moeda(td[1].textContent), anterior: moeda(td[2].textContent),
        dif: moeda(td[3].textContent),
        // O sinal, para a soma poder ser feita.
        sinal: cls.includes('desce') ? -1 : cls.includes('sobe') ? 1 : 0,
        temVer: !!tr.querySelector('[data-ver-variacao]'),
        temBalao: !!td[4].querySelector('[data-dica]'),
      };
    };
    return {
      colunas: [...corpo.querySelectorAll('thead th')].map((t) => t.textContent.trim()),
      linhas: [...corpo.querySelectorAll('tbody tr')].map(linha),
      totalCab: moeda(document.querySelector('.camada[data-camada="dif"] .camada-val').textContent),
    };
  });
  const a = await lerArvore();
  const porNivel = (n) => a.linhas.filter((l) => l.nivel === n);

  ok('o cabeçalho anuncia os quatro níveis',
    a.colunas[0] === 'Tipo / empresa / filial / título', a.colunas[0]);
  ok('as colunas trazem os dois meses e a diferença',
    /^\d{2}\/\d{4}$/.test(a.colunas[1]) && /^\d{2}\/\d{4}$/.test(a.colunas[2])
      && a.colunas[3] === 'Diferença', a.colunas.join(' | '));
  ok('os quatro níveis existem', [1, 2, 3, 4].every((n) => porNivel(n).length > 0),
    [1, 2, 3, 4].map((n) => `n${n}=${porNivel(n).length}`).join(' · '));
  ok('o nível 1 é o TIPO de despesa, e não a empresa',
    porNivel(1).length < porNivel(2).length,
    `${porNivel(1).length} tipo(s) · ${porNivel(2).length} empresa(s)`);
  ok('só o nível 1 nasce visível',
    a.linhas.filter((l) => !l.pai).length === porNivel(1).length);
  ok('cada linha tem balão e botão de ver', a.linhas.every((l) => l.temBalao && l.temVer));

  // A SOMA, nível a nível: os filhos fecham com o pai.
  const soma = (ls) => ls.reduce((s, l) => s + l.sinal * l.dif, 0);
  ok('a soma dos deltas do nível 1 é o total da camada',
    Math.abs(Math.abs(soma(porNivel(1))) - a.totalCab) < 0.01,
    `${soma(porNivel(1)).toFixed(2)} × ${a.totalCab}`);
  const filhosDe = (no) => a.linhas.filter((l) => l.pai === no);
  const paisQuebrados = a.linhas.filter((l) => l.no).filter((pai) => {
    const f = filhosDe(pai.no);
    return f.length && Math.abs(soma(f) - pai.sinal * pai.dif) > 0.011;
  });
  ok('em todo nível, os filhos somam o pai', paisQuebrados.length === 0,
    paisQuebrados.slice(0, 3).map((p) => `${p.nome.slice(0, 24)}: ${soma(filhosDe(p.no)).toFixed(2)} × ${(p.sinal * p.dif).toFixed(2)}`).join(' | ')
      || `${a.linhas.filter((l) => l.no).length} nó(s) conferidos`);
  // E cada linha fecha consigo mesma.
  ok('em cada linha, atual menos anterior dá a diferença',
    a.linhas.every((l) => Math.abs(Math.abs(l.atual - l.anterior) - l.dif) < 0.011));
  ok('o sentido da cor bate com o sinal', a.linhas.every((l) =>
    (l.atual < l.anterior ? l.sinal === -1 : l.atual > l.anterior ? l.sinal === 1 : l.sinal === 0)));
  // Ordem por variação absoluta, dentro de cada pai.
  const foraDeOrdem = [null, ...a.linhas.filter((l) => l.no).map((l) => l.no)]
    .map((pai) => a.linhas.filter((l) => l.pai === pai))
    .filter((irmaos) => irmaos.some((l, i, arr) => i > 0 && arr[i - 1].dif < l.dif));
  ok('cada nível vem por variação absoluta decrescente', foraDeOrdem.length === 0,
    foraDeOrdem.length ? `${foraDeOrdem.length} grupo(s) fora de ordem` : 'todos os grupos');

  console.log('\nCAMADA 1 — a folha é o TÍTULO, emparelhado entre os dois meses');
  const folha = await pag.evaluate(async () => {
    const corpo = document.querySelector('.camada[data-camada="dif"] .camada-corpo');
    for (let nivel = 1; nivel <= 3; nivel += 1) {
      const tr = [...corpo.querySelectorAll(`tbody tr.nivel-${nivel}`)].find((t) => !t.hidden);
      tr.querySelector('[data-abrir-no]').click();
      await new Promise((r) => setTimeout(r, 140));
    }
    const vis = [...corpo.querySelectorAll('tbody tr.nivel-4')].filter((t) => !t.hidden);
    return {
      quantas: vis.length,
      // Um título que existe nos DOIS meses aparece uma vez só, com os dois
      // valores — é o que a chave de recorrência compra. Sem ela, apareceria
      // duas vezes: uma como despesa nova, outra como despesa que cessou.
      nosDoisMeses: vis.filter((tr) => {
        const td = [...tr.querySelectorAll('td')];
        return !/R\$\s*0,00/.test(td[1].textContent) && !/R\$\s*0,00/.test(td[2].textContent);
      }).length,
      comMarca: vis.filter((tr) => tr.querySelector('.marca-novo, .marca-cessou')).length,
      titulosRepetidos: (() => {
        const n = vis.map((tr) => tr.querySelector('td').textContent.replace(/\s+/g, ' ').trim());
        return n.length - new Set(n).size;
      })(),
    };
  });
  ok('a folha traz títulos', folha.quantas > 0, `${folha.quantas} título(s)`);
  ok('nenhum título se repete na mesma filial', folha.titulosRepetidos === 0,
    `${folha.titulosRepetidos} repetido(s)`);
  ok('há título presente nos dois meses, numa linha só',
    folha.nosDoisMeses > 0, `${folha.nosDoisMeses} de ${folha.quantas}`);
  ok('quem só existe num dos meses vem marcado', folha.comMarca > 0,
    `${folha.comMarca} com marca "novo" ou "não veio"`);

  console.log('\nCAMADA 1 — o drill-down de um nó');
  const drill = await pag.evaluate(async () => {
    const corpo = document.querySelector('.camada[data-camada="dif"] .camada-corpo');
    corpo.querySelector('[data-ver-variacao]').click();
    await new Promise((r) => setTimeout(r, 500));
    const topo = [...document.querySelectorAll('.modal')].pop();
    return { modais: document.querySelectorAll('.modal').length,
      titulo: topo ? (topo.querySelector('h2, .tit') || {}).textContent.trim() : '',
      nota: topo ? topo.querySelector('.msg').textContent.replace(/\s+/g, ' ') : '',
      comps: topo
        ? [...new Set([...topo.querySelectorAll('tbody tr td:first-child')].map((t) => t.textContent.trim()))]
        : [] };
  });
  ok('o drill-down abre sobre o detalhamento', drill.modais === 2, `${drill.modais} tela(s)`);
  ok('o drill-down diz de quem é a variação', /^Variação de /.test(drill.titulo), drill.titulo);
  ok('o drill-down traz os DOIS meses', drill.comps.length === 2, drill.comps.join(' e '));
  ok('a nota diz quanto veio de cada mês',
    /lançamento\(s\) em \d{2}\/\d{4}, somando .+; \d+ em \d{2}\/\d{4}, somando/.test(drill.nota),
    drill.nota.slice(0, 120));
  await fecharModal(); await fecharModal();

  // ----------- camada 3: o mês anterior partido em veio, não veio e novos
  //
  // A asserção central é a CONFERÊNCIA DOS DOIS LADOS: veio + não veio é o mês
  // anterior inteiro, e repetidos + novos é o mês filtrado inteiro. Sem ela,
  // um erro de classificação sumiria entre três listas grandes.
  console.log('\nCAMADA 3 — veio × não veio, e os novos');
  await pag.evaluate(() => {
    const k = document.querySelector('.kpi.drill[data-kpi="teto-gasto"]');
    k.scrollIntoView({ block: 'center' }); k.click();
  });
  await pag.waitForTimeout(700);
  await abrirCamada('ant');
  const c3 = await pag.evaluate(() => {
    const corpo = document.querySelector('.camada[data-camada="ant"] .camada-corpo');
    const moeda = (t) => {
      const m = t.match(/R\$\s*([\d.]+,\d{2})/);
      return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null;
    };
    const num = (t) => Number((t.match(/(\d[\d.]*) lançamento/) || [])[1]?.replace(/\./g, '') || 0);
    const g = {};
    for (const s of corpo.querySelectorAll('.grupo-rec')) {
      g[s.dataset.grupo] = {
        rot: s.querySelector('.grupo-rot').textContent.trim(),
        soma: moeda(s.querySelector('.grupo-val').textContent),
        qtd: num(s.querySelector('.grupo-val').textContent),
        aberto: s.querySelector('.grupo-bt').getAttribute('aria-expanded') === 'true',
        nota: s.querySelector('.grupo-nota').textContent.trim().length,
        arvore: s.querySelectorAll('[data-arvore-det] table').length,
      };
    }
    const cab = (id) => {
      const s = [...document.querySelectorAll('.camada')].find((x) => x.dataset.camada === id);
      return moeda(s.querySelector('.camada-val').textContent);
    };
    return { g, confere: corpo.querySelector('.grupo-confere').textContent.replace(/\s+/g, ' ').trim(),
      divergiu: corpo.querySelector('.grupo-confere').classList.contains('erro'),
      totalAnterior: cab('ant'), totalFoco: cab('veio') };
  });
  ok('os três grupos existem', ['naoveio', 'veio', 'novos'].every((k) => c3.g[k]),
    Object.keys(c3.g).join(' · '));
  ok('só "não veio" nasce aberto',
    c3.g.naoveio.aberto && !c3.g.veio.aberto && !c3.g.novos.aberto,
    `naoveio=${c3.g.naoveio.aberto} veio=${c3.g.veio.aberto} novos=${c3.g.novos.aberto}`);
  ok('cada grupo traz subtotal e contagem',
    ['naoveio', 'veio', 'novos'].every((k) => c3.g[k].soma !== null && c3.g[k].qtd >= 0),
    ['naoveio', 'veio', 'novos'].map((k) => `${k}=${c3.g[k].soma}/${c3.g[k].qtd}`).join(' · '));
  ok('cada grupo explica o que significa',
    ['naoveio', 'veio', 'novos'].every((k) => c3.g[k].nota > 40));
  ok('o grupo aberto traz a MESMA árvore da composição', c3.g.naoveio.arvore === 1);
  // A conferência, calculada aqui e não lida da tela.
  ok('veio + não veio = o mês anterior inteiro',
    Math.abs(c3.g.veio.soma + c3.g.naoveio.soma - c3.totalAnterior) < 0.01,
    `${(c3.g.veio.soma + c3.g.naoveio.soma).toFixed(2)} × ${c3.totalAnterior}`);
  ok('a tela declara que confere, e não diverge', !c3.divergiu, c3.confere.slice(0, 80));
  ok('a frase de conferência traz os dois lados',
    /que veio \+.+que não veio =.+repetido \+.+novo =/.test(c3.confere), c3.confere.slice(0, 150));

  console.log('\nCAMADA 3 — abrir um grupo fechado monta a árvore dele');
  const abriuGrupo = await pag.evaluate(async () => {
    const corpo = document.querySelector('.camada[data-camada="ant"] .camada-corpo');
    const g = corpo.querySelector('.grupo-rec[data-grupo="novos"]');
    const antes = g.querySelectorAll('[data-arvore-det] tbody tr').length;
    g.querySelector('.grupo-bt').click();
    await new Promise((r) => setTimeout(r, 250));
    const depois = g.querySelectorAll('[data-arvore-det] tbody tr').length;
    // A árvore de dentro tem de ficar operável.
    const bt = g.querySelector('[data-abrir-no]');
    const visAntes = [...g.querySelectorAll('[data-arvore-det] tbody tr')].filter((t) => !t.hidden).length;
    if (bt) bt.click();
    await new Promise((r) => setTimeout(r, 150));
    return { antes, depois,
      anunciado: g.querySelector('.grupo-bt').getAttribute('aria-expanded') === 'true',
      visAntes, visDepois: [...g.querySelectorAll('[data-arvore-det] tbody tr')].filter((t) => !t.hidden).length };
  });
  ok('o grupo fechado não tinha árvore montada', abriuGrupo.antes === 0);
  ok('abrir monta a árvore', abriuGrupo.depois > 0, `${abriuGrupo.depois} linha(s)`);
  ok('o estado é anunciado', abriuGrupo.anunciado);
  ok('a árvore dentro do grupo abre os níveis',
    abriuGrupo.visDepois > abriuGrupo.visAntes, `${abriuGrupo.visAntes} → ${abriuGrupo.visDepois}`);
  await fecharModal();

  // -------------------------- todos os indicadores falam do MESMO par de meses
  //
  // O mês comparado sai do FIM DA JANELA, não do último mês que por acaso tem
  // linha na lista. A diferença aparece quando um indicador para de ter
  // movimento antes do fim do recorte: o plano de redução e o rateio podem não
  // ter nada no último mês, e pela regra antiga eles comparavam o penúltimo
  // contra o antepenúltimo enquanto os vizinhos comparavam o último contra o
  // penúltimo — dois detalhamentos abertos lado a lado falavam de meses
  // diferentes sem dizer isso.
  console.log('\nMESMO PAR — todo detalhamento compara o fim da janela contra o mês anterior');
  const pares = [];
  for (const ind of INDICADORES) {
    const achou = await pag.evaluate((c) => {
      const k = document.querySelector(`.kpi.drill[data-kpi="${c}"]`);
      if (!k) return false;
      k.scrollIntoView({ block: 'center' }); k.click(); return true;
    }, ind.chave);
    if (!achou) continue;
    await pag.waitForTimeout(700);
    const d = await lerDetalhe();
    if (d) {
      const m = d.cabecalho.match(/(\d{2}\/\d{4}) vs (\d{2}\/\d{4})/);
      pares.push({ nome: ind.nome, par: m ? `${m[1]} vs ${m[2]}` : d.cabecalho.slice(0, 40) });
    }
    await fecharModal();
  }
  const distintos = [...new Set(pares.map((p) => p.par))];
  ok('todos os indicadores comparam o mesmo par de meses', distintos.length === 1,
    pares.map((p) => `${p.nome.split(' ')[0]}=${p.par}`).join(' · '));
  // E esse par é o fim da janela do bloco contra o mês anterior a ele.
  const esperado = await pag.evaluate(() => {
    const r = recorteDoBloco('financeiro');
    const fim = r.ate || mesFechadoMaisRecente();
    return `${mesExib(fim)} vs ${mesExib(mesSoma(fim, -1))}`;
  });
  ok('o par é o fim da janela contra o mês anterior', distintos[0] === esperado,
    `${distintos[0]} · esperado ${esperado}`);

  // ------------------------------------------- recorte: a quarta camada soma
  console.log('\nRECORTE — a camada 4 é a que fecha com o indicador');
  await pag.evaluate(() => {
    const k = document.querySelector('.kpi.drill[data-kpi="custo-recorrente"]');
    if (k) { k.scrollIntoView({ block: 'center' }); k.click(); }
  });
  await pag.waitForTimeout(700);
  const rec = await lerDetalhe();
  if (rec && rec.camadas.length === 4) {
    const moeda = (t) => Number((t.match(/R\$\s*([\d.]+,\d{2})/) || [])[1]
      ?.replace(/\./g, '').replace(',', '.')) || 0;
    const doMes = moeda(rec.camadas[1].valor);
    const doRecorte = moeda(rec.camadas[3].valor);
    ok('o recorte inteiro soma mais que o último mês sozinho', doRecorte >= doMes,
      `recorte ${doRecorte} · mês ${doMes}`);
    // A lista e o mês comparado são coisas diferentes e podem não terminar
    // juntos; o cabeçalho diz as duas.
    ok('o cabeçalho diz o que a lista cobre e de onde vem a comparação',
      /a lista cobre \d{2}\/\d{4} a \d{2}\/\d{4}; a comparação é do fim da janela/.test(rec.cabecalho),
      rec.cabecalho.slice(0, 120));
  } else {
    ok('o detalhamento de recorte traz quatro camadas', false,
      rec ? `${rec.camadas.length} camada(s)` : 'nenhuma área comparativa');
  }
  await fecharModal();

  console.log(`\n=== erros de console: ${erros.length ? erros.slice(0, 5).join(' | ') : 'nenhum'} ===`);
  console.log(`=== ✗=${falhas.length} ===`);
  if (falhas.length) falhas.forEach((f) => console.log('  ✗ ' + f));
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
