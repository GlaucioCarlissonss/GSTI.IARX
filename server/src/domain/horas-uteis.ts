/**
 * O RELÓGIO DO SLA — horas úteis, e os feriados que as interrompem.
 *
 * Prazo de SLA não corre em horas de relógio: corre dentro do expediente. Um
 * chamado aberto na sexta às 17h30 com 4 horas de prazo não vence às 21h30 de
 * sexta — ele vence na segunda de manhã, porque ninguém trabalhou no meio.
 * Medir em horas corridas reprova a equipe pelo fim de semana.
 *
 * A janela é a do contrato:
 *   segunda a quinta  08:00–18:00   (10 h)
 *   sexta             08:00–17:00   ( 9 h)
 *   sábado, domingo e FERIADO       ( 0 h)
 *
 * Estas regras existem duas vezes — aqui e em `artifact/app-js22.js` —, e é
 * por isso que têm conferência própria: duas cópias divergem na primeira
 * correção feita de um lado só, e a divergência é silenciosa. Os dois lados
 * seguem devolvendo um prazo plausível.
 *
 * O motor é PURO: recebe as pontas e o calendário, devolve horas. Nenhuma
 * leitura de banco — é o que torna possível conferi-lo um caso de cada vez.
 */
import { db } from '../db/index.js';
import { erroNaoEncontrado, erroValidacao } from '../lib/erros.js';
import type { Contexto } from './contexto.js';
import { auditar } from './auditoria.js';

/** A janela de expediente de cada dia da semana, em horas decimais. */
export const EXPEDIENTE: Array<{ de: number; ate: number } | null> = [
  null,               // domingo
  { de: 8, ate: 18 }, // segunda
  { de: 8, ate: 18 }, // terça
  { de: 8, ate: 18 }, // quarta
  { de: 8, ate: 18 }, // quinta
  { de: 8, ate: 17 }, // sexta
  null,               // sábado
];

/**
 * A data como AAAA-MM-DD no fuso LOCAL.
 *
 * `toISOString().slice(0,10)` daria o dia em UTC, e no Brasil (UTC−3) um
 * chamado aberto às 22h de segunda viraria terça — deslocando o expediente
 * inteiro de um dia.
 */
export function diaLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A janela útil de um dia: `null` em fim de semana e feriado. */
export function janelaDoDia(d: Date, feriados?: Set<string>): { de: number; ate: number } | null {
  if (feriados && feriados.has(diaLocal(d))) return null;
  return EXPEDIENTE[d.getDay()] ?? null;
}

/** O mesmo dia, à hora decimal pedida. */
function noDiaAs(d: Date, hora: number): Date {
  const x = new Date(d);
  x.setHours(Math.floor(hora), Math.round((hora % 1) * 60), 0, 0);
  return x;
}

/**
 * Teto de dias da varredura.
 *
 * Existe para a conta nunca virar laço infinito quando as pontas vierem
 * absurdamente distantes por erro de dado — dez anos é mais do que qualquer
 * chamado real, e menos do que "para sempre".
 */
const LIMITE_DE_DIAS = 3660;

/**
 * As HORAS ÚTEIS entre dois instantes.
 *
 * Tempo fora do expediente não conta; fim de semana e feriado não contam. Se
 * o chamado foi aberto fora do expediente, o relógio só começa no próximo
 * horário útil — abrir às 22h de terça e às 8h de quarta dá o mesmo consumo,
 * que é o que o contrato promete.
 *
 * Fim antes do início devolve 0, e não um número negativo: data invertida é
 * erro de dado, e um consumo negativo se espalharia como "dentro do prazo".
 */
export function horasUteis(
  inicioISO: string,
  fimISO: string,
  feriados: Set<string> = new Set(),
): number | null {
  const ini = new Date(inicioISO);
  const fim = new Date(fimISO);
  if (Number.isNaN(ini.getTime()) || Number.isNaN(fim.getTime())) return null;
  if (fim <= ini) return 0;

  let total = 0;
  const cursor = new Date(ini);
  cursor.setHours(0, 0, 0, 0);
  for (let i = 0; i < LIMITE_DE_DIAS; i += 1) {
    if (cursor > fim) break;
    const janela = janelaDoDia(cursor, feriados);
    if (janela) {
      const abre = noDiaAs(cursor, janela.de);
      const fecha = noDiaAs(cursor, janela.ate);
      const de = ini > abre ? ini : abre;
      const ate = fim < fecha ? fim : fecha;
      if (ate > de) total += (ate.getTime() - de.getTime()) / 3600000;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.round(total * 1000) / 1000;
}

/**
 * O instante em que vencem N horas úteis a partir de um início.
 *
 * É o inverso de `horasUteis`, e é o que a tela mostra como "prazo": uma data
 * e hora concretas, não um saldo. Abrir fora do expediente empurra o começo
 * para o próximo horário útil.
 */
export function prazoEmHorasUteis(
  inicioISO: string,
  horas: number,
  feriados: Set<string> = new Set(),
): string | null {
  const ini = new Date(inicioISO);
  if (Number.isNaN(ini.getTime()) || !Number.isFinite(horas) || horas < 0) return null;
  let restante = horas;
  const cursor = new Date(ini);
  for (let i = 0; i < LIMITE_DE_DIAS; i += 1) {
    const janela = janelaDoDia(cursor, feriados);
    if (janela) {
      const abre = noDiaAs(cursor, janela.de);
      const fecha = noDiaAs(cursor, janela.ate);
      const de = cursor > abre ? cursor : abre;
      if (fecha > de) {
        const disponivel = (fecha.getTime() - de.getTime()) / 3600000;
        if (restante <= disponivel) {
          return new Date(de.getTime() + restante * 3600000).toISOString();
        }
        restante -= disponivel;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }
  return null;
}

// --------------------------------------------------- o cadastro de feriados

export interface Feriado {
  id: number;
  data: string;
  descricao: string;
  ativo: boolean;
}

interface LinhaFeriado {
  id: number;
  data: string;
  descricao: string;
  ativo: number;
}

const apresentar = (l: LinhaFeriado): Feriado => ({
  id: l.id, data: l.data, descricao: l.descricao, ativo: l.ativo === 1,
});

/** Todos os feriados do cliente, do mais antigo para o mais novo. */
export function listarFeriados(ctx: Contexto): Feriado[] {
  const linhas = db().prepare(
    'SELECT id, data, descricao, ativo FROM feriados WHERE cliente_id IS ? ORDER BY data',
  ).all(ctx.clienteId) as LinhaFeriado[];
  return linhas.map(apresentar);
}

/**
 * Os feriados que CONTAM, como conjunto de AAAA-MM-DD.
 *
 * Só os ativos: um feriado desconsiderado continua na lista, e voltar a
 * contá-lo aqui faria a correção do cadastro não ter efeito nenhum.
 */
export function feriadosVigentes(ctx: Contexto): Set<string> {
  const linhas = db().prepare(
    'SELECT data FROM feriados WHERE cliente_id IS ? AND ativo = 1',
  ).all(ctx.clienteId) as Array<{ data: string }>;
  return new Set(linhas.map((l) => l.data));
}

const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

export interface EntradaFeriado {
  data: string;
  descricao?: string;
  ativo?: boolean;
}

export function criarFeriado(ctx: Contexto, entrada: EntradaFeriado): Feriado {
  const data = String(entrada.data ?? '').trim();
  if (!DATA_VALIDA.test(data)) {
    throw erroValidacao('Informe a data do feriado no formato AAAA-MM-DD.');
  }
  // O mesmo dia duas vezes não é cadastro, é engano — e a recusa diz qual é o
  // feriado que já está lá, para não mandar ninguém procurar.
  const existente = db().prepare(
    'SELECT id, data, descricao, ativo FROM feriados WHERE cliente_id IS ? AND data = ?',
  ).get(ctx.clienteId, data) as LinhaFeriado | undefined;
  if (existente) {
    throw erroValidacao(
      `${data} já está cadastrado como feriado`
      + `${existente.descricao ? ` ("${existente.descricao}")` : ''}.`,
    );
  }
  const r = db().prepare(
    'INSERT INTO feriados (cliente_id, data, descricao, ativo) VALUES (?, ?, ?, ?)',
  ).run(ctx.clienteId, data, String(entrada.descricao ?? '').trim(), entrada.ativo === false ? 0 : 1);
  auditar(ctx, {
    entidade: 'feriado', entidadeId: Number(r.lastInsertRowid), acao: 'criar',
    comEmpresa: false, depois: { data, descricao: entrada.descricao ?? '' },
  });
  return buscarFeriado(ctx, Number(r.lastInsertRowid));
}

function buscarFeriado(ctx: Contexto, id: number): Feriado {
  const l = db().prepare(
    'SELECT id, data, descricao, ativo FROM feriados WHERE cliente_id IS ? AND id = ?',
  ).get(ctx.clienteId, id) as LinhaFeriado | undefined;
  if (!l) throw erroNaoEncontrado('Feriado não encontrado neste cliente.');
  return apresentar(l);
}

export function atualizarFeriado(
  ctx: Contexto,
  id: number,
  entrada: Partial<EntradaFeriado>,
): Feriado {
  const antes = buscarFeriado(ctx, id);
  const data = entrada.data === undefined ? antes.data : String(entrada.data).trim();
  if (!DATA_VALIDA.test(data)) {
    throw erroValidacao('Informe a data do feriado no formato AAAA-MM-DD.');
  }
  if (data !== antes.data) {
    const choque = db().prepare(
      'SELECT id FROM feriados WHERE cliente_id IS ? AND data = ? AND id <> ?',
    ).get(ctx.clienteId, data, id);
    if (choque) throw erroValidacao(`${data} já está cadastrado como feriado.`);
  }
  const descricao = entrada.descricao === undefined ? antes.descricao : String(entrada.descricao).trim();
  const ativo = entrada.ativo === undefined ? antes.ativo : entrada.ativo !== false;
  db().prepare(
    'UPDATE feriados SET data = ?, descricao = ?, ativo = ? WHERE cliente_id IS ? AND id = ?',
  ).run(data, descricao, ativo ? 1 : 0, ctx.clienteId, id);
  const depois = buscarFeriado(ctx, id);
  auditar(ctx, {
    entidade: 'feriado', entidadeId: id, acao: 'editar', comEmpresa: false, antes, depois,
  });
  return depois;
}

/**
 * Apaga um feriado.
 *
 * Existe, mas a tela oferece primeiro "desconsiderar": apagar some com o
 * registro de que o dia esteve na lista, e um prazo calculado ontem fica sem
 * explicação. Excluir é para a linha que nunca deveria ter existido.
 */
export function excluirFeriado(ctx: Contexto, id: number): { removido: number } {
  const antes = buscarFeriado(ctx, id);
  db().prepare('DELETE FROM feriados WHERE cliente_id IS ? AND id = ?').run(ctx.clienteId, id);
  auditar(ctx, { entidade: 'feriado', entidadeId: id, acao: 'excluir', comEmpresa: false, antes });
  return { removido: id };
}
