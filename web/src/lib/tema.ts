import { useCallback, useEffect, useState } from 'react';

/**
 * Três estados: `sistema` segue o aparelho; `claro` e `escuro` carimbam
 * `data-tema` na raiz, que é o que `estilos.css` já sabe interpretar.
 */
export type Tema = 'sistema' | 'claro' | 'escuro';

const CHAVE = 'gsti-tema';
export const TEMAS: Tema[] = ['sistema', 'claro', 'escuro'];
export const ROTULO_TEMA: Record<Tema, string> = {
  sistema: 'Tema do sistema',
  claro: 'Tema claro',
  escuro: 'Tema escuro',
};
export const ICONE_TEMA: Record<Tema, string> = { sistema: '◐', claro: '☀', escuro: '☾' };

function lerTema(): Tema {
  try {
    const t = localStorage.getItem(CHAVE);
    return TEMAS.includes(t as Tema) ? (t as Tema) : 'sistema';
  } catch {
    // Armazenamento bloqueado (janela anônima, cookies desligados): o tema
    // vale só nesta sessão, e seguir o aparelho é o padrão razoável.
    return 'sistema';
  }
}

function aplicar(tema: Tema) {
  const raiz = document.documentElement;
  if (tema === 'sistema') raiz.removeAttribute('data-tema');
  else raiz.setAttribute('data-tema', tema);
  try {
    localStorage.setItem(CHAVE, tema);
  } catch {
    /* sem armazenamento: a escolha não sobrevive ao recarregar */
  }
}

/** Tema atual e o passo para o próximo, na ordem sistema → claro → escuro. */
export function useTema(): { tema: Tema; alternar: () => void } {
  const [tema, setTema] = useState<Tema>(lerTema);

  useEffect(() => {
    aplicar(tema);
  }, [tema]);

  const alternar = useCallback(() => {
    setTema((atual) => TEMAS[(TEMAS.indexOf(atual) + 1) % TEMAS.length]!);
  }, []);

  return { tema, alternar };
}
