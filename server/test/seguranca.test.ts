import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco, db, definirBanco } from '../src/db/index.js';
import { autenticar, registrar, segredoJwt, verificarToken } from '../src/domain/auth.js';
import { criarEmpresa } from '../src/domain/empresas.js';
import { criarFila, listarFilas } from '../src/domain/cadastros.js';
import { registrarTicketSla } from '../src/domain/sla.js';
import { escreverCsv, lerCsv } from '../src/lib/planilha.js';
import type { Contexto } from '../src/domain/contexto.js';

const SEGREDO = 'a'.repeat(64);


function ambiente() {
  definirBanco(abrirBanco(':memory:'));
  delete process.env.REGISTRO_ABERTO;
  process.env.JWT_SECRET = SEGREDO;
  const usuario = registrar({ nome: 'Gestor', email: 'gestor@exemplo.com', senha: 'senha-bem-forte-1' });
  const empresa = criarEmpresa(usuario.id, { nome: 'Empresa A' });
  const ctx: Contexto = {
    empresaId: empresa.id,
    usuarioId: usuario.id,
    usuarioEmail: usuario.email,
    papel: 'gestor',
  };
  return { usuario, ctx };
}

test('sem JWT_SECRET a aplicação recusa assinar sessão, em vez de usar um segredo embutido', () => {
  const anterior = process.env.JWT_SECRET;
  try {
    delete process.env.JWT_SECRET;
    assert.throws(() => segredoJwt(), /JWT_SECRET não está definido/);

    process.env.JWT_SECRET = '   ';
    assert.throws(() => segredoJwt(), /JWT_SECRET não está definido/);

    process.env.JWT_SECRET = 'curto-demais';
    assert.throws(() => segredoJwt(), /curto demais/);

    process.env.JWT_SECRET = SEGREDO;
    assert.equal(segredoJwt(), SEGREDO);
  } finally {
    process.env.JWT_SECRET = anterior;
  }
});

test('a sessão deixa de valer quando a conta é desativada ou removida', () => {
  const { usuario } = ambiente();
  const { token } = autenticar('gestor', 'senha-bem-forte-1');
  assert.equal(verificarToken(token).usuarioId, usuario.id);

  db().prepare('UPDATE usuarios SET ativo = 0 WHERE id = ?').run(usuario.id);
  assert.throws(() => verificarToken(token), /Sessão inválida/);

  db().prepare('UPDATE usuarios SET ativo = 1 WHERE id = ?').run(usuario.id);
  assert.equal(verificarToken(token).usuarioId, usuario.id);

  db().prepare('DELETE FROM usuarios WHERE id = ?').run(usuario.id);
  assert.throws(() => verificarToken(token), /Sessão inválida/);
});

test('um token assinado com outro segredo é recusado', () => {
  ambiente();
  const { token } = autenticar('gestor', 'senha-bem-forte-1');
  const anterior = process.env.JWT_SECRET;
  try {
    process.env.JWT_SECRET = 'b'.repeat(64);
    assert.throws(() => verificarToken(token), /Sessão inválida/);
  } finally {
    process.env.JWT_SECRET = anterior;
  }
});

test('as filas de ticket pertencem à empresa e não vazam entre tenants', () => {
  const { usuario, ctx } = ambiente();
  const outra = criarEmpresa(usuario.id, { nome: 'Empresa B' });
  const ctxB: Contexto = { ...ctx, empresaId: outra.id };

  // Toda empresa nasce com as três filas padrão, próprias.
  const filasA = listarFilas(ctx) as Array<{ id: number; nome: string }>;
  const filasB = listarFilas(ctxB) as Array<{ id: number; nome: string }>;
  assert.deepEqual(filasA.map((f) => f.nome), ['Infraestrutura', 'Sistema', 'Dados']);
  assert.deepEqual(filasB.map((f) => f.nome), ['Infraestrutura', 'Sistema', 'Dados']);
  assert.equal(
    filasA.some((a) => filasB.some((b) => b.id === a.id)),
    false,
    'os ids não são compartilhados',
  );

  // Uma fila criada em A não aparece em B.
  criarFila(ctx, 'Telefonia do cliente XYZ');
  assert.equal((listarFilas(ctx) as unknown[]).length, 4);
  assert.equal((listarFilas(ctxB) as unknown[]).length, 3);

  // E não pode ser usada por B.
  const filaDeA = (listarFilas(ctx) as Array<{ id: number; nome: string }>).find(
    (f) => f.nome === 'Telefonia do cliente XYZ',
  )!;
  assert.throws(
    () =>
      registrarTicketSla(ctxB, {
        competencia: '03/2026',
        filaId: filaDeA.id,
        totalAtendidos: 10,
        dentroSla: 10,
      }),
    /não pertence à empresa em contexto/,
  );

  // O mesmo nome pode existir nas duas empresas, de forma independente.
  const naB = criarFila(ctxB, 'Telefonia do cliente XYZ');
  assert.notEqual(naB.id, filaDeA.id);
});

test('exportação em CSV neutraliza fórmula, e a leitura devolve o valor original', () => {
  const perigosos = ['=WEBSERVICE("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\tinicio-com-tab'];
  const csv = escreverCsv(
    ['Descrição'],
    perigosos.map((p) => ({ 'Descrição': p })),
  );

  // Cada linha de dados precisa começar com o apóstrofo que desarma a fórmula
  // (dentro das aspas, quando o valor exigiu aspas).
  const linhas = csv.split('\r\n').slice(1).filter((l) => l !== '');
  assert.equal(linhas.length, perigosos.length);
  for (const [i, linha] of linhas.entries()) {
    assert.ok(
      linha.startsWith("'") || linha.startsWith('"\''),
      `a linha ${i + 1} (${JSON.stringify(linha.slice(0, 12))}) deveria começar com apóstrofo`,
    );
  }

  // Ida e volta exata: o apóstrofo também protege espaço à esquerda do trim
  // da leitura, então o valor volta idêntico ao que entrou.
  assert.deepEqual(
    lerCsv(csv).map((l) => l['Descrição']),
    perigosos,
  );

  // Texto comum não é tocado.
  const comum = escreverCsv(['Descrição'], [{ 'Descrição': 'Licença anual' }]);
  assert.ok(comum.includes('Licença anual'));
  assert.equal(comum.includes("'Licença"), false);
});
