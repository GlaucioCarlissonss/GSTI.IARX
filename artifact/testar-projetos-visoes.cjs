// O BLOCO PROJETOS nos Indicadores Gerais — Entrega 1: posição, filtros e as
// duas visões.
//
// O que esta suíte protege é o ESQUELETO que as entregas 2 a 4 vão preencher:
// a ordem na pilha (Financeiro → Projetos → SLA), os filtros próprios do bloco
// — que agora incluem empresa e status — e as duas visões nomeadas, com os
// indicadores de execução dentro da Micro.
//
// A conferência menos óbvia é a do "Limpar filtros do bloco": o seletor de
// múltipla escolha tem um `data-limpar` próprio, e o casamento por atributo
// fazia o botão de dentro do painel resetar o bloco inteiro.
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
  const limpo = (t) => String(t || '').replace(/^[+−]\s*/, '').trim();

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  await irPara(pag, 'Indicadores Gerais', 2500);

  console.log('\nORDEM DA PILHA');
  const mods = await pag.evaluate(() => [...document.querySelectorAll('#pagina > section.bloco-modulo')]
    .map((m) => m.querySelector('h2').textContent.replace(/^[+−]\s*/, '').trim()));
  ok('Financeiro → Projetos → SLA',
    JSON.stringify(mods) === JSON.stringify(['Financeiro', 'Projetos', 'SLA']), mods.join(' → '));

  console.log('\nFILTROS PRÓPRIOS DO BLOCO');
  const f = await pag.evaluate(() => {
    const proj = [...document.querySelectorAll('#pagina > section.bloco-modulo')]
      .find((m) => m.querySelector('h2').textContent.includes('Projetos'));
    return {
      rotulos: [...proj.querySelectorAll(':scope > .bloco-corpo > .filtros .campo > label')]
        .map((l) => l.textContent.trim()),
      seletores: [...proj.querySelectorAll('[data-sel]')].map((d) => d.dataset.sel),
      // Só UM botão de limpar é do bloco; os outros pertencem aos painéis dos
      // seletores de múltipla escolha.
      doBloco: [...proj.querySelectorAll('button[data-limpar]')]
        .filter((b) => b.dataset.limpar).map((b) => b.textContent.trim()),
    };
  });
  ok('período, empresa, filial e status',
    JSON.stringify(f.rotulos) === JSON.stringify(['De', 'Até', 'Empresa (matriz)', 'Filial', 'Status da tarefa']),
    f.rotulos.join(' · '));
  ok('os três seletores têm alvo próprio',
    JSON.stringify(f.seletores) === JSON.stringify(['i-projetos-empresa', 'i-projetos-filial', 'i-projetos-status']),
    f.seletores.join(', '));
  ok('com o botão "Limpar filtros do bloco"',
    f.doBloco.length === 1 && f.doBloco[0] === 'Limpar filtros do bloco', JSON.stringify(f.doBloco));

  // O "Limpar" DE DENTRO do painel do seletor não pode resetar o bloco: ele
  // limpa a seleção daquele campo, e mais nada.
  const colisao = await pag.evaluate(() => {
    const dentro = [...document.querySelectorAll('#pagina .multi [data-limpar]')];
    return { quantos: dentro.length, algumComValor: dentro.some((b) => b.dataset.limpar) };
  });
  ok('o "Limpar" de dentro do seletor não carrega nome de bloco',
    colisao.quantos > 0 && !colisao.algumComValor, `${colisao.quantos} botão(ões) no painel`);

  // Independência: mexer no período do bloco Projetos não altera o do Financeiro.
  const antes = await pag.evaluate(() => ({
    fin: el('#i-financeiro-de').value, proj: el('#i-projetos-de').value }));
  await pag.evaluate(async () => {
    const c = el('#i-projetos-de');
    // Um mês que NÃO é o padrão do Financeiro (a competência mais antiga da
    // base): igual aos dois, a conferência de independência passaria por acaso.
    c.value = '03/2026';
    c.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await pag.waitForTimeout(1200);
  const depois = await pag.evaluate(() => ({
    fin: el('#i-financeiro-de').value, proj: el('#i-projetos-de').value,
    guardado: { proj: E.filtrosInd.projetos.de, fin: E.filtrosInd.financeiro.de },
  }));
  ok('o período do bloco Projetos é dele', depois.proj === '03/2026', depois.proj);
  ok('e não mexe no do Financeiro', depois.fin === antes.fin, `${antes.fin} → ${depois.fin}`);
  ok('o recorte guardado é por bloco', depois.guardado.proj === '2026-03'
    && depois.guardado.fin !== '2026-03', JSON.stringify(depois.guardado));

  await pag.evaluate(() => [...document.querySelectorAll('#pagina button[data-limpar]')]
    .filter((b) => b.dataset.limpar === 'projetos')[0].click());
  await pag.waitForTimeout(1200);
  const limpou = await pag.evaluate(() => ({
    de: el('#i-projetos-de').value, chaves: Object.keys(E.filtrosInd) }));
  ok('limpar volta o bloco ao padrão', limpou.de === '', `"${limpou.de}"`);
  // Sem a correção da colisão, `E.filtrosInd` ganhava uma chave "" a cada
  // clique no Limpar de dentro de um painel.
  ok('e nenhuma chave lixo entra no recorte',
    limpou.chaves.every((k) => ['financeiro', 'projetos', 'sla'].includes(k)),
    limpou.chaves.join(', '));

  console.log('\nAS DUAS VISÕES');
  const v = await pag.evaluate(() => {
    const proj = [...document.querySelectorAll('#pagina > section.bloco-modulo')]
      .find((m) => m.querySelector('h2').textContent.includes('Projetos'));
    return [...proj.querySelectorAll('section.bloco-grupo')].map((g) => ({
      t: g.querySelector('h2').textContent.replace(/^[+−]\s*/, '').trim(),
      dobra: !!g.querySelector(':scope > header .bloco-dobra'),
      indicadores: [...g.querySelectorAll('section.bloco-indicador [data-kpi]')].map((k) => k.dataset.kpi),
    }));
  });
  ok('são duas, nomeadas', v.length === 2, v.map((x) => x.t).join(' | '));
  ok('Macro — Virada de Sistema vem primeiro', limpo(v[0] && v[0].t) === 'Visão Macro — Virada de Sistema',
    limpo(v[0] && v[0].t));
  ok('Micro — Execução do Projeto vem depois', limpo(v[1] && v[1].t) === 'Visão Micro — Execução do Projeto',
    limpo(v[1] && v[1].t));
  ok('cada uma abre e fecha', v.every((x) => x.dobra));
  // Os indicadores que já existiam não se perderam ao serem agrupados: eles
  // passam a viver dentro da visão Micro, que é a pergunta que respondem.
  ok('os indicadores de execução estão dentro da Micro',
    JSON.stringify(v[1].indicadores) === JSON.stringify(['projetos-prazo', 'projetos-pendentes']),
    JSON.stringify(v[1].indicadores));
  ok('e nenhum ficou solto na Macro', v[0].indicadores.length === 0);

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
