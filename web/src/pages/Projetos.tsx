import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { Aviso, Carregando, Cartao, Etiqueta } from '../components/base';
import { GraficoRanking, Indicador, Legenda } from '../components/graficos';
import { competenciaAtual, inteiro, mesCurto, ROTULO_STATUS_PROJETO } from '../lib/formato';
import { useExpansao } from '../lib/expansao';

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
  tarefas: TarefaGantt[];
}

interface TarefaGantt {
  id: number;
  nome: string;
  responsavel: string | null;
  status: string;
  parent_task_id: number | null;
  nivel: number;
  total_subtarefas: number;
  mes_inicio: string;
  mes_fim_planejado: string;
  mes_fim_real: string | null;
  offset_meses: number;
  duracao_meses: number;
  duracao_real_meses: number | null;
  // Intervalo agregado da subárvore: é a barra que a tarefa principal mostra
  // quando o grupo está comprimido.
  grupo_mes_inicio: string;
  grupo_mes_fim: string;
  grupo_offset_meses: number;
  grupo_duracao_meses: number;
  grupo_duracao_real_meses: number | null;
  atrasado: boolean;
  meses_atraso: number;
}

/** Uma linha desenhada no Gantt: um projeto ou uma tarefa. */
type LinhaGantt =
  | { tipo: 'projeto'; chave: string; projeto: ItemGantt }
  | { tipo: 'tarefa'; chave: string; projeto: ItemGantt; tarefa: TarefaGantt; comprimida: boolean };

/**
 * Altura de uma linha do Gantt, em pixels. Fixa por CSS (`td.faixa`), o que é
 * o que permite virtualizar por aritmética em vez de medir cada linha.
 */
const ALTURA_LINHA = 27;

/** A partir de quantas linhas vale a pena virtualizar. */
const TETO_SEM_VIRTUALIZAR = 60;

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
  // Projeto e grupo de tarefas usam o mesmo estado persistido, com prefixo
  // diferente na chave: são dois níveis do mesmo cronograma.
  const grupos = useExpansao('gsti-gantt-comprimidos', 'expandido');
  const [rolagem, setRolagem] = useState(0);
  const [alturaVisivel, setAlturaVisivel] = useState(640);
  const caixa = useRef<HTMLDivElement>(null);

  const consulta = useDados<DashboardProjetos>(
    () => api.get('/api/dashboards/projetos', { filial_id: paramFilial() }),
    [empresa?.id, filialId],
  );

  const indiceHoje = useMemo(() => {
    if (!consulta.dados) return -1;
    return consulta.dados.linha_do_tempo.indexOf(competenciaAtual());
  }, [consulta.dados]);

  /**
   * O Gantt vira uma lista achatada de linhas visíveis, e não uma árvore
   * aninhada: é o que permite virtualizar por índice e o que mantém uma única
   * regra de "esta linha aparece?".
   *
   * Uma tarefa aparece quando o projeto está aberto e nenhuma das suas
   * ascendentes está comprimida — comprimir o avô esconde o neto junto.
   */
  const linhas = useMemo<LinhaGantt[]>(() => {
    if (!consulta.dados) return [];
    const saida: LinhaGantt[] = [];
    for (const projeto of consulta.dados.gantt) {
      saida.push({ tipo: 'projeto', chave: `p${projeto.id}`, projeto });
      if (!grupos.expandido(`p${projeto.id}`)) continue;

      const escondidas = new Set<number>();
      for (const tarefa of projeto.tarefas) {
        const paiEscondido = tarefa.parent_task_id !== null && escondidas.has(tarefa.parent_task_id);
        const paiComprimido = tarefa.parent_task_id !== null && !grupos.expandido(`t${tarefa.parent_task_id}`);
        if (paiEscondido || paiComprimido) {
          escondidas.add(tarefa.id);
          continue;
        }
        const comprimida = tarefa.total_subtarefas > 0 && !grupos.expandido(`t${tarefa.id}`);
        saida.push({ tipo: 'tarefa', chave: `t${tarefa.id}`, projeto, tarefa, comprimida });
      }
    }
    return saida;
  }, [consulta.dados, grupos]);

  // A virtualização só entra quando há linhas suficientes para valer a pena;
  // abaixo disso, desenhar tudo é mais simples e igualmente rápido.
  const virtualizar = linhas.length > TETO_SEM_VIRTUALIZAR;
  const margem = 8;
  const primeira = virtualizar ? Math.max(Math.floor(rolagem / ALTURA_LINHA) - margem, 0) : 0;
  const ultima = virtualizar
    ? Math.min(primeira + Math.ceil(alturaVisivel / ALTURA_LINHA) + margem * 2, linhas.length)
    : linhas.length;
  const visiveis = linhas.slice(primeira, ultima);

  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setAlturaVisivel(el.clientHeight || 640);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
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

  /** Todo grupo do cronograma: projetos e tarefas que têm subtarefas. */
  const todosOsGrupos = [
    ...d.gantt.map((p) => `p${p.id}`),
    ...d.gantt.flatMap((p) => p.tarefas.filter((t) => t.total_subtarefas > 0).map((t) => `t${t.id}`)),
  ];

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
        descricao={`${d.escopo.linha_do_tempo.inicio} a ${d.escopo.linha_do_tempo.fim} · ${inteiro(linhas.length)} linha(s)`}
        acoes={
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="botao discreto pequeno" onClick={() => grupos.expandirTudo(todosOsGrupos)}>
              Expandir tudo
            </button>
            <button
              type="button"
              className="botao discreto pequeno"
              onClick={() => grupos.comprimirTudo(todosOsGrupos)}
            >
              Comprimir tudo
            </button>
          </div>
        }
      >
        <Legenda series={SERIES_GANTT} />
        <div
          className="gantt"
          ref={caixa}
          onScroll={(e) => virtualizar && setRolagem(e.currentTarget.scrollTop)}
          style={{ marginTop: 10, ...(virtualizar ? { maxHeight: 640, overflowY: 'auto' } : null) }}
        >
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 240, position: 'sticky', left: 0, background: 'var(--superficie)' }}>
                  Projeto / tarefa
                </th>
                {meses.map((m, i) => (
                  <th key={m} className={`mes ${m.startsWith('01/') ? 'virada' : ''}`}>
                    {/* Linhas do tempo curtas cabem mês a mês; as longas rareiam os rótulos. */}
                    {meses.length <= 18 || i === 0 || m.startsWith('01/') || i % 3 === 0 ? mesCurto(m) : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Espaçadores das linhas fora da janela: mantêm a barra de
                  rolagem do tamanho da lista inteira. */}
              {primeira > 0 && (
                <tr aria-hidden>
                  <td colSpan={meses.length + 1} style={{ height: primeira * ALTURA_LINHA, padding: 0, border: 0 }} />
                </tr>
              )}

              {visiveis.map((linha) =>
                linha.tipo === 'projeto' ? (
                  <LinhaProjeto
                    key={linha.chave}
                    projeto={linha.projeto}
                    aberto={grupos.expandido(linha.chave)}
                    aoAlternar={() => grupos.alternar(linha.chave)}
                    meses={meses}
                    larguraMes={larguraMes}
                    indiceHoje={indiceHoje}
                  />
                ) : (
                  <LinhaTarefa
                    key={linha.chave}
                    tarefa={linha.tarefa}
                    comprimida={linha.comprimida}
                    aoAlternar={() => grupos.alternar(linha.chave)}
                    meses={meses}
                    larguraMes={larguraMes}
                    indiceHoje={indiceHoje}
                  />
                ),
              )}

              {ultima < linhas.length && (
                <tr aria-hidden>
                  <td
                    colSpan={meses.length + 1}
                    style={{ height: (linhas.length - ultima) * ALTURA_LINHA, padding: 0, border: 0 }}
                  />
                </tr>
              )}
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

/**
 * Botão de expandir/comprimir de um grupo do Gantt. Um `button` de verdade,
 * e não um ícone clicável: assim vem teclado (Enter/Espaço), foco e o estado
 * anunciado por `aria-expanded` sem nada disso ser reimplementado à mão.
 */
function BotaoGrupo({
  aberto,
  rotulo,
  aoAlternar,
}: {
  aberto: boolean;
  rotulo: string;
  aoAlternar: () => void;
}) {
  return (
    <button
      type="button"
      className="gantt-grupo"
      aria-expanded={aberto}
      aria-label={`${aberto ? 'Comprimir' : 'Expandir'} ${rotulo}`}
      title={aberto ? 'Comprimir' : 'Expandir'}
      onClick={(e) => {
        e.stopPropagation();
        aoAlternar();
      }}
    >
      <span aria-hidden>{aberto ? '−' : '+'}</span>
    </button>
  );
}

function MarcaHoje({ indiceHoje, larguraMes }: { indiceHoje: number; larguraMes: number }) {
  if (indiceHoje < 0) return null;
  return <div className="hoje" style={{ left: indiceHoje * larguraMes + larguraMes / 2 }} />;
}

function LinhaProjeto({
  projeto,
  aberto,
  aoAlternar,
  meses,
  larguraMes,
  indiceHoje,
}: {
  projeto: ItemGantt;
  aberto: boolean;
  aoAlternar: () => void;
  meses: string[];
  larguraMes: number;
  indiceHoje: number;
}) {
  return (
    <tr>
      <td className="nome" style={{ position: 'sticky', left: 0, background: 'var(--superficie)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {projeto.tarefas.length > 0 ? (
            <BotaoGrupo aberto={aberto} rotulo={`as tarefas de ${projeto.nome}`} aoAlternar={aoAlternar} />
          ) : (
            <span className="gantt-vazio" aria-hidden />
          )}
          <strong style={{ fontWeight: 550 }}>{projeto.nome}</strong>
          {projeto.atrasado && <Etiqueta texto={`${projeto.meses_atraso} mês(es) de atraso`} tom="critico" />}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--tinta-fraca)', paddingLeft: 26 }}>
          {projeto.filial_nome ?? 'empresa'} · {ROTULO_STATUS_PROJETO[projeto.status] ?? projeto.status}
          {projeto.tarefas.length > 0 && ` · ${inteiro(projeto.tarefas.length)} tarefa(s)`}
        </div>
      </td>
      <td className="faixa" colSpan={meses.length} style={{ position: 'relative' }}>
        <MarcaHoje indiceHoje={indiceHoje} larguraMes={larguraMes} />
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
  );
}

function LinhaTarefa({
  tarefa,
  comprimida,
  aoAlternar,
  meses,
  larguraMes,
  indiceHoje,
}: {
  tarefa: TarefaGantt;
  comprimida: boolean;
  aoAlternar: () => void;
  meses: string[];
  larguraMes: number;
  indiceHoje: number;
}) {
  const temFilhas = tarefa.total_subtarefas > 0;
  // Comprimida, a barra do grupo cobre o intervalo inteiro da subárvore: as
  // subtarefas sumiram da tela, mas o tempo que elas ocupam não sumiu do
  // cronograma.
  const usaGrupo = temFilhas && comprimida;
  const deslocamento = usaGrupo ? tarefa.grupo_offset_meses : tarefa.offset_meses;
  const duracao = usaGrupo ? tarefa.grupo_duracao_meses : tarefa.duracao_meses;
  const duracaoReal = usaGrupo ? tarefa.grupo_duracao_real_meses : tarefa.duracao_real_meses;
  const titulo = usaGrupo
    ? `Grupo "${tarefa.nome}": ${tarefa.grupo_mes_inicio} → ${tarefa.grupo_mes_fim} (${inteiro(tarefa.total_subtarefas)} subtarefa(s))`
    : `${tarefa.mes_inicio} → ${tarefa.mes_fim_planejado}`;

  return (
    <tr>
      <td
        className="nome tarefa"
        style={{ position: 'sticky', left: 0, background: 'var(--superficie)', paddingLeft: 14 + tarefa.nivel * 14 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {temFilhas ? (
            <BotaoGrupo aberto={!comprimida} rotulo={`as subtarefas de ${tarefa.nome}`} aoAlternar={aoAlternar} />
          ) : (
            <span className="gantt-vazio" aria-hidden />
          )}
          <span style={temFilhas ? { fontWeight: 550, color: 'var(--tinta)' } : undefined}>{tarefa.nome}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--tinta-fraca)', paddingLeft: 24 }}>
          {tarefa.responsavel ?? 'sem responsável'}
          {temFilhas && ` · ${inteiro(tarefa.total_subtarefas)} subtarefa(s)`}
        </div>
      </td>
      <td className="faixa" colSpan={meses.length} style={{ position: 'relative' }}>
        <MarcaHoje indiceHoje={indiceHoje} larguraMes={larguraMes} />
        <div
          className="barra"
          title={titulo}
          style={{
            left: deslocamento * larguraMes + 2,
            width: Math.max(duracao * larguraMes - 4, 6),
            height: usaGrupo ? 9 : 7,
            top: usaGrupo ? 5 : 7,
            background: tarefa.atrasado ? 'var(--critico)' : 'var(--serie-1)',
            opacity: usaGrupo ? 1 : 0.75,
          }}
        />
        {duracaoReal !== null && (
          <div
            className="barra real"
            title={usaGrupo ? `Grupo realizado até ${tarefa.grupo_mes_fim}` : `Realizado até ${tarefa.mes_fim_real}`}
            style={{
              left: deslocamento * larguraMes + 2,
              width: Math.max(duracaoReal * larguraMes - 4, 6),
              background: 'var(--serie-3)',
              opacity: usaGrupo ? 1 : 0.75,
            }}
          />
        )}
      </td>
    </tr>
  );
}
