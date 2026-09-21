import { useCallback, useMemo, useState } from 'react';

/**
 * Estado de expansão de grupos, guardado por usuário no navegador.
 *
 * O padrão importa e muda por tela: o Gantt abre **expandido** (o cronograma
 * inteiro é o que se quer ver), a tabela dinâmica abre **recolhida** (a visão
 * macro é o que se quer ver). Para que um grupo criado depois herde o padrão
 * em vez do silêncio de uma lista que não o conhecia, o que fica guardado é
 * sempre a **exceção** ao padrão — os comprimidos num caso, os expandidos no
 * outro.
 */
/**
 * Um bloco que abre e fecha, lembrando a escolha de quem o usa.
 *
 * Diferente de `useExpansao`, aqui cada bloco tem a SUA chave. É de propósito:
 * os blocos estão espalhados por telas diferentes e não compartilham estado em
 * React, então guardar todos num conjunto só faria o último a gravar apagar a
 * escolha dos outros — cada um leria o conjunto no momento em que montou e
 * escreveria por cima do que não conhece.
 *
 * O padrão é FECHADO, e o que fica guardado é a exceção: só o bloco que alguém
 * abriu ocupa espaço no armazenamento, e um bloco novo nasce fechado como os
 * demais, sem precisar ser cadastrado em lugar nenhum.
 */
export function useDobra(
  chave: string | null,
  /**
   * O estado de quem CHEGA na tela, quando não há escolha guardada.
   *
   * Quase todo bloco abre fechado ("a tela abre enxuta"). A exceção é o bloco
   * que AGRUPA outros — o módulo dos Indicadores Gerais: fechado, a tela seria
   * três títulos e nada mais, e o agrupamento que ele existe para mostrar não
   * apareceria. Guarda-se então a EXCEÇÃO ao padrão, e não o estado bruto.
   */
  padraoAberto = false,
): { aberto: boolean; alternar: () => void } {
  const [aberto, setAberto] = useState(() => {
    if (!chave) return true;
    try {
      const guardado = localStorage.getItem(chave);
      if (guardado === '1') return true;
      if (guardado === '0') return false;
      return padraoAberto;
    } catch {
      // Armazenamento bloqueado: vale o padrão do bloco.
      return padraoAberto;
    }
  });

  const alternar = useCallback(() => {
    setAberto((atual) => {
      const proximo = !atual;
      if (chave) {
        try {
          // Só a exceção é guardada; voltar ao padrão apaga a marca, para que
          // uma mudança futura de padrão alcance quem nunca escolheu nada.
          if (proximo === padraoAberto) localStorage.removeItem(chave);
          else localStorage.setItem(chave, proximo ? '1' : '0');
        } catch {
          /* sem armazenamento: a escolha vale só nesta sessão */
        }
      }
      return proximo;
    });
  }, [chave, padraoAberto]);

  // Bloco sem título não tem cabeçalho para clicar: fica sempre aberto.
  return chave ? { aberto, alternar } : { aberto: true, alternar: () => {} };
}

/** Chave estável a partir do título do bloco. */
export function chaveDoBloco(titulo: string | undefined): string | null {
  if (!titulo) return null;
  const limpo = titulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return limpo ? `gsti-bloco-${limpo}` : null;
}

export function useExpansao(chave: string, padrao: 'expandido' | 'recolhido' = 'expandido') {
  const [excecoes, setExcecoes] = useState<Set<string>>(() => {
    try {
      const bruto = localStorage.getItem(chave);
      return new Set<string>(bruto ? (JSON.parse(bruto) as string[]) : []);
    } catch {
      // Armazenamento bloqueado ou conteúdo inválido: começa no padrão, em
      // vez de derrubar a tela.
      return new Set<string>();
    }
  });

  const guardar = useCallback(
    (proximo: Set<string>) => {
      setExcecoes(proximo);
      try {
        localStorage.setItem(chave, JSON.stringify([...proximo]));
      } catch {
        /* sem armazenamento: a escolha vale só nesta sessão */
      }
    },
    [chave],
  );

  return useMemo(() => {
    const abrePorPadrao = padrao === 'expandido';
    return {
      expandido: (id: string | number) => (excecoes.has(String(id)) ? !abrePorPadrao : abrePorPadrao),
      alternar: (id: string | number) => {
        const proximo = new Set(excecoes);
        if (proximo.has(String(id))) proximo.delete(String(id));
        else proximo.add(String(id));
        guardar(proximo);
      },
      expandirTudo: (ids: Array<string | number> = []) =>
        guardar(abrePorPadrao ? new Set() : new Set(ids.map(String))),
      comprimirTudo: (ids: Array<string | number> = []) =>
        guardar(abrePorPadrao ? new Set(ids.map(String)) : new Set()),
      algumaExcecao: excecoes.size > 0,
    };
  }, [excecoes, guardar, padrao]);
}
