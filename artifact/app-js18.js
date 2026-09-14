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
      ${(() => {
        // Os contratantes que o enunciado pediu e ainda não estão aqui. O aviso
        // fica NESTA tela porque é onde a ausência se nota — dentro de
        // "Clientes e unidades" ele só seria visto por quem já sabia procurar.
        // Continua sendo um botão: escrever na base de todo mundo é um ato de
        // alguém, não algo que a abertura da página faça sozinha.
        const faltam = CLIENTES_INICIAIS.filter((n) => !E.clientes.some((c) => c.nome === n));
        return faltam.length
          ? `<div class="msg alerta" style="margin-top:4px">
               <strong>${esc(faltam.join(' e '))} ainda não ${faltam.length > 1 ? 'estão' : 'está'} nesta base.</strong>
               Cadastrar cria o contratante e a matriz de mesmo nome — nada é sobrescrito, e repetir não duplica.
               <div style="margin-top:8px"><button type="button" class="bt" id="bv-iniciais">Cadastrar
                 ${esc(faltam.join(' e '))}</button></div></div>`
          : '';
      })()}
    </section>`;

  el('#pagina').querySelectorAll('[data-cliente]').forEach((b) => {
    b.onclick = () => abrirCliente(b.dataset.cliente);
  });

  const btIniciais = el('#bv-iniciais');
  if (btIniciais) {
    btIniciais.onclick = async () => {
      btIniciais.disabled = true;
      try { await cadastrarClientesIniciais(); viewBoasVindas(); }
      catch (e) {
        btIniciais.disabled = false;
        btIniciais.insertAdjacentHTML('afterend',
          `<p class="msg erro" style="margin-top:8px">${esc(e.message || e)}</p>`);
      }
    };
  }
}

/** Entra no cliente: define o escopo inicial e monta a primeira tela. */
async function abrirCliente(id, guardar = true) {
  const cliente = clientePorId(id);
  if (!cliente) return viewBoasVindas();
  E.clienteSel = id;
  if (guardar) guardarCliente(id);
  document.body.removeAttribute('data-sem-cliente');

  // O escopo é o CLIENTE INTEIRO, não a primeira matriz: nenhuma tela começa
  // recortada por uma escolha que ninguém fez. Cada tela filtra por conta
  // própria, e os filtros começam vazios.
  const matrizes = empresasDoCliente(id);
  E.filtrosTela = new Map();
  E.empresaFoco = matrizes.length ? matrizes[0].id : null;
  await garantirEscopo();
  E.cenariosSel = new Set(['oficial']);
  E.competencias = new Set([competenciaPadrao()]);
  pintarCliente();
  pintarFiltrosDaTela();
  await restaurarPrevia();
  await render();
}

/** Volta à tela de boas-vindas sem recarregar a página. */
function trocarCliente() {
  E.clienteSel = null;
  guardarCliente(null);
  // Os filtros de tela morrem junto: o recorte de um contratante não significa
  // nada no próximo.
  E.filtrosTela = new Map();
  E.empresaFoco = null;
  pintarCliente();
  viewBoasVindas();
}

// ===========================================================================
// Cadastro de clientes, matrizes e filiais
// ===========================================================================

/** Só dígitos: é assim que dois CNPJs se comparam sem discutir pontuação. */
const digitosCnpj = (v) => String(v || '').replace(/\D/g, '');
/** A raiz — oito primeiros dígitos — é o que diz que duas unidades são a mesma. */
const raizCnpj = (v) => digitosCnpj(v).slice(0, 8);
const ehMatrizCnpj = (v) => digitosCnpj(v).slice(8, 12) === '0001';

/**
 * A matriz do cliente que já tem esta raiz — pela dela ou pela de uma filial.
 *
 * A matriz que agrupa por operação (MILAGRES abriga HM-CE, HM-DF e HM-MT) não
 * tem CNPJ próprio: a raiz está nas filiais, e é lá que ela precisa ser
 * procurada. Sem isso, cada nova unidade abriria uma matriz para a mesma
 * pessoa jurídica.
 */
function matrizPelaRaiz(clienteId, cnpj) {
  const raiz = raizCnpj(cnpj);
  if (raiz.length < 8) return null;
  const matrizes = empresasDoCliente(clienteId);
  return (
    matrizes.find((m) => raizCnpj(m.cnpj) === raiz) ||
    matrizes.find((m) => filiaisDa(m.id).some((f) => raizCnpj(f.cnpj) === raiz)) ||
    null
  );
}

async function criarClienteNovo(dados) {
  const nome = String(dados.nome || '').trim();
  if (!nome) throw new Error('O nome do cliente é obrigatório.');
  if (E.clientes.some((c) => c.nome.toLowerCase() === nome.toLowerCase())) {
    throw new Error('Já existe um cliente chamado "' + nome + '".');
  }
  const novo = { id: novoId(), nome, documento: digitosCnpj(dados.documento) || null, ativo: true };
  await Loja.gravarClientes([...E.clientes, novo]);
  await Loja.auditar({ acao: 'criar', entidade: 'cliente', descricao: nome });
  return novo;
}

/**
 * Cadastra a unidade aplicando a regra do CNPJ: mesma raiz, mesma matriz.
 *
 * A regra é uma só e mora aqui — a tela apenas informa o que a pessoa escolheu.
 */
async function criarUnidadeNoCliente(clienteId, dados) {
  const nome = String(dados.nome || '').trim();
  if (!nome) throw new Error('O nome da unidade é obrigatório.');
  const irma = dados.cnpj ? matrizPelaRaiz(clienteId, dados.cnpj) : null;
  const tipo = dados.tipo || (irma ? 'FILIAL' : 'MATRIZ');
  const comum = {
    codigo: String(dados.codigo || '').trim() || null,
    cnpj: digitosCnpj(dados.cnpj) || null,
    endereco: String(dados.endereco || '').trim() || null,
    cep: String(dados.cep || '').trim() || null,
  };

  if (tipo === 'MATRIZ') {
    if (irma) {
      throw new Error('O CNPJ informado tem a mesma raiz de "' + irma.nome + '". Unidades da mesma raiz são a ' +
        'mesma pessoa jurídica: cadastre esta como filial de "' + irma.nome + '".');
    }
    if (empresasDoCliente(clienteId).some((m) => m.nome.toLowerCase() === nome.toLowerCase())) {
      throw new Error('Já existe uma matriz "' + nome + '" neste cliente.');
    }
    const nova = { id: novoId(), nome, cliente: clienteId, ...comum };
    await Loja.gravarCatalogo('empresas', [...E.empresas, nova]);
    await Loja.auditar({ acao: 'criar', entidade: 'matriz', descricao: nome });
    return nova;
  }

  const paiId = dados.matrizPaiId || (irma && irma.id) || null;
  if (!paiId) {
    throw new Error('Informe a matriz desta filial. Sem CNPJ de raiz conhecida, não há como deduzir onde ela entra.');
  }
  // A matriz tem de ser DESTE cliente: sem a conferência, um id alheio
  // penduraria a filial na estrutura de outro contratante.
  if (!empresasDoCliente(clienteId).some((m) => m.id === paiId)) {
    throw new Error('Matriz não encontrada neste cliente.');
  }
  if (filiaisDa(paiId).some((f) => String(f.nome).toLowerCase() === nome.toLowerCase())) {
    throw new Error('Já existe uma filial "' + nome + '" nesta matriz.');
  }
  const nova = { empresa: paiId, nome, uf: String(dados.uf || '').trim().toUpperCase() || null, ...comum };
  await Loja.gravarCatalogo('filiais', [...E.filiais, nova]);
  await Loja.auditar({ acao: 'criar', entidade: 'filial', descricao: nome });
  return nova;
}

/** Os clientes que o enunciado pediu, além do grupo já cadastrado. */
const CLIENTES_INICIAIS = ['Limas IT', 'SoulCoop'];

/**
 * Cadastra Limas IT e SoulCoop, cada um com a matriz de mesmo nome.
 *
 * É um botão, e não algo que o sistema faça ao abrir: escrever na base de todo
 * mundo tem de ser um ato de alguém. Idempotente — rodar de novo não duplica.
 */
async function cadastrarClientesIniciais() {
  const clientes = [...E.clientes];
  const empresas = [...E.empresas];
  let novos = 0;
  for (const nome of CLIENTES_INICIAIS) {
    let c = clientes.find((x) => x.nome === nome);
    if (!c) {
      c = { id: novoId(), nome, documento: null, ativo: true };
      clientes.push(c);
      novos += 1;
    }
    if (!empresas.some((e) => e.cliente === c.id)) {
      empresas.push({ id: novoId(), nome, cliente: c.id, codigo: null, cnpj: null, endereco: null, cep: null });
    }
  }
  if (!novos && empresas.length === E.empresas.length) return 0;
  await Loja.gravarClientes(clientes);
  await Loja.gravarCatalogo('empresas', empresas);
  await Loja.auditar({ acao: 'criar', entidade: 'cliente', descricao: CLIENTES_INICIAIS.join(', ') });
  return novos;
}

const UNIDADE_NOVA = { tipo: 'MATRIZ', matrizPaiId: '', nome: '', codigo: '', cnpj: '', endereco: '', cep: '', uf: '' };

function cnpjExib(bruto) {
  const d = digitosCnpj(bruto);
  if (d.length !== 14) return String(bruto || '').trim() || '—';
  return d.slice(0,2) + '.' + d.slice(2,5) + '.' + d.slice(5,8) + '/' + d.slice(8,12) + '-' + d.slice(12);
}

async function viewClientes() {
  const alvo = E.clienteCad || E.clienteSel || (E.clientes[0] && E.clientes[0].id) || null;
  E.clienteCad = alvo;
  const rascunho = E.unidadeNova || { ...UNIDADE_NOVA };
  E.unidadeNova = rascunho;

  const linhaCliente = (c) => {
    const matrizes = empresasDoCliente(c.id);
    const filiais = matrizes.reduce((n, m) => n + filiaisDa(m.id).length, 0);
    return `<tr${c.id === alvo ? ' class="ativo"' : ''}>
      <td><button type="button" class="lk" data-abrir="${esc(c.id)}">${esc(c.nome)}</button></td>
      <td>${esc(cnpjExib(c.documento))}</td>
      <td class="num">${inteiro(matrizes.length)}</td>
      <td class="num">${inteiro(filiais)}</td>
      <td>${c.ativo === false ? '<span class="tag">Inativo</span>' : '<span class="tag bom">Ativo</span>'}</td>
      <td><button type="button" class="bt pequeno" data-escreve="edit" data-ativar="${esc(c.id)}">
        ${c.ativo === false ? 'Reativar' : 'Desativar'}</button></td>
    </tr>`;
  };

  const matrizes = alvo ? empresasDoCliente(alvo) : [];
  const linhasEstrutura = matrizes.flatMap((m) => [
    `<tr><td><strong>${esc(m.nome)}</strong></td><td><span class="tag">Matriz</span></td>
      <td>${esc(m.codigo || '—')}</td><td>${esc(cnpjExib(m.cnpj))}</td>
      <td>${esc(m.endereco || '—')}</td><td>${esc(m.cep || '—')}</td></tr>`,
    ...filiaisDa(m.id).map((f) => `<tr><td style="padding-left:24px;color:var(--tinta2)">${esc(f.nome)}</td>
      <td>Filial</td><td>${esc(f.codigo || '—')}</td><td>${esc(cnpjExib(f.cnpj))}</td>
      <td>${esc(f.endereco || '—')}</td><td>${esc(f.cep || '—')}</td></tr>`),
  ]);

  const faltam = CLIENTES_INICIAIS.filter((n) => !E.clientes.some((c) => c.nome === n));

  el('#pagina').innerHTML = `
    <section class="bloco">
      <header><h2>Clientes</h2><span class="nota">${inteiro(E.clientes.length)}</span></header>
      <div class="msg">O contratante é o recorte mais externo: toda matriz, toda filial e todo registro
        pertencem a um cliente, e nenhuma tela soma dois.</div>
      <div class="rol" style="margin-top:12px"><table>
        <thead><tr><th>Cliente</th><th>Documento</th><th class="num">Matrizes</th><th class="num">Filiais</th>
          <th>Situação</th><th></th></tr></thead>
        <tbody>${E.clientes.map(linhaCliente).join('') || '<tr><td colspan="6" class="vazio">Nenhum cliente.</td></tr>'}</tbody>
      </table></div>
      <div class="filtros" style="margin-top:12px;box-shadow:none;border:0;padding:0">
        <div class="campo"><label for="cl-nome">Novo cliente</label><input id="cl-nome" style="min-width:220px"></div>
        <div class="campo"><label for="cl-doc">CNPJ (opcional)</label><input id="cl-doc" style="width:180px"></div>
        <button class="bt primario" id="cl-criar" data-escreve="create">Cadastrar cliente</button>
        ${faltam.length ? `<button class="bt" id="cl-iniciais" data-escreve="create">Cadastrar ${esc(faltam.join(' e '))}</button>` : ''}
      </div>
      <div class="msg erro" id="cl-erro" hidden style="margin-top:10px"></div>
    </section>

    <section class="bloco">
      <header><h2>Estrutura${alvo ? ' de ' + esc((clientePorId(alvo) || {}).nome || '') : ''}</h2></header>
      <div class="msg">Matriz é a pessoa jurídica; filial é a unidade dela. É o CNPJ que diz qual é qual:
        mesma raiz, mesma matriz.</div>
      <div class="rol" style="margin-top:12px"><table>
        <thead><tr><th>Unidade</th><th>Tipo</th><th>Código</th><th>CNPJ</th><th>Endereço</th><th>CEP</th></tr></thead>
        <tbody>${linhasEstrutura.join('') || '<tr><td colspan="6" class="vazio">Nenhuma matriz cadastrada.</td></tr>'}</tbody>
      </table></div>

      <!-- O formulário é montado UMA vez e atualizado no lugar. Remontá-lo a
           cada tecla trocaria os elementos sob o cursor, e o clique no botão
           se perderia entre o "mouse desce" e o "mouse sobe". -->
      <div class="filtros" style="margin-top:12px;box-shadow:none;border:0;padding:0">
        <div class="campo"><label for="un-tipo">Tipo</label><select id="un-tipo">
          <option value="MATRIZ"${rascunho.tipo==='MATRIZ'?' selected':''}>Matriz</option>
          <option value="FILIAL"${rascunho.tipo==='FILIAL'?' selected':''}>Filial</option></select></div>
        <div class="campo" id="campo-pai"${rascunho.tipo === 'FILIAL' ? '' : ' hidden'}>
          <label for="un-pai">Matriz</label><select id="un-pai">
          <option value="">Pelo CNPJ</option>
          ${matrizes.map((m)=>`<option value="${esc(m.id)}"${rascunho.matrizPaiId===m.id?' selected':''}>${esc(m.nome)}</option>`).join('')}
          </select></div>
        <div class="campo"><label for="un-nome">Nome</label><input id="un-nome" value="${esc(rascunho.nome)}" style="min-width:200px"></div>
        <div class="campo"><label for="un-codigo">Código</label><input id="un-codigo" value="${esc(rascunho.codigo)}" style="width:110px"></div>
        <div class="campo"><label for="un-cnpj">CNPJ</label><input id="un-cnpj" value="${esc(rascunho.cnpj)}" style="width:175px"></div>
        <div class="campo"><label for="un-endereco">Endereço</label><input id="un-endereco" value="${esc(rascunho.endereco)}" style="flex:1 1 300px;min-width:0"></div>
        <div class="campo"><label for="un-cep">CEP</label><input id="un-cep" value="${esc(rascunho.cep)}" style="width:110px"></div>
        <div class="campo" id="campo-uf"${rascunho.tipo === 'FILIAL' ? '' : ' hidden'}>
          <label for="un-uf">UF</label><input id="un-uf" value="${esc(rascunho.uf)}" maxlength="2" style="width:60px"></div>
        <button class="bt primario" id="un-criar" data-escreve="create">Cadastrar unidade</button>
      </div>
      <div class="msg" id="un-aviso" hidden style="margin-top:10px"></div>
      <div class="msg erro" id="un-erro" hidden style="margin-top:10px"></div>
    </section>`;

  // ------------------------------------------------------------- interação
  const mostrarErro = (id, e) => {
    const caixa = el(id);
    caixa.hidden = false;
    caixa.textContent = e.message || String(e);
  };

  el('#pagina').querySelectorAll('[data-abrir]').forEach((b) => {
    b.onclick = () => { E.clienteCad = b.dataset.abrir; render(); };
  });
  el('#pagina').querySelectorAll('[data-ativar]').forEach((b) => {
    b.onclick = async () => {
      const c = clientePorId(b.dataset.ativar);
      if (!c) return;
      try {
        await Loja.gravarClientes(E.clientes.map((x) => (x.id === c.id ? { ...x, ativo: c.ativo === false } : x)));
        // Desativar o cliente aberto tiraria o chão da sessão: volta à escolha.
        if (c.id === E.clienteSel && c.ativo !== false) trocarCliente();
        else { pintarCliente(); render(); }
      } catch (e) { mostrarErro('#cl-erro', e); }
    };
  });

  const bt = el('#cl-criar');
  if (bt) bt.onclick = async () => {
    try {
      const novo = await criarClienteNovo({ nome: el('#cl-nome').value, documento: el('#cl-doc').value });
      E.clienteCad = novo.id;
      pintarCliente();
      render();
    } catch (e) { mostrarErro('#cl-erro', e); }
  };

  const btIniciais = el('#cl-iniciais');
  if (btIniciais) btIniciais.onclick = async () => {
    try { await cadastrarClientesIniciais(); pintarCliente(); render(); }
    catch (e) { mostrarErro('#cl-erro', e); }
  };

  const guardar = () => {
    E.unidadeNova = {
      tipo: el('#un-tipo').value,
      matrizPaiId: el('#un-pai') ? el('#un-pai').value : '',
      nome: el('#un-nome').value,
      codigo: el('#un-codigo').value,
      cnpj: el('#un-cnpj').value,
      endereco: el('#un-endereco').value,
      cep: el('#un-cep').value,
      uf: el('#un-uf') ? el('#un-uf').value : '',
    };
  };

  /**
   * O aviso da regra do CNPJ, atualizado no lugar enquanto se digita.
   *
   * Vem ANTES do envio porque descobrir depois, com a unidade já pendurada na
   * matriz errada, custa correção manual no organograma.
   */
  const pintarAvisoRaiz = () => {
    const caixa = el('#un-aviso');
    if (!caixa) return;
    const tipo = el('#un-tipo').value;
    const irma = matrizPelaRaiz(alvo, el('#un-cnpj').value);
    caixa.hidden = !irma;
    caixa.classList.toggle('erro', !!irma && tipo === 'MATRIZ');
    if (!irma) return (caixa.innerHTML = '');
    caixa.innerHTML = 'Este CNPJ tem a mesma raiz de <strong>' + esc(irma.nome) + '</strong>. ' +
      (tipo === 'MATRIZ'
        ? 'Unidades da mesma raiz são a mesma pessoa jurídica — o cadastro será recusado como matriz.'
        : 'A filial entrará em ' + esc(irma.nome) + '.');
  };

  el('#un-tipo').onchange = () => {
    const filial = el('#un-tipo').value === 'FILIAL';
    el('#campo-pai').hidden = !filial;
    el('#campo-uf').hidden = !filial;
    guardar();
    pintarAvisoRaiz();
  };
  // `input`, e não `change`: `change` dispara ao sair do campo, inclusive
  // quando quem sai está clicando no botão de cadastrar.
  el('#un-cnpj').oninput = pintarAvisoRaiz;
  pintarAvisoRaiz();

  const btUnidade = el('#un-criar');
  if (btUnidade) btUnidade.onclick = async () => {
    guardar();
    try {
      await criarUnidadeNoCliente(alvo, E.unidadeNova);
      E.unidadeNova = { ...UNIDADE_NOVA };
      pintarFiltrosDaTela();
      render();
    } catch (e) { mostrarErro('#un-erro', e); }
  };
}

function pintarCliente() {
  const caixa = el('#cliente-atual');
  if (!caixa) return;
  const c = clienteAtual();
  caixa.hidden = !c;
  if (!c) { caixa.innerHTML = ''; return; }
  // O botão aparece SEMPRE, inclusive com um cliente só: quem ganha acesso a
  // um segundo contratante no meio da semana precisa achar a saída sem
  // descobrir que ela só existe depois de ter dois. E ele é também o caminho
  // para a tela de seleção, onde a estrutura de cada cliente aparece.
  const unidades = E.clienteSel ? empresasDoCliente(E.clienteSel).length : 0;
  caixa.innerHTML = `<span>Cliente</span><b title="${esc(c.nome)}">${esc(c.nome)}</b>` +
    `<small>${inteiro(unidades)} unidade${unidades === 1 ? '' : 's'}</small>` +
    `<button type="button" id="bt-trocar-cliente" title="Volta à tela de seleção para escolher outro contratante">Trocar cliente</button>`;
  const bt = el('#bt-trocar-cliente');
  if (bt) bt.onclick = () => trocarCliente();
}
