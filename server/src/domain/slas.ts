/**
 * ACORDOS DE NÍVEL DE SERVIÇO — quantas horas um chamado tem.
 *
 * Antes deste cadastro, o prazo vinha pronto da origem (`due_at` do helpdesk).
 * Quando a origem não mandava, o sistema contava o chamado fechado como dentro
 * e o aberto como fora — que não é um acordo, é a ausência de um.
 *
 * A regra é por (tópico de ajuda, prioridade), e o tópico nulo é a REGRA GERAL
 * daquela prioridade. A integração cria tópico sozinha (`resolverTopicoAjuda`
 * com `criarSeAusente`), então exigir uma linha por tópico deixaria chamados
 * sem acordo sem ninguém perceber; a regra geral cobre o que aparecer.
 *
 * O acordo cadastrado TEM PRECEDÊNCIA sobre o prazo que o helpdesk informa:
 * ele é o compromisso que o grupo negociou, e o `due_at` da origem é a conta
 * que a ferramenta fez. O prazo da origem não se perde — fica em
 * `tickets_sla.prazo_origem`, e a ficha do chamado mostra os dois.
 *
 * O cadastro ainda NÃO reescreve o passado sozinho: ele decide o prazo na hora
 * em que o chamado entra. Para alcançar o que já está gravado existe a
 * reaplicação por competência (`reaplicarAcordos`), que é explícita, conta o
 * que mudou e recusa mês fechado — mudar número já conferido é decisão de
 * alguém, nunca efeito colateral de um cadastro.
 *
 * A VIGÊNCIA é em data, e quem decide qual acordo vale é a ABERTURA do
 * chamado. Passar de 24h para 8h hoje não pode rejulgar o chamado da semana
 * passada, que correu contra o compromisso de então.
 */
import { db } from '../db/index.js';
import { erroConflito, erroNaoEncontrado, erroValidacao } from '../lib/erros.js';
import { auditar } from './auditoria.js';
import { paraExibicao, paraInterno } from './competencia.js';
import type { Contexto } from './contexto.js';
import { garantirCompetenciaEditavel } from './fechamento.js';

export type Prioridade = 'low' | 'medium' | 'high' | 'urgent';

export const PRIORIDADES: Prioridade[] = ['low', 'medium', 'high', 'urgent'];

export const ROTULO_PRIORIDADE: Record<Prioridade, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente',
};

export interface LinhaSla {
  id: number;
  topico_ajuda_id: number | null;
  topico: string | null;
  prioridade: Prioridade;
  horas: number;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  ativo: number;
}

/** As colunas do acordo, na ordem, para as três consultas não divergirem. */
const CAMPOS_SLA = `s.id, s.topico_ajuda_id, t.nome AS topico, s.prioridade, s.horas,
         s.vigencia_inicio, s.vigencia_fim, s.ativo`;

function validarPrioridade(valor: unknown): Prioridade {
  const texto = String(valor ?? '').trim().toLowerCase();
  const porRotulo = (Object.keys(ROTULO_PRIORIDADE) as Prioridade[]).find(
    (k) => ROTULO_PRIORIDADE[k].toLowerCase() === texto,
  );
  const chave = PRIORIDADES.includes(texto as Prioridade) ? (texto as Prioridade) : porRotulo;
  if (!chave) throw erroValidacao(`Prioridade inválida. Use uma de: ${PRIORIDADES.join(', ')}.`);
  return chave;
}

function validarHoras(valor: unknown): number {
  const n = Number(String(valor ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) throw erroValidacao('As horas de atendimento precisam ser um número maior que zero.');
  return Math.round(n * 100) / 100;
}

/**
 * Data opcional de vigência: vazio vira nulo, preenchido tem de ser real.
 *
 * Aceita `DD/MM/AAAA`, que é como a tela escreve, e `AAAA-MM-DD`, que é como o
 * banco guarda — a API é usada pelas duas pontas. A conferência de dia/mês é
 * explícita porque `new Date('31/02/2026')` não reclama: ele rola para março,
 * e uma vigência que começa num dia que não existe é um erro silencioso.
 */
function dataOpcional(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null || String(valor).trim() === '') return null;
  const texto = String(valor).trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  const [ano, mes, dia] = br
    ? [Number(br[3]), Number(br[2]), Number(br[1])]
    : iso
      ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
      : [NaN, NaN, NaN];
  if (!Number.isFinite(ano)) throw erroValidacao(`${campo} inválida. Use o formato DD/MM/AAAA.`);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    throw erroValidacao(`${campo} inválida: não existe ${texto} no calendário.`);
  }
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** O tópico precisa ser da mesma unidade. Nulo é a regra geral, e é válido. */
function validarTopico(empresaId: number, valor: unknown): number | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const id = Number(valor);
  if (!Number.isInteger(id)) throw erroValidacao('Tópico de ajuda inválido.');
  const linha = db().prepare('SELECT id FROM topicos_ajuda WHERE id = ? AND empresa_id = ?').get(id, empresaId);
  if (!linha) throw erroValidacao(`Tópico de ajuda ${id} não pertence a esta unidade.`);
  return id;
}

export function listarSlas(ctx: Contexto, incluirInativos = false): LinhaSla[] {
  return db()
    .prepare(
      `SELECT ${CAMPOS_SLA}
         FROM slas s
         LEFT JOIN topicos_ajuda t ON t.id = s.topico_ajuda_id
        WHERE s.empresa_id = ? ${incluirInativos ? '' : 'AND s.ativo = 1'}
        ORDER BY COALESCE(t.nome, ''), s.prioridade, COALESCE(s.vigencia_inicio, '')`,
    )
    .all(ctx.empresaId) as LinhaSla[];
}

export interface EntradaSla {
  topico_ajuda_id?: unknown;
  prioridade?: unknown;
  horas?: unknown;
  vigencia_inicio?: unknown;
  vigencia_fim?: unknown;
}

/** `DD/MM/AAAA` para a mensagem de erro; nulo vira a ponta aberta. */
function periodoEmTexto(inicio: string | null, fim: string | null): string {
  const br = (d: string) => d.split('-').reverse().join('/');
  if (!inicio && !fim) return 'sem vigência definida';
  if (!inicio) return `até ${br(fim!)}`;
  if (!fim) return `a partir de ${br(inicio)}`;
  return `de ${br(inicio)} a ${br(fim)}`;
}

/**
 * O acordo que disputa o mesmo período, ou nada.
 *
 * Com vigência, dois acordos para a mesma (prioridade, tópico) são legítimos —
 * é assim que se troca 24h por 8h sem apagar a regra antiga. O que não pode é
 * haver dois valendo ao mesmo tempo: aí o chamado teria dois prazos, e o
 * desempate seria arbitrário. Por isso a recusa é por SOBREPOSIÇÃO, e não mais
 * por existência.
 *
 * Nulo é ponta aberta dos dois lados, o que torna a comparação assimétrica —
 * daí os `? IS NULL OR` em cada teste.
 */
function acordoQueSobrepoe(
  empresaId: number,
  prioridade: Prioridade,
  topicoId: number | null,
  inicio: string | null,
  fim: string | null,
  ignorarId?: number,
): LinhaSla | undefined {
  return db()
    .prepare(
      `SELECT ${CAMPOS_SLA}
         FROM slas s
         LEFT JOIN topicos_ajuda t ON t.id = s.topico_ajuda_id
        WHERE s.empresa_id = ? AND s.prioridade = ? AND s.topico_ajuda_id IS ?
          AND s.ativo = 1 AND s.id IS NOT ?
          AND (? IS NULL OR s.vigencia_fim    IS NULL OR ? <= s.vigencia_fim)
          AND (? IS NULL OR s.vigencia_inicio IS NULL OR s.vigencia_inicio <= ?)
        LIMIT 1`,
    )
    .get(empresaId, prioridade, topicoId, ignorarId ?? null, inicio, inicio, fim, fim) as
    | LinhaSla
    | undefined;
}

/** Início depois do fim não é período, é engano de digitação. */
function validarPeriodo(inicio: string | null, fim: string | null): void {
  if (inicio && fim && inicio > fim) {
    throw erroValidacao('A vigência termina antes de começar. Confira as duas datas.');
  }
}

export function criarSla(ctx: Contexto, dados: EntradaSla): LinhaSla {
  const topicoId = validarTopico(ctx.empresaId, dados.topico_ajuda_id);
  const prioridade = validarPrioridade(dados.prioridade);
  const horas = validarHoras(dados.horas);
  const inicio = dataOpcional(dados.vigencia_inicio, 'Vigência de');
  const fim = dataOpcional(dados.vigencia_fim, 'Vigência até');
  validarPeriodo(inicio, fim);

  // `UNIQUE` não serve aqui: no SQLite dois NULL são distintos, e a regra geral
  // (tópico nulo) poderia ser cadastrada duas vezes para a mesma prioridade.
  const conflito = acordoQueSobrepoe(ctx.empresaId, prioridade, topicoId, inicio, fim);
  if (conflito) {
    throw erroConflito(
      `${topicoId ? 'Já existe um acordo para este tópico' : 'Já existe uma regra geral'} nesta ` +
        `prioridade valendo no mesmo período (${periodoEmTexto(conflito.vigencia_inicio, conflito.vigencia_fim)}). ` +
        'Encerre a vigência do acordo anterior ou escolha outro período.',
    );
  }

  const info = db()
    .prepare(
      `INSERT INTO slas (empresa_id, topico_ajuda_id, prioridade, horas, vigencia_inicio, vigencia_fim)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(ctx.empresaId, topicoId, prioridade, horas, inicio, fim);
  const id = Number(info.lastInsertRowid);
  auditar(ctx, {
    entidade: 'sla',
    entidadeId: id,
    acao: 'criar',
    depois: { prioridade, horas, topico_ajuda_id: topicoId, vigencia_inicio: inicio, vigencia_fim: fim },
  });
  return obterSla(ctx, id);
}

export function obterSla(ctx: Contexto, id: number): LinhaSla {
  const linha = db()
    .prepare(
      `SELECT ${CAMPOS_SLA}
         FROM slas s
         LEFT JOIN topicos_ajuda t ON t.id = s.topico_ajuda_id
        WHERE s.id = ? AND s.empresa_id = ?`,
    )
    .get(id, ctx.empresaId) as LinhaSla | undefined;
  if (!linha) throw erroNaoEncontrado(`Acordo de SLA ${id} não encontrado nesta unidade.`);
  return linha;
}

export function atualizarSla(ctx: Contexto, id: number, dados: EntradaSla & { ativo?: unknown }): LinhaSla {
  const antes = obterSla(ctx, id);
  const horas = dados.horas === undefined ? antes.horas : validarHoras(dados.horas);
  const ativo = dados.ativo === undefined ? antes.ativo : dados.ativo ? 1 : 0;
  const inicio =
    dados.vigencia_inicio === undefined ? antes.vigencia_inicio : dataOpcional(dados.vigencia_inicio, 'Vigência de');
  const fim =
    dados.vigencia_fim === undefined ? antes.vigencia_fim : dataOpcional(dados.vigencia_fim, 'Vigência até');
  validarPeriodo(inicio, fim);

  // Só o acordo ATIVO disputa período: reativar ou esticar a vigência de um
  // acordo pode colidir com outro que nasceu no intervalo, e essa colisão tem
  // de ser recusada aqui, não descoberta depois por um chamado com dois prazos.
  if (ativo === 1) {
    const conflito = acordoQueSobrepoe(ctx.empresaId, antes.prioridade, antes.topico_ajuda_id, inicio, fim, id);
    if (conflito) {
      throw erroConflito(
        'Outro acordo desta prioridade já vale nesse período ' +
          `(${periodoEmTexto(conflito.vigencia_inicio, conflito.vigencia_fim)}).`,
      );
    }
  }

  db()
    .prepare(
      `UPDATE slas SET horas = ?, ativo = ?, vigencia_inicio = ?, vigencia_fim = ?
        WHERE id = ? AND empresa_id = ?`,
    )
    .run(horas, ativo, inicio, fim, id, ctx.empresaId);
  const depois = obterSla(ctx, id);
  auditar(ctx, { entidade: 'sla', entidadeId: id, acao: 'atualizar', antes, depois });
  return depois;
}

/**
 * As horas que valem para este chamado — ou `null` se não há acordo.
 *
 * O acordo do tópico ganha do geral: cadastrar "Rede: 4h para alta" e "geral:
 * 24h para alta" quer dizer que rede é mais exigente, não que as duas regras
 * competem. `null` devolve o comportamento anterior ao cadastro, que é o que
 * mantém toda base existente lendo como lia.
 */
export function horasDoAcordo(
  empresaId: number,
  prioridade: string | null | undefined,
  topicoAjudaId: number | null,
  /**
   * A abertura do chamado — é ela que escolhe entre acordos de vigências
   * diferentes. Ausente, vale o acordo sem vigência definida: um chamado sem
   * data de abertura não tem como ser encaixado numa linha do tempo, e
   * arbitrar "hoje" faria a regra de hoje julgar um chamado de origem
   * desconhecida.
   */
  abertoEm?: string | null,
): number | null {
  const chave = String(prioridade ?? '').trim().toLowerCase();
  if (!PRIORIDADES.includes(chave as Prioridade)) return null;
  const dia = abertoEm ? String(abertoEm).slice(0, 10) : null;
  const linha = db()
    .prepare(
      `SELECT horas FROM slas
        WHERE empresa_id = ? AND prioridade = ? AND ativo = 1
          AND (topico_ajuda_id IS ? OR topico_ajuda_id IS NULL)
          AND (vigencia_inicio IS NULL OR (? IS NOT NULL AND vigencia_inicio <= ?))
          AND (vigencia_fim    IS NULL OR (? IS NOT NULL AND vigencia_fim    >= ?))
        ORDER BY topico_ajuda_id IS NULL, COALESCE(vigencia_inicio, '') DESC
        LIMIT 1`,
    )
    .get(empresaId, chave, topicoAjudaId, dia, dia, dia, dia) as { horas: number } | undefined;
  return linha?.horas ?? null;
}

/**
 * O prazo derivado do acordo: abertura + horas, em ISO.
 *
 * Horas corridas, e não horas úteis: o sistema não tem calendário de
 * expediente cadastrado, e inventar um (segunda a sexta, 9 às 18) criaria um
 * prazo que nenhum contrato assinou.
 */
export function prazoDoAcordo(
  empresaId: number,
  abertoEm: string | null | undefined,
  prioridade: string | null | undefined,
  topicoAjudaId: number | null,
): string | null {
  if (!abertoEm) return null;
  const horas = horasDoAcordo(empresaId, prioridade, topicoAjudaId, abertoEm);
  if (horas === null) return null;
  const inicio = new Date(abertoEm);
  if (Number.isNaN(inicio.getTime())) return null;
  return new Date(inicio.getTime() + horas * 3600_000).toISOString();
}

// ===========================================================================
// Reaplicação: alcançar o chamado que já está gravado
// ===========================================================================
//
// O cadastro decide o prazo na ENTRADA do chamado. Quem cadastra um acordo
// hoje, porém, quer saber como o mês passado teria sido medido por ele — e a
// base carregada por planilha nasceu inteira antes de existir acordo nenhum.
//
// Recalcular sozinho seria pior que não recalcular: um número apresentado numa
// reunião mudaria porque alguém mexeu num cadastro. Por isso a reaplicação é
// um ato: escolhe-se a competência, vê-se o que muda, e só então se aplica —
// com contagem, justificativa quando o mês já passou e uma linha de auditoria.

export interface ResumoReaplicacao {
  competencia: string;
  /** Chamados do mês que a reaplicação olhou (o agregado não entra na conta). */
  avaliados: number;
  alterados: number;
  virou_dentro: number;
  virou_fora: number;
  sem_prioridade: number;
  sem_acordo: number;
  agregados_ignorados: number;
}

interface LinhaChamado {
  id: number;
  aberto_em: string | null;
  fechado_em: string | null;
  prioridade: string | null;
  topico_ajuda_id: number | null;
  prazo_em: string | null;
  prazo_origem: string | null;
  dentro_sla: number;
  total_atendidos: number;
}

interface Mudanca {
  id: number;
  prazo: string;
  dentro: number;
  antes_dentro: number;
}

/**
 * O que mudaria nesta competência, sem gravar nada.
 *
 * A mesma passada serve à prévia e à aplicação: se as duas contassem por
 * caminhos diferentes, a tela prometeria um número e o botão faria outro.
 */
function avaliarReaplicacao(
  empresaId: number,
  competencia: string,
): { resumo: ResumoReaplicacao; mudancas: Mudanca[] } {
  const linhas = db()
    .prepare(
      `SELECT id, aberto_em, fechado_em, prioridade, topico_ajuda_id,
              prazo_em, prazo_origem, dentro_sla, total_atendidos
         FROM tickets_sla
        WHERE empresa_id = ? AND competencia = ? AND excluido_em IS NULL`,
    )
    .all(empresaId, competencia) as LinhaChamado[];

  const resumo: ResumoReaplicacao = {
    competencia,
    avaliados: 0,
    alterados: 0,
    virou_dentro: 0,
    virou_fora: 0,
    sem_prioridade: 0,
    sem_acordo: 0,
    agregados_ignorados: 0,
  };
  const mudancas: Mudanca[] = [];
  const agora = new Date().toISOString().slice(0, 16) + 'Z';

  for (const l of linhas) {
    // O registro AGREGADO do mês (vários atendimentos numa linha) não tem
    // abertura nem prioridade: não há chamado individual para medir, e
    // arbitrar uma abertura para ele seria fabricar dado.
    if (l.total_atendidos !== 1) {
      resumo.agregados_ignorados += 1;
      continue;
    }
    resumo.avaliados += 1;
    if (!l.prioridade) {
      resumo.sem_prioridade += 1;
      continue;
    }
    const prazo = prazoDoAcordo(empresaId, l.aberto_em, l.prioridade, l.topico_ajuda_id);
    if (!prazo) {
      resumo.sem_acordo += 1;
      continue;
    }
    const referencia = l.fechado_em ?? agora;
    const dentro = referencia <= prazo ? 1 : 0;
    if (prazo === l.prazo_em && dentro === l.dentro_sla) continue;

    resumo.alterados += 1;
    if (dentro !== l.dentro_sla) {
      if (dentro === 1) resumo.virou_dentro += 1;
      else resumo.virou_fora += 1;
    }
    mudancas.push({ id: l.id, prazo, dentro, antes_dentro: l.dentro_sla });
  }
  return { resumo, mudancas };
}

/** A prévia: conta o que mudaria, e não grava. */
export function previaReaplicacao(ctx: Contexto, competencia: unknown): ResumoReaplicacao {
  const comp = paraInterno(competencia);
  return avaliarReaplicacao(ctx.empresaId, comp).resumo;
}

/**
 * Aplica o acordo aos chamados da competência.
 *
 * Passa pelo mesmo porteiro de escrita do resto do sistema: mês fechado é
 * recusado (reabra primeiro), mês passado exige justificativa. A auditoria
 * recebe UMA linha, com os números — uma por chamado afogaria a trilha e
 * esconderia justamente a informação que importa, que é o tamanho do efeito.
 */
export function reaplicarAcordos(
  ctx: Contexto,
  competencia: unknown,
  justificativa?: string | null,
): ResumoReaplicacao {
  const comp = paraInterno(competencia);
  garantirCompetenciaEditavel(ctx, comp, justificativa, ctx.empresaId);

  const { resumo, mudancas } = avaliarReaplicacao(ctx.empresaId, comp);
  if (mudancas.length) {
    const atualizar = db().prepare(
      // `prazo_origem` guarda a promessa do helpdesk ANTES de o acordo tomar o
      // lugar dela. O chamado anterior a esta coluna tem a promessa só em
      // `prazo_em`: sem o COALESCE, reaplicar o acordo a apagaria, e a
      // contestação de um "fora do SLA" ficaria sem referência. No SQLite o
      // lado direito do SET enxerga os valores ANTIGOS da linha, que é o que
      // faz isto funcionar numa única passada.
      `UPDATE tickets_sla
          SET prazo_origem = COALESCE(prazo_origem, CASE WHEN prazo_do_acordo = 0 THEN prazo_em END),
              prazo_em = ?, prazo_do_acordo = 1, dentro_sla = ?, fora_sla = ?,
              atualizado_em = datetime('now')
        WHERE id = ? AND empresa_id = ?`,
    );
    const emLote = db().transaction((itens: Mudanca[]) => {
      for (const m of itens) atualizar.run(m.prazo, m.dentro, 1 - m.dentro, m.id, ctx.empresaId);
    });
    emLote(mudancas);
  }

  auditar(ctx, {
    entidade: 'sla',
    acao: 'reaplicar',
    justificativa: justificativa?.trim() || null,
    depois: { ...resumo, competencia: paraExibicao(comp) },
  });
  return resumo;
}
