/**
 * Templates de importação/exportação.
 *
 * O mesmo layout serve para importar e exportar — o que garante backup,
 * migração e reimportação sem perda. Cada versão declara os apelidos aceitos
 * para os cabeçalhos, de forma que planilhas antigas continuem importáveis
 * quando o template evoluir.
 */

// 1.1 acrescentou a coluna Origem ao Financeiro;
// 1.2 acrescentou à aba SLA o detalhe do chamado (Ticket, Número, Assunto…);
// 1.3 acrescentou "Tarefa Principal" à aba Tarefas;
// 1.4 acrescentou "Empresa" a todas as abas, para que um arquivo só atenda
//     várias matrizes do mesmo cliente (ver COLUNA_EMPRESA, abaixo);
// 1.5 acrescentou "Tipo de Consumo" e "Filiais Beneficiadas" ao Financeiro,
//     para a planilha poder dizer quem CONSOME o que a filial paga. As duas
//     ficam fora das obrigatórias: um arquivo 1.4 continua entrando, e a
//     ausência da coluna preserva a classificação feita na tela.
export const TEMPLATE_VERSAO_ATUAL = '1.5';

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

const ABAS_BASE: Record<NomeAba, DefinicaoAba> = {
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
      'Origem',
      'Tipo de Consumo',
      'Filiais Beneficiadas',
      'Descrição',
      'Observações',
    ],
    apelidos: {
      'Tipo de Despesa': ['tipo', 'tipodespesa', 'tipodedespesa'],
      'Tipo de Consumo': ['tipoconsumo', 'consumo', 'tipodeconsumo', 'rateio'],
      'Filiais Beneficiadas': ['filiaisbeneficiadas', 'beneficiadas', 'filiaisbeneficiarias', 'beneficiarias'],
      Competência: ['competencia', 'mes', 'mesdecompetencia', 'mescompetencia', 'mesreferencia'],
      Valor: ['valor', 'valorrs', 'valorreais'],
      Classificação: ['classificacao', 'classificacaocontabil'],
      'Qtd Parcelas': ['qtdparcelas', 'quantidadeparcelas', 'parcelas', 'numeroparcelas'],
      Parcela: ['parcela', 'numeroparcela', 'parcelanumero'],
      Grupo: ['grupo', 'grupoparcelamento', 'referencia', 'referenciaexterna'],
      Cenário: ['cenario', 'cenarioprojecao'],
      Origem: ['origem', 'origemdodado', 'procedencia'],
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
    colunas: [
      'Projeto', 'Tarefa', 'Tarefa Principal', 'Mês Início', 'Mês Fim Planejado', 'Mês Fim Real', 'Responsável', 'Status',
    ],
    apelidos: {
      Projeto: ['projeto', 'nomeprojeto'],
      Tarefa: ['tarefa', 'nome', 'nometarefa'],
      // Pelo nome, que é o que se lê na planilha — id interno não ajuda quem edita.
      'Tarefa Principal': ['tarefaprincipal', 'tarefapai', 'pai', 'agrupadorpor', 'grupo'],
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
      // Detalhe do chamado: preenchido quando a linha é UM chamado do helpdesk,
      // vazio quando é o agregado mensal. `Ticket` é o id no sistema de origem.
      'Ticket',
      'Número',
      'Assunto',
      'Solicitante',
      'Responsável',
      'Nível',
      'Status',
      'Origem',
      'Aberto em',
      'Fechado em',
      'Prazo',
      'Horas',
      'Observações',
    ],
    apelidos: {
      Competência: ['competencia', 'mes', 'mescompetencia', 'mesreferencia'],
      Fila: ['fila', 'filaticket', 'filadoticket'],
      'Tópico de Ajuda': ['topicodeajuda', 'topico', 'topicoajuda'],
      'Total Atendidos': ['totalatendidos', 'total', 'atendidos'],
      'Dentro SLA': ['dentrosla', 'dentrodosla'],
      'Fora SLA': ['forasla', 'foradosla'],
      Ticket: ['ticket', 'ticketid', 'idticket', 'chamado', 'idchamado'],
      'Número': ['numero', 'numerodochamado', 'numerochamado'],
      Assunto: ['assunto', 'titulo'],
      Solicitante: ['solicitante', 'usuario', 'requerente'],
      'Responsável': ['responsavel', 'atendente', 'tecnico'],
      'Nível': ['nivel', 'departamento', 'equipe'],
      Status: ['status', 'situacao'],
      Origem: ['origem', 'origemchamado', 'canal', 'source'],
      'Aberto em': ['abertoem', 'aberturaem', 'abertura', 'criadoem', 'datadeabertura'],
      'Fechado em': ['fechadoem', 'fechamentoem', 'fechamento', 'datadefechamento'],
      Prazo: ['prazo', 'prazoem', 'vencimento', 'datadevencimento'],
      Horas: ['horas', 'tempoatendimento', 'horasatendimento'],
      Observações: ['observacoes', 'obs'],
    },
    obrigatorias: ['Competência', 'Fila', 'Total Atendidos', 'Dentro SLA'],
  },
};

/**
 * A coluna que diz de QUAL MATRIZ é a linha.
 *
 * Até a versão 1.3 o arquivo era de uma matriz só: quem importava escolhia a
 * unidade na tela e todas as linhas iam para ela. Com a operação passando a ser
 * do cliente inteiro, um arquivo com seis matrizes precisa dizer, linha a
 * linha, a quem cada uma pertence — e a `Filial` sozinha não resolve, porque
 * duas matrizes do mesmo cliente podem ter filial de mesmo nome.
 *
 * Ela entra em TODAS as abas e fica FORA de `obrigatorias`, de propósito: é o
 * que mantém os arquivos 1.3 importáveis. Vazia, a linha cai na unidade única
 * do escopo; se o escopo tiver várias, a carga é recusada pedindo a coluna.
 *
 * `grupo` NÃO entra como apelido: na aba Financeiro, "Grupo" já é o
 * identificador que liga as parcelas de uma compra.
 */
export const COLUNA_EMPRESA = 'Empresa';

const APELIDOS_EMPRESA = ['empresa', 'matriz', 'empresamatriz', 'grupoempresa', 'razaosocial', 'unidadematriz'];

export const ABAS: Record<NomeAba, DefinicaoAba> = Object.fromEntries(
  (Object.entries(ABAS_BASE) as Array<[NomeAba, DefinicaoAba]>).map(([nome, def]): [NomeAba, DefinicaoAba] => [
    nome,
    {
      ...def,
      colunas: [COLUNA_EMPRESA, ...def.colunas],
      apelidos: { ...def.apelidos, [COLUNA_EMPRESA]: APELIDOS_EMPRESA },
    },
  ]),
) as Record<NomeAba, DefinicaoAba>;

/** O nome da aba de instruções — reconhecido na leitura para não virar aviso. */
export const ABA_INSTRUCOES = 'Instruções';

/**
 * O que cada coluna espera, em português, para quem preenche à mão.
 *
 * Só as colunas cuja regra não se adivinha pelo nome entram aqui: formato de
 * competência, os valores aceitos de um campo fechado, o que é derivado. O
 * resto da aba de instruções sai da própria definição das abas, de modo que
 * planilha e explicação não têm como divergir.
 */
const NOTAS: Partial<Record<NomeAba, Record<string, string>>> = {
  Filiais: { Ativo: 'Sim/Não. Em branco entra como ativa.' },
  TiposDespesa: { Ativo: 'Sim/Não. Em branco entra como ativo.' },
  Cenarios: { 'Cenário': 'Chave curta e sem espaço (ex.: reducao2027). "oficial" é o cenário base e já existe.' },
  Financeiro: {
    'Competência': 'Mês de referência no formato MM/AAAA (ex.: 03/2026).',
    Valor: 'Em reais, com vírgula ou ponto decimal (1.234,56 ou 1234.56). Sem "R$".',
    Natureza: 'Fixa | Pontual única | Pontual parcelada.',
    'Classificação': 'Despesa | Investimento.',
    'Qtd Parcelas': 'Só para natureza parcelada. O sistema gera as parcelas seguintes e o resto do rateio vai nas primeiras.',
    Parcela: 'Número desta parcela dentro da série. Em branco, é a primeira.',
    Grupo: 'Identificador que liga as parcelas de uma mesma compra.',
    'Cenário': 'Em branco entra no cenário "oficial".',
    Origem: 'Procedência do dado (planilha, folha de TI, projeção). Não confundir com a origem do custo.',
    Filial: 'Em branco, o lançamento fica no nível empresa (consolidado).',
    'Tipo de Consumo':
      '100% da filial | Paga pela filial, beneficia outras. Em branco entra como 100% da filial. '
      + 'Coluna ausente no arquivo NÃO apaga a classificação já feita na tela.',
    'Filiais Beneficiadas':
      'Só para "beneficia outras": nomes das filiais separados por | (ex.: Filial Norte|Filial Oeste), '
      + 'ou a palavra Todas para todas as filiais do grupo do cliente. A lista é congelada na importação.',
  },
  Projetos: {
    'Mês Início': 'MM/AAAA.',
    'Mês Fim Planejado': 'MM/AAAA.',
    'Mês Fim Real': 'MM/AAAA. Em branco enquanto não terminou.',
    Status: 'Planejado | Em andamento | Concluído | Cancelado.',
  },
  Tarefas: {
    'Tarefa Principal': 'Nome de outra tarefa DO MESMO projeto, para aninhar até 3 níveis. Em branco, a tarefa é de primeiro nível.',
    'Mês Fim Real': 'MM/AAAA. O atraso é calculado a partir dele — nunca digitado.',
    Status: 'Pendente | Em andamento | Concluída | Cancelada.',
  },
  SLA: {
    'Competência': 'MM/AAAA.',
    'Total Atendidos': 'No agregado mensal, quantos chamados. Numa linha de chamado único, 1.',
    'Dentro SLA': 'Quantos dentro do prazo. Nunca maior que o total.',
    'Fora SLA': 'NÃO preencha: é sempre total − dentro, e é calculado na entrada.',
    Ticket: 'Id do chamado no helpdesk. Junto com a Origem, é o que evita duplicar ao reimportar.',
    Origem: 'OSTICK | BITRIX24, quando a linha é um chamado de helpdesk.',
    'Aberto em': 'dd/mm/aaaa hh:mm ou AAAA-MM-DDThh:mm.',
    'Fechado em': 'dd/mm/aaaa hh:mm. Em branco enquanto aberto.',
  },
};

export interface LinhaInstrucao extends Record<string, unknown> {
  Aba: string;
  Coluna: string;
  'Obrigatória': string;
  'O que preencher': string;
  'Também aceita como cabeçalho': string;
}

/** A aba de instruções do módulo, derivada da definição das abas. */
export function linhasDeInstrucoes(modulo: Modulo): LinhaInstrucao[] {
  const saida: LinhaInstrucao[] = [];
  for (const aba of ABAS_POR_MODULO[modulo]) {
    const def = ABAS[aba];
    for (const coluna of def.colunas) {
      saida.push({
        Aba: aba,
        Coluna: coluna,
        'Obrigatória': def.obrigatorias.includes(coluna) ? 'Sim' : 'Não',
        'O que preencher':
          coluna === COLUNA_EMPRESA
            ? 'Nome da empresa (matriz) a que a linha pertence. Em branco, vale a única unidade do escopo escolhido na tela; com várias no escopo, a coluna passa a ser exigida.'
            : (NOTAS[aba]?.[coluna] ?? ''),
        'Também aceita como cabeçalho': (def.apelidos[coluna] ?? []).join(', '),
      });
    }
  }
  return saida;
}

export const COLUNAS_INSTRUCOES = [
  'Aba',
  'Coluna',
  'Obrigatória',
  'O que preencher',
  'Também aceita como cabeçalho',
];

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
export function mapearColunas(
  aba: NomeAba,
  cabecalhoArquivo: string[],
  /** Apelidos do cliente, por coluna canônica — o adaptador da planilha dele. */
  extras: Record<string, string[]> = {},
): Map<string, string> {
  const def = ABAS[aba];
  const mapa = new Map<string, string>();
  const disponiveis = new Map(cabecalhoArquivo.map((c) => [normalizarCabecalho(c), c]));
  for (const coluna of def.colunas) {
    // O apelido do cliente vem ANTES dos fixos: ele foi cadastrado olhando o
    // arquivo real daquele contratante, e é o que descreve a planilha dele.
    const chaves = [
      ...(extras[coluna] ?? []).map(normalizarCabecalho),
      normalizarCabecalho(coluna),
      ...(def.apelidos[coluna] ?? []),
    ];
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
