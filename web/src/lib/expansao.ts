import { useCallback, useMemo, useState } from 'react';

/**
 * Estado de expansão de grupos, guardado por usuário no navegador.
 *
 * Guarda os **comprimidos**, não os expandidos: o padrão é expandido, e um
 * grupo criado depois precisa nascer aberto em vez de herdar o silêncio de
 * uma lista que não o conhecia.
 */
export function useExpansao(chave: string) {
  const [comprimidos, setComprimidos] = useState<Set<string>>(() => {
    try {
      const bruto = localStorage.getItem(chave);
      return new Set<string>(bruto ? (JSON.parse(bruto) as string[]) : []);
    } catch {
      // Armazenamento bloqueado ou conteúdo inválido: começa tudo expandido,
      // que é o padrão, em vez de derrubar a tela.
      return new Set<string>();
    }
  });

  const guardar = useCallback(
    (proximo: Set<string>) => {
      setComprimidos(proximo);
      try {
        localStorage.setItem(chave, JSON.stringify([...proximo]));
      } catch {
        /* sem armazenamento: a escolha vale só nesta sessão */
      }
    },
    [chave],
  );

  return useMemo(
    () => ({
      expandido: (id: string | number) => !comprimidos.has(String(id)),
      alternar: (id: string | number) => {
        const proximo = new Set(comprimidos);
        if (proximo.has(String(id))) proximo.delete(String(id));
        else proximo.add(String(id));
        guardar(proximo);
      },
      expandirTudo: () => guardar(new Set()),
      comprimirTudo: (ids: Array<string | number>) => guardar(new Set(ids.map(String))),
      algumComprimido: comprimidos.size > 0,
    }),
    [comprimidos, guardar],
  );
}
