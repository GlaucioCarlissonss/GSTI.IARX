// A REGRA DO ATINGIMENTO, EXERCIDA FORA DO NAVEGADOR.
//
// A regra do bloco Resultados é pura, e por isso mora em `src/lib/resultados.ts`,
// sem React: subir um navegador para conferir uma divisão seria caro e lento,
// e um caso a mais custaria minutos em vez de milissegundos.
//
// O que ela protege é a DIREÇÃO. Onde maior é melhor (SLA, Projetos) o
// atingimento é resultado ÷ meta; onde menor é melhor (custo contra teto) é
// meta ÷ resultado. Trocar os dois faria o mês mais caro do ano aparecer em
// verde — e é um erro que a tela não denuncia sozinha, porque o número
// continua parecendo um percentual plausível.
//
// Os mesmos casos existem em `artifact/testar-resultados.cjs`: são duas
// implementações, uma por superfície, e elas precisam dar a mesma resposta.
//
//   npx tsx web/testar-regra-resultados.mjs
import { atingimentoDaMeta, textoDaMeta } from './src/lib/resultados.ts';

const casos = [
  // maior é melhor: resultado ÷ meta
  ['sla acima da meta', 'minimo', 90, 80, 112.5, 'VERDE'],
  ['sla na meta exata', 'minimo', 80, 80, 100, 'VERDE'],
  ['sla parcialmente', 'minimo', 60, 80, 75, 'LARANJA'],
  ['sla na borda de 70%', 'minimo', 56, 80, 70, 'LARANJA'],
  ['sla logo abaixo de 70%', 'minimo', 55, 80, 68.8, 'VERMELHO'],
  ['projetos bem abaixo', 'minimo', 40, 80, 50, 'VERMELHO'],
  // menor é melhor: meta ÷ resultado. Gastar MENOS que o teto é atingir.
  ['financeiro abaixo do teto', 'maximo', 80, 100, 125, 'VERDE'],
  ['financeiro no teto', 'maximo', 100, 100, 100, 'VERDE'],
  ['financeiro estourando pouco', 'maximo', 120, 100, 83.3, 'LARANJA'],
  ['financeiro estourando muito', 'maximo', 200, 100, 50, 'VERMELHO'],
  // estados neutros e as divisões que não podem explodir
  ['sem meta', 'minimo', 90, null, undefined, 'SEM_META'],
  ['meta zero não vira divisão por zero', 'minimo', 90, 0, undefined, 'SEM_META'],
  ['meta negativa não vale como meta', 'minimo', 90, -10, undefined, 'SEM_META'],
  ['sem resultado', 'minimo', null, 80, undefined, 'SEM_DADOS'],
  ['resultado indefinido', 'minimo', undefined, 80, undefined, 'SEM_DADOS'],
  ['gasto zero não vira meta superada', 'maximo', 0, 100, undefined, 'SEM_DADOS'],
];

const falhas = [];
const ok = (r, b, d = '') => {
  console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`);
  if (!b) falhas.push(r);
};

console.log('\nREGRA — atingimento, direção e faixas');
for (const [nome, dir, res, meta, pct, faixa] of casos) {
  const a = atingimentoDaMeta(dir, res, meta);
  const bate = a.pct === pct && a.faixa === faixa;
  ok(nome, bate, bate ? '' : `obtido ${JSON.stringify([a.pct, a.faixa])}, esperado ${JSON.stringify([pct, faixa])}`);
}

console.log('\nTEXTO — a frase que acompanha cada faixa');
const pc = (v) => `${v.toFixed(1).replace('.', ',')}%`;
for (const [faixa, meta, esperado] of [
  ['VERDE', 80, 'Meta 80,0% atingida'],
  ['LARANJA', 80, 'Meta 80,0% parcialmente atingida'],
  ['VERMELHO', 80, 'Meta 80,0% não atingida'],
  ['SEM_META', null, 'Sem meta cadastrada'],
  ['SEM_DADOS', null, 'Sem dados no período'],
]) {
  const frase = textoDaMeta({ faixa }, meta, pc);
  ok(`texto: "${frase}"`, frase === esperado, frase === esperado ? '' : `esperado "${esperado}"`);
}

console.log(`\n=== ✗=${falhas.length} ===`);
if (falhas.length) falhas.forEach((f) => console.log('  ✗ ' + f));
process.exit(falhas.length ? 1 : 0);
