/**
 * O CRONOGRAMA DE ONDAS da implantação — quem vira, e quando.
 *
 * É o mesmo cronograma que o artifact carrega em `SPIN_ONDAS`, e os dois
 * precisam dizer a mesma coisa: ele é o documento que vai à diretoria, e duas
 * telas discordando sobre quem virou em 01/10 é pior que uma tela só.
 *
 * FONTE: `PLANO_DE_ACAO_SPINCARE`, que substituiu o cronograma anterior. A
 * mudança não foi de detalhe — a ORDEM DAS ONDAS INVERTEU:
 *
 *   antes                                    agora
 *   1ª  Paraíba (3 unidades)   01/10    →    1ª  Porto Velho/RO + Rio/RJ   01/10
 *   2ª  RO + SP + RJ           01/10    →    2ª  Paraíba (3 unidades)      03/11
 *   3ª  DF + MT + GO           01/11    →    3ª  8 unidades                01/12
 *   4ª  RN×2 + CE + AM         01/12    →    4ª  PE + AL + AM + SP         04/01
 *   5ª  BA + SE + PE + AL      01/01    →    (cinco ondas viraram quatro)
 *
 * São as MESMAS 17 unidades, reagrupadas.
 *
 * POR QUE CÓDIGO, E NÃO TABELA. O cronograma é revisado como código, e uma
 * planilha trocada por engano não pode remontar as ondas sozinha — a carga do
 * plano CONFERE o go-live contra ele e avisa a divergência em vez de aceitá-la.
 * Quando o cliente precisar editá-lo pela tela, aí sim ele vira cadastro.
 */

export interface OndaCronograma {
  n: number;
  /** Mês do go-live, em AAAA-MM. */
  mes: string;
  /** Dia do go-live, em AAAA-MM-DD. O plano publica a data exata. */
  virada: string;
  unidades: string[];
  /**
   * A data em que a virada ACONTECEU, quando informada pela gestão.
   *
   * É um fato, não uma dedução: uma unidade pode entrar em produção com
   * pendências, e esperar as pendências acabarem para dizer que virou faria a
   * tela negar o que já aconteceu.
   */
  viradaRealizada: string | null;
}

export const ONDAS: OndaCronograma[] = [
  { n: 1, mes: '2026-10', virada: '2026-10-01',
    unidades: ['MHC Porto Velho/RO', 'UC Rio de Janeiro/RJ'],
    viradaRealizada: '2026-10-01' },
  { n: 2, mes: '2026-11', virada: '2026-11-03',
    unidades: ['HR João Pessoa/PB', 'HR Campina Grande/PB', 'MHC João Pessoa/PB'],
    viradaRealizada: null },
  { n: 3, mes: '2026-12', virada: '2026-12-01',
    unidades: ['MHC Brasília/DF', 'MHC Goiânia/GO', 'MHC Cuiabá/MT', 'AHC Natal/RN',
      'HR Natal/RN', 'MHC Fortaleza/CE', 'AHC Aracaju/SE', 'HR Salvador/BA'],
    viradaRealizada: null },
  { n: 4, mes: '2027-01', virada: '2027-01-04',
    unidades: ['HR Recife/PE', 'HR Maceió/AL', 'MHC Manaus/AM', 'UC São Paulo/SP'],
    viradaRealizada: null },
];

/**
 * O total de pacientes do cronograma.
 *
 * Fica fora das ondas porque o plano novo reagrupou as unidades sem publicar a
 * contagem de cada uma: o total segue valendo (são as mesmas 17 unidades), mas
 * a divisão por onda deixou de ser conhecida. Repartir 1.922 entre as ondas
 * novas seria um palpite indistinguível do dado real.
 */
export const PACIENTES_TOTAL = 1922;

/** O último dia possível de uma competência AAAA-MM. */
const fimDoMes = (comp: string) => `${comp}-31`;

export interface UnidadeDaVirada {
  nome: string;
  onda: number;
  prazo: string;
  realizada: string | null;
  virou: boolean;
  estado: 'CUMPRIDO' | 'NÃO CUMPRIDO' | 'PENDENTE';
}

/**
 * As unidades de uma onda, com o estado delas numa data de corte.
 *
 * O corte é por DATA, e não pelo estado de hoje: olhar agosto não pode mostrar
 * uma virada declarada em outubro como se já tivesse acontecido.
 */
export function unidadesDaOnda(onda: OndaCronograma, ate: string): UnidadeDaVirada[] {
  const declarou = !!onda.viradaRealizada && onda.viradaRealizada <= ate;
  const venceu = onda.virada <= ate;
  return onda.unidades.map((nome) => ({
    nome,
    onda: onda.n,
    prazo: onda.virada,
    realizada: declarou ? onda.viradaRealizada : null,
    virou: declarou,
    // Sem declaração e com o prazo vencido, a onda não cumpriu. Antes de
    // vencer, ela está pendente — e não reprovada por um prazo que não passou.
    estado: declarou ? 'CUMPRIDO' : (venceu ? 'NÃO CUMPRIDO' : 'PENDENTE'),
  }));
}

export interface EntregaDoCronograma {
  /** Unidades que já deviam ter virado até a data de corte. */
  planejadas: number;
  viradas: number;
  /** Percentual entregue, ou `null` quando nenhuma onda venceu ainda. */
  resultado: number | null;
  /** O alvo é entregar a onda inteira. */
  meta: number | null;
  unidades: UnidadeDaVirada[];
  ondas: number[];
}

/**
 * A ENTREGA DO CRONOGRAMA ACUMULADA até o fim de uma competência.
 *
 * É o resultado do módulo de Projetos: o que a diretoria pergunta não é
 * quantas tarefas saíram no prazo, e sim se as unidades viraram quando foi
 * combinado.
 *
 * Acumulado, e não só as ondas do próprio mês: a pergunta é "estamos em dia
 * com o cronograma até aqui?", e medir apenas o mês faria o resultado sumir em
 * todo mês sem virada marcada.
 *
 * Nenhuma onda vencida não é 0%: é uma meta que ainda não chegou, e zero
 * reprovaria o programa por um prazo que não passou.
 */
export function entregaAte(comp: string): EntregaDoCronograma {
  if (!comp) return { planejadas: 0, viradas: 0, resultado: null, meta: null, unidades: [], ondas: [] };
  const ate = fimDoMes(comp);
  const vencidas = ONDAS.filter((o) => o.virada <= ate);
  const unidades = vencidas.flatMap((o) => unidadesDaOnda(o, ate));
  const planejadas = unidades.length;
  const viradas = unidades.filter((u) => u.virou).length;
  return {
    planejadas, viradas,
    resultado: planejadas ? Math.round((viradas / planejadas) * 1000) / 10 : null,
    meta: planejadas ? 100 : null,
    unidades,
    ondas: vencidas.map((o) => o.n),
  };
}

export interface OndaMedida extends OndaCronograma {
  unidadesDetalhe: UnidadeDaVirada[];
  planejadas: number;
  viradas: number;
  /** `null` enquanto a onda não vence — não é zero. */
  resultado: number | null;
  meta: number;
  venceu: boolean;
  estado: 'CUMPRIDO' | 'NÃO CUMPRIDO' | 'PENDENTE';
}

/** O cronograma inteiro medido numa data de corte. */
export function cronograma(hoje: string): { ondas: OndaMedida[]; pacientes: number; unidades: number } {
  const ondas = ONDAS.map((o): OndaMedida => {
    const detalhe = unidadesDaOnda(o, hoje);
    const viradas = detalhe.filter((u) => u.virou).length;
    const venceu = !!o.viradaRealizada || o.virada <= hoje;
    return {
      ...o,
      unidadesDetalhe: detalhe,
      planejadas: detalhe.length,
      viradas,
      resultado: venceu ? Math.round((viradas / detalhe.length) * 1000) / 10 : null,
      meta: 100,
      venceu,
      estado: viradas === detalhe.length ? 'CUMPRIDO'
        : (venceu ? 'NÃO CUMPRIDO' : 'PENDENTE'),
    };
  });
  return {
    ondas,
    pacientes: PACIENTES_TOTAL,
    unidades: ONDAS.reduce((s, o) => s + o.unidades.length, 0),
  };
}
