// Operabilidade medida NO NAVEGADOR: teclado, nome acessível e foco.
//
// Três defeitos que não aparecem olhando o código e derrubam quem não usa o
// mouse, cada um com a sua pergunta:
//
//   1. ESTE ELEMENTO RESPONDE AO TECLADO? Um `<div onclick>` é clicável e
//      invisível para quem navega por Tab. Vira achado quando tem gesto de
//      clique e não é focável nem tem papel de botão.
//   2. ELE TEM NOME? Um botão cujo conteúdo é só um glifo ("✕", "⛶", "+") não
//      é lido por leitor de tela: "botão" e nada mais. Vira achado quando o
//      nome acessível calculado sai vazio ou é só pontuação.
//   3. DÁ PARA VER ONDE O FOCO ESTÁ? Um controle que apaga o anel do sistema e
//      não põe nada no lugar deixa quem navega por teclado sem saber onde está.
//
// A varredura é por TELA, porque os três dependem do que está pintado.
const { chromium } = require('playwright');
const { irPara, abrirBlocos } = require('./ajuda-testes.cjs');

const TELAS = ['Indicadores Gerais', 'Painel', 'Lançamentos', 'Relatório', 'Conferência',
  'Indicadores', 'Chamados', 'Projetos', 'Integrações', 'Dados', 'Clientes e unidades',
  'Cadastros', 'Metas', 'SLAs', 'Feriados', 'Usuários e acessos', 'Auditoria'];

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
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });

  const falhas = [];
  // Um mesmo controle aparece em toda tela (o menu, o cabeçalho): agrupa pelo
  // que ele É, não por quantas vezes foi visto.
  const vistos = { semTeclado: new Map(), semNome: new Map() };
  for (const tela of TELAS) {
    await irPara(pag, tela, 700);
    await abrirBlocos(pag);
    await pag.waitForTimeout(400);
    const a = await pag.evaluate(MEDIR);
    for (const k of Object.keys(vistos)) {
      for (const item of a[k]) {
        const chave = `${item.el}|${item.txt || item.nome || ''}`;
        if (!vistos[k].has(chave)) vistos[k].set(chave, { ...item, telas: [] });
        vistos[k].get(chave).telas.push(tela);
      }
    }
    const n = a.semTeclado.length + a.semNome.length;
    console.log(`  ${n ? '✗' : '✓'} ${tela}${n ? ` — ${n} achado(s)` : ''}`);
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

  // --------------------------------------------------- foco, com Tab de verdade
  // `el.focus()` do script NÃO casa `:focus-visible` no Chromium: a pseudoclasse
  // existe justamente para distinguir foco de teclado de foco de mouse ou de
  // código. Medir por ali acusaria o sistema inteiro de não ter anel de foco,
  // quando o anel está lá e aparece para quem usa Tab. Então o passo é literal:
  // pressionar Tab e olhar onde o foco caiu.
  console.log('\nFOCO VISÍVEL — percorrendo com Tab (agrupado por forma de controle)');
  const semFoco = [];
  for (const tela of ['Painel', 'Lançamentos', 'Cadastros']) {
    await irPara(pag, tela, 700);
    await abrirBlocos(pag);
    await pag.evaluate(() => document.body.focus());
    const vistosAqui = new Set();
    for (let i = 0; i < 45; i += 1) {
      await pag.keyboard.press('Tab');
      const r = await pag.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const resumo = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`
          + `${el.getAttribute('class') ? '.' + el.getAttribute('class').split(/\s+/).slice(0, 2).join('.') : ''}`;
        const e = getComputedStyle(el);
        // Com o foco APLICADO pelo teclado, o navegador já resolveu
        // :focus-visible: basta perguntar se alguma coisa marca o elemento.
        const temAnel = e.outlineStyle !== 'none' && parseFloat(e.outlineWidth) > 0;
        const temSombra = e.boxShadow && e.boxShadow !== 'none';
        return { resumo, temAnel, temSombra, visivel: el.matches(':focus-visible'),
          txt: (el.textContent || '').trim().slice(0, 28) };
      });
      if (!r) break;
      if (vistosAqui.has(r.resumo)) continue;
      vistosAqui.add(r.resumo);
      if (r.visivel && !r.temAnel && !r.temSombra) semFoco.push({ tela, ...r });
    }
    console.log(`  ${tela}: ${vistosAqui.size} forma(s) distinta(s) de controle`);
  }
  if (semFoco.length) {
    console.log(`\nFOCO INVISÍVEL — ${semFoco.length}`);
    for (const i of semFoco) {
      console.log(`  ${i.resumo} "${i.txt}" (${i.tela})`);
      falhas.push(`semFoco: ${i.resumo}`);
    }
  } else {
    console.log('  nenhuma parada de Tab sem marca visível');
  }

  await nav.close();
  console.log(falhas.length ? `\n${falhas.length} CONTROLE(S) COM ACHADO` : '\nTUDO OPERÁVEL');
  process.exit(falhas.length ? 1 : 0);
})();
