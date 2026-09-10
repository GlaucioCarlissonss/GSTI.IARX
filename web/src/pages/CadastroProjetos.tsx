import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { Aviso, Campo, Carregando, Cartao, ConfirmarAcao, Etiqueta, Modal } from '../components/base';
import { competenciaAtual, competenciaValida, inteiro, ROTULO_STATUS_PROJETO, ROTULO_STATUS_TAREFA } from '../lib/formato';

interface Projeto {
  id: number;
  nome: string;
  descricao: string | null;
  filial_id: number | null;
  filial_nome: string | null;
  mes_inicio: string;
  mes_fim_planejado: string;
  mes_fim_real: string | null;
  status: string;
  atrasado: boolean;
  meses_atraso: number;
  total_tarefas: number;
  tarefas_concluidas: number;
}

interface Tarefa {
  id: number;
  nome: string;
  mes_inicio: string;
  mes_fim_planejado: string;
  mes_fim_real: string | null;
  responsavel: string | null;
  status: string;
  atrasado: boolean;
  meses_atraso: number;
}

interface Envolvido {
  id: number;
  nome: string;
  papel: string | null;
}

export function PaginaCadastroProjetos() {
  const { empresa, filialId, paramFilial, filiais, ehGestor } = useSessao();
  const [novo, setNovo] = useState(false);
  const [selecionado, setSelecionado] = useState<Projeto | null>(null);
  const [excluir, setExcluir] = useState<Projeto | null>(null);

  const consulta = useDados<Projeto[]>(
    () => api.get('/api/projetos', { filial_id: paramFilial() }),
    [empresa?.id, filialId],
  );

  return (
    <>
      <div className="barra-filtros">
        <div style={{ marginRight: 'auto', color: 'var(--tinta-fraca)', fontSize: 13 }}>
          Projetos do escopo selecionado. Clique em um projeto para gerenciar tarefas e envolvidos.
        </div>
        {ehGestor && (
          <button type="button" className="botao primario" onClick={() => setNovo(true)}>
            Novo projeto
          </button>
        )}
      </div>

      {consulta.erro && <Aviso tipo="erro">{consulta.erro}</Aviso>}

      <Cartao titulo="Projetos" descricao={consulta.dados ? `${inteiro(consulta.dados.length)} projeto(s)` : undefined}>
        {!consulta.dados ? (
          <Carregando />
        ) : consulta.dados.length === 0 ? (
          <p className="vazio">Nenhum projeto cadastrado neste escopo.</p>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Projeto</th>
                  <th>Filial</th>
                  <th>Início</th>
                  <th>Fim planejado</th>
                  <th>Fim real</th>
                  <th>Status</th>
                  <th className="num">Tarefas</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {consulta.dados.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <button type="button" className="botao discreto" onClick={() => setSelecionado(p)} style={{ padding: 0 }}>
                        {p.nome}
                      </button>
                      {p.descricao && <div style={{ color: 'var(--tinta-fraca)', fontSize: 12 }}>{p.descricao}</div>}
                    </td>
                    <td>{p.filial_nome ?? <em style={{ color: 'var(--tinta-fraca)' }}>empresa</em>}</td>
                    <td>{p.mes_inicio}</td>
                    <td>{p.mes_fim_planejado}</td>
                    <td>{p.mes_fim_real ?? '—'}</td>
                    <td>
                      {p.atrasado ? (
                        <Etiqueta texto={`Atrasado (${p.meses_atraso}m)`} tom="critico" />
                      ) : (
                        <Etiqueta texto={ROTULO_STATUS_PROJETO[p.status] ?? p.status} tom={p.status === 'concluido' ? 'bom' : 'neutro'} />
                      )}
                    </td>
                    <td className="num">
                      {p.tarefas_concluidas}/{p.total_tarefas}
                    </td>
                    <td>
                      {ehGestor && (
                        <button type="button" className="botao discreto pequeno" onClick={() => setExcluir(p)}>
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

      <FormularioProjeto
        aberto={novo}
        aoFechar={() => setNovo(false)}
        filiais={filiais}
        aoSalvar={consulta.recarregar}
      />

      {selecionado && (
        <DetalheProjeto
          projeto={selecionado}
          aoFechar={() => {
            setSelecionado(null);
            consulta.recarregar();
          }}
          podeEditar={ehGestor}
        />
      )}

      <ConfirmarAcao
        titulo="Excluir projeto"
        aberto={excluir !== null}
        exigirJustificativa
        rotuloConfirmar="Excluir projeto e tarefas"
        aoFechar={() => setExcluir(null)}
        mensagem={`O projeto "${excluir?.nome}" e suas tarefas serão excluídos logicamente e registrados na auditoria.`}
        aoConfirmar={async (justificativa) => {
          await api.remover(`/api/projetos/${excluir!.id}`, { justificativa });
          consulta.recarregar();
        }}
      />
    </>
  );
}

function FormularioProjeto({
  aberto,
  aoFechar,
  filiais,
  aoSalvar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  filiais: Array<{ id: number; nome: string }>;
  aoSalvar: () => void;
}) {
  const vazio = {
    nome: '',
    descricao: '',
    filial_id: '',
    mes_inicio: competenciaAtual(),
    mes_fim_planejado: '',
    status: 'planejado',
  };
  const [form, setForm] = useState(vazio);
  const [erro, setErro] = useState<string | null>(null);

  const submeter = async (evento: FormEvent) => {
    evento.preventDefault();
    if (!competenciaValida(form.mes_inicio) || !competenciaValida(form.mes_fim_planejado)) {
      return setErro('Os meses devem estar no formato MM/AAAA.');
    }
    try {
      await api.post('/api/projetos', {
        nome: form.nome,
        descricao: form.descricao || null,
        filial_id: form.filial_id ? Number(form.filial_id) : null,
        mes_inicio: form.mes_inicio,
        mes_fim_planejado: form.mes_fim_planejado,
        status: form.status,
      });
      setForm(vazio);
      aoSalvar();
      aoFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    }
  };

  return (
    <Modal titulo="Novo projeto" aberto={aberto} aoFechar={aoFechar}>
      <form onSubmit={submeter} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Campo rotulo="Nome do projeto">
          <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required autoFocus />
        </Campo>
        <Campo rotulo="Descrição">
          <textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
        </Campo>
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
          <Campo rotulo="Mês de início">
            <input value={form.mes_inicio} onChange={(e) => setForm({ ...form, mes_inicio: e.target.value })} required />
          </Campo>
          <Campo rotulo="Fim planejado">
            <input
              value={form.mes_fim_planejado}
              onChange={(e) => setForm({ ...form, mes_fim_planejado: e.target.value })}
              placeholder="MM/AAAA"
              required
            />
          </Campo>
        </div>
        <Campo rotulo="Status">
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="planejado">Planejado</option>
            <option value="em_andamento">Em andamento</option>
          </select>
        </Campo>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="acoes">
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="botao primario">
            Criar projeto
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DetalheProjeto({
  projeto,
  aoFechar,
  podeEditar,
}: {
  projeto: Projeto;
  aoFechar: () => void;
  podeEditar: boolean;
}) {
  const tarefas = useDados<Tarefa[]>(() => api.get(`/api/projetos/${projeto.id}/tarefas`), [projeto.id]);
  const envolvidos = useDados<Envolvido[]>(() => api.get(`/api/projetos/${projeto.id}/envolvidos`), [projeto.id]);
  const [tarefa, setTarefa] = useState({ nome: '', mes_inicio: projeto.mes_inicio, mes_fim_planejado: '', responsavel: '' });
  const [envolvido, setEnvolvido] = useState({ nome: '', papel: '' });
  const [erro, setErro] = useState<string | null>(null);

  const adicionarTarefa = async (evento: FormEvent) => {
    evento.preventDefault();
    setErro(null);
    try {
      await api.post(`/api/projetos/${projeto.id}/tarefas`, tarefa);
      setTarefa({ nome: '', mes_inicio: projeto.mes_inicio, mes_fim_planejado: '', responsavel: '' });
      tarefas.recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao criar a tarefa.');
    }
  };

  const concluirTarefa = async (t: Tarefa) => {
    const mes = window.prompt('Mês de conclusão real (MM/AAAA):', competenciaAtual());
    if (!mes) return;
    try {
      await api.patch(`/api/projetos/tarefas/${t.id}`, { mes_fim_real: mes });
      tarefas.recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao concluir a tarefa.');
    }
  };

  const concluirProjeto = async () => {
    const mes = window.prompt('Mês de conclusão real do projeto (MM/AAAA):', competenciaAtual());
    if (!mes) return;
    try {
      await api.patch(`/api/projetos/${projeto.id}`, { mes_fim_real: mes });
      aoFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao concluir o projeto.');
    }
  };

  const adicionarEnvolvido = async (evento: FormEvent) => {
    evento.preventDefault();
    try {
      await api.post(`/api/projetos/${projeto.id}/envolvidos`, envolvido);
      setEnvolvido({ nome: '', papel: '' });
      envolvidos.recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao adicionar o envolvido.');
    }
  };

  return (
    <Modal titulo={projeto.nome} aberto aoFechar={aoFechar}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Etiqueta texto={`${projeto.mes_inicio} → ${projeto.mes_fim_planejado}`} />
        <Etiqueta
          texto={projeto.mes_fim_real ? `Concluído em ${projeto.mes_fim_real}` : ROTULO_STATUS_PROJETO[projeto.status] ?? projeto.status}
          tom={projeto.mes_fim_real ? 'bom' : projeto.atrasado ? 'critico' : 'neutro'}
        />
        {podeEditar && !projeto.mes_fim_real && (
          <button type="button" className="botao pequeno" onClick={concluirProjeto} style={{ marginLeft: 'auto' }}>
            Registrar conclusão
          </button>
        )}
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <div>
        <h3 style={{ marginBottom: 8 }}>Tarefas</h3>
        {!tarefas.dados ? (
          <Carregando />
        ) : tarefas.dados.length === 0 ? (
          <p className="vazio">Nenhuma tarefa neste projeto.</p>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Tarefa</th>
                  <th>Responsável</th>
                  <th>Período</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tarefas.dados.map((t) => (
                  <tr key={t.id}>
                    <td>{t.nome}</td>
                    <td>{t.responsavel ?? '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {t.mes_inicio} → {t.mes_fim_real ?? t.mes_fim_planejado}
                    </td>
                    <td>
                      <Etiqueta
                        texto={t.atrasado ? `Atrasada (${t.meses_atraso}m)` : (ROTULO_STATUS_TAREFA[t.status] ?? t.status)}
                        tom={t.atrasado ? 'critico' : t.mes_fim_real ? 'bom' : 'neutro'}
                      />
                    </td>
                    <td>
                      {podeEditar && !t.mes_fim_real && (
                        <button type="button" className="botao discreto pequeno" onClick={() => concluirTarefa(t)}>
                          Concluir
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {podeEditar && (
          <form onSubmit={adicionarTarefa} className="barra-filtros" style={{ marginTop: 10 }}>
            <Campo rotulo="Nova tarefa">
              <input value={tarefa.nome} onChange={(e) => setTarefa({ ...tarefa, nome: e.target.value })} required />
            </Campo>
            <Campo rotulo="Responsável">
              <input value={tarefa.responsavel} onChange={(e) => setTarefa({ ...tarefa, responsavel: e.target.value })} />
            </Campo>
            <Campo rotulo="Início">
              <input
                value={tarefa.mes_inicio}
                onChange={(e) => setTarefa({ ...tarefa, mes_inicio: e.target.value })}
                style={{ width: 100 }}
                required
              />
            </Campo>
            <Campo rotulo="Fim planejado">
              <input
                value={tarefa.mes_fim_planejado}
                onChange={(e) => setTarefa({ ...tarefa, mes_fim_planejado: e.target.value })}
                placeholder="MM/AAAA"
                style={{ width: 100 }}
                required
              />
            </Campo>
            <button type="submit" className="botao primario">
              Adicionar
            </button>
          </form>
        )}
      </div>

      <div>
        <h3 style={{ marginBottom: 8 }}>Envolvidos</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(envolvidos.dados ?? []).length === 0 && <span className="vazio">Nenhum envolvido registrado.</span>}
          {(envolvidos.dados ?? []).map((e) => (
            <Etiqueta key={e.id} texto={e.papel ? `${e.nome} — ${e.papel}` : e.nome} />
          ))}
        </div>
        {podeEditar && (
          <form onSubmit={adicionarEnvolvido} className="barra-filtros" style={{ marginTop: 10 }}>
            <Campo rotulo="Nome">
              <input value={envolvido.nome} onChange={(e) => setEnvolvido({ ...envolvido, nome: e.target.value })} required />
            </Campo>
            <Campo rotulo="Papel">
              <input value={envolvido.papel} onChange={(e) => setEnvolvido({ ...envolvido, papel: e.target.value })} />
            </Campo>
            <button type="submit" className="botao">
              Adicionar envolvido
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}
