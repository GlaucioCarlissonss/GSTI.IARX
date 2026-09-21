// As telas das Fases 2 e 3 no navegador: metas, acordos de SLA, reclassificação
// e a classificação de consumo.
//
// Compilar não é abrir. `tsc` e `vite build` não veem um `useDados` que não
// recarrega depois de gravar, um `select` sem valor ou um erro de console —
// e é exatamente aí que estas telas poderiam falhar sem ninguém notar.
//
// O que se confere é a LIGAÇÃO, não a aparência: cadastrar uma meta e ver o
// indicador passar a ler contra ela é a promessa da entrega; a tela bonita com
// o número velho seria o defeito mais caro possível.
//
//   DATABASE_PATH=/tmp/verif-v2.sqlite npx tsx server/src/db/preparar-verificacao-v2.ts
//   DATABASE_PATH=/tmp/verif-v2.sqlite PORT=3399 node server/dist/index.js
//   BASE_URL=http://127.0.0.1:3399 node web/verificar-cadastros-v2.cjs
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3399';
const SENHA = process.env.SENHA || 'varredura2026';

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || '/opt/pw-browsers/chromium' });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/ERR_|net::|favicon|Failed to load resource/.test(t)) erros.push('console: ' + t);
  });
  const ok = (r, b, d = '') => {
    console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`);
    if (!b) falhas.push(r + (d ? ' — ' + d : ''));
  };

  // ------------------------------------------------------------------ entrar
  await pag.goto(BASE + '/');
  await pag.waitForLoadState('networkidle');
  await pag.fill('input[autocomplete="username"], input[name="usuario"]', process.env.USUARIO || 'gestora');
  await pag.fill('input[type="password"]', SENHA);
  await pag.click('button[type="submit"]');
  await pag.waitForSelector('.menu a, .cartao, h1', { timeout: 15000 });
  await pag.waitForTimeout(800);
  if (!(await pag.$('.menu a'))) {
    await pag.locator('.cartao button').filter({ hasNotText: 'Sair de' }).first().click();
  }
  await pag.waitForSelector('.menu a', { timeout: 15000 });

  // O cartão abre RECOLHIDO e lembra o que foi aberto — é a convenção global do
  // app ("a tela abre enxuta"). Quem verifica precisa fazer o que o usuário faz:
  // abrir. Sem isto, a varredura leria uma tela vazia e chamaria de defeito o
  // comportamento combinado.
  const abrirCartoes = async () => {
    const dobras = await pag.$$('.cartao.dobrado .cartao-dobra');
    for (const d of dobras) {
      await d.click();
      await pag.waitForTimeout(250);
    }
  };

  const irPara = async (rota, espera = 1400) => {
    await pag.goto(BASE + rota);
    await pag.waitForTimeout(espera);
    await abrirCartoes();
  };

  // ------------------------------------- o alvo de base, antes de cadastrar
  console.log('\nPARTIDA — sem meta cadastrada, o painel lê contra o 80 de sempre');
  await irPara('/');
  const alvoInicial = await pag.evaluate(() =>
    [...document.querySelectorAll('.meta-indicador')].map((m) => m.textContent.replace(/\s+/g, ' ').trim()));
  ok('o painel desenha a barra de Meta vs Resultado', alvoInicial.length > 0, `${alvoInicial.length} barra(s)`);
  ok('e compara contra 80', alvoInicial.some((t) => /80/.test(t)), alvoInicial.join(' | ').slice(0, 140));

  // ------------------------------------------------------------ cadastrar meta
  console.log('\nMETAS — a tela grava e o indicador passa a ler contra o alvo novo');
  await irPara('/metas');
  const telaMetas = await pag.evaluate(() => ({
    titulo: (document.querySelector('.cartao h2, .cartao h3') || {}).textContent || '',
    vazio: !!document.querySelector('.vazio'),
    // É tela de CLIENTE: oferecer seletor de unidade sugeriria um recorte que
    // ela não tem. `FormularioNovo` também usa `.barra-filtros`, então o que
    // distingue é o RÓTULO do seletor, não a classe do bloco.
    foco: /Unidade em foco/i.test(document.body.textContent),
  }));
  ok('a tela de Metas abre', /Metas/i.test(telaMetas.titulo), telaMetas.titulo.trim());
  ok('sem meta, diz que os alvos de base valem', telaMetas.vazio);
  ok('e não oferece seletor de unidade', !telaMetas.foco);

  await pag.fill('.barra-filtros input[type="text"], form input[type="text"]', 'SLA exigente');
  await pag.selectOption('form select', 'sla');
  await pag.fill('form input[type="number"]', '95');
  await pag.click('form button[type="submit"]');
  await pag.waitForTimeout(1600);

  const listada = await pag.evaluate(() => {
    const linha = document.querySelector('tbody tr');
    return linha ? linha.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  ok('a meta aparece na lista sem recarregar a página', /SLA exigente/.test(listada), listada);
  ok('com o alvo e a vigência', /95/.test(listada) && /sempre/i.test(listada), listada);

  await irPara('/');
  const alvoNovo = await pag.evaluate(() =>
    [...document.querySelectorAll('.meta-indicador')].map((m) => m.textContent.replace(/\s+/g, ' ').trim()));
  ok('o painel passa a ler o SLA contra 95', alvoNovo.some((t) => /95/.test(t)),
    alvoNovo.join(' | ').slice(0, 160));

  // -------------------------------------------------------------- desativar
  await irPara('/metas');
  await pag.click('tbody tr button:has-text("Desativar")');
  await pag.waitForTimeout(1400);
  await irPara('/');
  const alvoVolta = await pag.evaluate(() =>
    [...document.querySelectorAll('.meta-indicador')].map((m) => m.textContent.replace(/\s+/g, ' ').trim()));
  ok('desativar devolve o painel ao alvo de base', alvoVolta.some((t) => /80/.test(t)),
    alvoVolta.join(' | ').slice(0, 160));

  // --------------------------------------------------------- acordos de SLA
  console.log('\nSLAs — o acordo é da unidade, e a tela grava');
  await irPara('/slas');
  const telaSlas = await pag.evaluate(() => ({
    vazio: !!document.querySelector('.vazio'),
    // Aqui o seletor de unidade é obrigatório: o acordo é de uma unidade.
    foco: /Unidade em foco/i.test(document.body.textContent),
  }));
  ok('a tela de SLAs abre vazia e explica o que vale sem cadastro', telaSlas.vazio);
  ok('e oferece o seletor de unidade', telaSlas.foco);

  const selects = pag.locator('form select');
  await selects.nth(1).selectOption('high');
  await pag.fill('form input[type="number"]', '4');
  await pag.click('form button[type="submit"]');
  await pag.waitForTimeout(1600);
  const acordo = await pag.evaluate(() => {
    const linha = document.querySelector('tbody tr');
    return linha ? linha.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  ok('o acordo aparece na lista', /Alta/.test(acordo) && /4/.test(acordo), acordo);
  ok('e a regra geral é dita por extenso', /regra geral/i.test(acordo), acordo);

  // ------------------------------------------------ consumo no lançamento
  console.log('\nCONSUMO — a classificação aparece onde o lançamento aparece');
  await irPara('/lancamentos', 1800);
  const lanc = await pag.evaluate(() => ({
    cabecalho: [...document.querySelectorAll('thead th')].map((t) => t.textContent.trim()),
    linhas: [...document.querySelectorAll('tbody tr')].map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()),
  }));
  ok('a tabela tem coluna Consumo', lanc.cabecalho.includes('Consumo'), lanc.cabecalho.join(', '));
  ok('o lançamento compartilhado diz quem se beneficia',
    lanc.linhas.some((l) => /Beneficia/.test(l)),
    (lanc.linhas.find((l) => /Beneficia/.test(l)) || '(nenhum)').slice(0, 120));
  ok('e o que é só da filial não inventa etiqueta',
    lanc.linhas.some((l) => /Telefonia/.test(l) && !/Beneficia/.test(l)));

  // -------------------------------------------------- despesa centralizada
  await irPara('/', 1800);
  const painel = await pag.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));
  ok('o painel mostra a despesa paga por uma unidade e consumida por outras',
    /consumida por outras/i.test(painel));
  ok('e diz em voz alta que não há divisão por filial',
    /N[ãa]o h[áa] divis[ãa]o por filial/i.test(painel));

  // ------------------------------------------------------- reclassificação
  console.log('\nRECLASSIFICAÇÃO — exige cargo e nome, e o histórico fica na ficha');
  await irPara('/sla/registros', 1800);
  const abriu = await pag.evaluate(() => {
    const alvo = [...document.querySelectorAll('tbody tr')][0];
    if (!alvo) return false;
    alvo.click();
    return true;
  });
  ok('há chamado para abrir', abriu);
  await pag.waitForTimeout(1400);

  let temHistorico = await pag.evaluate(() => /Hist[óo]rico de prioridade/i.test(document.body.textContent));
  if (!temHistorico) {
    // A listagem de registros pode não abrir ficha; o módulo de Suporte abre.
    await irPara('/suporte/ostick', 1800);
    await pag.evaluate(() => { const t = document.querySelector('tbody tr'); if (t) t.click(); });
    await pag.waitForTimeout(1400);
    temHistorico = await pag.evaluate(() => /Hist[óo]rico de prioridade/i.test(document.body.textContent));
  }
  ok('a ficha do chamado traz o histórico de prioridade', temHistorico);

  if (temHistorico) {
    const vazio = await pag.evaluate(() =>
      /nunca foi alterada/i.test(document.body.textContent));
    ok('e diz quando a prioridade nunca mudou', vazio);

    await pag.click('button:has-text("Reclassificar prioridade")');
    await pag.waitForTimeout(600);
    // Enviar sem quem pediu: o campo é obrigatório no formulário e no servidor.
    const obrigatorio = await pag.evaluate(() => {
      const campos = [...document.querySelectorAll('form input')];
      const quem = campos.find((c) => c.required);
      return !!quem;
    });
    ok('quem pediu é campo obrigatório', obrigatorio);

    await pag.fill('form input[required]', 'Coordenador de Enfermagem — Maria Souza');
    const motivo = pag.locator('form input:not([required])').last();
    await motivo.fill('Paciente aguardando laudo.');
    await pag.click('form button:has-text("Reclassificar")');
    await pag.waitForTimeout(1800);

    const ficha = await pag.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));
    ok('o histórico passa a mostrar quem pediu',
      /Coordenador de Enfermagem — Maria Souza/.test(ficha));
    ok('com a prioridade de onde partiu', /Baixa\s*→/.test(ficha) || /→\s*Alta/.test(ficha));
  }

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
