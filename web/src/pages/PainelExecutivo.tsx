import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { Aviso, Carregando, Cartao } from '../components/base';
import { GraficoBarras, Indicador } from '../components/graficos';
import { inteiro, mesCurto, moeda, moedaCurta, percentual } from '../lib/formato';
import type { DashboardFinanceiro } from './Financeiro';

interface VisaoExecutiva {
  escopo: { competencia: string; consolidado: boolean };
  financeiro: {
    total_mes: number;
    despesa: number;
    investimento: number;
    variacao_mes_anterior_pct: number | null;
    compromisso_proximos_12_meses: number;
  };
  projetos: { total: number; em_andamento: number; concluidos: number; atrasados: number; tarefas_atrasadas: number };
  sla: { total_atendidos: number; pct_dentro_sla: number; fora_sla: number };
}

const SERIES = [
  { chave: 'despesa', nome: 'Despesa', cor: 'var(--serie-1)' },
  { chave: 'investimento', nome: 'Investimento', cor: 'var(--serie-2)' },
];

export function PaginaPainelExecutivo() {
  const { empresa, filialId, paramFilial } = useSessao();

  const visao = useDados<VisaoExecutiva>(
    () => api.get('/api/dashboards/executivo', { filial_id: paramFilial() }),
    [empresa?.id, filialId],
  );
  const financeiro = useDados<DashboardFinanceiro>(
    () => api.get('/api/dashboards/financeiro', { filial_id: paramFilial() }),
    [empresa?.id, filialId],
  );

  if (visao.erro) return <Aviso tipo="erro">{visao.erro}</Aviso>;
  if (!visao.dados) return <Carregando />;
  const v = visao.dados;

  return (
    <>
      <Aviso>
        Escopo: <strong>{empresa?.nome}</strong> ·{' '}
        {v.escopo.consolidado ? 'consolidado (todas as filiais)' : 'filial selecionada'} · competência{' '}
        <strong>{v.escopo.competencia}</strong>
      </Aviso>

      <div className="grade c4">
        <Indicador
          rotulo="Gasto de TI no mês"
          valor={moeda(v.financeiro.total_mes)}
          delta={v.financeiro.variacao_mes_anterior_pct}
          apoio={`${moedaCurta(v.financeiro.despesa)} despesa · ${moedaCurta(v.financeiro.investimento)} investimento`}
        />
        <Indicador
          rotulo="Compromisso — 12 meses"
          valor={moedaCurta(v.financeiro.compromisso_proximos_12_meses)}
          apoio="Parcelas e recorrências já lançadas"
        />
        <Indicador
          rotulo="Projetos atrasados"
          valor={inteiro(v.projetos.atrasados)}
          apoio={`${inteiro(v.projetos.em_andamento)} em andamento · ${inteiro(v.projetos.total)} no total`}
        />
        <Indicador
          rotulo="Conformidade de SLA"
          valor={v.sla.total_atendidos > 0 ? percentual(v.sla.pct_dentro_sla) : '—'}
          apoio={
            v.sla.total_atendidos > 0
              ? `${inteiro(v.sla.total_atendidos)} tickets · ${inteiro(v.sla.fora_sla)} fora do SLA`
              : 'Sem tickets registrados na competência'
          }
        />
      </div>

      {financeiro.dados && (
        <Cartao
          titulo="Evolução do gasto de TI"
          descricao="Despesa × investimento nos últimos 12 meses"
          acoes={
            <Link to="/financeiro" className="botao pequeno" style={{ textDecoration: 'none' }}>
              Abrir dashboard financeiro
            </Link>
          }
        >
          <GraficoBarras
            dados={financeiro.dados.evolucao_mensal.map((m) => ({
              rotulo: mesCurto(m.competencia),
              valores: { despesa: m.despesa, investimento: m.investimento },
            }))}
            series={SERIES}
            modo="empilhado"
            formatar={moeda}
            formatarEixo={moedaCurta}
            altura={260}
          />
        </Cartao>
      )}

      <div className="grade c3">
        <Cartao titulo="Financeiro">
          <p style={{ color: 'var(--tinta-2)', marginTop: 0 }}>
            Lançamentos por tipo, natureza e classificação, com projeção automática de parcelas e fechamento mensal.
          </p>
          <Link to="/lancamentos">Ver lançamentos →</Link>
        </Cartao>
        <Cartao titulo="Projetos">
          <p style={{ color: 'var(--tinta-2)', marginTop: 0 }}>
            {inteiro(v.projetos.total)} projeto(s), {inteiro(v.projetos.concluidos)} concluído(s),{' '}
            {inteiro(v.projetos.tarefas_atrasadas)} tarefa(s) em atraso.
          </p>
          <Link to="/projetos">Ver cronograma →</Link>
        </Cartao>
        <Cartao titulo="SLA de suporte">
          <p style={{ color: 'var(--tinta-2)', marginTop: 0 }}>
            Qualidade do atendimento por fila (Infraestrutura, Sistema, Dados) e por tópico de ajuda.
          </p>
          <Link to="/sla">Ver desempenho →</Link>
        </Cartao>
      </div>
    </>
  );
}
