// CRITICIDADE PADRÃO DOS CHAMADOS IMPORTADOS (Módulo SLA, Entrega 2).
//
// O chamado do helpdesk chega sem criticidade — a extração traz `nivel`
// ("N1", "Implementacao"), que é outra coisa. Sem criticidade nenhum acordo
// alcança o chamado, e ele some da conta de conformidade em vez de aparecer
// como problema.
//
// O que esta suíte protege, além de a regra funcionar, é que ela seja
// OPCIONAL: sem padrão cadastrado nada muda. Inventar "Média" para todo mundo
// criaria julgamento de SLA sobre classificação que ninguém fez, e um
// percentual assim é pior do que a ausência dele.
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
  await irPara(pag, 'SLAs', 1800);

  console.log('\nSEM PADRÃO CADASTRADO, NADA MUDA');
  const semPadrao = await pag.evaluate(() => {
    const emp = empresaAtiva();
    const cru = { id: 'x1', total: 1, dentro: 1, criadoEm: '2026-03-02T09:00:00',
      prazoEm: '2026-03-04T09:00:00', prioridade: null };
    const saida = classificarChamado(emp, cru);
    return { padrao: criticidadePadrao(), prioridade: saida.prioridade,
      origem: saida.prioridadeOrigem, prazo: saida.prazoEm };
  });
  ok('nenhuma criticidade padrão vem de fábrica', semPadrao.padrao === null, String(semPadrao.padrao));
  // A decisão que o teste guarda: a ausência de padrão é respeitada.
  ok('o chamado sem criticidade continua sem criticidade',
    semPadrao.prioridade === null && !semPadrao.origem,
    `${semPadrao.prioridade} · ${semPadrao.origem}`);
  ok('e o prazo que o helpdesk informou fica intacto',
    semPadrao.prazo === '2026-03-04T09:00:00', semPadrao.prazo);

  console.log('\nO QUE VEIO CLASSIFICADO É MARCADO COMO DA ORIGEM');
  const daOrigem = await pag.evaluate(() => classificarChamado(empresaAtiva(),
    { id: 'x2', total: 1, dentro: 1, criadoEm: '2026-03-02T09:00:00', prioridade: 'high' }));
  ok('criticidade preservada', daOrigem.prioridade === 'high', daOrigem.prioridade);
  ok('e marcada como vinda da origem', daOrigem.prioridadeOrigem === 'importada',
    daOrigem.prioridadeOrigem);

  console.log('\nO CADASTRO DA CRITICIDADE PADRÃO');
  ok('o bloco existe no cadastro de SLAs',
    await pag.evaluate(() => /Criticidade padrão dos chamados importados/.test(el('#pagina').textContent)));
  await pag.selectOption('#cp-pad', 'medium');
  await pag.click('#cp-salvar');
  await pag.waitForTimeout(1600);
  const salvo = await pag.evaluate(() => ({
    padrao: criticidadePadrao(),
    // Guardado por CLIENTE: a equipe de um contratante não decide o padrão de outro.
    porCliente: (E.config || {}).criticidadePadrao,
    aviso: /Criticidade padrão salva/.test(el('#pagina').textContent),
  }));
  ok('a criticidade padrão é salva', salvo.padrao === 'medium', String(salvo.padrao));
  ok('guardada por cliente', salvo.porCliente && Object.keys(salvo.porCliente).length === 1,
    JSON.stringify(salvo.porCliente));
  ok('e a tela confirma', salvo.aviso);
  ok('outro cliente não herda o padrão',
    await pag.evaluate(() => criticidadePadrao('outro-cliente-qualquer') === null));

  console.log('\nCOM PADRÃO, O CHAMADO GANHA CRITICIDADE E PRAZO DO ACORDO');
  const comPadrao = await pag.evaluate(async () => {
    const emp = empresaAtiva();
    // Um acordo de 4 h para Média, para o prazo ter de onde sair.
    await Loja.gravarCatalogo('slasCad', [...(E.slasCad || []),
      { empresa: emp, topico: null, prioridade: 'medium', horas: 4, ativo: true }]);
    const saida = classificarChamado(emp,
      { id: 'x3', total: 1, dentro: 1, criadoEm: '2026-03-02T09:00:00',
        prazoEm: '2026-03-30T09:00:00', prioridade: null });
    return { prioridade: saida.prioridade, origem: saida.prioridadeOrigem,
      prazo: saida.prazoEm, doAcordo: saida.prazoDoAcordo, prazoOrigem: saida.prazoOrigem };
  });
  ok('recebe a criticidade padrão', comPadrao.prioridade === 'medium', comPadrao.prioridade);
  ok('marcada como padrão do cadastro', comPadrao.origem === 'padrao', comPadrao.origem);
  ok('o prazo passa a sair do acordo (9h + 4h = 13h)',
    comPadrao.doAcordo === true && /2026-03-02T13:00/.test(comPadrao.prazo), comPadrao.prazo);
  // O prazo que o solicitante viu no helpdesk não é descartado: quem contesta
  // um "fora do SLA" precisa ter contra o que comparar.
  ok('e o prazo do helpdesk fica guardado',
    comPadrao.prazoOrigem === '2026-03-30T09:00:00', String(comPadrao.prazoOrigem));

  console.log('\nA CARGA DE RETAGUARDA');
  const pendentes = await pag.evaluate(() => {
    const lista = competenciasSemCriticidade(empresaAtiva());
    return { comps: lista.length, total: lista.reduce((s, [, n]) => s + n, 0) };
  });
  if (!pendentes.total) {
    console.log('  [pulado] a base de teste não tem chamado individual sem criticidade');
  } else {
    ok('a tela conta os chamados sem criticidade',
      await pag.evaluate(() => /chamado\(s\) em/.test(el('#pagina').textContent)),
      `${pendentes.total} em ${pendentes.comps} competência(s)`);
    const previa = await pag.evaluate(async () => {
      el('#pagina').querySelector('#cp-previa').click();
      await new Promise((r) => setTimeout(r, 600));
      const caixa = el('#pagina').querySelector('#cp-resultado');
      const antes = (E.sla.get(empresaAtiva()) || []).filter((r) => Number(r.total) === 1 && r.prioridade).length;
      return { texto: caixa.textContent.replace(/\s+/g, ' '),
        naoGravou: /nada foi gravado/i.test(caixa.textContent), comCriticidade: antes };
    });
    // A prévia é o que separa "aplicar" de "susto": o percentual do mês se
    // move, e quem aplica tem de ver quanto antes.
    ok('a prévia diz que nada foi gravado', previa.naoGravou, previa.texto.slice(0, 80));
    ok('e conta quantos seriam classificados', /Seriam classificados/.test(previa.texto));

    await pag.fill('#cp-just', 'Regularização da base histórica — teste');
    const aplicou = await pag.evaluate(async (antes) => {
      el('#pagina').querySelector('#cp-aplicar').click();
      await new Promise((r) => setTimeout(r, 2500));
      const caixa = el('#pagina').querySelector('#cp-resultado');
      const regs = (E.sla.get(empresaAtiva()) || []).filter((r) => Number(r.total) === 1);
      // A trilha é lida do ARMAZENAMENTO: `E.auditoria` só é preenchido pela
      // tela de Auditoria, e conferir por ele passaria verde sem provar nada.
      const doc = await E.db.doc('auditoria/cliente__' + E.clienteSel).get();
      const trilha = (doc.exists ? (doc.data().itens || []) : [])
        .filter((a) => a.acao === 'classificar_padrao');
      return {
        texto: caixa ? caixa.textContent.replace(/\s+/g, ' ') : '',
        // Os dois números que o defeito separava: quantos o resumo diz ter
        // avaliado, e quantos chamados individuais ainda existem na base.
        avaliados: Number(/avaliados(\d+)/.exec(
          caixa ? caixa.textContent.replace(/\s+/g, '') : '')?.[1] || 0),
        individuais: regs.length,
        aplicado: !!caixa && /aplicada/i.test(caixa.textContent),
        comCriticidade: regs.filter((r) => r.prioridade).length,
        antes,
        marcados: regs.filter((r) => r.prioridadeOrigem === 'padrao').length,
        todosMedium: regs.filter((r) => r.prioridadeOrigem === 'padrao')
          .every((r) => r.prioridade === 'medium'),
        restantes: competenciasSemCriticidade(empresaAtiva())
          .reduce((s, [, n]) => s + n, 0),
        trilha: trilha.length,
      };
    }, previa.comCriticidade);
    ok('aplicar classifica os chamados', aplicou.aplicado, aplicou.texto.slice(0, 70));
    // A conferência que pegou o defeito: gravar mês a mês lendo do cache já
    // invalidado apagava os chamados dos meses seguintes, e sobravam 8 de 624.
    ok('todos os avaliados ficam com a criticidade padrão',
      aplicou.marcados === aplicou.avaliados && aplicou.todosMedium,
      `${aplicou.marcados} de ${aplicou.avaliados}`);
    ok('e nenhum chamado se perde na gravação',
      aplicou.individuais === aplicou.avaliados,
      `${aplicou.individuais} na base, ${aplicou.avaliados} avaliados`);
    ok('e nenhum sobra sem criticidade nas competências alcançadas',
      aplicou.restantes === 0, String(aplicou.restantes));
    // Uma linha por CARGA, e não uma por chamado: uma por chamado afogaria a
    // trilha e esconderia justamente o evento que se quer achar.
    ok('a carga deixa uma linha de auditoria', aplicou.trilha >= 1, String(aplicou.trilha));
  }

  console.log('\nA FICHA DO CHAMADO DIZ DE ONDE VEIO E CONTRA O QUE CORRE');
  await irPara(pag, 'Chamados', 2200);
  const naFicha = await pag.evaluate(async () => {
    const bt = document.querySelector('#pagina [data-reclassificar]');
    if (!bt) return null;
    bt.click();
    await new Promise((r) => setTimeout(r, 800));
    const m = document.querySelector('#modais .modal');
    return m ? m.textContent.replace(/\s+/g, ' ') : null;
  });
  if (!naFicha) {
    console.log('  [pulado] a base de teste não tem chamado individual na competência aberta');
  } else {
    ok('a ficha nomeia a origem da criticidade',
      /da origem|padrão do cadastro|à mão|não definida/.test(naFicha), naFicha.slice(0, 90));
    ok('e mostra o prazo ou diz que não há',
      /Prazo/.test(naFicha) || /não tem prazo/.test(naFicha), naFicha.slice(0, 120));
    ok('com a situação contra o prazo',
      /dentro do prazo|fora do prazo|estourado|não tem prazo/.test(naFicha));
  }

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
