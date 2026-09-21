import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { useFiltroEscopo } from '../lib/filtros';
import { Filtro, FiltroUnidades, SeletorUnidadeFoco } from '../components/filtro-escopo';
import { Aviso, Campo, Carregando, Cartao, ConfirmarAcao, Etiqueta } from '../components/base';
import { competenciaAtual, competenciaExib, competenciaValida, dataHora, inteiro } from '../lib/formato';

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
  const { empresa, empresas, trocarEmpresa, pode } = useSessao();
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
      <div className="barra-filtros">
        <SeletorUnidadeFoco
          empresas={empresas}
          empresaId={empresa?.id ?? null}
          aoTrocar={trocarEmpresa}
          explicacao="O fechamento trava a competência DESTA unidade: as demais continuam aceitando lançamento."
        />
      </div>

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
  const { empresa, empresas, trocarEmpresa, pode, recarregarFiliais } = useSessao();
  // O perfil governa o que a tela oferece; quem recusa de fato é o servidor.
  const podeEditar = pode('configuracoes', 'edit');
  const [erro, setErro] = useState<string | null>(null);

  // O cadastro é de UMA unidade: filial, tipo de despesa e tópico pertencem à
  // matriz, e um cadastro "do cliente inteiro" não teria onde ser gravado.
  const filiais = useDados<FilialCadastro[]>(
    () => api.get('/api/filiais', { empresas: empresa?.id }),
    [empresa?.id],
  );
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
      <div className="barra-filtros">
        <SeletorUnidadeFoco
          empresas={empresas}
          empresaId={empresa?.id ?? null}
          aoTrocar={trocarEmpresa}
          explicacao="Os cadastros abaixo (filiais, tipos de despesa, tópicos) pertencem a esta unidade e valem só para ela."
        />
      </div>

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

// ==========================================================================
// Metas
// ==========================================================================

interface Meta {
  id: number;
  nome: string;
  modulo: 'financeiro' | 'sla' | 'projetos' | 'equilibrio';
  alvo_pct: number;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  ativo: number;
}

const ROTULO_MODULO_META: Record<Meta['modulo'], string> = {
  financeiro: 'Financeiro',
  sla: 'SLA',
  projetos: 'Projetos',
  equilibrio: 'Equilíbrio de despesas',
};

/** O que o alvo significa em cada módulo — piso ou teto. */
const SENTIDO_MODULO: Record<Meta['modulo'], string> = {
  financeiro: 'teto para a variação de custo contra o mês anterior',
  sla: 'mínimo de chamados atendidos no prazo',
  projetos: 'mínimo de tarefas entregues no prazo',
  equilibrio: 'teto para o gasto de uma unidade consumido por outras',
};

/**
 * Cadastro de metas — o alvo contra o qual os indicadores são lidos.
 *
 * É tela de CLIENTE, e não de unidade: por isso não tem o seletor de unidade
 * em foco que as outras têm. Uma meta de SLA que valesse só para uma matriz
 * não responderia "como vai o atendimento deste contratante".
 */
export function PaginaMetas() {
  const { pode } = useSessao();
  const podeEditar = pode('configuracoes', 'edit');
  const [erro, setErro] = useState<string | null>(null);
  const metas = useDados<Meta[]>(() => api.get('/api/metas', { incluir_inativos: true }), []);

  const criar = async (dados: Record<string, string>) => {
    setErro(null);
    try {
      await api.post('/api/metas', dados);
      metas.recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao cadastrar a meta.');
    }
  };

  const alternar = async (m: Meta) => {
    setErro(null);
    try {
      await api.patch(`/api/metas/${m.id}`, { ativo: m.ativo !== 1 });
      metas.recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao atualizar a meta.');
    }
  };

  const vigencia = (m: Meta) => {
    if (!m.vigencia_inicio && !m.vigencia_fim) return 'sempre';
    if (m.vigencia_inicio && !m.vigencia_fim) return `de ${competenciaExib(m.vigencia_inicio)} em diante`;
    if (!m.vigencia_inicio && m.vigencia_fim) return `até ${competenciaExib(m.vigencia_fim)}`;
    return `${competenciaExib(m.vigencia_inicio!)} a ${competenciaExib(m.vigencia_fim!)}`;
  };

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Cartao
        titulo="Metas"
        descricao="O alvo que aparece ao lado do resultado em cada indicador geral"
      >
        {metas.carregando ? (
          <Carregando />
        ) : (metas.dados ?? []).length === 0 ? (
          <p className="vazio">
            Nenhuma meta cadastrada. Os indicadores seguem com os alvos de base: 80% para SLA e
            para entrega de tarefas no prazo.
          </p>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Meta</th>
                  <th>Módulo</th>
                  <th className="num">Alvo</th>
                  <th>Vigência</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(metas.dados ?? []).map((m) => (
                  <tr key={m.id}>
                    <td>{m.nome}</td>
                    <td title={SENTIDO_MODULO[m.modulo]}>{ROTULO_MODULO_META[m.modulo]}</td>
                    <td className="num">{m.alvo_pct.toLocaleString('pt-BR')}%</td>
                    <td>{vigencia(m)}</td>
                    <td>
                      <Etiqueta texto={m.ativo === 1 ? 'Ativa' : 'Inativa'} tom={m.ativo === 1 ? 'bom' : 'neutro'} />
                    </td>
                    <td>
                      {podeEditar && (
                        <button type="button" className="botao discreto pequeno" onClick={() => alternar(m)}>
                          {m.ativo === 1 ? 'Desativar' : 'Reativar'}
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
          <FormularioNovo
            rotulo="Cadastrar meta"
            campos={[
              { chave: 'nome', rotulo: 'Nome', obrigatorio: true, largura: 200 },
              {
                chave: 'modulo',
                rotulo: 'Módulo',
                obrigatorio: true,
                tipo: 'select',
                largura: 190,
                opcoes: (Object.keys(ROTULO_MODULO_META) as Meta['modulo'][]).map((k) => ({
                  valor: k,
                  rotulo: ROTULO_MODULO_META[k],
                })),
              },
              { chave: 'alvo_pct', rotulo: 'Alvo (%)', obrigatorio: true, tipo: 'numero', minimo: 0, maximo: 100, largura: 100 },
              { chave: 'vigencia_inicio', rotulo: 'Vigência de', tipo: 'competencia', largura: 110, dica: 'em branco: desde sempre' },
              { chave: 'vigencia_fim', rotulo: 'até', tipo: 'competencia', largura: 110, dica: 'em branco: sem fim' },
            ]}
            aoEnviar={criar}
          />
        )}

        <p className="dica-filtro" style={{ marginTop: 10 }}>
          A vigência decide qual meta rege qual mês: trocar o alvo em janeiro não reescreve a leitura
          dos meses já fechados. Entre duas vigentes ganha a de início mais recente, e a meta sem
          início é o alvo genérico — vale onde nenhum específico alcança.
        </p>
      </Cartao>
    </>
  );
}

/**
 * Endereço base do helpdesk. O id do chamado completa a URL, e é isso que faz o
 * número na tela de SLA virar link de volta para o sistema de origem.
 */
function EnderecoHelpdesk({ podeEditar }: { podeEditar: boolean }) {
  const { empresa } = useSessao();
  // O endereço é desta unidade — cada uma pode ter instância própria do
  // helpdesk. Sem endereço aqui, vale o configurado para o cliente em
  // Integrações.
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

/**
 * O formulário de um cadastro.
 *
 * Nasceu só com texto, porque os cadastros de então eram só nome. Metas e SLAs
 * trouxeram número, escolha fechada e competência — daí o `tipo` por campo, em
 * vez de um formulário próprio para cada um: a diferença entre eles é o tipo
 * de três caixas, e não o comportamento.
 */
interface CampoCadastro {
  chave: string;
  rotulo: string;
  obrigatorio?: boolean;
  tipo?: 'texto' | 'numero' | 'select' | 'competencia';
  opcoes?: Array<{ valor: string; rotulo: string }>;
  dica?: string;
  minimo?: number;
  maximo?: number;
  largura?: number;
}

function FormularioNovo({
  rotulo,
  campos,
  aoEnviar,
}: {
  rotulo: string;
  campos: CampoCadastro[];
  aoEnviar: (dados: Record<string, string>) => Promise<void>;
}) {
  const [valores, setValores] = useState<Record<string, string>>({});
  const alterar = (chave: string, valor: string) => setValores((v) => ({ ...v, [chave]: valor }));
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
        <Campo key={c.chave} rotulo={c.rotulo} dica={c.dica}>
          {c.tipo === 'select' ? (
            <select
              value={valores[c.chave] ?? ''}
              onChange={(e) => alterar(c.chave, e.target.value)}
              required={c.obrigatorio}
              style={c.largura ? { width: c.largura } : undefined}
            >
              <option value="">—</option>
              {(c.opcoes ?? []).map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={c.tipo === 'numero' ? 'number' : 'text'}
              inputMode={c.tipo === 'competencia' ? 'numeric' : undefined}
              placeholder={c.tipo === 'competencia' ? 'MM/AAAA' : undefined}
              min={c.minimo}
              max={c.maximo}
              step={c.tipo === 'numero' ? '0.1' : undefined}
              value={valores[c.chave] ?? ''}
              onChange={(e) => alterar(c.chave, e.target.value)}
              required={c.obrigatorio}
              style={c.largura ? { width: c.largura } : undefined}
            />
          )}
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

const ENTIDADES = ['lancamento', 'projeto', 'tarefa', 'ticket_sla', 'fechamento', 'importacao', 'filial', 'tipo_despesa', 'meta'];

export function PaginaAuditoria() {
  const { empresas } = useSessao();
  // Filtro LOCAL: a trilha é do cliente, e quem audita procura um registro sem
  // saber de antemão em qual unidade ele foi alterado.
  const escopo = useFiltroEscopo('auditoria');
  const [entidade, setEntidade] = useState('');
  const consulta = useDados<RegistroAuditoria[]>(
    () =>
      api.get('/api/auditoria', {
        entidade: entidade || undefined,
        empresas: escopo.params.empresas,
        limite: 200,
      }),
    [escopo.params.empresas, entidade],
  );

  return (
    <>
      <div className="barra-filtros">
        <FiltroUnidades
          empresas={empresas}
          empresasSel={escopo.empresas}
          aoMudarEmpresas={escopo.definirEmpresas}
          aoLimpar={escopo.limpar}
        />
        <Filtro
          rotulo="Entidade"
          explicacao="Restringe a trilha a um tipo de registro (lançamento, projeto, chamado…). Vazio traz todos."
        >
          <select value={entidade} onChange={(e) => setEntidade(e.target.value)}>
            <option value="">Todas</option>
            {ENTIDADES.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </Filtro>
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
