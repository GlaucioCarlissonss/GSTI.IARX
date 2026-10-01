import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { useFiltroEscopo } from '../lib/filtros';
import { Filtro, FiltroUnidades, SeletorUnidadeFoco } from '../components/filtro-escopo';
import { Aviso, Campo, Carregando, Cartao, ConfirmarAcao, Etiqueta } from '../components/base';
import { competenciaAtual, competenciaExib, competenciaValida, dataHora, inteiro, moeda } from '../lib/formato';

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

// ==========================================================================
// Acordos de SLA
// ==========================================================================

interface AcordoSla {
  id: number;
  topico_ajuda_id: number | null;
  topico: string | null;
  prioridade: 'low' | 'medium' | 'high' | 'urgent';
  horas: number;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  ativo: number;
}

/** O resumo que a reaplicação devolve — os mesmos nomes do servidor. */
interface ResumoReaplicacao {
  competencia: string;
  avaliados: number;
  alterados: number;
  virou_dentro: number;
  virou_fora: number;
  sem_prioridade: number;
  sem_acordo: number;
  agregados_ignorados: number;
}

/** "de 01/03/2026 a 31/03/2026" — a vigência em texto, com pontas abertas. */
function periodoEmTexto(inicio: string | null, fim: string | null): string {
  const br = (d: string) => d.split('-').reverse().join('/');
  if (!inicio && !fim) return 'sem vigência definida';
  if (!inicio) return `até ${br(fim!)}`;
  if (!fim) return `a partir de ${br(inicio)}`;
  return `de ${br(inicio)} a ${br(fim)}`;
}

const ROTULO_PRIORIDADE_SLA: Record<AcordoSla['prioridade'], string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente',
};

/**
 * Cadastro de acordos de SLA — quantas horas um chamado tem para ser atendido.
 *
 * É de UNIDADE, e por isso traz o seletor de unidade em foco: a hora de
 * atendimento de um hospital não é a do outro.
 */
export function PaginaSlas() {
  const { empresa, empresas, trocarEmpresa, pode } = useSessao();
  const podeEditar = pode('configuracoes', 'edit');
  const [erro, setErro] = useState<string | null>(null);
  const acordos = useDados<AcordoSla[]>(
    () => api.get('/api/slas', { empresas: empresa?.id, incluir_inativos: true }),
    [empresa?.id],
  );
  const topicos = useDados<ItemCadastro[]>(
    () => api.get('/api/topicos-ajuda', { empresas: empresa?.id }),
    [empresa?.id],
  );

  const criar = async (dados: Record<string, string>) => {
    setErro(null);
    try {
      await api.post('/api/slas', { ...dados, empresas: empresa?.id });
      acordos.recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao cadastrar o acordo.');
    }
  };

  const alternar = async (a: AcordoSla) => {
    setErro(null);
    try {
      await api.patch(`/api/slas/${a.id}`, { ativo: a.ativo !== 1 });
      acordos.recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao atualizar o acordo.');
    }
  };

  // ---------------------------------------------- aplicar ao que já existe
  //
  // O acordo decide o prazo na ENTRADA do chamado. Alcançar o que já está
  // gravado é um ATO: escolhe-se o mês, vê-se o que mudaria e só então se
  // aplica. É o mesmo desenho da limpeza de base, e pela mesma razão —
  // "recalcular 412 chamados, 37 saem de dentro para fora" é uma decisão;
  // "recalcular" sozinho é um susto.
  const [competencia, setCompetencia] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [resumo, setResumo] = useState<{ dados: ResumoReaplicacao; aplicado: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const reaplicar = async (aplicar: boolean) => {
    setErro(null);
    setOcupado(true);
    try {
      // A unidade vai na QUERY também no POST: é de lá que `unidade(req)` a
      // lê, e o acordo é da unidade em foco.
      const dados = aplicar
        ? await api.post<ResumoReaplicacao>(`/api/slas/reaplicacao?empresas=${empresa?.id ?? ''}`, {
            competencia,
            justificativa,
          })
        : await api.get<ResumoReaplicacao>('/api/slas/reaplicacao', {
            empresas: empresa?.id,
            competencia,
          });
      setResumo({ dados, aplicado: aplicar });
    } catch (e) {
      setResumo(null);
      setErro(e instanceof Error ? e.message : 'Falha ao aplicar o acordo.');
    }
    setOcupado(false);
  };

  return (
    <>
      <div className="barra-filtros">
        <SeletorUnidadeFoco
          empresas={empresas}
          empresaId={empresa?.id ?? null}
          aoTrocar={trocarEmpresa}
          explicacao="Os acordos abaixo valem para os chamados desta unidade."
        />
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Cartao
        titulo="Acordos de SLA"
        descricao="Quantas horas um chamado tem, por tópico de ajuda e prioridade"
      >
        {acordos.carregando ? (
          <Carregando />
        ) : (acordos.dados ?? []).length === 0 ? (
          <p className="vazio">
            Nenhum acordo cadastrado. O prazo continua vindo do helpdesk de origem; onde ele não
            informa prazo, o chamado fechado conta como dentro e o aberto, como fora.
          </p>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Tópico de ajuda</th>
                  <th>Prioridade</th>
                  <th className="num">Horas</th>
                  <th>Vigência</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(acordos.dados ?? []).map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.topico ?? (
                        <em style={{ color: 'var(--tinta-fraca)' }}>regra geral desta prioridade</em>
                      )}
                    </td>
                    <td>{ROTULO_PRIORIDADE_SLA[a.prioridade]}</td>
                    <td className="num">{a.horas.toLocaleString('pt-BR')} h</td>
                    <td>{periodoEmTexto(a.vigencia_inicio, a.vigencia_fim)}</td>
                    <td>
                      <Etiqueta texto={a.ativo === 1 ? 'Ativo' : 'Inativo'} tom={a.ativo === 1 ? 'bom' : 'neutro'} />
                    </td>
                    <td>
                      {podeEditar && (
                        <button type="button" className="botao discreto pequeno" onClick={() => alternar(a)}>
                          {a.ativo === 1 ? 'Desativar' : 'Reativar'}
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
            rotulo="Cadastrar acordo"
            campos={[
              {
                chave: 'topico_ajuda_id',
                rotulo: 'Tópico de ajuda',
                tipo: 'select',
                largura: 200,
                dica: 'em branco: regra geral',
                opcoes: (topicos.dados ?? []).map((t) => ({ valor: String(t.id), rotulo: t.nome })),
              },
              {
                chave: 'prioridade',
                rotulo: 'Prioridade',
                obrigatorio: true,
                tipo: 'select',
                largura: 130,
                opcoes: (Object.keys(ROTULO_PRIORIDADE_SLA) as AcordoSla['prioridade'][]).map((k) => ({
                  valor: k,
                  rotulo: ROTULO_PRIORIDADE_SLA[k],
                })),
              },
              { chave: 'horas', rotulo: 'Horas', obrigatorio: true, tipo: 'numero', minimo: 0, largura: 100 },
              { chave: 'vigencia_inicio', rotulo: 'Vigência de', tipo: 'data', largura: 150, dica: 'em branco: desde sempre' },
              { chave: 'vigencia_fim', rotulo: 'até', tipo: 'data', largura: 150, dica: 'em branco: sem fim' },
            ]}
            aoEnviar={criar}
          />
        )}

        <p className="dica-filtro" style={{ marginTop: 10 }}>
          O acordo do tópico ganha do geral, e o acordo cadastrado ganha do prazo que o helpdesk
          informou — o da origem fica guardado e aparece na ficha do chamado. Quem escolhe qual
          acordo vale é a data de ABERTURA do chamado, e por isso dois acordos para a mesma
          prioridade convivem enquanto os períodos não se sobrepõem. São horas corridas: o sistema
          não tem calendário de expediente, e inventar um criaria um prazo que nenhum contrato
          assinou. Chamado já gravado só muda pela reaplicação abaixo.
        </p>
      </Cartao>

      <Cartao
        titulo="Aplicar o acordo a uma competência"
        descricao="Alcança o chamado que já está gravado — a base carregada por planilha, por exemplo"
      >
        <p className="dica-filtro">
          O acordo decide o prazo na entrada do chamado. Aqui ele alcança o que já existe: escolha o
          mês, veja o que mudaria e só então aplique. Mês fechado é recusado; mês que já passou exige
          justificativa. Registro agregado e chamado sem prioridade ficam de fora — não há chamado
          individual para medir.
        </p>

        <div className="barra-filtros" style={{ marginTop: 12 }}>
          <Campo rotulo="Competência" dica="MM/AAAA">
            <input
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
              placeholder="MM/AAAA"
              inputMode="numeric"
              style={{ width: 110 }}
            />
          </Campo>
          <Campo rotulo="Justificativa" dica="obrigatória em mês já encerrado">
            <input
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              style={{ width: 280 }}
            />
          </Campo>
          <button
            type="button"
            className="botao discreto"
            disabled={ocupado || !competencia}
            onClick={() => reaplicar(false)}
          >
            Ver o que mudaria
          </button>
          {podeEditar && (
            <button
              type="button"
              className="botao"
              disabled={ocupado || !competencia}
              onClick={() => reaplicar(true)}
            >
              Aplicar
            </button>
          )}
        </div>

        {resumo && (
          <Aviso tipo={resumo.aplicado ? 'ok' : 'info'}>
            <strong>
              {/* A resposta traz a competência interna (AAAA-MM), como o
                  resto da API; quem exibe é a tela, em MM/AAAA. */}
              {resumo.aplicado
                ? `Acordo aplicado a ${competenciaExib(resumo.dados.competencia)}.`
                : `Prévia de ${competenciaExib(resumo.dados.competencia)} — nada foi gravado.`}
            </strong>
            <dl className="ficha" style={{ marginTop: 6 }}>
              <Linha rotulo="Chamados avaliados" valor={inteiro(resumo.dados.avaliados)} />
              <Linha
                rotulo={resumo.aplicado ? 'Alterados' : 'Seriam alterados'}
                valor={inteiro(resumo.dados.alterados)}
              />
              <Linha rotulo="Passaram a contar dentro" valor={inteiro(resumo.dados.virou_dentro)} />
              <Linha rotulo="Passaram a contar fora" valor={inteiro(resumo.dados.virou_fora)} />
              <Linha rotulo="Sem prioridade (intocados)" valor={inteiro(resumo.dados.sem_prioridade)} />
              <Linha rotulo="Sem acordo vigente (intocados)" valor={inteiro(resumo.dados.sem_acordo)} />
              <Linha
                rotulo="Registros agregados (fora da conta)"
                valor={inteiro(resumo.dados.agregados_ignorados)}
              />
            </dl>
          </Aviso>
        )}
      </Cartao>
    </>
  );
}

/** Uma linha rótulo/valor da ficha — o mesmo par usado na ficha do chamado. */
function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <>
      <dt>{rotulo}</dt>
      <dd>{valor}</dd>
    </>
  );
}

// ==========================================================================
// Plano de redução de despesas
// ==========================================================================

interface ItemPlano {
  id: number;
  nome: string;
  tipo_despesa_id: number | null;
  tipo_despesa: string | null;
  filial_id: number | null;
  filial: string | null;
  valor_alvo: number;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  ativo: number;
}

interface TipoDoCliente {
  id: number;
  nome: string;
  empresa_nome: string;
}

interface FilialDoCliente {
  id: number;
  nome: string;
  empresa_nome: string;
}

/**
 * Cadastro do plano de redução: quais despesas serão cortadas, e para quanto.
 *
 * É do CLIENTE, como as metas, e por isso não traz seletor de unidade — o
 * plano de corte é negociado para o grupo. Uma linha por despesa escolhida: é
 * o que permite o par atual → alvo POR despesa, que é a leitura do indicador.
 * Um alvo único cobrindo cinco categorias não teria como mostrar de quanto
 * para quanto cai cada uma.
 */
export function PaginaReducao() {
  const { pode } = useSessao();
  const podeEditar = pode('configuracoes', 'edit');
  const [erro, setErro] = useState<string | null>(null);
  const planos = useDados<ItemPlano[]>(() => api.get('/api/planos-reducao', { incluir_inativos: true }), []);
  // `cliente=true`: o plano atravessa as matrizes, então a lista de escolha
  // também precisa atravessar. O nome da matriz vai no rótulo porque o mesmo
  // tipo de despesa existe em cada uma, com id próprio.
  const tipos = useDados<TipoDoCliente[]>(() => api.get('/api/tipos-despesa', { cliente: true }), []);
  const filiais = useDados<FilialDoCliente[]>(() => api.get('/api/filiais'), []);

  const criar = async (dados: Record<string, string>) => {
    setErro(null);
    try {
      await api.post('/api/planos-reducao', dados);
      planos.recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao cadastrar o item do plano.');
    }
  };

  const alternar = async (p: ItemPlano) => {
    setErro(null);
    try {
      await api.patch(`/api/planos-reducao/${p.id}`, { ativo: p.ativo !== 1 });
      planos.recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao atualizar o item do plano.');
    }
  };

  const vigencia = (p: ItemPlano) => {
    if (!p.vigencia_inicio && !p.vigencia_fim) return 'sempre';
    if (p.vigencia_inicio && !p.vigencia_fim) return `de ${competenciaExib(p.vigencia_inicio)} em diante`;
    if (!p.vigencia_inicio && p.vigencia_fim) return `até ${competenciaExib(p.vigencia_fim)}`;
    return `${competenciaExib(p.vigencia_inicio!)} a ${competenciaExib(p.vigencia_fim!)}`;
  };

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Cartao
        titulo="Plano de redução de despesas"
        descricao="As despesas escolhidas para cair, e para quanto — é o indicador do topo dos Indicadores Gerais"
      >
        {planos.carregando ? (
          <Carregando />
        ) : (planos.dados ?? []).length === 0 ? (
          <p className="vazio">
            Nenhuma despesa no plano. O indicador de redução fica vazio até que ao menos uma seja
            cadastrada aqui — sem alvo não há de quanto para quanto.
          </p>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Despesa</th>
                  <th>Filial</th>
                  <th className="num">Valor-alvo</th>
                  <th>Vigência</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(planos.dados ?? []).map((p) => (
                  <tr key={p.id}>
                    <td>{p.nome}</td>
                    <td>{p.tipo_despesa ?? <em style={{ color: 'var(--tinta-fraca)' }}>toda despesa do recorte</em>}</td>
                    <td>{p.filial ?? <em style={{ color: 'var(--tinta-fraca)' }}>todas</em>}</td>
                    <td className="num">{moeda(p.valor_alvo)}</td>
                    <td>{vigencia(p)}</td>
                    <td>
                      <Etiqueta texto={p.ativo === 1 ? 'Ativo' : 'Inativo'} tom={p.ativo === 1 ? 'bom' : 'neutro'} />
                    </td>
                    <td>
                      {podeEditar && (
                        <button type="button" className="botao discreto pequeno" onClick={() => alternar(p)}>
                          {p.ativo === 1 ? 'Desativar' : 'Reativar'}
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
            rotulo="Adicionar ao plano"
            campos={[
              { chave: 'nome', rotulo: 'Item', obrigatorio: true, largura: 190 },
              {
                chave: 'tipo_despesa_id',
                rotulo: 'Despesa',
                tipo: 'select',
                largura: 230,
                dica: 'em branco: toda despesa do recorte',
                opcoes: (tipos.dados ?? []).map((t) => ({
                  valor: String(t.id),
                  rotulo: `${t.empresa_nome} › ${t.nome}`,
                })),
              },
              {
                chave: 'filial_id',
                rotulo: 'Filial',
                tipo: 'select',
                largura: 200,
                dica: 'em branco: todas',
                opcoes: (filiais.dados ?? []).map((f) => ({
                  valor: String(f.id),
                  rotulo: `${f.empresa_nome} › ${f.nome}`,
                })),
              },
              { chave: 'valor_alvo', rotulo: 'Valor-alvo (R$)', obrigatorio: true, tipo: 'moeda', largura: 130 },
              { chave: 'vigencia_inicio', rotulo: 'Vigência de', tipo: 'competencia', largura: 110, dica: 'em branco: desde sempre' },
              { chave: 'vigencia_fim', rotulo: 'até', tipo: 'competencia', largura: 110, dica: 'em branco: sem fim' },
            ]}
            aoEnviar={criar}
          />
        )}

        <p className="dica-filtro" style={{ marginTop: 10 }}>
          O valor ATUAL de cada item sai dos lançamentos do recorte; o ALVO sai daqui. A vigência
          decide qual alvo rege qual mês — trocar o alvo em janeiro não reescreve a leitura dos
          meses já fechados. O tipo de despesa é cadastrado por matriz, então a lista traz a matriz
          junto do nome.
        </p>
      </Cartao>
    </>
  );
}

/** Uma pessoa da origem cujo lançamento já nasce conferido. */
interface Reconhecedor {
  id: number;
  usuario_origem: string;
  chave: string;
  nome_exibicao: string | null;
  ativo: number;
}

/** O resumo da aplicação retroativa — os mesmos nomes do servidor. */
interface ResumoReconhecimento {
  de: string | null;
  ate: string | null;
  avaliados: number;
  reconhecidos: number;
  ja_reconhecidos: number;
  sem_usuario_origem: number;
  fora_do_cadastro: number;
}

/**
 * QUEM RECONHECE DESPESA — a lista de quem, na origem, lança despesa que já
 * nasce conferida.
 *
 * Cadastro do CLIENTE, como Metas e o Plano de redução: a mesma pessoa lança
 * para todas as unidades do grupo.
 */
export function PaginaReconhecedores() {
  const { pode } = useSessao();
  const podeEditar = pode('configuracoes', 'edit');
  const [erro, setErro] = useState<string | null>(null);
  const lista = useDados<Reconhecedor[]>(
    () => api.get('/api/reconhecedores', { incluir_inativos: true }),
    [],
  );

  const criar = async (dados: Record<string, string>) => {
    setErro(null);
    try {
      await api.post('/api/reconhecedores', dados);
      lista.recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao cadastrar a pessoa.');
    }
  };

  const alternar = async (r: Reconhecedor) => {
    setErro(null);
    try {
      await api.patch(`/api/reconhecedores/${r.id}`, { ativo: r.ativo !== 1 });
      lista.recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao atualizar a pessoa.');
    }
  };

  // ------------------------------------------ aplicar ao que já está gravado
  //
  // O cadastro decide na ENTRADA da carga. Alcançar o que já foi carregado é um
  // ATO, com prévia e contagem — o mesmo desenho da reaplicação do acordo de
  // SLA, e pela mesma razão: um número apresentado numa reunião não pode mudar
  // porque alguém mexeu numa lista.
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [resumo, setResumo] = useState<{ dados: ResumoReconhecimento; aplicado: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const aplicar = async (gravar: boolean) => {
    setErro(null);
    setOcupado(true);
    try {
      const dados = gravar
        ? await api.post<ResumoReconhecimento>('/api/reconhecedores/aplicacao', { de, ate, justificativa })
        : await api.get<ResumoReconhecimento>('/api/reconhecedores/aplicacao', { de, ate });
      setResumo({ dados, aplicado: gravar });
    } catch (e) {
      setResumo(null);
      setErro(e instanceof Error ? e.message : 'Falha ao aplicar o reconhecimento.');
    }
    setOcupado(false);
  };

  const recorte = (r: ResumoReconhecimento) => {
    if (!r.de && !r.ate) return 'toda a base';
    if (r.de && !r.ate) return `de ${competenciaExib(r.de)} em diante`;
    if (!r.de && r.ate) return `até ${competenciaExib(r.ate)}`;
    return `${competenciaExib(r.de!)} a ${competenciaExib(r.ate!)}`;
  };

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Cartao
        titulo="Quem reconhece despesa"
        descricao="As pessoas que, na origem, lançam despesa que já chega conferida"
      >
        {lista.carregando ? (
          <Carregando />
        ) : (lista.dados ?? []).length === 0 ? (
          <p className="vazio">
            Ninguém cadastrado. Toda despesa que entrar por carga vai nascer por reconhecer, e
            alguém terá de conferir uma a uma na tela de Conferência.
          </p>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Usuário na origem</th>
                  <th>Nome</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(lista.dados ?? []).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <code>{r.usuario_origem}</code>
                    </td>
                    <td>{r.nome_exibicao ?? <em style={{ color: 'var(--tinta-fraca)' }}>—</em>}</td>
                    <td>
                      <Etiqueta texto={r.ativo === 1 ? 'Ativo' : 'Inativo'} tom={r.ativo === 1 ? 'bom' : 'neutro'} />
                    </td>
                    <td>
                      {podeEditar && (
                        <button type="button" className="botao discreto pequeno" onClick={() => alternar(r)}>
                          {r.ativo === 1 ? 'Desativar' : 'Reativar'}
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
            rotulo="Adicionar pessoa"
            campos={[
              {
                chave: 'usuario_origem',
                rotulo: 'Usuário na origem',
                obrigatorio: true,
                largura: 210,
                dica: 'como aparece na carga, ex.: MIQUEIASSILVA',
              },
              { chave: 'nome_exibicao', rotulo: 'Nome', largura: 210, dica: 'opcional, para quem lê a lista' },
            ]}
            aoEnviar={criar}
          />
        )}

        <p className="dica-filtro" style={{ marginTop: 10 }}>
          A comparação ignora acento, espaço e caixa: <code>Miqueias Silva</code> e{' '}
          <code>MIQUEIASSILVA</code> são a mesma pessoa. Desativar alguém que saiu do time faz a
          próxima carga dele nascer por reconhecer, sem apagar o que já entrou.
        </p>
      </Cartao>

      <Cartao
        titulo="Aplicar ao que já está na base"
        descricao="O cadastro vale na entrada da carga; aqui ele alcança os meses já carregados"
      >
        <p className="dica-filtro">
          Escolha o recorte, veja o que mudaria e só então aplique. Nada é recalculado sozinho — um
          número apresentado numa reunião não pode mudar porque alguém mexeu numa lista.
        </p>

        <div className="barra-filtros" style={{ marginTop: 12 }}>
          <Campo rotulo="De" dica="MM/AAAA — em branco: desde o início">
            <input value={de} onChange={(e) => setDe(e.target.value)} placeholder="MM/AAAA" inputMode="numeric" style={{ width: 110 }} />
          </Campo>
          <Campo rotulo="Até" dica="MM/AAAA — em branco: até o fim">
            <input value={ate} onChange={(e) => setAte(e.target.value)} placeholder="MM/AAAA" inputMode="numeric" style={{ width: 110 }} />
          </Campo>
          <Campo rotulo="Justificativa" dica="entra na trilha de auditoria">
            <input value={justificativa} onChange={(e) => setJustificativa(e.target.value)} style={{ width: 280 }} />
          </Campo>
          <button type="button" className="botao discreto" disabled={ocupado} onClick={() => aplicar(false)}>
            Ver o que mudaria
          </button>
          {podeEditar && (
            <button type="button" className="botao" disabled={ocupado} onClick={() => aplicar(true)}>
              Aplicar
            </button>
          )}
        </div>

        {resumo && (
          <Aviso tipo={resumo.aplicado ? 'ok' : 'info'}>
            <strong>
              {resumo.aplicado
                ? `Reconhecimento aplicado a ${recorte(resumo.dados)}.`
                : `Prévia de ${recorte(resumo.dados)} — nada foi gravado.`}
            </strong>
            <dl className="ficha" style={{ marginTop: 6 }}>
              <Linha rotulo="Lançamentos avaliados" valor={inteiro(resumo.dados.avaliados)} />
              <Linha
                rotulo={resumo.aplicado ? 'Reconhecidos agora' : 'Seriam reconhecidos'}
                valor={inteiro(resumo.dados.reconhecidos)}
              />
              <Linha rotulo="Já estavam reconhecidos" valor={inteiro(resumo.dados.ja_reconhecidos)} />
              <Linha rotulo="Criador fora do cadastro" valor={inteiro(resumo.dados.fora_do_cadastro)} />
              <Linha rotulo="Sem criador na origem" valor={inteiro(resumo.dados.sem_usuario_origem)} />
            </dl>
          </Aviso>
        )}
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
  tipo?: 'texto' | 'numero' | 'select' | 'competencia' | 'moeda' | 'data';
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
              type={
                c.tipo === 'numero' || c.tipo === 'moeda'
                  ? 'number'
                  // A vigência do acordo de SLA é um DIA, e o seletor nativo
                  // evita a ambiguidade entre 03/04 e 04/03 sem máscara nossa.
                  : c.tipo === 'data'
                    ? 'date'
                    : 'text'
              }
              inputMode={
                c.tipo === 'competencia' ? 'numeric' : c.tipo === 'moeda' ? 'decimal' : undefined
              }
              placeholder={c.tipo === 'competencia' ? 'MM/AAAA' : c.tipo === 'moeda' ? '0,00' : undefined}
              min={c.tipo === 'moeda' ? 0 : c.minimo}
              max={c.maximo}
              // Dinheiro anda de centavo em centavo; um passo de 0,1 faria a
              // seta do campo pular dez centavos por clique.
              step={c.tipo === 'moeda' ? '0.01' : c.tipo === 'numero' ? '0.1' : undefined}
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

const ENTIDADES = ['lancamento', 'projeto', 'tarefa', 'ticket_sla', 'fechamento', 'importacao', 'filial', 'tipo_despesa', 'meta', 'sla', 'plano_reducao', 'reconhecedor_origem'];

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
