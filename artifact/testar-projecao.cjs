// O motor de projeção da versão hospedada, medido sem navegador.
//
// Ele é PURO — recebe lançamentos e devolve contratos e parcelas —, então dá
// para exercitá-lo fora da página. Isto importa por dois motivos:
//
// 1. a bateria de suítes depende de `artifact/dados/`, que é a base real do
//    cliente e não está no repositório. Num ambiente limpo ela não roda, e o
//    motor ficaria sem rede nenhuma;
// 2. as DUAS pontas precisam dar o mesmo número. O gestor abre a versão
//    hospedada e confere no app local; uma divergência aqui transformaria a
//    projeção em duas respostas para a mesma pergunta. Estes casos são os
//    mesmos de `server/test/projecao.test.ts`, de propósito.
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

// `app-js1.js` é quase só declaração de topo; o que ele toca do navegador
// ganha um esboço aqui. Avaliá-lo inteiro é melhor do que recortar o trecho do
// motor: recorte envelhece em silêncio quando o arquivo muda.
const contexto = vm.createContext({
  document: { documentElement: { setAttribute() {} }, querySelector: () => null },
  window: {}, localStorage: { getItem: () => null, setItem() {} },
  console, Intl, Date, Math, JSON, Map, Set, Number, String, Object, Array,
});
vm.runInContext(readFileSync(`${__dirname}/app-js1.js`, 'utf8'), contexto);
// `function` de topo vira propriedade do contexto; `const` NÃO. As setas
// precisam ser colhidas por expressão, dentro do mesmo realm.
const { contratosDe, projetarContratos, projetadoPorMes } = contexto;
const [contratoValeEm, chaveDoContrato] =
  vm.runInContext('[contratoValeEm, chaveDoContrato]', contexto);

const falhas = [];
const conferir = (rotulo, fn) => {
  try { fn(); console.log(`  ✓ ${rotulo}`); }
  catch (e) { console.log(`  ✗ ${rotulo}: ${e.message}`); falhas.push(rotulo); }
};

/** Um lançamento fixo com o mínimo preenchido. */
const l = (p) => ({
  empresa: 'e1', filial: null, tipo: 'Licenças', fornecedor: 'TOTVS',
  descricao: 'Licença ERP', cenario: 'oficial', natureza: 'fixa', valor: 1000, ...p,
});

console.log('\nIDENTIDADE DO CONTRATO');

conferir('reajuste é o MESMO contrato, e projeta o preço novo', () => {
  const cs = contratosDe([
    l({ competencia: '2026-01', valor: 1000 }),
    l({ competencia: '2026-02', valor: 1000 }),
    l({ competencia: '2026-03', valor: 1150 }),
  ]);
  assert.equal(cs.length, 1, 'o valor não pode fazer parte da identidade');
  assert.equal(cs[0].valor, 1150, 'projeta o preço que vale hoje');
  assert.equal(cs[0].ultima, '2026-03');
  assert.equal(cs[0].primeira, '2026-01');
});

conferir('espaço e caixa não criam contrato novo', () => {
  assert.equal(
    chaveDoContrato(l({ fornecedor: '  TOTVS  ' })),
    chaveDoContrato(l({ fornecedor: 'totvs' })),
  );
});

conferir('fornecedor, filial, tipo e cenário diferentes são contratos diferentes', () => {
  const cs = contratosDe([
    l({ competencia: '2026-01' }),
    l({ competencia: '2026-01', fornecedor: 'Outro' }),
    l({ competencia: '2026-01', filial: 'HR-PE' }),
    l({ competencia: '2026-01', tipo: 'Telefonia' }),
    l({ competencia: '2026-01', cenario: 'otimista' }),
  ]);
  assert.equal(cs.length, 5);
});

conferir('despesa pontual não vira contrato', () => {
  assert.equal(contratosDe([l({ competencia: '2026-01', natureza: 'pontual_unica' })]).length, 0);
});

console.log('\nVIGÊNCIA');

conferir('sem vigência, projeta indefinidamente', () => {
  const [c] = contratosDe([l({ competencia: '2026-03' })]);
  assert.equal(c.vigenciaAte, null);
  assert.equal(contratoValeEm(c, '2030-12'), true);
});

conferir('a vigência encerra no mês dela, e não no seguinte', () => {
  const [c] = contratosDe([l({ competencia: '2026-03', recorrenciaAte: '2026-06' })]);
  assert.equal(contratoValeEm(c, '2026-06'), true);
  assert.equal(contratoValeEm(c, '2026-07'), false);
  assert.equal([...projetadoPorMes([c], '2026-04', '2026-12').keys()].sort().join(','),
    '2026-04,2026-05,2026-06');
});

conferir('a vigência declarada mais recente é a que vale', () => {
  const [c] = contratosDe([
    l({ competencia: '2026-05', recorrenciaAte: '2026-12' }),
    l({ competencia: '2026-03', recorrenciaAte: '2026-06' }),
  ]);
  assert.equal(c.vigenciaAte, '2026-12');
});

conferir('a projeção não anda para trás', () => {
  const [c] = contratosDe([l({ competencia: '2026-05' })]);
  assert.equal(contratoValeEm(c, '2026-04'), false);
  assert.equal(contratoValeEm(c, '2026-05'), true);
});

console.log('\nLINHA REAL VENCE A PROJEÇÃO');

conferir('mês com linha real não recebe projeção por cima', () => {
  const [c] = contratosDe([
    l({ competencia: '2026-06' }),
    l({ competencia: '2026-07' }),
  ]);
  const m = projetadoPorMes([c], '2026-06', '2026-08');
  assert.equal(m.has('2026-06'), false);
  assert.equal(m.has('2026-07'), false, 'lançar adiantado não pode ser punido com contagem dupla');
  assert.equal(m.get('2026-08').centavos, 100000);
});

conferir('nenhuma parcela projetada cai num mês já lançado', () => {
  const [c] = contratosDe([
    l({ competencia: '2026-01' }), l({ competencia: '2026-02' }), l({ competencia: '2026-04' }),
  ]);
  for (const p of projetarContratos([c], '2026-01', '2026-12')) {
    assert.equal(c.lancados.has(p.comp), false, `projetou sobre ${p.comp}`);
  }
});

console.log('\nO MÊS CORRENTE, COMPLETADO');

conferir('o mês parcial recebe só o que faltou nele', () => {
  const cs = contratosDe([
    l({ competencia: '2026-05', fornecedor: 'TOTVS', valor: 1000 }),
    l({ competencia: '2026-06', fornecedor: 'TOTVS', valor: 1000 }),
    l({ competencia: '2026-05', fornecedor: 'CLARO', valor: 400 }),
  ]);
  const junho = projetadoPorMes(cs, '2026-06', '2027-06').get('2026-06');
  assert.equal(junho.contratos, 1, 'a TOTVS já está lançada em junho');
  assert.equal(junho.centavos, 40000, 'só a CLARO entra projetada');
});

conferir('mês sem nada lançado recebe os dois contratos', () => {
  const cs = contratosDe([
    l({ competencia: '2026-05', fornecedor: 'TOTVS', valor: 1000 }),
    l({ competencia: '2026-05', fornecedor: 'CLARO', valor: 400 }),
  ]);
  const junho = projetadoPorMes(cs, '2026-06', '2027-06').get('2026-06');
  assert.equal(junho.contratos, 2);
  assert.equal(junho.centavos, 140000, 'é o pedido: mês sem lançamento EXISTE como projeção');
});

console.log('\nBORDAS');

conferir('sem lançamento, sem contrato e sem projeção', () => {
  assert.equal(contratosDe([]).length, 0);
  assert.equal(projetarContratos([], '2026-01', '2026-12').length, 0);
});

conferir('intervalo invertido devolve vazio em vez de explodir', () => {
  const [c] = contratosDe([l({ competencia: '2026-01' })]);
  assert.equal(projetarContratos([c], '2026-12', '2026-01').length, 0);
});

conferir('contrato encerrado antes do horizonte não projeta nada', () => {
  const [c] = contratosDe([l({ competencia: '2026-01', recorrenciaAte: '2026-02' })]);
  assert.equal(projetadoPorMes([c], '2026-06', '2027-06').size, 0);
});

console.log(falhas.length ? `\n${falhas.length} FALHA(S): ${falhas.join(' · ')}` : '\nTudo certo.');
process.exit(falhas.length ? 1 : 0);
