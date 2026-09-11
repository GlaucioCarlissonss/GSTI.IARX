// Auxiliares compartilhados pelas suítes.
//
// Os filtros deixaram de ser <select> e viraram seleção múltipla com caixas.
// Onde o seletor não é o objeto do teste, ajustar o estado direto e redesenhar
// é mais estável do que encenar cliques — `testar-multi.cjs` cobre a interação
// pela interface.

/** Deixa exatamente estas empresas selecionadas, carregando o que faltar. */
async function usarEmpresas(pag, ids) {
  await pag.evaluate(async (lista) => {
    E.empresasSel = new Set(lista);
    for (const e of E.empresasSel) await garantirDados(e);
    E.filiaisSel = new Set();
    const validos = new Set(cenariosDoEscopo().map((c) => c.chave));
    const cen = [...E.cenariosSel].filter((c) => validos.has(c));
    E.cenariosSel = new Set(cen.length ? cen : ['oficial']);
    ajustarCompetencias();
    pintarSeletores();
    await render();
  }, [].concat(ids));
  await pag.waitForTimeout(500);
}

/** Recorte de procedência; lista vazia = todas. */
async function usarBase(pag, origens) {
  await pag.evaluate(async (lista) => {
    E.origens = new Set(lista);
    pintarSeletores();
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

module.exports = { usarEmpresas, usarBase, usarCompetencias, rotuloSeletor };
