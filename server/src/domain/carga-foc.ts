/**
 * Leitura do layout FOC — a base que o cliente exporta do sistema dele.
 *
 * É um layout de UMA aba, com as 16 colunas em caixa alta, que não tem nada a
 * ver com o template do sistema. Ele mora aqui, separado de `importacao.ts`,
 * porque é o formato de um terceiro: quando ele mudar, muda só este arquivo.
 *
 * Duas armadilhas do formato, ambas verificadas no arquivo real e cobertas por
 * teste:
 *
 * 1. `ORIGEM` aqui NÃO é a `origem` do lançamento (que é a procedência do dado:
 *    planilha, folha, projeção, manual). É o tipo de registro, e ele decide em
 *    QUAL COLUNA está o valor — `FOC_DESPESAS` usa `VALOR_GASTO`,
 *    `FOC_APROVACAO` usa `PGTO_DIA`. As duas nunca somam na mesma linha.
 * 2. `COMPETENCIA` chega em formatos que o resto do sistema não conhece
 *    (`set./26`, e às vezes uma data inteira como `26/09/2026`).
 */
import { paraCentavos } from './dinheiro.js';
import { normalizarCabecalho } from './templates.js';

/** O tipo de registro, que decide de qual coluna sai o valor. */
export type OrigemFoc = 'FOC_DESPESAS' | 'FOC_APROVACAO';

export const ORIGENS_FOC: OrigemFoc[] = ['FOC_DESPESAS', 'FOC_APROVACAO'];

/** Colunas canônicas do layout, na ordem em que o arquivo as traz. */
export const COLUNAS_FOC = [
  'origem',
  'competencia',
  'grupo',
  'unidade',
  'grupo_gasto',
  'tipo',
  'centro_custo',
  'valor_gasto',
  'meta',
  'pgto_dia',
  'proj_diarias',
  'proj_pacientes',
  'data_pgto',
  'fornecedor',
  'motivo',
  'meta_mes',
] as const;

export type ColunaFoc = (typeof COLUNAS_FOC)[number];

/** Sem estas o arquivo não é importável. */
export const OBRIGATORIAS_FOC: ColunaFoc[] = ['origem', 'unidade', 'tipo', 'centro_custo', 'data_pgto'];

/**
 * Apelidos por coluna. O arquivo real usa `Meta Mês` onde o canônico é
 * `meta_mes` — e `normalizarCabecalho` já colapsa acento e separador, então a
 * lista existe só para as diferenças de PALAVRA, não de grafia.
 */
const APELIDOS: Partial<Record<ColunaFoc, string[]>> = {
  valor_gasto: ['valor gasto', 'vr gasto', 'valor'],
  pgto_dia: ['pgto dia', 'pagamento do dia', 'pgto de hoje'],
  data_pgto: ['data pgto', 'data de pagamento', 'data pagamento'],
  centro_custo: ['centro de custo', 'novo centro custo'],
  grupo_gasto: ['grupo de gasto'],
  meta_mes: ['meta mes'],
  motivo: ['descricao', 'historico'],
};

/**
 * Liga cada coluna canônica ao cabeçalho como ele veio no arquivo.
 *
 * `extras` são os apelidos cadastrados para o CLIENTE — o adaptador de carga
 * dele, que vence os apelidos fixos porque foi cadastrado olhando o arquivo
 * real daquele contratante.
 */
export function mapearColunasFoc(
  cabecalho: string[],
  extras: Record<string, string[]> = {},
): Map<ColunaFoc, string> {
  const disponiveis = new Map(cabecalho.map((c) => [normalizarCabecalho(c), c]));
  const mapa = new Map<ColunaFoc, string>();
  for (const coluna of COLUNAS_FOC) {
    const chaves = [
      ...(extras[coluna] ?? []).map(normalizarCabecalho),
      normalizarCabecalho(coluna),
      ...(APELIDOS[coluna] ?? []).map(normalizarCabecalho),
    ];
    for (const chave of chaves) {
      const achou = disponiveis.get(chave);
      if (achou !== undefined) {
        mapa.set(coluna, achou);
        break;
      }
    }
  }
  return mapa;
}

export function colunasFaltantesFoc(mapa: Map<ColunaFoc, string>): ColunaFoc[] {
  return OBRIGATORIAS_FOC.filter((c) => !mapa.has(c));
}

const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const doisDigitos = (n: number) => String(n).padStart(2, '0');
/** Ano de dois dígitos é deste século: a base é de 2026, não de 1926. */
const anoCheio = (bruto: string) => (bruto.length === 2 ? 2000 + Number(bruto) : Number(bruto));

/**
 * Competência do arquivo para o formato interno `AAAA-MM`.
 *
 * Aceita, além do que o sistema já usa (`MM/AAAA` e `AAAA-MM`):
 * - `set./26`, `set/26`, `setembro/2026` — mês por extenso abreviado, que é
 *   como a base do cliente vem na maioria das linhas;
 * - `26/09/2026` — uma data COMPLETA onde se espera um mês. Acontece em parte
 *   das linhas do arquivo real; ignorar o dia é a leitura certa, e recusar a
 *   linha por isso perderia despesa legítima.
 *
 * Devolve `null` em vez de lançar: quem chama decide se é erro ou aviso.
 */
export function normalizarCompetencia(bruto: unknown): string | null {
  if (bruto instanceof Date && !Number.isNaN(bruto.getTime())) {
    return `${bruto.getUTCFullYear()}-${doisDigitos(bruto.getUTCMonth() + 1)}`;
  }
  const texto = String(bruto ?? '').trim().toLowerCase();
  if (!texto) return null;

  // AAAA-MM (interno) e AAAA-MM-DD (ISO, do qual só o mês interessa)
  const iso = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(texto);
  if (iso && Number(iso[2]) >= 1 && Number(iso[2]) <= 12) return `${iso[1]}-${iso[2]}`;

  // DD/MM/AAAA — data inteira onde se espera competência
  const dataCheia = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(texto);
  if (dataCheia) {
    const mes = Number(dataCheia[2]);
    if (mes >= 1 && mes <= 12) return `${anoCheio(dataCheia[3]!)}-${doisDigitos(mes)}`;
  }

  // MM/AAAA
  const mesAno = /^(\d{1,2})[/-](\d{2,4})$/.exec(texto);
  if (mesAno) {
    const mes = Number(mesAno[1]);
    if (mes >= 1 && mes <= 12) return `${anoCheio(mesAno[2]!)}-${doisDigitos(mes)}`;
  }

  // set./26, set/26, setembro/2026
  const porExtenso = /^([a-zç]{3,})\.?[/-](\d{2,4})$/.exec(texto);
  if (porExtenso) {
    const i = MESES_PT.indexOf(porExtenso[1]!.slice(0, 3));
    if (i >= 0) return `${anoCheio(porExtenso[2]!)}-${doisDigitos(i + 1)}`;
  }
  return null;
}

/** Data de pagamento para ISO `AAAA-MM-DD`. Aceita Date, ISO e dd/mm/aaaa. */
export function normalizarData(bruto: unknown): string | null {
  if (bruto instanceof Date && !Number.isNaN(bruto.getTime())) {
    return bruto.toISOString().slice(0, 10);
  }
  const texto = String(bruto ?? '').trim();
  if (!texto) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(texto);
  if (br) {
    const dia = Number(br[1]);
    const mes = Number(br[2]);
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
      return `${anoCheio(br[3]!)}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
    }
  }
  return null;
}

export interface LinhaFoc {
  /** Número da linha no arquivo, para o relatório de erros apontar onde. */
  linha: number;
  origem: OrigemFoc;
  competencia: string | null;
  grupo: string;
  unidade: string;
  grupoGasto: string;
  tipo: string;
  centroCusto: string;
  fornecedor: string;
  motivo: string;
  dataPagamento: string;
  valorCentavos: number;
  /** Meta e projeções: controle, nunca valor. Vai para `planejamento` em JSON. */
  planejamento: Record<string, number>;
}

export interface ProblemaLinha {
  linha: number;
  campo: string;
  mensagem: string;
}

const texto = (v: unknown) => String(v ?? '').trim();
/**
 * Número vindo da planilha, nos dois formatos que aparecem.
 *
 * A vírgula é o que decide: com ela o texto é pt-BR (`1.234,56`, ponto de
 * milhar); sem ela o ponto é o separador decimal (`164.49`, que é como a
 * leitura do XLSX devolve). Tratar todo ponto como milhar transformaria
 * R$ 164,49 em R$ 16.449,00 — cem vezes a despesa.
 */
const numero = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const bruto = texto(v);
  const limpo = bruto.includes(',') ? bruto.replace(/\./g, '').replace(',', '.') : bruto;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
};

export interface LeituraFoc {
  linhas: LinhaFoc[];
  erros: ProblemaLinha[];
  avisos: ProblemaLinha[];
}

/**
 * Interpreta as linhas da aba já lida, sem tocar no banco.
 *
 * Erro = a linha não entra. Aviso = a linha entra, mas falta contexto. A
 * divisão importa: recusar o lote inteiro por um `motivo` em branco faria o
 * gestor perder a carga do mês por causa de uma célula descritiva.
 */
export function lerLinhasFoc(
  linhasBrutas: Array<Record<string, unknown>>,
  mapa: Map<ColunaFoc, string>,
  /** Deslocamento do cabeçalho: a 1ª linha de dados é a 2ª do arquivo. */
  primeiraLinha = 2,
): LeituraFoc {
  const ler = (linha: Record<string, unknown>, coluna: ColunaFoc): unknown => {
    const origem = mapa.get(coluna);
    return origem === undefined ? undefined : linha[origem];
  };

  const linhas: LinhaFoc[] = [];
  const erros: ProblemaLinha[] = [];
  const avisos: ProblemaLinha[] = [];

  linhasBrutas.forEach((bruta, i) => {
    const n = primeiraLinha + i;
    const origemBruta = texto(ler(bruta, 'origem')).toUpperCase();
    if (!ORIGENS_FOC.includes(origemBruta as OrigemFoc)) {
      erros.push({
        linha: n,
        campo: 'origem',
        mensagem: origemBruta
          ? `Origem "${origemBruta}" não é reconhecida. Use FOC_DESPESAS ou FOC_APROVACAO.`
          : 'Origem não informada.',
      });
      return;
    }
    const origem = origemBruta as OrigemFoc;

    const unidade = texto(ler(bruta, 'unidade'));
    const centroCusto = texto(ler(bruta, 'centro_custo'));
    const tipo = texto(ler(bruta, 'tipo'));
    if (!unidade) erros.push({ linha: n, campo: 'unidade', mensagem: 'Unidade não informada.' });
    if (!centroCusto) erros.push({ linha: n, campo: 'centro_custo', mensagem: 'Centro de custo não informado.' });
    if (!tipo) erros.push({ linha: n, campo: 'tipo', mensagem: 'Tipo não informado.' });

    const dataPagamento = normalizarData(ler(bruta, 'data_pgto'));
    if (!dataPagamento) {
      erros.push({
        linha: n,
        campo: 'data_pgto',
        mensagem: `Data de pagamento inválida: "${texto(ler(bruta, 'data_pgto'))}".`,
      });
    }

    // O valor sai da coluna que a ORIGEM manda, e só dela: somar as duas
    // inverteria o sentido do registro.
    const colunaValor: ColunaFoc = origem === 'FOC_DESPESAS' ? 'valor_gasto' : 'pgto_dia';
    const bruto = ler(bruta, colunaValor);
    const valor = numero(bruto);
    if (texto(bruto) === '') {
      erros.push({
        linha: n,
        campo: colunaValor,
        mensagem: `Linha ${origem} sem valor em ${colunaValor}.`,
      });
    } else if (valor < 0) {
      erros.push({ linha: n, campo: colunaValor, mensagem: `Valor negativo (${valor}) não é aceito.` });
    }

    const competencia = normalizarCompetencia(ler(bruta, 'competencia'));
    if (!competencia) {
      // Sem competência a despesa ainda tem lugar: cai no mês do pagamento.
      if (texto(ler(bruta, 'competencia'))) {
        avisos.push({
          linha: n,
          campo: 'competencia',
          mensagem: `Competência "${texto(ler(bruta, 'competencia'))}" não reconhecida; usando o mês do pagamento.`,
        });
      } else {
        avisos.push({ linha: n, campo: 'competencia', mensagem: 'Competência ausente; usando o mês do pagamento.' });
      }
    }

    const fornecedor = texto(ler(bruta, 'fornecedor'));
    const motivo = texto(ler(bruta, 'motivo'));
    const grupo = texto(ler(bruta, 'grupo'));
    const grupoGasto = texto(ler(bruta, 'grupo_gasto'));
    for (const [campo, valorTexto] of [
      ['fornecedor', fornecedor],
      ['motivo', motivo],
      ['grupo', grupo],
      ['grupo_gasto', grupoGasto],
    ] as Array<[string, string]>) {
      if (!valorTexto) avisos.push({ linha: n, campo, mensagem: `Campo "${campo}" ausente.` });
    }

    if (erros.some((e) => e.linha === n)) return;

    const planejamento: Record<string, number> = {};
    for (const campo of ['meta', 'proj_diarias', 'proj_pacientes', 'meta_mes'] as ColunaFoc[]) {
      const v = ler(bruta, campo);
      if (texto(v) !== '') planejamento[campo] = numero(v);
    }

    linhas.push({
      linha: n,
      origem,
      competencia: competencia ?? dataPagamento!.slice(0, 7),
      grupo,
      unidade,
      grupoGasto,
      tipo,
      centroCusto,
      fornecedor,
      motivo,
      dataPagamento: dataPagamento!,
      valorCentavos: paraCentavos(valor),
      planejamento,
    });
  });

  return { linhas, erros, avisos };
}

/**
 * As partes da chave natural de uma linha, antes do contador de ocorrência.
 *
 * O `centro_custo` faz parte da chave, e essa é a diferença que importa: no
 * arquivo real há oito linhas com a mesma unidade, a mesma data e o mesmo
 * fornecedor, que diferem SÓ no centro de custo. Sem ele, seis delas colapsam
 * em duas e quatro despesas somem sem ninguém notar.
 */
export function partesDaChave(clienteId: number, l: LinhaFoc): Array<string | number> {
  return [clienteId, l.unidade, l.dataPagamento, l.valorCentavos, l.origem, l.fornecedor, l.centroCusto];
}

/**
 * Numera as repetições da chave natural dentro do arquivo.
 *
 * Duas linhas idênticas em tudo são legítimas — a mesma tarifa cobrada duas
 * vezes no mesmo dia existe. O contador preserva as duas, e continua
 * idempotente: reimportar o mesmo arquivo reproduz a mesma numeração, então as
 * mesmas chaves saem do outro lado.
 */
export function numerarOcorrencias(clienteId: number, linhas: LinhaFoc[]): Array<{ linha: LinhaFoc; ocorrencia: number }> {
  const vistas = new Map<string, number>();
  return linhas.map((linha) => {
    const base = partesDaChave(clienteId, linha).join('|');
    const ocorrencia = (vistas.get(base) ?? 0) + 1;
    vistas.set(base, ocorrencia);
    return { linha, ocorrencia };
  });
}
