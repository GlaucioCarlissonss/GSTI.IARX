#!/usr/bin/env node
// A VARREDURA DO ARTIFACT: monta uma vez, depois roda tudo.
//
// Por que isto existe. As suítes do artifact leem `teste-local.html`, que é
// montado por `montar-teste.cjs` a partir dos fontes. Rodá-las uma a uma,
// enquanto alguém edita e remonta, troca o arquivo DEBAIXO da varredura: as
// primeiras medem o build antigo, as últimas o novo, e o resultado não
// descreve nenhum dos dois. Já aconteceu, e custou uma medição inteira.
//
// A montagem acontece aqui, antes da primeira suíte. Quem roda isto não
// precisa lembrar de montar — e, mais importante, não consegue remontar no
// meio sem perceber.
//
// A SEGUNDA RAZÃO é a mesma da varredura da web: contar linhas de "✗" dá
// VERDE a uma suíte que morreu antes da primeira asserção, porque ela não
// imprime falha nenhuma. "Morreu" se decide pelo rodapé que o Node imprime ao
// estourar sem captura.
//
// Uso:
//   node artifact/testar-tudo.cjs            # todas
//   node artifact/testar-tudo.cjs spincare   # só as que casam com o texto
//   node artifact/testar-tudo.cjs --sem-montar
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AQUI = __dirname;
const CHROMIUM = process.env.CHROMIUM_BIN || '/opt/pw-browsers/chromium';

function montar() {
  console.log('montando o artifact…');
  execFileSync('./montar.sh', { cwd: AQUI, stdio: 'pipe', encoding: 'utf8' });
  const saida = execFileSync('node', ['montar-teste.cjs'], {
    cwd: AQUI, stdio: 'pipe', encoding: 'utf8',
  });
  console.log(`  ${saida.trim().split('\n').pop()}\n`);
}

function rodarUma(suite, pastaLogs) {
  let saida = '';
  try {
    saida = execFileSync('node', [path.join(AQUI, suite)], {
      cwd: AQUI,
      env: { ...process.env, CHROMIUM_BIN: CHROMIUM },
      encoding: 'utf8',
      timeout: 6 * 60 * 1000,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    // Saída diferente de zero é o normal de uma suíte com falha: o texto é o
    // que interessa, e jogá-lo fora deixaria só "deu erro".
    saida = `${e.stdout || ''}${e.stderr || ''}`;
    if (!saida.trim()) saida = String(e.message || e);
  }
  fs.writeFileSync(path.join(pastaLogs, `${suite}.txt`), saida);
  const falhas = saida.split('\n').filter((l) => /^\s*✗/.test(l)).map((l) => l.trim());
  const morreu = /^Node\.js v\d/m.test(saida);
  if (morreu && !falhas.length) falhas.push('(morreu antes de medir qualquer coisa)');
  return { suite, falhas, morreu };
}

const argumentos = process.argv.slice(2);
const semMontar = argumentos.includes('--sem-montar');
const filtro = argumentos.find((a) => !a.startsWith('--')) || '';

if (!semMontar) montar();

const suites = fs.readdirSync(AQUI)
  .filter((f) => /^testar-.*\.cjs$/.test(f) && f !== 'testar-tudo.cjs')
  .filter((f) => !filtro || f.includes(filtro))
  .sort();

if (!suites.length) {
  console.log(`Nenhuma suíte casa com "${filtro}".`);
  process.exit(1);
}

const pastaLogs = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-logs-'));
console.log(`${suites.length} suíte(s); registro completo em ${pastaLogs}\n`);

const resultados = [];
for (const suite of suites) {
  const r = rodarUma(suite, pastaLogs);
  resultados.push(r);
  console.log(`${suite.padEnd(42)} ${(r.morreu ? 'MORREU' : `✗=${r.falhas.length}`).padStart(8)}`);
  for (const f of r.falhas) console.log(`    ${f}`);
}

const comFalha = resultados.filter((r) => r.falhas.length || r.morreu);
console.log(`\n${'='.repeat(60)}`);
console.log(`${resultados.length - comFalha.length} de ${resultados.length} limpas.`);
if (comFalha.length) {
  console.log('Ainda com falha:');
  for (const r of comFalha) {
    console.log(`  ${r.suite}: ${r.morreu ? 'morreu no meio' : `${r.falhas.length} falha(s)`}`);
  }
}
process.exit(comFalha.length ? 1 : 0);
