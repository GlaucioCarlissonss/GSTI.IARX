// Criação de projetos e tarefas desacoplada do filtro global: seleção própria
// de empresa/filial, lote com relatório por unidade, e vínculo individual.
//
// O gestor pediu isso porque criar dependia do que estava filtrado no topo — e
// o que ele está OLHANDO não é a mesma pergunta que onde ele quer CRIAR.
const { chromium } = require('playwright');
const { irPara, usarEmpresas } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const falhas = [];
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });

  const empresas = await pag.evaluate(() => E.empresas.map((e) => e.id));
  await usarEmpresas(pag, empresas.slice(0, 3));
  await irPara(pag, 'Projetos', 1200);

  console.log('\n--- criar não depende do filtro do topo ---');
  const botao = await pag.evaluate(() => {
    const b = document.querySelector('#p-novo');
    return { existe: !!b, travado: b ? b.disabled : null, empresasEmFoco: E.empresasSel.size };
  });
  ok('o botão existe com três empresas em foco', botao.existe && botao.travado === false,
    `${botao.empresasEmFoco} empresas`);

  await pag.click('#p-novo');
  await pag.waitForTimeout(700);
  const form = await pag.evaluate(() => ({
    temEmpresa: !!document.querySelector('[data-sel="q-emp"] button'),
    temFilial: !!document.querySelector('[data-sel="q-fil-multi"] button'),
    explica: /não depende do filtro do topo/.test(document.querySelector('.modal').textContent),
  }));
  ok('o formulário tem seleção própria de empresa', form.temEmpresa);
  ok('e de filial', form.temFilial);
  ok('e diz que não depende do filtro do topo', form.explica);

  console.log('\n--- a conta do lote aparece antes de confirmar ---');
  const resumo = await pag.evaluate(() => document.querySelector('#q-resumo').textContent.replace(/\s+/g, ' ').trim());
  ok('o resumo diz quantos e onde', /projetos.*um por unidade.*empresa\(s\)/i.test(resumo), resumo.slice(0, 110));

  console.log('\n--- o lote cria um por unidade, com vínculo próprio ---');
  await pag.fill('#q-nome', 'Projeto em lote');
  await pag.fill('#q-ini', '01/2026');
  await pag.fill('#q-fim', '12/2026');
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(2500);

  const relatorio = await pag.evaluate(() => {
    const m = document.querySelector('.modal');
    return m ? { texto: m.textContent.replace(/\s+/g, ' '), linhas: m.querySelectorAll('tbody tr').length,
      criados: m.querySelectorAll('.tag.bom').length } : null;
  });
  ok('o relatório abre com uma linha por unidade', relatorio && relatorio.linhas === 3, `${relatorio && relatorio.linhas}`);
  ok('e diz quantos foram criados', relatorio && relatorio.criados === 3, `${relatorio && relatorio.criados}`);
  await pag.click('.modal [data-c]');
  await pag.waitForTimeout(1200);

  const gravados = await pag.evaluate(async () => {
    const saida = [];
    for (const e of [...E.empresasSel]) {
      for (const p of await Loja.projetosDa(e)) {
        if (p.nome === 'Projeto em lote') saida.push({ empresa: e, id: p.id, filial: p.filial });
      }
    }
    return saida;
  });
  ok('um projeto por empresa', gravados.length === 3, `${gravados.length}`);
  ok('cada um com id próprio', new Set(gravados.map((g) => g.id)).size === 3);
  ok('e cada um na sua empresa', new Set(gravados.map((g) => g.empresa)).size === 3);

  console.log('\n--- o nome repetido na mesma unidade é recusado, sem derrubar o resto ---');
  await pag.click('#p-novo');
  await pag.waitForTimeout(600);
  await pag.fill('#q-nome', 'Projeto em lote');
  await pag.fill('#q-ini', '01/2026');
  await pag.fill('#q-fim', '12/2026');
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(2500);
  const recusa = await pag.evaluate(() => {
    const m = document.querySelector('.modal');
    return m ? { recusados: m.querySelectorAll('.tag.crit').length,
      motivo: m.textContent.includes('Já existe projeto com este nome') } : null;
  });
  ok('as três unidades recusam', recusa && recusa.recusados === 3, `${recusa && recusa.recusados}`);
  ok('e o relatório diz o motivo', recusa && recusa.motivo);
  await pag.click('.modal [data-c]');
  await pag.waitForTimeout(1200);

  console.log('\n--- a tarefa nova pode acompanhar as réplicas ---');
  await pag.evaluate(() => {
    const linha = [...document.querySelectorAll('#pagina tbody tr[data-id]')]
      .find((tr) => tr.textContent.includes('Projeto em lote'));
    linha.querySelector('[data-ab]').click();
  });
  await pag.waitForTimeout(1400);
  const replicar = await pag.evaluate(() => {
    const caixa = document.querySelector('[data-replicar]');
    return { visivel: caixa && !caixa.hidden,
      unidades: document.querySelectorAll('input[data-outro]').length,
      explica: caixa ? /sem tarefa principal/.test(caixa.textContent) : false };
  });
  ok('a caixa de replicação aparece', replicar.visivel);
  ok('com as outras duas unidades', replicar.unidades === 2, `${replicar.unidades}`);
  ok('e explica que a réplica nasce sem tarefa principal', replicar.explica);

  await pag.evaluate(() => {
    document.querySelectorAll('input[data-outro]').forEach((c) => { c.checked = true; });
  });
  await pag.fill('#t-nome', 'Tarefa replicada');
  await pag.fill('#t-ini', '01/2026');
  await pag.fill('#t-fim', '03/2026');
  await pag.click('.modal [data-formtar] button[type=submit]');
  await pag.waitForTimeout(2500);

  const replicadas = await pag.evaluate(async () => {
    let n = 0, comPai = 0;
    for (const e of [...E.empresasSel]) {
      for (const p of await Loja.projetosDa(e)) {
        for (const t of (p.tarefas || [])) {
          if (t.nome !== 'Tarefa replicada') continue;
          n += 1;
          if (t.paiId) comPai += 1;
        }
      }
    }
    return { n, comPai };
  });
  ok('a tarefa nasce nas três unidades', replicadas.n === 3, `${replicadas.n}`);
  ok('e nenhuma réplica herda tarefa principal', replicadas.comPai === 0);

  console.log('\n--- sem erro de console no caminho todo ---');
  ok('nenhum erro de página', erros.length === 0, erros.slice(0, 3).join(' | '));

  console.log(`\n${falhas.length ? '✗ ' + falhas.length + ' falha(s):\n  - ' + falhas.join('\n  - ') : '✓ tudo certo'}`);
  await nav.close();
  process.exit(falhas.length ? 1 : 0);
})();
