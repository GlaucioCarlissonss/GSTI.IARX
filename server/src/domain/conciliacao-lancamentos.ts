/**
 * CONCILIAÇÃO DE LANÇAMENTOS — o que a carga tem que a base já tem.
 *
 * A conciliação que já existia (`conciliacao.ts`) confere DIMENSÕES: se
 * "NATAL HOME" é a filial "HR RN", se "Licencas de Softwares" é o centro de
 * custo cadastrado. Ela não olha o lançamento em si.
 *
 * Esta olha. E existe por um número: das 1.148 linhas da carga de Contas a
 * Pagar, 1.125 encontram par de competência e valor entre os 1.898
 * lançamentos que a base já tem. São a MESMA despesa, exportada por outro
 * relatório do mesmo ERP. Importar sem conciliar dobraria a base do cliente,
 * e o `dedup_hash` não salva: ele foi montado com as colunas do layout FOC,
 * que este arquivo não tem.
 *
 * O PAREAMENTO é por grupo homogêneo, em ordem:
 *
 *   grupo = (matriz, filial, competência, valor, centro de custo)
 *
 * Dentro do grupo, cada linha da carga consome um lançamento da base. Quando
 * o número do documento casa, o par é esse — é a única identidade forte que
 * existe. Sem documento na base (o caso de TODOS os 1.898 lançamentos hoje),
 * o par é por ordem, e o relatório mostra o grupo inteiro para conferência.
 *
 * NÃO existe a classe "ambíguo" que um desenho mais tímido teria: como a base
 * não tem documento em nenhuma linha, ela marcaria mil linhas e não ajudaria
 * ninguém a decidir nada. O que a tela mostra, em vez disso, é o par formado
 * — e as SOBRAS dos dois lados, que é a informação que falta de verdade:
 * lançamento que está na base e não veio na carga costuma ser lançamento
 * manual, e some sem aviso num "substituir tudo".
 */
import { db } from '../db/index.js';

export type ClasseLinha = 'igual' | 'atualiza' | 'novo';

/** A linha da carga depois que unidade e centro de custo viraram id. */
export interface LinhaResolvida {
  linha: number;
  empresaId: number;
  filialId: number | null;
  tipoDespesaId: number;
  competencia: string;
  valorCentavos: number;
  descricao: string;
  documento: string;
  fornecedor: string;
  dataPagamento: string | null;
  usuarioOrigem: string;
  reconhecido: boolean;
}

export interface ItemConciliado {
  linha: number;
  classe: ClasseLinha;
  /** O lançamento pareado, quando há. */
  lancamentoId: number | null;
  /** Que campos mudariam, para a tela poder mostrar antes de gravar. */
  diferencas: string[];
  /** Como o par foi formado: pelo documento, ou pela ordem dentro do grupo. */
  pareadoPor: 'documento' | 'ordem' | null;
}

export interface SobraDaBase {
  lancamentoId: number;
  competencia: string;
  valorCentavos: number;
  descricao: string | null;
}

export interface AnaliseLancamentos {
  total: number;
  igual: number;
  atualiza: number;
  novo: number;
  /** Pares formados por ordem, sem documento para confirmar. */
  pareados_por_ordem: number;
  itens: ItemConciliado[];
  /** Na base, dentro das competências da carga, e sem par nela. */
  sobras_na_base: SobraDaBase[];
}

interface Candidato {
  id: number;
  documento: string | null;
  descricao: string | null;
  fornecedor: string | null;
  data_pagamento: string | null;
  usuario_origem: string | null;
  reconhecido: number;
  competencia: string;
  valor_centavos: number;
  consumido?: boolean;
}

const chaveDoGrupo = (l: {
  empresaId: number;
  filialId: number | null;
  competencia: string;
  valorCentavos: number;
  tipoDespesaId: number;
}) => [l.empresaId, l.filialId ?? 0, l.competencia, l.valorCentavos, l.tipoDespesaId].join('|');

/** Vazio e nulo são a mesma ausência; comparar sem isso acusa diferença que não há. */
const igual = (a: unknown, b: unknown) => String(a ?? '').trim() === String(b ?? '').trim();

/**
 * Confronta a carga com a base, sem gravar nada.
 *
 * As competências consultadas são só as que a carga cobre: varrer a base
 * inteira traria lançamentos de meses que esta carga nem menciona, e a
 * contagem de sobras acusaria falta onde não há.
 */
export function conciliarLancamentos(clienteId: number, linhas: LinhaResolvida[]): AnaliseLancamentos {
  const competencias = [...new Set(linhas.map((l) => l.competencia))];
  const grupos = new Map<string, Candidato[]>();

  if (competencias.length) {
    const marcas = competencias.map(() => '?').join(',');
    const candidatos = db()
      .prepare(
        `SELECT id, empresa_id, filial_id, tipo_despesa_id, competencia, valor_centavos,
                documento, descricao, fornecedor, data_pagamento, usuario_origem, reconhecido
           FROM lancamentos
          WHERE cliente_id = ? AND excluido_em IS NULL AND competencia IN (${marcas})
          ORDER BY id`,
      )
      .all(clienteId, ...competencias) as Array<Candidato & { empresa_id: number; filial_id: number | null; tipo_despesa_id: number }>;

    for (const c of candidatos) {
      const chave = chaveDoGrupo({
        empresaId: c.empresa_id,
        filialId: c.filial_id,
        competencia: c.competencia,
        valorCentavos: c.valor_centavos,
        tipoDespesaId: c.tipo_despesa_id,
      });
      const lista = grupos.get(chave) ?? [];
      lista.push(c);
      grupos.set(chave, lista);
    }
  }

  const itens: ItemConciliado[] = [];
  let pareadosPorOrdem = 0;

  for (const l of linhas) {
    const grupo = grupos.get(chaveDoGrupo(l)) ?? [];
    const livres = grupo.filter((c) => !c.consumido);

    // O documento é a única identidade forte. Quando ele casa, o par é esse,
    // independentemente da ordem.
    let par = l.documento ? livres.find((c) => igual(c.documento, l.documento)) : undefined;
    let pareadoPor: ItemConciliado['pareadoPor'] = par ? 'documento' : null;

    if (!par) {
      // Sem casar por documento: só pareia com quem AINDA não tem documento.
      // Um candidato com documento diferente é outra cobrança do mesmo valor —
      // os cinco boletos da VIVO no mesmo dia são cinco despesas, não uma.
      par = livres.find((c) => !String(c.documento ?? '').trim());
      if (par) {
        pareadoPor = 'ordem';
        pareadosPorOrdem += 1;
      }
    }

    if (!par) {
      itens.push({ linha: l.linha, classe: 'novo', lancamentoId: null, diferencas: [], pareadoPor: null });
      continue;
    }

    par.consumido = true;
    const diferencas: string[] = [];
    if (!igual(par.documento, l.documento) && l.documento) diferencas.push('documento');
    if (!igual(par.descricao, l.descricao) && l.descricao) diferencas.push('descricao');
    if (!igual(par.fornecedor, l.fornecedor) && l.fornecedor) diferencas.push('fornecedor');
    if (!igual(par.data_pagamento, l.dataPagamento) && l.dataPagamento) diferencas.push('data_pagamento');
    if (!igual(par.usuario_origem, l.usuarioOrigem) && l.usuarioOrigem) diferencas.push('usuario_origem');
    if (l.reconhecido && par.reconhecido !== 1) diferencas.push('reconhecido');

    itens.push({
      linha: l.linha,
      classe: diferencas.length ? 'atualiza' : 'igual',
      lancamentoId: par.id,
      diferencas,
      pareadoPor,
    });
  }

  const sobras: SobraDaBase[] = [];
  for (const grupo of grupos.values()) {
    for (const c of grupo) {
      if (!c.consumido) {
        sobras.push({
          lancamentoId: c.id,
          competencia: c.competencia,
          valorCentavos: c.valor_centavos,
          descricao: c.descricao,
        });
      }
    }
  }

  return {
    total: linhas.length,
    igual: itens.filter((i) => i.classe === 'igual').length,
    atualiza: itens.filter((i) => i.classe === 'atualiza').length,
    novo: itens.filter((i) => i.classe === 'novo').length,
    pareados_por_ordem: pareadosPorOrdem,
    itens,
    sobras_na_base: sobras,
  };
}
