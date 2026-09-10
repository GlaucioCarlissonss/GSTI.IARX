import { db, emTransacao } from '../db/index.js';
import { erroNaoEncontrado, erroValidacao } from '../lib/erros.js';
import { auditar } from './auditoria.js';
import { competenciaAtual, diferencaEmMeses, paraExibicao, paraInterno } from './competencia.js';
import type { Contexto } from './contexto.js';
import { validarFilial } from './cadastros.js';

export type StatusProjeto = 'planejado' | 'em_andamento' | 'concluido' | 'cancelado';
export type StatusTarefa = 'pendente' | 'em_andamento' | 'concluida' | 'cancelada';

interface LinhaProjeto {
  id: number;
  empresa_id: number;
  filial_id: number | null;
  nome: string;
  descricao: string | null;
  mes_inicio: string;
  mes_fim_planejado: string;
  mes_fim_real: string | null;
  status: StatusProjeto;
}

interface LinhaTarefa {
  id: number;
  projeto_id: number;
  nome: string;
  mes_inicio: string;
  mes_fim_planejado: string;
  mes_fim_real: string | null;
  responsavel: string | null;
  status: StatusTarefa;
}

/**
 * Atraso é derivado, nunca digitado: existe quando o mês corrente ultrapassa
 * o fim planejado sem fim real registrado. Se houve fim real posterior ao
 * planejado, o item foi entregue com atraso (desvio em meses).
 */
export function calcularAtraso(
  mesFimPlanejado: string,
  mesFimReal: string | null,
  status: string,
  hoje: Date = new Date(),
) {
  const atual = competenciaAtual(hoje);
  if (status === 'cancelado' || status === 'cancelada') {
    return { atrasado: false, meses_atraso: 0, desvio_meses: 0 };
  }
  if (mesFimReal) {
    const desvio = diferencaEmMeses(mesFimPlanejado, mesFimReal);
    return { atrasado: false, meses_atraso: 0, desvio_meses: desvio };
  }
  const atraso = diferencaEmMeses(mesFimPlanejado, atual);
  return { atrasado: atraso > 0, meses_atraso: Math.max(atraso, 0), desvio_meses: Math.max(atraso, 0) };
}

function apresentarProjeto(linha: LinhaProjeto & Record<string, unknown>) {
  const atraso = calcularAtraso(linha.mes_fim_planejado, linha.mes_fim_real, linha.status);
  return {
    id: linha.id,
    filial_id: linha.filial_id,
    filial_nome: (linha.filial_nome as string | null) ?? null,
    nome: linha.nome,
    descricao: linha.descricao,
    mes_inicio: paraExibicao(linha.mes_inicio),
    mes_fim_planejado: paraExibicao(linha.mes_fim_planejado),
    mes_fim_real: linha.mes_fim_real ? paraExibicao(linha.mes_fim_real) : null,
    status: linha.status,
    duracao_planejada_meses: diferencaEmMeses(linha.mes_inicio, linha.mes_fim_planejado) + 1,
    total_tarefas: Number(linha.total_tarefas ?? 0),
    tarefas_concluidas: Number(linha.tarefas_concluidas ?? 0),
    ...atraso,
  };
}

function apresentarTarefa(linha: LinhaTarefa) {
  return {
    id: linha.id,
    projeto_id: linha.projeto_id,
    nome: linha.nome,
    mes_inicio: paraExibicao(linha.mes_inicio),
    mes_fim_planejado: paraExibicao(linha.mes_fim_planejado),
    mes_fim_real: linha.mes_fim_real ? paraExibicao(linha.mes_fim_real) : null,
    responsavel: linha.responsavel,
    status: linha.status,
    ...calcularAtraso(linha.mes_fim_planejado, linha.mes_fim_real, linha.status),
  };
}

const SQL_PROJETO_BASE = `
  SELECT p.*, f.nome AS filial_nome,
         (SELECT COUNT(*) FROM tarefas t WHERE t.projeto_id = p.id AND t.excluido_em IS NULL) AS total_tarefas,
         (SELECT COUNT(*) FROM tarefas t WHERE t.projeto_id = p.id AND t.excluido_em IS NULL AND t.mes_fim_real IS NOT NULL) AS tarefas_concluidas
    FROM projetos p LEFT JOIN filiais f ON f.id = p.filial_id`;

export interface EntradaProjeto {
  filialId?: number | null;
  nome: string;
  descricao?: string | null;
  mesInicio: string;
  mesFimPlanejado: string;
  mesFimReal?: string | null;
  status?: StatusProjeto;
  dedupHash?: string | null;
}

export function criarProjeto(ctx: Contexto, entrada: EntradaProjeto) {
  const filialId = validarFilial(ctx.empresaId, entrada.filialId);
  const inicio = paraInterno(entrada.mesInicio);
  const fimPlanejado = paraInterno(entrada.mesFimPlanejado);
  if (fimPlanejado < inicio) throw erroValidacao('O fim planejado não pode ser anterior ao início.');
  const fimReal = entrada.mesFimReal ? paraInterno(entrada.mesFimReal) : null;
  if (fimReal && fimReal < inicio) throw erroValidacao('O fim real não pode ser anterior ao início.');
  if (!entrada.nome?.trim()) throw erroValidacao('O nome do projeto é obrigatório.');

  const status: StatusProjeto = entrada.status ?? (fimReal ? 'concluido' : 'planejado');
  if (status === 'concluido' && !fimReal) {
    throw erroValidacao('Um projeto concluído exige o mês de fim real.');
  }

  const info = db()
    .prepare(
      `INSERT INTO projetos (empresa_id, filial_id, nome, descricao, mes_inicio, mes_fim_planejado, mes_fim_real, status, dedup_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ctx.empresaId,
      filialId,
      entrada.nome.trim(),
      entrada.descricao ?? null,
      inicio,
      fimPlanejado,
      fimReal,
      status,
      entrada.dedupHash ?? null,
    );
  const id = Number(info.lastInsertRowid);
  auditar(ctx, { entidade: 'projeto', entidadeId: id, acao: 'criar', depois: { nome: entrada.nome, status } });
  return obterProjeto(ctx, id);
}

export function obterProjeto(ctx: Contexto, id: number) {
  const linha = db()
    .prepare(`${SQL_PROJETO_BASE} WHERE p.id = ? AND p.empresa_id = ? AND p.excluido_em IS NULL`)
    .get(id, ctx.empresaId) as (LinhaProjeto & Record<string, unknown>) | undefined;
  if (!linha) throw erroNaoEncontrado(`Projeto ${id} não encontrado nesta empresa.`);
  return apresentarProjeto(linha);
}

export interface FiltroProjetos {
  filialId?: number | null;
  status?: StatusProjeto;
  apenasAtrasados?: boolean;
  busca?: string;
}

export function listarProjetos(ctx: Contexto, filtro: FiltroProjetos = {}) {
  const condicoes = ['p.empresa_id = ?', 'p.excluido_em IS NULL'];
  const params: unknown[] = [ctx.empresaId];
  if (filtro.filialId === null) condicoes.push('p.filial_id IS NULL');
  else if (filtro.filialId !== undefined) {
    condicoes.push('p.filial_id = ?');
    params.push(filtro.filialId);
  }
  if (filtro.status) {
    condicoes.push('p.status = ?');
    params.push(filtro.status);
  }
  if (filtro.busca?.trim()) {
    condicoes.push('(p.nome LIKE ? OR p.descricao LIKE ?)');
    params.push(`%${filtro.busca.trim()}%`, `%${filtro.busca.trim()}%`);
  }
  const linhas = db()
    .prepare(`${SQL_PROJETO_BASE} WHERE ${condicoes.join(' AND ')} ORDER BY p.mes_inicio, p.nome`)
    .all(...params) as Array<LinhaProjeto & Record<string, unknown>>;
  const itens = linhas.map(apresentarProjeto);
  return filtro.apenasAtrasados ? itens.filter((p) => p.atrasado) : itens;
}

export function atualizarProjeto(ctx: Contexto, id: number, dados: Partial<EntradaProjeto> & { justificativa?: string }) {
  const antes = db()
    .prepare('SELECT * FROM projetos WHERE id = ? AND empresa_id = ? AND excluido_em IS NULL')
    .get(id, ctx.empresaId) as LinhaProjeto | undefined;
  if (!antes) throw erroNaoEncontrado(`Projeto ${id} não encontrado nesta empresa.`);

  const filialId = dados.filialId !== undefined ? validarFilial(ctx.empresaId, dados.filialId) : antes.filial_id;
  const inicio = dados.mesInicio ? paraInterno(dados.mesInicio) : antes.mes_inicio;
  const fimPlanejado = dados.mesFimPlanejado ? paraInterno(dados.mesFimPlanejado) : antes.mes_fim_planejado;
  const fimReal =
    dados.mesFimReal === undefined ? antes.mes_fim_real : dados.mesFimReal ? paraInterno(dados.mesFimReal) : null;
  if (fimPlanejado < inicio) throw erroValidacao('O fim planejado não pode ser anterior ao início.');
  if (fimReal && fimReal < inicio) throw erroValidacao('O fim real não pode ser anterior ao início.');

  let status: StatusProjeto = dados.status ?? antes.status;
  if (fimReal && status !== 'cancelado') status = 'concluido';
  if (!fimReal && status === 'concluido') {
    throw erroValidacao('Um projeto concluído exige o mês de fim real.');
  }

  db()
    .prepare(
      `UPDATE projetos SET filial_id = ?, nome = ?, descricao = ?, mes_inicio = ?, mes_fim_planejado = ?,
              mes_fim_real = ?, status = ?, atualizado_em = datetime('now')
        WHERE id = ? AND empresa_id = ?`,
    )
    .run(
      filialId,
      dados.nome?.trim() || antes.nome,
      dados.descricao !== undefined ? dados.descricao : antes.descricao,
      inicio,
      fimPlanejado,
      fimReal,
      status,
      id,
      ctx.empresaId,
    );
  const depois = obterProjeto(ctx, id);
  auditar(ctx, {
    entidade: 'projeto',
    entidadeId: id,
    acao: 'atualizar',
    justificativa: dados.justificativa ?? null,
    antes,
    depois,
  });
  return depois;
}

export function excluirProjeto(ctx: Contexto, id: number, justificativa?: string) {
  const antes = db()
    .prepare('SELECT * FROM projetos WHERE id = ? AND empresa_id = ? AND excluido_em IS NULL')
    .get(id, ctx.empresaId) as LinhaProjeto | undefined;
  if (!antes) throw erroNaoEncontrado(`Projeto ${id} não encontrado nesta empresa.`);
  return emTransacao(() => {
    db().prepare(`UPDATE projetos SET excluido_em = datetime('now'), dedup_hash = NULL WHERE id = ?`).run(id);
    db().prepare(`UPDATE tarefas SET excluido_em = datetime('now'), dedup_hash = NULL WHERE projeto_id = ? AND excluido_em IS NULL`).run(id);
    auditar(ctx, { entidade: 'projeto', entidadeId: id, acao: 'excluir', justificativa: justificativa ?? null, antes });
    return { excluido: true };
  });
}

// ------------------------------------------------------------------ Tarefas

function garantirProjeto(ctx: Contexto, projetoId: number): void {
  const linha = db()
    .prepare('SELECT id FROM projetos WHERE id = ? AND empresa_id = ? AND excluido_em IS NULL')
    .get(projetoId, ctx.empresaId);
  if (!linha) throw erroNaoEncontrado(`Projeto ${projetoId} não encontrado nesta empresa.`);
}

export interface EntradaTarefa {
  nome: string;
  mesInicio: string;
  mesFimPlanejado: string;
  mesFimReal?: string | null;
  responsavel?: string | null;
  status?: StatusTarefa;
  dedupHash?: string | null;
}

export function listarTarefas(ctx: Contexto, projetoId: number) {
  garantirProjeto(ctx, projetoId);
  return (
    db()
      .prepare('SELECT * FROM tarefas WHERE projeto_id = ? AND excluido_em IS NULL ORDER BY mes_inicio, id')
      .all(projetoId) as LinhaTarefa[]
  ).map(apresentarTarefa);
}

export function criarTarefa(ctx: Contexto, projetoId: number, entrada: EntradaTarefa) {
  garantirProjeto(ctx, projetoId);
  if (!entrada.nome?.trim()) throw erroValidacao('O nome da tarefa é obrigatório.');
  const inicio = paraInterno(entrada.mesInicio);
  const fimPlanejado = paraInterno(entrada.mesFimPlanejado);
  if (fimPlanejado < inicio) throw erroValidacao('O fim planejado da tarefa não pode ser anterior ao início.');
  const fimReal = entrada.mesFimReal ? paraInterno(entrada.mesFimReal) : null;
  const status: StatusTarefa = entrada.status ?? (fimReal ? 'concluida' : 'pendente');

  const info = db()
    .prepare(
      `INSERT INTO tarefas (projeto_id, nome, mes_inicio, mes_fim_planejado, mes_fim_real, responsavel, status, dedup_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(projetoId, entrada.nome.trim(), inicio, fimPlanejado, fimReal, entrada.responsavel ?? null, status, entrada.dedupHash ?? null);
  const id = Number(info.lastInsertRowid);
  auditar(ctx, { entidade: 'tarefa', entidadeId: id, acao: 'criar', depois: { projetoId, nome: entrada.nome } });
  return apresentarTarefa(db().prepare('SELECT * FROM tarefas WHERE id = ?').get(id) as LinhaTarefa);
}

export function atualizarTarefa(ctx: Contexto, tarefaId: number, dados: Partial<EntradaTarefa> & { justificativa?: string }) {
  const antes = db()
    .prepare(
      `SELECT t.* FROM tarefas t JOIN projetos p ON p.id = t.projeto_id
        WHERE t.id = ? AND p.empresa_id = ? AND t.excluido_em IS NULL AND p.excluido_em IS NULL`,
    )
    .get(tarefaId, ctx.empresaId) as LinhaTarefa | undefined;
  if (!antes) throw erroNaoEncontrado(`Tarefa ${tarefaId} não encontrada nesta empresa.`);

  const inicio = dados.mesInicio ? paraInterno(dados.mesInicio) : antes.mes_inicio;
  const fimPlanejado = dados.mesFimPlanejado ? paraInterno(dados.mesFimPlanejado) : antes.mes_fim_planejado;
  const fimReal =
    dados.mesFimReal === undefined ? antes.mes_fim_real : dados.mesFimReal ? paraInterno(dados.mesFimReal) : null;
  if (fimPlanejado < inicio) throw erroValidacao('O fim planejado da tarefa não pode ser anterior ao início.');

  let status: StatusTarefa = dados.status ?? antes.status;
  if (fimReal && status !== 'cancelada') status = 'concluida';

  db()
    .prepare(
      `UPDATE tarefas SET nome = ?, mes_inicio = ?, mes_fim_planejado = ?, mes_fim_real = ?, responsavel = ?,
              status = ?, atualizado_em = datetime('now')
        WHERE id = ?`,
    )
    .run(
      dados.nome?.trim() || antes.nome,
      inicio,
      fimPlanejado,
      fimReal,
      dados.responsavel !== undefined ? dados.responsavel : antes.responsavel,
      status,
      tarefaId,
    );
  const depois = apresentarTarefa(db().prepare('SELECT * FROM tarefas WHERE id = ?').get(tarefaId) as LinhaTarefa);
  auditar(ctx, {
    entidade: 'tarefa',
    entidadeId: tarefaId,
    acao: 'atualizar',
    justificativa: dados.justificativa ?? null,
    antes,
    depois,
  });
  return depois;
}

export function excluirTarefa(ctx: Contexto, tarefaId: number, justificativa?: string) {
  const antes = db()
    .prepare(
      `SELECT t.* FROM tarefas t JOIN projetos p ON p.id = t.projeto_id
        WHERE t.id = ? AND p.empresa_id = ? AND t.excluido_em IS NULL`,
    )
    .get(tarefaId, ctx.empresaId) as LinhaTarefa | undefined;
  if (!antes) throw erroNaoEncontrado(`Tarefa ${tarefaId} não encontrada nesta empresa.`);
  db().prepare(`UPDATE tarefas SET excluido_em = datetime('now'), dedup_hash = NULL WHERE id = ?`).run(tarefaId);
  auditar(ctx, { entidade: 'tarefa', entidadeId: tarefaId, acao: 'excluir', justificativa: justificativa ?? null, antes });
  return { excluida: true };
}

// --------------------------------------------------------------- Envolvidos

export function listarEnvolvidos(ctx: Contexto, projetoId: number) {
  garantirProjeto(ctx, projetoId);
  return db().prepare('SELECT id, nome, papel FROM envolvidos WHERE projeto_id = ? ORDER BY nome').all(projetoId);
}

export function adicionarEnvolvido(ctx: Contexto, projetoId: number, dados: { nome: string; papel?: string | null }) {
  garantirProjeto(ctx, projetoId);
  if (!dados.nome?.trim()) throw erroValidacao('O nome do envolvido é obrigatório.');
  const info = db()
    .prepare('INSERT OR IGNORE INTO envolvidos (projeto_id, nome, papel) VALUES (?, ?, ?)')
    .run(projetoId, dados.nome.trim(), dados.papel ?? null);
  if (info.changes === 0) {
    const existente = db()
      .prepare('SELECT id, nome, papel FROM envolvidos WHERE projeto_id = ? AND nome = ?')
      .get(projetoId, dados.nome.trim());
    return existente;
  }
  const id = Number(info.lastInsertRowid);
  auditar(ctx, { entidade: 'envolvido', entidadeId: id, acao: 'criar', depois: { projetoId, ...dados } });
  return { id, nome: dados.nome.trim(), papel: dados.papel ?? null };
}

export function removerEnvolvido(ctx: Contexto, projetoId: number, envolvidoId: number) {
  garantirProjeto(ctx, projetoId);
  const antes = db()
    .prepare('SELECT id, nome, papel FROM envolvidos WHERE id = ? AND projeto_id = ?')
    .get(envolvidoId, projetoId);
  if (!antes) throw erroNaoEncontrado(`Envolvido ${envolvidoId} não encontrado neste projeto.`);
  db().prepare('DELETE FROM envolvidos WHERE id = ?').run(envolvidoId);
  auditar(ctx, { entidade: 'envolvido', entidadeId: envolvidoId, acao: 'excluir', antes });
  return { removido: true };
}
