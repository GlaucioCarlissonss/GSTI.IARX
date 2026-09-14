import { db, emTransacao } from '../db/index.js';
import { erroConflito, erroNaoEncontrado, erroValidacao } from '../lib/erros.js';
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
      `SELECT e.id, e.nome, e.cnpj, e.status, e.cliente_id, ue.papel
         FROM empresas e JOIN usuario_empresas ue ON ue.empresa_id = e.id
        WHERE ue.usuario_id = ? ORDER BY e.nome`,
    )
    .all(usuarioId) as EmpresaDoUsuario[];
}

/**
 * As matrizes DESTE cliente a que esta pessoa tem acesso — o escopo de leitura
 * de todas as telas.
 *
 * O cruzamento é o ponto: nem todas as empresas do cliente (haveria vazamento
 * entre usuários do mesmo contratante), nem todas as empresas do usuário (elas
 * podem ser de clientes diferentes, e o recorte externo é o cliente).
 */
export function empresasAcessiveis(usuarioId: number, clienteId: number): number[] {
  return (
    db()
      .prepare(
        `SELECT e.id
           FROM empresas e JOIN usuario_empresas ue ON ue.empresa_id = e.id
          WHERE ue.usuario_id = ? AND e.cliente_id = ?
          ORDER BY e.nome`,
      )
      .all(usuarioId, clienteId) as Array<{ id: number }>
  ).map((e) => e.id);
}

export function acessoDoUsuario(usuarioId: number, empresaId: number): 'gestor' | 'leitor' | null {
  const linha = db()
    .prepare('SELECT papel FROM usuario_empresas WHERE usuario_id = ? AND empresa_id = ?')
    .get(usuarioId, empresaId) as { papel: 'gestor' | 'leitor' } | undefined;
  return linha?.papel ?? null;
}

/**
 * Deixa a matriz recém-criada PRONTA para receber dado: catálogos padrão e,
 * quando há um usuário criando, o vínculo que a faz aparecer no seletor.
 *
 * Toda porta de criação de matriz passa por aqui — é o que evita a matriz que
 * existe no banco, não aparece para ninguém e não aceita lançamento por falta
 * de tipo de despesa.
 */
export function prepararMatriz(empresaId: number, usuarioId?: number): void {
  if (usuarioId) {
    db()
      .prepare(
        `INSERT INTO usuario_empresas (usuario_id, empresa_id, papel) VALUES (?, ?, 'gestor')
         ON CONFLICT (usuario_id, empresa_id) DO NOTHING`,
      )
      .run(usuarioId, empresaId);
  }
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
    db()
      .prepare('INSERT OR IGNORE INTO usuario_clientes (usuario_id, cliente_id) VALUES (?, ?)')
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

export function concederAcesso(empresaId: number, email: string, papel: 'gestor' | 'leitor') {
  const usuario = db().prepare('SELECT id FROM usuarios WHERE email = ?').get(email.trim()) as
    | { id: number }
    | undefined;
  if (!usuario) throw erroNaoEncontrado(`Nenhum usuário cadastrado com o e-mail ${email}.`);
  const existente = acessoDoUsuario(usuario.id, empresaId);
  if (existente === papel) throw erroConflito(`O usuário já possui o papel "${papel}" nesta empresa.`);
  db()
    .prepare(
      `INSERT INTO usuario_empresas (usuario_id, empresa_id, papel) VALUES (?, ?, ?)
       ON CONFLICT (usuario_id, empresa_id) DO UPDATE SET papel = excluded.papel`,
    )
    .run(usuario.id, empresaId, papel);
  return { usuario_id: usuario.id, email, papel };
}

export function listarAcessos(empresaId: number) {
  return db()
    .prepare(
      `SELECT u.id AS usuario_id, u.nome, u.email, ue.papel
         FROM usuario_empresas ue JOIN usuarios u ON u.id = ue.usuario_id
        WHERE ue.empresa_id = ? ORDER BY u.nome`,
    )
    .all(empresaId);
}
