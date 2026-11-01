/**
 * O CONTROLE ÚNICO do projeto de implantação.
 *
 * A Visão Macro pergunta se a unidade virou no dia combinado. Esta pergunta é
 * a outra: **atividade a atividade, como está cada unidade?**
 *
 * A linha é uma ATIVIDADE, e cada unidade acompanhada tem uma situação dentro
 * dela. Uma atividade concluída em três unidades e não iniciada em outras três
 * é UMA linha, não seis.
 *
 * NADA DE DERIVADO GUARDADO. Status consolidado, avanço, peso e farol vêm do
 * servidor calculados contra hoje a cada abertura — a planilha traz oito
 * colunas já calculadas, e todas são descartadas na carga, pelo mesmo motivo
 * que "fora do SLA" nunca é gravado.
 */
import { useMemo, useState } from 'react';
import { Aviso, Carregando, Cartao, Etiqueta, Modal } from '../components/base';
import { api, ErroApi } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { inteiro, percentual } from '../lib/formato';

type Farol = 'VERDE' | 'AMARELO' | 'VERMELHO' | 'N/A';

interface Atividade {
  id_origem: string;
  chave: string;
  grupo_time: string;
  frente: string;
  atividade: string;
  tipo_entrega: string;
  caminho: string;
  criticidade: string;
  lider: string;
  executante: string;
  data_base_onda: string | null;
  prazo_repactuado: string | null;
  pendencia: string;
  proxima_acao: string;
  evidencia: string;
  observacoes: string;
  unidades: Record<string, string>;
  criterio_aceite: string;
  executantes: string[];
  status_consolidado: string;
  status_igual_em_todas: string;
  avanco: number | null;
  peso: number | null;
  farol: Farol;
  dias_para_prazo: number | null;
}

interface Coluna {
  chave: string;
  rotulo: string;
  nome: string;
  onda: number | null;
}

interface UnidadeMedida extends Coluna {
  acompanhada: boolean;
  por_status: Record<string, number>;
  avanco: number | null;
  atividades: number;
}

interface Painel {
  hoje: string;
  colunas: Coluna[];
  placar: {
    total: number;
    validas: number;
    por_status: Record<string, number>;
    por_farol: Record<string, number>;
    avanco_ponderado: number | null;
    avanco_simples: number | null;
  };
  unidades: UnidadeMedida[];
  atividades: Atividade[];
}

interface Leitura {
  total: number;
  problemas: Array<{ linha: number; id: string; tipo: string; texto: string }>;
  diagnostico: {
    total: number;
    sem_executante: number;
    sem_caminho: number;
    sem_criticidade: number;
    unidades_sem_coluna: number;
  };
}

interface Gravacao extends Omit<Leitura, 'total'> {
  gravadas: number;
  removidas: number;
}

const TOM_FAROL: Record<Farol, 'bom' | 'critico' | 'atencao' | 'neutro'> = {
  VERDE: 'bom', AMARELO: 'atencao', VERMELHO: 'critico', 'N/A': 'neutro',
};

const TOM_SITUACAO: Record<string, 'bom' | 'critico' | 'atencao' | 'neutro'> = {
  'Concluído': 'bom', 'Em andamento': 'atencao', 'Bloqueado': 'critico',
  'Não iniciado': 'neutro', 'Cancelado': 'neutro',
};

/** A ordem de urgência dos faróis. Menor vem primeiro. */
const URGENCIA: Record<Farol, number> = { VERMELHO: 0, AMARELO: 1, VERDE: 2, 'N/A': 3 };

const ou = (v: string | null | undefined) => (v && v !== '-' ? v : '—');

const diaExib = (iso: string | null | undefined) => (iso && iso.length >= 10
  ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
  : '—');

/** Sem acento e sem caixa, para a busca não depender de como foi digitado. */
const chave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function PaginaControleUnico() {
  const { cliente, pode } = useSessao();
  const podeEditar = pode('projetos', 'edit');
  const consulta = useDados<Painel>(() => api.get('/api/projetos/controle-unico'), [cliente]);

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [geracaoDoCampo, setGeracaoDoCampo] = useState(0);
  const [analise, setAnalise] = useState<Leitura | null>(null);
  const [gravacao, setGravacao] = useState<Gravacao | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<'' | 'analisar' | 'gravar' | 'remover'>('');
  const [confirmarRemocao, setConfirmarRemocao] = useState(false);
  const [detalhe, setDetalhe] = useState<Atividade | null>(null);
  const [corte, setCorte] = useState({ frente: '', farol: '', unidade: '', situacao: '', busca: '' });

  const atividades = useMemo(() => consulta.dados?.atividades ?? [], [consulta.dados]);

  const valoresDe = (campo: 'frente' | 'grupo_time') => [...new Set(
    atividades.map((a) => a[campo]).filter((v) => v && v !== '-'),
  )].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const lista = useMemo(() => {
    const texto = chave(corte.busca.trim());
    return atividades
      .filter((a) => (!corte.frente || a.frente === corte.frente)
        && (!corte.farol || a.farol === corte.farol)
        && (!corte.unidade || !!a.unidades?.[corte.unidade])
        && (!corte.situacao || (corte.unidade
          ? a.unidades?.[corte.unidade] === corte.situacao
          : a.status_consolidado === corte.situacao))
        && (!texto || chave(`${a.atividade} ${a.id_origem} ${a.frente} ${a.executante} ${a.pendencia}`)
          .includes(texto)))
      // O MAIS URGENTE PRIMEIRO, e não na ordem da planilha: aquela é a de
      // quem a escreveu, e não responde "o que fazer agora".
      .sort((a, b) => (URGENCIA[a.farol] - URGENCIA[b.farol])
        || ((a.dias_para_prazo ?? 1e9) - (b.dias_para_prazo ?? 1e9))
        || a.id_origem.localeCompare(b.id_origem, 'pt-BR'));
  }, [atividades, corte]);

  const enviar = async (rota: string, passo: 'analisar' | 'gravar') => {
    if (!arquivo) return;
    setOcupado(passo);
    setErroCarga(null);
    try {
      if (passo === 'analisar') {
        setGravacao(null);
        setAnalise(await api.enviarArquivo<Leitura>(rota, arquivo));
      } else {
        setGravacao(await api.enviarArquivo<Gravacao>(rota, arquivo));
        setAnalise(null);
        setArquivo(null);
        setGeracaoDoCampo((g) => g + 1);
        consulta.recarregar();
      }
    } catch (e: unknown) {
      setErroCarga(e instanceof ErroApi || e instanceof Error ? e.message : 'Falha ao ler o arquivo.');
    } finally {
      setOcupado('');
    }
  };

  const remover = async () => {
    setOcupado('remover');
    try {
      await api.remover('/api/projetos/controle-unico');
      setConfirmarRemocao(false);
      setAnalise(null);
      setGravacao(null);
      consulta.recarregar();
    } catch (e: unknown) {
      setErroCarga(e instanceof Error ? e.message : 'Falha ao remover o controle.');
    } finally {
      setOcupado('');
    }
  };

  if (consulta.erro) return <Aviso tipo="erro">{consulta.erro}</Aviso>;
  if (!consulta.dados) return <Carregando />;
  const d = consulta.dados;
  const p = d.placar;
  const acompanhadas = d.unidades.filter((u) => u.acompanhada);

  return (
    <>
      <Aviso tipo="info">
        A <strong>Visão Macro</strong> pergunta se a unidade virou no dia combinado. Esta pergunta é
        a outra: <strong>atividade a atividade, como está cada unidade?</strong> A linha é uma
        atividade, e cada unidade tem uma situação dentro dela — uma atividade concluída em três
        unidades e não iniciada em outras três é <strong>uma</strong> linha, não seis.
      </Aviso>

      {erroCarga && <Aviso tipo="erro">{erroCarga}</Aviso>}

      <Cartao
        titulo="Carga da planilha"
        descricao={p.total ? `${inteiro(p.total)} atividade(s) carregada(s)` : 'nenhuma atividade carregada ainda'}
        padraoAberto
      >
        {podeEditar ? (
          <>
            <div className="barra-filtros">
              <div className="campo" style={{ minWidth: 300 }}>
                <label htmlFor="controle-arquivo">Arquivo .xlsx do Controle Único</label>
                <input
                  key={geracaoDoCampo}
                  id="controle-arquivo"
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
                onClick={() => void enviar('/api/projetos/controle-unico/analisar', 'analisar')}
              >
                {ocupado === 'analisar' ? 'Conferindo…' : 'Conferir sem gravar'}
              </button>
              <button
                type="button"
                className="botao primario"
                disabled={!arquivo || ocupado !== ''}
                onClick={() => void enviar('/api/projetos/controle-unico', 'gravar')}
              >
                {ocupado === 'gravar' ? 'Gravando…' : 'Carregar e substituir'}
              </button>
              {p.total > 0 && (
                <button
                  type="button"
                  className="botao perigo"
                  disabled={ocupado !== ''}
                  onClick={() => setConfirmarRemocao(true)}
                >
                  Remover o controle
                </button>
              )}
            </div>
            <p className="nota">
              Conferir não grava nada. Carregar <strong>substitui o controle inteiro</strong>: o
              arquivo é a íntegra dele, e mesclar faria uma atividade já removida do documento
              seguir cobrando prazo aqui. As colunas calculadas da planilha são descartadas — elas
              foram escritas contra o dia em que alguém abriu o arquivo.
            </p>
          </>
        ) : (
          <p className="nota">Seu perfil lê o controle, mas não carrega planilha.</p>
        )}

        {analise && <Relatorio leitura={analise} gravou={false} />}
        {gravacao && <Relatorio leitura={gravacao} gravou />}
      </Cartao>

      {p.total === 0 ? (
        <Cartao titulo="Execução do projeto" padraoAberto>
          <p className="vazio">
            Nenhuma atividade carregada ainda. Suba a planilha acima para ver o avanço, o farol de
            cada atividade e o que está bloqueado.
          </p>
        </Cartao>
      ) : (
        <>
          <Cartao
            titulo="Execução do projeto"
            descricao={`recalculado contra hoje, ${diaExib(d.hoje)}`}
            padraoAberto
          >
            <div className="grade c4">
              <Indicador
                rotulo="Atividades"
                numero={inteiro(p.total)}
                apoio={`${inteiro(p.validas)} entram no avanço`}
              />
              <Indicador
                rotulo="Avanço ponderado"
                numero={p.avanco_ponderado === null ? '—' : percentual(p.avanco_ponderado)}
                apoio="pesado pela criticidade"
              />
              <Indicador
                rotulo="Avanço simples"
                numero={p.avanco_simples === null ? '—' : percentual(p.avanco_simples)}
                apoio="sem peso, para comparar"
              />
              <Indicador
                rotulo="Em vermelho"
                numero={inteiro(p.por_farol['VERMELHO'] ?? 0)}
                apoio="bloqueadas ou com prazo vencido"
                tom={(p.por_farol['VERMELHO'] ?? 0) > 0 ? 'critico' : 'neutro'}
              />
            </div>
            <p className="nota">
              O <strong>avanço ponderado</strong> pesa cada atividade pela criticidade — uma de
              go-live vale três vezes uma de evolução. O <strong>simples</strong> vai ao lado para
              a diferença entre os dois ficar visível: quando o ponderado é menor, o que está
              parado é justamente o que mais importa. Atividade cancelada e sem criticidade saem do
              denominador, e continuam aparecendo no total.
            </p>
          </Cartao>

          <Cartao
            titulo="Por unidade"
            descricao={`${inteiro(acompanhadas.length)} unidade(s) com coluna na planilha`}
            padraoAberto
          >
            <div className="tabela-envolucro">
              <table>
                <thead>
                  <tr>
                    <th>Unidade</th>
                    <th className="num">Onda</th>
                    <th className="num">Atividades</th>
                    <th className="num">Avanço</th>
                    <th>Situações</th>
                  </tr>
                </thead>
                <tbody>
                  {d.unidades.map((u) => (
                    <tr key={u.chave}>
                      <td>
                        <strong>{u.rotulo}</strong>
                        {u.nome && <div className="arv-comp">{u.nome}</div>}
                      </td>
                      <td className="num">{u.onda ? `${u.onda}ª` : '—'}</td>
                      <td className="num">{u.acompanhada ? inteiro(u.atividades) : '—'}</td>
                      <td className="num">
                        {u.avanco === null ? (
                          <span className="vazio">
                            {u.acompanhada ? 'sem base' : 'sem coluna na planilha'}
                          </span>
                        ) : percentual(u.avanco)}
                      </td>
                      <td>
                        {Object.entries(u.por_status).map(([s, n]) => (
                          <Etiqueta key={s} texto={`${s}: ${inteiro(n)}`} tom={TOM_SITUACAO[s] ?? 'neutro'} />
                        ))}
                        {!u.acompanhada && <span className="vazio">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="nota">
              A unidade <strong>sem coluna na planilha</strong> não está em zero: ela está sem base.
              A planilha ainda não pergunta por ela, e dizer 0% afirmaria um atraso que ninguém
              mediu. O avanço aqui é o <strong>da unidade</strong>, e não o consolidado — o
              consolidado é o pior caso, e uma unidade que já terminou tudo desapareceria dentro
              dele.
            </p>
          </Cartao>

          <Cartao
            titulo="Atividades"
            descricao={`${inteiro(lista.length)} de ${inteiro(atividades.length)} · da mais urgente para a menos`}
            padraoAberto
          >
            <div className="barra-filtros">
              <Corte
                campo="frente"
                rotulo="Frente"
                valor={corte.frente}
                aoMudar={(v) => setCorte((c) => ({ ...c, frente: v }))}
                opcoes={valoresDe('frente').map((s) => ({ valor: s, rotulo: s }))}
              />
              <Corte
                campo="farol"
                rotulo="Farol"
                valor={corte.farol}
                aoMudar={(v) => setCorte((c) => ({ ...c, farol: v }))}
                opcoes={(['VERMELHO', 'AMARELO', 'VERDE', 'N/A'] as Farol[])
                  .map((s) => ({ valor: s, rotulo: s }))}
              />
              <Corte
                campo="unidade"
                rotulo="Unidade"
                valor={corte.unidade}
                aoMudar={(v) => setCorte((c) => ({ ...c, unidade: v }))}
                opcoes={acompanhadas.map((u) => ({ valor: u.chave, rotulo: u.rotulo }))}
              />
              <Corte
                campo="situacao"
                rotulo={corte.unidade ? 'Situação na unidade' : 'Situação consolidada'}
                valor={corte.situacao}
                aoMudar={(v) => setCorte((c) => ({ ...c, situacao: v }))}
                opcoes={['Concluído', 'Em andamento', 'Não iniciado', 'Bloqueado', 'Cancelado']
                  .map((s) => ({ valor: s, rotulo: s }))}
              />
              <div className="campo" style={{ minWidth: 200 }}>
                <label htmlFor="controle-busca">Buscar</label>
                <input
                  id="controle-busca"
                  type="search"
                  value={corte.busca}
                  placeholder="atividade, ID, frente, executante…"
                  onChange={(e) => setCorte((c) => ({ ...c, busca: e.target.value }))}
                />
              </div>
              <button
                type="button"
                className="botao"
                onClick={() => setCorte({ frente: '', farol: '', unidade: '', situacao: '', busca: '' })}
              >
                Limpar filtros
              </button>
            </div>

            {lista.length === 0 ? (
              <p className="vazio">Nenhuma atividade neste recorte.</p>
            ) : (
              <div className="tabela-envolucro">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Atividade</th>
                      <th>Frente</th>
                      <th>Criticidade</th>
                      <th>Consolidado</th>
                      {acompanhadas.map((u) => <th key={u.chave}>{u.rotulo}</th>)}
                      <th>Farol</th>
                      <th aria-label="Detalhe" />
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((a) => (
                      <tr key={a.chave}>
                        <td>{a.id_origem}</td>
                        <td className="texto">{a.atividade}</td>
                        <td>{ou(a.frente)}</td>
                        <td>{ou(a.criticidade)}</td>
                        <td>
                          {a.status_consolidado
                            ? <Etiqueta texto={a.status_consolidado} tom={TOM_SITUACAO[a.status_consolidado] ?? 'neutro'} />
                            : <span className="vazio">sem situação</span>}
                        </td>
                        {acompanhadas.map((u) => (
                          <td key={u.chave}>
                            {a.unidades?.[u.chave]
                              ? <Etiqueta texto={a.unidades[u.chave]!} tom={TOM_SITUACAO[a.unidades[u.chave]!] ?? 'neutro'} />
                              : <span className="vazio">—</span>}
                          </td>
                        ))}
                        <td><Etiqueta texto={a.farol} tom={TOM_FAROL[a.farol]} /></td>
                        <td>
                          <button type="button" className="botao" onClick={() => setDetalhe(a)}>
                            Ver
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
        titulo={detalhe ? `${detalhe.id_origem} · ${detalhe.atividade}` : ''}
        aberto={detalhe !== null}
        aoFechar={() => setDetalhe(null)}
        tipo="controle-unico"
      >
        {detalhe && (
          <>
            <dl className="ficha">
              <dt>Frente</dt><dd>{ou(detalhe.frente)}</dd>
              <dt>Grupo / time</dt><dd>{ou(detalhe.grupo_time)}</dd>
              <dt>Tipo de entrega</dt><dd>{ou(detalhe.tipo_entrega)}</dd>
              <dt>Criticidade</dt><dd>{ou(detalhe.criticidade)}</dd>
              <dt>Líder</dt><dd>{ou(detalhe.lider)}</dd>
              <dt>Executantes</dt>
              <dd>{detalhe.executantes.length ? detalhe.executantes.join(', ') : '—'}</dd>
              <dt>Caminho no sistema</dt><dd>{ou(detalhe.caminho)}</dd>
              <dt>Data-base da onda</dt><dd>{diaExib(detalhe.data_base_onda)}</dd>
              <dt>Prazo repactuado</dt><dd>{diaExib(detalhe.prazo_repactuado)}</dd>
              <dt>Dias para o prazo</dt>
              <dd>
                {detalhe.dias_para_prazo === null
                  ? '—'
                  : `${inteiro(detalhe.dias_para_prazo)} dia(s)${detalhe.dias_para_prazo < 0 ? ' — vencido' : ''}`}
              </dd>
              <dt>Situação consolidada</dt>
              <dd>
                {detalhe.status_consolidado
                  ? <Etiqueta texto={detalhe.status_consolidado} tom={TOM_SITUACAO[detalhe.status_consolidado] ?? 'neutro'} />
                  : '—'}
              </dd>
              <dt>Igual em todas</dt><dd>{detalhe.status_igual_em_todas || '—'}</dd>
              <dt>Farol</dt><dd><Etiqueta texto={detalhe.farol} tom={TOM_FAROL[detalhe.farol]} /></dd>
            </dl>

            <h3>Por unidade</h3>
            {Object.keys(detalhe.unidades ?? {}).length === 0 ? (
              <p className="nota">Esta atividade não tem situação registrada em nenhuma unidade.</p>
            ) : (
              <p>
                {d.colunas
                  .filter((u) => detalhe.unidades?.[u.chave])
                  .map((u) => (
                    <span key={u.chave} style={{ marginRight: 8 }}>
                      {u.rotulo}:{' '}
                      <Etiqueta
                        texto={detalhe.unidades[u.chave]!}
                        tom={TOM_SITUACAO[detalhe.unidades[u.chave]!] ?? 'neutro'}
                      />
                    </span>
                  ))}
              </p>
            )}

            <h3>Critério de aceite</h3>
            <p className="texto-longo">{detalhe.criterio_aceite || '—'}</p>

            {detalhe.pendencia && (<><h3>Pendência</h3><p className="texto-longo">{detalhe.pendencia}</p></>)}
            {detalhe.proxima_acao && (<><h3>Próxima ação</h3><p className="texto-longo">{detalhe.proxima_acao}</p></>)}
            {detalhe.evidencia && (<><h3>Evidência</h3><p className="texto-longo">{detalhe.evidencia}</p></>)}
            {detalhe.observacoes && (<><h3>Observações</h3><p className="texto-longo">{detalhe.observacoes}</p></>)}
          </>
        )}
      </Modal>

      <Modal
        titulo="Remover o controle carregado"
        aberto={confirmarRemocao}
        aoFechar={() => setConfirmarRemocao(false)}
        tipo="controle-remover"
        acoes={(
          <>
            <button type="button" className="botao" onClick={() => setConfirmarRemocao(false)}>
              Manter o controle
            </button>
            <button
              type="button"
              className="botao perigo"
              disabled={ocupado === 'remover'}
              onClick={() => void remover()}
            >
              {ocupado === 'remover' ? 'Removendo…' : 'Remover as atividades'}
            </button>
          </>
        )}
      >
        <p>
          As {inteiro(p.total)} atividade(s) saem do sistema. O avanço, o farol e a lista ficam
          vazios até a próxima carga.
        </p>
        <p className="nota">A planilha de origem não é afetada — ela não fica guardada aqui.</p>
      </Modal>
    </>
  );
}

function Indicador({
  rotulo, numero, apoio, tom = 'neutro',
}: {
  rotulo: string;
  numero: string;
  apoio?: string;
  tom?: 'neutro' | 'bom' | 'critico' | 'atencao';
}) {
  return (
    <div className="cartao">
      <div className="indicador">
        <span className="rotulo">{rotulo}</span>
        <span className={tom === 'neutro' ? 'numero' : `numero ${tom}`}>{numero}</span>
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
      <label htmlFor={`controle-corte-${campo}`}>{rotulo}</label>
      <select id={`controle-corte-${campo}`} value={valor} onChange={(e) => aoMudar(e.target.value)}>
        <option value="">Todas</option>
        {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
    </div>
  );
}

/**
 * O relatório da leitura — o que entraria, o que falta e o que foi recusado.
 *
 * Os problemas aparecem SEMPRE, inclusive quando a carga deu certo: uma carga
 * que grava em silêncio entrega um controle plausível e errado.
 */
function Relatorio({ leitura, gravou }: { leitura: Leitura | Gravacao; gravou: boolean }) {
  const g = leitura as Gravacao;
  const total = gravou ? g.gravadas : (leitura as Leitura).total;
  const erros = leitura.problemas.filter((p) => p.tipo === 'erro');
  const avisos = leitura.problemas.filter((p) => p.tipo !== 'erro');
  return (
    <div className="ultima-carga">
      <Aviso tipo={leitura.problemas.length ? 'info' : 'ok'}>
        {gravou
          ? `${inteiro(total)} atividade(s) gravada(s)${g.removidas ? `, no lugar de ${inteiro(g.removidas)} anterior(es)` : ''}.`
          : `${inteiro(total)} atividade(s) seriam lidas. Nada foi gravado ainda.`}
      </Aviso>
      <dl className="ficha">
        <dt>Sem executante</dt><dd>{inteiro(leitura.diagnostico.sem_executante)}</dd>
        <dt>Sem caminho no sistema</dt><dd>{inteiro(leitura.diagnostico.sem_caminho)}</dd>
        <dt>Sem criticidade</dt><dd>{inteiro(leitura.diagnostico.sem_criticidade)}</dd>
        <dt>Unidades sem coluna</dt><dd>{inteiro(leitura.diagnostico.unidades_sem_coluna)}</dd>
      </dl>
      {erros.length > 0 && (
        <>
          <h3>{inteiro(erros.length)} linha(s) recusada(s)</h3>
          <ul className="lista-problemas">
            {erros.map((p) => <li key={`e-${p.linha}`}>Linha {p.linha}: {p.texto}</li>)}
          </ul>
        </>
      )}
      {avisos.length > 0 && (
        <>
          <h3>{inteiro(avisos.length)} ponto(s) de atenção</h3>
          <ul className="lista-problemas">
            {avisos.slice(0, 50).map((p, i) => (
              <li key={`a-${p.linha}-${i}`}>Linha {p.linha}: {p.texto}</li>
            ))}
          </ul>
          {avisos.length > 50 && (
            <p className="nota">
              …e mais {inteiro(avisos.length - 50)}. Os cinquenta primeiros bastam para reconhecer
              o padrão; a lista inteira cansaria sem acrescentar nada.
            </p>
          )}
        </>
      )}
    </div>
  );
}
