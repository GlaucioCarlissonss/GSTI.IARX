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
  { id:'sistema',    rotulo:'Sistema',              abas:['dados', 'clientes', 'cadastros', 'metas', 'slas', 'reducao', 'reconhecedores', 'acessos', 'auditoria'] },
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
  { id:'clientes',    rotulo:'Clientes e unidades', view: viewClientes },
  { id:'cadastros',   rotulo:'Cadastros',    view: viewCadastros },
  { id:'metas',       rotulo:'Metas',        view: viewMetas },
  { id:'slas',        rotulo:'SLAs',         view: viewSlas },
  { id:'reducao',     rotulo:'Plano de redução', view: viewReducao },
  { id:'reconhecedores', rotulo:'Quem reconhece despesa', view: viewReconhecedores },
  { id:'acessos',     rotulo:'Usuários e acessos', view: viewAcessos },
  { id:'auditoria',   rotulo:'Auditoria',    view: viewAuditoria },
];

// As abas do módulo "Sistema" não têm todas o mesmo escopo: Dados e Cadastros
// olham a unidade em foco, trocável na própria tela; Clientes e unidades,
// Usuários e acessos e Auditoria olham o cliente inteiro. Um selo único no
// grupo seria impreciso — por isso o ponto vai por aba, só nestas três.
const ESCOPO_CLIENTE = new Set(['clientes', 'metas', 'reducao', 'reconhecedores', 'acessos', 'auditoria']);

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
    const doCliente = mod.id === 'sistema' && ESCOPO_CLIENTE.has(a.id);
    const escopo = doCliente ? ' data-escopo="cliente" title="Vale para todo o cliente: toda matriz e toda filial."' : '';
    return `<button type="button" data-aba="${a.id}"${escopo}${a.id===E.aba?' aria-current="page"':''}>${a.rotulo}</button>`;
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

/**
 * Textos de apoio dos filtros que se repetem no sistema.
 *
 * Ficam num lugar só porque a mesma pergunta aparece em várias telas, e
 * respostas ligeiramente diferentes ensinariam regras diferentes.
 */
const EXPLICA = {
  empresa: 'Escolhe as unidades (matrizes) deste cliente que entram nesta tela. Vazio traz todas juntas.',
  filial: 'Restringe aos registros das filiais marcadas. "Sem filial" traz o que foi lançado no nível da matriz.',
  base: 'Procedência do dado: planilha do cliente, folha de TI rateada, projeção ou lançado no sistema. Vazio soma tudo.',
};

/**
 * Quais filtros cada tela tem.
 *
 * A tela de Integrações é do CLIENTE — configurar a conexão não depende de
 * unidade nenhuma —, e as de cadastro e dados operam sobre uma unidade
 * escolhida ali dentro. Nenhuma delas leva filtro de empresa, e essa é
 * exatamente a dependência que precisava cair.
 *
 * "Clientes e unidades", "Usuários e acessos" e "Auditoria" NÃO aparecem
 * aqui de propósito: as três são do cliente inteiro, sem seletor de unidade
 * nenhum — nem filtro, nem foco. Usuários e acessos já foi "foco de unidade"
 * (o perfil valia só numa matriz); a permissão passou a valer em todas de
 * uma vez, e o seletor que sobraria não teria mais o que fazer.
 */
const FILTROS_DA_TELA = {
  indicadores_gerais: { empresa: true, filial: false, base: false },
  painel:      { empresa: true, filial: true, base: true },
  lancamentos: { empresa: true, filial: true, base: true },
  relatorio:   { empresa: true, filial: true, base: true },
  conferencia: { empresa: true, filial: true, base: true },
  projetos:    { empresa: true, filial: true, base: false },
  sla:         { empresa: true, filial: true, base: false },
  chamados:    { empresa: true, filial: true, base: false },
  OSTICK:      { empresa: true, filial: true, base: false },
  BITRIX24:    { empresa: true, filial: true, base: false },
  // Estas não CONSULTAM o cliente: elas escrevem numa unidade. O campo é uma
  // escolha única, e diz o que governa — antes essa escolha vinha do filtro
  // global, o que fazia um recorte de leitura virar pré-requisito de escrita.
  cadastros:   { foco: 'Filiais, tipos de despesa, filas e cenários pertencem a esta unidade e valem só nela.' },
  // Metas são do CLIENTE: não há unidade em foco a escolher, e oferecer o
  // seletor sugeriria um recorte que a tela não tem.
  metas:       {},
  // O acordo é da UNIDADE, ao contrário da meta: aqui o seletor de foco faz
  // sentido e é obrigatório para saber onde gravar.
  slas:        { foco: 'Os acordos de SLA valem para os chamados desta unidade.' },
  // O plano de corte é negociado para o GRUPO, como as metas: sem seletor.
  reducao:     {},
  reconhecedores: {},
  dados:       { foco: 'A carga e a exportação são desta unidade: o arquivo traz os cadastros dela, e reimportá-lo volta para a mesma.' },
};

/**
 * A barra de filtros DA TELA em foco.
 *
 * O que se marca aqui vale nesta tela e em mais nenhuma: o estado mora em
 * `E.filtrosTela`, por aba, e morre com a sessão — recorte de leitura não é
 * configuração. Cada campo diz o que filtra, sobre quais dados atua e o efeito
 * esperado; um seletor vazio que traz tudo é justamente o que confunde quem
 * chega.
 */
function pintarFiltrosDaTela() {
  const caixa = el('#filtros-tela');
  if (!caixa) return;
  const conf = FILTROS_DA_TELA[E.aba];
  if (!conf || !E.clienteSel) {
    caixa.hidden = true;
    caixa.innerHTML = '';
    return;
  }
  const doCliente = empresasDoCliente(E.clienteSel);
  const local = filtroDaTela();

  // Tela de unidade única: um seletor de escolha, não um filtro.
  if (conf.foco) {
    const atual = empresaAtiva();
    caixa.hidden = false;
    caixa.innerHTML = doCliente.length > 1
      ? `<div class="campo" style="min-width:230px"><label for="f-foco">Unidade em foco</label>
           <select id="f-foco">${doCliente.map((e) =>
             `<option value="${esc(e.id)}"${e.id === atual ? ' selected' : ''}>${esc(e.nome)}</option>`).join('')}</select>
           <small class="dica-filtro">${esc(conf.foco)}</small></div>`
      : `<p class="dica-filtro">Unidade: <b>${esc(atual ? nomeEmpresa(atual) : '—')}</b>. ${esc(conf.foco)}</p>`;
    const sel = el('#f-foco');
    if (sel) {
      sel.onchange = async () => {
        E.empresaFoco = sel.value;
        await garantirDados(E.empresaFoco);
        render();
      };
    }
    pintarFichas(el('#f-fichas'), []);
    return;
  }
  const itensEmpresa = doCliente.map((e) => ({ valor: e.id, rotulo: e.nome }));
  const itensFilial = itensFilialAtuais();
  const itensBase = ORDEM_BASE.map((o) => ({ valor: o, rotulo: ORIGENS[o].rotulo }));
  // Com uma unidade só não há escolha a oferecer: o cliente inteiro e a única
  // unidade são a mesma coisa.
  const temEmpresa = conf.empresa && doCliente.length > 1;

  caixa.hidden = false;
  caixa.innerHTML =
    (temEmpresa
      ? `<div class="campo" style="min-width:210px"><label for="f-empresa">Empresa (matriz)</label>
           <div data-sel="empresa"></div><small class="dica-filtro">${esc(EXPLICA.empresa)}</small></div>`
      : '') +
    (conf.filial
      ? `<div class="campo" style="min-width:190px"><label for="f-filial">Filial</label>
           <div data-sel="filial"></div><small class="dica-filtro">${esc(EXPLICA.filial)}</small></div>`
      : '') +
    (conf.base
      ? `<div class="campo" style="min-width:200px"><label for="f-base">Base considerada</label>
           <div data-sel="base"></div><small class="dica-filtro">${esc(EXPLICA.base)}</small></div>`
      : '') +
    `<p class="resumo">Filtro desta tela. ${
      local.empresas.size
        ? esc(inteiro(local.empresas.size) + ' de ' + inteiro(doCliente.length) + ' unidades')
        : 'Todas as unidades de ' + esc(clienteAtual() ? clienteAtual().nome : 'cliente')
    }.${local.empresas.size || local.filiais.size ? ' <button type="button" class="bt fant peq" id="bt-limpar-filtros">Limpar filtros</button>' : ''}</p>`;

  if (temEmpresa) {
    seletorMulti(el('[data-sel="empresa"]'), {
      id: 'f-empresa', rotulo: 'Empresa (matriz)', itens: itensEmpresa, selecionados: local.empresas,
      aviso: 'Nada marcado = todas as unidades do cliente.',
      aoMudar: async (novo) => {
        local.empresas = novo;
        for (const e of escopoEmpresas()) await garantirDados(e);
        // Filial e cenário pertencem a uma unidade: o que saiu do escopo cai,
        // senão o filtro esconderia tudo sem dizer por quê.
        const validas = new Set(itensFilialAtuais().map((f) => f.valor));
        local.filiais = new Set([...local.filiais].filter((f) => validas.has(f)));
        const cenariosValidos = new Set(cenariosDoEscopo().map((c) => c.chave));
        const cen = [...E.cenariosSel].filter((c) => cenariosValidos.has(c));
        E.cenariosSel = new Set(cen.length ? cen : ['oficial']);
        ajustarCompetencias();
        pintarFiltrosDaTela(); render();
      },
    });
  }
  if (conf.filial) {
    seletorMulti(el('[data-sel="filial"]'), {
      id: 'f-filial', rotulo: 'Filial', itens: itensFilial, selecionados: local.filiais,
      aoMudar: (novo) => { local.filiais = novo; pintarFiltrosDaTela(); render(); },
    });
  }
  if (conf.base) {
    seletorMulti(el('[data-sel="base"]'), {
      id: 'f-base', rotulo: 'Base considerada', itens: itensBase, selecionados: E.origens,
      aviso: 'Nada marcado = tudo. Marque só "Planilhas do cliente" para comparar com a sua planilha.',
      aoMudar: (novo) => { E.origens = novo; pintarFiltrosDaTela(); render(); },
    });
  }
  const limpar = el('#bt-limpar-filtros');
  if (limpar) {
    limpar.onclick = () => {
      local.empresas = new Set();
      local.filiais = new Set();
      pintarFiltrosDaTela(); render();
    };
  }

  pintarFichas(el('#f-fichas'), [
    ...(temEmpresa ? [{ chave:'empresa', rotulo:'Empresa', itens:itensEmpresa, selecionados:local.empresas,
      ocultarSeTudo:true, total:itensEmpresa.length,
      aoMudar:(n) => { local.empresas = n; ajustarCompetencias(); pintarFiltrosDaTela(); render(); } }] : []),
    ...(conf.filial ? [{ chave:'filial', rotulo:'Filial', itens:itensFilial, selecionados:local.filiais,
      ocultarSeTudo:true, total:itensFilial.length,
      aoMudar:(n) => { local.filiais = n; pintarFiltrosDaTela(); render(); } }] : []),
    ...(conf.base ? [{ chave:'base', rotulo:'Base', itens:itensBase, selecionados:E.origens,
      ocultarSeTudo:true, total:itensBase.length,
      aoMudar:(n) => { E.origens = n; pintarFiltrosDaTela(); render(); } }] : []),
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
    // A barra de filtros é DA TELA: trocar de aba troca o recorte exibido, e
    // cada aba lembra o seu.
    pintarFiltrosDaTela();
    pintarPrevia();
    await aba.view();
    // Depois da view, e não dentro de cada uma: assim os 51 blocos espalhados
    // pelas telas viram acordeão sem que nenhuma delas precise saber disso.
    dobrarBlocos();
    aplicarPreviaNaTela();
    // Não é esperado: o selo aparece quando os registros chegarem, e a tela
    // não fica presa numa leitura de armazenamento para pintar o conteúdo.
    void pintarUltimaCarga();
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
    // Depois de saber que escreve, e antes de qualquer número aparecer: tirar
    // da base a folha de TI que o sistema inventou. Ver `purgarFolhaTI`.
    await purgarFolhaTI();
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
