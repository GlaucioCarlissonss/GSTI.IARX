// O BLOCO "RESULTADOS" NO APP — ENTREGA 1: ESTRUTURA E REGRA.
//
// A irmã desta conferência é `artifact/testar-resultados.cjs`, e as duas medem
// a mesma promessa em duas pontas.
//
// A PRIMEIRA é de LAYOUT, e é a que o enunciado chamou de crítica: o bloco é
// IRMÃO das caixas de módulo, nunca filho. Um `.cartao-resultado` dentro de um
// cartão de módulo é o defeito que esta suíte existe para pegar — e `closest`
// é o que prova parentesco, porque "está embaixo na tela" não distingue um
// irmão posicionado de um filho.
//
// A SEGUNDA é a REGRA: atingimento = resultado ÷ meta onde maior é melhor, e
// meta ÷ resultado onde menor é melhor. Inverter a direção num módulo faria o
// mês mais caro do ano aparecer em verde, e é um erro que a tela não denuncia
// sozinha — o número continua parecendo um percentual plausível.
//
// Uso: com o servidor no ar sobre uma base de verificação (nunca a base real),
//   BASE_URL=http://127.0.0.1:3333 node web/verificar-resultados.cjs
const { chromium } = require('playwright');

const B = process.env.BASE_URL || 'http://127.0.0.1:3333';

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const erros = [];
  pag.on('pageerror', (e) => erros.push(e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::|401/.test(m.text())) erros.push(m.text()); });

  const falhas = [];
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto(B + '/');
  await pag.fill('input[autocomplete="username"], input[name="usuario"]', process.env.USUARIO || 'gestora');
  await pag.fill('input[type=password]', process.env.SENHA || 'varredura2026');
  await pag.click('button[type=submit]');
  await pag.waitForTimeout(1200);
  if (await pag.$('.cartao button')) await pag.click('.cartao button');
  await pag.waitForSelector('.menu a', { timeout: 15000 });
  await pag.click('.menu a:has-text("Indicadores Gerais")');
  await pag.waitForSelector('.bloco-resultados', { timeout: 15000 });
  // O bloco faz duas consultas próprias depois de saber os meses.
  await pag.waitForTimeout(2000);

  // ------------------------------------------------------------- layout
  console.log('\nPOSIÇÃO — o bloco é irmão dos cartões de módulo, nunca filho');
  const pos = await pag.evaluate(() => {
    const b = document.querySelector('.bloco-resultados');
    if (!b) return null;
    const topo = (e) => e.getBoundingClientRect().top + window.scrollY;
    // Os cartões de módulo são os `.cartao` da página que NÃO são este bloco.
    const modulos = [...document.querySelectorAll('.pagina .cartao, main .cartao')]
      .filter((c) => c !== b && !b.contains(c) && !c.contains(b));
    return {
      ehFilhoDeCartao: !!(b.parentElement && b.parentElement.closest('.cartao')),
      abaixoDeTodos: modulos.every((m) => topo(b) >= topo(m)),
      quantosModulos: modulos.length,
      largura: Math.round(b.getBoundingClientRect().width),
      larguraIrmao: modulos.length
        ? Math.round(Math.max(...modulos.map((m) => m.getBoundingClientRect().width))) : 0,
      titulo: (b.querySelector('h2') || {}).textContent,
      temSubtitulo: !!(b.querySelector('.res-sub') || {}).textContent,
      cartoesDentroDeModulo: modulos.reduce(
        (n, m) => n + m.querySelectorAll('.cartao-resultado').length, 0),
      cartoes: [...b.querySelectorAll('.cartao-resultado')].map((c) => c.dataset.modulo),
    };
  });
  if (!pos) {
    ok('o bloco Resultados existe na tela', false, 'nenhum .bloco-resultados');
  } else {
    ok('o bloco Resultados existe na tela', true);
    ok('ele NÃO está dentro de nenhum cartão de módulo', !pos.ehFilhoDeCartao);
    ok('nenhum cartão de resultado foi duplicado dentro dos módulos',
      pos.cartoesDentroDeModulo === 0, `${pos.cartoesDentroDeModulo} encontrado(s)`);
    ok('ele vem abaixo de TODOS os cartões de módulo', pos.abaixoDeTodos,
      `${pos.quantosModulos} cartão(ões) acima`);
    ok('ele tem a largura de um bloco de página',
      Math.abs(pos.largura - pos.larguraIrmao) <= 2, `${pos.largura}px × ${pos.larguraIrmao}px`);
    ok('o título é "Resultados"', (pos.titulo || '').trim() === 'Resultados', pos.titulo);
    ok('há subtítulo explicando o que ele consolida', pos.temSubtitulo);
    ok('são exatamente três cartões, na ordem Financeiro / Projetos / SLA',
      pos.cartoes.join(',') === 'financeiro,projetos,sla', pos.cartoes.join(' · '));
  }

  console.log('\nGRADE — três colunas no desktop, uma no celular');
  const colunas = () => pag.evaluate(() => {
    const g = document.querySelector('.grade-resultados');
    if (!g) return null;
    return {
      colunas: getComputedStyle(g).gridTemplateColumns.split(' ').length,
      empilhado: [...g.children].every((c, i, a) =>
        i === 0 || c.getBoundingClientRect().top >= a[i - 1].getBoundingClientRect().bottom - 1),
    };
  });
  const desktop = await colunas();
  ok('no desktop são três colunas', !!desktop && desktop.colunas === 3,
    desktop ? String(desktop.colunas) : 'sem grade');
  for (const [nome, largura] of [['tablet', 760], ['celular', 390]]) {
    await pag.setViewportSize({ width: largura, height: 1000 });
    await pag.waitForTimeout(300);
    const c = await colunas();
    ok(`a ${largura}px (${nome}) vira uma coluna`, !!c && c.colunas === 1,
      c ? String(c.colunas) : 'sem grade');
    ok(`a ${largura}px os cartões ficam empilhados`, !!c && c.empilhado);
    const semLateral = await pag.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    ok(`a ${largura}px a página não rola para o lado`, semLateral);
    // O bloco continua fora dos módulos em todo breakpoint.
    const fora = await pag.evaluate(() => {
      const b = document.querySelector('.bloco-resultados');
      return !(b.parentElement && b.parentElement.closest('.cartao'));
    });
    ok(`a ${largura}px o bloco segue fora dos módulos`, fora);
  }
  await pag.setViewportSize({ width: 1500, height: 1100 });
  await pag.waitForTimeout(300);

  // ------------------------------------------------------------ conteúdo
  console.log('\nCARTÃO — resultado, meta e atingimento');
  const cartoes = await pag.evaluate(() => [...document.querySelectorAll('.cartao-resultado')]
    .map((c) => ({
      mod: c.dataset.modulo,
      faixa: ([...c.classList].find((x) => x.startsWith('faixa-')) || '').replace('faixa-', ''),
      valor: (c.querySelector('.res-valor') || {}).textContent,
      rotulos: [...c.querySelectorAll('.res-linha dt')].map((d) => d.textContent.trim()),
      texto: ((c.querySelector('.res-texto') || {}).textContent || '').trim(),
    })));
  ok('cada cartão traz Meta e Atingimento rotulados',
    cartoes.length === 3 && cartoes.every((c) => c.rotulos.join(',') === 'Meta,Atingimento'),
    cartoes.map((c) => c.rotulos.join('/')).join(' · '));
  ok('cada cartão traz o texto do estado da meta',
    cartoes.every((c) => c.texto.length > 0),
    cartoes.map((c) => `${c.mod}: ${c.texto}`).join(' · '));
  ok('nenhum cartão fica sem faixa declarada',
    cartoes.every((c) => c.faixa), cartoes.map((c) => `${c.mod}=${c.faixa}`).join(' · '));
  // O SLA tem meta padrão de 80% mesmo sem cadastro e mesmo sem chamado no
  // mês: o campo Meta do cartão tem de trazer um percentual. Conferir só a
  // faixa não serviria — "sem dados" passaria sem provar meta nenhuma.
  const metaSla = await pag.evaluate(() => {
    const c = document.querySelector('.cartao-resultado[data-modulo="sla"]');
    return c ? c.querySelectorAll('.res-linha dd')[0].textContent.trim() : null;
  });
  ok('o cartão de SLA traz a meta padrão de 80%', metaSla === '80,0%', String(metaSla));

  console.log('\nMÊS — o seletor é do bloco e não mexe nos filtros da tela');
  const mes = await pag.evaluate(async () => {
    const sel = document.querySelector('[data-mes-resultados]');
    if (!sel || sel.options.length < 2) return null;
    const antes = sel.value;
    const textoAntes = document.querySelector('.grade-resultados').textContent;
    const nativo = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    nativo.call(sel, sel.options[1].value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1800));
    return {
      antes, depois: document.querySelector('[data-mes-resultados]').value,
      mudou: document.querySelector('.grade-resultados').textContent !== textoAntes,
      tresCartoes: document.querySelectorAll('.cartao-resultado').length === 3,
    };
  });
  if (!mes) {
    console.log('  · a base de verificação tem um mês fechado só; o seletor não pode ser exercido');
  } else {
    ok('trocar o mês muda o seletor', mes.antes !== mes.depois, `${mes.antes} → ${mes.depois}`);
    ok('continuam sendo três cartões', mes.tresCartoes);
  }

  // A REGRA não é exercida aqui: ela é pura, mora em `src/lib/resultados.ts`
  // e é coberta por `web/testar-regra-resultados.mjs`, que roda sem navegador.
  // Importar o fonte de dentro da página servida falhava — o que o navegador
  // tem é o bundle — e deixava um erro de console que não era do produto.

  // ------------------------------------------------------------ contraste
  console.log('\nBARRA — preenchimento, acessibilidade e dica');
  // Procura um mês em que algum cartão tenha meta E resultado: no mês padrão a
  // base de verificação pode não ter nenhum, e uma asserção que nunca é
  // exercida não protege nada.
  const mesesDisponiveis = await pag.$$eval('[data-mes-resultados] option', (os) => os.map((o) => o.value));
  for (const m of mesesDisponiveis) {
    await pag.evaluate(async (valor) => {
      const sel = document.querySelector('[data-mes-resultados]');
      const nativo = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      nativo.call(sel, valor);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, m);
    await pag.waitForTimeout(1600);
    const achou = await pag.$$eval('.cartao-resultado .res-barra',
      (bs) => bs.some((b) => !b.classList.contains('vazia')));
    if (achou) { console.log(`  · mês com barra preenchida: ${m}`); break; }
  }
  const barras = await pag.evaluate(() => [...document.querySelectorAll('.cartao-resultado')]
    .map((c) => {
      const b = c.querySelector('.res-barra');
      const i = c.querySelector('.res-trilha > i');
      return { mod: c.dataset.modulo,
        faixa: ([...c.classList].find((x) => x.startsWith('faixa-')) || '').replace('faixa-', ''),
        temBarra: !!b, vazia: !!(b && b.classList.contains('vazia')),
        papel: b && b.getAttribute('role'),
        agora: b && b.getAttribute('aria-valuenow'),
        min: b && b.getAttribute('aria-valuemin'), max: b && b.getAttribute('aria-valuemax'),
        rotulo: (b && b.getAttribute('aria-label')) || '',
        dica: (b && b.getAttribute('title')) || '',
        largura: i ? parseFloat(i.style.width) : null,
        pct: (c.querySelector('.res-pct') || {}).textContent || '' };
    }));
  ok('todo cartão tem barra', barras.every((b) => b.temBarra), `${barras.length} cartão(ões)`);
  const comMeta = barras.filter((b) => !b.vazia);
  ok('sem atingimento, a barra fica neutra e vazia',
    barras.filter((b) => b.faixa === 'sem_dados' || b.faixa === 'sem_meta').every((b) => b.vazia),
    barras.map((b) => `${b.mod}=${b.vazia ? 'vazia' : 'cheia'}`).join(' · '));
  if (comMeta.length) {
    ok('o preenchimento nunca passa de 100%', comMeta.every((b) => b.largura <= 100),
      comMeta.map((b) => `${b.mod}:${b.largura}%`).join(' · '));
    ok('o preenchimento é proporcional ao atingimento',
      comMeta.every((b) => Math.abs(b.largura - Math.min(100, Number(b.agora))) < 0.2),
      comMeta.map((b) => `${b.largura}/${b.agora}`).join(' · '));
    ok('o percentual sai com uma casa decimal',
      comMeta.every((b) => /^\d+,\d%$/.test(b.pct.trim())), comMeta.map((b) => b.pct).join(' · '));
    ok('a barra é um progressbar com valor, mínimo e máximo',
      comMeta.every((b) => b.papel === 'progressbar' && b.min === '0' && b.max === '100'
        && Number.isFinite(Number(b.agora))));
    ok('com a frase da meta no rótulo',
      comMeta.every((b) => /atingimento de/.test(b.rotulo)), comMeta[0].rotulo.slice(0, 70));
    ok('a dica traz resultado, meta, atingimento, direção e mês',
      comMeta.every((b) => ['Resultado', 'Meta', 'Atingimento', 'Direção', 'Mês de referência']
        .every((x) => b.dica.includes(x))), comMeta[0].dica.replace(/\n/g, ' · ').slice(0, 120));
  } else {
    console.log('  · nenhum cartão com meta nesta base; o preenchimento não pôde ser exercido');
  }

  // ------------------------------------------------------ faixa mês a mês
  console.log('\nFAIXA MÊS A MÊS — um marcador por mês, na cor do semáforo dele');
  // Volta ao mês mais recente: as seções acima varreram os meses à procura de
  // uma barra preenchida e podem ter parado em qualquer um.
  const voltarAoUltimo = async () => {
    const ultimo = await pag.$eval('[data-mes-resultados]', (s) => s.options[0].value);
    await pag.evaluate((valor) => {
      const sel = document.querySelector('[data-mes-resultados]');
      const nativo = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      nativo.call(sel, valor);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, ultimo);
    await pag.waitForTimeout(900);
    return ultimo;
  };
  const ultimoMes = await voltarAoUltimo();

  const faixa = await pag.evaluate(() => {
    const c = document.querySelector('.cartao-resultado[data-modulo="sla"]');
    const g = c && c.querySelector('.res-meses');
    if (!g) return null;
    const bs = [...g.querySelectorAll('.res-mes')];
    return {
      papel: g.getAttribute('role'),
      rotuloGrupo: g.getAttribute('aria-label') || '',
      meses: bs.map((b) => b.dataset.mesFaixa),
      faixas: bs.map((b) => ([...b.classList].find((x) => x.startsWith('faixa-')) || '').replace('faixa-', '')),
      // Cor sozinha não informa quem não a distingue: o rótulo escrito tem de
      // estar visível, e o aria-label tem de dizer a situação por extenso.
      rotulos: bs.map((b) => (b.querySelector('.res-mes-rot') || {}).textContent || ''),
      ariaLabels: bs.map((b) => b.getAttribute('aria-label') || ''),
      pressed: bs.map((b) => b.getAttribute('aria-pressed')),
      dicas: bs.map((b) => b.getAttribute('title') || ''),
      // Cronológico: a faixa se lê da esquerda para a direita, como o tempo.
      cronologico: bs.every((b, i, a) => i === 0
        || `${a[i - 1].dataset.mesFaixa.slice(3)}-${a[i - 1].dataset.mesFaixa.slice(0, 2)}`
        < `${b.dataset.mesFaixa.slice(3)}-${b.dataset.mesFaixa.slice(0, 2)}`),
      emLinha: bs.every((b, i, a) => i === 0
        || Math.abs(b.getBoundingClientRect().top - a[i - 1].getBoundingClientRect().top) < 2),
    };
  });
  if (!faixa) {
    ok('o cartão de SLA tem a faixa mês a mês', false, 'nenhum .res-meses');
  } else {
    ok('o cartão de SLA tem a faixa mês a mês', faixa.meses.length >= 2, `${faixa.meses.length} mês(es)`);
    ok('a faixa é um grupo rotulado para leitor de tela',
      faixa.papel === 'group' && /SLA/.test(faixa.rotuloGrupo), faixa.rotuloGrupo);
    ok('os meses vêm do mais antigo para o mais novo', faixa.cronologico, faixa.meses.join(' → '));
    ok('a faixa cabe numa linha só', faixa.emLinha);
    ok('todo mês tem rótulo escrito, e não só a cor',
      faixa.rotulos.every((r) => r.trim().length > 0), faixa.rotulos.join(' · '));
    ok('todo mês diz a situação por extenso no aria-label',
      faixa.ariaLabels.every((r) => /atingida|Sem (meta|dados)/.test(r)), faixa.ariaLabels[0]);
    ok('a dica de cada mês traz resultado, meta, atingimento e situação',
      faixa.dicas.every((d) => ['Resultado', 'Meta', 'Atingimento', 'Situação'].every((x) => d.includes(x))),
      (faixa.dicas[0] || '').replace(/\n/g, ' · ').slice(0, 110));
    ok('exatamente um mês está marcado como selecionado',
      faixa.pressed.filter((p) => p === 'true').length === 1, faixa.pressed.join(','));
    ok('o mês selecionado é o do seletor',
      faixa.meses[faixa.pressed.indexOf('true')] === ultimoMes,
      `${faixa.meses[faixa.pressed.indexOf('true')]} × ${ultimoMes}`);
    // A base de verificação dá a cada mês fechado uma cor diferente de
    // propósito: uma faixa monocromática passaria com o código pintando tudo
    // igual, e não provaria que o marcador tem a cor do SEU mês.
    ok('meses com resultados diferentes têm faixas diferentes',
      new Set(faixa.faixas).size >= 2, faixa.meses.map((m, i) => `${m}=${faixa.faixas[i]}`).join(' · '));
  }

  console.log('\nFAIXA — clicar num mês move o BLOCO inteiro, sem ir ao servidor');
  // Três cartões em três meses diferentes seriam três leituras que não se
  // comparam — que é exatamente o que este bloco existe para evitar.
  const pedidos = [];
  const contar = (r) => { if (/\/api\//.test(r.url())) pedidos.push(r.url()); };
  pag.on('request', contar);
  const clique = await pag.evaluate(async () => {
    const alvo = [...document.querySelectorAll('.cartao-resultado[data-modulo="sla"] .res-mes')]
      .find((b) => b.getAttribute('aria-pressed') !== 'true');
    if (!alvo) return null;
    const mes = alvo.dataset.mesFaixa;
    const valor = (m) => (document.querySelector(
      `.cartao-resultado[data-modulo="${m}"] .res-valor`) || {}).textContent;
    const antes = ['financeiro', 'projetos', 'sla'].map(valor);
    alvo.click();
    await new Promise((r) => setTimeout(r, 900));
    return {
      pedido: mes,
      // O cartão Financeiro lia `totais_mes`, que ignora a janela do recorte e
      // devolve sempre o último mês com dado: trocar o mês não mexia nele.
      // Agora o número sai da série, e é o do mês escolhido.
      valoresMudaram: ['financeiro', 'projetos', 'sla']
        .map((m, i) => `${m}: ${antes[i]} → ${valor(m)}`),
      financeiroMudou: antes[0] !== valor('financeiro'),
      seletor: document.querySelector('[data-mes-resultados]').value,
      // TODOS os cartões seguem o mês, e não só aquele em que se clicou.
      selecionadoEmCada: [...document.querySelectorAll('.cartao-resultado')].map((c) => {
        const s = c.querySelector('.res-mes[aria-pressed="true"]');
        return `${c.dataset.modulo}=${s ? s.dataset.mesFaixa : '—'}`;
      }),
      rotuloDoBotao: ((document.querySelector('.cartao-resultado .res-ver') || {}).textContent || '').trim(),
    };
  });
  pag.off('request', contar);
  if (!clique) {
    console.log('  · a faixa tem um mês só nesta base; o clique não pôde ser exercido');
  } else {
    ok('clicar num mês da faixa passa a selecioná-lo',
      clique.seletor === clique.pedido, `${clique.pedido} → ${clique.seletor}`);
    ok('os três cartões vão para o MESMO mês',
      clique.selecionadoEmCada.every((s) => s.endsWith(clique.pedido)),
      clique.selecionadoEmCada.join(' · '));
    ok('o botão de registros acompanha o mês escolhido',
      clique.rotuloDoBotao.includes(clique.pedido), clique.rotuloDoBotao);
    // O cartão Financeiro é o que mais precisa disto: ele lia `totais_mes`,
    // que ignora a janela do recorte, e por isso mostrava sempre o último mês
    // com dado — o seletor mexia nos outros dois e nele não.
    ok('o valor do cartão Financeiro segue o mês escolhido',
      clique.financeiroMudou, clique.valoresMudaram.join(' · '));
    // O N+1 que esta entrega existe para não cometer: treze meses não podem
    // virar treze idas. A série inteira já veio nas duas consultas do bloco.
    ok('trocar de mês NÃO dispara consulta nova',
      pedidos.length === 0, pedidos.map((u) => u.replace(B, '')).join(' | ') || 'nenhuma');
  }

  // A FAIXA PELO TECLADO, a mesma conferência que a irmã do artifact faz.
  // Lá a área inteira é repintada a cada escolha, e sem cuidado o foco volta
  // ao `body`; aqui o React reaproveita os nós e o foco sobrevive sozinho —
  // o que esta seção garante é que continue sobrevivendo.
  console.log('\nFAIXA — percorrível pelo teclado, e o foco não se perde ao escolher');
  await voltarAoUltimo();
  const porTeclado = await pag.evaluate(() => {
    const c = document.querySelector('.cartao-resultado[data-modulo="sla"]');
    const meses = [...c.querySelectorAll('.res-mes')];
    const alvo = meses.find((m) => m.getAttribute('aria-pressed') !== 'true');
    if (!alvo) return null;
    alvo.focus();
    return {
      querido: alvo.dataset.mesFaixa,
      ehBotao: alvo.tagName === 'BUTTON',
      foraDaTabulacao: alvo.getAttribute('tabindex') === '-1',
      focou: document.activeElement === alvo,
    };
  });
  if (!porTeclado) {
    console.log('  · todos os meses já selecionados; o teclado não pôde ser exercido');
  } else {
    ok('o mês é um botão nativo, na ordem de tabulação',
      porTeclado.ehBotao && !porTeclado.foraDaTabulacao);
    ok('o mês recebe foco', porTeclado.focou);
    await pag.keyboard.press('Enter');
    await pag.waitForTimeout(700);
    const depois = await pag.evaluate(() => {
      const f = document.activeElement;
      return {
        ehBody: f === document.body,
        naFaixa: !!(f && f.classList && f.classList.contains('res-mes')),
        mes: f && f.dataset ? f.dataset.mesFaixa : null,
        modulo: f && f.closest ? (f.closest('[data-modulo]') || {}).dataset?.modulo : null,
        selecionado: document.querySelector('[data-mes-resultados]').value,
      };
    });
    ok('Enter escolhe o mês', depois.selecionado === porTeclado.querido,
      `${depois.selecionado} (queria ${porTeclado.querido})`);
    ok('e o foco continua no mesmo botão, e não volta ao topo da página',
      depois.naFaixa && !depois.ehBody && depois.mes === porTeclado.querido
        && depois.modulo === 'sla',
      `foco em ${depois.modulo || '—'}/${depois.mes || (depois.ehBody ? 'body' : '?')}`);
  }

  console.log('\nFAIXA — a 390px ela cabe sem empurrar a página');
  await pag.setViewportSize({ width: 390, height: 900 });
  await pag.waitForTimeout(400);
  const noCelular = await pag.evaluate(() => {
    const g = document.querySelector('.cartao-resultado[data-modulo="sla"] .res-meses');
    if (!g) return null;
    const bs = [...g.querySelectorAll('.res-mes')];
    const r = g.getBoundingClientRect();
    return {
      rolaLado: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      transborda: bs.some((b) => b.getBoundingClientRect().right > r.right + 1),
      // WCAG 2.2 AA pede 24×24 CSS px de alvo; abaixo disso o dedo erra.
      menorAlvo: Math.round(Math.min(...bs.map((b) => {
        const x = b.getBoundingClientRect();
        return Math.min(x.width, x.height);
      }))),
      rotulos: bs.map((b) => (b.querySelector('.res-mes-rot') || {}).textContent || ''),
    };
  });
  if (!noCelular) {
    ok('a faixa existe no celular', false, 'sem .res-meses a 390px');
  } else {
    ok('a página não rola para o lado', !noCelular.rolaLado);
    ok('nenhum mês vaza do grupo', !noCelular.transborda);
    ok('o alvo de cada mês tem ao menos 24px', noCelular.menorAlvo >= 24,
      `${noCelular.menorAlvo}px`);
    // O MESMO rótulo do artifact: mês abreviado e ano de dois dígitos. Duas
    // superfícies que nomeiam o mesmo mês de formas diferentes obrigam a
    // traduzir de cabeça ao comparar o celular com o navegador.
    ok('o rótulo do mês é o mesmo do artifact (mmm/aa)',
      noCelular.rotulos.every((r) => /^[a-z]{3}\/\d{2}$/.test(r.trim())),
      noCelular.rotulos.join(' · '));
  }
  await pag.setViewportSize({ width: 1500, height: 1100 });
  await pag.waitForTimeout(400);

  console.log('\nDELTA — a variação do atingimento, em pontos percentuais');
  // De volta ao mês mais recente: o clique acima pode ter parado no mês mais
  // ANTIGO da faixa, e esse não tem anterior com que se comparar.
  await voltarAoUltimo();
  const delta = await pag.evaluate(() => [...document.querySelectorAll('.cartao-resultado')]
    .map((c) => ({
      mod: c.dataset.modulo,
      texto: ((c.querySelector('.res-delta') || {}).textContent || '').trim(),
      vazio: !!(c.querySelector('.res-delta') || {}).classList?.contains('vazio-delta'),
    })));
  ok('todo cartão traz a linha da variação', delta.every((d) => d.texto.length > 0),
    delta.map((d) => `${d.mod}: ${d.texto}`).join(' · '));
  const comDelta = delta.filter((d) => !d.vazio);
  if (comDelta.length) {
    ok('a variação é em pontos percentuais, com seta e mês de comparação',
      comDelta.every((d) => /p\.p\./.test(d.texto) && /[↑↓=]/.test(d.texto) && /vs \d{2}\/\d{4}/.test(d.texto)),
      comDelta.map((d) => d.texto).join(' · '));
  } else {
    console.log('  · nenhum cartão com dois meses comparáveis; a variação não pôde ser exercida');
  }

  console.log('\nREGISTROS — o mês abre os registros que o compõem');
  await voltarAoUltimo();
  for (const mod of ['financeiro', 'projetos', 'sla']) {
    const bt = await pag.$(`.cartao-resultado[data-modulo="${mod}"] .res-ver`);
    if (!bt) { ok(`${mod}: tem botão de ver registros`, false); continue; }
    if (await bt.isDisabled()) {
      console.log(`  · ${mod}: sem registro no mês em foco; o botão fica desabilitado, como deve`);
      continue;
    }
    const valorNoCartao = await pag.$eval(
      `.cartao-resultado[data-modulo="${mod}"] .res-valor`, (e) => e.textContent.trim());
    await bt.click();
    await pag.waitForTimeout(1500);
    const modal = await pag.evaluate(() => {
      const m = document.querySelector('.modal, [role="dialog"]');
      if (!m) return null;
      const texto = m.textContent.replace(/\s+/g, ' ');
      return {
        titulo: ((m.querySelector('h2, h3') || {}).textContent || '').trim(),
        // O financeiro abre em modo COMPARATIVO, com as três camadas
        // recolhidas: contar `tbody tr` aqui daria zero e não provaria nada.
        // O que vale nos dois modos é o cabeçalho de conferência.
        registros: Number((texto.match(/(\d+) registro\(s\)/) || [])[1] ?? -1),
        confere: /confere com o indicador/.test(texto),
        diverge: /diverge do indicador|não confere/i.test(texto),
        texto: texto.slice(0, 220),
      };
    });
    if (!modal) {
      ok(`${mod}: abre a tela flutuante dos registros`, false, 'nenhum modal');
    } else {
      ok(`${mod}: abre a tela flutuante dos registros`, true, modal.texto.slice(0, 60));
      ok(`${mod}: o título diz de que mês é`, /\d{2}\/\d{4}/.test(modal.titulo), modal.titulo);
      ok(`${mod}: a lista traz registros`, modal.registros > 0, `${modal.registros} registro(s)`);
      // A conferência é a promessa inteira deste drill-down: a lista tem de
      // somar o MESMO número que estava no cartão. Se divergisse, o gestor
      // teria dois números e nenhum jeito de saber qual vale.
      ok(`${mod}: a soma dos registros confere com o cartão (${valorNoCartao})`,
        modal.confere && !modal.diverge, modal.texto.slice(0, 120));
    }
    await pag.keyboard.press('Escape');
    await pag.waitForTimeout(500);
  }

  console.log('\nCONTRASTE — o bloco passa na régua AA, nos dois temas');
  for (const tema of ['light', 'dark']) {
    await pag.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
    await pag.waitForTimeout(250);
    const abaixo = await pag.evaluate(() => {
      const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
        .map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const fundo = (e) => { let n = e; while (n) { const c = getComputedStyle(n).backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; n = n.parentElement; }
        return 'rgb(255,255,255)'; };
      const razao = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const ruins = [];
      for (const e of document.querySelectorAll('.bloco-resultados h2, .res-sub, .cartao-resultado h3, .res-oque, .res-valor, .res-linha dt, .res-linha dd, .res-texto, .res-ressalva')) {
        const s = getComputedStyle(e);
        const px = parseFloat(s.fontSize);
        const grande = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700);
        const r = razao(s.color, fundo(e));
        if (r < (grande ? 3 : 4.5)) ruins.push(`${e.className || e.tagName} ${px}px ${r.toFixed(2)}`);
      }
      return ruins;
    });
    ok(`tema ${tema}: nada abaixo da régua`, abaixo.length === 0, abaixo.join(', ') || 'tudo acima');
  }
  await pag.evaluate(() => document.documentElement.removeAttribute('data-theme'));

  console.log(`\n=== erros de console: ${erros.length ? erros.slice(0, 4).join(' | ') : 'nenhum'} ===`);
  console.log(`=== ✗=${falhas.length} ===`);
  if (falhas.length) falhas.forEach((f) => console.log('  ✗ ' + f));
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
