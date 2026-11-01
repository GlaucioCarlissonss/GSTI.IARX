/**
 * A CARGA DO CONTROLE ÚNICO a partir da planilha do cliente.
 *
 * Mesma leitura que `artifact/app-js21.js` faz no navegador, e pelas mesmas
 * razões — as duas superfícies têm de recusar o mesmo arquivo e aceitar o
 * mesmo, ou o gestor que importa pelo celular e confere pelo navegador verá
 * dois controles diferentes.
 *
 * NADA É INVENTADO. Campo vazio continua vazio e é CONTADO no diagnóstico: é
 * a diferença entre uma carga que informa o que falta e uma que preenche o
 * buraco com um palpite indistinguível do dado real.
 *
 * AS OITO COLUNAS CALCULADAS DA PLANILHA SÃO DESCARTADAS. Status consolidado,
 * avanço, peso, farol — todas foram calculadas contra o dia em que alguém
 * abriu o arquivo, e gravá-las faria o painel envelhecer em silêncio.
 */
import { lerGradeXlsx } from '../lib/planilha.js';
import { erroValidacao } from '../lib/erros.js';
import { SITUACOES, UNIDADES } from './spincare.js';
import type { AtividadeDoControle } from './spincare.js';

/** Sem acento, sem caixa, sem espaço dobrado — para casar rótulo com rótulo. */
const chaveDeNome = (s: unknown): string => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

/** As colunas da planilha, pela LETRA — o cabeçalho está na linha 2. */
const COLUNAS = {
  id_origem: 'A', fonte: 'B', grupo_time: 'C', frente: 'D', replicavel: 'E', atividade: 'F',
  tipo_entrega: 'G', caminho: 'I', criticidade: 'J', lider: 'K', executante: 'L',
  data_base_onda: 'M', prazo_repactuado: 'AD', pendencia: 'AX', proxima_acao: 'AY',
  evidencia: 'AZ', criterio_especifico: 'BA', observacoes: 'BB',
} as const;

const COL_PRAZO = ['N', 'P', 'R', 'T', 'V', 'X', 'Z', 'AB'];
const COL_SITUACAO = ['O', 'Q', 'S', 'U', 'W', 'Y', 'AA', 'AC'];
const COL_UNIDADE = ['AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN'];

/** 'AE' → 30. O índice da coluna na grade, a partir de zero. */
export function indiceDaColuna(letras: string): number {
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Data da planilha → ISO.
 *
 * O Excel guarda data como número de dias desde 30/12/1899, e o leitor pode
 * devolver a célula crua. Texto em DD/MM/AAAA também aparece quando alguém
 * digita à mão. Qualquer outra coisa volta vazia, em vez de virar uma data
 * inventada.
 */
export function dataISO(bruto: unknown): string {
  const v = String(bruto ?? '').trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (br) return `${br[3]}-${br[2]!.padStart(2, '0')}-${br[1]!.padStart(2, '0')}`;
  const n = Number(v);
  // A faixa exclui números que não são data: 20000 é 1954 e 80000 é 2119.
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
  }
  return '';
}

/** A situação, casada sem depender de acento nem de caixa. */
export function situacaoDe(bruto: unknown): string {
  const chave = chaveDeNome(bruto);
  if (!chave) return '';
  return (SITUACOES as readonly string[]).find((s) => chaveDeNome(s) === chave)
    || String(bruto).trim();
}

export interface ProblemaDaCarga {
  linha: number;
  id: string;
  tipo: 'erro' | 'aviso';
  texto: string;
}

export interface LeituraDoControle {
  atividades: AtividadeDoControle[];
  problemas: ProblemaDaCarga[];
  diagnostico: {
    total: number;
    sem_executante: number;
    sem_caminho: number;
    sem_criticidade: number;
    unidades_sem_coluna: number;
  };
}

/**
 * Lê a aba "Controle Mestre" e devolve as atividades mais o diagnóstico.
 *
 * Não grava nada: quem decide gravar é a rota, depois de o gestor ver o que
 * entraria. Uma carga que grava antes de mostrar é uma carga que não dá chance
 * de recusar.
 */
export async function lerControleUnico(buffer: Buffer): Promise<LeituraDoControle> {
  const abas = await lerGradeXlsx(buffer);
  const aba = abas.find((a) => chaveDeNome(a.nome) === chaveDeNome('Controle Mestre'));
  if (!aba) {
    // A recusa diz o que o arquivo precisaria ter. "Formato inválido"
    // obrigaria o gestor a adivinhar, e ele não tem como.
    throw erroValidacao(
      'Este arquivo não parece o Controle Único: falta a aba "Controle Mestre". '
      + `Abas encontradas: ${abas.map((a) => a.nome).join(', ') || '(nenhuma)'}.`,
    );
  }

  const grade = aba.grade;
  const cel = (linha: string[] | undefined, letra: string) => {
    const v = (linha ?? [])[indiceDaColuna(letra)];
    return v == null ? '' : String(v).trim();
  };
  const cabecalho = grade[1] ?? [];
  if (cel(cabecalho, 'A') !== 'ID' || cel(cabecalho, 'F') !== 'Atividade') {
    throw erroValidacao(
      'A aba "Controle Mestre" não tem o cabeçalho esperado na linha 2 (esperado "ID" na '
      + 'coluna A e "Atividade" na coluna F). Confira se o arquivo é o Controle Único.',
    );
  }

  const atividades: AtividadeDoControle[] = [];
  const problemas: ProblemaDaCarga[] = [];
  // O ID da planilha NÃO é único: um mesmo ID nomeia atividades distintas. Ele
  // é o rótulo do cliente, e a identidade do sistema não pode depender dele
  // sozinho — recusar a segunda linha perderia uma atividade de verdade. A
  // chave interna ganha `#2`, `#3`…, e o ID continua aparecendo como veio.
  const repeticoes = new Map<string, number>();

  for (let i = 2; i < grade.length; i += 1) {
    const linha = grade[i];
    const nLinha = i + 1;
    const id = cel(linha, 'A');
    const atividade = cel(linha, 'F');
    if (!id && !atividade) continue;

    if (!atividade) {
      problemas.push({ linha: nLinha, id, tipo: 'erro',
        texto: 'Linha sem o nome da atividade (coluna F). Recusada.' });
      continue;
    }

    const repeticao = (repeticoes.get(id) ?? 0) + 1;
    repeticoes.set(id, repeticao);
    if (repeticao > 1) {
      problemas.push({ linha: nLinha, id, tipo: 'aviso',
        texto: `O ID "${id}" nomeia mais de uma atividade na planilha. As duas foram mantidas; `
          + 'convém dar um ID próprio a cada uma na origem.' });
    }

    const a: AtividadeDoControle = {
      id_origem: id,
      chave: repeticao > 1 ? `${id}#${repeticao}` : id,
      fonte: cel(linha, COLUNAS.fonte),
      grupo_time: cel(linha, COLUNAS.grupo_time),
      frente: cel(linha, COLUNAS.frente),
      replicavel: cel(linha, COLUNAS.replicavel),
      atividade,
      tipo_entrega: cel(linha, COLUNAS.tipo_entrega),
      caminho: cel(linha, COLUNAS.caminho),
      criticidade: cel(linha, COLUNAS.criticidade),
      lider: cel(linha, COLUNAS.lider),
      executante: cel(linha, COLUNAS.executante),
      data_base_onda: dataISO(cel(linha, COLUNAS.data_base_onda)) || null,
      prazo_repactuado: dataISO(cel(linha, COLUNAS.prazo_repactuado)) || null,
      pendencia: cel(linha, COLUNAS.pendencia),
      proxima_acao: cel(linha, COLUNAS.proxima_acao),
      evidencia: cel(linha, COLUNAS.evidencia),
      criterio_especifico: cel(linha, COLUNAS.criterio_especifico),
      observacoes: cel(linha, COLUNAS.observacoes),
      unidades: {},
      ondas: {},
    };

    for (let o = 0; o < COL_PRAZO.length; o += 1) {
      const prazo = dataISO(cel(linha, COL_PRAZO[o]!));
      const situacao = situacaoDe(cel(linha, COL_SITUACAO[o]!));
      if (prazo || situacao) {
        a.ondas[String(o + 1)] = { ...(prazo ? { prazo } : {}), ...(situacao ? { situacao } : {}) };
      }
    }

    COL_UNIDADE.forEach((letra, idx) => {
      const bruto = cel(linha, letra);
      if (!bruto) return;
      const s = situacaoDe(bruto);
      const unidade = UNIDADES[idx];
      if (!unidade) return;
      if (!(SITUACOES as readonly string[]).includes(s)) {
        // O valor entra COMO VEIO. Descartá-lo perderia o que a planilha diz;
        // traduzi-lo inventaria uma situação que ninguém escreveu.
        problemas.push({ linha: nLinha, id, tipo: 'aviso',
          texto: `Situação não reconhecida em ${unidade.rotulo}: "${bruto}". `
            + `Valores aceitos: ${SITUACOES.join(', ')}. O valor foi guardado como veio.` });
      }
      a.unidades[unidade.chave] = s;
    });

    if (!a.criticidade) {
      problemas.push({ linha: nLinha, id, tipo: 'aviso',
        texto: 'Sem criticidade: a atividade entra, mas fica fora do avanço ponderado.' });
    }

    atividades.push(a);
  }

  const vazio = (v: string) => !v || v === '-';
  const comColuna = new Set<string>();
  for (const a of atividades) for (const k of Object.keys(a.unidades)) comColuna.add(k);
  return {
    atividades,
    problemas,
    diagnostico: {
      total: atividades.length,
      sem_executante: atividades.filter((a) => vazio(a.executante)).length,
      sem_caminho: atividades.filter((a) => vazio(a.caminho)).length,
      sem_criticidade: atividades.filter((a) => vazio(a.criticidade)).length,
      // As unidades do cronograma que a planilha ainda não acompanha. Elas não
      // estão atrasadas: a planilha ainda não pergunta por elas.
      unidades_sem_coluna: UNIDADES.filter((u) => u.onda && !comColuna.has(u.chave)).length,
    },
  };
}
