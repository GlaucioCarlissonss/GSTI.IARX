// Converte a base do osTicket nos documentos de SLA do sistema.
//
// Um chamado vira um registro de SLA com total=1 e dentro=1|0, o que faz toda
// a agregação existente (por fila, por tópico, por filial, percentuais) valer
// sem mudança — e ainda guarda o ticket_id, que é o que permite voltar ao
// chamado no osTicket.
const fs = require('fs');

// Uso: node scripts/gerar-sla.cjs <csv-do-osticket> <pasta-de-saida>
const CSV = process.argv[2] || 'dados-origem/chamados.csv';
const SAIDA = process.argv[3] || 'dados-origem/sla';
const HORAS_SLA = 48;              // "Padrão SLA": a própria tela mostra criação + 48h

// --- decisões de mapeamento, confirmadas com o gestor -----------------------
const ORG = {
  'PB - Hospital Residencial': ['residencial', 'HR JP'],
  'PE - Hospital Residencial': ['residencial', 'HR PE'],
  'RN - Hospital Residencial': ['residencial', 'HR RN'],
  'BA - Hospital Residencial': ['residencial', 'HR BA'],
  'AL - Hospital Residencial': ['residencial', 'HR AL'],
  'HR - Urgência Emergência':  ['residencial', null],
  'indefinido':                ['residencial', null],
  'PB - Hospital Milagres':    ['milagres', 'HM PB'],
  'MT - Hospital Milagres':    ['milagres', 'HM MT'],
  'DF - Hospital Milagres':    ['milagres', 'HM DF'],
  'GO - Hospital Milagres':    ['milagres', 'HM GO'],
  'CE - Hospital Milagres':    ['milagres', 'HM CE'],
  'AM - Hospital Milagres':    ['milagres', 'HM AM'],
  'RO - Hospital Milagres':    ['milagres', 'HM RO'],
  'HM - PB / EMAD':            ['milagres', 'HM PB'],
  'RN - Aliança':              ['alianca', 'AHC RN'],
  'SE - Aliança':              ['alianca', 'AHC SE'],
  'UNION CARE - RJ':           ['union', 'UC RJ'],
  'MOOVE':                     ['moove', 'MOOVE'],
};

/** Fila a partir do tópico do osTicket. */
function filaDe(topico) {
  if (/^TI - Infra/.test(topico)) return 'Infraestrutura';
  if (/^TI - (IW|FOC|Sistemas)/.test(topico)) return 'Sistema';
  if (/^TI - Dados/.test(topico)) return 'Dados';
  // Identidade, segurança e aquisição de equipamento são demanda de infra.
  if (/^TI - (Reset de Senha|Segurança|Aquisição)/.test(topico)) return 'Infraestrutura';
  if (/^TI - /.test(topico)) return 'Outros';
  return 'Fora de TI';
}

const dt = (s) => {
  if (!s || s === 'NULL') return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(String(s).trim());
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5])) : null;
};
const iso = (d) => (d ? d.toISOString().slice(0, 16) + 'Z' : null);
const comp = (d) => d.toISOString().slice(0, 7);

const linhas = fs.readFileSync(CSV, 'utf8').split(/\r?\n/).filter(Boolean);
const cab = linhas.shift().split(';');
const reg = linhas.map((l) => {
  const c = l.split(';');
  return Object.fromEntries(cab.map((k, i) => [k, c[i]]));
});

// Referência para chamados ainda abertos: o momento da extração. Guardada no
// documento, para o cálculo poder ser refeito e conferido.
const extraidoEm = new Date(Math.max(...reg.map((r) => (dt(r.updated) || dt(r.created)).getTime())));

const porDoc = new Map();
const relatorio = { total: reg.length, importados: 0, descartados: {}, semData: 0 };

for (const r of reg) {
  const criado = dt(r.created);
  if (!criado) { relatorio.semData++; continue; }

  const destino = ORG[r.organizacao];
  if (!destino) {
    relatorio.descartados[r.organizacao] = (relatorio.descartados[r.organizacao] || 0) + 1;
    continue;
  }
  const [empresa, filial] = destino;

  const prazo = new Date(criado.getTime() + HORAS_SLA * 36e5);
  const fechado = dt(r.closed);
  // Chamado ainda aberto é medido contra o momento da extração: um chamado
  // vencido e sem fechar está fora do SLA, não "ainda dentro".
  const referencia = fechado || extraidoEm;
  const dentro = referencia <= prazo ? 1 : 0;

  const chave = empresa + '__' + comp(criado);
  if (!porDoc.has(chave)) porDoc.set(chave, { empresa, competencia: comp(criado), itens: [] });
  porDoc.get(chave).itens.push({
    id: 't' + r.ticket_id,
    filial,
    fila: filaDe(r.topico),
    topico: r.topico,
    total: 1,
    dentro,
    // --- detalhe do chamado, para poder voltar ao osTicket
    ticketId: Number(r.ticket_id),
    numero: r.number,
    assunto: r.subject || null,
    solicitante: r.solicitante || null,
    atendente: r.atendente || null,
    nivel: r.departamento || null,
    status: r.status === 'NULL' ? null : r.status,
    origem: r.source || null,
    criadoEm: iso(criado),
    fechadoEm: iso(fechado),
    prazoEm: iso(prazo),
    horas: fechado ? Math.round((fechado - criado) / 36e5 * 10) / 10 : null,
  });
  relatorio.importados++;
}

fs.rmSync(SAIDA, { recursive: true, force: true });
fs.mkdirSync(SAIDA, { recursive: true });
let maior = 0, maiorNome = '';
for (const [chave, doc] of porDoc) {
  doc.extraidoEm = iso(extraidoEm);
  doc.itens.sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)));
  const texto = JSON.stringify(doc);
  fs.writeFileSync(`${SAIDA}/sla__${chave}.json`, texto);
  if (texto.length > maior) { maior = texto.length; maiorNome = chave; }
}

console.log('extraído em:', iso(extraidoEm));
console.log('chamados no arquivo:', relatorio.total);
console.log('importados:', relatorio.importados, `(${(relatorio.importados / relatorio.total * 100).toFixed(1)}%)`);
console.log('sem data de criação:', relatorio.semData);
console.log('descartados (fora das 5 empresas):',
  Object.values(relatorio.descartados).reduce((s, n) => s + n, 0));
Object.entries(relatorio.descartados).sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log('   ', String(v).padStart(3), k));
console.log('\ndocumentos gerados:', porDoc.size);
console.log('maior documento:', maiorNome, (maior / 1024).toFixed(1), 'KiB (limite 256 KiB)');

const porEmp = {};
for (const d of porDoc.values()) {
  porEmp[d.empresa] = porEmp[d.empresa] || { n: 0, dentro: 0 };
  porEmp[d.empresa].n += d.itens.length;
  porEmp[d.empresa].dentro += d.itens.reduce((s, i) => s + i.dentro, 0);
}
console.log('\n--- por empresa ---');
for (const [e, v] of Object.entries(porEmp).sort((a, b) => b[1].n - a[1].n)) {
  console.log('  ' + e.padEnd(12), String(v.n).padStart(5), 'chamados ·',
    (v.dentro / v.n * 100).toFixed(1) + '% dentro do SLA');
}
const tot = Object.values(porEmp).reduce((a, v) => ({ n: a.n + v.n, dentro: a.dentro + v.dentro }), { n: 0, dentro: 0 });
console.log('  ' + 'TOTAL'.padEnd(12), String(tot.n).padStart(5), 'chamados ·',
  (tot.dentro / tot.n * 100).toFixed(1) + '% dentro do SLA');
