import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { Aviso, Campo, Carregando, Cartao, ConfirmarAcao, Etiqueta } from '../components/base';
import { competenciaAtual, competenciaValida, dataHora, inteiro } from '../lib/formato';

// ==========================================================================
// Fechamento de competência
// ==========================================================================

interface Fechamento {
  id: number;
  competencia: string;
  fechado_em: string;
  fechado_por: string | null;
  observacao: string | null;
}

export function PaginaFechamentos() {
  const { empresa, pode } = useSessao();
  // O perfil governa o que a tela oferece; quem recusa de fato é o servidor.
  const podeEditar = pode('configuracoes', 'edit');
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [reabrir, setReabrir] = useState<Fechamento | null>(null);

  const consulta = useDados<Fechamento[]>(() => api.get('/api/fechamentos'), [empresa?.id]);

  const fechar = async (evento: FormEvent) => {
    evento.preventDefault();
    setErro(null);
    if (!competenciaValida(competencia)) return setErro('Competência deve estar no formato MM/AAAA.');
    try {
      await api.post('/api/fechamentos', { competencia, observacao: observacao || null });
      setObservacao('');
      consulta.recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao fechar a competência.');
    }
  };

  return (
    <>
      <Cartao titulo="Fechamento de competência">
        <Aviso>
          Uma competência fechada não aceita novos lançamentos nem alterações — inclusive por importação. Reabrir exige
          justificativa, que fica registrada na auditoria.
        </Aviso>
        {podeEditar && (
          <form onSubmit={fechar} className="barra-filtros" style={{ marginTop: 12 }}>
            <Campo rotulo="Competência (MM/AAAA)">
              <input value={competencia} onChange={(e) => setCompetencia(e.target.value)} style={{ width: 110 }} />
            </Campo>
            <Campo rotulo="Observação">
              <input value={observacao} onChange={(e) => setObservacao(e.target.value)} style={{ minWidth: 260 }} />
            </Campo>
            <button type="submit" className="botao primario">
              Fechar competência
            </button>
          </form>
        )}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
      </Cartao>

      <Cartao titulo="Competências fechadas">
        {!consulta.dados ? (
          <Carregando />
        ) : consulta.dados.length === 0 ? (
          <p className="vazio">Nenhuma competência fechada nesta empresa.</p>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Competência</th>
                  <th>Fechada em</th>
                  <th>Por</th>
                  <th>Observação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {consulta.dados.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <Etiqueta texto={f.competencia} tom="atencao" />
                    </td>
                    <td>{dataHora(f.fechado_em)}</td>
                    <td>{f.fechado_por ?? '—'}</td>
                    <td>{f.observacao ?? '—'}</td>
                    <td>
                      {podeEditar && (
                        <button type="button" className="botao discreto pequeno" onClick={() => setReabrir(f)}>
                          Reabrir
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

      <ConfirmarAcao
        titulo="Reabrir competência"
        aberto={reabrir !== null}
        exigirJustificativa
        rotuloConfirmar="Reabrir"
        aoFechar={() => setReabrir(null)}
        mensagem={`A competência ${reabrir?.competencia} voltará a aceitar alterações.`}
        aoConfirmar={async (justificativa) => {
          await api.post('/api/fechamentos/reabrir', { competencia: reabrir!.competencia, justificativa });
          consulta.recarregar();
        }}
      />
    </>
  );
}

// ==========================================================================
// Cadastros
// ==========================================================================

interface ItemCadastro {
  id: number;
  nome: string;
  ativo: number;
}

interface FilialCadastro extends ItemCadastro {
  cidade: string | null;
  uf: string | null;
}

export function PaginaCadastros() {
  const { empresa, pode, recarregarFiliais } = useSessao();
  // O perfil governa o que a tela oferece; quem recusa de fato é o servidor.
  const podeEditar = pode('configuracoes', 'edit');
  const [erro, setErro] = useState<string | null>(null);

  const filiais = useDados<FilialCadastro[]>(() => api.get('/api/filiais'), [empresa?.id]);
  const tipos = useDados<ItemCadastro[]>(() => api.get('/api/tipos-despesa', { incluir_inativos: true }), [empresa?.id]);
  const topicos = useDados<ItemCadastro[]>(() => api.get('/api/topicos-ajuda', { incluir_inativos: true }), [empresa?.id]);
  const filas = useDados<ItemCadastro[]>(() => api.get('/api/filas'), []);

  const criar = async (caminho: string, corpo: unknown, recarregar: () => void) => {
    setErro(null);
    try {
      await api.post(caminho, corpo);
      recarregar();
      if (caminho === '/api/filiais') await recarregarFiliais();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao cadastrar.');
    }
  };

  const alternarAtivo = async (caminho: string, item: ItemCadastro, recarregar: () => void) => {
    setErro(null);
    try {
      await api.patch(`${caminho}/${item.id}`, { ativo: item.ativo !== 1 });
      recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao atualizar.');
    }
  };

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Cartao titulo="Filiais" descricao="Uma empresa pode ter zero ou mais filiais">
        <ListaCadastro
          itens={(filiais.dados ?? []).map((f) => ({
            ...f,
            complemento: [f.cidade, f.uf].filter(Boolean).join('/') || null,
          }))}
          podeEditar={podeEditar}
          aoAlternar={(item) => alternarAtivo('/api/filiais', item, filiais.recarregar)}
        />
        {podeEditar && (
          <FormularioNovo
            rotulo="Nova filial"
            campos={[
              { chave: 'nome', rotulo: 'Nome', obrigatorio: true },
              { chave: 'cidade', rotulo: 'Cidade' },
              { chave: 'uf', rotulo: 'UF' },
            ]}
            aoEnviar={(dados) => criar('/api/filiais', dados, filiais.recarregar)}
          />
        )}
      </Cartao>

      <Cartao titulo="Tipos de despesa" descricao="Cadastro livre — os padrões vêm criados com a empresa">
        <ListaCadastro
          itens={tipos.dados ?? []}
          podeEditar={podeEditar}
          aoAlternar={(item) => alternarAtivo('/api/tipos-despesa', item, tipos.recarregar)}
        />
        {podeEditar && (
          <FormularioNovo
            rotulo="Novo tipo de despesa"
            campos={[{ chave: 'nome', rotulo: 'Nome', obrigatorio: true }]}
            aoEnviar={(dados) => criar('/api/tipos-despesa', dados, tipos.recarregar)}
          />
        )}
      </Cartao>

      <div className="grade c2">
        <Cartao titulo="Tópicos de ajuda" descricao="Categorizam o atendimento dos tickets">
          <ListaCadastro
            itens={topicos.dados ?? []}
            podeEditar={podeEditar}
            aoAlternar={(item) => alternarAtivo('/api/topicos-ajuda', item, topicos.recarregar)}
          />
          {podeEditar && (
            <FormularioNovo
              rotulo="Novo tópico"
              campos={[{ chave: 'nome', rotulo: 'Nome', obrigatorio: true }]}
              aoEnviar={(dados) => criar('/api/topicos-ajuda', dados, topicos.recarregar)}
            />
          )}
        </Cartao>

        <Cartao titulo="Filas de ticket" descricao="Infraestrutura, Sistema e Dados — expansível">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(filas.dados ?? []).map((f) => (
              <Etiqueta key={f.id} texto={f.nome} />
            ))}
          </div>
          {podeEditar && (
            <FormularioNovo
              rotulo="Nova fila"
              campos={[{ chave: 'nome', rotulo: 'Nome', obrigatorio: true }]}
              aoEnviar={(dados) => criar('/api/filas', dados, filas.recarregar)}
            />
          )}
        </Cartao>
      </div>

      <EnderecoHelpdesk podeEditar={podeEditar} />
    </>
  );
}

/**
 * Endereço base do helpdesk. O id do chamado completa a URL, e é isso que faz o
 * número na tela de SLA virar link de volta para o sistema de origem.
 */
function EnderecoHelpdesk({ podeEditar }: { podeEditar: boolean }) {
  const { empresa } = useSessao();
  const consulta = useDados<{ url_helpdesk: string }>(() => api.get('/api/sla/configuracao'), [empresa?.id]);
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [salvo, setSalvo] = useState(false);
  const valor = url ?? consulta.dados?.url_helpdesk ?? '';

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setSalvo(false);
    try {
      await api.put('/api/sla/configuracao', { url_helpdesk: valor });
      consulta.recarregar();
      setSalvo(true);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : String(falha));
    }
  }

  return (
    <Cartao
      titulo="Endereço do helpdesk"
      descricao="O número do chamado é acrescentado ao final, formando o link de volta"
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {salvo && <Aviso tipo="ok">Endereço salvo.</Aviso>}
      <form onSubmit={salvar} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Campo rotulo="Endereço base">
          <input
            value={valor}
            onChange={(e) => setUrl(e.target.value)}
            disabled={!podeEditar}
            placeholder="https://…/scp/tickets.php?id="
            style={{ minWidth: 320 }}
          />
        </Campo>
        {podeEditar && (
          <button type="submit" className="botao primario">
            Salvar
          </button>
        )}
      </form>
    </Cartao>
  );
}

function ListaCadastro({
  itens,
  podeEditar,
  aoAlternar,
}: {
  itens: Array<ItemCadastro & { complemento?: string | null }>;
  podeEditar: boolean;
  aoAlternar: (item: ItemCadastro) => void;
}) {
  if (itens.length === 0) return <p className="vazio">Nenhum registro.</p>;
  return (
    <div className="tabela-envolucro">
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Situação</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.id}>
              <td>
                {i.nome}
                {i.complemento && <span style={{ color: 'var(--tinta-fraca)' }}> · {i.complemento}</span>}
              </td>
              <td>
                <Etiqueta texto={i.ativo === 1 ? 'Ativo' : 'Inativo'} tom={i.ativo === 1 ? 'bom' : 'neutro'} />
              </td>
              <td>
                {podeEditar && (
                  <button type="button" className="botao discreto pequeno" onClick={() => aoAlternar(i)}>
                    {i.ativo === 1 ? 'Desativar' : 'Reativar'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormularioNovo({
  rotulo,
  campos,
  aoEnviar,
}: {
  rotulo: string;
  campos: Array<{ chave: string; rotulo: string; obrigatorio?: boolean }>;
  aoEnviar: (dados: Record<string, string>) => Promise<void>;
}) {
  const [valores, setValores] = useState<Record<string, string>>({});
  return (
    <form
      className="barra-filtros"
      style={{ marginTop: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        await aoEnviar(valores);
        setValores({});
      }}
    >
      {campos.map((c) => (
        <Campo key={c.chave} rotulo={c.rotulo}>
          <input
            value={valores[c.chave] ?? ''}
            onChange={(e) => setValores({ ...valores, [c.chave]: e.target.value })}
            required={c.obrigatorio}
          />
        </Campo>
      ))}
      <button type="submit" className="botao">
        {rotulo}
      </button>
    </form>
  );
}

// ==========================================================================
// Auditoria
// ==========================================================================

interface RegistroAuditoria {
  id: number;
  usuario_email: string;
  entidade: string;
  entidade_id: number | null;
  acao: string;
  justificativa: string | null;
  dados_antes: unknown;
  dados_depois: unknown;
  criado_em: string;
}

const ENTIDADES = ['lancamento', 'projeto', 'tarefa', 'ticket_sla', 'fechamento', 'importacao', 'filial', 'tipo_despesa'];

export function PaginaAuditoria() {
  const { empresa } = useSessao();
  const [entidade, setEntidade] = useState('');
  const consulta = useDados<RegistroAuditoria[]>(
    () => api.get('/api/auditoria', { entidade: entidade || undefined, limite: 200 }),
    [empresa?.id, entidade],
  );

  return (
    <>
      <div className="barra-filtros">
        <Campo rotulo="Entidade">
          <select value={entidade} onChange={(e) => setEntidade(e.target.value)}>
            <option value="">Todas</option>
            {ENTIDADES.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </Campo>
        <div style={{ marginLeft: 'auto', color: 'var(--tinta-fraca)', fontSize: 13 }}>
          Nenhuma alteração relevante ocorre sem trilha: quem, quando e o quê.
        </div>
      </div>

      <Cartao titulo="Trilha de auditoria" descricao={consulta.dados ? `${inteiro(consulta.dados.length)} eventos recentes` : undefined}>
        {!consulta.dados ? (
          <Carregando />
        ) : consulta.dados.length === 0 ? (
          <p className="vazio">Nenhum evento registrado.</p>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Usuário</th>
                  <th>Entidade</th>
                  <th>Ação</th>
                  <th>Justificativa</th>
                  <th>Alteração</th>
                </tr>
              </thead>
              <tbody>
                {consulta.dados.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{dataHora(r.criado_em)}</td>
                    <td>{r.usuario_email}</td>
                    <td>
                      {r.entidade}
                      {r.entidade_id ? ` #${r.entidade_id}` : ''}
                    </td>
                    <td>
                      <Etiqueta
                        texto={r.acao}
                        tom={r.acao === 'excluir' ? 'critico' : r.acao === 'criar' ? 'bom' : 'neutro'}
                      />
                    </td>
                    <td style={{ maxWidth: 260 }}>{r.justificativa ?? '—'}</td>
                    <td style={{ maxWidth: 380 }}>
                      <ResumoAlteracao antes={r.dados_antes} depois={r.dados_depois} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </>
  );
}

/** Mostra apenas os campos que efetivamente mudaram. */
function ResumoAlteracao({ antes, depois }: { antes: unknown; depois: unknown }) {
  const a = (antes ?? {}) as Record<string, unknown>;
  const d = (depois ?? {}) as Record<string, unknown>;
  const chaves = [...new Set([...Object.keys(a), ...Object.keys(d)])].filter(
    (c) => JSON.stringify(a[c]) !== JSON.stringify(d[c]),
  );
  if (chaves.length === 0) return <span style={{ color: 'var(--tinta-fraca)' }}>—</span>;
  return (
    <div style={{ fontSize: 12 }}>
      {chaves.slice(0, 6).map((c) => (
        <div key={c}>
          <strong>{c}</strong>: {antes ? String(a[c] ?? '∅') : '∅'} → {depois ? String(d[c] ?? '∅') : '∅'}
        </div>
      ))}
    </div>
  );
}
