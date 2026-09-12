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
 * `colunas`: `[{ rotulo, campo | valor(linha), n, texto, link(linha) }]` — `n` alinha
 * à direita, `texto` deixa a célula quebrar linha em vez de cortar, e `link`
 * transforma a célula em link para o sistema de origem.
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
    // Todo detalhamento guarda o mesmo tamanho: é sempre a mesma leitura —
    // muitos registros, colunas de texto longo — e o gestor ajusta uma vez.
    tipo: 'detalhamento',
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
        : `<div class="rol"><table class="larga">
            <thead><tr>${colunas.map((c) => `<th${c.n ? ' class="n"' : ''}>${esc(c.rotulo)}</th>`).join('')}</tr></thead>
            <tbody>${exibidas.map((l) => `<tr>${colunas.map((c) => {
              const v = c.valor ? c.valor(l) : l[c.campo];
              if (v === null || v === undefined || v === '') return `<td${c.n ? ' class="n"' : ''}>—</td>`;
              const href = c.link ? c.link(l) : null;
              const conteudo = href
                ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(String(v))}</a>`
                : esc(String(v));
              // Coluna de texto longo quebra em linha em vez de cortar: ao
              // esticar a tela flutuante, ela usa o espaço que apareceu.
              const classe = c.n ? ' class="n"' : c.texto ? ' class="texto"' : '';
              return `<td${classe}>${conteudo}</td>`;
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
      { rotulo: 'Descrição', valor: (l) => l.descricao || '—', texto: true },
      { rotulo: 'Origem do custo', valor: (l) => l.origemCusto || '—', texto: true },
      { rotulo: 'Destino', valor: (l) => l.destinoPagamento || '—', texto: true },
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
      // O número abre o chamado no sistema de origem — é o caminho para quem
      // quer ver o atendimento inteiro, e não só a linha do relatório.
      { rotulo: 'Chamado', valor: (r) => (r.numero ? '#' + r.numero : r.ticketId ? '#' + r.ticketId : '—'),
        link: urlDoRegistro },
      { rotulo: 'Sistema', valor: (r) => SISTEMAS_SUPORTE[sistemaDe(r)] },
      { rotulo: 'Competência', valor: (r) => mesExib(r.competencia) },
      { rotulo: 'Setor', valor: (r) => setorDe(r) },
      { rotulo: 'Filial', valor: (r) => r.filial || 'Nível empresa' },
      { rotulo: 'Fila', campo: 'fila' },
      { rotulo: 'Assunto', valor: (r) => r.assunto || '—', texto: true },
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
      { rotulo: 'Projeto', valor: (t) => t.projeto || '—', texto: true },
      { rotulo: 'Tarefa', campo: 'nome', texto: true },
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
      { rotulo: 'Projeto', campo: 'nome', texto: true },
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
    const entrada = mapa[i];
    if (!entrada) return;
    // Uma função sozinha é só o drill-down; o objeto permite dizer também o que
    // o número significa, que é o que o tooltip mostra.
    const abrir = typeof entrada === 'function' ? entrada : entrada.abrir;
    const texto = typeof entrada === 'function' ? null : entrada.dica;
    const rotulo = (kpi.querySelector('.r') || {}).textContent || 'indicador';

    if (texto) {
      // O mesmo balão dos gráficos, e não o `title` do navegador: o `title`
      // demora a aparecer, não segue o tema e some no toque.
      const linhas = [{ nome: texto, valor: '' }];
      kpi.addEventListener('mousemove', (ev) => mostrarDica(ev, rotulo, linhas));
      kpi.addEventListener('mouseleave', sumirDica);
      // Quem navega por teclado não passa o mouse: o balão acompanha o foco.
      kpi.addEventListener('focus', () => {
        const c = kpi.getBoundingClientRect();
        mostrarDica({ clientX: c.left + c.width / 2, clientY: c.top + c.height }, rotulo, linhas);
      });
      kpi.addEventListener('blur', sumirDica);
      // Sem drill-down o indicador não recebe foco por si: o tooltip ainda
      // precisa ser alcançável, então ele entra na ordem de tabulação.
      if (!abrir) kpi.setAttribute('tabindex', '0');
      // O balão é visual; o `title` é o que o leitor de tela encontra.
      kpi.setAttribute('title', texto);
    }

    if (abrir) {
      comDrill(kpi, rotulo, () => { sumirDica(); abrir(); });
      // `comDrill` põe um aria-label, que substitui o conteúdo lido. O
      // significado do número entra nele, ou se perderia para quem não vê.
      if (texto) {
        kpi.setAttribute('aria-label', rotulo + ' — ' + texto + ' Abrir os registros que compõem este número.');
      }
    }
  });
}
