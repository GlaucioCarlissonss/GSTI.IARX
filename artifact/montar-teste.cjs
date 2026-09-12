// Gera teste-local.html: sistema.html + window.claude simulado sobre artifact/dados/.
// Os JSON em dados/ vêm de `Artifact read_db` e contêm dados reais — ficam fora do git.
const fs = require('fs');
const base = {};
for (const dir of ['dados']) {
  for (const f of fs.readdirSync(dir)) {
    if (f === '_indice.json') continue;
    const [col, id] = f.replace(/\.json$/, '').split('__');
    const rest = f.replace(/\.json$/, '').split('__').slice(1).join('__');
    base[col + '/' + rest] = JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8'));
  }
}
const mock = `<script>
const BASE_TESTE = ${JSON.stringify(base)};
const _mem = JSON.parse(JSON.stringify(BASE_TESTE));
// A busca ?somenteLeitura=1 imita a recusa de escrita que o armazenamento aplica a
// quem recebeu o link só para ver: o código de erro é o mesmo que o contrato do
// db promete, para a tela ser exercitada pelo caminho de verdade.
const _soLeitura = new URLSearchParams(location.search).get('somenteLeitura') === '1';
function _recusar() {
  const e = new Error('write denied by access rules');
  e.code = 'invalid_argument';
  throw e;
}
function _doc(p) {
  return {
    async get() { const d = _mem[p]; return { exists: !!d, id: p.split('/').pop(), data: () => d }; },
    async set(v) { if (_soLeitura) _recusar(); _mem[p] = JSON.parse(JSON.stringify(v)); },
    async update(v) { if (_soLeitura) _recusar(); _mem[p] = { ...(_mem[p]||{}), ...JSON.parse(JSON.stringify(v)) }; },
    async delete() { if (_soLeitura) _recusar(); delete _mem[p]; },
  };
}
function _col(c) {
  const filtros = [];
  const api = {
    where(f, op, v) { filtros.push([f, op, v]); return api; },
    orderBy() { return api; }, limit() { return api; },
    async get() {
      const docs = Object.entries(_mem)
        .filter(([k]) => k.startsWith(c + '/'))
        .map(([k, v]) => ({ id: k.slice(c.length+1), data: () => v }))
        .filter((d) => filtros.every(([f, op, val]) => op === '==' ? d.data()[f] === val : true));
      return { docs, empty: docs.length === 0 };
    },
  };
  return api;
}
window.claude = { use: async (n) => n === 'db' ? { doc: _doc, collection: _col } : null };
window.__mem = _mem;
</script>`;
const html = fs.readFileSync('sistema.html', 'utf8');
fs.writeFileSync('teste-local.html', mock + html);
console.log('docs no mock:', Object.keys(base).length, '| bytes:', fs.statSync('teste-local.html').size);
