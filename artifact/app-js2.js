// ===========================================================================
// Gráficos em SVG: marca fina, grade em fio, topo de barra arredondado,
// 2px de respiro entre fatias, legenda sempre que há duas ou mais séries.
// ===========================================================================
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
const dica = () => el('#dica');
function mostrarDica(ev, titulo, linhas) {
  const d = dica();
  d.innerHTML = '<b>' + esc(titulo) + '</b>' + linhas.map((l) =>
    '<div class="l"><span>' + (l.cor ? '<i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:'+l.cor+';margin-right:5px"></i>' : '') +
    esc(l.nome) + '</span><var>' + esc(l.valor) + '</var></div>').join('');
  d.classList.add('on');
  const c = d.getBoundingClientRect();
  // Contenção nas quatro bordas. A de cima faltava: perto do topo da tela o
  // balão era empurrado para y=8 e cobria o próprio ponto que explicava.
  d.style.left = Math.max(8, Math.min(ev.clientX + 14, innerWidth - c.width - 12)) + 'px';
  const acima = ev.clientY - c.height - 12;
  d.style.top = (acima >= 8 ? acima : Math.min(ev.clientY + 18, innerHeight - c.height - 12)) + 'px';
}
const sumirDica = () => { clearTimeout(ATRASO_DICA); dica().classList.remove('on'); };

/**
 * O balão com atraso, para quem passa o cursor de raspão.
 *
 * Sem atraso, atravessar uma tabela de vinte barras pisca vinte balões pelo
 * caminho. Com ele, o balão só aparece onde o cursor PAROU — que é onde havia
 * intenção de ler. 180 ms é o ponto em que o gesto deliberado já espera algo e
 * o de passagem ainda não.
 *
 * O foco do teclado NÃO espera: quem chegou ali por Tab já escolheu o
 * elemento, e um atraso seria só demora.
 */
let ATRASO_DICA = null;

function ligarDica(elemento, montar) {
  if (!elemento) return;
  const abrir = (ev) => {
    const d = montar();
    if (d) mostrarDica(ev, d.titulo, d.linhas);
  };
  elemento.addEventListener('mouseenter', (ev) => {
    clearTimeout(ATRASO_DICA);
    ATRASO_DICA = setTimeout(() => abrir(ev), 180);
  });
  // Seguir o cursor só depois que o balão abriu: mover antes disso
  // reiniciaria o atraso a cada pixel e ele nunca chegaria ao fim.
  elemento.addEventListener('mousemove', (ev) => {
    if (dica().classList.contains('on')) abrir(ev);
  });
  elemento.addEventListener('mouseleave', sumirDica);
  elemento.addEventListener('focus', () => {
    const c = elemento.getBoundingClientRect();
    abrir({ clientX: c.left + c.width / 2, clientY: c.bottom });
  });
  elemento.addEventListener('blur', sumirDica);
  // Quem navega por teclado precisa alcançar o elemento para focá-lo. Um nó
  // que já é botão ou link não recebe `tabindex` — teria foco duas vezes.
  if (!elemento.matches('a, button, input, select, textarea, [tabindex]')) {
    elemento.setAttribute('tabindex', '0');
  }
}

function escalaBoa(max, div = 4) {
  if (max <= 0) return { teto: 1, marcas: [0, 1] };
  const bruto = max / div, mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1,2,2.5,5,10].map((x) => x*mag).find((p) => p >= bruto) ?? 10*mag;
  const teto = Math.ceil(max/passo)*passo, marcas = [];
  for (let v = 0; v <= teto + passo/2; v += passo) marcas.push(+v.toFixed(6));
  return { teto, marcas };
}
const pathBarra = (x, y, l, a, r=3) => {
  const rr = Math.max(0, Math.min(r, l/2, a));
  return a <= .5 ? '' : `M${x},${y+a} L${x},${y+rr} Q${x},${y} ${x+rr},${y} L${x+l-rr},${y} Q${x+l},${y} ${x+l},${y+rr} L${x+l},${y+a} Z`;
};

/** pontos: [{rot, v:{chave:valor}}]; series: [{k,nome,cor}] */
/**
 * `aoClicar(ponto, indice)` transforma cada barra em gatilho de drill-down.
 * Sem ele o gráfico segue só informativo, como antes.
 */
/**
 * `opcoes.referencias`: retas horizontais — a média do período, por exemplo.
 * Elas entram no cálculo do TETO da escala: uma referência acima do maior mês
 * ficaria fora do gráfico justamente quando a distância até ela é a notícia.
 */
/** O mesmo conteúdo do balão, em uma frase, para o leitor de tela. */
const rotuloAcessivel = (d) =>
  `${d.titulo}. ` + d.linhas.map((l) => `${l.nome}: ${l.valor}`).join('. ');

function barras(alvo, pontos, series, modo = 'empilhado', fmt = brl, fmtEixo = curto, aoClicar = null, opcoes = {}) {
  alvo.replaceChildren();
  if (!pontos.length) { alvo.innerHTML = '<p class="vazio">Sem dados no período.</p>'; return; }
  const referencias = (opcoes.referencias || []).filter((r) => Number.isFinite(r.valor));
  const L=700, A=230, m={t:10,d:12,b:24,e:80}, ap=A-m.t-m.b, lp=L-m.e-m.d;
  const max = Math.max(0, ...pontos.map((p) => modo==='empilhado'
    ? series.reduce((s,x)=>s+(p.v[x.k]||0),0) : Math.max(...series.map((x)=>p.v[x.k]||0))),
    ...referencias.map((r) => r.valor));
  const { teto, marcas } = escalaBoa(max);
  const y = (v) => m.t + ap - (v/teto)*ap;
  const passo = lp/Math.max(pontos.length,1), larg = Math.min(passo*.62, 34);
  const svg = svgEl('svg', { viewBox:`0 0 ${L} ${A}`, role:'img', 'aria-label':'gráfico de barras' });
  // HACHURA OPCIONAL POR SÉRIE: um segundo canal além da cor. Duas séries que
  // precisam ser distinguidas por quem não separa matizes — despesa e
  // investimento, por exemplo — não podem depender só do tom.
  //
  // O id é único por gráfico: dois na mesma página com o mesmo id fariam o
  // segundo herdar a hachura do primeiro, que é um defeito silencioso.
  const idHachura = `hachura-barras-${(barras.seq = (barras.seq || 0) + 1)}`;
  if (series.some((s) => s.hachura)) {
    const defs = svgEl('defs', {});
    const p = svgEl('pattern', { id: idHachura, width: 6, height: 6,
      patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    p.appendChild(svgEl('rect', { width: 1.8, height: 6, fill: 'var(--sup)', 'fill-opacity': 0.9 }));
    defs.appendChild(p);
    svg.appendChild(defs);
  }
  for (const mk of marcas) {
    svg.appendChild(svgEl('line', { x1:m.e, x2:L-m.d, y1:y(mk), y2:y(mk), stroke: mk===0?'var(--linha2)':'var(--linha)', 'stroke-width':1 }));
    const t = svgEl('text', { x:m.e-8, y:y(mk)+3.5, 'text-anchor':'end', class:'eixo' }); t.textContent = fmtEixo(mk); svg.appendChild(t);
  }
  pontos.forEach((p, i) => {
    const cx = m.e + passo*(i+.5), g = svgEl('g', {});
    // A área de captura da coluna, montada só no fim para ficar POR CIMA dos
    // segmentos: embaixo deles, uma barra alta a cobre inteira e o ponteiro
    // nunca a alcança — o balão só aparecia no vão acima da barra.
    const captura = svgEl('rect', { x:cx-passo/2, y:m.t, width:passo, height:ap, fill:'transparent' });
    if (modo === 'empilhado') {
      let acc = 0;
      for (const s of series) {
        const v = p.v[s.k]||0, base = acc; acc += v;
        const topo = y(acc), alt = Math.max(y(base)-topo-2, 0);
        if (alt > 0) {
          const d = pathBarra(cx-larg/2, topo, larg, alt);
          g.appendChild(svgEl('path', { d, fill:s.cor }));
          if (s.hachura) g.appendChild(svgEl('path', { d, fill:`url(#${idHachura})` }));
        }
      }
    } else {
      const lb = Math.max((larg - 2*(series.length-1))/series.length, 3);
      series.forEach((s, j) => g.appendChild(svgEl('path', {
        d: pathBarra(cx-larg/2 + j*(lb+2), y(p.v[s.k]||0), lb, y(0)-y(p.v[s.k]||0)), fill:s.cor })));
    }
    g.appendChild(captura);
    g.addEventListener('mousemove', (ev) => mostrarDica(ev, p.rot, [
      ...series.map((s) => ({ nome:s.nome, cor:s.cor, valor: fmt(p.v[s.k]||0) })),
      ...(series.length>1 && modo==='empilhado' ? [{ nome:'Total', valor: fmt(series.reduce((a,s)=>a+(p.v[s.k]||0),0)) }] : []),
    ]));
    g.addEventListener('mouseleave', sumirDica);
    if (aoClicar) {
      g.style.cursor = 'pointer';
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `${p.rot} — abrir os registros deste ponto`);
      g.addEventListener('click', () => { sumirDica(); aoClicar(p, i); });
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); sumirDica(); aoClicar(p, i); }
      });
    }
    svg.appendChild(g);
    if (pontos.length <= 13 || i % 2 === 0) {
      const t = svgEl('text', { x:cx, y:A-7, 'text-anchor':'middle', class:'eixo' }); t.textContent = p.rot; svg.appendChild(t);
    }
  });
  // As referências vão por ÚLTIMO, para ficarem por cima das barras — uma média
  // desenhada embaixo some atrás da coluna do mês em que ela mais importa.
  for (const r of referencias) {
    svg.appendChild(svgEl('line', { x1:m.e, x2:L-m.d, y1:y(r.valor), y2:y(r.valor),
      stroke:r.cor, 'stroke-width':1.5, 'stroke-dasharray':'2 3' }));
    if (r.rotulo) {
      const t = svgEl('text', { x:L-m.d, y:y(r.valor)-4, class:'eixo', fill:r.cor, 'text-anchor':'end' });
      t.textContent = r.rotulo; svg.appendChild(t);
    }
    if (!r.dica) continue;
    const faixa = svgEl('line', { x1:m.e, x2:L-m.d, y1:y(r.valor), y2:y(r.valor),
      stroke:'transparent', 'stroke-width':6, 'stroke-linecap':'round',
      role:'img', tabindex:'0', 'aria-label': rotuloAcessivel(r.dica) });
    faixa.style.cursor = 'help';
    faixa.addEventListener('mousemove', (ev) => { ev.stopPropagation(); mostrarDica(ev, r.dica.titulo, r.dica.linhas); });
    faixa.addEventListener('mouseleave', sumirDica);
    faixa.addEventListener('focus', () => {
      const c = faixa.getBoundingClientRect();
      mostrarDica({ clientX: c.left + c.width / 2, clientY: c.top }, r.dica.titulo, r.dica.linhas);
    });
    faixa.addEventListener('blur', sumirDica);
    // A faixa fica POR CIMA das colunas: sem repassar o clique, os seis pixels
    // dela virariam uma faixa morta bem no meio do gráfico — clicar ali não
    // abriria o mês, e nada na tela explicaria por quê.
    // O cartão inteiro é gatilho de drill-down: sem barrar a subida, um clique
    // na faixa abriria DUAS telas flutuantes, uma sobre a outra.
    faixa.addEventListener('click', (ev) => ev.stopPropagation());
    if (aoClicar) {
      faixa.style.cursor = 'pointer';
      faixa.addEventListener('click', (ev) => {
        const caixa = svg.getBoundingClientRect();
        const rel = ((ev.clientX - caixa.left) / caixa.width) * L;
        const i = Math.max(0, Math.min(pontos.length - 1, Math.floor((rel - m.e) / (passo || 1))));
        sumirDica(); aoClicar(pontos[i], i);
      });
    }
    svg.appendChild(faixa);
  }
  alvo.appendChild(svg);
}

/** `aoClicar(ponto, indice)` liga o drill-down ao ponto mais próximo do cursor. */
function linhas(alvo, pontos, series, fmt = brl, fmtEixo = curto, sufixo = '', aoClicar = null) {
  alvo.replaceChildren();
  if (!pontos.length) { alvo.innerHTML = '<p class="vazio">Sem dados no período.</p>'; return; }
  const L=700, A=230, m={t:10,d:34,b:24,e:80}, ap=A-m.t-m.b, lp=L-m.e-m.d;
  const max = Math.max(0, ...pontos.flatMap((p) => series.map((s)=>p.v[s.k]||0)));
  const { teto, marcas } = escalaBoa(max);
  const y = (v) => m.t + ap - (v/teto)*ap;
  const x = (i) => m.e + (pontos.length<=1 ? lp/2 : lp*i/(pontos.length-1));
  const svg = svgEl('svg', { viewBox:`0 0 ${L} ${A}`, role:'img', 'aria-label':'série temporal' });
  for (const mk of marcas) {
    svg.appendChild(svgEl('line', { x1:m.e, x2:L-m.d, y1:y(mk), y2:y(mk), stroke: mk===0?'var(--linha2)':'var(--linha)', 'stroke-width':1 }));
    const t = svgEl('text', { x:m.e-8, y:y(mk)+3.5, 'text-anchor':'end', class:'eixo' }); t.textContent = fmtEixo(mk)+sufixo; svg.appendChild(t);
  }
  // Valor AUSENTE (null/undefined) abre lacuna; zero continua sendo zero.
  //
  // Sem a distinção, uma série que só existe em parte dos meses — a projeção do
  // custo fixo, por exemplo — desceria até a linha do zero nos meses em que ela
  // não se aplica, desenhando uma queda que não aconteceu.
  const temValor = (p, k) => p.v[k] !== null && p.v[k] !== undefined;
  for (const s of series) {
    let comando = 'M';
    const d = pontos.map((p,i) => {
      if (!temValor(p, s.k)) { comando = 'M'; return ''; }
      const pedaco = `${comando}${x(i)},${y(p.v[s.k])}`;
      comando = 'L';
      return pedaco;
    }).filter(Boolean).join(' ');
    svg.appendChild(svgEl('path', { d, fill:'none', stroke:s.cor,
      'stroke-width': s.pontilhada ? 1.5 : 2, 'stroke-linejoin':'round', 'stroke-linecap':'round',
      // Três traços distintos, e cada um significa uma coisa:
      //   contínuo  = medição
      //   tracejado = compromisso (teto) ou projeção
      //   pontilhado= referência calculada (a média do período)
      // Sem essa separação, a média de fixas ficaria indistinguível do teto de
      // fixas e da projeção do fixo — três linhas azuladas tracejadas.
      ...(s.pontilhada ? { 'stroke-dasharray': '2 3' }
        : s.tracejada ? { 'stroke-dasharray': '6 4' } : {}) }));
    // Linha de referência não tem "pontos": ela não foi medida mês a mês, e uma
    // bolinha em cada mês diria que foi.
    if (!s.semPontos) {
      pontos.forEach((p,i) => { if (temValor(p, s.k)) {
        svg.appendChild(svgEl('circle', { cx:x(i), cy:y(p.v[s.k]), r:3.5, fill:s.cor, stroke:'var(--sup)', 'stroke-width':2 }));
      } });
    }
    // O rótulo na ponta direita poupa a ida à legenda para saber que linha é
    // aquela — e é a única forma de nomear uma reta que atravessa o gráfico.
    if (s.rotulo) {
      const ultimo = [...pontos.keys()].reverse().find((i) => temValor(pontos[i], s.k));
      if (ultimo !== undefined) {
        const t = svgEl('text', { x: x(ultimo) + 4, y: y(pontos[ultimo].v[s.k]) - 4,
          class: 'eixo', fill: s.cor, 'text-anchor': 'end' });
        t.textContent = s.rotulo;
        svg.appendChild(t);
      }
    }
  }
  const captura = svgEl('rect', { x:m.e, y:m.t, width:lp, height:ap, fill:'transparent' });
  const maisProximo = (ev) => {
    const cx = svg.getBoundingClientRect();
    const rel = ((ev.clientX-cx.left)/cx.width)*L;
    return Math.max(0, Math.min(pontos.length-1, Math.round((rel-m.e)/(lp||1)*Math.max(pontos.length-1,1))));
  };
  captura.addEventListener('mousemove', (ev) => {
    const i = maisProximo(ev);
    const p = pontos[i];
    mostrarDica(ev, p.rot, [
      // Série sem valor no mês fica FORA do balão: mostrá-la como "R$ 0,00"
      // afirmaria um zero onde o que há é ausência.
      // Linha de referência fica FORA do balão quando o chamador prefere
      // mostrar a DISTÂNCIA até ela — repetir o mesmo valor de média em todo
      // mês encheria o balão sem dizer nada que a reta já não diga.
      ...series.filter((s) => temValor(p, s.k) && !s.foraDoBalao)
        .map((s)=>({ nome:s.nome, cor:s.cor, valor: fmt(p.v[s.k]) })),
      // O ponto pode trazer linhas próprias — composição, natureza, a origem de
      // uma projeção. É o detalhamento que o balão de um número solto não tem.
      ...(Array.isArray(p.extra) ? p.extra : []),
    ]);
  });
  captura.addEventListener('mouseleave', sumirDica);
  if (aoClicar) {
    captura.style.cursor = 'pointer';
    captura.addEventListener('click', (ev) => { const i = maisProximo(ev); sumirDica(); aoClicar(pontos[i], i); });
  }
  svg.appendChild(captura);
  // A FAIXA DE CAPTURA DE CADA LINHA DE REFERÊNCIA, por cima do retângulo do
  // mês: uma reta que atravessa o gráfico é a única marca sem um mês para
  // apontar, e por isso é a única que precisa contar a própria origem. A faixa
  // é estreita (6px) para roubar o mínimo do balão mensal.
  for (const s of series.filter((sr) => sr.dica)) {
    const alvos = pontos.map((p,i) => (temValor(p, s.k) ? i : -1)).filter((i) => i >= 0);
    if (!alvos.length) continue;
    const yy = y(pontos[alvos[0]].v[s.k]);
    const faixa = svgEl('line', { x1:x(alvos[0]), x2:x(alvos[alvos.length-1]), y1:yy, y2:yy,
      stroke:'transparent', 'stroke-width':6, 'stroke-linecap':'round',
      role:'img', tabindex:'0', 'aria-label': rotuloAcessivel(s.dica) });
    faixa.style.cursor = 'help';
    faixa.addEventListener('mousemove', (ev) => { ev.stopPropagation(); mostrarDica(ev, s.dica.titulo, s.dica.linhas); });
    faixa.addEventListener('mouseleave', sumirDica);
    // Pelo teclado o balão sai do canto da própria linha: não há cursor de onde
    // partir, e sem isso a informação só existiria para quem usa o mouse.
    faixa.addEventListener('focus', () => {
      const c = faixa.getBoundingClientRect();
      mostrarDica({ clientX: c.left + c.width / 2, clientY: c.top }, s.dica.titulo, s.dica.linhas);
    });
    faixa.addEventListener('blur', sumirDica);
    // O cartão inteiro é gatilho de drill-down: sem barrar a subida, um clique
    // na faixa abriria DUAS telas flutuantes, uma sobre a outra.
    faixa.addEventListener('click', (ev) => ev.stopPropagation());
    if (aoClicar) {
      faixa.style.cursor = 'pointer';
      faixa.addEventListener('click', (ev) => {
        const i = maisProximo(ev); sumirDica(); aoClicar(pontos[i], i);
      });
    }
    svg.appendChild(faixa);
  }
  // Rótulo a cada `passo` pontos, e o último sempre. O passo sai da LARGURA que
  // um rótulo ocupa, não de um número fixo de rótulos: "01/2026" mede cerca de
  // 56 unidades do viewBox, e com 24 meses o espaço entre pontos é 25 — pular
  // um sim um não ainda encavalaria um no outro.
  const LARGURA_ROTULO = 56;
  const espaco = lp / Math.max(pontos.length - 1, 1);
  const passo = Math.max(1, Math.ceil(LARGURA_ROTULO / espaco));
  pontos.forEach((p,i) => {
    const ultimo = i === pontos.length - 1;
    if (!ultimo && i % passo) return;
    // O penúltimo rótulo desenhado encostaria no último: some com ele.
    if (!ultimo && pontos.length - 1 - i < passo) return;
    const t = svgEl('text', { x:x(i), y:A-7, class:'eixo',
      'text-anchor': i===0?'start':ultimo?'end':'middle' });
    t.textContent = p.rot; svg.appendChild(t);
  });
  alvo.appendChild(svg);
}

/**
 * Ranking com tooltip em todo item e, com `aoClicar`, drill-down por item —
 * o mesmo padrão dos demais gráficos.
 */
function ranking(alvo, itens, fmt = brl, cor = 'var(--s1)', aoClicar = null) {
  if (!itens.length) { alvo.innerHTML = '<p class="vazio">Sem dados no período.</p>'; return; }
  const ord = [...itens].sort((a,b)=>b.valor-a.valor), max = Math.max(...ord.map((i)=>i.valor), 1);
  const total = ord.reduce((s,i)=>s+i.valor, 0);
  alvo.innerHTML = ord.map((i, idx) => `
    <div class="it" data-rk="${idx}">
      <div class="tp"><span class="nm">${esc(i.rotulo)}</span>
        <span class="vl">${fmt(i.valor)} <em>· ${pctTxt(pct(i.valor,total))}</em></span></div>
      <div class="trilho"><div style="width:${Math.max(i.valor/max*100,1)}%;background:${cor}"></div></div>
    </div>`).join('');

  alvo.querySelectorAll('[data-rk]').forEach((no) => {
    const item = ord[+no.dataset.rk];
    no.addEventListener('mousemove', (ev) => mostrarDica(ev, item.rotulo, [
      { nome: 'Valor', cor, valor: fmt(item.valor) },
      { nome: 'Participação', valor: pctTxt(pct(item.valor, total)) },
      ...(item.apoio ? [{ nome: 'Detalhe', valor: item.apoio }] : []),
    ]));
    no.addEventListener('mouseleave', sumirDica);
    if (aoClicar) comDrill(no, item.rotulo, () => { sumirDica(); aoClicar(item); });
  });
}
