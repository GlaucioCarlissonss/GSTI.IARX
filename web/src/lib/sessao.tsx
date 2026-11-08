import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, sessaoLocal } from './api';

export interface Empresa {
  id: number;
  nome: string;
  cnpj: string | null;
  status: string;
  papel: 'gestor' | 'leitor';
  /** O cliente dono desta matriz. */
  cliente_id: number | null;
}

/**
 * O contratante. É o recorte mais externo do sistema: escolher o cliente é o
 * primeiro ato da sessão, e nenhuma tela mostra dado de dois clientes juntos.
 */
export interface Cliente {
  id: number;
  nome: string;
  documento: string | null;
  ativo: number;
  matrizes: number;
  filiais: number;
}

export interface Filial {
  id: number;
  nome: string;
  cidade: string | null;
  uf: string | null;
  ativo: number;
  /** A matriz a que a filial pertence — a lista é do cliente inteiro. */
  empresa_id?: number;
  empresa_nome?: string;
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
  /** Os clientes a que este usuário está vinculado. */
  clientes: Cliente[];
  cliente: Cliente | null;
  /** A busca da lista de clientes ainda está em curso? */
  carregandoClientes: boolean;
  /**
   * Por que a lista não veio. Lista vazia e falha de rede produzem a mesma tela
   * em branco, e as saídas são opostas: uma pede cadastro, a outra pede repetir.
   */
  erroClientes: string | null;
  escolherCliente: (id: number) => void;
  /** Volta à tela de boas-vindas, sem derrubar a sessão. */
  trocarCliente: () => void;
  recarregarClientes: () => Promise<void>;
  /** Só as matrizes do cliente escolhido. */
  empresas: Empresa[];
  /**
   * Matriz EM FOCO: a que recebe o que for criado, exportado ou importado sem
   * escolha explícita. Não é mais recorte de leitura — isso é do cliente, e
   * cada tela aplica o seu filtro local por cima.
   */
  empresa: Empresa | null;
  carregando: boolean;
  /** Todas as filiais do cliente, de todas as matrizes. */
  filiais: Filial[];
  /** O identificador de login é o USUÁRIO; o e-mail não autentica. */
  entrar: (usuario: string, senha: string) => Promise<void>;
  criarConta: (dados: { nome: string; email: string; senha: string; usuario?: string }) => Promise<void>;
  criarEmpresa: (dados: { nome: string; cnpj?: string }) => Promise<void>;
  instalacao: EstadoInstalacao | null;
  sair: () => void;
  trocarEmpresa: (id: number) => void;
  recarregarFiliais: () => Promise<void>;
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
  const [empresasTodas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState<number | null>(sessaoLocal.empresa());
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState<number | null>(sessaoLocal.cliente());
  const [carregandoClientes, setCarregandoClientes] = useState(true);
  const [erroClientes, setErroClientes] = useState<string | null>(null);
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [instalacao, setInstalacao] = useState<EstadoInstalacao | null>(null);
  const [permissoes, setPermissoes] = useState<Permissoes | null>(null);

  const aplicarEmpresa = useCallback((id: number | null) => {
    setEmpresaId(id);
    sessaoLocal.definirEmpresa(id);
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
      const guardado = sessaoLocal.cliente();
      // Sem cliente escolhido não há empresa em contexto: a ordem é cliente,
      // depois matriz, e inverter as duas abriria a primeira tela no recorte
      // que a pessoa ainda não escolheu.
      const candidatas = guardado ? dados.empresas.filter((e) => e.cliente_id === guardado) : [];
      const valida = candidatas.some((e) => e.id === atual);
      aplicarEmpresa(valida ? atual : (candidatas[0]?.id ?? null));
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

  const recarregarClientes = useCallback(async () => {
    if (!sessaoLocal.token()) {
      setCarregandoClientes(false);
      return;
    }
    setCarregandoClientes(true);
    setErroClientes(null);
    try {
      const dados = await api.get<{ clientes: Cliente[] }>('/api/clientes/meus');
      setClientes(dados.clientes);
      // Vínculo revogado não pode sobreviver no localStorage: o que ficou
      // guardado é a última escolha, não uma permissão.
      setClienteId((atual) => (atual && dados.clientes.some((c) => c.id === atual) ? atual : null));
    } catch (e) {
      setErroClientes(e instanceof Error ? e.message : 'Não foi possível carregar os clientes.');
    } finally {
      setCarregandoClientes(false);
    }
  }, []);

  useEffect(() => {
    if (!usuario) {
      setClientes([]);
      setCarregandoClientes(false);
      return;
    }
    void recarregarClientes();
  }, [usuario, recarregarClientes]);

  // A escolha do cliente decide QUAIS matrizes existem para a sessão. Uma
  // empresa de outro cliente em contexto misturaria dois contratantes na mesma
  // tela — é exatamente o que a camada de cliente existe para impedir.
  const empresas = useMemo(
    () => (clienteId === null ? [] : empresasTodas.filter((e) => e.cliente_id === clienteId)),
    [empresasTodas, clienteId],
  );

  useEffect(() => {
    if (clienteId === null || !empresas.length) return;
    if (empresas.some((e) => e.id === empresaId)) return;
    aplicarEmpresa(empresas[0]!.id);
  }, [clienteId, empresas, empresaId, aplicarEmpresa]);

  const escolherCliente = useCallback(
    (id: number) => {
      setClienteId(id);
      sessaoLocal.definirCliente(id);
      // A empresa antiga é de outro cliente; deixá-la em contexto faria a
      // primeira tela carregar com o recorte errado.
      const primeira = empresasTodas.find((e) => e.cliente_id === id);
      aplicarEmpresa(primeira?.id ?? null);
    },
    [empresasTodas, aplicarEmpresa],
  );

  const trocarCliente = useCallback(() => {
    setClienteId(null);
    sessaoLocal.definirCliente(null);
    aplicarEmpresa(null);
  }, [aplicarEmpresa]);

  // O estado da instalação decide se a tela de entrada oferece cadastro.
  useEffect(() => {
    api
      .get<EstadoInstalacao>('/api/auth/estado')
      .then(setInstalacao)
      .catch(() => setInstalacao({ registro_aberto: false, primeiro_acesso: false }));
  }, [usuario]);

  // As filiais são do CLIENTE, não da matriz em foco: o filtro de cada tela
  // recorta o que a tela mostra, e a tela mostra o cliente inteiro.
  const recarregarFiliais = useCallback(async () => {
    if (!clienteId) return setFiliais([]);
    setFiliais(await api.get<Filial[]>('/api/filiais'));
  }, [clienteId]);

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
      // A empresa em contexto sai da escolha de cliente, não do login: entrar
      // não decide por quem trabalha com mais de um contratante.
      const guardado = sessaoLocal.cliente();
      const candidatas = guardado ? dados.empresas.filter((e) => e.cliente_id === guardado) : [];
      aplicarEmpresa(candidatas[0]?.id ?? null);
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
      // A primeira matriz cria o cliente dela: quem acabou de cadastrar entra
      // direto, sem passar por uma tela de escolha de um item só.
      if (nova.cliente_id) {
        setClienteId(nova.cliente_id);
        sessaoLocal.definirCliente(nova.cliente_id);
      }
      aplicarEmpresa(nova.id);
      void recarregarClientes();
    },
    [aplicarEmpresa, recarregarClientes],
  );

  const sair = useCallback(() => {
    sessaoLocal.definirToken(null);
    sessaoLocal.definirEmpresa(null);
    sessaoLocal.definirCliente(null);
    setUsuario(null);
    setEmpresas([]);
    setEmpresaId(null);
    setPermissoes(null);
    setClientes([]);
    setClienteId(null);
  }, []);

  const empresa = useMemo(() => empresas.find((e) => e.id === empresaId) ?? null, [empresas, empresaId]);
  const cliente = useMemo(() => clientes.find((c) => c.id === clienteId) ?? null, [clientes, clienteId]);

  const valor = useMemo<EstadoSessao>(
    () => ({
      usuario,
      clientes,
      cliente,
      carregandoClientes,
      erroClientes,
      escolherCliente,
      trocarCliente,
      recarregarClientes,
      empresas,
      empresa,
      filiais,
      carregando,
      instalacao,
      entrar,
      criarConta,
      criarEmpresa,
      sair,
      trocarEmpresa: aplicarEmpresa,
      recarregarFiliais,
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
      clientes,
      cliente,
      carregandoClientes,
      erroClientes,
      escolherCliente,
      trocarCliente,
      recarregarClientes,
      empresas,
      empresa,
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
