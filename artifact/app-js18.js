// ===========================================================================
// Clientes — o contratante, uma camada acima da matriz
// ===========================================================================
// A hierarquia do negócio é Cliente → Matriz → Filial. Aqui as matrizes são as
// `empresas` do catálogo, e o cliente é quem as contrata. Nenhuma tela soma
// dois clientes: escolher um é o primeiro ato da sessão, e é o recorte que
// governa todos os outros.

const CHAVE_CLIENTE = 'iarx-cliente';

/**
 * O dono das empresas que já estavam na base antes de existir esta camada.
 *
 * As cinco matrizes carregadas (ALIANÇA, MILAGRES, MOOVE, RESIDENCIAL, UNION)
 * são todas do mesmo contratante — foi o que a conferência com a tabela do
 * gestor mostrou. Adotá-las é o contrário de inventar cadastro: sem dono, elas
 * ficariam invisíveis assim que a tela passasse a filtrar por cliente.
 */
const CLIENTE_HISTORICO = { id: 'grupo-brasil-home-care', nome: 'Grupo Brasil Home Care', documento: null, ativo: true };

Object.assign(Loja, {
  async clientesTodos() {
    const s = await E.db.doc('catalogo/clientes').get();
    return s.exists ? (s.data().itens || []) : [];
  },
  async gravarClientes(itens) {
    await E.db.doc('catalogo/clientes').set({ itens });
    E.clientes = itens;
  },
});

/** Empresa sem `cliente` é da carga anterior à camada: pertence ao histórico. */
const clienteDaEmpresa = (e) => (e && e.cliente) || CLIENTE_HISTORICO.id;
const empresasDoCliente = (id) => E.empresas.filter((e) => clienteDaEmpresa(e) === id);
const clientePorId = (id) => E.clientes.find((c) => c.id === id) || null;
const clienteAtual = () => clientePorId(E.clienteSel);

/**
 * Garante que todo cliente exista e que nenhuma empresa fique órfã.
 *
 * A adoção acontece em MEMÓRIA primeiro e só depois tenta gravar: quem abriu o
 * link só para ver não escreve, e a tela dessa pessoa precisa funcionar igual à
 * de quem edita — o que ela não pode é sair mudando a base.
 */
async function garantirClientes() {
  E.clientes = await Loja.clientesTodos();
  const orfas = E.empresas.filter((e) => !e.cliente);
  if (E.clientes.length && !orfas.length) return;

  if (orfas.length && !E.clientes.some((c) => c.id === CLIENTE_HISTORICO.id)) {
    E.clientes = [...E.clientes, { ...CLIENTE_HISTORICO }];
  }
  for (const e of orfas) e.cliente = CLIENTE_HISTORICO.id;

  if (E.somenteLeitura) return;
  try {
    await Loja.gravarClientes(E.clientes);
    if (orfas.length) await Loja.gravarCatalogo('empresas', E.empresas);
  } catch (err) {
    // Armazenamento recusou: a adoção vale para esta sessão e a tela abre. O
    // contrário — parar tudo — deixaria a pessoa sem sistema por um cadastro.
  }
}

// ------------------------------------------------------------- persistência

function clienteGuardado() {
  try { return localStorage.getItem(CHAVE_CLIENTE); } catch (e) { return null; }
}

function guardarCliente(id) {
  try { id ? localStorage.setItem(CHAVE_CLIENTE, id) : localStorage.removeItem(CHAVE_CLIENTE); }
  catch (e) { /* sem armazenamento: a escolha vale só nesta sessão */ }
}

// --------------------------------------------------------------- a escolha

/** 29521159000214 → 29.521.159/0002-14. Documento fora do formato sai como veio. */
function documentoExib(bruto) {
  const d = String(bruto || '').replace(/\D/g, '');
  if (d.length !== 14) return String(bruto || '').trim() || null;
  return d.slice(0,2) + '.' + d.slice(2,5) + '.' + d.slice(5,8) + '/' + d.slice(8,12) + '-' + d.slice(12);
}

const plural = (n, um, muitos) => n + ' ' + (n === 1 ? um : muitos);

/**
 * Tela de boas-vindas. Um cliente por vez, porque é assim que o sistema
 * consulta: oferecer "todos" prometeria uma visão consolidada que nenhuma tela
 * entrega.
 */
function viewBoasVindas() {
  document.body.setAttribute('data-sem-cliente', '1');
  const ativos = E.clientes.filter((c) => c.ativo !== false);
  const cartoes = ativos.map((c) => {
    const matrizes = empresasDoCliente(c.id);
    const filiais = matrizes.reduce((n, m) => n + filiaisDa(m.id).length, 0);
    const doc = documentoExib(c.documento);
    return `<button type="button" class="cartao-cliente" data-cliente="${esc(c.id)}">
        <strong>${esc(c.nome)}</strong>
        <small>${plural(matrizes.length, 'matriz', 'matrizes')} · ${plural(filiais, 'filial', 'filiais')}${doc ? ' · ' + esc(doc) : ''}</small>
      </button>`;
  }).join('');

  el('#pagina').innerHTML = `
    <section class="boas-vindas">
      <h1>Qual cliente você gostaria de acessar?</h1>
      <p>Todo número das telas seguintes é do cliente escolhido. Dá para trocar a qualquer momento,
         pelo topo da página.</p>
      ${ativos.length
        ? `<div class="lista-clientes">${cartoes}</div>`
        : `<div class="msg">Nenhum cliente cadastrado nesta base. Cadastre o primeiro em
             <strong>Sistema → Cadastros</strong>.</div>`}
    </section>`;

  el('#pagina').querySelectorAll('[data-cliente]').forEach((b) => {
    b.onclick = () => abrirCliente(b.dataset.cliente);
  });
}

/** Entra no cliente: define o escopo inicial e monta a primeira tela. */
async function abrirCliente(id, guardar = true) {
  const cliente = clientePorId(id);
  if (!cliente) return viewBoasVindas();
  E.clienteSel = id;
  if (guardar) guardarCliente(id);
  document.body.removeAttribute('data-sem-cliente');

  const matrizes = empresasDoCliente(id);
  E.empresasSel = new Set(matrizes.length ? [matrizes[0].id] : []);
  E.filiaisSel = new Set();
  await garantirEscopo();
  E.cenariosSel = new Set(['oficial']);
  E.competencias = new Set([competenciaPadrao()]);
  pintarCliente();
  pintarSeletores();
  await restaurarPrevia();
  await render();
}

/** Volta à tela de boas-vindas sem recarregar a página. */
function trocarCliente() {
  E.clienteSel = null;
  guardarCliente(null);
  E.empresasSel = new Set();
  pintarCliente();
  viewBoasVindas();
}

function pintarCliente() {
  const caixa = el('#cliente-atual');
  if (!caixa) return;
  const c = clienteAtual();
  caixa.hidden = !c;
  if (!c) { caixa.innerHTML = ''; return; }
  // Com um cliente só, trocar não teria para onde ir — o botão prometeria uma
  // escolha inexistente.
  const podeTrocar = E.clientes.filter((x) => x.ativo !== false).length > 1;
  caixa.innerHTML = `<span>Cliente</span><b title="${esc(c.nome)}">${esc(c.nome)}</b>` +
    (podeTrocar ? `<button type="button" id="bt-trocar-cliente">Trocar cliente</button>` : '');
  const bt = el('#bt-trocar-cliente');
  if (bt) bt.onclick = () => trocarCliente();
}
