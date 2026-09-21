/**
 * Base isolada para conferir, no navegador, as telas das Fases 2 e 3.
 *
 * `preparar-verificacao.ts` monta o caso de DOIS clientes, que é a pergunta da
 * tela de escolha. Aqui o caso é outro: um cliente com DUAS matrizes e filiais
 * em cada, porque é essa a forma que faz "paga uma, consome outra" existir —
 * com uma unidade só, a classificação de consumo não teria o que mostrar.
 *
 *   DATABASE_PATH=/tmp/verif-v2.sqlite npx tsx src/db/preparar-verificacao-v2.ts
 *
 * Nunca aponte para `data/gsti.sqlite`: este script escreve.
 */
import { carregarAmbiente } from '../lib/ambiente.js';
carregarAmbiente();
import { db } from './index.js';
import { registrar } from '../domain/auth.js';
import { criarEmpresa } from '../domain/empresas.js';
import { criarMatriz } from '../domain/clientes.js';
import { criarFilial } from '../domain/cadastros.js';
import { criarLancamento } from '../domain/financeiro.js';
import { comEmpresaEmFoco } from '../domain/escopo.js';
import { gravarChamado } from '../domain/suporte.js';
import { criarProjeto, criarTarefa } from '../domain/projetos.js';
import { criarPlano } from '../domain/reducao.js';
import { clienteDaEmpresa } from '../domain/clientes.js';
import { competenciaAtual, paraExibicao, somarMeses } from '../domain/competencia.js';
import type { Contexto } from '../domain/contexto.js';

const usuario = registrar({
  nome: 'Gestora',
  email: 'gestora@exemplo.com',
  senha: process.env.SENHA_VERIFICACAO || 'varredura2026',
  username: 'gestora',
});

const holding = criarEmpresa(usuario.id, { nome: 'Holding TI' });
const clienteId = clienteDaEmpresa(holding.id)!;
const hospital = criarMatriz(clienteId, { nome: 'Hospital Norte' }) as { id: number };
db()
  .prepare("INSERT INTO usuario_empresas (usuario_id, empresa_id, papel) VALUES (?, ?, 'gestor')")
  .run(usuario.id, hospital.id);

const ctx: Contexto = {
  clienteId,
  empresaIds: [holding.id, hospital.id],
  empresaId: holding.id,
  usuarioId: usuario.id,
  usuarioEmail: usuario.email,
  papel: 'gestor',
};

const sede = criarFilial(ctx, { nome: 'Sede', cidade: 'Natal', uf: 'RN' });
const unidadeNorte = criarFilial(comEmpresaEmFoco(ctx, hospital.id), {
  nome: 'Unidade Norte',
  cidade: 'Cuiabá',
  uf: 'MT',
});

const tipo = (
  db()
    .prepare('SELECT id FROM tipos_despesa WHERE empresa_id = ? AND nome = ?')
    .get(holding.id, 'Licenças de Softwares') as { id: number }
).id;

const mes = paraExibicao(competenciaAtual());

// A licença que a holding paga e a unidade do hospital usa: é o caso que o
// campo de consumo existe para descrever.
criarLancamento(ctx, {
  filialId: sede.id,
  tipoDespesaId: tipo,
  competencia: mes,
  valor: 12000,
  natureza: 'fixa',
  classificacao: 'despesa',
  descricao: 'Licença corporativa de antivírus',
  tipoConsumo: 'compartilhado',
  beneficiadas: [unidadeNorte.id],
});

// E uma despesa que é só da própria unidade, para a tela ter os dois casos.
criarLancamento(ctx, {
  filialId: sede.id,
  tipoDespesaId: tipo,
  competencia: mes,
  valor: 3000,
  natureza: 'fixa',
  classificacao: 'despesa',
  descricao: 'Telefonia da sede',
});

// Um projeto com tarefa entregue: sem ele a tela de Projetos abre vazia, e a
// varredura não teria como distinguir "tela quebrada" de "base sem projeto".
const projeto = criarProjeto(ctx, {
  nome: 'Troca do parque de impressoras',
  mesInicio: paraExibicao(somarMeses(competenciaAtual(), -2)),
  mesFimPlanejado: mes,
  status: 'em_andamento',
});
criarTarefa(ctx, projeto.id, {
  nome: 'Levantamento das unidades',
  mesInicio: paraExibicao(somarMeses(competenciaAtual(), -2)),
  mesFimPlanejado: paraExibicao(somarMeses(competenciaAtual(), -1)),
  mesFimReal: paraExibicao(somarMeses(competenciaAtual(), -1)),
  status: 'concluida',
});
criarTarefa(ctx, projeto.id, {
  nome: 'Instalação na Unidade Norte',
  mesInicio: paraExibicao(somarMeses(competenciaAtual(), -1)),
  mesFimPlanejado: mes,
});

// Um item no plano de redução: sem ele o indicador do topo abre vazio, e a
// varredura não teria como distinguir "tela quebrada" de "nada cadastrado".
criarPlano(ctx, {
  nome: 'Corte de licenças',
  tipo_despesa_id: tipo,
  valor_alvo: 8000,
});

// 'Infraestrutura' já vem como fila padrão de toda empresa nova.
gravarChamado(
  holding.id,
  {
    source_system: 'OSTICK',
    external_id: 'V2-1',
    title: 'Impressora parada na farmácia',
    description: 'Fila de impressão travada.',
    status: 'closed',
    priority: 'low',
    sector: 'Enfermagem',
    branch: null,
    queue: 'Infraestrutura',
    topic: 'Rede',
    requester_id: null,
    requester_name: 'Farmácia',
    requester_email: null,
    attendant_id: null,
    attendant_name: 'Suporte',
    opened_at: new Date(Date.now() - 6 * 3600_000).toISOString(),
    closed_at: new Date(Date.now() - 1 * 3600_000).toISOString(),
    due_at: null,
    hours: 5,
  },
  { origem: 'preparar-verificacao-v2' },
);

console.log(
  `base v2 pronta: usuário gestora · cliente com 2 matrizes (Holding TI, Hospital Norte) · ` +
    `2 filiais · 2 lançamentos (1 compartilhado) · 1 projeto com 2 tarefas · 1 chamado · 1 item no plano de redução`,
);
