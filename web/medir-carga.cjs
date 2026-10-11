// QUANTO A REDE REALMENTE BAIXA, e quanto tempo a tela leva para existir.
//
// O relatório do empacotador diz o tamanho dos arquivos; ele não diz quantos
// deles o navegador busca para abrir UMA tela, que é a pergunta. Aqui a conta
// é feita contando o que passou pela rede de verdade.
//
//   DATABASE_PATH=... PORT=3401 JWT_SECRET=... node server/dist/index.js
//   BASE_URL=http://localhost:3401 REDE=4g node web/medir-carga.cjs
//
// Cada tela é medida numa ABA NOVA, com o cache desligado: medir a segunda
// visita diria que tudo é instantâneo, o que é verdade e não interessa — o
// que se quer saber é o custo de quem chega.
//
// ## Por que a rede é estrangulada
//
// Em localhost a banda é infinita e a latência é zero. Nessas condições
// dividir o pacote só pode PIORAR o tempo: os bytes economizados não custavam
// nada, e cada arquivo a mais é uma ida e volta a mais. Medir assim provaria
// o contrário do que acontece com quem usa o sistema.
//
// `REDE` escolhe a condição. O padrão, `4g`, é o perfil comum de uma conexão
// de escritório mediana ou de celular com sinal bom — que é onde o gestor
// abre isto. `livre` desliga o estrangulamento, para ver o custo puro de
// processamento.
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3401';
const SENHA = process.env.SENHA || 'varredura2026';

/** Perfis de rede, em bytes por segundo e milissegundos de latência. */
const REDES = {
  livre: null,
  '4g': { downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (3 * 1024 * 1024) / 8, latency: 60 },
  '3g': { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 },
};
const NOME_REDE = process.env.REDE || '4g';
const REDE = REDES[NOME_REDE];
if (REDE === undefined) {
  console.error(`REDE="${NOME_REDE}" não existe. Use: ${Object.keys(REDES).join(', ')}.`);
  process.exit(1);
}

const TELAS = [
  ['/', 'Painel executivo'],
  ['/lancamentos', 'Lançamentos'],
  ['/planilhas', 'Planilhas'],
  ['/auditoria', 'Auditoria'],
];

const kb = (n) => (n / 1024).toFixed(1).padStart(7) + ' kB';

(async () => {
  const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // Entra uma vez e guarda o estado: o login não é o que está sendo medido, e
  // repeti-lo em cada tela somaria o tempo dele ao número.
  const ctxLogin = await nav.newContext();
  const pLogin = await ctxLogin.newPage();
  await pLogin.goto(BASE + '/');
  await pLogin.waitForLoadState('networkidle');
  await pLogin.fill('input[autocomplete="username"], input[name="usuario"]', 'gestora');
  await pLogin.fill('input[type="password"]', SENHA);
  await pLogin.click('button[type="submit"]');
  await pLogin.waitForSelector('h1', { timeout: 15000 });
  await pLogin.waitForTimeout(700);
  if (await pLogin.$('.cartao button')) await pLogin.click('.cartao button');
  await pLogin.waitForSelector('.menu a', { timeout: 15000 });
  const estado = await ctxLogin.storageState();
  await ctxLogin.close();

  console.log(`\nO QUE A REDE BAIXA PARA ABRIR CADA TELA (primeira visita, sem cache · rede ${NOME_REDE})\n`);
  console.log('  tela                       js      arquivos   mediana de 3    as três');
  console.log('  ' + '-'.repeat(76));

  for (const [rota, nome] of TELAS) {
    // TRÊS medições, e fica a MEDIANA. Tempo de rede varia de corrida para
    // corrida; uma leitura só transformaria ruído em conclusão, e a diferença
    // que se quer medir aqui é da mesma ordem de grandeza do ruído.
    const tempos = [];
    let bytesJs = 0;
    let arquivos = 0;

    for (let volta = 0; volta < 3; volta++) {
      const ctx = await nav.newContext({ storageState: estado });
      const pag = await ctx.newPage();
      const cdp = await ctx.newCDPSession(pag);
      // Sem cache: cada medição é a de quem chega agora.
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      if (REDE) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...REDE });

      let bytes = 0;
      let n = 0;
      pag.on('response', async (r) => {
        if (!/\.js(\?|$)/.test(r.url())) return;
        n += 1;
        try {
          bytes += (await r.body()).length;
        } catch { /* resposta já descartada: não entra na conta */ }
      });

      const t0 = Date.now();
      await pag.goto(BASE + rota, { waitUntil: 'load' });
      // "A tela apareceu" é o conteúdo dela, não o `load` do documento: o
      // `load` acontece antes de o React montar qualquer coisa.
      await pag.waitForSelector('main h1, main h2, main .cartao, main table', { timeout: 30000 });
      tempos.push(Date.now() - t0);
      await pag.waitForTimeout(200);
      // Os bytes são os mesmos nas três voltas; guarda a última fechada.
      bytesJs = bytes;
      arquivos = n;
      await ctx.close();
    }

    const mediana = tempos.sort((a, b) => a - b)[1];
    console.log(`  ${nome.padEnd(22)} ${kb(bytesJs)}  ${String(arquivos).padStart(6)}   ${String(mediana).padStart(6)} ms   (${tempos.join(' / ')})`);
  }

  await nav.close();
  console.log('');
})();
