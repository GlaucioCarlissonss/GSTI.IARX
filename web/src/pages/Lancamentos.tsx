import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { useFiltroEscopo } from '../lib/filtros';
import { EXPLICACAO, FichasUnidades, Filtro, FiltroUnidades } from '../components/filtro-escopo';
import { Aviso, Campo, Carregando, Cartao, ConfirmarAcao, Etiqueta, Modal } from '../components/base';
import { FichasSelecao, SeletorMulti } from '../components/seletor-multi';
import { competenciaAtual, competenciaValida, inteiro, moeda, ROTULO_NATUREZA } from '../lib/formato';

interface Lancamento {
  id: number;
  filial_id: number | null;
  filial_nome: string | null;
  tipo_despesa_id: number;
  tipo_despesa: string;
  competencia: string;
  valor: number;
  natureza: string;
  classificacao: string;
  qtd_parcelas: number | null;
  parcela_numero: number | null;
  grupo_id: number;
  cenario: string;
  origem: string;
  origem_rotulo: string;
  descricao: string | null;
  observacoes: string | null;
}

interface Pagina {
  total: number;
  total_valor: number;
  itens: Lancamento[];
}

interface Cenario {
  chave: string;
  nome: string;
}

interface TipoDespesa {
  id: number;
  nome: string;
}

const NATUREZAS = ['fixa', 'pontual_unica', 'pontual_parcelada'] as const;

/**
 * Procedência do lançamento. O total do sistema soma, às linhas das planilhas
 * enviadas, a folha de TI rateada e a projeção do ERP — mostrar a origem é o
 * que permite conferir cada parcela em vez de discutir o número final.
 */
const COR_ORIGEM: Record<string, string> = {
  planilha: 'var(--serie-1)',
  folha_ti: 'var(--serie-2)',
  projecao_spincare: 'var(--serie-3)',
  manual: 'var(--tinta-fraca)',
};
const ORIGEM_CURTA: Record<string, string> = {
  planilha: 'Planilha',
  folha_ti: 'Folha',
  projecao_spincare: 'Projeção',
  manual: 'Manual',
};

export function PaginaLancamentos() {
  const { empresa, empresas, filiais, pode } = useSessao();
  // Filtro LOCAL desta tela.
  const escopo = useFiltroEscopo('lancamentos');
  // A unidade que o formulário de criação abre marcada: a única do filtro, se
  // houver uma só, ou a matriz em foco. Sugestão, não amarra — o formulário
  // deixa trocar.
  const empresaEmFoco = escopo.empresas.length === 1 ? escopo.empresas[0]! : (empresa?.id ?? null);
  // O perfil governa o que a tela oferece; quem recusa de fato é o servidor.
  const podeEditar = pode('financeiro', 'create');
  // Cada dimensão guarda uma lista: a API aceita valores separados por vírgula.
  const [filtros, setFiltros] = useState<{
    competencia_inicio: string;
    competencia_fim: string;
    naturezas: string[];
    classificacoes: string[];
    tipos: string[];
    cenarios: string[];
    busca: string;
  }>({
    competencia_inicio: '',
    competencia_fim: '',
    naturezas: [],
    classificacoes: [],
    tipos: [],
    cenarios: ['oficial'],
    busca: '',
  });
  const [novoAberto, setNovoAberto] = useState(false);
  const [reclassificar, setReclassificar] = useState<Lancamento | null>(null);
  const [excluir, setExcluir] = useState<Lancamento | null>(null);
  const [serie, setSerie] = useState<Lancamento[] | null>(null);

  // Os tipos do FILTRO: do cliente inteiro não existe — o catálogo é por
  // unidade —, então valem os da unidade em foco, que é o catálogo que o gestor
  // reconhece. A criação usa o da unidade escolhida no formulário.
  const tipos = useDados<TipoDespesa[]>(() => api.get('/api/tipos-despesa'), [empresa?.id]);
  const cenarios = useDados<Cenario[]>(
    () => api.get('/api/lancamentos/cenarios/lista', { empresas: escopo.params.empresas }),
    [escopo.params.empresas],
  );
  const consulta = useDados<Pagina>(
    () =>
      api.get('/api/lancamentos', {
        empresas: escopo.params.empresas,
        filial_id: escopo.params.filial_id,
        limite: 300,
        competencia_inicio: filtros.competencia_inicio || undefined,
        competencia_fim: filtros.competencia_fim || undefined,
        busca: filtros.busca || undefined,
        natureza: filtros.naturezas.join(',') || undefined,
        classificacao: filtros.classificacoes.join(',') || undefined,
        tipo_despesa_id: filtros.tipos.join(',') || undefined,
        cenario: filtros.cenarios.join(',') || undefined,
      }),
    [escopo.params.empresas, escopo.params.filial_id, JSON.stringify(filtros)],
  );

  const atualizar = (chave: string, valor: string) => setFiltros((f) => ({ ...f, [chave]: valor }));
  const definirLista = (chave: 'naturezas' | 'classificacoes' | 'tipos' | 'cenarios') => (valores: string[]) =>
    setFiltros((f) => ({ ...f, [chave]: valores }));

  const itensTipo = (tipos.dados ?? []).map((t) => ({ valor: String(t.id), rotulo: t.nome }));
  const itensNatureza = NATUREZAS.map((n) => ({ valor: n, rotulo: ROTULO_NATUREZA[n] ?? n }));
  const itensClassificacao = [
    { valor: 'despesa', rotulo: 'Despesa' },
    { valor: 'investimento', rotulo: 'Investimento' },
  ];
  const itensCenario = [
    { valor: 'oficial', rotulo: 'Oficial' },
    ...(cenarios.dados ?? []).filter((c) => c.chave !== 'oficial').map((c) => ({ valor: c.chave, rotulo: c.nome })),
  ];

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
        <Filtro rotulo="De (MM/AAAA)" explicacao={EXPLICACAO.competenciaIntervalo}>
          <input
            value={filtros.competencia_inicio}
            onChange={(e) => atualizar('competencia_inicio', e.target.value)}
            placeholder="01/2026"
            style={{ width: 100 }}
          />
        </Filtro>
        <Filtro rotulo="Até (MM/AAAA)" explicacao={EXPLICACAO.competenciaIntervalo}>
          <input
            value={filtros.competencia_fim}
            onChange={(e) => atualizar('competencia_fim', e.target.value)}
            placeholder="12/2026"
            style={{ width: 100 }}
          />
        </Filtro>
        <Filtro rotulo="Tipo de despesa" explicacao={EXPLICACAO.tipoDespesa}>
          <SeletorMulti rotulo="Tipo de despesa" itens={itensTipo} selecionados={filtros.tipos}
            aoMudar={definirLista('tipos')} largura={180} />
        </Filtro>
        <Filtro rotulo="Natureza" explicacao="Separa despesa fixa recorrente, pontual única e parcelada. Vazio traz as três.">
          <SeletorMulti rotulo="Natureza" itens={itensNatureza} selecionados={filtros.naturezas}
            aoMudar={definirLista('naturezas')} largura={160} />
        </Filtro>
        <Filtro rotulo="Classificação" explicacao="Separa custeio (despesa) de investimento. Vazio traz os dois.">
          <SeletorMulti rotulo="Classificação" itens={itensClassificacao} selecionados={filtros.classificacoes}
            aoMudar={definirLista('classificacoes')} largura={150} />
        </Filtro>
        <Filtro rotulo="Cenário" explicacao={EXPLICACAO.cenario}>
          <SeletorMulti rotulo="Cenário" itens={itensCenario} selecionados={filtros.cenarios}
            aoMudar={definirLista('cenarios')} minimo={1} largura={170}
            aviso="Cenários são alternativas: marcar vários soma linhas que representam a mesma despesa." />
        </Filtro>
        <Filtro rotulo="Buscar" explicacao={EXPLICACAO.busca}>
          <input value={filtros.busca} onChange={(e) => atualizar('busca', e.target.value)} placeholder="fornecedor, motivo…" />
        </Filtro>
        {podeEditar && (
          <button type="button" className="botao primario" onClick={() => setNovoAberto(true)} style={{ marginLeft: 'auto' }}>
            Novo lançamento
          </button>
        )}
      </div>

      <FichasUnidades
        empresas={empresas}
        empresasSel={escopo.empresas}
        aoMudarEmpresas={escopo.definirEmpresas}
        filiais={filiais}
        filiaisSel={escopo.filiais}
        aoMudarFiliais={escopo.definirFiliais}
      />

      <FichasSelecao
        grupos={[
          { chave:'tipos', rotulo:'Tipo', itens:itensTipo, selecionados:filtros.tipos, aoMudar:definirLista('tipos') },
          { chave:'nat', rotulo:'Natureza', itens:itensNatureza, selecionados:filtros.naturezas, aoMudar:definirLista('naturezas') },
          { chave:'cls', rotulo:'Classificação', itens:itensClassificacao, selecionados:filtros.classificacoes, aoMudar:definirLista('classificacoes') },
          { chave:'cen', rotulo:'Cenário', itens:itensCenario, selecionados:filtros.cenarios, minimo:1, aoMudar:definirLista('cenarios') },
        ]}
      />

      {consulta.erro && <Aviso tipo="erro">{consulta.erro}</Aviso>}

      <Cartao
        titulo="Lançamentos"
        descricao={
          consulta.dados
            ? `${inteiro(consulta.dados.total)} registros · ${moeda(consulta.dados.total_valor)}`
            : undefined
        }
      >
        {!consulta.dados ? (
          <Carregando />
        ) : consulta.dados.itens.length === 0 ? (
          <p className="vazio">Nenhum lançamento com os filtros aplicados.</p>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Competência</th>
                  <th>Filial</th>
                  <th>Tipo de despesa</th>
                  <th>Descrição</th>
                  <th>Origem</th>
                  <th>Natureza</th>
                  <th>Classificação</th>
                  <th className="num">Valor</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {consulta.dados.itens.map((l) => (
                  <tr key={l.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{l.competencia}</td>
                    <td>{l.filial_nome ?? <em style={{ color: 'var(--tinta-fraca)' }}>empresa</em>}</td>
                    <td>{l.tipo_despesa}</td>
                    <td style={{ maxWidth: 320 }}>
                      {l.descricao}
                      {l.observacoes && (
                        <div style={{ color: 'var(--tinta-fraca)', fontSize: 12 }}>{l.observacoes}</div>
                      )}
                      {l.cenario !== 'oficial' && (
                        <div style={{ marginTop: 3 }}>
                          <Etiqueta texto={`cenário: ${l.cenario}`} tom="atencao" />
                        </div>
                      )}
                    </td>
                    <td title={l.origem_rotulo}>
                      <Etiqueta
                        texto={ORIGEM_CURTA[l.origem] ?? l.origem_rotulo ?? l.origem}
                        cor={COR_ORIGEM[l.origem] ?? 'var(--tinta-fraca)'}
                      />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {ROTULO_NATUREZA[l.natureza] ?? l.natureza}
                      {l.parcela_numero && (
                        <div style={{ color: 'var(--tinta-fraca)', fontSize: 12 }}>
                          parcela {l.parcela_numero}/{l.qtd_parcelas}
                        </div>
                      )}
                    </td>
                    <td>
                      <Etiqueta
                        texto={l.classificacao === 'investimento' ? 'Investimento' : 'Despesa'}
                        cor={l.classificacao === 'investimento' ? 'var(--serie-2)' : 'var(--serie-1)'}
                      />
                    </td>
                    <td className="num">{moeda(l.valor)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="botao discreto pequeno"
                        onClick={() => api.get<Lancamento[]>(`/api/lancamentos/${l.id}/serie`).then(setSerie)}
                      >
                        Série
                      </button>
                      {podeEditar && (
                        <>
                          <button type="button" className="botao discreto pequeno" onClick={() => setReclassificar(l)}>
                            Reclassificar
                          </button>
                          <button type="button" className="botao discreto pequeno" onClick={() => setExcluir(l)}>
                            Excluir
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7}>Total exibido</td>
                  <td className="num">{moeda(consulta.dados.itens.reduce((s, l) => s + l.valor, 0))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Cartao>

      <FormularioLancamento
        aberto={novoAberto}
        aoFechar={() => setNovoAberto(false)}
        empresas={empresas}
        empresaPadrao={empresaEmFoco}
        filiais={filiais}
        aoSalvar={consulta.recarregar}
      />

      <Modal titulo="Série do lançamento" aberto={serie !== null} aoFechar={() => setSerie(null)}>
        <div className="tabela-envolucro">
          <table>
            <thead>
              <tr>
                <th>Competência</th>
                <th>Parcela</th>
                <th>Classificação</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {(serie ?? []).map((p) => (
                <tr key={p.id}>
                  <td>{p.competencia}</td>
                  <td>{p.parcela_numero ? `${p.parcela_numero}/${p.qtd_parcelas}` : '—'}</td>
                  <td>{p.classificacao}</td>
                  <td className="num">{moeda(p.valor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total da série</td>
                <td className="num">{moeda((serie ?? []).reduce((s, p) => s + p.valor, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Modal>

      <ConfirmarAcao
        titulo="Reclassificar lançamento"
        aberto={reclassificar !== null}
        aoFechar={() => setReclassificar(null)}
        rotuloConfirmar={reclassificar?.classificacao === 'despesa' ? 'Marcar como investimento' : 'Marcar como despesa'}
        mensagem={
          <>
            {reclassificar?.tipo_despesa} — {reclassificar?.competencia} ({moeda(reclassificar?.valor ?? 0)}).
            <br />
            Passa de <strong>{reclassificar?.classificacao}</strong> para{' '}
            <strong>{reclassificar?.classificacao === 'despesa' ? 'investimento' : 'despesa'}</strong>. A mudança
            alcança as parcelas futuras da mesma série. Competências futuras dispensam justificativa; passadas e a
            corrente exigem.
          </>
        }
        aoConfirmar={async (justificativa) => {
          await api.post(`/api/lancamentos/${reclassificar!.id}/reclassificar`, {
            classificacao: reclassificar!.classificacao === 'despesa' ? 'investimento' : 'despesa',
            justificativa: justificativa || undefined,
          });
          consulta.recarregar();
        }}
      />

      <ConfirmarAcao
        titulo="Excluir lançamento"
        aberto={excluir !== null}
        exigirJustificativa
        rotuloConfirmar="Excluir"
        aoFechar={() => setExcluir(null)}
        mensagem={
          <>
            A exclusão é lógica e fica registrada na auditoria. Excluir um lançamento de origem remove também as
            parcelas projetadas dele.
          </>
        }
        aoConfirmar={async (justificativa) => {
          await api.remover(`/api/lancamentos/${excluir!.id}`, { justificativa });
          consulta.recarregar();
        }}
      />
    </>
  );
}

function FormularioLancamento({
  aberto,
  aoFechar,
  empresas,
  empresaPadrao,
  filiais,
  aoSalvar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  empresas: Array<{ id: number; nome: string }>;
  empresaPadrao: number | null;
  /** Todas as filiais do cliente; o formulário mostra as da unidade escolhida. */
  filiais: Array<{ id: number; nome: string; empresa_id?: number }>;
  aoSalvar: () => void;
}) {
  const vazio = {
    empresa_id: empresaPadrao ? String(empresaPadrao) : '',
    filial_id: '',
    tipo_despesa_id: '',
    competencia: competenciaAtual(),
    valor: '',
    natureza: 'pontual_unica',
    classificacao: 'despesa',
    qtd_parcelas: '',
    valor_refere_se: 'total',
    repetir_ate: '',
    descricao: '',
    observacoes: '',
    justificativa: '',
  };
  const [form, setForm] = useState(vazio);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const alterar = (chave: string, valor: string) => setForm((f) => ({ ...f, [chave]: valor }));

  // Filial e tipo de despesa são da unidade escolhida no formulário: oferecer
  // os da unidade errada faria o servidor recusar o que a tela ofereceu.
  const unidade = form.empresa_id ? Number(form.empresa_id) : null;
  const filiaisDaUnidade = filiais.filter((f) => f.empresa_id === undefined || f.empresa_id === unidade);
  const tiposDaUnidade = useDados<TipoDespesa[]>(
    () => api.get('/api/tipos-despesa', { empresas: unidade ?? undefined }),
    [unidade],
  );
  const tipos = tiposDaUnidade.dados ?? [];

  const submeter = async (evento: FormEvent) => {
    evento.preventDefault();
    if (!competenciaValida(form.competencia)) return setErro('Competência deve estar no formato MM/AAAA.');
    setEnviando(true);
    setErro(null);
    try {
      await api.post('/api/lancamentos', {
        // A unidade sai DAQUI, e não de um filtro: registrar nunca depende do
        // recorte que a tela está mostrando.
        empresa_id: form.empresa_id ? Number(form.empresa_id) : undefined,
        filial_id: form.filial_id ? Number(form.filial_id) : null,
        tipo_despesa_id: Number(form.tipo_despesa_id),
        competencia: form.competencia,
        valor: form.valor,
        natureza: form.natureza,
        classificacao: form.classificacao,
        qtd_parcelas: form.natureza === 'pontual_parcelada' ? Number(form.qtd_parcelas) : null,
        valor_refere_se: form.valor_refere_se,
        repetir_ate: form.natureza === 'fixa' && form.repetir_ate ? form.repetir_ate : null,
        descricao: form.descricao || null,
        observacoes: form.observacoes || null,
        justificativa: form.justificativa || null,
      });
      setForm(vazio);
      aoSalvar();
      aoFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal titulo="Novo lançamento" aberto={aberto} aoFechar={aoFechar}>
      <form onSubmit={submeter} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="grade c3">
          {empresas.length > 1 && (
            <Campo rotulo="Empresa (matriz)" dica="Onde o lançamento vai nascer. Independe do filtro da tela.">
              <select
                value={form.empresa_id}
                onChange={(e) => setForm((f) => ({ ...f, empresa_id: e.target.value, filial_id: '' }))}
                required
              >
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </select>
            </Campo>
          )}
          <Campo rotulo="Filial" dica="Vazio = nível da matriz">
            <select value={form.filial_id} onChange={(e) => alterar('filial_id', e.target.value)}>
              <option value="">— matriz —</option>
              {filiaisDaUnidade.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Tipo de despesa">
            <select value={form.tipo_despesa_id} onChange={(e) => alterar('tipo_despesa_id', e.target.value)} required>
              <option value="">Selecione…</option>
              {tipos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Competência (MM/AAAA)">
            <input value={form.competencia} onChange={(e) => alterar('competencia', e.target.value)} required />
          </Campo>
        </div>

        <div className="grade c3">
          <Campo rotulo="Valor (R$)">
            <input value={form.valor} onChange={(e) => alterar('valor', e.target.value)} placeholder="1.234,56" required />
          </Campo>
          <Campo rotulo="Natureza">
            <select value={form.natureza} onChange={(e) => alterar('natureza', e.target.value)}>
              {NATUREZAS.map((n) => (
                <option key={n} value={n}>
                  {ROTULO_NATUREZA[n]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Classificação">
            <select value={form.classificacao} onChange={(e) => alterar('classificacao', e.target.value)}>
              <option value="despesa">Despesa</option>
              <option value="investimento">Investimento</option>
            </select>
          </Campo>
        </div>

        {form.natureza === 'pontual_parcelada' && (
          <div className="grade c2">
            <Campo rotulo="Quantidade de parcelas">
              <input
                type="number"
                min={2}
                value={form.qtd_parcelas}
                onChange={(e) => alterar('qtd_parcelas', e.target.value)}
                required
              />
            </Campo>
            <Campo rotulo="O valor informado é">
              <select value={form.valor_refere_se} onChange={(e) => alterar('valor_refere_se', e.target.value)}>
                <option value="total">o total do contrato (rateado nas parcelas)</option>
                <option value="parcela">o valor de cada parcela</option>
              </select>
            </Campo>
          </div>
        )}

        {form.natureza === 'fixa' && (
          <Campo rotulo="Repetir mensalmente até (MM/AAAA)" dica="Opcional — gera uma ocorrência por mês">
            <input value={form.repetir_ate} onChange={(e) => alterar('repetir_ate', e.target.value)} placeholder="12/2027" />
          </Campo>
        )}

        <Campo rotulo="Descrição">
          <input value={form.descricao} onChange={(e) => alterar('descricao', e.target.value)} placeholder="Fornecedor / contrato" />
        </Campo>
        <Campo rotulo="Observações">
          <textarea value={form.observacoes} onChange={(e) => alterar('observacoes', e.target.value)} />
        </Campo>
        <Campo rotulo="Justificativa" dica="Obrigatória para competências passadas">
          <input value={form.justificativa} onChange={(e) => alterar('justificativa', e.target.value)} />
        </Campo>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="acoes">
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="botao primario" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar lançamento'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
