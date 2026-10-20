// O MOTOR DE HORAS ÚTEIS e o cadastro de feriados (Módulo SLA, Entrega 1).
//
// Aqui o que se confere é aritmética de calendário, e ela é toda contra-
// intuitiva: quatro horas de prazo numa sexta às 17h30 vencem na SEGUNDA, e
// abrir um chamado às 22h de terça tem exatamente o mesmo prazo de abri-lo às
// 8h de quarta. Errar isso reprova a equipe por horas em que ninguém
// trabalhou — que é o defeito que este motor existe para corrigir.
//
// As datas são fixas e os dias da semana foram conferidos: 02/03/2026 é uma
// segunda, 06/03 uma sexta, 09/03 a segunda seguinte; 20/04/2026 é segunda e
// 21/04 (Tiradentes) a terça.
//
// As pontas são escritas em hora LOCAL de propósito: o motor trabalha no fuso
// de quem opera, e um teste em UTC passaria verde num contêiner e vermelho na
// máquina do cliente.
const { chromium } = require('playwright');
const { irPara } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });

  // Um utilitário só para a conferência: o motor devolve ISO em UTC, e o que
  // interessa ler é o instante LOCAL.
  await pag.evaluate(() => {
    window.local = (iso) => {
      if (!iso) return String(iso);
      const d = new Date(iso);
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
  });

  console.log('\nA JANELA DO CONTRATO');
  const janela = await pag.evaluate(() => ({
    segunda: horasUteis('2026-03-02T00:00:00', '2026-03-02T23:59:59', new Set()),
    sexta: horasUteis('2026-03-06T00:00:00', '2026-03-06T23:59:59', new Set()),
    sabado: horasUteis('2026-03-07T00:00:00', '2026-03-07T23:59:59', new Set()),
    domingo: horasUteis('2026-03-08T00:00:00', '2026-03-08T23:59:59', new Set()),
    semana: horasUteis('2026-03-02T08:00:00', '2026-03-06T17:00:00', new Set()),
  }));
  ok('segunda a quinta valem 10 h', janela.segunda === 10, String(janela.segunda));
  // A sexta curta é o detalhe que mais se perde numa reimplementação: 9 h, e
  // não 10 — o contrato fecha às 17h.
  ok('sexta vale 9 h, e não 10', janela.sexta === 9, String(janela.sexta));
  ok('sábado e domingo valem 0', janela.sabado === 0 && janela.domingo === 0,
    `${janela.sabado} · ${janela.domingo}`);
  ok('a semana inteira dá 49 h (4×10 + 9)', janela.semana === 49, String(janela.semana));

  console.log('\nCHAMADO ABERTO NA SEXTA ÀS 17H30');
  const sexta = await pag.evaluate(() => ({
    // Depois do fechamento: o relógio não corre nem um minuto na sexta.
    consumoAteSegundaOito: horasUteis('2026-03-06T17:30:00', '2026-03-09T08:00:00', new Set()),
    prazo: local(prazoEmHorasUteis('2026-03-06T17:30:00', 4, new Set())),
    corridas: local(new Date(new Date('2026-03-06T17:30:00').getTime() + 4 * 3600000).toISOString()),
  }));
  ok('nada corre entre 17h30 de sexta e a abertura de segunda',
    sexta.consumoAteSegundaOito === 0, String(sexta.consumoAteSegundaOito));
  ok('4 h de prazo vencem segunda ao meio-dia', sexta.prazo === '09/03 12:00', sexta.prazo);
  // O número que o sistema dava antes, para que a diferença fique registrada.
  ok('e não às 21h30 de sexta, como em horas corridas', sexta.corridas === '06/03 21:30',
    sexta.corridas);

  console.log('\nCHAMADO QUE ATRAVESSA O FIM DE SEMANA');
  const fds = await pag.evaluate(() => ({
    prazo: local(prazoEmHorasUteis('2026-03-06T15:00:00', 4, new Set())),
    consumo: horasUteis('2026-03-06T15:00:00', '2026-03-09T10:00:00', new Set()),
    // Sexta 17:00 → segunda 08:00 é um vão de 63 horas de relógio e zero de
    // expediente.
    vao: horasUteis('2026-03-06T17:00:00', '2026-03-09T08:00:00', new Set()),
  }));
  ok('sexta 15h + 4 h vence segunda às 10h', fds.prazo === '09/03 10:00', fds.prazo);
  ok('o consumo até lá é de 4 h, e não de 67', fds.consumo === 4, String(fds.consumo));
  ok('o fim de semana inteiro consome 0', fds.vao === 0, String(fds.vao));

  console.log('\nCHAMADO QUE ATRAVESSA UM FERIADO');
  const feriado = await pag.evaluate(() => {
    const com = new Set(['2026-04-21']);       // Tiradentes, uma terça
    return {
      semFeriado: local(prazoEmHorasUteis('2026-04-20T16:00:00', 4, new Set())),
      comFeriado: local(prazoEmHorasUteis('2026-04-20T16:00:00', 4, com)),
      diaTodo: horasUteis('2026-04-21T00:00:00', '2026-04-21T23:59:59', com),
      consumo: horasUteis('2026-04-20T16:00:00', '2026-04-22T10:00:00', com),
    };
  });
  ok('sem feriado, segunda 16h + 4 h vence terça às 10h', feriado.semFeriado === '21/04 10:00',
    feriado.semFeriado);
  ok('com o feriado, o mesmo prazo pula para quarta às 10h',
    feriado.comFeriado === '22/04 10:00', feriado.comFeriado);
  ok('o feriado inteiro vale 0 h', feriado.diaTodo === 0, String(feriado.diaTodo));
  ok('e o consumo até quarta 10h é de 4 h', feriado.consumo === 4, String(feriado.consumo));

  console.log('\nCHAMADO ABERTO FORA DO EXPEDIENTE');
  const fora = await pag.evaluate(() => ({
    noite: local(prazoEmHorasUteis('2026-03-03T22:00:00', 4, new Set())),   // terça 22h
    manha: local(prazoEmHorasUteis('2026-03-04T08:00:00', 4, new Set())),   // quarta 8h
    madrugada: local(prazoEmHorasUteis('2026-03-04T03:00:00', 4, new Set())),
    sabado: local(prazoEmHorasUteis('2026-03-07T10:00:00', 4, new Set())),
    // Aberto às 22h de terça, nada foi consumido até a abertura de quarta.
    consumoNoite: horasUteis('2026-03-03T22:00:00', '2026-03-04T08:00:00', new Set()),
  }));
  // A promessa do contrato: quem abre de madrugada não perde o prazo por isso,
  // e quem abre de madrugada também não ganha prazo a mais.
  ok('abrir às 22h de terça dá o mesmo prazo de abrir às 8h de quarta',
    fora.noite === fora.manha && fora.noite === '04/03 12:00', `${fora.noite} · ${fora.manha}`);
  ok('e abrir às 3h da manhã também', fora.madrugada === fora.manha, fora.madrugada);
  ok('aberto no sábado, o relógio só começa na segunda', fora.sabado === '09/03 12:00', fora.sabado);
  ok('a noite de terça não consome nada', fora.consumoNoite === 0, String(fora.consumoNoite));

  console.log('\nO INVERSO FECHA COM O DIRETO');
  const volta = await pag.evaluate(() => {
    const casos = [
      ['2026-03-02T09:00:00', 3], ['2026-03-06T16:30:00', 12], ['2026-03-04T11:15:00', 0.5],
      ['2026-03-07T10:00:00', 20], ['2026-03-02T08:00:00', 49],
    ];
    const f = new Set(['2026-03-05']);
    return casos.map(([ini, h]) => {
      const prazo = prazoEmHorasUteis(ini, h, f);
      return { ini, h, medido: horasUteis(ini, prazo, f) };
    });
  });
  // Se `prazoEmHorasUteis` e `horasUteis` divergirem, a tela mostra um prazo
  // que o próprio sistema não consegue reproduzir ao medir o consumo.
  ok('medir o prazo devolvido dá exatamente as horas pedidas',
    volta.every((c) => Math.abs(c.medido - c.h) < 0.002),
    volta.map((c) => `${c.h}→${c.medido}`).join(' · '));

  console.log('\nDADO TORTO NÃO VIRA NÚMERO ABSURDO');
  const torto = await pag.evaluate(() => ({
    invertido: horasUteis('2026-03-06T17:00:00', '2026-03-02T08:00:00', new Set()),
    igual: horasUteis('2026-03-02T09:00:00', '2026-03-02T09:00:00', new Set()),
    lixo: horasUteis('nada', '2026-03-02T08:00:00', new Set()),
    horaNegativa: prazoEmHorasUteis('2026-03-02T09:00:00', -3, new Set()),
    zero: local(prazoEmHorasUteis('2026-03-06T17:30:00', 0, new Set())),
  }));
  // Consumo negativo se espalharia como "dentro do prazo" em toda a
  // conformidade, que é o pior jeito de um erro de dado se esconder.
  ok('fim antes do início devolve 0, e não negativo', torto.invertido === 0, String(torto.invertido));
  ok('pontas iguais devolvem 0', torto.igual === 0, String(torto.igual));
  ok('data ilegível devolve null, e não NaN', torto.lixo === null, String(torto.lixo));
  ok('horas negativas devolvem null', torto.horaNegativa === null, String(torto.horaNegativa));
  ok('prazo de 0 h é o próximo instante útil', torto.zero === '09/03 08:00', torto.zero);

  console.log('\nO SEMÁFORO DA CONFORMIDADE');
  const semaforo = await pag.evaluate(() => ({
    noventa: faixaDaConformidade(90).curto,
    oitentaNove: faixaDaConformidade(89.9).curto,
    setenta: faixaDaConformidade(70).curto,
    sessentaNove: faixaDaConformidade(69.9).curto,
    vazio: faixaDaConformidade(null).curto,
    // A cor nunca é o único canal: o selo carrega símbolo e palavra.
    selo: seloConformidadeHtml(95).replace(/\s+/g, ' '),
  }));
  ok('90% é excelente — a borda pertence à faixa de cima',
    semaforo.noventa === 'excelente', semaforo.noventa);
  ok('89,9% já é atenção', semaforo.oitentaNove === 'atenção', semaforo.oitentaNove);
  ok('70% é atenção, e 69,9% é crítico',
    semaforo.setenta === 'atenção' && semaforo.sessentaNove === 'crítico',
    `${semaforo.setenta} · ${semaforo.sessentaNove}`);
  ok('sem base, não inventa faixa', semaforo.vazio === 'sem base', semaforo.vazio);
  ok('o selo tem símbolo e palavra, não só cor',
    /✓/.test(semaforo.selo) && /excelente/.test(semaforo.selo), semaforo.selo.slice(0, 90));

  console.log('\nO CADASTRO DE FERIADOS');
  await irPara(pag, 'Feriados', 1500);
  ok('a aba existe e abre', await pag.evaluate(() => /Feriados/.test(el('#pagina').textContent)));
  ok('e diz a janela do expediente por extenso',
    await pag.evaluate(() => /08:00.*18:00/.test(el('#pagina').textContent)
      && /08:00.*17:00/.test(el('#pagina').textContent)));

  await pag.click('#fer-novo');
  await pag.waitForTimeout(600);
  await pag.fill('#fe-data', '31/02/2026');
  await pag.fill('#fe-desc', 'Dia que não existe');
  await pag.click('[data-s]');
  await pag.waitForTimeout(500);
  // 31/02 casa com a expressão de data e não existe no calendário: sem a
  // conferência, ele entraria como 03/03 e tiraria um dia útil de verdade.
  ok('uma data inexistente é recusada',
    await pag.evaluate(() => {
      const b = document.querySelector('#modais [data-erro]');
      return !!b && !b.hidden && /formato DD\/MM\/AAAA/.test(b.textContent);
    }));

  await pag.fill('#fe-data', '21/04/2026');
  await pag.fill('#fe-desc', '');
  await pag.click('[data-s]');
  await pag.waitForTimeout(500);
  ok('e uma descrição vazia também',
    await pag.evaluate(() => {
      const b = document.querySelector('#modais [data-erro]');
      return !!b && !b.hidden && /descrição/.test(b.textContent);
    }));

  await pag.fill('#fe-desc', 'Tiradentes');
  await pag.click('[data-s]');
  await pag.waitForTimeout(1500);
  const gravado = await pag.evaluate(() => {
    const linhas = [...document.querySelectorAll('#pagina tbody tr')]
      .map((tr) => tr.textContent.replace(/\s+/g, ' ').trim());
    return {
      linhas,
      guardado: (E.feriados || []).filter((f) => f.data === '2026-04-21'),
      // O motor tem de enxergá-lo sem que ninguém lhe passe o conjunto à mão.
      prazo: local(prazoEmHorasUteis('2026-04-20T16:00:00', 4)),
    };
  });
  ok('o feriado entra na lista', gravado.linhas.some((t) => /21\/04\/2026/.test(t) && /Tiradentes/.test(t)),
    (gravado.linhas[0] || '').slice(0, 60));
  ok('dizendo em que dia da semana ele cai',
    gravado.linhas.some((t) => /terça/.test(t)), (gravado.linhas[0] || '').slice(0, 60));
  ok('guardado uma vez só, com o cliente', gravado.guardado.length === 1
    && !!gravado.guardado[0].cliente, JSON.stringify(gravado.guardado));
  // A ligação que decide a entrega: cadastrar muda o cálculo, sem parâmetro.
  ok('e o motor passa a pular o dia sozinho', gravado.prazo === '22/04 10:00', gravado.prazo);

  await pag.click('#fer-novo');
  await pag.waitForTimeout(600);
  await pag.fill('#fe-data', '21/04/2026');
  await pag.fill('#fe-desc', 'Tiradentes de novo');
  await pag.click('[data-s]');
  await pag.waitForTimeout(500);
  ok('cadastrar o mesmo dia duas vezes é recusado, dizendo qual já existe',
    await pag.evaluate(() => {
      const b = document.querySelector('#modais [data-erro]');
      return !!b && !b.hidden && /Tiradentes/.test(b.textContent);
    }));
  await pag.keyboard.press('Escape');
  await pag.waitForTimeout(500);

  const desconsiderado = await pag.evaluate(async () => {
    document.querySelector('[data-fer-alt="0"]').click();
    await new Promise((r) => setTimeout(r, 1400));
    return {
      // Desconsiderar não apaga: o registro de que o dia existiu fica.
      aindaNaLista: (E.feriados || []).some((f) => f.data === '2026-04-21'),
      inativo: (E.feriados || []).find((f) => f.data === '2026-04-21').ativo === false,
      prazo: local(prazoEmHorasUteis('2026-04-20T16:00:00', 4)),
    };
  });
  ok('desconsiderar mantém o registro', desconsiderado.aindaNaLista && desconsiderado.inativo);
  ok('e o dia volta a contar como útil', desconsiderado.prazo === '21/04 10:00', desconsiderado.prazo);

  const isolado = await pag.evaluate(() => {
    const outro = feriadosDoCliente('cliente-que-nao-existe');
    return { vazio: outro.size, doAtual: feriadosDoCliente().size };
  });
  ok('o feriado é do cliente, e não vaza para outro', isolado.vazio === 0, String(isolado.vazio));
  ok('e o cliente atual não herda feriado de ninguém', isolado.doAtual === 0, String(isolado.doAtual));

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
