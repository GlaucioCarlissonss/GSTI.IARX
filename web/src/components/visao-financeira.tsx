/**
 * Como olhar os mesmos números: em dinâmica, ou em blocos por unidade.
 *
 * A dinâmica responde "quanto, em que mês"; os blocos respondem "quanto, em
 * qual unidade". É a mesma base recortada de dois jeitos, e trocar entre eles
 * não recarrega a página nem refaz a consulta.
 *
 * O modo escolhido vale para Lançamentos E Relatório: quem organizou a leitura
 * numa tela espera encontrar a outra do mesmo jeito.
 */
import { useCallback, useMemo, useState } from 'react';
import { Cartao, Etiqueta } from './base';
import { inteiro, moeda } from '../lib/formato';
import type { Filial } from '../lib/sessao';

export type ModoVisao = 'lista' | 'filial' | 'matriz';

const CHAVE_MODO = 'gsti-modo-visao';

export const MODOS: Array<{ valor: ModoVisao; rotulo: string; dica: string }> = [
  { valor: 'lista', rotulo: 'Lista', dica: 'Tabela dinâmica: meses nas colunas, hierarquia nas linhas.' },
  { valor: 'filial', rotulo: 'Blocos por filial', dica: 'Um bloco por filial, com o total dela.' },
  { valor: 'matriz', rotulo: 'Blocos por matriz', dica: 'Um bloco por matriz, somando as filiais dela.' },
];

/** O modo é compartilhado pelas duas telas, então mora numa chave só. */
export function useModoVisao(): [ModoVisao, (m: ModoVisao) => void] {
  const [modo, setModo] = useState<ModoVisao>(() => {
    try {
      const guardado = localStorage.getItem(CHAVE_MODO);
      return guardado === 'filial' || guardado === 'matriz' ? guardado : 'lista';
    } catch {
      return 'lista';
    }
  });

  const trocar = useCallback((m: ModoVisao) => {
    setModo(m);
    try {
      localStorage.setItem(CHAVE_MODO, m);
    } catch {
      /* sem armazenamento: a escolha vale só nesta sessão */
    }
  }, []);

  return [modo, trocar];
}

export function SeletorModo({ modo, aoTrocar }: { modo: ModoVisao; aoTrocar: (m: ModoVisao) => void }) {
  return (
    <div className="modo-visao" role="group" aria-label="Como exibir os números">
      {MODOS.map((m) => (
        <button
          key={m.valor}
          type="button"
          className={modo === m.valor ? 'ativo' : ''}
          aria-pressed={modo === m.valor}
          title={m.dica}
          onClick={() => aoTrocar(m.valor)}
        >
          {m.rotulo}
        </button>
      ))}
    </div>
  );
}

export interface LinhaVisao {
  chave: string;
  rotulo: string;
  nivel: 1 | 2;
  pai: string | null;
  filial_id: number | null;
  meses: Record<string, number>;
  total_centavos: number;
  lancamentos: number;
}

interface Grupo {
  nome: string;
  total: number;
  lancamentos: number;
  meses: Record<string, number>;
  itens: Array<{ rotulo: string; total: number; lancamentos: number }>;
}

/**
 * Agrupa as linhas por filial ou por matriz.
 *
 * O relatório vem com a filial no nível 1 e o tipo de despesa no 2. Para os
 * blocos por matriz, a ligação filial → matriz vem do cadastro da sessão: a
 * consulta não a traz, e pedi-la ao servidor só para agrupar seria uma viagem
 * a mais por um dado que a tela já tem.
 */
function agrupar(linhas: LinhaVisao[], modo: 'filial' | 'matriz', filiais: Filial[]): Grupo[] {
  const matrizDaFilial = new Map(filiais.map((f) => [f.id, f.empresa_nome ?? 'Sem matriz']));
  const grupos = new Map<string, Grupo>();

  for (const linha of linhas) {
    if (linha.nivel !== 1) continue;
    const nome =
      modo === 'filial'
        ? linha.rotulo
        : (linha.filial_id !== null ? matrizDaFilial.get(linha.filial_id) : null) ?? 'Sem matriz';

    let grupo = grupos.get(nome);
    if (!grupo) {
      grupo = { nome, total: 0, lancamentos: 0, meses: {}, itens: [] };
      grupos.set(nome, grupo);
    }
    grupo.total += linha.total_centavos;
    grupo.lancamentos += linha.lancamentos;
    for (const [mes, valor] of Object.entries(linha.meses)) {
      grupo.meses[mes] = (grupo.meses[mes] ?? 0) + valor;
    }
    // Dentro do bloco, o detalhe é o nível seguinte: os tipos daquela filial.
    for (const filho of linhas) {
      if (filho.nivel === 2 && filho.pai === linha.chave) {
        const existente = grupo.itens.find((i) => i.rotulo === filho.rotulo);
        if (existente) {
          existente.total += filho.total_centavos;
          existente.lancamentos += filho.lancamentos;
        } else {
          grupo.itens.push({ rotulo: filho.rotulo, total: filho.total_centavos, lancamentos: filho.lancamentos });
        }
      }
    }
  }

  return [...grupos.values()]
    .map((g) => ({ ...g, itens: g.itens.sort((a, b) => b.total - a.total) }))
    .sort((a, b) => b.total - a.total);
}

/** Os mesmos números, um bloco por unidade, do maior total para o menor. */
export function BlocosPorUnidade({
  linhas,
  colunas,
  modo,
  filiais,
}: {
  linhas: LinhaVisao[];
  colunas: string[];
  modo: 'filial' | 'matriz';
  filiais: Filial[];
}) {
  const grupos = useMemo(() => agrupar(linhas, modo, filiais), [linhas, modo, filiais]);

  if (grupos.length === 0) return <p className="vazio">Nenhum lançamento no recorte selecionado.</p>;

  return (
    <div className="grade c2">
      {grupos.map((g) => (
        <Cartao
          key={g.nome}
          titulo={g.nome}
          descricao={`${inteiro(g.lancamentos)} lançamento(s)`}
          acoes={<Etiqueta texto={moeda(g.total / 100)} tom="neutro" />}
        >
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th className="num">Lançamentos</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {g.itens.map((i) => (
                  <tr key={i.rotulo}>
                    <td>{i.rotulo}</td>
                    <td className="num">{inteiro(i.lancamentos)}</td>
                    <td className="num">{moeda(i.total / 100)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="num">{inteiro(g.lancamentos)}</td>
                  <td className="num">{moeda(g.total / 100)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {colunas.length > 1 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--tinta-fraca)' }}>
              {colunas.map((c) => `${c}: ${moeda((g.meses[c] ?? 0) / 100)}`).join(' · ')}
            </div>
          )}
        </Cartao>
      ))}
    </div>
  );
}
