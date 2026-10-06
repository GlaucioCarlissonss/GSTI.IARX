// FAROL 2 — o que o financeiro lançou e ninguém reconheceu.
//
// A entrega move um indicador de tela: "Despesas por reconhecer" sai de
// Indicadores Gerais e vai para o Painel do Controle Financeiro, que é onde se
// resolve o que ele aponta. Em Indicadores Gerais fica o Farol 2, com o mesmo
// visual e absorvendo o antigo bloco solto "Por reconhecer, por centro de custo".
//
// A conferência que mais importa é a do MOVIMENTO: o bloco solto sumiu da fila,
// o indicador apareceu na outra tela, e nenhum dos dois abre duas telas
// flutuantes empilhadas — que é o defeito que essa mudança convida.
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
  const estado = () => pag.evaluate(() => ({
    fundos: document.querySelectorAll('.fundo').length,
    titulos: [...document.querySelectorAll('.modal h2')].map((h) => h.textContent),
  }));

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });

  console.log('\nINDICADORES GERAIS — o Farol 2 no lugar, e o bloco solto fora');
  await irPara(pag, 'Indicadores Gerais', 1800);
  const ind = await pag.evaluate(() => {
    const kpi = document.querySelector('[data-kpi="por-reconhecer"]');
    const sec = kpi && kpi.closest('section.bloco-indicador');
    return kpi ? {
      titulo: sec.querySelector('h2').textContent.replace(/^\s*[−+]\s*/, '').trim(),
      numero: kpi.querySelector('.n').textContent.trim(),
      apoio: kpi.querySelector('.a').textContent.trim(),
      // A estrutura do indicador antigo permanece: faixa, legenda e árvore.
      faixa: !!sec.querySelector('.faixa-matrizes'),
      legenda: !!sec.querySelector('.legenda-matrizes'),
      arvore: sec.querySelectorAll('.arvore-unidades tr.nivel-1').length,
      // E a tabela por centro passa a viver DENTRO dele.
      centrosDentro: sec.querySelectorAll('tr[data-centro]').length,
      // O bloco solto não pode ter sobrado na fila.
      blocoSolto: [...document.querySelectorAll('section.bloco > header > h2')]
        .some((h) => /Por reconhecer, por centro de custo/i.test(h.textContent)),
      // Nenhuma outra tabela de centro fora do farol.
      centrosNaTela: document.querySelectorAll('tr[data-centro]').length,
      drill: kpi.classList.contains('drill'),
    } : null;
  });
  ok('o Farol 2 existe', !!ind);
  ok('com o título do enunciado',
    ind && /^Farol 2 - Custos de Despesas lançadas pelo Financeiro que NÃO SÃO/.test(ind.titulo),
    ind && ind.titulo);
  ok('mantém a faixa e a legenda por empresa', ind && ind.faixa && ind.legenda);
  ok('mantém a árvore por empresa e filial', ind && ind.arvore > 0, ind && String(ind.arvore));
  ok('o "por centro de custo" passou para dentro dele',
    ind && ind.centrosDentro > 0, ind && String(ind.centrosDentro));
  ok('e não sobrou bloco solto na fila', ind && !ind.blocoSolto);
  ok('a tabela de centros existe uma vez só na tela',
    ind && ind.centrosNaTela === ind.centrosDentro,
    ind && `${ind.centrosNaTela} na tela · ${ind.centrosDentro} no farol`);
  ok('e o drill-down continua funcionando', ind && ind.drill);

  // O cartão do farol É um gatilho: sem barrar a propagação, clicar num centro
  // abriria a tela do centro POR BAIXO da do farol inteiro.
  await pag.locator('tr[data-centro]').first().click();
  await pag.waitForTimeout(700);
  const cliqueInd = await estado();
  ok('clicar num centro abre UMA tela, não duas empilhadas',
    cliqueInd.fundos === 1, `${cliqueInd.fundos} tela(s): ${cliqueInd.titulos.join(' | ')}`);
  ok('e ela é a do centro, não a do farol inteiro',
    /^Não reconhecido — /.test(cliqueInd.titulos[0] || ''), cliqueInd.titulos[0]);
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(400);

  console.log('\nCONTROLE FINANCEIRO — o indicador migrado');
  await irPara(pag, 'Painel', 1800);
  const painel = await pag.evaluate(() => {
    const c = document.querySelector('[data-pendentes]');
    const sec = c && c.closest('section.bloco');
    // A conta do painel tem de bater com o recorte DELE, e não com o do bloco
    // de indicadores: um número que não obedece ao filtro logo acima dele faz
    // duvidar dos dois.
    const base = Loja.todosDoEscopo().filter(noEscopo)
      .filter((l) => E.competencias.has(l.competencia) && noCenario(l));
    const pend = base.filter((l) => !reconhecidoDe(l));
    return c ? {
      titulo: sec.querySelector('h2').textContent.replace(/^\s*[−+]\s*/, '').trim(),
      numero: c.querySelector('.n').textContent.trim(),
      apoio: c.querySelector('.a').textContent.trim().replace(/\s+/g, ' '),
      faixa: !!c.querySelector('.faixa-matrizes'),
      arvore: c.querySelectorAll('.arvore-unidades tr.nivel-1').length,
      centros: c.querySelectorAll('tr[data-centro]').length,
      drill: c.classList.contains('drill'),
      esperado: reais(somaC(pend.map((l) => l.valor))),
      esperadoN: pend.length, universo: base.length,
    } : null;
  });
  ok('o indicador existe no Painel', !!painel);
  ok('com o nome que ele tinha', painel && painel.titulo === 'Despesas por reconhecer', painel && painel.titulo);
  ok('e a mesma estrutura: faixa, árvore e centros',
    painel && painel.faixa && painel.arvore > 0 && painel.centros > 0,
    painel && `árvore ${painel.arvore} · centros ${painel.centros}`);
  // Comparado como NÚMERO, e não como texto: o formato de moeda da página usa
  // espaço não separável, e um teste que compara strings quebraria por isso sem
  // que número nenhum estivesse errado.
  const numeroDoPainel = painel && Number(painel.numero.replace(/[^\d,]/g, '').replace(',', '.'));
  ok('o número obedece ao recorte DESTA tela',
    painel && Math.abs(numeroDoPainel - painel.esperado) < 0.01,
    painel && `${painel.numero} vs ${painel.esperado}`);
  ok('e a contagem também',
    painel && painel.apoio.startsWith(`${painel.esperadoN} de ${painel.universo} lançamentos`),
    painel && painel.apoio);
  ok('o cartão abre o detalhamento', painel && painel.drill);

  await pag.locator('tr[data-centro]').first().click();
  await pag.waitForTimeout(700);
  const cliquePainel = await estado();
  ok('e clicar num centro aqui também abre UMA tela',
    cliquePainel.fundos === 1, `${cliquePainel.fundos} tela(s): ${cliquePainel.titulos.join(' | ')}`);
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(400);

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
