// O CRONOGRAMA DE ONDAS — a composição, as datas e a virada declarada.
//
// Esta suíte existe porque o cronograma é o número que vai à diretoria, e ele
// JÁ ESTEVE ERRADO: o sistema carregava a ordem antiga, em que a Paraíba
// virava em 01/10. O plano de ação que o cliente passou a usar inverteu as
// duas primeiras ondas — quem virou em 01/10 foram Porto Velho e Rio de
// Janeiro —, moveu São Paulo de outubro para janeiro e juntou cinco ondas em
// quatro. Nada disso aparece como erro na tela: o cronograma continua
// desenhando bonito, só que afirmando a coisa errada. Daí a conferência.
//
// A segunda metade protege a correção que veio junto: a Visão Macro pergunta
// "a unidade VIROU?", e isso não é a mesma pergunta que "as atividades dela
// acabaram". Uma unidade pode entrar em produção com pendências — Porto Velho
// e Rio são exatamente esse caso — e deduzir a virada da ausência de
// pendência faria a tela negar um fato informado pela gestão.
//
// Uso: CHROMIUM_BIN=/opt/pw-browsers/chromium node artifact/testar-cronograma-ondas.cjs
const { chromium } = require('playwright');

/** O cronograma que o PLANO DE AÇÃO publica — a régua desta conferência. */
const ESPERADO = [
  { n: 1, virada: '2026-10-01', unidades: ['MHC Porto Velho/RO', 'UC Rio de Janeiro/RJ'],
    realizada: '2026-10-01' },
  { n: 2, virada: '2026-11-03',
    unidades: ['HR João Pessoa/PB', 'HR Campina Grande/PB', 'MHC João Pessoa/PB'],
    realizada: null },
  { n: 3, virada: '2026-12-01',
    unidades: ['MHC Brasília/DF', 'MHC Goiânia/GO', 'MHC Cuiabá/MT', 'AHC Natal/RN',
      'HR Natal/RN', 'MHC Fortaleza/CE', 'AHC Aracaju/SE', 'HR Salvador/BA'],
    realizada: null },
  { n: 4, virada: '2027-01-04',
    unidades: ['HR Recife/PE', 'HR Maceió/AL', 'MHC Manaus/AM', 'UC São Paulo/SP'],
    realizada: null },
];

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

  const crono = await pag.evaluate(() => SPIN_ONDAS.map((o) => ({
    n: o.n, virada: o.virada, mes: o.mes, periodo: o.periodo,
    unidades: o.unidades, chaves: o.chaves, pacientes: o.pacientes,
    realizada: o.viradaRealizada || null,
  })));

  console.log('\nCOMPOSIÇÃO — o plano de ação é a régua');
  ok('são quatro ondas, e não cinco', crono.length === 4, `${crono.length} onda(s)`);
  for (const e of ESPERADO) {
    const o = crono.find((x) => x.n === e.n);
    if (!o) { ok(`a ${e.n}ª onda existe`, false); continue; }
    ok(`${e.n}ª onda: as unidades certas`,
      JSON.stringify(o.unidades) === JSON.stringify(e.unidades),
      o.unidades.join(' · '));
    ok(`${e.n}ª onda: vira em ${e.virada}`, o.virada === e.virada, o.virada);
  }

  // A inversão é o coração do erro antigo, e merece ser dita por extenso.
  console.log('\nA INVERSÃO — quem virou em 01/10 foram RO e RJ, não a Paraíba');
  const primeira = crono[0] || { unidades: [] };
  ok('a 1ª onda é Porto Velho + Rio de Janeiro',
    primeira.unidades.some((u) => /Porto Velho/i.test(u))
    && primeira.unidades.some((u) => /Rio de Janeiro/i.test(u)),
    primeira.unidades.join(' · '));
  ok('a Paraíba NÃO está na 1ª onda',
    !primeira.unidades.some((u) => /PB$/.test(u)), primeira.unidades.join(' · '));
  const paraiba = crono.find((o) => o.unidades.some((u) => /PB$/.test(u)));
  ok('a Paraíba está na 2ª, virando em 03/11',
    !!paraiba && paraiba.n === 2 && paraiba.virada === '2026-11-03',
    paraiba ? `${paraiba.n}ª em ${paraiba.virada}` : 'não encontrada');
  const sp = crono.find((o) => o.unidades.some((u) => /São Paulo/i.test(u)));
  ok('São Paulo saiu de outubro e foi para a 4ª',
    !!sp && sp.n === 4, sp ? `${sp.n}ª onda` : 'não encontrada');

  // As chaves são colunas do Controle Único, e acompanham a UNIDADE: movê-la
  // de onda não pode deixar a coluna para trás, nem levá-la para a errada.
  console.log('\nCHAVES DO CONTROLE ÚNICO — acompanham a unidade, não a onda');
  const chaveDe = (nome) => {
    for (const o of crono) {
      const i = o.unidades.indexOf(nome);
      if (i >= 0) return (o.chaves || [])[i] || '';
    }
    return null;
  };
  for (const [unidade, chave] of [
    ['MHC Porto Velho/RO', 'hm_ro'], ['UC Rio de Janeiro/RJ', 'uc_rj'],
    ['HR João Pessoa/PB', 'hr_pb'], ['HR Campina Grande/PB', 'hr_cg'],
    ['MHC João Pessoa/PB', 'hm_pb'], ['UC São Paulo/SP', 'uc_sp'],
  ]) {
    ok(`${unidade} → coluna ${chave}`, chaveDe(unidade) === chave, String(chaveDe(unidade)));
  }
  const todas = crono.flatMap((o) => o.chaves || []).filter(Boolean);
  ok('nenhuma coluna aparece em duas ondas', new Set(todas).size === todas.length,
    todas.join(','));
  ok('as 17 unidades continuam no cronograma',
    crono.reduce((s, o) => s + o.unidades.length, 0) === 17,
    String(crono.reduce((s, o) => s + o.unidades.length, 0)));

  console.log('\nPACIENTES — o total vale; a divisão por onda, não');
  ok('nenhuma onda finge saber quantos pacientes tem',
    crono.every((o) => o.pacientes === null),
    crono.map((o) => String(o.pacientes)).join(','));
  const total = await pag.evaluate(() => SPIN_PACIENTES_TOTAL);
  ok('o total segue sendo 1.922 — são as mesmas unidades, reagrupadas',
    total === 1922, String(total));

  // A VIRADA DECLARADA. É o que separa a Macro da Micro: a unidade virou
  // porque a gestão informou, não porque a planilha ficou sem pendência.
  console.log('\nVIRADA DECLARADA — fato informado vence dedução por pendência');
  ok('a 1ª onda traz a data realizada de 01/10',
    (crono[0] || {}).realizada === '2026-10-01', String((crono[0] || {}).realizada));
  ok('as demais não declaram virada nenhuma',
    crono.slice(1).every((o) => o.realizada === null),
    crono.slice(1).map((o) => String(o.realizada)).join(','));

  const macro = await pag.evaluate(() => {
    const c = calcularCronograma('2026-10');
    return c.ondas.map((o) => ({
      n: o.n, estado: o.estado, aderencia: o.aderencia,
      unidades: o.unidades.map((u) => ({
        nome: u.nome, estado: u.estado, virou: u.virou,
        declarada: !!u.viradaDeclarada, realizada: u.dataRealizada,
      })),
    }));
  });
  const o1 = macro.find((o) => o.n === 1) || { unidades: [] };
  ok('a 1ª onda consta CUMPRIDA mesmo sem a planilha fechar',
    o1.estado === 'CUMPRIDO', o1.estado);
  ok('e as duas unidades dela também',
    o1.unidades.length === 2 && o1.unidades.every((u) => u.estado === 'CUMPRIDO' && u.virou),
    o1.unidades.map((u) => `${u.nome}=${u.estado}`).join(' · '));
  ok('com a data realizada declarada, e não a planejada por dedução',
    o1.unidades.every((u) => u.declarada && u.realizada === '2026-10-01'),
    o1.unidades.map((u) => String(u.realizada)).join(' · '));
  ok('a aderência da 1ª onda é 100%', o1.aderencia === 100, String(o1.aderencia));
  // Sem declaração, nada vira sozinho: a onda 2 não pode herdar o CUMPRIDO.
  const o2 = macro.find((o) => o.n === 2) || {};
  ok('a 2ª onda NÃO é dada como virada', o2.estado !== 'CUMPRIDO', String(o2.estado));

  // ------------------------------------------- a entrega da onda como meta
  //
  // A pergunta da Macro é uma meta como qualquer outra: alvo (as unidades da
  // onda), resultado (quantas viraram) e prazo (o go-live). Dizê-la na mesma
  // linguagem dos outros indicadores é o que permite lê-la ao lado deles.
  console.log('\nA ENTREGA DA ONDA COMO META');
  const { irPara, abrirBlocos } = require('./ajuda-testes.cjs');
  await irPara(pag, 'Indicadores Gerais', 2500);
  await abrirBlocos(pag);
  await pag.waitForTimeout(1000);

  const tabela = await pag.evaluate(() => ({
    cabecalho: [...document.querySelectorAll('.cronograma thead th')]
      .map((t) => t.textContent.trim()),
    ondas: [...document.querySelectorAll('.cronograma tr.fase-linha')].map((tr) =>
      [...tr.cells].map((c) => c.textContent.replace(/\s+/g, ' ').trim())),
    // A unidade expandida não pode mais falar de atividade: isso é da Micro.
    unidades: [...document.querySelectorAll('.cronograma tr.unidade-linha')].map((tr) =>
      tr.textContent.replace(/\s+/g, ' ').trim()),
  }));
  ok('a coluna de aderência virou meta: Entregas + Atingimento',
    tabela.cabecalho.includes('Entregas') && tabela.cabecalho.includes('Atingimento')
      && !tabela.cabecalho.includes('Aderência'), tabela.cabecalho.join(' | '));
  ok('o go-live aparece em DIA, e não em mês',
    (tabela.ondas[1] || [])[1] && /03\/11\/2026/.test(tabela.ondas[1][1]),
    (tabela.ondas[1] || [])[1]);
  ok('a 1ª onda entrega 2 de 2, com 100% da meta',
    /2 de 2/.test((tabela.ondas[0] || [])[4] || '')
      && /100,0%/.test((tabela.ondas[0] || [])[5] || ''),
    `${(tabela.ondas[0] || [])[4]} · ${(tabela.ondas[0] || [])[5]}`);
  // A onda futura não é zero: zero afirmaria um fracasso que ninguém mediu.
  ok('a onda que ainda não venceu não aparece como 0%',
    tabela.ondas.slice(1).every((l) => /ainda não vence/.test(l[5] || '')),
    tabela.ondas.slice(1).map((l) => l[5]).join(' · '));
  ok('e ainda assim mostra o alvo dela',
    tabela.ondas.slice(1).every((l) => /\d+ de \d+ unidade/.test(l[4] || '')),
    tabela.ondas.slice(1).map((l) => l[4]).join(' · '));
  ok('a linha da unidade não fala mais de atividade',
    tabela.unidades.every((t) => !/atividade/i.test(t)),
    tabela.unidades.find((t) => /atividade/i.test(t)) || 'nenhuma menciona');

  // ------------------------------------------------- o detalhamento da Macro
  console.log('\nDETALHAMENTO — só unidades e prazos de virada');
  await pag.click('[data-viradas-onda="1"]');
  await pag.waitForTimeout(800);
  const modal = await pag.evaluate(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    return {
      titulo: ((m.querySelector('h2, .tit') || {}).textContent || '').trim(),
      colunas: [...m.querySelectorAll('thead th')].map((t) => t.textContent.trim()),
      linhas: [...m.querySelectorAll('tbody tr')].map((tr) =>
        [...tr.cells].map((c) => c.textContent.trim())),
      texto: m.textContent.replace(/\s+/g, ' '),
    };
  });
  if (!modal) {
    ok('o botão abre o detalhamento da virada', false, 'nenhum modal');
  } else {
    ok('o botão abre o detalhamento da virada', true);
    ok('o título nomeia a onda', /1ª onda/.test(modal.titulo), modal.titulo);
    // O PEDIDO: só unidades e prazos. Nenhuma coluna de atividade, status
    // consolidado, avanço ponderado ou criticidade — isso é da Micro.
    ok('as colunas são só unidade, onda, prazo, realizada e situação',
      modal.colunas.join('|') === 'Unidade|Onda|Prazo de virada|Virada realizada|Situação',
      modal.colunas.join(' | '));
    ok('nenhuma coluna de atividade vazou para cá',
      !/atividade|criticidade|avanço|executante/i.test(modal.colunas.join(' ')),
      modal.colunas.join(' | '));
    ok('lista as duas unidades da onda com o prazo de cada uma',
      modal.linhas.length === 2
        && modal.linhas.every((l) => /\d{2}\/\d{2}\/\d{4}/.test(l[2])),
      modal.linhas.map((l) => `${l[0]}=${l[2]}`).join(' · '));
    ok('e a virada realizada de quem já virou',
      modal.linhas.every((l) => l[3] === '01/10/2026'),
      modal.linhas.map((l) => l[3]).join(' · '));
    ok('a nota diz quantas viraram e quanto é da meta',
      /2 de 2 unidade\(s\) virada\(s\)/.test(modal.texto) && /100,0% da meta/.test(modal.texto),
      modal.texto.slice(0, 120));
  }
  await pag.evaluate(() => { const b = document.querySelector('.modal [data-c]'); if (b) b.click(); });
  await pag.waitForTimeout(300);

  // A onda futura abre igual, e diz que ainda não venceu.
  await pag.click('[data-viradas-onda="3"]');
  await pag.waitForTimeout(800);
  const futura = await pag.evaluate(() => {
    const m = document.querySelector('.modal');
    return m ? { linhas: m.querySelectorAll('tbody tr').length,
      texto: m.textContent.replace(/\s+/g, ' ') } : null;
  });
  ok('a onda sem coluna na planilha também abre, com as 8 unidades',
    !!futura && futura.linhas === 8, futura ? String(futura.linhas) : 'sem modal');
  ok('e diz que ela ainda não venceu, em vez de reprová-la',
    !!futura && /ainda não venceu/.test(futura.texto),
    (futura || {}).texto ? futura.texto.slice(0, 110) : '');
  await pag.evaluate(() => { const b = document.querySelector('.modal [data-c]'); if (b) b.click(); });
  await pag.waitForTimeout(300);

  // ------------------- o resultado de Projetos vem do cronograma
  //
  // O cartão media TAREFAS entregues no prazo, e numa base sem tarefa
  // cadastrada respondia "—" para sempre. O que a diretoria pergunta deste
  // módulo é se as unidades viraram no prazo combinado, e é isso que o
  // resultado passa a ser.
  console.log('\nRESULTADO DE PROJETOS — vem da entrega do cronograma');
  const porMes = await pag.evaluate(() => {
    const saida = {};
    for (const m of ['2026-08', '2026-09', '2026-10', '2026-11']) {
      const d = resultadoDoMes('projetos', m);
      saida[m] = { r: d.resultado, meta: d.meta, viradas: d.viradas, planejadas: d.planejadas };
    }
    return saida;
  });
  ok('antes da 1ª virada não há resultado — e não há zero',
    porMes['2026-09'].r === null && porMes['2026-09'].planejadas === 0,
    JSON.stringify(porMes['2026-09']));
  ok('em 10/2026 o resultado é 100%: as duas unidades viraram',
    porMes['2026-10'].r === 100 && porMes['2026-10'].viradas === 2
      && porMes['2026-10'].planejadas === 2, JSON.stringify(porMes['2026-10']));
  ok('a meta é 100% — o alvo é entregar a onda inteira',
    porMes['2026-10'].meta === 100, String(porMes['2026-10'].meta));
  // Acumulado: em novembro a 2ª onda já venceu e não virou, então o
  // resultado cai. Medir só as ondas do próprio mês faria o número sumir em
  // todo mês sem virada marcada.
  ok('em 11/2026 acumula a 2ª onda vencida: 2 de 5',
    porMes['2026-11'].viradas === 2 && porMes['2026-11'].planejadas === 5,
    JSON.stringify(porMes['2026-11']));

  console.log('\nMÊS EM CURSO — vale para virada, não para o que acumula');
  const meses = await pag.$$eval('[data-mes-resultados] option', (o) => o.map((x) => x.value));
  ok('o mês corrente entra na faixa, porque carrega uma virada fechada',
    meses.includes('2026-10'), meses.slice(0, 3).join(' · '));
  const cartoes = await pag.evaluate(() => {
    const ler = (mod) => {
      const c = document.querySelector(`.cartao-resultado[data-modulo="${mod}"]`);
      if (!c) return null;
      return { valor: (c.querySelector('.res-valor') || {}).textContent.trim(),
        texto: (c.querySelector('.res-texto') || {}).textContent.trim() };
    };
    return { financeiro: ler('financeiro'), projetos: ler('projetos'), sla: ler('sla') };
  });
  // Custo e conformidade ACUMULAM: meio mês contra a meta cheia reprovaria o
  // começo de todo mês. Mas "sem dados" seria falso — há dados, o mês é que
  // não fechou, e o cartão diz isso com todas as letras.
  ok('Financeiro no mês aberto diz que o mês está em curso, e não "sem dados"',
    /em curso/i.test((cartoes.financeiro || {}).texto || ''), (cartoes.financeiro || {}).texto);
  ok('SLA idem', /em curso/i.test((cartoes.sla || {}).texto || ''), (cartoes.sla || {}).texto);
  ok('Projetos é medido mesmo com o mês aberto: a virada é um fato datado',
    (cartoes.projetos || {}).valor === '100,0%'
      && /atingida/i.test((cartoes.projetos || {}).texto || ''),
    `${(cartoes.projetos || {}).valor} · ${(cartoes.projetos || {}).texto}`);

  console.log('\nVER REGISTROS de Projetos — unidades e prazos, não tarefas');
  await pag.click('.cartao-resultado[data-modulo="projetos"] .res-ver');
  await pag.waitForTimeout(900);
  const drill = await pag.evaluate(() => {
    const m = document.querySelector('.modal');
    if (!m) return null;
    return { titulo: ((m.querySelector('h2, .tit') || {}).textContent || '').trim(),
      colunas: [...m.querySelectorAll('thead th')].map((t) => t.textContent.trim()),
      linhas: m.querySelectorAll('tbody tr').length,
      texto: m.textContent.replace(/\s+/g, ' ') };
  });
  if (!drill) {
    ok('o cartão abre o detalhamento', false, 'nenhum modal');
  } else {
    ok('o cartão abre unidades e prazos, e não tarefas',
      drill.colunas.join('|') === 'Unidade|Onda|Prazo de virada|Virada realizada|Situação',
      drill.colunas.join(' | '));
    ok('com as duas unidades da onda vencida', drill.linhas === 2, String(drill.linhas));
    ok('e manda a execução atividade a atividade para a Visão Micro',
      /Visão Micro/.test(drill.texto));
  }
  await pag.evaluate(() => { const b = document.querySelector('.modal [data-c]'); if (b) b.click(); });
  await pag.waitForTimeout(300);

  console.log(`\n=== erros de console: ${erros.length ? erros.join(' | ') : 'nenhum'} ===`);
  console.log(`=== ✗=${falhas.length} ===`);
  if (falhas.length) falhas.forEach((f) => console.log('  ✗ ' + f));
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
