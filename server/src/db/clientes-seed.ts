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
 */
import { db } from './index.js';
import { digitosDoCnpj, ehMatriz, raizDoCnpj } from '../domain/clientes.js';

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

function idDoCliente(nome: string): number {
  db().prepare('INSERT OR IGNORE INTO clientes (nome) VALUES (?)').run(nome);
  return (db().prepare('SELECT id FROM clientes WHERE nome = ?').get(nome) as { id: number }).id;
}

/**
 * Cria (ou completa) o cadastro dos três clientes. Idempotente: rodar de novo
 * não duplica nem sobrescreve o que já foi ajustado à mão.
 */
export function semearClientes(): { clientes: number; matrizes: number; filiais: number } {
  let matrizes = 0;
  let filiais = 0;
  const grupo = idDoCliente(CLIENTE_GRUPO);

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

  const daRaiz = new Map<string, number>();
  const inserirMatriz = db().prepare(
    `INSERT INTO empresas (cliente_id, nome, codigo, cnpj, endereco, cep) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const acharPorCnpj = db().prepare('SELECT id, cnpj FROM empresas WHERE cliente_id = ?');

  const jaExistem = acharPorCnpj.all(grupo) as Array<{ id: number; cnpj: string | null }>;
  for (const e of jaExistem) if (e.cnpj) daRaiz.set(raizDoCnpj(e.cnpj), e.id);

  for (const u of UNIDADES_GRUPO) {
    const raiz = raizDoCnpj(u.cnpj);
    const ehCabeca = ehMatriz(u.cnpj) || primeiraDaRaiz.get(raiz) === u;
    if (!ehCabeca || daRaiz.has(raiz)) continue;
    const id = Number(
      inserirMatriz.run(grupo, u.razaoSocial, u.codigo, digitosDoCnpj(u.cnpj), u.endereco, u.cep)
        .lastInsertRowid,
    );
    daRaiz.set(raiz, id);
    matrizes += 1;
  }

  const inserirFilial = db().prepare(
    `INSERT INTO filiais (empresa_id, nome, codigo, cnpj, endereco, cep) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const filialExiste = db().prepare('SELECT id FROM filiais WHERE empresa_id = ? AND nome = ?');
  for (const u of UNIDADES_GRUPO) {
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
    const temMatriz = db().prepare('SELECT id FROM empresas WHERE cliente_id = ?').get(id);
    if (!temMatriz) {
      inserirMatriz.run(id, nome, null, null, null, null);
      matrizes += 1;
    }
  }

  return { clientes: 1 + CLIENTES_SIMPLES.length, matrizes, filiais };
}
