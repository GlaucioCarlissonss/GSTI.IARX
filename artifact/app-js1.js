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
  empresas: [], filiais: [], tipos: [], filas: [], cenarios: [],
  empresa: null, filial: '', aba: 'painel',
  lanc: new Map(),          // 'empresa__comp' -> {itens:[...]}
  mesesCarregados: new Set(),
  projetos: new Map(),      // empresa -> {itens:[...]}
  sla: new Map(),           // 'empresa__comp' -> {itens:[...]}
  fechamentos: new Map(),   // empresa -> [comp]
  competencia: null,
  cenario: 'oficial',
  baseIdx: 0,
  origens: null,            // null = todas; Set de chaves quando o gestor restringe a base
  filtros: { tipo:'', natureza:'', classificacao:'', busca:'', de:'', ate:'' },
};

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
  /** Todos os lançamentos da empresa, achatados com a competência. */
  todos(empresa) {
    const saida = [];
    for (const [k, v] of E.lanc) {
      if (!k.startsWith(empresa + '__')) continue;
      for (const it of (v.itens || [])) saida.push({ ...it, competencia: v.competencia });
    }
    return saida;
  },
  async gravarMes(empresa, comp, itens) {
    const k = Loja.chave(empresa, comp);
    const corpo = { empresa, competencia: comp, itens };
    await E.db.doc('lanc/' + k).set(corpo);
    E.lanc.set(k, corpo);
  },
  async auditar(entrada) {
    try {
      const ref = E.db.doc('auditoria/' + E.empresa);
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
  async gravarCatalogo(nome, itens) {
    await E.db.doc('catalogo/' + nome).set({ itens });
    E[nome] = itens;
  },
};

/** Competência fechada bloqueia escrita; passada exige justificativa. */
function checarCompetencia(comp, justificativa) {
  const fechadas = E.fechamentos.get(E.empresa) || [];
  if (fechadas.includes(comp)) throw new Error('A competência ' + mesExib(comp) + ' está fechada. Reabra-a para alterar.');
  if (comp < mesHoje() && !String(justificativa || '').trim()) {
    throw new Error('Alterações em competências passadas (' + mesExib(comp) + ') exigem justificativa.');
  }
}

const filiaisDa = (e) => E.filiais.filter((f) => f.empresa === e);
const tiposDa = (e) => E.tipos.filter((t) => t.empresa === e);
const filasDa = (e) => E.filas.filter((f) => f.empresa === e);
const cenariosDa = (e) => [{ chave:'oficial', nome:'Oficial' }, ...E.cenarios.filter((c) => c.empresa === e)];
