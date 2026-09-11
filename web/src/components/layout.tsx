import { NavLink, Outlet } from 'react-router-dom';
import { FichasSelecao, SeletorMulti } from './seletor-multi';
import { useSessao } from '../lib/sessao';

const NAVEGACAO = [
  {
    grupo: 'Visão geral',
    itens: [{ para: '/', glifo: '◆', rotulo: 'Painel executivo', fim: true }],
  },
  {
    grupo: 'Financeiro',
    itens: [
      { para: '/financeiro', glifo: '◱', rotulo: 'Dashboard' },
      { para: '/lancamentos', glifo: '≡', rotulo: 'Lançamentos' },
      { para: '/fechamentos', glifo: '⊘', rotulo: 'Fechamento mensal' },
      { para: '/conferencia', glifo: '⚖', rotulo: 'Conferência de origem' },
    ],
  },
  {
    grupo: 'Projetos',
    itens: [
      { para: '/projetos', glifo: '◫', rotulo: 'Dashboard e Gantt' },
      { para: '/projetos/cadastro', glifo: '≡', rotulo: 'Projetos e tarefas' },
    ],
  },
  {
    grupo: 'Suporte',
    itens: [
      { para: '/sla', glifo: '◷', rotulo: 'Dashboard de SLA' },
      { para: '/sla/registros', glifo: '≡', rotulo: 'Registros de tickets' },
    ],
  },
  {
    grupo: 'Administração',
    itens: [
      { para: '/planilhas', glifo: '⇅', rotulo: 'Importar / Exportar' },
      { para: '/cadastros', glifo: '⚙', rotulo: 'Cadastros' },
      { para: '/auditoria', glifo: '◉', rotulo: 'Auditoria' },
    ],
  },
];

export function Layout() {
  const { usuario, empresas, empresa, trocarEmpresa, filiaisSel, definirFiliais, filiais, sair, ehGestor } =
    useSessao();

  const itensFilial = [
    { valor: 'nenhuma', rotulo: 'Sem filial (empresa)' },
    ...filiais.map((f) => ({ valor: String(f.id), rotulo: f.uf ? `${f.nome} — ${f.uf}` : f.nome })),
  ];

  return (
    <div className="app">
      <aside className="lateral">
        <div className="marca">
          <strong>GSTI.IARX</strong>
          <span>Gestão de TI</span>
        </div>
        <nav className="menu">
          {NAVEGACAO.map((secao) => (
            <div key={secao.grupo}>
              <div className="menu-grupo">{secao.grupo}</div>
              {secao.itens.map((item) => (
                <NavLink
                  key={item.para}
                  to={item.para}
                  end={'fim' in item ? item.fim : false}
                  className={({ isActive }) => (isActive ? 'ativo' : '')}
                >
                  <span className="glifo" aria-hidden>
                    {item.glifo}
                  </span>
                  {item.rotulo}
                </NavLink>
              ))}
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
        <header className="topo">
          <div className="titulo">
            <h1>{empresa?.nome ?? 'Sem empresa'}</h1>
            <small>
              {filiaisSel.length === 0
                ? 'Consolidado da empresa'
                : filiaisSel.length === 1
                  ? (itensFilial.find((i) => i.valor === String(filiaisSel[0]))?.rotulo ?? 'Filial')
                  : `${filiaisSel.length} filiais`}
              {!ehGestor && ' · acesso somente leitura'}
            </small>
          </div>

          <div className="campo">
            <label htmlFor="sel-empresa">Empresa</label>
            <select
              id="sel-empresa"
              value={empresa?.id ?? ''}
              onChange={(e) => trocarEmpresa(Number(e.target.value))}
            >
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label>Filial</label>
            <SeletorMulti
              rotulo="Filial"
              largura={200}
              itens={itensFilial}
              selecionados={filiaisSel.map(String)}
              aoMudar={(v) => definirFiliais(v.map((x) => (x === 'nenhuma' ? 'nenhuma' : Number(x))))}
            />
          </div>
        </header>

        {filiaisSel.length > 1 && (
          <div style={{ padding: '0 24px 12px' }}>
            <FichasSelecao
              grupos={[{
                chave: 'filial',
                rotulo: 'Filial',
                itens: itensFilial,
                selecionados: filiaisSel.map(String),
                aoMudar: (v) => definirFiliais(v.map((x) => (x === 'nenhuma' ? 'nenhuma' : Number(x)))),
              }]}
            />
          </div>
        )}

        <main className="pagina">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
