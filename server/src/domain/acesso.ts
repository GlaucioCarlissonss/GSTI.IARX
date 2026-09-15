/**
 * Perfis e permissões.
 *
 * Três camadas, nesta ordem: o MÓDULO é visível ou não; dentro dele, a AÇÃO é
 * permitida ou não; e, para quem edita, o CAMPO é alterável ou não. Todas as
 * três valem no servidor — o que o front esconde é conveniência, não defesa.
 *
 * O perfil fica no vínculo com o CLIENTE, e não no usuário: o sistema é
 * multi-tenant por regra, e o mesmo usuário já podia ser gestor num cliente e
 * leitor em outro. Um perfil por usuário faria quem administra um contratante
 * virar administrador em todos. Vale para TODAS as matrizes e filiais do
 * cliente de uma vez — já foi por matriz individual; a migração de bases
 * antigas está em `db/index.ts`.
 */
import { db } from '../db/index.js';
import { erroNaoEncontrado, erroSemPermissao, erroValidacao } from '../lib/erros.js';
import type { Contexto } from './contexto.js';
import { auditar } from './auditoria.js';

export type TipoPerfil = 'VIEW_ONLY' | 'EDIT';
export type Acao = 'view' | 'create' | 'edit' | 'delete' | 'export' | 'import';

export const ACOES: Acao[] = ['view', 'create', 'edit', 'delete', 'export', 'import'];

/** Os módulos que o perfil controla, com o rótulo que a tela mostra. */
export const MODULOS = [
  { id: 'projetos', rotulo: 'Projetos' },
  { id: 'suporte_ostick', rotulo: 'Suporte (OStick)' },
  { id: 'suporte_bitrix24', rotulo: 'Suporte (Bitrix24)' },
  { id: 'financeiro', rotulo: 'Financeiro' },
  { id: 'relatorios', rotulo: 'Relatórios' },
  { id: 'integracoes', rotulo: 'Integrações' },
  { id: 'usuarios', rotulo: 'Usuários e Acessos' },
  { id: 'configuracoes', rotulo: 'Configurações' },
] as const;

const IDS_MODULO = MODULOS.map((m) => m.id) as string[];

export const PERFIL_LEITURA = 'Somente Visualização';
export const PERFIL_EDICAO = 'Edição';

/**
 * O cliente em contexto, ou recusa. `Contexto.clienteId` é nullable só para a
 * base histórica anterior a esta camada — na prática, toda requisição
 * autenticada já resolveu um cliente antes de chegar aqui, e este é o ponto
 * único de falha explícita (fail-closed) quando isso não aconteceu.
 */
function exigirClienteEmContexto(ctx: Contexto): number {
  if (ctx.clienteId === null) throw erroValidacao('Não há cliente em contexto para esta operação.');
  return ctx.clienteId;
}

interface LinhaPerfil {
  id: number;
  cliente_id: number;
  nome: string;
  tipo: TipoPerfil;
  padrao: number;
  criado_em: string;
}

// ------------------------------------------------------------ perfis padrão

/**
 * Garante os dois perfis de sistema do cliente. São criados na primeira
 * consulta, e não numa migração: cliente novo precisa deles igual.
 */
export function garantirPerfisPadrao(clienteId: number): void {
  const existe = db()
    .prepare('SELECT COUNT(*) AS n FROM perfis WHERE cliente_id = ? AND padrao = 1')
    .get(clienteId) as { n: number };
  if (existe.n >= 2) return;

  const criar = db().prepare(
    'INSERT OR IGNORE INTO perfis (cliente_id, nome, tipo, padrao) VALUES (?, ?, ?, 1)',
  );
  criar.run(clienteId, PERFIL_LEITURA, 'VIEW_ONLY');
  criar.run(clienteId, PERFIL_EDICAO, 'EDIT');

  const idDe = (nome: string) =>
    (db().prepare('SELECT id FROM perfis WHERE cliente_id = ? AND nome = ?').get(clienteId, nome) as
      | { id: number }
      | undefined)?.id;

  const leitura = idDe(PERFIL_LEITURA);
  const edicao = idDe(PERFIL_EDICAO);
  const permitir = db().prepare(
    `INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido) VALUES (?, ?, ?, ?)
       ON CONFLICT(perfil_id, modulo, acao) DO UPDATE SET permitido = excluded.permitido`,
  );

  // Módulos que administram o próprio sistema. Não são "conteúdo somente
  // leitura": quem tem acesso, com que e-mail e papel, e qual é o endereço e o
  // estado de cada integração são informação de administração.
  const ADMINISTRATIVOS = new Set(['usuarios', 'integracoes']);

  for (const modulo of IDS_MODULO) {
    // Visualização vê o conteúdo e não escreve nada — nem exporta a base, que
    // é escrita nenhuma mas é saída de dado.
    if (leitura) {
      const vê = !ADMINISTRATIVOS.has(modulo);
      for (const acao of ACOES) permitir.run(leitura, modulo, acao, acao === 'view' && vê ? 1 : 0);
    }
    // Edição faz tudo, menos administrar acessos: dar permissão a si mesmo é o
    // caminho mais curto para o perfil deixar de significar alguma coisa.
    if (edicao) {
      const podeTudo = modulo !== 'usuarios';
      for (const acao of ACOES) permitir.run(edicao, modulo, acao, podeTudo ? 1 : 0);
    }
  }
}

// ------------------------------------------------------------------ consulta

export interface PermissoesDoPerfil {
  [modulo: string]: Partial<Record<Acao, boolean>>;
}

function permissoesDe(perfilId: number): PermissoesDoPerfil {
  const linhas = db()
    .prepare('SELECT modulo, acao, permitido FROM perfil_permissoes WHERE perfil_id = ?')
    .all(perfilId) as Array<{ modulo: string; acao: Acao; permitido: number }>;
  const mapa: PermissoesDoPerfil = {};
  for (const l of linhas) {
    mapa[l.modulo] = mapa[l.modulo] ?? {};
    mapa[l.modulo]![l.acao] = l.permitido === 1;
  }
  return mapa;
}

function camposDe(perfilId: number): Record<string, string[]> {
  const linhas = db()
    .prepare('SELECT modulo, campo FROM perfil_campos WHERE perfil_id = ? AND pode_editar = 0')
    .all(perfilId) as Array<{ modulo: string; campo: string }>;
  const mapa: Record<string, string[]> = {};
  for (const l of linhas) (mapa[l.modulo] = mapa[l.modulo] ?? []).push(l.campo);
  return mapa;
}

export function apresentarPerfil(linha: LinhaPerfil) {
  return {
    id: linha.id,
    nome: linha.nome,
    tipo: linha.tipo,
    padrao: linha.padrao === 1,
    criado_em: linha.criado_em,
    permissoes: permissoesDe(linha.id),
    // Só os BLOQUEADOS: sem nenhuma linha, valem todos os campos. Exigir a
    // lista completa transformaria cada campo novo numa permissão esquecida.
    campos_bloqueados: camposDe(linha.id),
  };
}

export function listarPerfis(ctx: Contexto) {
  const clienteId = exigirClienteEmContexto(ctx);
  garantirPerfisPadrao(clienteId);
  const linhas = db()
    .prepare('SELECT * FROM perfis WHERE cliente_id = ? ORDER BY padrao DESC, nome')
    .all(clienteId) as LinhaPerfil[];
  return linhas.map(apresentarPerfil);
}

function obterPerfil(clienteId: number, perfilId: number): LinhaPerfil {
  const linha = db()
    .prepare('SELECT * FROM perfis WHERE id = ? AND cliente_id = ?')
    .get(perfilId, clienteId) as LinhaPerfil | undefined;
  if (!linha) throw erroNaoEncontrado(`Perfil ${perfilId} não encontrado neste cliente.`);
  return linha;
}

/**
 * O que o usuário pode neste cliente — vale em toda matriz e filial dele.
 * `gestor` mantém o papel antigo valendo: quem é gestor pode tudo, e o perfil
 * refina o resto. Sem isso, a migração tiraria acesso de quem já tinha — e um
 * sistema que tranca o próprio dono na atualização não é mais seguro, é só
 * inútil.
 */
export function permissoesDoUsuario(usuarioId: number, clienteId: number) {
  garantirPerfisPadrao(clienteId);
  const vinculo = db()
    .prepare('SELECT papel, perfil_id FROM usuario_clientes WHERE usuario_id = ? AND cliente_id = ?')
    .get(usuarioId, clienteId) as { papel: string; perfil_id: number | null } | undefined;
  if (!vinculo) {
    return {
      papel: null as string | null,
      perfil: null as { id: number; nome: string; tipo: TipoPerfil } | null,
      permissoes: {} as PermissoesDoPerfil,
      campos_bloqueados: {} as Record<string, string[]>,
    };
  }

  if (vinculo.perfil_id) {
    const perfil = db().prepare('SELECT * FROM perfis WHERE id = ?').get(vinculo.perfil_id) as
      | LinhaPerfil
      | undefined;
    if (perfil && perfil.cliente_id === clienteId) {
      return {
        papel: vinculo.papel,
        perfil: { id: perfil.id, nome: perfil.nome, tipo: perfil.tipo },
        permissoes: permissoesDe(perfil.id),
        campos_bloqueados: camposDe(perfil.id),
      };
    }
  }

  // Sem perfil atribuído, o papel antigo responde: gestor edita, leitor lê.
  const nome = vinculo.papel === 'gestor' ? PERFIL_EDICAO : PERFIL_LEITURA;
  const padrao = db()
    .prepare('SELECT * FROM perfis WHERE cliente_id = ? AND nome = ?')
    .get(clienteId, nome) as LinhaPerfil | undefined;
  return {
    papel: vinculo.papel,
    perfil: padrao ? { id: padrao.id, nome: padrao.nome, tipo: padrao.tipo } : null,
    permissoes: padrao ? permissoesDe(padrao.id) : {},
    campos_bloqueados: padrao ? camposDe(padrao.id) : {},
  };
}

/** Verdadeiro quando o usuário pode a ação no módulo, neste cliente. */
export function permitido(ctx: Contexto, modulo: string, acao: Acao): boolean {
  // O gestor do cliente administra os acessos por definição: fosse preciso um
  // perfil para isso, uma configuração errada trancaria todo mundo para fora.
  if (ctx.papel === 'gestor' && modulo === 'usuarios') return true;
  if (ctx.clienteId === null) return false;
  const p = permissoesDoUsuario(ctx.usuarioId, ctx.clienteId);
  return p.permissoes[modulo]?.[acao] === true;
}

export function exigirPermissao(ctx: Contexto, modulo: string, acao: Acao): void {
  if (!permitido(ctx, modulo, acao)) {
    const rotulo = MODULOS.find((m) => m.id === modulo)?.rotulo ?? modulo;
    throw erroSemPermissao(`Seu perfil não permite ${acao} em ${rotulo}.`);
  }
}

/**
 * Remove da alteração os campos que o perfil não pode mexer. Devolve também o
 * que foi retirado: a tela precisa dizer o que não foi salvo, em vez de
 * fingir que salvou tudo.
 */
export function filtrarCampos<T extends Record<string, unknown>>(
  ctx: Contexto,
  modulo: string,
  dados: T,
): { dados: Partial<T>; bloqueados: string[] } {
  const { campos_bloqueados } = permissoesDoUsuario(ctx.usuarioId, exigirClienteEmContexto(ctx));
  const proibidos = new Set(campos_bloqueados[modulo] ?? []);
  if (proibidos.size === 0) return { dados, bloqueados: [] };
  const saida: Partial<T> = {};
  const bloqueados: string[] = [];
  for (const [chave, valor] of Object.entries(dados)) {
    if (proibidos.has(chave)) bloqueados.push(chave);
    else (saida as Record<string, unknown>)[chave] = valor;
  }
  return { dados: saida, bloqueados };
}

// --------------------------------------------------------------- manutenção

export interface EntradaPerfil {
  nome: string;
  tipo: TipoPerfil;
  permissoes?: PermissoesDoPerfil;
  campos_bloqueados?: Record<string, string[]>;
}

function validarModulo(modulo: string) {
  if (!IDS_MODULO.includes(modulo)) throw erroValidacao(`Módulo desconhecido: "${modulo}".`);
}

function gravarMatriz(perfilId: number, entrada: EntradaPerfil) {
  if (entrada.permissoes) {
    const gravar = db().prepare(
      `INSERT INTO perfil_permissoes (perfil_id, modulo, acao, permitido) VALUES (?, ?, ?, ?)
         ON CONFLICT(perfil_id, modulo, acao) DO UPDATE SET permitido = excluded.permitido`,
    );
    for (const [modulo, acoes] of Object.entries(entrada.permissoes)) {
      validarModulo(modulo);
      for (const acao of ACOES) {
        const marcado = acoes[acao] === true;
        // Sem ver o módulo não há o que criar, editar ou exportar nele: deixar
        // as duas coisas desencontradas daria uma matriz que mente.
        const efetivo = acao === 'view' ? marcado : marcado && acoes.view === true;
        gravar.run(perfilId, modulo, acao, efetivo ? 1 : 0);
      }
    }
  }
  if (entrada.campos_bloqueados) {
    db().prepare('DELETE FROM perfil_campos WHERE perfil_id = ?').run(perfilId);
    const gravar = db().prepare(
      'INSERT INTO perfil_campos (perfil_id, modulo, campo, pode_editar) VALUES (?, ?, ?, 0)',
    );
    for (const [modulo, campos] of Object.entries(entrada.campos_bloqueados)) {
      validarModulo(modulo);
      for (const campo of campos) gravar.run(perfilId, modulo, String(campo).trim());
    }
  }
}

export function criarPerfil(ctx: Contexto, entrada: EntradaPerfil) {
  const clienteId = exigirClienteEmContexto(ctx);
  const nome = entrada.nome?.trim();
  if (!nome) throw erroValidacao('O nome do perfil é obrigatório.');
  if (entrada.tipo !== 'VIEW_ONLY' && entrada.tipo !== 'EDIT') {
    throw erroValidacao('O tipo do perfil precisa ser VIEW_ONLY ou EDIT.');
  }
  const info = db()
    .prepare('INSERT INTO perfis (cliente_id, nome, tipo, padrao) VALUES (?, ?, ?, 0)')
    .run(clienteId, nome, entrada.tipo);
  const id = Number(info.lastInsertRowid);
  gravarMatriz(id, entrada);
  auditar(ctx, {
    entidade: 'perfil',
    entidadeId: id,
    acao: 'criar',
    depois: { nome, tipo: entrada.tipo },
    comEmpresa: false,
  });
  return apresentarPerfil(obterPerfil(clienteId, id));
}

export function atualizarPerfil(ctx: Contexto, perfilId: number, entrada: Partial<EntradaPerfil>) {
  const clienteId = exigirClienteEmContexto(ctx);
  const antes = obterPerfil(clienteId, perfilId);
  if (antes.padrao === 1 && entrada.nome && entrada.nome.trim() !== antes.nome) {
    // Renomear um perfil de sistema quebraria a leitura que cai nele por nome
    // quando o vínculo ainda não tem perfil atribuído.
    throw erroValidacao('Os perfis padrão não podem ser renomeados. Duplique-o para criar uma variação.');
  }
  if (entrada.nome?.trim()) {
    db().prepare('UPDATE perfis SET nome = ? WHERE id = ?').run(entrada.nome.trim(), perfilId);
  }
  if (entrada.tipo) db().prepare('UPDATE perfis SET tipo = ? WHERE id = ?').run(entrada.tipo, perfilId);
  gravarMatriz(perfilId, { nome: antes.nome, tipo: antes.tipo, ...entrada });
  const depois = apresentarPerfil(obterPerfil(clienteId, perfilId));
  auditar(ctx, {
    entidade: 'perfil',
    entidadeId: perfilId,
    acao: 'atualizar',
    antes: apresentarPerfil(antes),
    depois,
    comEmpresa: false,
  });
  return depois;
}

/** Duplicar é o caminho para variar um perfil padrão sem mexer nele. */
export function duplicarPerfil(ctx: Contexto, perfilId: number, nome: string) {
  const origem = obterPerfil(exigirClienteEmContexto(ctx), perfilId);
  const novo = criarPerfil(ctx, {
    nome: nome?.trim() || `${origem.nome} (cópia)`,
    tipo: origem.tipo,
    permissoes: permissoesDe(origem.id),
    campos_bloqueados: camposDe(origem.id),
  });
  return novo;
}

export function excluirPerfil(ctx: Contexto, perfilId: number) {
  const perfil = obterPerfil(exigirClienteEmContexto(ctx), perfilId);
  if (perfil.padrao === 1) throw erroValidacao('Os perfis padrão não podem ser excluídos.');
  const emUso = db()
    .prepare('SELECT COUNT(*) AS n FROM usuario_clientes WHERE perfil_id = ?')
    .get(perfilId) as { n: number };
  if (emUso.n > 0) {
    // Excluir levando os vínculos junto deixaria gente sem perfil em silêncio,
    // e é o oposto da regra de auditoria.
    throw erroValidacao(
      `"${perfil.nome}" está em uso por ${emUso.n} usuário(s). Mude o perfil deles antes de excluir.`,
    );
  }
  db().prepare('DELETE FROM perfis WHERE id = ?').run(perfilId);
  auditar(ctx, {
    entidade: 'perfil',
    entidadeId: perfilId,
    acao: 'excluir',
    antes: apresentarPerfil(perfil),
    comEmpresa: false,
  });
  return { excluido: true };
}
