// O atalho de conteúdo e a tela estreita, no app React.
//
// A MESMA régua de `artifact/testar-estreito.cjs`. Aqui o menu lateral tem
// dezenove itens: quem navega por Tab atravessa todos antes de chegar ao
// conteúdo, em TODA tela, de novo.
//
//   DATABASE_PATH=/tmp/claude-0/verif-saida.sqlite PORT=3401 JWT_SECRET=<32+> node server/dist/index.js
//   BASE_URL=http://localhost:3401 node web/verificar-estreito.cjs
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3401';
const SENHA = process.env.SENHA || 'varredura2026';

const TELAS = [
  ['/', 'Painel executivo'], ['/indicadores', 'Indicadores Gerais'],
  ['/financeiro', 'Dashboard financeiro'], ['/lancamentos', 'Lançamentos'],
  ['/fechamentos', 'Fechamento'], ['/conferencia', 'Conferência'],
  ['/relatorio', 'Relatório'], ['/projetos', 'Projetos'],
  ['/projetos/cadastro', 'Projetos e tarefas'], ['/sla', 'SLA'],
  ['/sla/registros', 'Chamados'], ['/suporte/integracoes', 'Integrações'],
  ['/planilhas', 'Planilhas'], ['/clientes', 'Clientes'], ['/cadastros', 'Cadastros'],
  ['/metas', 'Metas'], ['/slas', 'SLAs'], ['/reducao', 'Plano de redução'],
  ['/reconhecedores', 'Quem reconhece'], ['/acessos', 'Acessos'], ['/auditoria', 'Auditoria'],
];

const entrar = async (pag) => {
  await pag.goto(BASE + '/');
  await pag.waitForLoadState('networkidle');
  await pag.fill('input[autocomplete="username"], input[name="usuario"]', 'gestora');
  await pag.fill('input[type="password"]', SENHA);
  await pag.click('button[type="submit"]');
  await pag.waitForSelector('h1', { timeout: 15000 });
  await pag.waitForTimeout(700);
  if (await pag.$('.cartao button')) await pag.click('.cartao button');
  await pag.waitForSelector('.menu a', { timeout: 15000 });
};

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const falhas = [];
  const erros = [];
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  const pag = await nav.newPage({ viewport: { width: 1440, height: 1000 } });
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/ERR_|net::|favicon|Failed to load resource/.test(t)) erros.push(t);
  });
  await entrar(pag);

  console.log('\nATALHO DE CONTEÚDO');
  await pag.evaluate(() => document.body.focus());
  await pag.keyboard.press('Tab');
  await pag.waitForTimeout(320);
  const primeira = await pag.evaluate(() => ({
    classe: document.activeElement?.getAttribute('class'),
    txt: (document.activeElement?.textContent || '').trim(),
    visivel: document.activeElement?.getBoundingClientRect().top >= 0,
  }));
  ok('a primeira tabulação da página é o atalho',
    primeira.classe === 'pular' && /Pular para o conteúdo/.test(primeira.txt), JSON.stringify(primeira));
  ok('ele aparece ao receber foco (estava fora da tela)', primeira.visivel === true);
  await pag.keyboard.press('Enter');
  await pag.waitForTimeout(300);
  ok('Enter move o FOCO para o conteúdo, não só a rolagem',
    await pag.evaluate(() => document.activeElement?.id === 'conteudo'),
    await pag.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));
  await pag.close();

  console.log('\n390 px — a PÁGINA não rola para o lado');
  const estreita = await nav.newPage({ viewport: { width: 390, height: 844 } });
  estreita.on('pageerror', (e) => erros.push('pageerror(390): ' + e.message));
  await entrar(estreita);
  for (const [rota, nome] of TELAS) {
    await estreita.goto(BASE + rota);
    await estreita.waitForTimeout(1300);
    const m = await estreita.evaluate(() => {
      const d = document.documentElement;
      let culpado = null;
      if (d.scrollWidth > d.clientWidth + 1) {
        for (const el of document.querySelectorAll('.pagina *')) {
          const r = el.getBoundingClientRect();
          if (r.right <= d.clientWidth + 1) continue;
          // Tabela que rola dentro da caixa dela é desenho, não defeito.
          if (el.closest('.tabela-envolucro,.rol-fixo,.indicador-unidades-corpo,.modal')) continue;
          culpado = `${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').split(/\s+/)[0]}`
            + ` (direita ${Math.round(r.right)}px)`;
          break;
        }
      }
      return { scroll: d.scrollWidth, cliente: d.clientWidth, culpado };
    });
    const bom = m.scroll <= m.cliente + 1;
    ok(nome, bom, bom ? '' : `${m.scroll} > ${m.cliente}${m.culpado ? ' · ' + m.culpado : ' · culpado fora da página'}`);
  }
  await estreita.close();

  console.log('\nERROS DE CONSOLE: ' + (erros.length ? erros.join(' | ') : 'nenhum'));
  await nav.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S): ` + falhas.join(' · ') : '\nTUDO VERDE');
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
