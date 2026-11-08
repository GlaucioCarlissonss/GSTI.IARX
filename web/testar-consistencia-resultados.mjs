/**
 * AS DUAS SUPERFÍCIES DIZEM A MESMA COISA? — a conferência cruzada da regra
 * de atingimento.
 *
 * O bloco Resultados tem duas implementações: `artifact/app-js17.js` e
 * `web/src/lib/resultados.ts`. Elas foram escritas uma a partir da outra, e é
 * exatamente por isso que precisam ser confrontadas: duas cópias da mesma
 * regra divergem na primeira correção que alguém faz num lado só, e a
 * divergência é silenciosa — os dois lados continuam devolvendo um percentual
 * plausível, e ninguém descobre até um gestor comparar o celular com o
 * navegador na frente do outro.
 *
 * A tabela cobre as três faixas, os dois sentidos de meta, as bordas exatas
 * (100% e 70%), o arredondamento em torno delas e os dois estados sem número.
 *
 * Uso (sem navegador para a web, com navegador para o artifact):
 *   CHROMIUM_BIN=/opt/pw-browsers/chromium node web/testar-consistencia-resultados.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { atingimentoDaMeta, textoDaMeta } from './src/lib/resultados.ts';

// O Playwright vive na instalação global de ferramentas da máquina, e o
// resolvedor de ESM não a enxerga como o de CommonJS enxerga. As outras
// suítes são `.cjs` e usam `require` direto; esta precisa ser módulo para
// importar a regra em TypeScript, então pede o pacote pelo mesmo caminho.
const { chromium } = createRequire(import.meta.url)('playwright');

const aqui = dirname(fileURLToPath(import.meta.url));
const SISTEMA = resolve(aqui, '..', 'artifact', 'sistema.html');

/**
 * Os casos. `modulo` escolhe o sentido: sla e projetos são alvo de PISO
 * (maior é melhor), financeiro é alvo de TETO (menor é melhor).
 */
const CASOS = [
  // --- piso: maior é melhor
  { nome: 'piso, meta superada', modulo: 'sla', resultado: 90, meta: 80 },
  { nome: 'piso, exatamente na meta', modulo: 'sla', resultado: 80, meta: 80 },
  { nome: 'piso, parcial no alto', modulo: 'sla', resultado: 79.9, meta: 80 },
  { nome: 'piso, parcial na borda de 70%', modulo: 'sla', resultado: 56, meta: 80 },
  { nome: 'piso, um fio abaixo de 70%', modulo: 'sla', resultado: 55.9, meta: 80 },
  { nome: 'piso, muito abaixo', modulo: 'projetos', resultado: 10, meta: 80 },
  { nome: 'piso, resultado zero', modulo: 'projetos', resultado: 0, meta: 80 },
  // O arredondamento decide a faixa: 99,96% é exibido como "100,0%", e pintar
  // de laranja um cartão que mostra 100,0% seria a tela contradizendo a si.
  { nome: 'piso, arredonda para 100,0%', modulo: 'sla', resultado: 79.97, meta: 80 },
  { nome: 'piso, arredonda para 70,0%', modulo: 'sla', resultado: 55.99, meta: 80 },
  // --- teto: menor é melhor
  { nome: 'teto, gasto abaixo do teto', modulo: 'financeiro', resultado: 8000, meta: 10000 },
  { nome: 'teto, exatamente no teto', modulo: 'financeiro', resultado: 10000, meta: 10000 },
  { nome: 'teto, estourou pouco', modulo: 'financeiro', resultado: 12000, meta: 10000 },
  { nome: 'teto, estourou muito', modulo: 'financeiro', resultado: 20000, meta: 10000 },
  // Gasto zero contra um teto positivo não é "meta superada": é mês sem
  // despesa reconhecida, e dividir por zero daria infinito.
  { nome: 'teto, gasto zero', modulo: 'financeiro', resultado: 0, meta: 10000 },
  // --- sem número
  { nome: 'sem resultado', modulo: 'sla', resultado: null, meta: 80 },
  { nome: 'sem meta', modulo: 'sla', resultado: 90, meta: null },
  { nome: 'meta zero não é meta', modulo: 'sla', resultado: 90, meta: 0 },
  { nome: 'sem resultado e sem meta', modulo: 'financeiro', resultado: null, meta: null },
];

const DIRECAO = { sla: 'minimo', projetos: 'minimo', financeiro: 'maximo' };
const EM_REAIS = { sla: false, projetos: false, financeiro: true };

const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
const pag = await nav.newPage();
const erros = [];
pag.on('pageerror', (e) => erros.push(e.message));
await pag.goto('file://' + SISTEMA);
await pag.waitForTimeout(600);

const doArtifact = await pag.evaluate((casos) => casos.map((c) => {
  const a = atingimentoDaMeta(c.modulo, { resultado: c.resultado, meta: c.meta });
  const moeda = c.modulo === 'financeiro';
  return { faixa: a.faixa, pct: a.pct === undefined ? null : a.pct, texto: textoDaMeta(a, moeda) };
}), CASOS);

const falhas = [];
const ok = (r, b, d = '') => {
  console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`);
  if (!b) falhas.push(r);
};

console.log('REGRA DE ATINGIMENTO — artifact × app, caso a caso\n');
CASOS.forEach((c, i) => {
  const art = doArtifact[i];
  const a = atingimentoDaMeta(DIRECAO[c.modulo], c.resultado, c.meta);
  const fmt = (v) => (EM_REAIS[c.modulo]
    ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : `${v.toFixed(1).replace('.', ',')}%`);
  const web = {
    faixa: a.faixa,
    pct: a.pct === undefined ? null : a.pct,
    texto: textoDaMeta(a, c.meta, fmt),
  };
  const igual = web.faixa === art.faixa && web.pct === art.pct && web.texto === art.texto;
  ok(c.nome, igual,
    igual
      ? `${art.faixa}${art.pct === null ? '' : ' ' + art.pct + '%'} — ${art.texto}`
      : `artifact ${art.faixa}/${art.pct}/"${art.texto}" × app ${web.faixa}/${web.pct}/"${web.texto}"`);
});

// As bordas, ditas uma vez por extenso: elas são o contrato da faixa, e um
// deslize de >= para > move um mês inteiro de cor sem mudar número nenhum.
console.log('\nBORDAS — o que a régua promete');
const borda = (modulo, resultado, meta) =>
  atingimentoDaMeta(DIRECAO[modulo], resultado, meta).faixa;
ok('100,0% é VERDE, e não laranja', borda('sla', 80, 80) === 'VERDE');
ok('99,9% é LARANJA', borda('sla', 79.92, 80) === 'LARANJA', `${atingimentoDaMeta('minimo', 79.92, 80).pct}%`);
ok('70,0% é LARANJA, e não vermelho', borda('sla', 56, 80) === 'LARANJA');
ok('69,9% é VERMELHO', borda('sla', 55.9, 80) === 'VERMELHO', `${atingimentoDaMeta('minimo', 55.9, 80).pct}%`);

console.log(`\n=== erros de console: ${erros.length ? erros.join(' | ') : 'nenhum'} ===`);
console.log(`=== ✗=${falhas.length} ===`);
if (falhas.length) falhas.forEach((f) => console.log('  ✗ ' + f));
await nav.close();
process.exit(falhas.length || erros.length ? 1 : 0);
