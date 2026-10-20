/**
 * Coluna ajustável: dá a cada cabeçalho uma alça de largura.
 *
 * Mexe só no `width` do `th`, por estilo e fora do ciclo de render — quem
 * arrasta espera resposta a cada pixel, e repintar a árvore a cada pixel
 * perderia o foco do teclado no meio do arrasto. Por não repintar, ordenação,
 * filtro e o conteúdo das células seguem intactos.
 */
export function ligarColunasAjustaveis(tabela: HTMLTableElement | null): () => void {
  if (!tabela) return () => {};
  const cabecalhos = Array.from(tabela.querySelectorAll('thead th')) as HTMLTableCellElement[];
  if (cabecalhos.length < 2) return () => {};

  tabela.style.tableLayout = 'fixed';
  for (const th of cabecalhos) if (!th.style.width) th.style.width = `${th.offsetWidth}px`;

  /**
   * A tabela passa a valer a soma das colunas, e não 100% da caixa. Com
   * `width: 100%` e `table-layout: fixed`, alargar uma coluna faz o navegador
   * devolver o ganho encolhendo as outras — a coluna não cresce de fato. Quem
   * absorve o excesso é a rolagem horizontal da caixa, como deve ser.
   */
  const somarLargura = () => {
    const soma = cabecalhos.reduce((s, th) => s + (parseFloat(th.style.width) || th.offsetWidth), 0);
    tabela.style.width = `${Math.round(soma)}px`;
  };
  somarLargura();

  const criadas: HTMLElement[] = [];
  cabecalhos.forEach((th, i) => {
    // A última coluna não recebe alça: arrastá-la só empurraria a borda da
    // tabela, sem redistribuir nada.
    if (i === cabecalhos.length - 1 || th.querySelector('.puxa-col')) return;
    th.classList.add('ajustavel');
    const alca = document.createElement('div');
    alca.className = 'puxa-col';
    alca.setAttribute('role', 'separator');
    alca.setAttribute('aria-orientation', 'vertical');
    alca.setAttribute('aria-label', `Ajustar a largura da coluna ${th.textContent?.trim() ?? ''}`);
    alca.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // A largura de referência é a do estilo, que é a que manda sob
      // `table-layout: fixed`; `offsetWidth` pode já vir reescalado.
      const x0 = ev.clientX;
      const l0 = parseFloat(th.style.width) || th.offsetWidth;
      alca.setPointerCapture(ev.pointerId);
      alca.classList.add('arrastando');
      const mover = (e: PointerEvent) => {
        th.style.width = `${Math.max(l0 + (e.clientX - x0), 48)}px`;
        somarLargura();
      };
      const soltar = () => {
        alca.classList.remove('arrastando');
        alca.removeEventListener('pointermove', mover);
        alca.removeEventListener('pointerup', soltar);
        alca.removeEventListener('pointercancel', soltar);
      };
      alca.addEventListener('pointermove', mover);
      alca.addEventListener('pointerup', soltar);
      alca.addEventListener('pointercancel', soltar);
    });
    th.appendChild(alca);
    criadas.push(alca);
  });

  return () => {
    for (const a of criadas) a.remove();
    for (const th of cabecalhos) th.classList.remove('ajustavel');
  };
}
