// O CONTROLE ÚNICO na web — a Visão Micro do programa de implantação.
//
// A irmã desta conferência é `artifact/testar-spincare.cjs`, e as duas medem a
// mesma promessa em duas pontas. O servidor já tem `test/spincare.test.ts` e
// `test/carga-spincare.test.ts`, que provam a REGRA; aqui se confere o que só
// existe em pixels.
//
// DUAS COISAS ESTA SUÍTE EXISTE PARA PEGAR:
//
// 1. A unidade SEM COLUNA na planilha aparecendo como 0%. Ela não está
//    atrasada — a planilha ainda não pergunta por ela —, e dizer zero afirma
//    um atraso que ninguém mediu. É o mesmo erro que a onda não vencida já
//    quase cometeu na Visão Macro.
// 2. "Conferir" gravando. O arquivo substitui o controle inteiro, e um botão
//    que grava quando diz que só confere faz perder o controle anterior sem
//    aviso.
//
// O arquivo do cliente NÃO entra aqui: ele traz nomes de funcionários e o
// cronograma comercial. A planilha desta suíte é montada na hora.
//
// Uso: com o servidor no ar sobre uma base de verificação (nunca a base real),
//   CHROMIUM_BIN=/opt/pw-browsers/chromium BASE_URL=http://127.0.0.1:3333 \
//     node web/verificar-controle-unico.cjs
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { chromium } = require('playwright');
const ExcelJS = require(require.resolve('exceljs', {
  paths: [path.join(__dirname, '..', 'server'), path.join(__dirname, '..')],
}));

const B = process.env.BASE_URL || 'http://127.0.0.1:3333';

/** 'AE' → 30. */
const indice = (letras) => {
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/**
 * A planilha de teste.
 *
 * As datas-base são relativas a HOJE de propósito: o farol é medido contra o
 * dia em que a conferência roda, e datas fixas fariam a suíte passar hoje e
 * falhar sozinha no mês que vem — sem nada ter mudado no produto.
 */
async function montarPlanilha() {
  const dia = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Controle Mestre');
  ws.addRow(['Controle Único do Projeto — arquivo de conferência']);
  const cab = [];
  cab[indice('A')] = 'ID';
  cab[indice('F')] = 'Atividade';
  ws.addRow(cab);

  // A: ID · D: frente · F: atividade · G: tipo de entrega · I: caminho
  // J: criticidade · L: executante · M: data-base da onda
  // AE..AG: situação por unidade (HR PB, HM PB, HR CG)
  //
  // TRÊS unidades são preenchidas de propósito: é com mais de uma que o
  // consolidado (o pior caso) se distingue do avanço de cada uma, que é a
  // distinção que esta tela existe para mostrar.
  const linhas = [
    { A: 'PRE-1', F: 'Cadastrar convênios', D: 'Cadastros', G: 'Cadastro', J: 'GO-LIVE',
      L: 'Ana', I: 'Menu > Convênios', M: dia(30),
      AE: 'Concluído', AF: 'Concluído', AG: 'Concluído' },
    { A: 'PRE-2', F: 'Importar base de pacientes', D: 'Cadastros', G: 'Importação de dados',
      J: 'GO-LIVE', L: 'Bruno', M: dia(30),
      AE: 'Concluído', AF: 'Em andamento', AG: 'Concluído' },
    { A: 'PRE-3', F: 'Parametrizar faturamento', D: 'Faturamento', G: 'Parametrização / Regra',
      J: 'GO-LIVE', L: '-', M: dia(-5),
      AE: 'Em andamento', AF: 'Não iniciado', AG: 'Em andamento' },
    { A: 'PRE-4', F: 'Treinar equipe assistencial', D: 'Operação', G: 'Cadastro', J: 'EVOLUÇÃO',
      L: 'Carla', M: dia(60), AE: 'Não iniciado', AG: 'Não iniciado' },
    { A: 'PRE-5', F: 'Integração com laboratório', D: 'Integrações', G: 'Conciliação',
      J: 'ESTABILIZAÇÃO', L: 'Diego', M: dia(10), AE: 'Bloqueado', AG: 'Em andamento' },
    { A: 'PRE-6', F: 'Relatório que saiu do escopo', D: 'Operação', G: 'Cadastro', J: 'EVOLUÇÃO',
      L: 'Ana', AE: 'Cancelado' },
    // Mesmo ID, atividade diferente: a segunda não pode se perder.
    { A: 'PRE-7', F: 'Cadastro de usuários externos', D: 'Cadastros', G: 'Cadastro', J: 'GO-LIVE',
      L: 'Ana', M: dia(20), AE: 'Concluído', AG: 'Concluído' },
    { A: 'PRE-7', F: 'Cadastro de usuários internos', D: 'Cadastros', G: 'Cadastro', J: 'GO-LIVE',
      L: 'Ana', M: dia(20), AE: 'Em andamento', AG: 'Em andamento' },
  ];
  for (const celulas of linhas) {
    const linha = [];
    for (const [letra, valor] of Object.entries(celulas)) linha[indice(letra)] = valor;
    ws.addRow(linha);
  }
  const destino = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'controle-')), 'controle-de-teste.xlsx');
  await wb.xlsx.writeFile(destino);
  return destino;
}

(async () => {
  const arquivo = await montarPlanilha();
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
  const pag = await nav.newPage({ viewport: { width: 1600, height: 1100 } });
  const erros = [];
  pag.on('pageerror', (e) => erros.push(e.message));
  pag.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/ERR_|net::|401|favicon|Failed to load resource/.test(t)) erros.push(t);
  });

  const falhas = [];
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto(B + '/');
  await pag.fill('input[autocomplete="username"], input[name="usuario"]', process.env.USUARIO || 'gestora');
  await pag.fill('input[type=password]', process.env.SENHA || 'varredura2026');
  await pag.click('button[type=submit]');
  await pag.waitForTimeout(1200);
  if (await pag.$('.cartao button')) await pag.click('.cartao button');
  await pag.waitForSelector('.menu a', { timeout: 15000 });

  console.log('\nCAMINHO — a tela existe, em Gestão de Projetos');
  const noMenu = await pag.$('.menu a:has-text("Controle Único")');
  ok('o menu leva ao Controle Único', !!noMenu);
  if (!noMenu) { await nav.close(); process.exit(1); }
  await pag.click('.menu a:has-text("Controle Único")');
  await pag.waitForSelector('.cartao', { timeout: 15000 });
  await pag.waitForTimeout(800);

  const abrirBlocos = async () => {
    for (let i = 0; i < 10; i += 1) {
      // `locator(...).first().click()` em vez de guardar o elemento e clicar
      // depois: entre a busca e o clique o React repinta o cartão, o elemento
      // guardado se solta do DOM e o clique estoura com "Element is not
      // attached to the DOM" — a conferência MORRE no meio, que é pior do que
      // falhar. O locator reencontra o alvo na hora do clique.
      const dobra = pag.locator('.cartao.dobrado .cartao-dobra').first();
      if (!(await dobra.count())) break;
      await dobra.click();
      await pag.waitForTimeout(150);
    }
  };
  await abrirBlocos();
  await pag.waitForSelector('#controle-arquivo', { timeout: 15000 });

  // Começa do zero, sempre: herdar carga de uma execução anterior faria a
  // conferência do "conferir não grava" medir o que já estava lá.
  const limparAntes = await pag.$('button:has-text("Remover o controle")');
  if (limparAntes) {
    await limparAntes.click();
    await pag.waitForSelector('.modal button:has-text("Remover as atividades")', { timeout: 10000 });
    await pag.click('.modal button:has-text("Remover as atividades")');
    await pag.waitForTimeout(1800);
    await abrirBlocos();
    console.log('  · havia controle de uma execução anterior; removido antes de medir');
  }

  // ------------------------------------------------------------- dois passos
  console.log('\nDOIS PASSOS — conferir não grava');
  await pag.setInputFiles('#controle-arquivo', arquivo);
  await pag.waitForTimeout(300);
  await pag.click('button:has-text("Conferir sem gravar")');
  await pag.waitForSelector('.ultima-carga', { timeout: 15000 });
  await pag.waitForTimeout(500);

  const relatorio = await pag.evaluate(() => {
    const c = document.querySelector('.ultima-carga');
    const ficha = {};
    const dts = [...c.querySelectorAll('.ficha dt')];
    const dds = [...c.querySelectorAll('.ficha dd')];
    dts.forEach((dt, i) => { ficha[dt.textContent.trim()] = (dds[i] || {}).textContent.trim(); });
    return {
      texto: c.textContent.replace(/\s+/g, ' '),
      ficha,
      problemas: [...document.querySelectorAll('.lista-problemas li')].map((l) => l.textContent.trim()),
    };
  });
  ok('o relatório diz quantas ATIVIDADES seriam lidas', /8 atividade\(s\) seriam lidas/.test(relatorio.texto),
    relatorio.texto.slice(0, 80));
  ok('e diz, em palavras, que nada foi gravado', /[Nn]ada foi gravado/.test(relatorio.texto));
  ok('o diagnóstico conta quem está sem executante', relatorio.ficha['Sem executante'] === '1',
    JSON.stringify(relatorio.ficha));
  ok('e conta as unidades que a planilha ainda não acompanha',
    relatorio.ficha['Unidades sem coluna'] === '3', relatorio.ficha['Unidades sem coluna']);
  ok('o ID repetido vira ponto de atenção, e não perda silenciosa',
    relatorio.problemas.some((p) => /nomeia mais de uma atividade/.test(p)),
    relatorio.problemas.join(' | ').slice(0, 120));

  await abrirBlocos();
  const aposConferir = await pag.evaluate(() => (document.body.textContent || '').replace(/\s+/g, ' '));
  ok('depois de conferir, a tela segue sem controle carregado',
    /Nenhuma atividade carregada ainda/.test(aposConferir));

  // ---------------------------------------------------------------- gravar
  console.log('\nGRAVAR — aí sim o controle entra');
  await pag.setInputFiles('#controle-arquivo', arquivo);
  await pag.waitForTimeout(300);
  await pag.click('button:has-text("Carregar e substituir")');
  await pag.waitForTimeout(2500);
  await abrirBlocos();
  const gravou = await pag.evaluate(() => (document.querySelector('.ultima-carga') || {}).textContent || '');
  ok('o relatório confirma a gravação', /8 atividade\(s\) gravada/.test(gravou.replace(/\s+/g, ' ')),
    gravou.replace(/\s+/g, ' ').slice(0, 80));

  // ---------------------------------------------------------------- o placar
  console.log('\nAVANÇO — o ponderado pesa a criticidade, e o simples vai ao lado');
  const placar = await pag.evaluate(() => {
    const saida = {};
    for (const i of document.querySelectorAll('.indicador')) {
      const r = (i.querySelector('.rotulo') || {}).textContent;
      if (r) {
        saida[r.trim()] = {
          numero: ((i.querySelector('.numero') || {}).textContent || '').trim(),
          apoio: ((i.querySelector('.apoio') || {}).textContent || '').trim(),
        };
      }
    }
    return saida;
  });
  console.log('  ·', JSON.stringify(placar));
  ok('são 8 atividades', (placar['Atividades'] || {}).numero === '8');
  ok('a cancelada sai do denominador: 7 entram no avanço',
    /7 entram/.test((placar['Atividades'] || {}).apoio || ''), (placar['Atividades'] || {}).apoio);
  ok('os dois avanços aparecem, e são diferentes',
    (placar['Avanço ponderado'] || {}).numero !== (placar['Avanço simples'] || {}).numero,
    `${(placar['Avanço ponderado'] || {}).numero} × ${(placar['Avanço simples'] || {}).numero}`);
  ok('a tela explica em palavras o que a diferença entre eles significa',
    /quando o ponderado é menor/i.test(
      await pag.evaluate(() => document.body.textContent.replace(/\s+/g, ' '))));
  // Uma bloqueada e uma vencida em aberto.
  ok('o vermelho conta bloqueada e vencida em aberto',
    (placar['Em vermelho'] || {}).numero === '2', (placar['Em vermelho'] || {}).numero);

  // ------------------------------------------------------------- por unidade
  console.log('\nPOR UNIDADE — e a que não tem coluna NÃO é zero');
  const unidades = await pag.evaluate(() => {
    const t = [...document.querySelectorAll('table')].find((x) => /Unidade/.test(
      (x.querySelector('thead') || {}).textContent || ''));
    if (!t) return null;
    return [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
  });
  ok('a tabela por unidade existe', !!unidades);
  if (unidades) {
    console.log(unidades.slice(0, 7).map((u) => '     ' + u.slice(0, 4).join(' | ')).join('\n'));
    const hrpb = unidades.find((u) => /^HR PB/.test(u[0]));
    ok('HR PB aparece com a onda vinda do cronograma', hrpb && /2ª/.test(hrpb[1]), hrpb && hrpb[1]);
    ok('e com avanço medido, não consolidado', hrpb && /%/.test(hrpb[3]), hrpb && hrpb[3]);

    const semColuna = unidades.find((u) => /unidade 7/.test(u[0]));
    ok('a unidade sem coluna na planilha DIZ que está sem base, e não 0%',
      semColuna && /sem coluna na planilha/.test(semColuna[3]) && !/0,0%/.test(semColuna[3]),
      semColuna && semColuna[3]);
    ok('a tela explica por que "sem coluna" não é zero',
      /não está em zero: ela está sem base/i.test(
        await pag.evaluate(() => document.body.textContent.replace(/\s+/g, ' '))));
  }

  // -------------------------------------------------------------- a listagem
  console.log('\nATIVIDADES — da mais urgente para a menos');
  const lista = await pag.evaluate(() => {
    const t = [...document.querySelectorAll('table')].find((x) => /Farol/.test(
      (x.querySelector('thead') || {}).textContent || ''));
    if (!t) return null;
    const cab = [...t.querySelectorAll('thead th')].map((h) => h.textContent.trim());
    return {
      cabecalho: cab,
      linhas: [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim())),
      iFarol: cab.indexOf('Farol'),
    };
  });
  ok('a tabela de atividades existe', !!lista);
  if (lista) {
    console.log(lista.linhas.map((l) => `     ${l[0]} ${l[1].padEnd(32).slice(0, 32)} ${l[lista.iFarol]}`).join('\n'));
    ok('as oito atividades estão lá', lista.linhas.length === 8, `${lista.linhas.length}`);
    ok('a coluna de cada unidade acompanhada aparece',
      ['HR PB', 'HM PB', 'HR CG'].every((u) => lista.cabecalho.includes(u)),
      lista.cabecalho.join(' | '));
    const ordem = lista.linhas.map((l) => l[lista.iFarol]);
    const peso = { VERMELHO: 0, AMARELO: 1, VERDE: 2, 'N/A': 3 };
    ok('a urgência é decrescente do começo ao fim',
      ordem.every((v, i) => i === 0 || peso[ordem[i - 1]] <= peso[v]), ordem.join(' ≤ '));
    ok('a cancelada fica no fim, como N/A', /N\/A/.test(ordem[ordem.length - 1]), ordem[ordem.length - 1]);
    ok('o ID repetido aparece duas vezes, com atividades diferentes',
      lista.linhas.filter((l) => l[0] === 'PRE-7').length === 2,
      lista.linhas.filter((l) => l[0] === 'PRE-7').map((l) => l[1]).join(' // '));
  }

  // ---------------------------------------------------------------- o corte
  console.log('\nCORTES — recortam a lista sem mexer no placar');
  await pag.selectOption('#controle-corte-farol', 'VERMELHO');
  await pag.waitForTimeout(500);
  const recortada = await pag.evaluate(() => {
    const t = [...document.querySelectorAll('table')].find((x) => /Farol/.test(
      (x.querySelector('thead') || {}).textContent || ''));
    const ind = [...document.querySelectorAll('.indicador')]
      .find((i) => /Atividades/.test((i.querySelector('.rotulo') || {}).textContent || ''));
    return {
      linhas: t ? t.querySelectorAll('tbody tr').length : -1,
      total: ind ? (ind.querySelector('.numero') || {}).textContent.trim() : '',
    };
  });
  ok('o corte por farol reduz a lista', recortada.linhas === 2, `${recortada.linhas} linha(s)`);
  ok('e o placar NÃO muda — ele é do controle, não do recorte', recortada.total === '8', recortada.total);
  await pag.click('button:has-text("Limpar filtros")');
  await pag.waitForTimeout(500);

  // --------------------------------------------------------------- o detalhe
  console.log('\nDETALHE — a atividade abre com o que a planilha trouxe');
  await pag.click('table button:has-text("Ver")');
  await pag.waitForSelector('.modal', { timeout: 10000 });
  await pag.waitForTimeout(400);
  const modal = await pag.evaluate(() => {
    const m = document.querySelector('.modal');
    return {
      titulo: (m.querySelector('h2') || {}).textContent || '',
      rotulos: [...m.querySelectorAll('.ficha dt')].map((d) => d.textContent.trim()),
      texto: m.textContent.replace(/\s+/g, ' '),
    };
  });
  ok('o título traz ID e atividade', /PRE-\d/.test(modal.titulo), modal.titulo.slice(0, 60));
  ok('a ficha traz criticidade, prazo e situação consolidada',
    ['Criticidade', 'Dias para o prazo', 'Situação consolidada', 'Farol'].every((r) => modal.rotulos.includes(r)),
    modal.rotulos.join(' | '));
  ok('e o critério de aceite, que é calculado e não guardado',
    /Critério de aceite/.test(modal.texto) && /amostragem|conferida|Regra configurada|conciliadas|Jornada/.test(modal.texto));
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(400);

  // ----------------------------------------------------------- a substituição
  console.log('\nSUBSTITUIR — a segunda carga troca, não soma');
  await pag.setInputFiles('#controle-arquivo', arquivo);
  await pag.waitForTimeout(300);
  await pag.click('button:has-text("Carregar e substituir")');
  await pag.waitForTimeout(2500);
  await abrirBlocos();
  const segunda = await pag.evaluate(() => {
    const t = [...document.querySelectorAll('table')].find((x) => /Farol/.test(
      (x.querySelector('thead') || {}).textContent || ''));
    return {
      linhas: t ? t.querySelectorAll('tbody tr').length : -1,
      texto: (document.querySelector('.ultima-carga') || {}).textContent?.replace(/\s+/g, ' ') || '',
    };
  });
  ok('seguem sendo oito, e não dezesseis', segunda.linhas === 8, `${segunda.linhas}`);
  ok('e o relatório diz quantas saíram no lugar', /no lugar de 8 anterior/.test(segunda.texto),
    segunda.texto.slice(0, 90));

  // -------------------------------------------------------- acessibilidade
  console.log('\nACESSIBILIDADE E CONTRASTE');
  const a11y = await pag.evaluate(() => {
    const campos = [...document.querySelectorAll('select, input:not([type=hidden])')];
    return {
      quantos: campos.length,
      semRotulo: campos.filter((c) => !c.id || !document.querySelector(`label[for="${CSS.escape(c.id)}"]`))
        .map((c) => c.id || c.type),
      cabecalhosSemTexto: [...document.querySelectorAll('th')]
        .filter((t) => !t.textContent.trim() && !t.getAttribute('aria-label')).length,
    };
  });
  ok('todo campo tem rótulo ligado por "for"', a11y.semRotulo.length === 0, a11y.semRotulo.join(', '));
  ok('nenhum cabeçalho de coluna fica mudo', a11y.cabecalhosSemTexto === 0,
    `${a11y.cabecalhosSemTexto} sem texto nem aria-label`);
  const etiquetas = await pag.$$eval('.etiqueta', (es) => es.map((e) => e.textContent.trim()).filter(Boolean));
  ok('a situação vem por extenso, e não só por cor',
    etiquetas.length > 0 && etiquetas.every((t) => t.length > 1), `${etiquetas.length} etiqueta(s)`);

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
      for (const e of document.querySelectorAll(
        '.cartao h2, .indicador .rotulo, .indicador .numero, .indicador .apoio, .nota, .etiqueta, td, th, .arv-comp')) {
        if (!e.textContent.trim()) continue;
        const s = getComputedStyle(e);
        const px = parseFloat(s.fontSize);
        const grande = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700);
        const r = razao(s.color, fundo(e));
        if (r < (grande ? 3 : 4.5)) ruins.push(`${e.className || e.tagName} ${px}px ${r.toFixed(2)}`);
      }
      return [...new Set(ruins)];
    });
    ok(`tema ${tema}: nada abaixo da régua AA`, abaixo.length === 0, abaixo.slice(0, 5).join(', ') || 'tudo acima');
  }
  await pag.evaluate(() => document.documentElement.removeAttribute('data-theme'));

  console.log(`\n=== erros de console: ${erros.length ? erros.slice(0, 4).join(' | ') : 'nenhum'} ===`);
  console.log(`=== ✗=${falhas.length} ===`);
  if (falhas.length) falhas.forEach((f) => console.log('  ✗ ' + f));
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
