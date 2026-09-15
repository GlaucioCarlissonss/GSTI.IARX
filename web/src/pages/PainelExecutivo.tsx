import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { useFiltroEscopo } from '../lib/filtros';
import { FichasUnidades, FiltroUnidades } from '../components/filtro-escopo';
import { Aviso, Carregando, Cartao } from '../components/base';
import { GraficoBarras, Indicador } from '../components/graficos';
import {
  Detalhamento,
  detalheDeLancamentos,
  detalheDeProjetos,
  detalheDeRegistrosSla,
  type PedidoDetalhe,
} from '../components/detalhamento';
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

/** Mês seguinte a uma competência MM/AAAA — o início da janela de projeção. */
function mesSeguinte(competencia: string): string {
  const [m, a] = competencia.split('/').map(Number);
  const d = new Date(Date.UTC(a!, m!, 1));
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

export function PaginaPainelExecutivo() {
  const { empresa, empresas, filiais, cliente } = useSessao();
  // Filtro LOCAL deste painel: recortar aqui não mexe nas outras telas.
  const escopo = useFiltroEscopo('executivo');
  const [detalhe, setDetalhe] = useState<PedidoDetalhe<Record<string, unknown>> | null>(null);

  const recorte = { empresas: escopo.params.empresas, filial_id: escopo.params.filial_id };
  const visao = useDados<VisaoExecutiva>(
    () => api.get('/api/dashboards/executivo', recorte),
    [escopo.params.empresas, escopo.params.filial_id],
  );
  const financeiro = useDados<DashboardFinanceiro>(
    () => api.get('/api/dashboards/financeiro', recorte),
    [escopo.params.empresas, escopo.params.filial_id],
  );

  if (visao.erro) return <Aviso tipo="erro">{visao.erro}</Aviso>;
  if (!visao.dados) return <Carregando />;
  const v = visao.dados;

  // Ambiente recém-criado: em vez de painéis zerados, um caminho para começar.
  const vazio =
    v.financeiro.total_mes === 0 &&
    v.financeiro.compromisso_proximos_12_meses === 0 &&
    v.projetos.total === 0 &&
    v.sla.total_atendidos === 0;

  if (vazio) {
    return (
      <Cartao titulo={`${empresa?.nome} está pronta para receber dados`}>
        <p style={{ color: 'var(--tinta-2)', marginTop: 0 }}>
          A empresa já nasceu com os nove tipos de despesa padrão e com você como gestor. Há dois caminhos para
          começar:
        </p>
        <ol style={{ color: 'var(--tinta-2)', lineHeight: 1.8, paddingLeft: 20 }}>
          <li>
            <strong>Importar uma planilha</strong> — baixe o template em <Link to="/planilhas">Importar / Exportar</Link>,
            preencha e envie. Linhas inválidas voltam em relatório, sem travar o lote.
          </li>
          <li>
            <strong>Lançar direto na tela</strong> — comece por <Link to="/lancamentos">Lançamentos</Link>, ou cadastre
            filiais e tipos próprios em <Link to="/cadastros">Cadastros</Link>.
          </li>
        </ol>
        <p style={{ color: 'var(--tinta-fraca)', fontSize: 13, marginBottom: 0 }}>
          Os painéis se preenchem sozinhos conforme os dados entram.
        </p>
      </Cartao>
    );
  }

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
      </div>
      <FichasUnidades
        empresas={empresas}
        empresasSel={escopo.empresas}
        aoMudarEmpresas={escopo.definirEmpresas}
        filiais={filiais}
        filiaisSel={escopo.filiais}
        aoMudarFiliais={escopo.definirFiliais}
      />

      <Aviso>
        Escopo: <strong>{cliente?.nome}</strong> ·{' '}
        {escopo.empresas.length === 0
          ? `todas as unidades (${empresas.length})`
          : `${escopo.empresas.length} de ${empresas.length} unidades`}{' '}
        · competência <strong>{v.escopo.competencia}</strong>
      </Aviso>

      <div className="grade c4">
        <Indicador
          rotulo="Gasto de TI no mês"
          valor={moeda(v.financeiro.total_mes)}
          delta={v.financeiro.variacao_mes_anterior_pct}
          apoio={`${moedaCurta(v.financeiro.despesa)} despesa · ${moedaCurta(v.financeiro.investimento)} investimento`}
          dica={`Soma dos lançamentos de ${v.escopo.competencia} no recorte atual.`}
          aoDetalhar={() =>
            setDetalhe(
              detalheDeLancamentos(
                `Gasto de TI — ${v.escopo.competencia}`,
                { ...recorte, competencia_inicio: v.escopo.competencia, competencia_fim: v.escopo.competencia },
                v.financeiro.total_mes,
              ),
            )
          }
        />
        <Indicador
          rotulo="Compromisso — 12 meses"
          valor={moedaCurta(v.financeiro.compromisso_proximos_12_meses)}
          apoio="Parcelas e recorrências já lançadas"
          dica="Soma dos 12 meses seguintes ao mês em foco, com o que já está lançado."
          aoDetalhar={() =>
            setDetalhe(
              detalheDeLancamentos(
                'Compromisso dos próximos 12 meses',
                { ...recorte, competencia_inicio: mesSeguinte(v.escopo.competencia) },
                v.financeiro.compromisso_proximos_12_meses,
              ),
            )
          }
        />
        <Indicador
          rotulo="Projetos atrasados"
          valor={inteiro(v.projetos.atrasados)}
          apoio={`${inteiro(v.projetos.em_andamento)} em andamento · ${inteiro(v.projetos.total)} no total`}
          dica="Atraso é derivado: o mês corrente passou do fim planejado sem fim real registrado."
          aoDetalhar={() =>
            setDetalhe(
              detalheDeProjetos(
                'Projetos atrasados',
                { ...recorte, atrasados: 'true' },
                v.projetos.atrasados,
                'O cronograma completo está na Gestão de Projetos; aqui ficam os projetos que compõem o número.',
              ),
            )
          }
        />
        <Indicador
          rotulo="Conformidade de SLA"
          valor={v.sla.total_atendidos > 0 ? percentual(v.sla.pct_dentro_sla) : '—'}
          apoio={
            v.sla.total_atendidos > 0
              ? `${inteiro(v.sla.total_atendidos)} tickets · ${inteiro(v.sla.fora_sla)} fora do SLA`
              : 'Sem tickets registrados na competência'
          }
          dica="Percentual de chamados atendidos dentro do prazo na competência."
          aoDetalhar={
            v.sla.total_atendidos > 0
              ? () =>
                  setDetalhe(
                    detalheDeRegistrosSla(
                      `Atendimento de ${v.escopo.competencia}`,
                      { ...recorte, competencia: v.escopo.competencia },
                      v.sla.total_atendidos,
                    ),
                  )
              : undefined
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
            aoClicar={(_, i) => {
              const m = financeiro.dados!.evolucao_mensal[i]!;
              setDetalhe(
                detalheDeLancamentos(
                  `Gasto de ${m.competencia}`,
                  { ...recorte, competencia_inicio: m.competencia, competencia_fim: m.competencia },
                  m.total,
                ),
              );
            }}
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

      {detalhe && <Detalhamento pedido={detalhe} aoFechar={() => setDetalhe(null)} />}
    </>
  );
}
