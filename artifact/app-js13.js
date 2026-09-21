// ===========================================================================
// Relatório financeiro — tabela dinâmica com drill-down em três níveis
// ===========================================================================
//
// É o formato que o gestor já monta no Excel: meses nas colunas, hierarquia
// nas linhas, Total Geral nas duas pontas. A diferença é que aqui o detalhe
// está a um clique.
//
//   1. macro       — filiais e seus totais por mês (padrão: recolhido)
//   2. categoria   — expandir a filial mostra os tipos de despesa
//   3. lançamento  — expandir o tipo mostra os lançamentos daquele recorte
//
// Aqui os lançamentos já estão em memória (a base da empresa inteira é
// carregada de uma vez), então o nível 3 não precisa de ida ao servidor — mas
// só é montado quando aberto, que é o que mantém a primeira tela leve.

/**
 * Estado de expansão do relatório. Guarda os **expandidos**, não os
 * comprimidos: aqui o padrão é recolhido, ao contrário do Gantt. Guardar
 * sempre a exceção ao padrão é o que faz uma linha nova nascer no padrão.
 */
const CHAVE_RELATORIO = 'iarx-relatorio-expandidos';
function relatorioAbertos() {
  try { return new Set(JSON.parse(localStorage.getItem(CHAVE_RELATORIO) || '[]')); }
  catch (e) { return new Set(); }
}
function gravarAbertos(conjunto) {
  try { localStorage.setItem(CHAVE_RELATORIO, JSON.stringify([...conjunto])); }
  catch (e) { /* sem armazenamento: vale só nesta sessão */ }
}
const relatorioAberto = (chave) => relatorioAbertos().has(chave);
function alternarRelatorio(chave) {
  const atual = relatorioAbertos();
  if (atual.has(chave)) atual.delete(chave); else atual.add(chave);
  gravarAbertos(atual);
}

/**
 * Monta a tabela dinâmica a partir dos lançamentos no escopo: linhas por
 * filial e por tipo de despesa, colunas por mês.
 */
function montarPivot(lancamentos) {
  const meses = [...new Set(lancamentos.map((l) => l.competencia))].sort();
  const porChave = new Map();

  const garantir = (chave, base) => {
    if (!porChave.has(chave)) porChave.set(chave, { chave, ...base, meses: {}, total: 0, itens: [] });
    return porChave.get(chave);
  };

  for (const l of lancamentos) {
    const filial = l.filial || 'Nível empresa';
    const chaveFilial = 'f:' + filial;
    const chaveTipo = chaveFilial + '|t:' + l.tipo;
    for (const alvo of [
      garantir(chaveFilial, { rotulo: filial, nivel: 1, pai: null, filial, tipo: null }),
      garantir(chaveTipo, { rotulo: l.tipo, nivel: 2, pai: chaveFilial, filial, tipo: l.tipo }),
    ]) {
      alvo.meses[l.competencia] = (alvo.meses[l.competencia] || 0) + l.valor;
      alvo.total += l.valor;
      // O nível 2 guarda os próprios lançamentos: é o detalhe do drill-down, e
      // guardá-lo aqui garante que a soma do detalhe sai da mesma conta do macro.
      if (alvo.nivel === 2) alvo.itens.push(l);
    }
  }

  const todas = [...porChave.values()];
  const nivel1 = todas.filter((l) => l.nivel === 1).sort((a, b) => b.total - a.total);
  // Ordem de leitura: cada filial seguida dos seus tipos, maior custo primeiro
  // — é o que o gestor procura.
  const linhas = nivel1.flatMap((f) => [
    f,
    ...todas.filter((l) => l.pai === f.chave).sort((a, b) => b.total - a.total),
  ]);

  const totalGeral = { meses: {}, total: 0, itens: 0 };
  for (const f of nivel1) {
    for (const [m, v] of Object.entries(f.meses)) totalGeral.meses[m] = (totalGeral.meses[m] || 0) + v;
    totalGeral.total += f.total;
  }
  totalGeral.itens = lancamentos.length;

  return { meses, linhas, totalGeral };
}

/**
 * Texto do tooltip de um lançamento: a descrição completa, com de onde veio o
 * custo e para onde foi o pagamento. É a pergunta que a linha da tabela não
 * cabe responder e que o gestor faz antes de abrir o registro.
 */
function resumoDoLancamento(l) {
  return [
    l.descricao || l.tipo,
    '\n\nOrigem do custo: ' + (l.origemCusto || 'não informada'),
    '\nDestino do pagamento: ' + (l.destinoPagamento || 'não informado'),
    '\nValor: ' + brl(l.valor) + ' · ' + mesExib(l.competencia),
    l.documento ? '\nDocumento: ' + l.documento : '',
    l.parcela && l.parcelas ? `\nParcela ${l.parcela} de ${l.parcelas}` : '',
    l.obs ? '\n\n' + l.obs : '',
    '\n\nClique para ver o detalhamento completo.',
  ].join('');
}

// ===========================================================================
// Como olhar os mesmos números
// ===========================================================================
// A dinâmica responde "quanto, em que mês"; os blocos respondem "quanto, em
// qual unidade". Trocar entre eles não recarrega nem refaz consulta.
//
// O modo vale para Lançamentos E Relatório: quem organizou a leitura numa tela
// espera encontrar a outra do mesmo jeito.
const CHAVE_MODO = 'iarx-modo-visao';
const MODOS_VISAO = [
  { valor: 'lista', rotulo: 'Lista', dica: 'Tabela dinâmica: meses nas colunas, hierarquia nas linhas.' },
  { valor: 'filial', rotulo: 'Blocos por filial', dica: 'Um bloco por filial, com o total dela.' },
  { valor: 'matriz', rotulo: 'Blocos por matriz', dica: 'Um bloco por matriz, somando as filiais dela.' },
];

function modoVisao() {
  try {
    const v = localStorage.getItem(CHAVE_MODO);
    return v === 'filial' || v === 'matriz' ? v : 'lista';
  } catch (e) { return 'lista'; }
}
function gravarModoVisao(v) {
  try { localStorage.setItem(CHAVE_MODO, v); }
  catch (e) { /* sem armazenamento: vale só nesta sessão */ }
}

/** Os três botões do seletor, para a barra de filtros da tela. */
function seletorModoHtml() {
  const atual = modoVisao();
  return `<div class="modo-visao" role="group" aria-label="Como exibir os números">${MODOS_VISAO.map((m) =>
    `<button type="button" data-modo="${m.valor}" title="${esc(m.dica)}"` +
    `${m.valor === atual ? ' class="ativo" aria-pressed="true"' : ' aria-pressed="false"'}>${esc(m.rotulo)}</button>`,
  ).join('')}</div>`;
}

function ligarSeletorModo() {
  el('#pagina').querySelectorAll('[data-modo]').forEach((b) => {
    b.onclick = () => { gravarModoVisao(b.dataset.modo); render(); };
  });
}

/**
 * Os mesmos lançamentos agrupados por unidade, do maior total para o menor.
 *
 * Agrupa a partir dos lançamentos, e não das linhas da dinâmica: a dinâmica
 * chaveia por filial, e a matriz não caberia nela sem uma segunda passada.
 */
function blocosPorUnidadeHtml(lancamentos, modo) {
  const grupos = new Map();
  for (const l of lancamentos) {
    const nome = modo === 'filial' ? (l.filial || 'Nível empresa') : nomeEmpresa(l.empresa);
    if (!grupos.has(nome)) grupos.set(nome, { nome, total: 0, itens: 0, tipos: new Map() });
    const g = grupos.get(nome);
    g.total += l.valor;
    g.itens += 1;
    const t = g.tipos.get(l.tipo) || { total: 0, itens: 0 };
    t.total += l.valor;
    t.itens += 1;
    g.tipos.set(l.tipo, t);
  }
  if (!grupos.size) return '<section class="bloco"><p class="vazio">Nenhum lançamento no recorte selecionado.</p></section>';

  return '<div class="grade g2">' + [...grupos.values()]
    .sort((a, b) => b.total - a.total)
    .map((g) => `<section class="bloco">
        <header><h2>${esc(g.nome)}</h2>
          <span class="nota">${inteiro(g.itens)} lançamento(s) · <strong>${brl(g.total)}</strong></span></header>
        <div class="rol"><table>
          <thead><tr><th>Categoria</th><th class="n">Lançamentos</th><th class="n">Total</th></tr></thead>
          <tbody>${[...g.tipos.entries()].sort((a, b) => b[1].total - a[1].total)
            .map(([tipo, t]) => `<tr><td>${esc(tipo)}</td><td class="n">${inteiro(t.itens)}</td>
              <td class="n">${brl(t.total)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Total</td><td class="n">${inteiro(g.itens)}</td><td class="n">${brl(g.total)}</td></tr></tfoot>
        </table></div>
      </section>`).join('') + '</div>';
}

/**
 * A dinâmica em dois níveis, para quem só quer a leitura por mês.
 *
 * O Relatório tem a versão de três níveis, com o lançamento no fundo; esta é a
 * mesma tabela sem esse terceiro passo, para acompanhar a listagem de
 * Lançamentos sem repetir ali o drill-down inteiro. As chaves levam prefixo
 * próprio para o que se abre aqui não mexer no que está aberto lá.
 */
function dinamicaHtml(lancamentos, prefixo) {
  const { meses, linhas, totalGeral } = montarPivot(lancamentos);
  if (!linhas.length) return '';
  const aberta = (l) => relatorioAberto(prefixo + l.chave);
  const visiveis = linhas.filter((l) => l.nivel === 1 || aberta({ chave: l.pai }));

  return `<section class="bloco">
    <header><h2>Por mês e categoria</h2>
      <span class="nota">${inteiro(totalGeral.itens)} lançamento(s) · ${meses.length} mês(es)</span></header>
    <div class="rol rol-fixo"><table class="pivot">
      <thead><tr><th style="min-width:220px">Rótulos de linha</th>
        ${meses.map((m) => `<th class="n">${mesExib(m)}</th>`).join('')}
        <th class="n">Total Geral</th></tr></thead>
      <tbody>${visiveis.map((l) => `<tr class="${l.nivel === 1 ? 'grupo-1' : ''}">
        <th style="${l.nivel === 2 ? 'padding-left:30px;font-weight:400' : ''}">
          ${l.nivel === 1
            ? `<button type="button" class="pivot-grupo" data-dgrupo="${esc(prefixo + l.chave)}"
                 aria-expanded="${aberta(l)}" aria-label="${aberta(l) ? 'Comprimir' : 'Expandir'} ${esc(l.rotulo)}"
                 >${aberta(l) ? '−' : '+'}</button> `
            : ''}${esc(l.rotulo)}</th>
        ${meses.map((m) => `<td class="n">${l.meses[m] ? brl(l.meses[m]) : '-'}</td>`).join('')}
        <td class="n">${brl(l.total)}</td></tr>`).join('')}</tbody>
      <tfoot><tr class="total-geral"><th>Total Geral</th>
        ${meses.map((m) => `<td class="n">${totalGeral.meses[m] ? brl(totalGeral.meses[m]) : '-'}</td>`).join('')}
        <td class="n">${brl(totalGeral.total)}</td></tr></tfoot>
    </table></div></section>`;
}

/** Liga os botões da dinâmica montada por `dinamicaHtml`. */
function ligarDinamica() {
  el('#pagina').querySelectorAll('[data-dgrupo]').forEach((b) => {
    b.onclick = () => { alternarRelatorio(b.dataset.dgrupo); render(); };
  });
}

async function viewRelatorio() {
  await garantirEscopo();
  const lancamentos = lancFiltrados();
  const { meses, linhas, totalGeral } = montarPivot(lancamentos);
  const todasAsChaves = linhas.map((l) => l.chave);
  const modo = modoVisao();

  el('#pagina').innerHTML = `
    <div class="filtros">
      <div class="campo" style="width:104px"><label for="r-de">De</label>
        <input id="r-de" placeholder="MM/AAAA" value="${E.filtros.de ? mesExib(E.filtros.de) : ''}"></div>
      <div class="campo" style="width:104px"><label for="r-ate">Até</label>
        <input id="r-ate" placeholder="MM/AAAA" value="${E.filtros.ate ? mesExib(E.filtros.ate) : ''}"></div>
      <div class="campo" style="flex:1 1 150px"><label for="r-busca">Buscar</label>
        <input id="r-busca" placeholder="descrição, tipo, filial…" value="${esc(E.filtros.busca)}"></div>
      ${modo === 'lista' ? `<button class="bt fant" id="r-abrir">Expandir tudo</button>
      <button class="bt fant" id="r-fechar">Recolher tudo</button>` : ''}
      ${seletorModoHtml()}
    </div>
    <p class="nota" style="margin:-4px 0 0">Meses nas colunas, filial e tipo de despesa nas linhas.
      <strong>+</strong> abre a categoria; abrir a categoria mostra os lançamentos, e clicar em um deles
      abre o registro inteiro.</p>
    ${modo !== 'lista' ? blocosPorUnidadeHtml(lancamentos, modo) : linhas.length === 0 ? '<section class="bloco"><p class="vazio">Nenhum lançamento no recorte selecionado.</p></section>' : `
    <section class="bloco" id="r-bloco"><header><h2>Relatório financeiro</h2>
      <span class="nota">${inteiro(totalGeral.itens)} lançamento(s) · ${meses.length} mês(es)</span>
      <button class="bt fant peq" id="r-tela" aria-pressed="false">Tela cheia</button></header>
      <div class="rol rol-fixo"><table class="pivot">
        <thead><tr><th style="min-width:230px">Rótulos de linha</th>
          ${meses.map((m) => `<th class="n">${mesExib(m)}</th>`).join('')}
          <th class="n">Total Geral</th></tr></thead>
        <tbody id="r-corpo"></tbody>
        <tfoot><tr class="total-geral"><th>Total Geral</th>
          ${meses.map((m) => `<td class="n">${totalGeral.meses[m] ? brl(totalGeral.meses[m]) : '-'}</td>`).join('')}
          <td class="n">${brl(totalGeral.total)}</td></tr></tfoot>
      </table></div></section>`}`;

  // Período e busca são os mesmos filtros da tela de Lançamentos: recortar
  // aqui recorta lá, e vice-versa — é o mesmo conjunto de dados.
  const aplicar = (campo, valor) => { E.filtros[campo] = valor; render(); };
  el('#r-de').addEventListener('change', (e) => aplicar('de', mesInterno(e.target.value) || ''));
  el('#r-ate').addEventListener('change', (e) => aplicar('ate', mesInterno(e.target.value) || ''));
  el('#r-busca').addEventListener('change', (e) => aplicar('busca', e.target.value.trim()));
  ligarSeletorModo();

  // Em blocos por unidade não há dinâmica: nada abaixo daqui se aplica.
  if (modo !== 'lista' || !linhas.length) return;

  // Tela cheia: 24 colunas de mês cabem mal em meia tela. Esc sai, porque é o
  // que a mão já faz, e o estado fica no botão para leitor de tela.
  const bloco = el('#r-bloco'), btTela = el('#r-tela');
  const sair = (ev) => { if (ev.key === 'Escape') alternarTela(false); };
  const alternarTela = (cheia) => {
    bloco.classList.toggle('tela-cheia', cheia);
    btTela.setAttribute('aria-pressed', String(cheia));
    btTela.textContent = cheia ? 'Sair da tela cheia' : 'Tela cheia';
    document[cheia ? 'addEventListener' : 'removeEventListener']('keydown', sair);
  };
  btTela.onclick = () => alternarTela(!bloco.classList.contains('tela-cheia'));

  const pintar = () => {
    el('#r-corpo').innerHTML = linhas.map((linha) => {
      // Nível 2 só aparece com a filial aberta.
      if (linha.nivel === 2 && !relatorioAberto(linha.pai)) return '';
      const aberto = relatorioAberto(linha.chave);
      const celulas = meses.map((m) => `<td class="n">${linha.meses[m] ? brl(linha.meses[m]) : '-'}</td>`).join('');

      const cabecalho = `<tr class="grupo-${linha.nivel}">
        <th style="padding-left:${8 + (linha.nivel - 1) * 18}px;font-weight:${linha.nivel === 1 ? 600 : 500}">
          <span style="display:inline-flex;align-items:center;gap:7px">
            <button type="button" class="pivot-grupo" data-rgrupo="${esc(linha.chave)}" aria-expanded="${aberto}"
              aria-label="${aberto ? 'Recolher' : 'Expandir'} ${esc(linha.rotulo)}"
              title="${aberto ? 'Recolher' : 'Expandir'}">${aberto ? '−' : '+'}</button>
            ${esc(linha.rotulo)}
            ${linha.nivel === 2 ? `<span style="color:var(--tinta3);font-size:11.5px">${inteiro(linha.itens.length)} lanç.</span>` : ''}
          </span></th>
        ${celulas}<td class="n">${brl(linha.total)}</td></tr>`;

      if (linha.nivel !== 2 || !aberto) return cabecalho;

      // Nível 3: os lançamentos, montados só quando a categoria está aberta.
      const soma = linha.itens.reduce((s, l) => s + l.valor, 0);
      const detalhe = linha.itens.map((l) => `<tr class="lancamento" data-rlanc="${esc(l.id)}" title="${esc(resumoDoLancamento(l))}">
          <th style="padding-left:54px;font-weight:400"><span style="color:var(--tinta2)">${esc(l.descricao || l.tipo)}</span>
            ${l.origemCusto ? `<div style="font-size:11px;color:var(--tinta3)">${esc(l.origemCusto)}${
              l.destinoPagamento ? ' → ' + esc(l.destinoPagamento) : ''}</div>` : ''}</th>
          ${meses.map((m) => `<td class="n" style="color:var(--tinta2)">${l.competencia === m ? brl(l.valor) : ''}</td>`).join('')}
          <td class="n" style="color:var(--tinta2)">${brl(l.valor)}</td></tr>`).join('');

      // A soma do detalhe ao lado do número do macro: se divergir, a
      // divergência aparece aqui e não num lugar qualquer.
      const conferencia = `<tr class="soma-detalhe">
        <th style="padding-left:54px;font-weight:500">Soma dos ${inteiro(linha.itens.length)} lançamento(s)</th>
        <td class="n" colspan="${meses.length}">${soma === linha.total
          ? '<span style="color:var(--tinta3);font-size:11.5px">confere com o total da linha</span>'
          : '<span class="tag crit">diverge do total da linha</span>'}</td>
        <td class="n">${brl(soma)}</td></tr>`;

      return cabecalho + detalhe + conferencia;
    }).join('');

    el('#r-corpo').querySelectorAll('[data-rgrupo]').forEach((b) => {
      b.onclick = () => { alternarRelatorio(b.dataset.rgrupo); pintar(); };
    });
    el('#r-corpo').querySelectorAll('tr[data-rlanc]').forEach((tr) => {
      tr.onclick = () => {
        const l = lancamentos.find((x) => String(x.id) === tr.dataset.rlanc);
        if (l) detalheDoLancamento(l);
      };
    });
  };

  pintar();
  el('#r-abrir').onclick = () => { gravarAbertos(new Set(todasAsChaves)); pintar(); };
  el('#r-fechar').onclick = () => { gravarAbertos(new Set()); pintar(); };
}

/** Nível 3: o registro inteiro, num modal. */
function detalheDoLancamento(l) {
  const linha = (rotulo, valor) => `<dt>${esc(rotulo)}</dt><dd>${esc(valor)}</dd>`;
  abrirModal({
    titulo: l.descricao || l.tipo,
    corpo: `
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <span class="tag">${brl(l.valor)}</span>
        <span class="tag">${mesExib(l.competencia)}</span>
        <span class="tag">${l.classificacao === 'investimento' ? 'Investimento' : 'Despesa'}</span>
        <span class="tag">${esc(ORIGENS[origemDe(l)].rotulo)}</span>
        ${l.cenario && l.cenario !== 'oficial' ? `<span class="tag alerta">Cenário ${esc(l.cenario)}</span>` : ''}
      </div>
      <dl class="ficha">
        ${linha('Descrição', l.descricao || '—')}
        ${linha('Origem do custo', l.origemCusto || 'não informada')}
        ${linha('Destino do pagamento', l.destinoPagamento || 'não informado')}
        ${linha('Consumo', detalheConsumo(l))}
        ${linha('Documento vinculado', l.documento || '—')}
        ${linha('Filial', l.filial || 'Nível empresa')}
        ${linha('Tipo de despesa', l.tipo)}
        ${linha('Natureza', (NATUREZAS[l.natureza] || l.natureza) +
          (l.parcela && l.parcelas ? ` · parcela ${l.parcela} de ${l.parcelas}` : ''))}
        ${linha('Procedência do dado', ORIGENS[origemDe(l)].rotulo)}
        ${linha('Observações', l.obs || '—')}
      </dl>`,
    acoes: `<button type="button" class="bt" data-c>Fechar</button>`,
    aoMontar({ raiz, fechar }) {
      raiz.querySelector('[data-c]').onclick = fechar;
    },
  });
}
