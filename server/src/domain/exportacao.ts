import { db } from '../db/index.js';
import { auditar } from './auditoria.js';
import { paraExibicao } from './competencia.js';
import type { Contexto } from './contexto.js';
import { paraReais } from './dinheiro.js';
import { clausulaEmpresas } from './escopo.js';
import {
  contarFiliais,
  escopoParaLog,
  filtroSql,
  resumoEscopo,
  type EscopoOperacao,
} from './escopo-operacao.js';
import {
  beneficiadasPorLancamento,
  ROTULO_CONSUMO,
  ROTULO_ORIGEM,
  type Origem,
  type TipoConsumo,
} from './financeiro.js';
import { escreverCsv, escreverXlsx, type Aba } from '../lib/planilha.js';
import {
  ABA_INSTRUCOES,
  ABAS,
  ABAS_POR_MODULO,
  COLUNA_EMPRESA,
  COLUNAS_INSTRUCOES,
  linhasDeInstrucoes,
  TEMPLATE_VERSAO_ATUAL,
  type Modulo,
  type NomeAba,
} from './templates.js';

/** Valor no formato brasileiro, pronto para o Excel pt-BR. */
function valorBR(centavos: number): string {
  return paraReais(centavos).toFixed(2).replace('.', ',');
}

/**
 * O recorte de uma aba de CADASTRO (filiais, tipos, cenários, tópicos).
 *
 * Cadastro pertence à matriz e não tem filial própria, então o modo `unidades`
 * não o recorta mais do que o modo `empresas` — o que a pessoa marcou já veio
 * expandido em `escopo.empresas`.
 */
function porEmpresa(escopo: EscopoOperacao, coluna = 'empresa_id') {
  return clausulaEmpresas(escopo.empresas, coluna);
}

function linhasFiliais(ctx: Contexto, escopo: EscopoOperacao) {
  const base = porEmpresa(escopo, 'f.empresa_id');
  // Aqui, sim, a filial marcada recorta: a aba É a lista de filiais.
  const recorte = escopo.filiais.length
    ? { sql: `${base.sql} AND f.id IN (${escopo.filiais.map(() => '?').join(', ')})`, params: [...base.params, ...escopo.filiais] }
    : base;
  return (
    db()
      .prepare(
        `SELECT e.nome AS empresa, f.nome, f.cidade, f.uf, f.ativo
           FROM filiais f JOIN empresas e ON e.id = f.empresa_id
          WHERE ${recorte.sql} ORDER BY e.nome, f.nome`,
      )
      .all(...recorte.params) as Array<{
      empresa: string;
      nome: string;
      cidade: string | null;
      uf: string | null;
      ativo: number;
    }>
  ).map((l) => ({
    [COLUNA_EMPRESA]: l.empresa,
    Filial: l.nome,
    Cidade: l.cidade ?? '',
    UF: l.uf ?? '',
    Ativo: l.ativo ? 'Sim' : 'Não',
  }));
}

function linhasTiposDespesa(_ctx: Contexto, escopo: EscopoOperacao) {
  const { sql, params } = porEmpresa(escopo, 't.empresa_id');
  return (
    db()
      .prepare(
        `SELECT e.nome AS empresa, t.nome, t.ativo
           FROM tipos_despesa t JOIN empresas e ON e.id = t.empresa_id
          WHERE ${sql} ORDER BY e.nome, t.nome`,
      )
      .all(...params) as Array<{ empresa: string; nome: string; ativo: number }>
  ).map((l) => ({ [COLUNA_EMPRESA]: l.empresa, 'Tipo de Despesa': l.nome, Ativo: l.ativo ? 'Sim' : 'Não' }));
}

function linhasCenarios(_ctx: Contexto, escopo: EscopoOperacao) {
  const { sql, params } = porEmpresa(escopo, 'c.empresa_id');
  return (
    db()
      .prepare(
        `SELECT e.nome AS empresa, c.chave, c.nome, c.descricao
           FROM cenarios c JOIN empresas e ON e.id = c.empresa_id
          WHERE ${sql} ORDER BY e.nome, c.nome`,
      )
      .all(...params) as Array<{ empresa: string; chave: string; nome: string; descricao: string | null }>
  ).map((l) => ({
    [COLUNA_EMPRESA]: l.empresa,
    'Cenário': l.chave,
    Nome: l.nome,
    'Descrição': l.descricao ?? '',
  }));
}

function linhasFinanceiro(_ctx: Contexto, escopo: EscopoOperacao) {
  const { sql, params } = filtroSql(escopo, 'l.empresa_id', 'l.filial_id');
  const linhas = (
    db()
      .prepare(
        `SELECT l.id, e.nome AS empresa, f.nome AS filial, t.nome AS tipo, l.competencia, l.valor_centavos,
                l.natureza, l.classificacao, l.qtd_parcelas, l.parcela_numero, l.lancamento_origem_id,
                l.cenario, l.origem, l.descricao, l.observacoes, l.tipo_consumo, l.beneficia_todas
           FROM lancamentos l
           JOIN empresas e ON e.id = l.empresa_id
           JOIN tipos_despesa t ON t.id = l.tipo_despesa_id
           LEFT JOIN filiais f ON f.id = l.filial_id
          WHERE ${sql} AND l.excluido_em IS NULL
          ORDER BY e.nome, l.competencia, t.nome, l.id`,
      )
      .all(...params) as Array<{
      id: number;
      empresa: string;
      filial: string | null;
      tipo: string;
      competencia: string;
      valor_centavos: number;
      natureza: string;
      classificacao: string;
      qtd_parcelas: number | null;
      parcela_numero: number | null;
      lancamento_origem_id: number | null;
      cenario: string;
      origem: Origem;
      descricao: string | null;
      observacoes: string | null;
      tipo_consumo: TipoConsumo | null;
      beneficia_todas: number | null;
    }>
  );

  // As beneficiadas saem pelo NOME, qualificado pela matriz: o arquivo viaja
  // entre bases, e um id não significa nada do outro lado.
  const beneficiadas = beneficiadasPorLancamento(linhas.map((l) => l.id));

  return linhas.map((l) => ({
    [COLUNA_EMPRESA]: l.empresa,
    Filial: l.filial ?? '',
    'Tipo de Despesa': l.tipo,
    Competência: paraExibicao(l.competencia),
    Valor: valorBR(l.valor_centavos),
    Natureza: l.natureza,
    Classificação: l.classificacao,
    'Qtd Parcelas': l.qtd_parcelas ?? '',
    Parcela: l.parcela_numero ?? '',
    // O grupo identifica a série; na reimportação religa as parcelas ao lançamento de origem.
    Grupo: l.lancamento_origem_id ?? l.id,
    Cenário: l.cenario,
    Origem: ROTULO_ORIGEM[l.origem] ?? l.origem,
    'Tipo de Consumo': ROTULO_CONSUMO[l.tipo_consumo ?? 'integral'],
    // "Todas" volta como a palavra, e não como a lista: é a intenção que a
    // pessoa registrou, e reimportar a lista congelada de hoje como se fosse a
    // escolha original apagaria essa diferença.
    'Filiais Beneficiadas': Number(l.beneficia_todas ?? 0) === 1
      ? 'Todas'
      : (beneficiadas.get(l.id) ?? []).map((f) => `${f.empresa_nome} > ${f.nome}`).join('|'),
    Descrição: l.descricao ?? '',
    Observações: l.observacoes ?? '',
  }));
}

function linhasProjetos(_ctx: Contexto, escopo: EscopoOperacao) {
  const { sql, params } = filtroSql(escopo, 'p.empresa_id', 'p.filial_id');
  return (
    db()
      .prepare(
        `SELECT e.nome AS empresa, p.nome, f.nome AS filial, p.descricao, p.mes_inicio, p.mes_fim_planejado,
                p.mes_fim_real, p.status
           FROM projetos p
           JOIN empresas e ON e.id = p.empresa_id
           LEFT JOIN filiais f ON f.id = p.filial_id
          WHERE ${sql} AND p.excluido_em IS NULL ORDER BY e.nome, p.mes_inicio, p.nome`,
      )
      .all(...params) as Array<{
      empresa: string;
      nome: string;
      filial: string | null;
      descricao: string | null;
      mes_inicio: string;
      mes_fim_planejado: string;
      mes_fim_real: string | null;
      status: string;
    }>
  ).map((l) => ({
    [COLUNA_EMPRESA]: l.empresa,
    Projeto: l.nome,
    Filial: l.filial ?? '',
    Descrição: l.descricao ?? '',
    'Mês Início': paraExibicao(l.mes_inicio),
    'Mês Fim Planejado': paraExibicao(l.mes_fim_planejado),
    'Mês Fim Real': l.mes_fim_real ? paraExibicao(l.mes_fim_real) : '',
    Status: l.status,
  }));
}

function linhasTarefas(_ctx: Contexto, escopo: EscopoOperacao) {
  const { sql, params } = filtroSql(escopo, 'p.empresa_id', 'p.filial_id');
  return (
    db()
      .prepare(
        `SELECT e.nome AS empresa, p.nome AS projeto, t.nome, t.mes_inicio, t.mes_fim_planejado, t.mes_fim_real,
                t.responsavel, t.status, pai.nome AS tarefa_principal
           FROM tarefas t
           JOIN projetos p ON p.id = t.projeto_id
           JOIN empresas e ON e.id = p.empresa_id
           LEFT JOIN tarefas pai ON pai.id = t.parent_task_id AND pai.excluido_em IS NULL
          WHERE ${sql} AND t.excluido_em IS NULL AND p.excluido_em IS NULL
          ORDER BY e.nome, p.nome, t.mes_inicio, t.id`,
      )
      .all(...params) as Array<{
      empresa: string;
      projeto: string;
      nome: string;
      mes_inicio: string;
      mes_fim_planejado: string;
      mes_fim_real: string | null;
      responsavel: string | null;
      status: string;
      tarefa_principal: string | null;
    }>
  ).map((l) => ({
    [COLUNA_EMPRESA]: l.empresa,
    Projeto: l.projeto,
    Tarefa: l.nome,
    'Tarefa Principal': l.tarefa_principal ?? '',
    'Mês Início': paraExibicao(l.mes_inicio),
    'Mês Fim Planejado': paraExibicao(l.mes_fim_planejado),
    'Mês Fim Real': l.mes_fim_real ? paraExibicao(l.mes_fim_real) : '',
    Responsável: l.responsavel ?? '',
    Status: l.status,
  }));
}

function linhasEnvolvidos(_ctx: Contexto, escopo: EscopoOperacao) {
  const { sql, params } = filtroSql(escopo, 'p.empresa_id', 'p.filial_id');
  return (
    db()
      .prepare(
        `SELECT e.nome AS empresa, p.nome AS projeto, en.nome, en.papel
           FROM envolvidos en
           JOIN projetos p ON p.id = en.projeto_id
           JOIN empresas e ON e.id = p.empresa_id
          WHERE ${sql} AND p.excluido_em IS NULL ORDER BY e.nome, p.nome, en.nome`,
      )
      .all(...params) as Array<{ empresa: string; projeto: string; nome: string; papel: string | null }>
  ).map((l) => ({
    [COLUNA_EMPRESA]: l.empresa,
    Projeto: l.projeto,
    Envolvido: l.nome,
    Papel: l.papel ?? '',
  }));
}

function linhasTopicos(_ctx: Contexto, escopo: EscopoOperacao) {
  const { sql, params } = porEmpresa(escopo, 't.empresa_id');
  return (
    db()
      .prepare(
        `SELECT e.nome AS empresa, t.nome, t.ativo
           FROM topicos_ajuda t JOIN empresas e ON e.id = t.empresa_id
          WHERE ${sql} ORDER BY e.nome, t.nome`,
      )
      .all(...params) as Array<{ empresa: string; nome: string; ativo: number }>
  ).map((l) => ({ [COLUNA_EMPRESA]: l.empresa, 'Tópico de Ajuda': l.nome, Ativo: l.ativo ? 'Sim' : 'Não' }));
}

function linhasSla(_ctx: Contexto, escopo: EscopoOperacao) {
  const { sql, params } = filtroSql(escopo, 's.empresa_id', 's.filial_id');
  return (
    db()
      .prepare(
        `SELECT e.nome AS empresa, f.nome AS filial, s.competencia, q.nome AS fila, ta.nome AS topico,
                s.total_atendidos, s.dentro_sla, s.fora_sla, s.observacoes,
                s.ticket_id, s.numero, s.assunto, s.solicitante, s.responsavel,
                s.nivel, s.status, s.origem_chamado, s.aberto_em, s.fechado_em, s.prazo_em, s.horas
           FROM tickets_sla s
           JOIN empresas e ON e.id = s.empresa_id
           JOIN filas_ticket q ON q.id = s.fila_id
           LEFT JOIN topicos_ajuda ta ON ta.id = s.topico_ajuda_id
           LEFT JOIN filiais f ON f.id = s.filial_id
          WHERE ${sql} AND s.excluido_em IS NULL
          ORDER BY e.nome, s.competencia, q.ordem, ta.nome`,
      )
      .all(...params) as Array<{
      empresa: string;
      filial: string | null;
      competencia: string;
      fila: string;
      topico: string | null;
      total_atendidos: number;
      dentro_sla: number;
      fora_sla: number;
      observacoes: string | null;
      ticket_id: number | null;
      numero: string | null;
      assunto: string | null;
      solicitante: string | null;
      responsavel: string | null;
      nivel: string | null;
      status: string | null;
      origem_chamado: string | null;
      aberto_em: string | null;
      fechado_em: string | null;
      prazo_em: string | null;
      horas: number | null;
    }>
  ).map((l) => ({
    [COLUNA_EMPRESA]: l.empresa,
    Filial: l.filial ?? '',
    Competência: paraExibicao(l.competencia),
    Fila: l.fila,
    'Tópico de Ajuda': l.topico ?? '',
    'Total Atendidos': l.total_atendidos,
    'Dentro SLA': l.dentro_sla,
    'Fora SLA': l.fora_sla,
    // Vazio no registro agregado; preenchido quando a linha é um chamado.
    Ticket: l.ticket_id ?? '',
    'Número': l.numero ?? '',
    Assunto: l.assunto ?? '',
    Solicitante: l.solicitante ?? '',
    'Responsável': l.responsavel ?? '',
    'Nível': l.nivel ?? '',
    Status: l.status ?? '',
    Origem: l.origem_chamado ?? '',
    'Aberto em': l.aberto_em ?? '',
    'Fechado em': l.fechado_em ?? '',
    Prazo: l.prazo_em ?? '',
    Horas: l.horas ?? '',
    Observações: l.observacoes ?? '',
  }));
}

type Gerador = (ctx: Contexto, escopo: EscopoOperacao) => Array<Record<string, unknown>>;

const GERADORES: Record<NomeAba, Gerador> = {
  Filiais: linhasFiliais,
  TiposDespesa: linhasTiposDespesa,
  Cenarios: linhasCenarios,
  Financeiro: linhasFinanceiro,
  Projetos: linhasProjetos,
  Tarefas: linhasTarefas,
  Envolvidos: linhasEnvolvidos,
  TopicosAjuda: linhasTopicos,
  SLA: linhasSla,
};

function nomeCliente(ctx: Contexto): string {
  if (!ctx.clienteId) return 'cliente';
  const linha = db().prepare('SELECT nome FROM clientes WHERE id = ?').get(ctx.clienteId) as
    | { nome: string }
    | undefined;
  return linha?.nome ?? `cliente-${ctx.clienteId}`;
}

function nomesDasEmpresas(escopo: EscopoOperacao): string[] {
  if (escopo.empresas.length === 0) return [];
  const { sql, params } = clausulaEmpresas(escopo.empresas, 'id');
  return (
    db().prepare(`SELECT nome FROM empresas WHERE ${sql} ORDER BY nome`).all(...params) as Array<{ nome: string }>
  ).map((e) => e.nome);
}

/**
 * Aba de metadados: permite ao importador identificar a versão do template.
 *
 * Passou a trazer o cliente e o ESCOPO porque o arquivo deixou de ser de uma
 * matriz: quem abrir a planilha meses depois precisa saber o que ela cobre sem
 * ter de contar as linhas.
 */
function abaMeta(ctx: Contexto, escopo: EscopoOperacao): Aba {
  return {
    nome: '_meta',
    colunas: ['Versão do Template', 'Cliente', 'Escopo', 'Unidades', 'Empresas', 'Gerado em'],
    linhas: [
      {
        'Versão do Template': TEMPLATE_VERSAO_ATUAL,
        Cliente: nomeCliente(ctx),
        Escopo: escopo.modo,
        Unidades: resumoEscopo(escopo),
        Empresas: nomesDasEmpresas(escopo).join(' | '),
        'Gerado em': new Date().toISOString(),
      },
    ],
  };
}

export function montarAbas(ctx: Contexto, escopo: EscopoOperacao, modulo: Modulo, apenasTemplate = false): Aba[] {
  const abas = ABAS_POR_MODULO[modulo].map((nome) => ({
    nome,
    colunas: ABAS[nome].colunas,
    linhas: apenasTemplate ? [] : GERADORES[nome](ctx, escopo),
  }));
  // A aba de instruções fecha o arquivo: quem preenche à mão descobre as regras
  // nela, e não errando uma linha por vez. Ela é derivada da definição das
  // abas, então não tem como divergir do que a importação aceita.
  return [
    abaMeta(ctx, escopo),
    ...abas,
    { nome: ABA_INSTRUCOES, colunas: COLUNAS_INSTRUCOES, linhas: linhasDeInstrucoes(modulo) },
  ];
}

/** Quantas linhas de dado o arquivo levou — o total que vai para o ExportLog. */
export function contarLinhas(abas: Aba[]): number {
  return abas
    .filter((a) => a.nome !== '_meta' && a.nome !== ABA_INSTRUCOES)
    .reduce((soma, a) => soma + a.linhas.length, 0);
}

export async function exportarXlsx(
  ctx: Contexto,
  escopo: EscopoOperacao,
  modulo: Modulo,
  apenasTemplate = false,
): Promise<{ buffer: Buffer; linhas: number }> {
  const abas = montarAbas(ctx, escopo, modulo, apenasTemplate);
  return { buffer: await escreverXlsx(abas), linhas: contarLinhas(abas) };
}

export function exportarCsv(
  ctx: Contexto,
  escopo: EscopoOperacao,
  aba: NomeAba,
  apenasTemplate = false,
): { texto: string; linhas: number } {
  const linhas = apenasTemplate ? [] : GERADORES[aba](ctx, escopo);
  return { texto: escreverCsv(ABAS[aba].colunas, linhas), linhas: linhas.length };
}

function comoNomeDeArquivo(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/**
 * O nome do arquivo diz de quem ele é.
 *
 * Com o cliente inteiro, é o nome do cliente; com uma unidade só, o dela — que
 * é o nome de sempre, e mantém reconhecível o arquivo de quem não usa escopo
 * múltiplo. Com algumas unidades, o nome do cliente mais a contagem, porque
 * emendar seis nomes de empresa daria um arquivo que nenhum sistema aceita.
 */
export function nomeArquivoExportacao(
  ctx: Contexto,
  escopo: EscopoOperacao,
  modulo: Modulo,
  extensao: string,
  template = false,
): string {
  const nomes = nomesDasEmpresas(escopo);
  const base =
    escopo.modo === 'cliente'
      ? comoNomeDeArquivo(nomeCliente(ctx))
      : nomes.length === 1
        ? comoNomeDeArquivo(nomes[0]!)
        : `${comoNomeDeArquivo(nomeCliente(ctx))}-${nomes.length}-unidades`;
  const data = new Date().toISOString().slice(0, 10);
  return `${template ? 'template' : 'gsti'}-${modulo}-${base}-${data}.${extensao}`;
}

/**
 * Grava a linha do registro de exportação (o ExportLog).
 *
 * Exportar não escreve dado nenhum, mas é SAÍDA de dado — e o enunciado pede o
 * mesmo rastro que a importação tem: quem levou o quê, de quais unidades e
 * quando. Sem isto, a única pergunta sem resposta sobre o arquivo seria
 * justamente "de onde ele veio".
 */
export function registrarExportacao(
  ctx: Contexto,
  escopo: EscopoOperacao,
  dados: { modulo: Modulo; formato: string; arquivoNome: string; totalLinhas: number; template?: boolean },
): number {
  const info = db()
    .prepare(
      `INSERT INTO exportacoes
         (empresa_id, cliente_id, usuario_id, modulo, formato, escopo, escopo_unidades, arquivo_nome,
          total_linhas, template_versao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      escopo.empresas.length === 1 ? escopo.empresas[0]! : ctx.empresaId,
      ctx.clienteId,
      ctx.usuarioId,
      dados.modulo === 'completo' ? 'financeiro' : dados.modulo,
      dados.formato,
      escopo.modo,
      escopoParaLog(escopo),
      dados.arquivoNome,
      dados.totalLinhas,
      TEMPLATE_VERSAO_ATUAL,
    );
  const id = Number(info.lastInsertRowid);
  auditar(ctx, {
    entidade: 'exportacao',
    entidadeId: id,
    acao: 'exportar',
    depois: {
      modulo: dados.modulo,
      formato: dados.formato,
      escopo: escopo.modo,
      unidades: resumoEscopo(escopo),
      empresas: escopo.empresas.length,
      filiais: contarFiliais(escopo),
      arquivo: dados.arquivoNome,
      linhas: dados.totalLinhas,
      template: dados.template === true,
    },
  });
  return id;
}

export interface FiltroExportacoes {
  modulo?: string | null;
  escopo?: string | null;
  usuario_id?: number | null;
  de?: string | null;
  ate?: string | null;
}

/** O histórico de exportações do cliente, com os mesmos filtros do de cargas. */
export function listarExportacoes(ctx: Contexto, filtro: FiltroExportacoes = {}) {
  const condicoes = ['x.cliente_id IS ?'];
  const params: unknown[] = [ctx.clienteId];
  if (filtro.modulo) (condicoes.push('x.modulo = ?'), params.push(filtro.modulo));
  if (filtro.escopo) (condicoes.push('x.escopo = ?'), params.push(filtro.escopo));
  if (filtro.usuario_id) (condicoes.push('x.usuario_id = ?'), params.push(filtro.usuario_id));
  if (filtro.de) (condicoes.push('x.criado_em >= ?'), params.push(filtro.de));
  // O `ate` cobre o dia inteiro: quem escolhe uma data espera o dia dela junto.
  if (filtro.ate) (condicoes.push('x.criado_em <= ?'), params.push(`${filtro.ate} 23:59:59`));
  return db()
    .prepare(
      `SELECT x.id, x.modulo, x.formato, x.escopo, x.escopo_unidades, x.arquivo_nome, x.total_linhas,
              x.template_versao, x.criado_em, x.usuario_id, u.nome AS usuario, e.nome AS empresa
         FROM exportacoes x
         LEFT JOIN usuarios u ON u.id = x.usuario_id
         LEFT JOIN empresas e ON e.id = x.empresa_id
        WHERE ${condicoes.join(' AND ')}
        ORDER BY x.criado_em DESC, x.id DESC
        LIMIT 200`,
    )
    .all(...params);
}
