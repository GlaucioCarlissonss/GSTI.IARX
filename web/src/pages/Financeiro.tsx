import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { Aviso, Campo, Carregando, Cartao } from '../components/base';
import { FichasSelecao, SeletorMulti } from '../components/seletor-multi';
import { GraficoBarras, GraficoLinhas, GraficoRanking, Indicador } from '../components/graficos';
import { Detalhamento, detalheDeLancamentos, type PedidoDetalhe } from '../components/detalhamento';
import { competenciaValida, inteiro, mesCurto, moeda, moedaCurta, percentual, ROTULO_NATUREZA } from '../lib/formato';

export interface DashboardFinanceiro {
  escopo: { competencia: string; filial_id: number | null; consolidado: boolean; cenario: string };
  totais_mes: {
    despesa: number;
    investimento: number;
    total: number;
    lancamentos: number;
    variacao_mes_anterior_pct: number | null;
    total_mes_anterior: number;
  };
  por_tipo_despesa: Array<{ tipo_despesa_id: number; tipo: string; total: number; despesa: number; investimento: number; participacao_pct: number }>;
  por_natureza: Array<{ natureza: string; total: number; quantidade: number; participacao_pct: number }>;
  por_filial: Array<{ filial_id: number | null; filial: string; despesa: number; investimento: number; total: number }>;
  evolucao_mensal: Array<{ competencia: string; despesa: number; investimento: number; total: number }>;
  projecao_12_meses: Array<{ competencia: string; parcelado: number; fixo: number; pontual: number; total: number }>;
}

interface Cenario {
  chave: string;
  nome: string;
  descricao: string | null;
  lancamentos: number;
}

const SERIES_CLASSIFICACAO = [
  { chave: 'despesa', nome: 'Despesa', cor: 'var(--serie-1)' },
  { chave: 'investimento', nome: 'Investimento', cor: 'var(--serie-2)' },
];

const SERIES_PROJECAO = [
  { chave: 'fixo', nome: 'Fixo recorrente', cor: 'var(--serie-1)' },
  { chave: 'parcelado', nome: 'Parcelas em curso', cor: 'var(--serie-2)' },
  { chave: 'pontual', nome: 'Pontual único', cor: 'var(--serie-3)' },
];

export function PaginaFinanceiro() {
  const { empresa, paramFilial, filialId } = useSessao();
  const [competencias, setCompetencias] = useState<string[]>([]);
  const [cenariosSel, setCenariosSel] = useState<string[]>(['oficial']);
  // Um só detalhamento por vez: o que estiver aberto define o que buscar.
  // Fica aqui, antes de qualquer `return`: a ordem dos hooks não pode mudar
  // entre renders.
  const [detalhe, setDetalhe] = useState<PedidoDetalhe<Record<string, unknown>> | null>(null);

  const cenarios = useDados<Cenario[]>(() => api.get('/api/lancamentos/cenarios/lista'), [empresa?.id]);
  const meses = useDados<Array<{ competencia: string; lancamentos: number }>>(
    () => api.get('/api/lancamentos/competencias/lista', { cenario: cenariosSel.join(',') }),
    [empresa?.id, cenariosSel.join(',')],
  );
  const consulta = useDados<DashboardFinanceiro>(
    () =>
      api.get('/api/dashboards/financeiro', {
        filial_id: paramFilial(),
        competencia: competencias.join(',') || undefined,
        cenario: cenariosSel.join(','),
      }),
    [empresa?.id, filialId, competencias.join(','), cenariosSel.join(',')],
  );

  // Trocar de cenário muda quais meses existem: manter uma competência que o
  // novo cenário não tem deixaria o painel zerado num mês que o seletor sequer
  // oferece.
  useEffect(() => {
    if (!meses.dados) return;
    const validos = new Set(meses.dados.map((m) => m.competencia));
    setCompetencias((atual) => atual.filter((c) => validos.has(c)));
  }, [meses.dados]);

  if (consulta.erro) return <Aviso tipo="erro">{consulta.erro}</Aviso>;
  if (!consulta.dados) return <Carregando />;
  const d = consulta.dados;

  /**
   * Recorte da tela, repassado a todo drill-down. É o que garante que os
   * registros abertos são os mesmos que formaram o número clicado.
   */
  const recorte = (extra: Record<string, unknown> = {}) => ({
    filial_id: paramFilial(),
    cenario: cenariosSel.join(','),
    ...extra,
  });

  const itensCenario = (cenarios.dados ?? [{ chave: 'oficial', nome: 'Oficial', descricao: null, lancamentos: 0 }])
    .map((c) => ({ valor: c.chave, rotulo: c.nome, apoio: inteiro(c.lancamentos) }));

  const compromisso = d.projecao_12_meses.reduce((s, m) => s + m.total, 0);

  return (
    <>
      <div className="barra-filtros">
        <Campo rotulo="Competência" dica="Nenhuma = último mês com movimento">
          <SeletorMulti
            rotulo="Competência"
            largura={180}
            itens={(meses.dados ?? []).map((m) => ({
              valor: m.competencia,
              rotulo: m.competencia,
              apoio: inteiro(m.lancamentos),
            }))}
            selecionados={competencias}
            aoMudar={setCompetencias}
          />
        </Campo>
        <Campo rotulo="Cenário de projeção">
          <SeletorMulti
            rotulo="Cenário de projeção"
            largura={200}
            minimo={1}
            aviso="Cenários são alternativas: marcar vários soma linhas que representam a mesma despesa."
            itens={itensCenario}
            selecionados={cenariosSel}
            aoMudar={setCenariosSel}
          />
        </Campo>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--tinta-fraca)', maxWidth: 420 }}>
          {d.escopo.consolidado ? 'Consolidado da empresa' : 'Filial selecionada'} ·{' '}
          {competencias.length > 1 ? 'período' : 'competência'}{' '}
          <strong style={{ color: 'var(--tinta-2)' }}>
            {competencias.length > 1
              ? `${competencias[0]} a ${competencias[competencias.length - 1]} · ${competencias.length} competências`
              : d.escopo.competencia}
          </strong>
        </div>
      </div>

      <FichasSelecao
        grupos={[
          { chave:'comp', rotulo:'Competência',
            itens:(meses.dados ?? []).map((m) => ({ valor:m.competencia, rotulo:m.competencia })),
            selecionados:competencias, aoMudar:setCompetencias },
          { chave:'cen', rotulo:'Cenário', itens:itensCenario, selecionados:cenariosSel, minimo:1,
            aoMudar:setCenariosSel },
        ]}
      />

      <div className="grade c4">
        <Indicador
          rotulo="Total do mês"
          valor={moeda(d.totais_mes.total)}
          delta={d.totais_mes.variacao_mes_anterior_pct}
          apoio={`${inteiro(d.totais_mes.lancamentos)} lançamentos · mês anterior ${moedaCurta(d.totais_mes.total_mes_anterior)}`}
          dica={`Soma de todos os lançamentos de ${d.escopo.competencia} no recorte atual.`}
          aoDetalhar={() =>
            setDetalhe(
              detalheDeLancamentos(
                `Total de ${d.escopo.competencia}`,
                recorte({ competencia_inicio: d.escopo.competencia, competencia_fim: d.escopo.competencia }),
                d.totais_mes.total,
              ),
            )
          }
        />
        <Indicador
          rotulo="Despesa"
          valor={moeda(d.totais_mes.despesa)}
          apoio={`${percentual(d.totais_mes.total > 0 ? (d.totais_mes.despesa / d.totais_mes.total) * 100 : 0)} do mês`}
          dica="Lançamentos classificados como despesa (custeio), não investimento."
          aoDetalhar={() =>
            setDetalhe(
              detalheDeLancamentos(
                `Despesa de ${d.escopo.competencia}`,
                recorte({
                  competencia_inicio: d.escopo.competencia,
                  competencia_fim: d.escopo.competencia,
                  classificacao: 'despesa',
                }),
                d.totais_mes.despesa,
              ),
            )
          }
        />
        <Indicador
          rotulo="Investimento"
          valor={moeda(d.totais_mes.investimento)}
          apoio={`${percentual(d.totais_mes.total > 0 ? (d.totais_mes.investimento / d.totais_mes.total) * 100 : 0)} do mês`}
          dica="Lançamentos classificados como investimento (ativo), não despesa."
          aoDetalhar={() =>
            setDetalhe(
              detalheDeLancamentos(
                `Investimento de ${d.escopo.competencia}`,
                recorte({
                  competencia_inicio: d.escopo.competencia,
                  competencia_fim: d.escopo.competencia,
                  classificacao: 'investimento',
                }),
                d.totais_mes.investimento,
              ),
            )
          }
        />
        <Indicador
          rotulo="Compromisso — 12 meses"
          valor={moedaCurta(compromisso)}
          apoio="Parcelas e recorrências já lançadas"
          dica="Soma dos 12 meses seguintes ao mês em foco, com o que já está lançado."
          aoDetalhar={() =>
            setDetalhe(
              detalheDeLancamentos(
                'Compromisso dos próximos 12 meses',
                recorte({
                  competencia_inicio: d.projecao_12_meses[0]?.competencia,
                  competencia_fim: d.projecao_12_meses[d.projecao_12_meses.length - 1]?.competencia,
                }),
                compromisso,
              ),
            )
          }
        />
      </div>

      <div className="grade c2">
        <Cartao titulo="Evolução mensal" descricao="Despesa × investimento">
          <GraficoBarras
            dados={d.evolucao_mensal.map((m) => ({
              rotulo: mesCurto(m.competencia),
              valores: { despesa: m.despesa, investimento: m.investimento },
            }))}
            series={SERIES_CLASSIFICACAO}
            modo="empilhado"
            formatar={moeda}
            formatarEixo={moedaCurta}
            aoClicar={(_, i) => {
              const m = d.evolucao_mensal[i]!;
              setDetalhe(
                detalheDeLancamentos(
                  `Despesa e investimento — ${m.competencia}`,
                  recorte({ competencia_inicio: m.competencia, competencia_fim: m.competencia }),
                  m.total,
                ),
              );
            }}
          />
        </Cartao>

        <Cartao titulo="Projeção dos próximos 12 meses" descricao="Compromissos já lançados">
          <GraficoBarras
            dados={d.projecao_12_meses.map((m) => ({
              rotulo: mesCurto(m.competencia),
              valores: { fixo: m.fixo, parcelado: m.parcelado, pontual: m.pontual },
            }))}
            series={SERIES_PROJECAO}
            modo="empilhado"
            formatar={moeda}
            formatarEixo={moedaCurta}
            aoClicar={(_, i) => {
              const m = d.projecao_12_meses[i]!;
              setDetalhe(
                detalheDeLancamentos(
                  `Compromisso de ${m.competencia}`,
                  recorte({ competencia_inicio: m.competencia, competencia_fim: m.competencia }),
                  m.fixo + m.parcelado + m.pontual,
                ),
              );
            }}
          />
        </Cartao>
      </div>

      <div className="grade c2">
        <Cartao titulo="Distribuição por tipo de despesa" descricao={d.escopo.competencia}>
          <GraficoRanking
            itens={d.por_tipo_despesa.map((t) => ({
              rotulo: t.tipo,
              valor: t.total,
              apoio: percentual(t.participacao_pct),
            }))}
            formatar={moeda}
            rotuloCategoria="Tipo de despesa"
            rotuloValor="Total"
            aoClicar={(item) => {
              const tipo = d.por_tipo_despesa.find((t) => t.tipo === item.rotulo);
              setDetalhe(
                detalheDeLancamentos(
                  `${item.rotulo} — ${d.escopo.competencia}`,
                  recorte({
                    competencia_inicio: d.escopo.competencia,
                    competencia_fim: d.escopo.competencia,
                    tipo_despesa_id: tipo?.tipo_despesa_id,
                  }),
                  item.valor,
                ),
              );
            }}
          />
        </Cartao>

        <Cartao titulo="Composição por natureza" descricao="Fixa × pontual (única e parcelada)">
          <GraficoRanking
            itens={d.por_natureza.map((n) => ({
              rotulo: ROTULO_NATUREZA[n.natureza] ?? n.natureza,
              valor: n.total,
              apoio: `${inteiro(n.quantidade)} lanç. · ${percentual(n.participacao_pct)}`,
            }))}
            formatar={moeda}
            cor="var(--serie-3)"
            rotuloCategoria="Natureza"
            rotuloValor="Total"
            aoClicar={(item) => {
              const nat = d.por_natureza.find((n) => (ROTULO_NATUREZA[n.natureza] ?? n.natureza) === item.rotulo);
              setDetalhe(
                detalheDeLancamentos(
                  `Natureza ${item.rotulo} — ${d.escopo.competencia}`,
                  recorte({
                    competencia_inicio: d.escopo.competencia,
                    competencia_fim: d.escopo.competencia,
                    natureza: nat?.natureza,
                  }),
                  item.valor,
                ),
              );
            }}
          />
        </Cartao>
      </div>

      <Cartao titulo="Por filial" descricao={`Competência ${d.escopo.competencia} — todas as filiais da empresa`}>
        <GraficoBarras
          dados={d.por_filial.map((f) => ({
            rotulo: f.filial,
            valores: { despesa: f.despesa, investimento: f.investimento },
          }))}
          series={SERIES_CLASSIFICACAO}
          modo="empilhado"
          formatar={moeda}
          formatarEixo={moedaCurta}
          rotuloCategoria="Filial"
          altura={260}
          aoClicar={(_, i) => {
            const f = d.por_filial[i]!;
            setDetalhe(
              detalheDeLancamentos(
                `Filial ${f.filial} — ${d.escopo.competencia}`,
                // Este gráfico compara as filiais entre si e por isso ignora o
                // filtro de filial da tela; o detalhe usa a mesma base dele.
                {
                  cenario: cenariosSel.join(','),
                  competencia_inicio: d.escopo.competencia,
                  competencia_fim: d.escopo.competencia,
                  filial_id: f.filial_id === null ? 'nenhuma' : f.filial_id,
                },
                f.despesa + f.investimento,
                'O gráfico por filial compara as filiais entre si e por isso ignora o filtro de filial.',
              ),
            );
          }}
        />
      </Cartao>

      <Cartao titulo="Série temporal do total" descricao="Total mensal consolidado no escopo consultado">
        <GraficoLinhas
          dados={d.evolucao_mensal.map((m) => ({ rotulo: mesCurto(m.competencia), valores: { total: m.total } }))}
          series={[{ chave: 'total', nome: 'Total mensal', cor: 'var(--serie-1)' }]}
          formatar={moeda}
          formatarEixo={moedaCurta}
          aoClicar={(_, i) => {
            const m = d.evolucao_mensal[i]!;
            setDetalhe(
              detalheDeLancamentos(
                `Total de ${m.competencia}`,
                recorte({ competencia_inicio: m.competencia, competencia_fim: m.competencia }),
                m.total,
              ),
            );
          }}
        />
      </Cartao>

      {detalhe && <Detalhamento pedido={detalhe} aoFechar={() => setDetalhe(null)} />}
    </>
  );
}
