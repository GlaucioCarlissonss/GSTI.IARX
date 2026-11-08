// Tarefas hierárquicas e Gantt agrupável.
//
// A hierarquia só vale se as regras valerem: sem ciclo, sem 4º nível, sem
// excluir um pai levando as filhas em silêncio. E o agrupamento só vale se o
// que some da tela não sumir do cronograma — daí a barra agregada.
const { chromium } = require('playwright');
const { irPara } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  const falhas = [], erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push('console: ' + m.text()); });
  const confere = (rotulo, obtido, esperado) => {
    const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
    console.log(`  ${ok ? '✓' : '✗'} ${rotulo}: ${JSON.stringify(obtido)}${ok ? '' : ' (esperado ' + JSON.stringify(esperado) + ')'}`);
    if (!ok) falhas.push(rotulo);
  };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 15000 });

  // Monta um projeto com 3 níveis direto no estado, que é o que as demais
  // suítes já fazem quando o objeto do teste não é o formulário.
  console.log('\nREGRAS — o que a hierarquia recusa');
  const regras = await pag.evaluate(() => {
    const t = [
      { id: 'a', nome: 'Levantamento', inicio: '2026-01', fimPlanejado: '2026-02', fimReal: null, paiId: null },
      { id: 'b', nome: 'Entrevistas', inicio: '2026-02', fimPlanejado: '2026-04', fimReal: null, paiId: 'a' },
      { id: 'c', nome: 'Roteiro', inicio: '2026-03', fimPlanejado: '2026-06', fimReal: null, paiId: 'b' },
    ];
    const tenta = (fn) => { try { fn(); return 'passou'; } catch (e) { return e.message; } };
    return {
      quartoNivel: tenta(() => validarPrincipal(t, 'c', null)),
      ciclo: tenta(() => validarPrincipal(t, 'c', 'a')),
      siMesma: tenta(() => validarPrincipal(t, 'a', 'a')),
      inexistente: tenta(() => validarPrincipal(t, 'zz', null)),
      valido: tenta(() => validarPrincipal(t, 'b', null)),
      ordem: tarefasEmOrdem(t).map((x) => `${x.nome}/n${x.nivel}/${x.filhas}f`),
      agregado: (() => { const r = tarefasEmOrdem(t)[0]; return [r.grupoInicio, r.grupoFim]; })(),
    };
  });
  confere('4º nível é recusado', /até 3 níveis/.test(regras.quartoNivel), true);
  confere('ciclo é recusado', /ciclo/.test(regras.ciclo), true);
  confere('a própria tarefa é recusada', /própria tarefa principal/.test(regras.siMesma), true);
  confere('tarefa inexistente é recusada', /não encontrada/.test(regras.inexistente), true);
  confere('vínculo válido passa', regras.valido, 'passou');
  confere('ordem de leitura é hierárquica', regras.ordem, ['Levantamento/n1/1f', 'Entrevistas/n2/1f', 'Roteiro/n3/0f']);
  confere('intervalo agregado cobre a subárvore', regras.agregado, ['2026-01', '2026-06']);

  // --- Gantt agrupado, pela interface
  console.log('\nGANTT — agrupar, comprimir e persistir');

  // O mock guarda os documentos em memória, então recarregar a página zera a
  // base: a semeadura precisa acontecer depois de cada carga.
  const semear = async () => {
    await pag.evaluate(async () => {
      const dono = escopoEmpresas()[0];
      // Só o projeto de teste, para as asserções não dependerem da posição
      // dele no meio dos projetos reais da base.
      await Loja.gravarProjetos(dono, [{
        id: 'proj-teste', nome: 'Projeto de teste', filial: null, status: 'em_andamento',
        inicio: '2026-01', fimPlanejado: '2026-12', fimReal: null, envolvidos: [],
        tarefas: [
          { id: 'a', nome: 'Levantamento', inicio: '2026-01', fimPlanejado: '2026-02', fimReal: null, paiId: null, responsavel: 'Ana' },
          { id: 'b', nome: 'Entrevistas', inicio: '2026-02', fimPlanejado: '2026-04', fimReal: null, paiId: 'a', responsavel: 'Bruno' },
          { id: 'c', nome: 'Roteiro', inicio: '2026-03', fimPlanejado: '2026-06', fimReal: null, paiId: 'b', responsavel: 'Ana' },
        ],
      }]);
      // A tela mostra o cliente inteiro; o filtro DELA recorta a unidade
      // semeada, para as asserções não dependerem da posição do projeto de
      // teste no meio dos projetos reais das outras unidades.
      filtroDaTela('projetos').empresas = new Set([dono]);
    });
    await irPara(pag, 'Projetos', 900);
  };

  await pag.evaluate(() => localStorage.removeItem('iarx-gantt-comprimidos'));
  await semear();

  // O nome vem do `title` da célula: o texto visível é truncado por ellipsis,
  // e é justamente por isso que a célula tem title.
  const nomesVisiveis = () =>
    pag.$$eval('#p-gantt-corpo tr:not([aria-hidden]) td.nome', (ts) => ts.map((t) => t.title));

  const expandido = await nomesVisiveis();
  confere('padrão é expandido: as 3 tarefas aparecem',
    ['Levantamento', 'Entrevistas', 'Roteiro'].every((n) => expandido.includes(n)), true);

  const bts = await pag.$$eval('#p-gantt-corpo .gantt-grupo', (bs) =>
    bs.map((b) => ({ exp: b.getAttribute('aria-expanded'), txt: b.textContent.trim(), tem: !!b.getAttribute('aria-label') })));
  confere('todo botão de grupo tem aria-expanded e aria-label',
    bts.length > 0 && bts.every((b) => b.exp === 'true' && b.txt === '−' && b.tem), true);

  // Comprime "Levantamento" pelo TECLADO.
  const alvo = await pag.$('#p-gantt-corpo .gantt-grupo[aria-label*="Levantamento"]');
  await alvo.focus();
  await pag.keyboard.press('Enter');
  await pag.waitForTimeout(700);

  const comprimido = await nomesVisiveis();
  confere('comprimir esconde a subárvore inteira, não só a filha direta',
    ['Entrevistas', 'Roteiro'].some((n) => comprimido.includes(n)), false);
  const estado = await pag.$eval('#p-gantt-corpo .gantt-grupo[aria-label*="Levantamento"]',
    (b) => ({ exp: b.getAttribute('aria-expanded'), txt: b.textContent.trim(), rot: b.getAttribute('aria-label') }));
  confere('o botão inverte estado, texto e rótulo',
    [estado.exp, estado.txt, /^Expandir/.test(estado.rot)], ['false', '+', true]);

  // A barra do grupo comprimido cobre o intervalo agregado (jan→jun = 6 meses),
  // e não só o da própria tarefa principal (jan→fev = 2 meses).
  const barra = await pag.$eval('#p-gantt-corpo tr:nth-child(2) .barra',
    (b) => ({ titulo: b.title, largura: parseFloat(b.style.width) }));
  console.log('    barra do grupo:', barra.titulo, '·', barra.largura + 'px');
  confere('a barra comprimida mostra o intervalo do grupo', /01\/2026 → 06\/2026/.test(barra.titulo), true);
  confere('e tem a largura dos 6 meses, não dos 2 do pai', barra.largura, 6 * 38 - 4);

  // Persistência entre navegações e entre cargas da página.
  await irPara(pag, 'Painel', 500);
  await irPara(pag, 'Projetos', 800);
  confere('o estado sobrevive a sair e voltar da tela',
    (await nomesVisiveis()).includes('Entrevistas'), false);

  await pag.reload();
  await pag.waitForSelector('#modulos button', { timeout: 15000 });
  await semear();
  confere('e sobrevive a recarregar a página',
    (await nomesVisiveis()).includes('Entrevistas'), false);

  await pag.click('#p-abrir');
  await pag.waitForTimeout(700);
  const reaberto = await nomesVisiveis();
  confere('"Expandir tudo" traz as três de volta',
    ['Levantamento', 'Entrevistas', 'Roteiro'].every((n) => reaberto.includes(n)), true);

  await pag.click('#p-fechar');
  await pag.waitForTimeout(700);
  const tudoFechado = await nomesVisiveis();
  confere('"Comprimir tudo" deixa só a linha do projeto', tudoFechado, ['Projeto de teste']);

  // ------------------------------------------------ escolher a principal
  //
  // O gestor relatou o defeito aqui, e não nas regras: o campo era texto livre,
  // e um nome com acento errado devolvia "não existe essa tarefa" para uma
  // tarefa que existe. Num projeto sem tarefa nenhuma, pedia um nome que não
  // havia como fornecer.
  console.log('\nFORMULÁRIO — a tarefa principal se escolhe numa lista');
  await irPara(pag, 'Projetos', 900);
  await pag.click('#pagina tbody tr button:has-text("Abrir")');
  await pag.waitForTimeout(800);

  const campo = await pag.$eval('#t-pai', (s) => ({
    tag: s.tagName,
    desabilitado: s.disabled,
    opcoes: [...s.options].map((o) => o.textContent),
    valores: [...s.options].map((o) => o.value),
  }));
  confere('o campo é um seletor, não texto livre', campo.tag, 'SELECT');
  confere('a primeira opção deixa a tarefa no primeiro nível', campo.valores[0], '');
  confere('as opções guardam o id, não o nome',
    campo.valores.slice(1).every((v) => v && !campo.opcoes.includes(v)), true);
  // As três tarefas do projeto de teste: só as de nível 1 e 2 podem ser
  // principais, porque a de nível 3 não cabe ninguém abaixo.
  confere('o seletor traz as candidatas, e não quem já está no último nível',
    campo.opcoes.some((o) => /Levantamento/.test(o)) && !campo.opcoes.some((o) => /Roteiro/.test(o)), true);
  confere('a subtarefa aparece recuada, mostrando o nível',
    campo.opcoes.some((o) => /\u21b3/.test(o)), true);

  // Agrupar uma tarefa existente: seletor numa janela, não `prompt`.
  await pag.click('[data-tar] tbody tr:first-child [data-grp]');
  await pag.waitForTimeout(600);
  const janela = await pag.evaluate(() => {
    const s = document.querySelector('#g-pai');
    return { temSeletor: !!s, opcoes: s ? [...s.options].map((o) => o.textContent) : [] };
  });
  confere('agrupar abre um seletor com as candidatas', janela.temSeletor, true);
  // Nunca a própria tarefa: seria o caso trivial de ciclo, oferecido em tela.
  confere('o seletor não oferece a própria tarefa que está sendo agrupada',
    janela.opcoes.some((o) => /Levantamento/.test(o)), false);
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(400);
  confere('Escape fecha só a janela de agrupar, não a do projeto',
    await pag.evaluate(() => !document.querySelector('#g-pai') && !!document.querySelector('#t-pai')), true);

  console.log('\n=== falhas: ' + (falhas.length ? falhas.join('; ') : 'nenhuma') + ' ===');
  console.log('=== erros de console: ' + (erros.length ? '\n' + erros.join('\n') : 'nenhum') + ' ===');
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
