// ===========================================================================
// Lançamentos — a tela onde o gestor efetivamente opera
// ===========================================================================
function lancFiltrados() {
  const f = E.filtros;
  return Loja.todos(E.empresa).filter((l) => {
    if (E.cenario !== 'todos' && l.cenario !== E.cenario) return false;
    if (!noEscopo(l)) return false;
    if (f.tipo && l.tipo !== f.tipo) return false;
    if (f.natureza && l.natureza !== f.natureza) return false;
    if (f.classificacao && l.classificacao !== f.classificacao) return false;
    if (f.de && l.competencia < f.de) return false;
    if (f.ate && l.competencia > f.ate) return false;
    if (f.busca) {
      const alvo = (l.descricao||'') + ' ' + (l.obs||'') + ' ' + l.tipo + ' ' + (l.filial||'');
      if (!alvo.toLowerCase().includes(f.busca.toLowerCase())) return false;
    }
    return true;
  }).sort((a,b) => b.competencia.localeCompare(a.competencia) || a.tipo.localeCompare(b.tipo));
}

function viewLancamentos() {
  const lista = lancFiltrados();
  const mostrados = lista.slice(0, 400);
  const total = reais(somaC(lista.map((l)=>l.valor)));
  const tipos = tiposDa(E.empresa);
  const f = E.filtros;

  el('#pagina').innerHTML = `
    <div class="filtros">
      <div class="campo" style="width:108px"><label for="l-de">De (MM/AAAA)</label><input id="l-de" placeholder="01/2026" value="${f.de?mesExib(f.de):''}"></div>
      <div class="campo" style="width:108px"><label for="l-ate">Até (MM/AAAA)</label><input id="l-ate" placeholder="12/2027" value="${f.ate?mesExib(f.ate):''}"></div>
      <div class="campo" style="width:180px"><label for="l-tipo">Tipo de despesa</label><select id="l-tipo">
        <option value="">Todos</option>${tipos.map((t)=>`<option${t.nome===f.tipo?' selected':''}>${esc(t.nome)}</option>`).join('')}</select></div>
      <div class="campo" style="width:150px"><label for="l-nat">Natureza</label><select id="l-nat">
        <option value="">Todas</option>${Object.entries(NATUREZAS).map(([k,v])=>`<option value="${k}"${k===f.natureza?' selected':''}>${v}</option>`).join('')}</select></div>
      <div class="campo" style="width:140px"><label for="l-cls">Classificação</label><select id="l-cls">
        <option value="">Todas</option>
        <option value="despesa"${f.classificacao==='despesa'?' selected':''}>Despesa</option>
        <option value="investimento"${f.classificacao==='investimento'?' selected':''}>Investimento</option></select></div>
      <div class="campo" style="width:150px"><label for="l-cen">Cenário</label><select id="l-cen">
        ${cenariosDa(E.empresa).map((c)=>`<option value="${esc(c.chave)}"${c.chave===E.cenario?' selected':''}>${esc(c.nome)}</option>`).join('')}
        <option value="todos"${E.cenario==='todos'?' selected':''}>Todos os cenários</option></select></div>
      <div class="campo" style="flex:1 1 160px"><label for="l-busca">Buscar</label><input id="l-busca" placeholder="fornecedor, motivo…" value="${esc(f.busca)}"></div>
      <button class="bt pri" id="l-novo">Novo lançamento</button>
    </div>

    <section class="bloco">
      <header><h2>Lançamentos</h2>
        <span class="nota">${inteiro(lista.length)} registros · ${brl(total)}${lista.length>400?' · exibindo os 400 mais recentes':''}</span></header>
      ${mostrados.length === 0 ? '<p class="vazio">Nenhum lançamento com estes filtros.</p>' : `
      <div class="rol"><table>
        <thead><tr><th>Competência</th><th>Filial</th><th>Tipo</th><th>Descrição</th>
          <th>Origem</th><th>Natureza</th><th>Classificação</th><th class="n">Valor</th><th></th></tr></thead>
        <tbody>${mostrados.map((l) => `<tr data-id="${esc(l.id)}" data-comp="${l.competencia}">
          <td>${mesExib(l.competencia)}</td>
          <td>${l.filial ? esc(l.filial) : '<em style="color:var(--tinta3)">empresa</em>'}</td>
          <td>${esc(l.tipo)}</td>
          <td style="max-width:280px">${esc(l.descricao||'')}
            ${l.obs?`<div style="color:var(--tinta3);font-size:12px">${esc(l.obs)}</div>`:''}
            ${l.cenario!=='oficial'?`<div style="margin-top:3px"><span class="tag alerta">cenário: ${esc(l.cenario)}</span></div>`:''}</td>
          <td><span class="tag" title="${esc(ORIGENS[origemDe(l)].nota)}"><i style="background:${COR_ORIGEM[origemDe(l)]}"></i>${esc(ORIGENS[origemDe(l)].curto)}</span></td>
          <td>${NATUREZAS[l.natureza]||l.natureza}
            ${l.parcela?`<div style="color:var(--tinta3);font-size:12px">parcela ${l.parcela}/${l.qtdParcelas}</div>`:''}</td>
          <td><span class="tag"><i style="background:${l.classificacao==='investimento'?'var(--s2)':'var(--s1)'}"></i>${l.classificacao==='investimento'?'Investimento':'Despesa'}</span></td>
          <td class="n">${brl(l.valor)}</td>
          <td style="white-space:nowrap">
            <button class="bt fant peq" data-ed>Editar</button>
            <button class="bt fant peq" data-rc>Reclassificar</button>
            <button class="bt fant peq" data-ex>Excluir</button></td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="7">Total exibido</td>
          <td class="n">${brl(reais(somaC(mostrados.map((l)=>l.valor))))}</td><td></td></tr></tfoot>
      </table></div>`}
    </section>`;

  const aplica = (id, chave, conv = (v)=>v) => {
    const c = el(id);
    const ev = c.tagName === 'SELECT' ? 'change' : 'change';
    c.addEventListener(ev, () => { E.filtros[chave] = conv(c.value); render(); });
  };
  aplica('#l-tipo','tipo'); aplica('#l-nat','natureza'); aplica('#l-cls','classificacao');
  aplica('#l-busca','busca');
  el('#l-de').addEventListener('change', () => { E.filtros.de = mesInterno(el('#l-de').value) || ''; render(); });
  el('#l-ate').addEventListener('change', () => { E.filtros.ate = mesInterno(el('#l-ate').value) || ''; render(); });
  el('#l-cen').addEventListener('change', () => { E.cenario = el('#l-cen').value; render(); });
  el('#l-novo').addEventListener('click', () => formLancamento(null));

  el('#pagina').querySelectorAll('tbody tr').forEach((tr) => {
    const id = tr.dataset.id, comp = tr.dataset.comp;
    const achar = () => Loja.itens(E.empresa, comp).find((x) => x.id === id);
    tr.querySelector('[data-ed]').onclick = () => formLancamento({ ...achar(), competencia: comp });
    tr.querySelector('[data-rc]').onclick = () => reclassificar({ ...achar(), competencia: comp });
    tr.querySelector('[data-ex]').onclick = () => excluirLancamento({ ...achar(), competencia: comp });
  });
}

// --------------------------------------------------------------- formulário
function formLancamento(existente) {
  const emp = E.empresa, ed = !!existente;
  const tipos = tiposDa(emp), fils = filiaisDa(emp), cens = cenariosDa(emp);
  const v = existente || { filial:null, tipo: tipos[0]?.nome || '', competencia: E.competencia || mesHoje(),
    valor:'', natureza:'pontual_unica', classificacao:'despesa', cenario:'oficial', descricao:'', obs:'' };

  abrirModal({
    titulo: ed ? 'Editar lançamento' : 'Novo lançamento',
    corpo: `
      <div class="grade g3">
        <div class="campo"><label for="c-filial">Filial</label><select id="c-filial" name="filial">
          <option value="">— nível empresa —</option>
          ${fils.map((f)=>`<option${f.nome===v.filial?' selected':''}>${esc(f.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label for="c-tipo">Tipo de despesa</label><select id="c-tipo" name="tipo">
          ${tipos.map((t)=>`<option${t.nome===v.tipo?' selected':''}>${esc(t.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label for="c-comp">Competência (MM/AAAA)</label>
          <input id="c-comp" name="competencia" value="${mesExib(v.competencia)}" inputmode="numeric"></div>
      </div>
      <div class="grade g3">
        <div class="campo"><label for="c-valor">Valor (R$)</label>
          <input id="c-valor" name="valor" value="${v.valor===''?'':String(v.valor).replace('.',',')}" placeholder="1.234,56"></div>
        <div class="campo"><label for="c-nat">Natureza</label><select id="c-nat" name="natureza"${ed?' disabled':''}>
          ${Object.entries(NATUREZAS).map(([k,n])=>`<option value="${k}"${k===v.natureza?' selected':''}>${n}</option>`).join('')}</select></div>
        <div class="campo"><label for="c-cls">Classificação</label><select id="c-cls" name="classificacao">
          <option value="despesa"${v.classificacao==='despesa'?' selected':''}>Despesa</option>
          <option value="investimento"${v.classificacao==='investimento'?' selected':''}>Investimento</option></select></div>
      </div>
      <div id="c-extra"></div>
      <div class="campo"><label for="c-cen">Cenário</label><select id="c-cen" name="cenario"${ed?' disabled':''}>
        ${cens.map((c)=>`<option value="${esc(c.chave)}"${c.chave===v.cenario?' selected':''}>${esc(c.nome)}</option>`).join('')}</select></div>
      <div class="campo"><label for="c-desc">Descrição</label>
        <input id="c-desc" name="descricao" value="${esc(v.descricao||'')}" placeholder="fornecedor, contrato"></div>
      <div class="campo"><label for="c-obs">Observações</label><textarea id="c-obs" name="obs">${esc(v.obs||'')}</textarea></div>
      <div class="campo"><label for="c-just">Justificativa</label>
        <input id="c-just" name="just" placeholder="obrigatória para competências passadas"></div>`,
    acoes: `<button type="button" class="bt" data-c>Cancelar</button>
            <button type="button" class="bt pri" data-s>${ed?'Salvar alterações':'Criar lançamento'}</button>`,
    aoMontar({ raiz, fechar, erro, campo }) {
      const extra = raiz.querySelector('#c-extra');
      const pintarExtra = () => {
        const nat = campo('natureza').value;
        extra.innerHTML = nat === 'pontual_parcelada' && !ed ? `
          <div class="grade g3">
            <div class="campo"><label for="c-qtd">Quantidade de parcelas</label>
              <input id="c-qtd" name="qtd" type="number" min="2" value="${v.qtdParcelas||''}"></div>
            <div class="campo"><label for="c-ref">O valor informado é</label><select id="c-ref" name="ref">
              <option value="total">o total do contrato (rateado)</option>
              <option value="parcela">o valor de cada parcela</option></select></div>
          </div>`
          : nat === 'fixa' && !ed ? `
          <div class="campo"><label for="c-ate">Repetir mensalmente até (MM/AAAA)</label>
            <input id="c-ate" name="ate" placeholder="opcional — gera uma ocorrência por mês"></div>` : '';
      };
      pintarExtra();
      campo('natureza').addEventListener('change', pintarExtra);
      raiz.querySelector('[data-c]').addEventListener('click', fechar);
      raiz.querySelector('[data-s]').addEventListener('click', async (ev) => {
        ev.target.disabled = true; erro('');
        try {
          await salvarLancamento(existente, campo);
          fechar(); render();
        } catch (e) { erro(e.message || 'Não foi possível salvar.'); ev.target.disabled = false; }
      });
    },
  });
}

function lerValor(t) {
  let s = String(t ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!s) throw new Error('Informe o valor.');
  const temV = s.includes(','), temP = s.includes('.');
  if (temV && temP) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g,'').replace(',','.') : s.replace(/,/g,'');
  else if (temV) s = s.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Valor inválido: use 1.234,56');
  return Number(s);
}

async function salvarLancamento(existente, campo) {
  const emp = E.empresa;
  const comp = mesInterno(campo('competencia').value);
  if (!comp) throw new Error('Competência inválida: use MM/AAAA.');
  const valor = lerValor(campo('valor').value);
  const just = campo('just').value.trim();
  const base = {
    filial: campo('filial').value || null,
    tipo: campo('tipo').value,
    classificacao: campo('classificacao').value,
    descricao: campo('descricao').value.trim() || null,
    obs: campo('obs').value.trim() || null,
  };

  if (existente) {
    checarCompetencia(existente.competencia, just);
    if (comp !== existente.competencia) {
      if (existente.parcela) throw new Error('Não é possível mover a competência de uma parcela projetada.');
      checarCompetencia(comp, just);
    }
    const antigos = Loja.itens(emp, existente.competencia).filter((x) => x.id !== existente.id);
    await Loja.gravarMes(emp, existente.competencia, antigos);
    const destino = [...Loja.itens(emp, comp).filter((x)=>x.id!==existente.id),
      { ...existente, ...base, valor, competencia: undefined, id: existente.id }];
    destino.forEach((x) => delete x.competencia);
    await Loja.gravarMes(emp, comp, destino);
    await Loja.auditar({ acao:'atualizar', entidade:'lancamento', id: existente.id, justificativa: just || null,
      antes: { valor: existente.valor, classificacao: existente.classificacao, competencia: mesExib(existente.competencia) },
      depois: { valor, classificacao: base.classificacao, competencia: mesExib(comp) } });
    return;
  }

  const natureza = campo('natureza').value;
  const cenario = campo('cenario').value;
  const ocorrencias = [];
  if (natureza === 'pontual_parcelada') {
    const n = Number(campo('qtd')?.value || 0);
    if (!Number.isInteger(n) || n < 2) throw new Error('Parcelamento exige ao menos 2 parcelas.');
    if (n > 240) throw new Error('Máximo de 240 parcelas.');
    const partes = campo('ref')?.value === 'parcela'
      ? Array.from({length:n}, () => cent(valor)) : ratear(cent(valor), n);
    partes.forEach((c, i) => ocorrencias.push({ comp: mesSoma(comp, i), valor: reais(c), parcela: i+1, qtdParcelas: n }));
  } else if (natureza === 'fixa' && campo('ate')?.value.trim()) {
    const fim = mesInterno(campo('ate').value);
    if (!fim) throw new Error('"Repetir até" inválido: use MM/AAAA.');
    if (fim < comp) throw new Error('"Repetir até" deve ser igual ou posterior à competência.');
    if (mesIdx(fim) - mesIdx(comp) > 240) throw new Error('Recorrência acima de 240 meses.');
    for (const m of intervalo(comp, fim)) ocorrencias.push({ comp: m, valor, parcela: null, qtdParcelas: null });
  } else {
    ocorrencias.push({ comp, valor, parcela: null, qtdParcelas: null });
  }

  for (const o of ocorrencias) checarCompetencia(o.comp, just);
  const grupo = novoId();
  const porMes = new Map();
  for (const o of ocorrencias) {
    if (!porMes.has(o.comp)) porMes.set(o.comp, [...Loja.itens(emp, o.comp)]);
    porMes.get(o.comp).push({ id: novoId(), grupo, origem: 'manual', ...base, valor: o.valor, natureza, cenario,
      parcela: o.parcela, qtdParcelas: o.qtdParcelas });
  }
  for (const [m, itens] of porMes) await Loja.gravarMes(emp, m, itens);
  await Loja.auditar({ acao:'criar', entidade:'lancamento', id: grupo, justificativa: just || null,
    depois: { tipo: base.tipo, natureza, classificacao: base.classificacao,
      competencia: mesExib(comp), ocorrencias: ocorrencias.length, valor_total: reais(somaC(ocorrencias.map((o)=>o.valor))) } });
}

// ------------------------------------------------------- reclassificar/excluir
function reclassificar(l) {
  const destino = l.classificacao === 'despesa' ? 'investimento' : 'despesa';
  const futura = l.competencia > mesHoje();
  confirmar({
    titulo: 'Reclassificar lançamento',
    mensagem: `${esc(l.tipo)} — ${mesExib(l.competencia)} (${brl(l.valor)}) passa de <strong>${l.classificacao}</strong>
      para <strong>${destino}</strong>. A mudança alcança as parcelas futuras da mesma série.
      ${futura ? 'Competência futura: justificativa dispensada.' : 'Competência não futura: justificativa obrigatória.'}`,
    rotulo: 'Reclassificar',
    exigeJustificativa: !futura,
    async aoConfirmar(just) {
      const emp = E.empresa, alvos = [];
      const grupo = l.grupo;
      for (const [k, doc] of E.lanc) {
        if (!k.startsWith(emp + '__')) continue;
        for (const it of (doc.itens||[])) {
          const mesmaSerie = grupo && it.grupo === grupo && doc.competencia > mesHoje();
          if (it.id === l.id || (mesmaSerie && it.classificacao !== destino)) {
            alvos.push({ comp: doc.competencia, id: it.id });
          }
        }
      }
      for (const a of alvos) {
        if (a.comp > mesHoje()) checarCompetencia(a.comp, 'reclassificação futura'); else checarCompetencia(a.comp, just);
      }
      const porMes = new Map();
      for (const a of alvos) {
        if (!porMes.has(a.comp)) porMes.set(a.comp, Loja.itens(emp, a.comp).map((x)=>({...x})));
        const it = porMes.get(a.comp).find((x)=>x.id===a.id);
        if (it) it.classificacao = destino;
      }
      for (const [m, itens] of porMes) await Loja.gravarMes(emp, m, itens);
      await Loja.auditar({ acao:'reclassificar', entidade:'lancamento', id: l.id, justificativa: just || 'competência futura',
        antes: { classificacao: l.classificacao }, depois: { classificacao: destino, alcancados: alvos.length } });
      render();
    },
  });
}

function excluirLancamento(l) {
  confirmar({
    titulo: 'Excluir lançamento',
    mensagem: `${esc(l.tipo)} — ${mesExib(l.competencia)} (${brl(l.valor)}). A exclusão fica registrada na auditoria.
      ${l.grupo ? 'Se este lançamento faz parte de uma série, as parcelas futuras dela também serão removidas.' : ''}`,
    rotulo: 'Excluir',
    exigeJustificativa: true,
    async aoConfirmar(just) {
      const emp = E.empresa, remover = [];
      for (const [k, doc] of E.lanc) {
        if (!k.startsWith(emp + '__')) continue;
        for (const it of (doc.itens||[])) {
          const serieFutura = l.grupo && it.grupo === l.grupo && doc.competencia > mesHoje();
          if (it.id === l.id || serieFutura) remover.push({ comp: doc.competencia, id: it.id });
        }
      }
      for (const r of remover) checarCompetencia(r.comp, just);
      const porMes = new Map();
      for (const r of remover) {
        if (!porMes.has(r.comp)) porMes.set(r.comp, Loja.itens(emp, r.comp).map((x)=>({...x})));
        porMes.set(r.comp, porMes.get(r.comp).filter((x) => x.id !== r.id));
      }
      for (const [m, itens] of porMes) await Loja.gravarMes(emp, m, itens);
      await Loja.auditar({ acao:'excluir', entidade:'lancamento', id: l.id, justificativa: just,
        antes: { tipo: l.tipo, valor: l.valor, competencia: mesExib(l.competencia) }, depois: { removidos: remover.length } });
      render();
    },
  });
}
