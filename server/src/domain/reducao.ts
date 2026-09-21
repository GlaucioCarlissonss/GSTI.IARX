/**
 * PLANO DE REDUÇÃO DE DESPESAS — de quanto para quanto cada despesa deve cair.
 *
 * O sistema já sabia dizer se o custo subiu ou desceu, e `metas` já dava um
 * alvo percentual por indicador inteiro ("não crescer mais que X%"). Nenhum dos
 * dois responde à pergunta que o gestor leva para a reunião de corte: *esta*
 * despesa custa R$ 50.000 e precisa cair para R$ 35.000 — quanto isso é do
 * grupo, e quanto pesa em cada filial?
 *
 * Por isso o alvo aqui é em REAIS e por despesa, e não um percentual por
 * módulo. Uma linha por despesa escolhida: um alvo único cobrindo cinco
 * categorias não teria como mostrar de quanto para quanto cai cada uma, que é
 * exatamente a leitura pedida.
 *
 * A vigência funciona como a de `metas`: trocar o alvo em janeiro não reescreve
 * a leitura dos meses já fechados.
 */
import { db } from '../db/index.js';
import { erroConflito, erroNaoEncontrado, erroValidacao } from '../lib/erros.js';
import { auditar } from './auditoria.js';
import { ehCompetenciaValida, paraInterno } from './competencia.js';
import { paraCentavos, paraReais } from './dinheiro.js';
import type { Contexto } from './contexto.js';

export interface LinhaPlanoReducao {
  id: number;
  nome: string;
  tipo_despesa_id: number | null;
  tipo_despesa: string | null;
  filial_id: number | null;
  filial: string | null;
  valor_alvo_centavos: number;
  valor_alvo: number;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  ativo: number;
}

function clienteDo(ctx: Contexto): number {
  if (ctx.clienteId === null) throw erroValidacao('Operação sem cliente em foco.');
  return ctx.clienteId;
}

/** Competência opcional: vazio vira nulo, preenchido tem de ser válido. */
function vigencia(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null || valor === '') return null;
  if (!ehCompetenciaValida(valor)) throw erroValidacao(`${campo} inválida. Use o formato MM/AAAA.`);
  return paraInterno(valor);
}

function validarAlvo(valor: unknown): number {
  if (valor === undefined || valor === null || valor === '') {
    throw erroValidacao('O valor-alvo do plano é obrigatório.');
  }
  let centavos: number;
  try {
    centavos = paraCentavos(valor);
  } catch {
    throw erroValidacao('O valor-alvo do plano precisa ser um valor em reais.');
  }
  if (centavos < 0) throw erroValidacao('O valor-alvo do plano não pode ser negativo.');
  return centavos;
}

/**
 * Tipo de despesa e filial precisam ser do CLIENTE em foco.
 *
 * Sem esta conferência, um id de outro contratante entraria no plano e o
 * indicador passaria a casar lançamentos que o gestor não pode nem ver.
 */
function validarTipoDespesa(clienteId: number, valor: unknown): number | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const id = Number(valor);
  if (!Number.isInteger(id)) throw erroValidacao('Tipo de despesa inválido.');
  const existe = db()
    .prepare(
      `SELECT td.id FROM tipos_despesa td
         JOIN empresas e ON e.id = td.empresa_id
        WHERE td.id = ? AND e.cliente_id = ?`,
    )
    .get(id, clienteId);
  if (!existe) throw erroNaoEncontrado(`Tipo de despesa ${id} não encontrado neste cliente.`);
  return id;
}

function validarFilial(clienteId: number, valor: unknown): number | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const id = Number(valor);
  if (!Number.isInteger(id)) throw erroValidacao('Filial inválida.');
  const existe = db()
    .prepare(
      `SELECT f.id FROM filiais f
         JOIN empresas e ON e.id = f.empresa_id
        WHERE f.id = ? AND e.cliente_id = ?`,
    )
    .get(id, clienteId);
  if (!existe) throw erroNaoEncontrado(`Filial ${id} não encontrada neste cliente.`);
  return id;
}

const SELECT_PLANO = `
  SELECT p.id, p.nome, p.tipo_despesa_id, td.nome AS tipo_despesa,
         p.filial_id, f.nome AS filial,
         p.valor_alvo_centavos, p.vigencia_inicio, p.vigencia_fim, p.ativo
    FROM planos_reducao p
    LEFT JOIN tipos_despesa td ON td.id = p.tipo_despesa_id
    LEFT JOIN filiais f ON f.id = p.filial_id`;

function apresentar(linha: Omit<LinhaPlanoReducao, 'valor_alvo'>): LinhaPlanoReducao {
  return { ...linha, valor_alvo: paraReais(linha.valor_alvo_centavos) };
}

export function listarPlanos(ctx: Contexto, incluirInativos = false): LinhaPlanoReducao[] {
  const linhas = db()
    .prepare(
      `${SELECT_PLANO}
        WHERE p.cliente_id = ? ${incluirInativos ? '' : 'AND p.ativo = 1'}
        ORDER BY p.nome`,
    )
    .all(clienteDo(ctx)) as Array<Omit<LinhaPlanoReducao, 'valor_alvo'>>;
  return linhas.map(apresentar);
}

export interface EntradaPlanoReducao {
  nome?: unknown;
  tipo_despesa_id?: unknown;
  filial_id?: unknown;
  valor_alvo?: unknown;
  vigencia_inicio?: unknown;
  vigencia_fim?: unknown;
}

export function criarPlano(ctx: Contexto, dados: EntradaPlanoReducao): LinhaPlanoReducao {
  const clienteId = clienteDo(ctx);
  const nome = String(dados.nome ?? '').trim();
  if (!nome) throw erroValidacao('Nome do item do plano é obrigatório.');
  const tipoDespesaId = validarTipoDespesa(clienteId, dados.tipo_despesa_id);
  const filialId = validarFilial(clienteId, dados.filial_id);
  const alvo = validarAlvo(dados.valor_alvo);
  const inicio = vigencia(dados.vigencia_inicio, 'Vigência inicial');
  const fim = vigencia(dados.vigencia_fim, 'Vigência final');
  if (inicio && fim && inicio > fim) throw erroValidacao('A vigência final é anterior à inicial.');

  const existente = db()
    .prepare('SELECT id FROM planos_reducao WHERE cliente_id = ? AND nome = ?')
    .get(clienteId, nome);
  if (existente) throw erroConflito(`O item "${nome}" já existe no plano deste cliente.`);

  const info = db()
    .prepare(
      `INSERT INTO planos_reducao
         (cliente_id, nome, tipo_despesa_id, filial_id, valor_alvo_centavos, vigencia_inicio, vigencia_fim)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(clienteId, nome, tipoDespesaId, filialId, alvo, inicio, fim);
  const id = Number(info.lastInsertRowid);
  const criado = obterPlano(ctx, id);
  auditar(ctx, { entidade: 'plano_reducao', entidadeId: id, acao: 'criar', depois: criado, comEmpresa: false });
  return criado;
}

export function obterPlano(ctx: Contexto, id: number): LinhaPlanoReducao {
  const linha = db()
    .prepare(`${SELECT_PLANO} WHERE p.id = ? AND p.cliente_id = ?`)
    .get(id, clienteDo(ctx)) as Omit<LinhaPlanoReducao, 'valor_alvo'> | undefined;
  if (!linha) throw erroNaoEncontrado(`Item ${id} do plano de redução não encontrado neste cliente.`);
  return apresentar(linha);
}

export function atualizarPlano(
  ctx: Contexto,
  id: number,
  dados: EntradaPlanoReducao & { ativo?: unknown },
): LinhaPlanoReducao {
  const clienteId = clienteDo(ctx);
  const antes = obterPlano(ctx, id);
  const nome = dados.nome === undefined ? antes.nome : String(dados.nome).trim() || antes.nome;
  const tipoDespesaId =
    dados.tipo_despesa_id === undefined ? antes.tipo_despesa_id : validarTipoDespesa(clienteId, dados.tipo_despesa_id);
  const filialId = dados.filial_id === undefined ? antes.filial_id : validarFilial(clienteId, dados.filial_id);
  const alvo = dados.valor_alvo === undefined ? antes.valor_alvo_centavos : validarAlvo(dados.valor_alvo);
  const inicio =
    dados.vigencia_inicio === undefined ? antes.vigencia_inicio : vigencia(dados.vigencia_inicio, 'Vigência inicial');
  const fim = dados.vigencia_fim === undefined ? antes.vigencia_fim : vigencia(dados.vigencia_fim, 'Vigência final');
  if (inicio && fim && inicio > fim) throw erroValidacao('A vigência final é anterior à inicial.');
  const ativo = dados.ativo === undefined ? antes.ativo : dados.ativo ? 1 : 0;

  if (nome !== antes.nome) {
    const existente = db()
      .prepare('SELECT id FROM planos_reducao WHERE cliente_id = ? AND nome = ? AND id <> ?')
      .get(clienteId, nome, id);
    if (existente) throw erroConflito(`O item "${nome}" já existe no plano deste cliente.`);
  }

  db()
    .prepare(
      `UPDATE planos_reducao
          SET nome = ?, tipo_despesa_id = ?, filial_id = ?, valor_alvo_centavos = ?,
              vigencia_inicio = ?, vigencia_fim = ?, ativo = ?
        WHERE id = ? AND cliente_id = ?`,
    )
    .run(nome, tipoDespesaId, filialId, alvo, inicio, fim, ativo, id, clienteId);
  const depois = obterPlano(ctx, id);
  auditar(ctx, { entidade: 'plano_reducao', entidadeId: id, acao: 'atualizar', antes, depois, comEmpresa: false });
  return depois;
}

/**
 * Os itens do plano que regem esta competência.
 *
 * Diferente de `metaVigente`, que devolve UMA meta por módulo, aqui todos os
 * itens vigentes valem ao mesmo tempo: o plano é um conjunto de despesas, e
 * escolher uma delas descartaria as outras quatro que o gestor cadastrou.
 */
export function planosVigentes(ctx: Contexto, competencia?: string): LinhaPlanoReducao[] {
  if (ctx.clienteId === null) return [];
  const comp = competencia ? paraInterno(competencia) : null;
  const linhas = db()
    .prepare(
      `${SELECT_PLANO}
        WHERE p.cliente_id = ? AND p.ativo = 1
          AND (p.vigencia_inicio IS NULL OR ? IS NULL OR p.vigencia_inicio <= ?)
          AND (p.vigencia_fim    IS NULL OR ? IS NULL OR p.vigencia_fim    >= ?)
        ORDER BY p.nome`,
    )
    .all(ctx.clienteId, comp, comp, comp, comp) as Array<Omit<LinhaPlanoReducao, 'valor_alvo'>>;
  return linhas.map(apresentar);
}
