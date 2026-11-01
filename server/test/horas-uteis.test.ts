/**
 * O RELÓGIO DO SLA no servidor.
 *
 * Estas regras existem duas vezes — aqui e em `artifact/app-js22.js` —, e é
 * por isso que precisam de conferência própria: duas cópias divergem na
 * primeira correção feita de um lado só, e a divergência é silenciosa. Os
 * dois lados seguem devolvendo um prazo plausível, e ninguém descobre até
 * alguém comparar o prazo que o celular mostra com o do navegador.
 *
 * O motor é puro e recebe o calendário por parâmetro. É isso que permite
 * conferir a sexta-feira, o feriado e a virada do ano com datas fixas, sem
 * depender do dia em que a conferência roda — um teste que usasse "hoje"
 * passaria hoje e falharia sozinho na semana que vem.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPEDIENTE, criarFeriado, diaLocal, excluirFeriado, feriadosVigentes, horasUteis,
  janelaDoDia, listarFeriados, prazoEmHorasUteis, atualizarFeriado,
} from '../src/domain/horas-uteis.js';
import { ambienteLimpo, contextoDe } from './apoio.js';
import { criarEmpresa } from '../src/domain/empresas.js';

/** Um instante local, para as datas não dependerem do fuso da máquina. */
const em = (ano: number, mes: number, dia: number, hora = 0, minuto = 0) =>
  new Date(ano, mes - 1, dia, hora, minuto, 0, 0).toISOString();

// ------------------------------------------------------------- o expediente

test('o expediente é o do contrato: 10 h de segunda a quinta, 9 h na sexta', () => {
  assert.deepEqual(EXPEDIENTE[1], { de: 8, ate: 18 });
  assert.deepEqual(EXPEDIENTE[4], { de: 8, ate: 18 });
  assert.deepEqual(EXPEDIENTE[5], { de: 8, ate: 17 }, 'sexta fecha uma hora antes');
  assert.equal(EXPEDIENTE[0], null, 'domingo não tem expediente');
  assert.equal(EXPEDIENTE[6], null, 'sábado idem');
});

test('o dia é lido no fuso LOCAL, e não em UTC', () => {
  // Às 22h de uma segunda, UTC já virou terça no Brasil. Usar o dia em UTC
  // deslocaria o expediente inteiro de um dia.
  const segundaTarde = new Date(2026, 10, 2, 22, 0, 0);
  assert.equal(diaLocal(segundaTarde), '2026-11-02');
});

test('feriado tira a janela do dia, e fim de semana também', () => {
  const feriados = new Set(['2026-11-04']);
  assert.equal(janelaDoDia(new Date(2026, 10, 4), feriados), null, 'quarta feriada');
  assert.deepEqual(janelaDoDia(new Date(2026, 10, 5), feriados), { de: 8, ate: 18 }, 'quinta normal');
  assert.equal(janelaDoDia(new Date(2026, 10, 7), feriados), null, 'sábado');
});

// ------------------------------------------------------------- o consumo

test('o consumo conta só o que está dentro do expediente', () => {
  // Segunda, das 9h às 12h: três horas inteiras dentro da janela.
  assert.equal(horasUteis(em(2026, 11, 2, 9), em(2026, 11, 2, 12)), 3);
  // Das 7h às 9h: só a hora a partir das 8 conta.
  assert.equal(horasUteis(em(2026, 11, 2, 7), em(2026, 11, 2, 9)), 1);
  // Das 17h às 23h numa segunda: só até as 18h.
  assert.equal(horasUteis(em(2026, 11, 2, 17), em(2026, 11, 2, 23)), 1);
});

test('abrir fora do expediente é o mesmo que abrir na abertura seguinte', () => {
  // É o que o contrato promete: o relógio só começa quando alguém pode atender.
  const deNoite = horasUteis(em(2026, 11, 3, 22), em(2026, 11, 4, 12));
  const deManha = horasUteis(em(2026, 11, 4, 8), em(2026, 11, 4, 12));
  assert.equal(deNoite, deManha);
  assert.equal(deManha, 4);
});

test('o fim de semana não conta — é o caso que motivou o motor', () => {
  // Sexta às 16h30 até segunda às 9h: 0,5 h na sexta (fecha 17h) + 1 h na
  // segunda. Em horas corridas seriam mais de 64.
  assert.equal(horasUteis(em(2026, 11, 6, 16, 30), em(2026, 11, 9, 9)), 1.5);
});

test('um feriado no meio some do consumo', () => {
  const sem = horasUteis(em(2026, 11, 3, 9), em(2026, 11, 5, 9));
  const com = horasUteis(em(2026, 11, 3, 9), em(2026, 11, 5, 9), new Set(['2026-11-04']));
  // Terça 9h→18h (9 h) + quarta inteira (10 h) + quinta 8h→9h (1 h) = 20 h.
  assert.equal(sem, 20);
  assert.equal(com, 10, 'a quarta inteira — 10 h — sai da conta');
});

test('fim antes do início é zero, nunca negativo', () => {
  // Consumo negativo se espalharia como "dentro do prazo".
  assert.equal(horasUteis(em(2026, 11, 5, 12), em(2026, 11, 5, 9)), 0);
  assert.equal(horasUteis(em(2026, 11, 5, 12), em(2026, 11, 5, 12)), 0);
});

test('data inválida devolve nada, e não um número inventado', () => {
  assert.equal(horasUteis('nem data', em(2026, 11, 5, 9)), null);
  assert.equal(horasUteis(em(2026, 11, 5, 9), 'nem data'), null);
});

// --------------------------------------------------------------- o prazo

test('o prazo é o inverso do consumo', () => {
  // 4 horas úteis a partir de segunda 9h vencem na mesma segunda às 13h.
  const prazo = prazoEmHorasUteis(em(2026, 11, 2, 9), 4)!;
  assert.equal(horasUteis(em(2026, 11, 2, 9), prazo), 4);
  assert.equal(new Date(prazo).getHours(), 13);
});

test('sexta às 17h30 com 4 horas vence na segunda de manhã', () => {
  // O caso do cabeçalho do motor, e o que medir em horas corridas erraria.
  const prazo = prazoEmHorasUteis(em(2026, 11, 6, 17, 30), 4)!;
  const d = new Date(prazo);
  assert.equal(diaLocal(d), '2026-11-09', 'segunda-feira');
  assert.equal(d.getHours(), 12, '8h + 4 h úteis');
});

test('o prazo pula o feriado', () => {
  const semFeriado = prazoEmHorasUteis(em(2026, 11, 3, 9), 12)!;
  const comFeriado = prazoEmHorasUteis(em(2026, 11, 3, 9), 12, new Set(['2026-11-04']))!;
  assert.equal(diaLocal(new Date(semFeriado)), '2026-11-04');
  assert.equal(diaLocal(new Date(comFeriado)), '2026-11-05', 'empurrou um dia útil adiante');
});

test('zero hora vence na próxima abertura, e hora negativa não vence nunca', () => {
  const agora = prazoEmHorasUteis(em(2026, 11, 2, 9), 0)!;
  assert.equal(new Date(agora).getHours(), 9);
  assert.equal(prazoEmHorasUteis(em(2026, 11, 2, 9), -1), null);
});

// ------------------------------------------------------------- o cadastro

test('o feriado é do cliente, e não vaza para o vizinho', () => {
  const { ctx } = ambienteLimpo();
  criarFeriado(ctx, { data: '2026-12-25', descricao: 'Natal' });
  assert.equal(listarFeriados(ctx).length, 1);

  const outra = criarEmpresa(ctx.usuarioId, { nome: 'Outro Contratante' });
  const alheio = contextoDe(ctx, outra.id);
  assert.equal(listarFeriados(alheio).length, 0);
  assert.equal(feriadosVigentes(alheio).size, 0);
});

test('o mesmo dia duas vezes é recusado, dizendo qual já está lá', () => {
  const { ctx } = ambienteLimpo();
  criarFeriado(ctx, { data: '2026-12-25', descricao: 'Natal' });
  assert.throws(() => criarFeriado(ctx, { data: '2026-12-25', descricao: 'Outro nome' }), /Natal/);
});

test('data fora do formato é recusada, e não vira dia nenhum', () => {
  const { ctx } = ambienteLimpo();
  assert.throws(() => criarFeriado(ctx, { data: '25/12/2026' }), /AAAA-MM-DD/);
  assert.throws(() => criarFeriado(ctx, { data: '' }), /AAAA-MM-DD/);
});

test('desconsiderar tira do cálculo sem apagar o registro', () => {
  // É como se corrige um cadastro errado sem tornar inexplicável um prazo que
  // já foi medido com a lista de ontem.
  const { ctx } = ambienteLimpo();
  const f = criarFeriado(ctx, { data: '2026-11-04', descricao: 'Engano' });
  assert.equal(feriadosVigentes(ctx).has('2026-11-04'), true);

  atualizarFeriado(ctx, f.id, { ativo: false });
  assert.equal(feriadosVigentes(ctx).has('2026-11-04'), false, 'saiu do cálculo');
  assert.equal(listarFeriados(ctx).length, 1, 'continua na lista');
  assert.equal(listarFeriados(ctx)[0]!.ativo, false);

  atualizarFeriado(ctx, f.id, { ativo: true });
  assert.equal(feriadosVigentes(ctx).has('2026-11-04'), true, 'reativar volta a contar');
});

test('o cadastro alimenta o motor de ponta a ponta', () => {
  const { ctx } = ambienteLimpo();
  const antes = horasUteis(em(2026, 11, 3, 9), em(2026, 11, 5, 9), feriadosVigentes(ctx));
  criarFeriado(ctx, { data: '2026-11-04', descricao: 'Feriado local' });
  const depois = horasUteis(em(2026, 11, 3, 9), em(2026, 11, 5, 9), feriadosVigentes(ctx));
  assert.equal(antes, 20);
  assert.equal(depois, 10, 'cadastrar o feriado tirou a quarta da conta');
});

test('excluir remove de vez; editar a data move o dia', () => {
  const { ctx } = ambienteLimpo();
  const f = criarFeriado(ctx, { data: '2026-11-04', descricao: 'Trocado' });
  atualizarFeriado(ctx, f.id, { data: '2026-11-05' });
  assert.deepEqual([...feriadosVigentes(ctx)], ['2026-11-05']);
  excluirFeriado(ctx, f.id);
  assert.equal(listarFeriados(ctx).length, 0);
});
