// ===========================================================================
// Carga de dados: modo, registro e adaptador de cabeçalho
// ===========================================================================
// Três coisas que a importação precisava e não tinha:
//
// 1. DIZER SE A CARGA É O HISTÓRICO OU O ARQUIVO DO MÊS. A carga inicial sobre
//    um módulo que já tem dado quase sempre é engano de quem escolheu o modo.
// 2. DEIXAR RASTRO. Toda tentativa entra no registro — inclusive a recusada,
//    que é justamente a que alguém vai investigar depois.
// 3. ACEITAR O CABEÇALHO DO CLIENTE. Onde o modelo diz `Valor`, a planilha de
//    um contratante diz `Vlr Total`. O apelido é dele, e não vale para outro.

/** Quantos registros o módulo já tem — é o que decide se a carga é inicial. */
function jaTemDados(empresa, modulo) {
  if (modulo === 'sla') return (E.sla.get(empresa) || []).length;
  if (modulo === 'projetos') return (E.projetos.get(empresa) || []).length;
  return Loja.todos(empresa).length;
}

Object.assign(Loja, {
  async cargasDa(empresa) {
    const s = await E.db.doc('importacoes/' + empresa).get();
    return s.exists ? (s.data().itens || []) : [];
  },
  async gravarCargas(empresa, itens) {
    // O registro é curto por desenho: guarda as últimas cargas, não o histórico
    // eterno. O que interessa é a investigação recente.
    await E.db.doc('importacoes/' + empresa).set({ itens: itens.slice(0, 100) });
    E.cargas.set(empresa, itens.slice(0, 100));
  },
  async mapeamentosTodos() {
    const s = await E.db.doc('catalogo/mapeamentos').get();
    return s.exists ? (s.data().itens || []) : [];
  },
  async gravarMapeamentos(itens) {
    await E.db.doc('catalogo/mapeamentos').set({ itens });
    E.mapeamentos = itens;
  },
});

/**
 * Grava a linha do registro de carga.
 *
 * Nunca derruba a importação: um registro que falha ao ser gravado não pode
 * desfazer o dado que entrou. O que ele pode é faltar — e é por isso que a
 * falha vai para o console, e não para o silêncio.
 */
async function registrarCarga(empresa, dados) {
  try {
    const itens = await Loja.cargasDa(empresa);
    itens.unshift({
      id: novoId(),
      quando: new Date().toISOString(),
      modulo: dados.modulo || 'completo',
      modo: dados.modo === 'inicial' ? 'inicial' : 'incremental',
      status: dados.status,
      mensagem: dados.mensagem || null,
      arquivo: dados.arquivo || null,
      lidas: dados.lidas || 0,
      criadas: dados.criadas || 0,
      duplicadas: dados.duplicadas || 0,
      invalidas: dados.invalidas || 0,
      erros: (dados.erros || []).slice(0, 200),
    });
    await Loja.gravarCargas(empresa, itens);
  } catch (e) {
    console.warn('Não foi possível registrar a carga:', e && e.message);
  }
}

async function cargasDaEmpresa(empresa) {
  if (E.cargas.has(empresa)) return E.cargas.get(empresa);
  const itens = await Loja.cargasDa(empresa);
  E.cargas.set(empresa, itens);
  return itens;
}

// ------------------------------------------------------------- adaptador

async function carregarMapeamentos() {
  E.mapeamentos = await Loja.mapeamentosTodos();
  return E.mapeamentos;
}

/** Os apelidos do cliente para uma aba, no formato que `mapearColunas` usa. */
function apelidosDoCliente(clienteId, aba) {
  const saida = {};
  for (const m of E.mapeamentos || []) {
    if (m.cliente !== clienteId || m.aba !== aba) continue;
    (saida[m.coluna] = saida[m.coluna] || []).push(m.apelido);
  }
  return saida;
}

async function criarMapeamento(clienteId, dados) {
  const aba = String(dados.aba || '').trim();
  const coluna = String(dados.coluna || '').trim();
  const apelido = String(dados.apelido || '').trim();
  const def = ABAS_MODELO[aba];
  if (!def) throw new Error('A aba "' + aba + '" não faz parte do modelo.');
  if (!def.colunas.includes(coluna)) {
    throw new Error('A aba ' + aba + ' não tem a coluna "' + coluna + '".');
  }
  if (!apelido) throw new Error('Informe o cabeçalho usado na planilha do cliente.');
  // Apelido que já é o nome de OUTRA coluna faria o dado entrar na coluna
  // errada — e sem erro nenhum, que é o pior jeito de errar.
  const conflito = def.colunas.find(
    (c) => c !== coluna && normalizarCabecalho(c) === normalizarCabecalho(apelido),
  );
  if (conflito) throw new Error('"' + apelido + '" já é o nome da coluna "' + conflito + '" nesta aba.');

  const existente = (E.mapeamentos || []).find(
    (m) => m.cliente === clienteId && m.aba === aba && normalizarCabecalho(m.apelido) === normalizarCabecalho(apelido),
  );
  if (existente) {
    if (existente.coluna === coluna) return existente;
    throw new Error('"' + apelido + '" já aponta para a coluna "' + existente.coluna + '" nesta aba.');
  }
  const novo = { id: novoId(), cliente: clienteId, aba, coluna, apelido };
  await Loja.gravarMapeamentos([...(E.mapeamentos || []), novo]);
  return novo;
}

async function removerMapeamento(id) {
  await Loja.gravarMapeamentos((E.mapeamentos || []).filter((m) => m.id !== id));
}
