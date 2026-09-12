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
  /** Identificador de login. O e-mail serve só à recuperação de senha. */
  username?: string;
  email: string;
}

/**
 * Escopo organizacional da sessão. Nenhuma tela consulta dados sem uma empresa
 * definida; a filial é opcional e `undefined` significa "consolidado".
 */
/**
 * O que o perfil do usuário permite nesta empresa. Vem do servidor, que é quem
 * recusa a requisição de verdade — o front usa a mesma resposta só para não
 * oferecer o que vai ser recusado. Esconder botão não é segurança; a segurança
 * é a recusa do servidor, e ela continua lá.
 */
export interface Permissoes {
  papel: string | null;
  perfil: { id: number; nome: string; tipo: 'VIEW_ONLY' | 'EDIT' } | null;
  permissoes: Record<string, Partial<Record<string, boolean>>>;
  campos_bloqueados: Record<string, string[]>;
}

export type Acao = 'view' | 'create' | 'edit' | 'delete' | 'export' | 'import';

export interface EstadoInstalacao {
  registro_aberto: boolean;
  primeiro_acesso: boolean;
}

interface EstadoSessao {
  usuario: Usuario | null;
  empresas: Empresa[];
  empresa: Empresa | null;
  filialId: number | 'todas' | 'nenhuma';
  /** Filiais em foco. Lista vazia = todas (consolidado). `'nenhuma'` é o nível empresa. */
  filiaisSel: Array<number | 'nenhuma'>;
  carregando: boolean;
  filiais: Filial[];
  /** O identificador de login é o USUÁRIO; o e-mail não autentica. */
  entrar: (usuario: string, senha: string) => Promise<void>;
  criarConta: (dados: { nome: string; email: string; senha: string; usuario?: string }) => Promise<void>;
  criarEmpresa: (dados: { nome: string; cnpj?: string }) => Promise<void>;
  instalacao: EstadoInstalacao | null;
  sair: () => void;
  trocarEmpresa: (id: number) => void;
  definirFilial: (valor: number | 'todas' | 'nenhuma') => void;
  definirFiliais: (valores: Array<number | 'nenhuma'>) => void;
  recarregarFiliais: () => Promise<void>;
  /** Parâmetro de filial pronto para a query da API. */
  paramFilial: () => string | undefined;
  ehGestor: boolean;
  /** Permissões do perfil nesta empresa; `null` enquanto não chegaram. */
  permissoes: Permissoes | null;
  /** O perfil permite a ação no módulo? Antes de a resposta chegar, não. */
  pode: (modulo: string, acao?: Acao) => boolean;
  /** Campos que o perfil não enxerga na entidade. */
  camposBloqueados: (entidade: string) => string[];
}

const Contexto = createContext<EstadoSessao | null>(null);

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState<number | null>(sessaoLocal.empresa());
  const [filiaisSel, setFiliaisSel] = useState<Array<number | 'nenhuma'>>([]);
  // `filialId` continua existindo para o código que só lida com uma: é a única
  // selecionada, ou 'todas' quando o recorte é consolidado ou múltiplo.
  const filialId: number | 'todas' | 'nenhuma' = filiaisSel.length === 1 ? filiaisSel[0]! : 'todas';
  const setFilialId = (v: number | 'todas' | 'nenhuma') => setFiliaisSel(v === 'todas' ? [] : [v]);
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [instalacao, setInstalacao] = useState<EstadoInstalacao | null>(null);
  const [permissoes, setPermissoes] = useState<Permissoes | null>(null);

  const aplicarEmpresa = useCallback((id: number | null) => {
    setEmpresaId(id);
    sessaoLocal.definirEmpresa(id);
    setFiliaisSel([]);
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

  // O perfil é do vínculo com a EMPRESA, não do usuário: trocar de empresa
  // troca o que se pode fazer, e a resposta antiga não vale para a nova.
  useEffect(() => {
    if (!usuario || !empresaId) return setPermissoes(null);
    let valido = true;
    setPermissoes(null);
    api
      .get<Permissoes>('/api/acesso/minhas-permissoes')
      .then((p) => {
        if (valido) setPermissoes(p);
      })
      .catch(() => {
        if (valido) setPermissoes(null);
      });
    return () => {
      valido = false;
    };
  }, [usuario, empresaId]);

  const entrar = useCallback(
    async (usuario: string, senha: string) => {
      const dados = await api.post<{ token: string; usuario: Usuario; empresas: Empresa[] }>('/api/auth/login', {
        usuario,
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
    async (dados: { nome: string; email: string; senha: string; usuario?: string }) => {
      const resposta = await api.post<{
        token: string;
        usuario: { id: number; nome: string; email: string; username: string };
      }>('/api/auth/registrar', { ...dados, username: dados.usuario || undefined });
      sessaoLocal.definirToken(resposta.token);
      setUsuario({
        usuarioId: resposta.usuario.id,
        nome: resposta.usuario.nome,
        email: resposta.usuario.email,
        username: resposta.usuario.username,
      });
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
    setPermissoes(null);
  }, []);

  const empresa = useMemo(() => empresas.find((e) => e.id === empresaId) ?? null, [empresas, empresaId]);

  const valor = useMemo<EstadoSessao>(
    () => ({
      usuario,
      empresas,
      empresa,
      filialId,
      filiaisSel,
      filiais,
      carregando,
      instalacao,
      entrar,
      criarConta,
      criarEmpresa,
      sair,
      trocarEmpresa: aplicarEmpresa,
      definirFilial: setFilialId,
      definirFiliais: setFiliaisSel,
      recarregarFiliais,
      // A API aceita lista separada por vírgula; vazio significa consolidado.
      paramFilial: () => (filiaisSel.length ? filiaisSel.map(String).join(',') : undefined),
      ehGestor: empresa?.papel === 'gestor',
      permissoes,
      // Enquanto a resposta não chega, nada é escondido. Esconder antes de
      // saber deixaria o menu vazio por um instante para todo mundo, e quem
      // recusa de verdade é o servidor — não a ausência do botão.
      pode: (modulo: string, acao: Acao = 'view') => {
        if (permissoes === null) return true;
        // Mesma exceção do servidor: o gestor da empresa administra os acessos
        // por definição. Fosse preciso um perfil para isso, uma configuração
        // errada trancaria todo mundo para fora.
        if (permissoes.papel === 'gestor' && modulo === 'usuarios') return true;
        return !!permissoes.permissoes?.[modulo]?.[acao];
      },
      camposBloqueados: (entidade: string) => permissoes?.campos_bloqueados?.[entidade] ?? [],
    }),
    [
      usuario,
      empresas,
      empresa,
      filialId,
      filiaisSel,
      filiais,
      carregando,
      instalacao,
      entrar,
      criarConta,
      criarEmpresa,
      sair,
      aplicarEmpresa,
      recarregarFiliais,
      permissoes,
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
