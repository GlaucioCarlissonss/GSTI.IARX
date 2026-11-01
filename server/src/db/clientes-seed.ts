/**
 * Cadastro inicial dos clientes.
 *
 * O Grupo Brasil Home Care vem com a estrutura real: cada linha da tabela do
 * gestor é uma unidade, e é o CNPJ que decide onde ela entra. Mesma raiz, mesma
 * matriz — é por isso que HM-CE, HM-DF e HM-MT ficam sob o Hospital Milagres
 * (`29.521.159`) em vez de virarem três matrizes soltas. Raiz própria com
 * sufixo 0001 é matriz independente dentro do grupo.
 *
 * Limas IT e SoulCoop entram só como cliente de matriz única: a estrutura de
 * filiais delas vem nas próximas cargas, e inventá-la agora seria cadastro
 * falso que depois teria de ser desfeito.
 *
 * Numa base que JÁ carregou estas unidades pelas planilhas, elas não são
 * criadas de novo: a tabela do gestor descreve as mesmas unidades, com CNPJ e
 * endereço que faltavam. A unidade existente é COMPLETADA nos campos em branco
 * (nunca sobrescrita), e só o que não tem correspondente é cadastrado. O
 * contrário dobraria o organograma: duas "AHC RN" para o gestor escolher.
 */
import { db } from './index.js';
import { digitosDoCnpj, ehMatriz, raizDoCnpj } from '../domain/clientes.js';
import { prepararMatriz } from '../domain/empresas.js';

export const CLIENTE_GRUPO = 'Grupo Brasil Home Care';

export interface UnidadeSeed {
  codigo: string;
  cnpj: string;
  razaoSocial: string;
  endereco: string | null;
  cep: string | null;
}

/** As unidades do grupo, como vieram da tabela do gestor. */
export const UNIDADES_GRUPO: UnidadeSeed[] = [
  {
    codigo: 'AHC-RN',
    cnpj: '29.843.964/0001-83',
    razaoSocial: 'Aliança Home Care Serviços Médicos LTDA',
    endereco: 'R. Eduardo Medeiros, 1210 - Barro Vermelho - Natal/RN',
    cep: '59030-480',
  },
  {
    codigo: 'HM-CE',
    cnpj: '29.521.159/0002-14',
    razaoSocial: 'Hospital Milagres Serviços de Saúde LTDA',
    endereco: 'R. Profº Dias da Rocha, 1763 - Aldeota - Fortaleza/CE',
    cep: '60170-285',
  },
  {
    codigo: 'HM-DF',
    cnpj: '29.521.159/0005-67',
    razaoSocial: 'Hospital Milagres Serviços de Saúde LTDA',
    endereco: 'Qd. SHCGN 706 Bl. A, Loja 12 - Asa Norte - Brasília/DF',
    cep: '70740-511',
  },
  {
    codigo: 'HM-MT',
    cnpj: '29.521.159/0009-90',
    razaoSocial: 'Hospital Milagres Serviços de Saúde LTDA',
    endereco: 'R. Diogo Domingos Ferreira, 442 - Bandeirantes - Cuiabá/MT',
    cep: '78010-090',
  },
  {
    codigo: 'HR-CG',
    cnpj: '05.238.398/0002-01',
    razaoSocial: 'Nordeste Serviços Médicos LTDA',
    endereco: 'R. Dom Pedro II, 930 - Prata - Campina Grande/PB',
    cep: '58400-565',
  },
  {
    codigo: 'HR-RN',
    cnpj: '22.026.461/0001-76',
    razaoSocial: 'Natal Home Care Serviços Médicos LTDA',
    endereco: 'R. Eduardo Medeiros, 1210 - Barro Vermelho - Natal/RN',
    cep: '59030-480',
  },
  {
    codigo: 'HR-AL',
    cnpj: '26.130.806/0002-79',
    razaoSocial: 'Life Home Care Serviços Médicos LTDA',
    endereco: 'R. Frederico, 165 - Encruzilhada - Recife/PE',
    cep: '52041-539',
  },
  // Endereço e CEP vieram em branco na tabela: entram nulos, e a tela mostra
  // travessão. Preencher por conta seria inventar dado de cadastro.
  {
    codigo: 'UC-SP',
    cnpj: '54.398.303/0002-14',
    razaoSocial: 'Union Care Serviços Médicos LTDA',
    endereco: null,
    cep: null,
  },
];

/** Clientes que entram só como matriz única, sem filiais ainda. */
export const CLIENTES_SIMPLES = ['Limas IT', 'SoulCoop'];

/**
 * Chave de comparação de unidade: só letras e dígitos, sem acento.
 *
 * A base carregada chama a unidade de `AHC RN`; a tabela do gestor a chama de
 * `AHC-RN`. É a MESMA unidade, e o que separa as duas grafias é pontuação.
 * Sem isto o cadastro criaria uma segunda cópia de cada unidade já existente.
 */
const chaveUnidade = (texto: string | null | undefined) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/** Preenche só o que está em branco: o que já foi conferido à mão não se perde. */
function completar(
  tabela: 'empresas' | 'filiais',
  id: number,
  atual: { cnpj: string | null; endereco: string | null; cep: string | null },
  novo: { cnpj: string | null; endereco: string | null; cep: string | null },
): boolean {
  const campos: string[] = [];
  const valores: unknown[] = [];
  if (!atual.cnpj && novo.cnpj) (campos.push('cnpj = ?'), valores.push(novo.cnpj));
  if (!atual.endereco && novo.endereco) (campos.push('endereco = ?'), valores.push(novo.endereco));
  if (!atual.cep && novo.cep) (campos.push('cep = ?'), valores.push(novo.cep));
  if (!campos.length) return false;
  db()
    .prepare(`UPDATE ${tabela} SET ${campos.join(', ')} WHERE id = ?`)
    .run(...valores, id);
  return true;
}

function idDoCliente(nome: string): number {
  db().prepare('INSERT OR IGNORE INTO clientes (nome) VALUES (?)').run(nome);
  return (db().prepare('SELECT id FROM clientes WHERE nome = ?').get(nome) as { id: number }).id;
}

/**
 * Cria (ou completa) o cadastro dos três clientes. Idempotente: rodar de novo
 * não duplica nem sobrescreve o que já foi ajustado à mão.
 */
export function semearClientes(usuarioId?: number): {
  clientes: number;
  matrizes: number;
  filiais: number;
  completadas: number;
  pendentes: string[];
} {
  let matrizes = 0;
  let filiais = 0;
  let completadas = 0;
  const grupo = idDoCliente(CLIENTE_GRUPO);

  // Cliente cadastrado que ninguém enxerga é cadastro morto: quem roda o seed
  // passa a enxergar os três, e o vínculo é idempotente.
  const darAcesso = (clienteId: number) => {
    if (!usuarioId) return;
    db()
      .prepare('INSERT OR IGNORE INTO usuario_clientes (usuario_id, cliente_id) VALUES (?, ?)')
      .run(usuarioId, clienteId);
  };
  darAcesso(grupo);

  // ------------------------------------------------------------ reconciliar
  //
  // A base carregada JÁ tem estas unidades: a tabela do gestor descreve as
  // mesmas que vieram nas planilhas, só que com CNPJ e endereço. Criar de novo
  // produziria uma segunda cópia de cada uma, e o gestor passaria a escolher
  // entre duas "AHC RN" no seletor. Então: quem já existe é COMPLETADO, e só o
  // que não tem correspondente é criado.
  const daCasa = db()
    .prepare('SELECT id, nome, codigo, cnpj, endereco, cep FROM empresas WHERE cliente_id = ?')
    .all(grupo) as Array<{ id: number; nome: string; codigo: string | null; cnpj: string | null; endereco: string | null; cep: string | null }>;
  const filiaisDaCasa = daCasa.length
    ? (db()
        .prepare(
          `SELECT id, empresa_id, nome, codigo, cnpj, endereco, cep FROM filiais
            WHERE empresa_id IN (${daCasa.map(() => '?').join(',')})`,
        )
        .all(...daCasa.map((e) => e.id)) as Array<{
        id: number;
        empresa_id: number;
        nome: string;
        codigo: string | null;
        cnpj: string | null;
        endereco: string | null;
        cep: string | null;
      }>)
    : [];

  const casaFilial = (u: UnidadeSeed) =>
    filiaisDaCasa.find(
      (f) => chaveUnidade(f.codigo) === chaveUnidade(u.codigo) || chaveUnidade(f.nome) === chaveUnidade(u.codigo),
    ) ?? null;
  const casaMatriz = (u: UnidadeSeed) =>
    daCasa.find(
      (e) => chaveUnidade(e.codigo) === chaveUnidade(u.codigo) || chaveUnidade(e.nome) === chaveUnidade(u.codigo),
    ) ?? null;

  // A matriz de cada raiz de CNPJ. O reconhecimento alimenta este mapa: se
  // HM-CE já mora sob MILAGRES, HM-DF tem de entrar na MESMA matriz, e não
  // abrir uma segunda para a mesma pessoa jurídica.
  const daRaiz = new Map<string, number>();
  const jaCadastradas = new Set<string>();
  for (const u of UNIDADES_GRUPO) {
    const dados = { cnpj: digitosDoCnpj(u.cnpj), endereco: u.endereco, cep: u.cep };
    const filial = casaFilial(u);
    const matriz = casaMatriz(u);
    if (!filial && !matriz) continue;
    jaCadastradas.add(u.codigo);
    // A raiz aponta para a matriz que JÁ abriga esta unidade.
    const dona = filial ? filial.empresa_id : matriz!.id;
    daRaiz.set(raizDoCnpj(u.cnpj), dona);

    // Completa-se a entidade que casou — nunca a mãe dela. RESIDENCIAL abriga
    // unidades de três pessoas jurídicas diferentes; carimbar nela o CNPJ de
    // uma delas diria que a matriz é aquela empresa, o que não é verdade.
    if (filial) {
      if (completar('filiais', filial.id, filial, dados)) completadas += 1;
    } else if (completar('empresas', matriz!.id, matriz!, dados)) {
      completadas += 1;
    }
  }
  const pendentes = UNIDADES_GRUPO.filter((u) => !jaCadastradas.has(u.codigo)).map((u) => u.codigo);

  // Primeiro as matrizes — a filial precisa de onde pendurar. Uma unidade cujo
  // sufixo não é 0001 e cuja raiz não tem matriz na tabela vira matriz também:
  // é o caso de HM-CE, que é a primeira unidade conhecida do Hospital Milagres.
  const raizesComMatriz = new Set<string>();
  for (const u of UNIDADES_GRUPO) if (ehMatriz(u.cnpj)) raizesComMatriz.add(raizDoCnpj(u.cnpj));
  const primeiraDaRaiz = new Map<string, UnidadeSeed>();
  for (const u of UNIDADES_GRUPO) {
    const raiz = raizDoCnpj(u.cnpj);
    if (raizesComMatriz.has(raiz)) continue;
    if (!primeiraDaRaiz.has(raiz)) primeiraDaRaiz.set(raiz, u);
  }

  const inserirMatriz = db().prepare(
    `INSERT INTO empresas (cliente_id, nome, codigo, cnpj, endereco, cep) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const acharPorCnpj = db().prepare('SELECT id, cnpj FROM empresas WHERE cliente_id = ?');

  const jaExistem = acharPorCnpj.all(grupo) as Array<{ id: number; cnpj: string | null }>;
  for (const e of jaExistem) if (e.cnpj) daRaiz.set(raizDoCnpj(e.cnpj), e.id);

  for (const u of UNIDADES_GRUPO) {
    if (jaCadastradas.has(u.codigo)) continue;
    const raiz = raizDoCnpj(u.cnpj);
    const ehCabeca = ehMatriz(u.cnpj) || primeiraDaRaiz.get(raiz) === u;
    if (!ehCabeca || daRaiz.has(raiz)) continue;
    const id = Number(
      inserirMatriz.run(grupo, u.razaoSocial, u.codigo, digitosDoCnpj(u.cnpj), u.endereco, u.cep)
        .lastInsertRowid,
    );
    prepararMatriz(id, usuarioId);
    daRaiz.set(raiz, id);
    matrizes += 1;
  }

  const inserirFilial = db().prepare(
    `INSERT INTO filiais (empresa_id, nome, codigo, cnpj, endereco, cep) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const filialExiste = db().prepare('SELECT id FROM filiais WHERE empresa_id = ? AND nome = ?');
  for (const u of UNIDADES_GRUPO) {
    if (jaCadastradas.has(u.codigo)) continue;
    const raiz = raizDoCnpj(u.cnpj);
    const matrizId = daRaiz.get(raiz);
    if (!matrizId) continue;
    // A unidade que virou matriz não vira também filial de si mesma.
    const cabeca = ehMatriz(u.cnpj) || primeiraDaRaiz.get(raiz) === u;
    if (cabeca) continue;
    if (filialExiste.get(matrizId, u.codigo)) continue;
    inserirFilial.run(matrizId, u.codigo, u.codigo, digitosDoCnpj(u.cnpj), u.endereco, u.cep);
    filiais += 1;
  }

  for (const nome of CLIENTES_SIMPLES) {
    const id = idDoCliente(nome);
    darAcesso(id);
    const temMatriz = db().prepare('SELECT id FROM empresas WHERE cliente_id = ?').get(id) as
      | { id: number }
      | undefined;
    if (temMatriz) {
      prepararMatriz(temMatriz.id, usuarioId);
    } else {
      prepararMatriz(Number(inserirMatriz.run(id, nome, null, null, null, null).lastInsertRowid), usuarioId);
      matrizes += 1;
    }
  }

  return { clientes: 1 + CLIENTES_SIMPLES.length, matrizes, filiais, completadas, pendentes };
}
