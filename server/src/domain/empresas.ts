import { db, emTransacao } from '../db/index.js';
import { erroConflito, erroNaoEncontrado, erroValidacao } from '../lib/erros.js';
import { TIPOS_DESPESA_PADRAO } from './cadastros.js';

export interface EmpresaDoUsuario {
  id: number;
  nome: string;
  cnpj: string | null;
  status: string;
  papel: 'gestor' | 'leitor';
}

export function listarEmpresasDoUsuario(usuarioId: number): EmpresaDoUsuario[] {
  return db()
    .prepare(
      `SELECT e.id, e.nome, e.cnpj, e.status, ue.papel
         FROM empresas e JOIN usuario_empresas ue ON ue.empresa_id = e.id
        WHERE ue.usuario_id = ? ORDER BY e.nome`,
    )
    .all(usuarioId) as EmpresaDoUsuario[];
}

export function acessoDoUsuario(usuarioId: number, empresaId: number): 'gestor' | 'leitor' | null {
  const linha = db()
    .prepare('SELECT papel FROM usuario_empresas WHERE usuario_id = ? AND empresa_id = ?')
    .get(usuarioId, empresaId) as { papel: 'gestor' | 'leitor' } | undefined;
  return linha?.papel ?? null;
}

/**
 * Cria a empresa, vincula o criador como gestor e semeia os tipos de despesa
 * padrão — a empresa nasce pronta para receber lançamentos.
 */
export function criarEmpresa(
  usuarioId: number,
  dados: { nome: string; cnpj?: string | null },
): EmpresaDoUsuario {
  if (!dados.nome?.trim()) throw erroValidacao('O nome da empresa é obrigatório.');
  return emTransacao(() => {
    const info = db()
      .prepare('INSERT INTO empresas (nome, cnpj) VALUES (?, ?)')
      .run(dados.nome.trim(), dados.cnpj?.trim() || null);
    const empresaId = Number(info.lastInsertRowid);
    db()
      .prepare("INSERT INTO usuario_empresas (usuario_id, empresa_id, papel) VALUES (?, ?, 'gestor')")
      .run(usuarioId, empresaId);
    const inserirTipo = db().prepare('INSERT INTO tipos_despesa (empresa_id, nome) VALUES (?, ?)');
    for (const tipo of TIPOS_DESPESA_PADRAO) inserirTipo.run(empresaId, tipo);
    return { id: empresaId, nome: dados.nome.trim(), cnpj: dados.cnpj ?? null, status: 'ativa', papel: 'gestor' };
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
