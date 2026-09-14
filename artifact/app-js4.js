// ===========================================================================
// Lançamentos — a tela onde o gestor efetivamente opera
// ===========================================================================
function lancFiltrados() {
  const f = E.filtros;
  return Loja.todosDoEscopo().filter((l) => {
    if (!noCenario(l)) return false;
    if (!noEscopo(l)) return false;
    if (!passaNoFiltro(f.tipos, l.tipo)) return false;
    if (!passaNoFiltro(f.naturezas, l.natureza)) return false;
    if (!passaNoFiltro(f.classificacoes, l.classificacao)) return false;
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
  const tipos = tiposDoEscopo();
  const f = E.filtros;
  const itensTipo = tipos.map((t) => ({ valor: t.nome, rotulo: t.nome }));
  const itensNat = Object.entries(NATUREZAS).map(([k, v]) => ({ valor: k, rotulo: v }));
  const itensCls = [{ valor:'despesa', rotulo:'Despesa' }, { valor:'investimento', rotulo:'Investimento' }];
  const itensCen = cenariosDoEscopo().map((c) => ({ valor: c.chave, rotulo: c.nome }));

  el('#pagina').innerHTML = `
    <div class="filtros">
      <div class="campo" style="width:108px"><label for="l-de">De (MM/AAAA)</label><input id="l-de" placeholder="01/2026" value="${f.de?mesExib(f.de):''}"></div>
      <div class="campo" style="width:108px"><label for="l-ate">Até (MM/AAAA)</label><input id="l-ate" placeholder="12/2027" value="${f.ate?mesExib(f.ate):''}"></div>
      <div class="campo" style="width:180px"><label for="l-tipo">Tipo de despesa</label><div data-sel="tipo"></div></div>
      <div class="campo" style="width:160px"><label for="l-nat">Natureza</label><div data-sel="nat"></div></div>
      <div class="campo" style="width:150px"><label for="l-cls">Classificação</label><div data-sel="cls"></div></div>
      <div class="campo" style="width:160px"><label for="l-cen">Cenário</label><div data-sel="cen"></div></div>
      <div class="campo" style="flex:1 1 160px"><label for="l-busca">Buscar</label><input id="l-busca" placeholder="fornecedor, motivo…" value="${esc(f.busca)}"></div>
      <button class="bt pri" id="l-novo">Novo lançamento</button>
    </div>
    <div class="fichas" id="l-fichas" hidden></div>

    <section class="bloco">
      <header><h2>Lançamentos</h2>
        <span class="nota">${inteiro(lista.length)} registros · ${brl(total)}${lista.length>400?' · exibindo os 400 mais recentes':''}</span></header>
      ${mostrados.length === 0 ? '<p class="vazio">Nenhum lançamento com estes filtros.</p>' : `
      <div class="rol"><table>
        <thead><tr><th>Competência</th><th>Filial</th><th>Tipo</th><th>Descrição</th>
          <th>Origem</th><th>Natureza</th><th>Classificação</th><th class="n">Valor</th><th></th></tr></thead>
        <tbody>${mostrados.map((l) => `<tr data-id="${esc(l.id)}" data-comp="${l.competencia}" data-emp="${esc(l.empresa)}"${classeReconhecimento(l)}>
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
            <button class="bt fant peq" data-rec>${reconhecidoDe(l) ? 'Desfazer' : 'Reconhecer'}</button>
            <button class="bt fant peq" data-ed>Editar</button>
            <button class="bt fant peq" data-rc>Reclassificar</button>
            <button class="bt fant peq" data-ex>Excluir</button></td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="7">Total exibido</td>
          <td class="n">${brl(reais(somaC(mostrados.map((l)=>l.valor))))}</td><td></td></tr></tfoot>
      </table></div>`}
    </section>`;

  const grupos = [
    { chave:'tipo', id:'l-tipo', rotulo:'Tipo de despesa', itens:itensTipo, get sel() { return E.filtros.tipos; },
      aplicar:(n) => { E.filtros.tipos = n; } },
    { chave:'nat', id:'l-nat', rotulo:'Natureza', itens:itensNat, get sel() { return E.filtros.naturezas; },
      aplicar:(n) => { E.filtros.naturezas = n; } },
    { chave:'cls', id:'l-cls', rotulo:'Classificação', itens:itensCls, get sel() { return E.filtros.classificacoes; },
      aplicar:(n) => { E.filtros.classificacoes = n; } },
    { chave:'cen', id:'l-cen', rotulo:'Cenário', itens:itensCen, get sel() { return E.cenariosSel; }, minimo:1,
      aplicar:(n) => { E.cenariosSel = n; ajustarCompetencias(); } },
  ];
  for (const g of grupos) {
    seletorMulti(el(`[data-sel="${g.chave}"]`), {
      id: g.id, rotulo: g.rotulo, itens: g.itens, selecionados: g.sel, minimo: g.minimo || 0,
      aoMudar: (novo) => { g.aplicar(novo); render(); },
    });
  }
  pintarFichas(el('#l-fichas'), grupos.map((g) => ({
    chave: g.chave, rotulo: g.rotulo, itens: g.itens, selecionados: g.sel, minimo: g.minimo || 0,
    ocultarSeTudo: !g.minimo, total: g.itens.length,
    aoMudar: (n) => { g.aplicar(n); render(); },
  })));

  el('#l-busca').addEventListener('change', () => { E.filtros.busca = el('#l-busca').value; render(); });
  el('#l-de').addEventListener('change', () => { E.filtros.de = mesInterno(el('#l-de').value) || ''; render(); });
  el('#l-ate').addEventListener('change', () => { E.filtros.ate = mesInterno(el('#l-ate').value) || ''; render(); });
  el('#l-novo').addEventListener('click', () => formLancamento(null));

  el('#pagina').querySelectorAll('tbody tr').forEach((tr) => {
    const id = tr.dataset.id, comp = tr.dataset.comp, emp = tr.dataset.emp;
    const achar = () => ({ ...Loja.itens(emp, comp).find((x) => x.id === id), competencia: comp, empresa: emp });
    tr.querySelector('[data-rec]').onclick = () => alternarReconhecimento([achar()]);
    tr.querySelector('[data-ed]').onclick = () => formLancamento(achar());
    tr.querySelector('[data-rc]').onclick = () => reclassificar(achar());
    tr.querySelector('[data-ex]').onclick = () => excluirLancamento(achar());
  });
}

// --------------------------------------------------------------- formulário
function formLancamento(existente) {
  const ed = !!existente;
  // Editar segue a empresa do próprio registro. Criar escolhe aqui dentro, e
  // não pelo filtro do topo: o filtro é o recorte que o gestor está olhando, e
  // não deveria decidir se ele consegue ou não lançar.
  let emp = existente ? existente.empresa : (empresaAtiva() || escopoEmpresas()[0] || E.empresas[0]?.id);
  if (!emp) throw new Error('Cadastre uma empresa antes de lançar.');
  const tipos = tiposDa(emp), fils = filiaisDa(emp), cens = cenariosDa(emp);
  const v = existente || { filial:null, tipo: tipos[0]?.nome || '', competencia: ordenado(E.competencias).pop() || mesHoje(),
    valor:'', natureza:'pontual_unica', classificacao:'despesa', cenario:'oficial', descricao:'', obs:'' };

  abrirModal({
    titulo: ed ? 'Editar lançamento' : 'Novo lançamento',
    corpo: `
      ${ed ? '' : `
      <div class="campo"><label for="c-empresa">Empresa</label><select id="c-empresa" name="empresa">
        ${E.empresas.map((e)=>`<option value="${esc(e.id)}"${e.id===emp?' selected':''}>${esc(e.nome)}</option>`).join('')}
      </select></div>`}
      <div class="grade g3">
        <div class="campo"><label for="c-filial">Filial</label><div id="c-filiais"></div></div>
        <div class="campo"><label for="c-tipo">Tipo de despesa</label><select id="c-tipo" name="tipo"></select></div>
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
      <div class="campo"><label for="c-cen">Cenário</label><select id="c-cen" name="cenario"${ed?' disabled':''}></select></div>
      <div class="campo"><label for="c-desc">Descrição</label>
        <input id="c-desc" name="descricao" value="${esc(v.descricao||'')}" placeholder="fornecedor, contrato"></div>
      <div class="campo"><label for="c-obs">Observações</label><textarea id="c-obs" name="obs">${esc(v.obs||'')}</textarea></div>
      <div class="campo"><label for="c-just">Justificativa</label>
        <input id="c-just" name="just" placeholder="obrigatória para competências passadas"></div>`,
    acoes: `<button type="button" class="bt" data-c>Cancelar</button>
            <button type="button" class="bt pri" data-s>${ed?'Salvar alterações':'Criar lançamento'}</button>`,
    aoMontar({ raiz, fechar, erro, campo }) {
      // Filial, tipo de despesa e cenário são cadastros de cada empresa: trocar
      // a empresa tem de repintar os três, ou o formulário ofereceria a filial
      // de uma empresa para um lançamento de outra.
      const pintarDaEmpresa = () => {
        const fs = filiaisDa(emp), ts = tiposDa(emp), cs = cenariosDa(emp);
        raiz.querySelector('#c-tipo').innerHTML =
          ts.map((x) => `<option${x.nome === v.tipo ? ' selected' : ''}>${esc(x.nome)}</option>`).join('');
        raiz.querySelector('#c-cen').innerHTML =
          cs.map((c) => `<option value="${esc(c.chave)}"${c.chave === v.cenario ? ' selected' : ''}>${esc(c.nome)}</option>`).join('');

        // Editar mexe num registro só, que tem uma filial. Criar pode lançar a
        // mesma despesa em várias de uma vez — é o caso comum de um contrato
        // que atende mais de uma unidade.
        raiz.querySelector('#c-filiais').innerHTML = ed
          ? `<select id="c-filial" name="filial">
               <option value="">— nível empresa —</option>
               ${fs.map((f) => `<option${f.nome === v.filial ? ' selected' : ''}>${esc(f.nome)}</option>`).join('')}
             </select>`
          : `<div class="multi-caixas" role="group" aria-label="Filiais">
               <label><input type="checkbox" value="" checked> nível empresa</label>
               ${fs.map((f) => `<label><input type="checkbox" value="${esc(f.nome)}"> ${esc(f.nome)}</label>`).join('')}
             </div>
             <p class="nota" data-resumo style="margin:4px 0 0"></p>`;
        if (!ed) ligarFiliais();
      };

      /** Quais filiais receberão o lançamento, e o que isso significa em total. */
      const filiaisEscolhidas = () =>
        [...raiz.querySelectorAll('#c-filiais input:checked')].map((c) => c.value || null);

      const ligarFiliais = () => {
        const resumo = raiz.querySelector('[data-resumo]');
        const atualizar = () => {
          const n = filiaisEscolhidas().length;
          if (n === 0) { resumo.textContent = 'Marque ao menos uma filial, ou o nível empresa.'; return; }
          if (n === 1) { resumo.textContent = 'Um lançamento.'; return; }
          // O valor NÃO é dividido: cada filial recebe o lançamento cheio. Dizer
          // o total evita a leitura oposta, que seria um rateio.
          let bruto = 0;
          try { bruto = lerValor(campo('valor').value); } catch { bruto = 0; }
          resumo.textContent = bruto
            ? `${n} lançamentos, um por filial, de ${brl(bruto)} cada — ${brl(bruto * n)} no total.`
            : `${n} lançamentos, um por filial, cada um com o valor informado.`;
        };
        raiz.querySelectorAll('#c-filiais input').forEach((c) => c.addEventListener('change', atualizar));
        campo('valor').addEventListener('input', atualizar);
        atualizar();
      };

      pintarDaEmpresa();
      raiz.querySelector('#c-empresa')?.addEventListener('change', (ev) => {
        emp = ev.target.value;
        pintarDaEmpresa();
      });

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
          if (ed) await salvarLancamento(existente, campo, emp);
          else {
            const escolhidas = filiaisEscolhidas();
            if (escolhidas.length === 0) throw new Error('Marque ao menos uma filial, ou o nível empresa.');
            for (const filial of escolhidas) await salvarLancamento(null, campo, emp, filial);
          }
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

/**
 * `filial` vem de fora quando o formulário está criando em várias de uma vez;
 * ao editar, o campo do formulário é que manda — o registro tem uma filial só.
 */
async function salvarLancamento(existente, campo, empresa, filial) {
  const emp = empresa || exigirEmpresaUnica();
  const comp = mesInterno(campo('competencia').value);
  if (!comp) throw new Error('Competência inválida: use MM/AAAA.');
  const valor = lerValor(campo('valor').value);
  const just = campo('just').value.trim();
  const base = {
    filial: filial !== undefined ? filial : (campo('filial')?.value || null),
    tipo: campo('tipo').value,
    classificacao: campo('classificacao').value,
    descricao: campo('descricao').value.trim() || null,
    obs: campo('obs').value.trim() || null,
  };

  if (existente) {
    checarCompetencia(existente.competencia, just, emp);
    if (comp !== existente.competencia) {
      if (existente.parcela) throw new Error('Não é possível mover a competência de uma parcela projetada.');
      checarCompetencia(comp, just, emp);
    }
    const antigos = Loja.itens(emp, existente.competencia).filter((x) => x.id !== existente.id);
    await Loja.gravarMes(emp, existente.competencia, antigos);
    const destino = [...Loja.itens(emp, comp).filter((x)=>x.id!==existente.id),
      { ...existente, ...base, valor, competencia: undefined, id: existente.id }];
    destino.forEach((x) => delete x.competencia);
    await Loja.gravarMes(emp, comp, destino);
    await Loja.auditar({ acao:'atualizar', entidade:'lancamento', id: existente.id, justificativa: just || null,
      antes: { valor: existente.valor, classificacao: existente.classificacao, competencia: mesExib(existente.competencia) },
      depois: { valor, classificacao: base.classificacao, competencia: mesExib(comp) } }, emp);
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

  for (const o of ocorrencias) checarCompetencia(o.comp, just, emp);
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
      competencia: mesExib(comp), ocorrencias: ocorrencias.length, valor_total: reais(somaC(ocorrencias.map((o)=>o.valor))) } }, emp);
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
      const emp = l.empresa || exigirEmpresaUnica(), alvos = [];
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
        if (a.comp > mesHoje()) checarCompetencia(a.comp, 'reclassificação futura', emp); else checarCompetencia(a.comp, just, emp);
      }
      const porMes = new Map();
      for (const a of alvos) {
        if (!porMes.has(a.comp)) porMes.set(a.comp, Loja.itens(emp, a.comp).map((x)=>({...x})));
        const it = porMes.get(a.comp).find((x)=>x.id===a.id);
        if (it) it.classificacao = destino;
      }
      for (const [m, itens] of porMes) await Loja.gravarMes(emp, m, itens);
      await Loja.auditar({ acao:'reclassificar', entidade:'lancamento', id: l.id, justificativa: just || 'competência futura',
        antes: { classificacao: l.classificacao }, depois: { classificacao: destino, alcancados: alvos.length } }, emp);
      render();
    },
  });
}

/**
 * Reconhecer (ou desfazer) uma ou várias despesas.
 *
 * NÃO passa pela trava de competência fechada, e isso é deliberado: conferir um
 * mês já fechado é exatamente o trabalho esperado, e proibi-lo deixaria o
 * passivo de não reconhecidos sem saída. Também não é edição — valor,
 * competência e classificação seguem intactos; o que muda é a afirmação de que
 * alguém olhou aquilo.
 */
async function alternarReconhecimento(lancamentos, forcar) {
  const alvos = lancamentos.filter(Boolean);
  if (!alvos.length) return;
  const destino = forcar === undefined ? !reconhecidoDe(alvos[0]) : !!forcar;
  const emp = alvos[0].empresa || exigirEmpresaUnica();
  const mudar = alvos.filter((l) => reconhecidoDe(l) !== destino);
  if (!mudar.length) return;

  const porMes = new Map();
  for (const l of mudar) {
    if (!porMes.has(l.competencia)) porMes.set(l.competencia, Loja.itens(emp, l.competencia).map((x) => ({ ...x })));
    const item = porMes.get(l.competencia).find((x) => x.id === l.id);
    if (item) {
      item.reconhecido = destino;
      item.reconhecidoEm = destino ? new Date().toISOString() : null;
    }
  }
  for (const [m, itens] of porMes) await Loja.gravarMes(emp, m, itens);
  await Loja.auditar({
    acao: destino ? 'reconhecer' : 'desfazer_reconhecimento', entidade: 'lancamento',
    id: mudar.length === 1 ? mudar[0].id : null,
    depois: { reconhecido: destino, quantidade: mudar.length },
  }, emp);
  render();
}

function excluirLancamento(l) {
  confirmar({
    titulo: 'Excluir lançamento',
    mensagem: `${esc(l.tipo)} — ${mesExib(l.competencia)} (${brl(l.valor)}). A exclusão fica registrada na auditoria.
      ${l.grupo ? 'Se este lançamento faz parte de uma série, as parcelas futuras dela também serão removidas.' : ''}`,
    rotulo: 'Excluir',
    exigeJustificativa: true,
    async aoConfirmar(just) {
      const emp = l.empresa || exigirEmpresaUnica(), remover = [];
      for (const [k, doc] of E.lanc) {
        if (!k.startsWith(emp + '__')) continue;
        for (const it of (doc.itens||[])) {
          const serieFutura = l.grupo && it.grupo === l.grupo && doc.competencia > mesHoje();
          if (it.id === l.id || serieFutura) remover.push({ comp: doc.competencia, id: it.id });
        }
      }
      for (const r of remover) checarCompetencia(r.comp, just, emp);
      const porMes = new Map();
      for (const r of remover) {
        if (!porMes.has(r.comp)) porMes.set(r.comp, Loja.itens(emp, r.comp).map((x)=>({...x})));
        porMes.set(r.comp, porMes.get(r.comp).filter((x) => x.id !== r.id));
      }
      for (const [m, itens] of porMes) await Loja.gravarMes(emp, m, itens);
      await Loja.auditar({ acao:'excluir', entidade:'lancamento', id: l.id, justificativa: just,
        antes: { tipo: l.tipo, valor: l.valor, competencia: mesExib(l.competencia) }, depois: { removidos: remover.length } }, emp);
      render();
    },
  });
}
