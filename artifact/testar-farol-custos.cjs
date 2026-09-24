// FAROL 1 — variação dos custos fixos (mensais) e dos variáveis (pontuais).
//
// A promessa que mais importa é de NÃO PERDER: o Farol 1 absorve o antigo
// "Custo recorrente — variação no período", e a série dos fixos tem de sair
// número por número igual à que o indicador antigo produzia. Um indicador novo
// que muda o número do antigo em silêncio é pior do que não tê-lo.
//
// A segunda: fixos e variáveis são séries SEPARADAS, e despesa e investimento
// são distinguíveis por mais de um canal.
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
  await irPara(pag, 'Indicadores Gerais', 1800);

  console.log('\nCOMPOSIÇÃO — o bloco novo no lugar do antigo');
  const bloco = await pag.evaluate(() => {
    const kpi = document.querySelector('[data-kpi="custo-recorrente"]');
    const sec = kpi && kpi.closest('section.bloco-indicador');
    return kpi ? {
      titulo: sec.querySelector('h2').textContent.replace(/^\s*[−+]\s*/, '').trim(),
      numero: kpi.querySelector('.n').textContent.trim(),
      apoio: kpi.querySelector('.a').textContent.trim(),
      cards: sec.querySelectorAll('.card-plano').length,
      graficos: sec.querySelectorAll('[id^="i-farol-"] svg').length,
      tabelas: sec.querySelectorAll('.rol-fixo table').length,
      // A árvore por empresa e filial do custo fixo continua no bloco: era o
      // corpo do indicador antigo, e absorver não é descartar.
      arvore: sec.querySelectorAll('.arvore-unidades tr.nivel-1').length,
      legenda: !!sec.querySelector('.amostra-hachura'),
      drill: kpi.classList.contains('drill'),
    } : null;
  });
  ok('o bloco existe', !!bloco);
  ok('com o título do enunciado',
    bloco && /^Farol 1 - Variação dos custos Fixos\(Mensais\)/.test(bloco.titulo), bloco && bloco.titulo);
  ok('um card por grupo', bloco && bloco.cards === 2, bloco && String(bloco.cards));
  ok('um gráfico por grupo', bloco && bloco.graficos === 2, bloco && String(bloco.graficos));
  ok('uma tabela de variação por grupo', bloco && bloco.tabelas >= 2, bloco && String(bloco.tabelas));
  ok('a árvore por empresa e filial do antigo continua no bloco',
    bloco && bloco.arvore > 0, bloco && String(bloco.arvore));
  ok('e o drill-down continua funcionando', bloco && bloco.drill);

  console.log('\nABSORÇÃO — o dado do indicador antigo não muda');
  const absorcao = await pag.evaluate(() => {
    const r = recorteDoBloco('financeiro');
    const f = calcularFarolCustos(r);
    const antigo = calcularReducao(r);
    return {
      mesmaSerie: JSON.stringify(f.fixos.serie.map((p) => [p.comp, p.valor, p.variacao]))
        === JSON.stringify(antigo.serie.map((p) => [p.comp, p.valor, p.variacao])),
      mesmaVariacao: f.fixos.variacaoTotal === antigo.variacaoTotal,
      mesmaTendencia: f.fixos.tendencia === antigo.tendencia,
      mesmaEconomia: f.fixos.economia === antigo.economia,
      mesmasPontas: f.fixos.valorInicial === antigo.valorInicial && f.fixos.valorFinal === antigo.valorFinal,
      meses: f.fixos.serie.length,
    };
  });
  ok('a série dos fixos é a mesma, mês a mês e variação a variação',
    absorcao.mesmaSerie, `${absorcao.meses} mês(es)`);
  ok('a variação do período é a mesma', absorcao.mesmaVariacao);
  ok('a tendência é a mesma', absorcao.mesmaTendencia);
  ok('a economia é a mesma', absorcao.mesmaEconomia);
  ok('e as duas pontas são as mesmas', absorcao.mesmasPontas);

  console.log('\nSEPARAÇÃO — fixos e variáveis nunca somados');
  const separacao = await pag.evaluate(() => {
    const r = recorteDoBloco('financeiro');
    const f = calcularFarolCustos(r);
    const universo = Loja.todosDoEscopo().filter((l) =>
      passaNoFiltro(E.cenariosSel, l.cenario) && naFilialDoBloco(l.filial, r) && naJanela(l.competencia, r));
    return {
      soFixaNosFixos: f.fixos.itens.every((l) => l.natureza === 'fixa'),
      nenhumaFixaNosVariaveis: f.variaveis.itens.every((l) => l.natureza !== 'fixa'),
      // Nenhum lançamento fica de fora nem entra duas vezes.
      cobreOUniverso: f.fixos.itens.length + f.variaveis.itens.length === universo.length,
      variacoesDistintas: f.fixos.variacaoTotal !== f.variaveis.variacaoTotal,
      fixos: f.fixos.itens.length, variaveis: f.variaveis.itens.length, universo: universo.length,
    };
  });
  ok('só despesa fixa entra na série dos fixos', separacao.soFixaNosFixos);
  ok('e nenhuma fixa entra na dos variáveis', separacao.nenhumaFixaNosVariaveis);
  ok('juntas cobrem o recorte, sem sobra nem repetição', separacao.cobreOUniverso,
    `${separacao.fixos} + ${separacao.variaveis} = ${separacao.universo}`);
  ok('e as duas variações são medidas à parte', separacao.variacoesDistintas);

  console.log('\nCLASSIFICAÇÃO — investimento distinguível de despesa');
  const classificacao = await pag.evaluate(() => {
    const r = recorteDoBloco('financeiro');
    const f = calcularFarolCustos(r);
    const sec = document.querySelector('[data-kpi="custo-recorrente"]').closest('section.bloco-indicador');
    const conta = (g) => ({
      despesa: g.itens.filter((l) => l.classificacao !== 'investimento').reduce((s, l) => s + cent(l.valor), 0),
      investimento: g.itens.filter((l) => l.classificacao === 'investimento').reduce((s, l) => s + cent(l.valor), 0),
    });
    const cv = conta(f.variaveis);
    return {
      // A hachura é o SEGUNDO canal: sem ela, investimento e despesa seriam só
      // duas cores, e quem não separa matizes leria uma barra só.
      hachuras: sec.querySelectorAll('[id^="i-farol-"] svg pattern').length,
      legendaHachurada: !!sec.querySelector('.amostra-hachura'),
      // E o terceiro: a coluna escrita na tabela.
      colunaInvestimento: [...sec.querySelectorAll('.rol-fixo th')].some((t) => /Investimento/i.test(t.textContent)),
      somaBate: Math.abs(reais(cv.despesa + cv.investimento) - f.variaveis.total) < 0.01,
      despesaBate: Math.abs(reais(cv.despesa) - f.variaveis.despesa) < 0.01,
      investimentoBate: Math.abs(reais(cv.investimento) - f.variaveis.investimento) < 0.01,
      // A série mês a mês também tem de fechar com o total do mês.
      seriesFecham: [...f.fixos.serie, ...f.variaveis.serie]
        .every((p) => Math.abs(p.despesa + p.investimento - p.valor) < 0.01),
      pctInv: f.variaveis.pctInvestimento,
    };
  });
  ok('a barra do investimento é hachurada, além de colorida',
    classificacao.hachuras > 0, `${classificacao.hachuras} padrão(ões)`);
  ok('e a legenda mostra a mesma hachura', classificacao.legendaHachurada);
  ok('a tabela escreve o investimento em coluna própria', classificacao.colunaInvestimento);
  ok('despesa e investimento somam o total do grupo',
    classificacao.somaBate && classificacao.despesaBate && classificacao.investimentoBate);
  ok('e fecham também mês a mês', classificacao.seriesFecham);
  ok('o percentual de investimento é medido', classificacao.pctInv >= 0,
    `${classificacao.pctInv}% dos variáveis`);

  console.log('\nCOERÊNCIA — as duas medidas vêm nomeadas');
  const coerencia = await pag.evaluate(() => ({
    apoio: document.querySelector('[data-kpi="custo-recorrente"] .a').textContent.trim(),
  }));
  // "↓ em queda" ao lado de "+72,8%" sem rótulo lê-se como defeito: uma é ponta
  // a ponta, a outra é a média das metades, e as duas podem discordar.
  ok('o apoio nomeia "ponta a ponta" e "tendência"',
    /ponta a ponta/.test(coerencia.apoio) && /tendência/.test(coerencia.apoio), coerencia.apoio);

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
