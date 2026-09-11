import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { Aviso, Campo, Carregando, Cartao, ConfirmarAcao, Etiqueta, Modal } from '../components/base';
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
  const { empresa, filialId, paramFilial, filiais, ehGestor } = useSessao();
  const [filtros, setFiltros] = useState({
    competencia_inicio: '',
    competencia_fim: '',
    natureza: '',
    classificacao: '',
    tipo_despesa_id: '',
    busca: '',
    cenario: 'oficial',
  });
  const [novoAberto, setNovoAberto] = useState(false);
  const [reclassificar, setReclassificar] = useState<Lancamento | null>(null);
  const [excluir, setExcluir] = useState<Lancamento | null>(null);
  const [serie, setSerie] = useState<Lancamento[] | null>(null);

  const tipos = useDados<TipoDespesa[]>(() => api.get('/api/tipos-despesa'), [empresa?.id]);
  const consulta = useDados<Pagina>(
    () =>
      api.get('/api/lancamentos', {
        filial_id: paramFilial(),
        limite: 300,
        ...Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== '')),
      }),
    [empresa?.id, filialId, JSON.stringify(filtros)],
  );

  const atualizar = (chave: string, valor: string) => setFiltros((f) => ({ ...f, [chave]: valor }));

  return (
    <>
      <div className="barra-filtros">
        <Campo rotulo="De (MM/AAAA)">
          <input
            value={filtros.competencia_inicio}
            onChange={(e) => atualizar('competencia_inicio', e.target.value)}
            placeholder="01/2026"
            style={{ width: 100 }}
          />
        </Campo>
        <Campo rotulo="Até (MM/AAAA)">
          <input
            value={filtros.competencia_fim}
            onChange={(e) => atualizar('competencia_fim', e.target.value)}
            placeholder="12/2026"
            style={{ width: 100 }}
          />
        </Campo>
        <Campo rotulo="Tipo de despesa">
          <select value={filtros.tipo_despesa_id} onChange={(e) => atualizar('tipo_despesa_id', e.target.value)}>
            <option value="">Todos</option>
            {(tipos.dados ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Natureza">
          <select value={filtros.natureza} onChange={(e) => atualizar('natureza', e.target.value)}>
            <option value="">Todas</option>
            {NATUREZAS.map((n) => (
              <option key={n} value={n}>
                {ROTULO_NATUREZA[n]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Classificação">
          <select value={filtros.classificacao} onChange={(e) => atualizar('classificacao', e.target.value)}>
            <option value="">Todas</option>
            <option value="despesa">Despesa</option>
            <option value="investimento">Investimento</option>
          </select>
        </Campo>
        <Campo rotulo="Cenário">
          <select value={filtros.cenario} onChange={(e) => atualizar('cenario', e.target.value)}>
            <option value="oficial">Oficial</option>
            <option value="todos">Todos os cenários</option>
          </select>
        </Campo>
        <Campo rotulo="Buscar">
          <input value={filtros.busca} onChange={(e) => atualizar('busca', e.target.value)} placeholder="fornecedor, motivo…" />
        </Campo>
        {ehGestor && (
          <button type="button" className="botao primario" onClick={() => setNovoAberto(true)} style={{ marginLeft: 'auto' }}>
            Novo lançamento
          </button>
        )}
      </div>

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
                      {ehGestor && (
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
        tipos={tipos.dados ?? []}
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
  tipos,
  filiais,
  aoSalvar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  tipos: TipoDespesa[];
  filiais: Array<{ id: number; nome: string }>;
  aoSalvar: () => void;
}) {
  const vazio = {
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

  const submeter = async (evento: FormEvent) => {
    evento.preventDefault();
    if (!competenciaValida(form.competencia)) return setErro('Competência deve estar no formato MM/AAAA.');
    setEnviando(true);
    setErro(null);
    try {
      await api.post('/api/lancamentos', {
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
          <Campo rotulo="Filial" dica="Vazio = nível empresa">
            <select value={form.filial_id} onChange={(e) => alterar('filial_id', e.target.value)}>
              <option value="">— empresa —</option>
              {filiais.map((f) => (
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
