/**
 * Filtros LOCAIS de cada tela.
 *
 * O sistema tinha um recorte global no topo: uma empresa e uma filial, e toda
 * tela obedecia. Isso tinha dois defeitos. A tela de Integrações — que é do
 * contratante, não da unidade — ficava refém de um seletor de empresa e se
 * recusava a abrir com mais de uma marcada. E mexer no filtro para conferir um
 * número em Financeiro recortava também Projetos, Suporte e os relatórios.
 *
 * Agora o escopo de toda consulta é o CLIENTE, e cada tela tem o seu filtro.
 * O estado vive aqui, em memória: recorte de leitura não é configuração, e
 * guardá-lo faria a pessoa voltar dias depois a uma tela filtrada sem lembrar
 * por quê. Trocar de cliente zera tudo — o filtro de um contratante não
 * significa nada no outro.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

/** O recorte de uma tela: matrizes e filiais escolhidas ali. */
export interface FiltroEscopo {
  /** Matrizes em foco. Vazio = todas as do cliente. */
  empresas: number[];
  /** Filiais em foco. Vazio = todas. `'nenhuma'` é o nível matriz, sem filial. */
  filiais: Array<number | 'nenhuma'>;
}

const VAZIO: FiltroEscopo = { empresas: [], filiais: [] };

interface Estado {
  ler: (tela: string) => FiltroEscopo;
  definir: (tela: string, valor: Partial<FiltroEscopo>) => void;
  limparTudo: () => void;
}

const Contexto = createContext<Estado | null>(null);

export function ProvedorFiltros({ children }: { children: ReactNode }) {
  const [mapa, setMapa] = useState<Record<string, FiltroEscopo>>({});
  // A referência evita recriar o objeto devolvido a cada leitura: uma tela que
  // usa o filtro como dependência de efeito recarregaria em laço.
  const cache = useRef<Record<string, FiltroEscopo>>({});

  const ler = useCallback(
    (tela: string) => {
      const atual = mapa[tela] ?? VAZIO;
      const guardado = cache.current[tela];
      if (
        guardado &&
        guardado.empresas.length === atual.empresas.length &&
        guardado.empresas.every((v, i) => v === atual.empresas[i]) &&
        guardado.filiais.length === atual.filiais.length &&
        guardado.filiais.every((v, i) => v === atual.filiais[i])
      ) {
        return guardado;
      }
      cache.current[tela] = atual;
      return atual;
    },
    [mapa],
  );

  const definir = useCallback((tela: string, valor: Partial<FiltroEscopo>) => {
    setMapa((atual) => ({ ...atual, [tela]: { ...(atual[tela] ?? VAZIO), ...valor } }));
  }, []);

  const limparTudo = useCallback(() => {
    cache.current = {};
    setMapa({});
  }, []);

  const estado = useMemo<Estado>(() => ({ ler, definir, limparTudo }), [ler, definir, limparTudo]);
  return <Contexto.Provider value={estado}>{children}</Contexto.Provider>;
}

function usarContexto(): Estado {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useFiltroEscopo precisa estar dentro de ProvedorFiltros.');
  return ctx;
}

/**
 * O filtro desta tela, e como mudá-lo.
 *
 * `tela` é a chave: duas telas com a mesma chave compartilham o recorte de
 * propósito (a lista e o painel de um módulo), e chaves diferentes ficam
 * independentes — que é o ponto de o filtro ser local.
 */
export function useFiltroEscopo(tela: string) {
  const { ler, definir } = usarContexto();
  const filtro = ler(tela);
  return useMemo(
    () => ({
      empresas: filtro.empresas,
      filiais: filtro.filiais,
      definirEmpresas: (v: number[]) => definir(tela, { empresas: v }),
      definirFiliais: (v: Array<number | 'nenhuma'>) => definir(tela, { filiais: v }),
      limpar: () => definir(tela, { empresas: [], filiais: [] }),
      /** Parâmetros prontos para a query: ausentes quando o recorte é o cliente inteiro. */
      params: {
        empresas: filtro.empresas.length ? filtro.empresas.join(',') : undefined,
        filial_id: filtro.filiais.length ? filtro.filiais.map(String).join(',') : undefined,
      },
    }),
    [filtro, definir, tela],
  );
}

/** Zera os filtros de todas as telas — usado ao trocar de cliente. */
export function useLimparFiltros() {
  return usarContexto().limparTudo;
}
