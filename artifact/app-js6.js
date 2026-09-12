// ===========================================================================
// SLA — registro mensal por fila e tópico, com indicadores derivados
// ===========================================================================
/**
 * `secao` separa as leituras do mesmo recorte: `indicadores` responde "como
 * está o atendimento" e `chamados` responde "quais são os chamados". Filtros e
 * dados são os mesmos — o que muda é o que a tela mostra.
 *
 * `OSTICK` e `BITRIX24` são a MESMA tela de chamados com a origem fixada: os
 * dois helpdesks descrevem a mesma coisa com nomes diferentes, e duplicar a
 * tela por origem só criaria duas cópias para manter em paridade.
 */
async function viewSla(secao = 'indicadores') {
  // A origem fixada pela aba não passa pelo filtro de Sistema: ela É a tela.
  const sistemaFixo = SISTEMAS_SUPORTE[secao] ? secao : null;
  const listaDeChamados = sistemaFixo !== null || secao === 'chamados';
  await Loja.configuracao();
  const carregados = [];
  for (const e of escopoEmpresas()) for (const r of await Loja.slaDa(e)) carregados.push({ ...r, empresa: e });
  const regs = carregados.filter((r) => passaNoFiltro(E.filiaisSel, r.filial || '(empresa)'));
  const comps = [...new Set(regs.map((r) => r.competencia))].sort();
  // O SLA acompanha a competência escolhida no topo, limitada ao que existe aqui.
  const escolhidas = [...E.competencias].filter((c) => comps.includes(c));
  const foco = new Set(escolhidas.length ? escolhidas : comps.slice(-1));
  const comp = ordenado(foco).pop() || mesHoje();
  const doMes = regs.filter((r) => foco.has(r.competencia));
  const periodo = foco.size <= 1 ? mesExib(comp) : `${mesExib(ordenado(foco)[0])} a ${mesExib(comp)}`;

  // Um chamado é um registro com total=1: a agregação vale para os dois casos,
  // o lote importado do osTicket e o total digitado à mão.
  const f = E.filtrosSla;
  const aberto = (r) => r.status && !/resolvid|fechad/i.test(r.status);
  const filtrado = doMes.filter((r) => {
    if (!passaNoFiltro(f.filas, r.fila)) return false;
    if (!passaNoFiltro(f.status, r.status || '(sem status)')) return false;
    if (!passaNoFiltro(f.niveis, r.nivel || '(sem nível)')) return false;
    if (sistemaFixo ? sistemaDe(r) !== sistemaFixo : !passaNoFiltro(f.sistemas, sistemaDe(r))) return false;
    if (!passaNoFiltro(f.setores, setorDe(r))) return false;
    if (f.sla.size && !f.sla.has(r.dentro >= (r.total || 1) ? 'dentro' : 'fora')) return false;
    if (f.busca) {
      const alvo = [r.assunto, r.descricao, r.solicitante, r.atendente, r.topico, setorDe(r), r.numero, r.ticketId]
        .join(' ').toLowerCase();
      if (!alvo.includes(f.busca.toLowerCase())) return false;
    }
    return true;
  });

  const T = filtrado.reduce((s, r) => s + (r.total || 0), 0);
  const D = filtrado.reduce((s, r) => s + (r.dentro || 0), 0);
  const emAberto = filtrado.filter(aberto).length;
  const comHoras = filtrado.filter((r) => typeof r.horas === 'number');
  const medianaHoras = comHoras.length
    ? comHoras.map((r) => r.horas).sort((a, b) => a - b)[Math.floor(comHoras.length / 2)] : null;

  // Chamado sem filial é do nível empresa — dizer "(sem)" esconde o que é.
  const VAZIO = { filial:'Sem filial (empresa)', topico:'(sem tópico)', fila:'(sem fila)',
    status:'(sem status)', nivel:'(sem nível)' };
  const agrupar = (chave) => {
    const m = {};
    for (const r of filtrado) { const k = r[chave] || VAZIO[chave] || '(sem)'; m[k] = m[k] || { t:0, d:0 }; m[k].t += r.total||0; m[k].d += r.dentro||0; }
    return Object.entries(m).map(([k, v]) => ({ nome:k, total:v.t, dentro:v.d, fora:v.t-v.d, pct:pct(v.d, v.t) }))
      .sort((a, b) => b.total - a.total);
  };
  const porFila = agrupar('fila'), porTopico = agrupar('topico'), porFilial = agrupar('filial');
  const tendencia = comps.map((c) => {
    const dd = regs.filter((r) => r.competencia === c);
    const t = dd.reduce((s, r) => s + (r.total||0), 0), d = dd.reduce((s, r) => s + (r.dentro||0), 0);
    return { rot: mesCurto(c), v: { p: pct(d, t) } };
  });

  const chamados = filtrado.filter((r) => r.ticketId).sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
  // O registro agregado do mês — o total digitado à mão — não é um chamado, e
  // some da tela se as duas listas disputarem o mesmo lugar. São duas leituras
  // distintas do mesmo recorte, e as duas pertencem a esta tela.
  const agregados = filtrado.filter((r) => !r.ticketId);
  const TETO = 300;
  const hora = (t) => (t ? new Date(t).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' }) : '—');
  const itensDe = (chave, rotulo) => [...new Set(doMes.map((r) => r[chave] || rotulo))].sort()
    .map((v) => ({ valor: v, rotulo: v }));


  el('#pagina').innerHTML = `
    <div class="filtros">
      <div class="campo" style="width:180px"><label for="s-comp">Competência</label><div data-sel="scomp"></div></div>
      <div class="campo" style="width:150px"><label for="s-fila">Fila</label><div data-sel="sfila"></div></div>
      <div class="campo" style="width:140px"><label for="s-status">Status</label><div data-sel="sstatus"></div></div>
      <div class="campo" style="width:130px"><label for="s-nivel">Nível</label><div data-sel="snivel"></div></div>
      ${sistemaFixo ? '' : '<div class="campo" style="width:160px"><label for="s-sistema">Sistema</label><div data-sel="ssistema"></div></div>'}
      <div class="campo" style="width:160px"><label for="s-setor">Setor / área</label><div data-sel="ssetor"></div></div>
      <div class="campo" style="width:130px"><label for="s-sla">SLA</label><div data-sel="ssla"></div></div>
      <div class="campo" style="flex:1 1 150px"><label for="s-busca">Buscar</label>
        <input id="s-busca" placeholder="assunto, solicitante, nº…" value="${esc(f.busca)}"></div>
      <button class="bt pri" id="s-novo">Registrar tickets do mês</button>
    </div>
    <div class="fichas" id="s-fichas" hidden></div>
    ${regs.length === 0 ? `<section class="bloco"><p class="vazio">
        Nenhum ticket registrado nesta empresa. Use <strong>Registrar tickets do mês</strong> para lançar
        o total atendido, ou importe a base do osTicket pela aba <strong>Dados</strong>.</p></section>` : `
    ${listaDeChamados ? '' : `
    <div class="kpis">
      <div class="kpi"><span class="r">Tickets atendidos</span><span class="n">${inteiro(T)}</span>
        <span class="a">${esc(periodo)}</span></div>
      <div class="kpi"><span class="r">Dentro do SLA</span><span class="n">${pctTxt(pct(D, T))}</span>
        <span class="a">${inteiro(D)} de ${inteiro(T)}</span></div>
      <div class="kpi"><span class="r">Fora do SLA</span><span class="n">${pctTxt(pct(T-D, T))}</span>
        <span class="a">${inteiro(T-D)} tickets</span></div>
      ${medianaHoras === null
        ? `<div class="kpi"><span class="r">Filas monitoradas</span><span class="n">${inteiro(porFila.length)}</span>
             <span class="a">${esc(porFila.map((x)=>x.nome).join(' · '))}</span></div>`
        : `<div class="kpi"><span class="r">Mediana de atendimento</span><span class="n">${medianaHoras.toLocaleString('pt-BR',{maximumFractionDigits:1})} h</span>
             <span class="a">${emAberto ? inteiro(emAberto) + ' ainda em aberto' : 'todos encerrados'}</span></div>`}
    </div>
    <div class="grade g2">
      <section class="bloco"><header><h2>Desempenho por fila</h2><span class="nota">${esc(periodo)}</span></header>
        <div class="leg"><span><i style="background:var(--bom)"></i>Dentro do SLA</span><span><i style="background:var(--crit)"></i>Fora do SLA</span></div>
        <div id="s-g1"></div></section>
      <section class="bloco"><header><h2>Tendência de conformidade</h2><span class="nota">% dentro do SLA</span></header>
        <div id="s-g2"></div></section>
    </div>
    <div class="grade g2">
      <section class="bloco"><header><h2>Por tópico de ajuda</h2></header><div class="rank" id="s-r1"></div></section>
      <section class="bloco"><header><h2>Por filial</h2></header>
        <div class="rol"><table><thead><tr><th>Filial</th><th class="n">Atendidos</th><th class="n">Dentro</th><th class="n">Fora</th><th class="n">% no SLA</th></tr></thead>
        <tbody>${porFilial.map((x)=>`<tr data-sfilial="${esc(x.nome)}"><td>${esc(x.nome)}</td><td class="n">${inteiro(x.total)}</td>
          <td class="n">${inteiro(x.dentro)}</td><td class="n">${inteiro(x.fora)}</td>
          <td class="n"><span class="tag ${x.pct>=90?'bom':x.pct>=75?'alerta':'crit'}">${pctTxt(x.pct)}</span></td></tr>`).join('')}
        </tbody></table></div></section>
    </div>`}

    ${!listaDeChamados ? '' : chamados.length ? `
    ${!sistemaFixo ? '' : `
    <div class="kpis">
      <div class="kpi"><span class="r">Chamados no recorte</span><span class="n">${inteiro(chamados.length)}</span>
        <span class="a">${esc(periodo)}</span></div>
      <div class="kpi"><span class="r">Em aberto</span><span class="n">${inteiro(emAberto)}</span>
        <span class="a">${inteiro(chamados.length - emAberto)} encerrados</span></div>
      <div class="kpi"><span class="r">Dentro do SLA</span><span class="n">${pctTxt(pct(D, T))}</span>
        <span class="a">${inteiro(D)} de ${inteiro(T)}</span></div>
    </div>`}
    <section class="bloco" id="s-chamados">
      <header><h2>${esc(sistemaFixo ? SISTEMAS_SUPORTE[sistemaFixo] : 'Chamados')}</h2><span class="nota">${inteiro(chamados.length)} no recorte${chamados.length > TETO ? ` · exibindo os ${TETO} mais recentes` : ''}</span></header>
      <div class="rol"><table>
        <thead><tr><th>Chamado</th><th>Sistema</th><th>Aberto em</th><th>Setor / área</th><th>Filial</th>
          <th>Fila</th><th>Tópico</th><th>Assunto</th><th>Solicitante</th><th>Responsável</th><th>Status</th>
          <th class="n">Horas</th><th>SLA</th></tr></thead>
        <tbody>${chamados.slice(0, TETO).map((r) => {
          const url = urlDoRegistro(r);
          const ok = (r.dentro || 0) >= (r.total || 1);
          return `<tr>
            <td style="white-space:nowrap">${(() => {
              // O número se lê igual com ou sem link: sem base configurada para
              // a origem não há para onde levar, mas o chamado continua sendo
              // o mesmo "#222".
              const n = r.numero || r.ticketId;
              if (!n) return '—';
              return url
                ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">#${esc(n)}</a>`
                : '#' + esc(n);
            })()}</td>
            <td style="white-space:nowrap">${esc(SISTEMAS_SUPORTE[sistemaDe(r)])}</td>
            <td style="white-space:nowrap">${esc(hora(r.criadoEm))}</td>
            <td>${esc(setorDe(r))}</td>
            <td>${r.filial ? esc(r.filial) : '<em style="color:var(--tinta3)">empresa</em>'}</td>
            <td>${esc(r.fila || '—')}</td>
            <td style="max-width:170px">${esc(r.topico || '—')}</td>
            <td style="max-width:240px">${esc(r.assunto || '—')}</td>
            <td style="max-width:140px">${esc(r.solicitante || '—')}</td>
            <td>${esc(r.atendente || '—')}${r.nivel ? `<div style="color:var(--tinta3);font-size:12px">${esc(r.nivel)}</div>` : ''}</td>
            <td><span class="tag${aberto(r) ? ' alerta' : ''}">${esc(r.status || '—')}</span></td>
            <td class="n">${r.horas === null || r.horas === undefined ? '—' : r.horas.toLocaleString('pt-BR',{maximumFractionDigits:1})}</td>
            <td><span class="tag ${ok ? 'bom' : 'crit'}">${ok ? 'Dentro' : 'Fora'}</span></td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="nota" style="margin-top:10px">O número do chamado abre o registro no osTicket.
        O prazo é a criação mais 48 h do Padrão SLA; chamado ainda aberto é medido contra a data da extração.</p>
    </section>` : `
    <section class="bloco" id="s-chamados"><p class="vazio">
      ${sistemaFixo
        ? `Nenhum chamado do <strong>${esc(SISTEMAS_SUPORTE[sistemaFixo])}</strong> no recorte atual.
           ${sistemaFixo === 'BITRIX24'
             ? 'Os chamados do Bitrix24 entram pela planilha padrão, na aba <strong>Dados</strong>.'
             : 'Amplie a competência no topo, ou importe a base pela aba <strong>Dados</strong>.'}`
        : 'Nenhum chamado importado no recorte atual.'}
    </p></section>`}
    ${sistemaFixo || agregados.length === 0 ? '' : `
    <section class="bloco"><header><h2>Registros de ${esc(periodo)}</h2>
      <span class="nota">totais digitados à mão, fora dos chamados importados</span></header>
      <div class="rol"><table><thead><tr><th>Filial</th><th>Fila</th><th>Tópico</th>
        <th class="n">Atendidos</th><th class="n">Dentro</th><th class="n">Fora</th><th class="n">%</th><th></th></tr></thead>
      <tbody>${agregados.map((r)=>`<tr data-sid="${esc(r.id)}">
        <td>${r.filial?esc(r.filial):'<em style="color:var(--tinta3)">empresa</em>'}</td>
        <td>${esc(r.fila)}</td><td>${esc(r.topico||'—')}</td>
        <td class="n">${inteiro(r.total)}</td><td class="n">${inteiro(r.dentro)}</td><td class="n">${inteiro(r.total-r.dentro)}</td>
        <td class="n">${pctTxt(pct(r.dentro,r.total))}</td>
        <td style="white-space:nowrap"><button class="bt fant peq" data-sed>Editar</button>
          <button class="bt fant peq" data-sdel>Excluir</button></td></tr>`).join('')}</tbody></table></div></section>`}`}`;

  const itensSComp = comps.map((c) => ({ valor: c, rotulo: mesExib(c) }));
  const grupos = [
    { chave:'scomp', id:'s-comp', rotulo:'Competência', itens:itensSComp, minimo:1,
      get sel() { return foco; }, aplicar:(n) => { E.competencias = n; } },
    { chave:'sfila', id:'s-fila', rotulo:'Fila', itens:itensDe('fila', '(sem fila)'),
      get sel() { return f.filas; }, aplicar:(n) => { f.filas = n; } },
    { chave:'sstatus', id:'s-status', rotulo:'Status', itens:itensDe('status', '(sem status)'),
      get sel() { return f.status; }, aplicar:(n) => { f.status = n; } },
    { chave:'snivel', id:'s-nivel', rotulo:'Nível', itens:itensDe('nivel', '(sem nível)'),
      get sel() { return f.niveis; }, aplicar:(n) => { f.niveis = n; } },
    { chave:'ssistema', id:'s-sistema', rotulo:'Sistema',
      itens:[...new Set(doMes.map(sistemaDe))].sort().map((v) => ({ valor:v, rotulo:SISTEMAS_SUPORTE[v] })),
      get sel() { return f.sistemas; }, aplicar:(n) => { f.sistemas = n; } },
    { chave:'ssetor', id:'s-setor', rotulo:'Setor / área',
      itens:[...new Set(doMes.map(setorDe))].sort().map((v) => ({ valor:v, rotulo:v })),
      get sel() { return f.setores; }, aplicar:(n) => { f.setores = n; } },
    { chave:'ssla', id:'s-sla', rotulo:'SLA',
      itens:[{ valor:'dentro', rotulo:'Dentro do SLA' }, { valor:'fora', rotulo:'Fora do SLA' }],
      get sel() { return f.sla; }, aplicar:(n) => { f.sla = n; } },
    // A aba que fixa o sistema não desenha o seletor dele: sem tirá-lo daqui,
    // a montagem procuraria um campo que não existe na tela.
  ].filter((g) => !(sistemaFixo && g.chave === 'ssistema'));
  if (comps.length) {
    for (const g of grupos) {
      seletorMulti(el(`[data-sel="${g.chave}"]`), {
        id: g.id, rotulo: g.rotulo, itens: g.itens, selecionados: g.sel, minimo: g.minimo || 0,
        aoMudar: (novo) => { g.aplicar(novo); render(); },
      });
    }
    pintarFichas(el('#s-fichas'), grupos.map((g) => ({
      chave: g.chave, rotulo: g.rotulo, itens: g.itens, selecionados: g.sel, minimo: g.minimo || 0,
      ocultarSeTudo: !g.minimo, total: g.itens.length,
      aoMudar: (n) => { g.aplicar(n); render(); },
    })));
  } else {
    el('[data-sel="scomp"]').innerHTML = '<span class="nota">sem registros</span>';
  }
  el('#s-busca').addEventListener('change', () => { f.busca = el('#s-busca').value; render(); });
  el('#s-novo').onclick = () => formSla(comp || mesHoje());

  // Os gráficos só existem na tela de indicadores; a tabela de registros, na
  // de chamados. Cada bloco é ligado onde o seu destino está montado.
  if (regs.length && secao === 'indicadores') {
    // Cada gráfico abre os chamados que formaram a barra, pelo mesmo recorte.
    barras(el('#s-g1'), porFila.map((x)=>({ rot:x.nome, v:{ d:x.dentro, f:x.fora } })),
      [{k:'d',nome:'Dentro do SLA',cor:'var(--bom)'},{k:'f',nome:'Fora do SLA',cor:'var(--crit)'}], 'empilhado', inteiro, inteiro,
      (p) => {
        const lista = filtrado.filter((r) => r.fila === p.rot);
        detalharChamados(`Fila ${p.rot} — ${periodo}`, lista, lista.reduce((s, r) => s + (r.total || 0), 0));
      });

    linhas(el('#s-g2'), tendencia, [{k:'p',nome:'% dentro do SLA',cor:'var(--s1)'}], pctTxt, (v)=>String(Math.round(v)), '%',
      (p) => {
        // A tendência percorre as competências com registro, não só as em foco.
        const comp = comps[comps.length - tendencia.length + tendencia.indexOf(p)];
        const lista = regs.filter((r) => r.competencia === comp);
        detalharChamados(`Conformidade de ${mesExib(comp)}`, lista, lista.reduce((s, r) => s + (r.total || 0), 0));
      });

    ranking(el('#s-r1'), porTopico.slice(0, 14).map((t)=>({ rotulo:t.nome+' — '+pctTxt(t.pct)+' no SLA', valor:t.total, topico:t.nome })),
      (v)=>inteiro(v)+' tickets', 'var(--s3)',
      (it) => {
        const lista = filtrado.filter((r) => (r.topico || '(sem tópico)') === it.topico);
        detalharChamados(`Tópico ${it.topico} — ${periodo}`, lista, it.valor);
      });

    // A tabela por filial também abre o detalhe de cada linha.
    el('#pagina').querySelectorAll('tr[data-sfilial]').forEach((tr) => {
      const nome = tr.dataset.sfilial;
      comDrill(tr, nome, () => {
        const lista = filtrado.filter((r) => (r.filial || VAZIO.filial) === nome);
        detalharChamados(`Filial ${nome} — ${periodo}`, lista, lista.reduce((s, r) => s + (r.total || 0), 0));
      });
    });

    ligarKpis({
      0: { dica: 'Chamados com registro na competência em foco.',
           abrir: () => detalharChamados(`Chamados de ${periodo}`, filtrado, T) },
      1: { dica: 'Chamados atendidos dentro do prazo acordado.',
           abrir: () => {
             const lista = filtrado.filter((r) => (r.dentro || 0) >= (r.total || 1));
             detalharChamados(`Dentro do SLA — ${periodo}`, lista, D);
           } },
      2: { dica: 'Chamados que ultrapassaram o prazo acordado.',
           abrir: () => {
             const lista = filtrado.filter((r) => (r.dentro || 0) < (r.total || 1));
             detalharChamados(`Fora do SLA — ${periodo}`, lista, T - D);
           } },
      // O quarto indicador muda com a base: contagem de filas (um cadastro) ou
      // mediana de horas. Nenhum dos dois é a soma de registros, então ganham
      // o tooltip mas não o detalhamento.
      3: { dica: medianaHoras === null
             ? 'Filas com atendimento registrado na competência.'
             : 'Tempo mediano entre a abertura e o encerramento do chamado.' },
    });
  }

  // A aba por sistema tem indicadores próprios, do recorte já fixado nela.
  if (sistemaFixo && chamados.length) {
    const nome = SISTEMAS_SUPORTE[sistemaFixo];
    ligarKpis({
      0: { dica: 'Todos os chamados que atendem aos filtros acima, e não só os exibidos na tabela.',
           abrir: () => detalharChamados(`${nome} — ${periodo}`, chamados, chamados.length) },
      1: { dica: 'Chamados ainda sem encerramento.',
           // Sem chamado em aberto não há o que abrir, e um detalhamento vazio
           // só faria duvidar do número.
           abrir: emAberto ? () => {
             const lista = chamados.filter(aberto);
             detalharChamados(`${nome} — em aberto`, lista, emAberto);
           } : null },
      2: { dica: 'Chamados atendidos dentro do prazo, sobre o total do recorte.',
           abrir: D ? () => {
             const lista = chamados.filter((r) => (r.dentro || 0) >= (r.total || 1));
             detalharChamados(`${nome} — dentro do SLA`, lista, D);
           } : null },
    });
  }

  if (regs.length) {
    el('#pagina').querySelectorAll('tr[data-sid]').forEach((tr) => {
      tr.querySelector('[data-sed]').onclick = () => {
        const reg = regs.find((r) => String(r.id) === tr.dataset.sid);
        if (reg) formSla(reg.competencia, reg);
      };
      tr.querySelector('[data-sdel]').onclick = () => confirmar({
        titulo:'Excluir registro de SLA', mensagem:'O registro será removido e a exclusão fica na auditoria.',
        rotulo:'Excluir', exigeJustificativa:true,
        async aoConfirmar(just) {
          // A exclusão manual vale para o registro digitado; chamado importado
          // some com a reimportação da base, não linha a linha.
          const dono = empresaAtiva();
          if (!dono) throw new Error('Deixe uma só empresa marcada para excluir.');
          const restantes = (await Loja.slaDa(dono)).filter((r) => r.competencia === comp && r.id !== tr.dataset.sid)
            .map(({ competencia, empresa, ...r }) => r);
          await Loja.gravarSlaMes(dono, comp, restantes);
          await Loja.auditar({ acao:'excluir', entidade:'ticket_sla', id:tr.dataset.sid, justificativa:just }, dono);
          render();
        } });
    });
  }
}

/**
 * `existente` edita um registro já gravado. Editar segue a empresa do próprio
 * registro; criar escolhe aqui dentro, e não pelo filtro do topo — o filtro é
 * o recorte que o gestor está olhando, e não deveria decidir se ele registra.
 */
function formSla(comp, existente) {
  const ed = !!existente;
  let dono = ed ? existente.empresa : (empresaAtiva() || escopoEmpresas()[0] || E.empresas[0]?.id);
  if (!dono) throw new Error('Cadastre uma empresa antes de registrar tickets.');
  const v = existente || { filial: null, fila: null, topico: '', total: '', dentro: '' };
  abrirModal({
    titulo: ed ? 'Editar registro de SLA' : 'Registrar tickets do mês',
    corpo: `
      ${ed ? '' : `
      <div class="campo"><label for="k-empresa">Empresa</label><select id="k-empresa" name="empresa">
        ${E.empresas.map((e)=>`<option value="${esc(e.id)}"${e.id===dono?' selected':''}>${esc(e.nome)}</option>`).join('')}
      </select></div>`}
      <div class="grade g3">
        <div class="campo"><label for="k-fil">Filial</label><select id="k-fil" name="filial"></select></div>
        <div class="campo"><label for="k-comp">Competência (MM/AAAA)</label><input id="k-comp" name="comp" value="${mesExib(ed ? existente.competencia : comp)}"></div>
        <div class="campo"><label for="k-fila">Fila</label><select id="k-fila" name="fila"></select></div>
      </div>
      <div class="grade g3">
        <div class="campo"><label for="k-top">Tópico de ajuda</label><input id="k-top" name="topico" value="${esc(v.topico||'')}" placeholder="opcional — cadastro livre"></div>
        <div class="campo"><label for="k-tot">Total atendidos</label><input id="k-tot" name="total" type="number" min="0" value="${v.total===''?'':inteiro(v.total)}"></div>
        <div class="campo"><label for="k-den">Dentro do SLA</label><input id="k-den" name="dentro" type="number" min="0" value="${v.dentro===''?'':inteiro(v.dentro)}"></div>
      </div>
      <div class="msg" data-calc>Fora do SLA calculado: <strong>—</strong></div>`,
    acoes:`<button type="button" class="bt" data-c>Cancelar</button><button type="button" class="bt pri" data-s>${ed?'Salvar alterações':'Salvar registro'}</button>`,
    aoMontar({ raiz, fechar, erro, campo }) {
      // Filial e fila são cadastros de cada empresa: trocar a empresa repinta
      // os dois, ou o formulário ofereceria a fila de uma para o registro de outra.
      const pintarDaEmpresa = () => {
        raiz.querySelector('#k-fil').innerHTML = '<option value="">— empresa —</option>'
          + filiaisDa(dono).map((f) => `<option${f.nome === v.filial ? ' selected' : ''}>${esc(f.nome)}</option>`).join('');
        raiz.querySelector('#k-fila').innerHTML =
          filasDa(dono).map((f) => `<option${f.nome === v.fila ? ' selected' : ''}>${esc(f.nome)}</option>`).join('');
      };
      pintarDaEmpresa();
      raiz.querySelector('#k-empresa')?.addEventListener('change', (ev) => { dono = ev.target.value; pintarDaEmpresa(); });

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
          checarCompetencia(c, 'registro de SLA', dono);
          // Mudar a competência de um registro é tirá-lo de um mês e pô-lo em
          // outro: os dois meses precisam estar abertos.
          if (ed && c !== existente.competencia) checarCompetencia(existente.competencia, 'registro de SLA', dono);

          const dados = { filial: campo('filial').value || null, fila: campo('fila').value,
            topico: campo('topico').value.trim() || null, total, dentro };
          const doMes = (comp) => (todos) => todos.filter((r) => r.competencia === comp)
            .map(({ competencia, empresa, ...r }) => r);
          const todos = await Loja.slaDa(dono);

          if (ed && c !== existente.competencia) {
            // Sai do mês antigo e entra no novo, em duas gravações: cada mês é
            // um documento próprio no armazenamento.
            await Loja.gravarSlaMes(dono, existente.competencia,
              doMes(existente.competencia)(todos).filter((r) => r.id !== existente.id));
            await Loja.gravarSlaMes(dono, c, [...doMes(c)(todos), { id: existente.id, ...dados }]);
          } else if (ed) {
            await Loja.gravarSlaMes(dono, c,
              doMes(c)(todos).map((r) => (r.id === existente.id ? { id: r.id, ...dados } : r)));
          } else {
            await Loja.gravarSlaMes(dono, c, [...doMes(c)(todos), { id: novoId(), ...dados }]);
          }

          await Loja.auditar({
            acao: ed ? 'atualizar' : 'criar', entidade: 'ticket_sla', id: ed ? existente.id : undefined,
            antes: ed ? { competencia: mesExib(existente.competencia), total: existente.total, dentro: existente.dentro } : undefined,
            depois: { competencia: mesExib(c), total, dentro },
          }, dono);
          E.competencias = new Set([c]); fechar(); render();
        } catch (e) { erro(e.message); ev.target.disabled = false; }
      };
    },
  });
}

// ===========================================================================
// Cadastros, fechamento e auditoria
// ===========================================================================
async function viewCadastros() {
  await Loja.configuracao();
  const emp = empresaAtiva();
  if (!emp) {
    el('#pagina').innerHTML = `<div class="msg alerta"><strong>Cadastros são de uma empresa por vez.</strong>
      Há ${inteiro(E.empresasSel.size)} empresas selecionadas — filiais, tipos, filas e cenários pertencem a
      cada uma, e o fechamento de competência também. Deixe uma só marcada no seletor <strong>Empresa</strong>.</div>`;
    return;
  }
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
    <section class="bloco"><header><h2>Endereço do osTicket</h2></header>
      <div class="msg">O número do chamado, na aba SLA, vira link para o sistema de origem. O id interno entra no
        fim do endereço — <code>tickets.php?id=<strong>21734</strong></code>.</div>
      <div class="filtros" style="margin-top:12px;box-shadow:none;border:0;padding:0">
        <div class="campo" style="flex:1 1 340px"><label for="cfg-url">Base do endereço</label>
          <input id="cfg-url" value="${esc((E.config && E.config.urlOsTicket) || URL_OSTICKET_PADRAO)}"></div>
        <button class="bt" id="cfg-salvar">Salvar</button>
      </div>
      <div class="msg" id="cfg-ok" hidden style="margin-top:10px"></div>
    </section>

    <section class="bloco"><header><h2>Fechamento de competência</h2></header>
      <div class="msg">Uma competência fechada não aceita novo lançamento nem alteração. Reabrir exige justificativa,
        e tudo fica na trilha de auditoria.</div>
      <div class="filtros" style="margin-top:12px;box-shadow:none;border:0;padding:0">
        <div class="campo" style="width:120px"><label for="fc-comp">Competência</label>
          <input id="fc-comp" value="${mesExib(ordenado(E.competencias).pop() || mesHoje())}"></div>
        <button class="bt pri" id="fc-fechar">Fechar competência</button>
      </div>
      <div class="msg erro" id="fc-erro" hidden style="margin-top:10px"></div>
      ${fechadas.length===0 ? '<p class="vazio">Nenhuma competência fechada.</p>' : `
      <div class="rol" style="margin-top:10px"><table><thead><tr><th>Competência</th><th>Fechada em</th><th></th></tr></thead>
        <tbody>${fechadas.map((f)=>`<tr data-fc="${esc(compDoFechamento(f))}">
          <td><span class="tag alerta">${mesExib(compDoFechamento(f))}</span></td>
          <td>${f.quando?new Date(f.quando).toLocaleString('pt-BR'):'—'}</td>
          <td><button class="bt fant peq" data-reabrir>Reabrir</button></td></tr>`).join('')}</tbody></table></div>`}
    </section>`;

  el('#pagina').querySelectorAll('[data-novo]').forEach((b) => b.onclick = () => formCadastro(b.dataset.novo));
  el('#cfg-salvar').onclick = async () => {
    const base = el('#cfg-url').value.trim();
    const aviso = el('#cfg-ok');
    if (!/^https?:\/\//i.test(base)) {
      aviso.hidden = false; aviso.className = 'msg erro';
      aviso.textContent = 'O endereço precisa começar com http:// ou https://.';
      return;
    }
    await Loja.gravarConfiguracao({ urlOsTicket: base });
    await Loja.auditar({ acao:'atualizar', entidade:'configuracao', depois:{ urlOsTicket: base } }, emp);
    aviso.hidden = false; aviso.className = 'msg bom';
    aviso.textContent = 'Endereço salvo. Exemplo: ' + base + '21734';
  };
  // alert() pode ser engolido pelo sandbox do visualizador: a recusa iria para
  // o nada e o botão pareceria quebrado. A mensagem fica na própria página.
  const avisar = (texto) => { const b = el('#fc-erro'); b.textContent = texto || ''; b.hidden = !texto; };
  el('#fc-fechar').onclick = async () => {
    avisar('');
    const c = mesInterno(el('#fc-comp').value);
    if (!c) return avisar('Competência inválida: use MM/AAAA.');
    if (c > mesHoje()) return avisar('Não é possível fechar uma competência futura — só meses já encerrados.');
    const atuais = await Loja.fechamentosDa(emp);
    if (atuais.some((f)=>compDoFechamento(f)===c)) return avisar('A competência ' + mesExib(c) + ' já está fechada.');
    await Loja.gravarFechamentos(emp, [...atuais, { comp:c, quando:new Date().toISOString() }]);
    await Loja.auditar({ acao:'fechar', entidade:'fechamento', depois:{ competencia: mesExib(c) } });
    render();
  };
  el('#pagina').querySelectorAll('tr[data-fc]').forEach((tr) => {
    tr.querySelector('[data-reabrir]').onclick = () => confirmar({
      titulo:'Reabrir competência', mensagem:`A competência ${mesExib(tr.dataset.fc)} voltará a aceitar alterações.`,
      rotulo:'Reabrir', exigeJustificativa:true,
      async aoConfirmar(just) {
        const atuais = (await Loja.fechamentosDa(emp)).filter((f)=>compDoFechamento(f)!==tr.dataset.fc);
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
          const emp = exigirEmpresaUnica();
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
            await Loja.gravarCatalogo('cenarios', [...E.cenariosSel, { empresa:emp, chave, nome, descricao: campo('desc').value.trim() || null }]);
          }
          await Loja.auditar({ acao:'criar', entidade:tipo, depois:{ nome } });
          fechar(); render();
        } catch (e) { erro(e.message); ev.target.disabled = false; }
      };
    },
  });
}

async function viewAuditoria() {
  const itens = [];
  for (const e of escopoEmpresas()) {
    const s = await E.db.doc('auditoria/' + e).get();
    for (const a of (s.exists ? (s.data().itens || []) : [])) itens.push({ ...a, empresa: e });
  }
  itens.sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
  el('#pagina').innerHTML = `
    <div class="msg">Nenhuma alteração relevante ocorre sem trilha: quem, quando e o quê. Registros mais recentes primeiro.</div>
    <section class="bloco"><header><h2>Trilha de auditoria</h2><span class="nota">${inteiro(itens.length)} eventos</span></header>
      ${itens.length===0 ? '<p class="vazio">Nenhum evento registrado nesta empresa ainda.</p>' : `
      <div class="rol"><table><thead><tr><th>Quando</th>${E.empresasSel.size>1?'<th>Empresa</th>':''}<th>Entidade</th><th>Ação</th><th>Justificativa</th><th>Alteração</th></tr></thead>
      <tbody>${itens.slice(0,250).map((a)=>`<tr>
        <td style="white-space:nowrap">${new Date(a.quando).toLocaleString('pt-BR')}</td>
        ${E.empresasSel.size>1?`<td>${esc(nomeEmpresa(a.empresa))}</td>`:''}
        <td>${esc(a.entidade||'')}</td>
        <td><span class="tag ${a.acao==='excluir'?'crit':a.acao==='criar'?'bom':''}">${esc(a.acao)}</span></td>
        <td style="max-width:220px">${esc(a.justificativa||'—')}</td>
        <td style="max-width:340px;font-size:12px">${esc(JSON.stringify(a.depois||a.antes||{}))}</td></tr>`).join('')}
      </tbody></table></div>`}</section>`;
}
