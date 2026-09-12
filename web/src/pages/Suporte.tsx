/**
 * Sistemas de suporte — OStick e Bitrix24.
 *
 * Uma tela só, parametrizada pelo sistema. Os dois trazem a mesma coisa com
 * nomes diferentes, e a normalização já resolveu isso no servidor: duplicar
 * tela e componente aqui seria duplicar manutenção para dizer o mesmo.
 */
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { Aviso, Campo, Carregando, Cartao, Etiqueta, Modal } from '../components/base';
import { SeletorMulti, FichasSelecao } from '../components/seletor-multi';
import { Indicador } from '../components/graficos';
import { competenciaValida, dataHora, inteiro, percentual } from '../lib/formato';
import { Detalhamento, detalheDeChamados, type PedidoDetalhe } from '../components/detalhamento';

export type SistemaOrigem = 'OSTICK' | 'BITRIX24';

const ROTULO_SISTEMA: Record<SistemaOrigem, string> = {
  OSTICK: 'Sistema OStick',
  BITRIX24: 'Sistema Bitrix24',
};

export const ROTULO_STATUS_CHAMADO: Record<string, string> = {
  open: 'Aberto',
  in_progress: 'Em andamento',
  resolved: 'Resolvido',
  closed: 'Fechado',
};

export const ROTULO_PRIORIDADE: Record<string, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente',
};

const TOM_PRIORIDADE: Record<string, 'neutro' | 'atencao' | 'critico'> = {
  low: 'neutro',
  medium: 'neutro',
  high: 'atencao',
  urgent: 'critico',
};

interface Chamado {
  id: number;
  source_system: SistemaOrigem;
  external_id: string;
  /** Endereço do chamado no sistema de origem, montado pelo servidor. */
  url_externa: string | null;
  numero: string | null;
  assunto: string | null;
  descricao: string | null;
  status: string | null;
  prioridade: string | null;
  setor_id: number | null;
  setor: string | null;
  solicitante: string | null;
  solicitante_email: string | null;
  solicitante_externo_id: string | null;
  responsavel: string | null;
  atendente_externo_id: string | null;
  filial_nome: string | null;
  fila: string | null;
  topico_ajuda: string | null;
  competencia: string;
  aberto_em: string | null;
  fechado_em: string | null;
  prazo_em: string | null;
  horas: number | null;
  dentro_sla: number;
  synced_at: string | null;
}

interface Pagina {
  itens: Chamado[];
  paginacao: { pagina: number; limite: number; total: number; paginas: number };
  resumo: { total: number; em_aberto: number; dentro_sla: number; pct_dentro_sla: number };
}

interface Opcoes {
  setores: Array<{ id: number; nome: string }>;
  atendentes: string[];
  solicitantes: string[];
  status: string[];
  prioridades: string[];
  competencias: string[];
}

export function PaginaOstick() {
  return <PaginaChamados sistema="OSTICK" />;
}

export function PaginaBitrix24() {
  return <PaginaChamados sistema="BITRIX24" />;
}

/** Status que o resumo conta como chamado ainda em aberto. */
const ABERTOS = ['open', 'in_progress'];

function PaginaChamados({ sistema }: { sistema: SistemaOrigem }) {
  const { empresa, filialId, paramFilial } = useSessao();
  const [setores, setSetores] = useState<string[]>([]);
  const [atendentes, setAtendentes] = useState<string[]>([]);
  const [solicitantes, setSolicitantes] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [busca, setBusca] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [pagina, setPagina] = useState(1);
  const [aberto, setAberto] = useState<Chamado | null>(null);
  const [detalhe, setDetalhe] = useState<PedidoDetalhe<Record<string, unknown>> | null>(null);

  const opcoes = useDados<Opcoes>(
    () => api.get('/api/suporte/chamados/opcoes', { sistema }),
    [empresa?.id, sistema],
  );

  const consulta = useDados<Pagina>(
    () =>
      api.get('/api/suporte/chamados', {
        sistema,
        filial_id: paramFilial(),
        setor_id: setores.join(','),
        atendente: atendentes.join(','),
        solicitante: solicitantes.join(','),
        status: status.join(','),
        busca: busca.trim() || undefined,
        competencia_inicio: competenciaValida(de) ? de : undefined,
        competencia_fim: competenciaValida(ate) ? ate : undefined,
        pagina,
      }),
    [empresa?.id, filialId, sistema, setores, atendentes, solicitantes, status, busca, de, ate, pagina],
  );

  /**
   * Os mesmos filtros da tela, sem a paginação: o indicador conta o recorte
   * inteiro, não a página em foco, e o detalhamento tem de contar o mesmo.
   */
  const recorte = (extra: Record<string, unknown> = {}) => ({
    sistema,
    filial_id: paramFilial(),
    setor_id: setores.join(','),
    atendente: atendentes.join(','),
    solicitante: solicitantes.join(','),
    status: status.join(','),
    busca: busca.trim() || undefined,
    competencia_inicio: competenciaValida(de) ? de : undefined,
    competencia_fim: competenciaValida(ate) ? ate : undefined,
    ...extra,
  });

  /**
   * "Em aberto" cruza com o filtro de status que o gestor já tenha marcado —
   * o indicador conta dentro desse recorte, e o detalhamento precisa do mesmo
   * cruzamento para não abrir mais chamados do que o número mostra.
   */
  const statusEmAberto = (status.length ? status.filter((s) => ABERTOS.includes(s)) : ABERTOS).join(',');

  // Trocar um filtro volta para a primeira página: continuar na 3ª de um
  // recorte que agora tem uma página só mostraria uma tela vazia.
  const comReset = <T,>(set: (v: T) => void) => (v: T) => {
    setPagina(1);
    set(v);
  };

  const itensSetor = useMemo(
    () => (opcoes.dados?.setores ?? []).map((s) => ({ valor: String(s.id), rotulo: s.nome })),
    [opcoes.dados],
  );
  const comoItens = (lista: string[] | undefined, rotulos?: Record<string, string>) =>
    (lista ?? []).map((v) => ({ valor: v, rotulo: rotulos?.[v] ?? v }));

  return (
    <>
      <div className="barra-filtros">
        <Campo rotulo="Setor / área">
          <SeletorMulti rotulo="Setor" largura={190} itens={itensSetor} selecionados={setores} aoMudar={comReset(setSetores)} />
        </Campo>
        <Campo rotulo="Atendente">
          <SeletorMulti
            rotulo="Atendente"
            largura={180}
            itens={comoItens(opcoes.dados?.atendentes)}
            selecionados={atendentes}
            aoMudar={comReset(setAtendentes)}
          />
        </Campo>
        <Campo rotulo="Solicitante">
          <SeletorMulti
            rotulo="Solicitante"
            largura={180}
            itens={comoItens(opcoes.dados?.solicitantes)}
            selecionados={solicitantes}
            aoMudar={comReset(setSolicitantes)}
          />
        </Campo>
        <Campo rotulo="Status">
          <SeletorMulti
            rotulo="Status"
            largura={160}
            itens={comoItens(opcoes.dados?.status, ROTULO_STATUS_CHAMADO)}
            selecionados={status}
            aoMudar={comReset(setStatus)}
          />
        </Campo>
        <Campo rotulo="De">
          <input value={de} onChange={(e) => comReset(setDe)(e.target.value)} placeholder="MM/AAAA" style={{ width: 92 }} />
        </Campo>
        <Campo rotulo="Até">
          <input value={ate} onChange={(e) => comReset(setAte)(e.target.value)} placeholder="MM/AAAA" style={{ width: 92 }} />
        </Campo>
        <Campo rotulo="Buscar">
          <input
            value={busca}
            onChange={(e) => comReset(setBusca)(e.target.value)}
            placeholder="assunto, solicitante, nº…"
            style={{ minWidth: 170 }}
          />
        </Campo>
      </div>

      <FichasSelecao
        grupos={[
          { chave: 'setor', rotulo: 'Setor', itens: itensSetor, selecionados: setores, aoMudar: comReset(setSetores) },
          {
            chave: 'atendente',
            rotulo: 'Atendente',
            itens: comoItens(opcoes.dados?.atendentes),
            selecionados: atendentes,
            aoMudar: comReset(setAtendentes),
          },
          {
            chave: 'solicitante',
            rotulo: 'Solicitante',
            itens: comoItens(opcoes.dados?.solicitantes),
            selecionados: solicitantes,
            aoMudar: comReset(setSolicitantes),
          },
          {
            chave: 'status',
            rotulo: 'Status',
            itens: comoItens(opcoes.dados?.status, ROTULO_STATUS_CHAMADO),
            selecionados: status,
            aoMudar: comReset(setStatus),
          },
        ]}
      />

      {consulta.erro && <Aviso tipo="erro">{consulta.erro}</Aviso>}

      {consulta.dados && consulta.dados.resumo.total > 0 && (
        <div className="grade c3">
          <Indicador
            rotulo="Chamados no recorte"
            valor={inteiro(consulta.dados.resumo.total)}
            dica="Todos os chamados que atendem aos filtros acima, e não só os da página em foco."
            aoDetalhar={() =>
              setDetalhe(
                detalheDeChamados(`Chamados — ${ROTULO_SISTEMA[sistema]}`, recorte(), consulta.dados!.resumo.total),
              )
            }
          />
          <Indicador
            rotulo="Em aberto"
            valor={inteiro(consulta.dados.resumo.em_aberto)}
            apoio={`${inteiro(consulta.dados.resumo.total - consulta.dados.resumo.em_aberto)} encerrados`}
            dica="Chamados ainda sem encerramento: em aberto ou em atendimento."
            aoDetalhar={
              // Sem chamados em aberto não há o que abrir, e um detalhamento
              // vazio só faria o gestor duvidar do número.
              consulta.dados.resumo.em_aberto > 0
                ? () =>
                    setDetalhe(
                      detalheDeChamados(
                        'Chamados em aberto',
                        recorte({ status: statusEmAberto }),
                        consulta.dados!.resumo.em_aberto,
                      ),
                    )
                : undefined
            }
          />
          <Indicador
            rotulo="Dentro do SLA"
            valor={percentual(consulta.dados.resumo.pct_dentro_sla)}
            apoio={`${inteiro(consulta.dados.resumo.dentro_sla)} de ${inteiro(consulta.dados.resumo.total)}`}
            dica="Chamados atendidos dentro do prazo, sobre o total do recorte."
            aoDetalhar={
              consulta.dados.resumo.dentro_sla > 0
                ? () =>
                    setDetalhe(
                      detalheDeChamados(
                        'Chamados dentro do SLA',
                        recorte({ sla: 'dentro' }),
                        consulta.dados!.resumo.dentro_sla,
                      ),
                    )
                : undefined
            }
          />
        </div>
      )}

      <Cartao
        titulo={ROTULO_SISTEMA[sistema]}
        descricao={
          consulta.dados
            ? `${inteiro(consulta.dados.paginacao.total)} chamado(s) · página ${consulta.dados.paginacao.pagina} de ${consulta.dados.paginacao.paginas}`
            : undefined
        }
      >
        {!consulta.dados ? (
          <Carregando />
        ) : consulta.dados.itens.length === 0 ? (
          <p className="vazio">
            {consulta.dados.resumo.total === 0 && !busca && setores.length === 0
              ? `Nenhum chamado recebido do ${ROTULO_SISTEMA[sistema]} ainda. Os chamados chegam pelo webhook da automação; ` +
                'enquanto ele não envia nada, esta tela fica vazia.'
              : 'Nenhum chamado no recorte selecionado. Ajuste os filtros acima.'}
          </p>
        ) : (
          <>
            <div className="tabela-envolucro">
              <table>
                <thead>
                  <tr>
                    <th>Chamado</th>
                    <th>Aberto em</th>
                    <th>Setor / área</th>
                    <th>Assunto</th>
                    <th>Solicitante</th>
                    <th>Atendente</th>
                    <th>Prioridade</th>
                    <th>Status</th>
                    <th>SLA</th>
                  </tr>
                </thead>
                <tbody>
                  {consulta.dados.itens.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => setAberto(c)}
                      style={{ cursor: 'pointer' }}
                      title={resumoDoChamado(c)}
                    >
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {/* O número abre o chamado no sistema de origem: é o
                            caminho para ver o atendimento inteiro. */}
                        {c.url_externa ? (
                          <a href={c.url_externa} target="_blank" rel="noopener noreferrer">
                            #{c.numero ?? c.external_id}
                          </a>
                        ) : (
                          `#${c.numero ?? c.external_id}`
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{dataHora(c.aberto_em)}</td>
                      <td>{c.setor ?? '—'}</td>
                      <td style={{ maxWidth: 260 }}>{c.assunto ?? '—'}</td>
                      <td>{c.solicitante ?? '—'}</td>
                      <td>{c.responsavel ?? '—'}</td>
                      <td>
                        <Etiqueta
                          texto={ROTULO_PRIORIDADE[c.prioridade ?? ''] ?? c.prioridade ?? '—'}
                          tom={TOM_PRIORIDADE[c.prioridade ?? ''] ?? 'neutro'}
                        />
                      </td>
                      <td>
                        <Etiqueta
                          texto={ROTULO_STATUS_CHAMADO[c.status ?? ''] ?? c.status ?? '—'}
                          tom={c.status === 'closed' || c.status === 'resolved' ? 'bom' : 'neutro'}
                        />
            {c.url_externa && (
              <a href={c.url_externa} target="_blank" rel="noopener noreferrer">
                Abrir no {ROTULO_SISTEMA[c.source_system]} ↗
              </a>
            )}
                      </td>
                      <td>
                        <Etiqueta texto={c.dentro_sla ? 'Dentro' : 'Fora'} tom={c.dentro_sla ? 'bom' : 'critico'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {consulta.dados.paginacao.paginas > 1 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                <button
                  type="button"
                  className="botao pequeno"
                  disabled={pagina <= 1}
                  onClick={() => setPagina((p) => p - 1)}
                >
                  Anterior
                </button>
                <span style={{ color: 'var(--tinta-fraca)', fontSize: 12.5 }}>
                  Página {consulta.dados.paginacao.pagina} de {consulta.dados.paginacao.paginas}
                </span>
                <button
                  type="button"
                  className="botao pequeno"
                  disabled={pagina >= consulta.dados.paginacao.paginas}
                  onClick={() => setPagina((p) => p + 1)}
                >
                  Próxima
                </button>
              </div>
            )}
          </>
        )}
      </Cartao>

      {aberto && <DetalheChamado id={aberto.id} aoFechar={() => setAberto(null)} />}
      {detalhe && <Detalhamento pedido={detalhe} aoFechar={() => setDetalhe(null)} />}
    </>
  );
}

/** Texto do tooltip da linha: o que o gestor quer saber sem abrir o chamado. */
function resumoDoChamado(c: Chamado): string {
  return [
    `#${c.numero ?? c.external_id} — ${c.assunto ?? 'sem assunto'}`,
    c.descricao ? `\n${c.descricao.slice(0, 240)}${c.descricao.length > 240 ? '…' : ''}` : '',
    `\n\nSetor: ${c.setor ?? 'Não classificado'}`,
    `\nSolicitante: ${c.solicitante ?? '—'}${c.solicitante_email ? ` (${c.solicitante_email})` : ''}`,
    `\nAtendente: ${c.responsavel ?? '—'}`,
    `\nAberto em ${dataHora(c.aberto_em)}${c.fechado_em ? ` · fechado em ${dataHora(c.fechado_em)}` : ''}`,
    '\n\nClique para ver o detalhamento completo.',
  ].join('');
}

/**
 * Detalhe do chamado. Carregado sob demanda: a listagem não traz o payload
 * bruto, que é o campo grande, justamente para a lista não ficar pesada.
 */
function DetalheChamado({ id, aoFechar }: { id: number; aoFechar: () => void }) {
  const consulta = useDados<Chamado & { raw_payload: unknown }>(() => api.get(`/api/suporte/chamados/${id}`), [id]);
  const [verBruto, setVerBruto] = useState(false);
  const c = consulta.dados;

  return (
    <Modal titulo={c ? `#${c.numero ?? c.external_id} — ${c.assunto ?? 'Chamado'}` : 'Chamado'} aberto aoFechar={aoFechar}>
      {consulta.erro && <Aviso tipo="erro">{consulta.erro}</Aviso>}
      {!c ? (
        <Carregando />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Etiqueta texto={ROTULO_SISTEMA[c.source_system]} />
            <Etiqueta
              texto={ROTULO_STATUS_CHAMADO[c.status ?? ''] ?? c.status ?? '—'}
              tom={c.status === 'closed' || c.status === 'resolved' ? 'bom' : 'neutro'}
            />
            <Etiqueta
              texto={`Prioridade ${ROTULO_PRIORIDADE[c.prioridade ?? ''] ?? c.prioridade ?? '—'}`}
              tom={TOM_PRIORIDADE[c.prioridade ?? ''] ?? 'neutro'}
            />
            <Etiqueta texto={c.dentro_sla ? 'Dentro do SLA' : 'Fora do SLA'} tom={c.dentro_sla ? 'bom' : 'critico'} />
          </div>

          {c.descricao && (
            <p style={{ whiteSpace: 'pre-wrap', color: 'var(--tinta-2)', marginTop: 4 }}>{c.descricao}</p>
          )}

          <dl className="ficha">
            <Linha rotulo="Setor / área da solicitação" valor={c.setor ?? 'Não classificado'} />
            <Linha
              rotulo="Solicitante"
              valor={[c.solicitante, c.solicitante_email].filter(Boolean).join(' · ') || '—'}
            />
            <Linha rotulo="Atendente" valor={c.responsavel ?? '—'} />
            <Linha rotulo="Filial" valor={c.filial_nome ?? 'Nível empresa'} />
            <Linha rotulo="Fila" valor={c.fila ?? '—'} />
            <Linha rotulo="Tópico de ajuda" valor={c.topico_ajuda ?? '—'} />
            <Linha rotulo="Aberto em" valor={dataHora(c.aberto_em)} />
            <Linha rotulo="Prazo" valor={dataHora(c.prazo_em)} />
            <Linha rotulo="Fechado em" valor={c.fechado_em ? dataHora(c.fechado_em) : 'em aberto'} />
            <Linha rotulo="Horas" valor={c.horas === null ? '—' : String(c.horas)} />
            <Linha rotulo="Identificador na origem" valor={c.external_id} />
            <Linha
              rotulo="Última sincronização"
              valor={c.synced_at ? dataHora(c.synced_at) : 'nunca sincronizado'}
            />
          </dl>

          {c.raw_payload !== null && c.raw_payload !== undefined && (
            <div>
              <button
                type="button"
                className="botao discreto pequeno"
                aria-expanded={verBruto}
                onClick={() => setVerBruto((v) => !v)}
              >
                {verBruto ? 'Ocultar' : 'Ver'} payload recebido
              </button>
              {verBruto && (
                <pre
                  style={{
                    background: 'var(--superficie-2)',
                    padding: 10,
                    borderRadius: 8,
                    fontSize: 12,
                    overflowX: 'auto',
                    maxHeight: 300,
                  }}
                >
                  {JSON.stringify(c.raw_payload, null, 2)}
                </pre>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <>
      <dt>{rotulo}</dt>
      <dd>{valor}</dd>
    </>
  );
}
