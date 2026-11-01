/**
 * O PLANO DE AÇÃO DA IMPLANTAÇÃO.
 *
 * O Dashboard e o Gantt respondem "como está cada projeto". Esta tela
 * responde outra coisa: "o que falta fazer, por quem, e até quando" — em
 * datas de DIA, não de mês.
 *
 * NADA DE FAROL GUARDADO. O servidor recalcula contra hoje a cada pedido, e a
 * tela não guarda nem recalcula por conta própria: a planilha de origem traz
 * uma coluna de farol escrita no dia em que alguém a abriu, e repeti-la aqui
 * faria a tela envelhecer em silêncio.
 *
 * A CARGA TEM DOIS PASSOS, e é o mesmo motivo de a importação de lançamentos
 * ter: o arquivo substitui o plano inteiro, e substituir sem mostrar antes o
 * que entraria tira de quem importa a chance de recusar um arquivo trocado.
 */
import { useMemo, useState } from 'react';
import { Aviso, Carregando, Cartao, Etiqueta, Modal } from '../components/base';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { inteiro, percentual } from '../lib/formato';

// --------------------------------------------------------------- o contrato

type ChaveFarol = 'ATRASADO' | 'VENCE' | 'NO_PRAZO' | 'SEM_DATA' | 'CONCLUIDO' | 'CANCELADO';

interface AcaoDerivada {
  onda: number;
  numero: number;
  tarefa: string;
  area: string;
  lider: string;
  inicio: string | null;
  fim: string | null;
  status: string;
  link: string;
  observacoes: string;
  evolucoes: string;
  farol: ChaveFarol;
  farol_rotulo: string;
  dias_para_prazo: number | null;
  situacao: string;
  em_aberto: boolean;
}

interface Placar {
  total: number;
  validas: number;
  concluidas: number;
  em_andamento: number;
  nao_iniciadas: number;
  atrasadas: number;
  canceladas: number;
  pct_concluido: number | null;
  por_situacao: Record<string, number>;
  por_farol: Record<string, number>;
}

interface OndaDoPlano extends Placar {
  onda: number;
  virada: string;
  unidades: string[];
  em_producao: boolean;
  acoes: AcaoDerivada[];
}

interface Painel {
  hoje: string;
  placar: Placar;
  ondas: OndaDoPlano[];
  acoes: AcaoDerivada[];
}

interface Leitura {
  acoes: Array<{ onda: number; numero: number }>;
  problemas: string[];
  ondas: Array<{ onda: number; lidas: number; go_live: string }>;
  diagnostico: { total: number; sem_area: number; sem_lider: number; sem_fim: number };
}

interface Gravacao extends Omit<Leitura, 'acoes'> {
  gravadas: number;
  removidas: number;
}

// ----------------------------------------------------------------- miudezas

/** `AAAA-MM-DD` → `DD/MM/AAAA`. */
const diaExib = (iso: string | null | undefined) => (iso && iso.length >= 10
  ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
  : '—');

/** Campo que a planilha deixou vazio, ou preencheu com um traço. */
const ou = (v: string | null | undefined) => (v && v !== '-' ? v : '—');

/**
 * A ordem de urgência dos faróis. Menor vem primeiro.
 *
 * A lista NÃO sai na numeração da planilha: aquela é a ordem de quem a
 * escreveu, e não responde "o que fazer agora".
 */
const URGENCIA: Record<ChaveFarol, number> = {
  ATRASADO: 0, VENCE: 1, NO_PRAZO: 2, SEM_DATA: 3, CONCLUIDO: 4, CANCELADO: 5,
};

/** O tom da etiqueta de cada farol. Cor nunca é o único canal: o texto diz. */
const TOM_FAROL: Record<ChaveFarol, 'bom' | 'critico' | 'atencao' | 'neutro'> = {
  CONCLUIDO: 'bom', NO_PRAZO: 'bom', VENCE: 'atencao',
  ATRASADO: 'critico', SEM_DATA: 'neutro', CANCELADO: 'neutro',
};

const TOM_SITUACAO: Record<string, 'bom' | 'critico' | 'atencao' | 'neutro'> = {
  'Concluído': 'bom', 'Em andamento': 'atencao', 'Atrasado': 'critico',
  'Não iniciado': 'neutro', 'Cancelado': 'neutro',
};

const SITUACOES = ['Não iniciado', 'Em andamento', 'Atrasado', 'Concluído', 'Cancelado'];

/** Sem acento e sem caixa, para a busca não depender de como foi digitado. */
const chave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// -------------------------------------------------------------------- a tela

export function PaginaPlanoAcao() {
  const { cliente } = useSessao();
  const consulta = useDados<Painel>(() => api.get('/api/projetos/plano-acao'), [cliente]);

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [analise, setAnalise] = useState<Leitura | null>(null);
  const [gravacao, setGravacao] = useState<Gravacao | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<'' | 'analisar' | 'gravar' | 'remover'>('');
  const [confirmarRemocao, setConfirmarRemocao] = useState(false);
  // Remonta o campo de arquivo depois de gravar. Limpar só o estado deixaria
  // o <input> ainda segurando o arquivo: reescolher o MESMO não dispara
  // `change`, e o botão ficaria morto sem a tela dizer por quê.
  const [geracaoDoCampo, setGeracaoDoCampo] = useState(0);
  const [detalhe, setDetalhe] = useState<AcaoDerivada | null>(null);

  const [corte, setCorte] = useState({ onda: '', situacao: '', area: '', lider: '', busca: '' });

  const acoes = useMemo(() => consulta.dados?.acoes ?? [], [consulta.dados]);

  const valoresDe = (campo: 'area' | 'lider') => [...new Set(
    acoes.map((a) => a[campo]).filter((v) => v && v !== '-'),
  )].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const lista = useMemo(() => {
    const texto = chave(corte.busca.trim());
    return acoes
      .filter((a) => (!corte.onda || String(a.onda) === corte.onda)
        && (!corte.situacao || a.situacao === corte.situacao)
        && (!corte.area || a.area === corte.area)
        && (!corte.lider || a.lider === corte.lider)
        && (!texto || chave(`${a.tarefa} ${a.area} ${a.lider} ${a.evolucoes}`).includes(texto)))
      .sort((a, b) => (URGENCIA[a.farol] - URGENCIA[b.farol])
        || ((a.dias_para_prazo ?? 1e9) - (b.dias_para_prazo ?? 1e9))
        || (a.onda - b.onda) || (a.numero - b.numero));
  }, [acoes, corte]);

  const enviar = async (rota: string, passo: 'analisar' | 'gravar') => {
    if (!arquivo) return;
    setOcupado(passo);
    setErroCarga(null);
    try {
      if (passo === 'analisar') {
        setGravacao(null);
        setAnalise(await api.enviarArquivo<Leitura>(rota, arquivo));
      } else {
        const r = await api.enviarArquivo<Gravacao>(rota, arquivo);
        setGravacao(r);
        setAnalise(null);
        setArquivo(null);
        setGeracaoDoCampo((g) => g + 1);
        consulta.recarregar();
      }
    } catch (e: unknown) {
      setErroCarga(e instanceof Error ? e.message : 'Falha ao ler o arquivo.');
    } finally {
      setOcupado('');
    }
  };

  const remover = async () => {
    setOcupado('remover');
    try {
      await api.remover('/api/projetos/plano-acao');
      setConfirmarRemocao(false);
      setAnalise(null);
      setGravacao(null);
      consulta.recarregar();
    } catch (e: unknown) {
      setErroCarga(e instanceof Error ? e.message : 'Falha ao remover o plano.');
    } finally {
      setOcupado('');
    }
  };

  if (consulta.erro) return <Aviso tipo="erro">{consulta.erro}</Aviso>;
  if (!consulta.dados) return <Carregando />;
  const d = consulta.dados;
  const p = d.placar;

  return (
    <>
      <Aviso tipo="info">
        O Plano de Ação responde o que o Gantt não responde: <strong>o que falta fazer, por
        quem e até quando</strong>, em datas de dia. O farol é recalculado contra{' '}
        <strong>hoje, {diaExib(d.hoje)}</strong>, a cada abertura — o que vem escrito na
        planilha foi calculado no dia em que alguém a abriu, e é descartado na carga.
      </Aviso>

      <Cartao
        titulo="Carga da planilha"
        descricao={p.total
          ? `${inteiro(p.total)} ação(ões) no plano atual`
          : 'nenhuma ação carregada ainda'}
        // Aberto por padrão: em primeira visita esta é a ÚNICA ação da tela, e
        // escondê-la atrás de uma dobra deixaria a página sem saída.
        padraoAberto
      >
        <div className="barra-filtros">
          <div className="campo" style={{ minWidth: 300 }}>
            <label htmlFor="plano-arquivo">Arquivo .xlsx do Plano de Ação</label>
            <input
              key={geracaoDoCampo}
              id="plano-arquivo"
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                setArquivo(e.target.files?.[0] ?? null);
                setAnalise(null);
                setGravacao(null);
                setErroCarga(null);
              }}
            />
          </div>
          <button
            type="button"
            className="botao"
            disabled={!arquivo || ocupado !== ''}
            onClick={() => void enviar('/api/projetos/plano-acao/analisar', 'analisar')}
          >
            {ocupado === 'analisar' ? 'Conferindo…' : 'Conferir sem gravar'}
          </button>
          <button
            type="button"
            className="botao primario"
            disabled={!arquivo || ocupado !== ''}
            onClick={() => void enviar('/api/projetos/plano-acao', 'gravar')}
          >
            {ocupado === 'gravar' ? 'Gravando…' : 'Carregar e substituir o plano'}
          </button>
          {p.total > 0 && (
            <button
              type="button"
              className="botao perigo"
              disabled={ocupado !== ''}
              onClick={() => setConfirmarRemocao(true)}
            >
              Remover o plano carregado
            </button>
          )}
        </div>

        <p className="nota">
          Conferir não grava nada. Carregar <strong>substitui o plano inteiro</strong>: o
          arquivo é a íntegra dele, e mesclar faria uma ação já removida do documento seguir
          cobrando prazo aqui.
        </p>

        {erroCarga && <Aviso tipo="erro">{erroCarga}</Aviso>}
        {analise && <Relatorio leitura={analise} gravou={false} />}
        {gravacao && <Relatorio leitura={gravacao} gravou />}
      </Cartao>

      {p.total === 0 ? (
        <Cartao titulo="Execução do plano" padraoAberto>
          <p className="vazio">
            Nenhuma ação carregada ainda. Suba a planilha acima para ver o placar, o farol de
            cada ação e o que está atrasado.
          </p>
        </Cartao>
      ) : (
        <>
          <Cartao
            titulo="Execução do plano"
            descricao={`recalculado contra hoje, ${diaExib(d.hoje)}`}
            padraoAberto
          >
            <div className="grade c4">
              <Indicador
                rotulo="Total de ações"
                numero={inteiro(p.total)}
                apoio={`${inteiro(p.validas)} valem para o percentual`}
              />
              <Indicador rotulo="Concluídas" numero={inteiro(p.concluidas)} apoio="entregues" tom="bom" />
              <Indicador
                rotulo="Em andamento"
                numero={inteiro(p.em_andamento)}
                apoio="começadas e no prazo"
                tom="atencao"
              />
              <Indicador
                rotulo="Não iniciadas"
                numero={inteiro(p.nao_iniciadas)}
                apoio="ainda no prazo"
              />
              <Indicador
                rotulo="Atrasadas"
                numero={inteiro(p.atrasadas)}
                apoio="prazo vencido, em aberto"
                tom={p.atrasadas > 0 ? 'critico' : 'neutro'}
              />
              <Indicador
                rotulo="Concluído"
                numero={p.pct_concluido === null ? '—' : percentual(p.pct_concluido)}
                apoio={p.pct_concluido === null
                  ? 'sem ação válida para medir'
                  : `${inteiro(p.concluidas)} de ${inteiro(p.validas)}`}
              />
            </div>
            {p.canceladas > 0 && (
              <p className="nota">
                {inteiro(p.canceladas)} ação(ões) cancelada(s) — <strong>fora do
                percentual</strong>, como no plano: mantê-las embaixo da divisão faria o plano
                nunca poder chegar a 100%.
              </p>
            )}
          </Cartao>

          <Cartao
            titulo="Por onda"
            descricao="a virada de cada frente, e o que falta para ela"
            padraoAberto
          >
            <div className="tabela-envolucro">
              <table>
                <thead>
                  <tr>
                    <th>Onda</th>
                    <th>Unidades</th>
                    <th>Go-live</th>
                    <th className="num">Ações</th>
                    <th className="num">Concluídas</th>
                    <th className="num">Atrasadas</th>
                    <th className="num">% concl.</th>
                  </tr>
                </thead>
                <tbody>
                  {d.ondas.map((o) => (
                    <tr key={o.onda}>
                      <td>
                        <strong>{o.onda}ª</strong>{' '}
                        {o.em_producao && <Etiqueta texto="em produção" tom="bom" />}
                      </td>
                      <td>{o.unidades.join(' · ')}</td>
                      <td>{diaExib(o.virada)}</td>
                      <td className="num">{inteiro(o.total)}</td>
                      <td className="num">{inteiro(o.concluidas)}</td>
                      <td className="num">
                        {o.atrasadas > 0 ? <strong className="res-falhou">{inteiro(o.atrasadas)}</strong> : '0'}
                      </td>
                      <td className="num">
                        {o.pct_concluido === null ? '—' : percentual(o.pct_concluido)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="nota">
              Uma onda pode estar <strong>em produção com ações em aberto</strong> — a virada é
              um fato, e o que falta é estabilização. É por isso que as duas colunas não dizem a
              mesma coisa.
            </p>
          </Cartao>

          <Cartao
            titulo="Ações"
            descricao={`${inteiro(lista.length)} de ${inteiro(acoes.length)} · da mais urgente para a menos`}
            padraoAberto
          >
            <div className="barra-filtros">
              <Corte
                campo="onda"
                rotulo="Onda"
                valor={corte.onda}
                aoMudar={(v) => setCorte((c) => ({ ...c, onda: v }))}
                opcoes={d.ondas.map((o) => ({ valor: String(o.onda), rotulo: `${o.onda}ª — ${diaExib(o.virada)}` }))}
              />
              <Corte
                campo="situacao"
                rotulo="Situação"
                valor={corte.situacao}
                aoMudar={(v) => setCorte((c) => ({ ...c, situacao: v }))}
                opcoes={SITUACOES.map((s) => ({ valor: s, rotulo: s }))}
              />
              <Corte
                campo="area"
                rotulo="Área responsável"
                valor={corte.area}
                aoMudar={(v) => setCorte((c) => ({ ...c, area: v }))}
                opcoes={valoresDe('area').map((s) => ({ valor: s, rotulo: s }))}
              />
              <Corte
                campo="lider"
                rotulo="Líder de equipe"
                valor={corte.lider}
                aoMudar={(v) => setCorte((c) => ({ ...c, lider: v }))}
                opcoes={valoresDe('lider').map((s) => ({ valor: s, rotulo: s }))}
              />
              <div className="campo" style={{ minWidth: 200 }}>
                <label htmlFor="plano-busca">Buscar</label>
                <input
                  id="plano-busca"
                  type="search"
                  value={corte.busca}
                  placeholder="tarefa, área, líder ou evolução"
                  onChange={(e) => setCorte((c) => ({ ...c, busca: e.target.value }))}
                />
              </div>
              <button
                type="button"
                className="botao"
                onClick={() => setCorte({ onda: '', situacao: '', area: '', lider: '', busca: '' })}
              >
                Limpar filtros
              </button>
            </div>

            {lista.length === 0 ? (
              <p className="vazio">Nenhuma ação neste recorte.</p>
            ) : (
              <div className="tabela-envolucro">
                <table>
                  <thead>
                    <tr>
                      <th className="num">Onda</th>
                      <th className="num">Nº</th>
                      <th>Tarefa</th>
                      <th>Área</th>
                      <th>Líder</th>
                      <th>Início</th>
                      <th>Fim</th>
                      <th>Situação</th>
                      <th>Farol</th>
                      <th aria-label="Detalhe" />
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((a) => (
                      <tr key={`${a.onda}-${a.numero}`}>
                        <td className="num">{a.onda}ª</td>
                        <td className="num">{inteiro(a.numero)}</td>
                        <td className="texto">{a.tarefa}</td>
                        <td>{ou(a.area)}</td>
                        <td>{ou(a.lider)}</td>
                        <td>{diaExib(a.inicio)}</td>
                        <td>{diaExib(a.fim)}</td>
                        <td><Etiqueta texto={a.situacao} tom={TOM_SITUACAO[a.situacao] ?? 'neutro'} /></td>
                        <td><Etiqueta texto={a.farol_rotulo} tom={TOM_FAROL[a.farol]} /></td>
                        <td>
                          <button
                            type="button"
                            className="botao"
                            onClick={() => setDetalhe(a)}
                          >
                            Ver ação
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Cartao>
        </>
      )}

      <Modal
        titulo={detalhe ? `Onda ${detalhe.onda} · nº ${detalhe.numero}` : ''}
        aberto={detalhe !== null}
        aoFechar={() => setDetalhe(null)}
        tipo="plano-acao"
      >
        {detalhe && (
          <>
            <p><strong>{detalhe.tarefa}</strong></p>
            <dl className="ficha">
              <dt>Área responsável</dt><dd>{ou(detalhe.area)}</dd>
              <dt>Líder de equipe</dt><dd>{ou(detalhe.lider)}</dd>
              <dt>Início</dt><dd>{diaExib(detalhe.inicio)}</dd>
              <dt>Fim</dt><dd>{diaExib(detalhe.fim)}</dd>
              <dt>Status no plano</dt><dd>{detalhe.status}</dd>
              <dt>Situação medida</dt>
              <dd><Etiqueta texto={detalhe.situacao} tom={TOM_SITUACAO[detalhe.situacao] ?? 'neutro'} /></dd>
              <dt>Farol</dt>
              <dd><Etiqueta texto={detalhe.farol_rotulo} tom={TOM_FAROL[detalhe.farol]} /></dd>
            </dl>
            {detalhe.evolucoes && (
              <>
                <h3>Evolução registrada</h3>
                <p className="texto-longo">{detalhe.evolucoes}</p>
              </>
            )}
            {detalhe.observacoes && (
              <>
                <h3>Observações</h3>
                <p className="texto-longo">{detalhe.observacoes}</p>
              </>
            )}
            {!detalhe.evolucoes && !detalhe.observacoes && (
              <p className="nota">Esta ação não tem evolução nem observação registrada na planilha.</p>
            )}
          </>
        )}
      </Modal>

      <Modal
        titulo="Remover o plano carregado"
        aberto={confirmarRemocao}
        aoFechar={() => setConfirmarRemocao(false)}
        tipo="plano-remover"
        acoes={(
          <>
            <button type="button" className="botao" onClick={() => setConfirmarRemocao(false)}>
              Manter o plano
            </button>
            <button
              type="button"
              className="botao perigo"
              disabled={ocupado === 'remover'}
              onClick={() => void remover()}
            >
              {ocupado === 'remover' ? 'Removendo…' : 'Remover as ações'}
            </button>
          </>
        )}
      >
        <p>
          As {inteiro(p.total)} ação(ões) do plano saem do sistema. O placar, o farol e a lista
          ficam vazios até a próxima carga.
        </p>
        <p className="nota">A planilha de origem não é afetada — ela não fica guardada aqui.</p>
      </Modal>
    </>
  );
}

// ----------------------------------------------------------------- pedaços

function Indicador({
  rotulo, numero, apoio, tom = 'neutro',
}: {
  rotulo: string;
  numero: string;
  apoio?: string;
  tom?: 'neutro' | 'bom' | 'critico' | 'atencao';
}) {
  // A cor acompanha o número, mas nunca sozinha: o rótulo e o apoio dizem em
  // palavras o que ela mostra.
  const classe = tom === 'neutro' ? 'numero' : `numero ${tom}`;
  return (
    <div className="cartao">
      <div className="indicador">
        <span className="rotulo">{rotulo}</span>
        <span className={classe}>{numero}</span>
        {apoio && <span className="apoio">{apoio}</span>}
      </div>
    </div>
  );
}

function Corte({
  campo, rotulo, valor, opcoes, aoMudar,
}: {
  campo: string;
  rotulo: string;
  valor: string;
  opcoes: Array<{ valor: string; rotulo: string }>;
  aoMudar: (v: string) => void;
}) {
  return (
    <div className="campo" style={{ minWidth: 150 }}>
      <label htmlFor={`plano-corte-${campo}`}>{rotulo}</label>
      <select
        id={`plano-corte-${campo}`}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
      >
        <option value="">Todos</option>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>{o.rotulo}</option>
        ))}
      </select>
    </div>
  );
}

/**
 * O relatório da leitura — o que entrou, o que faltava e o que foi recusado.
 *
 * Os problemas aparecem SEMPRE, inclusive quando a carga deu certo: uma carga
 * que grava em silêncio entrega um plano plausível e errado, e quem importou
 * não tem como saber que a planilha dizia um go-live e o cronograma diz outro.
 */
function Relatorio({ leitura, gravou }: { leitura: Leitura | Gravacao; gravou: boolean }) {
  const g = leitura as Gravacao;
  const total = gravou ? g.gravadas : leitura.diagnostico.total;
  return (
    <div className="ultima-carga">
      <Aviso tipo={leitura.problemas.length ? 'info' : 'ok'}>
        {gravou
          ? `${inteiro(total)} ação(ões) gravada(s)${g.removidas ? `, no lugar de ${inteiro(g.removidas)} anterior(es)` : ''}.`
          : `${inteiro(total)} ação(ões) seriam lidas. Nada foi gravado ainda.`}
      </Aviso>
      <dl className="ficha">
        <dt>Ondas no arquivo</dt>
        <dd>{leitura.ondas.map((o) => `${o.onda}ª: ${inteiro(o.lidas)}`).join(' · ') || '—'}</dd>
        <dt>Sem área responsável</dt><dd>{inteiro(leitura.diagnostico.sem_area)}</dd>
        <dt>Sem líder de equipe</dt><dd>{inteiro(leitura.diagnostico.sem_lider)}</dd>
        <dt>Sem data de fim</dt><dd>{inteiro(leitura.diagnostico.sem_fim)}</dd>
      </dl>
      {leitura.problemas.length > 0 && (
        <>
          <h3>{inteiro(leitura.problemas.length)} ponto(s) de atenção</h3>
          <ul className="lista-problemas">
            {leitura.problemas.map((texto) => <li key={texto}>{texto}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}
