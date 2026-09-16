// ===========================================================================
// Gestão de TI IARX — aplicação completa sobre o armazenamento do artifact.
// Competência interna 'AAAA-MM' (ordenável), exibida 'MM/AAAA'.
// Valores em reais; toda soma passa por centavos inteiros para não derivar.
// ===========================================================================
const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const NATUREZAS = { fixa:'Fixa', pontual_unica:'Pontual única', pontual_parcelada:'Pontual parcelada' };
const ORIGENS = {
  planilha:          { rotulo:'Planilhas do cliente', curto:'Planilha',  nota:'Linha importada das bases enviadas pelo gestor, sem alteração de valor.' },
  folha_ti:          { rotulo:'Folha de TI (rateio)', curto:'Folha',     nota:'Custo de pessoal de TI alocado ou rateado — não constava como linha nas planilhas de despesa.' },
  projecao_spincare: { rotulo:'Projeção SpinCare',    curto:'Projeção',  nota:'Mensalidade projetada do novo ERP; ainda não realizada.' },
  manual:            { rotulo:'Lançado no sistema',   curto:'Manual',    nota:'Criado ou editado por um usuário aqui dentro.' },
};
const origemDe = (l) => ORIGENS[l && l.origem] ? l.origem : 'manual';
const STATUS_PROJ = { planejado:'Planejado', em_andamento:'Em andamento', concluido:'Concluído', cancelado:'Cancelado' };
const cent = (v) => Math.round((Number(v) || 0) * 100);
const reais = (c) => c / 100;
const somaC = (xs) => xs.reduce((a, b) => a + cent(b), 0);
const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const curto = (v) => Math.abs(v) >= 1e6 ? 'R$ ' + (v/1e6).toLocaleString('pt-BR',{maximumFractionDigits:1}) + ' mi'
  : Math.abs(v) >= 1000 ? 'R$ ' + (v/1000).toLocaleString('pt-BR',{maximumFractionDigits:0}) + ' mil'
  : 'R$ ' + (v).toLocaleString('pt-BR',{maximumFractionDigits:0});
const inteiro = (v) => (Number(v)||0).toLocaleString('pt-BR');
const pct = (p, t) => t > 0 ? Math.round((p/t)*1000)/10 : 0;
const pctTxt = (v) => (Number(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1}) + '%';

const mesExib = (m) => m ? m.slice(5) + '/' + m.slice(0,4) : '';
const mesCurto = (m) => MESES[+m.slice(5)-1] + '/' + m.slice(2,4);
const mesInterno = (t) => { const x = /^(0[1-9]|1[0-2])\/(\d{4})$/.exec((t||'').trim()); return x ? x[2]+'-'+x[1] : null; };
const mesIdx = (m) => +m.slice(0,4)*12 + (+m.slice(5)-1);
const mesDe = (n) => Math.floor(n/12) + '-' + String((n%12)+1).padStart(2,'0');
const mesSoma = (m, n) => mesDe(mesIdx(m)+n);
const mesHoje = () => { const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); };
const intervalo = (a, b) => { const r=[]; for (let i=mesIdx(a); i<=mesIdx(b); i++) r.push(mesDe(i)); return r; };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const el = (sel) => document.querySelector(sel);
const novoId = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);

/** Rateio que fecha exatamente no total: o resto vai nas primeiras parcelas. */
function ratear(totalCent, n) {
  const base = Math.trunc(totalCent / n), resto = totalCent - base * n;
  return Array.from({length:n}, (_, i) => base + (i < resto ? 1 : 0));
}

// ===========================================================================
// Estado e acesso ao armazenamento
// ===========================================================================
const E = {
  db: null, pronto: false, erro: null,
  clientes: [],             // contratantes; a matriz pertence a um deles
  clienteSel: null,         // o cliente aberto; nulo = tela de boas-vindas
  clienteCad: null,         // o cliente em foco na tela de cadastro
  unidadeNova: null,        // rascunho do cadastro de unidade
  cargas: new Map(),        // empresa -> registro das importações
  mapeamentos: [],          // apelidos de cabeçalho, por cliente
  empresas: [], filiais: [], tipos: [], filas: [], cenarios: [],
  aba: 'painel',
  lanc: new Map(),          // 'empresa__comp' -> {itens:[...]}
  mesesCarregados: new Set(),
  projetos: new Map(),      // empresa -> {itens:[...]}
  sla: new Map(),           // 'empresa__comp' -> {itens:[...]}
  fechamentos: new Map(),   // empresa -> [comp]
  integracoes: new Map(),   // empresa -> [conexao]
  eventos: new Map(),       // empresa -> [evento de integração]
  usuarios: new Map(),      // empresa -> [usuario]
  perfis: new Map(),        // empresa -> [perfil de acesso]
  previa: null,             // perfil em pré-visualização, ou null
  somenteLeitura: false,    // o armazenamento recusou escrita: link compartilhado só para ver

  // Todo filtro é um conjunto. Vazio quer dizer "todos" onde isso faz sentido;
  // onde não faz (competência, cenário) o seletor impede esvaziar.
  //
  // `empresasSel` deixou de ser o recorte do sistema: o escopo agora é o
  // CLIENTE, e ela guarda as matrizes dele que estão carregadas. O recorte que
  // a pessoa escolhe é por TELA, em `filtrosTela` — mexer no filtro de uma não
  // pode recortar as outras, e a tela de Integrações (que é do contratante)
  // não pode depender de seletor de empresa nenhum.
  /** tela -> { empresas:Set, filiais:Set }. Só de sessão: recorte não é configuração. */
  filtrosTela: new Map(),
  /** Matriz EM FOCO para escrever: criar, importar e configurar precisam de uma. */
  empresaFoco: null,
  origens: new Set(),       // vazio = todas as procedências
  competencias: new Set(),
  cenarios: new Set(['oficial']),
  filtros: { tipos: new Set(), naturezas: new Set(), classificacoes: new Set(), busca:'', de:'', ate:'' },
  filtrosSla: { filas: new Set(), status: new Set(), niveis: new Set(), sla: new Set(),
                sistemas: new Set(), setores: new Set(), busca:'' },
  config: null,             // preferências da empresa (endereço do osTicket, etc.)
};

/**
 * Endereço do chamado no osTicket.
 *
 * O id interno compõe a URL (`tickets.php?id=21734`), então guardar o id no
 * registro basta para voltar ao chamado de origem. A base fica configurável
 * porque é a instalação do cliente, não um endereço fixo do sistema.
 */
// Sistemas de suporte de onde os chamados vêm. O chamado sem `sistema` é da
// carga original do osTicket, anterior à integração — daí o padrão.
const SISTEMAS_SUPORTE = { OSTICK: 'Sistema OStick', BITRIX24: 'Sistema Bitrix24' };
const sistemaDe = (r) => (SISTEMAS_SUPORTE[r && r.sistema] ? r.sistema : 'OSTICK');
const SETOR_NAO_CLASSIFICADO = 'Não classificado';
const setorDe = (r) => (r && r.setor ? r.setor : SETOR_NAO_CLASSIFICADO);

const URL_OSTICKET_PADRAO = 'https://www.suportehr.com.br/scp/tickets.php?id=';
function urlDoChamado(ticketId, sistema = 'OSTICK') {
  if (ticketId === null || ticketId === undefined || ticketId === '') return null;
  // Cada helpdesk tem o seu endereço. Sem base configurada não há link: um
  // endereço adivinhado levaria o gestor a uma página que não existe.
  const base = sistema === 'BITRIX24'
    ? (E.config && E.config.urlBitrix24) || null
    : (E.config && E.config.urlOsTicket) || URL_OSTICKET_PADRAO;
  return base ? base + encodeURIComponent(ticketId) : null;
}

/**
 * Reconhecimento da despesa pelo gestor: "eu olhei isto e assumo como meu".
 *
 * O registro sem o campo é ANTERIOR ao reconhecimento existir — e o que veio
 * por carga não foi conferido por ninguém. Ausente vale como NÃO reconhecido,
 * que é a verdade; tratá-lo como reconhecido apagaria o trabalho a fazer.
 */
const reconhecidoDe = (l) => l && l.reconhecido === true;

/**
 * A não reconhecida se destaca em toda listagem — negrito e laranja. O atributo
 * vai na linha, e o CSS pinta valor e descrição: destacar a linha inteira
 * deixaria a tabela toda gritando.
 */
const classeReconhecimento = (l) => (reconhecidoDe(l) ? '' : ' data-sem-reconhecer="1"');

/** O endereço do chamado a partir do próprio registro. */
const urlDoRegistro = (r) => (r && r.ticketId ? urlDoChamado(r.ticketId, sistemaDe(r)) : null);

/**
 * A unidade EM FOCO — aquela em que se escreve.
 *
 * Criar, importar e configurar precisam de UMA: um registro não pertence a duas
 * matrizes. Antes ela saía do filtro global ("deixe só uma marcada"), o que
 * transformava um recorte de leitura em pré-requisito de escrita — e era o que
 * travava a tela de Integrações. Agora é uma escolha própria, com a primeira
 * matriz do cliente como padrão.
 */
const empresaAtiva = () => {
  const doCliente = matrizesDoClienteAtivo();
  // Filtro da tela com UMA unidade é intenção declarada: quem deixou só a
  // MOOVE à vista está trabalhando nela, e criar em outra surpreenderia.
  const local = [...filtroDaTela().empresas].filter((id) => doCliente.includes(id));
  if (local.length === 1) return local[0];
  if (E.empresaFoco && doCliente.includes(E.empresaFoco)) return E.empresaFoco;
  return doCliente[0] || null;
};

/** Escrita exige uma unidade; sem cliente escolhido não há nenhuma. */
function exigirEmpresaUnica() {
  const e = empresaAtiva();
  if (!e) {
    throw new Error('Nenhuma unidade em foco. Escolha um cliente com ao menos uma matriz cadastrada.');
  }
  return e;
}
const nomeEmpresa = (id) => (E.empresas.find((e) => e.id === id) || {}).nome || id;

/** As matrizes do cliente aberto — o escopo de leitura de toda tela. */
function matrizesDoClienteAtivo() {
  const doCliente = E.clienteSel
    ? E.empresas.filter((e) => clienteDaEmpresa(e) === E.clienteSel)
    : E.empresas;
  return doCliente.map((e) => e.id);
}

/** O filtro LOCAL da tela em foco. Vazio significa o cliente inteiro. */
function filtroDaTela(tela = E.aba) {
  let f = E.filtrosTela.get(tela);
  if (!f) {
    f = { empresas: new Set(), filiais: new Set() };
    E.filtrosTela.set(tela, f);
  }
  return f;
}

/**
 * O escopo de leitura desta tela: o filtro local, quando há, e o cliente
 * inteiro quando não há. Nunca o banco todo — matriz de outro contratante não
 * entra nem por engano.
 */
function escopoEmpresas(tela = E.aba) {
  const doCliente = matrizesDoClienteAtivo();
  const local = [...filtroDaTela(tela).empresas].filter((id) => doCliente.includes(id));
  return local.length ? local : doCliente;
}

/** As filiais em foco NESTA tela. Vazio = todas. */
const filiaisDaTela = (tela = E.aba) => filtroDaTela(tela).filiais;

// `E.empresasSel` e `E.filiaisSel` passam a ser VISTAS do filtro da tela em
// foco. São dezenas de usos espalhados pelas telas, e trocar cada um por uma
// chamada nova só criaria oportunidade de esquecer algum — aqui a leitura e a
// escrita caem, as duas, no filtro local certo.
Object.defineProperty(E, 'empresasSel', {
  get: () => new Set(escopoEmpresas()),
  set: (v) => { filtroDaTela().empresas = new Set(v); },
});
Object.defineProperty(E, 'filiaisSel', {
  get: () => filtroDaTela().filiais,
  set: (v) => { filtroDaTela().filiais = new Set(v); },
});

const Loja = {
  async catalogos() {
    const ler = async (p) => { const s = await E.db.doc('catalogo/' + p).get(); return s.exists ? (s.data().itens || []) : []; };
    const [empresas, filiais, tipos, filas, cenarios] = await Promise.all(
      ['empresas','filiais','tipos','filas','cenarios'].map(ler));
    Object.assign(E, { empresas, filiais, tipos, filas, cenarios });
  },
  async lancDaEmpresa(empresa) {
    const snap = await E.db.collection('lanc').where('empresa','==',empresa).get();
    for (const d of snap.docs) E.lanc.set(d.id, { ...d.data() });
    E.mesesCarregados.add(empresa);
  },
  chave: (empresa, comp) => empresa + '__' + comp,
  itens(empresa, comp) { return (E.lanc.get(Loja.chave(empresa, comp)) || {}).itens || []; },
  /** Todos os lançamentos da empresa, achatados com a competência e a empresa. */
  todos(empresa) {
    const saida = [];
    for (const [k, v] of E.lanc) {
      if (!k.startsWith(empresa + '__')) continue;
      for (const it of (v.itens || [])) saida.push({ ...it, competencia: v.competencia, empresa });
    }
    return saida;
  },
  /** Lançamentos de todas as empresas selecionadas. */
  todosDoEscopo() {
    return escopoEmpresas().flatMap((e) => Loja.todos(e));
  },
  async gravarMes(empresa, comp, itens) {
    const k = Loja.chave(empresa, comp);
    const corpo = { empresa, competencia: comp, itens };
    await E.db.doc('lanc/' + k).set(corpo);
    E.lanc.set(k, corpo);
  },
  /**
   * A trilha é do CLIENTE — dimensão primária, sempre presente. `empresa` é
   * só o CONTEXTO do evento: preenchido para o que pertence a uma matriz
   * (lançamento, filial, projeto...), ausente para o que é do cliente inteiro
   * (usuário, perfil — chame com `null` nesses casos). Já foi um documento por
   * matriz; a leitura antiga (`auditoria/<empresa>`) é promovida sob demanda em
   * `viewAuditoria`, o mesmo padrão já usado para integrações e acesso.
   */
  async auditar(entrada, empresa = empresaAtiva()) {
    try {
      const obj = empresa ? E.empresas.find((e) => e.id === empresa) : null;
      const cliente = obj ? clienteDaEmpresa(obj) : E.clienteSel;
      if (!cliente) return;
      const ref = E.db.doc('auditoria/cliente__' + cliente);
      const s = await ref.get();
      const itens = s.exists ? (s.data().itens || []) : [];
      itens.unshift({ ...entrada, empresa: empresa || undefined, quando: new Date().toISOString() });
      await ref.set({ itens: itens.slice(0, 400) });   // trilha limitada, sem crescer sem fim
    } catch { /* a trilha nunca bloqueia a operação de negócio */ }
  },
  async fechamentosDa(empresa) {
    if (E.fechamentos.has(empresa)) return E.fechamentos.get(empresa);
    const s = await E.db.doc('fechamentos/' + empresa).get();
    const lista = s.exists ? (s.data().itens || []) : [];
    E.fechamentos.set(empresa, lista);
    return lista;
  },
  async gravarFechamentos(empresa, lista) {
    await E.db.doc('fechamentos/' + empresa).set({ itens: lista });
    E.fechamentos.set(empresa, lista);
  },
  async projetosDa(empresa) {
    if (E.projetos.has(empresa)) return E.projetos.get(empresa);
    const s = await E.db.doc('projetos/' + empresa).get();
    const itens = s.exists ? (s.data().itens || []) : [];
    E.projetos.set(empresa, itens);
    return itens;
  },
  async gravarProjetos(empresa, itens) {
    await E.db.doc('projetos/' + empresa).set({ itens });
    E.projetos.set(empresa, itens);
  },
  async slaDa(empresa) {
    if (E.sla.has(empresa)) return E.sla.get(empresa);
    const snap = await E.db.collection('sla').where('empresa','==',empresa).get();
    const itens = [];
    for (const d of snap.docs) for (const it of (d.data().itens || [])) itens.push({ ...it, competencia: d.data().competencia });
    E.sla.set(empresa, itens);
    return itens;
  },
  async gravarSlaMes(empresa, comp, itens) {
    await E.db.doc('sla/' + Loja.chave(empresa, comp)).set({ empresa, competencia: comp, itens });
    E.sla.delete(empresa);
  },
  // ------------------------------------------------------------ integrações
  //
  // A configuração é do CLIENTE, não da matriz: quem contrata o helpdesk é o
  // contratante, e o endereço, o segredo e o interruptor são os mesmos para
  // todas as unidades dele. Guardá-los por unidade obrigava a repetir a
  // configuração uma vez por matriz e prendia a tela a um seletor de empresa.
  //
  // A leitura ainda olha os documentos por empresa: é a MIGRAÇÃO da base que
  // já existe. A primeira gravação consolida no documento do cliente, e o
  // antigo deixa de ser consultado.
  async integracoesDa(cliente) {
    if (E.integracoes.has(cliente)) return E.integracoes.get(cliente);
    const s = await E.db.doc('integracoes/cliente__' + cliente).get();
    let itens = s.exists ? (s.data().conexoes || []) : [];
    if (!s.exists) itens = await Loja.integracoesHerdadas(cliente);
    E.integracoes.set(cliente, itens);
    return itens;
  },
  /**
   * As conexões que estavam guardadas por matriz, promovidas ao cliente.
   *
   * Duas unidades podiam ter conexão para o mesmo sistema: fica a que está EM
   * USO — a que tem segredo e, entre elas, a de evento mais recente. Descartar
   * a que nunca recebeu nada não perde nada; descartar a ativa quebraria a
   * integração em produção.
   */
  async integracoesHerdadas(cliente) {
    const porSistema = new Map();
    for (const e of (E.clientes.length ? empresasDoCliente(cliente) : E.empresas)) {
      const s = await E.db.doc('integracoes/' + e.id).get();
      if (!s.exists) continue;
      for (const c of s.data().conexoes || []) {
        const atual = porSistema.get(c.sistema);
        const melhor = !atual
          || (!atual.segredo && c.segredo)
          || (!!atual.segredo === !!c.segredo && String(c.ultimoEventoEm || '') > String(atual.ultimoEventoEm || ''));
        if (melhor) porSistema.set(c.sistema, c);
      }
    }
    return [...porSistema.values()];
  },
  async gravarIntegracoes(cliente, conexoes) {
    await E.db.doc('integracoes/cliente__' + cliente).set({ conexoes, cliente });
    E.integracoes.set(cliente, conexoes);
  },
  /**
   * O log é por UNIDADE — o chamado é sempre de uma, porque cada unidade tem a
   * própria instância do helpdesk — e a tela soma as do cliente.
   */
  async eventosDa(empresa) {
    if (E.eventos.has(empresa)) return E.eventos.get(empresa);
    const s = await E.db.doc('eventos-integracao/' + empresa).get();
    const itens = s.exists ? (s.data().itens || []) : [];
    E.eventos.set(empresa, itens);
    return itens;
  },
  /** Todos os eventos do cliente, com a unidade em cada linha. */
  async eventosDoCliente(cliente) {
    const saida = [];
    for (const e of empresasDoCliente(cliente)) {
      for (const ev of await Loja.eventosDa(e.id)) saida.push({ ...ev, empresa: e.id });
    }
    return saida.sort((a, b) => String(b.quando || '').localeCompare(String(a.quando || '')));
  },
  async gravarEventos(empresa, itens) {
    await E.db.doc('eventos-integracao/' + empresa).set({ itens });
    E.eventos.set(empresa, itens);
  },
  // ----------------------------------------------------------------- acesso
  //
  // Usuário e perfil são do CLIENTE, não da matriz: a permissão vale em toda
  // unidade dele. Já foram por empresa — mesma migração-por-leitura das
  // integrações (ver `integracoesDa`/`integracoesHerdadas` acima): o documento
  // do cliente é consultado primeiro, e só na ausência dele os documentos
  // antigos por matriz são promovidos e consolidados.
  async usuariosDoCliente(cliente) {
    if (E.usuarios.has(cliente)) return E.usuarios.get(cliente);
    const s = await E.db.doc('usuarios/cliente__' + cliente).get();
    let itens = s.exists ? (s.data().itens || []) : [];
    if (!s.exists) itens = await Loja.usuariosHerdados(cliente);
    E.usuarios.set(cliente, itens);
    return itens;
  },
  /**
   * Usuários que estavam por matriz, promovidos ao cliente.
   *
   * A mesma pessoa podia estar cadastrada em mais de uma matriz do mesmo
   * cliente, com papéis diferentes — nunca deveria, mas o cadastro antigo não
   * impedia. Uma linha por e-mail, e o papel mais permissivo vence: perder
   * acesso que alguém já tinha na migração seria pior que duplicar.
   */
  async usuariosHerdados(cliente) {
    const porEmail = new Map();
    for (const e of empresasDoCliente(cliente)) {
      const s = await E.db.doc('usuarios/' + e.id).get();
      for (const u of (s.exists ? (s.data().itens || []) : [])) {
        const atual = porEmail.get(u.email);
        const vence = !atual || (atual.perfil !== 'gestor' && u.perfil === 'gestor');
        if (vence) porEmail.set(u.email, u);
      }
    }
    return [...porEmail.values()];
  },
  async gravarUsuarios(cliente, itens) {
    await E.db.doc('usuarios/cliente__' + cliente).set({ itens, cliente });
    E.usuarios.set(cliente, itens);
  },
  async perfisDoCliente(cliente) {
    if (E.perfis.has(cliente)) return E.perfis.get(cliente);
    const s = await E.db.doc('perfis/cliente__' + cliente).get();
    let itens = s.exists ? (s.data().itens || []) : [];
    if (!s.exists) itens = await Loja.perfisHerdados(cliente);
    E.perfis.set(cliente, itens);
    return itens;
  },
  /**
   * Perfis por matriz, promovidos ao cliente.
   *
   * Os dois perfis PADRÃO de cada matriz mesclam num só por nome: a
   * permissão é a UNIÃO das cópias (o padrão é negar, então unir nunca tira
   * acesso de quem já tinha). Perfis CUSTOMIZADOS nunca mesclam entre si —
   * mesmo nome em duas matrizes é coincidência, não a mesma coisa — e ganham
   * sufixo da matriz de origem se colidirem com o nome escolhido.
   */
  async perfisHerdados(cliente) {
    const porNomePadrao = new Map();
    const customizados = [];
    for (const e of empresasDoCliente(cliente)) {
      const s = await E.db.doc('perfis/' + e.id).get();
      for (const p of (s.exists ? (s.data().itens || []) : [])) {
        if (!p.padrao) { customizados.push({ ...p, origemMatriz: e.id }); continue; }
        const atual = porNomePadrao.get(p.nome);
        if (!atual) { porNomePadrao.set(p.nome, { ...p, id: novoId() }); continue; }
        for (const mod of Object.keys(p.permissoes || {})) {
          atual.permissoes[mod] = atual.permissoes[mod] || {};
          for (const acao of Object.keys(p.permissoes[mod] || {})) {
            atual.permissoes[mod][acao] = atual.permissoes[mod][acao] || p.permissoes[mod][acao];
          }
        }
      }
    }
    const nomesUsados = new Set([...porNomePadrao.values()].map((p) => p.nome));
    const finalCustom = [];
    for (const p of customizados) {
      let nome = p.nome;
      if (nomesUsados.has(nome)) nome = `${p.nome} — ${nomeEmpresa(p.origemMatriz)}`;
      nomesUsados.add(nome);
      finalCustom.push({ ...p, id: novoId(), origemMatriz: undefined, nome });
    }
    return [...porNomePadrao.values(), ...finalCustom];
  },
  async gravarPerfis(cliente, itens) {
    await E.db.doc('perfis/cliente__' + cliente).set({ itens, cliente });
    E.perfis.set(cliente, itens);
  },
  async gravarCatalogo(nome, itens) {
    await E.db.doc('catalogo/' + nome).set({ itens });
    E[nome] = itens;
  },
  async configuracao() {
    if (E.config) return E.config;
    const s = await E.db.doc('catalogo/config').get();
    E.config = s.exists ? (s.data() || {}) : {};
    return E.config;
  },
  async gravarConfiguracao(valores) {
    const novo = { ...(E.config || {}), ...valores };
    await E.db.doc('catalogo/config').set(novo);
    E.config = novo;
  },
};

/**
 * O fechamento é gravado como {comp, quando} para a trilha saber quando foi,
 * mas versões antigas guardaram a competência solta. Quem consulta precisa
 * aceitar as duas formas — comparar o registro inteiro com a string faz o
 * bloqueio nunca disparar, e o fechamento vira enfeite.
 */
const compDoFechamento = (f) => (f && typeof f === 'object' ? f.comp : f);
function competenciaFechada(empresa, comp) {
  return (E.fechamentos.get(empresa) || []).some((f) => compDoFechamento(f) === comp);
}

/** Competência fechada bloqueia escrita; passada exige justificativa. */
function checarCompetencia(comp, justificativa, empresa = empresaAtiva()) {
  if (competenciaFechada(empresa, comp)) {
    throw new Error('A competência ' + mesExib(comp) + ' está fechada. Reabra-a para alterar.');
  }
  if (comp < mesHoje() && !String(justificativa || '').trim()) {
    throw new Error('Alterações em competências passadas (' + mesExib(comp) + ') exigem justificativa.');
  }
}

// ===========================================================================
// Blocos que abrem e fecham
// ===========================================================================
// A tela ganhou muitos blocos, e abrir todos de uma vez enterrava o que importa
// numa rolagem longa. Agora cada um abre FECHADO e quem usa escolhe o que ver.
//
// A conversão acontece depois do `render()`, percorrendo a página — e não
// dentro de cada view. São 51 blocos em 12 arquivos: fazer um por um seria
// convidar o próximo bloco a nascer sem a dobra.
//
// O que fica guardado é a exceção ao padrão: só o bloco que alguém ABRIU ocupa
// espaço, e um bloco novo nasce fechado como os outros, sem cadastro nenhum.
const CHAVE_BLOCOS = 'iarx-blocos-abertos';

function blocosAbertos() {
  try { return new Set(JSON.parse(localStorage.getItem(CHAVE_BLOCOS) || '[]')); }
  catch (e) { return new Set(); }
}
function gravarBlocosAbertos(conjunto) {
  try { localStorage.setItem(CHAVE_BLOCOS, JSON.stringify([...conjunto])); }
  catch (e) { /* sem armazenamento: vale só nesta sessão */ }
}

/** Chave estável a partir do título do bloco. */
function chaveDoBloco(titulo) {
  const limpo = String(titulo || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return limpo ? 'bloco-' + limpo.slice(0, 60) : null;
}

function aplicarDobra(bloco, aberto) {
  const bt = bloco.querySelector(':scope > header .bloco-dobra');
  const corpo = bloco.querySelector(':scope > .bloco-corpo');
  if (bt) {
    bt.setAttribute('aria-expanded', String(aberto));
    bt.title = aberto ? 'Recolher' : 'Expandir';
    const seta = bt.querySelector('.bloco-seta');
    if (seta) seta.textContent = aberto ? '−' : '+';
  }
  if (corpo) corpo.hidden = !aberto;
  bloco.classList.toggle('dobrado', !aberto);
}

/**
 * Converte todo `section.bloco` da página num acordeão fechado.
 *
 * O conteúdo é EMBRULHADO, não reescrito: os elementos continuam sendo os
 * mesmos objetos, então os manipuladores que a view pendurou neles seguem
 * valendo depois da mudança.
 */
function dobrarBlocos(raiz) {
  const area = raiz || el('#pagina');
  if (!area) return;
  const abertos = blocosAbertos();

  area.querySelectorAll('section.bloco').forEach((bloco) => {
    if (bloco.dataset.dobra) return;                   // já convertido
    const cab = bloco.querySelector(':scope > header');
    const h2 = cab && cab.querySelector('h2');
    if (!h2) return;                                   // sem título não há onde clicar
    const chave = chaveDoBloco(h2.textContent);
    if (!chave) return;
    bloco.dataset.dobra = chave;

    const corpo = document.createElement('div');
    corpo.className = 'bloco-corpo';
    while (cab.nextSibling) corpo.appendChild(cab.nextSibling);
    bloco.appendChild(corpo);

    // O botão vai DENTRO do h2: o cabeçalho tem outros botões, e botão dentro
    // de botão não é HTML válido.
    const rotulo = h2.innerHTML;
    h2.innerHTML = '';
    const bt = document.createElement('button');
    bt.type = 'button';
    bt.className = 'bloco-dobra';
    bt.innerHTML = '<span class="bloco-seta" aria-hidden="true">+</span>' + rotulo;
    h2.appendChild(bt);

    aplicarDobra(bloco, abertos.has(chave));
    bt.onclick = () => {
      const atuais = blocosAbertos();
      const vai = !atuais.has(chave);
      if (vai) atuais.add(chave); else atuais.delete(chave);
      gravarBlocosAbertos(atuais);
      aplicarDobra(bloco, vai);
    };
  });
}

/** Abre um bloco pela chave — usado por quem precisa levar a pessoa até ele. */
function abrirBloco(chave) {
  const atuais = blocosAbertos();
  atuais.add(chave);
  gravarBlocosAbertos(atuais);
  const bloco = document.querySelector(`.bloco[data-dobra="${chave}"]`);
  if (bloco) aplicarDobra(bloco, true);
}

const filiaisDa = (e) => E.filiais.filter((f) => f.empresa === e);
const tiposDa = (e) => E.tipos.filter((t) => t.empresa === e);
const filasDa = (e) => E.filas.filter((f) => f.empresa === e);
const cenariosDa = (e) => [{ chave:'oficial', nome:'Oficial' }, ...E.cenarios.filter((c) => c.empresa === e)];

/** União dos catálogos das empresas selecionadas, sem repetir nome. */
function unicoPorNome(lista, chave = 'nome') {
  const vistos = new Map();
  for (const item of lista) if (!vistos.has(item[chave])) vistos.set(item[chave], item);
  return [...vistos.values()].sort((a, b) => String(a[chave]).localeCompare(String(b[chave]), 'pt-BR'));
}
const filiaisDoEscopo = () => unicoPorNome(escopoEmpresas().flatMap(filiaisDa));
const tiposDoEscopo = () => unicoPorNome(escopoEmpresas().flatMap(tiposDa));
const filasDoEscopo = () => unicoPorNome(escopoEmpresas().flatMap(filasDa));
const cenariosDoEscopo = () => unicoPorNome(escopoEmpresas().flatMap(cenariosDa), 'chave');
