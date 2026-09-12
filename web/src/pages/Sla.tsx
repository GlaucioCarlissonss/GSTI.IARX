import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { Aviso, Campo, Carregando, Cartao, ConfirmarAcao, Etiqueta, Modal } from '../components/base';
import { SeletorMulti } from '../components/seletor-multi';
import { GraficoBarras, GraficoLinhas, GraficoRanking, Indicador } from '../components/graficos';
import { Detalhamento, detalheDeRegistrosSla, type PedidoDetalhe } from '../components/detalhamento';
import { competenciaAtual, competenciaValida, inteiro, mesCurto, percentual } from '../lib/formato';

interface DashboardSla {
  escopo: { competencia: string; consolidado: boolean };
  totais_mes: {
    total_atendidos: number;
    dentro_sla: number;
    fora_sla: number;
    pct_dentro_sla: number;
    pct_fora_sla: number;
  };
  por_fila: Array<{ fila_id: number; fila: string; total_atendidos: number; dentro_sla: number; fora_sla: number; pct_dentro_sla: number }>;
  por_topico: Array<{ topico_ajuda_id: number | null; topico: string; total_atendidos: number; dentro_sla: number; fora_sla: number; pct_dentro_sla: number }>;
  por_filial: Array<{ filial: string; total_atendidos: number; dentro_sla: number; fora_sla: number; pct_dentro_sla: number }>;
  tendencia_mensal: Array<{ competencia: string; total_atendidos: number; dentro_sla: number; fora_sla: number; pct_dentro_sla: number }>;
}

// Dentro/fora do SLA é estado (bom/ruim), não identidade: usa a paleta de status,
// sempre acompanhada de rótulo — a cor nunca carrega o significado sozinha.
const SERIES_SLA = [
  { chave: 'dentro_sla', nome: 'Dentro do SLA', cor: 'var(--bom)' },
  { chave: 'fora_sla', nome: 'Fora do SLA', cor: 'var(--critico)' },
];

export function PaginaSla() {
  const { empresa, filialId, paramFilial } = useSessao();
  const [competencias, setCompetencias] = useState<string[]>([]);
  const [detalhe, setDetalhe] = useState<PedidoDetalhe<Record<string, unknown>> | null>(null);

  const consulta = useDados<DashboardSla>(
    () =>
      api.get('/api/dashboards/sla', {
        filial_id: paramFilial(),
        competencia: competencias.join(',') || undefined,
      }),
    [empresa?.id, filialId, competencias.join(',')],
  );

  if (consulta.erro) return <Aviso tipo="erro">{consulta.erro}</Aviso>;
  if (!consulta.dados) return <Carregando />;
  const d = consulta.dados;

  /**
   * Recorte do mês em foco, repassado a todo drill-down desta tela. É o que
   * garante que os chamados abertos são os mesmos que formaram o número.
   */
  const doMes = (extra: Record<string, unknown> = {}) => ({
    filial_id: paramFilial(),
    competencia: d.escopo.competencia,
    ...extra,
  });

  // Os meses com registro vêm da própria tendência, que já é a série do SLA.
  const itensMes = d.tendencia_mensal
    .filter((m) => m.total_atendidos > 0)
    .map((m) => ({ valor: m.competencia, rotulo: m.competencia, apoio: inteiro(m.total_atendidos) }));

  if (d.totais_mes.total_atendidos === 0 && d.tendencia_mensal.every((m) => m.total_atendidos === 0)) {
    return (
      <Cartao titulo="SLA de suporte">
        <p className="vazio">
          Nenhum ticket registrado nesta empresa. Lance em <strong>Registros de tickets</strong> ou importe pela
          planilha padrão do módulo de SLA.
        </p>
      </Cartao>
    );
  }

  return (
    <>
      <div className="barra-filtros">
        <Campo rotulo="Competência" dica="Nenhuma = último mês com registro">
          <SeletorMulti rotulo="Competência" largura={180} itens={itensMes}
            selecionados={competencias} aoMudar={setCompetencias} />
        </Campo>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--tinta-fraca)' }}>
          {d.escopo.consolidado ? 'Consolidado da empresa' : 'Filial selecionada'} · competência{' '}
          <strong style={{ color: 'var(--tinta-2)' }}>{d.escopo.competencia}</strong>
        </div>
      </div>

      <div className="grade c4">
        <Indicador
          rotulo="Tickets atendidos"
          valor={inteiro(d.totais_mes.total_atendidos)}
          dica={`Chamados com registro na competência ${d.escopo.competencia}.`}
          aoDetalhar={() => setDetalhe(detalheDeRegistrosSla(`Chamados de ${d.escopo.competencia}`, doMes(), d.totais_mes.total_atendidos))}
        />
        <Indicador
          rotulo="Dentro do SLA"
          valor={percentual(d.totais_mes.pct_dentro_sla)}
          apoio={`${inteiro(d.totais_mes.dentro_sla)} tickets`}
          dica="Chamados atendidos dentro do prazo."
          aoDetalhar={() =>
            setDetalhe(detalheDeRegistrosSla(`Dentro do SLA — ${d.escopo.competencia}`, doMes({ sla: 'dentro' }), d.totais_mes.dentro_sla))
          }
        />
        <Indicador
          rotulo="Fora do SLA"
          valor={percentual(d.totais_mes.pct_fora_sla)}
          apoio={`${inteiro(d.totais_mes.fora_sla)} tickets`}
          dica="Chamados que ultrapassaram o prazo."
          aoDetalhar={() =>
            setDetalhe(detalheDeRegistrosSla(`Fora do SLA — ${d.escopo.competencia}`, doMes({ sla: 'fora' }), d.totais_mes.fora_sla))
          }
        />
        {/* Contagem de filas não tem registros por trás — é um cadastro. */}
        <Indicador
          rotulo="Filas monitoradas"
          valor={inteiro(d.por_fila.length)}
          apoio={d.por_fila.map((f) => f.fila).join(' · ')}
          dica="Filas com atendimento registrado na competência."
        />
      </div>

      <div className="grade c2">
        <Cartao titulo="Desempenho por fila" descricao={d.escopo.competencia}>
          <GraficoBarras
            dados={d.por_fila.map((f) => ({
              rotulo: f.fila,
              valores: { dentro_sla: f.dentro_sla, fora_sla: f.fora_sla },
            }))}
            series={SERIES_SLA}
            modo="empilhado"
            formatar={inteiro}
            rotuloCategoria="Fila"
            aoClicar={(_, i) => {
              const f = d.por_fila[i]!;
              setDetalhe(
                detalheDeRegistrosSla(`Fila ${f.fila} — ${d.escopo.competencia}`, doMes({ fila_id: f.fila_id }), f.total_atendidos),
              );
            }}
          />
        </Cartao>

        <Cartao titulo="Tendência de conformidade" descricao="% dentro do SLA por competência">
          <GraficoLinhas
            dados={d.tendencia_mensal.map((m) => ({
              rotulo: mesCurto(m.competencia),
              valores: { pct: m.pct_dentro_sla },
            }))}
            series={[{ chave: 'pct', nome: '% dentro do SLA', cor: 'var(--serie-1)' }]}
            formatar={(v) => percentual(v)}
            formatarEixo={(v) => String(Math.round(v))}
            sufixoEixo="%"
            aoClicar={(_, i) => {
              const m = d.tendencia_mensal[i]!;
              setDetalhe(
                detalheDeRegistrosSla(`Conformidade de ${m.competencia}`,
                  { filial_id: paramFilial(), competencia: m.competencia }, m.total_atendidos),
              );
            }}
          />
        </Cartao>
      </div>

      <div className="grade c2">
        <Cartao titulo="Desempenho por tópico de ajuda" descricao="Volume atendido e conformidade">
          <GraficoRanking
            itens={d.por_topico.map((t) => ({
              rotulo: t.topico,
              valor: t.total_atendidos,
              apoio: `${percentual(t.pct_dentro_sla)} no SLA`,
            }))}
            formatar={(v) => `${inteiro(v)} tickets`}
            rotuloCategoria="Tópico de ajuda"
            rotuloValor="Tickets"
            aoClicar={(item) => {
              const t = d.por_topico.find((x) => x.topico === item.rotulo);
              setDetalhe(
                detalheDeRegistrosSla(`Tópico ${item.rotulo} — ${d.escopo.competencia}`,
                  doMes({ topico_ajuda_id: t?.topico_ajuda_id ?? 'sem' }), item.valor),
              );
            }}
          />
        </Cartao>

        <Cartao titulo="Desempenho por filial" descricao={d.escopo.competencia}>
          {d.por_filial.length === 0 ? (
            <p className="vazio">Sem registros nesta competência.</p>
          ) : (
            <div className="tabela-envolucro">
              <table>
                <thead>
                  <tr>
                    <th>Filial</th>
                    <th className="num">Atendidos</th>
                    <th className="num">Dentro</th>
                    <th className="num">Fora</th>
                    <th className="num">% no SLA</th>
                  </tr>
                </thead>
                <tbody>
                  {d.por_filial.map((f) => (
                    <tr key={f.filial}>
                      <td>{f.filial}</td>
                      <td className="num">{inteiro(f.total_atendidos)}</td>
                      <td className="num">{inteiro(f.dentro_sla)}</td>
                      <td className="num">{inteiro(f.fora_sla)}</td>
                      <td className="num">
                        <Etiqueta
                          texto={percentual(f.pct_dentro_sla)}
                          tom={f.pct_dentro_sla >= 90 ? 'bom' : f.pct_dentro_sla >= 75 ? 'atencao' : 'critico'}
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

      {detalhe && <Detalhamento pedido={detalhe} aoFechar={() => setDetalhe(null)} />}
    </>
  );
}

// ==========================================================================
// Registros de tickets
// ==========================================================================

interface RegistroSla {
  id: number;
  filial_nome: string | null;
  competencia: string;
  fila: string;
  topico_ajuda: string | null;
  total_atendidos: number;
  dentro_sla: number;
  fora_sla: number;
  pct_dentro_sla: number;
  // Preenchido quando o registro é UM chamado do helpdesk, e não o agregado.
  ticket_id: number | null;
  /** Id no sistema de origem. O chamado que chega por webhook grava só este. */
  external_id: string | null;
  /** Endereço do chamado no helpdesk, montado pelo servidor. */
  url_externa: string | null;
  numero: string | null;
  assunto: string | null;
  solicitante: string | null;
  status: string | null;
  horas: number | null;
}

interface Fila {
  id: number;
  nome: string;
}

interface Topico {
  id: number;
  nome: string;
}

export function PaginaRegistrosSla() {
  const { empresa, filialId, paramFilial, filiais, pode } = useSessao();
  // O perfil governa o que a tela oferece; quem recusa de fato é o servidor.
  const podeEditar = pode('suporte_ostick', 'create');
  const [novo, setNovo] = useState(false);
  const [excluir, setExcluir] = useState<RegistroSla | null>(null);
  const [competencia, setCompetencia] = useState('');

  const filas = useDados<Fila[]>(() => api.get('/api/filas'), []);
  const topicos = useDados<Topico[]>(() => api.get('/api/topicos-ajuda'), [empresa?.id]);
  const consulta = useDados<{ itens: RegistroSla[]; resumo: DashboardSla['totais_mes'] }>(
    () =>
      api.get('/api/sla', {
        filial_id: paramFilial(),
        competencia: competenciaValida(competencia) ? competencia : undefined,
      }),
    [empresa?.id, filialId, competencia],
  );

  // As colunas do chamado só aparecem quando há chamado no recorte: num
  // registro agregado mensal elas seriam uma fileira de travessões.
  /**
   * O registro é um chamado, e não o agregado do mês. Vale pelos dois campos:
   * a carga antiga do osTicket gravou `ticket_id`, e o chamado que chega por
   * webhook grava `external_id`.
   */
  const ehChamado = (r: RegistroSla) => r.ticket_id !== null || r.external_id !== null;
  const numeroDoChamado = (r: RegistroSla) => r.numero ?? r.external_id ?? r.ticket_id;
  const temChamados = (consulta.dados?.itens ?? []).some(ehChamado);

  return (
    <>
      <div className="barra-filtros">
        <Campo rotulo="Competência">
          <input
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            placeholder="todas"
            style={{ width: 110 }}
          />
        </Campo>
        {podeEditar && (
          <button type="button" className="botao primario" onClick={() => setNovo(true)} style={{ marginLeft: 'auto' }}>
            Registrar tickets do mês
          </button>
        )}
      </div>

      {consulta.erro && <Aviso tipo="erro">{consulta.erro}</Aviso>}

      <Cartao
        titulo="Registros de SLA"
        descricao={
          consulta.dados
            ? `${inteiro(consulta.dados.resumo.total_atendidos)} tickets · ${percentual(consulta.dados.resumo.pct_dentro_sla)} dentro do SLA`
            : undefined
        }
      >
        {!consulta.dados ? (
          <Carregando />
        ) : consulta.dados.itens.length === 0 ? (
          <p className="vazio">Nenhum registro no escopo consultado.</p>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  {temChamados && <th>Chamado</th>}
                  <th>Competência</th>
                  <th>Filial</th>
                  <th>Fila</th>
                  <th>Tópico de ajuda</th>
                  {temChamados && <th>Assunto</th>}
                  {temChamados && <th>Solicitante</th>}
                  {temChamados && <th>Status</th>}
                  <th className="num">Atendidos</th>
                  <th className="num">Dentro</th>
                  <th className="num">Fora</th>
                  <th className="num">% no SLA</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {consulta.dados.itens.map((r) => (
                  <tr key={r.id}>
                    {temChamados && (
                      <td>
                        {!ehChamado(r) ? (
                          '—'
                        ) : r.url_externa ? (
                          // O endereço vem pronto do servidor, que conhece a
                          // base de cada helpdesk; montá-lo aqui faria esta
                          // tela divergir do detalhamento e da listagem.
                          <a href={r.url_externa} target="_blank" rel="noopener noreferrer">
                            {numeroDoChamado(r)}
                          </a>
                        ) : (
                          numeroDoChamado(r)
                        )}
                      </td>
                    )}
                    <td>{r.competencia}</td>
                    <td>{r.filial_nome ?? <em style={{ color: 'var(--tinta-fraca)' }}>empresa</em>}</td>
                    <td>{r.fila}</td>
                    <td>{r.topico_ajuda ?? '—'}</td>
                    {temChamados && <td>{r.assunto ?? '—'}</td>}
                    {temChamados && <td>{r.solicitante ?? '—'}</td>}
                    {temChamados && <td>{r.status ?? '—'}</td>}
                    <td className="num">{inteiro(r.total_atendidos)}</td>
                    <td className="num">{inteiro(r.dentro_sla)}</td>
                    <td className="num">{inteiro(r.fora_sla)}</td>
                    <td className="num">
                      <Etiqueta
                        texto={percentual(r.pct_dentro_sla)}
                        tom={r.pct_dentro_sla >= 90 ? 'bom' : r.pct_dentro_sla >= 75 ? 'atencao' : 'critico'}
                      />
                    </td>
                    <td>
                      {podeEditar && (
                        <button type="button" className="botao discreto pequeno" onClick={() => setExcluir(r)}>
                          Excluir
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      <FormularioSla
        aberto={novo}
        aoFechar={() => setNovo(false)}
        filas={filas.dados ?? []}
        topicos={topicos.dados ?? []}
        filiais={filiais}
        aoSalvar={consulta.recarregar}
      />

      <ConfirmarAcao
        titulo="Excluir registro de SLA"
        aberto={excluir !== null}
        exigirJustificativa
        rotuloConfirmar="Excluir"
        aoFechar={() => setExcluir(null)}
        mensagem="A exclusão é lógica e fica registrada na trilha de auditoria."
        aoConfirmar={async (justificativa) => {
          await api.remover(`/api/sla/${excluir!.id}`, { justificativa });
          consulta.recarregar();
        }}
      />
    </>
  );
}

function FormularioSla({
  aberto,
  aoFechar,
  filas,
  topicos,
  filiais,
  aoSalvar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  filas: Fila[];
  topicos: Topico[];
  filiais: Array<{ id: number; nome: string }>;
  aoSalvar: () => void;
}) {
  const vazio = {
    filial_id: '',
    competencia: competenciaAtual(),
    fila_id: '',
    topico_ajuda_id: '',
    total_atendidos: '',
    dentro_sla: '',
  };
  const [form, setForm] = useState(vazio);
  const [erro, setErro] = useState<string | null>(null);

  const total = Number(form.total_atendidos || 0);
  const dentro = Number(form.dentro_sla || 0);
  const fora = total - dentro;

  const submeter = async (evento: FormEvent) => {
    evento.preventDefault();
    setErro(null);
    try {
      await api.post('/api/sla', {
        filial_id: form.filial_id ? Number(form.filial_id) : null,
        competencia: form.competencia,
        fila_id: Number(form.fila_id),
        topico_ajuda_id: form.topico_ajuda_id ? Number(form.topico_ajuda_id) : null,
        total_atendidos: total,
        dentro_sla: dentro,
      });
      setForm(vazio);
      aoSalvar();
      aoFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    }
  };

  return (
    <Modal titulo="Registrar tickets do mês" aberto={aberto} aoFechar={aoFechar}>
      <form onSubmit={submeter} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="grade c3">
          <Campo rotulo="Filial">
            <select value={form.filial_id} onChange={(e) => setForm({ ...form, filial_id: e.target.value })}>
              <option value="">— empresa —</option>
              {filiais.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Competência (MM/AAAA)">
            <input value={form.competencia} onChange={(e) => setForm({ ...form, competencia: e.target.value })} required />
          </Campo>
          <Campo rotulo="Fila">
            <select value={form.fila_id} onChange={(e) => setForm({ ...form, fila_id: e.target.value })} required>
              <option value="">Selecione…</option>
              {filas.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </Campo>
        </div>
        <div className="grade c3">
          <Campo rotulo="Tópico de ajuda">
            <select value={form.topico_ajuda_id} onChange={(e) => setForm({ ...form, topico_ajuda_id: e.target.value })}>
              <option value="">— sem tópico —</option>
              {topicos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Total atendidos">
            <input
              type="number"
              min={0}
              value={form.total_atendidos}
              onChange={(e) => setForm({ ...form, total_atendidos: e.target.value })}
              required
            />
          </Campo>
          <Campo rotulo="Dentro do SLA">
            <input
              type="number"
              min={0}
              max={total}
              value={form.dentro_sla}
              onChange={(e) => setForm({ ...form, dentro_sla: e.target.value })}
              required
            />
          </Campo>
        </div>
        <Aviso tipo={fora < 0 ? 'erro' : 'info'}>
          Fora do SLA calculado: <strong>{fora}</strong>
          {fora < 0 && ' — "dentro do SLA" não pode superar o total atendido.'}
        </Aviso>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="acoes">
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="botao primario" disabled={fora < 0}>
            Salvar registro
          </button>
        </div>
      </form>
    </Modal>
  );
}
