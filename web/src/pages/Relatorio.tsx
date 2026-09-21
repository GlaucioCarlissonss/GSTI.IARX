/**
 * Relatório financeiro — tabela dinâmica com drill-down em três níveis.
 *
 * É o formato que o gestor já monta no Excel: meses nas colunas, hierarquia
 * nas linhas, Total Geral nas duas pontas. A diferença é que aqui o detalhe
 * está a um clique.
 *
 *   1. macro       — filiais e seus totais por mês (padrão: recolhido)
 *   2. categoria   — expandir a filial mostra os tipos de despesa
 *   3. lançamento  — expandir o tipo busca os lançamentos daquele recorte
 *
 * O nível 3 é carregado sob demanda: trazer todos os lançamentos junto do
 * macro tornaria a primeira tela lenta pelo que quase nunca é olhado.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { useFiltroEscopo } from '../lib/filtros';
import { EXPLICACAO, Filtro, FiltroUnidades } from '../components/filtro-escopo';
import { Aviso, Campo, Carregando, Cartao, Etiqueta, Modal, UltimaAtualizacao } from '../components/base';
import { SeletorMulti } from '../components/seletor-multi';
import { competenciaValida, inteiro, moeda } from '../lib/formato';
import { detalheConsumo, tipoDe, type FilialBeneficiada, type TipoConsumo } from '../lib/consumo';
import { EtiquetaConsumo, LegendaDeConsumo, useCorCompartilhada } from '../components/consumo';
import { useExpansao } from '../lib/expansao';
import { BlocosPorUnidade, SeletorModo, useModoVisao } from '../components/visao-financeira';

/** Centavos → moeda. O relatório trabalha em centavos inteiros, como o banco. */
const dinheiro = (centavos: number) => moeda(centavos / 100);

interface LinhaRelatorio {
  chave: string;
  rotulo: string;
  nivel: 1 | 2;
  pai: string | null;
  filial_id: number | null;
  tipo_despesa_id: number | null;
  meses: Record<string, number>;
  total_centavos: number;
  lancamentos: number;
}

interface Relatorio {
  colunas: string[];
  linhas: LinhaRelatorio[];
  total_geral: { meses: Record<string, number>; total_centavos: number; lancamentos: number };
}

export interface Lancamento {
  id: number;
  /** A matriz pagadora: é dela a cor com que a linha marca a despesa compartilhada. */
  empresa_id: number;
  competencia: string;
  valor_centavos: number;
  natureza: string;
  classificacao: string;
  parcela_numero: number | null;
  qtd_parcelas: number | null;
  descricao: string | null;
  observacoes: string | null;
  origem: string;
  origem_rotulo: string;
  origem_custo: string | null;
  destino_pagamento: string | null;
  documento: string | null;
  cenario: string;
  filial_nome: string;
  tipo_despesa: string;
  tipo_consumo: TipoConsumo;
  beneficia_todas: boolean;
  filiais_beneficiadas: FilialBeneficiada[];
}

interface Detalhe {
  itens: Lancamento[];
  total_centavos: number;
}

/**
 * Tooltip de um lançamento: a descrição completa, com de onde veio o custo e
 * para onde foi o pagamento. É a pergunta que a linha da tabela não cabe
 * responder e que o gestor faz antes de abrir o registro.
 */
export function resumoDoLancamento(l: Lancamento): string {
  return [
    l.descricao || l.tipo_despesa,
    `\n\nOrigem do custo: ${l.origem_custo ?? 'não informada'}`,
    `\nDestino do pagamento: ${l.destino_pagamento ?? 'não informado'}`,
    `\nConsumo: ${detalheConsumo(l)}`,
    `\nValor: ${dinheiro(l.valor_centavos)} · ${l.competencia}`,
    l.documento ? `\nDocumento: ${l.documento}` : '',
    l.parcela_numero && l.qtd_parcelas ? `\nParcela ${l.parcela_numero} de ${l.qtd_parcelas}` : '',
    l.observacoes ? `\n\n${l.observacoes}` : '',
    '\n\nClique para ver o detalhamento completo.',
  ].join('');
}

export function PaginaRelatorio() {
  const { empresas, filiais, cliente } = useSessao();
  // Filtro LOCAL deste relatório.
  const escopo = useFiltroEscopo('relatorio');
  // Padrão recolhido, como na tabela dinâmica do anexo: a visão macro primeiro.
  const grupos = useExpansao('gsti-relatorio-expandidos', 'recolhido');
  // O modo é o mesmo de Lançamentos: quem organizou a leitura numa tela espera
  // encontrar a outra do mesmo jeito.
  const [modo, trocarModo] = useModoVisao();
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [classificacoes, setClassificacoes] = useState<string[]>([]);
  const [aberto, setAberto] = useState<Lancamento | null>(null);
  const [telaCheia, setTelaCheia] = useState(false);

  const consulta = useDados<Relatorio>(
    () =>
      api.get('/api/dashboards/relatorio', {
        empresas: escopo.params.empresas,
        filial_id: escopo.params.filial_id,
        competencia_inicio: competenciaValida(de) ? de : undefined,
        competencia_fim: competenciaValida(ate) ? ate : undefined,
        classificacao: classificacoes.join(','),
      }),
    [escopo.params.empresas, escopo.params.filial_id, de, ate, classificacoes],
  );

  // O detalhe de cada linha expandida, buscado sob demanda e mantido em cache
  // enquanto o filtro não muda — reabrir o mesmo grupo não refaz a consulta.
  const [detalhes, setDetalhes] = useState<Record<string, Detalhe | 'carregando' | 'erro'>>({});

  // Esc sai da tela cheia: é o que a mão já faz, e sem isso só o botão devolve
  // a tela — que some de vista quando a tabela está rolada.
  useEffect(() => {
    if (!telaCheia) return;
    const sair = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setTelaCheia(false);
    };
    document.addEventListener('keydown', sair);
    return () => document.removeEventListener('keydown', sair);
  }, [telaCheia]);
  useEffect(() => setDetalhes({}), [escopo.params.empresas, escopo.params.filial_id, de, ate, classificacoes]);

  const buscarDetalhe = useCallback(
    async (linha: LinhaRelatorio) => {
      setDetalhes((d) => (d[linha.chave] ? d : { ...d, [linha.chave]: 'carregando' }));
      try {
        const r = await api.get<Detalhe>('/api/dashboards/relatorio/lancamentos', {
          empresas: escopo.params.empresas,
          filial_id: linha.filial_id === null ? 'nenhuma' : linha.filial_id,
          tipo_despesa_id: linha.tipo_despesa_id ?? undefined,
          competencia_inicio: competenciaValida(de) ? de : undefined,
          competencia_fim: competenciaValida(ate) ? ate : undefined,
          classificacao: classificacoes.join(','),
        });
        setDetalhes((d) => ({ ...d, [linha.chave]: r }));
      } catch {
        setDetalhes((d) => ({ ...d, [linha.chave]: 'erro' }));
      }
    },
    [de, ate, classificacoes],
  );

  // Só o nível 2 traz lançamentos; o nível 1 expande para os tipos, que já
  // vieram no macro. A busca fica aqui, e não no clique, para cobrir também
  // "Expandir tudo", que abre muitas linhas de uma vez.
  useEffect(() => {
    for (const linha of consulta.dados?.linhas ?? []) {
      if (linha.nivel !== 2) continue;
      if (!grupos.expandido(linha.chave) || !grupos.expandido(linha.pai!)) continue;
      if (detalhes[linha.chave]) continue;
      void buscarDetalhe(linha);
    }
  }, [consulta.dados, grupos, detalhes, buscarDetalhe]);

  /**
   * As linhas visíveis agora: filiais sempre, tipos quando a filial está
   * aberta, e os lançamentos logo abaixo do tipo aberto.
   */
  const visiveis = useMemo(() => {
    if (!consulta.dados) return [];
    const saida: Array<
      | { tipo: 'grupo'; linha: LinhaRelatorio }
      | { tipo: 'lancamentos'; chave: string; pai: LinhaRelatorio }
    > = [];
    for (const linha of consulta.dados.linhas) {
      if (linha.nivel === 2 && !grupos.expandido(linha.pai!)) continue;
      saida.push({ tipo: 'grupo', linha });
      if (linha.nivel === 2 && grupos.expandido(linha.chave)) {
        saida.push({ tipo: 'lancamentos', chave: linha.chave, pai: linha });
      }
    }
    return saida;
  }, [consulta.dados, grupos]);

  if (consulta.erro) return <Aviso tipo="erro">{consulta.erro}</Aviso>;
  if (!consulta.dados) return <Carregando />;
  const d = consulta.dados;
  const colunas = d.colunas;

  return (
    <>
      <div className="barra-filtros">
        <FiltroUnidades
          empresas={empresas}
          empresasSel={escopo.empresas}
          aoMudarEmpresas={escopo.definirEmpresas}
          filiais={filiais}
          filiaisSel={escopo.filiais}
          aoMudarFiliais={escopo.definirFiliais}
          aoLimpar={escopo.limpar}
        />
        <Filtro rotulo="De" explicacao={EXPLICACAO.competenciaIntervalo}>
          <input value={de} onChange={(e) => setDe(e.target.value)} placeholder="MM/AAAA" style={{ width: 100 }} />
        </Filtro>
        <Filtro rotulo="Até" explicacao={EXPLICACAO.competenciaIntervalo}>
          <input value={ate} onChange={(e) => setAte(e.target.value)} placeholder="MM/AAAA" style={{ width: 100 }} />
        </Filtro>
        <Filtro rotulo="Classificação" explicacao="Separa custeio (despesa) de investimento. Vazio traz os dois.">
          <SeletorMulti
            rotulo="Classificação"
            largura={190}
            itens={[
              { valor: 'despesa', rotulo: 'Despesa' },
              { valor: 'investimento', rotulo: 'Investimento' },
            ]}
            selecionados={classificacoes}
            aoMudar={setClassificacoes}
          />
        </Filtro>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <button
            type="button"
            className="botao discreto pequeno"
            onClick={() => grupos.expandirTudo(d.linhas.map((l) => l.chave))}
          >
            Expandir tudo
          </button>
          <button type="button" className="botao discreto pequeno" onClick={() => grupos.comprimirTudo()}>
            Recolher tudo
          </button>
        </div>
        <SeletorModo modo={modo} aoTrocar={trocarModo} />
        <UltimaAtualizacao cliente={cliente?.id} />
      </div>

      {d.linhas.length === 0 ? (
        <Cartao titulo="Relatório financeiro">
          <p className="vazio">Nenhum lançamento no recorte selecionado.</p>
        </Cartao>
      ) : modo !== 'lista' ? (
        <BlocosPorUnidade linhas={d.linhas} colunas={colunas} modo={modo} filiais={filiais} />
      ) : (
        <Cartao
          titulo="Relatório financeiro"
          descricao={`${inteiro(d.total_geral.lancamentos)} lançamento(s) · ${colunas.length} mês(es) · clique em + para abrir o detalhe`}
          classe={telaCheia ? 'tela-cheia' : undefined}
          acoes={
            <button
              type="button"
              className="botao discreto pequeno"
              aria-pressed={telaCheia}
              onClick={() => setTelaCheia((v) => !v)}
            >
              {telaCheia ? 'Sair da tela cheia' : 'Tela cheia'}
            </button>
          }
        >
          <div className="tabela-envolucro rol-fixo">
            <table className="pivot">
              <thead>
                <tr>
                  {/* Fixo pela folha de estilo, junto do cabeçalho e do rodapé. */}
                  <th style={{ minWidth: 240 }}>Rótulos de linha</th>
                  {colunas.map((m) => (
                    <th key={m} className="num">
                      {m}
                    </th>
                  ))}
                  <th className="num">Total Geral</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((v) =>
                  v.tipo === 'grupo' ? (
                    <LinhaGrupo
                      key={v.linha.chave}
                      linha={v.linha}
                      colunas={colunas}
                      aberto={grupos.expandido(v.linha.chave)}
                      aoAlternar={() => grupos.alternar(v.linha.chave)}
                    />
                  ) : (
                    <LinhasDetalhe
                      key={`d-${v.chave}`}
                      estado={detalhes[v.chave]}
                      pai={v.pai}
                      colunas={colunas}
                      aoAbrir={setAberto}
                    />
                  ),
                )}
              </tbody>
              <tfoot>
                <tr className="total-geral">
                  <th>Total Geral</th>
                  {colunas.map((m) => (
                    <td key={m} className="num">
                      {d.total_geral.meses[m] ? dinheiro(d.total_geral.meses[m]!) : '-'}
                    </td>
                  ))}
                  <td className="num">{dinheiro(d.total_geral.total_centavos)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <LegendaDeConsumo />
        </Cartao>
      )}

      {aberto && <DetalheLancamento lancamento={aberto} aoFechar={() => setAberto(null)} />}
    </>
  );
}

function LinhaGrupo({
  linha,
  colunas,
  aberto,
  aoAlternar,
}: {
  linha: LinhaRelatorio;
  colunas: string[];
  aberto: boolean;
  aoAlternar: () => void;
}) {
  return (
    <tr className={linha.nivel === 1 ? 'grupo-1' : 'grupo-2'}>
      <th
        scope="row"
        style={{
          position: 'sticky',
          left: 0,
          background: 'var(--superficie)',
          paddingLeft: 8 + (linha.nivel - 1) * 18,
          fontWeight: linha.nivel === 1 ? 600 : 500,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <button
            type="button"
            className="pivot-grupo"
            aria-expanded={aberto}
            aria-label={`${aberto ? 'Recolher' : 'Expandir'} ${linha.rotulo}`}
            title={aberto ? 'Recolher' : 'Expandir'}
            onClick={aoAlternar}
          >
            <span aria-hidden>{aberto ? '−' : '+'}</span>
          </button>
          {linha.rotulo}
          {linha.nivel === 2 && (
            <span style={{ color: 'var(--tinta-fraca)', fontSize: 11.5 }}>
              {inteiro(linha.lancamentos)} lanç.
            </span>
          )}
        </span>
      </th>
      {colunas.map((m) => (
        <td key={m} className="num">
          {linha.meses[m] ? dinheiro(linha.meses[m]!) : '-'}
        </td>
      ))}
      <td className="num">{dinheiro(linha.total_centavos)}</td>
    </tr>
  );
}

/** Nível 3: os lançamentos, com tooltip e clique para o registro inteiro. */
function LinhasDetalhe({
  estado,
  pai,
  colunas,
  aoAbrir,
}: {
  estado: Detalhe | 'carregando' | 'erro' | undefined;
  pai: LinhaRelatorio;
  colunas: string[];
  aoAbrir: (l: Lancamento) => void;
}) {
  const largura = colunas.length + 2;

  if (estado === undefined || estado === 'carregando') {
    return (
      <tr>
        <td colSpan={largura} style={{ paddingLeft: 54 }}>
          <Carregando />
        </td>
      </tr>
    );
  }
  if (estado === 'erro') {
    return (
      <tr>
        <td colSpan={largura} style={{ paddingLeft: 54 }}>
          <Aviso tipo="erro">Não foi possível carregar os lançamentos desta linha. Tente recolher e expandir de novo.</Aviso>
        </td>
      </tr>
    );
  }
  if (estado.itens.length === 0) {
    return (
      <tr>
        <td colSpan={largura} style={{ paddingLeft: 54, color: 'var(--tinta-fraca)' }}>
          Nenhum lançamento nesta linha.
        </td>
      </tr>
    );
  }

  return (
    <>
      {estado.itens.map((l) => (
        <LinhaLancamentoPivo key={l.id} lancamento={l} colunas={colunas} aoAbrir={aoAbrir} />
      ))}
      {/* A soma do detalhe, ao lado do número que estava no macro: se
          divergirem, a divergência aparece aqui e não num lugar qualquer. */}
      <tr className="soma-detalhe">
        <th scope="row" style={{ position: 'sticky', left: 0, background: 'var(--superficie)', paddingLeft: 54, fontWeight: 500 }}>
          Soma dos {inteiro(estado.itens.length)} lançamento(s)
        </th>
        <td className="num" colSpan={colunas.length}>
          {estado.total_centavos === pai.total_centavos ? (
            <span style={{ color: 'var(--tinta-fraca)', fontSize: 11.5 }}>confere com o total da linha</span>
          ) : (
            <Etiqueta texto="diverge do total da linha" tom="critico" />
          )}
        </td>
        <td className="num">{dinheiro(estado.total_centavos)}</td>
      </tr>
    </>
  );
}

/**
 * A linha de um lançamento no pivô (nível 3).
 *
 * A etiqueta de consumo não cabe numa célula do pivô, que já é estreita e
 * rolável. A marca é um filete na cor ESCURA da empresa, à esquerda, onde o
 * olho já corre — a mesma convenção do tom escurecido do resto do financeiro.
 * O `title` da linha continua dizendo por extenso quem consome, que é o canal
 * que não depende de enxergar cor.
 */
function LinhaLancamentoPivo({
  lancamento: l,
  colunas,
  aoAbrir,
}: {
  lancamento: Lancamento;
  colunas: string[];
  aoAbrir: (l: Lancamento) => void;
}) {
  const cor = useCorCompartilhada(l.empresa_id);
  const compartilhada = tipoDe(l) === 'compartilhado';
  return (
    <tr
      className="lancamento"
      onClick={() => aoAbrir(l)}
      title={resumoDoLancamento(l)}
      data-compartilhada={compartilhada ? '' : undefined}
      style={compartilhada ? ({ ['--cor' as string]: cor } as CSSProperties) : undefined}
    >
      <th scope="row" style={{ position: 'sticky', left: 0, background: 'var(--superficie)', paddingLeft: 54, fontWeight: 400 }}>
        <span style={{ color: 'var(--tinta-2)' }}>{l.descricao || l.tipo_despesa}</span>
        {l.origem_custo && (
          <div style={{ fontSize: 11, color: 'var(--tinta-fraca)' }}>
            {l.origem_custo}
            {l.destino_pagamento ? ` → ${l.destino_pagamento}` : ''}
          </div>
        )}
      </th>
      {colunas.map((m) => (
        <td key={m} className="num" style={{ color: 'var(--tinta-2)' }}>
          {l.competencia === m ? dinheiro(l.valor_centavos) : ''}
        </td>
      ))}
      <td className="num" style={{ color: 'var(--tinta-2)' }}>
        {dinheiro(l.valor_centavos)}
      </td>
    </tr>
  );
}

function DetalheLancamento({ lancamento: l, aoFechar }: { lancamento: Lancamento; aoFechar: () => void }) {
  return (
    <Modal titulo={l.descricao || l.tipo_despesa} aberto aoFechar={aoFechar}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Etiqueta texto={dinheiro(l.valor_centavos)} />
        <Etiqueta texto={l.competencia} />
        <Etiqueta texto={l.classificacao === 'investimento' ? 'Investimento' : 'Despesa'} />
        <Etiqueta texto={l.origem_rotulo} />
        {l.cenario !== 'oficial' && <Etiqueta texto={`Cenário ${l.cenario}`} tom="atencao" />}
      </div>

      <dl className="ficha">
        <dt>Descrição</dt>
        <dd>{l.descricao ?? '—'}</dd>
        <dt>Origem do custo</dt>
        <dd>{l.origem_custo ?? 'não informada'}</dd>
        <dt>Destino do pagamento</dt>
        <dd>{l.destino_pagamento ?? 'não informado'}</dd>
        <dt>Consumo</dt>
        <dd>
          <EtiquetaConsumo lancamento={l} />
          <div style={{ marginTop: 4 }}>{detalheConsumo(l)}</div>
        </dd>
        <dt>Documento vinculado</dt>
        <dd>{l.documento ?? '—'}</dd>
        <dt>Filial</dt>
        <dd>{l.filial_nome}</dd>
        <dt>Tipo de despesa</dt>
        <dd>{l.tipo_despesa}</dd>
        <dt>Natureza</dt>
        <dd>
          {l.natureza === 'fixa' ? 'Fixa' : l.natureza === 'pontual_unica' ? 'Pontual única' : 'Pontual parcelada'}
          {l.parcela_numero && l.qtd_parcelas ? ` · parcela ${l.parcela_numero} de ${l.qtd_parcelas}` : ''}
        </dd>
        <dt>Procedência do dado</dt>
        <dd>{l.origem_rotulo}</dd>
        <dt>Observações</dt>
        <dd>{l.observacoes ?? '—'}</dd>
      </dl>
    </Modal>
  );
}
