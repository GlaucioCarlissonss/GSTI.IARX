// A TELA DO PLANO DE AÇÃO, no navegador.
//
// A irmã desta conferência é `artifact/testar-plano-acao.cjs`, e as duas medem
// a mesma promessa em duas pontas. O servidor já tem conferência de domínio —
// `server/test/plano-acao.test.ts` e `carga-plano-acao.test.ts` —, e ela não
// cobre o que só existe em pixels: se a carga realmente tem dois passos, se a
// lista sai da mais urgente para a menos, se a tela diz em palavras o que a
// cor mostra.
//
// O QUE MAIS IMPORTA AQUI é o DOIS PASSOS. "Conferir" não pode gravar. Um
// botão que grava quando diz que só confere é o defeito mais caro desta tela:
// o arquivo substitui o plano inteiro, e quem clicou achando que estava
// olhando perdeu o plano anterior sem ser avisado. A conferência exercita os
// dois botões e mede a tela ENTRE eles.
//
// O arquivo do cliente NÃO entra aqui: ele traz nomes de pessoas e o
// cronograma comercial. A planilha desta suíte é montada na hora, com nomes
// inventados, reproduzindo o layout.
//
// Uso: com o servidor no ar sobre uma base de verificação (nunca a base real),
//   CHROMIUM_BIN=/opt/pw-browsers/chromium BASE_URL=http://127.0.0.1:3333 \
//     node web/verificar-plano-acao.cjs
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { chromium } = require('playwright');
// `exceljs` é dependência do servidor e fica no node_modules da raiz do
// monorepo; o `require` daqui não o alcança por nome sozinho.
const ExcelJS = require(require.resolve('exceljs', { paths: [path.join(__dirname, '..', 'server'), path.join(__dirname, '..')] }));

const B = process.env.BASE_URL || 'http://127.0.0.1:3333';

const CABECALHO = ['Nº', 'Tarefa', 'Área Responsável', 'Líder de Equipe',
  'Data Início', 'Data Fim', 'Qtd Dias', 'Status da Ação'];

/**
 * A planilha de teste.
 *
 * As datas são relativas a HOJE de propósito: o farol é medido contra o dia
 * em que a conferência roda, e datas fixas fariam a suíte passar hoje e
 * falhar sozinha no mês que vem — sem nada ter mudado no produto.
 */
async function montarPlanilha() {
  const dia = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };
  const wb = new ExcelJS.Workbook();
  const abas = [
    ['Onda 1', '01/10/2026', [
      [1, 'Levantar inventário', 'Infraestrutura', 'Equipe Alfa', dia(-40), dia(-20), '20', 'Concluído'],
      [2, 'Migrar base de dados', 'Aplicações', 'Equipe Beta', dia(-30), dia(-5), '25', 'Em andamento'],
      [3, 'Treinar equipe local', 'Operações', 'Equipe Gama', dia(-10), dia(2), '12', 'Em andamento'],
      [4, 'Revisar contratos', 'Jurídico', 'Equipe Delta', dia(1), dia(40), '39', 'Não iniciado'],
    ]],
    ['Onda 2', '03/11/2026', [
      [1, 'Preparar rede', 'Infraestrutura', 'Equipe Alfa', dia(-5), dia(25), '30', 'Não iniciado'],
      [2, 'Homologar integração', '-', '', dia(0), '', '', 'Status Esquisito'],
      [3, 'Desmobilizar piloto', 'Operações', 'Equipe Gama', dia(-60), dia(-50), '10', 'Cancelado'],
    ]],
  ];
  for (const [nome, golive, linhas] of abas) {
    const ws = wb.addWorksheet(nome);
    ws.addRow([`${nome} • Go-live: ${golive} • Unidades: Unidade Alfa, Unidade Beta`]);
    ws.addRow(['']);
    ws.addRow(CABECALHO);
    for (const l of linhas) ws.addRow(l);
  }
  const destino = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plano-')), 'plano-de-teste.xlsx');
  await wb.xlsx.writeFile(destino);
  return destino;
}

(async () => {
  const arquivo = await montarPlanilha();
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const erros = [];
  pag.on('pageerror', (e) => erros.push(e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::|401|favicon/.test(m.text())) erros.push(m.text()); });

  const falhas = [];
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto(B + '/');
  await pag.fill('input[autocomplete="username"], input[name="usuario"]', process.env.USUARIO || 'gestora');
  await pag.fill('input[type=password]', process.env.SENHA || 'varredura2026');
  await pag.click('button[type=submit]');
  await pag.waitForTimeout(1200);
  if (await pag.$('.cartao button')) await pag.click('.cartao button');
  await pag.waitForSelector('.menu a', { timeout: 15000 });

  // --------------------------------------------------------------- o caminho
  console.log('\nCAMINHO — a tela existe, e mora na Gestão de Projetos');
  const noMenu = await pag.$('.menu a:has-text("Plano de Ação")');
  ok('o menu leva ao Plano de Ação', !!noMenu);
  if (!noMenu) { await nav.close(); process.exit(1); }
  await pag.click('.menu a:has-text("Plano de Ação")');
  await pag.waitForSelector('.cartao', { timeout: 15000 });
  await pag.waitForTimeout(600);

  const abrirTudo = async () => {
    // Os blocos são acordeão. Abrir todos antes de medir é o que evita a
    // asserção que passa por vazia — um seletor sobre bloco fechado não acha
    // nada, e "nada" não é o mesmo que "está certo".
    for (let i = 0; i < 8; i += 1) {
      const fechado = await pag.$('.cartao.dobrado .cartao-dobra');
      if (!fechado) break;
      await fechado.click();
      await pag.waitForTimeout(150);
    }
  };
  await abrirTudo();
  await pag.waitForSelector('#plano-arquivo', { timeout: 15000 });

  // A suíte começa do zero, sempre. Herdar o plano de uma execução anterior
  // faria a conferência do "conferir não grava" medir um plano que já estava
  // lá — e ela passaria a acusar o produto por sujeira da própria suíte.
  const limparAntes = await pag.$('button:has-text("Remover o plano carregado")');
  if (limparAntes) {
    await limparAntes.click();
    await pag.waitForSelector('.modal button:has-text("Remover as ações")', { timeout: 10000 });
    await pag.click('.modal button:has-text("Remover as ações")');
    await pag.waitForTimeout(1800);
    await abrirTudo();
    console.log('  · havia plano de uma execução anterior; removido antes de medir');
  }

  const placarVazio = await pag.$$eval('.indicador .numero', (ns) => ns.map((n) => n.textContent.trim()));
  console.log(`  · a tela abre sem plano: ${placarVazio.length} indicador(es)`);

  // ------------------------------------------------------------- dois passos
  console.log('\nDOIS PASSOS — conferir não grava, e é o que esta suíte mais vigia');
  await pag.setInputFiles('#plano-arquivo', arquivo);
  await pag.waitForTimeout(300);
  await pag.click('button:has-text("Conferir sem gravar")');
  await pag.waitForSelector('.ultima-carga', { timeout: 15000 });
  await pag.waitForTimeout(400);

  const relatorio = await pag.evaluate(() => {
    const c = document.querySelector('.ultima-carga');
    // A ficha é lida PAR A PAR, e não pelo texto achatado: ali "Sem data de
    // fim" com valor 1, seguido do título "2 ponto(s) de atenção", vira
    // "fim12" — e uma asserção sobre esse texto mede ruído.
    const ficha = {};
    const dts = c ? [...c.querySelectorAll('.ficha dt')] : [];
    const dds = c ? [...c.querySelectorAll('.ficha dd')] : [];
    dts.forEach((dt, i) => { ficha[dt.textContent.trim()] = (dds[i] || {}).textContent.trim(); });
    return {
      texto: c ? c.textContent.replace(/\s+/g, ' ').trim() : '',
      ficha,
      problemas: [...document.querySelectorAll('.lista-problemas li')].map((l) => l.textContent.trim()),
    };
  });
  ok('o relatório diz quantas AÇÕES seriam lidas', /7 ação/.test(relatorio.texto), relatorio.texto.slice(0, 90));
  ok('e diz, em palavras, que nada foi gravado',
    /[Nn]ada foi gravado/.test(relatorio.texto), relatorio.texto.slice(0, 120));
  ok('o diagnóstico conta o que a planilha deixou vazio',
    relatorio.ficha['Sem data de fim'] === '1'
    && relatorio.ficha['Sem área responsável'] === '1'
    && relatorio.ficha['Sem líder de equipe'] === '1',
    JSON.stringify(relatorio.ficha));
  ok('e diz quantas ações cada onda traz',
    relatorio.ficha['Ondas no arquivo'] === '1ª: 4 · 2ª: 3', relatorio.ficha['Ondas no arquivo']);
  ok('o status desconhecido vira ponto de atenção, e não silêncio',
    relatorio.problemas.some((p) => /Status Esquisito/.test(p)),
    relatorio.problemas.join(' | ').slice(0, 150));

  // E a prova de que conferir NÃO gravou: a tela segue dizendo que não há plano.
  await abrirTudo();
  const aposConferir = await pag.evaluate(() => (document.body.textContent || '').replace(/\s+/g, ' '));
  ok('depois de conferir, a tela segue sem plano carregado',
    /Nenhuma ação carregada ainda/.test(aposConferir));
  const linhasAposConferir = await pag.$$eval('tbody tr', (ts) => ts.length);
  ok('e nenhuma ação apareceu na listagem', linhasAposConferir === 0, `${linhasAposConferir} linha(s)`);

  // --------------------------------------------------------------- a gravação
  console.log('\nGRAVAR — aí sim o plano entra');
  await pag.setInputFiles('#plano-arquivo', arquivo);
  await pag.waitForTimeout(300);
  await pag.click('button:has-text("Carregar e substituir")');
  await pag.waitForTimeout(2500);
  await abrirTudo();

  const gravou = await pag.evaluate(() => (document.querySelector('.ultima-carga') || {}).textContent || '');
  ok('o relatório confirma a gravação', /7 ação\(ões\) gravada/.test(gravou.replace(/\s+/g, ' ')),
    gravou.replace(/\s+/g, ' ').slice(0, 90));

  // ---------------------------------------------------------------- o placar
  console.log('\nPLACAR — os baldes somam o total, e o percentual exclui canceladas');
  const placar = await pag.evaluate(() => {
    const saida = {};
    for (const i of document.querySelectorAll('.indicador')) {
      const r = (i.querySelector('.rotulo') || {}).textContent;
      const n = (i.querySelector('.numero') || {}).textContent;
      const a = (i.querySelector('.apoio') || {}).textContent;
      if (r) saida[r.trim()] = { numero: (n || '').trim(), apoio: (a || '').trim() };
    }
    return saida;
  });
  console.log('  ·', JSON.stringify(placar));
  ok('o total é 7', (placar['Total de ações'] || {}).numero === '7');
  ok('1 concluída', (placar['Concluídas'] || {}).numero === '1');
  // Duas vencidas e em aberto (a nº 2 da Onda 1 e a nº 3 da Onda 2 é cancelada):
  // só a nº 2 da Onda 1 venceu em aberto.
  ok('1 atrasada — a que venceu em aberto', (placar['Atrasadas'] || {}).numero === '1');
  ok('as válidas excluem a cancelada: 6 de 7',
    /6 valem/.test((placar['Total de ações'] || {}).apoio || ''),
    (placar['Total de ações'] || {}).apoio);
  ok('o percentual usa as válidas como denominador',
    /1 de 6/.test((placar['Concluído'] || {}).apoio || ''),
    `${(placar['Concluído'] || {}).numero} · ${(placar['Concluído'] || {}).apoio}`);
  const somaBaldes = ['Concluídas', 'Em andamento', 'Não iniciadas', 'Atrasadas']
    .reduce((s, k) => s + Number((placar[k] || {}).numero || 0), 0);
  ok('os baldes mais a cancelada somam o total, sem contar ninguém duas vezes',
    somaBaldes + 1 === 7, `${somaBaldes} + 1 cancelada`);

  const notaCancelada = await pag.evaluate(() => (document.body.textContent || '').replace(/\s+/g, ' '));
  ok('a tela DIZ que a cancelada está fora do percentual',
    /fora do percentual/i.test(notaCancelada));

  // ----------------------------------------------------------------- as ondas
  console.log('\nPOR ONDA — as quatro do cronograma, mesmo as sem ação');
  const ondas = await pag.evaluate(() => {
    const tabelas = [...document.querySelectorAll('table')];
    const t = tabelas.find((x) => /Go-live/.test(x.textContent));
    if (!t) return null;
    return [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
  });
  ok('a tabela de ondas existe', !!ondas);
  if (ondas) {
    ok('as quatro ondas aparecem, inclusive as sem ação', ondas.length === 4, `${ondas.length} linha(s)`);
    ok('a 1ª está marcada como em produção', /em produção/.test(ondas[0].join(' ')), ondas[0].join(' | '));
    ok('a 3ª não tem ação e mostra travessão no percentual, não zero',
      ondas[2][3] === '0' && ondas[2][6] === '—', ondas[2].join(' | '));
    ok('as unidades de cada onda estão na linha',
      /Porto Velho/.test(ondas[0][1]) && /João Pessoa/.test(ondas[1][1]),
      `${ondas[0][1]} // ${ondas[1][1]}`);
  }

  // -------------------------------------------------------------- a listagem
  console.log('\nAÇÕES — da mais urgente para a menos, e nunca na ordem da planilha');
  const lista = await pag.evaluate(() => {
    const tabelas = [...document.querySelectorAll('table')];
    const t = tabelas.find((x) => /Farol/.test(x.textContent));
    if (!t) return null;
    return [...t.querySelectorAll('tbody tr')].map((tr) => {
      const c = [...tr.children].map((td) => td.textContent.trim());
      return { onda: c[0], numero: c[1], tarefa: c[2], situacao: c[7], farol: c[8] };
    });
  });
  ok('a tabela de ações existe', !!lista);
  if (lista) {
    console.log(lista.map((l) => `     ${l.onda}#${l.numero} ${l.tarefa.padEnd(24)} ${l.farol.padEnd(14)} ${l.situacao}`).join('\n'));
    ok('as sete ações estão lá', lista.length === 7, `${lista.length}`);
    ok('a atrasada vem PRIMEIRO, e não a nº 1 da planilha',
      /Atrasado/.test(lista[0].farol), `${lista[0].tarefa} — ${lista[0].farol}`);
    const ordem = { Atrasado: 0, Vence: 1, 'No prazo': 2, 'Sem data': 3, Concluído: 4, Cancelado: 5 };
    const chaves = lista.map((l) => {
      const achou = Object.keys(ordem).find((k) => l.farol.startsWith(k));
      return achou === undefined ? 9 : ordem[achou];
    });
    ok('a urgência é decrescente do começo ao fim',
      chaves.every((v, i) => i === 0 || chaves[i - 1] <= v), chaves.join(' ≤ '));
    ok('a concluída e a cancelada ficam no fim',
      /Concluído|Cancelado/.test(lista[lista.length - 1].farol), lista[lista.length - 1].farol);
    ok('a ação sem data de fim diz "Sem data", e não atraso',
      lista.some((l) => /Sem data/.test(l.farol)), lista.map((l) => l.farol).join(' · '));
  }

  // ----------------------------------------------------------------- o corte
  console.log('\nCORTES — recortam a lista sem mexer no placar');
  await pag.selectOption('#plano-corte-situacao', 'Atrasado');
  await pag.waitForTimeout(400);
  const recortada = await pag.evaluate(() => {
    const t = [...document.querySelectorAll('table')].find((x) => /Farol/.test(x.textContent));
    const placar = [...document.querySelectorAll('.indicador')]
      .find((i) => /Total de ações/.test((i.querySelector('.rotulo') || {}).textContent || ''));
    return {
      linhas: t ? t.querySelectorAll('tbody tr').length : -1,
      total: placar ? (placar.querySelector('.numero') || {}).textContent.trim() : '',
    };
  });
  ok('o corte por situação reduz a lista', recortada.linhas === 1, `${recortada.linhas} linha(s)`);
  ok('e o placar NÃO muda — ele é do plano, não do recorte', recortada.total === '7', recortada.total);
  await pag.click('button:has-text("Limpar filtros")');
  await pag.waitForTimeout(400);
  const depoisDeLimpar = await pag.$$eval('table', (ts) => {
    const t = ts.find((x) => /Farol/.test(x.textContent));
    return t ? t.querySelectorAll('tbody tr').length : -1;
  });
  ok('limpar devolve as sete', depoisDeLimpar === 7, `${depoisDeLimpar}`);

  // --------------------------------------------------------------- o detalhe
  console.log('\nDETALHE — a ação abre com o que a planilha trouxe');
  await pag.click('table button:has-text("Ver ação")');
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
  ok('o título diz onda e número', /Onda \d+ · nº \d+/.test(modal.titulo), modal.titulo);
  ok('a ficha traz prazo, status e situação medida',
    ['Início', 'Fim', 'Status no plano', 'Situação medida', 'Farol'].every((r) => modal.rotulos.includes(r)),
    modal.rotulos.join(' | '));
  ok('a ação sem evolução DIZ que não tem, em vez de deixar o espaço vazio',
    /não tem evolução|Evolução registrada/.test(modal.texto));
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(400);

  // ----------------------------------------------------------- a substituição
  console.log('\nSUBSTITUIR — a segunda carga troca o plano, não soma a ele');
  await pag.setInputFiles('#plano-arquivo', arquivo);
  await pag.waitForTimeout(300);
  await pag.click('button:has-text("Carregar e substituir")');
  await pag.waitForTimeout(2500);
  await abrirTudo();
  const segunda = await pag.evaluate(() => {
    const t = [...document.querySelectorAll('table')].find((x) => /Farol/.test(x.textContent));
    const c = document.querySelector('.ultima-carga');
    return {
      linhas: t ? t.querySelectorAll('tbody tr').length : -1,
      texto: c ? c.textContent.replace(/\s+/g, ' ') : '',
    };
  });
  ok('seguem sendo sete, e não catorze', segunda.linhas === 7, `${segunda.linhas}`);
  ok('e o relatório diz quantas saíram no lugar',
    /no lugar de 7 anterior/.test(segunda.texto), segunda.texto.slice(0, 110));

  // -------------------------------------------------------------- acessibilidade
  console.log('\nACESSIBILIDADE — teclado, rótulo e dobra');
  const a11y = await pag.evaluate(() => {
    const semRotulo = [...document.querySelectorAll('select, input:not([type=hidden])')]
      .filter((c) => !c.id || !document.querySelector(`label[for="${CSS.escape(c.id)}"]`))
      .map((c) => c.id || c.name || c.type);
    const dobras = [...document.querySelectorAll('.cartao-dobra')];
    return {
      semRotulo,
      dobras: dobras.length,
      semAria: dobras.filter((d) => d.getAttribute('aria-expanded') === null).length,
      semControls: dobras.filter((d) => !d.getAttribute('aria-controls')).length,
    };
  });
  ok('todo campo tem rótulo ligado por "for"', a11y.semRotulo.length === 0, a11y.semRotulo.join(', '));
  ok('toda dobra anuncia se está aberta', a11y.dobras > 0 && a11y.semAria === 0,
    `${a11y.dobras} dobra(s), ${a11y.semAria} sem aria-expanded`);
  ok('e aponta o que controla', a11y.semControls === 0, `${a11y.semControls} sem aria-controls`);

  // A cor nunca é o único canal: cada etiqueta de farol tem o texto junto.
  const etiquetas = await pag.$$eval('.etiqueta', (es) => es.map((e) => e.textContent.trim()).filter(Boolean));
  ok('toda etiqueta tem texto, e não só cor', etiquetas.length > 0 && etiquetas.every((t) => t.length > 1),
    `${etiquetas.length} etiqueta(s)`);

  console.log('\nCONTRASTE — a tela passa na régua AA, nos dois temas');
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
        '.indicador .rotulo, .indicador .numero, .indicador .apoio, .nota, .etiqueta, .lista-problemas li, td, th')) {
        if (!e.textContent.trim()) continue;
        const s = getComputedStyle(e);
        const px = parseFloat(s.fontSize);
        const grande = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700);
        const r = razao(s.color, fundo(e));
        if (r < (grande ? 3 : 4.5)) ruins.push(`${e.className || e.tagName} ${px}px ${r.toFixed(2)}`);
      }
      return [...new Set(ruins)];
    });
    ok(`tema ${tema}: nada abaixo da régua`, abaixo.length === 0, abaixo.slice(0, 5).join(', ') || 'tudo acima');
  }
  await pag.evaluate(() => document.documentElement.removeAttribute('data-theme'));

  // ----------------------------------------------------------------- a limpeza
  console.log('\nREMOVER — pede confirmação, e diz o que vai embora');
  await pag.click('button:has-text("Remover o plano carregado")');
  await pag.waitForSelector('.modal', { timeout: 10000 });
  const confirmacao = await pag.evaluate(() => (document.querySelector('.modal') || {}).textContent || '');
  ok('a confirmação diz quantas ações saem', /7 ação/.test(confirmacao.replace(/\s+/g, ' ')),
    confirmacao.replace(/\s+/g, ' ').slice(0, 110));
  await pag.click('.modal button:has-text("Remover as ações")');
  await pag.waitForTimeout(2000);
  await abrirTudo();
  const vazio = await pag.evaluate(() => (document.body.textContent || '').replace(/\s+/g, ' '));
  ok('a tela volta a dizer que não há plano', /Nenhuma ação carregada ainda/.test(vazio));

  console.log(`\n=== erros de console: ${erros.length ? erros.slice(0, 4).join(' | ') : 'nenhum'} ===`);
  console.log(`=== ✗=${falhas.length} ===`);
  if (falhas.length) falhas.forEach((f) => console.log('  ✗ ' + f));
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
