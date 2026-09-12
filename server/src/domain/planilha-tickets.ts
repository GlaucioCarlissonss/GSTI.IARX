/**
 * Planilha de chamados: exportação com os filtros da tela e importação com
 * pré-visualização.
 *
 * O template tem duas abas. `Tickets` carrega os dados; `Instruções` explica
 * cada coluna, os valores aceitos e um exemplo — sem ela, quem preenche à mão
 * descobre as regras errando, uma linha por vez.
 *
 * A identidade é a mesma do webhook: `(source_system, external_id)`. Um único
 * mecanismo serve aos dois caminhos, e é isso que faz reimportar um arquivo já
 * importado atualizar em vez de duplicar.
 */
import { db } from '../db/index.js';
import { erroValidacao } from '../lib/erros.js';
import { lerXlsx, type Aba } from '../lib/planilha.js';
import type { Contexto } from './contexto.js';
import {
  gravarChamado,
  listarChamados,
  type ChamadoNormalizado,
  type FiltroChamados,
  type Prioridade,
  type SistemaOrigem,
  type StatusChamado,
} from './suporte.js';
import { SETOR_NAO_CLASSIFICADO } from './cadastros.js';

export const ABA_TICKETS = 'Tickets';
export const ABA_INSTRUCOES = 'Instruções';

/** As colunas do template, na ordem. É o contrato do arquivo. */
export const COLUNAS_TICKET = [
  'external_id',
  'source_system',
  'title',
  'description',
  'status',
  'priority',
  'sector',
  'attendant_name',
  'requester_name',
  'requester_email',
  'created_at',
  'synced_at',
  'last_sync_status',
] as const;

const SISTEMAS: SistemaOrigem[] = ['OSTICK', 'BITRIX24'];
const STATUS: StatusChamado[] = ['open', 'in_progress', 'resolved', 'closed'];
const PRIORIDADES: Prioridade[] = ['low', 'medium', 'high', 'urgent'];

/** Uma linha por coluna, explicando o que é, o que aceita e um exemplo. */
const INSTRUCOES: Array<{ Coluna: string; Obrigatória: string; 'O que é': string; 'Valores aceitos': string; Exemplo: string }> = [
  { Coluna: 'external_id', Obrigatória: 'Sim', 'O que é': 'Identificador do chamado no sistema de origem. Junto com source_system, é o que evita duplicar.', 'Valores aceitos': 'Texto livre, não vazio', Exemplo: '21734' },
  { Coluna: 'source_system', Obrigatória: 'Sim', 'O que é': 'De qual helpdesk o chamado veio.', 'Valores aceitos': SISTEMAS.join(' | '), Exemplo: 'OSTICK' },
  { Coluna: 'title', Obrigatória: 'Sim', 'O que é': 'Assunto do chamado.', 'Valores aceitos': 'Texto livre, não vazio', Exemplo: 'Impressora sem toner' },
  { Coluna: 'description', Obrigatória: 'Não', 'O que é': 'Descrição completa do chamado.', 'Valores aceitos': 'Texto livre', Exemplo: 'A impressora do 3º andar parou de imprimir.' },
  { Coluna: 'status', Obrigatória: 'Não', 'O que é': 'Situação do atendimento. Em branco entra como open.', 'Valores aceitos': STATUS.join(' | '), Exemplo: 'closed' },
  { Coluna: 'priority', Obrigatória: 'Não', 'O que é': 'Prioridade. Em branco entra como medium.', 'Valores aceitos': PRIORIDADES.join(' | '), Exemplo: 'high' },
  { Coluna: 'sector', Obrigatória: 'Não', 'O que é': `Área que abriu o chamado. Em branco entra como "${SETOR_NAO_CLASSIFICADO}".`, 'Valores aceitos': 'Texto livre', Exemplo: 'Enfermagem' },
  { Coluna: 'attendant_name', Obrigatória: 'Não', 'O que é': 'Quem atendeu.', 'Valores aceitos': 'Texto livre', Exemplo: 'Carlos Souza' },
  { Coluna: 'requester_name', Obrigatória: 'Não', 'O que é': 'Quem abriu o chamado.', 'Valores aceitos': 'Texto livre', Exemplo: 'Ana Lima' },
  { Coluna: 'requester_email', Obrigatória: 'Não', 'O que é': 'E-mail de quem abriu.', 'Valores aceitos': 'Endereço de e-mail válido', Exemplo: 'ana.lima@empresa.com' },
  { Coluna: 'created_at', Obrigatória: 'Não', 'O que é': 'Quando o chamado foi aberto. Define a competência do registro.', 'Valores aceitos': 'ISO 8601 ou dd/mm/aaaa hh:mm', Exemplo: '10/09/2026 08:30' },
  { Coluna: 'synced_at', Obrigatória: 'Não', 'O que é': 'Somente leitura: quando este SaaS sincronizou o chamado pela última vez.', 'Valores aceitos': 'Preenchido na exportação; ignorado na importação', Exemplo: '2026-09-12T14:00:00Z' },
  { Coluna: 'last_sync_status', Obrigatória: 'Não', 'O que é': 'Somente leitura: como terminou a última sincronização.', 'Valores aceitos': 'Preenchido na exportação; ignorado na importação', Exemplo: 'processed' },
];

// ------------------------------------------------------------- exportação

interface LinhaExportada {
  external_id: string | null;
  source_system: string | null;
  assunto: string | null;
  descricao: string | null;
  status: string | null;
  prioridade: string | null;
  setor: string | null;
  responsavel: string | null;
  solicitante: string | null;
  solicitante_email: string | null;
  aberto_em: string | null;
  synced_at: string | null;
}

/**
 * Chamados do recorte, prontos para a aba `Tickets`. O filtro é o da tela: um
 * arquivo com tudo, quando a tela mostrava um recorte, não é o que o gestor
 * pediu ao clicar em exportar.
 */
export function linhasDeTickets(ctx: Contexto, filtro: FiltroChamados = {}) {
  // Teto alto e explícito: uma planilha de 50 mil linhas trava o Excel antes
  // de ajudar, e o gestor tem os filtros para estreitar.
  const pagina = listarChamados(ctx.empresaId, { ...filtro, limite: 500, pagina: 1 });
  const total = pagina.paginacao.total;
  const itens: LinhaExportada[] = [];
  for (let p = 1; p <= Math.min(pagina.paginacao.paginas, 40); p++) {
    const lote = listarChamados(ctx.empresaId, { ...filtro, limite: 500, pagina: p });
    itens.push(...(lote.itens as unknown as LinhaExportada[]));
  }

  // O último evento de integração de cada chamado responde "como terminou a
  // última sincronização" sem consultar o log linha a linha na planilha.
  const ultimoStatus = new Map<string, string>();
  for (const linha of db()
    .prepare(
      `SELECT source_system, external_id, status FROM integracao_evento
        WHERE empresa_id = ? AND external_id IS NOT NULL
        ORDER BY criado_em ASC`,
    )
    .all(ctx.empresaId) as Array<{ source_system: string; external_id: string; status: string }>) {
    ultimoStatus.set(`${linha.source_system}|${linha.external_id}`, linha.status);
  }

  return {
    total,
    exportadas: itens.length,
    linhas: itens.map((c) => ({
      external_id: c.external_id ?? '',
      source_system: c.source_system ?? '',
      title: c.assunto ?? '',
      description: c.descricao ?? '',
      status: c.status ?? '',
      priority: c.prioridade ?? '',
      sector: c.setor ?? '',
      attendant_name: c.responsavel ?? '',
      requester_name: c.solicitante ?? '',
      requester_email: c.solicitante_email ?? '',
      created_at: c.aberto_em ?? '',
      synced_at: c.synced_at ?? '',
      last_sync_status: ultimoStatus.get(`${c.source_system}|${c.external_id}`) ?? '',
    })),
  };
}

/** As duas abas do arquivo. `apenasTemplate` devolve a de dados vazia. */
export function abasDeTickets(ctx: Contexto, filtro: FiltroChamados = {}, apenasTemplate = false): Aba[] {
  const dados = apenasTemplate ? { linhas: [] as Array<Record<string, unknown>>, total: 0, exportadas: 0 } : linhasDeTickets(ctx, filtro);
  return [
    { nome: ABA_TICKETS, colunas: [...COLUNAS_TICKET], linhas: dados.linhas },
    {
      nome: ABA_INSTRUCOES,
      colunas: ['Coluna', 'Obrigatória', 'O que é', 'Valores aceitos', 'Exemplo'],
      linhas: INSTRUCOES,
    },
  ];
}

// ------------------------------------------------------------- importação

export interface LinhaValidada {
  /** Número da linha no arquivo, contando o cabeçalho — é o que o Excel mostra. */
  linha: number;
  valida: boolean;
  mensagem: string | null;
  external_id: string;
  source_system: string;
  title: string;
  /** `criar` ou `atualizar`: o gestor vê o efeito antes de confirmar. */
  efeito: 'criar' | 'atualizar' | null;
}

export interface PreviaImportacao {
  total: number;
  validas: number;
  invalidas: number;
  a_criar: number;
  a_atualizar: number;
  linhas: LinhaValidada[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Data em ISO 8601 ou no formato brasileiro. Devolve ISO, ou `null` quando o
 * campo está vazio — e lança quando está preenchido e ilegível, porque aí é
 * erro de quem preencheu, não ausência de dado.
 */
function lerData(bruto: unknown, coluna: string): string | null {
  const texto = String(bruto ?? '').trim();
  if (!texto) return null;
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) {
    const [, d, m, a, hh = '00', mm = '00', ss = '00'] = br;
    return `${a}-${m}-${d}T${hh}:${mm}:${ss}`;
  }
  const data = new Date(texto);
  if (Number.isNaN(data.getTime())) {
    throw erroValidacao(`${coluna}: "${texto}" não é uma data. Use ISO 8601 ou dd/mm/aaaa hh:mm.`);
  }
  return data.toISOString();
}

/** Converte uma linha do arquivo no chamado normalizado, ou explica o motivo. */
function interpretarLinha(bruto: Record<string, unknown>): ChamadoNormalizado {
  const texto = (c: string) => String(bruto[c] ?? '').trim();

  const externalId = texto('external_id');
  if (!externalId) throw erroValidacao('external_id é obrigatório.');

  const sistema = texto('source_system').toUpperCase() as SistemaOrigem;
  if (!SISTEMAS.includes(sistema)) {
    throw erroValidacao(`source_system precisa ser ${SISTEMAS.join(' ou ')}; veio "${texto('source_system')}".`);
  }

  const titulo = texto('title');
  if (!titulo) throw erroValidacao('title é obrigatório.');

  const status = (texto('status').toLowerCase() || 'open') as StatusChamado;
  if (!STATUS.includes(status)) {
    throw erroValidacao(`status precisa ser um de ${STATUS.join(', ')}; veio "${texto('status')}".`);
  }

  const prioridade = (texto('priority').toLowerCase() || 'medium') as Prioridade;
  if (!PRIORIDADES.includes(prioridade)) {
    throw erroValidacao(`priority precisa ser um de ${PRIORIDADES.join(', ')}; veio "${texto('priority')}".`);
  }

  const email = texto('requester_email');
  if (email && !EMAIL.test(email)) {
    throw erroValidacao(`requester_email: "${email}" não é um endereço válido.`);
  }

  return {
    source_system: sistema,
    external_id: externalId,
    title: titulo,
    description: texto('description') || null,
    status,
    priority: prioridade,
    sector: texto('sector') || SETOR_NAO_CLASSIFICADO,
    attendant_id: null,
    attendant_name: texto('attendant_name') || null,
    requester_id: null,
    requester_name: texto('requester_name') || null,
    requester_email: email || null,
    queue: null,
    topic: null,
    branch: null,
    opened_at: lerData(bruto.created_at, 'created_at'),
    closed_at: null,
    due_at: null,
    hours: null,
  };
}

/** Localiza a aba de dados, aceitando o nome com ou sem acento. */
function abaDeDados(abas: Aba[]): Aba {
  const alvo = abas.find((a) => a.nome.trim().toLowerCase() === ABA_TICKETS.toLowerCase());
  if (!alvo) {
    throw erroValidacao(
      `O arquivo precisa ter a aba "${ABA_TICKETS}". Baixe o modelo para partir da estrutura certa.`,
    );
  }
  const faltando = ['external_id', 'source_system', 'title'].filter(
    (c) => !alvo.colunas.some((x) => x.trim().toLowerCase() === c),
  );
  if (faltando.length) {
    throw erroValidacao(`A aba "${ABA_TICKETS}" está sem as colunas obrigatórias: ${faltando.join(', ')}.`);
  }
  return alvo;
}

/**
 * Valida o arquivo sem gravar nada. É o que alimenta a pré-visualização: o
 * gestor vê linha a linha o que vai acontecer antes de confirmar.
 */
export async function previewDeTickets(ctx: Contexto, arquivo: Buffer): Promise<PreviaImportacao> {
  const aba = abaDeDados(await lerXlsx(arquivo));

  const jaExiste = db().prepare(
    'SELECT id FROM tickets_sla WHERE empresa_id = ? AND source_system = ? AND external_id = ? AND excluido_em IS NULL',
  );

  const vistos = new Map<string, number>();
  const linhas: LinhaValidada[] = aba.linhas.map((bruto, i) => {
    // +2: a linha 1 é o cabeçalho, e o Excel conta a partir de 1.
    const numero = i + 2;
    const base = {
      linha: numero,
      external_id: String(bruto.external_id ?? '').trim(),
      source_system: String(bruto.source_system ?? '').trim().toUpperCase(),
      title: String(bruto.title ?? '').trim(),
    };
    try {
      const chamado = interpretarLinha(bruto);
      const chave = `${chamado.source_system}|${chamado.external_id}`;
      // Duplicata DENTRO do arquivo é erro, e não upsert: das duas linhas, o
      // sistema não tem como saber qual é a boa.
      const anterior = vistos.get(chave);
      if (anterior !== undefined) {
        return { ...base, valida: false, efeito: null,
          mensagem: `external_id repetido no arquivo: já apareceu na linha ${anterior}.` };
      }
      vistos.set(chave, numero);

      const existente = jaExiste.get(ctx.empresaId, chamado.source_system, chamado.external_id);
      return { ...base, valida: true, mensagem: null, efeito: existente ? 'atualizar' : 'criar' };
    } catch (erro) {
      return { ...base, valida: false, efeito: null,
        mensagem: erro instanceof Error ? erro.message : String(erro) };
    }
  });

  return {
    total: linhas.length,
    validas: linhas.filter((l) => l.valida).length,
    invalidas: linhas.filter((l) => !l.valida).length,
    a_criar: linhas.filter((l) => l.efeito === 'criar').length,
    a_atualizar: linhas.filter((l) => l.efeito === 'atualizar').length,
    linhas,
  };
}

export interface ResultadoTickets {
  total: number;
  criados: number;
  atualizados: number;
  rejeitados: number;
  erros: Array<{ linha: number; external_id: string; mensagem: string }>;
}

/**
 * Grava o que é válido e reporta o resto. A linha inválida não derruba as boas
 * — recusar o arquivo inteiro por causa de uma linha faria o gestor refazer o
 * trabalho todo por um erro de digitação.
 */
export async function importarTickets(ctx: Contexto, arquivo: Buffer): Promise<ResultadoTickets> {
  const aba = abaDeDados(await lerXlsx(arquivo));
  const previa = await previewDeTickets(ctx, arquivo);

  let criados = 0;
  let atualizados = 0;
  const erros: ResultadoTickets['erros'] = [];

  previa.linhas.forEach((validada, i) => {
    if (!validada.valida) {
      erros.push({ linha: validada.linha, external_id: validada.external_id, mensagem: validada.mensagem ?? 'inválida' });
      return;
    }
    try {
      const bruto = aba.linhas[i] as Record<string, unknown>;
      const gravado = gravarChamado(ctx.empresaId, interpretarLinha(bruto), bruto);
      if (gravado.criado) criados++;
      else atualizados++;
    } catch (erro) {
      erros.push({
        linha: validada.linha,
        external_id: validada.external_id,
        mensagem: erro instanceof Error ? erro.message : String(erro),
      });
    }
  });

  return { total: previa.total, criados, atualizados, rejeitados: erros.length, erros };
}

/** Aba com as linhas recusadas, para o gestor corrigir e reenviar só elas. */
export function abaDeErros(erros: ResultadoTickets['erros']): Aba[] {
  return [
    {
      nome: 'Erros',
      colunas: ['Linha', 'external_id', 'Motivo'],
      linhas: erros.map((e) => ({ Linha: e.linha, external_id: e.external_id, Motivo: e.mensagem })),
    },
  ];
}
