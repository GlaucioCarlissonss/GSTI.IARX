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
  // onde não faz (empresa, competência, cenário) o seletor impede esvaziar.
  empresasSel: new Set(),
  filiaisSel: new Set(),    // vazio = todas; '(empresa)' é o nível sem filial
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
 * Empresa em que se escreve. Criar, editar e excluir precisam de uma só — com
 * várias selecionadas o sistema não teria como saber a quem o registro pertence.
 */
const empresaAtiva = () => (E.empresasSel.size === 1 ? [...E.empresasSel][0] : null);

/** Escrita exige uma empresa só; sem isso o registro não teria dono. */
function exigirEmpresaUnica() {
  const e = empresaAtiva();
  if (!e) {
    throw new Error('Há ' + E.empresasSel.size + ' empresas selecionadas. ' +
      'Para criar ou alterar registros, deixe apenas uma marcada no seletor Empresa.');
  }
  return e;
}
const nomeEmpresa = (id) => (E.empresas.find((e) => e.id === id) || {}).nome || id;
const escopoEmpresas = () => [...E.empresasSel];

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
  async auditar(entrada, empresa = empresaAtiva()) {
    try {
      if (!empresa) return;
      const ref = E.db.doc('auditoria/' + empresa);
      const s = await ref.get();
      const itens = s.exists ? (s.data().itens || []) : [];
      itens.unshift({ ...entrada, quando: new Date().toISOString() });
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
  async integracoesDa(empresa) {
    if (E.integracoes.has(empresa)) return E.integracoes.get(empresa);
    const s = await E.db.doc('integracoes/' + empresa).get();
    const itens = s.exists ? (s.data().conexoes || []) : [];
    E.integracoes.set(empresa, itens);
    return itens;
  },
  async gravarIntegracoes(empresa, conexoes) {
    await E.db.doc('integracoes/' + empresa).set({ conexoes });
    E.integracoes.set(empresa, conexoes);
  },
  async eventosDa(empresa) {
    if (E.eventos.has(empresa)) return E.eventos.get(empresa);
    const s = await E.db.doc('eventos-integracao/' + empresa).get();
    const itens = s.exists ? (s.data().itens || []) : [];
    E.eventos.set(empresa, itens);
    return itens;
  },
  async gravarEventos(empresa, itens) {
    await E.db.doc('eventos-integracao/' + empresa).set({ itens });
    E.eventos.set(empresa, itens);
  },
  // ----------------------------------------------------------------- acesso
  async usuariosDa(empresa) {
    if (E.usuarios.has(empresa)) return E.usuarios.get(empresa);
    const s = await E.db.doc('usuarios/' + empresa).get();
    const itens = s.exists ? (s.data().itens || []) : [];
    E.usuarios.set(empresa, itens);
    return itens;
  },
  async gravarUsuarios(empresa, itens) {
    await E.db.doc('usuarios/' + empresa).set({ itens });
    E.usuarios.set(empresa, itens);
  },
  async perfisDa(empresa) {
    if (E.perfis.has(empresa)) return E.perfis.get(empresa);
    const s = await E.db.doc('perfis/' + empresa).get();
    const itens = s.exists ? (s.data().itens || []) : [];
    E.perfis.set(empresa, itens);
    return itens;
  },
  async gravarPerfis(empresa, itens) {
    await E.db.doc('perfis/' + empresa).set({ itens });
    E.perfis.set(empresa, itens);
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
