// O CRONOGRAMA DE ONDAS — a composição, as datas e a virada declarada.
//
// Esta suíte existe porque o cronograma é o número que vai à diretoria, e ele
// JÁ ESTEVE ERRADO: o sistema carregava a ordem antiga, em que a Paraíba
// virava em 01/10. O plano de ação que o cliente passou a usar inverteu as
// duas primeiras ondas — quem virou em 01/10 foram Porto Velho e Rio de
// Janeiro —, moveu São Paulo de outubro para janeiro e juntou cinco ondas em
// quatro. Nada disso aparece como erro na tela: o cronograma continua
// desenhando bonito, só que afirmando a coisa errada. Daí a conferência.
//
// A segunda metade protege a correção que veio junto: a Visão Macro pergunta
// "a unidade VIROU?", e isso não é a mesma pergunta que "as atividades dela
// acabaram". Uma unidade pode entrar em produção com pendências — Porto Velho
// e Rio são exatamente esse caso — e deduzir a virada da ausência de
// pendência faria a tela negar um fato informado pela gestão.
//
// Uso: CHROMIUM_BIN=/opt/pw-browsers/chromium node artifact/testar-cronograma-ondas.cjs
const { chromium } = require('playwright');

/** O cronograma que o PLANO DE AÇÃO publica — a régua desta conferência. */
const ESPERADO = [
  { n: 1, virada: '2026-10-01', unidades: ['MHC Porto Velho/RO', 'UC Rio de Janeiro/RJ'],
    realizada: '2026-10-01' },
  { n: 2, virada: '2026-11-03',
    unidades: ['HR João Pessoa/PB', 'HR Campina Grande/PB', 'MHC João Pessoa/PB'],
    realizada: null },
  { n: 3, virada: '2026-12-01',
    unidades: ['MHC Brasília/DF', 'MHC Goiânia/GO', 'MHC Cuiabá/MT', 'AHC Natal/RN',
      'HR Natal/RN', 'MHC Fortaleza/CE', 'AHC Aracaju/SE', 'HR Salvador/BA'],
    realizada: null },
  { n: 4, virada: '2027-01-04',
    unidades: ['HR Recife/PE', 'HR Maceió/AL', 'MHC Manaus/AM', 'UC São Paulo/SP'],
    realizada: null },
];

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

  const crono = await pag.evaluate(() => SPIN_ONDAS.map((o) => ({
    n: o.n, virada: o.virada, mes: o.mes, periodo: o.periodo,
    unidades: o.unidades, chaves: o.chaves, pacientes: o.pacientes,
    realizada: o.viradaRealizada || null,
  })));

  console.log('\nCOMPOSIÇÃO — o plano de ação é a régua');
  ok('são quatro ondas, e não cinco', crono.length === 4, `${crono.length} onda(s)`);
  for (const e of ESPERADO) {
    const o = crono.find((x) => x.n === e.n);
    if (!o) { ok(`a ${e.n}ª onda existe`, false); continue; }
    ok(`${e.n}ª onda: as unidades certas`,
      JSON.stringify(o.unidades) === JSON.stringify(e.unidades),
      o.unidades.join(' · '));
    ok(`${e.n}ª onda: vira em ${e.virada}`, o.virada === e.virada, o.virada);
  }

  // A inversão é o coração do erro antigo, e merece ser dita por extenso.
  console.log('\nA INVERSÃO — quem virou em 01/10 foram RO e RJ, não a Paraíba');
  const primeira = crono[0] || { unidades: [] };
  ok('a 1ª onda é Porto Velho + Rio de Janeiro',
    primeira.unidades.some((u) => /Porto Velho/i.test(u))
    && primeira.unidades.some((u) => /Rio de Janeiro/i.test(u)),
    primeira.unidades.join(' · '));
  ok('a Paraíba NÃO está na 1ª onda',
    !primeira.unidades.some((u) => /PB$/.test(u)), primeira.unidades.join(' · '));
  const paraiba = crono.find((o) => o.unidades.some((u) => /PB$/.test(u)));
  ok('a Paraíba está na 2ª, virando em 03/11',
    !!paraiba && paraiba.n === 2 && paraiba.virada === '2026-11-03',
    paraiba ? `${paraiba.n}ª em ${paraiba.virada}` : 'não encontrada');
  const sp = crono.find((o) => o.unidades.some((u) => /São Paulo/i.test(u)));
  ok('São Paulo saiu de outubro e foi para a 4ª',
    !!sp && sp.n === 4, sp ? `${sp.n}ª onda` : 'não encontrada');

  // As chaves são colunas do Controle Único, e acompanham a UNIDADE: movê-la
  // de onda não pode deixar a coluna para trás, nem levá-la para a errada.
  console.log('\nCHAVES DO CONTROLE ÚNICO — acompanham a unidade, não a onda');
  const chaveDe = (nome) => {
    for (const o of crono) {
      const i = o.unidades.indexOf(nome);
      if (i >= 0) return (o.chaves || [])[i] || '';
    }
    return null;
  };
  for (const [unidade, chave] of [
    ['MHC Porto Velho/RO', 'hm_ro'], ['UC Rio de Janeiro/RJ', 'uc_rj'],
    ['HR João Pessoa/PB', 'hr_pb'], ['HR Campina Grande/PB', 'hr_cg'],
    ['MHC João Pessoa/PB', 'hm_pb'], ['UC São Paulo/SP', 'uc_sp'],
  ]) {
    ok(`${unidade} → coluna ${chave}`, chaveDe(unidade) === chave, String(chaveDe(unidade)));
  }
  const todas = crono.flatMap((o) => o.chaves || []).filter(Boolean);
  ok('nenhuma coluna aparece em duas ondas', new Set(todas).size === todas.length,
    todas.join(','));
  ok('as 17 unidades continuam no cronograma',
    crono.reduce((s, o) => s + o.unidades.length, 0) === 17,
    String(crono.reduce((s, o) => s + o.unidades.length, 0)));

  console.log('\nPACIENTES — o total vale; a divisão por onda, não');
  ok('nenhuma onda finge saber quantos pacientes tem',
    crono.every((o) => o.pacientes === null),
    crono.map((o) => String(o.pacientes)).join(','));
  const total = await pag.evaluate(() => SPIN_PACIENTES_TOTAL);
  ok('o total segue sendo 1.922 — são as mesmas unidades, reagrupadas',
    total === 1922, String(total));

  // A VIRADA DECLARADA. É o que separa a Macro da Micro: a unidade virou
  // porque a gestão informou, não porque a planilha ficou sem pendência.
  console.log('\nVIRADA DECLARADA — fato informado vence dedução por pendência');
  ok('a 1ª onda traz a data realizada de 01/10',
    (crono[0] || {}).realizada === '2026-10-01', String((crono[0] || {}).realizada));
  ok('as demais não declaram virada nenhuma',
    crono.slice(1).every((o) => o.realizada === null),
    crono.slice(1).map((o) => String(o.realizada)).join(','));

  const macro = await pag.evaluate(() => {
    const c = calcularCronograma('2026-10');
    return c.ondas.map((o) => ({
      n: o.n, estado: o.estado, aderencia: o.aderencia,
      unidades: o.unidades.map((u) => ({
        nome: u.nome, estado: u.estado, virou: u.virou,
        declarada: !!u.viradaDeclarada, realizada: u.dataRealizada,
      })),
    }));
  });
  const o1 = macro.find((o) => o.n === 1) || { unidades: [] };
  ok('a 1ª onda consta CUMPRIDA mesmo sem a planilha fechar',
    o1.estado === 'CUMPRIDO', o1.estado);
  ok('e as duas unidades dela também',
    o1.unidades.length === 2 && o1.unidades.every((u) => u.estado === 'CUMPRIDO' && u.virou),
    o1.unidades.map((u) => `${u.nome}=${u.estado}`).join(' · '));
  ok('com a data realizada declarada, e não a planejada por dedução',
    o1.unidades.every((u) => u.declarada && u.realizada === '2026-10-01'),
    o1.unidades.map((u) => String(u.realizada)).join(' · '));
  ok('a aderência da 1ª onda é 100%', o1.aderencia === 100, String(o1.aderencia));
  // Sem declaração, nada vira sozinho: a onda 2 não pode herdar o CUMPRIDO.
  const o2 = macro.find((o) => o.n === 2) || {};
  ok('a 2ª onda NÃO é dada como virada', o2.estado !== 'CUMPRIDO', String(o2.estado));

  console.log(`\n=== erros de console: ${erros.length ? erros.join(' | ') : 'nenhum'} ===`);
  console.log(`=== ✗=${falhas.length} ===`);
  if (falhas.length) falhas.forEach((f) => console.log('  ✗ ' + f));
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
