// Operabilidade medida NO NAVEGADOR: teclado, nome acessível e foco.
//
// A MESMA régua de `artifact/testar-operavel.cjs`, aqui sobre o app React. As
// três perguntas são as mesmas — este elemento responde ao teclado, ele tem
// nome, e dá para ver onde o foco está — porque o que muda entre as duas
// superfícies é a implementação, não o que a pessoa precisa conseguir fazer.
//
//   DATABASE_PATH=/tmp/claude-0/verif-saida.sqlite PORT=3401 JWT_SECRET=<32+> node server/dist/index.js
//   BASE_URL=http://localhost:3401 node web/verificar-operavel.cjs
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

const MEDIR = () => {
  // Glifos que o sistema usa como ícone. Um botão cujo nome acessível é só
  // isto não tem nome nenhum para quem ouve a tela. Vive AQUI dentro porque
  // esta função é serializada e executada na página, longe deste arquivo.
  const SO_GLIFO = /^[\s✕⛶+\-−×↗⇅⇄◆◱≡⊘⚖▦◈◫◷·⬢⚙◉↑↓←→«»…⋮⌄⌃▸▾▴◂☰🔍]*$/u;
  const visivel = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const e = getComputedStyle(el);
    return e.visibility !== 'hidden' && e.display !== 'none' && Number(e.opacity) > 0.05;
  };
  // O nome acessível, na ordem que o navegador usa.
  const nomeDe = (el) => {
    const rotulado = el.getAttribute('aria-labelledby');
    if (rotulado) {
      const txt = rotulado.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ');
      if (txt.trim()) return txt.trim();
    }
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l && l.textContent.trim()) return l.textContent.trim();
      }
      const envolve = el.closest('label');
      if (envolve && envolve.textContent.trim()) return envolve.textContent.trim();
      const campo = el.closest('.campo');
      const rot = campo && campo.querySelector('label');
      if (rot && rot.textContent.trim()) return rot.textContent.trim();
      if (el.placeholder && el.placeholder.trim()) return el.placeholder.trim();
      const t = el.getAttribute('title');
      return t && t.trim() ? t.trim() : '';
    }
    const txt = (el.textContent || '').trim();
    if (txt) return txt;
    const t = el.getAttribute('title');
    return t && t.trim() ? t.trim() : '';
  };
  const resumo = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`
    + `${el.getAttribute('class') ? '.' + el.getAttribute('class').split(/\s+/).slice(0, 2).join('.') : ''}`;

  const achados = { semTeclado: [], semNome: [] };

  // 1 — gesto de clique sem caminho de teclado.
  for (const el of document.querySelectorAll('[onclick], [data-drill], .drill, [role="button"]')) {
    if (!visivel(el)) continue;
    const tag = el.tagName;
    const nativo = tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'LABEL';
    if (nativo) continue;
    const focavel = el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1';
    // Um contêiner cujo clique é delegado aos botões dentro dele não é o alvo:
    // o caminho de teclado existe, só que nos filhos.
    const temFilhoOperavel = el.querySelector('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focavel && !temFilhoOperavel) achados.semTeclado.push({ el: resumo(el), txt: (el.textContent || '').trim().slice(0, 40) });
  }

  // 2 — controle operável sem nome acessível.
  for (const el of document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])')) {
    if (!visivel(el)) continue;
    if (el.getAttribute('aria-hidden') === 'true' || el.closest('[aria-hidden="true"]')) continue;
    if (el.type === 'checkbox' || el.type === 'radio') {
      // Caixa de seleção dentro de <label> é nomeada pelo rótulo que a envolve.
      if (el.closest('label')) continue;
    }
    const nome = nomeDe(el);
    if (!nome || SO_GLIFO.test(nome)) achados.semNome.push({ el: resumo(el), nome });
  }

  return achados;
};

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pag = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  await pag.goto(BASE + '/');
  await pag.waitForLoadState('networkidle');
  await pag.fill('input[autocomplete="username"], input[name="usuario"]', 'gestora');
  await pag.fill('input[type="password"]', SENHA);
  await pag.click('button[type="submit"]');
  await pag.waitForSelector('h1', { timeout: 15000 });
  await pag.waitForTimeout(600);
  if (await pag.$('.cartao button')) await pag.click('.cartao button');
  await pag.waitForSelector('.menu a', { timeout: 15000 });

  const falhas = [];
  const vistos = { semTeclado: new Map(), semNome: new Map() };
  for (const [rota, nome] of TELAS) {
    await pag.goto(BASE + rota);
    await pag.waitForTimeout(1400);
    const a = await pag.evaluate(MEDIR);
    for (const k of Object.keys(vistos)) {
      for (const item of a[k]) {
        const chave = `${item.el}|${item.txt || item.nome || ''}`;
        if (!vistos[k].has(chave)) vistos[k].set(chave, { ...item, telas: [] });
        vistos[k].get(chave).telas.push(nome);
      }
    }
    const n = a.semTeclado.length + a.semNome.length;
    console.log(`  ${n ? '✗' : '✓'} ${nome}${n ? ` — ${n} achado(s)` : ''}`);
  }

  const secao = (k, titulo) => {
    const lista = [...vistos[k].values()];
    if (!lista.length) return;
    console.log(`\n${titulo} — ${lista.length} distinto(s)`);
    for (const i of lista) {
      console.log(`  ${i.el} "${i.txt || i.nome || ''}" (${i.telas.length} tela(s): ${i.telas.slice(0, 3).join(', ')}${i.telas.length > 3 ? '…' : ''})`);
      falhas.push(`${k}: ${i.el}`);
    }
  };
  secao('semTeclado', 'CLIQUE SEM CAMINHO DE TECLADO');
  secao('semNome', 'CONTROLE SEM NOME ACESSÍVEL');

  // Foco, com Tab de verdade: `el.focus()` do script NÃO casa `:focus-visible`
  // no Chromium — a pseudoclasse existe justamente para separar foco de teclado
  // de foco de mouse ou de código.
  console.log('\nFOCO VISÍVEL — percorrendo com Tab (agrupado por forma de controle)');
  const semFoco = [];
  for (const [rota, nome] of [['/', 'Painel executivo'], ['/lancamentos', 'Lançamentos'], ['/cadastros', 'Cadastros']]) {
    await pag.goto(BASE + rota);
    await pag.waitForTimeout(1400);
    await pag.evaluate(() => document.body.focus());
    const vistosAqui = new Set();
    for (let i = 0; i < 60; i += 1) {
      await pag.keyboard.press('Tab');
      const r = await pag.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const resumo = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`
          + `${el.getAttribute('class') ? '.' + el.getAttribute('class').split(/\s+/).slice(0, 2).join('.') : ''}`;
        const e = getComputedStyle(el);
        const temAnel = e.outlineStyle !== 'none' && parseFloat(e.outlineWidth) > 0;
        const temSombra = e.boxShadow && e.boxShadow !== 'none';
        return { resumo, temAnel, temSombra, visivel: el.matches(':focus-visible'),
          txt: (el.textContent || '').trim().slice(0, 28) };
      });
      if (!r) break;
      if (vistosAqui.has(r.resumo)) continue;
      vistosAqui.add(r.resumo);
      if (r.visivel && !r.temAnel && !r.temSombra) semFoco.push({ tela: nome, ...r });
    }
    console.log(`  ${nome}: ${vistosAqui.size} forma(s) distinta(s) de controle`);
  }
  if (semFoco.length) {
    console.log(`\nFOCO INVISÍVEL — ${semFoco.length}`);
    for (const i of semFoco) { console.log(`  ${i.resumo} "${i.txt}" (${i.tela})`); falhas.push(`semFoco: ${i.resumo}`); }
  } else {
    console.log('  nenhuma parada de Tab sem marca visível');
  }

  await nav.close();
  console.log(falhas.length ? `\n${falhas.length} CONTROLE(S) COM ACHADO` : '\nTUDO OPERÁVEL');
  process.exit(falhas.length ? 1 : 0);
})();
