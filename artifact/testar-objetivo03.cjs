// OBJETIVO 03 — custos dentro de um teto de gasto mensal.
//
// Duas conferências decidem a entrega. A primeira é a PARTIÇÃO: `natureza` e
// `classificacao` são campos independentes, e um investimento fixo entraria em
// duas faixas se o corte fosse ingênuo — o "total = soma das três" deixaria de
// ser verdade. A segunda é o VEREDICTO: mês sem teto não é verde nem vermelho,
// porque não há contra o que comparar.
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
  await pag.evaluate(() => Loja.gravarCatalogo('metas', []));
  await pag.waitForTimeout(300);
  await irPara(pag, 'Indicadores Gerais', 2000);

  console.log('\nVAZIO — sem reconhecida, o indicador diz isso');
  const vazio = await pag.evaluate(() => {
    const kpi = document.querySelector('[data-kpi="teto-gasto"]');
    const sec = kpi && kpi.closest('section.bloco-indicador');
    const grupo = [...document.querySelectorAll('section.bloco-grupo')]
      .find((s) => s.querySelector('h2').textContent.replace(/^\s*[−+]\s*/, '').trim() === 'Objetivos');
    return kpi ? {
      ordem: [...grupo.querySelectorAll('[data-kpi]')].map((k) => k.dataset.kpi),
      titulo: sec.querySelector('h2').textContent.replace(/^\s*[−+]\s*/, '').trim(),
      descricao: (sec.querySelector('.descricao-indicador') || {}).textContent.trim(),
      numero: kpi.querySelector('.n').textContent.trim(),
      apoio: kpi.querySelector('.a').textContent.trim(),
      reconhecidas: Loja.todosDoEscopo().filter((l) => reconhecidoDe(l)).length,
    } : null;
  });
  ok('o Objetivo 03 existe', !!vazio);
  ok('na ORDEM 3 do grupo Objetivos',
    vazio && JSON.stringify(vazio.ordem) === JSON.stringify(['plano-reducao', 'rateio', 'teto-gasto']),
    vazio && vazio.ordem.join(' · '));
  ok('com o título do enunciado',
    vazio && vazio.titulo === 'Objetivo 03: Custos dentro de um teto de gastos', vazio && vazio.titulo);
  ok('e a descrição recuada',
    vazio && /despesas reconhecidas dentro de uma meta de teto de gasto mensal/.test(vazio.descricao));
  // A base real não tem nada reconhecido: o indicador tem de dizer isso em vez
  // de mostrar um zero, que se leria como "nada gasto".
  ok('a base não tem despesa reconhecida', vazio && vazio.reconhecidas === 0, vazio && String(vazio.reconhecidas));
  ok('e o vazio explica que só reconhecida entra',
    vazio && vazio.numero === '—' && /reconhecida/.test(vazio.apoio), vazio && vazio.apoio);

  console.log('\nCHEIO — reconhecer acende, e o teto julga');
  await pag.evaluate(async () => {
    const fechado = mesSoma(mesHoje(), -1);
    for (const emp of escopoEmpresas()) {
      for (const k of [...E.lanc.keys()].filter((x) => x.startsWith(emp + '__'))) {
        const comp = k.slice(emp.length + 2);
        if (comp > fechado) continue;
        const itens = Loja.itens(emp, comp);
        if (itens.length) await Loja.gravarMes(emp, comp, itens.map((x) => ({ ...x, reconhecido: true })));
      }
    }
    await Loja.gravarCatalogo('metas', [
      { cliente: E.clienteSel, nome: 'Teto fixas', modulo: 'financeiro', tipoMeta: 'objetivo-03',
        contextoTeto: 'fixas', valorTeto: 120000, alvoPct: 0, vigenciaInicio: null, vigenciaFim: null, ativo: true },
      { cliente: E.clienteSel, nome: 'Teto pontuais', modulo: 'financeiro', tipoMeta: 'objetivo-03',
        contextoTeto: 'variaveis', valorTeto: 30000, alvoPct: 0, vigenciaInicio: null, vigenciaFim: null, ativo: true },
    ]);
  });
  // Repintar de propósito: a tela JÁ está em Indicadores Gerais, e trocar de
  // aba para a mesma aba não remonta o DOM.
  await pag.evaluate(async () => { await render(); });
  await pag.waitForTimeout(1200);
  await pag.evaluate(() => [...document.querySelectorAll('.bloco.dobrado > header .bloco-dobra')]
    .forEach((b) => b.click()));
  await pag.waitForTimeout(600);

  const cheio = await pag.evaluate(() => {
    const kpi = document.querySelector('[data-kpi="teto-gasto"]');
    const sec = kpi.closest('section.bloco-indicador');
    const o = calcularObjetivo03(recorteDoBloco('financeiro'));
    const r = recorteDoBloco('financeiro');
    const universo = Loja.todosDoEscopo().filter((l) =>
      passaNoFiltro(E.cenariosSel, l.cenario) && naFilialDoBloco(l.filial, r) && naJanela(l.competencia, r));
    return {
      numero: kpi.querySelector('.n').textContent.trim(),
      apoio: kpi.querySelector('.a').textContent.trim(),
      // Três faixas + total + teto.
      linhas: sec.querySelectorAll('#i-obj3 svg path[stroke]').length,
      tetoTracejado: sec.querySelectorAll('#i-obj3 svg path[stroke-dasharray]').length,
      colunas: [...sec.querySelectorAll('#i-obj3 ~ .rol thead th, .rol-fixo thead th')]
        .map((t) => t.textContent.trim()),
      estados: [...sec.querySelectorAll('tbody tr[data-mes-obj3] td:last-child')].map((t) => t.textContent.trim()),
      arvore: sec.querySelectorAll('.arvore-unidades tr.nivel-1').length,
      // A partição: as três faixas somam o total, mês a mês.
      somaFecha: o.serie.every((p) => Math.abs(p.fixas + p.variaveis + p.investimentos - p.total) < 0.01),
      // E nenhum lançamento entra em duas faixas: a soma das faixas é a soma do
      // universo reconhecido daquele mês.
      cobreTudo: o.serie.every((p) =>
        Math.abs(p.total - reais(somaC(p.itens.map((l) => l.valor)))) < 0.01),
      soReconhecidas: o.registros.every((l) => reconhecidoDe(l)),
      // Só reconhecida entra: o universo tem mais lançamentos que o indicador.
      recorteMenor: o.registros.length <= universo.length,
      // O teto do mês é a soma dos vigentes — dois cadastrados, 120k + 30k.
      teto: o.referencia && o.referencia.teto,
      verdes: o.serie.filter((p) => p.dentro === true).length,
      vermelhos: o.serie.filter((p) => p.dentro === false).length,
      // Investimentos ficou sem teto: o aviso tem de aparecer.
      aviso: /Sem teto cadastrado/.test(sec.textContent),
      semTeto: o.semTeto,
    };
  });
  ok('o indicador acende', cheio.numero !== '—', cheio.numero);
  ok('o número traz total e teto', /\/ R\$/.test(cheio.numero), cheio.numero);
  ok('cinco linhas: três faixas, total e teto', cheio.linhas === 5, String(cheio.linhas));
  ok('e o teto é a linha tracejada', cheio.tetoTracejado === 1, String(cheio.tetoTracejado));
  ok('o racional tem coluna de teto e de diferença',
    cheio.colunas.includes('Teto') && cheio.colunas.includes('Diferença'), cheio.colunas.join(' | '));
  ok('só despesa reconhecida entra', cheio.soReconhecidas && cheio.recorteMenor);
  ok('total = soma das três faixas, mês a mês', cheio.somaFecha);
  ok('e nenhum lançamento entra em duas faixas', cheio.cobreTudo);
  ok('o teto do mês é a soma dos vigentes', cheio.teto === 150000, String(cheio.teto));
  ok('há mês dentro e mês estourado', cheio.verdes > 0 && cheio.vermelhos > 0,
    `${cheio.verdes} dentro · ${cheio.vermelhos} estouraram`);
  // A cor nunca é o único canal: a situação vem escrita.
  ok('a situação vem escrita, não só colorida',
    cheio.estados.some((e) => /dentro/.test(e)) && cheio.estados.some((e) => /estourou/.test(e)),
    [...new Set(cheio.estados)].join(' · '));
  ok('a expansão agrupa por empresa e filial', cheio.arvore > 0, String(cheio.arvore));
  ok('e o contexto sem teto é avisado',
    cheio.aviso && JSON.stringify(cheio.semTeto) === JSON.stringify(['investimentos']),
    cheio.semTeto.join(' · '));

  console.log('\nSEM TETO — o mês não é aprovado nem reprovado');
  const semTeto = await pag.evaluate(async () => {
    // Uma vigência que não alcança os meses da base: fica tudo sem teto.
    await Loja.gravarCatalogo('metas', [
      { cliente: E.clienteSel, nome: 'Teto futuro', modulo: 'financeiro', tipoMeta: 'objetivo-03',
        contextoTeto: 'fixas', valorTeto: 120000, alvoPct: 0,
        vigenciaInicio: '2030-01', vigenciaFim: null, ativo: true },
    ]);
    const o = calcularObjetivo03(recorteDoBloco('financeiro'));
    return { todosNulos: o.serie.every((p) => p.dentro === null), atinge: o.atinge, comTeto: o.mesesComTeto };
  });
  // `null` não é "dentro": pintar de verde um mês sem meta afirmaria uma
  // aprovação que ninguém deu.
  ok('sem teto vigente, nenhum mês recebe veredicto', semTeto.todosNulos);
  ok('e o indicador não se declara alcançado', semTeto.atinge === null, String(semTeto.atinge));
  ok('com o placar zerado, em vez de "0 de 0 dentro"', semTeto.comTeto === 0);

  console.log('\nCLIQUE — a tela diz de onde veio o estouro');
  await pag.evaluate(async () => {
    await Loja.gravarCatalogo('metas', [
      { cliente: E.clienteSel, nome: 'Teto fixas', modulo: 'financeiro', tipoMeta: 'objetivo-03',
        contextoTeto: 'fixas', valorTeto: 120000, alvoPct: 0, vigenciaInicio: null, vigenciaFim: null, ativo: true },
    ]);
    await render();
  });
  await pag.waitForTimeout(1200);
  await pag.evaluate(() => [...document.querySelectorAll('.bloco.dobrado > header .bloco-dobra')]
    .forEach((b) => b.click()));
  await pag.waitForTimeout(600);
  await pag.locator('tr[data-mes-obj3]').last().click();
  await pag.waitForTimeout(900);
  const clique = await pag.evaluate(() => {
    const valores = [...document.querySelectorAll('.modal tr.nivel-1')]
      .map((tr) => Number((tr.children[1] || {}).textContent.replace(/[^\d,]/g, '').replace(',', '.')))
      .filter((n) => n > 0);
    return {
      fundos: document.querySelectorAll('.fundo').length,
      titulo: (document.querySelector('.modal h2') || {}).textContent,
      nota: (document.querySelector('.modal .msg') || {}).textContent.replace(/\s+/g, ' '),
      decrescente: valores.every((x, i) => i === 0 || valores[i - 1] >= x),
    };
  });
  ok('a linha abre UMA tela', clique.fundos === 1, String(clique.fundos));
  ok('com os lançamentos do maior para o menor', clique.decrescente);
  ok('e a nota abre a conta nas três faixas',
    /em despesa fixa, .* em pontual e .* em investimento/.test(clique.nota), clique.nota.slice(0, 140));
  ok('dizendo se ficou dentro ou acima do teto',
    /(Dentro do teto|Acima do teto)/.test(clique.nota));

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
