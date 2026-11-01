#!/usr/bin/env node
// A VARREDURA DA WEB: cada conferência na base que ela pede, sempre nova.
//
// Por que isto existe. As conferências rodavam todas contra UM servidor, com
// UMA base, aberta uma vez e reaproveitada. Duas coisas davam errado, e as
// duas davam errado em silêncio:
//
// 1. **A base é mutável.** `verificar-cliente` cadastra matrizes, `verificar-
//    carga` importa lançamentos. Quem roda depois encontra uma base diferente
//    da que o roteiro dele descreve — e a falha aparece como defeito do
//    produto. Uma conferência cujo resultado depende da ordem não mede nada.
//
// 2. **Nem toda conferência quer a mesma base.** `verificar-cliente` precisa
//    de DOIS contratantes (`preparar-verificacao.ts`); `verificar-indicadores`
//    precisa de um com duas matrizes (`preparar-verificacao-v2.ts`); o bloco
//    de Resultados precisa ainda dos meses fechados que `preparar-resultados`
//    semeia. Rodar a de dois clientes contra a base de um devolve "só um
//    cliente aparece" — e não há defeito nenhum ali.
//
// Cada suíte passa a ganhar banco próprio, servidor próprio e porta própria.
// Mais lento, e a lentidão é o preço de um resultado que quer dizer alguma
// coisa.
//
// Uso:
//   node web/verificar-tudo.cjs               # todas
//   node web/verificar-tudo.cjs resultados    # só as que casam com o texto
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const SERVIDOR = path.join(RAIZ, 'server');
const CHROMIUM = process.env.CHROMIUM_BIN || '/opt/pw-browsers/chromium';
const SEGREDO = 'verificacao-local-apenas-nao-producao';

/**
 * A base de cada conferência.
 *
 * `completa` é v2 mais os meses do comparativo e dos resultados: é o que as
 * telas de leitura estratégica precisam para ter faixa, série e comparação.
 * Quem não aparece aqui cai nela — é a mais rica, e uma conferência que não
 * declara base não pode ser recusada por falta de dado.
 */
const BASES = {
  'dois-clientes': ['preparar-verificacao.ts'],
  v2: ['preparar-verificacao-v2.ts'],
  completa: ['preparar-verificacao-v2.ts', 'preparar-comparativo.ts', 'preparar-resultados.ts'],
  // Dois usuários no mesmo cliente: um que edita, um que só lê. É o que
  // `verificar-perfil` sempre pediu no cabeçalho e ninguém montava.
  perfis: ['preparar-perfis.ts'],
};

const DE_CADA_SUITE = {
  'verificar-cliente.cjs': 'dois-clientes',
  'verificar-carga.cjs': 'dois-clientes',
  'verificar-perfil.cjs': 'perfis',
};

const baseDe = (suite) => DE_CADA_SUITE[suite] || 'completa';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function noAr(porta, tentativas = 60) {
  for (let i = 0; i < tentativas; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/api/saude`);
      if (r.ok) return true;
    } catch {
      // ainda subindo
    }
    await esperar(500);
  }
  return false;
}

async function rodarUma(suite, porta) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'varredura-'));
  const banco = path.join(pasta, 'base.sqlite');
  const ambiente = { ...process.env, DATABASE_PATH: banco, JWT_SECRET: SEGREDO };

  for (const preparador of BASES[baseDe(suite)]) {
    try {
      execFileSync('npx', ['tsx', path.join('src', 'db', preparador)], {
        cwd: SERVIDOR, env: ambiente, stdio: 'pipe', encoding: 'utf8',
      });
    } catch (e) {
      // A mensagem do preparador É o diagnóstico. Deixar o objeto de erro
      // vazar cru imprime um Buffer de bytes e esconde a única linha útil.
      const texto = `${e.stdout || ''}${e.stderr || ''}`.trim() || String(e.message || e);
      return { suite, falhas: [`a base não pôde ser preparada (${preparador})`], morreu: true, saida: texto };
    }
  }

  const servidor = spawn('node', [path.join('dist', 'index.js')], {
    cwd: SERVIDOR,
    env: { ...ambiente, PORT: String(porta) },
    stdio: 'ignore',
    detached: true,
  });

  try {
    if (!(await noAr(porta))) return { suite, erro: 'o servidor não subiu', falhas: ['(sem servidor)'] };
    let saida = '';
    try {
      saida = execFileSync('node', [path.join(__dirname, suite)], {
        cwd: RAIZ,
        env: { ...process.env, BASE_URL: `http://127.0.0.1:${porta}`, CHROMIUM_BIN: CHROMIUM },
        encoding: 'utf8',
        timeout: 8 * 60 * 1000,
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (e) {
      // Saída diferente de zero é o normal de uma suíte com falha: o texto é
      // que interessa, e jogá-lo fora deixaria só "deu erro".
      saida = `${e.stdout || ''}${e.stderr || ''}`;
      if (!saida.trim()) saida = String(e.message || e);
    }
    const falhas = saida.split('\n').filter((l) => /^\s*✗/.test(l)).map((l) => l.trim());
    // MORREU é decidido pelo rodapé que o Node imprime ao estourar sem captura
    // ("Node.js v22..."), e não por procurar a palavra "Error" no texto.
    //
    // Importa porque uma suíte que morre ANTES da primeira asserção não
    // imprime nenhum "✗" — e contar linhas de "✗" a daria como limpa. Foi
    // assim que `verificar-perfil` passou meses morrendo no login e sendo
    // reportada como verde.
    const morreu = /^Node\.js v\d/m.test(saida);
    return { suite, falhas, morreu, saida };
  } finally {
    try { process.kill(-servidor.pid, 'SIGKILL'); } catch { /* já saiu */ }
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

(async () => {
  const filtro = process.argv[2] || '';
  const suites = fs.readdirSync(__dirname)
    .filter((f) => /^verificar-.*\.cjs$/.test(f) && f !== 'verificar-tudo.cjs')
    .filter((f) => !filtro || f.includes(filtro))
    .sort();

  if (!suites.length) {
    console.log(`Nenhuma conferência casa com "${filtro}".`);
    process.exit(1);
  }

  const pastaLogs = fs.mkdtempSync(path.join(os.tmpdir(), 'varredura-logs-'));
  console.log(`${suites.length} conferência(s); registro completo em ${pastaLogs}\n`);

  const resultados = [];
  let porta = 3400;
  for (const suite of suites) {
    const r = await rodarUma(suite, porta);
    porta += 1;
    fs.writeFileSync(path.join(pastaLogs, `${suite}.txt`), r.saida || r.erro || '');
    resultados.push(r);
    const marca = r.morreu ? 'MORREU' : `✗=${r.falhas.length}`;
    if (r.morreu && !r.falhas.length) r.falhas.push('(morreu antes de medir qualquer coisa)');
    console.log(`${suite.padEnd(40)} ${String(marca).padStart(8)}  [base: ${baseDe(suite)}]`);
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
})();
