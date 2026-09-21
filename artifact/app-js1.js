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
  metas: [],                // alvos dos indicadores, por cliente
  slasCad: [],              // acordos de SLA (horas por tópico e prioridade), por unidade
  reducao: [],              // plano de redução: despesa escolhida e valor-alvo, por cliente
  reconhecedores: [],       // quem, na origem, lança despesa que já chega conferida
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

/**
 * Quem CONSOME o que a filial PAGA.
 *
 * O lançamento sempre soube quem pagou; nunca soube quem usou. Uma matriz que
 * centraliza licenças para seis filiais aparecia como a unidade cara, e as
 * filiais que consomem, como baratas — o número certo contando a história
 * errada.
 *
 * O registro sem o campo é ANTERIOR à pergunta existir, e vale como 'integral':
 * é a leitura que o sistema fazia antes, então nenhum número muda.
 *
 * As beneficiadas são NOMES de filial, e não ids, porque é assim que a filial
 * existe neste modelo (ver `filiaisDoEscopo`, que já unifica por nome).
 */
const consumoDe = (l) => (l && l.tipoConsumo === 'compartilhado' ? 'compartilhado' : 'integral');
const beneficiadasDe = (l) => (Array.isArray(l && l.beneficiadas) ? l.beneficiadas : []);

const ROTULO_CONSUMO = { integral:'100% da filial', compartilhado:'Beneficia outras' };

/**
 * A frase curta da célula.
 *
 * Com "todas" marcado, a frase é a INTENÇÃO e não a lista: foi o que a pessoa
 * escolheu, e catorze nomes não cabem numa célula nem informam mais.
 */
function resumoConsumo(l) {
  if (consumoDe(l) === 'integral') return ROTULO_CONSUMO.integral;
  if (l.beneficiaTodas) return 'Beneficia todas as filiais do grupo';
  const nomes = beneficiadasDe(l);
  if (!nomes.length) return ROTULO_CONSUMO.compartilhado;
  if (nomes.length <= 2) return 'Beneficia ' + nomes.join(' e ');
  return 'Beneficia ' + nomes.length + ' filiais';
}

/**
 * METAS — o alvo contra o qual cada indicador é lido.
 *
 * Antes, o único alvo era `META_SLA = 80` escrito à mão aqui e em mais dois
 * arquivos. Agora é cadastro, e o 80 sobrevive como PADRÃO: uma base sem
 * nenhuma meta continua com o termômetro de sempre.
 *
 * A direção é propriedade do módulo, e não escolha de quem cadastra: SLA e
 * entrega no prazo são piso, variação de custo e equilíbrio são teto. Sem
 * isso, um custo acima da meta seria pintado de verde.
 */
const MODULOS_META = ['financeiro', 'sla', 'projetos', 'equilibrio'];
const ROTULO_MODULO_META = { financeiro:'Financeiro', sla:'SLA', projetos:'Projetos', equilibrio:'Equilíbrio de despesas' };
const ALVO_PADRAO = { sla: 80, projetos: 80, financeiro: null, equilibrio: null };
const DIRECAO_META = { sla:'minimo', projetos:'minimo', financeiro:'maximo', equilibrio:'maximo' };

/** As metas do cliente aberto. Entre duas vigentes ganha a de início mais recente. */
function metaVigente(modulo, competencia) {
  const doCliente = (E.metas || []).filter((m) =>
    m && m.modulo === modulo && m.ativo !== false && (!m.cliente || m.cliente === E.clienteSel));
  const vale = (m) =>
    (!m.vigenciaInicio || !competencia || m.vigenciaInicio <= competencia) &&
    (!m.vigenciaFim || !competencia || m.vigenciaFim >= competencia);
  // A meta sem início ("desde sempre") é o alvo genérico: só vale onde nenhum
  // específico alcança, e por isso desce para o fim da ordem.
  const vigentes = doCliente.filter(vale)
    .sort((a, b) => String(b.vigenciaInicio || '').localeCompare(String(a.vigenciaInicio || '')));
  return vigentes[0] || null;
}

const alvoDe = (modulo, competencia) => {
  const m = metaVigente(modulo, competencia);
  return m ? Number(m.alvoPct) : (ALVO_PADRAO[modulo] ?? null);
};

/**
 * As metas que regem os meses dados, da mais antiga para a mais nova.
 *
 * Existe porque um recorte é um PERÍODO, e o cadastro tem vigência: pedir
 * 01/2026 a 01/2027 pode atravessar duas metas. Escolher uma só — como o
 * sistema fazia, pegando a do último mês — julgava treze meses por uma regra
 * que valia para cinco, e a outra meta sumia da tela sem explicação.
 */
function metasDoRecorte(modulo, competencias) {
  const vistas = new Map();
  for (const c of competencias) {
    const m = metaVigente(modulo, c);
    if (!m) continue;
    const chave = m.nome + '\u0000' + m.alvoPct + '\u0000' + (m.vigenciaInicio || '');
    if (!vistas.has(chave)) vistas.set(chave, m);
  }
  return [...vistas.values()].sort((a, b) =>
    String(a.vigenciaInicio || '').localeCompare(String(b.vigenciaInicio || '')));
}

/**
 * O resultado contra a meta, mês a mês.
 *
 * `pontos` são `{comp, valor}` — um por competência do recorte, com o valor que
 * aquele mês atingiu. Cada um é medido contra a meta que rege AQUELE mês, que é
 * a única leitura honesta quando o período atravessa vigências.
 *
 * Quando o recorte inteiro cai sob uma meta só (o caso comum), devolve a mesma
 * leitura de sempre e a tela não muda de forma. Quando atravessa, devolve o
 * placar — "9 de 13 meses dentro" — e a lista das metas envolvidas.
 */
function leituraMensalDeMeta(modulo, pontos, totalAtingido) {
  const comMeta = pontos.filter((p) => p && p.comp);
  const metas = metasDoRecorte(modulo, comMeta.map((p) => p.comp));

  // Zero ou uma meta: nada muda. Uma comparação única continua sendo a leitura
  // certa, e trocá-la por um placar de meses seria perder informação.
  if (metas.length <= 1) {
    const comp = comMeta.length ? comMeta[comMeta.length - 1].comp : null;
    return leituraDeMeta(alvoDe(modulo, comp), totalAtingido, modulo);
  }

  const direcao = DIRECAO_META[modulo];
  const meses = comMeta
    .filter((p) => p.valor !== null && p.valor !== undefined)
    .map((p) => {
      const alvo = alvoDe(modulo, p.comp);
      if (alvo === null || alvo === undefined) return null;
      const bruto = direcao === 'minimo' ? p.valor - alvo : alvo - p.valor;
      return { comp: p.comp, alvo, valor: p.valor, atinge: bruto >= 0 };
    })
    .filter(Boolean);

  const dentro = meses.filter((m) => m.atinge).length;
  return {
    varias: true, metas, meses, dentro, total: meses.length, direcao,
    // `atinge` só quando TODOS os meses atingiram: o indicador é do período, e
    // dizer "atingiu" com um mês fora seria arredondar a favor.
    atinge: meses.length > 0 && dentro === meses.length,
  };
}

/**
 * O resultado lido contra o alvo. `null` quando não há meta — o indicador
 * continua mostrando o número, só não mostra a comparação. Inventar um alvo
 * para ter o que comparar seria pior do que não comparar.
 */
function leituraDeMeta(alvo, atingido, modulo) {
  if (alvo === null || alvo === undefined) return null;
  const direcao = DIRECAO_META[modulo];
  if (atingido === null || atingido === undefined) return { alvo, atingido:null, direcao, atinge:false, distancia:null };
  const bruto = direcao === 'minimo' ? atingido - alvo : alvo - atingido;
  return { alvo, atingido, direcao, atinge: bruto >= 0, distancia: Math.round(bruto * 10) / 10 };
}

/** A frase longa, para dica e ficha: aqui a lista cabe. */
function detalheConsumo(l) {
  if (consumoDe(l) === 'integral') return 'O custo é todo da filial que paga.';
  const nomes = beneficiadasDe(l);
  if (l.beneficiaTodas) {
    return nomes.length
      ? 'Paga por esta filial, consumido por todas as filiais do grupo: ' + nomes.join(', ') + '.'
      : 'Paga por esta filial, consumido por todas as filiais do grupo.';
  }
  return nomes.length
    ? 'Paga por esta filial, consumido por: ' + nomes.join(', ') + '.'
    : 'Paga por esta filial, com beneficiadas não informadas.';
}

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
    const [empresas, filiais, tipos, filas, cenarios, metas, slasCad, reducao, reconhecedores] = await Promise.all(
      ['empresas','filiais','tipos','filas','cenarios','metas','slasCad','reducao','reconhecedores'].map(ler));
    Object.assign(E, { empresas, filiais, tipos, filas, cenarios, metas, slasCad, reducao, reconhecedores });
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

    // Sem escolha guardada, vale o padrão do bloco. Quase todo bloco abre
    // FECHADO ("a tela abre enxuta"); o módulo dos Indicadores Gerais é a
    // exceção declarada: fechado, a tela seria três títulos e nada mais, e o
    // agrupamento que ele existe para mostrar não apareceria.
    const padraoAberto = bloco.dataset.dobraPadrao === 'aberto';
    aplicarDobra(bloco, abertos.has(chave) || (padraoAberto && !abertos.has('!' + chave)));
    bt.onclick = () => {
      const atuais = blocosAbertos();
      const aberto = bt.getAttribute('aria-expanded') === 'true';
      const vai = !aberto;
      // Guarda-se sempre a EXCEÇÃO ao padrão: a chave crua quando o bloco está
      // aberto contra um padrão fechado, e `!chave` quando está fechado contra
      // um padrão aberto. Sem a segunda, fechar um bloco que nasce aberto não
      // teria como ser lembrado.
      atuais.delete(chave);
      atuais.delete('!' + chave);
      if (vai !== padraoAberto) atuais.add(vai ? chave : '!' + chave);
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

// --------------------------------------------------------------- escopo da operação
//
// O escopo de IMPORTAR e EXPORTAR, que não é o filtro de uma tela.
//
// Antes, toda operação de arquivo era de UMA matriz: quem exportava escolhia a
// unidade e repetia a operação para cada empresa do cliente. Agora o padrão é o
// cliente inteiro, e restringir é a exceção que a pessoa escolhe:
//
//   cliente   — todas as matrizes e filiais do cliente ativo (o padrão)
//   empresas  — as matrizes marcadas, com as filiais delas junto
//   unidades  — matrizes e/ou filiais marcadas uma a uma
//
// O MESMO estado serve às duas operações: mudar o escopo para exportar e
// esquecer de mudá-lo para importar é justamente o engano que isso evita.
const CHAVE_ESCOPO_OP = 'iarx-escopo-operacao';

function escopoOperacao() {
  const vazio = { modo: 'cliente', empresas: [], filiais: [] };
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_ESCOPO_OP) || 'null');
    if (!bruto || !['cliente', 'empresas', 'unidades'].includes(bruto.modo)) return vazio;
    return {
      modo: bruto.modo,
      empresas: Array.isArray(bruto.empresas) ? bruto.empresas : [],
      filiais: Array.isArray(bruto.filiais) ? bruto.filiais : [],
    };
  } catch {
    // Aba anônima, armazenamento bloqueado, dado corrompido: o padrão vale e a
    // tela abre. Escopo lembrado é conveniência, não requisito.
    return vazio;
  }
}

function gravarEscopoOperacao(escopo) {
  try { localStorage.setItem(CHAVE_ESCOPO_OP, JSON.stringify(escopo)); } catch { /* ver acima */ }
}

/** As matrizes atingidas pelo escopo — nunca fora do cliente ativo. */
function empresasDoEscopoOp(escopo = escopoOperacao()) {
  const doCliente = matrizesDoClienteAtivo();
  if (escopo.modo === 'cliente') return doCliente;
  const marcadas = new Set((escopo.empresas || []).filter((id) => doCliente.includes(id)));
  // Filial marcada puxa a matriz dela: sem isso a linha filha ficaria fora.
  if (escopo.modo === 'unidades') {
    for (const id of escopo.filiais || []) {
      const f = E.filiais.find((x) => x.id === id);
      if (f && doCliente.includes(f.empresa)) marcadas.add(f.empresa);
    }
  }
  return marcadas.size ? [...marcadas] : doCliente;
}

/** As filiais atingidas. Vazio significa TODAS as das matrizes acima. */
function filiaisDoEscopoOp(escopo = escopoOperacao()) {
  if (escopo.modo !== 'unidades') return [];
  const permitidas = new Set(empresasDoEscopoOp(escopo));
  return (escopo.filiais || []).filter((id) => {
    const f = E.filiais.find((x) => x.id === id);
    return f && permitidas.has(f.empresa);
  });
}

/** "3 empresas, 12 filiais" — o contador da tela e o texto do registro. */
function resumoEscopoOp(escopo = escopoOperacao()) {
  // Modo explícito e nada marcado: o escopo cai no cliente inteiro para não
  // ficar vazio, mas dizer "5 empresas" aí seria mentir sobre o que a pessoa
  // escolheu. O botão da operação recusa nesse estado; o texto explica por quê.
  if (escopo.modo !== 'cliente' && !escopoOpCompleto(escopo)) return 'nenhuma unidade marcada';
  const empresas = empresasDoEscopoOp(escopo);
  const marcadas = filiaisDoEscopoOp(escopo);
  const filiais = marcadas.length ? marcadas.length : empresas.flatMap(filiaisDa).length;
  const parte = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  return `${parte(empresas.length, 'empresa', 'empresas')}, ${parte(filiais, 'filial', 'filiais')}`;
}

/** O escopo está pronto para operar? Marcar o modo e não marcar nada, não está. */
function escopoOpCompleto(escopo = escopoOperacao()) {
  if (escopo.modo === 'cliente') return true;
  return (escopo.empresas || []).length > 0 || (escopo.filiais || []).length > 0;
}

// ------------------------------------------------------------- cor por matriz
//
// Um indicador consolidado some com a origem do número: R$ 2 milhões não diz
// quanto é de qual matriz. A cor devolve essa leitura sem quebrar o
// consolidado — o valor segue somado, e a faixa embaixo dele mostra a divisão.
//
// A cor vem da POSIÇÃO da matriz na lista ordenada por nome, e não do id. Pelo
// id, cadastrar uma empresa nova trocaria a cor de todas as outras; pela
// posição, ela é estável entre telas enquanto o cadastro não mudar. A ordem é
// por nome porque é essa a ordem em que a pessoa vê as matrizes nos seletores.
//
// São oito. Da nona em diante, "Outras" — inventar uma nona cor daria duas
// indistinguíveis, e duas cores parecidas mentem mais do que uma faixa cinza.
const CORES_MATRIZ = 8;

function ordemDasMatrizes() {
  return [...matrizesDoClienteAtivo()]
    .map((id) => ({ id, nome: String(nomeEmpresa(id)) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .map((e) => e.id);
}

/** A cor desta matriz. Fora das oito primeiras, a cor de "Outras". */
function corDaMatriz(empresaId) {
  const i = ordemDasMatrizes().indexOf(empresaId);
  return i >= 0 && i < CORES_MATRIZ ? `var(--m${i + 1})` : 'var(--tinta3)';
}

/**
 * A mesma cor da matriz, em tom mais ESCURO: a despesa que ela paga e o grupo
 * consome.
 *
 * Escurecer em vez de trocar de cor é o que mantém a leitura: a unidade
 * continua reconhecível pela cor dela, e o tom diz que aquele custo não é só
 * dela. Duas cores diferentes fariam parecer duas empresas.
 *
 * 68% é o ponto que preserva contraste de componente (≥3:1) contra `--sup`
 * nos dois temas — no escuro, misturar mais preto apagaria o segmento.
 * `color-mix` já é o idioma de derivação de tom desta folha de estilo.
 */
function corCompartilhada(empresaId) {
  return `color-mix(in srgb, ${corDaMatriz(empresaId)} 68%, #000)`;
}

/**
 * A etiqueta de consumo de um lançamento, igual em toda tela do financeiro.
 *
 * Uma redação por tela seriam três chances de parecerem dados diferentes —
 * e, agora que há cor, três chances de a mesma despesa aparecer em tons
 * diferentes. Lançamento próprio não recebe etiqueta: é o caso comum, e
 * etiquetar o comum faz a tabela gritar sem informar.
 */
function etiquetaConsumoHtml(l) {
  if (consumoDe(l) !== 'compartilhado') return '<span style="color:var(--tinta3)">—</span>';
  return `<span class="tag compartilhada" style="--cor:${corCompartilhada(l.empresa)}">`
    + `<i></i>${esc(resumoConsumo(l))}</span>`;
}

/**
 * A faixa que divide o número por matriz.
 *
 * Com uma matriz só ela não aparece: não haveria o que distinguir, e uma barra
 * de cor única viraria enfeite. Fatia de valor zero também sai — um segmento
 * sem largura não é visível, e listá-lo na legenda faria procurar na faixa uma
 * cor que não está lá.
 */
function faixaDeMatrizesHtml(fatias) {
  const visiveis = fatias.filter((f) => f.valor > 0);
  if (visiveis.length < 2) return '';
  return `<span class="faixa-matrizes" aria-hidden="true">${visiveis
    .map((f) => `<i style="background:${f.cor};flex-grow:${f.valor}" title="${esc(f.nome)}: ${esc(f.texto)}"></i>`)
    .join('')}</span>`;
}

/** A legenda da faixa. O nome é o canal que não depende de enxergar cor. */
function legendaDeMatrizesHtml(fatias) {
  const visiveis = fatias.filter((f) => f.valor > 0);
  if (visiveis.length < 2) return '';
  return `<div class="legenda-matrizes">${visiveis
    .map((f) => `<span><i style="background:${f.cor}"></i>${esc(f.nome)} · ${esc(f.texto)}</span>`)
    .join('')}</div>`;
}

/**
 * A legenda fixa dos dois tons: próprio e compartilhado.
 *
 * Vai no bloco que usa a distinção, e não uma vez na tela: quem rola até o
 * meio de uma tela longa precisa da chave de leitura ali, não lá em cima. A
 * amostra sai da cor de uma matriz de verdade — a da primeira fatia — porque
 * uma amostra cinza não ensinaria a ler as cores que estão logo ao lado.
 */
function legendaDeConsumoHtml(corBase) {
  const base = corBase || 'var(--m1)';
  const escura = `color-mix(in srgb, ${base} 68%, #000)`;
  return `<div class="legenda-matrizes legenda-consumo">
    <span><i style="background:${base}"></i>tom da unidade · despesa 100% dela</span>
    <span><i style="background:${escura}"></i>tom escurecido · paga por ela, consumida pelo grupo</span>
  </div>`;
}
