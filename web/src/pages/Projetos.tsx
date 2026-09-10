import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { Aviso, Carregando, Cartao, Etiqueta } from '../components/base';
import { GraficoRanking, Indicador, Legenda } from '../components/graficos';
import { competenciaAtual, inteiro, mesCurto, ROTULO_STATUS_PROJETO } from '../lib/formato';

interface ItemGantt {
  id: number;
  nome: string;
  filial_nome: string | null;
  status: string;
  atrasado: boolean;
  meses_atraso: number;
  desvio_meses: number;
  mes_inicio: string;
  mes_fim_planejado: string;
  mes_fim_real: string | null;
  offset_meses: number;
  duracao_meses: number;
  duracao_real_meses: number | null;
  tarefas: Array<{
    id: number;
    nome: string;
    responsavel: string | null;
    status: string;
    mes_inicio: string;
    mes_fim_planejado: string;
    mes_fim_real: string | null;
    offset_meses: number;
    duracao_meses: number;
    duracao_real_meses: number | null;
    atrasado: boolean;
    meses_atraso: number;
  }>;
}

interface DashboardProjetos {
  escopo: { linha_do_tempo: { inicio: string; fim: string } };
  indicadores: {
    total: number;
    planejados: number;
    em_andamento: number;
    concluidos: number;
    cancelados: number;
    atrasados: number;
    total_tarefas: number;
    tarefas_atrasadas: number;
    desvio_medio_meses: number;
  };
  linha_do_tempo: string[];
  gantt: ItemGantt[];
  carga_por_envolvido: Array<{ responsavel: string; total: number; concluidas: number; atrasadas: number; em_aberto: number }>;
  desvios: Array<{ id: number; nome: string; mes_fim_planejado: string; mes_fim_real: string; desvio_meses: number }>;
}

const SERIES_GANTT = [
  { chave: 'planejado', nome: 'Planejado', cor: 'var(--serie-1)' },
  { chave: 'realizado', nome: 'Realizado', cor: 'var(--serie-3)' },
  { chave: 'atraso', nome: 'Em atraso', cor: 'var(--critico)' },
];

export function PaginaProjetos() {
  const { empresa, filialId, paramFilial } = useSessao();
  const [expandidos, setExpandidos] = useState<Set<number>>(new Set());

  const consulta = useDados<DashboardProjetos>(
    () => api.get('/api/dashboards/projetos', { filial_id: paramFilial() }),
    [empresa?.id, filialId],
  );

  const indiceHoje = useMemo(() => {
    if (!consulta.dados) return -1;
    return consulta.dados.linha_do_tempo.indexOf(competenciaAtual());
  }, [consulta.dados]);

  if (consulta.erro) return <Aviso tipo="erro">{consulta.erro}</Aviso>;
  if (!consulta.dados) return <Carregando />;
  const d = consulta.dados;

  if (d.gantt.length === 0) {
    return (
      <Cartao titulo="Projetos de TI">
        <p className="vazio">
          Nenhum projeto cadastrado nesta empresa. Cadastre em <strong>Projetos e tarefas</strong> ou importe pela
          planilha padrão.
        </p>
      </Cartao>
    );
  }

  const meses = d.linha_do_tempo;
  const larguraMes = 34;

  const alternar = (id: number) =>
    setExpandidos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });

  return (
    <>
      <div className="grade c4">
        <Indicador rotulo="Projetos" valor={inteiro(d.indicadores.total)} apoio={`${inteiro(d.indicadores.total_tarefas)} tarefas`} />
        <Indicador
          rotulo="Em andamento"
          valor={inteiro(d.indicadores.em_andamento)}
          apoio={`${inteiro(d.indicadores.planejados)} planejados`}
        />
        <Indicador
          rotulo="Concluídos"
          valor={inteiro(d.indicadores.concluidos)}
          apoio={`desvio médio de ${d.indicadores.desvio_medio_meses} mês(es)`}
        />
        <Indicador
          rotulo="Atrasados"
          valor={inteiro(d.indicadores.atrasados)}
          apoio={`${inteiro(d.indicadores.tarefas_atrasadas)} tarefas em atraso`}
        />
      </div>

      <Cartao
        titulo="Cronograma (Gantt mensal)"
        descricao={`${d.escopo.linha_do_tempo.inicio} a ${d.escopo.linha_do_tempo.fim} · clique no projeto para ver as tarefas`}
      >
        <Legenda series={SERIES_GANTT} />
        <div className="gantt" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 240, position: 'sticky', left: 0, background: 'var(--superficie)' }}>Projeto</th>
                {meses.map((m, i) => (
                  <th key={m} className={`mes ${m.startsWith('01/') ? 'virada' : ''}`}>
                    {/* Linhas do tempo curtas cabem mês a mês; as longas rareiam os rótulos. */}
                    {meses.length <= 18 || i === 0 || m.startsWith('01/') || i % 3 === 0 ? mesCurto(m) : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.gantt.map((projeto) => {
                const aberto = expandidos.has(projeto.id);
                return (
                  <>
                    <tr key={projeto.id}>
                      <td
                        className="nome"
                        style={{ position: 'sticky', left: 0, background: 'var(--superficie)', cursor: 'pointer' }}
                        onClick={() => alternar(projeto.id)}
                      >
                        <span style={{ color: 'var(--tinta-fraca)', marginRight: 6 }}>{aberto ? '▾' : '▸'}</span>
                        {projeto.nome}
                        {projeto.atrasado && (
                          <span style={{ marginLeft: 6 }}>
                            <Etiqueta texto={`${projeto.meses_atraso} mês(es) de atraso`} tom="critico" />
                          </span>
                        )}
                        <div style={{ fontSize: 11.5, color: 'var(--tinta-fraca)', paddingLeft: 18 }}>
                          {projeto.filial_nome ?? 'empresa'} · {ROTULO_STATUS_PROJETO[projeto.status] ?? projeto.status}
                        </div>
                      </td>
                      <td className="faixa" colSpan={meses.length} style={{ position: 'relative' }}>
                        {indiceHoje >= 0 && <div className="hoje" style={{ left: indiceHoje * larguraMes + larguraMes / 2 }} />}
                        <div
                          className="barra"
                          title={`Planejado: ${projeto.mes_inicio} → ${projeto.mes_fim_planejado}`}
                          style={{
                            left: projeto.offset_meses * larguraMes + 2,
                            width: Math.max(projeto.duracao_meses * larguraMes - 4, 6),
                            background: projeto.atrasado ? 'var(--critico)' : 'var(--serie-1)',
                          }}
                        />
                        {projeto.duracao_real_meses !== null && (
                          <div
                            className="barra real"
                            title={`Realizado: ${projeto.mes_inicio} → ${projeto.mes_fim_real}`}
                            style={{
                              left: projeto.offset_meses * larguraMes + 2,
                              width: Math.max(projeto.duracao_real_meses * larguraMes - 4, 6),
                              background: 'var(--serie-3)',
                            }}
                          />
                        )}
                      </td>
                    </tr>
                    {aberto &&
                      projeto.tarefas.map((tarefa) => (
                        <tr key={`t-${tarefa.id}`}>
                          <td className="nome tarefa" style={{ position: 'sticky', left: 0, background: 'var(--superficie)' }}>
                            {tarefa.nome}
                            <div style={{ fontSize: 11, color: 'var(--tinta-fraca)' }}>
                              {tarefa.responsavel ?? 'sem responsável'}
                            </div>
                          </td>
                          <td className="faixa" colSpan={meses.length} style={{ position: 'relative' }}>
                            {indiceHoje >= 0 && <div className="hoje" style={{ left: indiceHoje * larguraMes + larguraMes / 2 }} />}
                            <div
                              className="barra"
                              title={`${tarefa.mes_inicio} → ${tarefa.mes_fim_planejado}`}
                              style={{
                                left: tarefa.offset_meses * larguraMes + 2,
                                width: Math.max(tarefa.duracao_meses * larguraMes - 4, 6),
                                height: 7,
                                top: 7,
                                background: tarefa.atrasado ? 'var(--critico)' : 'var(--serie-1)',
                                opacity: 0.75,
                              }}
                            />
                            {tarefa.duracao_real_meses !== null && (
                              <div
                                className="barra real"
                                style={{
                                  left: tarefa.offset_meses * larguraMes + 2,
                                  width: Math.max(tarefa.duracao_real_meses * larguraMes - 4, 6),
                                  background: 'var(--serie-3)',
                                  opacity: 0.75,
                                }}
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </Cartao>

      <div className="grade c2">
        <Cartao titulo="Carga de trabalho por envolvido" descricao="Tarefas atribuídas">
          <GraficoRanking
            itens={d.carga_por_envolvido.map((c) => ({
              rotulo: c.responsavel,
              valor: c.total,
              apoio: `${c.em_aberto} em aberto${c.atrasadas > 0 ? ` · ${c.atrasadas} atrasadas` : ''}`,
            }))}
            formatar={(v) => `${inteiro(v)} tarefa(s)`}
            rotuloCategoria="Envolvido"
            rotuloValor="Tarefas"
          />
        </Cartao>

        <Cartao titulo="Desvio entre planejado e real" descricao="Projetos concluídos">
          {d.desvios.length === 0 ? (
            <p className="vazio">Nenhum projeto concluído ainda.</p>
          ) : (
            <div className="tabela-envolucro">
              <table>
                <thead>
                  <tr>
                    <th>Projeto</th>
                    <th>Fim planejado</th>
                    <th>Fim real</th>
                    <th className="num">Desvio</th>
                  </tr>
                </thead>
                <tbody>
                  {d.desvios.map((p) => (
                    <tr key={p.id}>
                      <td>{p.nome}</td>
                      <td>{p.mes_fim_planejado}</td>
                      <td>{p.mes_fim_real}</td>
                      <td className="num">
                        <Etiqueta
                          texto={p.desvio_meses > 0 ? `+${p.desvio_meses} mês(es)` : p.desvio_meses < 0 ? `${p.desvio_meses} mês(es)` : 'no prazo'}
                          tom={p.desvio_meses > 0 ? 'critico' : 'bom'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Cartao>
      </div>
    </>
  );
}
