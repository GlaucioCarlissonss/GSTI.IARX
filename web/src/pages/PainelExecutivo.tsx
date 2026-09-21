import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { useFiltroEscopo } from '../lib/filtros';
import { FichasUnidades, FiltroUnidades } from '../components/filtro-escopo';
import { Aviso, Carregando, Cartao, UltimaAtualizacao } from '../components/base';
import { GraficoBarras, Indicador, type LeituraMeta } from '../components/graficos';
import {
  Detalhamento,
  detalheDeLancamentos,
  detalheDeProjetos,
  detalheDeRegistrosSla,
  type PedidoDetalhe,
} from '../components/detalhamento';
import { inteiro, mesCurto, moeda, moedaCurta, percentual } from '../lib/formato';
import { coresDasMatrizes, fatiasPorMatriz, type MatrizComCor } from '../lib/cores';
import type { DashboardFinanceiro } from './Financeiro';

/** Uma linha da quebra por unidade, como o servidor a devolve. */
interface LinhaPorUnidade {
  empresa_id: number;
  empresa: string;
  filial_id: number | null;
  filial: string | null;
  valor: number;
  total?: number;
  dentro?: number;
}

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
  por_unidade: {
    gasto_mes: LinhaPorUnidade[];
    compromisso_proximos_12_meses: LinhaPorUnidade[];
    projetos_atrasados: LinhaPorUnidade[];
    sla: LinhaPorUnidade[];
  };
}


/**
 * A quebra de um número em matriz → filial.
 *
 * O consolidado por matriz é a soma das filiais dela: é o que a sanfona mostra,
 * e é o que tem de bater com o número do card. Quando não bate, o problema está
 * na consulta — e é melhor que apareça aqui do que numa reunião.
 */
function porMatriz(linhas: LinhaPorUnidade[], cores: Map<number, MatrizComCor>) {
  const mapa = new Map<number, { id: number; nome: string; cor: string; valor: number; filiais: LinhaPorUnidade[] }>();
  for (const l of linhas) {
    const atual = mapa.get(l.empresa_id) ?? {
      id: l.empresa_id,
      nome: l.empresa,
      cor: cores.get(l.empresa_id)?.cor ?? 'var(--tinta-fraca)',
      valor: 0,
      filiais: [] as LinhaPorUnidade[],
    };
    atual.valor += l.valor;
    atual.filiais.push(l);
    mapa.set(l.empresa_id, atual);
  }
  return [...mapa.values()]
    .map((m) => ({ ...m, filiais: m.filiais.sort((a, b) => b.valor - a.valor) }))
    .sort((a, b) => b.valor - a.valor);
}

/**
 * A tabela da sanfona. `conformidade` é a coluna de ✓/✗, só no SLA.
 *
 * O alvo vem de fora: era uma constante copiada aqui, e desde que a meta virou
 * cadastro a tela não tem como saber qual é sem perguntar ao servidor.
 */
function TabelaPorUnidade({
  linhas,
  cores,
  formatar,
  rotuloValor,
  conformidade,
  alvo,
}: {
  linhas: LinhaPorUnidade[];
  cores: Map<number, MatrizComCor>;
  formatar: (v: number) => string;
  rotuloValor: string;
  conformidade?: boolean;
  /** O alvo de conformidade vigente. Ausente: a coluna não julga, só mostra. */
  alvo?: number | null;
}) {
  const grupos = porMatriz(linhas, cores);
  if (!grupos.length) return <p className="vazio">Nada neste recorte.</p>;
  const situacao = (l: { total?: number; dentro?: number }) => {
    const total = l.total ?? 0;
    if (!total) return <span>—</span>;
    const pct = Math.round(((l.dentro ?? 0) / total) * 1000) / 10;
    const fora = total - (l.dentro ?? 0);
    return alvo === null || alvo === undefined || pct >= alvo ? (
      <span className="dentro">✓ {pct.toLocaleString('pt-BR')}% · dentro</span>
    ) : (
      <span className="fora">✗ {pct.toLocaleString('pt-BR')}% · fora ({inteiro(fora)})</span>
    );
  };
  return (
    <table>
      <thead>
        <tr>
          <th>Empresa / filial</th>
          <th className="n">{rotuloValor}</th>
          {conformidade && <th>Conformidade</th>}
        </tr>
      </thead>
      <tbody>
        {grupos.map((m) => (
          <Fragment key={m.id}>
            <tr className="matriz">
              <td>
                <i
                  style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: m.cor, marginRight: 6 }}
                  aria-hidden
                />
                {m.nome}
              </td>
              <td className="n">{formatar(m.valor)}</td>
              {conformidade && (
                <td>
                  {situacao({
                    total: m.filiais.reduce((s, f) => s + (f.total ?? 0), 0),
                    dentro: m.filiais.reduce((s, f) => s + (f.dentro ?? 0), 0),
                  })}
                </td>
              )}
            </tr>
            {m.filiais.map((f) => (
              <tr className="filial" key={`${m.id}:${f.filial_id ?? 'matriz'}`}>
                <td>{f.filial ?? 'Sem filial (nível empresa)'}</td>
                <td className="n">{formatar(f.valor)}</td>
                {conformidade && <td>{situacao(f)}</td>}
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
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
