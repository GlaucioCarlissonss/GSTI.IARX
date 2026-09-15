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
