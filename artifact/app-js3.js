// ===========================================================================
// Modal genérico
// ===========================================================================
function abrirModal({ titulo, corpo, acoes, aoMontar }) {
  const fundo = document.createElement('div');
  fundo.className = 'fundo';
  fundo.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <header><h2>${esc(titulo)}</h2><button type="button" class="bt fant" data-x aria-label="Fechar">✕</button></header>
      <div data-corpo>${corpo}</div>
      <div class="msg erro" data-erro hidden></div>
      <div class="acoes">${acoes}</div>
    </div>`;
  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', tecla); };
  const tecla = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', tecla);
  fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) fechar(); });
  fundo.querySelector('[data-x]').addEventListener('click', fechar);
  el('#modais').appendChild(fundo);
  const erro = (m) => { const b = fundo.querySelector('[data-erro]'); b.textContent = m; b.hidden = !m; };
  aoMontar?.({ raiz: fundo, fechar, erro, campo: (n) => fundo.querySelector('[name="'+n+'"]') });
  fundo.querySelector('input,select,textarea')?.focus();
  return { fechar, erro };
}

function confirmar({ titulo, mensagem, rotulo = 'Confirmar', exigeJustificativa, aoConfirmar }) {
  abrirModal({
    titulo,
    corpo: `<p style="margin:0 0 12px;color:var(--tinta2)">${mensagem}</p>
      <div class="campo"><label for="just">Justificativa${exigeJustificativa ? ' (obrigatória)' : ' (opcional)'}</label>
      <textarea id="just" name="just" placeholder="Fica registrada na trilha de auditoria"></textarea></div>`,
    acoes: `<button type="button" class="bt" data-nao>Cancelar</button>
            <button type="button" class="bt pri" data-sim>${esc(rotulo)}</button>`,
    aoMontar({ raiz, fechar, erro, campo }) {
      raiz.querySelector('[data-nao]').addEventListener('click', fechar);
      raiz.querySelector('[data-sim]').addEventListener('click', async (ev) => {
        const j = campo('just').value.trim();
        if (exigeJustificativa && !j) return erro('Informe a justificativa.');
        ev.target.disabled = true; erro('');
        try { await aoConfirmar(j); fechar(); }
        catch (e) { erro(e.message || 'Não foi possível concluir.'); ev.target.disabled = false; }
      });
    },
  });
}

// ===========================================================================
// Painel executivo e financeiro
// ===========================================================================
const naOrigem = (l) => passaNoFiltro(E.origens, origemDe(l));
const naFilial = (l) => passaNoFiltro(E.filiaisSel, l.filial || '(empresa)');
const noCenario = (l) => passaNoFiltro(E.cenariosSel, l.cenario);
function noEscopo(l) { return naFilial(l) && naOrigem(l); }

/** Competências com movimento nas empresas e cenários em foco. */
function competenciasComDados(cenarios = E.cenariosSel) {
  const cs = conjunto(cenarios);
  return [...new Set(Loja.todosDoEscopo()
    .filter((l) => passaNoFiltro(cs, l.cenario))
    .map((l) => l.competencia))].sort();
}

/**
 * Abre no último mês encerrado com movimento: o mês corrente é parcial, e
 * compará-lo com um mês inteiro produz variação enganosa.
 *
 * Recebe o cenário porque cada cenário tem seus próprios meses — calcular pelo
 * oficial e exibir no cenário de desconto deixava o painel zerado num mês que
 * o seletor sequer oferecia.
 */
function competenciaPadrao(cenarios = E.cenariosSel) {
  const todas = competenciasComDados(cenarios);
  const encerradas = todas.filter((c) => c < mesHoje());
  if (encerradas.length) return encerradas[encerradas.length - 1];
  const ateHoje = todas.filter((c) => c <= mesHoje());
  return ateHoje[ateHoje.length - 1] || todas[0] || mesHoje();
}

/** Mantém a seleção de competências dentro do que o cenário atual oferece. */
function ajustarCompetencias() {
  const disponiveis = new Set(competenciasComDados());
  const validas = [...E.competencias].filter((c) => disponiveis.has(c));
  E.competencias = new Set(validas.length ? validas : [competenciaPadrao()]);
}

function viewPainel() {
  const meses = ordenado(E.competencias);
  const ultimo = meses[meses.length - 1] || mesHoje();
  const cenarios = ordenado(E.cenariosSel);
  const comparando = cenarios.length > 1;   // cenários são alternativas, não parcelas

  const base = Loja.todosDoEscopo().filter(noEscopo);
  const doPeriodo = base.filter((l) => E.competencias.has(l.competencia) && noCenario(l));
  const somaDe = (xs) => reais(somaC(xs.map((l) => l.valor)));

  const despesa = somaDe(doPeriodo.filter((l) => l.classificacao === 'despesa'));
  const invest = somaDe(doPeriodo.filter((l) => l.classificacao === 'investimento'));
  const total = despesa + invest;

  // Delta só com um mês em foco: comparar um período de N meses com o mês
  // anterior seria comparar coisas de tamanhos diferentes.
  let varia = null, anterior = null;
  if (meses.length === 1 && !comparando) {
    const anteriores = competenciasComDados().filter((c) => c < meses[0]);
    anterior = anteriores[anteriores.length - 1];
    const totalAnt = anterior ? somaDe(base.filter((l) => l.competencia === anterior && noCenario(l))) : 0;
    varia = totalAnt > 0 ? ((total - totalAnt) / totalAnt) * 100 : null;
  }

  // Janela dos gráficos: exatamente os meses escolhidos quando há mais de um;
  // com um só, os doze que terminam nele, para dar contexto.
  const janela = meses.length > 1 ? meses : intervalo(mesSoma(ultimo, -11), ultimo);
  const noMes = (m, extra = () => true) => base.filter((l) => l.competencia === m && noCenario(l) && extra(l));

  const serie = janela.map((m) => ({ rot: mesCurto(m), v: {
    d: somaDe(noMes(m, (l) => l.classificacao === 'despesa')),
    i: somaDe(noMes(m, (l) => l.classificacao === 'investimento')) } }));
  const serieCenarios = janela.map((m) => ({ rot: mesCurto(m),
    v: Object.fromEntries(cenarios.map((c) => [c, somaDe(base.filter((l) => l.competencia === m && l.cenario === c))])) }));
  const proj = intervalo(mesSoma(ultimo, 1), mesSoma(ultimo, 12)).map((m) => ({ rot: mesCurto(m), v: {
    f: somaDe(noMes(m, (l) => l.natureza === 'fixa')),
    p: somaDe(noMes(m, (l) => l.natureza === 'pontual_parcelada')),
    u: somaDe(noMes(m, (l) => l.natureza === 'pontual_unica')) } }));
  const compromisso = reais(somaC(proj.flatMap((p) => [p.v.f, p.v.p, p.v.u])));

  const agrupar = (xs, chave) => {
    const m = {};
    for (const l of xs) { const k = chave(l); m[k] = (m[k] || 0) + cent(l.valor); }
    return Object.entries(m).map(([k, v]) => ({ rotulo: k, valor: reais(v) }));
  };
  // O ranking por filial ignora o filtro de filial de propósito — existe para
  // comparar as filiais entre si —, mas obedece aos demais recortes: senão o
  // KPI e a soma do ranking discordam na mesma tela.
  const porFilial = agrupar(
    base.filter((l) => E.competencias.has(l.competencia) && noCenario(l) && naOrigem(l)),
    (l) => l.filial || '(empresa)');

  const periodo = meses.length === 1 ? mesExib(meses[0])
    : `${mesExib(meses[0])} a ${mesExib(ultimo)} · ${meses.length} competências`;
  const cls = varia === null ? 'zero' : varia > .05 ? 'sobe' : varia < -.05 ? 'desce' : 'zero';
  const seta = varia === null ? '' : varia > 0 ? '▲' : varia < 0 ? '▼' : '■';

  const kpisComparacao = () => cenarios.map((c, i) => {
    const t = somaDe(base.filter((l) => E.competencias.has(l.competencia) && l.cenario === c));
    const nome = (cenariosDoEscopo().find((x) => x.chave === c) || {}).nome || c;
    return `<div class="kpi"><span class="r">${esc(nome)}</span><span class="n">${brl(t)}</span>
      <span class="a">${inteiro(base.filter((l) => E.competencias.has(l.competencia) && l.cenario === c).length)} lançamentos</span>
      <span class="delta zero" style="color:${['var(--s1)','var(--s2)','var(--s3)'][i % 3]}">■ cenário</span></div>`;
  }).join('');

  el('#pagina').innerHTML = `
    <div class="filtros">
      <div class="campo"><label for="p-comp">Competência</label><div data-sel="comp"></div></div>
      <div class="campo"><label for="p-cen">Cenário de projeção</label><div data-sel="cen"></div></div>
      <div style="margin-left:auto;font-size:12px;color:var(--tinta3);max-width:420px">
        ${esc(rotuloEscopo())} · ${esc(periodo)} · ${inteiro(doPeriodo.length)} lançamentos
      </div>
    </div>
    <div class="fichas" id="p-fichas" hidden></div>

    ${comparando ? `<div class="msg alerta">Cenários são <strong>alternativas</strong>, não parcelas de um mesmo
      total — somá-los contaria a mesma despesa duas vezes. Com mais de um marcado o painel compara, em vez de
      somar: um indicador por cenário, e os rankings ficam de fora até você escolher um só.</div>` : ''}

    <div class="kpis">
      ${comparando ? kpisComparacao() : `
      <div class="kpi"><span class="r">${meses.length === 1 ? 'Total do mês' : 'Total do período'}</span>
        <span class="n">${brl(total)}</span>
        ${varia === null ? `<span class="a">${meses.length === 1 ? 'sem mês anterior' : esc(periodo)}</span>`
          : `<span class="delta ${cls}">${seta} ${pctTxt(Math.abs(varia))} vs. ${mesExib(anterior)}</span>`}</div>
      <div class="kpi"><span class="r">Despesa</span><span class="n">${brl(despesa)}</span>
        <span class="a">${pctTxt(pct(cent(despesa), cent(total)))} do período</span></div>
      <div class="kpi"><span class="r">Investimento</span><span class="n">${brl(invest)}</span>
        <span class="a">${pctTxt(pct(cent(invest), cent(total)))} do período</span></div>
      <div class="kpi"><span class="r">Compromisso — 12 meses</span><span class="n">${curto(compromisso)}</span>
        <span class="a">a partir de ${mesExib(mesSoma(ultimo, 1))}</span></div>`}
    </div>

    <div class="grade g2">
      <section class="bloco"><header><h2>Evolução mensal</h2>
        <span class="nota">${comparando ? 'total por cenário' : 'despesa × investimento'}</span></header>
        <div class="leg">${comparando
          ? cenarios.map((c, i) => `<span><i style="background:${['var(--s1)','var(--s2)','var(--s3)'][i % 3]}"></i>${esc((cenariosDoEscopo().find((x) => x.chave === c) || {}).nome || c)}</span>`).join('')
          : '<span><i style="background:var(--s1)"></i>Despesa</span><span><i style="background:var(--s2)"></i>Investimento</span>'}</div>
        <div id="g1"></div></section>
      <section class="bloco"><header><h2>Projeção dos próximos 12 meses</h2></header>
        <div class="leg"><span><i style="background:var(--s1)"></i>Fixo</span><span><i style="background:var(--s2)"></i>Parcelas</span><span><i style="background:var(--s3)"></i>Pontual</span></div>
        <div id="g2"></div></section>
    </div>

    ${comparando ? '' : `
    <div class="grade g2">
      <section class="bloco"><header><h2>Por tipo de despesa</h2><span class="nota">${esc(periodo)}</span></header>
        <div class="rank" id="r1"></div></section>
      <section class="bloco"><header><h2>Por natureza</h2><span class="nota">${esc(periodo)}</span></header>
        <div class="rank" id="r2"></div></section>
    </div>
    <section class="bloco"><header><h2>Por filial</h2><span class="nota">todas as filiais · ${esc(periodo)}</span></header>
      <div class="rank" id="r3"></div></section>
    ${E.empresasSel.size > 1 ? `<section class="bloco"><header><h2>Por empresa</h2>
      <span class="nota">${esc(periodo)}</span></header><div class="rank" id="r4"></div></section>` : ''}
    <section class="bloco"><header><h2>Série do total mensal</h2></header><div id="g3"></div></section>`}`;

  const compsDisponiveis = competenciasComDados();
  const itensComp = compsDisponiveis.map((c) => ({ valor: c, rotulo: mesExib(c) }));
  const itensCen = cenariosDoEscopo().map((c) => ({ valor: c.chave, rotulo: c.nome }));

  seletorMulti(el('[data-sel="comp"]'), {
    id: 'p-comp', rotulo: 'Competência', itens: itensComp, selecionados: E.competencias, minimo: 1,
    aoMudar: (novo) => { E.competencias = novo; render(); },
  });
  seletorMulti(el('[data-sel="cen"]'), {
    id: 'p-cen', rotulo: 'Cenário de projeção', itens: itensCen, selecionados: E.cenariosSel, minimo: 1,
    aviso: 'Cenários são alternativas: marcar vários compara, não soma.',
    aoMudar: (novo) => { E.cenariosSel = novo; ajustarCompetencias(); render(); },
  });
  pintarFichas(el('#p-fichas'), [
    { chave:'comp', rotulo:'Competência', itens:itensComp, selecionados:E.competencias, minimo:1,
      ocultarSeTudo:false, total:itensComp.length, aoMudar:(n) => { E.competencias = n; render(); } },
    { chave:'cen', rotulo:'Cenário', itens:itensCen, selecionados:E.cenariosSelSel, minimo:1,
      ocultarSeTudo:false, total:itensCen.length, aoMudar:(n) => { E.cenariosSel = n; ajustarCompetencias(); render(); } },
  ]);

  const CORES = ['var(--s1)', 'var(--s2)', 'var(--s3)'];

  // O drill-down recorta a MESMA lista que produziu o número clicado. Se
  // viesse de outra consulta, poderia divergir do que está na tela.
  const mesDaJanela = (i) => janela[i];
  const dosMeses = (m, extra = () => true) => noMes(m, extra);

  if (comparando) {
    // Agrupado, não empilhado: cenários alternativos ficam lado a lado.
    barras(el('#g1'), serieCenarios,
      cenarios.map((c, i) => ({ k: c, nome: (cenariosDoEscopo().find((x) => x.chave === c) || {}).nome || c, cor: CORES[i % 3] })),
      'agrupado', brl, curto,
      (p, i) => {
        const m = mesDaJanela(i);
        const lista = base.filter((l) => l.competencia === m && cenarios.includes(l.cenario));
        detalharLancamentos(`Comparação de cenários — ${mesExib(m)}`, lista, somaDe(lista),
          'Cenários são alternativas: cada lançamento aparece uma vez por cenário.');
      });
  } else {
    barras(el('#g1'), serie, [{k:'d',nome:'Despesa',cor:'var(--s1)'},{k:'i',nome:'Investimento',cor:'var(--s2)'}],
      'empilhado', brl, curto,
      (p, i) => {
        const m = mesDaJanela(i);
        const lista = dosMeses(m);
        detalharLancamentos(`Despesa e investimento — ${mesExib(m)}`, lista, somaDe(lista));
      });
  }

  const mesesProjecao = intervalo(mesSoma(ultimo, 1), mesSoma(ultimo, 12));
  barras(el('#g2'), proj, [{k:'f',nome:'Fixo',cor:'var(--s1)'},{k:'p',nome:'Parcelas',cor:'var(--s2)'},{k:'u',nome:'Pontual',cor:'var(--s3)'}],
    'empilhado', brl, curto,
    (p, i) => {
      const m = mesesProjecao[i];
      const lista = dosMeses(m);
      detalharLancamentos(`Compromisso projetado — ${mesExib(m)}`, lista, somaDe(lista));
    });

  if (!comparando) {
    // Cada ranking abre os lançamentos do item clicado, pelo mesmo critério
    // que formou a barra.
    ranking(el('#r1'), agrupar(doPeriodo, (l) => l.tipo), brl, 'var(--s1)',
      (it) => {
        const lista = doPeriodo.filter((l) => l.tipo === it.rotulo);
        detalharLancamentos(`${it.rotulo} — ${periodo}`, lista, it.valor);
      });
    ranking(el('#r2'), agrupar(doPeriodo, (l) => NATUREZAS[l.natureza] || l.natureza), brl, 'var(--s3)',
      (it) => {
        const lista = doPeriodo.filter((l) => (NATUREZAS[l.natureza] || l.natureza) === it.rotulo);
        detalharLancamentos(`Natureza ${it.rotulo} — ${periodo}`, lista, it.valor);
      });
    ranking(el('#r3'), porFilial, brl, 'var(--s2)',
      (it) => {
        // Este ranking ignora o filtro de filial de propósito (existe para
        // comparar filiais), então o detalhe usa a mesma base dele.
        const lista = base.filter((l) => E.competencias.has(l.competencia) && noCenario(l) && naOrigem(l)
          && (l.filial || '(empresa)') === it.rotulo);
        detalharLancamentos(`Filial ${it.rotulo} — ${periodo}`, lista, it.valor,
          'O ranking por filial compara as filiais entre si e por isso ignora o filtro de filial.');
      });
    if (E.empresasSel.size > 1) {
      ranking(el('#r4'), agrupar(doPeriodo, (l) => nomeEmpresa(l.empresa)), brl, 'var(--s1)',
        (it) => {
          const lista = doPeriodo.filter((l) => nomeEmpresa(l.empresa) === it.rotulo);
          detalharLancamentos(`${it.rotulo} — ${periodo}`, lista, it.valor);
        });
    }
    linhas(el('#g3'), serie.map((p) => ({ rot: p.rot, v: { t: p.v.d + p.v.i } })),
      [{ k:'t', nome:'Total mensal', cor:'var(--s1)' }], brl, curto, '',
      (p, i) => {
        const m = mesDaJanela(i);
        const lista = dosMeses(m);
        detalharLancamentos(`Total de ${mesExib(m)}`, lista, somaDe(lista));
      });
  }

  // Os indicadores: cada um abre os lançamentos que o compõem. O de variação
  // percentual e o de compromisso projetado saem de recortes próprios.
  ligarKpis(comparando ? {} : {
    0: () => detalharLancamentos(`Total do período — ${periodo}`, doPeriodo, somaDe(doPeriodo)),
    1: () => {
      const lista = doPeriodo.filter((l) => l.classificacao === 'despesa');
      detalharLancamentos(`Despesa — ${periodo}`, lista, somaDe(lista));
    },
    2: () => {
      const lista = doPeriodo.filter((l) => l.classificacao === 'investimento');
      detalharLancamentos(`Investimento — ${periodo}`, lista, somaDe(lista));
    },
    3: () => {
      const lista = mesesProjecao.flatMap((m) => dosMeses(m));
      detalharLancamentos('Compromisso dos próximos 12 meses', lista, somaDe(lista),
        `${mesExib(mesesProjecao[0])} a ${mesExib(mesesProjecao[mesesProjecao.length - 1])}`);
    },
  });
}

/** Texto curto do recorte em foco, para o cabeçalho das telas. */
function rotuloEscopo() {
  const emp = E.empresasSel.size === 1 ? nomeEmpresa([...E.empresasSel][0])
    : `${E.empresasSel.size} empresas`;
  const fil = E.filiaisSel.size === 0 ? 'todas as filiais'
    : E.filiaisSel.size === 1 ? [...E.filiaisSel][0]
    : `${E.filiaisSel.size} filiais`;
  return `${emp} · ${fil}`;
}
