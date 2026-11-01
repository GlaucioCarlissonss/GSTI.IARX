/**
 * Base isolada para conferir, no navegador, o que o PERFIL governa.
 *
 * Dois usuários no MESMO cliente: um que edita e um que só lê. É o mínimo
 * para a pergunta ter duas respostas — com um usuário só, o menu e os botões
 * seriam sempre os mesmos, e a conferência passaria sem provar nada.
 *
 * Esta base existia só no cabeçalho de `web/verificar-perfil.cjs`, como uma
 * instrução para montar à mão ("suba o servidor com uma base isolada e dois
 * usuários"). Ninguém montava: a conferência morria no login há meses, e uma
 * varredura que contava linhas de "✗" a dava como limpa — porque uma suíte
 * que morre antes da primeira asserção não imprime falha nenhuma.
 *
 *   DATABASE_PATH=/tmp/verif-perfis.sqlite npx tsx src/db/preparar-perfis.ts
 */
import { carregarAmbiente } from '../lib/ambiente.js';
carregarAmbiente();
import { db } from './index.js';
import { registrar } from '../domain/auth.js';
import { criarUsuario } from '../domain/usuarios.js';
import { criarEmpresa } from '../domain/empresas.js';
import { criarFilial } from '../domain/cadastros.js';
import { criarLancamento } from '../domain/financeiro.js';
import { competenciaAtual, paraExibicao } from '../domain/competencia.js';
import { garantirPerfisPadrao, PERFIL_LEITURA } from '../domain/acesso.js';
import type { Contexto } from '../domain/contexto.js';

const SENHA = process.env.SENHA_VERIFICACAO || 'varredura2026';

const gestor = registrar({
  nome: 'Gestor de TI',
  email: 'gestor@exemplo.com',
  senha: SENHA,
  username: 'gestor',
});
const empresa = criarEmpresa(gestor.id, { nome: 'Contratante Único' });
const clienteId = empresa.cliente_id!;

// Os dois perfis padrão nascem com o cliente; é um deles que a leitora recebe.
garantirPerfisPadrao(clienteId);

const ctx: Contexto = {
  clienteId,
  empresaIds: [empresa.id],
  empresaId: empresa.id,
  usuarioId: gestor.id,
  usuarioEmail: gestor.email,
  papel: 'gestor',
};

const filial = criarFilial(ctx, { nome: 'Unidade Central' }) as { id: number };

// Dado de verdade na tela: um menu vazio esconderia a diferença entre "o
// perfil não deixa ver" e "não há o que ver".
const tipo = (
  db()
    .prepare('SELECT id FROM tipos_despesa WHERE empresa_id = ? AND nome = ?')
    .get(empresa.id, 'Licenças de Softwares') as { id: number }
).id;
criarLancamento(ctx, {
  filialId: filial.id,
  tipoDespesaId: tipo,
  competencia: paraExibicao(competenciaAtual()),
  valor: 4200,
  natureza: 'fixa',
  classificacao: 'despesa',
  descricao: 'Licença de antivírus',
});

/**
 * A LEITORA.
 *
 * O perfil mora no vínculo com o CLIENTE, e não no usuário: a mesma pessoa
 * pode editar num contratante e só ler em outro. O `papel` da matriz continua
 * existindo como piso para quem não tem perfil atribuído, e aqui ele é
 * `leitor` para os dois caminhos concordarem.
 */
const perfilLeitura = db()
  .prepare('SELECT id FROM perfis WHERE cliente_id = ? AND nome = ?')
  .get(clienteId, PERFIL_LEITURA) as { id: number } | undefined;
if (!perfilLeitura) throw new Error(`O perfil "${PERFIL_LEITURA}" não nasceu com o cliente.`);

// Pelo caminho ADMINISTRATIVO, e não por `registrar`: o auto-cadastro fecha
// depois da primeira conta, e é assim que uma segunda pessoa entra de verdade
// — um gestor a convida. Montar a base por um atalho que a instalação não
// oferece deixaria a conferência medindo um estado impossível.
const leitora = criarUsuario(ctx, {
  nome: 'Leitora',
  email: 'leitora@exemplo.com',
  username: 'leitora',
  senha: SENHA,
  papel: 'leitor',
  perfil_id: perfilLeitura.id,
});

console.log(
  `base de perfis pronta: cliente "${empresa.nome}" · `
  + `gestor (edita) e ${leitora.username} (perfil "${PERFIL_LEITURA}") · senha de verificação`,
);
