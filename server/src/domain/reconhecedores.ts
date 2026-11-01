/**
 * QUEM RECONHECE DESPESA — a lista de quem, na origem, lança despesa que já
 * nasce conferida.
 *
 * Toda despesa que entra por carga nasce POR RECONHECER (`lancamentos.
 * reconhecido = 0`), e alguém precisa olhar uma a uma. Mas parte da carga vem
 * de quem já conferiu na origem: o documento criado pela própria equipe de TI
 * no ERP chega revisado, e marcar isso à mão é trabalho repetido de milhares
 * de linhas.
 *
 * A lista existia — numa constante de script, fora do sistema. Bastava uma
 * pessoa entrar ou sair do time para a classificação sair errada sem ninguém
 * perceber, e ninguém conseguiria dizer por que aquele lançamento foi
 * reconhecido.
 *
 * É cadastro do CLIENTE, como `metas` e `planos_reducao`: a mesma pessoa
 * lança para todas as unidades do grupo.
 *
 * O valor guardado é um NOME DE USUÁRIO DE OUTRO SISTEMA, texto livre — não
 * há id interno para referenciar, e exigir um usuário cadastrado aqui faria o
 * cadastro não cobrir justamente quem não usa este sistema. O precedente é
 * `ticket_reclassificacoes.solicitante`, pela mesma razão.
 */
import { db } from '../db/index.js';
import { erroConflito, erroNaoEncontrado, erroValidacao } from '../lib/erros.js';
import { chaveDoUsuario } from '../lib/texto.js';
import { auditar } from './auditoria.js';
import type { Contexto } from './contexto.js';
import { reconhecerLancamentos } from './financeiro.js';

export interface LinhaReconhecedor {
  id: number;
  usuario_origem: string;
  chave: string;
  nome_exibicao: string | null;
  ativo: number;
}

function clienteDo(ctx: Contexto): number {
  if (ctx.clienteId === null) throw erroValidacao('Operação sem cliente em foco.');
  return ctx.clienteId;
}

/**
 * A forma comparável do nome: maiúsculas, sem acento, sem espaço.
 *
 * Mora em `lib/texto.ts` porque a semeadura da lista inicial acontece em
 * `db/index.ts`, que é folha e não pode importar o domínio. Reexportada aqui
 * para quem já a conhecia por este caminho.
 */
export { chaveDoUsuario };

const SELECT_RECONHECEDOR = `SELECT id, usuario_origem, chave, nome_exibicao, ativo
     FROM reconhecedores_origem`;

export function listarReconhecedores(ctx: Contexto, incluirInativos = false): LinhaReconhecedor[] {
  return db()
    .prepare(
      `${SELECT_RECONHECEDOR}
        WHERE cliente_id = ? ${incluirInativos ? '' : 'AND ativo = 1'}
        ORDER BY usuario_origem`,
    )
    .all(clienteDo(ctx)) as LinhaReconhecedor[];
}

export interface EntradaReconhecedor {
  usuario_origem?: unknown;
  nome_exibicao?: unknown;
}

export function criarReconhecedor(ctx: Contexto, dados: EntradaReconhecedor): LinhaReconhecedor {
  const clienteId = clienteDo(ctx);
  const usuario = String(dados.usuario_origem ?? '').trim();
  if (!usuario) throw erroValidacao('Informe o usuário da origem, como ele aparece na carga.');
  const chave = chaveDoUsuario(usuario);
  if (!chave) throw erroValidacao('O usuário da origem precisa ter ao menos uma letra ou número.');

  const existente = db()
    .prepare('SELECT usuario_origem FROM reconhecedores_origem WHERE cliente_id = ? AND chave = ?')
    .get(clienteId, chave) as { usuario_origem: string } | undefined;
  if (existente) {
    throw erroConflito(`"${existente.usuario_origem}" já está na lista — é o mesmo usuário.`);
  }

  const nome = String(dados.nome_exibicao ?? '').trim() || null;
  const info = db()
    .prepare(
      `INSERT INTO reconhecedores_origem (cliente_id, usuario_origem, chave, nome_exibicao)
       VALUES (?, ?, ?, ?)`,
    )
    .run(clienteId, usuario, chave, nome);
  const id = Number(info.lastInsertRowid);
  auditar(ctx, {
    entidade: 'reconhecedor_origem',
    entidadeId: id,
    acao: 'criar',
    depois: { usuario_origem: usuario, nome_exibicao: nome },
    comEmpresa: false,
  });
  return obterReconhecedor(ctx, id);
}

export function obterReconhecedor(ctx: Contexto, id: number): LinhaReconhecedor {
  const linha = db()
    .prepare(`${SELECT_RECONHECEDOR} WHERE id = ? AND cliente_id = ?`)
    .get(id, clienteDo(ctx)) as LinhaReconhecedor | undefined;
  if (!linha) throw erroNaoEncontrado(`Usuário ${id} não está na lista deste cliente.`);
  return linha;
}

export function atualizarReconhecedor(
  ctx: Contexto,
  id: number,
  dados: EntradaReconhecedor & { ativo?: unknown },
): LinhaReconhecedor {
  const antes = obterReconhecedor(ctx, id);
  const nome =
    dados.nome_exibicao === undefined ? antes.nome_exibicao : String(dados.nome_exibicao ?? '').trim() || null;
  const ativo = dados.ativo === undefined ? antes.ativo : dados.ativo ? 1 : 0;
  db()
    .prepare('UPDATE reconhecedores_origem SET nome_exibicao = ?, ativo = ? WHERE id = ? AND cliente_id = ?')
    .run(nome, ativo, id, clienteDo(ctx));
  const depois = obterReconhecedor(ctx, id);
  auditar(ctx, {
    entidade: 'reconhecedor_origem',
    entidadeId: id,
    acao: 'atualizar',
    antes,
    depois,
    comEmpresa: false,
  });
  return depois;
}

/**
 * Este usuário da origem reconhece despesa?
 *
 * É o que a carga pergunta por linha. Só o cadastro ATIVO conta: desativar
 * alguém que saiu do time faz a próxima carga dele nascer por reconhecer, sem
 * apagar o que já entrou.
 */
export function reconhecePorOrigem(clienteId: number, usuarioOrigem: string | null | undefined): boolean {
  const chave = chaveDoUsuario(usuarioOrigem);
  if (!chave) return false;
  const linha = db()
    .prepare('SELECT 1 AS ok FROM reconhecedores_origem WHERE cliente_id = ? AND chave = ? AND ativo = 1')
    .get(clienteId, chave);
  return linha !== undefined;
}

// ===========================================================================
// Aplicar o cadastro ao que já está gravado
// ===========================================================================
//
// O cadastro decide na ENTRADA da carga. Quem o monta hoje, porém, quer que
// ele valha para os meses que já foram carregados — e recalcular sozinho
// seria pior que não recalcular: um número apresentado numa reunião mudaria
// porque alguém mexeu numa lista. Por isso é um ato, com prévia e contagem,
// igual à reaplicação do acordo de SLA.

export interface RecorteReconhecimento {
  /** Competência inicial, em AAAA-MM. Ausente: desde o começo da base. */
  de?: string | null;
  /** Competência final, em AAAA-MM. Ausente: até o fim. */
  ate?: string | null;
}

export interface ResumoReconhecimento {
  de: string | null;
  ate: string | null;
  /** Lançamentos do recorte que a passada olhou. */
  avaliados: number;
  /** Passariam (ou passaram) a reconhecidos. */
  reconhecidos: number;
  ja_reconhecidos: number;
  /** Sem `usuario_origem`: entraram por um caminho que não registra a origem. */
  sem_usuario_origem: number;
  /** Têm origem, mas quem criou não está no cadastro ativo. */
  fora_do_cadastro: number;
}

interface Alvo {
  id: number;
  empresa_id: number;
  usuario_origem: string | null;
  reconhecido: number;
}

function avaliarReconhecimento(clienteId: number, recorte: RecorteReconhecimento) {
  const condicoes = ['l.cliente_id = ?', 'l.excluido_em IS NULL'];
  const params: unknown[] = [clienteId];
  if (recorte.de) {
    condicoes.push('l.competencia >= ?');
    params.push(recorte.de);
  }
  if (recorte.ate) {
    condicoes.push('l.competencia <= ?');
    params.push(recorte.ate);
  }
  const linhas = db()
    .prepare(
      `SELECT l.id, l.empresa_id, l.usuario_origem, l.reconhecido
         FROM lancamentos l
        WHERE ${condicoes.join(' AND ')}`,
    )
    .all(...params) as Alvo[];

  const resumo: ResumoReconhecimento = {
    de: recorte.de ?? null,
    ate: recorte.ate ?? null,
    avaliados: linhas.length,
    reconhecidos: 0,
    ja_reconhecidos: 0,
    sem_usuario_origem: 0,
    fora_do_cadastro: 0,
  };
  const marcar: Alvo[] = [];

  for (const l of linhas) {
    if (l.reconhecido === 1) {
      resumo.ja_reconhecidos += 1;
      continue;
    }
    if (!l.usuario_origem) {
      resumo.sem_usuario_origem += 1;
      continue;
    }
    if (!reconhecePorOrigem(clienteId, l.usuario_origem)) {
      resumo.fora_do_cadastro += 1;
      continue;
    }
    resumo.reconhecidos += 1;
    marcar.push(l);
  }
  return { resumo, marcar };
}

/** O que mudaria, sem gravar nada. */
export function previaReconhecimento(ctx: Contexto, recorte: RecorteReconhecimento = {}): ResumoReconhecimento {
  return avaliarReconhecimento(clienteDo(ctx), recorte).resumo;
}

/**
 * Marca como reconhecido o que o cadastro alcança.
 *
 * Grava pelo mesmo caminho da tela de Conferência (`reconhecerLancamentos`),
 * que já tem a guarda de não auditar o que não mudou e a trilha por
 * lançamento. A justificativa entra numa linha própria de auditoria, com os
 * números — é ela que explica, depois, por que 600 lançamentos mudaram de
 * estado no mesmo segundo.
 */
export function aplicarReconhecimento(
  ctx: Contexto,
  recorte: RecorteReconhecimento = {},
  justificativa?: string | null,
): ResumoReconhecimento {
  const clienteId = clienteDo(ctx);
  const { resumo, marcar } = avaliarReconhecimento(clienteId, recorte);

  // `reconhecerLancamentos` opera dentro de UMA matriz por vez, porque a
  // trilha do lançamento é por empresa. O cadastro é do cliente, então o
  // agrupamento acontece aqui.
  const porEmpresa = new Map<number, number[]>();
  for (const l of marcar) {
    const lista = porEmpresa.get(l.empresa_id) ?? [];
    lista.push(l.id);
    porEmpresa.set(l.empresa_id, lista);
  }
  for (const [empresaId, ids] of porEmpresa) {
    reconhecerLancamentos({ ...ctx, empresaId }, ids, true, justificativa ?? undefined);
  }

  auditar(ctx, {
    entidade: 'reconhecedor_origem',
    acao: 'aplicar',
    justificativa: justificativa?.trim() || null,
    depois: resumo,
    comEmpresa: false,
  });
  return resumo;
}
