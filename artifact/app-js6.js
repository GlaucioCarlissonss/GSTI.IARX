// ===========================================================================
// SLA — registro mensal por fila e tópico, com indicadores derivados
// ===========================================================================
async function viewSla() {
  const emp = E.empresa;
  const regs = (await Loja.slaDa(emp)).filter((r) => !E.filial || r.filial === E.filial);
  const comps = [...new Set(regs.map((r)=>r.competencia))].sort();
  const comp = comps.includes(E.competencia) ? E.competencia : comps[comps.length-1];
  const doMes = regs.filter((r)=>r.competencia===comp);
  const T = doMes.reduce((s,r)=>s+(r.total||0),0), D = doMes.reduce((s,r)=>s+(r.dentro||0),0);

  const agrupar = (chave) => {
    const m = {};
    for (const r of doMes) { const k = r[chave] || '(sem)'; m[k] = m[k] || { t:0, d:0 }; m[k].t += r.total||0; m[k].d += r.dentro||0; }
    return Object.entries(m).map(([k,v]) => ({ nome:k, total:v.t, dentro:v.d, fora:v.t-v.d, pct:pct(v.d,v.t) }));
  };
  const porFila = agrupar('fila'), porTopico = agrupar('topico'), porFilial = agrupar('filial');
  const tendencia = comps.map((c) => {
    const dd = regs.filter((r)=>r.competencia===c);
    const t = dd.reduce((s,r)=>s+(r.total||0),0), d = dd.reduce((s,r)=>s+(r.dentro||0),0);
    return { rot: mesCurto(c), v: { p: pct(d,t) } };
  });

  el('#pagina').innerHTML = `
    <div class="filtros">
      <div class="campo" style="width:140px"><label for="s-comp">Competência</label><select id="s-comp">
        ${comps.length?comps.map((c)=>`<option value="${c}"${c===comp?' selected':''}>${mesExib(c)}</option>`).join(''):'<option>—</option>'}</select></div>
      <div style="margin-left:auto"></div>
      <button class="bt pri" id="s-novo">Registrar tickets do mês</button>
    </div>
    ${regs.length === 0 ? `<section class="bloco"><p class="vazio">
        Nenhum ticket registrado nesta empresa. Use <strong>Registrar tickets do mês</strong> para lançar
        o total atendido, quantos ficaram dentro do SLA, por fila e por tópico de ajuda.</p></section>` : `
    <div class="kpis">
      <div class="kpi"><span class="r">Tickets atendidos</span><span class="n">${inteiro(T)}</span><span class="a">${mesExib(comp)}</span></div>
      <div class="kpi"><span class="r">Dentro do SLA</span><span class="n">${pctTxt(pct(D,T))}</span><span class="a">${inteiro(D)} tickets</span></div>
      <div class="kpi"><span class="r">Fora do SLA</span><span class="n">${pctTxt(pct(T-D,T))}</span><span class="a">${inteiro(T-D)} tickets</span></div>
      <div class="kpi"><span class="r">Filas monitoradas</span><span class="n">${inteiro(porFila.length)}</span>
        <span class="a">${esc(porFila.map((f)=>f.nome).join(' · '))}</span></div>
    </div>
    <div class="grade g2">
      <section class="bloco"><header><h2>Desempenho por fila</h2><span class="nota">${mesExib(comp)}</span></header>
        <div class="leg"><span><i style="background:var(--bom)"></i>Dentro do SLA</span><span><i style="background:var(--crit)"></i>Fora do SLA</span></div>
        <div id="s-g1"></div></section>
      <section class="bloco"><header><h2>Tendência de conformidade</h2><span class="nota">% dentro do SLA</span></header>
        <div id="s-g2"></div></section>
    </div>
    <div class="grade g2">
      <section class="bloco"><header><h2>Por tópico de ajuda</h2></header><div class="rank" id="s-r1"></div></section>
      <section class="bloco"><header><h2>Por filial</h2></header>
        <div class="rol"><table><thead><tr><th>Filial</th><th class="n">Atendidos</th><th class="n">Dentro</th><th class="n">Fora</th><th class="n">% no SLA</th></tr></thead>
        <tbody>${porFilial.map((f)=>`<tr><td>${esc(f.nome)}</td><td class="n">${inteiro(f.total)}</td>
          <td class="n">${inteiro(f.dentro)}</td><td class="n">${inteiro(f.fora)}</td>
          <td class="n"><span class="tag ${f.pct>=90?'bom':f.pct>=75?'alerta':'crit'}">${pctTxt(f.pct)}</span></td></tr>`).join('')}
        </tbody></table></div></section>
    </div>
    <section class="bloco"><header><h2>Registros de ${mesExib(comp)}</h2></header>
      <div class="rol"><table><thead><tr><th>Filial</th><th>Fila</th><th>Tópico</th>
        <th class="n">Atendidos</th><th class="n">Dentro</th><th class="n">Fora</th><th class="n">%</th><th></th></tr></thead>
      <tbody>${doMes.map((r)=>`<tr data-sid="${esc(r.id)}">
        <td>${r.filial?esc(r.filial):'<em style="color:var(--tinta3)">empresa</em>'}</td>
        <td>${esc(r.fila)}</td><td>${esc(r.topico||'—')}</td>
        <td class="n">${inteiro(r.total)}</td><td class="n">${inteiro(r.dentro)}</td><td class="n">${inteiro(r.total-r.dentro)}</td>
        <td class="n">${pctTxt(pct(r.dentro,r.total))}</td>
        <td><button class="bt fant peq" data-sdel>Excluir</button></td></tr>`).join('')}</tbody></table></div></section>`}`;

  if (comps.length) el('#s-comp').onchange = () => { E.competencia = el('#s-comp').value; render(); };
  el('#s-novo').onclick = () => formSla(comp || mesHoje());
  if (regs.length) {
    barras(el('#s-g1'), porFila.map((f)=>({ rot:f.nome, v:{ d:f.dentro, f:f.fora } })),
      [{k:'d',nome:'Dentro do SLA',cor:'var(--bom)'},{k:'f',nome:'Fora do SLA',cor:'var(--crit)'}], 'empilhado', inteiro, inteiro);
    linhas(el('#s-g2'), tendencia, [{k:'p',nome:'% dentro do SLA',cor:'var(--s1)'}], pctTxt, (v)=>String(Math.round(v)), '%');
    ranking(el('#s-r1'), porTopico.map((t)=>({ rotulo:t.nome+' — '+pctTxt(t.pct)+' no SLA', valor:t.total })),
      (v)=>inteiro(v)+' tickets', 'var(--s3)');
    el('#pagina').querySelectorAll('tr[data-sid]').forEach((tr) => {
      tr.querySelector('[data-sdel]').onclick = () => confirmar({
        titulo:'Excluir registro de SLA', mensagem:'O registro será removido e a exclusão fica na auditoria.',
        rotulo:'Excluir', exigeJustificativa:true,
        async aoConfirmar(just) {
          const restantes = (await Loja.slaDa(emp)).filter((r)=>r.competencia===comp && r.id!==tr.dataset.sid)
            .map(({competencia, ...r})=>r);
          await Loja.gravarSlaMes(emp, comp, restantes);
          await Loja.auditar({ acao:'excluir', entidade:'ticket_sla', id:tr.dataset.sid, justificativa:just });
          render();
        } });
    });
  }
}

function formSla(comp) {
  const fils = filiaisDa(E.empresa), filas = filasDa(E.empresa);
  abrirModal({
    titulo: 'Registrar tickets do mês',
    corpo: `
      <div class="grade g3">
        <div class="campo"><label for="k-fil">Filial</label><select id="k-fil" name="filial">
          <option value="">— empresa —</option>${fils.map((f)=>`<option>${esc(f.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label for="k-comp">Competência (MM/AAAA)</label><input id="k-comp" name="comp" value="${mesExib(comp)}"></div>
        <div class="campo"><label for="k-fila">Fila</label><select id="k-fila" name="fila">
          ${filas.map((f)=>`<option>${esc(f.nome)}</option>`).join('')}</select></div>
      </div>
      <div class="grade g3">
        <div class="campo"><label for="k-top">Tópico de ajuda</label><input id="k-top" name="topico" placeholder="opcional — cadastro livre"></div>
        <div class="campo"><label for="k-tot">Total atendidos</label><input id="k-tot" name="total" type="number" min="0"></div>
        <div class="campo"><label for="k-den">Dentro do SLA</label><input id="k-den" name="dentro" type="number" min="0"></div>
      </div>
      <div class="msg" data-calc>Fora do SLA calculado: <strong>—</strong></div>`,
    acoes:`<button type="button" class="bt" data-c>Cancelar</button><button type="button" class="bt pri" data-s>Salvar registro</button>`,
    aoMontar({ raiz, fechar, erro, campo }) {
      const calc = () => {
        const t = Number(campo('total').value||0), d = Number(campo('dentro').value||0);
        const box = raiz.querySelector('[data-calc]');
        box.innerHTML = 'Fora do SLA calculado: <strong>' + (t-d) + '</strong>' +
          (d > t ? ' — "dentro" não pode superar o total atendido.' : '');
        box.className = 'msg' + (d > t ? ' erro' : '');
      };
      campo('total').addEventListener('input', calc); campo('dentro').addEventListener('input', calc);
      raiz.querySelector('[data-c]').onclick = fechar;
      raiz.querySelector('[data-s]').onclick = async (ev) => {
        ev.target.disabled = true; erro('');
        try {
          const c = mesInterno(campo('comp').value);
          if (!c) throw new Error('Competência inválida: use MM/AAAA.');
          const total = Number(campo('total').value), dentro = Number(campo('dentro').value);
          if (!Number.isInteger(total) || total < 0) throw new Error('Total atendidos inválido.');
          if (!Number.isInteger(dentro) || dentro < 0) throw new Error('Dentro do SLA inválido.');
          if (dentro > total) throw new Error('Dentro do SLA não pode superar o total atendido.');
          checarCompetencia(c, 'registro de SLA');
          const atuais = (await Loja.slaDa(E.empresa)).filter((r)=>r.competencia===c).map(({competencia, ...r})=>r);
          atuais.push({ id: novoId(), filial: campo('filial').value || null, fila: campo('fila').value,
            topico: campo('topico').value.trim() || null, total, dentro });
          await Loja.gravarSlaMes(E.empresa, c, atuais);
          await Loja.auditar({ acao:'criar', entidade:'ticket_sla', depois:{ competencia:mesExib(c), total, dentro } });
          E.competencia = c; fechar(); render();
        } catch (e) { erro(e.message); ev.target.disabled = false; }
      };
    },
  });
}

// ===========================================================================
// Cadastros, fechamento e auditoria
// ===========================================================================
async function viewCadastros() {
  const emp = E.empresa;
  const fechadas = await Loja.fechamentosDa(emp);
  const lista = (titulo, itens, acaoNovo, extra) => `
    <section class="bloco"><header><h2>${titulo}</h2><span class="nota">${inteiro(itens.length)}</span></header>
      ${itens.length===0 ? '<p class="vazio">Nenhum registro.</p>' : `<div style="display:flex;gap:7px;flex-wrap:wrap">
        ${itens.map((i)=>`<span class="tag">${esc(i)}</span>`).join('')}</div>`}
      ${extra||''}
      <div style="margin-top:12px"><button class="bt" data-novo="${acaoNovo}">Adicionar</button></div></section>`;

  el('#pagina').innerHTML = `
    <div class="msg"><strong>Cadastros da empresa ${esc(E.empresas.find((x)=>x.id===emp)?.nome || '')}.</strong>
      Filiais, tipos de despesa, filas e cenários pertencem a esta empresa — nada é compartilhado entre empresas.</div>
    <div class="grade g2">
      ${lista('Filiais', filiaisDa(emp).map((f)=>f.uf?`${f.nome} — ${f.uf}`:f.nome), 'filial')}
      ${lista('Tipos de despesa', tiposDa(emp).map((t)=>t.nome), 'tipo')}
    </div>
    <div class="grade g2">
      ${lista('Filas de ticket', filasDa(emp).map((f)=>f.nome), 'fila')}
      ${lista('Cenários de projeção', cenariosDa(emp).map((c)=>c.nome), 'cenario')}
    </div>
    <section class="bloco"><header><h2>Fechamento de competência</h2></header>
      <div class="msg">Uma competência fechada não aceita novo lançamento nem alteração. Reabrir exige justificativa,
        e tudo fica na trilha de auditoria.</div>
      <div class="filtros" style="margin-top:12px;box-shadow:none;border:0;padding:0">
        <div class="campo" style="width:120px"><label for="fc-comp">Competência</label>
          <input id="fc-comp" value="${mesExib(E.competencia||mesHoje())}"></div>
        <button class="bt pri" id="fc-fechar">Fechar competência</button>
      </div>
      ${fechadas.length===0 ? '<p class="vazio">Nenhuma competência fechada.</p>' : `
      <div class="rol" style="margin-top:10px"><table><thead><tr><th>Competência</th><th>Fechada em</th><th></th></tr></thead>
        <tbody>${fechadas.map((f)=>`<tr data-fc="${esc(f.comp||f)}">
          <td><span class="tag alerta">${mesExib(f.comp||f)}</span></td>
          <td>${f.quando?new Date(f.quando).toLocaleString('pt-BR'):'—'}</td>
          <td><button class="bt fant peq" data-reabrir>Reabrir</button></td></tr>`).join('')}</tbody></table></div>`}
    </section>`;

  el('#pagina').querySelectorAll('[data-novo]').forEach((b) => b.onclick = () => formCadastro(b.dataset.novo));
  el('#fc-fechar').onclick = async () => {
    const c = mesInterno(el('#fc-comp').value);
    if (!c) return alert('Competência inválida: use MM/AAAA.');
    if (c > mesHoje()) return alert('Não é possível fechar uma competência futura.');
    const atuais = await Loja.fechamentosDa(emp);
    if (atuais.some((f)=>(f.comp||f)===c)) return alert('Esta competência já está fechada.');
    await Loja.gravarFechamentos(emp, [...atuais, { comp:c, quando:new Date().toISOString() }]);
    await Loja.auditar({ acao:'fechar', entidade:'fechamento', depois:{ competencia: mesExib(c) } });
    render();
  };
  el('#pagina').querySelectorAll('tr[data-fc]').forEach((tr) => {
    tr.querySelector('[data-reabrir]').onclick = () => confirmar({
      titulo:'Reabrir competência', mensagem:`A competência ${mesExib(tr.dataset.fc)} voltará a aceitar alterações.`,
      rotulo:'Reabrir', exigeJustificativa:true,
      async aoConfirmar(just) {
        const atuais = (await Loja.fechamentosDa(emp)).filter((f)=>(f.comp||f)!==tr.dataset.fc);
        await Loja.gravarFechamentos(emp, atuais);
        await Loja.auditar({ acao:'reabrir', entidade:'fechamento', justificativa:just, antes:{ competencia: mesExib(tr.dataset.fc) } });
        render();
      } });
  });
}

function formCadastro(tipo) {
  const rotulos = { filial:'Nova filial', tipo:'Novo tipo de despesa', fila:'Nova fila de ticket', cenario:'Novo cenário de projeção' };
  abrirModal({
    titulo: rotulos[tipo],
    corpo: `<div class="campo"><label for="n-nome">Nome</label><input id="n-nome" name="nome"></div>
      ${tipo==='filial'?'<div class="campo"><label for="n-uf">UF</label><input id="n-uf" name="uf" maxlength="2"></div>':''}
      ${tipo==='cenario'?'<div class="campo"><label for="n-desc">Descrição</label><textarea id="n-desc" name="desc"></textarea></div>':''}`,
    acoes:`<button type="button" class="bt" data-c>Cancelar</button><button type="button" class="bt pri" data-s>Adicionar</button>`,
    aoMontar({ raiz, fechar, erro, campo }) {
      raiz.querySelector('[data-c]').onclick = fechar;
      raiz.querySelector('[data-s]').onclick = async (ev) => {
        ev.target.disabled = true; erro('');
        try {
          const nome = campo('nome').value.trim();
          if (!nome) throw new Error('Informe o nome.');
          const emp = E.empresa;
          if (tipo === 'filial') {
            if (filiaisDa(emp).some((f)=>f.nome.toLowerCase()===nome.toLowerCase())) throw new Error('Já existe filial com este nome.');
            await Loja.gravarCatalogo('filiais', [...E.filiais, { empresa:emp, nome, uf: campo('uf').value.trim().toUpperCase() || null }]);
          } else if (tipo === 'tipo') {
            if (tiposDa(emp).some((t)=>t.nome.toLowerCase()===nome.toLowerCase())) throw new Error('Já existe tipo com este nome.');
            await Loja.gravarCatalogo('tipos', [...E.tipos, { empresa:emp, nome }]);
          } else if (tipo === 'fila') {
            if (filasDa(emp).some((f)=>f.nome.toLowerCase()===nome.toLowerCase())) throw new Error('Já existe fila com este nome.');
            await Loja.gravarCatalogo('filas', [...E.filas, { empresa:emp, nome }]);
          } else {
            const chave = nome.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9]+/g,'_').toLowerCase();
            if (chave === 'oficial') throw new Error('O cenário "oficial" já existe.');
            await Loja.gravarCatalogo('cenarios', [...E.cenarios, { empresa:emp, chave, nome, descricao: campo('desc').value.trim() || null }]);
          }
          await Loja.auditar({ acao:'criar', entidade:tipo, depois:{ nome } });
          fechar(); render();
        } catch (e) { erro(e.message); ev.target.disabled = false; }
      };
    },
  });
}

async function viewAuditoria() {
  const s = await E.db.doc('auditoria/' + E.empresa).get();
  const itens = s.exists ? (s.data().itens || []) : [];
  el('#pagina').innerHTML = `
    <div class="msg">Nenhuma alteração relevante ocorre sem trilha: quem, quando e o quê. Registros mais recentes primeiro.</div>
    <section class="bloco"><header><h2>Trilha de auditoria</h2><span class="nota">${inteiro(itens.length)} eventos</span></header>
      ${itens.length===0 ? '<p class="vazio">Nenhum evento registrado nesta empresa ainda.</p>' : `
      <div class="rol"><table><thead><tr><th>Quando</th><th>Entidade</th><th>Ação</th><th>Justificativa</th><th>Alteração</th></tr></thead>
      <tbody>${itens.slice(0,250).map((a)=>`<tr>
        <td style="white-space:nowrap">${new Date(a.quando).toLocaleString('pt-BR')}</td>
        <td>${esc(a.entidade||'')}</td>
        <td><span class="tag ${a.acao==='excluir'?'crit':a.acao==='criar'?'bom':''}">${esc(a.acao)}</span></td>
        <td style="max-width:220px">${esc(a.justificativa||'—')}</td>
        <td style="max-width:340px;font-size:12px">${esc(JSON.stringify(a.depois||a.antes||{}))}</td></tr>`).join('')}
      </tbody></table></div>`}</section>`;
}
