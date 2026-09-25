// O acordo de SLA que decide de verdade.
//
// Até aqui o cadastro era enfeite nesta versão: a função que calculava as
// horas do acordo não tinha um único chamador, e reclassificar um chamado
// mudava a prioridade sem mexer no prazo. O servidor fazia as duas coisas —
// as duas pontas do mesmo sistema davam números diferentes para o mesmo
// chamado.
//
// O que esta suíte prova: a vigência escolhe o acordo pela ABERTURA do
// chamado; a reaplicação por competência muda dentro/fora e conta o que
// mudou; a prévia não grava; o registro agregado fica de fora; e reclassificar
// refaz o prazo.
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

  // Base própria: um mês inventado, numa unidade do cliente, com três
  // chamados de formas diferentes. Assim a suíte não depende da carga real e
  // não estraga nada dela.
  const COMP = '2024-02';
  const preparo = await pag.evaluate(async (comp) => {
    const emp = empresaAtiva();
    await Loja.gravarCatalogo('slasCad', []);
    await Loja.slaDa(emp);
    const itens = [
      // Fechou 3h depois: dentro de um acordo de 24h, fora de um de 1h.
      { id: 'ac1', filial: null, fila: 'Infraestrutura', topico: 'Rede', total: 1, dentro: 1,
        prioridade: 'high', status: 'Resolvido',
        criadoEm: comp + '-10T09:00:00Z', fechadoEm: comp + '-10T12:00:00Z', prazoEm: null },
      // Sem prioridade: o acordo não tem como alcançá-lo.
      { id: 'ac2', filial: null, fila: 'Infraestrutura', topico: 'Rede', total: 1, dentro: 1,
        prioridade: null, status: 'Resolvido',
        criadoEm: comp + '-11T09:00:00Z', fechadoEm: comp + '-11T10:00:00Z', prazoEm: null },
      // Agregado do mês: 40 atendimentos numa linha só.
      { id: 'ac3', filial: null, fila: 'Infraestrutura', topico: null, total: 40, dentro: 30 },
    ];
    await Loja.gravarSlaMes(emp, comp, itens);
    await Loja.slaDa(emp);
    return { emp, quantos: (E.sla.get(emp) || []).filter((r) => r.competencia === comp).length };
  }, COMP);
  ok('a base de teste entrou', preparo.quantos === 3, String(preparo.quantos));

  // ------------------------------------------------------------ vigência
  console.log('\nVIGÊNCIA — quem escolhe o acordo é a abertura do chamado');
  const vigencia = await pag.evaluate(async (comp) => {
    const emp = empresaAtiva();
    await Loja.gravarCatalogo('slasCad', [
      { empresa: emp, topico: null, prioridade: 'high', horas: 24,
        vigenciaInicio: null, vigenciaFim: comp + '-09', ativo: true },
      { empresa: emp, topico: null, prioridade: 'high', horas: 1,
        vigenciaInicio: comp + '-10', vigenciaFim: null, ativo: true },
    ]);
    return {
      antes: horasDoAcordo(emp, 'high', null, comp + '-05T09:00:00Z'),
      depois: horasDoAcordo(emp, 'high', null, comp + '-10T09:00:00Z'),
      prazo: prazoDoAcordo(emp, comp + '-10T09:00:00Z', 'high', null),
    };
  }, COMP);
  ok('chamado aberto antes da troca usa o acordo antigo', vigencia.antes === 24, String(vigencia.antes));
  ok('chamado aberto depois usa o novo', vigencia.depois === 1, String(vigencia.depois));
  ok('e o prazo sai de abertura + horas', vigencia.prazo === '2024-02-10T10:00:00.000Z', String(vigencia.prazo));

  // ----------------------------------------------------------- a tela
  console.log('\nTELA — a vigência aparece, e o bloco de reaplicação existe');
  await irPara(pag, 'SLAs', 900);
  const tela = await pag.evaluate(() => {
    const linhas = [...document.querySelectorAll('#pagina table tbody tr')]
      .map((tr) => [...tr.children].map((td) => td.textContent.trim()));
    return {
      linhas,
      temReaplicacao: !!document.querySelector('[data-aplicar-sla]'),
      temPrevia: !!document.querySelector('[data-previa-sla]'),
      temCompetencia: !!document.querySelector('#r-comp'),
    };
  });
  ok('os dois acordos aparecem', tela.linhas.length === 2, String(tela.linhas.length));
  ok('com a vigência escrita por extenso',
    tela.linhas.some((l) => /até 09\/02\/2024/.test(l.join(' ')))
    && tela.linhas.some((l) => /a partir de 10\/02\/2024/.test(l.join(' '))),
    JSON.stringify(tela.linhas.map((l) => l[3])));
  ok('o bloco de reaplicação está na tela', tela.temReaplicacao && tela.temPrevia && tela.temCompetencia);

  // ---------------------------------------------------------- a prévia
  console.log('\nPRÉVIA — conta o que mudaria, e não grava');
  await pag.selectOption('#r-comp', COMP);
  await pag.click('[data-previa-sla]');
  await pag.waitForTimeout(300);
  const previa = await pag.evaluate((comp) => {
    const texto = (document.querySelector('#r-resultado') || {}).textContent || '';
    const emp = empresaAtiva();
    const alvo = (E.sla.get(emp) || []).find((r) => r.id === 'ac1' && r.competencia === comp);
    return { texto, prazoGravado: alvo ? alvo.prazoEm : 'sumiu', dentroGravado: alvo ? alvo.dentro : null };
  }, COMP);
  ok('a prévia diz que nada foi gravado', /nada foi gravado/i.test(previa.texto));
  ok('e conta 1 chamado que passaria a contar fora', /Passaram a contar fora/.test(previa.texto));
  ok('o chamado continua sem prazo no armazenamento', previa.prazoGravado === null, String(previa.prazoGravado));
  ok('e continua contando dentro', Number(previa.dentroGravado) === 1, String(previa.dentroGravado));

  // -------------------------------------------------------- a aplicação
  console.log('\nAPLICAÇÃO — o número muda, e o que não dá para medir fica de fora');
  await pag.fill('#r-just', 'Acordo assinado, aplicado ao mês');
  await pag.click('[data-aplicar-sla]');
  await pag.waitForTimeout(600);
  const aplicado = await pag.evaluate(async (comp) => {
    const emp = empresaAtiva();
    await Loja.slaDa(emp);
    const doMes = (E.sla.get(emp) || []).filter((r) => r.competencia === comp);
    const um = doMes.find((r) => r.id === 'ac1');
    const sem = doMes.find((r) => r.id === 'ac2');
    const agregado = doMes.find((r) => r.id === 'ac3');
    return {
      texto: (document.querySelector('#r-resultado') || {}).textContent || '',
      prazo: um && um.prazoEm, dentro: um && Number(um.dentro), doAcordo: um && um.prazoDoAcordo,
      semPrazo: sem && sem.prazoEm, semDentro: sem && Number(sem.dentro),
      agregadoTotal: agregado && Number(agregado.total), agregadoDentro: agregado && Number(agregado.dentro),
    };
  }, COMP);
  ok('a tela confirma a aplicação', /Acordo aplicado/i.test(aplicado.texto));
  ok('o chamado ganhou o prazo do acordo', aplicado.prazo === '2024-02-10T10:00:00.000Z', String(aplicado.prazo));
  ok('e passou a contar FORA', aplicado.dentro === 0, String(aplicado.dentro));
  ok('a ficha sabe que o prazo é nosso', aplicado.doAcordo === true, String(aplicado.doAcordo));
  ok('o chamado sem prioridade ficou intocado',
    aplicado.semPrazo === null && aplicado.semDentro === 1,
    `${aplicado.semPrazo} / ${aplicado.semDentro}`);
  ok('o registro agregado saiu inteiro',
    aplicado.agregadoTotal === 40 && aplicado.agregadoDentro === 30,
    `${aplicado.agregadoTotal} / ${aplicado.agregadoDentro}`);

  // ------------------------------------------------ aplicar de novo
  console.log('\nIDEMPOTÊNCIA — aplicar duas vezes não inventa alteração');
  await pag.click('[data-aplicar-sla]');
  await pag.waitForTimeout(500);
  const segunda = await pag.evaluate(() =>
    ((document.querySelector('#r-resultado') || {}).textContent || '').replace(/\s+/g, ' '));
  ok('a segunda passada não altera nada', /Alterados\s*0/.test(segunda), segunda.slice(0, 120));

  // ------------------------------------------------- mês fechado recusa
  console.log('\nFECHAMENTO — mês fechado recusa, e diz por quê');
  await pag.evaluate(async (comp) => {
    const emp = empresaAtiva();
    const atuais = await Loja.fechamentosDa(emp);
    await Loja.gravarFechamentos(emp, [...atuais, { comp, quando: new Date().toISOString() }]);
  }, COMP);
  await pag.click('[data-aplicar-sla]');
  await pag.waitForTimeout(400);
  const fechado = await pag.evaluate(() => (document.querySelector('#r-resultado') || {}).textContent || '');
  ok('a reaplicação em mês fechado é recusada', /está fechada/i.test(fechado), fechado.trim().slice(0, 90));

  // limpa o fechamento para não contaminar outras suítes na mesma base
  await pag.evaluate(async (comp) => {
    const emp = empresaAtiva();
    const atuais = await Loja.fechamentosDa(emp);
    await Loja.gravarFechamentos(emp, atuais.filter((f) => (f && f.comp ? f.comp : f) !== comp));
  }, COMP);

  // -------------------------------------------------- reclassificação
  console.log('\nRECLASSIFICAÇÃO — mudar a prioridade refaz o prazo');
  const reclass = await pag.evaluate(async (comp) => {
    const emp = empresaAtiva();
    // Um acordo bem curto para Urgente: elevar tem de encurtar o prazo.
    await Loja.gravarCatalogo('slasCad', [
      ...(E.slasCad || []),
      { empresa: emp, topico: null, prioridade: 'urgent', horas: 0.5, ativo: true },
    ]);
    const antes = (E.sla.get(emp) || []).find((r) => r.id === 'ac1' && r.competencia === comp);
    const medida = medirPeloAcordo(emp, { ...antes, prioridade: 'urgent' });
    return { antes: antes.prazoEm, depois: medida && medida.prazoEm, dentro: medida && medida.dentro };
  }, COMP);
  ok('o prazo encurta com a prioridade nova',
    reclass.depois === '2024-02-10T09:30:00.000Z', String(reclass.depois));
  ok('e o chamado segue fora, agora por 2h30 de atraso', reclass.dentro === 0, String(reclass.dentro));

  console.log(`\n=== falhas: ${falhas.length ? falhas.join(' | ') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? erros.join(' | ') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
