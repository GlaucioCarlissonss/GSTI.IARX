/**
 * Clientes — a camada de contratante, acima da matriz.
 *
 * A hierarquia do negócio é Cliente → Matriz → Filial. No banco ela é
 * `clientes` → `empresas` → `filiais`: a matriz é a empresa com CNPJ base, e a
 * filial é a unidade com CNPJ completo. Os nomes das tabelas ficaram como
 * estavam porque renomeá-las quebraria todo o código por uma palavra, e porque
 * `empresas` sempre foi, no negócio, a matriz.
 *
 * O ISOLAMENTO é a razão de tudo isto existir: nenhuma consulta de negócio
 * atravessa o cliente, e quem pede um cliente a que não está vinculado é
 * recusado no servidor — não escondido na tela.
 */
import { db } from '../db/index.js';
import { prepararMatriz } from './empresas.js';
import { erroNaoEncontrado, erroSemPermissao, erroValidacao } from '../lib/erros.js';

export interface EntradaCliente {
  nome: string;
  documento?: string | null;
  ativo?: boolean;
}

export interface EntradaUnidade {
  nome: string;
  codigo?: string | null;
  cnpj?: string | null;
  endereco?: string | null;
  cep?: string | null;
  cidade?: string | null;
  uf?: string | null;
}

/** Só dígitos: é assim que dois CNPJs se comparam sem discutir pontuação. */
export const digitosDoCnpj = (bruto: string | null | undefined) =>
  String(bruto ?? '').replace(/\D/g, '');

/**
 * Raiz do CNPJ — os oito primeiros dígitos.
 *
 * É o que diz que HM-CE, HM-DF e HM-MT são a mesma matriz: o CNPJ base
 * `29.521.159` se repete, e só o sufixo de filial muda.
 */
export const raizDoCnpj = (bruto: string | null | undefined) => digitosDoCnpj(bruto).slice(0, 8);

/** Uma matriz é a unidade cujo sufixo é 0001; o resto é filial dela. */
export const ehMatriz = (cnpj: string | null | undefined) => digitosDoCnpj(cnpj).slice(8, 12) === '0001';

// --------------------------------------------------------------------- CRUD

export function listarClientes(filtro: { ativo?: boolean } = {}) {
  const condicoes: string[] = [];
  const params: unknown[] = [];
  if (filtro.ativo !== undefined) {
    condicoes.push('c.ativo = ?');
    params.push(filtro.ativo ? 1 : 0);
  }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  return db()
    .prepare(
      `SELECT c.id, c.nome, c.documento, c.ativo, c.criado_em,
              (SELECT COUNT(*) FROM empresas e WHERE e.cliente_id = c.id) AS matrizes,
              (SELECT COUNT(*) FROM filiais f JOIN empresas e ON e.id = f.empresa_id
                WHERE e.cliente_id = c.id) AS filiais
         FROM clientes c ${where} ORDER BY c.nome`,
    )
    .all(...params) as Array<{
    id: number;
    nome: string;
    documento: string | null;
    ativo: number;
    criado_em: string;
    matrizes: number;
    filiais: number;
  }>;
}

/**
 * Os clientes que ESTE usuário pode abrir.
 *
 * É a lista da tela de boas-vindas, e é a mesma que o servidor usa para
 * autorizar: se as duas divergissem, a tela ofereceria o que a API recusa.
 */
export function clientesDoUsuario(usuarioId: number) {
  return db()
    .prepare(
      `SELECT c.id, c.nome, c.documento, c.ativo,
              (SELECT COUNT(*) FROM empresas e WHERE e.cliente_id = c.id) AS matrizes,
              (SELECT COUNT(*) FROM filiais f JOIN empresas e ON e.id = f.empresa_id
                WHERE e.cliente_id = c.id) AS filiais
         FROM clientes c
         JOIN usuario_clientes uc ON uc.cliente_id = c.id
        WHERE uc.usuario_id = ? AND c.ativo = 1
        ORDER BY c.nome`,
    )
    .all(usuarioId) as Array<{
    id: number;
    nome: string;
    documento: string | null;
    ativo: number;
    matrizes: number;
    filiais: number;
  }>;
}

/**
 * O usuário pode este cliente? É a pergunta que decide o 403.
 *
 * A resposta vem do vínculo gravado, nunca do que a requisição afirmou — o
 * cabeçalho é a pergunta, não a prova.
 */
export function usuarioTemCliente(usuarioId: number, clienteId: number): boolean {
  const linha = db()
    .prepare('SELECT 1 FROM usuario_clientes WHERE usuario_id = ? AND cliente_id = ?')
    .get(usuarioId, clienteId);
  return !!linha;
}

export function exigirCliente(usuarioId: number, clienteId: number): number {
  if (!usuarioTemCliente(usuarioId, clienteId)) {
    // A mesma recusa para cliente inexistente e para cliente alheio: distinguir
    // os dois contaria a quem tenta qual id existe.
    throw erroSemPermissao('Você não tem acesso a este cliente.');
  }
  return clienteId;
}

export function criarCliente(entrada: EntradaCliente) {
  const nome = entrada.nome?.trim();
  if (!nome) throw erroValidacao('O nome do cliente é obrigatório.');
  const existente = db().prepare('SELECT id FROM clientes WHERE nome = ?').get(nome);
  if (existente) throw erroValidacao(`Já existe um cliente chamado "${nome}".`);
  const info = db()
    .prepare('INSERT INTO clientes (nome, documento, ativo) VALUES (?, ?, ?)')
    .run(nome, entrada.documento?.trim() || null, entrada.ativo === false ? 0 : 1);
  return obterCliente(Number(info.lastInsertRowid));
}

export function obterCliente(id: number) {
  const linha = db().prepare('SELECT * FROM clientes WHERE id = ?').get(id) as
    | { id: number; nome: string; documento: string | null; ativo: number; criado_em: string }
    | undefined;
  if (!linha) throw erroNaoEncontrado(`Cliente ${id} não encontrado.`);
  return linha;
}

export function atualizarCliente(id: number, dados: Partial<EntradaCliente>) {
  const antes = obterCliente(id);
  const nome = dados.nome === undefined ? antes.nome : dados.nome.trim();
  if (!nome) throw erroValidacao('O nome do cliente é obrigatório.');
  if (nome !== antes.nome && db().prepare('SELECT id FROM clientes WHERE nome = ?').get(nome)) {
    throw erroValidacao(`Já existe um cliente chamado "${nome}".`);
  }
  db()
    .prepare('UPDATE clientes SET nome = ?, documento = ?, ativo = ? WHERE id = ?')
    .run(
      nome,
      dados.documento === undefined ? antes.documento : dados.documento?.trim() || null,
      dados.ativo === undefined ? antes.ativo : dados.ativo ? 1 : 0,
      id,
    );
  return obterCliente(id);
}

/** Dá acesso de um usuário a um cliente. Idempotente. */
export function vincularUsuario(usuarioId: number, clienteId: number) {
  obterCliente(clienteId);
  db()
    .prepare('INSERT OR IGNORE INTO usuario_clientes (usuario_id, cliente_id) VALUES (?, ?)')
    .run(usuarioId, clienteId);
  return { usuario_id: usuarioId, cliente_id: clienteId };
}

export function desvincularUsuario(usuarioId: number, clienteId: number) {
  db()
    .prepare('DELETE FROM usuario_clientes WHERE usuario_id = ? AND cliente_id = ?')
    .run(usuarioId, clienteId);
  return { usuario_id: usuarioId, cliente_id: clienteId };
}

// ------------------------------------------------------- matrizes e filiais

/** A árvore do cliente: cada matriz com as filiais dela. */
export function estruturaDoCliente(clienteId: number) {
  const matrizes = db()
    .prepare(
      `SELECT id, nome, codigo, cnpj, endereco, cep, status
         FROM empresas WHERE cliente_id = ? ORDER BY nome`,
    )
    .all(clienteId) as Array<{
    id: number;
    nome: string;
    codigo: string | null;
    cnpj: string | null;
    endereco: string | null;
    cep: string | null;
    status: string;
  }>;

  // Uma consulta para todas as filiais, não uma por matriz: com trinta matrizes
  // o laço viraria trinta idas ao banco para montar a mesma árvore.
  const filiais = matrizes.length
    ? (db()
        .prepare(
          `SELECT id, empresa_id, nome, codigo, cnpj, endereco, cep, cidade, uf, ativo
             FROM filiais WHERE empresa_id IN (${matrizes.map(() => '?').join(',')})
            ORDER BY nome`,
        )
        .all(...matrizes.map((m) => m.id)) as Array<{
        id: number;
        empresa_id: number;
        nome: string;
        codigo: string | null;
        cnpj: string | null;
        endereco: string | null;
        cep: string | null;
        cidade: string | null;
        uf: string | null;
        ativo: number;
      }>)
    : [];

  return matrizes.map((m) => ({
    ...m,
    tipo: 'MATRIZ' as const,
    filiais: filiais.filter((f) => f.empresa_id === m.id).map((f) => ({ ...f, tipo: 'FILIAL' as const })),
  }));
}

/**
 * Cria a matriz do cliente. O CNPJ base decide a que matriz uma unidade
 * pertence, então ele não é decoração: sem ele, a carga não sabe onde pendurar
 * a filial e tem de perguntar.
 */
export function criarMatriz(clienteId: number, entrada: EntradaUnidade, usuarioId?: number) {
  obterCliente(clienteId);
  const nome = entrada.nome?.trim();
  if (!nome) throw erroValidacao('O nome da matriz é obrigatório.');
  const existente = db()
    .prepare('SELECT id FROM empresas WHERE cliente_id = ? AND nome = ?')
    .get(clienteId, nome);
  if (existente) throw erroValidacao(`Já existe uma matriz "${nome}" neste cliente.`);
  const info = db()
    .prepare(
      `INSERT INTO empresas (cliente_id, nome, codigo, cnpj, endereco, cep)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      clienteId,
      nome,
      entrada.codigo?.trim() || null,
      entrada.cnpj?.trim() || null,
      entrada.endereco?.trim() || null,
      entrada.cep?.trim() || null,
    );
  const empresaId = Number(info.lastInsertRowid);
  // Sem isto a matriz existiria no banco sem aparecer no seletor de ninguém, e
  // sem tipo de despesa para receber o primeiro lançamento.
  prepararMatriz(empresaId, usuarioId);
  return db().prepare('SELECT * FROM empresas WHERE id = ?').get(empresaId);
}

export function criarUnidade(matrizId: number, entrada: EntradaUnidade) {
  const matriz = db().prepare('SELECT id, cliente_id FROM empresas WHERE id = ?').get(matrizId) as
    | { id: number; cliente_id: number | null }
    | undefined;
  if (!matriz) throw erroNaoEncontrado(`Matriz ${matrizId} não encontrada.`);
  const nome = entrada.nome?.trim();
  if (!nome) throw erroValidacao('O nome da filial é obrigatório.');
  const existente = db()
    .prepare('SELECT id FROM filiais WHERE empresa_id = ? AND nome = ?')
    .get(matrizId, nome);
  if (existente) throw erroValidacao(`Já existe uma filial "${nome}" nesta matriz.`);
  const info = db()
    .prepare(
      `INSERT INTO filiais (empresa_id, nome, codigo, cnpj, endereco, cep, cidade, uf)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      matrizId,
      nome,
      entrada.codigo?.trim() || null,
      entrada.cnpj?.trim() || null,
      entrada.endereco?.trim() || null,
      entrada.cep?.trim() || null,
      entrada.cidade?.trim() || null,
      entrada.uf?.trim()?.toUpperCase() || null,
    );
  return db().prepare('SELECT * FROM filiais WHERE id = ?').get(Number(info.lastInsertRowid));
}

/**
 * Onde uma unidade entra, pelo CNPJ.
 *
 * A regra é a do enunciado, e é a do próprio CNPJ: mesma raiz, mesma matriz;
 * raiz própria terminada em 0001, matriz nova. É o que faz a carga saber onde
 * pendurar HM-DF sem ninguém dizer.
 */
export function matrizPeloCnpj(clienteId: number, cnpj: string) {
  const raiz = raizDoCnpj(cnpj);
  if (!raiz) return null;
  const matrizes = db()
    .prepare('SELECT id, nome, cnpj FROM empresas WHERE cliente_id = ?')
    .all(clienteId) as Array<{ id: number; nome: string; cnpj: string | null }>;
  const pelaPropria = matrizes.find((m) => raizDoCnpj(m.cnpj) === raiz);
  if (pelaPropria) return pelaPropria;

  // A matriz que já abriga uma unidade desta raiz é onde a próxima entra —
  // mesmo que ela própria não tenha CNPJ. É o caso das matrizes que agrupam
  // unidades por operação (MILAGRES abriga HM-CE, HM-DF e HM-MT) e nunca
  // receberam CNPJ: a raiz está nas filiais, e é lá que ela deve ser procurada.
  const porFilial = db()
    .prepare(
      `SELECT e.id, e.nome, e.cnpj, f.cnpj AS cnpj_filial
         FROM filiais f JOIN empresas e ON e.id = f.empresa_id
        WHERE e.cliente_id = ? AND f.cnpj IS NOT NULL`,
    )
    .all(clienteId) as Array<{ id: number; nome: string; cnpj: string | null; cnpj_filial: string }>;
  const achada = porFilial.find((f) => raizDoCnpj(f.cnpj_filial) === raiz);
  return achada ? { id: achada.id, nome: achada.nome, cnpj: achada.cnpj } : null;
}

/**
 * Cadastra uma unidade no cliente, aplicando a regra do CNPJ.
 *
 * A regra é uma só, e é do próprio CNPJ: mesma raiz, mesma matriz. Por isso ela
 * mora aqui e não na tela — duas telas (local e hospedada) escrevendo a mesma
 * regra viram duas regras no dia em que uma delas mudar.
 *
 * Quando a tela não diz o tipo, o CNPJ decide: raiz já conhecida entra como
 * filial da matriz dela; raiz nova abre matriz.
 */
export function criarUnidadeDoCliente(
  clienteId: number,
  entrada: EntradaUnidade & { tipo?: 'MATRIZ' | 'FILIAL'; matrizPaiId?: number | null },
  usuarioId?: number,
) {
  obterCliente(clienteId);
  const irma = entrada.cnpj ? matrizPeloCnpj(clienteId, entrada.cnpj) : null;
  const tipo = entrada.tipo ?? (irma ? 'FILIAL' : 'MATRIZ');

  if (tipo === 'MATRIZ') {
    if (irma) {
      throw erroValidacao(
        `O CNPJ informado tem a mesma raiz de "${irma.nome}". Unidades da mesma raiz são a mesma pessoa ` +
          `jurídica: cadastre esta como filial de "${irma.nome}".`,
      );
    }
    return criarMatriz(clienteId, entrada, usuarioId);
  }

  const paiId = entrada.matrizPaiId ?? irma?.id ?? null;
  if (!paiId) {
    throw erroValidacao(
      'Informe a matriz desta filial. Sem CNPJ de raiz conhecida, o sistema não tem como deduzir onde ela entra.',
    );
  }
  // A matriz tem de ser DESTE cliente: sem esta conferência, um id de outro
  // contratante penduraria a filial na estrutura alheia.
  const pai = db().prepare('SELECT id, cliente_id FROM empresas WHERE id = ?').get(paiId) as
    | { id: number; cliente_id: number | null }
    | undefined;
  if (!pai || pai.cliente_id !== clienteId) throw erroNaoEncontrado('Matriz não encontrada neste cliente.');
  return criarUnidade(paiId, entrada);
}

/** O cliente da empresa em contexto — a ponte entre o modelo antigo e o novo. */
export function clienteDaEmpresa(empresaId: number): number | null {
  const linha = db().prepare('SELECT cliente_id FROM empresas WHERE id = ?').get(empresaId) as
    | { cliente_id: number | null }
    | undefined;
  return linha?.cliente_id ?? null;
}

/** As empresas (matrizes) de um cliente — o recorte que toda consulta usa. */
export function empresasDoCliente(clienteId: number): number[] {
  return (
    db().prepare('SELECT id FROM empresas WHERE cliente_id = ? ORDER BY id').all(clienteId) as Array<{
      id: number;
    }>
  ).map((e) => e.id);
}
