// ===========================================================================
// Seletor de múltipla escolha.
//
// Todo filtro do sistema usa este componente: caixas de seleção, com o que
// está escolhido aparecendo na própria tela em fichas removíveis — para o
// gestor enxergar o recorte sem precisar reabrir cada seletor.
//
// Conjuntos vazios significam "todos" onde isso faz sentido (tipo, natureza,
// filial…). Onde não faz — empresa, competência, cenário —, `minimo:1` impede
// esvaziar: um painel sem competência nenhuma não mostraria número algum.
// ===========================================================================

/** Conjunto a partir de qualquer coisa: Set, array, valor solto ou nada. */
const conjunto = (v) => v instanceof Set ? new Set(v) : new Set(v == null ? [] : [].concat(v));
const ordenado = (s) => [...s].sort();

/** Um filtro só restringe quando tem escolha e não é "todos". */
function passaNoFiltro(selecionados, valor) {
  return !selecionados || selecionados.size === 0 || selecionados.has(valor);
}

let multiAberto = null;
document.addEventListener('click', (ev) => {
  if (multiAberto && !multiAberto.contains(ev.target)) fecharMulti();
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && multiAberto) fecharMulti(); });
function fecharMulti() {
  if (!multiAberto) return;
  multiAberto.querySelector('.painel').hidden = true;
  multiAberto.querySelector('button[aria-expanded]').setAttribute('aria-expanded', 'false');
  multiAberto = null;
}

/**
 * Monta o seletor dentro de `hospedeiro`.
 *
 * itens: [{ valor, rotulo, apoio? }]
 * selecionados: Set (mutado somente através de aoMudar)
 * aoMudar(novoConjunto): chamado a cada alteração — quem chama decide se
 *   redesenha a tela inteira ou só a parte afetada.
 */
function seletorMulti(hospedeiro, { id, rotulo, itens, selecionados, aoMudar, minimo = 0, aviso = '' }) {
  const sel = conjunto(selecionados);
  const busca = itens.length > 8;

  hospedeiro.innerHTML = `
    <div class="multi" data-multi="${esc(id)}">
      <button type="button" id="${esc(id)}" aria-expanded="false" aria-haspopup="listbox"
        aria-label="${esc(rotulo)}"></button>
      <div class="painel" hidden role="listbox" aria-multiselectable="true">
        ${busca ? `<input class="busca" type="search" placeholder="Filtrar…" aria-label="Filtrar opções">` : ''}
        <div class="acoes">
          <button type="button" class="bt" data-todos>Todos</button>
          <button type="button" class="bt" data-limpar>${minimo ? 'Só o primeiro' : 'Limpar'}</button>
        </div>
        ${aviso ? `<div class="aviso">${esc(aviso)}</div>` : ''}
        <ul class="lista"></ul>
      </div>
    </div>`;

  const raiz = hospedeiro.querySelector('.multi');
  const gatilho = raiz.querySelector('button[aria-expanded]');
  const painel = raiz.querySelector('.painel');
  const lista = raiz.querySelector('.lista');
  const campoBusca = raiz.querySelector('.busca');

  const resumo = () => {
    if (sel.size === 0) return minimo ? 'Nenhuma' : 'Todos';
    if (sel.size === 1) {
      const unico = itens.find((i) => i.valor === [...sel][0]);
      return unico ? unico.rotulo : [...sel][0];
    }
    if (sel.size === itens.length) return `Todos <span class="cont">(${itens.length})</span>`;
    return `${sel.size} selecionados <span class="cont">de ${itens.length}</span>`;
  };
  const pintarGatilho = () => { gatilho.innerHTML = resumo(); };

  const pintarLista = () => {
    const termo = (campoBusca?.value || '').trim().toLowerCase();
    const visiveis = termo
      ? itens.filter((i) => i.rotulo.toLowerCase().includes(termo) || String(i.valor).toLowerCase().includes(termo))
      : itens;
    lista.innerHTML = visiveis.length === 0
      ? '<li class="nada">Nada encontrado.</li>'
      : visiveis.map((i) => `
        <li><label>
          <input type="checkbox" value="${esc(i.valor)}"${sel.has(i.valor) ? ' checked' : ''}>
          <span class="rot">${esc(i.rotulo)}</span>
          ${i.apoio ? `<span class="ap">${esc(i.apoio)}</span>` : ''}
        </label></li>`).join('');
    lista.querySelectorAll('input[type=checkbox]').forEach((c) => {
      c.addEventListener('change', () => {
        if (c.checked) sel.add(c.value);
        else if (sel.size > minimo) sel.delete(c.value);
        else { c.checked = true; return; }   // o mínimo não pode ser violado
        pintarGatilho();
        aoMudar(new Set(sel));
      });
    });
  };

  gatilho.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const abrindo = painel.hidden;
    fecharMulti();
    if (!abrindo) return;
    painel.hidden = false;
    gatilho.setAttribute('aria-expanded', 'true');
    multiAberto = raiz;
    pintarLista();
    campoBusca?.focus();
  });
  painel.addEventListener('click', (ev) => ev.stopPropagation());
  campoBusca?.addEventListener('input', pintarLista);

  raiz.querySelector('[data-todos]').addEventListener('click', () => {
    itens.forEach((i) => sel.add(i.valor));
    pintarGatilho(); pintarLista(); aoMudar(new Set(sel));
  });
  raiz.querySelector('[data-limpar]').addEventListener('click', () => {
    sel.clear();
    // com mínimo, "limpar" reduz ao primeiro item em vez de deixar a tela cega
    if (minimo) itens.slice(0, minimo).forEach((i) => sel.add(i.valor));
    pintarGatilho(); pintarLista(); aoMudar(new Set(sel));
  });

  pintarGatilho();
  return raiz;
}

/**
 * Fichas do que está selecionado. É a metade visível do pedido: a escolha
 * aparece na tela, e cada ficha se remove sozinha.
 */
function pintarFichas(hospedeiro, grupos) {
  const partes = [];
  for (const g of grupos) {
    const escolhidos = [...(g.selecionados || [])];
    if (!escolhidos.length) continue;
    if (g.ocultarSeTudo && escolhidos.length === g.total) continue;
    // Com um item só, o próprio botão do seletor já mostra o nome: repetir em
    // ficha vira ruído. As fichas existem para o caso de vários.
    if (escolhidos.length === 1) continue;
    partes.push(`<span class="rotgrupo">${esc(g.rotulo)}</span>`);
    for (const v of escolhidos) {
      const item = (g.itens || []).find((i) => i.valor === v);
      partes.push(`<span class="ficha" data-g="${esc(g.chave)}" data-v="${esc(v)}">
        <span>${esc(item ? item.rotulo : v)}</span>
        ${escolhidos.length > (g.minimo || 0) ? '<button type="button" aria-label="Remover">×</button>' : ''}
      </span>`);
    }
  }
  if (!partes.length) { hospedeiro.innerHTML = ''; hospedeiro.hidden = true; return; }
  hospedeiro.hidden = false;
  hospedeiro.innerHTML = partes.join('');
  hospedeiro.querySelectorAll('.ficha button').forEach((b) => {
    b.onclick = () => {
      const f = b.closest('.ficha');
      const g = grupos.find((x) => x.chave === f.dataset.g);
      if (!g) return;
      const novo = new Set(g.selecionados);
      if (novo.size <= (g.minimo || 0)) return;
      novo.delete(f.dataset.v);
      g.aoMudar(novo);
    };
  });
}
