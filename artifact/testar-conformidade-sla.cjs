// CONFORMIDADE DE SLA EM HORAS ÚTEIS E OS TRÊS DASHBOARDS (Entregas 3 a 5).
//
// A conta que o contrato define é:
//
//   conformidade = resolvidos dentro do SLA ÷ TOTAL DE RESOLVIDOS × 100
//
// O denominador são os RESOLVIDOS. O chamado ainda aberto não tem tempo de
// resolução: contá-lo diluiria o percentual com casos que ainda podem
// terminar dentro do prazo, e contá-lo como "fora" condenaria um chamado de
// ontem. É a parte da regra que um teste de aritmética solta não pega, e por
// isso ela é conferida aqui contra o universo real da base de teste.
const { chromium } = require('playwright');
const { irPara } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1200 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  await irPara(pag, 'Indicadores Gerais', 4000);

  console.log('\nO PRAZO DO ACORDO PASSOU A SER EM HORAS ÚTEIS');
  const prazo = await pag.evaluate(async () => {
    const emp = empresaAtiva();
    await Loja.gravarCatalogo('slasCad', [...(E.slasCad || []),
      { empresa: emp, topico: null, prioridade: 'high', horas: 4, ativo: true }]);
    const p = (n) => String(n).padStart(2, '0');
    const local = (iso) => { const d = new Date(iso);
      return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`; };
    return {
      // Sexta 06/03/2026 às 17h30: fora do expediente (a sexta fecha às 17h).
      sexta: local(prazoDoAcordo(emp, '2026-03-06T17:30:00', 'high', null)),
      // Segunda 09h + 4h úteis = 13h do mesmo dia.
      segunda: local(prazoDoAcordo(emp, '2026-03-09T09:00:00', 'high', null)),
      corridas: local(new Date(new Date('2026-03-06T17:30:00').getTime() + 4 * 3600000).toISOString()),
    };
  });
  ok('sexta 17h30 + 4 h vence segunda ao meio-dia', prazo.sexta === '09/03 12:00', prazo.sexta);
  // O número que o sistema dava antes, para a diferença ficar registrada.
  ok('e não às 21h30 de sexta, como em horas corridas', prazo.corridas === '06/03 21:30',
    prazo.corridas);
  ok('dentro do expediente a conta é a mesma de antes', prazo.segunda === '09/03 13:00',
    prazo.segunda);

  console.log('\nA FÓRMULA DA CONFORMIDADE');
  const f = await pag.evaluate(() => {
    const r = recorteDoBloco('sla');
    const d = conformidadeSegmentada(r, 'geral');
    const ch = d.chamados;
    return {
      resumo: d.resumo,
      // As partes têm de somar o todo, nas duas direções.
      fecha: d.resumo.dentro + d.resumo.fora === d.resumo.resolvidos,
      fechaTotal: d.resumo.resolvidos + d.resumo.abertos === d.resumo.total,
      conta: Math.round((d.resumo.dentro / d.resumo.resolvidos) * 1000) / 10,
      // Nenhum chamado aberto pode ter entrado na conta de dentro/fora.
      abertoNaConta: ch.filter((c) => !c.m.resolvido && c.m.dentro !== null).length,
      // Todo resolvido tem veredito.
      resolvidoSemVeredito: ch.filter((c) => c.m.resolvido && c.m.dentro === null).length,
      // Vencido é subconjunto de aberto, e não uma quarta categoria somável.
      vencidoAberto: ch.filter((c) => c.m.vencido && c.m.resolvido).length,
    };
  });
  ok('dentro + fora = resolvidos', f.fecha,
    `${f.resumo.dentro} + ${f.resumo.fora} = ${f.resumo.resolvidos}`);
  ok('resolvidos + abertos = total', f.fechaTotal,
    `${f.resumo.resolvidos} + ${f.resumo.abertos} = ${f.resumo.total}`);
  ok('o percentual é dentro ÷ resolvidos', f.resumo.pct === f.conta,
    `${f.resumo.pct}% = ${f.conta}%`);
  // A decisão que o denominador guarda: o chamado aberto fica FORA da conta.
  ok('nenhum chamado aberto entra no dentro/fora', f.abertoNaConta === 0, String(f.abertoNaConta));
  ok('e todo resolvido tem veredito', f.resolvidoSemVeredito === 0, String(f.resolvidoSemVeredito));
  ok('vencido é sempre chamado em aberto', f.vencidoAberto === 0, String(f.vencidoAberto));

  console.log('\n90 DE 100 DÁ 90% — o exemplo do enunciado');
  const exemplo = await pag.evaluate(() => {
    const cel = { dentro: 90, fora: 10, resolvidos: 100 };
    return Math.round((cel.dentro / cel.resolvidos) * 1000) / 10;
  });
  ok('a fórmula reproduz o exemplo', exemplo === 90, `${exemplo}%`);

  console.log('\nAS SEGMENTAÇÕES');
  const seg = await pag.evaluate(() => {
    const r = recorteDoBloco('sla');
    const geral = conformidadeSegmentada(r, 'geral');
    const saida = {};
    for (const id of ['fila', 'criticidade', 'nivel']) {
      const d = conformidadeSegmentada(r, id);
      saida[id] = {
        series: d.series.map((s) => s.nome),
        // Segmentar reparte o mesmo universo: a soma das partes é o todo.
        soma: d.series.reduce((s, x) => s + x.total.resolvidos, 0),
        pcts: d.series.map((s) => s.pct),
      };
    }
    return { total: geral.resumo.resolvidos, ...saida };
  });
  for (const id of ['fila', 'criticidade', 'nivel']) {
    // Um grupo que perdesse chamados faria cada fila parecer melhor ou pior do
    // que é, sem nada na tela denunciando a perda.
    ok(`segmentar por ${id} não perde nem duplica chamado`,
      seg[id].soma === seg.total, `${seg[id].soma} de ${seg.total}`);
    ok(`e nomeia as séries de ${id}`, seg[id].series.length > 0,
      seg[id].series.slice(0, 5).join(' · '));
  }

  console.log('\nO SEMÁFORO EM TODOS OS PONTOS');
  const sem = await pag.evaluate(() => {
    const bloco = [...document.querySelectorAll('#pagina > section.bloco-modulo')]
      .find((m) => m.querySelector('h2').textContent.includes('SLA'));
    const t = bloco.textContent;
    return {
      noCartao: /excelente|atenção|crítico/.test(t),
      // O selo carrega símbolo e palavra: a cor nunca é o único canal.
      comSimbolo: /[✓!✗]\s*\d/.test(t.replace(/\s+/g, ' ')),
      naArvore: bloco.querySelectorAll('.arvore-unidades .tag').length,
    };
  });
  ok('o semáforo aparece no bloco de SLA', sem.noCartao);
  ok('com símbolo e palavra, não só cor', sem.comSimbolo);

  console.log('\nOS TRÊS DASHBOARDS');
  const painel = await pag.evaluate(() => ({
    quadros: [...document.querySelectorAll('[data-quadro^="sla-"]')].map((x) => x.dataset.quadro),
    // Numa visão só: os três são leituras do mesmo universo, e compará-los
    // exigia abrir três acordeões e rolar entre eles.
    painelUnico: document.querySelectorAll('[data-kpi="sla-painel"] .painel-spin').length === 1,
    conformidade: document.querySelectorAll('#sla-g-conf svg path[stroke]').length,
    volume: document.querySelectorAll('#sla-g-vol svg path[stroke]').length,
    status: document.querySelectorAll('#sla-g-status svg path[fill]').length,
    seletores: [...document.querySelectorAll('[data-seg]')].map((x) => x.dataset.seg),
    legendaStatus: document.querySelectorAll('#sla-l-status [data-fatia]').length,
  }));
  ok('os três estão na tela',
    JSON.stringify(painel.quadros) === JSON.stringify(['sla-conformidade-tempo', 'sla-volume', 'sla-status']),
    painel.quadros.join(', '));
  ok('numa visão só', painel.painelUnico);
  // Duas linhas: a conformidade e a META tracejada, que é série e não traço
  // solto — assim ela entra na escala do eixo.
  ok('a conformidade desenha a série e a linha de meta', painel.conformidade === 2,
    String(painel.conformidade));
  ok('o volume desenha Total, Resolvidos e Abertos', painel.volume === 3, String(painel.volume));
  ok('a rosca desenha as situações que existem', painel.status >= 2, String(painel.status));
  ok('a legenda da rosca nomeia cada fatia', painel.legendaStatus >= 2, String(painel.legendaStatus));
  ok('os três têm seletor de segmentação',
    JSON.stringify(painel.seletores) === JSON.stringify(['conformidade', 'volume', 'status']),
    painel.seletores.join(', '));

  console.log('\nO SELETOR TROCA AS SÉRIES SEM RECARREGAR');
  const trocou = await pag.evaluate(async () => {
    const antes = document.querySelectorAll('#sla-g-conf svg path[stroke]').length;
    const marca = document.querySelector('[data-kpi="sla-painel"]');
    marca.dataset.viva = 'sim';           // se a página recarregar, isto some
    const sel = document.querySelector('[data-seg="conformidade"]');
    sel.value = 'fila';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    return { antes,
      depois: document.querySelectorAll('#sla-g-conf svg path[stroke]').length,
      legenda: document.querySelectorAll('#sla-l-conf .legenda-tipos span').length,
      naoRecarregou: document.querySelector('[data-kpi="sla-painel"]').dataset.viva === 'sim',
      // Nenhuma tela flutuante pode ter aberto: o seletor mora dentro do
      // cartão, que também é gatilho de drill-down.
      modais: document.querySelectorAll('#modais .modal').length };
  });
  ok('trocar para "por fila" multiplica as séries', trocou.depois > trocou.antes,
    `${trocou.antes} → ${trocou.depois}`);
  ok('com legenda nomeada por fila', trocou.legenda >= 3, String(trocou.legenda));
  ok('sem recarregar a página', trocou.naoRecarregou);
  ok('e sem abrir tela flutuante nenhuma', trocou.modais === 0, String(trocou.modais));

  console.log('\nO DRILL-DOWN');
  const drill = await pag.evaluate(async () => {
    const svg = document.querySelector('#sla-g-conf svg');
    const cx = svg.getBoundingClientRect();
    svg.querySelector('rect[fill="transparent"]').dispatchEvent(new MouseEvent('click', {
      bubbles: true, clientX: cx.left + cx.width * 0.8, clientY: cx.top + cx.height / 2 }));
    await new Promise((r) => setTimeout(r, 900));
    const m = document.querySelectorAll('#modais .modal');
    if (!m.length) return { modais: 0 };
    const cab = [...m[0].querySelectorAll('thead th')].map((t) => t.textContent.trim());
    const horas = [...m[0].querySelectorAll('tbody tr')].map((tr) => {
      const tds = tr.querySelectorAll('td');
      const t = tds[cab.indexOf('Horas úteis')];
      const v = t ? t.textContent.trim().replace(/\./g, '').replace(',', '.') : '';
      return v === '—' || v === '' ? null : Number(v);
    });
    const medidos = horas.filter((h) => h !== null);
    return { modais: m.length, titulo: m[0].querySelector('h2').textContent.trim(), cab,
      linhas: horas.length,
      // A ordem pedida: do maior tempo de resolução para o menor, e o que não
      // tem tempo medido vai para o fim — ele não tem posição nessa ordem.
      ordenado: medidos.every((v, i) => i === 0 || medidos[i - 1] >= v),
      semMedidaNoFim: horas.slice(0, medidos.length).every((h) => h !== null) };
  });
  ok('clicar num mês abre os chamados', drill.modais === 1 && drill.linhas > 0,
    `${drill.modais} tela, ${drill.linhas} linha(s)`);
  ok('com o mês no título', /Conformidade de \d{2}\/\d{4}/.test(drill.titulo || ''), drill.titulo);
  ok('trazendo fila, criticidade, prazo, horas úteis e situação',
    ['Fila', 'Criticidade', 'Prazo', 'Horas úteis', 'SLA'].every((c) => (drill.cab || []).includes(c)),
    (drill.cab || []).join(' · '));
  ok('ordenados do maior tempo de resolução para o menor', drill.ordenado);
  ok('e os sem tempo medido ficam no fim', drill.semMedidaNoFim);
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(400);

  console.log('\nA ROSCA RECORTA POR FILA EM VEZ DE MULTIPLICAR');
  const recorte = await pag.evaluate(async () => {
    const sel = document.querySelector('[data-seg="status"]');
    sel.value = 'fila';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    const chave = document.querySelector('[data-seg-chave]');
    const antes = [...document.querySelectorAll('#sla-l-status [data-fatia] b')]
      .reduce((s, b) => s + Number(b.textContent.replace(/\./g, '')), 0);
    const opcoes = [...chave.options].map((o) => o.value).filter(Boolean);
    chave.value = opcoes[0];
    chave.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    const depois = [...document.querySelectorAll('#sla-l-status [data-fatia] b')]
      .reduce((s, b) => s + Number(b.textContent.replace(/\./g, '')), 0);
    return { temSeletor: !!chave, opcoes: opcoes.length, antes, depois,
      // UMA rosca, sempre: cinco lado a lado não se comparam de relance.
      roscas: document.querySelectorAll('#sla-g-status svg').length };
  });
  ok('escolher "por fila" oferece o recorte', recorte.temSeletor && recorte.opcoes >= 2,
    `${recorte.opcoes} opção(ões)`);
  ok('e continua sendo UMA rosca', recorte.roscas === 1, String(recorte.roscas));
  ok('recortar reduz o universo', recorte.depois > 0 && recorte.depois < recorte.antes,
    `${recorte.antes} → ${recorte.depois}`);

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
