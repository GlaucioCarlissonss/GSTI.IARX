/**
 * A REGRA DO ATINGIMENTO DE META — resultado contra meta, e a faixa que sai disso.
 *
 * Mora numa lib sem React de propósito: é regra, não desenho. Assim ela pode
 * ser exercida fora do navegador, caso a caso, e o componente que a usa fica
 * responsável só por pintar. Inverter a direção num módulo faria o mês mais
 * caro do ano aparecer em verde — e é um erro que a tela não denuncia sozinha,
 * porque o número continua parecendo um percentual plausível.
 */

/**
 * A direção da meta é propriedade do MÓDULO, não escolha de quem cadastra:
 * "quanto maior melhor" não é opinião sobre o SLA. `'minimo'` é alvo de piso
 * (maior é melhor) e `'maximo'` é alvo de teto (menor é melhor) — o mesmo
 * vocabulário de `DIRECAO_META` no servidor, que já rege a leitura dos
 * indicadores. Uma segunda tabela aqui seria uma segunda chance de divergir.
 */
export type DirecaoMeta = 'minimo' | 'maximo';

export type FaixaResultado = 'VERDE' | 'LARANJA' | 'VERMELHO' | 'SEM_META' | 'SEM_DADOS';

export interface Atingimento {
  faixa: FaixaResultado;
  /** Ausente quando não há meta ou não há resultado. */
  pct?: number;
}

/**
 * O atingimento e a faixa do semáforo.
 *
 * A faixa é decidida pelo percentual ARREDONDADO, que é o que aparece na tela:
 * um 99,96% exibido como "100,0%" e pintado de laranja seria a tela
 * contradizendo a si mesma.
 */
export function atingimentoDaMeta(
  direcao: DirecaoMeta,
  resultado: number | null | undefined,
  meta: number | null | undefined,
): Atingimento {
  if (resultado === null || resultado === undefined) return { faixa: 'SEM_DADOS' };
  if (meta === null || meta === undefined || !(Number(meta) > 0)) return { faixa: 'SEM_META' };
  const menor = direcao === 'maximo';
  // Dividir pelo resultado exige resultado: gasto zero contra um teto positivo
  // não é "meta superada", é mês sem despesa.
  if (menor && !(resultado > 0)) return { faixa: 'SEM_DADOS' };
  const pct = Math.round((menor ? meta / resultado : resultado / meta) * 1000) / 10;
  return { faixa: pct >= 100 ? 'VERDE' : pct >= 70 ? 'LARANJA' : 'VERMELHO', pct };
}

/**
 * O texto que acompanha a faixa, com o valor da meta por extenso.
 *
 * `formatar` entra de fora porque moeda e percentual são do chamador: a regra
 * não precisa saber se o alvo são reais ou pontos percentuais.
 */
export function textoDaMeta(
  a: Atingimento,
  meta: number | null | undefined,
  formatar: (v: number) => string,
): string {
  if (a.faixa === 'SEM_DADOS') return 'Sem dados no período';
  if (a.faixa === 'SEM_META') return 'Sem meta cadastrada';
  const valor = formatar(meta as number);
  return a.faixa === 'VERDE'
    ? `Meta ${valor} atingida`
    : a.faixa === 'LARANJA'
      ? `Meta ${valor} parcialmente atingida`
      : `Meta ${valor} não atingida`;
}
