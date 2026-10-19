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
 */
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useDados } from '../lib/sessao';
import { competenciaExib, competenciaOrdem, competenciaSoma, moeda, percentual } from '../lib/formato';
import type { LeituraDeMeta } from './graficos';
import { atingimentoDaMeta, textoDaMeta, type Atingimento, type DirecaoMeta } from '../lib/resultados';

interface CartaoResultado {
  chave: string;
  nome: string;
  oQue: string;
  resultado: number | null;
  meta: number | null;
  direcao: DirecaoMeta;
  emReais: boolean;
  /** Dito na tela quando o número não pôde ser montado — nunca um número falso. */
  ressalva?: string;
}

interface RespostaIndicadores {
  sla: { total: number; pct_dentro: number; meta: number; meta_leitura: LeituraDeMeta | null };
  projetos: { entregues: number; pct_no_prazo: number; meta_leitura: LeituraDeMeta | null };
}

interface RespostaFinanceiro {
  totais_mes: { total: number; lancamentos: number };
}

/** O alvo de uma leitura de meta, quando ela é de uma meta só. */
function alvoDaLeitura(m: LeituraDeMeta | null | undefined): number | null {
  if (!m) return null;
  if ('varias' in m && m.varias) return null;
  return typeof (m as { alvo?: number }).alvo === 'number' ? (m as { alvo: number }).alvo : null;
}

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
function BarraDeAtingimento({ a, c, fmt, mes }: {
  a: Atingimento; c: CartaoResultado; fmt: (v: number) => string; mes: string;
}) {
  if (a.pct === undefined) {
    return <div className="res-barra vazia" aria-hidden><span /></div>;
  }
  const cheio = Math.max(0, Math.min(100, a.pct));
  const excedeu = a.pct > 100;
  const cor = a.faixa === 'VERDE' ? 'var(--bom)'
    : a.faixa === 'LARANJA' ? 'var(--atencao)' : 'var(--critico)';
  const dica = [
    `Resultado: ${c.resultado === null ? '—' : fmt(c.resultado)}`,
    `Meta: ${c.meta === null ? '—' : fmt(c.meta)}`,
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
        aria-label={`${textoDaMeta(a, c.meta, fmt)} — atingimento de ${percentual(a.pct)}`}
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

function Cartao({ c, mes }: { c: CartaoResultado; mes: string }) {
  const a = atingimentoDaMeta(c.direcao, c.resultado, c.meta);
  const semNumero = a.faixa === 'SEM_DADOS';
  const fmt = (v: number) => (c.emReais ? moeda(v) : percentual(v));
  return (
    <article className={`cartao-resultado faixa-${a.faixa.toLowerCase()}`} data-modulo={c.chave}>
      <h3>
        {c.nome}
        <span className="res-oque">{c.oQue}</span>
      </h3>
      <p className="res-valor">{semNumero || c.resultado === null ? '—' : fmt(c.resultado)}</p>
      <dl className="res-linha">
        <dt>Meta</dt>
        <dd>{c.meta === null ? '—' : fmt(c.meta)}</dd>
        <dt>Atingimento</dt>
        <dd className="res-ating">{a.pct === undefined ? '—' : percentual(a.pct)}</dd>
      </dl>
      <BarraDeAtingimento a={a} c={c} fmt={fmt} mes={mes} />
      <p className="res-texto">{textoDaMeta(a, c.meta, fmt)}</p>
      {c.ressalva && <p className="res-ressalva">{c.ressalva}</p>}
    </article>
  );
}

/** O esqueleto enquanto as duas consultas do mês não voltam. */
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

  const emFoco = meses.includes(mes) ? mes : (meses[0] ?? '');

  // Uma consulta por fonte, e não uma por cartão: três idas para três números
  // do mesmo mês seriam o N+1 desta tela.
  const janela = useMemo(
    () => ({ competencia_inicio: emFoco, competencia_fim: emFoco }),
    [emFoco],
  );
  const ind = useDados<RespostaIndicadores>(
    () =>
      !emFoco ? Promise.resolve(null as unknown as RespostaIndicadores) :
      api.get('/api/indicadores', {
        ...params,
        sla_competencia_inicio: emFoco,
        sla_competencia_fim: emFoco,
        projetos_competencia_inicio: emFoco,
        projetos_competencia_fim: emFoco,
      }),
    [emFoco, JSON.stringify(params)],
  );
  const fin = useDados<RespostaFinanceiro>(
    () => (!emFoco ? Promise.resolve(null as unknown as RespostaFinanceiro)
      : api.get('/api/dashboards/financeiro', { ...params, ...janela })),
    [emFoco, JSON.stringify(params)],
  );

  const erro = lista.erro || ind.erro || fin.erro;
  // Sem a lista ainda não se sabe nem quais meses existem: é carregamento, e
  // não vazio — dizer "nenhum mês" antes de perguntar seria mentir por pressa.
  const carregando = !erro && (!lista.dados || (!!emFoco && (!ind.dados || !fin.dados)));

  const cartoes: CartaoResultado[] = [];
  if (ind.dados && fin.dados) {
    cartoes.push({
      chave: 'financeiro',
      nome: 'Financeiro',
      oQue: 'custo realizado do mês',
      resultado: fin.dados.totais_mes.lancamentos ? fin.dados.totais_mes.total : null,
      // O teto de gasto do Objetivo 03 ainda não existe neste servidor: a
      // tabela de metas guarda alvo em PERCENTUAL, e teto é valor em reais.
      // Enquanto não existir, o cartão diz que não há meta em vez de comparar
      // o custo com um alvo de outra natureza.
      meta: null,
      direcao: 'maximo',
      emReais: true,
      ressalva: 'O teto de gasto ainda não é cadastrável nesta instalação.',
    });
    cartoes.push({
      chave: 'projetos',
      nome: 'Projetos',
      oQue: 'tarefas entregues no prazo',
      // Sem tarefa entregue no mês não há percentual: 0% diria "nenhuma saiu
      // no prazo", quando o que houve foi nenhuma entrega.
      resultado: ind.dados.projetos.entregues ? ind.dados.projetos.pct_no_prazo : null,
      meta: alvoDaLeitura(ind.dados.projetos.meta_leitura),
      direcao: 'minimo',
      emReais: false,
    });
    cartoes.push({
      chave: 'sla',
      nome: 'SLA',
      oQue: 'chamados dentro do prazo',
      resultado: ind.dados.sla.total ? ind.dados.sla.pct_dentro : null,
      meta: ind.dados.sla.meta ?? alvoDaLeitura(ind.dados.sla.meta_leitura),
      direcao: 'minimo',
      emReais: false,
    });
  }

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
        {meses.length > 0 && (
          <label className="campo campo-mes-resultados">
            <span>Mês</span>
            <select value={emFoco} onChange={(e) => setMes(e.target.value)} data-mes-resultados>
              {meses.map((m) => (
                <option value={m} key={m}>
                  {competenciaExib(m)}
                </option>
              ))}
            </select>
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
            <Cartao c={c} mes={emFoco} key={c.chave} />
          ))}
        </div>
      )}
    </section>
  );
}

/** O mês anterior ao corrente: o último FECHADO, que é o que se mede. */
export const mesFechadoMaisRecente = () => {
  const hoje = new Date();
  return competenciaSoma(
    `${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`,
    -1,
  );
};
