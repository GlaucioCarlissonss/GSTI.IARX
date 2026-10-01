/**
 * Como a tela fala do consumo de um lançamento.
 *
 * O servidor devolve três campos — o tipo, a intenção "todas" e a lista
 * congelada de beneficiadas. Transformá-los em frase é decisão de
 * apresentação, e mora aqui para que a tabela de Lançamentos, o detalhamento
 * compartilhado e a ficha do Relatório digam a MESMA coisa. Três redações do
 * mesmo dado seriam três chances de parecerem dados diferentes.
 */
export type TipoConsumo = 'integral' | 'compartilhado';

export interface FilialBeneficiada {
  id: number;
  nome: string;
  empresa_nome: string;
}

export interface ComConsumo {
  tipo_consumo?: TipoConsumo | null;
  beneficia_todas?: boolean | null;
  filiais_beneficiadas?: FilialBeneficiada[] | null;
}

export const ROTULO_CONSUMO: Record<TipoConsumo, string> = {
  integral: '100% da filial',
  compartilhado: 'Beneficia outras',
};

export function tipoDe(l: ComConsumo): TipoConsumo {
  return l.tipo_consumo === 'compartilhado' ? 'compartilhado' : 'integral';
}

/** Nomes das beneficiadas, qualificados pela matriz só quando ela ajuda a distinguir. */
export function nomesBeneficiadas(l: ComConsumo): string[] {
  return (l.filiais_beneficiadas ?? []).map((f) => f.nome);
}

/**
 * A frase curta da célula de tabela.
 *
 * Com "todas" marcado, a frase é a intenção e não a lista: foi o que a pessoa
 * escolheu, e imprimir catorze nomes numa célula não caberia nem informaria
 * mais. Quem quiser a lista abre o detalhe.
 */
export function resumoConsumo(l: ComConsumo): string {
  if (tipoDe(l) === 'integral') return ROTULO_CONSUMO.integral;
  if (l.beneficia_todas) return 'Beneficia todas as filiais do grupo';
  const nomes = nomesBeneficiadas(l);
  if (!nomes.length) return ROTULO_CONSUMO.compartilhado;
  if (nomes.length <= 2) return `Beneficia ${nomes.join(' e ')}`;
  return `Beneficia ${nomes.length} filiais`;
}

/** A frase longa, para tooltip e ficha: aqui a lista cabe. */
export function detalheConsumo(l: ComConsumo): string {
  if (tipoDe(l) === 'integral') return 'O custo é todo da filial que paga.';
  const nomes = (l.filiais_beneficiadas ?? []).map((f) => `${f.empresa_nome} › ${f.nome}`);
  if (l.beneficia_todas) {
    return nomes.length
      ? `Paga por esta filial, consumido por todas as filiais do grupo: ${nomes.join(', ')}.`
      : 'Paga por esta filial, consumido por todas as filiais do grupo.';
  }
  return nomes.length
    ? `Paga por esta filial, consumido por: ${nomes.join(', ')}.`
    : 'Paga por esta filial, com beneficiadas não informadas.';
}
