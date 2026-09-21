/**
 * Leitura do layout "Contas a Pagar" — o dump cru do ERP do cliente.
 *
 * É o SEGUNDO layout de terceiro que o sistema lê, e não tem parentesco com o
 * FOC de 16 colunas (`carga-foc.ts`): são 86 colunas com os nomes internos do
 * ERP (`GLBCOMPANYCOMMERCIALNAME`, `ORIGINALVALUE`, `CREATIONUSER`), em CSV
 * Windows-1252. Mora em arquivo próprio pela mesma razão do outro: quando o
 * ERP mudar, muda só aqui.
 *
 * Três armadilhas do formato, todas medidas no arquivo real de 1.148 linhas e
 * cobertas por teste:
 *
 * 1. O EXPORTADOR OMITE CAMPOS VAZIOS em vez de emitir o separador. As linhas
 *    chegam com 84, 85 ou 86 campos contra 86 no cabeçalho, e casar pela
 *    esquerda desliza a cauda: `CREATIONUSER` recebe o carimbo de
 *    `CREATIONDATETIME` em 69% das linhas. Daí `realinhar`.
 * 2. NÃO HÁ COLUNA DE COMPETÊNCIA. Ela sai do mês do VENCIMENTO — decisão do
 *    cliente, e a que casa com a base que já existe (1.125 das 1.148 linhas
 *    encontram par, contra 998 pela emissão). Emissão e vencimento caem em
 *    meses diferentes em 365 linhas, então a escolha move um terço da carga.
 * 3. CADA PARCELA JÁ É UMA LINHA. `INSTALLMENTQTY` diz "12", mas o arquivo
 *    traz as doze linhas — uma por vencimento. Por isso a natureza aqui é
 *    sempre `pontual_unica`: marcar `pontual_parcelada` faria o sistema gerar
 *    doze lançamentos a partir de uma linha que já é uma das doze, e a carga
 *    entraria com doze vezes a despesa. A parcela vira texto nas observações.
 * 4. O CENTRO DE CUSTO NÃO TEM COLUNA PRÓPRIA: vem dentro do texto de rateio
 *    (`07.05 Serviços Tecnicos: R$ 2.630,00 (100,00%)`), com prefixo numérico
 *    que o cadastro do sistema não usa.
 */
import { paraCentavos } from './dinheiro.js';
import type { ProblemaLinha } from './carga-foc.js';

/** As colunas de que este leitor depende. O arquivo traz 86; usamos 14. */
export const COLUNAS_USADAS = [
  'ID',
  'GLBCOMPANYCOMMERCIALNAME',
  'SUPPLIERNAME',
  'DOCNUMBER',
  'DOCEMISSIONDATE',
  'ACTUALDUEDATE',
  'DOCPAIDDATE',
  'ORIGINALVALUE',
  'LISTOFPRORATEBYCC',
  'MOTIVE',
  'INSTALLMENT',
  'INSTALLMENTQTY',
  'CREATIONUSER',
  'DOCISSUBSTITUTE',
] as const;

/**
 * As âncoras do realinhamento, por NOME e não por índice.
 *
 * Verificadas em 1.148/1.148 linhas do arquivo real: a cabeça casa pela
 * esquerda até `APPROVALDATE`; o bloco de pagamento (`IDPAYINSTRUCTION` ..
 * `WITHPAYMENTINSTRUCTION`) casa pela DIREITA dentro dele; e a cauda, de
 * `KPAYSETOFDOCSSTATUS` ao fim, casa pela direita. `FULLBNKACCOUNT`, entre o
 * bloco e a cauda, é o campo que o exportador descarta quando vazio.
 */
const FIM_CABECA = 'APPROVALDATE';
const INICIO_BLOCO = 'IDPAYINSTRUCTION';
const FIM_BLOCO = 'WITHPAYMENTINSTRUCTION';
const INICIO_CAUDA = 'KPAYSETOFDOCSSTATUS';

/** Reconhece o layout pelo cabeçalho, para o importador escolher sozinho. */
export function ehLayoutContasPagar(cabecalho: string[]): boolean {
  const nomes = new Set(cabecalho.map((c) => c.trim().toUpperCase()));
  return ['IDPAYDOCBILL', 'CREATIONUSER', 'GLBCOMPANYCOMMERCIALNAME'].every((c) => nomes.has(c));
}

interface Ancoras {
  fimCabeca: number;
  inicioBloco: number;
  fimBloco: number;
  inicioCauda: number;
  total: number;
}

export function ancorasDoCabecalho(cabecalho: string[]): Ancoras {
  const pos = (nome: string) => cabecalho.findIndex((c) => c.trim().toUpperCase() === nome);
  return {
    fimCabeca: pos(FIM_CABECA),
    inicioBloco: pos(INICIO_BLOCO),
    fimBloco: pos(FIM_BLOCO),
    inicioCauda: pos(INICIO_CAUDA),
    total: cabecalho.length,
  };
}

/**
 * Devolve a linha com os 86 campos nas posições certas.
 *
 * A correção apenas INSERE posições vazias: a sequência de valores não vazios
 * fica idêntica à do arquivo. É o que permite afirmar que nada foi movido de
 * coluna sem que se saiba — e o teste confere isso linha a linha.
 */
export function realinhar(campos: string[], a: Ancoras): string[] {
  const limpos = campos.map((c) => c.trim());
  if (limpos.length >= a.total) return limpos.slice(0, a.total);

  const linha: string[] = Array(a.total).fill('');
  const cabeca = a.fimCabeca + 1;
  for (let i = 0; i < cabeca && i < limpos.length; i++) linha[i] = limpos[i]!;

  const tamanhoCauda = a.total - a.inicioCauda;
  const cauda = limpos.slice(-tamanhoCauda);
  for (let k = 0; k < cauda.length; k++) linha[a.inicioCauda + k] = cauda[k]!;

  // O que sobra é o bloco de pagamento, encostado à DIREITA do bloco: quando
  // falta campo aqui, quem some é o começo (a instrução de pagamento), não o
  // fim (o indicador de que houve instrução).
  const miolo = limpos.slice(cabeca, limpos.length - tamanhoCauda);
  const largura = a.fimBloco - a.inicioBloco + 1;
  const usados = miolo.slice(-largura);
  for (let k = 0; k < usados.length; k++) linha[a.fimBloco - usados.length + 1 + k] = usados[k]!;
  return linha;
}

export interface LinhaContasPagar {
  /** Número da linha no arquivo, para o relatório apontar onde. */
  linha: number;
  /** O id do documento no ERP. Não vira coluna: vai para as observações. */
  idOrigem: string;
  unidade: string;
  competencia: string;
  valorCentavos: number;
  fornecedor: string;
  centroCusto: string;
  descricao: string;
  documento: string;
  /** "03" de "12", como o ERP escreve. Informação, não instrução — ver abaixo. */
  parcela: string;
  qtdParcelas: string;
  dataEmissao: string;
  dataVencimento: string;
  dataPagamento: string | null;
  /** Quem criou o documento no ERP — é o que o cadastro de reconhecimento lê. */
  usuarioOrigem: string;
  /**
   * `DOCISSUBSTITUTE` como o ERP manda — hoje `"0"` em todas as linhas.
   *
   * As regras de classificação que acompanharam a base pediam para considerar
   * só os registros com esta coluna preenchida. Medida no arquivo de jan–out
   * de 2026, ela vem `"0"` nas 1.148 linhas: sempre preenchida e sempre igual,
   * portanto sem poder de separar nada. Usá-la como porteiro seria inócuo na
   * melhor hipótese e, lida como "só os marcados `Sim`", reprovaria o arquivo
   * inteiro. Quem decide o reconhecimento é o NOME do criador.
   *
   * Continua sendo lida e CONTADA: se um arquivo futuro trouxer a coluna vazia
   * ou com outro valor, o relatório da carga diz quantas linhas — em vez de a
   * diferença passar despercebida.
   */
  docSubstituto: string;
}

export interface LeituraContasPagar {
  linhas: LinhaContasPagar[];
  erros: ProblemaLinha[];
  avisos: ProblemaLinha[];
  /** Quantas linhas chegaram com campo omitido e precisaram ser realinhadas. */
  realinhadas: number;
  /** Quantas linhas VÁLIDAS chegaram sem `DOCISSUBSTITUTE`. Ver `docSubstituto`. */
  semDocSubstituto: number;
  /** Quantas linhas VÁLIDAS chegaram sem `CREATIONUSER` — nunca reconhecidas. */
  semCriador: number;
}

/** `260826000000-0300` → `2026-08-26`. Vazio e lixo viram nulo. */
export function dataDoCarimbo(valor: string): string | null {
  const t = String(valor ?? '').trim();
  if (!/^\d{12}-\d{4}$/.test(t)) return null;
  const ano = 2000 + Number(t.slice(0, 2));
  const mes = Number(t.slice(2, 4));
  const dia = Number(t.slice(4, 6));
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Cada parte do rateio: o centro de custo e quanto dele cabe nesta despesa. */
const RATEIO = /([^:,]+?):\s*R\$\s*([\d.]*\d(?:,\d+)?)\s*\((\d+,\d+)%\)/g;

/**
 * O centro de custo dominante, e se havia mais de um.
 *
 * O prefixo numérico (`07.05 `) sai: o cadastro do sistema usa "Serviços
 * Técnicos", e manter o código faria toda linha cair como centro novo.
 *
 * Quando o documento é rateado entre vários centros — 2 das 1.148 linhas do
 * arquivo real, com ~21 centros a 4,76% cada — o lançamento NÃO é dividido.
 * Dividir criaria lançamentos que não existem no contas a pagar e quebraria o
 * casamento com o número do documento; fica o centro de maior percentual, e o
 * relatório avisa nominalmente.
 */
export function centroDoRateio(texto: string): { centro: string; multiplo: boolean } {
  const partes = [...String(texto ?? '').matchAll(RATEIO)].map((m) => ({
    nome: m[1]!.trim().replace(/^[\d.]+\s+/, ''),
    pct: Number(m[3]!.replace(',', '.')),
  }));
  if (!partes.length) return { centro: '', multiplo: false };
  partes.sort((a, b) => b.pct - a.pct);
  return { centro: partes[0]!.nome, multiplo: partes.length > 1 };
}

/**
 * O valor como este arquivo o escreve: ponto é SEMPRE milhar.
 *
 * Diferente do FOC, que vem de XLSX e pode trazer `164.49` com ponto decimal,
 * aqui o ERP exporta em pt-BR puro — `2.630` são dois mil seiscentos e trinta,
 * e lê-lo como 2,63 encolheria a despesa em mil vezes. Conferido no arquivo
 * real: a soma das 1.148 linhas fecha em R$ 1.203.876,40, e a conversão de ida
 * e volta não perde nenhum valor.
 */
function valorPtBr(texto: string): string {
  return String(texto ?? '').trim().replace(/\./g, '').replace(',', '.');
}

/**
 * Interpreta o arquivo inteiro, sem tocar no banco.
 *
 * Erro = a linha não entra. Aviso = a linha entra, mas falta contexto. A
 * divisão é a mesma do FOC, e pela mesma razão: recusar o lote por uma
 * descrição em branco faria o gestor perder a carga do mês.
 */
export function lerLinhasContasPagar(linhasBrutas: string[][], primeiraLinha = 2): LeituraContasPagar {
  const linhas: LinhaContasPagar[] = [];
  const erros: ProblemaLinha[] = [];
  const avisos: ProblemaLinha[] = [];
  let realinhadas = 0;
  let semDocSubstituto = 0;
  let semCriador = 0;

  const cabecalho = (linhasBrutas[0] ?? []).map((c) => c.replace(/^"|"$/g, '').trim());
  const a = ancorasDoCabecalho(cabecalho);
  const indice = new Map(cabecalho.map((c, i) => [c.toUpperCase(), i]));
  const em = (linha: string[], coluna: string) => linha[indice.get(coluna) ?? -1] ?? '';

  linhasBrutas.slice(1).forEach((bruta, i) => {
    const numero = primeiraLinha + i;
    if (!bruta.some((c) => c.trim() !== '')) return;
    if (bruta.length < a.total) realinhadas += 1;
    const linha = realinhar(bruta, a);

    const unidade = em(linha, 'GLBCOMPANYCOMMERCIALNAME');
    const vencimento = dataDoCarimbo(em(linha, 'ACTUALDUEDATE'));
    const valor = em(linha, 'ORIGINALVALUE');

    if (!unidade) {
      erros.push({ linha: numero, campo: 'GLBCOMPANYCOMMERCIALNAME', mensagem: 'Unidade não informada.' });
      return;
    }
    if (!vencimento) {
      erros.push({ linha: numero, campo: 'ACTUALDUEDATE', mensagem: 'Data de vencimento inválida — é ela que define a competência.' });
      return;
    }
    // `paraCentavos` LANÇA em texto que não é número, e uma linha com valor em
    // branco não pode derrubar a leitura do arquivo inteiro: aqui ela vira erro
    // de linha, como toda outra recusa deste leitor.
    let valorCentavos = 0;
    try {
      valorCentavos = paraCentavos(valorPtBr(valor));
    } catch {
      valorCentavos = 0;
    }
    if (!Number.isFinite(valorCentavos) || valorCentavos <= 0) {
      erros.push({ linha: numero, campo: 'ORIGINALVALUE', mensagem: `Valor inválido ou não positivo: "${valor}".` });
      return;
    }

    const { centro, multiplo } = centroDoRateio(em(linha, 'LISTOFPRORATEBYCC'));
    // Sem centro de custo a linha NÃO entra, e isto é erro e não aviso: o
    // lançamento não existe sem tipo de despesa, e inventar um ("Sem centro de
    // custo") criaria cadastro que ninguém pediu e um balde onde a despesa se
    // esconde. No arquivo real do cliente, nenhuma das 1.148 linhas cai aqui.
    if (!centro) {
      erros.push({
        linha: numero,
        campo: 'LISTOFPRORATEBYCC',
        mensagem: 'Sem centro de custo no rateio — sem ele não há como classificar a despesa.',
      });
      return;
    }
    if (multiplo) {
      avisos.push({
        linha: numero,
        campo: 'LISTOFPRORATEBYCC',
        mensagem: `Rateado entre vários centros de custo; o lançamento fica inteiro no de maior peso ("${centro}").`,
      });
    }
    const descricao = em(linha, 'MOTIVE');
    if (!descricao) {
      avisos.push({ linha: numero, campo: 'MOTIVE', mensagem: 'Sem descrição.' });
    }

    // As duas colunas que as regras de classificação nomeiam. Contadas quando
    // faltam — nenhuma das duas DERRUBA a linha: o que decide o reconhecimento
    // é o nome do criador, e sem ele a linha entra por reconhecer, que é o
    // estado certo para uma despesa que ninguém conferiu.
    const docSubstituto = em(linha, 'DOCISSUBSTITUTE').trim();
    const usuarioOrigem = em(linha, 'CREATIONUSER');
    if (!docSubstituto) semDocSubstituto += 1;
    if (!usuarioOrigem.trim()) semCriador += 1;

    linhas.push({
      linha: numero,
      idOrigem: em(linha, 'ID'),
      unidade,
      competencia: vencimento.slice(0, 7),
      valorCentavos,
      fornecedor: em(linha, 'SUPPLIERNAME'),
      centroCusto: centro,
      descricao,
      documento: em(linha, 'DOCNUMBER'),
      parcela: em(linha, 'INSTALLMENT'),
      qtdParcelas: em(linha, 'INSTALLMENTQTY'),
      dataEmissao: dataDoCarimbo(em(linha, 'DOCEMISSIONDATE')) ?? '',
      dataVencimento: vencimento,
      dataPagamento: dataDoCarimbo(em(linha, 'DOCPAIDDATE')),
      usuarioOrigem,
      docSubstituto,
    });
  });

  return { linhas, erros, avisos, realinhadas, semDocSubstituto, semCriador };
}

/**
 * As partes da chave natural, antes do contador de ocorrência.
 *
 * O NÚMERO DO DOCUMENTO entra na chave, e é a diferença que importa neste
 * layout: no arquivo real há cinco boletos da VIVO de R$ 574,55 no mesmo dia,
 * para a mesma unidade — cobranças distintas, uma por linha telefônica. Sem o
 * documento, quatro delas sumiriam como duplicata.
 */
export function partesDaChaveContasPagar(clienteId: number, l: LinhaContasPagar): Array<string | number> {
  return [clienteId, l.unidade, l.competencia, l.valorCentavos, l.fornecedor, l.centroCusto, l.documento];
}

/**
 * Numera as repetições da chave natural dentro do arquivo.
 *
 * No arquivo real há UMA colisão: duas linhas iguais em unidade, competência,
 * valor, fornecedor, centro de custo e número de documento. Cobrança repetida
 * do mesmo documento existe, e o contador preserva as duas sem deixar a
 * reimportação duplicar — a mesma ordem produz a mesma numeração.
 */
export function numerarOcorrenciasContasPagar(
  clienteId: number,
  linhas: LinhaContasPagar[],
): Array<{ linha: LinhaContasPagar; ocorrencia: number }> {
  const vistas = new Map<string, number>();
  return linhas.map((linha) => {
    const base = partesDaChaveContasPagar(clienteId, linha).join('|');
    const ocorrencia = (vistas.get(base) ?? 0) + 1;
    vistas.set(base, ocorrencia);
    return { linha, ocorrencia };
  });
}
