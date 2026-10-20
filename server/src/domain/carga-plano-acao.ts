/**
 * A CARGA DO PLANO DE AÇÃO a partir da planilha do cliente.
 *
 * Mesma leitura que `artifact/app-js23.js` faz no navegador, e pelas mesmas
 * razões — as duas superfícies têm de recusar o mesmo arquivo e aceitar o
 * mesmo, ou o gestor que importa pelo celular e confere pelo navegador verá
 * dois planos diferentes.
 *
 * NADA É INVENTADO. Campo vazio continua vazio e é CONTADO no diagnóstico:
 * uma ação sem data de fim entra com farol "Sem data" e aparece na lista de
 * problemas. É a diferença entre uma carga que informa o que falta e uma que
 * preenche o buraco com um palpite indistinguível do dado real.
 *
 * A COLUNA "Farol (Prazo)" DO ARQUIVO É DESCARTADA, e a "Qtd Dias" também. A
 * primeira foi escrita contra o dia em que alguém abriu a planilha; a segunda
 * diverge do intervalo entre as pontas em várias linhas. O que vale são as
 * datas.
 */
import { lerGradeXlsx } from '../lib/planilha.js';
import { erroValidacao } from '../lib/erros.js';
import { ONDAS } from './cronograma.js';
import { PLANO_STATUS } from './plano-acao.js';
import type { AcaoDoPlano } from './plano-acao.js';

/** Sem acento, sem caixa, sem espaço dobrado — para casar rótulo com rótulo. */
export const chaveDeNome = (s: unknown): string => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Uma data em ISO, venha ela como estiver.
 *
 * A planilha mistura três formas: o texto brasileiro, o ISO que o ExcelJS já
 * devolve para célula de data, e o número de série do Excel quando a célula
 * foi digitada como número. A faixa do serial exclui o que não é data: 20000
 * é 1954 e 80000 é 2119.
 */
export function dataISO(bruto: unknown): string {
  const v = String(bruto ?? '').trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (br) return `${br[3]}-${br[2]!.padStart(2, '0')}-${br[1]!.padStart(2, '0')}`;
  const n = Number(v);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
  }
  return '';
}

/** `AAAA-MM-DD` → `DD/MM/AAAA`, só para as mensagens. */
const diaExib = (iso: string): string => (iso
  ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
  : '—');

/** O cabeçalho que prova que a aba é uma onda do plano. */
export const PLANO_CABECALHO = ['Nº', 'Tarefa', 'Área Responsável', 'Líder de Equipe',
  'Data Início', 'Data Fim', 'Qtd Dias', 'Status da Ação'];

/** `Onda 3` → 3. Qualquer outra coisa devolve nulo. */
export function numeroDaOnda(nomeAba: string): number | null {
  const m = /^\s*onda\s*(\d+)\s*$/i.exec(chaveDeNome(nomeAba));
  return m ? Number(m[1]) : null;
}

/**
 * A linha do cabeçalho dentro da aba da onda.
 *
 * Não é fixa: as abas trazem um título, a linha das unidades e a da data da
 * virada antes dela, e um dia alguém acrescenta mais uma. Procurar pelo
 * conteúdo aguenta isso; contar linhas, não.
 */
export function linhaDoCabecalho(grade: string[][]): number {
  for (let i = 0; i < Math.min(grade.length, 12); i += 1) {
    const linha = (grade[i] ?? []).map((c) => chaveDeNome(c));
    if (PLANO_CABECALHO.every((rot, j) => linha[j] === chaveDeNome(rot))) return i;
  }
  return -1;
}

export interface DiagnosticoDaCarga {
  total: number;
  sem_area: number;
  sem_lider: number;
  sem_fim: number;
}

export interface LeituraDoPlano {
  acoes: AcaoDoPlano[];
  problemas: string[];
  ondas: Array<{ onda: number; lidas: number; go_live: string }>;
  diagnostico: DiagnosticoDaCarga;
}

/**
 * Lê as abas de onda do arquivo e devolve as ações mais o diagnóstico.
 *
 * Não grava nada: quem decide gravar é a rota, depois de o gestor ver o que
 * entraria. Uma carga que grava antes de mostrar é uma carga que não dá
 * chance de recusar.
 */
export async function lerPlanoDeAcao(buffer: Buffer): Promise<LeituraDoPlano> {
  const abas = await lerGradeXlsx(buffer);
  const daOnda = abas
    .map((a) => ({ aba: a, onda: numeroDaOnda(a.nome) }))
    .filter((x): x is { aba: typeof x.aba; onda: number } => x.onda !== null)
    .map((x) => ({ ...x, cabecalho: linhaDoCabecalho(x.aba.grade) }))
    .filter((x) => x.cabecalho >= 0);

  if (!daOnda.length) {
    // A recusa diz o que o arquivo precisaria ter. "Formato inválido" obrigaria
    // o gestor a adivinhar, e ele não tem como.
    throw erroValidacao(
      'Este arquivo não parece o Plano de Ação. Esperava abas chamadas "Onda 1", '
      + '"Onda 2"… e, dentro de cada uma, uma linha de cabeçalho com as colunas '
      + `${PLANO_CABECALHO.join(', ')}.`,
    );
  }

  const acoes: AcaoDoPlano[] = [];
  const problemas: string[] = [];
  const vistos = new Set<string>();
  const resumoOndas: Array<{ onda: number; lidas: number; go_live: string }> = [];

  for (const { aba, onda, cabecalho } of daOnda) {
    const grade = aba.grade;
    const cel = (linha: string[] | undefined, i: number) => String((linha ?? [])[i] ?? '').trim();

    // O topo da aba traz "Onda N • Go-live: d/m/aaaa • Unidades: ...". Ele é
    // LIDO e conferido contra o cronograma, não usado para sobrescrevê-lo: o
    // cronograma é código revisado, e uma planilha trocada por engano não
    // pode remontar as ondas sozinha.
    const titulo = grade.slice(0, cabecalho).flat().find((t) => /go-?live/i.test(String(t ?? ''))) ?? '';
    const goLive = dataISO((/go-?live:?\s*([\d/.-]+)/i.exec(String(titulo)) ?? [])[1] ?? '');
    const doCrono = ONDAS.find((o) => o.n === onda);
    if (goLive && doCrono && goLive !== doCrono.virada) {
      problemas.push(`Onda ${onda}: a planilha diz go-live em ${diaExib(goLive)} e o `
        + `cronograma do sistema, ${diaExib(doCrono.virada)}. Vale o cronograma; `
        + 'confira qual dos dois está desatualizado.');
    }
    if (!doCrono) {
      problemas.push(`Onda ${onda}: a planilha traz uma onda que o cronograma não tem. `
        + 'As ações entram, mas ela não aparece agrupada no painel.');
    }

    let lidas = 0;
    for (let i = cabecalho + 1; i < grade.length; i += 1) {
      const linha = grade[i];
      const n = cel(linha, 0);
      // Sem número não é ação: é linha de espaçamento ou rodapé.
      if (!n || !/^\d+$/.test(n)) continue;
      const tarefa = cel(linha, 1);
      if (!tarefa) {
        problemas.push(`Onda ${onda}, nº ${n}: sem descrição da tarefa — linha ignorada.`);
        continue;
      }
      // A identidade é onda + nº: é como o cliente numera, e é único dentro
      // da aba. Repetido é linha duplicada de fato, e das duas não há como
      // saber qual é a boa.
      const chave = `${onda}__${n}`;
      if (vistos.has(chave)) {
        problemas.push(`Onda ${onda}, nº ${n}: número repetido na aba — a segunda linha `
          + 'foi recusada, porque das duas não há como saber qual vale.');
        continue;
      }
      vistos.add(chave);

      const statusBruto = cel(linha, 7);
      const status = PLANO_STATUS.find((s) => chaveDeNome(s) === chaveDeNome(statusBruto)) ?? '';
      if (statusBruto && !status) {
        problemas.push(`Onda ${onda}, nº ${n}: status "${statusBruto}" não é um dos `
          + `conhecidos (${PLANO_STATUS.join(', ')}) — a ação entra como não iniciada.`);
      }
      const inicio = dataISO(cel(linha, 4));
      const fim = dataISO(cel(linha, 5));
      if (!fim) {
        problemas.push(`Onda ${onda}, nº ${n}: sem data de fim — entra com farol "Sem data", `
          + 'e fica de fora da contagem de prazo.');
      }
      if (inicio && fim && fim < inicio) {
        problemas.push(`Onda ${onda}, nº ${n}: a data de fim (${diaExib(fim)}) vem antes `
          + `do início (${diaExib(inicio)}).`);
      }

      acoes.push({
        onda,
        numero: Number(n),
        tarefa,
        area: cel(linha, 2),
        lider: cel(linha, 3),
        inicio: inicio || null,
        fim: fim || null,
        status: status || 'Não iniciado',
        link: cel(linha, 9),
        observacoes: cel(linha, 10),
        evolucoes: cel(linha, 11),
      });
      lidas += 1;
    }
    resumoOndas.push({ onda, lidas, go_live: goLive });
  }

  const vazio = (v: string) => !v || v === '-';
  return {
    acoes,
    problemas,
    ondas: resumoOndas,
    diagnostico: {
      total: acoes.length,
      sem_area: acoes.filter((a) => vazio(a.area)).length,
      sem_lider: acoes.filter((a) => vazio(a.lider)).length,
      sem_fim: acoes.filter((a) => !a.fim).length,
    },
  };
}
