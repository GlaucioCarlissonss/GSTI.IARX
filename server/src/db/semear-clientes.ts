/**
 * Cadastra os clientes na base já existente.
 *
 *   npm --workspace server run semear-clientes -- --usuario=gestor
 *
 * O `--usuario` é quem passa a enxergar os três clientes; sem ele o cadastro é
 * criado sem dono de acesso, e ninguém abre o que foi cadastrado.
 *
 * É idempotente e NÃO sobrescreve: unidade que já existe é completada só nos
 * campos em branco, e rodar de novo não cria nada. O resumo ao final diz
 * exatamente o que foi criado, o que foi completado e o que ficou de fora.
 */
import { carregarAmbiente } from '../lib/ambiente.js';
carregarAmbiente();
import { db, emTransacao } from './index.js';
import { semearClientes } from './clientes-seed.js';
import { estruturaDoCliente, listarClientes } from '../domain/clientes.js';

const alvo = (process.argv.find((a) => a.startsWith('--usuario=')) ?? '').split('=')[1];

let usuarioId: number | undefined;
if (alvo) {
  const linha = db()
    .prepare('SELECT id, nome FROM usuarios WHERE username = ? OR email = ? OR id = ?')
    .get(alvo, alvo, Number(alvo) || -1) as { id: number; nome: string } | undefined;
  if (!linha) {
    console.error(`Usuário "${alvo}" não encontrado. Rode sem --usuario ou informe um username válido.`);
    process.exit(1);
  }
  usuarioId = linha.id;
  console.log(`Acesso será concedido a ${linha.nome} (#${linha.id}).`);
} else {
  console.log('Sem --usuario: o cadastro é criado, mas ninguém ganha acesso a ele.');
}

const resumo = emTransacao(() => semearClientes(usuarioId));

console.log('');
console.log(`clientes:    ${resumo.clientes}`);
console.log(`matrizes criadas: ${resumo.matrizes}`);
console.log(`filiais criadas:  ${resumo.filiais}`);
console.log(`unidades completadas (CNPJ/endereço/CEP): ${resumo.completadas}`);
console.log(`unidades da tabela sem correspondente na base: ${resumo.pendentes.join(', ') || 'nenhuma'}`);
console.log('');

for (const c of listarClientes()) {
  console.log(`# ${c.nome} — ${c.matrizes} matriz(es), ${c.filiais} filial(is)`);
  for (const m of estruturaDoCliente(c.id)) {
    console.log(`   · ${m.nome}${m.cnpj ? ' (' + m.cnpj + ')' : ''}`);
    for (const f of m.filiais) console.log(`       - ${f.nome}${f.cnpj ? ' (' + f.cnpj + ')' : ''}`);
  }
}
