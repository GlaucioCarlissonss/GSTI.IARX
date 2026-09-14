import { NavLink, Outlet } from 'react-router-dom';
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
      { para: '/planilhas', glifo: '⇅', rotulo: 'Importar / Exportar', modulo: 'configuracoes' },
      { para: '/clientes', glifo: '⬢', rotulo: 'Clientes e unidades', modulo: 'configuracoes' },
      { para: '/cadastros', glifo: '⚙', rotulo: 'Cadastros', modulo: 'configuracoes' },
      { para: '/acessos', glifo: '◈', rotulo: 'Usuários e acessos', modulo: 'usuarios' },
      { para: '/auditoria', glifo: '◉', rotulo: 'Auditoria', modulo: 'configuracoes' },
    ],
  },
];

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

  return (
    <div className="app">
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
          <div className="cliente-atual">
            <span>Cliente</span>
            <strong title={cliente.nome}>{cliente.nome}</strong>
            <button
              type="button"
              className="botao discreto pequeno"
              onClick={trocar}
              title="Volta à tela de seleção para escolher outro contratante"
            >
              Trocar cliente
            </button>
          </div>
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
                  </NavLink>
                ),
              )}
            </div>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', fontSize: 12, color: 'var(--tinta-fraca)', padding: '0 8px' }}>
          <div style={{ color: 'var(--tinta-2)' }}>{usuario?.nome}</div>
          <div>{usuario?.email}</div>
          <button type="button" className="botao discreto pequeno" onClick={sair} style={{ marginTop: 6, paddingLeft: 0 }}>
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

        <main className="pagina">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
