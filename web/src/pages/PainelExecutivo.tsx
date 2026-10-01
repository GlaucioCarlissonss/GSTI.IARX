import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { useFiltroEscopo } from '../lib/filtros';
import { FichasUnidades, FiltroUnidades } from '../components/filtro-escopo';
import { Aviso, Carregando, Cartao, UltimaAtualizacao } from '../components/base';
import {
  GraficoBarras,
  Indicador,
  TabelaPorUnidade,
  porMatriz,
  type LeituraMeta,
  type LinhaPorUnidade,
} from '../components/graficos';
import {
  Detalhamento,
  detalheDeLancamentos,
  detalheDeProjetos,
  detalheDeRegistrosSla,
  type PedidoDetalhe,
} from '../components/detalhamento';
import { inteiro, mesCurto, moeda, moedaCurta, percentual } from '../lib/formato';
import { coresDasMatrizes, fatiasPorMatriz, type MatrizComCor } from '../lib/cores';
import { LegendaDeConsumo } from '../components/consumo';
import type { DashboardFinanceiro } from './Financeiro';

interface VisaoExecutiva {
  escopo: { competencia: string; consolidado: boolean };
  financeiro: {
    total_mes: number;
    despesa: number;
    investimento: number;
    variacao_mes_anterior_pct: number | null;
    compromisso_proximos_12_meses: number;
    meta: LeituraMeta | null;
  };
  projetos: {
    total: number;
    em_andamento: number;
    concluidos: number;
    atrasados: number;
    tarefas_atrasadas: number;
    pct_no_prazo: number;
    tarefas_entregues: number;
    meta: LeituraMeta | null;
  };
  sla: { total_atendidos: number; pct_dentro_sla: number; fora_sla: number; meta: LeituraMeta | null };
  consumo: {
    total: number;
    centralizado: number;
    pct_centralizado: number;
    lancamentos: number;
    por_pagadora: Array<{
      empresa_id: number;
      empresa: string;
      filial_id: number | null;
      unidade: string;
      valor: number;
      total_unidade: number;
      pct_da_unidade: number;
      lancamentos: number;
      beneficiadas: string[];
    }>;
  };
  equilibrio: {
    meses: number;
    atual: { competencia: string; pct: number; total: number; centralizado: number } | null;
    anterior: { competencia: string; pct: number } | null;
    variacao_pp: number | null;
    meta: LeituraMeta | null;
    serie: Array<{ competencia: string; pct: number; centralizado: number; total: number }>;
  };
  /** A mesma despesa compartilhada, distribuída entre as empresas do grupo. */
  rateio: {
    compartilhado: number;
    pct_compartilhado: number;
    lancamentos: number;
    criterio: string;
    divisao_igual: boolean;
    por_empresa: Array<{
      empresa_id: number;
      empresa: string;
      proprio: number;
      rateado_pago: number;
      rateado_recebido: number;
      antes: number;
      depois: number;
      variacao: number;
      pagadora: boolean;
    }>;
  };
  plano_reducao: {
    itens: Array<{
      plano_id: number;
      nome: string;
      tipo_despesa: string | null;
      atual: number;
      alvo: number;
      reducao: number;
      pct_reducao: number;
      pct_do_grupo: number;
      sem_despesa_no_recorte: boolean;
    }>;
    total_atual: number;
    total_alvo: number;
    pct_reducao: number;
    pct_do_grupo: number;
  };
  por_unidade: {
    gasto_mes: LinhaPorUnidade[];
    compromisso_proximos_12_meses: LinhaPorUnidade[];
    projetos_atrasados: LinhaPorUnidade[];
    sla: LinhaPorUnidade[];
  };
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

  // Uma cor por matriz, pela posição na lista do cliente — estável entre telas
  // e entre sessões enquanto o cadastro não mudar.
  const cores = coresDasMatrizes(empresas);
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
        <UltimaAtualizacao cliente={cliente?.id} />
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
          meta={v.financeiro.meta}
          fatias={fatiasPorMatriz(
            porMatriz(v.por_unidade.gasto_mes, cores).map((m) => ({ empresa_id: m.id, valor: m.valor })),
            cores,
          ).map((f) => ({ ...f, texto: moedaCurta(f.valor) }))}
          detalhePorUnidade={
            <TabelaPorUnidade linhas={v.por_unidade.gasto_mes} cores={cores} formatar={moeda} rotuloValor="Gasto" />
          }
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
          fatias={fatiasPorMatriz(
            porMatriz(v.por_unidade.compromisso_proximos_12_meses, cores).map((m) => ({ empresa_id: m.id, valor: m.valor })),
            cores,
          ).map((f) => ({ ...f, texto: moedaCurta(f.valor) }))}
          detalhePorUnidade={
            <TabelaPorUnidade
              linhas={v.por_unidade.compromisso_proximos_12_meses}
              cores={cores}
              formatar={moeda}
              rotuloValor="Compromisso"
            />
          }
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
          meta={v.projetos.meta}
          fatias={fatiasPorMatriz(
            porMatriz(v.por_unidade.projetos_atrasados, cores).map((m) => ({ empresa_id: m.id, valor: m.valor })),
            cores,
          ).map((f) => ({ ...f, texto: `${inteiro(f.valor)} projeto(s)` }))}
          detalhePorUnidade={
            <TabelaPorUnidade
              linhas={v.por_unidade.projetos_atrasados}
              cores={cores}
              formatar={inteiro}
              rotuloValor="Atrasados"
            />
          }
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
          meta={v.sla.meta}
          fatias={fatiasPorMatriz(
            porMatriz(v.por_unidade.sla, cores).map((m) => ({ empresa_id: m.id, valor: m.valor })),
            cores,
          ).map((f) => ({ ...f, texto: `${inteiro(f.valor)} chamado(s)` }))}
          detalhePorUnidade={
            <TabelaPorUnidade
              linhas={v.por_unidade.sla}
              cores={cores}
              formatar={inteiro}
              rotuloValor="Chamados"
              conformidade
              alvo={v.sla.meta?.alvo ?? null}
            />
          }
          // Abre mesmo sem chamado: "nenhum registro nesta competência" é
          // informação, e um card que não responde ao clique parece quebrado.
          aoDetalhar={() =>
            setDetalhe(
              detalheDeRegistrosSla(
                `Atendimento de ${v.escopo.competencia}`,
                { ...recorte, competencia: v.escopo.competencia },
                v.sla.total_atendidos,
              ),
            )
          }
        />
      </div>

      {/* Os dois indicadores estratégicos da fase 4. Vêm antes do bloco de
          consumo integral de propósito: o rateio é a leitura regularizada da
          MESMA despesa, e o integral logo abaixo é o "antes" dele. A tela de
          Indicadores Gerais traz os dois abertos por empresa; aqui é o
          resumo, com o caminho para lá. */}
      {v.plano_reducao.itens.length > 0 && (
        <Cartao
          titulo="Plano de redução de despesas"
          descricao={`${moeda(v.plano_reducao.total_atual)} → ${moeda(v.plano_reducao.total_alvo)} · ${percentual(
            v.plano_reducao.pct_reducao,
          )} de redução · ${percentual(v.plano_reducao.pct_do_grupo)} da despesa do grupo`}
          acoes={<Link to="/indicadores">Ver por empresa →</Link>}
        >
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Atual</th>
                  <th className="num">Alvo</th>
                  <th className="num">Redução</th>
                  <th className="num">% do grupo</th>
                </tr>
              </thead>
              <tbody>
                {v.plano_reducao.itens.map((i) => (
                  <tr key={i.plano_id}>
                    <td>
                      {i.nome}
                      {i.tipo_despesa && (
                        <div style={{ fontSize: 11, color: 'var(--tinta-fraca)' }}>{i.tipo_despesa}</div>
                      )}
                    </td>
                    <td className="num">{moeda(i.atual)}</td>
                    <td className="num">{moeda(i.alvo)}</td>
                    <td
                      className="num"
                      style={{ color: i.reducao > 0 ? 'var(--positivo-texto)' : 'var(--tinta-2)' }}
                    >
                      {i.sem_despesa_no_recorte ? '—' : percentual(i.pct_reducao)}
                    </td>
                    <td className="num">{percentual(i.pct_do_grupo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Cartao>
      )}

      {v.rateio.lancamentos > 0 && (
        <Cartao
          titulo="Despesas compartilhadas regularizadas"
          descricao={`${moeda(v.rateio.compartilhado)} distribuídos entre ${inteiro(
            v.rateio.por_empresa.length,
          )} empresa(s) — ${v.rateio.criterio}`}
          acoes={<Link to="/indicadores">Ver o comparativo →</Link>}
        >
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th className="num">Própria</th>
                  <th className="num">Rateio recebido</th>
                  <th className="num">Antes</th>
                  <th className="num">Depois</th>
                  <th className="num">Variação</th>
                </tr>
              </thead>
              <tbody>
                {v.rateio.por_empresa.map((e) => (
                  <tr key={e.empresa_id}>
                    <td>
                      <i
                        className="ponto-matriz"
                        style={{ background: cores.get(e.empresa_id)?.cor }}
                        aria-hidden
                      />
                      {e.empresa}
                      {e.pagadora && (
                        <span
                          className="etiqueta"
                          style={{ marginLeft: 6 }}
                          title="Esta empresa paga ao menos uma despesa compartilhada do grupo"
                        >
                          pagadora
                        </span>
                      )}
                    </td>
                    <td className="num">{moeda(e.proprio)}</td>
                    <td className="num" style={{ color: cores.get(e.empresa_id)?.corCompartilhada }}>
                      {moeda(e.rateado_recebido)}
                    </td>
                    <td className="num">{moeda(e.antes)}</td>
                    <td className="num">{moeda(e.depois)}</td>
                    <td
                      className="num"
                      style={{
                        color:
                          e.variacao < 0
                            ? 'var(--positivo-texto)'
                            : e.variacao > 0
                              ? 'var(--atencao)'
                              : 'var(--tinta-2)',
                      }}
                    >
                      {e.variacao === 0 ? '—' : `${e.variacao > 0 ? '+' : ''}${moeda(e.variacao)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LegendaDeConsumo cor={cores.get(v.rateio.por_empresa[0]!.empresa_id)?.cor} />
          <p className="dica-filtro" style={{ marginTop: 10 }}>
            O <strong>antes</strong> é como a unidade aparece hoje: o que é dela mais 100% do que ela
            paga. O <strong>depois</strong> é o que é dela mais a parcela que lhe cabe. O bloco
            abaixo mostra a leitura integral, que é o antes deste comparativo.
          </p>
        </Cartao>
      )}

      {v.consumo.lancamentos > 0 && (
        <Cartao
          titulo="Despesa paga por uma unidade, consumida por outras"
          descricao={`${moeda(v.consumo.centralizado)} de ${moeda(v.consumo.total)} no mês (${percentual(
            v.consumo.pct_centralizado,
          )}) saem de uma unidade e beneficiam outras.`}
        >
          {/* Sem rateio, por decisão: a linha mostra o valor INTEGRAL que a
              pagadora desembolsa e diz QUEM consome, nunca quanto cada uma
              consome. Dividir exigiria um critério que ninguém definiu. */}
          <div className="rolagem">
            <table>
              <thead>
                <tr>
                  <th>Unidade pagadora</th>
                  <th className="num">Centralizado</th>
                  <th className="num">Do que ela paga</th>
                  <th>Beneficia</th>
                </tr>
              </thead>
              <tbody>
                {v.consumo.por_pagadora.map((p) => (
                  <tr key={`${p.empresa_id}-${p.filial_id ?? 'matriz'}`}>
                    <td>
                      {p.unidade}
                      {p.filial_id === null && (
                        <span style={{ color: 'var(--tinta-fraca)' }}> · nível empresa</span>
                      )}
                    </td>
                    <td className="num">{moeda(p.valor)}</td>
                    <td className="num">{percentual(p.pct_da_unidade)}</td>
                    <td>{p.beneficiadas.length ? p.beneficiadas.join(', ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="dica-filtro" style={{ marginTop: 8 }}>
            O valor é o que a unidade pagadora desembolsa por inteiro. Não há divisão por filial
            beneficiada: somar as linhas daria mais que o total, porque a mesma despesa serve a várias.
          </p>

          {v.equilibrio.atual && (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--borda)', paddingTop: 12 }}>
              <strong>Equilíbrio de despesas, mês a mês</strong>
              <p style={{ margin: '4px 0 0', fontSize: 13 }}>
                {percentual(v.equilibrio.atual.pct)} em {v.equilibrio.atual.competencia}
                {v.equilibrio.anterior && (
                  <>
                    {' '}· {percentual(v.equilibrio.anterior.pct)} em {v.equilibrio.anterior.competencia}
                    {v.equilibrio.variacao_pp !== null && (
                      // Pontos percentuais, e não percentual de percentual: de 10%
                      // para 12% são +2 p.p., e chamar isso de +20% confundiria.
                      <span className={v.equilibrio.variacao_pp > 0 ? 'fora' : 'dentro'}>
                        {' '}({v.equilibrio.variacao_pp > 0 ? '+' : ''}
                        {v.equilibrio.variacao_pp.toLocaleString('pt-BR')} p.p.)
                      </span>
                    )}
                  </>
                )}
              </p>
              {!v.equilibrio.anterior && (
                <p className="dica-filtro" style={{ margin: '4px 0 0' }}>
                  Sem mês anterior com movimento neste recorte — não há contra o que comparar.
                </p>
              )}
              {v.equilibrio.meta && (
                <p style={{ margin: '6px 0 0', fontSize: 13 }} className={v.equilibrio.meta.atinge ? 'dentro' : 'fora'}>
                  {v.equilibrio.meta.atinge ? '✓' : '✗'} teto de {percentual(v.equilibrio.meta.alvo)} por mês
                </p>
              )}
            </div>
          )}
        </Cartao>
      )}

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
