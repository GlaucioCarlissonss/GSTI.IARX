import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Seletor de múltipla escolha com caixas.
 *
 * Todo filtro do sistema usa este componente, e o que está marcado aparece em
 * fichas removíveis ao lado — a escolha fica na tela sem precisar reabrir o
 * seletor.
 *
 * Conjunto vazio significa "todos" onde isso faz sentido. Onde não faz
 * (competência, cenário), `minimo` impede esvaziar: um painel sem competência
 * nenhuma não mostraria número algum.
 */
export interface ItemSelecao {
  valor: string;
  rotulo: string;
  apoio?: string;
}

export function SeletorMulti({
  rotulo,
  itens,
  selecionados,
  aoMudar,
  minimo = 0,
  aviso,
  largura = 190,
}: {
  rotulo: string;
  itens: ItemSelecao[];
  selecionados: string[];
  aoMudar: (valores: string[]) => void;
  minimo?: number;
  aviso?: ReactNode;
  largura?: number;
}) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState('');
  const raiz = useRef<HTMLDivElement>(null);
  const escolhidos = useMemo(() => new Set(selecionados), [selecionados]);

  useEffect(() => {
    if (!aberto) return;
    const forade = (ev: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(ev.target as Node)) setAberto(false);
    };
    const tecla = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', forade);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', forade);
      document.removeEventListener('keydown', tecla);
    };
  }, [aberto]);

  const alternar = (valor: string) => {
    if (escolhidos.has(valor)) {
      if (escolhidos.size <= minimo) return;   // o mínimo não pode ser violado
      aoMudar(selecionados.filter((v) => v !== valor));
    } else {
      aoMudar([...selecionados, valor]);
    }
  };

  const resumo = () => {
    if (escolhidos.size === 0) return minimo ? 'Nenhum' : 'Todos';
    if (escolhidos.size === 1) {
      return itens.find((i) => i.valor === selecionados[0])?.rotulo ?? selecionados[0];
    }
    if (escolhidos.size === itens.length) return `Todos (${itens.length})`;
    return `${escolhidos.size} de ${itens.length}`;
  };

  const visiveis = termo.trim()
    ? itens.filter((i) => i.rotulo.toLowerCase().includes(termo.trim().toLowerCase()))
    : itens;

  return (
    <div className="seletor-multi" ref={raiz} style={{ width: largura }}>
      <button
        type="button"
        className="gatilho"
        aria-expanded={aberto}
        aria-haspopup="listbox"
        aria-label={rotulo}
        onClick={() => setAberto((a) => !a)}
      >
        {resumo()}
      </button>
      {aberto && (
        <div className="painel" role="listbox" aria-multiselectable>
          {itens.length > 8 && (
            <input
              className="busca"
              type="search"
              placeholder="Filtrar…"
              aria-label="Filtrar opções"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              autoFocus
            />
          )}
          <div className="acoes">
            <button type="button" className="botao pequeno" onClick={() => aoMudar(itens.map((i) => i.valor))}>
              Todos
            </button>
            <button
              type="button"
              className="botao pequeno"
              onClick={() => aoMudar(minimo ? itens.slice(0, minimo).map((i) => i.valor) : [])}
            >
              {minimo ? 'Só o primeiro' : 'Limpar'}
            </button>
          </div>
          {aviso && <p className="aviso-seletor">{aviso}</p>}
          <ul className="lista">
            {visiveis.length === 0 && <li className="nada">Nada encontrado.</li>}
            {visiveis.map((i) => (
              <li key={i.valor}>
                <label>
                  <input
                    type="checkbox"
                    checked={escolhidos.has(i.valor)}
                    onChange={() => alternar(i.valor)}
                  />
                  <span className="rot">{i.rotulo}</span>
                  {i.apoio && <span className="ap">{i.apoio}</span>}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Fichas do que está selecionado. Com um item só a ficha é omitida: o próprio
 * botão do seletor já mostra o nome, e repetir vira ruído.
 */
export function FichasSelecao({
  grupos,
}: {
  grupos: Array<{
    chave: string;
    rotulo: string;
    itens: ItemSelecao[];
    selecionados: string[];
    minimo?: number;
    aoMudar: (valores: string[]) => void;
  }>;
}) {
  const visiveis = grupos.filter((g) => g.selecionados.length > 1);
  if (!visiveis.length) return null;
  return (
    <div className="fichas">
      {visiveis.map((g) => (
        <span key={g.chave} className="bloco-fichas">
          <span className="rotulo-grupo">{g.rotulo}</span>
          {g.selecionados.map((v) => (
            <span key={v} className="ficha">
              <span>{g.itens.find((i) => i.valor === v)?.rotulo ?? v}</span>
              {g.selecionados.length > (g.minimo ?? 0) && (
                <button
                  type="button"
                  aria-label={`Remover ${v}`}
                  onClick={() => g.aoMudar(g.selecionados.filter((x) => x !== v))}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}
