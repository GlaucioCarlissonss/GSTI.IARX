// Auxiliares compartilhados pelas suítes.
//
// Os filtros deixaram de ser <select> e viraram seleção múltipla com caixas.
// Onde o seletor não é o objeto do teste, ajustar o estado direto e redesenhar
// é mais estável do que encenar cliques — `testar-multi.cjs` cobre a interação
// pela interface.

/**
 * Deixa exatamente estas empresas no recorte, carregando o que faltar.
 *
 * O filtro deixou de ser global: ele é por tela. Uma suíte que percorre várias
 * telas conferindo os mesmos números precisa do mesmo recorte em todas, então
 * o auxiliar marca TODAS as telas — e a unidade de escrita vai junto, porque
 * criar não depende mais de filtro nenhum. A independência entre as telas é o
 * objeto de `testar-multi.cjs` e de `web/verificar-cliente.cjs`, que a
 * exercitam pela interface.
 */
async function usarEmpresas(pag, ids) {
  await pag.evaluate(async (lista) => {
    for (const aba of ABAS) filtroDaTela(aba.id).empresas = new Set(lista);
    E.empresaFoco = lista[0];
    for (const e of escopoEmpresas()) await garantirDados(e);
    E.filiaisSel = new Set();
    const validos = new Set(cenariosDoEscopo().map((c) => c.chave));
    const cen = [...E.cenariosSel].filter((c) => validos.has(c));
    E.cenariosSel = new Set(cen.length ? cen : ['oficial']);
    ajustarCompetencias();
    pintarFiltrosDaTela();
    await render();
  }, [].concat(ids));
  await pag.waitForTimeout(500);
}

/** Recorte de procedência; lista vazia = todas. */
async function usarBase(pag, origens) {
  await pag.evaluate(async (lista) => {
    E.origens = new Set(lista);
    pintarFiltrosDaTela();
    await render();
  }, [].concat(origens || []));
  await pag.waitForTimeout(400);
}

/** Competências em foco; lista vazia volta ao padrão do cenário. */
async function usarCompetencias(pag, comps) {
  await pag.evaluate(async (lista) => {
    E.competencias = new Set(lista.length ? lista : [competenciaPadrao()]);
    await render();
  }, [].concat(comps || []));
  await pag.waitForTimeout(400);
}

/** Lê o rótulo atual de um seletor múltiplo pelo id do gatilho. */
const rotuloSeletor = (pag, id) => pag.$eval('#' + id, (b) => b.textContent.trim().replace(/\s+/g, ' '));

/**
 * Vai para uma tela pelo rótulo da aba. A navegação tem dois níveis — o módulo
 * e a tela dentro dele —, então o caminho passa antes pelo módulo que contém a
 * aba. Continua aceitando o rótulo da aba sozinho, como as suítes já usavam.
 */
/**
 * Abre os blocos da tela.
 *
 * Os blocos nascem FECHADOS — é o comportamento que o sistema passou a ter, e
 * quem usa escolhe o que abrir. As suítes conferem o conteúdo, então elas
 * abrem tudo antes de olhar. A escolha fica guardada, então isto custa um
 * clique por bloco na primeira visita e nada depois.
 */
async function abrirBlocos(pag) {
  await pag.evaluate(() => {
    document
      .querySelectorAll('#pagina .bloco[data-dobra] .bloco-dobra[aria-expanded="false"]')
      .forEach((b) => b.click());
  });
  await pag.waitForTimeout(160);
}

async function irPara(pag, rotulo, espera = 450) {
  const mod = await pag.evaluate((r) => {
    const chave = String(r).toLowerCase();
    const aba = ABAS.find((a) => a.rotulo.toLowerCase() === chave || a.id.toLowerCase() === chave);
    if (!aba) return null;
    return { modulo: moduloDaAba(aba.id).rotulo, aba: aba.rotulo, sozinha: moduloDaAba(aba.id).abas.length < 2 };
  }, rotulo);
  if (!mod) throw new Error(`Aba "${rotulo}" não existe na navegação.`);
  await pag.click(`#modulos button:text-is("${mod.modulo}")`);
  await pag.waitForTimeout(120);
  if (!mod.sozinha) await pag.click(`#abas button:text-is("${mod.aba}")`);
  await pag.waitForTimeout(espera);
  await abrirBlocos(pag);
}

/** Todas as abas, na ordem em que a navegação as apresenta. */
const todasAsAbas = (pag) =>
  pag.evaluate(() => MODULOS_NAV.flatMap((m) =>
    m.abas.map((id) => ({ modulo: m.rotulo, aba: ABAS.find((a) => a.id === id).rotulo }))));

module.exports = { usarEmpresas, usarBase, usarCompetencias, rotuloSeletor, irPara, todasAsAbas, abrirBlocos };
