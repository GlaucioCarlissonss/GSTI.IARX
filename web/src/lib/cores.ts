/**
 * A cor de cada empresa matriz.
 *
 * Um indicador consolidado some com a origem do número: R$ 2 milhões não diz
 * quanto é de qual matriz. A cor devolve essa leitura sem quebrar o
 * consolidado — o valor segue somado, e a faixa embaixo dele mostra a divisão.
 *
 * A cor vem da POSIÇÃO da matriz na lista ordenada do cliente, e não do id.
 * Pelo id, cadastrar uma empresa nova trocaria a cor de todas as outras; pela
 * posição, ela é estável entre telas e entre sessões enquanto o cadastro não
 * mudar — e quando mudar, muda uma vez e a legenda acompanha.
 *
 * São oito. Da nona em diante a tela agrupa em "Outras", que é o que
 * `GraficoRanking` já faz com a cauda: inventar uma nona cor daria duas
 * indistinguíveis, e duas cores parecidas mentem mais do que uma faixa cinza.
 *
 * A cor nunca é o único canal: legenda, tooltip e tabela dizem o nome.
 */
export const CORES_MATRIZ = 8;

export const COR_OUTRAS = 'var(--tinta-fraca)';

/** A cor da matriz que está na posição `indice` da lista ordenada do cliente. */
export function corDaPosicao(indice: number): string {
  return indice >= 0 && indice < CORES_MATRIZ ? `var(--matriz-${indice + 1})` : COR_OUTRAS;
}

export interface MatrizComCor {
  id: number;
  nome: string;
  cor: string;
}

/**
 * As matrizes do cliente, em ordem de nome, com a cor de cada uma.
 *
 * A ordenação é por nome de propósito: é a ordem em que a pessoa as vê em todo
 * seletor do sistema, então a cor do indicador casa com a posição na lista.
 */
export function coresDasMatrizes(empresas: Array<{ id: number; nome: string }>): Map<number, MatrizComCor> {
  const ordenadas = [...empresas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return new Map(
    ordenadas.map((e, i) => [e.id, { id: e.id, nome: e.nome, cor: corDaPosicao(i) }]),
  );
}

export interface FatiaDeMatriz {
  id: number;
  nome: string;
  cor: string;
  valor: number;
}

/**
 * As fatias de um número consolidado, prontas para a faixa e para a legenda.
 *
 * Fatia de valor zero sai fora: um segmento sem largura não é visível, e
 * listá-lo na legenda faria procurar na faixa uma cor que não está lá.
 */
export function fatiasPorMatriz(
  porMatriz: Array<{ empresa_id: number; valor: number }>,
  cores: Map<number, MatrizComCor>,
): FatiaDeMatriz[] {
  return porMatriz
    .map((p) => {
      const m = cores.get(p.empresa_id);
      return { id: p.empresa_id, nome: m?.nome ?? '—', cor: m?.cor ?? COR_OUTRAS, valor: p.valor };
    })
    .filter((f) => f.valor > 0)
    .sort((a, b) => b.valor - a.valor);
}
