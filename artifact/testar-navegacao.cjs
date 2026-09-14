// Navegação por módulo e alternância de tema.
//
// São as duas coisas que o gestor pediu depois de usar o sistema: separar
// visualmente Financeiro, Projetos e Suporte, e poder escolher claro ou escuro
// em qualquer tela. Ambas são estruturais — se quebrarem, quebram em todo lugar.
const { chromium } = require('playwright');
const { irPara, todasAsAbas } = require('./ajuda-testes.cjs');

const MODULOS_ESPERADOS = ['Indicadores Gerais', 'Controle Financeiro', 'Gestão de Projetos', 'Gestão de Suporte TI', 'Sistema'];

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push('console: ' + m.text()); });
  const conferir = (rotulo, ok, detalhe = '') => {
    console.log(`  ${ok ? '✓' : '✗'} ${rotulo}: ${detalhe}`);
    if (!ok) falhas.push(rotulo + (detalhe ? ' — ' + detalhe : ''));
  };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 15000 });

  // ---------------------------------------------------------------- módulos
  console.log('\nMÓDULOS — a separação que o gestor pediu');
  const modulos = await pag.$$eval('#modulos button', (bs) => bs.map((b) => b.textContent.trim()));
  conferir('os cinco módulos, nos rótulos combinados',
    JSON.stringify(modulos) === JSON.stringify(MODULOS_ESPERADOS), modulos.join(' | '));

  const telas = await todasAsAbas(pag);
  const por = (m) => telas.filter((t) => t.modulo === m).map((t) => t.aba);
  conferir('financeiro reúne painel, lançamentos, relatório e conferência',
    JSON.stringify(por('Controle Financeiro')) === JSON.stringify(['Painel', 'Lançamentos', 'Relatório', 'Conferência']),
    por('Controle Financeiro').join(', '));
  conferir('suporte reúne indicadores, chamados, as duas origens e as integrações',
    JSON.stringify(por('Gestão de Suporte TI'))
      === JSON.stringify(['Indicadores', 'Chamados', 'Sistema OStick', 'Sistema Bitrix24', 'Integrações']),
    por('Gestão de Suporte TI').join(', '));
  conferir('indicadores gerais é módulo de tela única, fora dos operacionais',
    JSON.stringify(por('Indicadores Gerais')) === JSON.stringify(['Indicadores Gerais']),
    por('Indicadores Gerais').join(', '));
  conferir('sistema reúne dados, cadastros, acessos e auditoria',
    JSON.stringify(por('Sistema')) === JSON.stringify(['Dados', 'Cadastros', 'Usuários e acessos', 'Auditoria']),
    por('Sistema').join(', '));
  // "Indicadores Gerais" é a leitura estratégica dos três módulos, e mora fora
  // deles de propósito — a regra aqui é sobre a OPERAÇÃO de suporte não vazar.
  conferir('nada de SLA ou chamado operacional fora do módulo de suporte',
    !telas.some((t) => t.modulo !== 'Gestão de Suporte TI' && t.modulo !== 'Indicadores Gerais'
      && /chamad|sla|indicad|ostick|bitrix/i.test(t.aba)),
    telas.filter((t) => t.modulo !== 'Gestão de Suporte TI' && t.modulo !== 'Indicadores Gerais')
      .map((t) => t.aba).join(', '));

  // Entrar num módulo abre a primeira tela dele.
  for (const m of MODULOS_ESPERADOS) {
    await pag.click(`#modulos button:text-is("${m}")`);
    await pag.waitForTimeout(500);
    const estado = await pag.evaluate(() => ({
      aba: E.aba,
      modulo: document.querySelector('#modulos button[aria-current="page"]').textContent.trim(),
      abasVisiveis: document.querySelector('#abas').hidden
        ? [] : [...document.querySelectorAll('#abas button')].map((b) => b.textContent.trim()),
      conteudo: document.querySelector('#pagina').textContent.trim().length,
    }));
    const esperadas = por(m);
    conferir(`${m} abre a própria tela`,
      estado.modulo === m && estado.conteudo > 60
        && JSON.stringify(estado.abasVisiveis) === JSON.stringify(esperadas.length > 1 ? esperadas : []),
      `aba=${estado.aba} · abas=${estado.abasVisiveis.join(',') || '(nenhuma — módulo de tela única)'}`);
  }

  // A tela de chamados é a que traz a tabela; a de indicadores, os gráficos.
  await irPara(pag, 'Indicadores', 700);
  const ind = await pag.evaluate(() => ({
    kpis: document.querySelectorAll('.kpi').length,
    chamados: !!document.querySelector('#s-chamados'),
  }));
  await irPara(pag, 'Chamados', 700);
  const cha = await pag.evaluate(() => ({
    kpis: document.querySelectorAll('.kpi').length,
    chamados: !!document.querySelector('#s-chamados'),
    linhas: document.querySelectorAll('#s-chamados tbody tr').length,
  }));
  conferir('indicadores mostram os KPIs e não a tabela de chamados',
    ind.kpis > 0 && !ind.chamados, `${ind.kpis} indicadores`);
  conferir('chamados mostram a tabela e não repetem os KPIs',
    cha.chamados && cha.kpis === 0, `${cha.linhas} linhas`);

  // A aba por origem é a mesma tela com o sistema fixado: traz a tabela e os
  // seus próprios indicadores, e dispensa o filtro de Sistema.
  await irPara(pag, 'Sistema OStick', 900);
  const ost = await pag.evaluate(() => ({
    titulo: (document.querySelector('#s-chamados h2') || {}).textContent || '',
    kpis: document.querySelectorAll('.kpi').length,
    filtro: !!document.querySelector('[data-sel="ssistema"]'),
    sistemas: [...new Set([...document.querySelectorAll('#s-chamados tbody tr')].map((tr) => tr.children[1].textContent.trim()))],
  }));
  conferir('a aba por origem traz só os chamados daquele sistema',
    ost.titulo === 'Sistema OStick' && ost.kpis === 3 && !ost.filtro
      && JSON.stringify(ost.sistemas) === JSON.stringify(['Sistema OStick']),
    `${ost.titulo} · ${ost.kpis} indicadores · ${ost.sistemas.join(', ')}`);

  // ------------------------------------------------------------------ tema
  console.log('\nTEMA — claro e escuro em qualquer tela');
  const lerTema = () => pag.evaluate(() => ({
    marca: document.documentElement.getAttribute('data-theme'),
    rotulo: document.querySelector('#bt-tema').textContent.trim(),
    fundo: getComputedStyle(document.body).backgroundColor,
    tinta: getComputedStyle(document.body).color,
    guardado: (() => { try { return localStorage.getItem('iarx-tema'); } catch (e) { return null; } })(),
  }));

  const sequencia = [];
  sequencia.push(await lerTema());
  for (let i = 0; i < 3; i++) {
    await pag.click('#bt-tema');
    await pag.waitForTimeout(450);
    sequencia.push(await lerTema());
  }
  // Ausência é significativa aqui: sem `data-theme` a página segue o aparelho.
  const ou = (v, vazio) => (v === null || v === undefined ? vazio : v);
  conferir('o botão cicla sistema → claro → escuro → sistema',
    sequencia.map((t) => ou(t.guardado, '(nada)')).join('|') === '(nada)|claro|escuro|sistema'
      && sequencia.map((t) => ou(t.marca, '(nenhum)')).join('|') === '(nenhum)|light|dark|(nenhum)',
    sequencia.map((t) => t.rotulo).join(' → '));

  const claro = sequencia[1], escuro = sequencia[2];
  conferir('as cores realmente trocam', claro.fundo !== escuro.fundo && claro.tinta !== escuro.tinta,
    `claro ${claro.fundo} / escuro ${escuro.fundo}`);

  // A escolha sobrevive a recarregar a página, e sem piscar no tema errado.
  await pag.evaluate(() => localStorage.setItem('iarx-tema', 'escuro'));
  await pag.reload();
  await pag.waitForSelector('#modulos button', { timeout: 15000 });
  const aposRecarga = await pag.evaluate(() => document.documentElement.getAttribute('data-theme'));
  conferir('a escolha sobrevive a recarregar', aposRecarga === 'dark', String(aposRecarga));

  // Percorre todas as telas nos dois temas: é o pedido "em todas as telas".
  for (const tema of ['escuro', 'claro']) {
    await pag.evaluate((t) => { localStorage.setItem('iarx-tema', t); }, tema);
    await pag.reload();
    await pag.waitForSelector('#modulos button', { timeout: 15000 });
    const ruins = [];
    for (const { aba } of telas) {
      await irPara(pag, aba, 450);
      const d = await pag.evaluate(() => {
        const corpo = getComputedStyle(document.body);
        const comoRgb = (c) => (c.match(/\d+/g) || []).slice(0, 3).map(Number);
        const [rf, gf, bf] = comoRgb(corpo.backgroundColor);
        const [rt, gt, bt] = comoRgb(corpo.color);
        const luz = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return {
          vazia: document.querySelector('#pagina').textContent.trim().length < 40,
          // Fundo e tinta precisam estar em lados opostos da escala; iguais
          // significa texto invisível, que é o defeito clássico de tema.
          contraste: Math.abs(luz(rf, gf, bf) - luz(rt, gt, bt)) > 120,
          transparente: corpo.backgroundColor === 'rgba(0, 0, 0, 0)',
          botao: !!document.querySelector('#bt-tema'),
        };
      });
      if (d.vazia || !d.contraste || d.transparente || !d.botao) ruins.push(aba);
    }
    conferir(`as ${telas.length} telas no tema ${tema}`, ruins.length === 0,
      ruins.length ? 'problema em: ' + ruins.join(', ') : 'todas com contraste e com o botão de tema');
  }

  console.log('\n=== falhas: ' + (falhas.length ? '\n' + falhas.join('\n') : 'nenhuma') + ' ===');
  console.log('=== erros de console: ' + (erros.length ? '\n' + erros.join('\n') : 'nenhum') + ' ===');
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
