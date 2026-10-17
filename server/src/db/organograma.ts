/**
 * Normalização do organograma das bases de origem.
 *
 * As planilhas usam duas convenções para a mesma unidade ("HR - NAT" nas bases
 * de jan–mai/2026 e "HR RN" a partir de jun/2026). Aqui elas convergem para um
 * único cadastro de filial por empresa.
 */

export interface Unidade {
  empresa: string;
  filial: string;
  cidade: string | null;
  uf: string | null;
}

/** Empresas (o campo GRUPO/GRP das bases). */
export const EMPRESAS = ['ALIANÇA', 'MILAGRES', 'MOOVE', 'RESIDENCIAL', 'UNION'] as const;

const UNIDADES: Unidade[] = [
  { empresa: 'ALIANÇA', filial: 'AHC RN', cidade: 'Natal', uf: 'RN' },
  { empresa: 'ALIANÇA', filial: 'AHC SE', cidade: null, uf: 'SE' },
  { empresa: 'MILAGRES', filial: 'HM AM', cidade: 'Manaus', uf: 'AM' },
  { empresa: 'MILAGRES', filial: 'HM CE', cidade: null, uf: 'CE' },
  { empresa: 'MILAGRES', filial: 'HM DF', cidade: 'Brasília', uf: 'DF' },
  { empresa: 'MILAGRES', filial: 'HM GO', cidade: null, uf: 'GO' },
  { empresa: 'MILAGRES', filial: 'HM MT', cidade: null, uf: 'MT' },
  { empresa: 'MILAGRES', filial: 'HM PB', cidade: null, uf: 'PB' },
  { empresa: 'MILAGRES', filial: 'HM RO', cidade: null, uf: 'RO' },
  { empresa: 'MOOVE', filial: 'MOOVE', cidade: null, uf: null },
  { empresa: 'RESIDENCIAL', filial: 'HR AL', cidade: 'Maceió', uf: 'AL' },
  { empresa: 'RESIDENCIAL', filial: 'HR BA', cidade: 'Salvador', uf: 'BA' },
  { empresa: 'RESIDENCIAL', filial: 'HR CG', cidade: 'Campina Grande', uf: 'PB' },
  { empresa: 'RESIDENCIAL', filial: 'HR JP', cidade: 'João Pessoa', uf: 'PB' },
  { empresa: 'RESIDENCIAL', filial: 'HR PE', cidade: 'Recife', uf: 'PE' },
  { empresa: 'RESIDENCIAL', filial: 'HR RN', cidade: 'Natal', uf: 'RN' },
  { empresa: 'UNION', filial: 'UC RJ', cidade: null, uf: 'RJ' },
  { empresa: 'UNION', filial: 'UC SP', cidade: null, uf: 'SP' },
];

/** Apelidos das bases antigas -> filial canônica. */
const APELIDOS: Record<string, string> = {
  'AHL - NAT': 'AHC RN',
  'AHC - SE': 'AHC SE',
  'HM - MAN': 'HM AM',
  'HM - CE': 'HM CE',
  'HM - BSB': 'HM DF',
  'HM - GO': 'HM GO',
  'HM - MT': 'HM MT',
  'HM - PB': 'HM PB',
  'HM - RO': 'HM RO',
  'MO - MOOVE': 'MOOVE',
  'HR - MAC': 'HR AL',
  'HR - SAL': 'HR BA',
  'HR - CG': 'HR CG',
  'HR - JP': 'HR JP',
  'HR - REC': 'HR PE',
  'HR - NAT': 'HR RN',
  'UC - RJ': 'UC RJ',
  'UC - SP': 'UC SP',
};

const PORNOME = new Map(UNIDADES.map((u) => [u.filial, u]));

export function listarUnidades(): Unidade[] {
  return UNIDADES;
}

export function resolverUnidade(bruto: string): Unidade | null {
  const limpo = bruto.trim().replace(/\s+/g, ' ').toUpperCase();
  const canonico = APELIDOS[limpo] ?? limpo;
  return PORNOME.get(canonico) ?? null;
}

/** Normaliza os nomes de centro de custo das bases para os tipos de despesa padrão. */
const TIPOS: Record<string, string> = {
  'EQUIPAMENTOS DE TI': 'Equipamentos de TI',
  'LICENCAS DE SOFTWARES': 'Licenças de Softwares',
  'LICENÇAS DE SOFTWARES': 'Licenças de Softwares',
  'LOCACAO DE IMPRESSORA': 'Locação de Impressora',
  'LOCAÇÃO DE IMPRESSORA': 'Locação de Impressora',
  'MATERIAIS DE TI': 'Materiais de TI',
  'SERVIÇOS TECNICOS': 'Serviços Técnicos',
  'SERVICOS TECNICOS': 'Serviços Técnicos',
  'SERVIÇOS TÉCNICOS': 'Serviços Técnicos',
  'TELEFONIA / INTERNET': 'Telefonia/Internet',
  'TELEFONIA/INTERNET': 'Telefonia/Internet',
  // Grafia com erro de digitação na base de origem
  'SERVIÇOS DE DESENCOLVIMENTO': 'Serviços de Desenvolvimento',
  'SERVICOS DE DESENCOLVIMENTO': 'Serviços de Desenvolvimento',
  'SERVIÇOS DE DESENVOLVIMENTO': 'Serviços de Desenvolvimento',
  'SISTEMAS GERENCIAIS': 'Sistemas Gerenciais',
  PESSOAS: 'Pessoas',
};

export function normalizarTipoDespesa(bruto: string): string {
  const limpo = bruto.trim().replace(/\s+/g, ' ');
  return TIPOS[limpo.toUpperCase()] ?? limpo;
}

/**
 * As bases não trazem classificação contábil nem distinguem aquisição pontual
 * de recorrência. Estas são as regras de enquadramento da carga inicial —
 * qualquer lançamento pode ser reclassificado depois pelo gestor.
 */
export function enquadrar(
  tipoDespesa: string,
  tipoOrigem: string,
): { natureza: 'fixa' | 'pontual_unica'; classificacao: 'despesa' | 'investimento' } {
  const pontual = tipoOrigem.trim().toUpperCase() !== 'FIXO';
  if (tipoDespesa === 'Equipamentos de TI') {
    return { natureza: 'pontual_unica', classificacao: 'investimento' };
  }
  if (tipoDespesa === 'Materiais de TI') {
    return { natureza: 'pontual_unica', classificacao: 'despesa' };
  }
  return { natureza: pontual ? 'pontual_unica' : 'fixa', classificacao: 'despesa' };
}

/** Competências das bases: "Jan_26", "Maio_26", "Ago_26" ou uma data. */
const MESES: Record<string, string> = {
  JAN: '01', FEV: '02', MAR: '03', ABR: '04', ABRIL: '04', MAI: '05', MAIO: '05',
  JUN: '06', JUNHO: '06', JUL: '07', JULHO: '07', AGO: '08', AGOSTO: '08',
  SET: '09', SETEMBRO: '09', OUT: '10', OUTUBRO: '10', NOV: '11', NOVEMBRO: '11', DEZ: '12', DEZEMBRO: '12',
};

export function normalizarCompetencia(bruto: unknown): string | null {
  if (bruto instanceof Date) {
    return `${String(bruto.getUTCMonth() + 1).padStart(2, '0')}/${bruto.getUTCFullYear()}`;
  }
  const texto = String(bruto ?? '').trim();
  if (!texto) return null;

  const mmaaaa = /^(0[1-9]|1[0-2])\/(\d{4})$/.exec(texto);
  if (mmaaaa) return texto;

  const iso = /^(\d{4})-(\d{2})-\d{2}/.exec(texto);
  if (iso) return `${iso[2]}/${iso[1]}`;

  const abreviado = /^([A-Za-zçÇ]+)[_\-/ ](\d{2,4})$/.exec(texto);
  if (abreviado) {
    const mes = MESES[abreviado[1]!.toUpperCase()];
    if (!mes) return null;
    const ano = abreviado[2]!.length === 2 ? `20${abreviado[2]}` : abreviado[2]!;
    return `${mes}/${ano}`;
  }
  return null;
}
