/**
 * Indicadores Gerais — a leitura estratégica, separada da operação.
 *
 * A rota `/api/indicadores` existia desde a versão 1 e nunca teve consumidor
 * no app React: o Painel Executivo come `/api/dashboards/executivo`, que é
 * outra coisa (um resumo do mês, não os três blocos com filtro próprio). Esta
 * tela é o consumidor que faltava.
 *
 * O desenho segue o pedido: cada indicador ocupa a LINHA INTEIRA e abre para
 * baixo, agrupado por empresa e, dentro dela, por filial. Nenhum divide a
 * linha com outro — dois números concorrendo lado a lado é exatamente o que o
 * cliente reclamou.
 *
 * A ordem dos blocos também é o pedido: plano de redução no topo, despesas
 * compartilhadas regularizadas em seguida, e os indicadores financeiros
 * existentes depois.
 */
import { useState } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { useFiltroEscopo } from '../lib/filtros';
import { FiltroUnidades } from '../components/filtro-escopo';
import { Aviso, Carregando, Cartao } from '../components/base';
import { Detalhamento, detalheDeLancamentos, type PedidoDetalhe } from '../components/detalhamento';
import {
  ArvoreDeUnidades,
  Dica,
  Indicador,
  LegendaDeMatrizes,
  useDica,
  type LeituraMeta,
  type NoEmpresa,
} from '../components/graficos';
import { LegendaDeConsumo } from '../components/consumo';
import { coresDasMatrizes, fatiasPorMatriz } from '../lib/cores';
import { inteiro, moeda, moedaCurta, percentual } from '../lib/formato';

// ---------------------------------------------------------------- resposta

interface SegmentoRateio {
  lancamento_id: number;
  descricao: string;
  origem_empresa: string;
  valor: number;
  pct: number;
  beneficiadas: string[];
}

interface EmpresaRateada {
  empresa_id: number;
  empresa: string;
  proprio: number;
  rateado_pago: number;
  rateado_recebido: number;
  antes: number;
  depois: number;
  variacao: number;
  pagadora: boolean;
  segmentos: SegmentoRateio[];
}

interface ItemPlano {
  plano_id: number;
  nome: string;
  tipo_despesa: string | null;
  filial: string | null;
  atual: number;
  alvo: number;
  reducao: number;
  pct_reducao: number;
  sem_despesa_no_recorte: boolean;
  pct_do_grupo: number;
  por_filial: Array<{
    empresa_id: number;
    unidade: string;
    valor: number;
    pct_da_filial: number;
  }>;
}

interface Indicadores {
  financeiro: {
    reducao_custo: {
      valor_inicial: number;
      valor_final: number;
      variacao_total_pct: number | null;
      economia: number;
      tendencia: 'queda' | 'alta' | 'estavel' | 'indefinida';
      meses: number;
    };
    por_reconhecer: {
      quantidade: number;
      valor: number;
      total_lancamentos: number;
      pct_quantidade: number;
    };
  };
  sla: {
    total: number;
    dentro: number;
    fora: number;
    pct_dentro: number;
    meta: number;
    meta_leitura: LeituraMeta | null;
  };
  projetos: {
    entregues: number;
    no_prazo: number;
    pct_no_prazo: number;
    pendentes: number;
    pendentes_atrasadas: number;
    meta_leitura: LeituraMeta | null;
  };
  consumo: {
    total: number;
    centralizado: number;
    pct_centralizado: number;
    lancamentos: number;
    por_pagadora: Array<{
      unidade: string;
      valor: number;
      total_unidade: number;
      pct_da_unidade: number;
      beneficiadas: string[];
    }>;
  };
  equilibrio: {
    atual: { competencia: string; pct: number } | null;
    anterior: { competencia: string; pct: number } | null;
    variacao_pp: number | null;
    meta: LeituraMeta | null;
  };
  rateio: {
    compartilhado: number;
    pct_compartilhado: number;
    lancamentos: number;
    divisao_igual: boolean;
    criterio: string;
    por_empresa: EmpresaRateada[];
  };
  plano_reducao: {
    itens: ItemPlano[];
    total_atual: number;
    total_alvo: number;
    total_reducao: number;
    pct_reducao: number;
    pct_do_grupo: number;
  };
  por_unidade: {
    total: number;
    empresas: NoEmpresa[];
  };
}

const ROTULO_TENDENCIA: Record<Indicadores['financeiro']['reducao_custo']['tendencia'], string> = {
  queda: '↓ em queda',
  alta: '↑ em alta',
  estavel: '→ estável',
  indefinida: '· sem base para dizer',
};

/** Duas barras na mesma escala: escalas diferentes mentiriam pela largura. */
function Comparativo({
  antes,
  depois,
  corAntes,
  corDepois,
  teto,
  rotuloAntes = 'antes',
  rotuloDepois = 'depois',
  gatilho,
}: {
  antes: number;
  depois: number;
  corAntes: string;
  corDepois: string;
  teto: number;
  rotuloAntes?: string;
  rotuloDepois?: string;
  gatilho?: Record<string, unknown>;
}) {
  const largura = (v: number) => (teto > 0 ? Math.max(0, Math.min(100, (v / teto) * 100)) : 0);
  return (
    <span className="comparativo" {...gatilho}>
      <span className="comparativo-linha">
        <b>{rotuloAntes}</b>
        <span aria-hidden>
          <i style={{ width: `${largura(antes)}%`, background: corAntes }} />
        </span>
        <var>{moeda(antes)}</var>
      </span>
      <span className="comparativo-linha">
        <b>{rotuloDepois}</b>
        <span aria-hidden>
          <i style={{ width: `${largura(depois)}%`, background: corDepois }} />
        </span>
        <var>{moeda(depois)}</var>
      </span>
    </span>
  );
}

export function PaginaIndicadoresGerais() {
  const { empresas, cliente } = useSessao();
  const escopo = useFiltroEscopo('indicadores');
  const [detalhe, setDetalhe] = useState<PedidoDetalhe<Record<string, unknown>> | null>(null);
  const cores = coresDasMatrizes(empresas);
  const { dica, gatilho } = useDica();

  // Os três blocos vêm numa resposta só: a primeira pintura da tela não custa
  // três idas. O recorte é prefixado por bloco, que é o contrato da rota.
  const consulta = useDados<Indicadores>(
    () =>
      api.get('/api/indicadores', {
        financeiro_empresas: escopo.params.empresas,
        financeiro_filial_id: escopo.params.filial_id,
        sla_empresas: escopo.params.empresas,
        sla_filial_id: escopo.params.filial_id,
        projetos_empresas: escopo.params.empresas,
        projetos_filial_id: escopo.params.filial_id,
      }),
    [escopo.params.empresas, escopo.params.filial_id],
  );

  if (consulta.erro) return <Aviso tipo="erro">{consulta.erro}</Aviso>;
  if (!consulta.dados) return <Carregando />;
  const v = consulta.dados;

  const abrirLancamentos = (titulo: string, params: Record<string, unknown>, total?: number | null) =>
    setDetalhe(
      detalheDeLancamentos(titulo, { ...params, ...escopo.params }, total ?? null),
    );

  const fatiasDoTotal = fatiasPorMatriz(
    v.por_unidade.empresas.map((e) => ({ empresa_id: e.empresa_id, valor: e.valor })),
    cores,
  ).map((f) => ({ ...f, texto: moedaCurta(f.valor) }));

  const tetoRateio = Math.max(
    1,
    ...v.rateio.por_empresa.map((e) => Math.max(e.antes, e.depois)),
  );

  return (
    <>
      <div className="barra-filtros">
        <FiltroUnidades
          empresas={empresas}
          empresasSel={escopo.empresas}
          aoMudarEmpresas={escopo.definirEmpresas}
        />
      </div>

      <Aviso>
        <strong>Leitura estratégica, separada da operação.</strong> Os indicadores estão agrupados
        pelo módulo a que pertencem: abrir <em>Financeiro</em> abre os indicadores financeiros, e o
        mesmo vale para SLA e Projetos. Dentro de cada indicador, a expansão continua por empresa e,
        dentro dela, por filial. Escopo:{' '}
        <strong>{cliente?.nome}</strong> ·{' '}
        {escopo.empresas.length === 0
          ? `todas as unidades (${empresas.length})`
          : `${escopo.empresas.length} de ${empresas.length} unidades`}
        .
      </Aviso>

      {/* Os indicadores vêm um abaixo do outro, em largura total: é proibido
          dividir a linha com outro. `grade empilhada` é uma coluna só. */}
      {/* Os indicadores vêm agrupados pelo MÓDULO a que pertencem, e dentro do
          módulo um abaixo do outro, em largura total. O módulo abre expandido e
          o indicador abre fechado: é o que faz a tela mostrar de que negócio é
          cada número sem despejar nove blocos abertos de uma vez. */}
      <div className="grade empilhada">
        <Cartao
          titulo="Financeiro"
          classe="cartao-modulo"
          padraoAberto
          descricao="despesa, rateio, plano de redução e conferência"
        >
        {/* ---------------------------------------------- 1. plano de redução */}
        <Cartao
          titulo="Plano de redução de despesas"
          descricao={
            v.plano_reducao.itens.length
              ? `${moeda(v.plano_reducao.total_atual)} → ${moeda(v.plano_reducao.total_alvo)} · ${percentual(
                  v.plano_reducao.pct_reducao,
                )} de redução`
              : 'nenhuma despesa no plano'
          }
        >
          {v.plano_reducao.itens.length === 0 ? (
            <p className="vazio">
              Nenhuma despesa no plano. Cadastre em <strong>Sistema › Cadastro › Plano de redução</strong>:
              sem alvo não há de quanto para quanto, e um alvo inventado seria pior que a ausência dele.
            </p>
          ) : (
            <>
              <Indicador
                rotulo="Redução planejada no período"
                valor={`${moeda(v.plano_reducao.total_atual)} → ${moeda(v.plano_reducao.total_alvo)}`}
                apoio={`${inteiro(v.plano_reducao.itens.length)} despesa(s) no plano · ${percentual(
                  v.plano_reducao.pct_do_grupo,
                )} da despesa do grupo`}
                dica="O valor atual sai dos lançamentos do recorte; o alvo, do cadastro. O percentual de redução é (atual − alvo) / atual."
              />
              <div className="tabela-envolucro" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Atual</th>
                      <th className="num">Alvo</th>
                      <th>Atual × alvo</th>
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
                            <div className="arv-comp">
                              {i.tipo_despesa}
                              {i.filial ? ` · ${i.filial}` : ''}
                            </div>
                          )}
                        </td>
                        <td className="num">{moeda(i.atual)}</td>
                        <td className="num">{moeda(i.alvo)}</td>
                        <td>
                          {i.sem_despesa_no_recorte ? (
                            <span style={{ color: 'var(--tinta-fraca)', fontSize: 11.5 }}>
                              sem despesa no recorte
                            </span>
                          ) : (
                            <Comparativo
                              antes={i.atual}
                              depois={i.alvo}
                              corAntes="var(--critico)"
                              corDepois="var(--bom)"
                              teto={Math.max(i.atual, i.alvo)}
                              rotuloAntes="atual"
                              rotuloDepois="alvo"
                              gatilho={gatilho(() => ({
                                titulo: i.nome,
                                linhas: [
                                  { nome: 'Valor atual', valor: moeda(i.atual), cor: 'var(--critico)' },
                                  { nome: 'Valor alvo', valor: moeda(i.alvo), cor: 'var(--bom)' },
                                  { nome: 'Redução', valor: `${moeda(i.reducao)} (${percentual(i.pct_reducao)})` },
                                  { nome: 'Peso no grupo', valor: percentual(i.pct_do_grupo) },
                                  ...i.por_filial.slice(0, 6).map((f) => ({
                                    nome: f.unidade,
                                    valor: `${moeda(f.valor)} · ${percentual(f.pct_da_filial)} da unidade`,
                                    cor: cores.get(f.empresa_id)?.cor,
                                  })),
                                ],
                              }))}
                            />
                          )}
                        </td>
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
              <p className="dica-filtro" style={{ marginTop: 10 }}>
                Passe o cursor sobre a barra para ver o peso da despesa em cada filial — é o peso
                dentro <strong>daquela unidade</strong>, e não no grupo.
              </p>
            </>
          )}
        </Cartao>

        {/* ------------------------- 2. compartilhadas regularizadas (rateio) */}
        <Cartao
          titulo="Despesas compartilhadas regularizadas"
          descricao={
            v.rateio.lancamentos
              ? `${moeda(v.rateio.compartilhado)} distribuídos entre ${inteiro(
                  v.rateio.por_empresa.length,
                )} empresa(s) · ${percentual(v.rateio.pct_compartilhado)} da despesa do recorte`
              : 'nenhuma despesa compartilhada no recorte'
          }
        >
          {v.rateio.lancamentos === 0 ? (
            <p className="vazio">
              Nenhum lançamento classificado como compartilhado neste recorte. Sem eles não há o que
              ratear — e um rateio de nada não diria nada.
            </p>
          ) : (
            <>
              <LegendaDeConsumo cor={cores.get(v.rateio.por_empresa[0]!.empresa_id)?.cor} />
              <div className="tabela-envolucro" style={{ marginTop: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Empresa</th>
                      <th className="num">Própria</th>
                      <th className="num">Rateio recebido</th>
                      <th>Antes → depois</th>
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
                        <td>
                          <Comparativo
                            antes={e.antes}
                            depois={e.depois}
                            corAntes={cores.get(e.empresa_id)?.cor ?? 'var(--tinta-fraca)'}
                            corDepois={cores.get(e.empresa_id)?.corCompartilhada ?? 'var(--tinta-fraca)'}
                            teto={tetoRateio}
                            gatilho={gatilho(() => ({
                              titulo: e.empresa,
                              linhas: [
                                { nome: 'Antes (100% na pagadora)', valor: moeda(e.antes), cor: cores.get(e.empresa_id)?.cor },
                                {
                                  nome: 'Depois (rateio proporcional)',
                                  valor: moeda(e.depois),
                                  cor: cores.get(e.empresa_id)?.corCompartilhada,
                                },
                                { nome: 'Despesa própria', valor: moeda(e.proprio) },
                                { nome: 'Rateio recebido', valor: moeda(e.rateado_recebido) },
                                ...(e.pagadora ? [{ nome: 'Rateio pago', valor: moeda(e.rateado_pago) }] : []),
                                ...e.segmentos.slice(0, 5).map((s) => ({
                                  nome: `${s.descricao} (de ${s.origem_empresa})`,
                                  valor: `${moeda(s.valor)} · ${percentual(s.pct)}`,
                                  cor: cores.get(e.empresa_id)?.corCompartilhada,
                                })),
                              ],
                            }))}
                          />
                        </td>
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
              <p className="dica-filtro" style={{ marginTop: 10 }}>
                O <strong>antes</strong> é como a unidade aparece hoje: o que é dela mais 100% do que
                ela paga. O <strong>depois</strong> é o que é dela mais a parcela que lhe cabe. O
                critério do rateio é {v.rateio.criterio}
                {v.rateio.divisao_igual
                  ? '; como nenhuma empresa tem despesa própria neste recorte, a divisão saiu igual'
                  : ''}
                . O total redistribui, não cresce.
              </p>
            </>
          )}
        </Cartao>

        {/* -------------------------------- 3. custo recorrente e composição */}
        <Cartao
          titulo="Custo recorrente — variação no período"
          descricao={`${inteiro(v.financeiro.reducao_custo.meses)} competência(s) com despesa fixa`}
        >
          <Indicador
            rotulo="Variação entre o primeiro e o último mês"
            valor={
              v.financeiro.reducao_custo.variacao_total_pct === null
                ? '—'
                : `${v.financeiro.reducao_custo.variacao_total_pct > 0 ? '+' : ''}${v.financeiro.reducao_custo.variacao_total_pct.toLocaleString('pt-BR')}%`
            }
            apoio={`${ROTULO_TENDENCIA[v.financeiro.reducao_custo.tendencia]}${
              v.financeiro.reducao_custo.economia > 0
                ? ` · economia de ${moeda(v.financeiro.reducao_custo.economia)}/mês`
                : ''
            }`}
            dica="Só a despesa de natureza fixa entra: uma compra pontual num mês e nenhuma no seguinte produziria uma redução que é só o fim da compra."
            fatias={fatiasDoTotal}
            aoDetalhar={() =>
              abrirLancamentos('Custo recorrente — despesas fixas do recorte', { natureza: 'fixa' })
            }
          />
          <LegendaDeMatrizes fatias={fatiasDoTotal} />
        </Cartao>

        <Cartao
          titulo="Despesas por reconhecer"
          descricao={`${inteiro(v.financeiro.por_reconhecer.quantidade)} de ${inteiro(
            v.financeiro.por_reconhecer.total_lancamentos,
          )} lançamentos`}
        >
          <Indicador
            rotulo="Valor ainda não reconhecido"
            valor={moeda(v.financeiro.por_reconhecer.valor)}
            apoio={`${percentual(v.financeiro.por_reconhecer.pct_quantidade)} dos lançamentos do recorte`}
            dica="As despesas que ninguém conferiu ainda. Clique para ver os lançamentos."
            aoDetalhar={() =>
              abrirLancamentos(
                'Despesas por reconhecer',
                { reconhecido: 'false' },
                v.financeiro.por_reconhecer.valor,
              )
            }
          />
        </Cartao>

        {/* ------------------------- 4. despesa paga por uma, consumida por outras */}
        {v.consumo.lancamentos > 0 && (
          <Cartao
            titulo="Despesa paga por uma unidade, consumida por outras"
            descricao={`${moeda(v.consumo.centralizado)} de ${moeda(v.consumo.total)} · ${percentual(
              v.consumo.pct_centralizado,
            )}`}
          >
            {/* Sem rateio, por decisão: esta é a leitura INTEGRAL, e é o
                "antes" do indicador de despesas regularizadas acima. */}
            <div className="tabela-envolucro">
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
                  {v.consumo.por_pagadora.map((u) => (
                    <tr key={u.unidade}>
                      <td>{u.unidade}</td>
                      <td className="num">{moeda(u.valor)}</td>
                      <td className="num">{percentual(u.pct_da_unidade)}</td>
                      <td>{u.beneficiadas.length ? u.beneficiadas.join(', ') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="dica-filtro" style={{ marginTop: 10 }}>
              O valor é o que a unidade pagadora desembolsa por inteiro. Não há divisão por filial
              beneficiada: somar as linhas daria mais que o total, porque a mesma despesa serve a
              várias. A leitura <strong>rateada</strong> dessa mesma despesa está no indicador de
              despesas compartilhadas regularizadas, acima.
            </p>
            {v.equilibrio.atual && (
              <p style={{ marginTop: 10, fontSize: 13 }}>
                <strong>Equilíbrio de despesas:</strong> {percentual(v.equilibrio.atual.pct)} em{' '}
                {v.equilibrio.atual.competencia}
                {v.equilibrio.anterior && (
                  <>
                    {' '}
                    · {percentual(v.equilibrio.anterior.pct)} em {v.equilibrio.anterior.competencia}
                    {v.equilibrio.variacao_pp !== null && (
                      <span
                        style={{
                          color: v.equilibrio.variacao_pp > 0 ? 'var(--critico)' : 'var(--positivo-texto)',
                        }}
                      >
                        {' '}
                        ({v.equilibrio.variacao_pp > 0 ? '+' : ''}
                        {v.equilibrio.variacao_pp.toLocaleString('pt-BR')} p.p.)
                      </span>
                    )}
                  </>
                )}
              </p>
            )}
          </Cartao>
        )}

        {/* --------------------------------- 5. a árvore empresa → filial → lançamento */}
        <Cartao
          titulo="Despesa por empresa e filial"
          descricao={`${moeda(v.por_unidade.total)} no recorte · abra uma empresa para ver as filiais, e uma filial para ver os lançamentos`}
        >
          <ArvoreDeUnidades
            empresas={v.por_unidade.empresas}
            cores={cores}
            formatar={moeda}
            rotuloValor="Despesa"
            chaveEstado="gsti-indicadores-arvore"
          />
          <LegendaDeConsumo cor={cores.get(v.por_unidade.empresas[0]?.empresa_id ?? -1)?.cor} />
        </Cartao>

        </Cartao>

        {/* ------------------------------------------------------ módulo SLA */}
        <Cartao
          titulo="SLA"
          classe="cartao-modulo"
          padraoAberto
          descricao={`meta de ${v.sla.meta}%`}
        >
        <Cartao titulo="Atendidos dentro do SLA" descricao={`meta de ${v.sla.meta}%`}>
          <Indicador
            rotulo="Conformidade de SLA"
            valor={v.sla.total ? percentual(v.sla.pct_dentro) : '—'}
            apoio={
              v.sla.total
                ? `${inteiro(v.sla.dentro)} dentro · ${inteiro(v.sla.fora)} fora de ${inteiro(v.sla.total)}`
                : 'sem chamado no recorte'
            }
            meta={v.sla.meta_leitura}
            dica="Atendidos dentro do prazo sobre o total de atendimentos do recorte. É a mesma conta das telas de SLA."
          />
        </Cartao>

        </Cartao>

        {/* ------------------------------------------------ módulo Projetos */}
        <Cartao
          titulo="Projetos"
          classe="cartao-modulo"
          padraoAberto
          descricao="por competência de entrega planejada"
        >
        <Cartao
          titulo="Tarefas entregues no prazo"
          descricao="por competência de entrega planejada"
        >
          <Indicador
            rotulo="Entrega no prazo"
            valor={v.projetos.entregues ? percentual(v.projetos.pct_no_prazo) : '—'}
            apoio={
              v.projetos.entregues
                ? `${inteiro(v.projetos.no_prazo)} de ${inteiro(v.projetos.entregues)} entregues · ${inteiro(
                    v.projetos.pendentes,
                  )} pendente(s)`
                : 'nenhuma tarefa entregue no recorte'
            }
            meta={v.projetos.meta_leitura}
            dica="O denominador é o que foi ENTREGUE: tarefa ainda em aberto não está fora do prazo enquanto o mês planejado não passa."
          />
        </Cartao>
        </Cartao>
      </div>

      <Dica estado={dica} />
      {detalhe && <Detalhamento pedido={detalhe} aoFechar={() => setDetalhe(null)} />}
    </>
  );
}
