/**
 * Base isolada para conferir, no navegador, a tela de escolha de cliente.
 *
 * Dois clientes com uma matriz cada: é o mínimo para a pergunta "qual cliente?"
 * ter mais de uma resposta, que é o caso que a tela existe para resolver.
 *
 *   DATABASE_PATH=/tmp/verif.sqlite npx tsx src/db/preparar-verificacao.ts
 */
import { carregarAmbiente } from '../lib/ambiente.js';
carregarAmbiente();
import { db } from './index.js';
import { registrar } from '../domain/auth.js';
import { criarEmpresa } from '../domain/empresas.js';
import { criarCliente, criarMatriz, vincularUsuario } from '../domain/clientes.js';

const usuario = registrar({
  nome: 'Gestora',
  email: 'gestora@exemplo.com',
  senha: process.env.SENHA_VERIFICACAO || 'varredura2026',
  username: 'gestora',
});
criarEmpresa(usuario.id, { nome: 'ALIANÇA' });

const outro = criarCliente({ nome: 'Limas IT' });
vincularUsuario(usuario.id, outro.id);
const matriz = criarMatriz(outro.id, { nome: 'Limas IT — Matriz' }) as { id: number };
// Sem o vínculo de empresa a matriz do segundo cliente não chega ao seletor: o
// acesso ao cliente e o acesso à matriz são duas concessões distintas.
db()
  .prepare("INSERT INTO usuario_empresas (usuario_id, empresa_id, papel) VALUES (?, ?, 'gestor')")
  .run(usuario.id, matriz.id);

console.log('base pronta: usuário gestora, clientes ' + [outro.nome, 'ALIANÇA'].join(' e '));
