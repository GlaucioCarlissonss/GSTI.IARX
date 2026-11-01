// CHAMADOS SINTÉTICOS para a base local de testes.
//
// Por que isto existe. `dados/` vem de um `read_db` do artifact publicado, e
// ele não traz documento de SLA nenhum. Quatro conferências — conformidade,
// consistência, reclassificação e a de projetos+SLA — MORRIAM por isso, e um
// contador de linhas "✗" as dava como limpas: uma suíte que morre antes da
// primeira asserção não imprime falha nenhuma. Elas ficaram meses sem medir
// nada, e o relatório dizia que estava tudo bem.
//
// Nenhum número daqui veio de lugar nenhum. Solicitantes, atendentes, filas e
// assuntos são inventados, e é justamente por isso que este arquivo pode
// existir no repositório enquanto `dados/` não pode. A base real do cliente
// tem nomes de pessoas e assuntos de chamado — ela nunca entra no git.
//
// O que ele semeia é o MÍNIMO para as regras serem exercidas, e não um volume:
//   - chamados DENTRO e FORA do prazo, para o percentual não ser 0% nem 100%;
//   - um aberto e um em andamento, para a contagem por status ter os três;
//   - filas, criticidades e níveis diferentes, para as séries terem o que
//     separar;
//   - um chamado SEM criticidade, que é o caso que a criticidade padrão
//     existe para resolver.
//
//   node artifact/semear-sla.cjs && node artifact/montar-teste.cjs
//
// Ele NÃO sobrescreve chamado que já exista: rodá-lo sobre uma base que já
// tem SLA apagaria o que o gestor carregou.
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'dados');

if (!fs.existsSync(DIR)) {
  console.error(`${DIR} não existe. Monte a base local antes de semear.`);
  process.exit(1);
}

const jaTem = fs.readdirSync(DIR).filter((f) => f.startsWith('sla__'));
if (jaTem.length && !process.env.FORCAR) {
  console.error(`dados/ já tem ${jaTem.length} documento(s) de SLA.`);
  console.error('Recusando sobrescrever: pode ser a base real do cliente.');
  console.error('Para semear mesmo assim: FORCAR=1 node artifact/semear-sla.cjs');
  process.exit(1);
}

/** As matrizes da base, para os chamados nascerem onde há o que ler. */
const empresas = JSON.parse(
  fs.readFileSync(path.join(DIR, 'catalogo__empresas.json'), 'utf8'),
).itens || [];
if (!empresas.length) {
  console.error('A base não tem matriz cadastrada; não há onde pendurar chamado.');
  process.exit(1);
}

/** As filiais, para o filtro por unidade ter o que recortar. */
const filiais = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, 'catalogo__filiais.json'), 'utf8')).itens || [];
  } catch {
    return [];
  }
})();

const FILAS = ['Infraestrutura', 'Sistemas', 'Atendimento'];

/**
 * Os tópicos levam a marca "(base)".
 *
 * Várias conferências criam os próprios chamados pela tela e os reconhecem
 * depois pelo TÓPICO que usaram — "Rede", "ERP". Semear com esses mesmos
 * nomes faria os registros sintéticos entrarem na contagem delas, e a suíte
 * acusaria o produto de ter criado registros que ela não criou.
 */
const TOPICOS = ['Rede (base)', 'Impressão (base)', 'Acesso (base)', 'Faturamento (base)'];
const CRITICIDADES = ['low', 'normal', 'high', 'urgent'];
const NIVEIS = ['N1', 'N2', 'Implementacao'];

/** Dois dígitos. */
const d2 = (n) => String(n).padStart(2, '0');

/**
 * Os três meses FECHADOS mais recentes.
 *
 * Fechados de propósito: o mês em curso está pela metade, e um chamado nele
 * faria a conferência de conformidade medir meio mês contra a meta cheia.
 */
function mesesFechados(quantos = 3) {
  const hoje = new Date();
  const saida = [];
  for (let i = 1; i <= quantos; i += 1) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    saida.push(`${d.getFullYear()}-${d2(d.getMonth() + 1)}`);
  }
  return saida.reverse();
}

/** Um instante dentro do mês, em ISO. */
const instante = (comp, dia, hora) => `${comp}-${d2(dia)}T${d2(hora)}:00:00.000Z`;

/**
 * Os chamados de um mês numa matriz.
 *
 * A composição é fixa, e não sorteada: uma base que muda a cada execução faz
 * a conferência passar hoje e falhar amanhã sem ninguém ter mexido em nada.
 */
function chamadosDoMes(comp, empresa, indiceDaEmpresa) {
  const filial = (filiais.find((f) => f.empresa === empresa.id) || {}).id || null;
  const base = [
    // Fechado DENTRO do prazo.
    { n: 1, dia: 3, status: 'closed', dentro: 1, horas: 2, fila: FILAS[0], topico: TOPICOS[0],
      nivel: NIVEIS[0], prioridade: CRITICIDADES[1], assunto: 'Impressora sem resposta na recepção' },
    // Fechado FORA do prazo — sem ele o percentual seria 100% e não provaria conta nenhuma.
    { n: 2, dia: 6, status: 'closed', dentro: 0, horas: 51, fila: FILAS[1], topico: TOPICOS[1],
      nivel: NIVEIS[1], prioridade: CRITICIDADES[2], assunto: 'Lentidão no sistema de prescrição' },
    { n: 3, dia: 9, status: 'closed', dentro: 1, horas: 4, fila: FILAS[1], topico: TOPICOS[2],
      nivel: NIVEIS[0], prioridade: CRITICIDADES[1], assunto: 'Acesso bloqueado após troca de senha' },
    // Em ANDAMENTO e ABERTO: a contagem por status precisa dos três.
    { n: 4, dia: 14, status: 'in progress', dentro: 0, horas: null, fila: FILAS[2], topico: TOPICOS[3],
      nivel: NIVEIS[2], prioridade: CRITICIDADES[3], assunto: 'Divergência no faturamento do convênio' },
    { n: 5, dia: 18, status: 'open', dentro: 0, horas: null, fila: FILAS[0], topico: TOPICOS[0],
      nivel: NIVEIS[1], prioridade: CRITICIDADES[0], assunto: 'Ponto de rede sem link na ala B' },
    // SEM criticidade: é o caso que a criticidade padrão existe para resolver.
    { n: 6, dia: 21, status: 'closed', dentro: 1, horas: 6, fila: FILAS[2], topico: TOPICOS[2],
      nivel: '', prioridade: '', assunto: 'Solicitação de novo usuário' },
  ];

  return base.map((c) => {
    const abertoEm = instante(comp, c.dia, 9);
    const fechadoEm = /closed/.test(c.status) ? instante(comp, c.dia + 1, 11) : null;
    // O prazo é o que decide dentro/fora, e ele é escrito para CONCORDAR com
    // a marca: um prazo que contradissesse o `dentro` faria a conferência
    // medir a incoerência da base em vez da regra do produto.
    const prazoEm = fechadoEm
      ? instante(comp, c.dentro ? c.dia + 2 : c.dia, c.dentro ? 18 : 10)
      : instante(comp, c.dia + 2, 18);
    // O id do osTicket é NUMÉRICO, e é por ele que a tela monta o link de
    // volta para a origem. Guardá-lo como texto faria o link apontar para um
    // chamado que a base não reconhece como seu.
    const ticketId = 1000 + indiceDaEmpresa * 100 + c.n;
    const numero = String(ticketId);
    return {
      id: `OSTICK-${numero}`,
      sistema: 'OSTICK',
      ticketId,
      numero,
      assunto: c.assunto,
      descricao: 'Registro sintético da base local de testes.',
      status: c.status,
      nivel: c.nivel,
      prioridade: c.prioridade,
      setor: 'Não classificado',
      solicitante: `Solicitante ${c.n}`,
      email: null,
      atendente: `Atendente ${((c.n % 3) + 1)}`,
      fila: c.fila,
      topico: c.topico,
      filial,
      criadoEm: abertoEm,
      fechadoEm,
      prazoEm,
      horas: c.horas,
      origem: 'integracao',
      total: 1,
      dentro: c.dentro,
    };
  });
}

const meses = mesesFechados();
let documentos = 0;
let chamados = 0;
for (const [i, empresa] of empresas.entries()) {
  for (const comp of meses) {
    const itens = chamadosDoMes(comp, empresa, i);
    const doc = { empresa: empresa.id, competencia: comp, itens };
    fs.writeFileSync(
      path.join(DIR, `sla__${empresa.id}__${comp}.json`),
      `${JSON.stringify(doc, null, 2)}\n`,
    );
    documentos += 1;
    chamados += itens.length;
  }
}

console.log(
  `semeados ${chamados} chamado(s) sintético(s) em ${documentos} documento(s), `
  + `nas matrizes ${empresas.map((e) => e.id).join(', ')} e nos meses ${meses.join(', ')}.`,
);
console.log('Rode `node artifact/montar-teste.cjs` para a base local recolhê-los.');
