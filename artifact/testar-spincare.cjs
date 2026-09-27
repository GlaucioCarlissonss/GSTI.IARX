// O CONTROLE ÚNICO DO PROJETO SPINCARE — Entregável 1: modelo e carga.
//
// A suíte sobe a planilha DE VERDADE pela tela e confere o que entrou contra
// os números que a própria planilha calcula. Três conferências decidem a
// entrega: nenhuma atividade se perde (nem a que repete o ID), os derivados
// batem com as fórmulas da origem, e o que falta é contado em vez de
// preenchido com palpite.
//
// O arquivo é dado do cliente e NÃO está no repositório: a suíte usa a cópia
// que o ambiente tenha em SPINCARE_XLSX e, sem ela, confere só o que não
// depende do arquivo, dizendo o que pulou.
const { chromium } = require('playwright');
const fs = require('fs');
const { irPara } = require('./ajuda-testes.cjs');

const ARQ = process.env.SPINCARE_XLSX || '';

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

  console.log('\nOS DERIVADOS — regras da planilha, calculadas aqui');
  // Estas não dependem do arquivo: são as fórmulas da planilha, exercitadas
  // com atividades montadas à mão. Guardar o derivado deixaria o número
  // gravado divergir da regra que diz produzi-lo.
  const regras = await pag.evaluate(() => {
    const base = { criticidade: 'GO-LIVE', tipoEntrega: 'Cadastro', dataBaseOnda: '2026-10-01' };
    const com = (unidades, extra) => spinDerivar({ ...base, ...extra, unidades }, '2026-09-24');
    return {
      // O consolidado é o PIOR status, não o mais frequente.
      pior: com({ hr_pb: 'Concluído', hm_pb: 'Concluído', hr_cg: 'Não iniciado' }).statusConsolidado,
      bloqueioGanha: com({ hr_pb: 'Bloqueado', hm_pb: 'Concluído' }).statusConsolidado,
      todas: com({ hr_pb: 'Concluído', hm_pb: 'Concluído' }).statusConsolidado,
      // Avanço: 1 / 0,5 / 0,25 / 0.
      avConcluido: com({ hr_pb: 'Concluído' }).avanco,
      avAndamento: com({ hr_pb: 'Em andamento' }).avanco,
      avBloqueado: com({ hr_pb: 'Bloqueado' }).avanco,
      avNaoIniciado: com({ hr_pb: 'Não iniciado' }).avanco,
      // Fora do universo válido: cancelada e criticidade N/A.
      avCancelado: com({ hr_pb: 'Cancelado' }).avanco,
      avNA: com({ hr_pb: 'Concluído' }, { criticidade: 'N/A' }).avanco,
      // Peso por criticidade, e o ponderado como produto.
      pesos: ['GO-LIVE', 'ESTABILIZAÇÃO', 'EVOLUÇÃO'].map((c) =>
        com({ hr_pb: 'Concluído' }, { criticidade: c }).peso),
      ponderado: com({ hr_pb: 'Em andamento' }).avancoPonderado,
      // Farol: concluído verde; vencido em aberto vermelho; bloqueado vermelho.
      farolVerde: com({ hr_pb: 'Concluído' }).farol,
      farolVermelhoBloqueio: com({ hr_pb: 'Bloqueado' }).farol,
      // GO-LIVE desloca -10 dias da data-base: 01/10 − 10 = 21/09, vencido em 24/09.
      farolVencido: com({ hr_pb: 'Em andamento' }).farol,
      dias: com({ hr_pb: 'Em andamento' }).diasParaPrazo,
      // O critério de aceite é derivado do tipo, e o específico o substitui.
      criterioPadrao: com({ hr_pb: 'Concluído' }).criterioAceite.slice(0, 40),
      criterioEsp: com({ hr_pb: 'Concluído' }, { criterioEspecifico: 'Combinado à parte' }).criterioAceite,
    };
  });
  ok('o consolidado é o PIOR status', regras.pior === 'Não iniciado', regras.pior);
  ok('e bloqueado ganha de todos', regras.bloqueioGanha === 'Bloqueado', regras.bloqueioGanha);
  ok('concluído só quando é em todas', regras.todas === 'Concluído', regras.todas);
  ok('avanço 1 / 0,5 / 0,25 / 0',
    regras.avConcluido === 1 && regras.avAndamento === 0.5
    && regras.avBloqueado === 0.25 && regras.avNaoIniciado === 0,
    [regras.avConcluido, regras.avAndamento, regras.avBloqueado, regras.avNaoIniciado].join(' · '));
  // Sem isso, as 7 linhas de criticidade N/A entrariam no denominador e o
  // painel deixaria de bater com a planilha.
  ok('cancelada e N/A ficam fora do universo válido',
    regras.avCancelado === null && regras.avNA === null,
    `${regras.avCancelado} · ${regras.avNA}`);
  ok('peso 3 / 2 / 1 por criticidade',
    JSON.stringify(regras.pesos) === JSON.stringify([3, 2, 1]), JSON.stringify(regras.pesos));
  ok('o ponderado é peso × avanço', regras.ponderado === 1.5, String(regras.ponderado));
  ok('farol verde no concluído', regras.farolVerde === 'VERDE', regras.farolVerde);
  ok('vermelho no bloqueado', regras.farolVermelhoBloqueio === 'VERMELHO', regras.farolVermelhoBloqueio);
  ok('e vermelho no prazo vencido em aberto',
    regras.farolVencido === 'VERMELHO' && regras.dias < 0, `${regras.farolVencido} · ${regras.dias} dia(s)`);
  ok('o critério de aceite vem do tipo de entrega',
    /^Registros cadastrados/.test(regras.criterioPadrao), regras.criterioPadrao);
  ok('e o específico substitui o padrão', regras.criterioEsp === 'Combinado à parte', regras.criterioEsp);

  console.log('\nNORMALIZAÇÃO DE NOMES');
  const nomes = await pag.evaluate(() => ({
    variante: spinExecutantes('Dayvison'),
    canonico: spinExecutantes('Dayvson Rocha'),
    // A célula pode trazer duas pessoas, separadas por quebra de linha.
    duas: spinExecutantes('Gabriel Cavalcanti\nDanilo Batista'),
    // "-" é "ninguém" escrito de propósito, e conta junto com o branco.
    traco: spinExecutantes('-'),
    vazio: spinExecutantes(''),
  }));
  ok('a variante cai na grafia do cadastro',
    JSON.stringify(nomes.variante) === JSON.stringify(['Dayvson Rocha']), JSON.stringify(nomes.variante));
  ok('duas pessoas na mesma célula viram duas',
    nomes.duas.length === 2, JSON.stringify(nomes.duas));
  ok('"-" e vazio são ausência de responsável',
    nomes.traco.length === 0 && nomes.vazio.length === 0);

  console.log('\nDATAS DA PLANILHA');
  const datas = await pag.evaluate(() => ({
    // O Excel guarda data como número de dias desde 30/12/1899.
    serial: spinData('46296'), iso: spinData('2026-10-01'), br: spinData('01/10/2026'),
    lixo: spinData('Concluído'), vazio: spinData(''),
  }));
  ok('o serial do Excel vira ISO', datas.serial === '2026-10-01', datas.serial);
  ok('ISO e DD/MM/AAAA também', datas.iso === '2026-10-01' && datas.br === '2026-10-01');
  // Texto que não é data NÃO pode virar uma data inventada.
  ok('e o que não é data volta vazio', datas.lixo === '' && datas.vazio === '',
    `"${datas.lixo}" · "${datas.vazio}"`);

  if (!ARQ || !fs.existsSync(ARQ)) {
    console.log('\n[pulado] A carga da planilha real exige SPINCARE_XLSX apontando para o arquivo '
      + 'do cliente, que não está no repositório.');
  } else {
    console.log('\nA CARGA DA PLANILHA REAL');
    await irPara(pag, 'Projeto SpinCare', 1500);
    await pag.setInputFiles('#spin-arq', ARQ);
    await pag.click('#spin-carregar');
    await pag.waitForSelector('#spin-resultado .msg.ok, #spin-resultado .msg.erro', { timeout: 30000 });
    await pag.waitForTimeout(2500);

    const r = await pag.evaluate(() => {
      const at = spinAtividades();
      const d = spinDiagnostico(E.spincare.filter((a) => a.cliente === E.clienteSel));
      return { n: at.length, d, chaves: at.map((a) => a.chave),
        ids11: at.filter((a) => a.id === 'PRE-11').map((a) => a.atividade),
        semOutroCliente: E.spincare.every((a) => a.cliente === E.clienteSel) };
    });
    // 172 é o número de linhas com ID na planilha. Uma a menos significa que
    // alguma foi engolida em silêncio — foi o que aconteceu antes de a
    // identidade deixar de ser só o ID.
    ok('as 172 atividades entram', r.n === 172, String(r.n));
    // PRE-11 nomeia DUAS atividades distintas na planilha. Recusar a segunda
    // perderia uma atividade de verdade; tratá-las como uma perderia a outra.
    ok('o ID repetido vira duas atividades', r.ids11.length === 2, JSON.stringify(r.ids11));
    ok('com chaves internas distintas',
      new Set(r.chaves).size === r.n, `${new Set(r.chaves).size} chaves para ${r.n} atividades`);

    // Os números que a planilha calcula, recalculados aqui.
    ok('165 atividades válidas', r.d.validas === 165, String(r.d.validas));
    ok('127 concluídas, 16 em andamento, 22 não iniciadas',
      r.d.concluidas === 127 && r.d.emAndamento === 16 && r.d.naoIniciadas === 22,
      `${r.d.concluidas} / ${r.d.emAndamento} / ${r.d.naoIniciadas}`);
    // A conferência que o status report do cliente não passa: as partes somam
    // o todo porque numerador e denominador saem do mesmo universo.
    ok('as partes somam as válidas',
      r.d.concluidas + r.d.emAndamento + r.d.naoIniciadas + r.d.bloqueadas === r.d.validas,
      `${r.d.concluidas}+${r.d.emAndamento}+${r.d.naoIniciadas}+${r.d.bloqueadas} = ${r.d.validas}`);
    ok('as 7 de criticidade N/A são o que tira 172 de 165',
      r.d.criticidadeNA === r.d.total - r.d.validas, `${r.d.criticidadeNA} N/A`);

    // Nada é inventado: o vazio é contado, não preenchido.
    ok('o diagnóstico conta quem está sem responsável', r.d.semExecutante === 19,
      `${r.d.semExecutante} (17 em branco + 2 com "-")`);
    ok('e quem está sem caminho no sistema', r.d.semCaminho === 18, String(r.d.semCaminho));
    ok('as seis unidades com coluna foram reconhecidas',
      r.d.unidadesComColuna.length === 6, r.d.unidadesComColuna.join(', '));
    ok('e as das ondas 3 a 5 são nomeadas como sem coluna',
      r.d.unidadesSemColuna.length === 11, `${r.d.unidadesSemColuna.length} unidade(s)`);
    ok('a base carregada é do cliente em foco', r.semOutroCliente);

    // Recarregar o mesmo arquivo não duplica: a carga SUBSTITUI a base do
    // cliente, e um segundo clique não pode virar 344 atividades.
    await pag.setInputFiles('#spin-arq', ARQ);
    await pag.click('#spin-carregar');
    await pag.waitForTimeout(4000);
    const dobro = await pag.evaluate(() => spinAtividades().length);
    ok('recarregar o mesmo arquivo não duplica', dobro === 172, String(dobro));
  }

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
