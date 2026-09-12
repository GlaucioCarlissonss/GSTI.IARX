import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProvedorSessao, useSessao } from './lib/sessao';
import { Layout } from './components/layout';
import { Login, PrimeiraEmpresa } from './pages/Login';
import { PaginaPainelExecutivo } from './pages/PainelExecutivo';
import { PaginaFinanceiro } from './pages/Financeiro';
import { PaginaLancamentos } from './pages/Lancamentos';
import { PaginaProjetos } from './pages/Projetos';
import { PaginaCadastroProjetos } from './pages/CadastroProjetos';
import { PaginaRegistrosSla, PaginaSla } from './pages/Sla';
import { PaginaBitrix24, PaginaOstick } from './pages/Suporte';
import { PaginaPlanilhas } from './pages/Planilhas';
import { PaginaConferencia } from './pages/Conferencia';
import { PaginaAuditoria, PaginaCadastros, PaginaFechamentos } from './pages/Administracao';
import { Carregando } from './components/base';

function Rotas() {
  const { usuario, carregando, empresa } = useSessao();

  if (carregando) return <Carregando>Carregando sessão…</Carregando>;
  if (!usuario) return <Login />;
  if (!empresa) return <PrimeiraEmpresa />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<PaginaPainelExecutivo />} />
        <Route path="financeiro" element={<PaginaFinanceiro />} />
        <Route path="lancamentos" element={<PaginaLancamentos />} />
        <Route path="fechamentos" element={<PaginaFechamentos />} />
        <Route path="conferencia" element={<PaginaConferencia />} />
        <Route path="projetos" element={<PaginaProjetos />} />
        <Route path="projetos/cadastro" element={<PaginaCadastroProjetos />} />
        <Route path="sla" element={<PaginaSla />} />
        <Route path="sla/registros" element={<PaginaRegistrosSla />} />
        <Route path="suporte/ostick" element={<PaginaOstick />} />
        <Route path="suporte/bitrix24" element={<PaginaBitrix24 />} />
        <Route path="planilhas" element={<PaginaPlanilhas />} />
        <Route path="cadastros" element={<PaginaCadastros />} />
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
