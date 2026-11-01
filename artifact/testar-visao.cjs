// Como a tela se apresenta: blocos que abrem e fecham, os três modos de ver os
// números, e o selo de última atualização.
//
// São três promessas que o sistema passou a fazer ao gestor:
//   1. a tela abre enxuta, e o que ele abriu continua aberto amanhã;
//   2. os mesmos números podem ser lidos por mês ou por unidade, e a escolha
//      vale nas duas telas do financeiro;
//   3. todo número vem com a data da carga que o produziu.
const { chromium } = require('playwright');
const { irPara } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1000 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push('console: ' + m.text()); });
  const conferir = (rotulo, ok, detalhe = '') => {
    console.log(`  ${ok ? '✓' : '✗'} ${rotulo}${detalhe ? ': ' + detalhe : ''}`);
    if (!ok) falhas.push(rotulo + (detalhe ? ' — ' + detalhe : ''));
  };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  // Começa sem memória de dobra: é o primeiro acesso de quem abre o sistema.
  await pag.evaluate(() => { try { localStorage.removeItem('iarx-blocos-abertos'); } catch (e) {} });

  // --------------------------------------------------------------- acordeão
  console.log('\nBLOCOS — abrem fechados, e lembram o que foi aberto');
  // `irPara` do auxiliar abre os blocos; aqui o objeto do teste é justamente
  // o estado inicial, então a navegação é feita à mão.
  const irCru = async (modulo, aba) => {
    await pag.click(`#modulos button:text-is("${modulo}")`);
    await pag.waitForTimeout(150);
    await pag.click(`#abas button:text-is("${aba}")`);
    await pag.waitForTimeout(800);
  };
  await irCru('Controle Financeiro', 'Lançamentos');

  const inicial = await pag.evaluate(() => {
    const bts = [...document.querySelectorAll('#pagina .bloco[data-dobra] .bloco-dobra')];
    return {
      quantos: bts.length,
      todosFechados: bts.every((b) => b.getAttribute('aria-expanded') === 'false'),
      corpoEscondido: [...document.querySelectorAll('#pagina .bloco-corpo')].every((c) => c.hidden),
    };
  });
  conferir('a tela tem blocos dobráveis', inicial.quantos > 0, `${inicial.quantos} bloco(s)`);
  conferir('todos abrem FECHADOS', inicial.todosFechados, String(inicial.todosFechados));
  conferir('e o conteúdo deles não é mostrado', inicial.corpoEscondido, String(inicial.corpoEscondido));

  // Pelo teclado, porque o cabeçalho é um botão de verdade.
  await pag.focus('#pagina .bloco[data-dobra] .bloco-dobra');
  await pag.keyboard.press('Enter');
  await pag.waitForTimeout(300);
  const aberto = await pag.$eval('#pagina .bloco[data-dobra] .bloco-dobra', (b) => b.getAttribute('aria-expanded'));
  conferir('Enter no título abre o bloco (teclado, não só clique)', aberto === 'true', String(aberto));

  const guardado = await pag.evaluate(() => localStorage.getItem('iarx-blocos-abertos'));
  conferir('o que se abre é o que fica guardado', /\[".+"\]/.test(String(guardado)), String(guardado));

  // Sai da tela e volta: a escolha tem de sobreviver.
  await irPara(pag, 'Painel', 600);
  await irCru('Controle Financeiro', 'Lançamentos');
  const voltou = await pag.$eval('#pagina .bloco[data-dobra] .bloco-dobra', (b) => b.getAttribute('aria-expanded'));
  conferir('o bloco aberto continua aberto ao voltar', voltou === 'true', String(voltou));

  // ------------------------------------------------------------ modos de ver
  console.log('\nMODOS — os mesmos números por mês ou por unidade');
  const medir = () => pag.evaluate(() => ({
    blocos: document.querySelectorAll('#pagina .grade .bloco').length,
    pivot: document.querySelectorAll('table.pivot').length,
    ativo: (document.querySelector('.modo-visao button.ativo') || {}).textContent.trim(),
  }));
  const trocar = async (modo) => {
    await pag.click(`.modo-visao button[data-modo="${modo}"]`);
    await pag.waitForTimeout(700);
    return medir();
  };

  conferir('o seletor tem os três modos',
    (await pag.$$eval('.modo-visao button', (b) => b.length)) === 3, '3');

  const porFilial = await trocar('filial');
  conferir('blocos por filial: um bloco por filial, sem dinâmica',
    porFilial.blocos > 1 && porFilial.pivot === 0, `${porFilial.blocos} bloco(s)`);

  const porMatriz = await trocar('matriz');
  conferir('blocos por matriz: menos blocos que por filial, porque agrupa',
    porMatriz.blocos > 0 && porMatriz.blocos < porFilial.blocos,
    `${porMatriz.blocos} matriz(es) para ${porFilial.blocos} filial(is)`);

  const lista = await trocar('lista');
  conferir('lista traz a dinâmica de volta', lista.pivot === 1 && lista.blocos === 0, `pivot=${lista.pivot}`);

  // Os totais não podem mudar só porque o agrupamento mudou.
  const totalDe = async (modo) => {
    await trocar(modo);
    return pag.evaluate(() => {
      const num = (t) => { const m = /-?[\d.]+,\d{2}/.exec(t || ''); return m ? Math.round(Number(m[0].replace(/\./g, '').replace(',', '.')) * 100) : 0; };
      const blocos = [...document.querySelectorAll('#pagina .grade .bloco tfoot td:last-child')];
      if (blocos.length) return blocos.reduce((s, c) => s + num(c.textContent), 0);
      const rodape = document.querySelector('table.pivot tfoot td:last-child');
      return rodape ? num(rodape.textContent) : 0;
    });
  };
  const tFilial = await totalDe('filial');
  const tMatriz = await totalDe('matriz');
  const tLista = await totalDe('lista');
  conferir('o total é o mesmo nos três modos', tFilial === tMatriz && tMatriz === tLista,
    `${tFilial} / ${tMatriz} / ${tLista}`);

  // O modo é do financeiro inteiro, não de uma tela.
  await trocar('matriz');
  await irPara(pag, 'Relatório', 900);
  const noRelatorio = await medir();
  conferir('a escolha acompanha quem troca de tela', noRelatorio.ativo === 'Blocos por matriz', noRelatorio.ativo);
  await trocar('lista');

  // ------------------------------------------------------- última atualização
  console.log('\nÚLTIMA ATUALIZAÇÃO — todo número com a data da carga');
  const semCarga = await pag.textContent('#ultima-carga');
  conferir('sem carga, diz isso em vez de inventar data',
    /Nenhuma carga registrada/.test(semCarga), semCarga.trim());

  await pag.evaluate(async () => {
    const emp = matrizesDoClienteAtivo()[0];
    await E.db.doc('importacoes/' + emp).set({ itens: [
      { id: 'a', quando: '2026-09-15T22:06:00.000Z', status: 'concluida', modulo: 'financeiro', arquivo: 'base.xlsx' },
      // Mais recente, mas RECUSADA: não atualizou nada, e não pode contar.
      { id: 'b', quando: '2026-09-16T10:00:00.000Z', status: 'recusada', modulo: 'financeiro' },
    ] });
    E.cargas.clear();
  });
  await irPara(pag, 'Painel', 900);
  const comCarga = (await pag.textContent('#ultima-carga')).trim();
  conferir('mostra a data da última carga CONCLUÍDA',
    /15\/09\/2026 às \d\d:\d\d/.test(comCarga), comCarga);
  conferir('e ignora a carga recusada, ainda que mais recente',
    !/16\/09\/2026/.test(comCarga), comCarga);

  await irPara(pag, 'Projetos', 700);
  const foraDoFinanceiro = await pag.evaluate(() => document.querySelector('#ultima-carga').hidden);
  conferir('fora do financeiro o selo não aparece', foraDoFinanceiro === true, String(foraDoFinanceiro));

  console.log(`\n=== erros de console: ${erros.length ? erros.join(' | ') : 'nenhum'} ===`);
  if (erros.length) falhas.push('erros de console');
  console.log(falhas.length ? `\nFALHAS (${falhas.length}):\n- ` + falhas.join('\n- ') : '\nTudo certo.');
  await nav.close();
  process.exit(falhas.length ? 1 : 0);
})();
