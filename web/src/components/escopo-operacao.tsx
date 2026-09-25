/**
 * O ESCOPO DA OPERAÇÃO — o seletor de importar e exportar.
 *
 * Substitui o antigo "Unidade em foco", que obrigava a repetir a carga uma vez
 * por matriz do cliente. Agora o padrão é o cliente inteiro, e restringir é a
 * exceção que a pessoa escolhe:
 *
 *   Cliente inteiro     todas as empresas e filiais do cliente (o padrão)
 *   Empresas            as matrizes marcadas, com as filiais delas junto
 *   Unidades            matrizes e/ou filiais marcadas uma a uma
 *
 * O MESMO estado serve às duas operações — importar e exportar —, guardado numa
 * chave só. Mudar o escopo para exportar e esquecer de mudá-lo para importar é
 * exatamente o erro que compartilhar o estado evita.
 *
 * Nada aqui é conferência de segurança: a lista mostra o que a sessão já tem em
 * mãos, e quem decide o que entra na operação é o servidor (`escopo-operacao.ts`).
 */
import { useCallback, useEffect, useState } from 'react';
import { Filtro } from './filtro-escopo';
import { SeletorMulti, type ItemSelecao } from './seletor-multi';

export type ModoEscopo = 'cliente' | 'empresas' | 'unidades';

export interface EscopoOperacao {
  modo: ModoEscopo;
  /** Ids de matriz marcados. Só vale nos modos `empresas` e `unidades`. */
  empresas: number[];
  /** Ids de filial marcados. Só vale no modo `unidades`. */
  filiais: number[];
}

export const ESCOPO_PADRAO: EscopoOperacao = { modo: 'cliente', empresas: [], filiais: [] };

const CHAVE = 'gsti-escopo-operacao';

const MODOS: Array<{ chave: ModoEscopo; rotulo: string; apoio: string }> = [
  {
    chave: 'cliente',
    rotulo: 'Cliente inteiro',
    apoio: 'Todas as empresas e filiais deste cliente, num arquivo só.',
  },
  {
    chave: 'empresas',
    rotulo: 'Empresas selecionadas',
    apoio: 'As matrizes marcadas. As filiais de cada uma entram junto.',
  },
  {
    chave: 'unidades',
    rotulo: 'Unidades específicas',
    apoio: 'Matrizes e filiais marcadas uma a uma.',
  },
];

/**
 * O escopo escolhido, lembrado entre as visitas.
 *
 * Uma chave só, compartilhada por importação e exportação — é o que o enunciado
 * pede com "o mesmo seletor, com o mesmo estado".
 */
export function useEscopoOperacao(): [EscopoOperacao, (e: EscopoOperacao) => void] {
  const [escopo, setEscopo] = useState<EscopoOperacao>(() => {
    try {
      const bruto = localStorage.getItem(CHAVE);
      if (!bruto) return ESCOPO_PADRAO;
      const lido = JSON.parse(bruto) as Partial<EscopoOperacao>;
      return {
        modo: MODOS.some((m) => m.chave === lido.modo) ? (lido.modo as ModoEscopo) : 'cliente',
        empresas: Array.isArray(lido.empresas) ? lido.empresas.filter((n) => Number.isInteger(n)) : [],
        filiais: Array.isArray(lido.filiais) ? lido.filiais.filter((n) => Number.isInteger(n)) : [],
      };
    } catch {
      // Navegador sem armazenamento, aba anônima, dado corrompido: o padrão
      // vale e a tela abre. Escopo lembrado é conveniência, não requisito.
      return ESCOPO_PADRAO;
    }
  });

  const guardar = useCallback((novo: EscopoOperacao) => {
    setEscopo(novo);
    try {
      localStorage.setItem(CHAVE, JSON.stringify(novo));
    } catch {
      /* ver acima */
    }
  }, []);

  return [escopo, guardar];
}

export interface UnidadeDoCliente {
  id: number;
  nome: string;
}

export interface FilialDoCliente {
  id: number;
  nome: string;
  uf?: string | null;
  empresa_id?: number;
  empresa_nome?: string;
}

/**
 * Os parâmetros do escopo na chamada da API.
 *
 * Sai em query string e em corpo de formulário sem mudar de forma — as duas
 * pontas do servidor leem o mesmo contrato.
 */
export function parametrosDoEscopo(escopo: EscopoOperacao): Record<string, string> {
  if (escopo.modo === 'cliente') return { escopo: 'cliente' };
  const saida: Record<string, string> = { escopo: escopo.modo };
  if (escopo.empresas.length) saida.empresas = escopo.empresas.join(',');
  if (escopo.modo === 'unidades' && escopo.filiais.length) saida.filiais = escopo.filiais.join(',');
  return saida;
}

/** O mesmo, pronto para entrar numa URL. */
export function consultaDoEscopo(escopo: EscopoOperacao): string {
  return new URLSearchParams(parametrosDoEscopo(escopo)).toString();
}

/**
 * Quantas unidades o escopo atinge — "3 empresas, 12 filiais".
 *
 * Calculado na tela a partir do que a sessão já tem, para o contador responder
 * no ato. O servidor recalcula o mesmo número para o log; os dois usam a mesma
 * frase de propósito.
 */
export function resumoEscopo(
  escopo: EscopoOperacao,
  empresas: UnidadeDoCliente[],
  filiais: FilialDoCliente[],
): string {
  const empresasNoEscopo =
    escopo.modo === 'cliente' ? empresas.map((e) => e.id) : escopo.empresas;
  const filiaisNoEscopo =
    escopo.modo === 'unidades' && escopo.filiais.length
      ? escopo.filiais
      : filiais.filter((f) => !f.empresa_id || empresasNoEscopo.includes(f.empresa_id)).map((f) => f.id);
  const parte = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  return `${parte(empresasNoEscopo.length, 'empresa', 'empresas')}, ${parte(filiaisNoEscopo.length, 'filial', 'filiais')}`;
}

/** O escopo está pronto para operar? Marcar o modo e não marcar nada, não está. */
export function escopoCompleto(escopo: EscopoOperacao): boolean {
  if (escopo.modo === 'cliente') return true;
  if (escopo.modo === 'empresas') return escopo.empresas.length > 0;
  return escopo.empresas.length > 0 || escopo.filiais.length > 0;
}

export function SeletorEscopo({
  escopo,
  aoMudar,
  empresas,
  filiais,
  explicacao,
}: {
  escopo: EscopoOperacao;
  aoMudar: (e: EscopoOperacao) => void;
  empresas: UnidadeDoCliente[];
  filiais: FilialDoCliente[];
  /** O que esta escolha governa nesta tela. */
  explicacao: string;
}) {
  // Com uma matriz só e nenhuma filial, os três modos dizem a mesma coisa: o
  // seletor seria uma pergunta sem resposta diferente.
  const trivial = empresas.length <= 1 && filiais.length === 0;

  // Sair do modo `cliente` sem nada marcado deixaria o escopo vazio. Marcar
  // tudo é o ponto de partida honesto: a pessoa desmarca o que não quer.
  useEffect(() => {
    if (escopo.modo === 'empresas' && escopo.empresas.length === 0 && empresas.length > 0) {
      aoMudar({ ...escopo, empresas: empresas.map((e) => e.id) });
    }
  }, [escopo, empresas, aoMudar]);

  if (trivial) {
    return empresas.length === 1 ? (
      <p className="dica-filtro" style={{ margin: '0 0 8px' }}>
        Unidade: <strong>{empresas[0]!.nome}</strong>. {explicacao}
      </p>
    ) : null;
  }

  const itensEmpresa: ItemSelecao[] = empresas.map((e) => ({ valor: String(e.id), rotulo: e.nome }));
  const itensFilial: ItemSelecao[] = filiais.map((f) => ({
    valor: String(f.id),
    rotulo: f.uf ? `${f.nome} — ${f.uf}` : f.nome,
    apoio: f.empresa_nome ?? undefined,
  }));

  const trocarModo = (modo: ModoEscopo) => {
    if (modo === 'cliente') return aoMudar({ modo, empresas: [], filiais: [] });
    if (modo === 'empresas') return aoMudar({ modo, empresas: empresas.map((e) => e.id), filiais: [] });
    return aoMudar({ modo, empresas: escopo.empresas, filiais: escopo.filiais });
  };

  return (
    <fieldset className="campo filtro escopo-operacao" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend style={{ padding: 0 }}>
        <span className="rotulo-escopo">Escopo da operação</span>{' '}
        <strong className="contador-escopo">{resumoEscopo(escopo, empresas, filiais)}</strong>
      </legend>

      <div className="opcoes-escopo" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, margin: '6px 0' }}>
        {MODOS.map((m) => (
          <label key={m.chave} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }} title={m.apoio}>
            <input
              type="radio"
              name="escopo-operacao"
              value={m.chave}
              checked={escopo.modo === m.chave}
              onChange={() => trocarModo(m.chave)}
            />
            {m.rotulo}
          </label>
        ))}
      </div>

      {escopo.modo !== 'cliente' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <Filtro rotulo="Empresas (matrizes)" explicacao="As matrizes que entram na operação.">
            <SeletorMulti
              rotulo="Empresas (matrizes)"
              largura={220}
              itens={itensEmpresa}
              selecionados={escopo.empresas.map(String)}
              aoMudar={(v) => aoMudar({ ...escopo, empresas: v.map(Number) })}
            />
          </Filtro>

          {escopo.modo === 'unidades' && (
            <Filtro
              rotulo="Filiais"
              explicacao="As filiais que entram. Vazio traz todas as filiais das matrizes marcadas."
            >
              <SeletorMulti
                rotulo="Filiais"
                largura={230}
                itens={itensFilial}
                selecionados={escopo.filiais.map(String)}
                aoMudar={(v) => aoMudar({ ...escopo, filiais: v.map(Number) })}
              />
            </Filtro>
          )}

          <button
            type="button"
            className="botao discreto pequeno"
            onClick={() => aoMudar({ ...escopo, empresas: empresas.map((e) => e.id), filiais: [] })}
          >
            Selecionar todas
          </button>
          <button
            type="button"
            className="botao discreto pequeno"
            onClick={() => aoMudar({ ...escopo, empresas: [], filiais: [] })}
          >
            Limpar seleção
          </button>
        </div>
      )}

      <small className="dica-filtro">{explicacao}</small>
      {!escopoCompleto(escopo) && (
        <small className="dica-filtro" style={{ color: 'var(--alerta)' }}>
          Nenhuma unidade marcada — marque ao menos uma, ou volte para "Cliente inteiro".
        </small>
      )}
    </fieldset>
  );
}

/**
 * A etapa em que a operação está.
 *
 * Não é barra de percentual: uma carga tem fases com duração muito desigual, e
 * um número subindo sozinho mentiria sobre quanto falta. Dizer em que fase está
 * — e quantas linhas já foram — informa mais e não promete o que não sabe.
 */
export function EtapaOperacao({ etapa, detalhe }: { etapa: string | null; detalhe?: string | null }) {
  if (!etapa) return null;
  return (
    <p className="etapa-operacao" role="status" aria-live="polite" style={{ margin: '8px 0 0', fontSize: 13 }}>
      <span className="girando" aria-hidden>
        ⏳
      </span>{' '}
      {etapa}
      {detalhe ? ` — ${detalhe}` : ''}
    </p>
  );
}
