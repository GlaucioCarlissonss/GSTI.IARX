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
function naOrigem(l) { return !E.origens || E.origens.has(origemDe(l)); }
function noEscopo(l) { return (!E.filial || l.filial === E.filial) && naOrigem(l); }

function competenciasComDados(empresa, cenario = 'oficial') {
  return [...new Set(Loja.todos(empresa).filter((l) => l.cenario === cenario).map((l) => l.competencia))].sort();
}
/** Abre no último mês encerrado com movimento: o mês corrente é parcial. */
function competenciaPadrao(empresa) {
  const cs = competenciasComDados(empresa).filter((c) => c < mesHoje());
  if (cs.length) return cs[cs.length-1];
  const todas = competenciasComDados(empresa).filter((c) => c <= mesHoje());
  return todas[todas.length-1] || mesHoje();
}

function viewPainel() {
  const emp = E.empresa, comp = E.competencia;
  const todos = Loja.todos(emp).filter((l) => l.cenario === E.cenario && noEscopo(l));
  const doMes = todos.filter((l) => l.competencia === comp);
  const despesa = reais(somaC(doMes.filter((l)=>l.classificacao==='despesa').map((l)=>l.valor)));
  const invest = reais(somaC(doMes.filter((l)=>l.classificacao==='investimento').map((l)=>l.valor)));
  const total = despesa + invest;
  const compsFech = competenciasComDados(emp, E.cenario).filter((c) => c < comp);
  const anterior = compsFech[compsFech.length-1];
  const totalAnt = anterior ? reais(somaC(todos.filter((l)=>l.competencia===anterior).map((l)=>l.valor))) : 0;
  const varia = totalAnt > 0 ? ((total-totalAnt)/totalAnt)*100 : null;

  const serie = intervalo(mesSoma(comp,-11), comp).map((m) => ({ rot: mesCurto(m), v: {
    d: reais(somaC(todos.filter((l)=>l.competencia===m && l.classificacao==='despesa').map((l)=>l.valor))),
    i: reais(somaC(todos.filter((l)=>l.competencia===m && l.classificacao==='investimento').map((l)=>l.valor))) } }));
  const proj = intervalo(mesSoma(comp,1), mesSoma(comp,12)).map((m) => ({ rot: mesCurto(m), v: {
    f: reais(somaC(todos.filter((l)=>l.competencia===m && l.natureza==='fixa').map((l)=>l.valor))),
    p: reais(somaC(todos.filter((l)=>l.competencia===m && l.natureza==='pontual_parcelada').map((l)=>l.valor))),
    u: reais(somaC(todos.filter((l)=>l.competencia===m && l.natureza==='pontual_unica').map((l)=>l.valor))) } }));
  const compromisso = reais(somaC(proj.flatMap((p)=>[p.v.f,p.v.p,p.v.u])));

  const porTipo = {}; for (const l of doMes) porTipo[l.tipo] = (porTipo[l.tipo]||0) + cent(l.valor);
  const porNat = {}; for (const l of doMes) porNat[l.natureza] = (porNat[l.natureza]||0) + cent(l.valor);
  const porFil = {}; for (const l of Loja.todos(emp).filter((l)=>l.cenario===E.cenario && l.competencia===comp))
    porFil[l.filial || '(empresa)'] = (porFil[l.filial||'(empresa)']||0) + cent(l.valor);

  const cls = varia===null ? 'zero' : varia>.05 ? 'sobe' : varia<-.05 ? 'desce' : 'zero';
  const seta = varia===null ? '' : varia>0 ? '▲' : varia<0 ? '▼' : '■';

  el('#pagina').innerHTML = `
    <div class="filtros">
      <div class="campo"><label for="p-comp">Competência</label><select id="p-comp"></select></div>
      <div class="campo"><label for="p-cen">Cenário de projeção</label><select id="p-cen"></select></div>
      <div style="margin-left:auto;font-size:12px;color:var(--tinta3);max-width:420px">
        ${E.filial ? 'Filial <strong>'+esc(E.filial)+'</strong>' : 'Consolidado da empresa'} ·
        competência <strong>${mesExib(comp)}</strong> · ${inteiro(doMes.length)} lançamentos
      </div>
    </div>
    <div class="kpis">
      <div class="kpi"><span class="r">Total do mês</span><span class="n">${brl(total)}</span>
        ${varia===null ? '<span class="a">sem mês anterior</span>'
          : `<span class="delta ${cls}">${seta} ${pctTxt(Math.abs(varia))} vs. ${mesExib(anterior)}</span>`}</div>
      <div class="kpi"><span class="r">Despesa</span><span class="n">${brl(despesa)}</span>
        <span class="a">${pctTxt(pct(cent(despesa),cent(total)))} do mês</span></div>
      <div class="kpi"><span class="r">Investimento</span><span class="n">${brl(invest)}</span>
        <span class="a">${pctTxt(pct(cent(invest),cent(total)))} do mês</span></div>
      <div class="kpi"><span class="r">Compromisso — 12 meses</span><span class="n">${curto(compromisso)}</span>
        <span class="a">parcelas e recorrências lançadas</span></div>
    </div>
    <div class="grade g2">
      <section class="bloco"><header><h2>Evolução mensal</h2><span class="nota">despesa × investimento</span></header>
        <div class="leg"><span><i style="background:var(--s1)"></i>Despesa</span><span><i style="background:var(--s2)"></i>Investimento</span></div>
        <div id="g1"></div></section>
      <section class="bloco"><header><h2>Projeção dos próximos 12 meses</h2></header>
        <div class="leg"><span><i style="background:var(--s1)"></i>Fixo</span><span><i style="background:var(--s2)"></i>Parcelas</span><span><i style="background:var(--s3)"></i>Pontual</span></div>
        <div id="g2"></div></section>
    </div>
    <div class="grade g2">
      <section class="bloco"><header><h2>Por tipo de despesa</h2><span class="nota">${mesExib(comp)}</span></header>
        <div class="rank" id="r1"></div></section>
      <section class="bloco"><header><h2>Por natureza</h2><span class="nota">${mesExib(comp)}</span></header>
        <div class="rank" id="r2"></div></section>
    </div>
    <section class="bloco"><header><h2>Por filial</h2><span class="nota">todas as filiais · ${mesExib(comp)}</span></header>
      <div class="rank" id="r3"></div></section>
    <section class="bloco"><header><h2>Série do total mensal</h2></header><div id="g3"></div></section>`;

  const selC = el('#p-comp');
  const comps = competenciasComDados(emp, E.cenario);
  selC.innerHTML = comps.map((c)=>`<option value="${c}"${c===comp?' selected':''}>${mesExib(c)}</option>`).join('');
  selC.onchange = () => { E.competencia = selC.value; render(); };
  const selCen = el('#p-cen');
  selCen.innerHTML = cenariosDa(emp).map((c)=>`<option value="${esc(c.chave)}"${c.chave===E.cenario?' selected':''}>${esc(c.nome)}</option>`).join('');
  selCen.onchange = () => { E.cenario = selCen.value; E.competencia = competenciaPadrao(emp); render(); };

  barras(el('#g1'), serie, [{k:'d',nome:'Despesa',cor:'var(--s1)'},{k:'i',nome:'Investimento',cor:'var(--s2)'}], 'empilhado');
  barras(el('#g2'), proj, [{k:'f',nome:'Fixo',cor:'var(--s1)'},{k:'p',nome:'Parcelas',cor:'var(--s2)'},{k:'u',nome:'Pontual',cor:'var(--s3)'}], 'empilhado');
  ranking(el('#r1'), Object.entries(porTipo).map(([k,v])=>({rotulo:k,valor:reais(v)})));
  ranking(el('#r2'), Object.entries(porNat).map(([k,v])=>({rotulo:NATUREZAS[k]||k,valor:reais(v)})), brl, 'var(--s3)');
  ranking(el('#r3'), Object.entries(porFil).map(([k,v])=>({rotulo:k,valor:reais(v)})), brl, 'var(--s2)');
  linhas(el('#g3'), serie.map((p)=>({rot:p.rot, v:{t:p.v.d+p.v.i}})), [{k:'t',nome:'Total mensal',cor:'var(--s1)'}]);
}
