// Quem reconhece despesa: o cadastro e o alcance dele sobre o que já existe.
//
// A promessa é a LIGAÇÃO: cadastrar uma pessoa tem de mudar o que a aplicação
// retroativa marcaria. Um cadastro que a aplicação não lê seria o defeito mais
// caro possível — o gestor montaria a lista e continuaria conferindo tudo à mão.
//
// E a segunda promessa: nada é recalculado sozinho. A prévia conta e não grava;
// só o botão de aplicar mexe em lançamento.
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

  // Base limpa: um resto de execução anterior faria o "vazio" nunca acontecer.
  await pag.evaluate(() => Loja.gravarCatalogo('reconhecedores', []));
  await pag.waitForTimeout(300);

  // ------------------------------------------------------- o cadastro
  console.log('\nCADASTRO — a tela grava, e recusa o que não faz sentido');
  await irPara(pag, 'Quem reconhece despesa', 900);
  const tela = await pag.evaluate(() => ({
    titulo: ((document.querySelector('#pagina .bloco header h2') || {}).textContent || '').replace(/^\s*[−+]\s*/, ''),
    vazio: !!document.querySelector('#pagina .vazio'),
    // É tela de CLIENTE: oferecer seletor de unidade sugeriria um recorte que
    // ela não tem, como em Metas e no Plano de redução.
    foco: !!document.querySelector('[data-sel="foco"]'),
  }));
  ok('a tela abre', /reconhece despesa/i.test(tela.titulo), tela.titulo);
  ok('e diz que não há ninguém cadastrado', tela.vazio);
  ok('sem seletor de unidade, porque o cadastro é do cliente', !tela.foco);

  await pag.click('[data-novo-rec]');
  await pag.waitForTimeout(400);
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(400);
  const semUsuario = await pag.evaluate(() =>
    (document.querySelector('.modal .msg.erro, .modal [data-erro]') || {}).textContent || '');
  ok('sem usuário, o cadastro é recusado', /usuário/i.test(semUsuario), semUsuario.trim());

  await pag.fill('#r-usuario', 'MIQUEIASSILVA');
  await pag.fill('#r-nome', 'Miqueias Silva');
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(900);

  const listado = await pag.evaluate(() => {
    const linha = document.querySelector('#pagina tbody tr');
    return linha ? linha.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  ok('a pessoa aparece na lista sem recarregar a página', /MIQUEIASSILVA/.test(listado), listado);
  ok('com o nome de exibição e a situação', /Miqueias Silva/.test(listado) && /Ativo/.test(listado), listado);

  // O mesmo nome escrito de outro jeito é a mesma pessoa — é a razão de a
  // comparação ser normalizada, e sem isto o cadastro ganharia duplicatas.
  await pag.click('[data-novo-rec]');
  await pag.waitForTimeout(400);
  await pag.fill('#r-usuario', 'Miqueias Silva');
  await pag.click('.modal [data-s]');
  await pag.waitForTimeout(400);
  const repetido = await pag.evaluate(() =>
    (document.querySelector('.modal .msg.erro, .modal [data-erro]') || {}).textContent || '');
  ok('o mesmo nome com espaço é recusado como repetido', /já está na lista/i.test(repetido), repetido.trim());
  await pag.click('.modal [data-c]');
  await pag.waitForTimeout(300);

  // ------------------------------------------- a ligação com os lançamentos
  console.log('\nLIGAÇÃO — o cadastro decide quem a aplicação alcança');

  // Um lançamento com criador na origem, como a carga de Contas a Pagar o
  // deixa. Sem ele, a prévia contaria "0 de 0" e não provaria nada.
  const preparado = await pag.evaluate(async () => {
    const emp = escopoEmpresas()[0];
    const comp = competenciaPadrao();
    const itens = Loja.itens(emp, comp).map((x) => ({ ...x }));
    const alvo = itens.find((x) => !x.reconhecido);
    if (!alvo) return null;
    alvo.usuarioOrigem = 'MIQUEIASSILVA';
    await Loja.gravarMes(emp, comp, itens);
    return { id: alvo.id, empresa: emp, competencia: comp };
  });
  ok('há um lançamento por reconhecer com criador na origem', !!preparado);

  await irPara(pag, 'Quem reconhece despesa', 900);
  await pag.click('[data-previa-rec]');
  await pag.waitForTimeout(500);
  const previa = await pag.evaluate(() => {
    const bloco = document.querySelector('[data-resumo-reconhecimento]');
    return bloco ? bloco.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  ok('a prévia sai', /nada foi gravado/i.test(previa), previa.slice(0, 90));
  ok('e conta ao menos um a reconhecer', /Seriam reconhecidos\s*1/.test(previa), previa.slice(0, 200));

  const aindaNao = await pag.evaluate((p) =>
    !Loja.itens(p.empresa, p.competencia).find((x) => x.id === p.id).reconhecido, preparado);
  ok('a prévia NÃO gravou nada', aindaNao);

  await pag.click('[data-aplicar-rec]');
  await pag.waitForTimeout(1200);
  const depois = await pag.evaluate((p) =>
    Loja.itens(p.empresa, p.competencia).find((x) => x.id === p.id).reconhecido === true, preparado);
  ok('aplicar marca o lançamento de quem está no cadastro', depois);

  const trilha = await pag.evaluate(async () => {
    // A trilha é UM documento por cliente, com a lista dentro — não uma coleção.
    const s = await E.db.doc('auditoria/cliente__' + E.clienteSel).get();
    const itens = s.exists ? (s.data().itens || []) : [];
    return itens.filter((a) => a.entidade === 'reconhecedor_origem').map((a) => a.acao);
  });
  ok('a criação e a aplicação ficam na trilha', trilha.includes('criar') && trilha.includes('aplicar'), trilha.join(', '));

  // ------------------------------------------- quem sai do time para de valer
  console.log('\nDESATIVAR — quem saiu do time para de reconhecer, sem apagar o passado');
  const jaReconhecido = await pag.evaluate((p) =>
    Loja.itens(p.empresa, p.competencia).find((x) => x.id === p.id).reconhecido === true, preparado);
  await pag.click('[data-alternar-rec="0"]');
  await pag.waitForTimeout(900);
  const inativo = await pag.evaluate(() => {
    const linha = document.querySelector('#pagina tbody tr');
    return linha ? linha.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  ok('a pessoa fica inativa e continua na lista, para o histórico', /Inativo/.test(inativo), inativo);
  const preservado = await pag.evaluate((p) =>
    Loja.itens(p.empresa, p.competencia).find((x) => x.id === p.id).reconhecido === true, preparado);
  ok('e o que já tinha sido reconhecido não é desfeito', jaReconhecido && preservado);

  console.log(`\n=== falhas: ${falhas.length ? falhas.join(' | ') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? erros.join(' | ') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
