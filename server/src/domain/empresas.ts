import { db, emTransacao } from '../db/index.js';
import { erroNaoEncontrado, erroValidacao } from '../lib/erros.js';
import { FILAS_PADRAO, TIPOS_DESPESA_PADRAO } from './cadastros.js';

export interface EmpresaDoUsuario {
  id: number;
  nome: string;
  cnpj: string | null;
  status: string;
  papel: 'gestor' | 'leitor';
  /** A quem esta matriz pertence. É o que deixa a tela separar as matrizes por cliente. */
  cliente_id: number | null;
}

export function listarEmpresasDoUsuario(usuarioId: number): EmpresaDoUsuario[] {
  return db()
    .prepare(
      `SELECT e.id, e.nome, e.cnpj, e.status, e.cliente_id, uc.papel
         FROM empresas e JOIN usuario_clientes uc ON uc.cliente_id = e.cliente_id
        WHERE uc.usuario_id = ? ORDER BY e.nome`,
    )
    .all(usuarioId) as EmpresaDoUsuario[];
}

/**
 * As matrizes DESTE cliente a que esta pessoa tem acesso — o escopo de leitura
 * de todas as telas.
 *
 * O acesso é do CLIENTE, não da matriz individual: uma vez vinculado, o
 * usuário vê TODAS as matrizes dele — não há mais como restringir a um
 * subconjunto. (Consulta em SQL puro, em vez de importar `usuarioTemCliente`/
 * `empresasDoCliente` de `clientes.ts`, para não fechar um ciclo de import —
 * aquele módulo já importa deste.)
 */
export function empresasAcessiveis(usuarioId: number, clienteId: number): number[] {
  const tem = db()
    .prepare('SELECT 1 FROM usuario_clientes WHERE usuario_id = ? AND cliente_id = ?')
    .get(usuarioId, clienteId);
  if (!tem) return [];
  return (
    db().prepare('SELECT id FROM empresas WHERE cliente_id = ? ORDER BY nome').all(clienteId) as Array<{
      id: number;
    }>
  ).map((e) => e.id);
}

export function acessoDoUsuario(usuarioId: number, empresaId: number): 'gestor' | 'leitor' | null {
  const linha = db()
    .prepare(
      `SELECT uc.papel FROM usuario_clientes uc
         JOIN empresas e ON e.cliente_id = uc.cliente_id
        WHERE uc.usuario_id = ? AND e.id = ?`,
    )
    .get(usuarioId, empresaId) as { papel: 'gestor' | 'leitor' } | undefined;
  return linha?.papel ?? null;
}

/**
 * Deixa a matriz recém-criada PRONTA para receber dado: catálogos padrão.
 *
 * O vínculo de acesso não é mais daqui: é do cliente (`usuario_clientes`), e
 * uma vez concedido vale para toda matriz dele — inclusive as criadas depois.
 * Toda porta de criação de matriz passa por aqui — é o que evita a matriz que
 * existe no banco e não aceita lançamento por falta de tipo de despesa.
 */
export function prepararMatriz(empresaId: number, _usuarioId?: number): void {
  const temTipo = db().prepare('SELECT id FROM tipos_despesa WHERE empresa_id = ?').get(empresaId);
  if (!temTipo) {
    const inserirTipo = db().prepare('INSERT INTO tipos_despesa (empresa_id, nome) VALUES (?, ?)');
    for (const tipo of TIPOS_DESPESA_PADRAO) inserirTipo.run(empresaId, tipo);
  }
  const temFila = db().prepare('SELECT id FROM filas_ticket WHERE empresa_id = ?').get(empresaId);
  if (!temFila) {
    const inserirFila = db().prepare('INSERT INTO filas_ticket (empresa_id, nome, ordem) VALUES (?, ?, ?)');
    FILAS_PADRAO.forEach((fila, i) => inserirFila.run(empresaId, fila, i + 1));
  }
}

/**
 * Cria a empresa (matriz) e garante que ela tenha DONO.
 *
 * Sem `clienteId`, a empresa vira cliente de si mesma — é o caso de quem
 * contrata uma matriz só, como Limas IT e SoulCoop. Deixar a empresa sem
 * cliente não é opção: o cliente é o recorte mais externo de toda consulta, e
 * uma empresa órfã ficaria invisível para o sistema inteiro.
 */
export function criarEmpresa(
  usuarioId: number,
  dados: { nome: string; cnpj?: string | null; clienteId?: number },
): EmpresaDoUsuario {
  if (!dados.nome?.trim()) throw erroValidacao('O nome da empresa é obrigatório.');
  return emTransacao(() => {
    const nome = dados.nome.trim();
    let clienteId = dados.clienteId;
    if (clienteId === undefined) {
      const existente = db().prepare('SELECT id FROM clientes WHERE nome = ?').get(nome) as
        | { id: number }
        | undefined;
      clienteId =
        existente?.id ??
        Number(db().prepare('INSERT INTO clientes (nome) VALUES (?)').run(nome).lastInsertRowid);
    }
    // Quem cria a empresa é gestor do cliente dela — sem isso, criar seria a
    // forma mais rápida de produzir uma empresa que ninguém administra.
    db()
      .prepare(
        `INSERT INTO usuario_clientes (usuario_id, cliente_id, papel) VALUES (?, ?, 'gestor')
           ON CONFLICT (usuario_id, cliente_id) DO NOTHING`,
      )
      .run(usuarioId, clienteId);

    const info = db()
      .prepare('INSERT INTO empresas (cliente_id, nome, cnpj) VALUES (?, ?, ?)')
      .run(clienteId, nome, dados.cnpj?.trim() || null);
    const empresaId = Number(info.lastInsertRowid);
    prepararMatriz(empresaId, usuarioId);
    return {
      id: empresaId,
      nome: dados.nome.trim(),
      cnpj: dados.cnpj ?? null,
      status: 'ativa',
      papel: 'gestor',
      cliente_id: clienteId,
    };
  });
}

export function atualizarEmpresa(
  empresaId: number,
  dados: { nome?: string; cnpj?: string | null; status?: 'ativa' | 'inativa' },
) {
  const antes = db().prepare('SELECT id, nome, cnpj, status FROM empresas WHERE id = ?').get(empresaId) as
    | { id: number; nome: string; cnpj: string | null; status: string }
    | undefined;
  if (!antes) throw erroNaoEncontrado(`Empresa ${empresaId} não encontrada.`);
  db()
    .prepare('UPDATE empresas SET nome = ?, cnpj = ?, status = ? WHERE id = ?')
    .run(dados.nome?.trim() || antes.nome, dados.cnpj !== undefined ? dados.cnpj : antes.cnpj, dados.status ?? antes.status, empresaId);
  return db().prepare('SELECT id, nome, cnpj, status FROM empresas WHERE id = ?').get(empresaId);
}

