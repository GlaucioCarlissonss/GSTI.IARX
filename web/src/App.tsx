import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProvedorSessao, useSessao } from './lib/sessao';
import { ProvedorFiltros } from './lib/filtros';
import { Layout } from './components/layout';
// Login e Seleção de Cliente ficam ESTÁTICOS de propósito: são as duas telas
// que todo mundo atravessa antes de qualquer outra, e carregá-las sob demanda
// poria uma espera de rede justamente na porta de entrada. As 23 telas de
// dentro vêm de `rotas.ts`, uma por arquivo, buscadas quando se vai até elas.
import { Login, PrimeiraEmpresa, RedefinirSenha } from './pages/Login';
import { PaginaSelecaoCliente } from './pages/SelecaoCliente';
import { Telas } from './rotas';
import { Carregando } from './components/base';

function Rotas() {
  const { usuario, carregando, empresa, cliente, clientes, carregandoClientes, erroClientes } = useSessao();

  // O link de redefinição vive fora da sessão: quem chega por ele está
  // justamente sem conseguir entrar.
  if (window.location.pathname === '/redefinir-senha') return <RedefinirSenha />;

  if (carregando) return <Carregando>Carregando sessão…</Carregando>;
  if (!usuario) return <Login />;
  // Instalação nova: quem não tem cliente NEM empresa cadastra a primeira, e a
  // matriz criada já nasce sendo o cliente dela.
  if (!carregandoClientes && !erroClientes && clientes.length === 0 && !empresa) return <PrimeiraEmpresa />;
  // O cliente é o recorte mais externo: nenhuma tela abre antes dele.
  if (!cliente) return <PaginaSelecaoCliente />;
  if (!empresa) return <PrimeiraEmpresa />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Telas.painelExecutivo />} />
        <Route path="indicadores" element={<Telas.indicadores />} />
        <Route path="financeiro" element={<Telas.financeiro />} />
        <Route path="lancamentos" element={<Telas.lancamentos />} />
        <Route path="fechamentos" element={<Telas.fechamentos />} />
        <Route path="conferencia" element={<Telas.conferencia />} />
        <Route path="relatorio" element={<Telas.relatorio />} />
        <Route path="projetos" element={<Telas.projetos />} />
        <Route path="projetos/cadastro" element={<Telas.cadastroProjetos />} />
        <Route path="projetos/plano-acao" element={<Telas.planoAcao />} />
        <Route path="sla" element={<Telas.sla />} />
        <Route path="sla/registros" element={<Telas.registrosSla />} />
        <Route path="suporte/ostick" element={<Telas.ostick />} />
        <Route path="suporte/bitrix24" element={<Telas.bitrix24 />} />
        <Route path="suporte/integracoes" element={<Telas.integracoes />} />
        <Route path="planilhas" element={<Telas.planilhas />} />
        <Route path="cadastros" element={<Telas.cadastros />} />
        <Route path="metas" element={<Telas.metas />} />
        <Route path="slas" element={<Telas.slas />} />
        <Route path="reducao" element={<Telas.reducao />} />
        <Route path="reconhecedores" element={<Telas.reconhecedores />} />
        <Route path="clientes" element={<Telas.clientes />} />
        <Route path="acessos" element={<Telas.acessos />} />
        <Route path="auditoria" element={<Telas.auditoria />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ProvedorSessao>
        {/* Os filtros de tela vivem acima das rotas e abaixo da sessão: eles
            duram a sessão, e trocar de cliente os zera. */}
        <ProvedorFiltros>
          <Rotas />
        </ProvedorFiltros>
      </ProvedorSessao>
    </BrowserRouter>
  );
}
