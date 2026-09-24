// Indicadores Gerais: três blocos com filtros próprios, o switch de
// reconhecimento recalculando o bloco inteiro, e o termômetro contra a meta.
//
// A tela existe porque a leitura estratégica não cabia na de Integrações, que é
// operação. Cada conferência aqui é uma promessa que ela faz ao gestor.
const { chromium } = require('playwright');
const { irPara, usarEmpresas } = require('./ajuda-testes.cjs');

(async () => {
  const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN });
  const pag = await nav.newPage({ viewport: { width: 1500, height: 1100 } });
  const erros = [];
  pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  pag.on('console', (m) => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) erros.push(m.text()); });
  const falhas = [];
  const ok = (r, b, d = '') => { console.log(`  ${b ? '✓' : '✗'} ${r}${d ? ': ' + d : ''}`); if (!b) falhas.push(r); };

  await pag.goto('file://' + __dirname + '/teste-local.html');
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  await irPara(pag, 'Indicadores Gerais', 1500);

  console.log('\n--- indicadores empilhados, um por linha ---');
  const estrutura = await pag.evaluate(() => {
    // O título agora mora dentro do botão que dobra o bloco, e traz a seta
    // junto — a mesma limpeza que `testar-relatorio.cjs` faz nos grupos.
    const limpar = (t) => t.trim().replace(/^[−+]\s*/, '');
    const blocos = [...document.querySelectorAll('#pagina > .bloco > header h2')].map((h) => limpar(h.textContent));
    // Nenhum indicador pode dividir a linha com outro: o teste é geométrico,
    // e não de classe CSS — é o que o enunciado proíbe, em pixels.
    const caixas = [...document.querySelectorAll('#pagina > .bloco-indicador')]
      .map((b) => b.getBoundingClientRect());
    const ladoALado = caixas.some((a, i) =>
      caixas.slice(i + 1).some((b) => a.top < b.bottom - 1 && b.top < a.bottom - 1));
    // A área ÚTIL da página, sem o respiro lateral dela: é contra isso que
    // "100% da largura" se mede — comparar com a caixa externa acusaria o
    // padding do contêiner como se fosse um indicador encolhido.
    const area = document.querySelector('#pagina');
    const respiro = getComputedStyle(area);
    const util = area.getBoundingClientRect().width
      - parseFloat(respiro.paddingLeft) - parseFloat(respiro.paddingRight);
    return {
      blocos,
      indicadores: [...document.querySelectorAll('[data-kpi]')].map((k) => k.dataset.kpi),
      ladoALado,
      // "100% da largura" na prática: o bloco ocupa a área útil da página.
      larguraCheia: caixas.every((c) => c.width >= util - 2),
      termometro: !!document.querySelector('#i-termometro svg'),
      serie: !!document.querySelector('#i-reducao svg'),
    };
  });
  ok('o plano de redução vem no topo', estrutura.indicadores[0] === 'plano-reducao', estrutura.indicadores[0]);
  ok('e o rateio logo abaixo dele', estrutura.indicadores[1] === 'rateio', estrutura.indicadores[1]);
  ok('nenhum indicador divide a linha com outro', !estrutura.ladoALado);
  ok('cada um ocupa a largura inteira', estrutura.larguraCheia);
  // Nove desde que "Custo recorrente mês a mês" deixou de ser uma seção solta e
  // virou o Farol 3, com cartão, número e drill-down como os demais.
  ok('os nove indicadores estão na tela', estrutura.indicadores.length === 9,
    estrutura.indicadores.join(' · '));
  ok('os três blocos de negócio continuam nomeados',
    ['Financeiro', 'SLA', 'Projetos'].every((n) => estrutura.blocos.includes(n)),
    estrutura.blocos.join(' · '));
  ok('a série do custo recorrente é desenhada', estrutura.serie);
  ok('e o termômetro do SLA também', estrutura.termometro);

  console.log('\n--- o termômetro marca a meta, e a cor não anda sozinha ---');
  const term = await pag.evaluate(() => {
    const svg = document.querySelector('#i-termometro svg');
    const textos = [...svg.querySelectorAll('text')].map((t) => t.textContent);
    return { rotulo: svg.getAttribute('aria-label'), textos, traco: svg.querySelectorAll('line').length };
  });
  ok('a meta vem rotulada sobre o traço', term.textos.some((t) => /meta 80%/.test(t)), term.textos.join(' · '));
  ok('o traço da meta existe', term.traco >= 1);
  ok('e o leitor de tela recebe o número', /\d+% contra a meta de 80%/.test(term.rotulo || ''), term.rotulo);

  console.log('\n--- o bloco financeiro abre no período padrão ---');
  // O padrão é a janela de leitura da diretoria: da primeira competência da
  // base até o último mês FECHADO. O mês corrente fica de fora de propósito —
  // ele está pela metade, e lê-lo junto com os fechados faz a série terminar
  // num degrau para baixo que é mês incompleto, não queda de custo.
  const mesAnterior = (() => {
    const d = new Date();
    const i = d.getFullYear() * 12 + d.getMonth() - 1;
    return String(Math.floor(i / 12)) + '-' + String((i % 12) + 1).padStart(2, '0');
  })();
  const padrao = await pag.evaluate(() => ({
    de: E.filtrosInd.financeiro.de,
    ate: E.filtrosInd.financeiro.ate,
    slaDe: E.filtrosInd.sla.de,
    slaAte: E.filtrosInd.sla.ate,
  }));
  ok('DE nasce no mês mais antigo da base', padrao.de === '2026-01', padrao.de);
  ok('ATÉ nasce no mês anterior ao corrente', padrao.ate === mesAnterior, `${padrao.ate} (esperado ${mesAnterior})`);
  ok('e só o bloco financeiro tem período padrão',
    padrao.slaDe === '' && padrao.slaAte === '', `sla: "${padrao.slaDe}".."${padrao.slaAte}"`);

  console.log('\n--- os filtros são do bloco, e não do sistema ---');
  const antesGlobal = await pag.evaluate(() => [...E.competencias].join(','));
  await pag.fill('#i-financeiro-de', '03/2026');
  await pag.dispatchEvent('#i-financeiro-de', 'change');
  await pag.waitForTimeout(900);
  const depois = await pag.evaluate(() => ({
    global: [...E.competencias].join(','),
    doBloco: E.filtrosInd.financeiro.de,
    slaIntacto: E.filtrosInd.sla.de,
  }));
  ok('o recorte fica no bloco', depois.doBloco === '2026-03', depois.doBloco);
  ok('o filtro global do sistema não é tocado', depois.global === antesGlobal, `${antesGlobal} → ${depois.global}`);
  ok('e o bloco vizinho tampouco', depois.slaIntacto === '', `"${depois.slaIntacto}"`);

  // O botão do bloco financeiro VOLTA AO PADRÃO — não esvazia. Esvaziar
  // traria de volta as competências futuras que o padrão existe para excluir.
  await pag.click('[data-limpar="financeiro"]');
  await pag.waitForTimeout(900);
  const restaurado = await pag.evaluate(() => ({
    de: E.filtrosInd.financeiro.de, ate: E.filtrosInd.financeiro.ate,
  }));
  ok('restaurar devolve a janela padrão, e não o vazio',
    restaurado.de === '2026-01' && restaurado.ate === mesAnterior,
    `${restaurado.de}..${restaurado.ate}`);

  // Memória de sessão: recarregar esquece a escolha. Um filtro de leitura que
  // sobrevive ao F5 faria o gestor voltar dias depois a um recorte que não
  // escolheu — ele volta ao PADRÃO, que é escolha do sistema e é declarada.
  await pag.fill('#i-financeiro-de', '05/2026');
  await pag.dispatchEvent('#i-financeiro-de', 'change');
  await pag.waitForTimeout(600);
  await pag.reload();
  await pag.waitForSelector('#modulos button', { timeout: 20000 });
  await irPara(pag, 'Indicadores Gerais', 1200);
  const aposRecarregar = await pag.evaluate(() => E.filtrosInd.financeiro.de);
  ok('recarregar devolve o bloco ao período padrão', aposRecarregar === '2026-01', `"${aposRecarregar}"`);

  console.log('\n--- o switch de reconhecimento recalcula o bloco inteiro ---');
  const comTudo = await pag.evaluate(() => ({
    nota: document.querySelector('#pagina > .bloco > header .nota').textContent.trim(),
    serie: [...document.querySelectorAll('#i-reducao svg circle')].length,
    kpi: document.querySelector('[data-kpi="custo-recorrente"] .n').textContent.trim(),
  }));
  await pag.selectOption('#i-rec', 'rec');
  await pag.waitForTimeout(1200);
  const soReconhecidas = await pag.evaluate(() => ({
    nota: document.querySelector('#pagina > .bloco > header .nota').textContent.trim(),
    serie: [...document.querySelectorAll('#i-reducao svg circle')].length,
    kpi: document.querySelector('[data-kpi="custo-recorrente"] .n').textContent.trim(),
    aviso: document.querySelector('#pagina').textContent.includes('Exibindo apenas despesas reconhecidas'),
    vazio: !!document.querySelector('#i-reducao .vazio'),
  }));
  ok('o cabeçalho do bloco diz o que está sendo exibido',
    /apenas despesas reconhecidas/.test(soReconhecidas.nota), soReconhecidas.nota);
  ok('o gráfico avisa no rodapé', soReconhecidas.aviso);
  // A base de teste não tem nada reconhecido: a série tem de esvaziar, e é essa
  // a prova de que o gráfico recalculou junto com o indicador.
  ok('a série recalcula junto com o indicador',
    soReconhecidas.serie !== comTudo.serie || soReconhecidas.vazio,
    `${comTudo.serie} pontos → ${soReconhecidas.vazio ? 'vazio' : soReconhecidas.serie + ' pontos'}`);
  await pag.selectOption('#i-rec', 'tudo');
  await pag.waitForTimeout(900);

  console.log('\n--- por reconhecer se agrupa por centro de custo ---');
  const centros = await pag.evaluate(() => {
    const linhas = [...document.querySelectorAll('tr[data-centro]')];
    // O rateio também tem rodapé: o total conferido é o da tabela de
    // centros de custo, que é a que tem as linhas `data-centro`.
    const tabela = linhas.length ? linhas[0].closest('table') : null;
    const total = tabela ? tabela.querySelector('tfoot td:last-child') : null;
    return {
      quantos: linhas.length,
      ordenado: linhas.map((l) => Number(l.querySelector('td:last-child').textContent.replace(/[^\d,]/g, '').replace(',', '.'))),
      total: total ? total.textContent.trim() : '',
      kpi: document.querySelector('[data-kpi="por-reconhecer"] .n').textContent.trim(),
    };
  });
  ok('há centro de custo na tabela', centros.quantos > 0, `${centros.quantos}`);
  ok('do maior valor para o menor',
    centros.ordenado.every((v, i) => i === 0 || centros.ordenado[i - 1] >= v), centros.ordenado.slice(0, 4).join(' ≥ '));
  ok('o total da tabela bate com o indicador', centros.total === centros.kpi, `${centros.total} vs ${centros.kpi}`);

  console.log('\n--- o detalhamento abre e reconhece em lote ---');
  const antesPendentes = await pag.evaluate(() =>
    document.querySelector('[data-kpi="por-reconhecer"] .n').textContent.trim());
  await pag.evaluate(() => document.querySelector('[data-kpi="por-reconhecer"]').click());
  await pag.waitForTimeout(1000);
  const modal = await pag.evaluate(() => {
    const m = document.querySelector('.modal');
    return m ? {
      titulo: m.querySelector('h2, .tit') ? m.textContent.slice(0, 40) : '',
      // O detalhamento virou ÁRVORE: o LANÇAMENTO é o nível 4, e é só ele
      // que carrega a marca de por reconhecer — tipo, empresa e filial são
      // agrupadores, não registros.
      linhas: m.querySelectorAll('tr.nivel-4').length,
      destacadas: m.querySelectorAll('tr.nivel-4[data-sem-reconhecer]').length,
      niveis: [1, 2, 3, 4].map((n) => m.querySelectorAll(`tr.nivel-${n}`).length),
      caixas: m.querySelectorAll('input[data-sel-lanc]').length,
      botao: m.querySelector('[data-reconhecer]') ? m.querySelector('[data-reconhecer]').disabled : null,
    } : null;
  });
  ok('o detalhamento abre com os lançamentos', modal && modal.linhas > 0, `${modal && modal.linhas} linha(s)`);
  // A MESMA estrutura do detalhamento da barra do Objetivo 01: uma tela que
  // lista lançamento tem de listar do mesmo jeito em toda a tela.
  ok('e na mesma árvore tipo → empresa → filial → lançamento',
    modal && modal.niveis.every((n) => n > 0), modal && modal.niveis.join('/'));
  ok('com a caixa de reconhecer em cada lançamento',
    modal && modal.caixas === modal.linhas, modal && `${modal.caixas} caixa(s)`);
  ok('todos aparecem destacados como por reconhecer', modal && modal.destacadas === modal.linhas,
    `${modal && modal.destacadas}/${modal && modal.linhas}`);
  ok('e o botão começa desabilitado, sem seleção', modal && modal.botao === true);

  await pag.evaluate(() => {
    const c = document.querySelector('.modal input[data-sel-lanc]:not([disabled])');
    c.checked = true; c.dispatchEvent(new Event('change'));
  });
  await pag.waitForTimeout(300);
  const habilitado = await pag.evaluate(() => {
    const b = document.querySelector('.modal [data-reconhecer]');
    return { desabilitado: b.disabled, rotulo: b.textContent.trim() };
  });
  ok('marcar um habilita a ação, dizendo quantos', !habilitado.desabilitado && /1 selecionado/.test(habilitado.rotulo),
    habilitado.rotulo);

  await pag.click('.modal [data-reconhecer]');
  await pag.waitForTimeout(1500);
  const depoisRec = await pag.evaluate(async () => {
    const trilha = await E.db.doc('auditoria/cliente__' + E.clienteSel).get();
    return {
      kpi: document.querySelector('[data-kpi="por-reconhecer"] .n').textContent.trim(),
      auditado: (trilha.exists ? trilha.data().itens : []).some((a) => a.acao === 'reconhecer'),
      modalFechado: !document.querySelector('.modal'),
    };
  });
  ok('a tela fecha e o indicador cai', depoisRec.modalFechado && depoisRec.kpi !== antesPendentes,
    `${antesPendentes} → ${depoisRec.kpi}`);
  ok('e o reconhecimento deixa trilha', depoisRec.auditado);

  console.log('\n--- a despesa reconhecida perde o destaque na listagem ---');
  await irPara(pag, 'Lançamentos', 1200);
  // A listagem mostra o cliente inteiro e tem teto de linhas: para conferir a
  // linha que acabou de ser reconhecida, o filtro DESTA tela recorta a unidade
  // dela — que é o uso normal do filtro local.
  await pag.evaluate(async () => {
    filtroDaTela('lancamentos').empresas = new Set([empresaAtiva()]);
    await render();
  });
  await pag.waitForTimeout(900);
  const listagem = await pag.evaluate(() => {
    const linhas = [...document.querySelectorAll('#pagina tbody tr')];
    const reconhecida = linhas.find((l) => !l.hasAttribute('data-sem-reconhecer'));
    const pendente = linhas.find((l) => l.hasAttribute('data-sem-reconhecer'));
    const cor = (tr) => tr && getComputedStyle(tr.querySelector('td.n')).color;
    return { temReconhecida: !!reconhecida, corPendente: cor(pendente), corReconhecida: cor(reconhecida),
      pesoPendente: pendente ? getComputedStyle(pendente.querySelector('td.n')).fontWeight : '' };
  });
  ok('a linha reconhecida existe e não carrega a marca', listagem.temReconhecida);
  ok('a pendente sai em negrito', Number(listagem.pesoPendente) >= 700, listagem.pesoPendente);
  ok('e em laranja, diferente da reconhecida', listagem.corPendente !== listagem.corReconhecida,
    `${listagem.corPendente} vs ${listagem.corReconhecida}`);

  // ------------------------------------------------- cores e sanfona por unidade
  //
  // O indicador continua consolidado. O que se exige aqui é que ele saiba DE
  // QUEM é cada pedaço: a faixa divide por matriz, a legenda nomeia (o canal
  // que não depende de enxergar cor), e a sanfona abre matriz -> filial com a
  // soma batendo com o número do card.
  console.log('\n--- a composição por empresa matriz aparece no indicador ---');
  await irPara(pag, 'Indicadores Gerais', 1200);
  const composicao = await pag.evaluate(() => {
    const faixas = [...document.querySelectorAll('.faixa-matrizes')];
    const cores = faixas.map((f) => [...f.children].map((i) => i.style.background));
    return {
      faixas: faixas.length,
      legendas: document.querySelectorAll('.legenda-matrizes').length,
      // Uma faixa com um segmento só não teria o que distinguir: ela não aparece.
      minimoDeSegmentos: Math.min(...cores.map((c) => c.length), Infinity),
      // Nenhuma cor pode se repetir dentro da mesma faixa — duas matrizes na
      // mesma cor mentem mais do que nenhuma cor.
      repetidas: cores.filter((c) => new Set(c).size !== c.length).length,
      comTitulo: faixas.every((f) => [...f.children].every((i) => (i.title || '').includes(':'))),
    };
  });
  ok('há faixa de composição por matriz', composicao.faixas > 0, String(composicao.faixas));
  ok('toda faixa tem legenda ao lado', composicao.legendas === composicao.faixas,
    `${composicao.legendas} legenda(s) para ${composicao.faixas} faixa(s)`);
  ok('nenhuma faixa sai com um segmento só', composicao.minimoDeSegmentos >= 2, String(composicao.minimoDeSegmentos));
  ok('nenhuma cor se repete dentro da mesma faixa', composicao.repetidas === 0, String(composicao.repetidas));
  ok('cada segmento diz de quem é e quanto', composicao.comTitulo);

  console.log('\n--- a árvore do SLA aponta quem puxa o resultado para baixo ---');
  const fechada = await pag.$eval('[data-arvore="ind-sla"] [data-abrir-unidades]',
    (b) => b.getAttribute('aria-expanded'));
  ok('a árvore nasce fechada', fechada === 'false', String(fechada));
  await pag.click('[data-arvore="ind-sla"] [data-abrir-unidades]');
  await pag.waitForTimeout(400);
  const arvore = await pag.evaluate(() => {
    const caixa = document.querySelector('[data-arvore="ind-sla"]');
    const corpo = caixa.querySelector('.kpi-corpo');
    const num = document.querySelector('[data-kpi="sla-chamados"] .n').textContent;
    const soma = [...corpo.querySelectorAll('tr.nivel-1 td.num')]
      .reduce((s, td) => s + Number(String(td.textContent).replace(/\./g, '').replace(',', '.')), 0);
    return {
      aberta: caixa.querySelector('[data-abrir-unidades]').getAttribute('aria-expanded') === 'true',
      abriuModal: !!document.querySelector('.modal'),
      empresas: corpo.querySelectorAll('tr.nivel-1').length,
      // A filial nasce ESCONDIDA: a hierarquia abre um nível por vez.
      filiaisVisiveis: [...corpo.querySelectorAll('tr.nivel-2')].filter((tr) => !tr.hidden).length,
      filiais: corpo.querySelectorAll('tr.nivel-2').length,
      soma,
      numeroDoCard: Number(String(num).replace(/\./g, '')),
      // Cada empresa tem o seu controle, e ele se anuncia.
      controles: corpo.querySelectorAll('tr.nivel-1 [data-abrir-no][aria-expanded="false"]').length,
      // A barra de representatividade, com o percentual escrito ao lado.
      barras: corpo.querySelectorAll('tr.nivel-1 .barra-rep').length,
      comPercentual: [...corpo.querySelectorAll('tr.nivel-1 .barra-rep b')].every((b) => /%$/.test(b.textContent.trim())),
      comDica: [...corpo.querySelectorAll('tr.nivel-1 .barra-rep')].every((b) => (b.getAttribute('title') || '').length > 5),
    };
  });
  ok('abre e marca aria-expanded', arvore.aberta);
  ok('abrir a árvore NÃO abre o detalhamento do card', !arvore.abriuModal);
  ok('o primeiro nível é a EMPRESA, e a filial vem escondida',
    arvore.empresas > 0 && arvore.filiaisVisiveis === 0,
    `${arvore.empresas} empresa(s), ${arvore.filiaisVisiveis} de ${arvore.filiais} filial(is) à mostra`);
  ok('cada empresa tem o seu controle de expansão', arvore.controles === arvore.empresas,
    `${arvore.controles} controle(s) para ${arvore.empresas} empresa(s)`);
  ok('a soma por empresa bate com o número do card', arvore.soma === arvore.numeroDoCard,
    `${arvore.soma} vs ${arvore.numeroDoCard}`);
  ok('cada empresa traz a barra de representatividade', arvore.barras === arvore.empresas,
    `${arvore.barras} barra(s)`);
  ok('com o percentual escrito ao lado, e não só a cor', arvore.comPercentual);
  ok('e a barra explica o valor no hover', arvore.comDica);

  console.log('\n--- expandir a empresa revela as filiais dela, e só as dela ---');
  const primeiraEmpresa = await pag.$eval('[data-arvore="ind-sla"] tr.nivel-1 [data-abrir-no]',
    (b) => b.dataset.abrirNo);
  await pag.click(`[data-arvore="ind-sla"] [data-abrir-no="${primeiraEmpresa}"]`);
  await pag.waitForTimeout(350);
  const expandida = await pag.evaluate((no) => {
    const corpo = document.querySelector('[data-arvore="ind-sla"] .kpi-corpo');
    const doGrupo = [...corpo.querySelectorAll(`tr.nivel-2[data-pai="${no}"]`)];
    const deOutros = [...corpo.querySelectorAll('tr.nivel-2')].filter((tr) => tr.dataset.pai !== no);
    return {
      expandido: corpo.querySelector(`[data-abrir-no="${no}"]`).getAttribute('aria-expanded') === 'true',
      abertas: doGrupo.filter((tr) => !tr.hidden).length,
      total: doGrupo.length,
      vizinhasEscondidas: deOutros.every((tr) => tr.hidden),
      // O mesmo formato do nível de cima: barra, percentual e valor.
      mesmoFormato: doGrupo.filter((tr) => !tr.hidden).every((tr) =>
        tr.querySelector('.barra-rep') && tr.querySelector('td.num')),
    };
  }, primeiraEmpresa);
  ok('a empresa se anuncia expandida', expandida.expandido);
  ok('as filiais dela aparecem', expandida.abertas > 0 && expandida.abertas === expandida.total,
    `${expandida.abertas} de ${expandida.total}`);
  ok('as das outras empresas continuam escondidas', expandida.vizinhasEscondidas);
  ok('e a filial usa o mesmo formato da empresa', expandida.mesmoFormato);

  console.log('\n--- na despesa, a filial abre os lançamentos (nível 3, sob demanda) ---');
  await pag.click('[data-arvore="ind-fixos"] [data-abrir-unidades]');
  await pag.waitForTimeout(350);
  const antesDoClique = await pag.evaluate(() =>
    document.querySelectorAll('[data-arvore="ind-fixos"] tr.nivel-3').length);
  ok('o nível 3 não existe antes de alguém pedir', antesDoClique === 0, String(antesDoClique));

  const empresaFixos = await pag.$eval('[data-arvore="ind-fixos"] tr.nivel-1 [data-abrir-no]',
    (b) => b.dataset.abrirNo);
  await pag.click(`[data-arvore="ind-fixos"] [data-abrir-no="${empresaFixos}"]`);
  await pag.waitForTimeout(350);
  const filialFixos = await pag.$eval(
    '[data-arvore="ind-fixos"] tr.nivel-2:not([hidden]) [data-abrir-no]', (b) => b.dataset.abrirNo);
  await pag.click(`[data-arvore="ind-fixos"] [data-abrir-no="${filialFixos}"]`);
  await pag.waitForTimeout(450);
  const nivel3 = await pag.evaluate((no) => {
    const corpo = document.querySelector('[data-arvore="ind-fixos"] .kpi-corpo');
    const itens = [...corpo.querySelectorAll(`tr.nivel-3[data-pai="${no}"]`)];
    return {
      quantos: itens.length,
      visiveis: itens.filter((tr) => !tr.hidden).length,
      // A linha de "exibindo os N maiores" não é um lançamento: ela é o aviso
      // de corte, e cobrar dela barra e valor seria cobrar o que não existe.
      mesmoFormato: itens.filter((tr) => !tr.hidden && !tr.querySelector('.vazio-no')).every((tr) =>
        tr.querySelector('.barra-rep') && tr.querySelector('td.num')),
    };
  }, filialFixos);
  ok('os lançamentos aparecem só depois do clique', nivel3.quantos > 0, `${nivel3.quantos} lançamento(s)`);
  ok('e todos visíveis', nivel3.visiveis === nivel3.quantos, `${nivel3.visiveis}/${nivel3.quantos}`);
  ok('com o mesmo formato dos níveis de cima', nivel3.mesmoFormato);

  // Fechar a empresa esconde o que estava aberto abaixo dela: uma árvore que
  // deixasse netos à mostra sob um pai fechado estaria mentindo sobre si.
  await pag.click(`[data-arvore="ind-fixos"] [data-abrir-no="${empresaFixos}"]`);
  await pag.waitForTimeout(350);
  const aposFechar = await pag.evaluate(() => {
    const corpo = document.querySelector('[data-arvore="ind-fixos"] .kpi-corpo');
    return [...corpo.querySelectorAll('tr.nivel-2, tr.nivel-3')].filter((tr) => !tr.hidden).length;
  });
  ok('fechar a empresa recolhe filiais e lançamentos juntos', aposFechar === 0, String(aposFechar));

  console.log('\n--- sem erro de console no caminho todo ---');
  ok('nenhum erro de página', erros.length === 0, erros.slice(0, 3).join(' | '));

  console.log(`\n${falhas.length ? '✗ ' + falhas.length + ' falha(s):\n  - ' + falhas.join('\n  - ') : '✓ tudo certo'}`);
  await nav.close();
  process.exit(falhas.length ? 1 : 0);
})();
