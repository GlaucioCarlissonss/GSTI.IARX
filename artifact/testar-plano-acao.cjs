// O PLANO DE AÇÃO — leitura da planilha, farol diário e placar.
//
// A conferência central é esta: com o relógio parado em 19/10/2026, o farol
// que o sistema calcula tem de reproduzir PALAVRA POR PALAVRA o que a
// planilha do cliente imprimiu naquele dia. Se reproduz, a regra é a mesma; se
// diverge, o painel e o documento vão discordar sobre o que é urgente — e o
// gestor vai acreditar no documento.
//
// Por isso a grade de teste traz as DATAS e os STATUS reais da 1ª onda, com
// tarefas, áreas e líderes trocados por nomes inventados: data e status não
// identificam ninguém, e nome de colaborador não entra no repositório.
//
// A segunda conferência é a do que a planilha traz pronto e o sistema RECUSA:
// a coluna "Farol (Prazo)" vem escrita no arquivo, calculada contra o dia em
// que alguém o abriu. Guardá-la faria o painel envelhecer em silêncio — e a
// suíte prova que ela é ignorada passando um farol propositalmente errado.
//
// Uso: CHROMIUM_BIN=/opt/pw-browsers/chromium node artifact/testar-plano-acao.cjs
const { chromium } = require('playwright');
const { congelarRelogio } = require('./ajuda-testes.cjs');

const HOJE = '2026-10-19';

/**
 * A 1ª onda como a planilha a traz: datas e status reais, textos trocados.
 * A última coluna é o farol ESCRITO no arquivo — o que o sistema deve ignorar.
 */
const ONDA1 = [
  // nº, tarefa, área, líder, início, fim, dias, status, farol escrito
  [1, 'Ação alfa', 'Área A', 'Pessoa 1', '05/10/2026', '31/10/2026', 26, 'Em andamento', 'No prazo 12d'],
  [2, 'Ação beta', 'Área B', 'Pessoa 2', '07/10/2026', '13/10/2026', 3, 'Concluído', 'Concluído'],
  [3, 'Ação gama', 'Área C', 'Pessoa 3', '13/10/2026', '14/10/2026', 1, 'Concluído', 'Concluído'],
  [4, 'Ação delta', 'Área D', 'Pessoa 4', '06/10/2026', '21/10/2026', 15, 'Em andamento', 'Vence em 2d'],
  [5, 'Ação épsilon', 'Área B', 'Pessoa 2', '13/10/2026', '14/10/2026', 1, 'Em andamento', 'Atrasado 5d'],
  [6, 'Ação zeta', 'Área E', 'Pessoa 5', '07/10/2026', '14/10/2026', 3, 'Concluído', 'Concluído'],
  [7, 'Ação eta', 'Área B', 'Pessoa 2', '14/09/2026', '15/10/2026', 38, 'Em andamento', 'Atrasado 4d'],
  [8, 'Ação teta', 'Área F', 'Pessoa 6', '05/10/2026', '30/10/2026', 25, 'Não iniciado', 'No prazo 11d'],
  [9, 'Ação iota', 'Área F', 'Pessoa 7', '01/11/2026', '30/11/2026', 29, 'Não iniciado', 'No prazo 42d'],
];

/** O que a planilha imprimiu em 19/10, por nº — a régua. */
const FAROL_DA_PLANILHA = {
  1: 'No prazo 12d', 2: 'Concluído', 3: 'Concluído', 4: 'Vence em 2d', 5: 'Atrasado 5d',
  6: 'Concluído', 7: 'Atrasado 4d', 8: 'No prazo 11d', 9: 'No prazo 42d',
};

/** Monta a grade de uma aba de onda, com as linhas de título antes do cabeçalho. */
function gradeDaOnda(n, goLive, linhas) {
  return [
    ['PLANO DE AÇÃO — IMPLANTAÇÃO SPINCARE'],
    [`Onda ${n} • Go-live: ${goLive} • Unidades: Unidade X - Unidade Y`],
    [`Data da Virada (go-live): ${goLive}`],
    ['Nº', 'Tarefa', 'Área Responsável', 'Líder de Equipe', 'Data Início', 'Data Fim',
      'Qtd Dias', 'Status da Ação', 'Farol (Prazo)', 'Link Sala Remota', 'Observações', 'Evoluções'],
    ...linhas.map((l) => [l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[7], l[8], '', '', '']),
  ];
}

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1000 } });
  const falhas = [];
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await congelarRelogio(pag, `${HOJE}T12:00:00Z`);
  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });

  console.log('\nO RELÓGIO — o farol é contra hoje, e hoje é congelado aqui');
  const hoje = await pag.evaluate(() => planoHojeISO());
  ok('a página enxerga 19/10/2026', hoje === HOJE, hoje);

  // ------------------------------------------------------------- leitura
  console.log('\nLEITURA — a aba da onda vira ações');
  const lido = await pag.evaluate(([grade, n]) => {
    const r = planoLerOndas([{ aba: { nome: `Onda ${n}`, grade }, onda: n, cabecalho: 3 }], 'c1');
    return { total: r.acoes.length, problemas: r.problemas, diag: r.diagnostico,
      primeira: r.acoes[0], ondas: r.ondas };
  }, [gradeDaOnda(1, '1/10/2026', ONDA1), 1]);
  ok('as nove ações da onda foram lidas', lido.total === 9, String(lido.total));
  ok('o cabeçalho é achado pelo conteúdo, não por contagem de linha',
    lido.ondas[0] && lido.ondas[0].lidas === 9, JSON.stringify(lido.ondas[0] || {}));
  ok('a primeira traz tarefa, área, líder e as duas datas',
    lido.primeira && lido.primeira.tarefa === 'Ação alfa' && lido.primeira.area === 'Área A'
      && lido.primeira.lider === 'Pessoa 1' && lido.primeira.inicio === '2026-10-05'
      && lido.primeira.fim === '2026-10-31',
    JSON.stringify(lido.primeira || {}));
  ok('a data dd/mm/aaaa vira ISO, sem trocar dia por mês',
    lido.primeira && lido.primeira.inicio === '2026-10-05', (lido.primeira || {}).inicio);
  // O farol escrito na planilha NÃO pode estar entre os campos gravados.
  ok('o farol escrito na planilha não é guardado',
    lido.primeira && !('farolRotulo' in lido.primeira) && !('farolEscrito' in lido.primeira),
    Object.keys(lido.primeira || {}).join(','));
  ok('e a carga da onda 1 não reclama de nada', lido.problemas.length === 0,
    lido.problemas.join(' | '));

  // -------------------------------------------------------------- farol
  console.log('\nFAROL — tem de reproduzir o que a planilha imprimiu em 19/10');
  const farois = await pag.evaluate(([grade, hojeISO]) => {
    const r = planoLerOndas([{ aba: { nome: 'Onda 1', grade }, onda: 1, cabecalho: 3 }], 'c1');
    const saida = {};
    for (const a of r.acoes) saida[a.n] = planoDerivar(a, hojeISO).farolRotulo;
    return saida;
  }, [gradeDaOnda(1, '1/10/2026', ONDA1), HOJE]);
  for (const [n, esperado] of Object.entries(FAROL_DA_PLANILHA)) {
    ok(`nº ${n}: ${esperado}`, farois[n] === esperado, `${farois[n]}`);
  }

  console.log('\nFAROL — as bordas da régua de 3 dias');
  const bordas = await pag.evaluate((hojeISO) => {
    const f = (fim, status) => planoFarol({ fim, status: status || 'Não iniciado' }, hojeISO).rotulo;
    return {
      ontem: f('2026-10-18'), hoje: f('2026-10-19'), tres: f('2026-10-22'), quatro: f('2026-10-23'),
      // Concluída e cancelada saem ANTES do prazo: entregue na semana passada
      // não é atraso, é coisa pronta.
      concluidaVencida: f('2026-10-01', 'Concluído'),
      canceladaVencida: f('2026-10-01', 'Cancelado'),
      semData: f(''),
    };
  }, HOJE);
  ok('vencida ontem é "Atrasado 1d"', bordas.ontem === 'Atrasado 1d', bordas.ontem);
  ok('vencendo hoje é "Vence em 0d", e não atraso', bordas.hoje === 'Vence em 0d', bordas.hoje);
  ok('três dias ainda é amarelo', bordas.tres === 'Vence em 3d', bordas.tres);
  ok('quatro dias já é verde', bordas.quatro === 'No prazo 4d', bordas.quatro);
  ok('concluída com prazo vencido NÃO é atraso',
    bordas.concluidaVencida === 'Concluído', bordas.concluidaVencida);
  ok('cancelada com prazo vencido NÃO é atraso',
    bordas.canceladaVencida === 'Cancelado', bordas.canceladaVencida);
  ok('sem data de fim não inventa prazo', bordas.semData === 'Sem data', bordas.semData);

  // ------------------------------------------------------------- placar
  console.log('\nPLACAR — os mesmos números do DASHBOARD da planilha');
  const placar = await pag.evaluate(([grade, hojeISO]) => {
    const r = planoLerOndas([{ aba: { nome: 'Onda 1', grade }, onda: 1, cabecalho: 3 }], 'c1');
    return planoPlacar(r.acoes.map((a) => planoDerivar(a, hojeISO)));
  }, [gradeDaOnda(1, '1/10/2026', ONDA1), HOJE]);
  // A linha "Onda 1" do dashboard do cliente: 2 não iniciado, 2 em andamento,
  // 2 atrasado, 3 concluído, 0 cancelado — e 33% concluído.
  ok('não iniciadas: 2', placar.naoIniciadas === 2, String(placar.naoIniciadas));
  ok('em andamento: 2', placar.emAndamento === 2, String(placar.emAndamento));
  ok('atrasadas: 2', placar.atrasadas === 2, String(placar.atrasadas));
  ok('concluídas: 3', placar.concluidas === 3, String(placar.concluidas));
  ok('canceladas: 0', placar.canceladas === 0, String(placar.canceladas));
  ok('as cinco situações somam o total, sem contar ninguém duas vezes',
    placar.naoIniciadas + placar.emAndamento + placar.atrasadas + placar.concluidas
      + placar.canceladas === placar.total, `${placar.total}`);
  ok('33% concluído, como no dashboard do cliente',
    Math.round(placar.pctConcluido) === 33, `${placar.pctConcluido}%`);

  // A cancelada sai do DENOMINADOR: ela foi tirada do plano, e mantê-la
  // embaixo da divisão faria o percentual nunca poder chegar a 100%.
  const comCancelada = await pag.evaluate((hojeISO) => {
    const acoes = [
      { n: 1, onda: 2, status: 'Concluído', fim: '2026-10-01' },
      { n: 2, onda: 2, status: 'Cancelado', fim: '2026-10-01' },
    ].map((a) => planoDerivar(a, hojeISO));
    return planoPlacar(acoes);
  }, HOJE);
  ok('uma concluída e uma cancelada dão 100%, e não 50%',
    comCancelada.pctConcluido === 100, `${comCancelada.pctConcluido}%`);

  // ------------------------------------------------------- diagnóstico
  console.log('\nDIAGNÓSTICO — o vazio é contado, nunca preenchido com palpite');
  const sujo = await pag.evaluate(([grade]) => {
    const r = planoLerOndas([{ aba: { nome: 'Onda 2', grade }, onda: 2, cabecalho: 3 }], 'c1');
    return { problemas: r.problemas, diag: r.diagnostico, total: r.acoes.length,
      statusDoDesconhecido: (r.acoes.find((a) => a.n === 3) || {}).status };
  }, [gradeDaOnda(2, '3/11/2026', [
    [1, 'Sem fim', 'Área A', '-', '05/10/2026', '', 0, 'Em andamento', ''],
    [2, 'Fim antes do início', 'Área A', 'Pessoa 1', '20/10/2026', '10/10/2026', 0, 'Não iniciado', ''],
    [3, 'Status estranho', '-', 'Pessoa 1', '05/10/2026', '30/11/2026', 1, 'Meio feito', ''],
    [3, 'Número repetido', 'Área A', 'Pessoa 1', '05/10/2026', '30/11/2026', 1, 'Não iniciado', ''],
    [5, '', 'Área A', 'Pessoa 1', '05/10/2026', '30/11/2026', 1, 'Não iniciado', ''],
  ])]);
  ok('a linha sem tarefa é recusada e dita', /nº 5.*sem descrição/i.test(sujo.problemas.join(' ')),
    sujo.problemas.join(' | ').slice(0, 90));
  ok('o número repetido é recusado, e a primeira fica',
    sujo.total === 3 && /repetido/i.test(sujo.problemas.join(' ')), `${sujo.total} lida(s)`);
  ok('a ação sem data de fim entra, mas é contada no diagnóstico',
    sujo.diag.semFim === 1 && /sem data de fim/i.test(sujo.problemas.join(' ')),
    `semFim=${sujo.diag.semFim}`);
  ok('fim antes do início é apontado', /vem antes/i.test(sujo.problemas.join(' ')));
  ok('status desconhecido não é inventado: vira não iniciada, e é dito',
    sujo.statusDoDesconhecido === 'Não iniciado'
      && /não é um dos conhecidos/i.test(sujo.problemas.join(' ')),
    String(sujo.statusDoDesconhecido));
  ok('"-" conta como ausência, igual ao branco',
    sujo.diag.semArea === 1 && sujo.diag.semLider === 1,
    `semArea=${sujo.diag.semArea} semLider=${sujo.diag.semLider}`);

  console.log('\nCRONOGRAMA — a planilha é conferida contra ele, não o sobrescreve');
  const divergente = await pag.evaluate(([grade]) => planoLerOndas(
    [{ aba: { nome: 'Onda 1', grade }, onda: 1, cabecalho: 3 }], 'c1').problemas,
  [gradeDaOnda(1, '15/10/2026', [
    [1, 'Ação', 'Área A', 'Pessoa 1', '05/10/2026', '31/10/2026', 26, 'Em andamento', ''],
  ])]);
  ok('go-live divergente do cronograma vira aviso, e o cronograma prevalece',
    divergente.some((p) => /go-live/i.test(p) && /Vale o cronograma/i.test(p)),
    divergente.join(' | ').slice(0, 120));

  console.log(`\n=== erros de console: ${erros.length ? erros.join(' | ') : 'nenhum'} ===`);
  console.log(`=== ✗=${falhas.length} ===`);
  if (falhas.length) falhas.forEach((f) => console.log('  ✗ ' + f));
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
