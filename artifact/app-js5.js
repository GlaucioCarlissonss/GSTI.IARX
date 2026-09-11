// ===========================================================================
// Projetos — cadastro, tarefas, envolvidos e Gantt mensal
// ===========================================================================
/** Atraso é derivado: mês corrente além do fim planejado, sem fim real. */
function atrasoDe(fimPlan, fimReal, status) {
  if (status === 'cancelado' || status === 'cancelada') return { atrasado:false, meses:0, desvio:0 };
  if (fimReal) return { atrasado:false, meses:0, desvio: mesIdx(fimReal) - mesIdx(fimPlan) };
  const d = mesIdx(mesHoje()) - mesIdx(fimPlan);
  return { atrasado: d > 0, meses: Math.max(d,0), desvio: Math.max(d,0) };
}

async function viewProjetos() {
  const emp = E.empresa;
  const projetos = (await Loja.projetosDa(emp)).filter((p) => !E.filial || p.filial === E.filial);
  const comAtraso = projetos.map((p) => ({ ...p, ...atrasoDe(p.fimPlanejado, p.fimReal, p.status) }));
  const tarefas = projetos.flatMap((p) => (p.tarefas||[]).map((t)=>({ ...t, projeto:p.nome })));
  const carga = {};
  for (const t of tarefas) {
    const k = t.responsavel?.trim() || '(não atribuído)';
    carga[k] = carga[k] || { total:0, abertas:0, atrasadas:0 };
    carga[k].total++; if (!t.fimReal) carga[k].abertas++;
    if (atrasoDe(t.fimPlanejado, t.fimReal, 'x').atrasado) carga[k].atrasadas++;
  }
  const meses = projetos.length
    ? intervalo([mesHoje(), ...projetos.map((p)=>p.inicio)].sort()[0],
                [mesHoje(), ...projetos.map((p)=>p.fimReal||p.fimPlanejado)].sort().pop())
    : [];
  const iHoje = meses.indexOf(mesHoje()), larg = 38;

  el('#pagina').innerHTML = `
    <div class="filtros">
      <div style="margin-right:auto;color:var(--tinta3);font-size:13px">
        Cronograma mensal. O atraso é calculado, não digitado: existe quando o mês corrente passa do fim planejado sem fim real.</div>
      <button class="bt pri" id="p-novo">Novo projeto</button>
    </div>
    <div class="kpis">
      <div class="kpi"><span class="r">Projetos</span><span class="n">${inteiro(comAtraso.length)}</span><span class="a">${inteiro(tarefas.length)} tarefas</span></div>
      <div class="kpi"><span class="r">Em andamento</span><span class="n">${inteiro(comAtraso.filter((p)=>p.status==='em_andamento').length)}</span></div>
      <div class="kpi"><span class="r">Concluídos</span><span class="n">${inteiro(comAtraso.filter((p)=>p.status==='concluido').length)}</span></div>
      <div class="kpi"><span class="r">Atrasados</span><span class="n">${inteiro(comAtraso.filter((p)=>p.atrasado).length)}</span>
        <span class="a">${inteiro(tarefas.filter((t)=>atrasoDe(t.fimPlanejado,t.fimReal,'x').atrasado).length)} tarefas em atraso</span></div>
    </div>
    ${comAtraso.length === 0 ? '<section class="bloco"><p class="vazio">Nenhum projeto cadastrado nesta empresa.</p></section>' : `
    <section class="bloco"><header><h2>Cronograma</h2>
      <span class="nota">${mesExib(meses[0])} a ${mesExib(meses[meses.length-1])}</span></header>
      <div class="leg"><span><i style="background:var(--s1)"></i>Planejado</span>
        <span><i style="background:var(--s3)"></i>Realizado</span><span><i style="background:var(--crit)"></i>Em atraso</span></div>
      <div class="gantt"><table><thead><tr><th style="min-width:210px">Projeto</th>
        ${meses.map((m,i)=>`<th class="m">${meses.length<=18||i%3===0?mesCurto(m):''}</th>`).join('')}</tr></thead>
        <tbody>${comAtraso.map((p) => {
          const off = (mesIdx(p.inicio)-mesIdx(meses[0]))*larg;
          const dur = (mesIdx(p.fimPlanejado)-mesIdx(p.inicio)+1)*larg;
          const dReal = p.fimReal ? (mesIdx(p.fimReal)-mesIdx(p.inicio)+1)*larg : 0;
          return `<tr><td class="nome">${esc(p.nome)}
            <div style="font-size:11.5px;color:var(--tinta3)">${p.filial?esc(p.filial):'empresa'} ·
              ${p.atrasado?`<span class="tag crit">${p.meses} mês(es) de atraso</span>`:(STATUS_PROJ[p.status]||p.status)}</div></td>
            <td class="faixa" colspan="${meses.length}">
              ${iHoje>=0?`<div class="hoje" style="left:${iHoje*larg+larg/2}px"></div>`:''}
              <div class="barra" style="left:${off+2}px;width:${Math.max(dur-4,6)}px;${p.atrasado?'background:var(--crit)':''}"></div>
              ${dReal?`<div class="barra real" style="left:${off+2}px;width:${Math.max(dReal-4,6)}px"></div>`:''}
            </td></tr>`;
        }).join('')}</tbody></table></div></section>`}

    <section class="bloco"><header><h2>Projetos e tarefas</h2></header>
      ${comAtraso.length===0 ? '<p class="vazio">Cadastre o primeiro projeto.</p>' : `
      <div class="rol"><table><thead><tr><th>Projeto</th><th>Filial</th><th>Início</th><th>Fim planejado</th>
        <th>Fim real</th><th>Situação</th><th class="n">Tarefas</th><th></th></tr></thead>
        <tbody>${comAtraso.map((p)=>`<tr data-id="${esc(p.id)}">
          <td><strong>${esc(p.nome)}</strong>${p.descricao?`<div style="color:var(--tinta3);font-size:12px">${esc(p.descricao)}</div>`:''}</td>
          <td>${p.filial?esc(p.filial):'<em style="color:var(--tinta3)">empresa</em>'}</td>
          <td>${mesExib(p.inicio)}</td><td>${mesExib(p.fimPlanejado)}</td><td>${p.fimReal?mesExib(p.fimReal):'—'}</td>
          <td>${p.atrasado?`<span class="tag crit">Atrasado (${p.meses}m)</span>`
            :`<span class="tag ${p.status==='concluido'?'bom':''}">${STATUS_PROJ[p.status]||p.status}</span>`}</td>
          <td class="n">${(p.tarefas||[]).filter((t)=>t.fimReal).length}/${(p.tarefas||[]).length}</td>
          <td style="white-space:nowrap"><button class="bt fant peq" data-ab>Abrir</button>
            <button class="bt fant peq" data-ex>Excluir</button></td></tr>`).join('')}</tbody></table></div>`}
    </section>

    ${Object.keys(carga).length ? `<div class="grade g2">
      <section class="bloco"><header><h2>Carga por envolvido</h2><span class="nota">tarefas atribuídas</span></header>
        <div class="rank" id="p-carga"></div></section>
      <section class="bloco"><header><h2>Desvio planejado × real</h2><span class="nota">projetos concluídos</span></header>
        ${comAtraso.filter((p)=>p.fimReal).length===0 ? '<p class="vazio">Nenhum projeto concluído ainda.</p>' : `
        <div class="rol"><table><thead><tr><th>Projeto</th><th>Planejado</th><th>Real</th><th class="n">Desvio</th></tr></thead>
        <tbody>${comAtraso.filter((p)=>p.fimReal).sort((a,b)=>b.desvio-a.desvio).map((p)=>`<tr>
          <td>${esc(p.nome)}</td><td>${mesExib(p.fimPlanejado)}</td><td>${mesExib(p.fimReal)}</td>
          <td class="n"><span class="tag ${p.desvio>0?'crit':'bom'}">${p.desvio>0?'+':''}${p.desvio} mês(es)</span></td></tr>`).join('')}
        </tbody></table></div>`}</section></div>` : ''}`;

  el('#p-novo').onclick = () => formProjeto(null);
  if (Object.keys(carga).length) {
    ranking(el('#p-carga'), Object.entries(carga).map(([k,c])=>({ rotulo:k, valor:c.total })),
      (v)=>inteiro(v)+' tarefa(s)', 'var(--s3)');
  }
  el('#pagina').querySelectorAll('tbody tr[data-id]').forEach((tr) => {
    const p = projetos.find((x)=>x.id===tr.dataset.id);
    tr.querySelector('[data-ab]').onclick = () => abrirProjeto(p);
    tr.querySelector('[data-ex]').onclick = () => confirmar({
      titulo:'Excluir projeto', mensagem:`O projeto "${esc(p.nome)}" e suas tarefas serão removidos.`,
      rotulo:'Excluir', exigeJustificativa:true,
      async aoConfirmar(just) {
        const itens = (await Loja.projetosDa(E.empresa)).filter((x)=>x.id!==p.id);
        await Loja.gravarProjetos(E.empresa, itens);
        await Loja.auditar({ acao:'excluir', entidade:'projeto', id:p.id, justificativa:just, antes:{ nome:p.nome } });
        render();
      } });
  });
}

function formProjeto(existente) {
  const fils = filiaisDa(E.empresa), ed = !!existente;
  const v = existente || { nome:'', descricao:'', filial:null, inicio:mesHoje(), fimPlanejado:'', fimReal:null, status:'planejado' };
  abrirModal({
    titulo: ed ? 'Editar projeto' : 'Novo projeto',
    corpo: `
      <div class="campo"><label for="q-nome">Nome do projeto</label><input id="q-nome" name="nome" value="${esc(v.nome)}"></div>
      <div class="campo"><label for="q-desc">Descrição</label><textarea id="q-desc" name="descricao">${esc(v.descricao||'')}</textarea></div>
      <div class="grade g3">
        <div class="campo"><label for="q-fil">Filial</label><select id="q-fil" name="filial">
          <option value="">— empresa —</option>${fils.map((f)=>`<option${f.nome===v.filial?' selected':''}>${esc(f.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label for="q-ini">Mês de início</label><input id="q-ini" name="inicio" value="${mesExib(v.inicio)}"></div>
        <div class="campo"><label for="q-fim">Fim planejado</label><input id="q-fim" name="fimPlanejado" value="${v.fimPlanejado?mesExib(v.fimPlanejado):''}" placeholder="MM/AAAA"></div>
      </div>
      <div class="grade g3">
        <div class="campo"><label for="q-st">Status</label><select id="q-st" name="status">
          ${Object.entries(STATUS_PROJ).map(([k,n])=>`<option value="${k}"${k===v.status?' selected':''}>${n}</option>`).join('')}</select></div>
        <div class="campo"><label for="q-real">Fim real (só na conclusão)</label>
          <input id="q-real" name="fimReal" value="${v.fimReal?mesExib(v.fimReal):''}" placeholder="MM/AAAA"></div>
      </div>`,
    acoes:`<button type="button" class="bt" data-c>Cancelar</button><button type="button" class="bt pri" data-s>${ed?'Salvar':'Criar projeto'}</button>`,
    aoMontar({ raiz, fechar, erro, campo }) {
      raiz.querySelector('[data-c]').onclick = fechar;
      raiz.querySelector('[data-s]').onclick = async (ev) => {
        ev.target.disabled = true; erro('');
        try {
          const nome = campo('nome').value.trim();
          if (!nome) throw new Error('O nome do projeto é obrigatório.');
          const inicio = mesInterno(campo('inicio').value), fimP = mesInterno(campo('fimPlanejado').value);
          if (!inicio || !fimP) throw new Error('Início e fim planejado precisam estar em MM/AAAA.');
          if (fimP < inicio) throw new Error('O fim planejado não pode ser anterior ao início.');
          const fimRealTxt = campo('fimReal').value.trim();
          const fimReal = fimRealTxt ? mesInterno(fimRealTxt) : null;
          if (fimRealTxt && !fimReal) throw new Error('Fim real inválido: use MM/AAAA.');
          let status = campo('status').value;
          if (fimReal && status !== 'cancelado') status = 'concluido';
          if (status === 'concluido' && !fimReal) throw new Error('Um projeto concluído exige o mês de fim real.');
          const itens = [...(await Loja.projetosDa(E.empresa))];
          const corpo = { nome, descricao: campo('descricao').value.trim() || null,
            filial: campo('filial').value || null, inicio, fimPlanejado: fimP, fimReal, status };
          if (ed) { const i = itens.findIndex((x)=>x.id===existente.id); itens[i] = { ...itens[i], ...corpo }; }
          else itens.push({ id: novoId(), ...corpo, tarefas: [], envolvidos: [] });
          await Loja.gravarProjetos(E.empresa, itens);
          await Loja.auditar({ acao: ed?'atualizar':'criar', entidade:'projeto', id: ed?existente.id:corpo.nome, depois: corpo });
          fechar(); render();
        } catch (e) { erro(e.message); ev.target.disabled = false; }
      };
    },
  });
}

function abrirProjeto(p) {
  const tarefas = p.tarefas || [], envolvidos = p.envolvidos || [];
  abrirModal({
    titulo: p.nome,
    corpo: `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span class="tag">${mesExib(p.inicio)} → ${mesExib(p.fimPlanejado)}</span>
        <span class="tag ${p.fimReal?'bom':''}">${p.fimReal?'Concluído em '+mesExib(p.fimReal):(STATUS_PROJ[p.status]||p.status)}</span>
        <button type="button" class="bt peq" data-edp style="margin-left:auto">Editar projeto</button>
      </div>
      <h3 style="font-size:14px;margin-top:6px">Tarefas</h3>
      <div class="rol" data-tar></div>
      <form class="filtros" data-formtar style="margin-top:4px">
        <div class="campo" style="flex:1 1 150px"><label for="t-nome">Nova tarefa</label><input id="t-nome" name="tnome" required></div>
        <div class="campo" style="width:140px"><label for="t-resp">Responsável</label><input id="t-resp" name="tresp"></div>
        <div class="campo" style="width:104px"><label for="t-ini">Início</label><input id="t-ini" name="tini" value="${mesExib(p.inicio)}" required></div>
        <div class="campo" style="width:104px"><label for="t-fim">Fim planejado</label><input id="t-fim" name="tfim" placeholder="MM/AAAA" required></div>
        <button class="bt pri" type="submit">Adicionar</button>
      </form>
      <h3 style="font-size:14px;margin-top:8px">Envolvidos</h3>
      <div data-env style="display:flex;gap:7px;flex-wrap:wrap"></div>
      <form class="filtros" data-formenv style="margin-top:4px">
        <div class="campo" style="flex:1 1 140px"><label for="e-nome">Nome</label><input id="e-nome" name="enome" required></div>
        <div class="campo" style="width:150px"><label for="e-papel">Papel</label><input id="e-papel" name="epapel"></div>
        <button class="bt" type="submit">Adicionar envolvido</button>
      </form>`,
    acoes: `<button type="button" class="bt" data-c>Fechar</button>`,
    aoMontar({ raiz, fechar, erro }) {
      const pintar = () => {
        const t = raiz.querySelector('[data-tar]');
        t.innerHTML = tarefas.length === 0 ? '<p class="vazio">Nenhuma tarefa.</p>' : `
          <table><thead><tr><th>Tarefa</th><th>Responsável</th><th>Período</th><th>Situação</th><th></th></tr></thead>
          <tbody>${tarefas.map((x)=>{ const a = atrasoDe(x.fimPlanejado, x.fimReal, 'x'); return `<tr data-t="${esc(x.id)}">
            <td>${esc(x.nome)}</td><td>${esc(x.responsavel||'—')}</td>
            <td style="white-space:nowrap">${mesExib(x.inicio)} → ${mesExib(x.fimReal||x.fimPlanejado)}</td>
            <td>${x.fimReal?'<span class="tag bom">Concluída</span>':a.atrasado?`<span class="tag crit">Atrasada (${a.meses}m)</span>`:'<span class="tag">Pendente</span>'}</td>
            <td style="white-space:nowrap">${x.fimReal?'':'<button type="button" class="bt fant peq" data-ok>Concluir</button>'}
              <button type="button" class="bt fant peq" data-del>Remover</button></td></tr>`; }).join('')}</tbody></table>`;
        raiz.querySelector('[data-env]').innerHTML = envolvidos.length === 0
          ? '<span class="vazio" style="padding:6px">Nenhum envolvido.</span>'
          : envolvidos.map((e,i)=>`<span class="tag">${esc(e.papel?e.nome+' — '+e.papel:e.nome)}
              <button type="button" class="bt fant peq" data-rmenv="${i}" style="padding:0 4px">✕</button></span>`).join('');
        t.querySelectorAll('tr[data-t]').forEach((tr) => {
          const tar = tarefas.find((x)=>x.id===tr.dataset.t);
          tr.querySelector('[data-ok]')?.addEventListener('click', async () => {
            const m = prompt('Mês de conclusão real (MM/AAAA):', mesExib(mesHoje()));
            if (!m) return;
            const c = mesInterno(m); if (!c) return erro('Mês inválido.');
            tar.fimReal = c; await persistir(); pintar();
          });
          tr.querySelector('[data-del]').addEventListener('click', async () => {
            tarefas.splice(tarefas.findIndex((x)=>x.id===tar.id), 1); await persistir(); pintar();
          });
        });
        raiz.querySelectorAll('[data-rmenv]').forEach((b) => b.addEventListener('click', async () => {
          envolvidos.splice(+b.dataset.rmenv, 1); await persistir(); pintar();
        }));
      };
      const persistir = async () => {
        const itens = (await Loja.projetosDa(E.empresa)).map((x)=> x.id===p.id ? { ...x, tarefas, envolvidos } : x);
        await Loja.gravarProjetos(E.empresa, itens);
      };
      raiz.querySelector('[data-c]').onclick = () => { fechar(); render(); };
      raiz.querySelector('[data-edp]').onclick = () => { fechar(); formProjeto(p); };
      raiz.querySelector('[data-formtar]').addEventListener('submit', async (ev) => {
        ev.preventDefault(); erro('');
        const f = ev.target;
        const ini = mesInterno(f.tini.value), fim = mesInterno(f.tfim.value);
        if (!ini || !fim) return erro('Início e fim da tarefa precisam estar em MM/AAAA.');
        if (fim < ini) return erro('O fim planejado da tarefa não pode ser anterior ao início.');
        tarefas.push({ id: novoId(), nome: f.tnome.value.trim(), inicio: ini, fimPlanejado: fim,
          fimReal: null, responsavel: f.tresp.value.trim() || null });
        await persistir(); f.reset(); f.tini.value = mesExib(p.inicio); pintar();
      });
      raiz.querySelector('[data-formenv]').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = ev.target;
        envolvidos.push({ nome: f.enome.value.trim(), papel: f.epapel.value.trim() || null });
        await persistir(); f.reset(); pintar();
      });
      pintar();
    },
  });
}
