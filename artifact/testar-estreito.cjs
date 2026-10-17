// O atalho de conteúdo e a tela estreita.
//
// Duas coisas que só aparecem quando se usa o sistema do jeito que ele não foi
// desenhado: com teclado, e num telefone.
//
//   1. ATALHO. Antes do conteúdo há a marca, o cartão do cliente, o tema,
//      cinco módulos e as abas do módulo. Quem navega por Tab atravessa tudo
//      isso em TODA tela, de novo. O atalho é a primeira parada e pula tudo —
//      e só vale se ele de fato MOVER O FOCO, não só a rolagem: sem isso, a
//      tabulação seguinte voltaria ao topo e o atalho não teria pulado nada.
//   2. 390px. Rolagem horizontal numa tela de telefone esconde coluna de
//      dinheiro à direita, e quem rola a página para o lado perde o rótulo da
//      linha. A tabela pode rolar dentro da caixa dela; a PÁGINA não pode.
const { chromium } = require('playwright');
const { irPara, abrirBlocos } = require('./ajuda-testes.cjs');

const TELAS = ['Indicadores Gerais', 'Painel', 'Lançamentos', 'Relatório', 'Conferência',
  'Indicadores', 'Chamados', 'Projetos', 'Dados', 'Clientes e unidades', 'Cadastros',
  'Metas', 'SLAs', 'Feriados', 'Usuários e acessos', 'Auditoria'];

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const falhas = [];
  const erros = [];
  const conferir = (r, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!ok) falhas.push(r); };

  // ------------------------------------------------- atalho, em largura normal
  const pag = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });

  console.log('\nATALHO DE CONTEÚDO');
  await pag.evaluate(() => document.body.focus());
  await pag.keyboard.press('Tab');
  await pag.waitForTimeout(320);
  const primeira = await pag.evaluate(() => ({
    classe: document.activeElement?.getAttribute('class'),
    txt: (document.activeElement?.textContent || '').trim(),
    visivel: document.activeElement?.getBoundingClientRect().top >= 0,
  }));
  conferir('a primeira tabulação da página é o atalho',
    primeira.classe === 'pular' && /Pular para o conteúdo/.test(primeira.txt), JSON.stringify(primeira));
  conferir('ele aparece ao receber foco (estava fora da tela)', primeira.visivel === true);

  await pag.keyboard.press('Enter');
  await pag.waitForTimeout(300);
  conferir('Enter move o FOCO para o conteúdo, não só a rolagem',
    await pag.evaluate(() => document.activeElement?.id === 'pagina'),
    await pag.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));
  const depois = await pag.evaluate(() => {
    const a = document.activeElement;
    return { dentroDaPagina: document.getElementById('pagina')?.contains(a) || a?.id === 'pagina' };
  });
  conferir('a tabulação seguinte já está dentro do conteúdo', depois.dentroDaPagina);
  await pag.close();

  // --------------------------------------------------------------- 390 px
  console.log('\n390 px — a PÁGINA não rola para o lado');
  const estreita = await nav.newPage({ viewport: { width: 390, height: 844 } });
  estreita.on('pageerror', (e) => erros.push('pageerror(390): ' + e.message));
  await estreita.goto('file://' + __dirname + '/teste-local.html');
  await estreita.waitForSelector('#modulos button', { timeout: 20000 });
  for (const tela of TELAS) {
    await irPara(estreita, tela, 700);
    await abrirBlocos(estreita);
    await estreita.waitForTimeout(400);
    const m = await estreita.evaluate(() => {
      const d = document.documentElement;
      // Quem é o culpado, quando há: o elemento mais largo que a janela e que
      // não está dentro de uma caixa de rolagem própria.
      let culpado = null;
      if (d.scrollWidth > d.clientWidth + 1) {
        for (const el of document.querySelectorAll('.pagina *')) {
          const r = el.getBoundingClientRect();
          if (r.right <= d.clientWidth + 1) continue;
          if (el.closest('.rol,.rol-fixo,.grade-spin,.kpi-corpo,.modulos,.abas,[data-arvore-det]')) continue;
          culpado = `${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').split(/\s+/)[0]}`
            + ` (direita ${Math.round(r.right)}px)`;
          break;
        }
      }
      return { scroll: d.scrollWidth, cliente: d.clientWidth, culpado };
    });
    const ok = m.scroll <= m.cliente + 1;
    conferir(tela, ok, ok ? '' : `${m.scroll} > ${m.cliente}${m.culpado ? ' · ' + m.culpado : ' · culpado fora da página'}`);
  }
  await estreita.close();

  console.log('\n=== erros de console: ' + (erros.length ? erros.join(' | ') : 'nenhum') + ' ===');
  await nav.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S): ` + falhas.join(' · ') : '\nTudo certo.');
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
