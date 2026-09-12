// ===========================================================================
// Detalhamento — o drill-down padrão de todo gráfico e todo indicador
// ===========================================================================
//
// Um número numa tela é sempre a soma de registros. Clicar nele abre esses
// registros, com o MESMO recorte que produziu o número — é essa a garantia que
// faz o detalhamento valer: se ele viesse de outra consulta, poderia divergir
// do que estava na tela, e o gestor não teria como saber qual dos dois está
// certo.
//
// Este arquivo concentra as três peças: o texto do tooltip, a abertura do
// detalhamento e o que torna um elemento clicável de forma acessível.

/**
 * Torna um elemento um gatilho de drill-down: clicável, alcançável por teclado
 * e anunciado como botão. Um `div` com `onclick` não é nada disso.
 */
function comDrill(elemento, rotulo, aoAbrir) {
  if (!elemento) return;
  elemento.classList.add('drill');
  elemento.setAttribute('role', 'button');
  elemento.setAttribute('tabindex', '0');
  elemento.setAttribute('aria-label', rotulo + ' — abrir os registros que compõem este número');
  elemento.addEventListener('click', aoAbrir);
  elemento.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); aoAbrir(ev); }
  });
}

/** Descreve o recorte em vigor, para o detalhamento dizer de onde veio. */
function recorteAtual() {
  const partes = [];
  const nomes = (ids, lista) => [...ids].map((i) => (lista.find((x) => x.id === i) || {}).nome || i).join(', ');
  if (E.empresasSel.size) partes.push('Empresa: ' + nomes(E.empresasSel, E.empresas));
  if (E.filiaisSel.size) partes.push('Filial: ' + [...E.filiaisSel].join(', '));
  if (E.competencias.size) partes.push('Competência: ' + ordenado(E.competencias).map(mesExib).join(', '));
  if (E.cenariosSel.size && !(E.cenariosSel.size === 1 && E.cenariosSel.has('oficial'))) {
    partes.push('Cenário: ' + [...E.cenariosSel].join(', '));
  }
  if (E.origens.size) partes.push('Base: ' + [...E.origens].map((o) => ORIGENS[o].rotulo).join(', '));
  return partes;
}

/** Teto de linhas exibidas. Acima disso a tela some antes de ajudar. */
const TETO_DETALHE = 300;

/**
 * Abre o detalhamento de um número: os registros que o compõem, o recorte que
 * os produziu, e a soma — que tem de bater com o número clicado.
 *
 * `colunas`: `[{ rotulo, campo | valor(linha), n }]` — `n` alinha à direita.
 * `total`: o número que estava na tela, para a conferência ficar explícita.
 */
function abrirDetalhamento({ titulo, subtitulo, colunas, linhas, total, formatarTotal = brl, somar }) {
  const soma = somar ? linhas.reduce((s, l) => s + somar(l), 0) : null;
  const bate = total === null || total === undefined || soma === null
    ? null
    : Math.abs(soma - total) < 0.005;
  const recorte = recorteAtual();
  const exibidas = linhas.slice(0, TETO_DETALHE);

  abrirModal({
    titulo: 'Detalhamento — ' + titulo,
    corpo: `
      ${subtitulo ? `<p class="nota" style="margin:0">${esc(subtitulo)}</p>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <span class="tag">${inteiro(linhas.length)} registro(s)</span>
        ${soma === null ? '' : `<span class="tag">Soma: ${esc(formatarTotal(soma))}</span>`}
        ${bate === null ? '' : bate
          ? '<span class="tag bom">confere com o indicador</span>'
          : `<span class="tag crit">diverge do indicador (${esc(formatarTotal(total))})</span>`}
      </div>
      ${recorte.length ? `<p class="nota" style="margin:2px 0 0">Recorte aplicado — ${esc(recorte.join(' · '))}</p>` : ''}
      ${linhas.length === 0
        ? '<p class="vazio">Nenhum registro compõe este número no recorte atual.</p>'
        : `<div class="rol" style="max-height:52vh"><table>
            <thead><tr>${colunas.map((c) => `<th${c.n ? ' class="n"' : ''}>${esc(c.rotulo)}</th>`).join('')}</tr></thead>
            <tbody>${exibidas.map((l) => `<tr>${colunas.map((c) => {
              const v = c.valor ? c.valor(l) : l[c.campo];
              return `<td${c.n ? ' class="n"' : ''}>${v === null || v === undefined || v === '' ? '—' : esc(String(v))}</td>`;
            }).join('')}</tr>`).join('')}</tbody></table></div>
          ${linhas.length > TETO_DETALHE
            ? `<p class="nota">Exibindo os ${TETO_DETALHE} primeiros de ${inteiro(linhas.length)}. Estreite o recorte para ver o resto.</p>`
            : ''}`}`,
    acoes: `<button type="button" class="bt" data-c>Fechar</button>`,
    aoMontar({ raiz, fechar }) {
      raiz.querySelector('[data-c]').onclick = fechar;
    },
  });
}

// ------------------------------------------------- detalhamentos por domínio
//
// Cada um recebe os registros JÁ FILTRADOS pela tela que o chamou. É isso que
// garante que o detalhamento mostra o mesmo recorte do número clicado.

/** Lançamentos financeiros. */
function detalharLancamentos(titulo, lista, total, subtitulo) {
  abrirDetalhamento({
    titulo, subtitulo, total,
    somar: (l) => l.valor,
    linhas: [...lista].sort((a, b) => b.valor - a.valor),
    colunas: [
      { rotulo: 'Competência', valor: (l) => mesExib(l.competencia) },
      { rotulo: 'Filial', valor: (l) => l.filial || 'Nível empresa' },
      { rotulo: 'Tipo', campo: 'tipo' },
      { rotulo: 'Descrição', valor: (l) => l.descricao || '—' },
      { rotulo: 'Origem do custo', valor: (l) => l.origemCusto || '—' },
      { rotulo: 'Destino', valor: (l) => l.destinoPagamento || '—' },
      { rotulo: 'Procedência', valor: (l) => ORIGENS[origemDe(l)].rotulo },
      { rotulo: 'Valor', valor: (l) => brl(l.valor), n: true },
    ],
  });
}

/** Chamados / registros de SLA. */
function detalharChamados(titulo, lista, total, subtitulo) {
  abrirDetalhamento({
    titulo, subtitulo, total,
    formatarTotal: inteiro,
    somar: (r) => r.total || 0,
    linhas: [...lista].sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || ''))),
    colunas: [
      { rotulo: 'Chamado', valor: (r) => (r.numero ? '#' + r.numero : r.ticketId ? '#' + r.ticketId : '—') },
      { rotulo: 'Sistema', valor: (r) => SISTEMAS_SUPORTE[sistemaDe(r)] },
      { rotulo: 'Competência', valor: (r) => mesExib(r.competencia) },
      { rotulo: 'Setor', valor: (r) => setorDe(r) },
      { rotulo: 'Filial', valor: (r) => r.filial || 'Nível empresa' },
      { rotulo: 'Fila', campo: 'fila' },
      { rotulo: 'Assunto', valor: (r) => r.assunto || '—' },
      { rotulo: 'Solicitante', valor: (r) => r.solicitante || '—' },
      { rotulo: 'Responsável', valor: (r) => r.atendente || '—' },
      { rotulo: 'SLA', valor: (r) => ((r.dentro || 0) >= (r.total || 1) ? 'Dentro' : 'Fora') },
    ],
  });
}

/** Tarefas de projeto. */
function detalharTarefas(titulo, lista, total, subtitulo) {
  abrirDetalhamento({
    titulo, subtitulo, total,
    formatarTotal: inteiro,
    somar: () => 1,
    linhas: lista,
    colunas: [
      { rotulo: 'Projeto', valor: (t) => t.projeto || '—' },
      { rotulo: 'Tarefa', campo: 'nome' },
      { rotulo: 'Responsável', valor: (t) => t.responsavel || 'sem responsável' },
      { rotulo: 'Início', valor: (t) => mesExib(t.inicio) },
      { rotulo: 'Fim planejado', valor: (t) => mesExib(t.fimPlanejado) },
      { rotulo: 'Fim real', valor: (t) => (t.fimReal ? mesExib(t.fimReal) : 'em aberto') },
      { rotulo: 'Situação', valor: (t) => {
        const a = atrasoDe(t.fimPlanejado, t.fimReal, 'x');
        return t.fimReal ? 'Concluída' : a.atrasado ? `Atrasada (${a.meses}m)` : 'Pendente';
      } },
    ],
  });
}

/** Projetos. */
function detalharProjetos(titulo, lista, total, subtitulo) {
  abrirDetalhamento({
    titulo, subtitulo, total,
    formatarTotal: inteiro,
    somar: () => 1,
    linhas: lista,
    colunas: [
      { rotulo: 'Projeto', campo: 'nome' },
      { rotulo: 'Filial', valor: (p) => p.filial || 'Nível empresa' },
      { rotulo: 'Início', valor: (p) => mesExib(p.inicio) },
      { rotulo: 'Fim planejado', valor: (p) => mesExib(p.fimPlanejado) },
      { rotulo: 'Fim real', valor: (p) => (p.fimReal ? mesExib(p.fimReal) : 'em aberto') },
      { rotulo: 'Status', valor: (p) => STATUS_PROJ[p.status] || p.status },
      { rotulo: 'Tarefas', valor: (p) => inteiro((p.tarefas || []).length), n: true },
    ],
  });
}

/**
 * Liga os indicadores (`.kpi`) de uma tela ao seu detalhamento.
 *
 * `mapa`: `{ [índice do KPI]: () => void }` — cada entrada abre os registros
 * daquele número. O KPI sem entrada no mapa não vira botão: nem todo número
 * tem registros por trás (uma mediana, um percentual isolado), e fingir que
 * tem seria pior do que não oferecer.
 */
function ligarKpis(mapa) {
  el('#pagina').querySelectorAll('.kpi').forEach((kpi, i) => {
    const abrir = mapa[i];
    if (!abrir) return;
    const rotulo = (kpi.querySelector('.r') || {}).textContent || 'indicador';
    comDrill(kpi, rotulo, abrir);
  });
}
