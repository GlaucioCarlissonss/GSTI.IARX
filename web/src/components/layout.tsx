import { NavLink, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { Modal } from './base';
import { useSessao } from '../lib/sessao';
import { useLimparFiltros } from '../lib/filtros';
import { ICONE_TEMA, ROTULO_TEMA, useTema } from '../lib/tema';

// O menu é o desenho dos módulos do negócio. Quem trabalha com dinheiro não
// precisa esbarrar em chamado, e vice-versa. `Sistema` guarda o que atravessa
// os três — planilha, cadastro e auditoria — e por isso não cabe em nenhum.
const NAVEGACAO = [
  {
    grupo: 'Controle Financeiro',
    itens: [
      { para: '/', glifo: '◆', rotulo: 'Painel executivo', fim: true, modulo: 'financeiro' },
      { para: '/financeiro', glifo: '◱', rotulo: 'Dashboard financeiro', modulo: 'financeiro' },
      { para: '/lancamentos', glifo: '≡', rotulo: 'Lançamentos', modulo: 'financeiro' },
      { para: '/fechamentos', glifo: '⊘', rotulo: 'Fechamento mensal', modulo: 'financeiro' },
      { para: '/conferencia', glifo: '⚖', rotulo: 'Conferência de origem', modulo: 'financeiro' },
      { para: '/relatorio', glifo: '▦', rotulo: 'Relatório detalhado', modulo: 'relatorios' },
      // A leitura estratégica atravessa os três módulos, mas o menu é por
      // módulo de negócio: ela fica no financeiro, que é de onde vem a maior
      // parte do que ela lê, com a permissão de relatórios que a rota exige.
      { para: '/indicadores', glifo: '◈', rotulo: 'Indicadores Gerais', modulo: 'relatorios', escopo: 'cliente' as const },
    ],
  },
  {
    grupo: 'Gestão de Projetos',
    itens: [
      { para: '/projetos', glifo: '◫', rotulo: 'Dashboard e Gantt', modulo: 'projetos' },
      { para: '/projetos/cadastro', glifo: '≡', rotulo: 'Projetos e tarefas', modulo: 'projetos' },
    ],
  },
  {
    grupo: 'Gestão de Suporte TI',
    itens: [
      { para: '/sla', glifo: '◷', rotulo: 'Indicadores de SLA', modulo: 'suporte_ostick' },
      { para: '/sla/registros', glifo: '≡', rotulo: 'Chamados', modulo: 'suporte_ostick' },
      // Sistemas de suporte: as duas entradas usam a MESMA tela, mudando só a
      // origem dos dados. A separação é do gestor, que pensa por sistema.
      { subtitulo: 'Sistemas de Suporte' },
      { para: '/suporte/ostick', glifo: '·', rotulo: 'Sistema OStick', sub: true, modulo: 'suporte_ostick' },
      { para: '/suporte/bitrix24', glifo: '·', rotulo: 'Sistema Bitrix24', sub: true, modulo: 'suporte_bitrix24' },
      { para: '/suporte/integracoes', glifo: '⇄', rotulo: 'Integrações', modulo: 'integracoes' },
    ],
  },
  {
    grupo: 'Sistema',
    itens: [
      // `escopo` diz se a tela olha só a unidade em foco ou o cliente
      // inteiro — não é o mesmo em todo item deste grupo, então o rótulo
      // vai por item, não um selo único no cabeçalho da seção.
      { para: '/planilhas', glifo: '⇅', rotulo: 'Importar / Exportar', modulo: 'configuracoes', escopo: 'unidade' as const },
      { para: '/clientes', glifo: '⬢', rotulo: 'Clientes e unidades', modulo: 'configuracoes', escopo: 'cliente' as const },
      // "Cadastro" agrupa o que é configuração de leitura — as metas, e os SLAs
      // que entram em seguida. O subnível é o mesmo mecanismo dos Sistemas de
      // Suporte acima: um subtítulo sem link e os filhos marcados com `sub`.
      { para: '/cadastros', glifo: '⚙', rotulo: 'Cadastros', modulo: 'configuracoes', escopo: 'unidade' as const },
      { subtitulo: 'Cadastro' },
      { para: '/metas', glifo: '·', rotulo: 'Metas', sub: true, modulo: 'configuracoes', escopo: 'cliente' as const },
      { para: '/slas', glifo: '·', rotulo: 'SLAs', sub: true, modulo: 'configuracoes', escopo: 'unidade' as const },
      { para: '/reducao', glifo: '·', rotulo: 'Plano de redução', sub: true, modulo: 'configuracoes', escopo: 'cliente' as const },
      { para: '/reconhecedores', glifo: '·', rotulo: 'Quem reconhece despesa', sub: true, modulo: 'configuracoes', escopo: 'cliente' as const },
      { para: '/acessos', glifo: '◈', rotulo: 'Usuários e acessos', modulo: 'usuarios', escopo: 'cliente' as const },
      { para: '/auditoria', glifo: '◉', rotulo: 'Auditoria', modulo: 'configuracoes', escopo: 'cliente' as const },
    ],
  },
];

const TITULO_ESCOPO = {
  cliente: 'Vale para todo o cliente: toda matriz e toda filial.',
  unidade: 'Vale só para a unidade em foco, escolhida na própria tela.',
};

export function Layout() {
  const { usuario, empresas, cliente, trocarCliente, sair, ehGestor, pode, permissoes } = useSessao();
  const { tema, alternar } = useTema();
  const limparFiltros = useLimparFiltros();

  // Trocar de cliente recarrega o contexto inteiro: o filtro de uma tela no
  // contratante anterior não significa nada no próximo.
  const trocar = () => {
    limparFiltros();
    trocarCliente();
  };

  // Sair do contratante PERGUNTA antes. Não se perde dado nenhum — perde-se o
  // CONTEXTO: os filtros de cada tela, a competência em foco e a unidade
  // escolhida. Quem esbarra no nome do cliente no meio de uma análise perderia
  // o caminho até ela sem aviso.
  const [saindo, setSaindo] = useState(false);

  return (
    <div className="app">
      {/* A primeira parada de Tab da página. Até chegar ao conteúdo, quem
          navega por teclado atravessa a marca, o cartão do cliente e os
          dezenove itens do menu — em TODA tela, de novo. Este atalho pula
          tudo isso num Enter, e fica escondido fora do foco porque é inútil
          para quem usa o mouse. */}
      <a className="pular" href="#conteudo">Pular para o conteúdo</a>
      <aside className="lateral">
        <div className="marca">
          <strong>GSTI.IARX</strong>
          <span>Gestão de TI</span>
        </div>

        {/* O cliente em contexto fica ao lado da marca porque é o recorte que
            governa TODAS as telas abaixo — e trocar tem de ser um clique, não
            uma ida ao login. O botão aparece SEMPRE, inclusive com um cliente
            só: quem ganha acesso a um segundo contratante no meio da semana
            precisa achar a saída sem descobrir que ela só existe depois. */}
        {cliente && (
          // O CARTÃO INTEIRO é o caminho de saída, e não só o botão: quem quer
          // trocar de contratante clica no nome do contratante, que é onde a
          // mão vai. O botão fica para quem procura um rótulo explícito, e os
          // dois levam à mesma pergunta.
          <div
            className="cliente-atual"
            role="button"
            tabIndex={0}
            title="Clique para sair deste cliente e escolher outro"
            aria-label={`Cliente ${cliente.nome}. Ativar para sair e escolher outro.`}
            onClick={() => setSaindo(true)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                setSaindo(true);
              }
            }}
          >
            <span>Cliente</span>
            <strong title={cliente.nome}>{cliente.nome}</strong>
            <button
              type="button"
              className="botao discreto pequeno"
              onClick={(ev) => { ev.stopPropagation(); setSaindo(true); }}
              title="Volta à tela de seleção para escolher outro contratante"
            >
              Trocar cliente
            </button>
          </div>
        )}
        {cliente && (
          <Modal
            titulo="Sair deste cliente?"
            aberto={saindo}
            aoFechar={() => setSaindo(false)}
            acoes={
              <>
                <button type="button" className="botao" onClick={() => setSaindo(false)}>
                  Ficar neste cliente
                </button>
                <button
                  type="button"
                  className="botao primario"
                  onClick={() => { setSaindo(false); trocar(); }}
                >
                  Sair e escolher outro
                </button>
              </>
            }
          >
            <div className="aviso">
              Você está em <strong>{cliente.nome}</strong>. Sair leva de volta à tela de escolha
              de cliente.
            </div>
            <p style={{ marginTop: 'var(--esp-5)', fontSize: 13, color: 'var(--tinta-fraca)' }}>
              O que você tem aqui não se perde: nada é apagado e tudo volta igual quando você
              entrar de novo. O que recomeça é o <strong>recorte desta sessão</strong> — os
              filtros de cada tela, a competência em foco e a unidade escolhida —, porque o corte
              de um contratante não quer dizer nada no próximo.
            </p>
          </Modal>
        )}
        <nav className="menu">
          {/* O perfil governa o menu: módulo que a pessoa não vê não vira link,
              e grupo que ficou sem nenhum item não vira título solto. */}
          {NAVEGACAO.map((secao) => ({
            ...secao,
            itens: secao.itens.filter((i) => !('modulo' in i) || !i.modulo || pode(i.modulo)),
          }))
            .filter((secao) => secao.itens.some((i) => !('subtitulo' in i)))
            .map((secao) => (
            <div key={secao.grupo}>
              <div className="menu-grupo">{secao.grupo}</div>
              {secao.itens.map((item) =>
                'subtitulo' in item ? (
                  // Submenu: um rótulo, não um link. As entradas abaixo dele
                  // ficam indentadas para a relação ficar visível.
                  <div key={item.subtitulo} className="menu-sub">
                    {item.subtitulo}
                  </div>
                ) : (
                  <NavLink
                    key={item.para}
                    to={item.para}
                    end={'fim' in item ? item.fim : false}
                    className={({ isActive }) => [isActive ? 'ativo' : '', 'sub' in item ? 'aninhado' : ''].join(' ').trim()}
                  >
                    <span className="glifo" aria-hidden>
                      {item.glifo}
                    </span>
                    {item.rotulo}
                    {'escopo' in item && item.escopo && (
                      <span className="menu-escopo" title={TITULO_ESCOPO[item.escopo]}>
                        {item.escopo === 'cliente' ? 'cliente' : 'unidade'}
                      </span>
                    )}
                  </NavLink>
                ),
              )}
            </div>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', fontSize: 12, color: 'var(--tinta-fraca)', padding: '0 8px' }}>
          <div style={{ color: 'var(--tinta-2)' }}>{usuario?.nome}</div>
          <div>{usuario?.email}</div>
          <button type="button" className="botao discreto pequeno" onClick={sair} style={{ marginTop: 'var(--esp-3)', paddingLeft: 0 }}>
            Sair
          </button>
        </div>
      </aside>

      <div className="conteudo">
        {/* O topo perdeu os seletores de empresa e filial. Eles eram um recorte
            GLOBAL: mexer neles para conferir um número num módulo recortava o
            sistema inteiro, e prendia telas que não são de unidade nenhuma — a
            de Integrações, por exemplo — a uma escolha que não lhes diz
            respeito. Cada tela tem agora o seu filtro, que vale só nela. */}
        <header className="topo">
          <div className="titulo">
            <h1>{cliente?.nome ?? 'Sem cliente'}</h1>
            <small>
              {empresas.length === 1
                ? empresas[0]!.nome
                : `${empresas.length} empresas (matrizes) · cada tela filtra a sua`}
              {/* O perfil é o que governa de fato; o papel antigo só responde
                  enquanto nenhum perfil foi atribuído. */}
              {permissoes?.perfil
                ? ` · perfil ${permissoes.perfil.nome}`
                : !ehGestor && ' · acesso somente leitura'}
            </small>
          </div>

          <button
            type="button"
            className="botao discreto bt-tema"
            onClick={alternar}
            title="Alternar entre tema do sistema, claro e escuro"
            aria-pressed={tema === 'escuro'}
          >
            <span aria-hidden>{ICONE_TEMA[tema]}</span>
            {ROTULO_TEMA[tema]}
          </button>
        </header>

        <main className="pagina" id="conteudo" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
