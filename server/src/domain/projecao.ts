/**
 * O MOTOR DE PROJEÇÃO — o que continua acontecendo se nada mudar.
 *
 * O problema que ele resolve. Antes dele, as duas superfícies do sistema
 * projetavam de formas diferentes, e nenhuma das duas projetava o que o gestor
 * precisa ler:
 *
 * - a versão hospedada repetia o TOTAL fixo do último mês fechado, doze vezes.
 *   Um número só, que não se abre: não dá para perguntar "de que contratos
 *   isto é feito?", e um contrato que acabou continua embutido no total;
 * - o servidor somava apenas o que JÁ ESTAVA LANÇADO nos meses à frente. Mês
 *   sem lançamento devolvia ZERO — e a leitura "o custo de TI cai a zero em
 *   março" é falsa de um jeito que ninguém acredita, o que faz a projeção
 *   inteira deixar de ser olhada.
 *
 * A regra agora é uma só, e é por CONTRATO: toda despesa fixa projeta mês a
 * mês, a partir da última vez que apareceu, até a vigência dela — e, não
 * havendo vigência, indefinidamente.
 *
 * ## As quatro decisões que sustentam isso
 *
 * 1. **A identidade do contrato NÃO inclui o valor.** Um reajuste é o mesmo
 *    contrato mais caro, não um contrato novo; se o valor entrasse na chave, o
 *    reajustado passaria a projetar DUAS vezes — o preço velho (do contrato
 *    "encerrado") e o novo. A chave é unidade + filial + tipo + fornecedor +
 *    descrição + cenário, e o valor projetado é o da ÚLTIMA ocorrência, que é
 *    o preço que vale hoje.
 *
 * 2. **Linha real sempre vence a projeção.** Um mês que já tem o lançamento
 *    daquele contrato não recebe a projeção dele. Sem esta regra a despesa
 *    seria contada duas vezes exatamente nos meses em que o gestor foi
 *    diligente e lançou adiantado — punindo o cuidado.
 *
 * 3. **A vigência manda; a ausência dela significa "em aberto".** Encerrar um
 *    contrato é cadastrar até quando ele valeu. Supor um fim que ninguém
 *    informou inventaria o encerramento de contratos em vigor, e o sistema
 *    passaria a prometer uma economia que não aconteceu.
 *
 * 4. **O mês corrente é completado, não ignorado.** Ele costumava sair da
 *    leitura inteira porque "está pela metade" — e o resultado era um buraco
 *    justamente no mês que o gestor está vivendo. Agora o que já foi lançado
 *    nele conta como realizado, e os contratos que ainda não foram lançados
 *    entram como projeção. O mês fica inteiro sem fingir que já fechou.
 *
 * ## O que ele deliberadamente NÃO faz
 *
 * Não projeta despesa pontual, única ou parcelada. A parcelada já tem as
 * linhas dela gravadas até o fim — projetá-la seria contar de novo. A única
 * não tem o que repetir: ela aconteceu uma vez. Projetá-las exigiria adivinhar
 * compras que ninguém decidiu ainda.
 */
import { db } from '../db/index.js';
import { intervalo, somarMeses } from './competencia.js';

/** Uma despesa fixa como o motor precisa vê-la. */
export interface OcorrenciaFixa {
  empresaId: number;
  filialId: number | null;
  tipoDespesaId: number;
  tipoDespesa?: string | null;
  fornecedor?: string | null;
  descricao?: string | null;
  cenario: string;
  /** AAAA-MM */
  competencia: string;
  valorCentavos: number;
  /** AAAA-MM, ou nulo para contrato em aberto. */
  recorrenciaAte?: string | null;
}

/** Um contrato recorrente, deduzido das ocorrências dele. */
export interface Contrato {
  chave: string;
  empresaId: number;
  filialId: number | null;
  tipoDespesaId: number;
  tipoDespesa: string | null;
  fornecedor: string | null;
  descricao: string | null;
  cenario: string;
  /** A última competência em que ele foi lançado de verdade. */
  ultimaOcorrencia: string;
  /** O valor da última ocorrência — o preço que vale hoje. */
  valorCentavos: number;
  /** Até quando vale. Nulo = em aberto. */
  recorrenciaAte: string | null;
  /** Quantas vezes ele já foi lançado. */
  ocorrencias: number;
  /** A primeira vez que apareceu, para a tela poder dizer "desde quando". */
  primeiraOcorrencia: string;
  /** As competências em que ele JÁ tem linha real — não recebem projeção. */
  lancados: Set<string>;
}

/**
 * A identidade do contrato. Normaliza como `chaveDedup` normaliza, para que
 * "TOTVS " e "totvs" sejam o mesmo fornecedor — a planilha do cliente não é
 * consistente em espaço nem em caixa, e tratá-los como contratos distintos
 * dobraria a projeção dele.
 */
const normal = (v: unknown) =>
  v === null || v === undefined ? '' : String(v).trim().toLowerCase().replace(/\s+/g, ' ');

export function chaveDoContrato(o: OcorrenciaFixa): string {
  return [
    o.empresaId,
    o.filialId ?? '',
    o.tipoDespesaId,
    normal(o.fornecedor),
    normal(o.descricao),
    normal(o.cenario),
  ].join('|');
}

/**
 * Agrupa as ocorrências em contratos.
 *
 * A vigência vem da ocorrência MAIS RECENTE que declarou uma: é a última
 * palavra de quem cadastrou. Uma vigência antiga sobrevivendo a uma nova faria
 * o encerramento depender da ordem em que as linhas foram gravadas.
 */
export function contratosDe(ocorrencias: Iterable<OcorrenciaFixa>): Contrato[] {
  const porChave = new Map<string, Contrato>();
  // Declarações de vigência, com o mês em que foram declaradas, para a mais
  // recente ganhar independentemente da ordem de chegada.
  const vigencias = new Map<string, { em: string; ate: string }>();

  for (const o of ocorrencias) {
    const chave = chaveDoContrato(o);
    const atual = porChave.get(chave);
    if (!atual) {
      porChave.set(chave, {
        chave,
        empresaId: o.empresaId,
        filialId: o.filialId ?? null,
        tipoDespesaId: o.tipoDespesaId,
        tipoDespesa: o.tipoDespesa ?? null,
        fornecedor: o.fornecedor ?? null,
        descricao: o.descricao ?? null,
        cenario: o.cenario,
        ultimaOcorrencia: o.competencia,
        valorCentavos: o.valorCentavos,
        recorrenciaAte: null,
        ocorrencias: 1,
        primeiraOcorrencia: o.competencia,
        lancados: new Set([o.competencia]),
      });
    } else {
      atual.ocorrencias += 1;
      atual.lancados.add(o.competencia);
      if (o.competencia < atual.primeiraOcorrencia) atual.primeiraOcorrencia = o.competencia;
      // O valor acompanha a última ocorrência: é o preço vigente.
      if (o.competencia > atual.ultimaOcorrencia) {
        atual.ultimaOcorrencia = o.competencia;
        atual.valorCentavos = o.valorCentavos;
      }
    }
    if (o.recorrenciaAte) {
      const anterior = vigencias.get(chave);
      if (!anterior || o.competencia >= anterior.em) {
        vigencias.set(chave, { em: o.competencia, ate: o.recorrenciaAte });
      }
    }
  }

  for (const [chave, v] of vigencias) {
    const c = porChave.get(chave);
    if (c) c.recorrenciaAte = v.ate;
  }
  return [...porChave.values()];
}

/** Uma parcela projetada de um contrato, num mês. */
export interface ParcelaProjetada {
  competencia: string;
  chave: string;
  valorCentavos: number;
  contrato: Contrato;
}

/**
 * O contrato vale neste mês?
 *
 * `de` é a primeira competência em que ele passa a valer — a última ocorrência
 * dele. Antes disso ele não existia, e projetar para trás inventaria despesa
 * num passado que já foi medido.
 */
export function valeEm(c: Contrato, mes: string): boolean {
  if (mes < c.ultimaOcorrencia) return false;
  if (c.recorrenciaAte && mes > c.recorrenciaAte) return false;
  return true;
}

/**
 * As parcelas que o motor projeta no intervalo, contrato a contrato.
 *
 * Só entra o mês em que o contrato vale E não tem linha real — a regra 2.
 */
export function projetar(
  contratos: Contrato[],
  de: string,
  ate: string,
): ParcelaProjetada[] {
  if (ate < de) return [];
  const meses = intervalo(de, ate);
  const saida: ParcelaProjetada[] = [];
  for (const c of contratos) {
    for (const mes of meses) {
      if (!valeEm(c, mes)) continue;
      if (c.lancados.has(mes)) continue;
      saida.push({ competencia: mes, chave: c.chave, valorCentavos: c.valorCentavos, contrato: c });
    }
  }
  return saida;
}

/** O total projetado por competência, pronto para somar ao realizado. */
export function projetadoPorMes(
  contratos: Contrato[],
  de: string,
  ate: string,
): Map<string, { centavos: number; contratos: number }> {
  const mapa = new Map<string, { centavos: number; contratos: number }>();
  for (const p of projetar(contratos, de, ate)) {
    const atual = mapa.get(p.competencia) ?? { centavos: 0, contratos: 0 };
    atual.centavos += p.valorCentavos;
    atual.contratos += 1;
    mapa.set(p.competencia, atual);
  }
  return mapa;
}

/**
 * O horizonte padrão da projeção: do mês CORRENTE (que é completado, não
 * ignorado — regra 4) até doze meses à frente.
 *
 * Doze é o mesmo horizonte do "Compromisso — 12 meses" do Painel. Dois
 * horizontes diferentes sobre a mesma base dariam duas respostas para
 * "quanto isto compromete".
 */
export const MESES_PROJETADOS = 12;

export function horizonte(mesCorrente: string): { de: string; ate: string } {
  return { de: mesCorrente, ate: somarMeses(mesCorrente, MESES_PROJETADOS) };
}

// ==========================================================================
// A borda do banco
//
// Tudo acima é puro — recebe ocorrências e devolve contratos. É o que permite
// medir a REGRA sem subir banco nenhum. Daqui para baixo mora a única função
// que lê o SQLite, e ela existe para que o SQL da projeção não se espalhe por
// cada tela que precisa dela.
// ==========================================================================

/**
 * Os contratos recorrentes de um escopo.
 *
 * `where`/`params` são a cláusula de escopo que a tela já montou — empresa,
 * filial, cenário. O filtro de MÊS deliberadamente não entra: o contrato
 * precisa ser conhecido pela história INTEIRA dele. Recortá-lo pela janela
 * apagaria justamente o contrato que parou de aparecer dentro dela — que é o
 * que a projeção existe para carregar adiante.
 */
export function contratosDoEscopo(where: string, params: unknown[]): Contrato[] {
  const linhas = db()
    .prepare(
      `SELECT l.empresa_id, l.filial_id, l.tipo_despesa_id, t.nome AS tipo_despesa,
              l.fornecedor, l.descricao, l.cenario, l.competencia, l.valor_centavos,
              l.recorrencia_ate
         FROM lancamentos l
         LEFT JOIN tipos_despesa t ON t.id = l.tipo_despesa_id
        WHERE ${where} AND l.natureza = 'fixa'`,
    )
    .all(...params) as Array<{
    empresa_id: number;
    filial_id: number | null;
    tipo_despesa_id: number;
    tipo_despesa: string | null;
    fornecedor: string | null;
    descricao: string | null;
    cenario: string;
    competencia: string;
    valor_centavos: number;
    recorrencia_ate: string | null;
  }>;

  return contratosDe(
    linhas.map((l) => ({
      empresaId: l.empresa_id,
      filialId: l.filial_id,
      tipoDespesaId: l.tipo_despesa_id,
      tipoDespesa: l.tipo_despesa,
      fornecedor: l.fornecedor,
      descricao: l.descricao,
      cenario: l.cenario,
      competencia: l.competencia,
      valorCentavos: l.valor_centavos,
      recorrenciaAte: l.recorrencia_ate,
    })),
  );
}
