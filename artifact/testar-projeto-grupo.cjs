// PROJETO DO GRUPO INTEIRO.
//
// Um projeto pode ser do contratante, não de uma empresa: a virada de um ERP
// não é da HR PB nem da HM PB. Antes, marcar as cinco empresas criava CINCO
// projetos — que precisam ser atualizados cinco vezes e somam cinco onde há um.
//
// O que esta suíte protege é que ele nasça ÚNICO e não suma de nenhuma tela:
// um projeto sem empresa é a única entidade do sistema nessa condição, e todo
// lugar que enumera projetos precisa incluir o balde do grupo.
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
  await irPara(pag, 'Projetos', 1800);

  console.log('\nA OPÇÃO NO FORMULÁRIO');
  await pag.click('button:has-text("Novo projeto")');
  await pag.waitForTimeout(700);
  ok('a caixa "projeto do grupo inteiro" existe', await pag.evaluate(() => !!el('#q-grupo')));
  const antes = await pag.evaluate(() => el('#q-unidades').hidden);
  await pag.check('#q-grupo');
  await pag.waitForTimeout(350);
  const depois = await pag.evaluate(() => el('#q-unidades').hidden);
  // Escondidos, e não só ignorados: deixá-los à vista ofereceria uma escolha
  // sem efeito nenhum.
  ok('marcar o grupo esconde a escolha de unidades', antes === false && depois === true,
    `${antes} → ${depois}`);

  await pag.fill('#q-nome', 'Virada do ERP — grupo');
  await pag.fill('#q-ini', '10/2026');
  await pag.fill('#q-fim', '01/2027');
  await pag.click('[data-s]');
  await pag.waitForTimeout(2200);

  console.log('\nNASCE UM, NÃO CINCO');
  const criado = await pag.evaluate(async () => {
    const balde = chaveDoGrupo();
    const grupo = await Loja.projetosDa(balde);
    // Em nenhuma empresa pode ter nascido uma cópia.
    const copias = [];
    for (const e of escopoEmpresas()) {
      for (const p of await Loja.projetosDa(e)) if (/Virada do ERP — grupo/.test(p.nome)) copias.push(e);
    }
    return { noGrupo: grupo.length, escopo: (grupo[0] || {}).escopo, filial: (grupo[0] || {}).filial,
      copias, rotulo: nomeEmpresa(balde), empresas: escopoEmpresas().length };
  });
  ok('um único projeto no balde do grupo', criado.noGrupo === 1, String(criado.noGrupo));
  ok('marcado como escopo de grupo e sem filial',
    criado.escopo === 'grupo' && criado.filial === null, `${criado.escopo} · ${criado.filial}`);
  // A diferença que motivou a mudança: replicar criaria uma cópia por empresa.
  ok('e nenhuma cópia por empresa', criado.copias.length === 0,
    `${criado.copias.length} cópia(s) em ${criado.empresas} empresa(s)`);
  ok('o balde se chama "Todas as empresas"', criado.rotulo === 'Todas as empresas', criado.rotulo);

  console.log('\nELE APARECE NAS TELAS');
  const naLista = await pag.evaluate(() => [...document.querySelectorAll('#pagina table tbody tr')]
    .map((tr) => tr.textContent.replace(/\s+/g, ' ').trim())
    .filter((t) => /Virada do ERP — grupo/.test(t)));
  ok('está na lista de projetos', naLista.length > 0, `${naLista.length} linha(s)`);
  ok('rotulado como "Todas as empresas", não como "empresa"',
    naLista.some((t) => /Todas as empresas/.test(t)) && !naLista.some((t) => /· empresa ·/.test(t)),
    (naLista[0] || '').slice(0, 70));

  // O filtro de filial não pode escondê-lo: ele não tem filial, e vale para
  // todas — retirá-lo ao filtrar seria tirá-lo de quem ele também rege.
  const comFiltro = await pag.evaluate(async () => {
    const f = filiaisDoEscopo()[0];
    if (!f) return null;
    E.filiaisSel = new Set([f.nome]);
    await render();
    await new Promise((r) => setTimeout(r, 900));
    const achou = [...document.querySelectorAll('#pagina table tbody tr')]
      .some((tr) => /Virada do ERP — grupo/.test(tr.textContent));
    E.filiaisSel = new Set();
    await render();
    return { filial: f.nome, achou };
  });
  if (comFiltro) {
    ok('e continua visível com o filtro numa filial', comFiltro.achou, comFiltro.filial);
  }

  console.log('\nOS INDICADORES O ENXERGAM');
  await pag.waitForTimeout(800);
  // A checagem roda DENTRO da página: `ehChaveDeGrupo` é função do sistema,
  // e chamá-la aqui fora daria ReferenceError.
  const nosIndicadores = await pag.evaluate(() => ({
    lista: escopoProjetos(),
    temGrupo: escopoProjetos().some((k) => ehChaveDeGrupo(k)),
    // `escopoProjetos` é a lista ÚNICA que todo leitor usa. Esquecer um leitor
    // faria o projeto do grupo sumir daquela tela sem nenhum aviso.
    grupoPrimeiro: ehChaveDeGrupo(escopoProjetos()[0]),
  }));
  ok('o balde do grupo entra no escopo de projetos', nosIndicadores.temGrupo,
    nosIndicadores.lista.join(', '));
  ok('e vem antes das empresas, porque rege todas', nosIndicadores.grupoPrimeiro,
    nosIndicadores.lista[0]);

  await irPara(pag, 'Indicadores Gerais', 2500);
  const contagem = await pag.evaluate(async () => {
    const antes = calcularProjetos(recorteDoBloco('projetos')).total;
    // Uma tarefa no projeto do grupo tem de somar no indicador.
    const balde = chaveDoGrupo();
    const itens = [...(await Loja.projetosDa(balde))];
    const i = itens.findIndex((p) => /Virada do ERP — grupo/.test(p.nome));
    itens[i] = { ...itens[i], tarefas: [{ id: 'tg1', descricao: 'Teste do grupo',
      inicio: '2026-10', fimPlanejado: '2026-10', fimReal: '2026-10', status: 'concluida' }] };
    await Loja.gravarProjetos(balde, itens);
    return { antes, depois: calcularProjetos(recorteDoBloco('projetos')).total };
  });
  ok('tarefa do projeto do grupo soma no indicador', contagem.depois === contagem.antes + 1,
    `${contagem.antes} → ${contagem.depois}`);

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
