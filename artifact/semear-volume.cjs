// Uma base SINTÉTICA com VOLUME, para medir desempenho.
//
// `semear-projecao.cjs` cria o mínimo para a regra de projeção ser exercida:
// dois lançamentos. Serve para provar a REGRA e não serve para medir NADA —
// numa base de dois registros toda tela desenha em 1 ms, e qualquer
// otimização "melhora" zero porque não havia o que melhorar.
//
// Aqui o objetivo é outro: aproximar a ordem de grandeza da base real do
// cliente, que tem dois anos de histórico e centenas de lançamentos por mês.
// Nenhum número daqui veio de lugar nenhum — fornecedores, valores e
// descrições são inventados, e é justamente por isso que este arquivo pode
// existir no repositório enquanto `dados/` não pode.
//
//   node semear-volume.cjs && node montar-teste.cjs
//   CHROMIUM_BIN=/opt/pw-browsers/chromium node medir-render.cjs
//
// Ele RECUSA sobrescrever uma base que não criou: rodá-lo por engano em cima
// da base real apagaria o que o gestor carregou.
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'dados');
const CLIENTE = 'cli-volume';
const MESES = Number(process.env.MESES || 24);
const POR_MES = Number(process.env.POR_MES || 180);

if (fs.existsSync(DIR) && fs.readdirSync(DIR).some((f) => f.endsWith('.json'))) {
  if (!fs.existsSync(path.join(DIR, '_sintetico.json'))) {
    console.error('dados/ já tem documentos e NÃO foi semeado por um script destes.');
    console.error('Recusando sobrescrever: pode ser a base real do cliente.');
    console.error('Para refazer a base sintética, apague dados/ à mão primeiro.');
    process.exit(1);
  }
}

// Gerador determinístico: a mesma semente dá a mesma base, e duas medições
// feitas em dias diferentes continuam comparáveis. Com `Math.random()` a
// comparação antes/depois mediria também a diferença entre as duas bases.
let semente = 20261011;
const sorteio = () => {
  semente = (semente * 1664525 + 1013904223) % 4294967296;
  return semente / 4294967296;
};
const umDe = (lista) => lista[Math.floor(sorteio() * lista.length)];

const EMPRESAS = [
  { id: 'emp-holding', nome: 'Holding de Volume' },
  { id: 'emp-norte', nome: 'Unidade Norte' },
];
const FILIAIS = ['Matriz', 'Filial Centro', 'Filial Sul', 'Filial Leste', 'CD Logística'];
const TIPOS_FIXOS = ['Licenças de Softwares', 'Telefonia/Internet', 'Links e Conectividade',
  'Suporte Terceirizado', 'Nuvem e Hospedagem', 'Manutenção de Equipamentos'];
const TIPOS_PONTUAIS = ['Equipamentos', 'Consultoria', 'Treinamento'];
const FORNECEDORES = ['ALFA TECNOLOGIA', 'BETA SISTEMAS', 'GAMA TELECOM', 'DELTA CLOUD',
  'EPSILON SUPORTE', 'ZETA SOFTWARE', 'ETA REDES', 'THETA DATACENTER', 'IOTA SEGURANCA',
  'KAPPA LICENCAS', 'LAMBDA LINKS', 'MI INFRAESTRUTURA'];

const hoje = new Date();
const mesIdx = (a, m) => a * 12 + (m - 1);
const mesDe = (n) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
const base = mesIdx(hoje.getFullYear(), hoje.getMonth() + 1);

let seq = 0;
const novoId = () => 'v' + (seq++).toString(36).padStart(6, '0');

const docs = {
  'catalogo__clientes': { itens: [{ id: CLIENTE, nome: 'Contratante de Volume', ativo: true }] },
  'catalogo__empresas': { itens: EMPRESAS.map((e) => ({ ...e, cliente: CLIENTE })) },
  'catalogo__filiais': { itens: EMPRESAS.flatMap((e) => FILIAIS.map((nome) => ({ empresa: e.id, nome }))) },
  'catalogo__tipos': {
    itens: EMPRESAS.flatMap((e) => [
      ...TIPOS_FIXOS.map((nome) => ({ empresa: e.id, nome, fixa: true })),
      ...TIPOS_PONTUAIS.map((nome) => ({ empresa: e.id, nome, fixa: false })),
    ]),
  },
  'catalogo__cenarios': { itens: EMPRESAS.map((e) => ({ empresa: e.id, chave: 'oficial', nome: 'Oficial' })) },
  'catalogo__filas': { itens: [] },
  'catalogo__metas': { itens: [] },
  'catalogo__slasCad': { itens: [] },
  'catalogo__reducao': { itens: [] },
  'catalogo__reconhecedores': { itens: [] },
  'catalogo__spincare': { itens: [] },
  'catalogo__feriados': { itens: [] },
};

// Contratos recorrentes de verdade: a MESMA chave (fornecedor + descrição +
// tipo + filial) reaparece mês a mês. É isso que faz o motor de projeção ter
// o que agrupar — uma base de linhas aleatórias viraria milhares de contratos
// de uma ocorrência cada, que não é a forma da base real.
const contratos = [];
for (const emp of EMPRESAS) {
  for (let i = 0; i < Math.round(POR_MES * 0.7); i++) {
    contratos.push({
      empresa: emp.id,
      filial: sorteio() < 0.2 ? null : umDe(FILIAIS),
      tipo: umDe(TIPOS_FIXOS),
      fornecedor: umDe(FORNECEDORES),
      descricao: `Contrato ${i + 1}`,
      valor: Math.round((200 + sorteio() * 9800) * 100) / 100,
      // Um em cada dez nasce com vigência, para a lista de contratos
      // projetados ter os dois casos.
      ate: sorteio() < 0.1 ? mesDe(base + 1 + Math.floor(sorteio() * 10)) : null,
    });
  }
}

let total = 0;
for (let k = MESES - 1; k >= 0; k--) {
  const comp = mesDe(base - k);
  for (const emp of EMPRESAS) {
    const itens = [];
    for (const c of contratos.filter((x) => x.empresa === emp.id)) {
      // Nem todo contrato aparece em todo mês: alguns começam depois, outros
      // somem. É a bagunça que a base real tem, e é ela que dá trabalho ao
      // agrupamento.
      if (sorteio() < 0.06) continue;
      itens.push({
        id: novoId(), grupo: novoId(), origem: 'manual',
        filial: c.filial, tipo: c.tipo, natureza: 'fixa', classificacao: 'despesa',
        cenario: 'oficial', fornecedor: c.fornecedor, descricao: c.descricao,
        // Reajuste de alguns por cento ao longo do tempo.
        valor: Math.round(c.valor * (1 + (MESES - k) * 0.004) * 100) / 100,
        tipoConsumo: 'integral', beneficiadas: [], beneficiaTodas: false,
        recorrenciaAte: c.ate,
        reconhecido: sorteio() < 0.8,
      });
    }
    // E os pontuais, que não projetam mas entram em toda soma e em toda tela.
    for (let i = 0; i < Math.round(POR_MES * 0.3); i++) {
      itens.push({
        id: novoId(), grupo: novoId(), origem: 'manual',
        filial: sorteio() < 0.2 ? null : umDe(FILIAIS),
        tipo: umDe(TIPOS_PONTUAIS), natureza: 'pontual_unica',
        classificacao: sorteio() < 0.25 ? 'investimento' : 'despesa',
        cenario: 'oficial', fornecedor: umDe(FORNECEDORES),
        descricao: `Aquisição ${comp}-${i}`,
        valor: Math.round((300 + sorteio() * 14700) * 100) / 100,
        tipoConsumo: 'integral', beneficiadas: [], beneficiaTodas: false,
        reconhecido: sorteio() < 0.8,
      });
    }
    docs[`lanc__${emp.id}__${comp}`] = { empresa: emp.id, competencia: comp, itens };
    total += itens.length;
  }
}

fs.mkdirSync(DIR, { recursive: true });
for (const [nome, valor] of Object.entries(docs)) {
  fs.writeFileSync(path.join(DIR, `${nome}.json`), JSON.stringify(valor, null, 0));
}
fs.writeFileSync(path.join(DIR, '_sintetico.json'),
  JSON.stringify({ origem: 'semear-volume.cjs', criado_em: new Date().toISOString() }));

console.log(`base de volume: ${total} lançamentos · ${MESES} meses · ${EMPRESAS.length} matrizes `
  + `· ${contratos.length} contratos recorrentes · ${Object.keys(docs).length} documentos`);
console.log('tudo inventado — nenhum dado de cliente.');
