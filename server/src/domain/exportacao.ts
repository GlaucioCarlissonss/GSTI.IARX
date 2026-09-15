import { db } from '../db/index.js';
import { paraExibicao } from './competencia.js';
import type { Contexto } from './contexto.js';
import { paraReais } from './dinheiro.js';
import { ROTULO_ORIGEM, type Origem } from './financeiro.js';
import { escreverCsv, escreverXlsx, type Aba } from '../lib/planilha.js';
import {
  ABA_INSTRUCOES,
  ABAS,
  ABAS_POR_MODULO,
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

function linhasFiliais(ctx: Contexto) {
  return (
    db()
      .prepare('SELECT nome, cidade, uf, ativo FROM filiais WHERE empresa_id = ? ORDER BY nome')
      .all(ctx.empresaId) as Array<{ nome: string; cidade: string | null; uf: string | null; ativo: number }>
  ).map((l) => ({ Filial: l.nome, Cidade: l.cidade ?? '', UF: l.uf ?? '', Ativo: l.ativo ? 'Sim' : 'Não' }));
}

function linhasTiposDespesa(ctx: Contexto) {
  return (
    db()
      .prepare('SELECT nome, ativo FROM tipos_despesa WHERE empresa_id = ? ORDER BY nome')
      .all(ctx.empresaId) as Array<{ nome: string; ativo: number }>
  ).map((l) => ({ 'Tipo de Despesa': l.nome, Ativo: l.ativo ? 'Sim' : 'Não' }));
}

function linhasCenarios(ctx: Contexto) {
  return (
    db()
      .prepare('SELECT chave, nome, descricao FROM cenarios WHERE empresa_id = ? ORDER BY nome')
      .all(ctx.empresaId) as Array<{ chave: string; nome: string; descricao: string | null }>
  ).map((l) => ({ 'Cenário': l.chave, Nome: l.nome, 'Descrição': l.descricao ?? '' }));
}

function linhasFinanceiro(ctx: Contexto) {
  return (
    db()
      .prepare(
        `SELECT l.id, f.nome AS filial, t.nome AS tipo, l.competencia, l.valor_centavos, l.natureza,
                l.classificacao, l.qtd_parcelas, l.parcela_numero, l.lancamento_origem_id, l.cenario,
                l.origem, l.descricao, l.observacoes
           FROM lancamentos l
           JOIN tipos_despesa t ON t.id = l.tipo_despesa_id
           LEFT JOIN filiais f ON f.id = l.filial_id
          WHERE l.empresa_id = ? AND l.excluido_em IS NULL
          ORDER BY l.competencia, t.nome, l.id`,
      )
      .all(ctx.empresaId) as Array<{
      id: number;
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
    }>
  ).map((l) => ({
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
    Descrição: l.descricao ?? '',
    Observações: l.observacoes ?? '',
  }));
}

function linhasProjetos(ctx: Contexto) {
  return (
    db()
      .prepare(
        `SELECT p.nome, f.nome AS filial, p.descricao, p.mes_inicio, p.mes_fim_planejado, p.mes_fim_real, p.status
           FROM projetos p LEFT JOIN filiais f ON f.id = p.filial_id
          WHERE p.empresa_id = ? AND p.excluido_em IS NULL ORDER BY p.mes_inicio, p.nome`,
      )
      .all(ctx.empresaId) as Array<{
      nome: string;
      filial: string | null;
      descricao: string | null;
      mes_inicio: string;
      mes_fim_planejado: string;
      mes_fim_real: string | null;
      status: string;
    }>
  ).map((l) => ({
    Projeto: l.nome,
    Filial: l.filial ?? '',
    Descrição: l.descricao ?? '',
    'Mês Início': paraExibicao(l.mes_inicio),
    'Mês Fim Planejado': paraExibicao(l.mes_fim_planejado),
    'Mês Fim Real': l.mes_fim_real ? paraExibicao(l.mes_fim_real) : '',
    Status: l.status,
  }));
}

function linhasTarefas(ctx: Contexto) {
  return (
    db()
      .prepare(
        `SELECT p.nome AS projeto, t.nome, t.mes_inicio, t.mes_fim_planejado, t.mes_fim_real, t.responsavel, t.status,
                pai.nome AS tarefa_principal
           FROM tarefas t JOIN projetos p ON p.id = t.projeto_id
           LEFT JOIN tarefas pai ON pai.id = t.parent_task_id AND pai.excluido_em IS NULL
          WHERE p.empresa_id = ? AND t.excluido_em IS NULL AND p.excluido_em IS NULL
          ORDER BY p.nome, t.mes_inicio, t.id`,
      )
      .all(ctx.empresaId) as Array<{
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

function linhasEnvolvidos(ctx: Contexto) {
  return (
    db()
      .prepare(
        `SELECT p.nome AS projeto, e.nome, e.papel
           FROM envolvidos e JOIN projetos p ON p.id = e.projeto_id
          WHERE p.empresa_id = ? AND p.excluido_em IS NULL ORDER BY p.nome, e.nome`,
      )
      .all(ctx.empresaId) as Array<{ projeto: string; nome: string; papel: string | null }>
  ).map((l) => ({ Projeto: l.projeto, Envolvido: l.nome, Papel: l.papel ?? '' }));
}

function linhasTopicos(ctx: Contexto) {
  return (
    db()
      .prepare('SELECT nome, ativo FROM topicos_ajuda WHERE empresa_id = ? ORDER BY nome')
      .all(ctx.empresaId) as Array<{ nome: string; ativo: number }>
  ).map((l) => ({ 'Tópico de Ajuda': l.nome, Ativo: l.ativo ? 'Sim' : 'Não' }));
}

function linhasSla(ctx: Contexto) {
  return (
    db()
      .prepare(
        `SELECT f.nome AS filial, s.competencia, q.nome AS fila, ta.nome AS topico,
                s.total_atendidos, s.dentro_sla, s.fora_sla, s.observacoes,
                s.ticket_id, s.numero, s.assunto, s.solicitante, s.responsavel,
                s.nivel, s.status, s.origem_chamado, s.aberto_em, s.fechado_em, s.prazo_em, s.horas
           FROM tickets_sla s
           JOIN filas_ticket q ON q.id = s.fila_id
           LEFT JOIN topicos_ajuda ta ON ta.id = s.topico_ajuda_id
           LEFT JOIN filiais f ON f.id = s.filial_id
          WHERE s.empresa_id = ? AND s.excluido_em IS NULL
          ORDER BY s.competencia, q.ordem, ta.nome`,
      )
      .all(ctx.empresaId) as Array<{
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

const GERADORES: Record<NomeAba, (ctx: Contexto) => Array<Record<string, unknown>>> = {
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

/** Aba de metadados: permite ao importador identificar a versão do template. */
function abaMeta(empresaNome: string): Aba {
  return {
    nome: '_meta',
    colunas: ['Versão do Template', 'Empresa', 'Gerado em'],
    linhas: [
      {
        'Versão do Template': TEMPLATE_VERSAO_ATUAL,
        Empresa: empresaNome,
        'Gerado em': new Date().toISOString(),
      },
    ],
  };
}

function nomeEmpresa(ctx: Contexto): string {
  const linha = db().prepare('SELECT nome FROM empresas WHERE id = ?').get(ctx.empresaId) as
    | { nome: string }
    | undefined;
  return linha?.nome ?? `empresa-${ctx.empresaId}`;
}

export function montarAbas(ctx: Contexto, modulo: Modulo, apenasTemplate = false): Aba[] {
  const abas = ABAS_POR_MODULO[modulo].map((nome) => ({
    nome,
    colunas: ABAS[nome].colunas,
    linhas: apenasTemplate ? [] : GERADORES[nome](ctx),
  }));
  // A aba de instruções fecha o arquivo: quem preenche à mão descobre as regras
  // nela, e não errando uma linha por vez. Ela é derivada da definição das
  // abas, então não tem como divergir do que a importação aceita.
  return [
    abaMeta(nomeEmpresa(ctx)),
    ...abas,
    { nome: ABA_INSTRUCOES, colunas: COLUNAS_INSTRUCOES, linhas: linhasDeInstrucoes(modulo) },
  ];
}

export async function exportarXlsx(ctx: Contexto, modulo: Modulo, apenasTemplate = false): Promise<Buffer> {
  return escreverXlsx(montarAbas(ctx, modulo, apenasTemplate));
}

export function exportarCsv(ctx: Contexto, aba: NomeAba, apenasTemplate = false): string {
  return escreverCsv(ABAS[aba].colunas, apenasTemplate ? [] : GERADORES[aba](ctx));
}

export function nomeArquivoExportacao(ctx: Contexto, modulo: Modulo, extensao: string, template = false): string {
  const base = nomeEmpresa(ctx)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  const data = new Date().toISOString().slice(0, 10);
  return `${template ? 'template' : 'gsti'}-${modulo}-${base}-${data}.${extensao}`;
}
