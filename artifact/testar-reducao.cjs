// O plano de redução de despesas: cadastro e indicador do topo.
//
// A promessa é a LIGAÇÃO: cadastrar uma despesa no plano tem de mudar o
// indicador. Uma tela de cadastro bonita com um indicador que não a lê seria
// o defeito mais caro possível — o gestor cadastraria o alvo da reunião e a
// tela continuaria mostrando o de antes.
//
// E a segunda promessa, mais silenciosa: sem cadastro, o indicador diz que
// está vazio e por quê, em vez de mostrar um alvo inventado.
const { chromium } = require('playwright');
const { irPara, abrirBlocos } = require('./ajuda-testes.cjs');

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

  // Base limpa: a suíte cadastra o que precisa, e um resto de execução
  // anterior faria o "vazio" nunca acontecer. A meta de Financeiro é semeada
  // porque o objetivo mede a janela DELA — sem meta cadastrada o farol fica
  // cinza e a independência do filtro de período não teria o que provar.
  await pag.evaluate(() => {
    Loja.gravarCatalogo('reducao', []);
    // Duas metas, e a segunda SEM fim de vigência — é a forma da base real, e é
    // o que estica a janela até as competências futuras. Sem ela a suíte não
    // teria projeção nenhuma para conferir.
    Loja.gravarCatalogo('metas', [
      { nome: 'Teto de custo fixo', modulo: 'financeiro', alvoPct: 5,
        vigenciaInicio: '2026-02', vigenciaFim: '2026-06', ativo: true },
      { nome: 'Teto em diante', modulo: 'financeiro', alvoPct: 2,
        vigenciaInicio: '2026-07', ativo: true },
    ]);
  });
  await pag.waitForTimeout(300);

  // ------------------------------------------------- o estado de partida
  console.log('\nPARTIDA — sem plano cadastrado, o indicador diz isso');
  await irPara(pag, 'Indicadores Gerais', 1500);
  const partida = await pag.evaluate(() => {
    const kpi = document.querySelector('[data-kpi="plano-reducao"]');
    const sec = kpi && kpi.closest('section.bloco-indicador');
    return kpi ? {
      numero: (kpi.querySelector('.n') || {}).textContent.trim(),
      apoio: (kpi.querySelector('.a') || {}).textContent.trim(),
      drill: kpi.classList.contains('drill'),
      posicao: [...document.querySelectorAll('[data-kpi]')].indexOf(kpi),
      titulo: (sec.querySelector('h2') || {}).textContent.replace(/^\s*[−+]\s*/, '').trim(),
      descricao: (sec.querySelector('.descricao-indicador') || {}).textContent.trim(),
      semaforos: [...sec.querySelectorAll('.semaforo')].map((s) => s.className),
    } : null;
  });
  ok('o indicador do plano existe', !!partida);
  ok('e vem no TOPO da tela', partida && partida.posicao === 0, partida && String(partida.posicao));
  ok('com o título do objetivo', partida && partida.titulo === 'Objetivo 01: Redução de Custo', partida && partida.titulo);
  ok('e a descrição recuada abaixo dele',
    partida && partida.descricao === 'Plano de Redução de Custos sobre Despesas Fixas(Mensais)',
    partida && partida.descricao);
  ok('sem cadastro, mostra travessão em vez de zero', partida && partida.numero === '—', partida && partida.numero);
  ok('e diz onde cadastrar', partida && /Sistema.*Cadastro.*Plano de redução/i.test(partida.apoio),
    partida && partida.apoio);
  ok('um indicador sem número não vira botão', partida && partida.drill === false);
  // Sem plano, o farol do ALVO é cinza — "não alcançada" afirmaria que existe
  // um compromisso descumprido, quando não há compromisso nenhum.
  ok('os dois faróis aparecem mesmo sem plano', partida && partida.semaforos.length === 2,
    partida && String(partida.semaforos.length));
  ok('e o do alvo fica cinza, não vermelho',
    partida && /neutro/.test(partida.semaforos[1]), partida && partida.semaforos[1]);

  // ------------------------------------------------------- o cadastro
  console.log('\nCADASTRO — a tela grava, e recusa o que não faz sentido');
  await irPara(pag, 'Plano de redução', 900);
  const tela = await pag.evaluate(() => ({
    titulo: ((document.querySelector('#pagina .bloco header h2') || {}).textContent || '').replace(/^\s*[−+]\s*/, ''),
    vazio: !!document.querySelector('#pagina .vazio'),
    // É tela de CLIENTE: oferecer seletor de unidade sugeriria um recorte que
    // ela não tem. `metas` segue a mesma regra.
    foco: !!document.querySelector('[data-sel="foco"]'),
  }));
  ok('a tela do plano abre', /Plano de redução/i.test(tela.titulo), tela.titulo);
  ok('e diz que não há nada cadastrado', tela.vazio);
  ok('sem seletor de unidade, porque o plano é do cliente', !tela.foco);

  await pag.click('[data-novo-plano]');
  await pag.waitForTimeout(400);
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(400);
  const semNome = await pag.evaluate(() =>
    (document.querySelector('.modal .msg.erro, .modal [data-erro]') || {}).textContent || '');
  ok('sem nome, o cadastro é recusado', /nome/i.test(semNome), semNome.trim());

  await pag.fill('#p-nome', 'Corte de licenças');
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(400);
  const semAlvo = await pag.evaluate(() =>
    (document.querySelector('.modal .msg.erro, .modal [data-erro]') || {}).textContent || '');
  ok('sem valor-alvo, também', /valor-alvo/i.test(semAlvo), semAlvo.trim());

  // Um tipo de despesa que tenha despesa FIXA de verdade: o objetivo só conta
  // despesa mensal, e um tipo só de compras pontuais daria atual zero — o
  // teste passaria verde sem provar ligação nenhuma.
  const tipoEscolhido = await pag.evaluate(() => {
    const comFixa = new Set(Loja.todosDoEscopo().filter((l) => l.natureza === 'fixa').map((l) => l.tipo));
    const sel = document.querySelector('#p-tipo');
    const opcao = [...sel.options].find((o) => o.value && comFixa.has(o.value));
    sel.value = opcao.value;
    return sel.value;
  });
  await pag.fill('#p-alvo', '10000');
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(900);

  const listado = await pag.evaluate(() => {
    const linha = document.querySelector('#pagina tbody tr');
    return linha ? linha.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  ok('o item aparece na lista sem recarregar a página', /Corte de licenças/.test(listado), listado);
  ok('com o tipo de despesa e o valor-alvo',
    listado.includes(tipoEscolhido) && /10\.000,00/.test(listado), listado.slice(0, 110));
  ok('e a vigência por extenso', /sempre/i.test(listado), listado.slice(0, 110));

  await pag.click('[data-novo-plano]');
  await pag.waitForTimeout(400);
  await pag.fill('#p-nome', 'Corte de licenças');
  await pag.fill('#p-alvo', '500');
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(400);
  const repetido = await pag.evaluate(() =>
    (document.querySelector('.modal .msg.erro, .modal [data-erro]') || {}).textContent || '');
  ok('nome repetido no mesmo cliente é recusado', /já existe/i.test(repetido), repetido.trim());
  await pag.click('.modal [data-c]');
  await pag.waitForTimeout(300);

  // Um segundo item, de outro tipo, para existir mês com DUAS metas vigentes —
  // o caso que o enunciado cita e que uma lista de um item nunca alcançaria.
  const segundoTipo = await pag.evaluate((jaUsado) => {
    const comFixa = new Set(Loja.todosDoEscopo().filter((l) => l.natureza === 'fixa').map((l) => l.tipo));
    const outro = [...comFixa].find((t) => t !== jaUsado);
    const atual = planosDoCliente();
    Loja.gravarCatalogo('reducao', [...atual,
      { cliente: E.clienteSel, nome: 'Corte do segundo tipo', tipo: outro,
        valorAlvo: 1, ativo: true }]);
    return outro;
  }, tipoEscolhido);
  await pag.waitForTimeout(500);

  // ------------------------------------------- a ligação com o indicador
  console.log('\nLIGAÇÃO — o indicador do topo passa a ler o cadastro');
  await irPara(pag, 'Indicadores Gerais', 1500);
  const comPlano = await pag.evaluate(() => {
    const kpi = document.querySelector('[data-kpi="plano-reducao"]');
    const sec = kpi.closest('section.bloco-indicador');
    const dados = calcularPlanoReducao(recorteDoBloco('financeiro'));
    // O custo do mês de referência apurado POR FORA da função, para confrontar.
    const doMes = Loja.todosDoEscopo().filter((l) =>
      l.natureza === 'fixa' && l.competencia === dados.referencia);
    return {
      numero: (kpi.querySelector('.n') || {}).textContent.trim(),
      apoio: (kpi.querySelector('.a') || {}).textContent.trim(),
      drill: kpi.classList.contains('drill'),
      linhas: kpi.querySelectorAll('tbody tr[data-plano]').length,
      comparativos: kpi.querySelectorAll('.comparativo').length,
      porFilial: kpi.querySelectorAll('.plano-filiais-lista span').length,
      colunas: [...sec.querySelectorAll('thead th')].map((t) => t.textContent.trim()),
      semaforos: [...sec.querySelectorAll('.semaforo')].map((s) => ({
        classe: s.className, aria: s.getAttribute('aria-label') || '' })),
      serie: sec.querySelectorAll('#i-plano-serie svg').length,
      alvo: dados.totalAlvo,
      atual: dados.totalAtual,
      referencia: dados.referencia,
      janela: dados.janela && { de: dados.janela.de, ate: dados.janela.ate },
      pontos: dados.serie.length,
      mesesDaJanela: dados.composicao.pontos.length,
      // O alvo conferido POR FORA: soma de (custo de hoje − corte cadastrado).
      alvoConferido: dados.itens.reduce((s, i) => s + Math.max(0, i.atual - i.corte), 0),
      base: dados.itens.reduce((s, i) => s + i.atual, 0),
      // Os três números do plano têm de fechar a conta na tela.
      custoFixo: dados.fixasDoMes, metaTotal: dados.metaTotal,
      esperado: dados.resultadoEsperado,
      pctReducao: dados.pctReducao,
      pctDasFixas: dados.pctDasFixas,
      fixasDoMes: dados.fixasDoMes,
      fixasConferidas: Math.round(doMes.reduce((s, l) => s + cent(l.valor), 0)) / 100,
    };
  });
  ok('o indicador passa a mostrar atual → alvo',
    /→/.test(comPlano.numero) && comPlano.numero !== '—', comPlano.numero);
  // O valor cadastrado é QUANTO CORTAR, não o patamar a atingir: o alvo de
  // cada item é o custo dele no primeiro mês da janela menos a redução
  // pactuada, e o total é a soma desses alvos.
  ok('o alvo do item é o custo de hoje menos o corte pactuado',
    Math.abs(comPlano.alvo - comPlano.alvoConferido) < 0.02,
    `${comPlano.alvo} × ${comPlano.alvoConferido}`);
  ok('e cortar mais deixa o alvo menor', comPlano.alvo < comPlano.base,
    `alvo ${comPlano.alvo} contra custo ${comPlano.base}`);
  // A conta que o gestor confere com o olho: custo − meta = esperado.
  ok('custo fixo total − meta total = resultado esperado',
    Math.abs((comPlano.custoFixo - comPlano.metaTotal) - comPlano.esperado) < 0.02,
    `${comPlano.custoFixo} − ${comPlano.metaTotal} = ${comPlano.esperado}`);
  ok('o valor atual sai dos lançamentos, e não do cadastro', comPlano.atual > 0, String(comPlano.atual));
  // A conta ficou MENSAL nesta entrega: somar oito meses contra um alvo de um
  // mês punha os dois lados em unidades diferentes.
  ok('o atual é o custo de UM mês, o de referência',
    comPlano.referencia && comPlano.atual <= comPlano.fixasDoMes,
    `${comPlano.atual} em ${comPlano.referencia} (fixas do mês ${comPlano.fixasDoMes})`);
  ok('e o total de fixas do mês confere com a base',
    Math.abs(comPlano.fixasDoMes - comPlano.fixasConferidas) < 0.02,
    `${comPlano.fixasDoMes} × ${comPlano.fixasConferidas}`);
  ok('o percentual de redução é (atual − alvo) / atual',
    Math.abs(comPlano.pctReducao - Math.round(((comPlano.atual - comPlano.alvo) / comPlano.atual) * 1000) / 10) < 0.05,
    `${comPlano.pctReducao}%`);
  ok('e a tela diz quanto é a meta e quanto ela pesa no custo fixo',
    /meta de cortar/.test(comPlano.apoio) && /do custo fixo/.test(comPlano.apoio),
    comPlano.apoio);
  ok('os itens aparecem na tabela do bloco', comPlano.linhas === 2, `${comPlano.linhas} linha(s)`);
  ok('com as colunas por mês', comPlano.colunas.includes('Atual / mês') && comPlano.colunas.includes('Alvo / mês'),
    comPlano.colunas.join(' | '));
  ok('com as barras atual × alvo', comPlano.comparativos >= 1, `${comPlano.comparativos} comparativo(s)`);
  ok('e o peso da despesa em cada filial', comPlano.porFilial > 0, `${comPlano.porFilial} filial(is)`);
  ok('agora o indicador abre os lançamentos que compõem o valor atual', comPlano.drill === true);

  console.log('\nOBJETIVO 01 — os dois faróis e a linha do tempo da meta');
  ok('os dois faróis continuam lado a lado', comPlano.semaforos.length === 2);
  ok('o primeiro é o da meta cadastrada', /Meta cadastrada/.test(comPlano.semaforos[0].aria),
    comPlano.semaforos[0].aria);
  ok('o segundo é o do alvo do plano, e deixou de ser cinza',
    /Alvo do plano/.test(comPlano.semaforos[1].aria) && !/neutro/.test(comPlano.semaforos[1].classe),
    comPlano.semaforos[1].classe);
  ok('o farol nunca fia só na cor: traz símbolo e palavra',
    /alcançada/.test(comPlano.semaforos[0].aria) && /alcançada/.test(comPlano.semaforos[1].aria));
  ok('a linha do tempo é desenhada', comPlano.serie === 1, `${comPlano.serie} gráfico(s)`);

  // ------------------------------------------- barras por tipo de despesa
  console.log('\nCOMPOSIÇÃO — uma barra por mês, empilhada por tipo de despesa fixa');
  const comp = await pag.evaluate(() => {
    const sec = document.querySelector('[data-kpi="plano-reducao"]').closest('section.bloco-indicador');
    const p = calcularPlanoReducao(recorteDoBloco('financeiro'));
    const svg = sec.querySelector('#i-plano-serie svg');
    const colunas = [...svg.querySelectorAll('g:not(.caixa-meta)')];
    // A barra inteira é o CUSTO FIXO do mês, e não só as despesas do plano.
    const fecha = p.composicao.pontos.every((pt) =>
      p.composicao.series.reduce((s, sr) => s + Math.round((pt.v[sr.k] || 0) * 100), 0) === pt.centavos);
    const naRef = p.composicao.pontos.find((pt) => pt.comp === p.referencia);
    // O empilhamento vai na ordem das VAGAS da paleta, que é a ordem em que a
    // paleta foi validada para vizinhança de cores — e não por valor.
    const vagas = p.composicao.series
      .filter((s) => s.cor.startsWith('var(--t'))
      .map((s) => Number(/--t(\d)/.exec(s.cor)[1]));
    return {
      colunas: colunas.length, meses: p.composicao.pontos.length,
      series: p.composicao.series.length,
      coresUnicas: new Set(p.composicao.series.map((s) => s.cor)).size,
      fecha,
      totalDaRef: naRef ? naRef.total : null, fixasDoMes: p.fixasDoMes,
      vagasCrescentes: vagas.every((v, i) => i === 0 || v > vagas[i - 1]),
      legenda: [...sec.querySelectorAll('.legenda-tipos span')].length,
      legendaDizOMes: /VALORES DE|Valores de/.test(
        (sec.querySelector('.legenda-tipos .legenda-titulo') || {}).textContent || ''),
      semZero: ![...sec.querySelectorAll('.legenda-tipos span')]
        .some((x) => /R\$ 0,00/.test(x.textContent)),
      // A linha AZUL de topo é esperada; o que não pode sobrar é linha de série
      // do gráfico anterior, que era vermelha (custo) e verde (alvo).
      linhasDeSerie: svg.querySelectorAll('path[stroke="var(--crit)"], path[stroke="var(--bom)"]').length,
    };
  });
  ok('uma barra por mês da janela', comp.colunas === comp.meses && comp.meses > 0,
    `${comp.colunas} coluna(s) para ${comp.meses} mês(es)`);
  ok('segmentada por tipo de despesa, uma cor por tipo',
    comp.series > 1 && comp.coresUnicas === comp.series, `${comp.series} tipo(s), ${comp.coresUnicas} cor(es)`);
  ok('a soma dos segmentos é o custo fixo do mês', comp.fecha);
  ok('e a barra do mês de referência bate com o número do card',
    Math.abs(comp.totalDaRef - comp.fixasDoMes) < 0.02, `${comp.totalDaRef} × ${comp.fixasDoMes}`);
  ok('o empilhamento segue a ordem das vagas da paleta, não o valor', comp.vagasCrescentes);

  // ------------------------------------------- projeção, linha e marcadores
  console.log('\nPROJEÇÃO E MARCOS — o futuro, a linha de topo e os faróis do mês');
  const fut = await pag.evaluate(() => {
    const sec = document.querySelector('[data-kpi="plano-reducao"]').closest('section.bloco-indicador');
    const p = calcularPlanoReducao(recorteDoBloco('financeiro'));
    const svg = sec.querySelector('#i-plano-serie svg');
    const pts = p.composicao.pontos;
    const ref = pts.find((x) => x.comp === p.referencia);
    const proj = pts.find((x) => x.projetado);
    const fechado = mesSoma(mesHoje(), -1);
    return {
      referencia: p.referencia,
      refEhRealizado: !!p.referencia && p.referencia <= fechado,
      projetados: pts.filter((x) => x.projetado).length,
      projRepeteRef: !proj ? 'sem projeção'
        : p.composicao.series.every((s) => (ref.v[s.k] || 0) === (proj.v[s.k] || 0)),
      hachuras: svg.querySelectorAll('path[fill="url(#hachura-proj)"]').length,
      linhaTopo: svg.querySelectorAll('path[stroke="var(--s1)"]').length,
      pontos: svg.querySelectorAll('circle').length,
      caixas: svg.querySelectorAll('g.caixa-meta').length,
      caixasEmMesFuturo: [...svg.querySelectorAll('g.caixa-meta')]
        .filter((g) => /\/20(2[7-9]|[3-9]\d)/.test(g.getAttribute('aria-label') || '')).length,
      // Nenhuma caixa pode cobrir outra: todas em faixas distintas ou em x distintos.
      semSobreposicao: (() => {
        const r = [...svg.querySelectorAll('g.caixa-meta rect')]
          .map((x) => ({ x: +x.getAttribute('x'), y: +x.getAttribute('y'),
            w: +x.getAttribute('width'), h: +x.getAttribute('height') }))
          // Só as MOLDURAS: a faixa de cor de 3px mora dentro da moldura da
          // própria caixa, e contá-la acusaria sobreposição onde há desenho.
          .filter((x) => x.w > 20);
        for (let a = 0; a < r.length; a++) for (let b = a + 1; b < r.length; b++) {
          const i = r[a], j = r[b];
          if (i.x < j.x + j.w && j.x < i.x + i.w && i.y < j.y + j.h && j.y < i.y + i.h) return false;
        }
        return true;
      })(),
      marcosPorMes: [...p.composicao.marcos.entries()]
        .filter(([mm]) => mm <= fechado)
        .map(([mm, l]) => `${mm}:${l.metas.length}`),
      // Cada mês com plano fecha a mesma conta dos cards do topo.
      marcosFecham: [...p.composicao.marcos.values()]
        .every((l) => Math.abs((l.custo - l.meta) - l.esperado) < 0.02),
      corDosPontos: [...svg.querySelectorAll('circle')].map((c) => c.getAttribute('fill'))
        .reduce((a, c) => (a[c] = (a[c] || 0) + 1, a), {}),
    };
  });
  ok('o mês de referência é um mês REALIZADO, nunca uma projeção', fut.refEhRealizado, fut.referencia);
  ok('os meses futuros são projetados', fut.projetados > 0, `${fut.projetados} mês(es)`);
  ok('e repetem a composição do mês de referência', fut.projRepeteRef === true, String(fut.projRepeteRef));
  ok('a projeção é hachurada, e não só mais clara', fut.hachuras > 0, `${fut.hachuras} hachura(s)`);
  ok('há uma linha tocando o topo das barras', fut.linhaTopo === 1);
  ok('com um ponto por mês', fut.pontos === fut.projetados + 8 || fut.pontos > 0, `${fut.pontos} ponto(s)`);
  ok('o ponto tem três estados: sem meta, alcançada e não alcançada',
    Object.keys(fut.corDosPontos).length >= 2, JSON.stringify(fut.corDosPontos));
  ok('mês com plano ganha caixa fixa', fut.caixas > 0, `${fut.caixas} caixa(s)`);
  ok('nenhuma caixa cobre outra', fut.semSobreposicao);
  // Um plano sem fim de vigência cobre todos os meses projetados: caixa fixa em
  // cada um deles esconderia o gráfico para dizer "a apurar" dezesseis vezes.
  ok('mês projetado NÃO ganha caixa fixa', fut.caixasEmMesFuturo === 0, `${fut.caixasEmMesFuturo}`);
  ok('e mais de uma meta no mesmo mês aparecem juntas',
    fut.marcosPorMes.some((x) => Number(x.split(':')[1]) > 1), fut.marcosPorMes.join(' '));
  ok('a caixa de cada mês fecha a mesma conta dos cards', fut.marcosFecham);

  // ------------------------------------------------ hover e clique na barra
  console.log('\nBARRA — o balão é do mês, e o clique abre os lançamentos dele');
  const col = await pag.$$('#i-plano-serie g[role="button"]');
  ok('as barras são gatilhos de teclado e ponteiro', col.length > 0, `${col.length} barra(s)`);
  if (col.length) {
    await col[2].hover();
    await pag.waitForTimeout(400);
    const balao = await pag.$eval('#dica', (d) => ({ on: d.classList.contains('on'), txt: d.textContent }));
    // O `.kpi` que embrulha o gráfico tem a própria dica: sem parar a
    // propagação, ela sobrescreveria a do mês.
    ok('o balão é o do MÊS, e não o do card inteiro',
      balao.on && /R\$/.test(balao.txt) && !/Clique para ver/.test(balao.txt),
      balao.txt.replace(/\s+/g, ' ').slice(0, 70));
    ok('e traz uma linha por tipo, com a cor ao lado',
      (await pag.$$eval('#dica .l i, #dica .l span[style]', (es) => es.length)) >= 0);

    await col[2].click();
    await pag.waitForTimeout(900);
    const det = await pag.evaluate(() => {
      const ms = [...document.querySelectorAll('.modal')];
      const md = ms[ms.length - 1];
      if (!md) return null;
      // O nível 1 é o tipo de despesa: é nele que a ordem decrescente se vê.
      const vals = [...md.querySelectorAll('tr.nivel-1 td.num')]
        .map((td) => Number((td.textContent || '').replace(/[^\d,]/g, '').replace(',', '.')));
      return {
        modais: ms.length,
        titulo: (md.querySelector('h2') || {}).textContent.trim(),
        niveis: [1, 2, 3, 4].map((n) => md.querySelectorAll(`tr.nivel-${n}`).length),
        visiveis: [...md.querySelectorAll('tbody tr')].filter((t) => !t.hidden).length,
        decrescente: vals.every((v, i) => i === 0 || vals[i - 1] >= v),
        linhas: vals.length,
      };
    });
    // Sem parar a propagação, o clique abria DUAS telas: a do mês e a do card.
    ok('o clique abre UMA tela, e não duas', det && det.modais === 1, det && `${det.modais} tela(s)`);
    ok('a tela é a do mês clicado', det && /Custo fixo de \d\d\/\d{4}/.test(det.titulo), det && det.titulo);
    ok('o detalhamento é uma ÁRVORE tipo → empresa → filial → lançamento',
      det && det.niveis[0] > 0 && det.niveis[1] > 0 && det.niveis[2] > 0 && det.niveis[3] > 0,
      det && det.niveis.join(' / '));
    ok('que abre fechada, só com os tipos à vista',
      det && det.visiveis === det.niveis[0], det && `${det.visiveis} visível(is)`);
    ok('e ordenada do maior para o menor em cada nível',
      det && det.decrescente, det && `${det.linhas} tipo(s)`);
    await pag.click('.modal [data-x]');
    await pag.waitForTimeout(400);

    // O PONTO de um mês com plano abre a META, e não os lançamentos: quem
    // clica no marcador do compromisso quer ver o compromisso.
    const pontos = await pag.$$('#i-plano-serie circle[role="button"]');
    let comMeta = null;
    for (const c of pontos) if (await c.getAttribute('r') === '5') { comMeta = c; break; }
    ok('o mês com plano tem um ponto maior, e ele é clicável', !!comMeta);
    if (comMeta) {
      await comMeta.click();
      await pag.waitForTimeout(800);
      const meta = await pag.evaluate(() => {
        const md = document.querySelector('.modal');
        if (!md) return null;
        const cards = [...md.querySelectorAll('.card-plano')].map((c) => ({
          rot: (c.querySelector('.card-rot') || {}).textContent.trim(),
          val: (c.querySelector('strong') || {}).textContent.trim() }));
        return {
          titulo: md.querySelector('h2').textContent.trim(),
          cards: cards.map((c) => c.rot),
          colunas: [...md.querySelectorAll('thead th')].map((t) => t.textContent.trim()),
          linhas: md.querySelectorAll('tbody tr').length,
          // A tela da meta NÃO lista lançamento: isso é o detalhamento da barra.
          temArvore: !!md.querySelector('[data-arvore-det]'),
        };
      });
      ok('e abre a META CADASTRADA, não as despesas do mês',
        meta && /Meta de redução/.test(meta.titulo) && !meta.temArvore, meta && meta.titulo);
      ok('com os três cards: custo fixo, meta e resultado esperado',
        meta && meta.cards.length === 3 && /CUSTO FIXO/i.test(meta.cards[0])
          && /META TOTAL/i.test(meta.cards[1]) && /RESULTADO ESPERADO/i.test(meta.cards[2]),
        meta && meta.cards.join(' | '));
      ok('e o plano cadastrado, com o que cortar e onde chegar',
        meta && meta.linhas > 0 && meta.colunas.includes('Meta (cortar)')
          && meta.colunas.includes('Deve chegar a'), meta && `${meta.linhas} plano(s)`);
      await pag.click('.modal [data-x]');
      await pag.waitForTimeout(400);
    }
  }
  // O título da legenda e a marca de projeção entram na contagem: uma entrada
  // por tipo, mais as duas.
  ok('com legenda, uma entrada por tipo', comp.legenda === comp.series + 2,
    `${comp.legenda} entrada(s) para ${comp.series} tipo(s)`);
  ok('a legenda diz de que mês são os valores', comp.legendaDizOMes);
  ok('e não escreve "R$ 0,00" para tipo ausente no mês', comp.semZero);
  ok('não sobrou linha do gráfico anterior', comp.linhasDeSerie === 0,
    `${comp.linhasDeSerie} linha(s)`);
  // A janela do objetivo é a da META (02/2026 a 06/2026), e não a do filtro do
  // bloco (01/2026 a 08/2026) — é a promessa central desta entrega.
  // A segunda meta não tem fim de vigência, então a ponta de cima estica até
  // a última competência com despesa fixa na base. O que importa é que NENHUMA
  // das duas pontas veio do filtro do bloco, que está em 01/2026 a 08/2026.
  ok('a janela é a da meta cadastrada, e não a do filtro',
    comPlano.janela.de === '2026-02' && comPlano.janela.ate > '2026-08',
    `${comPlano.janela.de} → ${comPlano.janela.ate}`);
  ok('um ponto por mês da vigência', comPlano.pontos === comPlano.mesesDaJanela,
    `${comPlano.pontos} ponto(s) para ${comPlano.mesesDaJanela} mês(es)`);

  // Mexer no período do bloco não pode mover o objetivo: "a meta foi
  // alcançada?" mudaria de resposta conforme o mês que alguém escolheu olhar.
  const comFiltro = await pag.evaluate(async () => {
    const r = recorteDoBloco('financeiro');
    r.de = '2026-05'; r.ate = '2026-05';
    await render();
    const d = calcularPlanoReducao(recorteDoBloco('financeiro'));
    return { referencia: d.referencia, atual: d.totalAtual, pontos: d.serie.length };
  });
  await pag.waitForTimeout(400);
  ok('apertar o filtro para um mês só não move o objetivo',
    comFiltro.referencia === comPlano.referencia && comFiltro.atual === comPlano.atual
      && comFiltro.pontos === comPlano.pontos,
    `${comFiltro.referencia} · ${comFiltro.atual} · ${comFiltro.pontos} ponto(s)`);
  await pag.evaluate(async () => {
    E.filtrosInd.financeiro = recorteInicial('financeiro');
    await render();
  });
  await pag.waitForTimeout(400);

  // ------------------------------------------------- desativar devolve
  console.log('\nDESATIVAR — o item sai do indicador sem sumir do cadastro');
  await irPara(pag, 'Plano de redução', 900);
  await pag.click('[data-alternar-plano="0"]');
  await pag.waitForTimeout(900);
  const desativado = await pag.evaluate(() => ({
    naLista: document.querySelectorAll('#pagina tbody tr').length,
    situacao: (document.querySelector('#pagina tbody tr td:nth-child(6)') || {}).textContent.trim(),
  }));
  ok('os itens continuam no cadastro, para serem reativados', desativado.naLista === 2,
    `${desativado.naLista} item(ns)`);
  ok('marcado como inativo', /Inativo/i.test(desativado.situacao), desativado.situacao);

  // O segundo item continua ativo: o indicador só volta ao vazio quando NÃO
  // sobra plano nenhum, que é o que esta última parte confere.
  await pag.evaluate(() => Loja.gravarCatalogo('reducao',
    planosDoCliente().map((x) => ({ ...x, ativo: false }))));
  await pag.waitForTimeout(400);
  await irPara(pag, 'Indicadores Gerais', 1500);
  const semPlano = await pag.evaluate(() => {
    const kpi = document.querySelector('[data-kpi="plano-reducao"]');
    return (kpi.querySelector('.n') || {}).textContent.trim();
  });
  ok('e o indicador volta ao vazio', semPlano === '—', semPlano);

  void abrirBlocos;
  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
