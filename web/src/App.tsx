import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProvedorSessao, useSessao } from './lib/sessao';
import { Layout } from './components/layout';
import { Login, PrimeiraEmpresa, RedefinirSenha } from './pages/Login';
import { PaginaSelecaoCliente } from './pages/SelecaoCliente';
import { PaginaClientes } from './pages/Clientes';
import { PaginaPainelExecutivo } from './pages/PainelExecutivo';
import { PaginaFinanceiro } from './pages/Financeiro';
import { PaginaLancamentos } from './pages/Lancamentos';
import { PaginaProjetos } from './pages/Projetos';
import { PaginaCadastroProjetos } from './pages/CadastroProjetos';
import { PaginaRegistrosSla, PaginaSla } from './pages/Sla';
import { PaginaBitrix24, PaginaOstick } from './pages/Suporte';
import { PaginaIntegracoes } from './pages/Integracoes';
import { PaginaAcessos } from './pages/Acessos';
import { PaginaRelatorio } from './pages/Relatorio';
import { PaginaPlanilhas } from './pages/Planilhas';
import { PaginaConferencia } from './pages/Conferencia';
import { PaginaAuditoria, PaginaCadastros, PaginaFechamentos } from './pages/Administracao';
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
        <Route index element={<PaginaPainelExecutivo />} />
        <Route path="financeiro" element={<PaginaFinanceiro />} />
        <Route path="lancamentos" element={<PaginaLancamentos />} />
        <Route path="fechamentos" element={<PaginaFechamentos />} />
        <Route path="conferencia" element={<PaginaConferencia />} />
        <Route path="relatorio" element={<PaginaRelatorio />} />
        <Route path="projetos" element={<PaginaProjetos />} />
        <Route path="projetos/cadastro" element={<PaginaCadastroProjetos />} />
        <Route path="sla" element={<PaginaSla />} />
        <Route path="sla/registros" element={<PaginaRegistrosSla />} />
        <Route path="suporte/ostick" element={<PaginaOstick />} />
        <Route path="suporte/bitrix24" element={<PaginaBitrix24 />} />
        <Route path="suporte/integracoes" element={<PaginaIntegracoes />} />
        <Route path="planilhas" element={<PaginaPlanilhas />} />
        <Route path="cadastros" element={<PaginaCadastros />} />
        <Route path="clientes" element={<PaginaClientes />} />
        <Route path="acessos" element={<PaginaAcessos />} />
        <Route path="auditoria" element={<PaginaAuditoria />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ProvedorSessao>
        <Rotas />
      </ProvedorSessao>
    </BrowserRouter>
  );
}
