// Uma base SINTÉTICA mínima em `artifact/dados/`, para a suíte de projeção
// poder rodar onde a base real não existe.
//
// `artifact/dados/` é a base do cliente e fica fora do git de propósito — ela
// tem nome de fornecedor, valor de contrato e unidade. Num contêiner limpo
// ela não vem, e sem ela `montar-teste.cjs` não monta: a bateria inteira para.
//
// Este script escreve um contratante inventado, com uma unidade e dois tipos
// de despesa, e NADA mais. Nenhum número aqui veio de lugar nenhum; a suíte
// lança o que precisa por cima, dentro da própria página.
//
//   node semear-projecao.cjs && node montar-teste.cjs
//
// Ele RECUSA sobrescrever uma base existente: rodá-lo por engano em cima da
// base real apagaria o que o gestor carregou.
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'dados');
const EMPRESA = 'contratante-de-projecao';
const CLIENTE = 'cli-projecao';

if (fs.existsSync(DIR) && fs.readdirSync(DIR).some((f) => f.endsWith('.json'))) {
  const sinteticos = fs.existsSync(path.join(DIR, '_sintetico.json'));
  if (!sinteticos) {
    console.error('dados/ já tem documentos e NÃO foi semeado por este script.');
    console.error('Recusando sobrescrever: pode ser a base real do cliente.');
    console.error('Para refazer a base sintética, apague dados/ à mão primeiro.');
    process.exit(1);
  }
}

const hoje = new Date();
const comp = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;

const docs = {
  'catalogo__clientes': { itens: [{ id: CLIENTE, nome: 'Contratante de Projeção', ativo: true }] },
  'catalogo__empresas': { itens: [{ id: EMPRESA, nome: 'Contratante de Projeção', cliente: CLIENTE }] },
  'catalogo__filiais': { itens: [{ empresa: EMPRESA, nome: 'Unidade Central' }] },
  'catalogo__tipos': {
    itens: [
      { empresa: EMPRESA, nome: 'Licenças de Softwares', fixa: true },
      { empresa: EMPRESA, nome: 'Telefonia/Internet', fixa: true },
    ],
  },
  'catalogo__cenarios': { itens: [{ empresa: EMPRESA, chave: 'oficial', nome: 'Oficial' }] },
  // Os demais catálogos existem vazios: a tela os lê sempre, e um documento
  // ausente e um documento vazio seguem o mesmo caminho — mas deixá-los
  // escritos torna explícito que a base é completa, e não truncada.
  'catalogo__filas': { itens: [] },
  'catalogo__metas': { itens: [] },
  'catalogo__slasCad': { itens: [] },
  'catalogo__reducao': { itens: [] },
  'catalogo__reconhecedores': { itens: [] },
  'catalogo__spincare': { itens: [] },
  'catalogo__feriados': { itens: [] },
  [`lanc__${EMPRESA}__${comp}`]: { empresa: EMPRESA, competencia: comp, itens: [] },
};

fs.mkdirSync(DIR, { recursive: true });
for (const [nome, valor] of Object.entries(docs)) {
  fs.writeFileSync(path.join(DIR, `${nome}.json`), JSON.stringify(valor, null, 0));
}
// A marca que permite re-semear sem perguntar, e impede o script de passar por
// cima de uma base que ele não criou.
// Prefixo `_`: `montar-teste.cjs` trata arquivo assim como metadado da pasta,
// e não como documento do banco.
fs.writeFileSync(path.join(DIR, '_sintetico.json'),
  JSON.stringify({ origem: 'semear-projecao.cjs', criado_em: new Date().toISOString() }));

console.log(`base sintética escrita: ${Object.keys(docs).length} documentos · competência ${comp}`);
console.log('nenhum dado de cliente — a suíte lança o que precisa dentro da página.');
