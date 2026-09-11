// ===========================================================================
// Navegação e inicialização
// ===========================================================================
const ORDEM_BASE = ['planilha', 'folha_ti', 'projecao_spincare', 'manual'];

const ABAS = [
  { id:'painel',      rotulo:'Painel',      view: viewPainel },
  { id:'lancamentos', rotulo:'Lançamentos', view: viewLancamentos },
  { id:'projetos',    rotulo:'Projetos',    view: viewProjetos },
  { id:'sla',         rotulo:'SLA',         view: viewSla },
  { id:'conferencia', rotulo:'Conferência', view: viewConferencia },
  { id:'dados',       rotulo:'Dados',       view: viewDados },
  { id:'cadastros',   rotulo:'Cadastros',   view: viewCadastros },
  { id:'auditoria',   rotulo:'Auditoria',   view: viewAuditoria },
];

function pintarAbas() {
  el('#abas').innerHTML = ABAS.map((a) =>
    `<button type="button" data-aba="${a.id}"${a.id===E.aba?' aria-current="page"':''}>${a.rotulo}</button>`).join('');
  el('#abas').querySelectorAll('button').forEach((b) => b.onclick = () => { E.aba = b.dataset.aba; render(); });
}

function pintarSeletores() {
  const itensEmpresa = E.empresas.map((e) => ({ valor: e.id, rotulo: e.nome }));
  const itensFilial = [
    { valor: '(empresa)', rotulo: 'Sem filial (nível empresa)' },
    ...filiaisDoEscopo().map((f) => ({ valor: f.nome, rotulo: f.nome })),
  ];
  const itensBase = ORDEM_BASE.map((o) => ({ valor: o, rotulo: ORIGENS[o].rotulo }));

  seletorMulti(el('[data-sel="empresa"]'), {
    id: 'f-empresa', rotulo: 'Empresa', itens: itensEmpresa, selecionados: E.empresasSel, minimo: 1,
    aviso: 'Com mais de uma empresa o sistema consolida. Para lançar, deixe só uma.',
    aoMudar: async (novo) => {
      E.empresasSel = novo;
      // filial e cenário pertencem a uma empresa: ao trocar o conjunto, o que
      // não existe mais no escopo precisa cair, senão o filtro esconde tudo
      for (const e of novo) await garantirDados(e);
      const filiaisValidas = new Set(itensFilialAtuais().map((f) => f.valor));
      E.filiaisSel = new Set([...E.filiaisSel].filter((f) => filiaisValidas.has(f)));
      const cenariosValidos = new Set(cenariosDoEscopo().map((c) => c.chave));
      const cen = [...E.cenariosSel].filter((c) => cenariosValidos.has(c));
      E.cenariosSel = new Set(cen.length ? cen : ['oficial']);
      ajustarCompetencias();
      pintarSeletores(); render();
    },
  });

  seletorMulti(el('[data-sel="filial"]'), {
    id: 'f-filial', rotulo: 'Filial', itens: itensFilial, selecionados: E.filiaisSel,
    aoMudar: (novo) => { E.filiaisSel = novo; pintarSeletores(); render(); },
  });

  seletorMulti(el('[data-sel="base"]'), {
    id: 'f-base', rotulo: 'Base considerada', itens: itensBase, selecionados: E.origens,
    aviso: 'Nada marcado = tudo. Marque só "Planilhas do cliente" para comparar com a sua planilha.',
    aoMudar: (novo) => { E.origens = novo; pintarSeletores(); render(); },
  });

  pintarFichas(el('#f-fichas'), [
    { chave:'empresa', rotulo:'Empresa', itens:itensEmpresa, selecionados:E.empresasSel, minimo:1,
      ocultarSeTudo:false, total:itensEmpresa.length,
      aoMudar:(n) => { E.empresasSel = n; ajustarCompetencias(); pintarSeletores(); render(); } },
    { chave:'filial', rotulo:'Filial', itens:itensFilial, selecionados:E.filiaisSel,
      ocultarSeTudo:true, total:itensFilial.length,
      aoMudar:(n) => { E.filiaisSel = n; pintarSeletores(); render(); } },
    { chave:'base', rotulo:'Base', itens:itensBase, selecionados:E.origens,
      ocultarSeTudo:true, total:itensBase.length,
      aoMudar:(n) => { E.origens = n; pintarSeletores(); render(); } },
  ]);
}

const itensFilialAtuais = () => [
  { valor: '(empresa)', rotulo: 'Sem filial (nível empresa)' },
  ...filiaisDoEscopo().map((f) => ({ valor: f.nome, rotulo: f.nome })),
];

let renderizando = false;
async function render() {
  if (renderizando) return;
  renderizando = true;
  sumirDica();
  try {
    const aba = ABAS.find((a)=>a.id===E.aba) || ABAS[0];
    pintarAbas();
    await aba.view();
  } catch (e) {
    el('#pagina').innerHTML = `<div class="msg erro"><strong>Falha ao montar a tela.</strong> ${esc(e.message||e)}</div>`;
  } finally { renderizando = false; }
}

async function garantirDados(empresa) {
  if (!E.mesesCarregados.has(empresa)) await Loja.lancDaEmpresa(empresa);
  await Loja.fechamentosDa(empresa);
}

async function garantirEscopo() {
  for (const e of E.empresasSel) await garantirDados(e);
}

function semBanco(motivo) {
  el('#pagina').innerHTML = `
    <section class="bloco">
      <h2 style="margin-bottom:8px">Armazenamento indisponível nesta visualização</h2>
      <p style="color:var(--tinta2)">${esc(motivo)}</p>
      <p style="color:var(--tinta2)">Abra esta página pelo link do artifact, logado na sua conta. Se o problema
        persistir, o mesmo sistema roda na sua máquina com <code>npm run iniciar</code>.</p>
    </section>`;
}

(async function iniciar() {
  try {
    const db = await window.claude?.use?.('db');
    if (!db) return semBanco('Esta visualização não pôde abrir a base de dados do sistema.');
    E.db = db;
    await Loja.catalogos();
    if (!E.empresas.length) {
      el('#pagina').innerHTML = `<section class="bloco"><h2>Base vazia</h2>
        <p style="color:var(--tinta2)">Nenhuma empresa cadastrada ainda nesta base.</p></section>`;
      return;
    }
    E.empresasSel = new Set([E.empresas[0].id]);
    await garantirEscopo();
    E.cenariosSel = new Set(['oficial']);
    E.competencias = new Set([competenciaPadrao()]);
    pintarSeletores();
    await render();
  } catch (e) {
    semBanco('Erro ao carregar: ' + (e.message || e));
  }
})();
