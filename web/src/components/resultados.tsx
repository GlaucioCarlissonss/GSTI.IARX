/**
 * RESULTADOS — o placar das três frentes, num bloco só.
 *
 * Os indicadores de cada módulo respondem bem a pergunta de dentro dele:
 * quanto custou, quantas tarefas saíram no prazo, qual foi a conformidade.
 * Nenhum responde a de cima — das três frentes, quais fecharam o mês dentro do
 * que foi combinado? Para saber isso era preciso abrir os três blocos e
 * comparar cada número com a meta dele, de cabeça.
 *
 * O bloco fica ABAIXO e FORA das caixas de módulo, de propósito: ele não
 * pertence a nenhuma das três, e pendurá-lo em uma faria procurar o resultado
 * de Projetos dentro de Financeiro.
 *
 * O MÊS é deste bloco, e não dos filtros dos módulos: cada um dos três tem a
 * sua janela, e três janelas diferentes não produzem "o mês do resultado".
 *
 * DUAS CONSULTAS, TREZE MESES. A faixa mês a mês não pede um mês por vez: as
 * duas rotas já devolvem a série do período, e é dela que saem tanto os
 * marcadores da faixa quanto os números do cartão em foco. Por isso trocar o
 * mês selecionado não vai ao servidor — o dado dos treze meses já está aqui.
 */
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useDados } from '../lib/sessao';
import {
  competenciaExib, competenciaOrdem, competenciaSoma, mesCurto, moeda, percentual,
} from '../lib/formato';
import {
  Detalhamento, detalheDeLancamentos, detalheDeRegistrosSla, detalheDeViradas,
  type PedidoDetalhe,
} from './detalhamento';
import { atingimentoDaMeta, textoDaMeta, type Atingimento, type DirecaoMeta } from '../lib/resultados';

/** O resultado de UM mês num módulo — o que o cartão mostra quando ele está em foco. */
interface PontoResultado {
  resultado: number | null;
  meta: number | null;
  /** Quantos registros compõem o número, para a conferência do detalhamento. */
  registros: number;
  /**
   * O mês ainda não fechou, e este indicador ACUMULA — custo e conformidade
   * pela metade contra a meta cheia reprovariam o começo de todo mês. Não é a
   * mesma coisa que "sem dados": há dados, o mês é que não acabou, e trocar
   * uma frase pela outra faria procurar um buraco que não existe.
   */
  emCurso?: boolean;
}

interface CartaoResultado {
  chave: 'financeiro' | 'projetos' | 'sla';
  nome: string;
  oQue: string;
  direcao: DirecaoMeta;
  emReais: boolean;
  /** Dito na tela quando o número não pôde ser montado — nunca um número falso. */
  ressalva?: string;
  /** O filtro de natureza alcança este cartão, e ele diz isso na tela. */
  filtrado?: boolean;
  /** O resultado de cada mês da janela, indexado por MM/AAAA. */
  pontos: Map<string, PontoResultado>;
}

interface PontoSerie {
  competencia: string;
  pct: number | null;
  alvo: number | null;
}

interface RespostaIndicadores {
  sla: { serie: Array<PontoSerie & { total: number; dentro: number }> };
  projetos: { serie: Array<PontoSerie & { entregues: number; no_prazo: number }> };
}

interface RespostaCronograma {
  serie: Array<{
    competencia: string; planejadas: number; viradas: number;
    resultado: number | null; meta: number | null;
  }>;
}

interface RespostaFinanceiro {
  evolucao_mensal: Array<{
    competencia: string; total: number; lancamentos: number;
    /** A parcela recorrente fixa do mês, que o filtro de natureza isola. */
    fixa: number; lancamentos_fixa: number;
  }>;
}

const VAZIO: PontoResultado = { resultado: null, meta: null, registros: 0 };

/**
 * A BARRA DE ATINGIMENTO: o quanto da meta foi cumprido, em comprimento.
 *
 * O preenchimento para em 100% de propósito. Uma barra que passasse da caixa
 * perderia a referência — "cheia" deixaria de querer dizer "meta atingida" —, e
 * duas metas superadas por margens diferentes ficariam com a mesma aparência
 * de transbordo. O excedente vira uma marca no fim e uma frase ao lado.
 *
 * `role="progressbar"` com `aria-valuenow` é o que faz o leitor de tela
 * anunciar o número; o `aria-label` carrega a frase da meta por extenso,
 * porque "83,5" sozinho não diz de quê.
 */
function BarraDeAtingimento({ a, c, p, fmt, mes }: {
  a: Atingimento; c: CartaoResultado; p: PontoResultado; fmt: (v: number) => string; mes: string;
}) {
  if (a.pct === undefined) {
    return <div className="res-barra vazia" aria-hidden><span /></div>;
  }
  const cheio = Math.max(0, Math.min(100, a.pct));
  const excedeu = a.pct > 100;
  const cor = a.faixa === 'VERDE' ? 'var(--bom)'
    : a.faixa === 'LARANJA' ? 'var(--atencao)' : 'var(--critico)';
  const dica = [
    `Resultado: ${p.resultado === null ? '—' : fmt(p.resultado)}`,
    `Meta: ${p.meta === null ? '—' : fmt(p.meta)}`,
    `Atingimento: ${percentual(a.pct)}`,
    c.direcao === 'maximo'
      ? 'Direção: menor é melhor — a meta é um teto'
      : 'Direção: maior é melhor — a meta é um piso',
    `Mês de referência: ${competenciaExib(mes)}`,
  ].join('\n');
  return (
    <>
      <div
        className={`res-barra faixa-${a.faixa.toLowerCase()}`}
        role="progressbar"
        aria-valuenow={Number(a.pct.toFixed(1))}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${textoDaMeta(a, p.meta, fmt, p.emCurso)} — atingimento de ${percentual(a.pct)}`}
        title={dica}
      >
        <span className="res-trilha" aria-hidden>
          <i style={{ width: `${cheio.toFixed(1)}%`, background: cor }} />
          {excedeu && <em className="res-excedeu" />}
        </span>
        <b className="res-pct">{percentual(a.pct)}</b>
      </div>
      {excedeu && <p className="res-excesso">Meta superada em {percentual(a.pct - 100)}.</p>}
    </>
  );
}

/**
 * A FAIXA MÊS A MÊS: treze semáforos lado a lado, do mais antigo ao mais novo.
 *
 * A barra do cartão diz como foi ESTE mês; ela sozinha não distingue um mês
 * ruim isolado de uma queda que já dura um semestre — e são leituras que pedem
 * reações opostas. A faixa põe o mês em série, e aí a pergunta "é pontual ou é
 * tendência?" se responde de relance.
 *
 * Cada mês é um botão: o rótulo escrito fica visível (cor sozinha não informa
 * quem não a distingue) e o `aria-label` carrega a frase inteira da situação,
 * porque "jul/26" sozinho não diz como o mês foi.
 */
function FaixaDeMeses({ c, meses, emFoco, aoEscolher, fmt }: {
  c: CartaoResultado;
  meses: string[];
  emFoco: string;
  aoEscolher: (m: string) => void;
  fmt: (v: number) => string;
}) {
  if (meses.length < 2) return null;
  return (
    <div className="res-meses" role="group" aria-label={`Atingimento mês a mês de ${c.nome}`}>
      {meses.map((m) => {
        const p = c.pontos.get(m) ?? VAZIO;
        const a = atingimentoDaMeta(c.direcao, p.resultado, p.meta);
        const sel = m === emFoco;
        const dica = [
          `${c.nome} · ${competenciaExib(m)}`,
          `Resultado: ${p.resultado === null ? '—' : fmt(p.resultado)}`,
          `Meta: ${p.meta === null ? '—' : fmt(p.meta)}`,
          `Atingimento: ${a.pct === undefined ? '—' : percentual(a.pct)}`,
          `Situação: ${textoDaMeta(a, p.meta, fmt, p.emCurso)}`,
        ].join('\n');
        return (
          <button
            type="button"
            key={m}
            className={`res-mes faixa-${a.faixa.toLowerCase()}${sel ? ' sel' : ''}`}
            data-mes-faixa={m}
            aria-pressed={sel}
            aria-label={`${competenciaExib(m)}: ${textoDaMeta(a, p.meta, fmt, p.emCurso)}`}
            title={dica}
            onClick={() => aoEscolher(m)}
          >
            <span className="res-mes-rot">{mesCurto(competenciaExib(m))}</span>
            <span className="res-mes-pt" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/**
 * A variação do atingimento contra o mês anterior, em PONTOS PERCENTUAIS.
 *
 * Pontos percentuais, e não percentual do percentual: de 80% para 90% a
 * diferença é de 10 p.p., e dizer "subiu 12,5%" sobre dois percentuais é o
 * tipo de frase que ninguém confere de cabeça.
 */
function DeltaDoAtingimento({ c, mes }: { c: CartaoResultado; mes: string }) {
  const anterior = competenciaSoma(mes, -1);
  const atual = c.pontos.get(mes) ?? VAZIO;
  const antes = c.pontos.get(anterior) ?? VAZIO;
  const a = atingimentoDaMeta(c.direcao, atual.resultado, atual.meta);
  const b = atingimentoDaMeta(c.direcao, antes.resultado, antes.meta);
  if (a.pct === undefined || b.pct === undefined) {
    return <p className="res-delta vazio-delta">Sem comparação com {competenciaExib(anterior)}.</p>;
  }
  const d = Math.round((a.pct - b.pct) * 10) / 10;
  // Aqui, ao contrário do custo, SUBIR é bom: é o atingimento da meta.
  const sentido = d > 0 ? 'desce' : d < 0 ? 'sobe' : 'zero';
  const seta = d > 0 ? '↑' : d < 0 ? '↓' : '=';
  return (
    <p className="res-delta">
      <span className={`delta ${sentido}`}>{seta} {percentual(Math.abs(d)).replace('%', ' p.p.')}</span>{' '}
      <span className="camada-qtd">vs {competenciaExib(anterior)}</span>
    </p>
  );
}

function Cartao({ c, mes, meses, aoEscolher, aoDetalhar }: {
  c: CartaoResultado;
  mes: string;
  meses: string[];
  aoEscolher: (m: string) => void;
  aoDetalhar: () => void;
}) {
  const p = c.pontos.get(mes) ?? VAZIO;
  const a = atingimentoDaMeta(c.direcao, p.resultado, p.meta);
  const fmt = (v: number) => (c.emReais ? moeda(v) : percentual(v));
  return (
    <article
      className={`cartao-resultado faixa-${a.faixa.toLowerCase()}${c.filtrado ? ' res-filtrado' : ''}`}
      data-modulo={c.chave}
    >
      <h3>
        {c.nome}
        {/* O cartão filtrado DIZ que está filtrado, e diz aqui: uma marca só
            no cabeçalho do bloco faria o número menor parecer queda de custo
            para quem chega na tela com o filtro já ligado. */}
        {c.filtrado && (
          <span
            className="marca-filtro"
            title="O cartão está restrito à despesa recorrente fixa."
          >
            só fixas
          </span>
        )}
        <span className="res-oque">{c.oQue}</span>
      </h3>
      <p className="res-valor">{p.resultado === null ? '—' : fmt(p.resultado)}</p>
      <dl className="res-linha">
        <dt>Meta</dt>
        <dd>{p.meta === null ? '—' : fmt(p.meta)}</dd>
        <dt>Atingimento</dt>
        <dd className="res-ating">{a.pct === undefined ? '—' : percentual(a.pct)}</dd>
      </dl>
      <BarraDeAtingimento a={a} c={c} p={p} fmt={fmt} mes={mes} />
      <p className="res-texto">{textoDaMeta(a, p.meta, fmt, p.emCurso)}</p>
      <DeltaDoAtingimento c={c} mes={mes} />
      <FaixaDeMeses c={c} meses={meses} emFoco={mes} aoEscolher={aoEscolher} fmt={fmt} />
      <button type="button" className="botao discreto res-ver" onClick={aoDetalhar} disabled={!p.registros}>
        Ver registros de {competenciaExib(mes)}
      </button>
      {c.ressalva && <p className="res-ressalva">{c.ressalva}</p>}
    </article>
  );
}

/** O esqueleto enquanto as duas consultas do período não voltam. */
function Esqueleto() {
  return (
    <div className="grade-resultados" aria-hidden>
      {[0, 1, 2].map((i) => (
        <article className="cartao-resultado esqueleto" key={i}>
          <span className="esq-linha esq-titulo" />
          <span className="esq-linha esq-valor" />
          <span className="esq-linha" />
          <span className="esq-linha esq-curta" />
        </article>
      ))}
    </div>
  );
}

export function BlocoResultados({
  params,
}: {
  /** O recorte de cliente/unidade da tela — o bloco não inventa o seu. */
  params: Record<string, unknown>;
}) {
  const [mes, setMes] = useState<string>('');
  // O filtro de natureza do bloco. Recorte de leitura, e por isso só de
  // sessão — como o mês, e pelo mesmo motivo: não é configuração do cliente.
  const [soFixas, setSoFixas] = useState(false);
  const [detalhe, setDetalhe] = useState<PedidoDetalhe<Record<string, unknown>> | null>(null);

  // A lista de meses sai da mesma rota que a tela de Financeiro usa. Pedir ao
  // bloco que a receba pronta obrigaria toda tela que o monta a buscá-la.
  const lista = useDados<Array<{ competencia: string }>>(
    () => api.get('/api/lancamentos/competencias/lista', params),
    [JSON.stringify(params)],
  );
  const meses = useMemo(() => {
    const fechado = mesFechadoMaisRecente();
    return (lista.dados ?? [])
      .map((m) => m.competencia)
      // O mês em curso está pela metade: medi-lo contra a meta cheia do mês
      // reprovaria todo começo de mês por incompletude.
      .filter((c) => competenciaOrdem(c) <= competenciaOrdem(fechado))
      .sort((a, b) => competenciaOrdem(b).localeCompare(competenciaOrdem(a)));
  }, [lista.dados]);

  // Os treze meses mais recentes, do mais antigo para o mais novo: a faixa se
  // lê da esquerda para a direita, como o tempo. A janela é FIXA — escolher um
  // mês dentro dela não a desloca, senão a faixa fugiria sob o dedo de quem
  // clica.
  const fechados = useMemo(() => meses.slice(0, 13).reverse(), [meses]);
  const inicio = fechados[0] ?? '';
  // A janela das consultas vai até o MÊS CORRENTE, e não até o último
  // fechado: é lá que mora a virada de 01/10, e pedir só até setembro
  // esconderia por trinta dias a única entrega que o programa fez.
  const ateConsulta = fechados.length ? mesCorrente() : '';

  const ind = useDados<RespostaIndicadores>(
    () =>
      !fim ? Promise.resolve(null as unknown as RespostaIndicadores) :
      api.get('/api/indicadores', {
        ...params,
        sla_competencia_inicio: inicio,
        sla_competencia_fim: ateConsulta,
        projetos_competencia_inicio: inicio,
        projetos_competencia_fim: ateConsulta,
      }),
    [inicio, ateConsulta, JSON.stringify(params)],
  );
  // O cronograma não depende de recorte de empresa nem de filial — ele é do
  // programa inteiro —, e por isso não leva `params`: mandá-los faria toda
  // troca de filtro recarregar algo que filtro nenhum muda.
  const cron = useDados<RespostaCronograma>(
    () => (!ateConsulta ? Promise.resolve(null as unknown as RespostaCronograma)
      : api.get('/api/indicadores/cronograma', { de: inicio, ate: ateConsulta })),
    [inicio, ateConsulta],
  );
  const fin = useDados<RespostaFinanceiro>(
    () => (!fim ? Promise.resolve(null as unknown as RespostaFinanceiro)
      : api.get('/api/dashboards/financeiro', {
        ...params, competencia_inicio: inicio, competencia_fim: ateConsulta,
      })),
    [inicio, ateConsulta, JSON.stringify(params)],
  );

  // O MÊS CORRENTE ENTRA NA FAIXA QUANDO JÁ CARREGA UM FATO FECHADO.
  //
  // Ele fica de fora porque custo e chamado ACUMULAM. Uma virada não acumula
  // — aconteceu num dia, e o dia passou —, e esconder a entrega até o mês
  // virar seria esconder a única coisa que o programa entregou.
  const pontoCorrente = (cron.dados?.serie ?? [])
    .find((p) => p.competencia === mesCorrente());
  const faixa = useMemo(
    () => (pontoCorrente && pontoCorrente.planejadas > 0
      ? [...fechados, mesCorrente()] : fechados),
    [fechados, pontoCorrente?.planejadas],
  );
  const fim = faixa[faixa.length - 1] ?? '';
  const emFoco = faixa.includes(mes) ? mes : fim;

  const erro = lista.erro || ind.erro || fin.erro || cron.erro;
  // Sem a lista ainda não se sabe nem quais meses existem: é carregamento, e
  // não vazio — dizer "nenhum mês" antes de perguntar seria mentir por pressa.
  const carregando = !erro && (!lista.dados || (!!ateConsulta && (!ind.dados || !fin.dados || !cron.dados)));

  const cartoes: CartaoResultado[] = useMemo(() => {
    if (!ind.dados || !fin.dados || !cron.dados) return [];
    const porMes = <T,>(linhas: T[], chave: (l: T) => string, ponto: (l: T) => PontoResultado) =>
      new Map(linhas.map((l) => [competenciaExib(chave(l)), ponto(l)]));
    return [
      {
        chave: 'financeiro' as const,
        nome: 'Financeiro',
        oQue: soFixas
          ? 'despesa fixa recorrente do mês'
          : 'custo realizado do mês',
        direcao: 'maximo' as const,
        emReais: true,
        // O teto de gasto do Objetivo 03 ainda não existe neste servidor: a
        // tabela de metas guarda alvo em PERCENTUAL, e teto é valor em reais.
        // Enquanto não existir, o cartão diz que não há meta em vez de comparar
        // o custo com um alvo de outra natureza — e isso vale com o filtro
        // ligado ou desligado: sem teto geral também não há teto de fixas.
        ressalva: 'O teto de gasto ainda não é cadastrável nesta instalação.',
        filtrado: soFixas,
        pontos: porMes(fin.dados.evolucao_mensal, (l) => l.competencia, (l) => (
          l.competencia === mesCorrente()
            ? { resultado: null, meta: null, registros: 0, emCurso: true }
            : {
          // Mês sem lançamento nenhum não custou R$ 0,00 — não há o que dizer
          // dele, e o zero da série é só o preenchimento do buraco do gráfico.
          // Vale igual para a parcela fixa: um mês só de pontuais não tem
          // custo fixo "de R$ 0,00", tem custo fixo nenhum a declarar.
              resultado: soFixas
                ? (l.lancamentos_fixa ? l.fixa : null)
                : (l.lancamentos ? l.total : null),
              meta: null,
              registros: soFixas ? l.lancamentos_fixa : l.lancamentos,
            })),
      },
      {
        chave: 'projetos' as const,
        nome: 'Projetos',
        // O RESULTADO DE PROJETOS É A ENTREGA DO CRONOGRAMA, e não a contagem
        // de tarefas. O que a diretoria pergunta deste módulo é se as unidades
        // viraram no prazo combinado — é esse o compromisso do programa. A
        // contagem de tarefas continua nos indicadores do módulo, onde
        // responde "como anda a execução".
        oQue: 'unidades viradas no cronograma',
        direcao: 'minimo' as const,
        emReais: false,
        pontos: porMes(cron.dados.serie, (l) => l.competencia, (l) => ({
          // Nenhuma onda vencida até o mês não é 0%: é uma meta que ainda não
          // chegou, e zero reprovaria o programa por um prazo que não passou.
          resultado: l.resultado,
          meta: l.meta,
          registros: l.planejadas,
        })),
      },
      {
        chave: 'sla' as const,
        nome: 'SLA',
        // A mesma frase do artifact, palavra por palavra: o cartão do celular
        // e o do navegador descrevem a mesma medida, e descrevê-la com outras
        // palavras faz duvidar se é a mesma.
        oQue: 'chamados resolvidos dentro do prazo',
        direcao: 'minimo' as const,
        emReais: false,
        pontos: porMes(ind.dados.sla.serie, (l) => l.competencia, (l) => (
          l.competencia === mesCorrente()
            ? { resultado: null, meta: null, registros: 0, emCurso: true }
            : { resultado: l.pct, meta: l.alvo, registros: l.total })),
      },
    ];
    // `soFixas` entra na dependência, e não nas consultas: a série dos treze
    // meses já traz as duas somas, então ligar o filtro recalcula em memória
    // e não vai ao servidor — o mesmo trato do seletor de mês.
  }, [ind.dados, fin.dados, cron.dados, soFixas]);

  /**
   * OS REGISTROS QUE COMPÕEM O RESULTADO DO MÊS.
   *
   * Cada módulo abre a sua própria lista, no mesmo recorte que produziu o
   * número — é essa igualdade que faz a conferência do rodapé do modal valer
   * alguma coisa.
   */
  const abrir = (c: CartaoResultado) => {
    const p = c.pontos.get(emFoco) ?? VAZIO;
    const janela = { ...params, competencia_inicio: emFoco, competencia_fim: emFoco };
    const quando = competenciaExib(emFoco);
    if (c.chave === 'financeiro') {
      // O MESMO recorte do cartão, filtro incluído: o modal que listasse tudo
      // sob um cartão que soma só as fixas acusaria uma divergência que não
      // existe, e quem conferisse na mão não acharia o número de volta.
      setDetalhe(detalheDeLancamentos(
        soFixas ? `Despesa fixa de ${quando}` : `Custo de ${quando}`,
        soFixas ? { ...janela, natureza: 'fixa' } : janela,
        p.resultado,
        soFixas
          ? 'Só a despesa recorrente fixa do mês, do maior para o menor valor —'
            + ' pontuais e investimentos ficaram de fora, aqui e no cartão.'
          : 'Os lançamentos que somam o resultado do mês, do maior para o menor valor.',
      ));
    } else if (c.chave === 'projetos') {
      // O detalhamento acompanha o que o cartão mede: unidades e prazos de
      // virada, e não tarefas. Abrir tarefas sob um número de cronograma
      // faria o clique responder outra pergunta.
      setDetalhe(detalheDeViradas(
        `Unidades e prazos de virada até ${quando}`, { ate: emFoco }, p.registros,
      ));
    } else {
      setDetalhe(detalheDeRegistrosSla(
        `Chamados de ${quando}`, janela, p.registros,
        'Os registros de atendimento que formam a conformidade deste mês.',
      ));
    }
  };

  return (
    <section className="cartao bloco-resultados">
      <header className="res-cabecalho">
        <div>
          <h2>Resultados</h2>
          <p className="res-sub">
            O atingimento da meta do mês nos três módulos, lado a lado — é a leitura de cima, que
            nenhum indicador sozinho dá.
          </p>
        </div>
        {faixa.length > 0 && (
          <label className="campo campo-mes-resultados">
            <span>Mês</span>
            <select value={emFoco} onChange={(e) => setMes(e.target.value)} data-mes-resultados>
              {[...faixa].reverse().map((m) => (
                <option value={m} key={m}>
                  {competenciaExib(m)}
                </option>
              ))}
            </select>
          </label>
        )}
        {faixa.length > 0 && (
          <label
            className="filtro-fixas"
            title="Restringe o cartão Financeiro à despesa recorrente fixa."
          >
            <input
              type="checkbox"
              checked={soFixas}
              onChange={(e) => setSoFixas(e.target.checked)}
              data-so-fixas
            />
            <span>Somente despesas fixas (recorrentes)</span>
            <small>Afeta o cartão Financeiro; Projetos e SLA não têm despesa.</small>
          </label>
        )}
      </header>

      {carregando ? (
        <Esqueleto />
      ) : meses.length === 0 ? (
        <p className="vazio">
          Nenhum mês fechado no recorte deste cliente. Carregue lançamentos para o bloco ter o que
          medir.
        </p>
      ) : erro ? (
        <p className="vazio res-falhou">
          Não foi possível carregar os resultados de {competenciaExib(emFoco)}. Tente de novo; se
          persistir, confira o recorte de unidades acima.
        </p>
      ) : (
        <div className="grade-resultados">
          {cartoes.map((c) => (
            <Cartao
              c={c}
              mes={emFoco}
              meses={faixa}
              // O mês é do BLOCO, e não de cada cartão: três cartões em três
              // meses diferentes seriam três leituras que não se comparam, que
              // é exatamente o que este bloco existe para evitar.
              aoEscolher={setMes}
              aoDetalhar={() => abrir(c)}
              key={c.chave}
            />
          ))}
        </div>
      )}

      {detalhe && <Detalhamento pedido={detalhe} aoFechar={() => setDetalhe(null)} />}
    </section>
  );
}

/** A competência de hoje, em MM/AAAA. */
export const mesCorrente = () => {
  const hoje = new Date();
  return `${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
};

/** O mês anterior ao corrente: o último FECHADO, que é o que se mede. */
export const mesFechadoMaisRecente = () => {
  const hoje = new Date();
  return competenciaSoma(
    `${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`,
    -1,
  );
};
