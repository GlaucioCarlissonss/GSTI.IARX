/**
 * AS TELAS, CARREGADAS SOB DEMANDA.
 *
 * As 23 rotas viviam num `import` estático cada, e o resultado era um pacote
 * só: quem abria o Painel Executivo baixava também a tela de Planilhas, a de
 * Acessos e a de Auditoria — 10.622 linhas de página para ver uma.
 *
 * Aqui cada tela vira um `import()`, que o empacotador transforma num arquivo
 * próprio. O primeiro carregamento passa a trazer o esqueleto mais a tela
 * pedida; as outras chegam quando alguém for até elas.
 *
 * ## O preço disso, e o que o paga
 *
 * Dividir troca "baixar tudo uma vez" por "baixar um pedaço a cada navegação".
 * Numa rede ruim isso é uma pausa visível em cada clique do menu — trocar uma
 * espera no início por vinte espalhadas seria piorar.
 *
 * Duas coisas pagam esse preço:
 *
 * 1. **O módulo é carregado no `pointerenter` e no `focus` do link**, e não no
 *    clique. O dedo leva uns 100 ms entre apontar e apertar; o arquivo
 *    costuma chegar dentro dessa janela, e a navegação fica instantânea.
 * 2. **O esqueleto não é remontado.** O `Suspense` fica ao redor do `Outlet`,
 *    dentro do `Layout`: menu, cabeçalho e filtros continuam na tela, e só a
 *    área de conteúdo mostra que está carregando. Um `Suspense` acima do
 *    `Layout` apagaria a navegação inteira a cada clique.
 *
 * ## Por que o mapa fica num arquivo só
 *
 * O `prefetch` precisa alcançar o MESMO `import()` que a rota usa, senão o
 * navegador baixaria o arquivo duas vezes. Mantê-los lado a lado é o que
 * garante isso: a rota e o prefetch leem a mesma entrada deste mapa.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/** Um `import()` de tela, e o componente preguiçoso que sai dele. */
type Modulo = () => Promise<Record<string, unknown>>;

/**
 * Cada entrada: como buscar o módulo, e qual exportação dele é a tela.
 *
 * O nome da exportação é explícito porque várias telas moram no mesmo arquivo
 * — `Sla.tsx` tem duas, `Administracao.tsx` tem sete. Elas compartilham o
 * arquivo porque compartilham o assunto, e separá-las só para dividir o
 * pacote criaria sete arquivos de 200 linhas que ninguém pediu.
 */
const TELAS = {
  painelExecutivo: { rota: '/', de: () => import('./pages/PainelExecutivo'), nome: 'PaginaPainelExecutivo' },
  indicadores: { rota: '/indicadores', de: () => import('./pages/IndicadoresGerais'), nome: 'PaginaIndicadoresGerais' },
  financeiro: { rota: '/financeiro', de: () => import('./pages/Financeiro'), nome: 'PaginaFinanceiro' },
  lancamentos: { rota: '/lancamentos', de: () => import('./pages/Lancamentos'), nome: 'PaginaLancamentos' },
  conferencia: { rota: '/conferencia', de: () => import('./pages/Conferencia'), nome: 'PaginaConferencia' },
  relatorio: { rota: '/relatorio', de: () => import('./pages/Relatorio'), nome: 'PaginaRelatorio' },
  projetos: { rota: '/projetos', de: () => import('./pages/Projetos'), nome: 'PaginaProjetos' },
  cadastroProjetos: { rota: '/projetos/cadastro', de: () => import('./pages/CadastroProjetos'), nome: 'PaginaCadastroProjetos' },
  sla: { rota: '/sla', de: () => import('./pages/Sla'), nome: 'PaginaSla' },
  registrosSla: { rota: '/sla/registros', de: () => import('./pages/Sla'), nome: 'PaginaRegistrosSla' },
  ostick: { rota: '/suporte/ostick', de: () => import('./pages/Suporte'), nome: 'PaginaOstick' },
  bitrix24: { rota: '/suporte/bitrix24', de: () => import('./pages/Suporte'), nome: 'PaginaBitrix24' },
  integracoes: { rota: '/suporte/integracoes', de: () => import('./pages/Integracoes'), nome: 'PaginaIntegracoes' },
  planilhas: { rota: '/planilhas', de: () => import('./pages/Planilhas'), nome: 'PaginaPlanilhas' },
  clientes: { rota: '/clientes', de: () => import('./pages/Clientes'), nome: 'PaginaClientes' },
  acessos: { rota: '/acessos', de: () => import('./pages/Acessos'), nome: 'PaginaAcessos' },
  fechamentos: { rota: '/fechamentos', de: () => import('./pages/Administracao'), nome: 'PaginaFechamentos' },
  cadastros: { rota: '/cadastros', de: () => import('./pages/Administracao'), nome: 'PaginaCadastros' },
  metas: { rota: '/metas', de: () => import('./pages/Administracao'), nome: 'PaginaMetas' },
  slas: { rota: '/slas', de: () => import('./pages/Administracao'), nome: 'PaginaSlas' },
  reducao: { rota: '/reducao', de: () => import('./pages/Administracao'), nome: 'PaginaReducao' },
  reconhecedores: { rota: '/reconhecedores', de: () => import('./pages/Administracao'), nome: 'PaginaReconhecedores' },
  auditoria: { rota: '/auditoria', de: () => import('./pages/Administracao'), nome: 'PaginaAuditoria' },
} satisfies Record<string, { rota: string; de: Modulo; nome: string }>;

export type ChaveDeTela = keyof typeof TELAS;

/**
 * O caminho de cada rota, para o menu poder pedir o módulo pelo endereço do
 * link que a pessoa apontou. Sem ele, o prefetch teria de adivinhar a tela a
 * partir da URL — e adivinhação silenciosa erra sem avisar.
 *
 * É DERIVADO do mapa acima, e não escrito à mão: a rota e o `import()` dela
 * precisam ser a mesma verdade. Duas listas lado a lado divergem na primeira
 * tela que alguém acrescentar com pressa, e a divergência aqui não quebra
 * nada — só faz o prefetch buscar a tela errada, em silêncio.
 */
export const TELA_DA_ROTA: Record<string, ChaveDeTela> = Object.fromEntries(
  (Object.keys(TELAS) as ChaveDeTela[]).map((k) => [TELAS[k].rota, k]),
) as Record<string, ChaveDeTela>;

/**
 * Pede o módulo de uma tela ANTES de ela ser necessária.
 *
 * Chamar duas vezes é de graça: o navegador memoriza o `import()` e devolve a
 * mesma promessa. Por isso o menu pode chamar a cada passada do mouse sem
 * contar quantas vezes já chamou.
 *
 * A falha é engolida de propósito. Isto é uma antecipação, não a navegação:
 * se a rede cair agora, o clique vai tentar de novo e aí sim o erro tem onde
 * aparecer. Avisar aqui seria assustar quem só passou o mouse por cima.
 */
export function adiantar(rota: string) {
  const chave = TELA_DA_ROTA[rota];
  if (chave) void TELAS[chave].de().catch(() => {});
}

/** O componente preguiçoso de uma tela, pronto para a rota. */
type Tela = LazyExoticComponent<ComponentType>;

const tela = (chave: ChaveDeTela): Tela => {
  const { de, nome } = TELAS[chave];
  return lazy(async () => {
    const mod = (await de()) as Record<string, unknown>;
    const Componente = mod[nome];
    if (typeof Componente !== 'function') {
      // Um nome errado aqui daria uma tela branca sem explicação. O mapa é
      // digitado à mão e o TypeScript não alcança a indexação por string;
      // falhar dizendo QUAL entrada está errada é o que torna isto corrigível.
      throw new Error(`Tela "${chave}": o módulo não exporta "${nome}".`);
    }
    return { default: Componente as ComponentType };
  });
};

export const Telas = Object.fromEntries(
  (Object.keys(TELAS) as ChaveDeTela[]).map((k) => [k, tela(k)]),
) as Record<ChaveDeTela, Tela>;
