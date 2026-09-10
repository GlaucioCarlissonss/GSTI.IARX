import { useState } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { Aviso, Campo, Carregando, Cartao } from '../components/base';
import { GraficoBarras, GraficoLinhas, GraficoRanking, Indicador } from '../components/graficos';
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
  por_tipo_despesa: Array<{ tipo: string; total: number; despesa: number; investimento: number; participacao_pct: number }>;
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
  const [competencia, setCompetencia] = useState('');
  const [cenario, setCenario] = useState('oficial');

  const cenarios = useDados<Cenario[]>(() => api.get('/api/lancamentos/cenarios/lista'), [empresa?.id]);
  const consulta = useDados<DashboardFinanceiro>(
    () =>
      api.get('/api/dashboards/financeiro', {
        filial_id: paramFilial(),
        competencia: competenciaValida(competencia) ? competencia : undefined,
        cenario,
      }),
    [empresa?.id, filialId, competencia, cenario],
  );

  if (consulta.erro) return <Aviso tipo="erro">{consulta.erro}</Aviso>;
  if (!consulta.dados) return <Carregando />;
  const d = consulta.dados;

  const compromisso = d.projecao_12_meses.reduce((s, m) => s + m.total, 0);

  return (
    <>
      <div className="barra-filtros">
        <Campo rotulo="Competência" dica="Vazio = último mês com movimento">
          <input
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            placeholder={d.escopo.competencia}
            inputMode="numeric"
            style={{ width: 110 }}
          />
        </Campo>
        <Campo rotulo="Cenário de projeção">
          <select value={cenario} onChange={(e) => setCenario(e.target.value)}>
            {(cenarios.dados ?? [{ chave: 'oficial', nome: 'Oficial', descricao: null, lancamentos: 0 }]).map((c) => (
              <option key={c.chave} value={c.chave}>
                {c.nome} ({inteiro(c.lancamentos)})
              </option>
            ))}
          </select>
        </Campo>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--tinta-fraca)', maxWidth: 420 }}>
          {d.escopo.consolidado ? 'Consolidado da empresa' : 'Filial selecionada'} · competência{' '}
          <strong style={{ color: 'var(--tinta-2)' }}>{d.escopo.competencia}</strong>
          {cenario !== 'oficial' && (
            <>
              {' · '}
              {cenarios.dados?.find((c) => c.chave === cenario)?.descricao}
            </>
          )}
        </div>
      </div>

      <div className="grade c4">
        <Indicador
          rotulo="Total do mês"
          valor={moeda(d.totais_mes.total)}
          delta={d.totais_mes.variacao_mes_anterior_pct}
          apoio={`${inteiro(d.totais_mes.lancamentos)} lançamentos · mês anterior ${moedaCurta(d.totais_mes.total_mes_anterior)}`}
        />
        <Indicador
          rotulo="Despesa"
          valor={moeda(d.totais_mes.despesa)}
          apoio={`${percentual(d.totais_mes.total > 0 ? (d.totais_mes.despesa / d.totais_mes.total) * 100 : 0)} do mês`}
        />
        <Indicador
          rotulo="Investimento"
          valor={moeda(d.totais_mes.investimento)}
          apoio={`${percentual(d.totais_mes.total > 0 ? (d.totais_mes.investimento / d.totais_mes.total) * 100 : 0)} do mês`}
        />
        <Indicador
          rotulo="Compromisso — 12 meses"
          valor={moedaCurta(compromisso)}
          apoio="Parcelas e recorrências já lançadas"
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
        />
      </Cartao>

      <Cartao titulo="Série temporal do total" descricao="Total mensal consolidado no escopo consultado">
        <GraficoLinhas
          dados={d.evolucao_mensal.map((m) => ({ rotulo: mesCurto(m.competencia), valores: { total: m.total } }))}
          series={[{ chave: 'total', nome: 'Total mensal', cor: 'var(--serie-1)' }]}
          formatar={moeda}
          formatarEixo={moedaCurta}
        />
      </Cartao>
    </>
  );
}
