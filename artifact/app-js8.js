// ===========================================================================
// Conferência — de onde vem cada real que o sistema mostra.
// Existe porque o total do sistema não é o total das planilhas enviadas:
// há folha de TI rateada e projeção do novo ERP somadas por cima.
// Esta tela ignora o recorte "Base considerada" de propósito: ela é a régua.
// ===========================================================================
const ORDEM_ORIGEM = ['planilha', 'folha_ti', 'projecao_spincare', 'manual'];
const COR_ORIGEM = { planilha:'var(--s1)', folha_ti:'var(--s2)', projecao_spincare:'var(--s3)', manual:'var(--tinta3)' };

function resumoPorOrigem(lancamentos) {
  const r = {};
  for (const o of ORDEM_ORIGEM) r[o] = { n:0, c:0, de:null, ate:null };
  for (const l of lancamentos) {
    const a = r[origemDe(l)];
    a.n++; a.c += cent(l.valor);
    if (!a.de || l.competencia < a.de) a.de = l.competencia;
    if (!a.ate || l.competencia > a.ate) a.ate = l.competencia;
  }
  return r;
}

function viewConferencia() {
  const cenarios = ordenado(E.cenariosSel);
  const nomeEmp = E.empresasSel.size === 1 ? nomeEmpresa([...E.empresasSel][0]) : `${E.empresasSel.size} empresas`;
  const todos = Loja.todosDoEscopo().filter(noCenario);
  const res = resumoPorOrigem(todos);
  const totalC = ORDEM_ORIGEM.reduce((s, o) => s + res[o].c, 0);
  const baseC = res.planilha.c;
  const acrescC = totalC - baseC;

  const meses = [...new Set(todos.map((l) => l.competencia))].sort();
  const linhasMes = meses.map((m) => {
    const doMes = todos.filter((l) => l.competencia === m);
    const r = resumoPorOrigem(doMes);
    return { m, r, total: ORDEM_ORIGEM.reduce((s, o) => s + r[o].c, 0) };
  });
  const usadas = ORDEM_ORIGEM.filter((o) => res[o].n > 0);

  const serie = linhasMes.map((x) => ({
    rot: mesCurto(x.m),
    v: Object.fromEntries(usadas.map((o) => [o, reais(x.r[o].c)])),
  }));

  // Conferência cruzada: todas as empresas, para bater com o total geral do grupo.
  const porEmpresa = E.empresas.map((e) => {
    const ls = Loja.todos(e.id).filter(noCenario);
    return { id:e.id, nome:e.nome, carregada: E.mesesCarregados.has(e.id), r: resumoPorOrigem(ls) };
  });
  const faltam = porEmpresa.filter((x) => !x.carregada).length;

  el('#pagina').innerHTML = `
    <div class="msg"><strong>Por que o total do sistema difere da sua planilha.</strong>
      O sistema guarda as linhas que você enviou <em>sem alterar valor</em> e soma a elas duas coisas que
      não existiam como linha de despesa nas bases: o <strong>rateio da folha de TI</strong> e a
      <strong>projeção do novo ERP</strong>. Aqui cada parcela aparece separada, para você conferir
      linha a linha e decidir o que entra no número oficial.</div>

    <div class="filtros">
      <div class="campo"><label for="c-cen">Cenário de projeção</label><div data-sel="ccen"></div></div>
      <div style="margin-left:auto;font-size:12px;color:var(--tinta3);max-width:460px">
        <strong>${esc(nomeEmp)}</strong> · consolidado, todas as filiais ·
        ${inteiro(todos.length)} lançamentos · ${meses.length ? mesExib(meses[0]) + ' a ' + mesExib(meses[meses.length-1]) : 'sem competências'}
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><span class="r">Base enviada por você</span><span class="n">${brl(reais(baseC))}</span>
        <span class="a">${inteiro(res.planilha.n)} linhas das planilhas</span></div>
      <div class="kpi"><span class="r">Acrescentado pelo sistema</span><span class="n">${brl(reais(acrescC))}</span>
        <span class="a">folha rateada + projeção${res.manual.n ? ' + lançamentos manuais' : ''}</span></div>
      <div class="kpi"><span class="r">Total exibido no painel</span><span class="n">${brl(reais(totalC))}</span>
        <span class="a">com a base “Completa” selecionada</span></div>
      <div class="kpi"><span class="r">Peso do acréscimo</span><span class="n">${pctTxt(pct(acrescC, totalC))}</span>
        <span class="a">do total consolidado</span></div>
    </div>

    <section class="bloco">
      <header><h2>Composição por origem</h2><span class="nota">${esc(cenarios.map((c) => (cenariosDoEscopo().find((x) => x.chave === c) || {}).nome || c).join(' + '))}</span></header>
      <div class="rol"><table>
        <thead><tr><th>Origem</th><th>O que é</th><th class="n">Lançamentos</th><th class="n">Valor</th>
          <th class="n">% do total</th><th>Período</th></tr></thead>
        <tbody>${ORDEM_ORIGEM.map((o) => {
          const a = res[o], d = ORIGENS[o];
          return `<tr${a.n ? '' : ' style="opacity:.45"'}>
            <td><span class="pastilha" style="background:${COR_ORIGEM[o]}"></span>${esc(d.rotulo)}</td>
            <td style="max-width:360px;font-size:12px;color:var(--tinta2)">${esc(d.nota)}</td>
            <td class="n">${inteiro(a.n)}</td>
            <td class="n">${a.n ? brl(reais(a.c)) : '—'}</td>
            <td class="n">${a.n ? pctTxt(pct(a.c, totalC)) : '—'}</td>
            <td style="white-space:nowrap">${a.de ? mesExib(a.de) + ' a ' + mesExib(a.ate) : '—'}</td></tr>`;
        }).join('')}
        <tr class="tot"><td colspan="2"><strong>Total</strong></td>
          <td class="n"><strong>${inteiro(todos.length)}</strong></td>
          <td class="n"><strong>${brl(reais(totalC))}</strong></td>
          <td class="n"><strong>100,0%</strong></td><td></td></tr>
        </tbody></table></div>
    </section>

    <section class="bloco">
      <header><h2>Mês a mês, por origem</h2><span class="nota">${inteiro(meses.length)} competências</span></header>
      <div class="leg">${usadas.map((o) => `<span><i style="background:${COR_ORIGEM[o]}"></i>${esc(ORIGENS[o].curto)}</span>`).join('')}</div>
      <div id="gc"></div>
      <div class="rol" style="margin-top:12px"><table>
        <thead><tr><th>Competência</th>${usadas.map((o)=>`<th class="n">${esc(ORIGENS[o].curto)}</th>`).join('')}
          <th class="n">Total do mês</th></tr></thead>
        <tbody>${linhasMes.map((x) => `<tr>
          <td>${mesExib(x.m)}</td>
          ${usadas.map((o)=>`<td class="n">${x.r[o].n ? brl(reais(x.r[o].c)) : '—'}</td>`).join('')}
          <td class="n"><strong>${brl(reais(x.total))}</strong></td></tr>`).join('')}
        <tr class="tot"><td><strong>Total</strong></td>
          ${usadas.map((o)=>`<td class="n"><strong>${brl(reais(res[o].c))}</strong></td>`).join('')}
          <td class="n"><strong>${brl(reais(totalC))}</strong></td></tr>
        </tbody></table></div>
    </section>

    <section class="bloco">
      <header><h2>Todas as empresas</h2><span class="nota">para bater com o total do grupo</span></header>
      ${faltam ? `<p class="vazio" style="text-align:left">${inteiro(faltam)} empresa(s) ainda não carregada(s) nesta sessão.
        <button type="button" class="bt" id="c-carregar">Carregar todas e conferir</button></p>` : ''}
      <div class="rol"><table>
        <thead><tr><th>Empresa</th>${ORDEM_ORIGEM.map((o)=>`<th class="n">${esc(ORIGENS[o].curto)}</th>`).join('')}
          <th class="n">Total</th></tr></thead>
        <tbody>${porEmpresa.map((x) => {
          const t = ORDEM_ORIGEM.reduce((s,o)=>s+x.r[o].c, 0);
          return `<tr${x.carregada ? '' : ' style="opacity:.45"'}>
            <td>${esc(x.nome)}${x.carregada ? '' : ' <span class="nota">(não carregada)</span>'}</td>
            ${ORDEM_ORIGEM.map((o)=>`<td class="n">${x.r[o].n ? brl(reais(x.r[o].c)) : '—'}</td>`).join('')}
            <td class="n"><strong>${x.carregada ? brl(reais(t)) : '—'}</strong></td></tr>`;
        }).join('')}
        ${faltam ? '' : `<tr class="tot"><td><strong>Grupo</strong></td>
          ${ORDEM_ORIGEM.map((o)=>`<td class="n"><strong>${brl(reais(porEmpresa.reduce((s,x)=>s+x.r[o].c,0)))}</strong></td>`).join('')}
          <td class="n"><strong>${brl(reais(porEmpresa.reduce((s,x)=>s+ORDEM_ORIGEM.reduce((a,o)=>a+x.r[o].c,0),0)))}</strong></td></tr>`}
        </tbody></table></div>
    </section>

    <div class="msg">Discorda de uma dessas parcelas? Troque <strong>Base considerada</strong> na barra do topo
      para tirá-la de todos os números, ou vá em <strong>Lançamentos</strong> e edite linha a linha —
      toda alteração fica na trilha de auditoria.</div>`;

  const itensCCen = cenariosDoEscopo().map((c) => ({ valor: c.chave, rotulo: c.nome }));
  seletorMulti(el('[data-sel="ccen"]'), {
    id: 'c-cen', rotulo: 'Cenário de projeção', itens: itensCCen, selecionados: E.cenariosSel, minimo: 1,
    aviso: 'Cenários são alternativas: marcar vários soma linhas que representam a mesma despesa.',
    aoMudar: (novo) => { E.cenariosSel = novo; ajustarCompetencias(); render(); },
  });

  barras(el('#gc'), serie, usadas.map((o) => ({ k:o, nome:ORIGENS[o].curto, cor:COR_ORIGEM[o] })), 'empilhado');

  el('#c-carregar')?.addEventListener('click', async (ev) => {
    ev.target.disabled = true; ev.target.textContent = 'Carregando…';
    for (const e of E.empresas) if (!E.mesesCarregados.has(e.id)) await Loja.lancDaEmpresa(e.id);
    render();
  });
}
