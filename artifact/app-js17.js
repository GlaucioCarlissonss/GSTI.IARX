// ===========================================================================
// Indicadores Gerais — a leitura estratégica, separada da operação
// ===========================================================================
/**
 * Três blocos independentes, dois indicadores cada. Independentes de propósito:
 * cada bloco tem os PRÓPRIOS filtros, e mexer no período do financeiro não faz
 * o SLA recarregar. Os filtros também não atravessam para as demais telas —
 * quem vem conferir um número aqui não quer encontrar o sistema inteiro
 * recortado depois.
 *
 * Por isso o recorte vive em `E.filtrosInd`, que é memória de sessão: não vai
 * para o `localStorage` nem toca em `E.competencias`, que é o filtro global.
 */
const BLOCOS_IND = ['financeiro', 'sla', 'projetos'];

/** Meta de conformidade de SLA, em pontos percentuais. */
const META_SLA = 80;

/** Recorte em branco de um bloco: período livre, todas as filiais, tudo. */
const recorteVazio = () => ({ de: '', ate: '', filiais: new Set(), somenteReconhecidas: false });

function recorteDoBloco(bloco) {
  if (!E.filtrosInd) E.filtrosInd = {};
  if (!E.filtrosInd[bloco]) E.filtrosInd[bloco] = recorteVazio();
  return E.filtrosInd[bloco];
}

/** A competência está na janela do bloco? Ponta em branco não limita. */
function naJanela(comp, r) {
  if (r.de && comp < r.de) return false;
  if (r.ate && comp > r.ate) return false;
  return true;
}

const naFilialDoBloco = (valor, r) => (r.filiais.size === 0 ? true : r.filiais.has(valor || '(empresa)'));

// ------------------------------------------------------------- cálculo
/**
 * Redução de custo: só a despesa RECORRENTE entra.
 *
 * Uma compra pontual num mês e nenhuma no seguinte produziria uma "redução" que
 * é só o fim de uma compra. A tendência compara as médias das duas metades do
 * período, e não o último ponto: um mês atípico no fim não é direção.
 */
function calcularReducao(r) {
  const porMes = new Map();
  for (const l of Loja.todosDoEscopo()) {
    if (l.natureza !== 'fixa') continue;
    if (!passaNoFiltro(E.cenariosSel, l.cenario)) continue;
    if (!naFilialDoBloco(l.filial, r)) continue;
    if (!naJanela(l.competencia, r)) continue;
    if (r.somenteReconhecidas && !reconhecidoDe(l)) continue;
    const atual = porMes.get(l.competencia) || { c: 0, n: 0 };
    porMes.set(l.competencia, { c: atual.c + cent(l.valor), n: atual.n + 1 });
  }
  const meses = ordenado([...porMes.keys()]);
  const serie = meses.map((m, i) => {
    const anterior = i > 0 ? porMes.get(meses[i - 1]).c : null;
    const c = porMes.get(m).c;
    return {
      comp: m, rot: mesExib(m), valor: reais(c), centavos: c, lancamentos: porMes.get(m).n,
      // Sem mês anterior não há variação — e 0 % diria que ficou igual.
      variacao: anterior === null || anterior === 0 ? null : Math.round(((c - anterior) / anterior) * 1000) / 10,
    };
  });
  const primeiro = serie[0] ? serie[0].centavos : 0;
  const ultimo = serie.length ? serie[serie.length - 1].centavos : 0;
  const metade = Math.floor(serie.length / 2);
  const media = (fatia) => (fatia.length ? fatia.reduce((s, p) => s + p.centavos, 0) / fatia.length : 0);
  const inicioMedio = media(serie.slice(0, metade || 1));
  const variacaoMedia = inicioMedio === 0 ? 0 : ((media(serie.slice(metade)) - inicioMedio) / inicioMedio) * 100;
  return {
    serie,
    valorInicial: reais(primeiro), valorFinal: reais(ultimo),
    variacaoTotal: serie.length < 2 || primeiro === 0 ? null : Math.round(((ultimo - primeiro) / primeiro) * 1000) / 10,
    economia: reais(Math.max(primeiro - ultimo, 0)),
    tendencia: serie.length < 2 ? 'indefinida' : variacaoMedia <= -2 ? 'queda' : variacaoMedia >= 2 ? 'alta' : 'estavel',
  };
}

/**
 * Despesas por reconhecer, agrupadas por centro de custo.
 *
 * Neste sistema o centro de custo É o tipo de despesa: é assim que as bases do
 * cliente vêm rotuladas, e a importação já traduz um pelo outro. O agrupamento
 * é explícito porque a carga concentra quase tudo por reconhecer — sem contador
 * por centro, o gestor veria um número grande e nenhum lugar por onde começar.
 */
function calcularPorReconhecer(r) {
  const centros = new Map();
  let universoN = 0, universoC = 0, n = 0, c = 0;
  for (const l of Loja.todosDoEscopo()) {
    if (!passaNoFiltro(E.cenariosSel, l.cenario)) continue;
    if (!naFilialDoBloco(l.filial, r)) continue;
    if (!naJanela(l.competencia, r)) continue;
    universoN += 1; universoC += cent(l.valor);
    if (reconhecidoDe(l)) continue;
    n += 1; c += cent(l.valor);
    const chave = l.tipo || '(sem centro de custo)';
    const atual = centros.get(chave) || { n: 0, c: 0 };
    centros.set(chave, { n: atual.n + 1, c: atual.c + cent(l.valor) });
  }
  return {
    quantidade: n, valor: reais(c), universoN, universoValor: reais(universoC),
    pctQuantidade: universoN ? Math.round((n / universoN) * 1000) / 10 : 0,
    centros: [...centros.entries()]
      .map(([centro, v]) => ({ centro, quantidade: v.n, valor: reais(v.c) }))
      .sort((a, b) => b.valor - a.valor),
  };
}

/**
 * Conformidade de SLA e situação dos chamados.
 *
 * "Vencido" não é status de origem: é o chamado cujo prazo passou e que ninguém
 * resolveu. Convive com aberto e em andamento, por isso é contado À PARTE — as
 * quatro somadas dariam mais que o total, e a tela precisa dizer isso.
 */
function calcularSla(r) {
  let total = 0, dentro = 0, abertos = 0, andamento = 0, resolvidos = 0, vencidos = 0, comStatus = 0;
  const agora = new Date().toISOString();
  for (const e of escopoEmpresas()) {
    for (const s of (E.sla.get(e) || [])) {
      if (!naFilialDoBloco(s.filial, r)) continue;
      if (!naJanela(s.competencia, r)) continue;
      total += s.total || 0;
      dentro += s.dentro || 0;
      if (!s.status) continue;
      comStatus += s.total || 1;
      const st = String(s.status).toLowerCase();
      if (/resolvid|fechad|closed|resolved/.test(st)) resolvidos += 1;
      else if (/andamento|progress|process/.test(st)) andamento += 1;
      else abertos += 1;
      if (!/resolvid|fechad|closed|resolved/.test(st) && s.prazoEm && s.prazoEm < agora) vencidos += 1;
    }
  }
  const pct = total ? Math.round((dentro / total) * 1000) / 10 : 0;
  return {
    total, dentro, fora: total - dentro, pct, meta: META_SLA,
    atinge: total > 0 && pct >= META_SLA,
    distancia: total > 0 ? Math.round((pct - META_SLA) * 10) / 10 : null,
    abertos, andamento, resolvidos, vencidos, semStatus: total - comStatus,
  };
}

/**
 * Entrega de tarefas na competência.
 *
 * O denominador do "no prazo" é o que foi ENTREGUE: uma tarefa ainda em aberto
 * não está fora do prazo enquanto o mês planejado não passou. A cancelada fica
 * de fora das duas contas — não foi entregue nem está pendente.
 */
function calcularProjetos(r) {
  let entregues = 0, noPrazo = 0, pendentes = 0, atrasadas = 0, canceladas = 0, total = 0;
  const hoje = mesHoje();
  for (const e of escopoEmpresas()) {
    for (const p of (E.projetos.get(e) || [])) {
      if (!naFilialDoBloco(p.filial, r)) continue;
      for (const t of (p.tarefas || [])) {
        if (!naJanela(t.fimPlanejado, r)) continue;
        total += 1;
        if (t.status === 'cancelada') { canceladas += 1; continue; }
        if (t.status === 'concluida' && t.fimReal) {
          entregues += 1;
          if (t.fimReal <= t.fimPlanejado) noPrazo += 1;
        } else {
          pendentes += 1;
          if (t.fimPlanejado < hoje) atrasadas += 1;
        }
      }
    }
  }
  return {
    total, entregues, noPrazo, foraDoPrazo: entregues - noPrazo, canceladas, pendentes, atrasadas,
    pct: entregues ? Math.round((noPrazo / entregues) * 1000) / 10 : 0,
  };
}

// -------------------------------------------------------------- desenho
/**
 * Termômetro: preenchimento proporcional ao percentual, com o marcador da meta.
 *
 * A cor carrega a severidade, mas nunca sozinha — o número e a palavra estão
 * ao lado, e a meta vem rotulada sobre o próprio traço. A trilha não pintada é
 * um tom fraco da mesma escala, para o estado se ler na barra inteira.
 */
function termometro(alvo, pct, meta, rotulo) {
  alvo.replaceChildren();
  const L = 700, A = 74, m = { e: 8, d: 8, t: 26 }, lp = L - m.e - m.d, alt = 22;
  const cor = pct >= meta ? 'var(--bom)' : pct >= meta - 10 ? 'var(--alerta)' : 'var(--crit)';
  const svg = svgEl('svg', { viewBox: `0 0 ${L} ${A}`, role: 'img',
    'aria-label': `${rotulo}: ${pct}% contra a meta de ${meta}%` });

  svg.appendChild(svgEl('rect', { x: m.e, y: m.t, width: lp, height: alt, rx: 6,
    fill: 'color-mix(in srgb, var(--tinta3) 16%, transparent)' }));
  const cheio = Math.max(0, Math.min(100, pct)) / 100 * lp;
  if (cheio > 0) {
    svg.appendChild(svgEl('path', { d: pathBarra(m.e, m.t, cheio, alt, 6), fill: cor }));
  }

  // Marcador da meta: traço de ponta a ponta da barra, rotulado. Uma linha sem
  // rótulo viraria decoração — e é justamente o número que decide a leitura.
  const xm = m.e + (meta / 100) * lp;
  svg.appendChild(svgEl('line', { x1: xm, x2: xm, y1: m.t - 6, y2: m.t + alt + 6,
    stroke: 'var(--tinta)', 'stroke-width': 2 }));
  const rot = svgEl('text', { x: xm, y: m.t - 11, 'text-anchor': 'middle', class: 'eixo' });
  rot.textContent = `meta ${meta}%`;
  svg.appendChild(rot);

  const valor = svgEl('text', { x: m.e + 10, y: m.t + alt + 18, class: 'eixo' });
  valor.textContent = '0%';
  svg.appendChild(valor);
  const fim = svgEl('text', { x: L - m.d - 10, y: m.t + alt + 18, 'text-anchor': 'end', class: 'eixo' });
  fim.textContent = '100%';
  svg.appendChild(fim);
  alvo.appendChild(svg);
}

/** Filtros do bloco: período próprio e filiais próprias, nada global. */
function filtrosDoBloco(bloco, r) {
  return `<div class="filtros" style="box-shadow:none;border:0;padding:0;margin-bottom:14px">
      <div class="campo" style="width:118px"><label for="i-${bloco}-de">De</label>
        <input id="i-${bloco}-de" value="${r.de ? mesExib(r.de) : ''}" placeholder="MM/AAAA"></div>
      <div class="campo" style="width:118px"><label for="i-${bloco}-ate">Até</label>
        <input id="i-${bloco}-ate" value="${r.ate ? mesExib(r.ate) : ''}" placeholder="MM/AAAA"></div>
      <div class="campo" style="min-width:190px"><label>Filial</label>
        <div data-sel="i-${bloco}-filial"></div></div>
      ${bloco === 'financeiro' ? `
      <div class="campo" style="min-width:230px"><label for="i-rec">Despesas consideradas</label>
        <select id="i-rec">
          <option value="tudo"${r.somenteReconhecidas ? '' : ' selected'}>Ver tudo</option>
          <option value="rec"${r.somenteReconhecidas ? ' selected' : ''}>Apenas reconhecidas</option>
        </select></div>` : ''}
      <button class="bt fant" data-limpar="${bloco}">Limpar filtros do bloco</button>
    </div>`;
}

async function viewIndicadores() {
  await Loja.configuracao();
  for (const e of escopoEmpresas()) { await Loja.slaDa(e); await Loja.projetosDa(e); }

  const rf = recorteDoBloco('financeiro');
  const rs = recorteDoBloco('sla');
  const rp = recorteDoBloco('projetos');
  const reducao = calcularReducao(rf);
  const pendente = calcularPorReconhecer(rf);
  const sla = calcularSla(rs);
  const proj = calcularProjetos(rp);

  // As quebras por unidade saem dos MESMOS registros que os cálculos acima
  // percorrem — é isso que garante que a soma da sanfona seja o número do card.
  const emDinheiro = (v) => brl(reais(v));
  const naoReconhecidos = Loja.todosDoEscopo().filter((l) =>
    passaNoFiltro(E.cenariosSel, l.cenario) && naFilialDoBloco(l.filial, rf) &&
    naJanela(l.competencia, rf) && !reconhecidoDe(l));
  const tickets = ticketsDoRecorte(rs);
  const q = {
    fixos: quebrarPorUnidade(fixosDoRecorte(rf), (l) => cent(l.valor)),
    pendentes: quebrarPorUnidade(naoReconhecidos, (l) => cent(l.valor)),
    sla: quebraDeSla(tickets),
    entregues: quebrarPorUnidade(tarefasDoRecorte(rp, 'entregues'), () => 1),
    tarefasPendentes: quebrarPorUnidade(tarefasDoRecorte(rp, 'pendentes'), () => 1),
  };
  // No SLA, o que a filial "vale" para a faixa é o volume de atendimento: uma
  // filial com 2 chamados não pode ocupar o mesmo espaço de uma com 2000.
  const extraSla = {
    coluna: 'Chamados',
    colunaExtra: 'Conformidade',
    matriz: (m) => rotuloConformidade(m),
    filial: (f) => rotuloConformidade(f),
  };

  const seta = { queda: '↓', alta: '↑', estavel: '→', indefinida: '·' };
  const palavra = { queda: 'em queda', alta: 'em alta', estavel: 'estável', indefinida: 'sem base para dizer' };

  el('#pagina').innerHTML = `
    <div class="msg"><strong>Leitura estratégica, separada da operação.</strong>
      Cada bloco tem os próprios filtros, e eles não atravessam para as outras telas do sistema — nem sobrevivem
      ao recarregar. Quem responde "a integração está viva?" é a tela de Integrações; aqui se responde como vão o
      gasto, o atendimento e a entrega.</div>

    <section class="bloco" style="margin-top:16px">
      <header><h2>Financeiro</h2>
        <span class="nota">${rf.somenteReconhecidas ? 'apenas despesas reconhecidas' : 'todas as despesas'}</span></header>
      ${filtrosDoBloco('financeiro', rf)}

      <div class="kpis">
        <div class="kpi">
          <span class="r">Custo recorrente — variação no período</span>
          <span class="n" style="color:${reducao.tendencia === 'queda' ? 'var(--bomtxt)' : reducao.tendencia === 'alta' ? 'var(--crit)' : 'var(--tinta)'}">
            ${reducao.variacaoTotal === null ? '—' : (reducao.variacaoTotal > 0 ? '+' : '') + reducao.variacaoTotal.toLocaleString('pt-BR') + '%'}</span>
          <span class="a">${esc(seta[reducao.tendencia])} ${esc(palavra[reducao.tendencia])}${
            reducao.economia > 0 ? ` · economia de ${brl(reducao.economia)}/mês` : ''}</span>
          ${faixaDeMatrizesHtml(fatiasDe(q.fixos, emDinheiro))}
          ${legendaDeMatrizesHtml(fatiasDe(q.fixos, emDinheiro))}
          ${sanfonaHtml('ind-fixos', q.fixos, emDinheiro)}
        </div>
        <div class="kpi">
          <span class="r">Despesas por reconhecer</span>
          <span class="n" style="color:${pendente.quantidade ? 'var(--alerta)' : 'var(--bomtxt)'}">${brl(pendente.valor)}</span>
          <span class="a">${inteiro(pendente.quantidade)} de ${inteiro(pendente.universoN)} lançamentos
            (${pendente.pctQuantidade.toLocaleString('pt-BR')}%)</span>
          ${faixaDeMatrizesHtml(fatiasDe(q.pendentes, emDinheiro))}
          ${legendaDeMatrizesHtml(fatiasDe(q.pendentes, emDinheiro))}
          ${sanfonaHtml('ind-pendentes', q.pendentes, emDinheiro)}
        </div>
      </div>

      <div class="grade g2" style="margin-top:16px">
        <section class="bloco" style="box-shadow:none">
          <header><h2>Custo recorrente mês a mês</h2>
            <span class="nota">${inteiro(reducao.serie.length)} competência(s)</span></header>
          <div id="i-reducao"></div>
          ${reducao.serie.length ? `<div class="rol rol-fixo" style="margin-top:12px;max-height:280px;min-height:0"><table>
            <thead><tr><th>Competência</th><th class="n">Custo recorrente</th><th class="n">Variação</th></tr></thead>
            <tbody>${reducao.serie.map((p) => `<tr>
              <td>${esc(p.rot)}</td><td class="n">${brl(p.valor)}</td>
              <td class="n"${p.variacao === null ? '' : ` style="color:${p.variacao < 0 ? 'var(--bomtxt)' : p.variacao > 0 ? 'var(--crit)' : 'var(--tinta2)'}"`}>${
                p.variacao === null ? '—' : (p.variacao > 0 ? '+' : '') + p.variacao.toLocaleString('pt-BR') + '%'}</td>
            </tr>`).join('')}</tbody></table></div>` : ''}
          ${rf.somenteReconhecidas ? '<p class="nota" style="margin-top:10px">Exibindo apenas despesas reconhecidas.</p>' : ''}
        </section>

        <section class="bloco" style="box-shadow:none">
          <header><h2>Por reconhecer, por centro de custo</h2>
            <span class="nota">${inteiro(pendente.centros.length)} centro(s)</span></header>
          ${pendente.centros.length === 0
            ? '<p class="vazio">Nada por reconhecer neste recorte.</p>'
            : `<div class="rol"><table>
                <thead><tr><th>Centro de custo</th><th class="n">Lançamentos</th><th class="n">Valor</th></tr></thead>
                <tbody>${pendente.centros.map((c) => `<tr data-centro="${esc(c.centro)}">
                  <td>${esc(c.centro)}</td><td class="n">${inteiro(c.quantidade)}</td>
                  <td class="n" style="color:var(--alerta);font-weight:700">${brl(c.valor)}</td></tr>`).join('')}</tbody>
                <tfoot><tr><td>Total</td><td class="n">${inteiro(pendente.quantidade)}</td>
                  <td class="n">${brl(pendente.valor)}</td></tr></tfoot></table></div>
              <p class="nota" style="margin-top:10px">O centro de custo é o tipo de despesa — é assim que as bases
                vêm rotuladas.</p>`}
        </section>
      </div>
    </section>

    <section class="bloco" style="margin-top:16px">
      <header><h2>SLA</h2><span class="nota">meta de ${META_SLA}%</span></header>
      ${filtrosDoBloco('sla', rs)}

      <div class="kpis">
        <div class="kpi">
          <span class="r">Atendidos dentro do SLA</span>
          <span class="n" style="color:${sla.total === 0 ? 'var(--tinta)' : sla.atinge ? 'var(--bomtxt)' : 'var(--crit)'}">${
            sla.total ? sla.pct.toLocaleString('pt-BR') + '%' : '—'}</span>
          <span class="a">${sla.total
            ? `${sla.atinge ? '✓ atinge' : '✗ abaixo d'}a meta de ${META_SLA}% · ${
                sla.distancia > 0 ? '+' : ''}${sla.distancia.toLocaleString('pt-BR')} p.p.`
            : 'sem chamado no recorte'}</span>
          ${faixaDeMatrizesHtml(fatiasDe(q.sla, inteiro))}
          ${legendaDeMatrizesHtml(fatiasDe(q.sla, inteiro))}
          ${sanfonaHtml('ind-sla', q.sla, inteiro, extraSla)}
        </div>
        <div class="kpi">
          <span class="r">Chamados no recorte</span>
          <span class="n">${inteiro(sla.total)}</span>
          <span class="a">${inteiro(sla.dentro)} dentro · ${inteiro(sla.fora)} fora</span>
          ${faixaDeMatrizesHtml(fatiasDe(q.sla, inteiro))}
          ${legendaDeMatrizesHtml(fatiasDe(q.sla, inteiro))}
          ${sanfonaHtml('ind-chamados', q.sla, inteiro, extraSla)}
        </div>
      </div>

      <div id="i-termometro" style="margin-top:16px"></div>

      <div class="grade g3" style="margin-top:16px">
        ${[['Abertos', sla.abertos, ''], ['Em andamento', sla.andamento, ''],
           ['Resolvidos', sla.resolvidos, 'bomtxt'], ['Vencidos', sla.vencidos, 'crit']]
          .map(([rot, n, cor]) => `<div class="bloco" style="box-shadow:none">
            <span class="r" style="font-family:var(--mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--tinta3)">${esc(rot)}</span>
            <div style="font-size:25px;font-weight:600${cor ? `;color:var(--${cor})` : ''}">${inteiro(n)}</div>
          </div>`).join('')}
      </div>
      <p class="nota" style="margin-top:10px">
        <strong>Vencido</strong> atravessa aberto e em andamento — é o chamado cujo prazo passou e ninguém resolveu.
        Por isso não soma com os outros três.${sla.semStatus > 0
          ? ` ${inteiro(sla.semStatus)} atendimento(s) vêm de registro agregado do mês, que não tem situação.` : ''}</p>
    </section>

    <section class="bloco" style="margin-top:16px">
      <header><h2>Projetos</h2><span class="nota">por competência de entrega planejada</span></header>
      ${filtrosDoBloco('projetos', rp)}

      <div class="kpis">
        <div class="kpi">
          <span class="r">Tarefas entregues no prazo</span>
          <span class="n" style="color:${proj.entregues === 0 ? 'var(--tinta)' : proj.pct >= 80 ? 'var(--bomtxt)' : 'var(--crit)'}">${
            proj.entregues ? proj.pct.toLocaleString('pt-BR') + '%' : '—'}</span>
          <span class="a">${proj.entregues
            ? `${inteiro(proj.noPrazo)} de ${inteiro(proj.entregues)} entregues`
            : 'nenhuma tarefa entregue no recorte'}</span>
          ${faixaDeMatrizesHtml(fatiasDe(q.entregues, inteiro))}
          ${legendaDeMatrizesHtml(fatiasDe(q.entregues, inteiro))}
          ${sanfonaHtml('ind-entregues', q.entregues, inteiro, { coluna: 'Tarefas', colunaExtra: '', matriz: () => '', filial: () => '' })}
        </div>
        <div class="kpi">
          <span class="r">Tarefas pendentes</span>
          <span class="n"${proj.atrasadas ? ' style="color:var(--alerta)"' : ''}>${inteiro(proj.pendentes)}</span>
          <span class="a">${proj.atrasadas
            ? `${inteiro(proj.atrasadas)} com o mês planejado já vencido`
            : 'nenhuma com o mês planejado vencido'}</span>
          ${faixaDeMatrizesHtml(fatiasDe(q.tarefasPendentes, inteiro))}
          ${legendaDeMatrizesHtml(fatiasDe(q.tarefasPendentes, inteiro))}
          ${sanfonaHtml('ind-tarefas-pendentes', q.tarefasPendentes, inteiro, { coluna: 'Tarefas', colunaExtra: '', matriz: () => '', filial: () => '' })}
        </div>
      </div>
      <p class="nota" style="margin-top:12px">O denominador do percentual é o que foi <strong>entregue</strong>:
        tarefa ainda em aberto não está fora do prazo enquanto o mês planejado não passa.
        ${proj.canceladas ? `${inteiro(proj.canceladas)} cancelada(s) ficam fora das duas contas.` : ''}</p>
    </section>`;

  // ----------------------------------------------------------- desenho
  if (reducao.serie.length) {
    linhas(el('#i-reducao'), reducao.serie.map((p) => ({ rot: p.rot, v: { custo: p.valor } })),
      [{ k: 'custo', nome: 'Custo recorrente', cor: 'var(--s1)' }]);
  } else {
    el('#i-reducao').innerHTML = '<p class="vazio">Sem despesa recorrente neste recorte.</p>';
  }
  termometro(el('#i-termometro'), sla.total ? sla.pct : 0, META_SLA, 'Atendidos dentro do SLA');

  // ----------------------------------------------------------- ligações
  for (const bloco of BLOCOS_IND) {
    const r = recorteDoBloco(bloco);
    const mudar = (campo, valor) => { r[campo] = valor; render(); };
    el(`#i-${bloco}-de`).addEventListener('change', (ev) => mudar('de', mesInterno(ev.target.value) || ''));
    el(`#i-${bloco}-ate`).addEventListener('change', (ev) => mudar('ate', mesInterno(ev.target.value) || ''));
    seletorMulti(el(`[data-sel="i-${bloco}-filial"]`), {
      id: `i-${bloco}-filial`, rotulo: 'Filial',
      itens: [{ valor: '(empresa)', rotulo: 'Sem filial (nível empresa)' },
        ...filiaisDoEscopo().map((f) => ({ valor: f.nome, rotulo: f.nome }))],
      selecionados: r.filiais,
      aoMudar: (novo) => { r.filiais = novo; render(); },
    });
  }
  el('#pagina').querySelectorAll('[data-limpar]').forEach((b) => b.onclick = () => {
    E.filtrosInd[b.dataset.limpar] = recorteVazio();
    render();
  });
  // O switch recalcula o BLOCO inteiro: indicadores, série e tabela. Filtrar só
  // o gráfico deixaria o KPI dizendo uma coisa e a curva outra.
  const rec = el('#i-rec');
  if (rec) rec.addEventListener('change', () => { rf.somenteReconhecidas = rec.value === 'rec'; render(); });

  // ----------------------------------------------------- detalhamento
  const linhasPendentes = () => naoReconhecidos;

  // TODO indicador abre os registros que o compõem — inclusive os que mostram
  // percentual. Um percentual não tem soma, mas tem registros por trás: são
  // eles que a tela lista, e a conferência passa a ser pela CONTAGEM. Antes
  // esses quatro não abriam, e o clique morria justamente onde a pergunta
  // "de onde vem esse número?" mais aparece.
  ligarKpis([
    { dica: 'Variação do custo RECORRENTE entre o primeiro e o último mês do recorte. '
      + 'Só a despesa de natureza fixa entra: uma compra pontual num mês e nenhuma no seguinte '
      + 'produziria uma "redução" que é só o fim da compra. Clique para ver as despesas fixas.',
      abrir: () => abrirRegistros({
        titulo: 'Custo recorrente — despesas fixas do recorte', tipo: 'indicadores',
        colunas: COLUNAS_LANCAMENTO_SIMPLES, itens: fixosDoRecorte(rf), contagem: null,
        nota: 'A variação compara o primeiro e o último mês; a lista traz as despesas que formam a série.',
      }) },
    { dica: 'Soma e contagem das despesas que ninguém reconheceu ainda, no recorte do bloco. '
      + 'Clique para ver os lançamentos e reconhecer em lote.',
      abrir: () => abrirDetalhe({
        titulo: 'Despesas por reconhecer', tipo: 'indicadores',
        itens: linhasPendentes(), esperado: pendente.valor,
      }) },
    { dica: `Atendidos dentro do prazo sobre o total de atendimentos do recorte, contra a meta de ${META_SLA}%. `
      + 'É a mesma conta das telas de SLA. Clique para ver os chamados, com prazo e situação.',
      abrir: () => abrirRegistros({
        titulo: 'Atendidos dentro do SLA — chamados do recorte', tipo: 'indicadores',
        colunas: COLUNAS_TICKET, itens: ticketsDoRecorte(rs), contagem: null,
        nota: `${inteiro(sla.dentro)} de ${inteiro(sla.total)} atendimentos dentro do prazo `
          + `(${sla.total ? sla.pct.toLocaleString('pt-BR') : '0'}%), contra a meta de ${META_SLA}%.`,
      }) },
    { dica: 'Total de atendimentos no recorte, somando o chamado vindo de helpdesk e o registro '
      + 'agregado do mês. Clique para ver os registros; a tela Chamados é onde se mexe neles.',
      abrir: () => abrirRegistros({
        titulo: 'Chamados no recorte', tipo: 'indicadores',
        colunas: COLUNAS_TICKET, itens: ticketsDoRecorte(rs), contagem: null,
        nota: 'Um registro agregado do mês pode valer por vários atendimentos — por isso a contagem '
          + 'de linhas nem sempre é o total de chamados.',
      }) },
    { dica: 'Entregues dentro do mês planejado sobre o total ENTREGUE — tarefa ainda em aberto não '
      + 'está fora do prazo enquanto o mês planejado não passa. Clique para ver as entregas.',
      abrir: () => abrirRegistros({
        titulo: 'Tarefas entregues no recorte', tipo: 'indicadores',
        colunas: COLUNAS_TAREFA, itens: tarefasDoRecorte(rp, 'entregues'), contagem: proj.entregues,
        nota: `${inteiro(proj.noPrazo)} dentro do mês planejado.`,
      }) },
    { dica: 'Tarefas ainda pendentes ou em andamento cuja entrega estava planejada para o recorte. '
      + 'Clique para ver quais são; o cronograma está na tela Projetos.',
      abrir: () => abrirRegistros({
        titulo: 'Tarefas pendentes no recorte', tipo: 'indicadores',
        colunas: COLUNAS_TAREFA, itens: tarefasDoRecorte(rp, 'pendentes'), contagem: proj.pendentes,
        nota: proj.atrasadas ? `${inteiro(proj.atrasadas)} com o mês planejado já vencido.` : '',
      }) },
  ]);
  ligarSanfonasDeUnidade();
  el('#pagina').querySelectorAll('tr[data-centro]').forEach((tr) => {
    tr.style.cursor = 'pointer';
    tr.onclick = () => abrirDetalhe({
      titulo: 'Por reconhecer — ' + tr.dataset.centro, tipo: 'indicadores',
      itens: linhasPendentes().filter((l) => (l.tipo || '(sem centro de custo)') === tr.dataset.centro),
      esperado: null,
    });
  });
}

// --------------------------------------------------- quebra por matriz e filial
//
// O indicador continua CONSOLIDADO — é o pedido: um número só. O que muda é
// que ele passa a saber DE QUEM é cada pedaço, em dois lugares: na faixa de
// cores logo abaixo do número, e na sanfona que abre a hierarquia matriz →
// filial. Os dois saem do MESMO laço que o cálculo já percorre; nada é
// consultado de novo, e por isso a soma da quebra é o número do card.

/** Agrupa registros em matriz → filial, somando o que `medir` devolver. */
function quebrarPorUnidade(registros, medir) {
  const matrizes = new Map();
  for (const r of registros) {
    const chave = r.empresa;
    if (!matrizes.has(chave)) {
      matrizes.set(chave, { empresa: chave, nome: String(nomeEmpresa(chave)), cor: corDaMatriz(chave), valor: 0, filiais: new Map() });
    }
    const m = matrizes.get(chave);
    const valor = medir(r);
    m.valor += valor;
    const nomeFilial = r.filial || 'Sem filial (nível empresa)';
    const f = m.filiais.get(nomeFilial) || { nome: nomeFilial, valor: 0, registros: [] };
    f.valor += valor;
    f.registros.push(r);
    m.filiais.set(nomeFilial, f);
  }
  return [...matrizes.values()]
    .map((m) => ({ ...m, filiais: [...m.filiais.values()].sort((a, b) => b.valor - a.valor) }))
    .sort((a, b) => b.valor - a.valor);
}

/** As fatias da faixa: nome, cor, peso e o valor já formatado para o balão. */
const fatiasDe = (quebra, formatar) =>
  quebra.map((m) => ({ nome: m.nome, cor: m.cor, valor: m.valor, texto: formatar(m.valor) }));

/**
 * A sanfona de um indicador: matriz → filial, com o valor de cada uma.
 *
 * Fica num botão PRÓPRIO, e não no corpo do card: o corpo já abre o
 * detalhamento, e dois gestos no mesmo alvo brigariam.
 */
function sanfonaHtml(id, quebra, formatar, extra) {
  if (!quebra.length) return '';
  const linhas = quebra.map((m) => `
    <tr class="matriz"><td>${esc(m.nome)}</td><td class="num">${formatar(m.valor)}</td>
      <td>${extra ? extra.matriz(m) : ''}</td></tr>
    ${m.filiais.map((f) => `<tr class="filial"><td>${esc(f.nome)}</td>
      <td class="num">${formatar(f.valor)}</td><td>${extra ? extra.filial(f, m) : ''}</td></tr>`).join('')}`).join('');
  return `<div class="kpi-unidades" data-sanfona="${esc(id)}">
    <button type="button" class="bt" aria-expanded="false" data-abrir-unidades>+ por unidade</button>
    <div class="kpi-corpo" hidden><table>
      <thead><tr><th>Empresa / filial</th><th class="num">${esc(extra ? extra.coluna : 'Valor')}</th>
        <th>${esc(extra ? extra.colunaExtra : '')}</th></tr></thead>
      <tbody>${linhas}</tbody></table></div></div>`;
}

/**
 * A quebra do SLA por unidade.
 *
 * Aqui o valor não é uma soma qualquer: é a conformidade. Cada filial recebe
 * DENTRO ou FORA da meta, e a ordenação é por volume de chamados fora — quem
 * mais puxa o resultado geral para baixo aparece primeiro, que é a pergunta
 * que o gestor traz para esta tela.
 */
function quebraDeSla(registros) {
  const matrizes = new Map();
  const acumular = (alvo, s) => {
    alvo.total += Number(s.total) || 0;
    alvo.dentro += Number(s.dentro) || 0;
  };
  const fechar = (x) => {
    x.fora = x.total - x.dentro;
    x.pct = x.total ? Math.round((x.dentro / x.total) * 1000) / 10 : 0;
    x.atinge = x.total > 0 && x.pct >= META_SLA;
    // `valor` é o que a faixa pesa e a coluna mostra: no SLA é o VOLUME de
    // atendimento. Sem ele, a linha de filial sairia zerada enquanto o rótulo
    // ao lado dizia mil chamados fora — dois números discordando na mesma linha.
    x.valor = x.total;
    return x;
  };
  for (const s of registros) {
    if (!matrizes.has(s.empresa)) {
      matrizes.set(s.empresa, {
        empresa: s.empresa, nome: String(nomeEmpresa(s.empresa)), cor: corDaMatriz(s.empresa),
        total: 0, dentro: 0, filiais: new Map(),
      });
    }
    const m = matrizes.get(s.empresa);
    acumular(m, s);
    const nomeFilial = s.filial || 'Sem filial (nível empresa)';
    const f = m.filiais.get(nomeFilial) || { nome: nomeFilial, total: 0, dentro: 0 };
    acumular(f, s);
    m.filiais.set(nomeFilial, f);
  }
  return [...matrizes.values()]
    .map((m) => fechar({ ...m, filiais: [...m.filiais.values()].map(fechar).sort((a, b) => b.fora - a.fora) }))
    .sort((a, b) => b.fora - a.fora);
}

/** Dentro ou fora da meta, com o percentual — o canal que não é só a cor. */
function rotuloConformidade(x) {
  if (!x.total) return '<span class="tag">sem chamado</span>';
  return x.atinge
    ? `<span class="dentro">✓ ${x.pct.toLocaleString('pt-BR')}% · dentro</span>`
    : `<span class="fora">✗ ${x.pct.toLocaleString('pt-BR')}% · fora (${inteiro(x.fora)} chamado(s))</span>`;
}

/** Liga as sanfonas da tela. Estado por card, e memória entre visitas. */
function ligarSanfonasDeUnidade() {
  el('#pagina').querySelectorAll('[data-sanfona]').forEach((caixa) => {
    const bt = caixa.querySelector('[data-abrir-unidades]');
    const corpo = caixa.querySelector('.kpi-corpo');
    const chave = 'sanfona:' + caixa.dataset.sanfona;
    const abertas = blocosAbertos();
    const aplicar = (aberto) => {
      bt.setAttribute('aria-expanded', String(aberto));
      bt.textContent = (aberto ? '− ' : '+ ') + 'por unidade';
      corpo.hidden = !aberto;
    };
    aplicar(abertas.has(chave));
    bt.onclick = (ev) => {
      // O card é gatilho de drill-down: sem parar aqui, abrir a sanfona
      // abriria o modal junto.
      ev.stopPropagation();
      const atuais = blocosAbertos();
      const vai = !atuais.has(chave);
      if (vai) atuais.add(chave); else atuais.delete(chave);
      gravarBlocosAbertos(atuais);
      aplicar(vai);
    };
  });
}

/**
 * Os REGISTROS de cada indicador, com o mesmo recorte do bloco.
 *
 * Nenhum deles consulta nada: reaproveitam exatamente os laços que o cálculo do
 * bloco já percorre, e é isso que garante que a lista e o número digam a mesma
 * coisa. Se viessem de outra fonte, poderiam divergir — e o gestor não teria
 * como saber qual dos dois está certo.
 */
function fixosDoRecorte(r) {
  return Loja.todosDoEscopo().filter((l) =>
    l.natureza === 'fixa' && passaNoFiltro(E.cenariosSel, l.cenario) &&
    naFilialDoBloco(l.filial, r) && naJanela(l.competencia, r) &&
    (!r.somenteReconhecidas || reconhecidoDe(l)));
}

function ticketsDoRecorte(r) {
  const saida = [];
  for (const e of escopoEmpresas()) {
    for (const s of (E.sla.get(e) || [])) {
      if (!naFilialDoBloco(s.filial, r)) continue;
      if (!naJanela(s.competencia, r)) continue;
      saida.push({ ...s, empresa: e });
    }
  }
  return saida.sort((a, b) => String(b.competencia).localeCompare(String(a.competencia)));
}

/** `quais`: 'entregues' (com fim real) ou 'pendentes' (sem, e não cancelada). */
function tarefasDoRecorte(r, quais) {
  const saida = [];
  for (const e of escopoEmpresas()) {
    for (const p of (E.projetos.get(e) || [])) {
      if (!naFilialDoBloco(p.filial, r)) continue;
      for (const t of (p.tarefas || [])) {
        if (!naJanela(t.fimPlanejado, r)) continue;
        const cancelada = String(t.status || '').toLowerCase().startsWith('cancel');
        if (cancelada) continue;
        const entregue = !!t.fimReal;
        if ((quais === 'entregues') !== entregue) continue;
        saida.push({ ...t, projeto: p.nome, filial: p.filial, empresa: e });
      }
    }
  }
  return saida;
}

/**
 * Tela flutuante com os registros que compõem um indicador.
 *
 * Irmã de `abrirDetalhe`, e não a mesma função: aquela é de LANÇAMENTO e leva a
 * ação de reconhecer em lote, que não faz sentido sobre um chamado ou uma
 * tarefa. Aqui a conferência é por CONTAGEM, porque o número no card pode ser um
 * percentual — e somar percentuais não significa nada.
 */
function abrirRegistros({ titulo, tipo, colunas, itens, contagem, nota }) {
  const confere = contagem === null || contagem === undefined || contagem === itens.length;
  abrirModal({
    titulo, tipo,
    corpo: `
      <div class="msg${confere ? '' : ' erro'}">
        <strong>${inteiro(itens.length)} registro(s).</strong>
        ${contagem === null || contagem === undefined ? ''
          : confere ? ' Confere com o indicador.' : ` Diverge: o indicador conta ${inteiro(contagem)}.`}
        ${nota ? ' ' + nota : ''}
      </div>
      ${itens.length === 0 ? '<p class="vazio">Nenhum registro neste recorte.</p>' : `
      <div class="rol" style="margin-top:10px"><table>
        <thead><tr>${colunas.map((c) => `<th${c.n ? ' class="n"' : ''}>${esc(c.rotulo)}</th>`).join('')}</tr></thead>
        <tbody>${itens.slice(0, 400).map((it) => `<tr>${colunas
          .map((c) => `<td${c.n ? ' class="n"' : ''}>${c.valor(it)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      ${itens.length > 400 ? `<p class="nota" style="margin-top:8px">Exibindo os 400 primeiros de ${inteiro(itens.length)}.</p>` : ''}`}`,
    acoes: '<button type="button" class="bt" data-c>Fechar</button>',
    aoMontar({ raiz, fechar }) { raiz.querySelector('[data-c]').onclick = fechar; },
  });
}

/** As colunas de cada tipo de registro, num lugar só. */
const COLUNAS_TICKET = [
  { rotulo: 'Competência', valor: (s) => mesExib(s.competencia) },
  { rotulo: 'Unidade', valor: (s) => esc(nomeEmpresa(s.empresa)) },
  { rotulo: 'Filial', valor: (s) => esc(s.filial || 'empresa') },
  { rotulo: 'Fila', valor: (s) => esc(s.fila || '—') },
  { rotulo: 'Chamado', valor: (s) => esc(s.numero || s.ticketId || '—') },
  { rotulo: 'Assunto', valor: (s) => esc(s.assunto || '') },
  // No artifact, o "nível" do chamado É a prioridade: a integração grava
  // `priority` do helpdesk neste campo (app-js15.js).
  { rotulo: 'Prioridade', valor: (s) => esc(s.nivel || '—') },
  { rotulo: 'Status', valor: (s) => esc(s.status || '—') },
  { rotulo: 'Prazo', valor: (s) => esc(s.prazoEm ? String(s.prazoEm).slice(0, 10) : '—') },
  { rotulo: 'SLA', valor: (s) => {
      const t = Number(s.total) || 0, d = Number(s.dentro) || 0;
      if (!t) return '—';
      return d >= t ? '<span class="tag bom">dentro</span>'
        : d === 0 ? '<span class="tag crit">fora</span>'
        : `<span class="tag alerta">${inteiro(d)} de ${inteiro(t)}</span>`;
    } },
];

const COLUNAS_TAREFA = [
  { rotulo: 'Projeto', valor: (t) => esc(t.projeto || '') },
  { rotulo: 'Tarefa', valor: (t) => esc(t.nome || '') },
  { rotulo: 'Unidade', valor: (t) => esc(nomeEmpresa(t.empresa)) },
  { rotulo: 'Filial', valor: (t) => esc(t.filial || 'empresa') },
  { rotulo: 'Planejado', valor: (t) => esc(t.fimPlanejado ? mesExib(t.fimPlanejado) : '—') },
  { rotulo: 'Entregue', valor: (t) => esc(t.fimReal ? mesExib(t.fimReal) : '—') },
  { rotulo: 'Situação', valor: (t) => {
      if (!t.fimReal) return '<span class="tag">pendente</span>';
      return t.fimReal <= t.fimPlanejado
        ? '<span class="tag bom">no prazo</span>' : '<span class="tag crit">fora do prazo</span>';
    } },
  { rotulo: 'Status', valor: (t) => esc(STATUS_PROJ[t.status] || t.status || '') },
];

const COLUNAS_LANCAMENTO_SIMPLES = [
  { rotulo: 'Competência', valor: (l) => mesExib(l.competencia) },
  { rotulo: 'Unidade', valor: (l) => esc(nomeEmpresa(l.empresa)) },
  { rotulo: 'Filial', valor: (l) => esc(l.filial || 'empresa') },
  { rotulo: 'Centro de custo', valor: (l) => esc(l.tipo || '') },
  { rotulo: 'Descrição', valor: (l) => esc(l.descricao || '') },
  { rotulo: 'Valor', n: true, valor: (l) => brl(l.valor) },
];

/**
 * Detalhamento dos lançamentos de um indicador, com a ação de reconhecer em
 * lote: quem abriu "o que falta reconhecer" veio para resolver, e mandá-lo
 * clicar um a um na tela de Lançamentos seria devolver o problema.
 */
function abrirDetalhe({ titulo, tipo, itens, esperado }) {
  const soma = reais(somaC(itens.map((l) => l.valor)));
  const confere = esperado === null || Math.abs(soma - esperado) < 0.01;
  abrirModal({
    titulo, tipo,
    corpo: `
      <div class="msg${confere ? '' : ' erro'}">
        <strong>${inteiro(itens.length)} lançamento(s) · ${brl(soma)}.</strong>
        ${esperado === null ? '' : confere ? ' Confere com o indicador.' : ` Diverge: o indicador mostra ${brl(esperado)}.`}
      </div>
      ${itens.length === 0 ? '<p class="vazio">Nenhum lançamento.</p>' : `
      <div class="rol" style="margin-top:10px"><table>
        <thead><tr><th></th><th>Competência</th><th>Filial</th><th>Centro de custo</th><th>Descrição</th>
          <th class="n">Valor</th></tr></thead>
        <tbody>${itens.slice(0, 400).map((l) => `<tr${classeReconhecimento(l)}>
          <td><input type="checkbox" data-sel-lanc="${esc(l.id)}" data-comp="${esc(l.competencia)}"
               data-emp="${esc(l.empresa)}"${reconhecidoDe(l) ? ' disabled' : ''}
               aria-label="Selecionar ${esc(l.descricao || l.tipo)}"></td>
          <td>${mesExib(l.competencia)}</td>
          <td>${esc(l.filial || 'empresa')}</td>
          <td>${esc(l.tipo)}</td>
          <td>${esc(l.descricao || '')}</td>
          <td class="n">${brl(l.valor)}</td></tr>`).join('')}</tbody>
      </table></div>
      ${itens.length > 400 ? `<p class="nota" style="margin-top:8px">Exibindo os 400 primeiros de ${inteiro(itens.length)}.</p>` : ''}`}`,
    acoes: `<button type="button" class="bt" data-todos>Marcar todos</button>
      <button type="button" class="bt pri" data-reconhecer disabled>Reconhecer selecionados</button>
      <button type="button" class="bt" data-c>Fechar</button>`,
    aoMontar({ raiz, fechar }) {
      const caixas = [...raiz.querySelectorAll('input[data-sel-lanc]:not([disabled])')];
      const bt = raiz.querySelector('[data-reconhecer]');
      const contar = () => {
        const n = caixas.filter((c) => c.checked).length;
        bt.disabled = n === 0;
        bt.textContent = n ? `Reconhecer ${inteiro(n)} selecionado(s)` : 'Reconhecer selecionados';
      };
      caixas.forEach((c) => c.addEventListener('change', contar));
      raiz.querySelector('[data-todos]').onclick = () => {
        const ligar = !caixas.every((c) => c.checked);
        caixas.forEach((c) => { c.checked = ligar; });
        contar();
      };
      raiz.querySelector('[data-c]').onclick = fechar;
      bt.onclick = async () => {
        bt.disabled = true;
        const alvos = caixas.filter((c) => c.checked).map((c) =>
          itens.find((l) => l.id === c.dataset.selLanc && l.competencia === c.dataset.comp));
        await alternarReconhecimento(alvos, true);
        fechar();
      };
      contar();
    },
  });
}
