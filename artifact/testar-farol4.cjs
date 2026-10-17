// O FAROL 4 — Projeção de Economias e Valor Gerado pela TI.
//
// Entrega 1 é ESTRUTURA: as três frentes ainda não têm cadastro, e o que se
// confere aqui é o esqueleto que as entregas 2 a 4 vão preencher — posição na
// pilha, título e descrição exatos, três sub-blocos que abrem e fecham sozinhos,
// e o cabeçalho separando o REALIZADO do PROJETADO.
//
// A conferência que mais importa é a última: "sem cadastro" não pode virar
// "R$ 0,00". Zero afirmaria que a TI não gerou economia nenhuma; o que há é que
// ninguém cadastrou ainda o que ela gerou.
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
  await irPara(pag, 'Indicadores Gerais', 2500);

  console.log('\nPOSIÇÃO, TÍTULO E DESCRIÇÃO');
  const base = await pag.evaluate(() => {
    const kpi = document.querySelector('[data-kpi="valor-gerado"]');
    if (!kpi) return null;
    const bloco = kpi.closest('section.bloco-indicador');
    const irmaos = [...bloco.parentElement.querySelectorAll(':scope > section.bloco-indicador')]
      .map((b) => b.querySelector('h2').textContent.replace(/^[+−]\s*/, '').trim());
    return {
      irmaos,
      titulo: bloco.querySelector('h2').textContent.replace(/^[+−]\s*/, '').trim(),
      descricao: (bloco.querySelector('.descricao-indicador') || {}).textContent || '',
      grupo: bloco.closest('section.bloco-grupo').querySelector('h2').textContent.replace(/^[+−]\s*/, '').trim(),
      modulo: bloco.closest('section.bloco-modulo').querySelector('h2').textContent.replace(/^[+−]\s*/, '').trim(),
    };
  });
  ok('o Farol 4 existe na tela', !!base);
  if (!base) { console.log('=== falhas: bloco ausente ==='); process.exit(1); }
  ok('com o título exato do enunciado',
    base.titulo === 'Farol 4 - Projeção de Economias e Valor Gerado pela TI', base.titulo);
  ok('e a descrição exata', base.descricao.trim() === 'Resultado gerado com negociação de compras '
    + 'e serviços, desenvolvimento interno (BI e automações) e o custo da ausência de controle e '
    + 'processo rigoroso na gestão de TI', base.descricao.trim().slice(0, 60));
  ok('dentro do módulo Financeiro', base.modulo === 'Financeiro', base.modulo);
  ok('no grupo Faróis', base.grupo === 'Faróis', base.grupo);
  // Imediatamente APÓS o Farol 3: a ordem da pilha é parte do pedido, e um
  // farol fora de ordem faz procurar o custo recorrente no lugar errado.
  const i = base.irmaos.findIndex((t) => /^Farol 4/.test(t));
  ok('imediatamente depois do Farol 3', i > 0 && /^Farol 3/.test(base.irmaos[i - 1]),
    base.irmaos.map((t) => t.slice(0, 12)).join(' → '));
  ok('e é o último da fila de faróis', i === base.irmaos.length - 1, `${i + 1} de ${base.irmaos.length}`);

  console.log('\nOS TRÊS SUB-BLOCOS');
  const subs = await pag.evaluate(() => {
    const bloco = document.querySelector('[data-kpi="valor-gerado"]').closest('section.bloco-indicador');
    return [...bloco.querySelectorAll('section.bloco-sub')].map((s) => ({
      frente: s.dataset.subFarol4,
      titulo: s.querySelector('h2').textContent.replace(/^[+−]\s*/, '').trim(),
      temDobra: !!s.querySelector(':scope > header .bloco-dobra'),
      // O sub-bloco NÃO pode estar dentro do `.kpi`: ele é gatilho de
      // drill-down, e abrir a frente abriria a tela flutuante junto.
      dentroDoKpi: !!s.closest('.kpi'),
    }));
  });
  ok('são três', subs.length === 3, String(subs.length));
  ok('na ordem A, B, C',
    subs.map((s) => s.frente).join(',') === 'negociacao,desenvolvimento,naoGestao',
    subs.map((s) => s.frente).join(','));
  ok('com os títulos do enunciado',
    subs[0].titulo === 'Economia com Negociação — Compras e Serviços'
    && subs[1].titulo === 'Economia com Desenvolvimento Interno — BI e Automações'
    && subs[2].titulo === 'Custo da Não Gestão — Projeção sem Controle e Processo Rigoroso',
    subs.map((s) => s.titulo.slice(0, 22)).join(' | '));
  ok('cada um com dobra própria', subs.every((s) => s.temDobra));
  ok('e nenhum dentro do gatilho de drill-down', subs.every((s) => !s.dentroDoKpi));

  // Independentes: fechar um não pode arrastar os outros.
  const antes = await pag.evaluate(() => [...document.querySelectorAll('section.bloco-sub')]
    .map((s) => s.querySelector('.bloco-dobra').getAttribute('aria-expanded')));
  await pag.evaluate(() => document.querySelector('section.bloco-sub .bloco-dobra').click());
  await pag.waitForTimeout(350);
  const depois = await pag.evaluate(() => [...document.querySelectorAll('section.bloco-sub')]
    .map((s) => s.querySelector('.bloco-dobra').getAttribute('aria-expanded')));
  ok('fechar um sub-bloco não mexe nos outros',
    depois[0] !== antes[0] && depois[1] === antes[1] && depois[2] === antes[2],
    `${antes.join(',')} → ${depois.join(',')}`);

  console.log('\nESTADO PADRÃO — comprimido');
  // `irPara` abre todos os blocos, que é o que as demais suítes precisam. O
  // padrão de verdade só aparece com a memória limpa.
  await pag.evaluate(async () => { localStorage.removeItem('iarx-blocos-abertos'); await render(); });
  await pag.waitForTimeout(1400);
  const padrao = await pag.evaluate(() => [...document.querySelectorAll('section.bloco-sub')]
    .map((s) => s.querySelector('.bloco-dobra').getAttribute('aria-expanded')));
  ok('os sub-blocos nascem fechados', padrao.every((x) => x === 'false'), padrao.join(','));

  console.log('\nCABEÇALHO — realizado e projetado separados');
  const conta = await pag.evaluate(() => {
    const f = calcularFarol4(recorteDoBloco('financeiro'));
    return {
      frentes: f.frentes.map((x) => ({ k: x.k, tipo: x.tipo, pronto: x.pronto, valor: x.valor })),
      realizado: f.realizado, evitado: f.evitado, completo: f.completo,
      prontas: f.prontas, total: f.total,
    };
  });
  ok('a consolidação conhece as três frentes', conta.total === 3, String(conta.total));
  ok('duas são realizadas e uma é projetada',
    conta.frentes.filter((x) => x.tipo === 'realizado').length === 2
    && conta.frentes.filter((x) => x.tipo === 'projetado').length === 1);
  // A regra que rege o bloco: o completo é a SOMA, nunca a subtração. Somar o
  // desperdício evitado como negativo faria o indicador encolher quanto mais
  // desperdício a TI demonstrasse ter evitado.
  ok('o cenário completo é realizado MAIS evitado, nunca menos',
    conta.completo === conta.realizado + conta.evitado,
    `${conta.realizado} + ${conta.evitado} = ${conta.completo}`);
  ok('nenhuma frente tem cadastro ainda (Entrega 1)', conta.prontas === 0, String(conta.prontas));

  const cabecalho = await pag.evaluate(() => {
    const kpi = document.querySelector('[data-kpi="valor-gerado"]');
    const bloco = kpi.closest('section.bloco-indicador');
    return {
      valor: kpi.querySelector('.n').textContent.trim(),
      apoio: (kpi.querySelector('.a') || {}).textContent || '',
      cards: [...bloco.querySelectorAll('.card-plano')].map((c) => ({
        rot: c.querySelector('.card-rot').textContent.trim(),
        val: c.querySelector('strong').textContent.trim(),
      })),
      // O sinal escrito entre os cards: o gestor confere a conta com o olho.
      ops: [...bloco.querySelectorAll('.card-op')].map((o) => o.textContent.trim()).join(''),
      semaforo: !!bloco.querySelector('.semaforo.neutro'),
      temMeta: /sem meta cadastrada/i.test(bloco.textContent),
    };
  });
  // "Sem cadastro" NÃO é zero: R$ 0,00 afirmaria que a TI não gerou economia
  // nenhuma, quando o que há é ausência de registro.
  ok('sem cadastro o valor é travessão, não R$ 0,00',
    cabecalho.valor === '—' && !/R\$/.test(cabecalho.valor), cabecalho.valor);
  ok('e o apoio diz quantas frentes faltam', /nenhuma das 3 frentes/.test(cabecalho.apoio),
    cabecalho.apoio);
  ok('a conta aparece em cinco cards', cabecalho.cards.length === 5,
    cabecalho.cards.map((c) => c.rot).join(' · '));
  ok('com os operadores escritos entre eles', cabecalho.ops === '+=+=', cabecalho.ops);
  ok('o realizado e o cenário completo são cards distintos',
    cabecalho.cards.some((c) => /realizado/i.test(c.rot))
    && cabecalho.cards.some((c) => /completo/i.test(c.rot)));
  ok('o semáforo da meta está neutro', cabecalho.semaforo);
  ok('e diz que não há meta cadastrada', cabecalho.temMeta);

  console.log(`\n=== falhas: ${falhas.length ? '\n' + falhas.join('\n') : 'nenhuma'} ===`);
  console.log(`=== erros de console: ${erros.length ? '\n' + erros.join('\n') : 'nenhum'} ===`);
  await nav.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
