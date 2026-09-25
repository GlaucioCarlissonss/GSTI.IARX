import { db } from '../db/index.js';
import { erroConflito, erroNaoEncontrado, erroSemPermissao, erroValidacao } from '../lib/erros.js';
import { auditar } from './auditoria.js';
import type { Contexto } from './contexto.js';
import { escopoSql } from './escopo.js';

/** Tipos de despesa criados automaticamente em toda empresa nova. */
export const TIPOS_DESPESA_PADRAO = [
  'Pessoas',
  'Equipamentos de TI',
  'Licenças de Softwares',
  'Locação de Impressora',
  'Materiais de TI',
  'Serviços Técnicos',
  'Telefonia/Internet',
  'Serviços de Desenvolvimento',
  'Sistemas Gerenciais',
] as const;

// ---------------------------------------------------------------- Filiais

/**
 * As filiais do CLIENTE, não só as da matriz em foco.
 *
 * O filtro de filial de cada tela recorta o que a tela mostra — e a tela mostra
 * o cliente inteiro. Oferecer só as filiais de uma matriz deixaria de fora,
 * sem aviso, metade das unidades que estão na lista. A matriz vem na linha para
 * a tela distinguir filiais homônimas de matrizes diferentes.
 */
export function listarFiliais(ctx: Contexto, empresas?: number[]) {
  const alcance = escopoSql(ctx, empresas, 'f.empresa_id');
  return db()
    .prepare(
      `SELECT f.id, f.nome, f.cidade, f.uf, f.ativo, f.empresa_id, e.nome AS empresa_nome
         FROM filiais f JOIN empresas e ON e.id = f.empresa_id
        WHERE ${alcance.sql} ORDER BY e.nome, f.nome`,
    )
    .all(...alcance.params);
}

export function criarFilial(ctx: Contexto, dados: { nome: string; cidade?: string; uf?: string }) {
  const existente = db()
    .prepare('SELECT id FROM filiais WHERE empresa_id = ? AND nome = ?')
    .get(ctx.empresaId, dados.nome);
  if (existente) throw erroConflito(`Já existe a filial "${dados.nome}" nesta empresa.`);
  const info = db()
    .prepare('INSERT INTO filiais (empresa_id, nome, cidade, uf) VALUES (?, ?, ?, ?)')
    .run(ctx.empresaId, dados.nome, dados.cidade ?? null, dados.uf ?? null);
  const id = Number(info.lastInsertRowid);
  auditar(ctx, { entidade: 'filial', entidadeId: id, acao: 'criar', depois: dados });
  return { id, ...dados, ativo: 1 };
}

export function atualizarFilial(
  ctx: Contexto,
  id: number,
  dados: { nome?: string; cidade?: string | null; uf?: string | null; ativo?: boolean },
) {
  const antes = obterFilial(ctx, id);
  db()
    .prepare('UPDATE filiais SET nome = ?, cidade = ?, uf = ?, ativo = ? WHERE id = ? AND empresa_id = ?')
    .run(
      dados.nome ?? antes.nome,
      dados.cidade !== undefined ? dados.cidade : antes.cidade,
      dados.uf !== undefined ? dados.uf : antes.uf,
      dados.ativo === undefined ? antes.ativo : dados.ativo ? 1 : 0,
      id,
      ctx.empresaId,
    );
  const depois = obterFilial(ctx, id);
  auditar(ctx, { entidade: 'filial', entidadeId: id, acao: 'atualizar', antes, depois });
  return depois;
}

function obterFilial(ctx: Contexto, id: number) {
  const linha = db()
    .prepare('SELECT id, nome, cidade, uf, ativo FROM filiais WHERE id = ? AND empresa_id = ?')
    .get(id, ctx.empresaId) as { id: number; nome: string; cidade: string | null; uf: string | null; ativo: number } | undefined;
  if (!linha) throw erroNaoEncontrado(`Filial ${id} não encontrada nesta empresa.`);
  return linha;
}

/** Valida que a filial informada pertence ao tenant corrente. `null` = nível empresa. */
export function validarFilial(empresaId: number, filialId: number | null | undefined): number | null {
  if (filialId === null || filialId === undefined) return null;
  const linha = db().prepare('SELECT id FROM filiais WHERE id = ? AND empresa_id = ?').get(filialId, empresaId);
  if (!linha) throw erroValidacao(`Filial ${filialId} não pertence à empresa em contexto.`);
  return filialId;
}

/**
 * Todas as filiais do CLIENTE, atravessando as matrizes.
 *
 * `validarFilial` acima responde outra pergunta — "esta filial é desta
 * matriz?" —, que é a certa para dizer onde um lançamento nasce. Mas quem se
 * BENEFICIA de uma despesa centralizada pode estar em outra matriz do mesmo
 * contratante: é o caso da licença comprada pela holding e usada pelos
 * hospitais. Recortar por matriz aqui deixaria metade do grupo de fora.
 */
export function filiaisDoCliente(ctx: Contexto): number[] {
  const alcance = escopoSql(ctx, null, 'f.empresa_id');
  return (
    db()
      .prepare(`SELECT f.id FROM filiais f WHERE ${alcance.sql} ORDER BY f.id`)
      .all(...alcance.params) as Array<{ id: number }>
  ).map((f) => f.id);
}

/**
 * Confere que cada filial informada é do cliente da sessão.
 *
 * A recusa é a mesma para filial de outro cliente e para filial inexistente:
 * distinguir as duas contaria a quem tenta qual id existe.
 */
export function validarFiliaisDoCliente(ctx: Contexto, ids: number[]): number[] {
  const unicos = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!unicos.length) return [];
  const doCliente = new Set(filiaisDoCliente(ctx));
  for (const id of unicos) {
    if (!doCliente.has(id)) throw erroSemPermissao('Você não tem acesso a uma das filiais informadas.');
  }
  return unicos;
}

// ------------------------------------------------------- Tipos de despesa

export function listarTiposDespesa(ctx: Contexto, incluirInativos = false) {
  return db()
    .prepare(
      `SELECT id, nome, ativo FROM tipos_despesa
        WHERE empresa_id = ? ${incluirInativos ? '' : 'AND ativo = 1'}
        ORDER BY nome`,
    )
    .all(ctx.empresaId);
}

/**
 * Os tipos de despesa do CLIENTE inteiro, qualificados pela matriz.
 *
 * O tipo de despesa é cadastrado POR MATRIZ — "Licenças de Softwares" existe
 * uma vez em cada, com id próprio. Quem cadastra um plano de redução escolhe do
 * grupo, então precisa da lista inteira, e precisa saber de qual matriz é cada
 * entrada: duas linhas com o mesmo nome e nenhuma pista seriam impossíveis de
 * distinguir.
 */
export function tiposDespesaDoCliente(ctx: Contexto, incluirInativos = false) {
  const alcance = escopoSql(ctx, null, 'td.empresa_id');
  return db()
    .prepare(
      `SELECT td.id, td.nome, td.ativo, td.empresa_id, e.nome AS empresa_nome
         FROM tipos_despesa td JOIN empresas e ON e.id = td.empresa_id
        WHERE ${alcance.sql} ${incluirInativos ? '' : 'AND td.ativo = 1'}
        ORDER BY e.nome, td.nome`,
    )
    .all(...alcance.params);
}

export function criarTipoDespesa(ctx: Contexto, nome: string) {
  const limpo = nome.trim();
  if (!limpo) throw erroValidacao('Nome do tipo de despesa é obrigatório.');
  const existente = db()
    .prepare('SELECT id, ativo FROM tipos_despesa WHERE empresa_id = ? AND nome = ?')
    .get(ctx.empresaId, limpo) as { id: number; ativo: number } | undefined;
  if (existente) throw erroConflito(`O tipo de despesa "${limpo}" já existe nesta empresa.`);
  const info = db()
    .prepare('INSERT INTO tipos_despesa (empresa_id, nome) VALUES (?, ?)')
    .run(ctx.empresaId, limpo);
  const id = Number(info.lastInsertRowid);
  auditar(ctx, { entidade: 'tipo_despesa', entidadeId: id, acao: 'criar', depois: { nome: limpo } });
  return { id, nome: limpo, ativo: 1 };
}

export function atualizarTipoDespesa(ctx: Contexto, id: number, dados: { nome?: string; ativo?: boolean }) {
  const antes = db()
    .prepare('SELECT id, nome, ativo FROM tipos_despesa WHERE id = ? AND empresa_id = ?')
    .get(id, ctx.empresaId) as { id: number; nome: string; ativo: number } | undefined;
  if (!antes) throw erroNaoEncontrado(`Tipo de despesa ${id} não encontrado nesta empresa.`);
  db()
    .prepare('UPDATE tipos_despesa SET nome = ?, ativo = ? WHERE id = ? AND empresa_id = ?')
    .run(dados.nome?.trim() || antes.nome, dados.ativo === undefined ? antes.ativo : dados.ativo ? 1 : 0, id, ctx.empresaId);
  const depois = db().prepare('SELECT id, nome, ativo FROM tipos_despesa WHERE id = ?').get(id);
  auditar(ctx, { entidade: 'tipo_despesa', entidadeId: id, acao: 'atualizar', antes, depois });
  return depois;
}

/** Resolve um tipo pelo nome; opcionalmente cria (usado na importação). */
export function resolverTipoDespesa(
  empresaId: number,
  nome: string,
  criarSeAusente = false,
): { id: number; criado: boolean } | null {
  const limpo = nome.trim();
  const existente = db()
    .prepare('SELECT id FROM tipos_despesa WHERE empresa_id = ? AND nome = ? COLLATE NOCASE')
    .get(empresaId, limpo) as { id: number } | undefined;
  if (existente) return { id: existente.id, criado: false };
  if (!criarSeAusente) return null;
  const info = db().prepare('INSERT INTO tipos_despesa (empresa_id, nome) VALUES (?, ?)').run(empresaId, limpo);
  return { id: Number(info.lastInsertRowid), criado: true };
}

// -------------------------------------------------------- Tópicos de ajuda

export function listarTopicosAjuda(ctx: Contexto, incluirInativos = false) {
  return db()
    .prepare(
      `SELECT id, nome, ativo FROM topicos_ajuda
        WHERE empresa_id = ? ${incluirInativos ? '' : 'AND ativo = 1'}
        ORDER BY nome`,
    )
    .all(ctx.empresaId);
}

export function criarTopicoAjuda(ctx: Contexto, nome: string) {
  const limpo = nome.trim();
  if (!limpo) throw erroValidacao('Nome do tópico de ajuda é obrigatório.');
  const existente = db()
    .prepare('SELECT id FROM topicos_ajuda WHERE empresa_id = ? AND nome = ?')
    .get(ctx.empresaId, limpo);
  if (existente) throw erroConflito(`O tópico "${limpo}" já existe nesta empresa.`);
  const info = db().prepare('INSERT INTO topicos_ajuda (empresa_id, nome) VALUES (?, ?)').run(ctx.empresaId, limpo);
  const id = Number(info.lastInsertRowid);
  auditar(ctx, { entidade: 'topico_ajuda', entidadeId: id, acao: 'criar', depois: { nome: limpo } });
  return { id, nome: limpo, ativo: 1 };
}

export function atualizarTopicoAjuda(ctx: Contexto, id: number, dados: { nome?: string; ativo?: boolean }) {
  const antes = db()
    .prepare('SELECT id, nome, ativo FROM topicos_ajuda WHERE id = ? AND empresa_id = ?')
    .get(id, ctx.empresaId) as { id: number; nome: string; ativo: number } | undefined;
  if (!antes) throw erroNaoEncontrado(`Tópico de ajuda ${id} não encontrado nesta empresa.`);
  db()
    .prepare('UPDATE topicos_ajuda SET nome = ?, ativo = ? WHERE id = ? AND empresa_id = ?')
    .run(dados.nome?.trim() || antes.nome, dados.ativo === undefined ? antes.ativo : dados.ativo ? 1 : 0, id, ctx.empresaId);
  const depois = db().prepare('SELECT id, nome, ativo FROM topicos_ajuda WHERE id = ?').get(id);
  auditar(ctx, { entidade: 'topico_ajuda', entidadeId: id, acao: 'atualizar', antes, depois });
  return depois;
}

export function resolverTopicoAjuda(
  empresaId: number,
  nome: string | null | undefined,
  criarSeAusente = false,
): number | null {
  if (!nome?.trim()) return null;
  const limpo = nome.trim();
  const existente = db()
    .prepare('SELECT id FROM topicos_ajuda WHERE empresa_id = ? AND nome = ? COLLATE NOCASE')
    .get(empresaId, limpo) as { id: number } | undefined;
  if (existente) return existente.id;
  if (!criarSeAusente) return null;
  const info = db().prepare('INSERT INTO topicos_ajuda (empresa_id, nome) VALUES (?, ?)').run(empresaId, limpo);
  return Number(info.lastInsertRowid);
}

// ------------------------------------------------------------ Filas SLA

/** Filas padrão criadas junto com toda empresa nova. */
// ------------------------------------------------------------------ Setores
//
// A área da empresa que fez a solicitação. Vem dos sistemas de suporte, que
// nem sempre a informam — daí o destino abaixo.

/** Destino do chamado cujo setor a origem não informou. */
export const SETOR_NAO_CLASSIFICADO = 'Não classificado';

export function listarSetores(ctx: Contexto, incluirInativos = false) {
  return db()
    .prepare(
      `SELECT id, nome, ativo FROM setores
        WHERE empresa_id = ? ${incluirInativos ? '' : 'AND ativo = 1'}
        ORDER BY nome`,
    )
    .all(ctx.empresaId);
}

export function criarSetor(ctx: Contexto, nome: string) {
  const limpo = nome.trim();
  if (!limpo) throw erroValidacao('Nome do setor é obrigatório.');
  const existente = db().prepare('SELECT id FROM setores WHERE empresa_id = ? AND nome = ?').get(ctx.empresaId, limpo);
  if (existente) throw erroConflito(`O setor "${limpo}" já existe nesta empresa.`);
  const info = db().prepare('INSERT INTO setores (empresa_id, nome) VALUES (?, ?)').run(ctx.empresaId, limpo);
  const id = Number(info.lastInsertRowid);
  auditar(ctx, { entidade: 'setor', entidadeId: id, acao: 'criar', depois: { nome: limpo } });
  return { id, nome: limpo, ativo: 1 };
}

export function atualizarSetor(ctx: Contexto, id: number, dados: { nome?: string; ativo?: boolean }) {
  const antes = db()
    .prepare('SELECT id, nome, ativo FROM setores WHERE id = ? AND empresa_id = ?')
    .get(id, ctx.empresaId) as { id: number; nome: string; ativo: number } | undefined;
  if (!antes) throw erroNaoEncontrado(`Setor ${id} não encontrado nesta empresa.`);
  db()
    .prepare('UPDATE setores SET nome = ?, ativo = ? WHERE id = ? AND empresa_id = ?')
    .run(dados.nome?.trim() || antes.nome, dados.ativo === undefined ? antes.ativo : dados.ativo ? 1 : 0, id, ctx.empresaId);
  const depois = db().prepare('SELECT id, nome, ativo FROM setores WHERE id = ?').get(id);
  auditar(ctx, { entidade: 'setor', entidadeId: id, acao: 'atualizar', antes, depois });
  return depois;
}

/**
 * Id do setor pelo nome, criando-o quando ainda não existe. A integração
 * cria: recusar um chamado por causa de um setor novo perderia o chamado, e o
 * setor é um cadastro livre como os demais.
 */
export function resolverSetor(empresaId: number, nome: string | null | undefined): number {
  const limpo = (nome ?? '').trim() || SETOR_NAO_CLASSIFICADO;
  const existente = db().prepare('SELECT id FROM setores WHERE empresa_id = ? AND nome = ?').get(empresaId, limpo) as
    | { id: number }
    | undefined;
  if (existente) return existente.id;
  const info = db().prepare('INSERT INTO setores (empresa_id, nome) VALUES (?, ?)').run(empresaId, limpo);
  return Number(info.lastInsertRowid);
}

export const FILAS_PADRAO = ['Infraestrutura', 'Sistema', 'Dados'] as const;

export function listarFilas(ctx: Contexto) {
  return db()
    .prepare('SELECT id, nome, ativo FROM filas_ticket WHERE empresa_id = ? AND ativo = 1 ORDER BY ordem, nome')
    .all(ctx.empresaId);
}

/**
 * As filas nascem como Infraestrutura | Sistema | Dados, mas o cadastro é
 * expansível: novas filas entram sem migração dos dados existentes.
 */
export function criarFila(ctx: Contexto, nome: string) {
  const limpo = nome.trim();
  if (!limpo) throw erroValidacao('Nome da fila é obrigatório.');
  const existente = db()
    .prepare('SELECT id FROM filas_ticket WHERE empresa_id = ? AND nome = ? COLLATE NOCASE')
    .get(ctx.empresaId, limpo);
  if (existente) throw erroConflito(`A fila "${limpo}" já existe nesta empresa.`);
  const ordem = (
    db()
      .prepare('SELECT COALESCE(MAX(ordem), 0) + 1 AS n FROM filas_ticket WHERE empresa_id = ?')
      .get(ctx.empresaId) as { n: number }
  ).n;
  const info = db()
    .prepare('INSERT INTO filas_ticket (empresa_id, nome, ordem) VALUES (?, ?, ?)')
    .run(ctx.empresaId, limpo, ordem);
  const id = Number(info.lastInsertRowid);
  auditar(ctx, { entidade: 'fila_ticket', entidadeId: id, acao: 'criar', depois: { nome: limpo } });
  return { id, nome: limpo, ativo: 1 };
}

export function resolverFila(empresaId: number, nome: string): number | null {
  const linha = db()
    .prepare('SELECT id FROM filas_ticket WHERE empresa_id = ? AND nome = ? COLLATE NOCASE')
    .get(empresaId, nome.trim()) as { id: number } | undefined;
  return linha?.id ?? null;
}
