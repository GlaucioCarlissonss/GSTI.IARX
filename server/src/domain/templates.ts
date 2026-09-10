/**
 * Templates de importação/exportação.
 *
 * O mesmo layout serve para importar e exportar — o que garante backup,
 * migração e reimportação sem perda. Cada versão declara os apelidos aceitos
 * para os cabeçalhos, de forma que planilhas antigas continuem importáveis
 * quando o template evoluir.
 */

export const TEMPLATE_VERSAO_ATUAL = '1.0';

export type NomeAba =
  | 'Filiais'
  | 'TiposDespesa'
  | 'Cenarios'
  | 'Financeiro'
  | 'Projetos'
  | 'Tarefas'
  | 'Envolvidos'
  | 'TopicosAjuda'
  | 'SLA';

export type Modulo = 'financeiro' | 'projetos' | 'sla' | 'completo';

export interface DefinicaoAba {
  colunas: string[];
  /** Apelidos aceitos no cabeçalho, por coluna canônica. */
  apelidos: Record<string, string[]>;
  obrigatorias: string[];
}

export const ABAS: Record<NomeAba, DefinicaoAba> = {
  Filiais: {
    colunas: ['Filial', 'Cidade', 'UF', 'Ativo'],
    apelidos: { Filial: ['nome', 'filial', 'nomefilial'] },
    obrigatorias: ['Filial'],
  },
  TiposDespesa: {
    colunas: ['Tipo de Despesa', 'Ativo'],
    apelidos: { 'Tipo de Despesa': ['nome', 'tipo', 'tipodespesa', 'tipodedespesa'] },
    obrigatorias: ['Tipo de Despesa'],
  },
  Cenarios: {
    colunas: ['Cenário', 'Nome', 'Descrição'],
    apelidos: {
      'Cenário': ['cenario', 'chave', 'chavecenario'],
      Nome: ['nome', 'nomecenario'],
      'Descrição': ['descricao'],
    },
    obrigatorias: ['Cenário'],
  },
  Financeiro: {
    colunas: [
      'Filial',
      'Tipo de Despesa',
      'Competência',
      'Valor',
      'Natureza',
      'Classificação',
      'Qtd Parcelas',
      'Parcela',
      'Grupo',
      'Cenário',
      'Descrição',
      'Observações',
    ],
    apelidos: {
      'Tipo de Despesa': ['tipo', 'tipodespesa', 'tipodedespesa'],
      Competência: ['competencia', 'mes', 'mesdecompetencia', 'mescompetencia', 'mesreferencia'],
      Valor: ['valor', 'valorrs', 'valorreais'],
      Classificação: ['classificacao', 'classificacaocontabil'],
      'Qtd Parcelas': ['qtdparcelas', 'quantidadeparcelas', 'parcelas', 'numeroparcelas'],
      Parcela: ['parcela', 'numeroparcela', 'parcelanumero'],
      Grupo: ['grupo', 'grupoparcelamento', 'referencia', 'referenciaexterna'],
      Cenário: ['cenario', 'cenarioprojecao'],
      Descrição: ['descricao'],
      Observações: ['observacoes', 'obs'],
    },
    obrigatorias: ['Tipo de Despesa', 'Competência', 'Valor', 'Natureza', 'Classificação'],
  },
  Projetos: {
    colunas: ['Projeto', 'Filial', 'Descrição', 'Mês Início', 'Mês Fim Planejado', 'Mês Fim Real', 'Status'],
    apelidos: {
      Projeto: ['projeto', 'nome', 'nomeprojeto'],
      'Mês Início': ['mesinicio', 'inicio', 'mesdeinicio'],
      'Mês Fim Planejado': ['mesfimplanejado', 'fimplanejado', 'terminoplanejado'],
      'Mês Fim Real': ['mesfimreal', 'fimreal', 'terminoreal'],
      Descrição: ['descricao'],
    },
    obrigatorias: ['Projeto', 'Mês Início', 'Mês Fim Planejado'],
  },
  Tarefas: {
    colunas: ['Projeto', 'Tarefa', 'Mês Início', 'Mês Fim Planejado', 'Mês Fim Real', 'Responsável', 'Status'],
    apelidos: {
      Projeto: ['projeto', 'nomeprojeto'],
      Tarefa: ['tarefa', 'nome', 'nometarefa'],
      'Mês Início': ['mesinicio', 'inicio'],
      'Mês Fim Planejado': ['mesfimplanejado', 'fimplanejado'],
      'Mês Fim Real': ['mesfimreal', 'fimreal'],
      Responsável: ['responsavel'],
    },
    obrigatorias: ['Projeto', 'Tarefa', 'Mês Início', 'Mês Fim Planejado'],
  },
  Envolvidos: {
    colunas: ['Projeto', 'Envolvido', 'Papel'],
    apelidos: { Projeto: ['projeto'], Envolvido: ['envolvido', 'nome'], Papel: ['papel', 'funcao'] },
    obrigatorias: ['Projeto', 'Envolvido'],
  },
  TopicosAjuda: {
    colunas: ['Tópico de Ajuda', 'Ativo'],
    apelidos: { 'Tópico de Ajuda': ['topicodeajuda', 'topico', 'topicoajuda', 'nome'] },
    obrigatorias: ['Tópico de Ajuda'],
  },
  SLA: {
    colunas: [
      'Filial',
      'Competência',
      'Fila',
      'Tópico de Ajuda',
      'Total Atendidos',
      'Dentro SLA',
      'Fora SLA',
      'Observações',
    ],
    apelidos: {
      Competência: ['competencia', 'mes', 'mescompetencia', 'mesreferencia'],
      Fila: ['fila', 'filaticket', 'filadoticket'],
      'Tópico de Ajuda': ['topicodeajuda', 'topico', 'topicoajuda'],
      'Total Atendidos': ['totalatendidos', 'total', 'atendidos'],
      'Dentro SLA': ['dentrosla', 'dentrodosla'],
      'Fora SLA': ['forasla', 'foradosla'],
      Observações: ['observacoes', 'obs'],
    },
    obrigatorias: ['Competência', 'Fila', 'Total Atendidos', 'Dentro SLA'],
  },
};

export const ABAS_POR_MODULO: Record<Modulo, NomeAba[]> = {
  financeiro: ['Filiais', 'TiposDespesa', 'Cenarios', 'Financeiro'],
  projetos: ['Projetos', 'Tarefas', 'Envolvidos'],
  sla: ['TopicosAjuda', 'SLA'],
  completo: [
    'Filiais',
    'TiposDespesa',
    'Cenarios',
    'Financeiro',
    'Projetos',
    'Tarefas',
    'Envolvidos',
    'TopicosAjuda',
    'SLA',
  ],
};

/** Chave canônica de cabeçalho: sem acento, sem pontuação, minúscula. */
export function normalizarCabecalho(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Mapeia as colunas presentes na planilha para as colunas canônicas da aba,
 * aceitando os apelidos declarados (compatibilidade entre versões).
 */
export function mapearColunas(aba: NomeAba, cabecalhoArquivo: string[]): Map<string, string> {
  const def = ABAS[aba];
  const mapa = new Map<string, string>();
  const disponiveis = new Map(cabecalhoArquivo.map((c) => [normalizarCabecalho(c), c]));
  for (const coluna of def.colunas) {
    const chaves = [normalizarCabecalho(coluna), ...(def.apelidos[coluna] ?? [])];
    for (const chave of chaves) {
      const encontrado = disponiveis.get(chave);
      if (encontrado) {
        mapa.set(coluna, encontrado);
        break;
      }
    }
  }
  return mapa;
}

export function colunasFaltantes(aba: NomeAba, mapa: Map<string, string>): string[] {
  return ABAS[aba].obrigatorias.filter((c) => !mapa.has(c));
}
