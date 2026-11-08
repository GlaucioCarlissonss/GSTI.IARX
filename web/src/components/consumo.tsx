/**
 * A identidade visual do consumo de um lançamento.
 *
 * A regra é transversal ao módulo financeiro: a despesa 100% da unidade sai na
 * cor base da empresa; a que ela paga e o grupo consome sai na MESMA cor, em
 * tom escurecido. Escurecer em vez de trocar de cor é o que mantém a leitura —
 * a unidade continua reconhecível, e o tom diz que o custo não é só dela.
 *
 * A cor mora aqui, e não em cada tela, por dois motivos: o detalhamento de
 * lançamentos é aberto por Conferência, Financeiro, Painel Executivo e
 * Relatório com a MESMA fábrica (`detalheDeLancamentos`), que não tem acesso ao
 * estado das páginas; e uma cópia por tela seria uma chance por tela de a mesma
 * despesa aparecer em tom diferente.
 *
 * A cor nunca é o único canal: a etiqueta traz o texto por extenso, e o `title`
 * traz a lista de beneficiadas.
 */
import { useSessao } from '../lib/sessao';
import { COR_OUTRAS, coresDasMatrizes } from '../lib/cores';
import { detalheConsumo, resumoConsumo, tipoDe, type ComConsumo } from '../lib/consumo';

/** O lançamento como o detalhamento o entrega: consumo + a empresa que paga. */
export type ComConsumoEEmpresa = ComConsumo & { empresa_id?: number | null };

/**
 * A cor com que esta empresa pinta o que é compartilhado.
 *
 * Sem empresa conhecida, o cinza de "Outras": um tom inventado sugeriria uma
 * unidade que não está na legenda.
 */
export function useCorCompartilhada(empresaId: number | null | undefined): string {
  const { empresas } = useSessao();
  if (empresaId === null || empresaId === undefined) return COR_OUTRAS;
  return coresDasMatrizes(empresas).get(empresaId)?.corCompartilhada ?? COR_OUTRAS;
}

/**
 * A etiqueta de consumo, igual em toda tela do financeiro.
 *
 * Lançamento próprio não recebe etiqueta colorida: é o caso comum, e etiquetar
 * o comum faz a tabela gritar sem informar.
 */
export function EtiquetaConsumo({ lancamento }: { lancamento: ComConsumoEEmpresa }) {
  const cor = useCorCompartilhada(lancamento.empresa_id);
  if (tipoDe(lancamento) !== 'compartilhado') {
    return <span style={{ color: 'var(--tinta-fraca)' }}>{resumoConsumo(lancamento)}</span>;
  }
  return (
    <span
      className="etiqueta compartilhada"
      style={{ ['--cor' as string]: cor }}
      title={detalheConsumo(lancamento)}
    >
      <i aria-hidden />
      {resumoConsumo(lancamento)}
    </span>
  );
}

/**
 * A legenda fixa dos dois tons.
 *
 * Vai no bloco que usa a distinção, e não uma vez na tela: quem rola até o meio
 * de uma tela longa precisa da chave de leitura ali, não lá em cima. A amostra
 * sai de uma cor de matriz de verdade, porque uma amostra cinza não ensinaria a
 * ler as cores que estão logo ao lado.
 */
export function LegendaDeConsumo({ cor }: { cor?: string }) {
  const base = cor ?? 'var(--matriz-1)';
  return (
    <div className="legenda legenda-consumo">
      <span>
        <i style={{ background: base }} />
        tom da unidade · despesa 100% dela
      </span>
      <span>
        <i style={{ background: `color-mix(in srgb, ${base} 68%, #000)` }} />
        tom escurecido · paga por ela, consumida pelo grupo
      </span>
    </div>
  );
}
