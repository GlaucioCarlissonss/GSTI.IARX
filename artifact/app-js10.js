// ===========================================================================
// Importação e exportação — o mesmo modelo serve para os dois lados, de forma
// que exportar, editar no Excel e reimportar não perca nada nem duplique.
//
// Layout idêntico ao da versão local (server/src/domain/templates.ts), com uma
// coluna a mais: Origem. Sem ela a reimportação apagaria a procedência que a
// aba Conferência usa, e o rateio de folha viraria linha de planilha.
// ===========================================================================
// 1.3 acrescentou "Empresa" a todas as abas de dado, para que um arquivo só
//     atenda várias matrizes do mesmo cliente (ver COLUNA_EMPRESA, abaixo);
// 1.5 acrescentou "Tipo de Consumo" e "Filiais Beneficiadas" ao Financeiro,
//     para a planilha poder dizer quem CONSOME o que a filial paga. Fora das
//     obrigatórias: um arquivo anterior continua entrando igual. A numeração
//     acompanha a do servidor, que é quem o cliente vê na aba Modelo.
const MODELO_VERSAO = '1.6';

/**
 * A coluna que diz de QUAL MATRIZ é a linha.
 *
 * Até a 1.2 o arquivo era de uma matriz só: quem importava escolhia a unidade e
 * todas as linhas iam para ela. Com a operação passando a ser do cliente
 * inteiro, um arquivo com seis matrizes precisa dizer, linha a linha, a quem
 * cada uma pertence — e a Filial sozinha não resolve, porque duas matrizes do
 * mesmo cliente podem ter filial de mesmo nome.
 *
 * Fica FORA de `obrigatorias` de propósito: é o que mantém importável o arquivo
 * gerado antes. Vazia, a linha cai na unidade única do escopo; com várias no
 * escopo, a carga é recusada pedindo a coluna.
 *
 * `grupo` NÃO entra como apelido: na aba Financeiro, "Grupo" já é o
 * identificador que liga as parcelas de uma compra.
 */
const COLUNA_EMPRESA = 'Empresa';
const APELIDOS_EMPRESA = ['empresa', 'matriz', 'empresamatriz', 'grupoempresa', 'razaosocial', 'unidadematriz'];

const ABAS_MODELO_BASE = {
  Modelo: { colunas: ['Chave', 'Valor'], obrigatorias: [], apelidos: {} },
  Filiais: {
    colunas: ['Filial', 'Cidade', 'UF', 'Ativo'],
    obrigatorias: ['Filial'], apelidos: { Filial: ['nome', 'filial', 'nomefilial'] },
  },
  TiposDespesa: {
    colunas: ['Tipo de Despesa', 'Ativo'],
    obrigatorias: ['Tipo de Despesa'],
    apelidos: { 'Tipo de Despesa': ['nome', 'tipo', 'tipodespesa', 'tipodedespesa'] },
  },
  Cenarios: {
    colunas: ['Cenário', 'Nome', 'Descrição'],
    obrigatorias: ['Cenário'],
    apelidos: { 'Cenário': ['cenario', 'chave', 'chavecenario'], Nome: ['nome', 'nomecenario'], 'Descrição': ['descricao'] },
  },
  Financeiro: {
    colunas: ['Filial', 'Tipo de Despesa', 'Competência', 'Valor', 'Natureza', 'Classificação',
      'Qtd Parcelas', 'Parcela', 'Grupo', 'Cenário', 'Origem', 'Tipo de Consumo', 'Filiais Beneficiadas',
      'Fornecedor', 'Descrição', 'Observações'],
    obrigatorias: ['Tipo de Despesa', 'Competência', 'Valor', 'Natureza', 'Classificação'],
    apelidos: {
      'Tipo de Despesa': ['tipo', 'tipodespesa', 'tipodedespesa', 'centrocusto', 'centrodecusto'],
      'Competência': ['competencia', 'mes', 'mesdecompetencia', 'mescompetencia', 'mesreferencia'],
      Valor: ['valor', 'valorrs', 'valorreais'],
      'Classificação': ['classificacao', 'classificacaocontabil'],
      'Qtd Parcelas': ['qtdparcelas', 'quantidadeparcelas', 'parcelas', 'numeroparcelas'],
      Parcela: ['parcela', 'numeroparcela', 'parcelanumero'],
      Grupo: ['grupo', 'grupoparcelamento', 'referencia', 'referenciaexterna'],
      'Cenário': ['cenario', 'cenarioprojecao'],
      Origem: ['origem', 'origemdodado', 'procedencia'],
      'Tipo de Consumo': ['tipoconsumo', 'consumo', 'tipodeconsumo', 'rateio'],
      'Filiais Beneficiadas': ['filiaisbeneficiadas', 'beneficiadas', 'filiaisbeneficiarias', 'beneficiarias'],
      'Descrição': ['descricao', 'historico'],
      'Observações': ['observacoes', 'obs'],
      'Fornecedor': ['fornecedor', 'favorecido', 'credor', 'beneficiario', 'razaosocial'],
      Filial: ['filial', 'unidade'],
    },
  },
  Projetos: {
    colunas: ['Projeto', 'Filial', 'Descrição', 'Mês Início', 'Mês Fim Planejado', 'Mês Fim Real', 'Status'],
    obrigatorias: ['Projeto', 'Mês Início', 'Mês Fim Planejado'],
    apelidos: { Projeto: ['projeto', 'nome', 'nomeprojeto'], 'Mês Início': ['mesinicio', 'inicio', 'mesdeinicio'],
      'Mês Fim Planejado': ['mesfimplanejado', 'fimplanejado', 'terminoplanejado'],
      'Mês Fim Real': ['mesfimreal', 'fimreal', 'terminoreal'], 'Descrição': ['descricao'] },
  },
  Tarefas: {
    colunas: ['Projeto', 'Tarefa', 'Mês Início', 'Mês Fim Planejado', 'Mês Fim Real', 'Responsável', 'Status'],
    obrigatorias: ['Projeto', 'Tarefa', 'Mês Início', 'Mês Fim Planejado'],
    apelidos: { Projeto: ['projeto', 'nomeprojeto'], Tarefa: ['tarefa', 'nome', 'nometarefa'],
      'Mês Início': ['mesinicio', 'inicio'], 'Mês Fim Planejado': ['mesfimplanejado', 'fimplanejado'],
      'Mês Fim Real': ['mesfimreal', 'fimreal'], 'Responsável': ['responsavel'] },
  },
  Envolvidos: {
    colunas: ['Projeto', 'Envolvido', 'Papel'], obrigatorias: ['Projeto', 'Envolvido'],
    apelidos: { Projeto: ['projeto'], Envolvido: ['envolvido', 'nome'], Papel: ['papel', 'funcao'] },
  },
  SLA: {
    // Um chamado é um registro com Total 1; as colunas de detalhe só vêm
    // preenchidas quando a linha veio do osTicket, e é o Ticket que permite
    // voltar ao chamado de origem.
    colunas: ['Filial', 'Competência', 'Fila', 'Tópico de Ajuda', 'Total Atendidos', 'Dentro SLA', 'Fora SLA',
      'Ticket', 'Número', 'Assunto', 'Solicitante', 'Responsável', 'Nível', 'Prioridade', 'Status', 'Origem',
      'Aberto em', 'Fechado em', 'Prazo', 'Horas', 'Observações'],
    obrigatorias: ['Competência', 'Fila', 'Total Atendidos', 'Dentro SLA'],
    apelidos: { 'Competência': ['competencia', 'mes', 'mescompetencia', 'mesreferencia'],
      Fila: ['fila', 'filaticket', 'filadoticket'], 'Tópico de Ajuda': ['topicodeajuda', 'topico', 'topicoajuda'],
      'Total Atendidos': ['totalatendidos', 'total', 'atendidos'], 'Dentro SLA': ['dentrosla', 'dentrodosla'],
      'Fora SLA': ['forasla', 'foradosla'], 'Observações': ['observacoes', 'obs'],
      Ticket: ['ticket', 'ticketid', 'idchamado', 'idticket'], 'Número': ['numero', 'numerochamado', 'number'],
      Assunto: ['assunto', 'subject'], Solicitante: ['solicitante'], 'Responsável': ['responsavel', 'atendente'],
      'Nível': ['nivel', 'departamento'], Status: ['status'], Origem: ['origem', 'source'],
      // A prioridade é o que casa o chamado com o acordo de SLA cadastrado.
      // Sem esta coluna, o acordo não alcança chamado nenhum vindo de planilha.
      Prioridade: ['prioridade', 'priority', 'urgencia'],
      'Aberto em': ['abertoem', 'criadoem', 'created'], 'Fechado em': ['fechadoem', 'closed'],
      Prazo: ['prazo', 'prazoem', 'duedate', 'estduedate'], Horas: ['horas'] },
  },
};

// A coluna Empresa entra em todas as abas de dado. A aba `Modelo` fica de fora:
// ela é o cabeçalho do arquivo, não uma tabela de linhas.
const ABAS_MODELO = Object.fromEntries(
  Object.entries(ABAS_MODELO_BASE).map(([nome, def]) =>
    nome === 'Modelo'
      ? [nome, def]
      : [nome, {
          ...def,
          colunas: [COLUNA_EMPRESA, ...def.colunas],
          apelidos: { ...def.apelidos, [COLUNA_EMPRESA]: APELIDOS_EMPRESA },
        }],
  ),
);

const MODULOS = {
  completo:   { rotulo:'Completo',   abas:['Modelo','Filiais','TiposDespesa','Cenarios','Financeiro','Projetos','Tarefas','Envolvidos','SLA'] },
  financeiro: { rotulo:'Financeiro', abas:['Modelo','Filiais','TiposDespesa','Cenarios','Financeiro'] },
  projetos:   { rotulo:'Projetos',   abas:['Modelo','Projetos','Tarefas','Envolvidos'] },
  sla:        { rotulo:'SLA',        abas:['Modelo','SLA'] },
};

/** Chave canônica de cabeçalho: sem acento, sem pontuação, minúscula. */
const normalizarCabecalho = (t) => String(t || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Mapeia cabeçalho do arquivo para as colunas canônicas, aceitando apelidos. */
function mapearColunas(aba, cabecalho, extras) {
  const def = ABAS_MODELO[aba], mapa = new Map();
  const doCliente = extras || apelidosDoCliente(E.clienteSel, aba);
  const disponiveis = new Map(cabecalho.map((c) => [normalizarCabecalho(c), c]));
  for (const coluna of def.colunas) {
    // O apelido do cliente vem ANTES dos fixos: ele foi cadastrado olhando o
    // arquivo real daquele contratante, e é o que descreve a planilha dele.
    const doDono = (doCliente[coluna] || []).map(normalizarCabecalho);
    for (const chave of [...doDono, normalizarCabecalho(coluna), ...(def.apelidos[coluna] || [])]) {
      const achado = disponiveis.get(chave);
      if (achado) { mapa.set(coluna, achado); break; }
    }
  }
  return mapa;
}

// ------------------------------------------------------------ interpretação
/** Aceita 1.234,56 · 1,234.56 · 1234.56 · R$ 1.234,56 · (1.234,56) negativo. */
function lerValorPlanilha(texto) {
  let t = String(texto ?? '').trim().replace(/^R\$\s*/i, '');
  if (!t) return null;
  let sinal = 1;
  if (/^\(.*\)$/.test(t)) { sinal = -1; t = t.slice(1, -1); }
  if (/^-/.test(t)) { sinal = -1; t = t.slice(1); }
  const virgula = t.lastIndexOf(','), ponto = t.lastIndexOf('.');
  if (virgula > ponto) t = t.replace(/\./g, '').replace(',', '.');
  else if (ponto > virgula) t = t.replace(/,/g, '');
  else t = t.replace(/[.,]/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? sinal * n : null;
}
/** Aceita MM/AAAA, AAAA-MM, M/AAAA e a serial de data do Excel. */
function lerCompetencia(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return null;
  let m = /^(\d{1,2})[\/\-.](\d{4})$/.exec(t);
  if (m) { const mes = +m[1]; return mes >= 1 && mes <= 12 ? m[2] + '-' + String(mes).padStart(2,'0') : null; }
  m = /^(\d{4})[\/\-.](\d{1,2})$/.exec(t);
  if (m) { const mes = +m[2]; return mes >= 1 && mes <= 12 ? m[1] + '-' + String(mes).padStart(2,'0') : null; }
  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(t);   // dd/mm/aaaa
  if (m) { const mes = +m[2]; return mes >= 1 && mes <= 12 ? m[3] + '-' + String(mes).padStart(2,'0') : null; }
  if (/^\d{5}$/.test(t)) {                                    // serial do Excel
    const d = new Date(Date.UTC(1899, 11, 30) + (+t) * 86400000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0');
  }
  return null;
}
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function lerNatureza(texto) {
  const t = semAcento(texto).replace(/[\s_-]+/g, '_');
  if (['fixa','fixo','recorrente','mensal'].includes(t)) return 'fixa';
  if (['pontual_unica','pontual','unica','avulsa','esporadica'].includes(t)) return 'pontual_unica';
  if (['pontual_parcelada','parcelada','parcelado','parcelamento'].includes(t)) return 'pontual_parcelada';
  return null;
}
function lerClassificacao(texto) {
  const t = semAcento(texto);
  if (['despesa','custo','opex'].includes(t)) return 'despesa';
  if (['investimento','capex','imobilizado'].includes(t)) return 'investimento';
  return null;
}
function lerOrigem(texto) {
  const t = semAcento(texto).replace(/[\s-]+/g, '_');
  if (!t) return null;
  if (ORIGENS[t]) return t;
  for (const [k, d] of Object.entries(ORIGENS)) if (semAcento(d.rotulo) === t || semAcento(d.curto) === t) return k;
  return null;
}
const lerInteiro = (t) => { const n = Number(String(t ?? '').trim()); return Number.isInteger(n) && n !== 0 ? n : null; };
/** Aceita a chave interna, o rótulo exibido ou a grafia da planilha do cliente. */
function lerTipoConsumo(texto) {
  const t = semAcento(texto).trim();
  if (!t) return null;
  if (t === 'integral' || /100\s*%|somente|so a filial|exclusiv/.test(t)) return 'integral';
  if (t === 'compartilhado' || /beneficia|compartilh|rate|central/.test(t)) return 'compartilhado';
  return null;
}

// ---------------------------------------------------------------- exportação
function linhasFinanceiro(empresa) {
  return Loja.todos(empresa)
    .sort((a,b) => a.competencia.localeCompare(b.competencia) || String(a.tipo).localeCompare(String(b.tipo)))
    .map((l) => ({
      'Filial': l.filial || '', 'Tipo de Despesa': l.tipo, 'Competência': mesExib(l.competencia),
      'Valor': Number(l.valor), 'Natureza': NATUREZAS[l.natureza] || l.natureza,
      'Classificação': l.classificacao === 'investimento' ? 'Investimento' : 'Despesa',
      'Qtd Parcelas': l.qtdParcelas || '', 'Parcela': l.parcela || '', 'Grupo': l.grupo || '',
      'Cenário': l.cenario, 'Origem': ORIGENS[origemDe(l)].rotulo,
      'Tipo de Consumo': consumoDe(l) === 'compartilhado' ? 'Paga pela filial, beneficia outras' : '100% da filial',
      // "Todas" volta como a palavra, e não como a lista: é a intenção que a
      // pessoa registrou, e reexportar a lista congelada como se fosse a
      // escolha original apagaria essa diferença.
      'Filiais Beneficiadas': l.beneficiaTodas ? 'Todas' : beneficiadasDe(l).join('|'),
      'Fornecedor': l.fornecedor || '',
      'Descrição': l.descricao || '', 'Observações': l.obs || '',
    }));
}

async function montarAbas(empresa, modulo) {
  const nomeEmp = (E.empresas.find((e) => e.id === empresa) || {}).nome || empresa;
  const projetos = await Loja.projetosDa(empresa);
  const sla = await Loja.slaDa(empresa);
  const conteudo = {
    Modelo: [
      { Chave:'Versão do modelo', Valor: MODELO_VERSAO },
      { Chave:'Empresa', Valor: nomeEmp },
      { Chave:'Identificador da empresa', Valor: empresa },
      { Chave:'Gerado em', Valor: new Date().toLocaleString('pt-BR') },
      { Chave:'Sistema', Valor: 'Gestão de TI IARX' },
    ],
    Filiais: filiaisDa(empresa).map((f) => ({ Filial:f.nome, Cidade:f.cidade||'', UF:f.uf||'', Ativo:'Sim' })),
    TiposDespesa: tiposDa(empresa).map((t) => ({ 'Tipo de Despesa':t.nome, Ativo:'Sim' })),
    Cenarios: cenariosDa(empresa).map((c) => ({ 'Cenário':c.chave, Nome:c.nome, 'Descrição':c.descricao||'' })),
    Financeiro: linhasFinanceiro(empresa),
    Projetos: projetos.map((p) => ({ Projeto:p.nome, Filial:p.filial||'', 'Descrição':p.descricao||'',
      'Mês Início':mesExib(p.inicio), 'Mês Fim Planejado':mesExib(p.fimPlanejado),
      'Mês Fim Real':p.fimReal?mesExib(p.fimReal):'', Status:STATUS_PROJ[p.status]||p.status||'' })),
    Tarefas: projetos.flatMap((p) => (p.tarefas||[]).map((t) => ({ Projeto:p.nome, Tarefa:t.nome,
      'Mês Início':mesExib(t.inicio), 'Mês Fim Planejado':mesExib(t.fimPlanejado),
      'Mês Fim Real':t.fimReal?mesExib(t.fimReal):'', 'Responsável':t.responsavel||'',
      Status:STATUS_PROJ[t.status]||t.status||'' }))),
    Envolvidos: projetos.flatMap((p) => (p.envolvidos||[]).map((v) => ({ Projeto:p.nome, Envolvido:v.nome, Papel:v.papel||'' }))),
    SLA: sla.map((s) => ({ Filial:s.filial||'', 'Competência':mesExib(s.competencia), Fila:s.fila,
      'Tópico de Ajuda':s.topico||'', 'Total Atendidos':Number(s.total)||0,
      'Dentro SLA':Number(s.dentro)||0, 'Fora SLA':(Number(s.total)||0)-(Number(s.dentro)||0),
      Ticket:s.ticketId||'', 'Número':s.numero||'', Assunto:s.assunto||'', Solicitante:s.solicitante||'',
      'Responsável':s.atendente||'', 'Nível':s.nivel||'',
      Prioridade: ROTULO_PRIORIDADE_SLA[s.prioridade] || s.prioridade || '',
      Status:s.status||'', Origem:s.origem||'',
      'Aberto em':s.criadoEm||'', 'Fechado em':s.fechadoEm||'', Prazo:s.prazoEm||'',
      Horas:(s.horas ?? ''), 'Observações':s.obs||'' })),
  };
  const abas = MODULOS[modulo].abas.map((nome) => ({
    nome, colunas: ABAS_MODELO[nome].colunas, linhas: conteudo[nome] || [],
  }));
  // A aba de instruções fecha o arquivo: quem preenche à mão descobre as regras
  // nela, e não errando uma linha por vez. É derivada da definição das abas,
  // então não tem como divergir do que a importação aceita.
  return [...abas, { nome: ABA_INSTRUCOES, colunas: COLUNAS_INSTRUCOES, linhas: linhasDeInstrucoes(modulo) }];
}

/**
 * O arquivo do ESCOPO: uma planilha só para todas as unidades escolhidas.
 *
 * Monta as abas de cada matriz pelo caminho de sempre e as junta, carimbando a
 * coluna `Empresa` em cada linha — é ela que permite a reimportação devolver
 * cada linha à unidade de onde saiu. A aba `Modelo` sai uma vez só, com o
 * cliente e o escopo, porque é o cabeçalho do arquivo e não uma tabela.
 */
async function montarAbasDoEscopo(escopo, modulo) {
  const empresas = empresasDoEscopoOp(escopo);
  const filiaisMarcadas = filiaisDoEscopoOp(escopo);
  // Nome, e não id: é o nome que a planilha mostra e que a volta reconhece.
  const nomesDeFilial = new Set(
    filiaisMarcadas.map((id) => (E.filiais.find((f) => f.id === id) || {}).nome).filter(Boolean),
  );

  const partes = [];
  for (const empresa of empresas) partes.push({ empresa, abas: await montarAbas(empresa, modulo) });

  const juntas = new Map();
  for (const { empresa, abas } of partes) {
    const nomeEmp = nomeEmpresa(empresa);
    for (const aba of abas) {
      if (aba.nome === 'Modelo' || aba.nome === ABA_INSTRUCOES) continue;
      let linhas = aba.linhas.map((l) => ({ [COLUNA_EMPRESA]: nomeEmp, ...l }));
      // Filial marcada recorta; a linha do nível da matriz (sem filial) fica,
      // porque ela é da matriz e não de nenhuma filial em especial.
      if (nomesDeFilial.size) linhas = linhas.filter((l) => !l.Filial || nomesDeFilial.has(l.Filial));
      const anterior = juntas.get(aba.nome);
      if (anterior) anterior.linhas.push(...linhas);
      else juntas.set(aba.nome, { nome: aba.nome, colunas: ABAS_MODELO[aba.nome].colunas, linhas });
    }
  }

  const cabecalho = {
    nome: 'Modelo',
    colunas: ABAS_MODELO.Modelo.colunas,
    linhas: [
      { Chave: 'Versão do modelo', Valor: MODELO_VERSAO },
      { Chave: 'Cliente', Valor: (clientePorId(E.clienteSel) || {}).nome || '—' },
      { Chave: 'Escopo', Valor: escopo.modo },
      { Chave: 'Unidades', Valor: resumoEscopoOp(escopo) },
      { Chave: 'Empresas', Valor: empresas.map(nomeEmpresa).join(' | ') },
      { Chave: 'Gerado em', Valor: new Date().toLocaleString('pt-BR') },
      { Chave: 'Sistema', Valor: 'Gestão de TI IARX' },
    ],
  };

  const ordenadas = MODULOS[modulo].abas.filter((n) => n !== 'Modelo').map((n) => juntas.get(n)).filter(Boolean);
  return [cabecalho, ...ordenadas,
    { nome: ABA_INSTRUCOES, colunas: COLUNAS_INSTRUCOES, linhas: linhasDeInstrucoes(modulo) }];
}

/**
 * A carga do ESCOPO: um arquivo, todas as unidades.
 *
 * Cada aba é repartida pela coluna `Empresa` e entregue ao importador de sempre,
 * uma vez por matriz — o que mantém intactas as regras de deduplicação, de
 * cadastro e de competência fechada, que são todas por matriz.
 *
 * A trava do enunciado vem antes de tudo: escopo com várias unidades e arquivo
 * sem a coluna não tem uma linha errada, tem o destino de todas indefinido.
 */
async function importarArquivoNoEscopo(escopo, abas, opcoes) {
  const empresas = empresasDoEscopoOp(escopo);
  const porNome = new Map(empresas.map((id) => [normalizarCabecalho(nomeEmpresa(id)), id]));
  const dados = abas.filter((a) => normalizarCabecalho(a.nome) !== 'modelo'
    && normalizarCabecalho(a.nome) !== normalizarCabecalho(ABA_INSTRUCOES));

  if (empresas.length > 1) {
    const sem = dados.find((a) => !colunaDoArquivo(a.colunas, COLUNA_EMPRESA, APELIDOS_EMPRESA));
    if (sem) {
      const mensagem = 'O escopo desta carga tem ' + empresas.length + ' empresas, e a aba "' + sem.nome +
        '" não traz a coluna "' + COLUNA_EMPRESA + '" — sem ela não há como saber de qual unidade é cada linha. ' +
        'Acrescente a coluna ao arquivo, ou escolha uma unidade só no escopo da operação.';
      if (!opcoes.simular) {
        await registrarCarga(empresas[0], { modulo: opcoes.modulo, modo: opcoes.modo, status: 'recusada',
          mensagem, arquivo: opcoes.arquivo, escopo: escopo.modo, unidades: resumoEscopoOp(escopo) });
      }
      throw new Error(mensagem);
    }
  }

  /**
   * De qual matriz é esta linha.
   *
   * Vazia com uma unidade só no escopo, é dela — é assim que entra o arquivo no
   * formato antigo, que não traz a coluna. Nome que não está no escopo devolve
   * `null`: a linha é recusada, e não desviada para a unidade mais próxima.
   */
  const donaDaLinha = (aba, linha) => {
    const coluna = colunaDoArquivo(aba.colunas, COLUNA_EMPRESA, APELIDOS_EMPRESA);
    const nome = coluna ? String(linha[coluna] ?? '').trim() : '';
    if (!nome) return empresas.length === 1 ? empresas[0] : null;
    return porNome.get(normalizarCabecalho(nome)) || null;
  };

  const juntou = { invalidas: [], abas: [], criouCadastros: null,
    modo: opcoes.modo === 'inicial' ? 'inicial' : 'incremental' };

  for (const empresa of empresas) {
    const recorte = dados
      .map((aba) => ({ ...aba, linhas: aba.linhas.filter((l) => donaDaLinha(aba, l) === empresa) }))
      .filter((aba) => aba.linhas.length);
    if (!recorte.length) continue;
    // O `Modelo` volta junto: é dele que sai a versão do arquivo no relatório.
    const comCabecalho = abas.filter((a) => normalizarCabecalho(a.nome) === 'modelo').concat(recorte);
    const rel = await importarArquivo(empresa, comCabecalho, { ...opcoes, escopo, semRegistro: true });
    juntou.invalidas.push(...rel.invalidas);
    juntou.versaoArquivo = juntou.versaoArquivo || rel.versaoArquivo;
    for (const a of rel.abas) {
      const anterior = juntou.abas.find((x) => x.nome === a.nome);
      if (!anterior) juntou.abas.push({ ...a });
      else for (const c of ['lidas', 'criadas', 'duplicadas', 'atualizadas']) anterior[c] = (anterior[c] || 0) + (a[c] || 0);
    }
  }

  // A linha que aponta para uma empresa fora do escopo não some em silêncio:
  // ela entra no relatório com o motivo, como toda linha recusada.
  for (const aba of dados) {
    aba.linhas.forEach((l, i) => {
      if (donaDaLinha(aba, l)) return;
      const coluna = colunaDoArquivo(aba.colunas, COLUNA_EMPRESA, APELIDOS_EMPRESA);
      const nome = coluna ? String(l[coluna] ?? '').trim() : '';
      juntou.invalidas.push({ aba: aba.nome, linha: i + 2,
        motivo: nome ? 'A empresa "' + nome + '" não está no escopo desta carga.'
                     : 'A coluna "' + COLUNA_EMPRESA + '" está vazia e o escopo tem várias empresas.' });
    });
  }
  if (!juntou.abas.length) juntou.semAbasConhecidas = true;

  if (!opcoes.simular) {
    // O registro fica na primeira matriz do escopo, com o escopo real ao lado:
    // o histórico da tela junta as cargas de todas as unidades do escopo.
    await registrarCarga(empresas[0], {
      modulo: opcoes.modulo, modo: juntou.modo, status: 'concluida', arquivo: opcoes.arquivo,
      escopo: escopo.modo, unidades: resumoEscopoOp(escopo),
      lidas: juntou.abas.reduce((s, a) => s + (a.lidas || 0), 0),
      criadas: juntou.abas.reduce((s, a) => s + (a.criadas || 0), 0),
      duplicadas: juntou.abas.reduce((s, a) => s + (a.duplicadas || 0), 0),
      invalidas: juntou.invalidas.length,
      erros: juntou.invalidas.map((i) => ({ aba: i.aba, linha: i.linha, mensagem: i.motivo || i.mensagem })),
    });
  }
  return juntou;
}

/** O cabeçalho do arquivo que corresponde a esta coluna do modelo, se houver. */
function colunaDoArquivo(colunas, canonica, apelidos) {
  const chaves = new Set([normalizarCabecalho(canonica), ...apelidos.map(normalizarCabecalho)]);
  return colunas.find((c) => chaves.has(normalizarCabecalho(c))) || null;
}

const ABA_INSTRUCOES = 'Instruções';
const COLUNAS_INSTRUCOES = ['Aba', 'Coluna', 'Obrigatória', 'O que preencher', 'Também aceita como cabeçalho'];

/**
 * O que cada coluna espera, para quem preenche à mão. Só as regras que não se
 * adivinham pelo nome da coluna: formato, valores fechados, campo derivado.
 */
const NOTAS_MODELO = {
  Financeiro: {
    'Competência': 'Mês de referência no formato MM/AAAA (ex.: 03/2026).',
    Valor: 'Em reais, com vírgula ou ponto decimal (1.234,56 ou 1234.56). Sem "R$".',
    Natureza: 'Fixa | Pontual única | Pontual parcelada.',
    'Classificação': 'Despesa | Investimento.',
    'Qtd Parcelas': 'Só para natureza parcelada; o sistema gera as parcelas seguintes.',
    Grupo: 'Identificador que liga as parcelas de uma mesma compra.',
    'Cenário': 'Em branco entra no cenário "oficial".',
    Origem: 'Procedência do dado (planilha, folha de TI, projeção).',
    Filial: 'Em branco, o lançamento fica no nível empresa (consolidado).',
  },
  Projetos: {
    'Mês Início': 'MM/AAAA.', 'Mês Fim Planejado': 'MM/AAAA.',
    'Mês Fim Real': 'MM/AAAA. Em branco enquanto não terminou.',
    Status: 'Planejado | Em andamento | Concluído | Cancelado.',
  },
  Tarefas: {
    'Mês Fim Real': 'MM/AAAA. O atraso é calculado a partir dele — nunca digitado.',
    Status: 'Pendente | Em andamento | Concluída | Cancelada.',
  },
  SLA: {
    'Competência': 'MM/AAAA.',
    'Total Atendidos': 'No agregado mensal, quantos chamados. Numa linha de chamado único, 1.',
    'Dentro SLA': 'Quantos dentro do prazo. Nunca maior que o total.',
    'Prioridade': 'Baixa, Média, Alta ou Urgente. É o que liga o chamado ao acordo de SLA cadastrado.',
    'Fora SLA': 'NÃO preencha: é sempre total − dentro, e é calculado na entrada.',
    Ticket: 'Id do chamado no helpdesk. Junto com a Origem, é o que evita duplicar ao reimportar.',
    'Aberto em': 'dd/mm/aaaa hh:mm ou AAAA-MM-DDThh:mm.',
  },
};

function linhasDeInstrucoes(modulo) {
  const saida = [];
  for (const nome of MODULOS[modulo].abas) {
    const def = ABAS_MODELO[nome];
    if (!def || nome === 'Modelo') continue;
    for (const coluna of def.colunas) {
      saida.push({
        Aba: nome,
        Coluna: coluna,
        'Obrigatória': def.obrigatorias.includes(coluna) ? 'Sim' : 'Não',
        'O que preencher': (NOTAS_MODELO[nome] || {})[coluna] || '',
        'Também aceita como cabeçalho': (def.apelidos[coluna] || []).join(', '),
      });
    }
  }
  return saida;
}

// ---------------------------------------------------------------- importação
/**
 * Chave de conteúdo idêntica à da versão local: a n-ésima linha repetida no
 * arquivo casa com a n-ésima já existente na base. Assim reimportar a própria
 * exportação não duplica, e duas notas legitimamente iguais no mês continuam
 * valendo por duas.
 */
const chaveConteudo = (empresa, l) => [empresa, l.filial || '', l.tipo, l.competencia, cent(l.valor),
  l.natureza, l.classificacao, l.parcela || '', l.cenario, l.descricao || '', l.obs || ''].join('|');

function contarExistentes(empresa) {
  const mapa = new Map();
  for (const l of Loja.todos(empresa)) {
    const k = chaveConteudo(empresa, l);
    mapa.set(k, (mapa.get(k) || 0) + 1);
  }
  return mapa;
}

/**
 * Importa a aba Financeiro. Linha inválida não aborta o lote: entra no
 * relatório com o número da linha e o motivo, e o resto segue.
 */
async function importarFinanceiro(empresa, aba, opcoes, rel) {
  const mapa = mapearColunas('Financeiro', aba.colunas);
  const faltando = ABAS_MODELO.Financeiro.obrigatorias.filter((c) => !mapa.has(c));
  if (faltando.length) {
    rel.abas.push({ nome:'Financeiro', erro:'Faltam colunas obrigatórias: ' + faltando.join(', ') });
    return;
  }
  const ler = (linha, col) => mapa.has(col) ? String(linha[mapa.get(col)] ?? '').trim() : '';
  const existentes = contarExistentes(empresa);
  const vistas = new Map();
  const tiposConhecidos = new Set(tiposDa(empresa).map((t) => t.nome));
  const filiaisConhecidas = new Set(filiaisDa(empresa).map((f) => f.nome));
  const cenariosConhecidos = new Set(cenariosDa(empresa).map((c) => c.chave));
  const novosTipos = new Set(), novasFiliais = new Set(), novosCenarios = new Set();
  const porMes = new Map();
  let criadas = 0, duplicadas = 0;

  aba.linhas.forEach((linha, i) => {
    const nl = i + 2;   // linha 1 é o cabeçalho
    const erro = (motivo) => rel.invalidas.push({ aba:'Financeiro', linha:nl, motivo });

    const competencia = lerCompetencia(ler(linha, 'Competência'));
    if (!competencia) return erro('Competência inválida — use MM/AAAA.');
    const valor = lerValorPlanilha(ler(linha, 'Valor'));
    if (valor === null) return erro('Valor inválido.');
    const tipo = ler(linha, 'Tipo de Despesa');
    if (!tipo) return erro('Tipo de despesa em branco.');
    const natureza = lerNatureza(ler(linha, 'Natureza'));
    if (!natureza) return erro('Natureza inválida — use Fixa, Pontual única ou Pontual parcelada.');
    const classificacao = lerClassificacao(ler(linha, 'Classificação'));
    if (!classificacao) return erro('Classificação inválida — use Despesa ou Investimento.');
    if (competenciaFechada(empresa, competencia)) return erro('Competência ' + mesExib(competencia) + ' está fechada.');

    const filial = ler(linha, 'Filial') || null;
    const parcela = lerInteiro(ler(linha, 'Parcela'));
    const qtdParcelas = lerInteiro(ler(linha, 'Qtd Parcelas'));
    if (natureza === 'pontual_parcelada' && parcela === null && (qtdParcelas === null || qtdParcelas < 2)) {
      return erro('Pontual parcelada exige "Qtd Parcelas" de 2 ou mais.');
    }
    const cenario = ler(linha, 'Cenário') || 'oficial';
    const origem = lerOrigem(ler(linha, 'Origem')) || 'planilha';

    // Consumo (modelo 1.5). Nomear beneficiadas sem dizer o tipo já diz o tipo:
    // exigir as duas colunas rejeitaria um arquivo cuja intenção é inequívoca.
    const textoBenef = ler(linha, 'Filiais Beneficiadas');
    const beneficiaTodas = /^todas( as filiais)?$/i.test(textoBenef.trim());
    const nomesBenef = beneficiaTodas ? [] : textoBenef.split(/[|;/]/).map((n) => n.trim()).filter(Boolean);
    const temBenef = beneficiaTodas || nomesBenef.length > 0;
    const tipoConsumo = lerTipoConsumo(ler(linha, 'Tipo de Consumo')) || (temBenef ? 'compartilhado' : 'integral');
    if (tipoConsumo === 'compartilhado' && !temBenef) {
      return erro('Tipo de consumo "beneficia outras" exige "Filiais Beneficiadas" preenchida.');
    }
    // A lista é congelada aqui: reimportar o arquivo depois de cadastrar uma
    // filial nova não pode mudar quem consumia um mês já carregado.
    const beneficiadas = tipoConsumo === 'integral'
      ? []
      : (beneficiaTodas ? filiaisDoEscopo().map((f) => f.nome) : nomesBenef).filter((n) => n !== filial);
    if (tipoConsumo === 'compartilhado' && !beneficiadas.length) {
      return erro('Nenhuma filial beneficiada além da que paga.');
    }
    const desconhecida = beneficiadas.find((n) => !filiaisDoEscopo().some((f) => f.nome === n));
    if (desconhecida) return erro('Filial beneficiada "' + desconhecida + '" não encontrada neste cliente.');

    const registro = { filial, tipo, competencia, valor, natureza, classificacao,
      parcela, qtdParcelas, cenario, origem, tipoConsumo, beneficiadas, beneficiaTodas,
      fornecedor: ler(linha, 'Fornecedor') || null,
      descricao: ler(linha, 'Descrição') || null, obs: ler(linha, 'Observações') || null,
      grupo: ler(linha, 'Grupo') || null };

    if (!tiposConhecidos.has(tipo)) { if (!opcoes.criarCadastros) return erro('Tipo de despesa "' + tipo + '" não cadastrado.'); novosTipos.add(tipo); }
    if (filial && !filiaisConhecidas.has(filial)) { if (!opcoes.criarCadastros) return erro('Filial "' + filial + '" não cadastrada.'); novasFiliais.add(filial); }
    if (!cenariosConhecidos.has(cenario)) { if (!opcoes.criarCadastros) return erro('Cenário "' + cenario + '" não cadastrado.'); novosCenarios.add(cenario); }

    const k = chaveConteudo(empresa, registro);
    const ocorrencia = (vistas.get(k) || 0) + 1;
    vistas.set(k, ocorrencia);
    if (ocorrencia <= (existentes.get(k) || 0)) { duplicadas++; return; }

    if (!porMes.has(competencia)) porMes.set(competencia, []);
    porMes.get(competencia).push(registro);
    criadas++;
  });

  rel.abas.push({ nome:'Financeiro', lidas: aba.linhas.length, criadas, duplicadas,
    invalidas: rel.invalidas.filter((x) => x.aba === 'Financeiro').length });
  if (opcoes.simular || !criadas) return;

  // Cadastros que a importação precisou criar entram antes dos lançamentos.
  if (novosTipos.size) await Loja.gravarCatalogo('tipos', [...E.tipos, ...[...novosTipos].map((n) => ({ empresa, nome:n }))]);
  if (novasFiliais.size) await Loja.gravarCatalogo('filiais', [...E.filiais, ...[...novasFiliais].map((n) => ({ empresa, nome:n }))]);
  if (novosCenarios.size) await Loja.gravarCatalogo('cenarios', [...E.cenarios, ...[...novosCenarios].map((c) => ({ empresa, chave:c, nome:c }))]);

  for (const [comp, novos] of porMes) {
    const itens = [...Loja.itens(empresa, comp)];
    for (const r of novos) {
      const id = novoId();
      itens.push({ id, grupo: r.grupo || 'g' + id, filial:r.filial, tipo:r.tipo, valor:r.valor,
        natureza:r.natureza, classificacao:r.classificacao, qtdParcelas:r.qtdParcelas, parcela:r.parcela,
        cenario:r.cenario, origem:r.origem, fornecedor:r.fornecedor, descricao:r.descricao, obs:r.obs,
        tipoConsumo:r.tipoConsumo, beneficiadas:r.beneficiadas, beneficiaTodas:r.beneficiaTodas });
    }
    await Loja.gravarMes(empresa, comp, itens);
  }
  rel.criouCadastros = { tipos:[...novosTipos], filiais:[...novasFiliais], cenarios:[...novosCenarios] };
}

async function importarSla(empresa, aba, opcoes, rel) {
  const mapa = mapearColunas('SLA', aba.colunas);
  const faltando = ABAS_MODELO.SLA.obrigatorias.filter((c) => !mapa.has(c));
  if (faltando.length) { rel.abas.push({ nome:'SLA', erro:'Faltam colunas obrigatórias: ' + faltando.join(', ') }); return; }
  const ler = (l, c) => mapa.has(c) ? String(l[mapa.get(c)] ?? '').trim() : '';
  const jaTem = new Set((await Loja.slaDa(empresa)).map((s) => s.ticketId
    ? 'ticket:' + s.ticketId
    : [s.competencia, s.fila, s.topico || '', s.filial || '', s.total, s.dentro].join('|')));
  const porMes = new Map();
  let criadas = 0, duplicadas = 0;

  aba.linhas.forEach((linha, i) => {
    const nl = i + 2;
    const erro = (m) => rel.invalidas.push({ aba:'SLA', linha:nl, motivo:m });
    const competencia = lerCompetencia(ler(linha, 'Competência'));
    if (!competencia) return erro('Competência inválida — use MM/AAAA.');
    const fila = ler(linha, 'Fila');
    if (!fila) return erro('Fila em branco.');
    const total = Number(ler(linha, 'Total Atendidos'));
    const dentro = Number(ler(linha, 'Dentro SLA'));
    if (!Number.isInteger(total) || total < 0) return erro('Total de atendidos inválido.');
    if (!Number.isInteger(dentro) || dentro < 0) return erro('Dentro do SLA inválido.');
    if (dentro > total) return erro('Dentro do SLA (' + dentro + ') maior que o total (' + total + ').');
    const foraTxt = ler(linha, 'Fora SLA');
    const fora = foraTxt === '' ? total - dentro : Number(foraTxt);
    if (!Number.isInteger(fora) || fora < 0) return erro('Fora do SLA inválido.');
    if (dentro + fora !== total) return erro('Dentro (' + dentro + ') + fora (' + fora + ') não fecha com o total (' + total + ').');

    // `fora` não é gravado: é derivado de total − dentro em toda leitura, como
    // na tela. Guardar o derivado abriria espaço para ele discordar da conta.
    const ticketId = lerInteiro(ler(linha, 'Ticket'));
    const reg = { id: ticketId ? 't' + ticketId : novoId(),
      filial: ler(linha,'Filial') || null, fila, topico: ler(linha,'Tópico de Ajuda') || null,
      total, dentro, obs: ler(linha,'Observações') || null };
    if (ticketId) {
      Object.assign(reg, { ticketId,
        numero: ler(linha,'Número') || null, assunto: ler(linha,'Assunto') || null,
        solicitante: ler(linha,'Solicitante') || null, atendente: ler(linha,'Responsável') || null,
        nivel: ler(linha,'Nível') || null, prioridade: prioridadeDaPlanilha(ler(linha,'Prioridade')),
        status: ler(linha,'Status') || null, origem: ler(linha,'Origem') || null,
        criadoEm: ler(linha,'Aberto em') || null, fechadoEm: ler(linha,'Fechado em') || null,
        prazoEm: ler(linha,'Prazo') || null,
        horas: ler(linha,'Horas') === '' ? null : lerValorPlanilha(ler(linha,'Horas')) });
    }
    // O chamado se identifica pelo próprio número no osTicket; o registro
    // digitado à mão continua casando por conteúdo.
    const k = ticketId ? 'ticket:' + ticketId
      : [competencia, reg.fila, reg.topico || '', reg.filial || '', total, dentro].join('|');
    if (jaTem.has(k)) { duplicadas++; return; }
    jaTem.add(k);
    if (!porMes.has(competencia)) porMes.set(competencia, []);
    porMes.get(competencia).push(reg);
    criadas++;
  });

  rel.abas.push({ nome:'SLA', lidas: aba.linhas.length, criadas, duplicadas,
    invalidas: rel.invalidas.filter((x) => x.aba === 'SLA').length });
  if (opcoes.simular || !criadas) return;
  for (const [comp, novos] of porMes) {
    const atuais = (await Loja.slaDa(empresa)).filter((s) => s.competencia === comp).map(({ competencia, ...r }) => r);
    await Loja.gravarSlaMes(empresa, comp, [...atuais, ...novos]);
  }
}

async function importarProjetos(empresa, abas, opcoes, rel) {
  const projAba = abas.find((a) => normalizarCabecalho(a.nome) === 'projetos');
  if (!projAba) return;
  const mapa = mapearColunas('Projetos', projAba.colunas);
  const faltando = ABAS_MODELO.Projetos.obrigatorias.filter((c) => !mapa.has(c));
  if (faltando.length) { rel.abas.push({ nome:'Projetos', erro:'Faltam colunas obrigatórias: ' + faltando.join(', ') }); return; }
  const ler = (l, c) => mapa.has(c) ? String(l[mapa.get(c)] ?? '').trim() : '';
  const atuais = [...await Loja.projetosDa(empresa)];
  const porNome = new Map(atuais.map((p) => [p.nome, p]));
  let criadas = 0, duplicadas = 0;

  projAba.linhas.forEach((linha, i) => {
    const nl = i + 2;
    const erro = (m) => rel.invalidas.push({ aba:'Projetos', linha:nl, motivo:m });
    const nome = ler(linha, 'Projeto');
    if (!nome) return erro('Nome do projeto em branco.');
    const inicio = lerCompetencia(ler(linha, 'Mês Início'));
    if (!inicio) return erro('Mês de início inválido — use MM/AAAA.');
    const fimPlanejado = lerCompetencia(ler(linha, 'Mês Fim Planejado'));
    if (!fimPlanejado) return erro('Mês de fim planejado inválido — use MM/AAAA.');
    if (fimPlanejado < inicio) return erro('Fim planejado anterior ao início.');
    const fimRealTexto = ler(linha, 'Mês Fim Real');
    const fimReal = fimRealTexto ? lerCompetencia(fimRealTexto) : null;
    if (fimRealTexto && !fimReal) return erro('Mês de fim real inválido — use MM/AAAA.');
    if (porNome.has(nome)) { duplicadas++; return; }
    const p = { id: novoId(), nome, filial: ler(linha,'Filial') || null, descricao: ler(linha,'Descrição') || null,
      inicio, fimPlanejado, fimReal, status: semAcento(ler(linha,'Status')).replace(/\s+/g,'_') || 'planejado',
      tarefas: [], envolvidos: [] };
    porNome.set(nome, p); atuais.push(p); criadas++;
  });

  for (const [nomeAba, chave, campos] of [['tarefas','Tarefas','tarefas'], ['envolvidos','Envolvidos','envolvidos']]) {
    const a = abas.find((x) => normalizarCabecalho(x.nome) === nomeAba);
    if (!a) continue;
    const m = mapearColunas(chave, a.colunas);
    const f = ABAS_MODELO[chave].obrigatorias.filter((c) => !m.has(c));
    if (f.length) { rel.abas.push({ nome:chave, erro:'Faltam colunas obrigatórias: ' + f.join(', ') }); continue; }
    const l2 = (l, c) => m.has(c) ? String(l[m.get(c)] ?? '').trim() : '';
    let n = 0, repetidas = 0;
    a.linhas.forEach((linha, i) => {
      const erro = (mo) => rel.invalidas.push({ aba:chave, linha:i+2, motivo:mo });
      const p = porNome.get(l2(linha, 'Projeto'));
      if (!p) return erro('Projeto "' + l2(linha, 'Projeto') + '" não existe nesta empresa.');
      if (chave === 'Tarefas') {
        const inicio = lerCompetencia(l2(linha, 'Mês Início'));
        const fimPlanejado = lerCompetencia(l2(linha, 'Mês Fim Planejado'));
        if (!inicio || !fimPlanejado) return erro('Meses da tarefa inválidos — use MM/AAAA.');
        const nome = l2(linha, 'Tarefa');
        if ((p.tarefas || []).some((t) => t.nome === nome)) { repetidas++; return; }
        (p.tarefas ||= []).push({ id: novoId(), nome, inicio, fimPlanejado,
          fimReal: lerCompetencia(l2(linha, 'Mês Fim Real')), responsavel: l2(linha,'Responsável') || null,
          status: semAcento(l2(linha,'Status')).replace(/\s+/g,'_') || 'planejado' });
      } else {
        const nome = l2(linha, 'Envolvido');
        if (!nome) return erro('Nome do envolvido em branco.');
        if ((p.envolvidos || []).some((v) => v.nome === nome)) { repetidas++; return; }
        (p.envolvidos ||= []).push({ id: novoId(), nome, papel: l2(linha,'Papel') || null });
      }
      n++;
    });
    rel.abas.push({ nome:chave, lidas:a.linhas.length, criadas:n, duplicadas:repetidas,
      invalidas: rel.invalidas.filter((x) => x.aba === chave).length });
  }

  rel.abas.push({ nome:'Projetos', lidas:projAba.linhas.length, criadas, duplicadas,
    invalidas: rel.invalidas.filter((x) => x.aba === 'Projetos').length });
  if (!opcoes.simular) await Loja.gravarProjetos(empresa, atuais);
}

async function importarCatalogos(empresa, abas, opcoes, rel) {
  const conf = [
    ['filiais', 'Filiais', 'Filial', (n) => ({ empresa, nome:n }), (x) => x.nome],
    ['tipos', 'TiposDespesa', 'Tipo de Despesa', (n) => ({ empresa, nome:n }), (x) => x.nome],
    ['cenarios', 'Cenarios', 'Cenário', (n) => ({ empresa, chave:n, nome:n }), (x) => x.chave],
  ];
  for (const [colecao, nomeAba, coluna, montar, chaveDe] of conf) {
    const a = abas.find((x) => normalizarCabecalho(x.nome) === normalizarCabecalho(nomeAba));
    if (!a) continue;
    const m = mapearColunas(nomeAba, a.colunas);
    if (!m.has(coluna)) { rel.abas.push({ nome:nomeAba, erro:'Falta a coluna "' + coluna + '".' }); continue; }
    const atuais = E[colecao];
    const existe = new Set(atuais.filter((x) => x.empresa === empresa).map(chaveDe));
    const novos = [];
    let duplicadas = 0;
    a.linhas.forEach((linha, i) => {
      const nome = String(linha[m.get(coluna)] ?? '').trim();
      if (!nome) return rel.invalidas.push({ aba:nomeAba, linha:i+2, motivo:'Nome em branco.' });
      if (existe.has(nome) || nome === 'oficial') { duplicadas++; return; }
      existe.add(nome); novos.push(montar(nome));
    });
    rel.abas.push({ nome:nomeAba, lidas:a.linhas.length, criadas:novos.length, duplicadas,
      invalidas: rel.invalidas.filter((x) => x.aba === nomeAba).length });
    if (!opcoes.simular && novos.length) await Loja.gravarCatalogo(colecao, [...atuais, ...novos]);
  }
}

/** Roda o lote inteiro; nenhuma aba interrompe as outras. */
async function importarArquivo(empresa, abas, opcoes) {
  const rel = { invalidas: [], abas: [], criouCadastros: null, modo: opcoes.modo === 'inicial' ? 'inicial' : 'incremental' };

  // A carga inicial é o histórico inteiro entrando de uma vez. Sobre um módulo
  // que já tem dado, ela quase sempre é engano de quem escolheu o modo — e a
  // recusa vem com o número na frente, para a confirmação ser informada.
  if (rel.modo === 'inicial' && !opcoes.simular && !opcoes.confirmar) {
    const existentes = jaTemDados(empresa, opcoes.modulo || 'completo');
    if (existentes > 0) {
      const mensagem = 'Esta empresa já tem ' + inteiro(existentes) + ' registro(s), e a carga foi marcada como ' +
        'INICIAL. Use a carga incremental, ou confirme a inicial se a intenção é recarregar o histórico ' +
        '(nada é duplicado: as linhas que já existem continuam sendo reconhecidas).';
      await registrarCarga(empresa, {
        modulo: opcoes.modulo, modo: 'inicial', status: 'recusada', mensagem, arquivo: opcoes.arquivo,
      });
      const erro = new Error(mensagem);
      erro.precisaConfirmar = true;
      throw erro;
    }
  }
  const modelo = abas.find((a) => normalizarCabecalho(a.nome) === 'modelo');
  if (modelo) {
    const v = modelo.linhas.find((l) => normalizarCabecalho(l.Chave || l[modelo.colunas[0]]) === 'versaodomodelo');
    rel.versaoArquivo = v ? String(v.Valor ?? v[modelo.colunas[1]]) : null;
  }
  await importarCatalogos(empresa, abas, opcoes, rel);
  const fin = abas.find((a) => normalizarCabecalho(a.nome) === 'financeiro');
  if (fin) await importarFinanceiro(empresa, fin, opcoes, rel);
  await importarProjetos(empresa, abas, opcoes, rel);
  const sla = abas.find((a) => normalizarCabecalho(a.nome) === 'sla');
  if (sla) await importarSla(empresa, sla, opcoes, rel);
  if (!rel.abas.length) rel.semAbasConhecidas = true;

  // Simulação não é carga: registrar a prévia encheria o histórico de linhas
  // que não mudaram nada, e a pergunta "o que entrou?" ficaria mais difícil.
  if (!opcoes.simular && !opcoes.semRegistro) {
    await registrarCarga(empresa, {
      modulo: opcoes.modulo,
      modo: rel.modo,
      escopo: opcoes.escopo ? opcoes.escopo.modo : 'cliente',
      unidades: opcoes.escopo ? resumoEscopoOp(opcoes.escopo) : null,
      status: 'concluida',
      arquivo: opcoes.arquivo,
      lidas: rel.abas.reduce((s, a) => s + (a.lidas || 0), 0),
      criadas: rel.abas.reduce((s, a) => s + (a.criadas || 0), 0),
      duplicadas: rel.abas.reduce((s, a) => s + (a.duplicadas || 0), 0),
      invalidas: rel.invalidas.length,
      erros: rel.invalidas.map((i) => ({ aba: i.aba, linha: i.linha, mensagem: i.motivo || i.mensagem })),
    });
  }
  return rel;
}
