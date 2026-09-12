// O perfil governa o menu e os botões do app local, e o servidor continua
// sendo quem recusa: as duas metades são conferidas aqui. Esconder botão não é
// segurança — por isso a última conferência bate na API direto, sem passar pela
// tela, e espera 403.
//
// Suba o servidor com uma base isolada e dois usuários: um gestor e um com o
// perfil Somente Visualização. Depois:
//   BASE_URL=http://127.0.0.1:3348 GESTOR=gestor LEITORA=leitora \
//   SENHA=... node web/verificar-perfil.cjs
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3348';
const SENHA = process.env.SENHA || 'varredura2026';
const GESTOR = process.env.GESTOR || 'gestor';
const LEITORA = process.env.LEITORA || 'leitora';

const entrar = async (pag, usuario, senha) => {
  await pag.goto(BASE + '/');
  await pag.waitForLoadState('networkidle');
  await pag.fill('input[autocomplete="username"], input[name="usuario"]', usuario);
  await pag.fill('input[type="password"]', senha);
  await pag.click('button[type="submit"]');
  await pag.waitForSelector('.menu a', { timeout: 15000 });
  await pag.waitForTimeout(1200);
};
const menu = (pag) => pag.$$eval('.menu a', (as) => as.map((a) => a.textContent.trim()));

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const falhas = [];
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  const gestor = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  await entrar(gestor, GESTOR, SENHA);
  const mGestor = await menu(gestor);
  ok('o gestor vê Usuários e acessos', mGestor.some((t) => /Usuários e acessos/.test(t)));
  ok('e vê Integrações', mGestor.some((t) => /Integrações/.test(t)));
  await gestor.goto(BASE + '/lancamentos');
  await gestor.waitForTimeout(1800);
  const btGestor = await gestor.$$eval('button', (bs) => bs.filter((b) => /Novo lançamento/.test(b.textContent)).length);
  ok('e tem o botão de novo lançamento', btGestor === 1, `${btGestor}`);

  const leitora = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  await entrar(leitora, LEITORA, SENHA);
  const mLeitora = await menu(leitora);
  ok('quem só lê não vê Usuários e acessos', !mLeitora.some((t) => /Usuários e acessos/.test(t)), mLeitora.join(' · '));
  ok('nem Integrações', !mLeitora.some((t) => /Integrações/.test(t)));
  ok('mas continua com o financeiro', mLeitora.some((t) => /Lançamentos/.test(t)));
  const perfilNoTopo = await leitora.$eval('.titulo small', (e) => e.textContent.trim());
  ok('o topo diz qual é o perfil', /Somente Visualização/.test(perfilNoTopo), perfilNoTopo);

  await leitora.goto(BASE + '/lancamentos');
  await leitora.waitForTimeout(1800);
  const btLeitora = await leitora.$$eval('button', (bs) => bs.filter((b) => /Novo lançamento/.test(b.textContent)).length);
  ok('e não recebe o botão de novo lançamento', btLeitora === 0, `${btLeitora}`);

  // A metade que importa: o servidor recusa mesmo sem passar pela tela.
  const recusa = await leitora.evaluate(async (base) => {
    const t = JSON.parse(localStorage.getItem('gsti.sessao') || '{}').token
      || localStorage.getItem('gsti.token') || '';
    const r = await fetch(base + '/api/acesso/usuarios', {
      headers: { authorization: 'Bearer ' + t.replace(/^"|"$/g, ''), 'X-Empresa-Id': '1' } });
    return r.status;
  }, BASE);
  ok('o servidor recusa a rota administrativa', recusa === 403 || recusa === 401, `HTTP ${recusa}`);

  console.log(`\n${falhas.length ? '✗ ' + falhas.length + ' falha(s)' : '✓ tudo certo'}`);
  await nav.close();
  process.exit(falhas.length ? 1 : 0);
})();
