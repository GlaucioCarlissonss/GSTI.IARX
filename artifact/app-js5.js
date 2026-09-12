// ===========================================================================
// Projetos — cadastro, tarefas, envolvidos e Gantt mensal
// ===========================================================================

// ------------------------------------------------------- hierarquia de tarefas
//
// Uma tarefa pode ter uma tarefa principal (`paiId`), sempre do mesmo projeto,
// porque as tarefas vivem dentro do documento do projeto. A profundidade vai
// até 3 níveis — principal → subtarefa → subtarefa —, que é o que um Gantt
// ainda mostra sem virar indentação ilegível.
const PROFUNDIDADE_MAXIMA = 3;

/** Cadeia de ascendentes, da mais próxima à raiz. Teto próprio contra ciclo. */
function ascendentesDe(tarefas, id) {
  const cadeia = [];
  let atual = (tarefas.find((t) => t.id === id) || {}).paiId || null;
  for (let i = 0; i < 64 && atual; i++) {
    if (cadeia.includes(atual)) break;
    cadeia.push(atual);
    atual = (tarefas.find((t) => t.id === atual) || {}).paiId || null;
  }
  return cadeia;
}

/** Profundidade da subárvore abaixo da tarefa (0 = sem filhas). */
function alturaAbaixoDe(tarefas, id) {
  const filhas = tarefas.filter((t) => t.paiId === id);
  return filhas.length ? 1 + Math.max(...filhas.map((f) => alturaAbaixoDe(tarefas, f.id))) : 0;
}

/**
 * Valida a tarefa principal escolhida. Devolve `null` (sem agrupamento) ou o
 * id; lança com o motivo quando a escolha é impossível.
 *
 * `id` é a tarefa sendo editada; ao criar, `null`.
 */
function validarPrincipal(tarefas, paiId, id) {
  if (!paiId) return null;
  if (id && paiId === id) throw new Error('Uma tarefa não pode ser a própria tarefa principal.');
  const pai = tarefas.find((t) => t.id === paiId);
  if (!pai) throw new Error('Tarefa principal não encontrada neste projeto.');
  if (id && ascendentesDe(tarefas, paiId).includes(id)) {
    throw new Error(`"${pai.nome}" já está abaixo desta tarefa: colocá-la como principal criaria um ciclo.`);
  }
  const nivelDoPai = ascendentesDe(tarefas, paiId).length + 1;
  const alturaQueVem = id ? alturaAbaixoDe(tarefas, id) : 0;
  if (nivelDoPai + 1 + alturaQueVem > PROFUNDIDADE_MAXIMA) {
    throw new Error(
      `A hierarquia vai até ${PROFUNDIDADE_MAXIMA} níveis (tarefa principal → subtarefa → subtarefa). ` +
      `"${pai.nome}" já está no nível ${nivelDoPai}.`);
  }
  return paiId;
}

/**
 * Opções do seletor de tarefa principal. A indentação por nível mostra onde
 * cada uma está na hierarquia — sem ela, uma lista plana de nomes não diz se a
 * escolha vai criar um segundo ou um terceiro nível.
 *
 * `excluir` tira da lista a própria tarefa que está sendo reagrupada: ninguém
 * pode ser a própria principal, e oferecer a opção seria oferecer um erro.
 */
function opcoesDePrincipal(candidatas, selecionado = null, excluir = null) {
  const disponiveis = candidatas.filter((c) => c.id !== excluir);
  const nenhuma = `<option value=""${selecionado ? '' : ' selected'}>— nenhuma (fica no primeiro nível) —</option>`;
  if (disponiveis.length === 0) return nenhuma;
  return nenhuma + disponiveis.map((c) => {
    const recuo = '\u00a0\u00a0'.repeat(c.nivel - 1) + (c.nivel > 1 ? '\u21b3 ' : '');
    return `<option value="${esc(c.id)}"${c.id === selecionado ? ' selected' : ''}>${esc(recuo + c.nome)}</option>`;
  }).join('');
}

/**
 * Tarefas em ordem de leitura — cada principal seguida das suas subtarefas —,
 * com o nível e o intervalo agregado do grupo. O agregado é o que a barra do
 * pai mostra quando o grupo está comprimido: esconder as subtarefas não pode
 * encolher o tempo que elas ocupam no cronograma.
 */
function tarefasEmOrdem(tarefas) {
  const ids = new Set(tarefas.map((t) => t.id));
  const paiDe = (t) => (t.paiId && ids.has(t.paiId) ? t.paiId : null);
  const porPai = new Map();
  for (const t of tarefas) {
    const k = paiDe(t);
    if (!porPai.has(k)) porPai.set(k, []);
    porPai.get(k).push(t);
  }
  const subarvore = (t) => [t, ...(porPai.get(t.id) || []).flatMap(subarvore)];

  const saida = [];
  const descer = (paiId, nivel) => {
    for (const t of porPai.get(paiId) || []) {
      const grupo = subarvore(t);
      const fins = grupo.map((x) => x.fimReal || x.fimPlanejado).sort();
      const todasFeitas = grupo.every((x) => x.fimReal);
      saida.push({
        ...t,
        nivel,
        filhas: (porPai.get(t.id) || []).length,
        grupoInicio: grupo.map((x) => x.inicio).sort()[0],
        grupoFim: fins[fins.length - 1],
        grupoFimReal: todasFeitas ? grupo.map((x) => x.fimReal).sort().pop() : null,
      });
      descer(t.id, nivel + 1);
    }
  };
  descer(null, 1);
  return saida;
}

/** Atraso é derivado: mês corrente além do fim planejado, sem fim real. */
function atrasoDe(fimPlan, fimReal, status) {
  if (status === 'cancelado' || status === 'cancelada') return { atrasado:false, meses:0, desvio:0 };
  if (fimReal) return { atrasado:false, meses:0, desvio: mesIdx(fimReal) - mesIdx(fimPlan) };
  const d = mesIdx(mesHoje()) - mesIdx(fimPlan);
  return { atrasado: d > 0, meses: Math.max(d,0), desvio: Math.max(d,0) };
}

/**
 * Estado de expansão dos grupos do Gantt, por usuário, no navegador.
 * Guarda os **comprimidos**: o padrão é expandido, e um grupo criado depois
 * precisa nascer aberto em vez de herdar o silêncio de uma lista antiga.
 */
const CHAVE_GANTT = 'iarx-gantt-comprimidos';
function gruposComprimidos() {
  try { return new Set(JSON.parse(localStorage.getItem(CHAVE_GANTT) || '[]')); }
  catch (e) { return new Set(); }
}
function gravarComprimidos(conjunto) {
  try { localStorage.setItem(CHAVE_GANTT, JSON.stringify([...conjunto])); }
  catch (e) { /* sem armazenamento: vale só nesta sessão */ }
}
const grupoExpandido = (chave) => !gruposComprimidos().has(chave);
function alternarGrupo(chave) {
  const atual = gruposComprimidos();
  if (atual.has(chave)) atual.delete(chave); else atual.add(chave);
  gravarComprimidos(atual);
}

/** A quantidade de linhas a partir da qual o Gantt passa a virtualizar. */
const TETO_GANTT = 60;
const ALTURA_LINHA_GANTT = 31;  // 30px de `td.faixa` + 1px de borda

/**
 * Lista achatada do que o Gantt mostra agora: projetos e, dentro dos abertos,
 * as tarefas cujas ascendentes estão todas expandidas. Achatar aqui é o que
 * permite virtualizar por índice e o que mantém uma única regra de "aparece".
 */
function montarLinhasGantt(projetos) {
  const linhas = [];
  for (const p of projetos) {
    linhas.push({ tipo: 'projeto', chave: 'p' + p.id, projeto: p });
    if (!p.ordenadas.length || !grupoExpandido('p' + p.id)) continue;
    const escondidas = new Set();
    for (const t of p.ordenadas) {
      if (t.paiId && (escondidas.has(t.paiId) || !grupoExpandido('t' + t.paiId))) {
        escondidas.add(t.id);
        continue;
      }
      linhas.push({
        tipo: 'tarefa', chave: 't' + t.id, projeto: p, tarefa: t,
        comprimida: t.filhas > 0 && !grupoExpandido('t' + t.id),
      });
    }
  }
  return linhas;
}

/**
 * Desenha o corpo do Gantt. Só as linhas na janela visível vão para o DOM
 * quando a lista é grande; o resto vira espaçador, para a barra de rolagem
 * continuar do tamanho da lista inteira.
 */
function pintarGantt(linhas, meses, larg, iHoje) {
  const caixa = el('#p-gantt');
  const corpo = el('#p-gantt-corpo');
  if (!caixa || !corpo) return;

  const virtualizar = linhas.length > TETO_GANTT;
  const margem = 8;
  const primeira = virtualizar ? Math.max(Math.floor(caixa.scrollTop / ALTURA_LINHA_GANTT) - margem, 0) : 0;
  const ultima = virtualizar
    ? Math.min(primeira + Math.ceil((caixa.clientHeight || 620) / ALTURA_LINHA_GANTT) + margem * 2, linhas.length)
    : linhas.length;

  const marcaHoje = iHoje >= 0 ? `<div class="hoje" style="left:${iHoje * larg + larg / 2}px"></div>` : '';
  const espaco = (n) => (n > 0
    ? `<tr aria-hidden="true"><td colspan="${meses.length + 1}" style="height:${n * ALTURA_LINHA_GANTT}px;padding:0;border:0"></td></tr>`
    : '');

  /** Botão de grupo: `button` de verdade, com teclado e estado anunciados. */
  const botao = (chave, aberto, oQue) =>
    `<button type="button" class="gantt-grupo" data-grupo="${esc(chave)}" aria-expanded="${aberto}"
       aria-label="${aberto ? 'Comprimir' : 'Expandir'} ${esc(oQue)}" title="${aberto ? 'Comprimir' : 'Expandir'}"
       >${aberto ? '−' : '+'}</button>`;
  const semBotao = '<span class="gantt-vazio" aria-hidden="true"></span>';

  const barra = (inicio, fim, extra) => {
    const off = (mesIdx(inicio) - mesIdx(meses[0])) * larg;
    const dur = (mesIdx(fim) - mesIdx(inicio) + 1) * larg;
    return { left: off + 2, width: Math.max(dur - 4, 6), extra };
  };

  corpo.innerHTML = espaco(primeira) + linhas.slice(primeira, ultima).map((linha) => {
    if (linha.tipo === 'projeto') {
      const p = linha.projeto;
      const aberto = grupoExpandido(linha.chave);
      const b = barra(p.inicio, p.fimPlanejado);
      const r = p.fimReal ? barra(p.inicio, p.fimReal) : null;
      return `<tr><td class="nome" title="${esc(p.nome)}">
          <div style="display:flex;align-items:center;gap:6px">
            ${p.ordenadas.length ? botao(linha.chave, aberto, 'as tarefas de ' + p.nome) : semBotao}
            <strong>${esc(p.nome)}</strong>
            ${p.atrasado ? `<span class="tag crit">${p.meses} mês(es) de atraso</span>` : ''}
          </div>
          <div style="font-size:11.5px;color:var(--tinta3);padding-left:26px">${p.filial ? esc(p.filial) : 'empresa'}
            · ${esc(STATUS_PROJ[p.status] || p.status)}${p.ordenadas.length ? ` · ${inteiro(p.ordenadas.length)} tarefa(s)` : ''}</div></td>
        <td class="faixa" colspan="${meses.length}">${marcaHoje}
          <div class="barra" style="left:${b.left}px;width:${b.width}px;${p.atrasado ? 'background:var(--crit)' : ''}"></div>
          ${r ? `<div class="barra real" style="left:${r.left}px;width:${r.width}px"></div>` : ''}</td></tr>`;
    }

    const t = linha.tarefa;
    const atraso = atrasoDe(t.fimPlanejado, t.fimReal, 'x');
    // Comprimida, a barra cobre o intervalo inteiro da subárvore: esconder as
    // subtarefas não encolhe o tempo que elas ocupam.
    const usaGrupo = t.filhas > 0 && linha.comprimida;
    const b = usaGrupo ? barra(t.grupoInicio, t.grupoFim) : barra(t.inicio, t.fimPlanejado);
    const fimR = usaGrupo ? t.grupoFimReal : t.fimReal;
    const r = fimR ? barra(usaGrupo ? t.grupoInicio : t.inicio, fimR) : null;
    const titulo = usaGrupo
      ? `Grupo "${t.nome}": ${mesExib(t.grupoInicio)} → ${mesExib(t.grupoFim)} (${inteiro(t.filhas)} subtarefa(s))`
      : `${mesExib(t.inicio)} → ${mesExib(t.fimPlanejado)}`;

    return `<tr><td class="nome tarefa" title="${esc(t.nome)}" style="padding-left:${10 + t.nivel * 14}px">
        <div style="display:flex;align-items:center;gap:6px">
          ${t.filhas ? botao(linha.chave, !linha.comprimida, 'as subtarefas de ' + t.nome) : semBotao}
          <span${t.filhas ? ' style="font-weight:600;color:var(--tinta)"' : ''}>${esc(t.nome)}</span>
        </div>
        <div style="font-size:11px;color:var(--tinta3);padding-left:26px">${esc(t.responsavel || 'sem responsável')}${
          t.filhas ? ` · ${inteiro(t.filhas)} subtarefa(s)` : ''}</div></td>
      <td class="faixa" colspan="${meses.length}">${marcaHoje}
        <div class="barra" title="${esc(titulo)}" style="left:${b.left}px;width:${b.width}px;height:${usaGrupo ? 9 : 7}px;top:${usaGrupo ? 5 : 7}px;${
          atraso.atrasado ? 'background:var(--crit);' : ''}opacity:${usaGrupo ? 1 : 0.75}"></div>
        ${r ? `<div class="barra real" style="left:${r.left}px;width:${r.width}px;opacity:${usaGrupo ? 1 : 0.75}"></div>` : ''}</td></tr>`;
  }).join('') + espaco(linhas.length - ultima);

  corpo.querySelectorAll('[data-grupo]').forEach((b) => {
    b.onclick = () => { alternarGrupo(b.dataset.grupo); render(); };
  });
}

async function viewProjetos() {
  const emp = empresaAtiva();
  // Com várias empresas o quadro consolida; cada projeto carrega a sua.
  const carregados = [];
  for (const e of escopoEmpresas()) {
    for (const p of await Loja.projetosDa(e)) carregados.push({ ...p, empresa: e });
  }
  const projetos = carregados.filter((p) => passaNoFiltro(E.filiaisSel, p.filial || '(empresa)'));
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

  // Cada projeto vira uma linha de grupo, e as suas tarefas vêm abaixo em
  // ordem hierárquica. O que aparece depende do que está comprimido.
  const comTarefas = comAtraso.map((p) => ({ ...p, ordenadas: tarefasEmOrdem(p.tarefas || []) }));
  const linhasGantt = montarLinhasGantt(comTarefas);
  const todosOsGrupos = [
    ...comTarefas.filter((p) => p.ordenadas.length).map((p) => 'p' + p.id),
    ...comTarefas.flatMap((p) => p.ordenadas.filter((t) => t.filhas).map((t) => 't' + t.id)),
  ];

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
      <span class="nota">${mesExib(meses[0])} a ${mesExib(meses[meses.length-1])} · ${inteiro(linhasGantt.length)} linha(s)</span>
      <span style="margin-left:auto;display:flex;gap:6px">
        <button type="button" class="bt fant peq" id="p-abrir">Expandir tudo</button>
        <button type="button" class="bt fant peq" id="p-fechar">Comprimir tudo</button></span></header>
      <div class="leg"><span><i style="background:var(--s1)"></i>Planejado</span>
        <span><i style="background:var(--s3)"></i>Realizado</span><span><i style="background:var(--crit)"></i>Em atraso</span></div>
      <div class="gantt" id="p-gantt"${linhasGantt.length > TETO_GANTT ? ' style="max-height:620px;overflow-y:auto"' : ''}>
        <table><thead><tr><th style="min-width:230px">Projeto / tarefa</th>
        ${meses.map((m,i)=>`<th class="m">${meses.length<=18||i%3===0?mesCurto(m):''}</th>`).join('')}</tr></thead>
        <tbody id="p-gantt-corpo"></tbody></table></div></section>`}

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

  // Cada indicador abre os projetos ou as tarefas que o compõem.
  ligarKpis({
    0: { dica: 'Projetos ativos no recorte, com o total de tarefas que eles somam.',
         abrir: () => detalharProjetos('Projetos no recorte', comAtraso, comAtraso.length) },
    1: { dica: 'Projetos já iniciados e ainda não concluídos.',
         abrir: () => {
           const lista = comAtraso.filter((p) => p.status === 'em_andamento');
           detalharProjetos('Projetos em andamento', lista, lista.length);
         } },
    2: { dica: 'Projetos com mês de fim real registrado.',
         abrir: () => {
           const lista = comAtraso.filter((p) => p.status === 'concluido');
           detalharProjetos('Projetos concluídos', lista, lista.length);
         } },
    3: { dica: 'Atraso é derivado: o mês corrente passou do fim planejado sem fim real.',
         abrir: () => {
           const lista = comAtraso.filter((p) => p.atrasado);
           detalharProjetos('Projetos atrasados', lista, lista.length,
             'Atraso é derivado: o mês corrente passou do fim planejado sem fim real.');
         } },
  });

  if (el('#p-gantt-corpo')) {
    const repintar = () => pintarGantt(montarLinhasGantt(comTarefas), meses, larg, iHoje);
    repintar();
    el('#p-gantt').addEventListener('scroll', repintar);
    el('#p-abrir').onclick = () => { gravarComprimidos(new Set()); render(); };
    el('#p-fechar').onclick = () => { gravarComprimidos(new Set(todosOsGrupos)); render(); };
  }

  if (Object.keys(carga).length) {
    ranking(el('#p-carga'), Object.entries(carga).map(([k,c])=>({
        rotulo:k, valor:c.total, apoio:`${c.abertas} em aberto${c.atrasadas ? ` · ${c.atrasadas} atrasadas` : ''}` })),
      (v)=>inteiro(v)+' tarefa(s)', 'var(--s3)',
      (it) => {
        const lista = tarefas.filter((t) => (t.responsavel?.trim() || '(não atribuído)') === it.rotulo);
        detalharTarefas(`Tarefas de ${it.rotulo}`, lista, it.valor);
      });
  }
  el('#pagina').querySelectorAll('tbody tr[data-id]').forEach((tr) => {
    const p = projetos.find((x)=>x.id===tr.dataset.id);
    tr.querySelector('[data-ab]').onclick = () => abrirProjeto(p);
    tr.querySelector('[data-ex]').onclick = () => confirmar({
      titulo:'Excluir projeto', mensagem:`O projeto "${esc(p.nome)}" e suas tarefas serão removidos.`,
      rotulo:'Excluir', exigeJustificativa:true,
      async aoConfirmar(just) {
        const dono = p.empresa || exigirEmpresaUnica();
        const itens = (await Loja.projetosDa(dono)).filter((x)=>x.id!==p.id);
        await Loja.gravarProjetos(dono, itens);
        await Loja.auditar({ acao:'excluir', entidade:'projeto', id:p.id, justificativa:just, antes:{ nome:p.nome } });
        render();
      } });
  });
}

function formProjeto(existente) {
  const dono = (existente && existente.empresa) || exigirEmpresaUnica();
  const fils = filiaisDa(dono), ed = !!existente;
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
          const itens = [...(await Loja.projetosDa(dono))];
          const corpo = { nome, descricao: campo('descricao').value.trim() || null,
            filial: campo('filial').value || null, inicio, fimPlanejado: fimP, fimReal, status };
          if (ed) { const i = itens.findIndex((x)=>x.id===existente.id); itens[i] = { ...itens[i], ...corpo }; }
          else itens.push({ id: novoId(), ...corpo, tarefas: [], envolvidos: [] });
          await Loja.gravarProjetos(dono, itens);
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
        <div class="campo" style="width:210px"><label for="t-pai">Tarefa principal</label>
          <select id="t-pai" name="tpai" aria-describedby="t-pai-ajuda"></select></div>
        <span id="t-pai-ajuda" hidden>Tarefa deste projeto sob a qual esta ficará agrupada. Até 3 níveis.</span>
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
        const emOrdem = tarefasEmOrdem(tarefas);
        // Só pode ser principal quem ainda cabe um nível abaixo; oferecer as
        // demais na lista seria oferecer um erro.
        const candidatas = emOrdem.filter((x) => x.nivel < PROFUNDIDADE_MAXIMA);
        // O seletor guarda o id, não o nome: dois projetos podem ter tarefas
        // homônimas, e escrever o nome à mão erra mais do que acerta.
        const sel = raiz.querySelector('#t-pai');
        const escolhido = sel.value;
        sel.innerHTML = opcoesDePrincipal(candidatas);
        sel.disabled = candidatas.length === 0;
        sel.value = candidatas.some((c) => c.id === escolhido) ? escolhido : '';

        t.innerHTML = tarefas.length === 0 ? '<p class="vazio">Nenhuma tarefa.</p>' : `
          <table><thead><tr><th>Tarefa</th><th>Responsável</th><th>Período</th><th>Situação</th><th></th></tr></thead>
          <tbody>${emOrdem.map((x)=>{ const a = atrasoDe(x.fimPlanejado, x.fimReal, 'x'); return `<tr data-t="${esc(x.id)}">
            <td style="padding-left:${10 + (x.nivel - 1) * 18}px">${x.nivel > 1 ? '<span style="color:var(--tinta3)">↳</span> ' : ''}${esc(x.nome)}${
              x.filhas ? `<span style="color:var(--tinta3);font-size:11.5px"> · ${inteiro(x.filhas)} subtarefa(s)</span>` : ''}</td>
            <td>${esc(x.responsavel||'—')}</td>
            <td style="white-space:nowrap">${mesExib(x.inicio)} → ${mesExib(x.fimReal||x.fimPlanejado)}</td>
            <td>${x.fimReal?'<span class="tag bom">Concluída</span>':a.atrasado?`<span class="tag crit">Atrasada (${a.meses}m)</span>`:'<span class="tag">Pendente</span>'}</td>
            <td style="white-space:nowrap"><button type="button" class="bt fant peq" data-grp>Agrupar</button>
              ${x.fimReal?'':'<button type="button" class="bt fant peq" data-ok>Concluir</button>'}
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
          tr.querySelector('[data-grp]').addEventListener('click', () => {
            // Escolher numa lista, e não digitar o nome: com o nome, errar um
            // acento já devolvia "não existe essa tarefa" para uma tarefa que
            // existe — e com o projeto sem tarefa nenhuma não havia o que
            // digitar, mas o campo pedia mesmo assim.
            const disponiveis = candidatas.filter((c) => c.id !== tar.id);
            abrirModal({
              titulo: `Agrupar "${tar.nome}"`,
              corpo: disponiveis.length === 0
                ? `<p class="vazio" style="text-align:left">Este projeto ainda não tem outra tarefa que possa ser a
                     principal desta. Crie a tarefa que agrupa antes de agrupar esta.</p>`
                : `<div class="campo"><label for="g-pai">Tarefa principal</label>
                     <select id="g-pai">${opcoesDePrincipal(candidatas, tar.paiId || null, tar.id)}</select></div>
                   <p class="nota" style="margin-top:8px">A hierarquia vai até ${PROFUNDIDADE_MAXIMA} níveis.
                     Escolher <strong>nenhuma</strong> desagrupa a tarefa.</p>`,
              acoes: disponiveis.length === 0
                ? `<button type="button" class="bt" data-c>Fechar</button>`
                : `<button type="button" class="bt" data-c>Cancelar</button>
                   <button type="button" class="bt pri" data-ok>Agrupar</button>`,
              aoMontar({ raiz, fechar, erro: erroModal }) {
                raiz.querySelector('[data-c]').onclick = fechar;
                raiz.querySelector('[data-ok]')?.addEventListener('click', async () => {
                  try {
                    tar.paiId = validarPrincipal(tarefas, raiz.querySelector('#g-pai').value || null, tar.id);
                  } catch (e) { return erroModal(e.message); }
                  fechar(); erro(''); await persistir(); pintar();
                });
              },
            });
          });
          tr.querySelector('[data-del]').addEventListener('click', async () => {
            // Bloqueio, não cascata: em cascata um "Remover" apagaria em
            // silêncio a subárvore inteira, que é o oposto da regra de
            // auditoria. Quem quer remover o grupo desagrupa as filhas antes.
            const filhas = tarefas.filter((x) => x.paiId === tar.id);
            if (filhas.length) {
              return erro(`"${tar.nome}" tem ${filhas.length} subtarefa(s) e não pode ser removida: ` +
                filhas.map((f) => `"${f.nome}"`).join(', ') + '. Desagrupe ou remova as subtarefas primeiro.');
            }
            erro('');
            tarefas.splice(tarefas.findIndex((x)=>x.id===tar.id), 1); await persistir(); pintar();
          });
        });
        raiz.querySelectorAll('[data-rmenv]').forEach((b) => b.addEventListener('click', async () => {
          envolvidos.splice(+b.dataset.rmenv, 1); await persistir(); pintar();
        }));
      };
      const persistir = async () => {
        const dono = p.empresa || exigirEmpresaUnica();
        const itens = (await Loja.projetosDa(dono)).map((x)=> x.id===p.id ? { ...x, tarefas, envolvidos } : x);
        await Loja.gravarProjetos(dono, itens);
      };
      raiz.querySelector('[data-c]').onclick = () => { fechar(); render(); };
      raiz.querySelector('[data-edp]').onclick = () => { fechar(); formProjeto(p); };
      raiz.querySelector('[data-formtar]').addEventListener('submit', async (ev) => {
        ev.preventDefault(); erro('');
        const f = ev.target;
        const ini = mesInterno(f.tini.value), fim = mesInterno(f.tfim.value);
        if (!ini || !fim) return erro('Início e fim da tarefa precisam estar em MM/AAAA.');
        if (fim < ini) return erro('O fim planejado da tarefa não pode ser anterior ao início.');
        let paiId = null;
        try { paiId = validarPrincipal(tarefas, f.tpai.value || null, null); }
        catch (e) { return erro(e.message); }
        tarefas.push({ id: novoId(), nome: f.tnome.value.trim(), inicio: ini, fimPlanejado: fim,
          fimReal: null, responsavel: f.tresp.value.trim() || null, paiId });
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
