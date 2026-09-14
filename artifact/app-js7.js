// ===========================================================================
// Navegação e inicialização
// ===========================================================================
const ORDEM_BASE = ['planilha', 'folha_ti', 'projecao_spincare', 'manual'];

// A navegação tem dois níveis: o módulo do negócio e, dentro dele, a tela.
// Quem trabalha com dinheiro não precisa esbarrar em chamado, e vice-versa.
// `sistema` guarda o que atravessa os três — planilha, cadastro e auditoria —
// e por isso não cabe dentro de nenhum.
const MODULOS_NAV = [
  // A leitura estratégica não cabe dentro de nenhum dos três módulos
  // operacionais: ela atravessa os três, e pendurá-la em um deles faria o
  // gestor procurar SLA dentro de Financeiro.
  { id:'indicadores', rotulo:'Indicadores Gerais',  abas:['indicadores_gerais'] },
  { id:'financeiro', rotulo:'Controle Financeiro',  abas:['painel', 'lancamentos', 'relatorio', 'conferencia'] },
  { id:'projetos',   rotulo:'Gestão de Projetos',   abas:['projetos'] },
  { id:'suporte',    rotulo:'Gestão de Suporte TI', abas:['sla', 'chamados', 'OSTICK', 'BITRIX24', 'integracoes'] },
  { id:'sistema',    rotulo:'Sistema',              abas:['dados', 'cadastros', 'acessos', 'auditoria'] },
];

const ABAS = [
  { id:'indicadores_gerais', rotulo:'Indicadores Gerais', view: viewIndicadores },
  { id:'painel',      rotulo:'Painel',       view: viewPainel },
  { id:'lancamentos', rotulo:'Lançamentos',  view: viewLancamentos },
  { id:'relatorio',   rotulo:'Relatório',    view: viewRelatorio },
  { id:'conferencia', rotulo:'Conferência',  view: viewConferencia },
  { id:'projetos',    rotulo:'Projetos',     view: viewProjetos },
  { id:'sla',         rotulo:'Indicadores',  view: () => viewSla('indicadores') },
  { id:'chamados',    rotulo:'Chamados',     view: () => viewSla('chamados') },
  // As duas entradas por sistema de origem são a MESMA tela de chamados, com a
  // origem fixada. O id é o próprio `source_system`, e é o que a tela usa para
  // se fixar — assim um sistema novo vira aba sem uma segunda lista para manter.
  { id:'OSTICK',      rotulo:'Sistema OStick',   view: () => viewSla('OSTICK') },
  { id:'BITRIX24',    rotulo:'Sistema Bitrix24', view: () => viewSla('BITRIX24') },
  { id:'integracoes', rotulo:'Integrações',  view: viewIntegracoes },
  { id:'dados',       rotulo:'Dados',        view: viewDados },
  { id:'cadastros',   rotulo:'Cadastros',    view: viewCadastros },
  { id:'acessos',     rotulo:'Usuários e acessos', view: viewAcessos },
  { id:'auditoria',   rotulo:'Auditoria',    view: viewAuditoria },
];

/** Módulo a que a aba pertence. */
const moduloDaAba = (aba) => MODULOS_NAV.find((m) => m.abas.includes(aba)) || MODULOS_NAV[0];

/** Abas do módulo que o recorte atual deixa ver. */
const abasVisiveis = (m) => m.abas.filter((a) => abaVisivel(a));

function pintarModulos() {
  const atual = moduloDaAba(E.aba);
  el('#modulos').innerHTML = MODULOS_NAV.filter((m) => abasVisiveis(m).length).map((m) =>
    `<button type="button" data-mod="${m.id}"${m.id===atual.id?' aria-current="page"':''}>
       <span class="pt"></span>${m.rotulo}</button>`).join('');
  el('#modulos').querySelectorAll('button').forEach((b) => b.onclick = () => {
    const mod = MODULOS_NAV.find((m) => m.id === b.dataset.mod);
    // Entrar num módulo abre a primeira tela dele; voltar ao módulo em que já
    // se está não tira ninguém da tela em que estava.
    if (mod && mod.id !== moduloDaAba(E.aba).id) { E.aba = abasVisiveis(mod)[0] || mod.abas[0]; render(); }
  });
}

function pintarAbas() {
  const mod = moduloDaAba(E.aba);
  const barra = el('#abas');
  const visiveis = abasVisiveis(mod);
  // Módulo de uma tela só não ganha barra de abas: seria um botão sozinho.
  barra.hidden = visiveis.length < 2;
  if (barra.hidden) { barra.innerHTML = ''; return; }
  barra.innerHTML = visiveis.map((id) => {
    const a = ABAS.find((x) => x.id === id);
    return `<button type="button" data-aba="${a.id}"${a.id===E.aba?' aria-current="page"':''}>${a.rotulo}</button>`;
  }).join('');
  barra.querySelectorAll('button').forEach((b) => b.onclick = () => { E.aba = b.dataset.aba; render(); });
}

// ----------------------------------------------------------------- tema
// Três estados: `sistema` segue o aparelho, e as duas escolhas explícitas
// carimbam `data-theme` na raiz, que é o que o CSS já sabe interpretar.
const TEMAS = ['sistema', 'claro', 'escuro'];
const ROTULO_TEMA = { sistema: 'Tema do sistema', claro: 'Tema claro', escuro: 'Tema escuro' };
const ICONE_TEMA = { sistema: '◐', claro: '☀', escuro: '☾' };

function temaAtual() {
  try { const t = localStorage.getItem('iarx-tema'); return TEMAS.includes(t) ? t : 'sistema'; }
  catch (e) { return 'sistema'; }
}

function aplicarTema(tema) {
  const raiz = document.documentElement;
  if (tema === 'claro') raiz.setAttribute('data-theme', 'light');
  else if (tema === 'escuro') raiz.setAttribute('data-theme', 'dark');
  else raiz.removeAttribute('data-theme');
  try { localStorage.setItem('iarx-tema', tema); } catch (e) { /* sem armazenamento: vale só nesta sessão */ }
  pintarTema(tema);
}

function pintarTema(tema) {
  const bt = el('#bt-tema');
  if (!bt) return;
  bt.innerHTML = `<span aria-hidden="true">${ICONE_TEMA[tema]}</span>${ROTULO_TEMA[tema]}`;
  bt.title = 'Alternar entre tema do sistema, claro e escuro';
  bt.setAttribute('aria-pressed', tema === 'escuro' ? 'true' : 'false');
}

function ligarTema() {
  const bt = el('#bt-tema');
  if (!bt) return;
  pintarTema(temaAtual());
  bt.onclick = () => {
    const proximo = TEMAS[(TEMAS.indexOf(temaAtual()) + 1) % TEMAS.length];
    aplicarTema(proximo);
    // Os gráficos são SVG desenhado com as cores resolvidas no momento da
    // montagem: sem repintar a tela, eles ficariam com a paleta antiga. Na
    // tela de erro não há o que repintar — e não há base para montar nada.
    if (E.db) render();
  };
}

function pintarSeletores() {
  // Só as matrizes do cliente aberto. Uma matriz de outro contratante no
  // seletor juntaria dois clientes na mesma tela — é o que a camada impede.
  const doCliente = E.clienteSel ? empresasDoCliente(E.clienteSel) : E.empresas;
  const itensEmpresa = doCliente.map((e) => ({ valor: e.id, rotulo: e.nome }));
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
    // A pré-visualização pode ter tirado a tela atual do alcance do perfil:
    // insistir nela mostraria o que o perfil não vê.
    if (!abaVisivel(E.aba)) E.aba = (ABAS.find((a) => abaVisivel(a.id)) || ABAS[0]).id;
    const aba = ABAS.find((a)=>a.id===E.aba) || ABAS[0];
    pintarModulos();
    pintarAbas();
    pintarPrevia();
    await aba.view();
    aplicarPreviaNaTela();
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
  // Antes de qualquer coisa: o botão de tema precisa funcionar mesmo nas telas
  // de erro, que são justamente onde alguém fica preso.
  ligarTema();
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
    // Antes de montar qualquer tela: saber se esta visualização escreve. A tela
    // precisa disso para não oferecer um botão que o armazenamento vai recusar.
    await apurarEscrita();
    // O cliente vem antes de tudo: é o recorte mais externo, e abrir uma tela
    // antes de escolhê-lo mostraria números de um contratante que ninguém pediu.
    await garantirClientes();
    const guardado = clienteGuardado();
    if (guardado && clientePorId(guardado)) await abrirCliente(guardado, false);
    else viewBoasVindas();
  } catch (e) {
    semBanco('Erro ao carregar: ' + (e.message || e));
  }
})();
