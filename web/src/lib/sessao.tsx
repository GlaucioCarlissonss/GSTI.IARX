import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, sessaoLocal } from './api';

export interface Empresa {
  id: number;
  nome: string;
  cnpj: string | null;
  status: string;
  papel: 'gestor' | 'leitor';
}

export interface Filial {
  id: number;
  nome: string;
  cidade: string | null;
  uf: string | null;
  ativo: number;
}

export interface Usuario {
  usuarioId: number;
  nome: string;
  email: string;
}

/**
 * Escopo organizacional da sessão. Nenhuma tela consulta dados sem uma empresa
 * definida; a filial é opcional e `undefined` significa "consolidado".
 */
export interface EstadoInstalacao {
  registro_aberto: boolean;
  primeiro_acesso: boolean;
}

interface EstadoSessao {
  usuario: Usuario | null;
  empresas: Empresa[];
  empresa: Empresa | null;
  filialId: number | 'todas' | 'nenhuma';
  carregando: boolean;
  filiais: Filial[];
  entrar: (email: string, senha: string) => Promise<void>;
  criarConta: (dados: { nome: string; email: string; senha: string }) => Promise<void>;
  criarEmpresa: (dados: { nome: string; cnpj?: string }) => Promise<void>;
  instalacao: EstadoInstalacao | null;
  sair: () => void;
  trocarEmpresa: (id: number) => void;
  definirFilial: (valor: number | 'todas' | 'nenhuma') => void;
  recarregarFiliais: () => Promise<void>;
  /** Parâmetro de filial pronto para a query da API. */
  paramFilial: () => string | undefined;
  ehGestor: boolean;
}

const Contexto = createContext<EstadoSessao | null>(null);

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState<number | null>(sessaoLocal.empresa());
  const [filialId, setFilialId] = useState<number | 'todas' | 'nenhuma'>('todas');
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [instalacao, setInstalacao] = useState<EstadoInstalacao | null>(null);

  const aplicarEmpresa = useCallback((id: number | null) => {
    setEmpresaId(id);
    sessaoLocal.definirEmpresa(id);
    setFilialId('todas');
  }, []);

  const carregarSessao = useCallback(async () => {
    if (!sessaoLocal.token()) {
      setCarregando(false);
      return;
    }
    try {
      const dados = await api.get<{ usuario: Usuario; empresas: Empresa[] }>('/api/auth/eu');
      setUsuario(dados.usuario);
      setEmpresas(dados.empresas);
      const atual = sessaoLocal.empresa();
      const valida = dados.empresas.some((e) => e.id === atual);
      aplicarEmpresa(valida ? atual : (dados.empresas[0]?.id ?? null));
    } catch {
      sessaoLocal.definirToken(null);
      setUsuario(null);
    } finally {
      setCarregando(false);
    }
  }, [aplicarEmpresa]);

  useEffect(() => {
    void carregarSessao();
  }, [carregarSessao]);

  // O estado da instalação decide se a tela de entrada oferece cadastro.
  useEffect(() => {
    api
      .get<EstadoInstalacao>('/api/auth/estado')
      .then(setInstalacao)
      .catch(() => setInstalacao({ registro_aberto: false, primeiro_acesso: false }));
  }, [usuario]);

  const recarregarFiliais = useCallback(async () => {
    if (!empresaId) return setFiliais([]);
    setFiliais(await api.get<Filial[]>('/api/filiais'));
  }, [empresaId]);

  useEffect(() => {
    void recarregarFiliais();
  }, [recarregarFiliais]);

  const entrar = useCallback(
    async (email: string, senha: string) => {
      const dados = await api.post<{ token: string; usuario: Usuario; empresas: Empresa[] }>('/api/auth/login', {
        email,
        senha,
      });
      sessaoLocal.definirToken(dados.token);
      setUsuario(dados.usuario);
      setEmpresas(dados.empresas);
      aplicarEmpresa(dados.empresas[0]?.id ?? null);
    },
    [aplicarEmpresa],
  );

  const criarConta = useCallback(
    async (dados: { nome: string; email: string; senha: string }) => {
      const resposta = await api.post<{ token: string; usuario: { id: number; nome: string; email: string } }>(
        '/api/auth/registrar',
        dados,
      );
      sessaoLocal.definirToken(resposta.token);
      setUsuario({ usuarioId: resposta.usuario.id, nome: resposta.usuario.nome, email: resposta.usuario.email });
      setEmpresas([]);
      aplicarEmpresa(null);
    },
    [aplicarEmpresa],
  );

  const criarEmpresa = useCallback(
    async (dados: { nome: string; cnpj?: string }) => {
      const nova = await api.post<Empresa>('/api/auth/empresas', dados);
      setEmpresas((atuais) => [...atuais, nova]);
      aplicarEmpresa(nova.id);
    },
    [aplicarEmpresa],
  );

  const sair = useCallback(() => {
    sessaoLocal.definirToken(null);
    sessaoLocal.definirEmpresa(null);
    setUsuario(null);
    setEmpresas([]);
    setEmpresaId(null);
  }, []);

  const empresa = useMemo(() => empresas.find((e) => e.id === empresaId) ?? null, [empresas, empresaId]);

  const valor = useMemo<EstadoSessao>(
    () => ({
      usuario,
      empresas,
      empresa,
      filialId,
      filiais,
      carregando,
      instalacao,
      entrar,
      criarConta,
      criarEmpresa,
      sair,
      trocarEmpresa: aplicarEmpresa,
      definirFilial: setFilialId,
      recarregarFiliais,
      paramFilial: () => (filialId === 'todas' ? undefined : filialId === 'nenhuma' ? 'nenhuma' : String(filialId)),
      ehGestor: empresa?.papel === 'gestor',
    }),
    [
      usuario,
      empresas,
      empresa,
      filialId,
      filiais,
      carregando,
      instalacao,
      entrar,
      criarConta,
      criarEmpresa,
      sair,
      aplicarEmpresa,
      recarregarFiliais,
    ],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao(): EstadoSessao {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error('useSessao precisa estar dentro de ProvedorSessao.');
  return contexto;
}

/** Hook de carregamento com estado de erro — usado por todas as páginas. */
export function useDados<T>(carregar: () => Promise<T>, dependencias: unknown[]) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [gatilho, setGatilho] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    carregar()
      .then((r) => {
        if (!cancelado) setDados(r);
      })
      .catch((e: unknown) => {
        if (!cancelado) setErro(e instanceof Error ? e.message : 'Falha ao carregar os dados.');
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencias, gatilho]);

  return { dados, erro, carregando, recarregar: () => setGatilho((v) => v + 1) };
}
