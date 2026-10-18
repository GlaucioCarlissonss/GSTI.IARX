/**
 * Detalhamento — o drill-down padrão de todo gráfico e todo indicador.
 *
 * Um número numa tela é sempre a soma de registros. Clicar nele abre esses
 * registros, com o MESMO recorte que produziu o número — é essa a garantia que
 * faz o detalhamento valer: se viesse de outra consulta, poderia divergir do
 * que está na tela, e o gestor não teria como saber qual dos dois está certo.
 *
 * Os dados vêm sob demanda: a tela só busca quando o detalhamento abre.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { Aviso, Carregando, Etiqueta, Modal } from './base';
import {
  competenciaExib, competenciaOrdem, competenciaSoma,
  inteiro, moeda, percentual, ROTULO_STATUS_PROJETO, ROTULO_STATUS_TAREFA,
} from '../lib/formato';
import { ligarColunasAjustaveis } from '../lib/colunas';
import { coresDasMatrizes } from '../lib/cores';
import { useSessao } from '../lib/sessao';
import { EtiquetaConsumo, type ComConsumoEEmpresa } from './consumo';

/** Coluna do detalhamento. `n` alinha à direita, para números. */
export interface ColunaDetalhe<T> {
  rotulo: string;
  valor: (linha: T) => ReactNode;
  /** Alinha à direita, para números. */
  n?: boolean;
  /** Texto longo: quebra em linha em vez de cortar, e usa o espaço que houver. */
  texto?: boolean;
}

export interface PedidoDetalhe<T = Record<string, unknown>> {
  /** O que está sendo detalhado — vira o título do modal. */
  titulo: string;
  /** Uma linha de contexto: o recorte, a ressalva, o que for necessário. */
  subtitulo?: string;
  /** Caminho e parâmetros da consulta. Buscada só quando o modal abre. */
  caminho: string;
  params?: Record<string, unknown>;
  /** Lê os registros da resposta (formatos variam por módulo). */
  extrair?: (resposta: unknown) => T[];
  /**
   * Quantos registros existem no recorte, quando a resposta é paginada e traz
   * menos linhas do que o total. Sem isto, uma lista cortada somaria menos que
   * o indicador e a tela acusaria uma divergência que não existe.
   */
  contarNaResposta?: (resposta: unknown) => number;
  /**
   * A soma do recorte inteiro, calculada pelo servidor. Só é necessária quando
   * a lista pode vir cortada: aí a soma das linhas visíveis não serve de
   * conferência, mas a do servidor sim.
   */
  somaNaResposta?: (resposta: unknown) => number;
  /** O número que estava na tela, para a conferência ficar explícita. */
  total?: number | null;
  /** Como somar cada registro, para conferir com o total. */
  somar?: (linha: T) => number;
  formatarTotal?: (v: number) => string;
  colunas: Array<ColunaDetalhe<T>>;
  /**
   * Abre o detalhamento em CAMADAS comparativas em vez de uma lista só. Vale
   * para o que é somado por competência — lançamentos —, e só tem efeito
   * quando os parâmetros trazem uma janela de competência de onde tirar o mês
   * filtrado e o anterior a ele.
   */
  comparativo?: boolean;
}

/** Teto de linhas exibidas. Acima disso a tela some antes de ajudar. */
const TETO = 300;

// ---------------------------------------- detalhamento comparativo mês a mês
//
// O detalhamento de um indicador financeiro deixa de ser UMA lista e passa a
// ser camadas empilhadas, cada uma respondendo uma pergunta diferente:
//
//   1. quanto mudou em relação ao mês anterior — e para que lado;
//   2. o que veio no mês filtrado, e com que peso cada parte;
//   3. o que havia no mês anterior, para separar o que se repetiu do que cessou.
//
// Uma lista só respondia a segunda. As outras duas o gestor fazia de cabeça,
// abrindo dois meses em duas telas e comparando no olho.
//
// É a mesma estrutura do artifact, com uma diferença que vem do meio: lá os
// lançamentos estão todos na memória e a comparação é de graça; aqui cada mês
// é uma consulta. Por isso o mês anterior é buscado UMA vez, junto com o
// principal — e não por linha, que seria o N+1 — e as tabelas de cada camada
// só são montadas quando a camada abre.

/** A janela de competência de um pedido, quando ele tem uma. */
function janelaDoPedido(params?: Record<string, unknown>) {
  const ini = params?.competencia_inicio ? String(params.competencia_inicio) : '';
  const fim = params?.competencia_fim ? String(params.competencia_fim) : '';
  if (!ini || !fim) return null;
  // O mês em foco é o ÚLTIMO da janela: num recorte de nove meses, "e agora,
  // como está?" é uma pergunta sobre o mês mais recente, não sobre o primeiro.
  const foco = competenciaOrdem(fim) >= competenciaOrdem(ini) ? fim : ini;
  const anterior = competenciaSoma(foco, -1);
  if (!anterior) return null;
  return { ini, fim, foco, anterior, multiMes: competenciaOrdem(ini) !== competenciaOrdem(fim) };
}

/** O que uma consulta de um mês devolveu, já somado. */
interface Fatia<T> { itens: T[]; contagem: number; soma: number | null; cortada: boolean }

const SETA_DELTA = { sobe: '↑', desce: '↓', zero: '=' } as const;

/**
 * Um nó da hierarquia Empresa → Filial, com os lançamentos embaixo.
 *
 * `valor` é a soma do nó, e é por ela que os irmãos se ordenam — a regra da
 * tela inteira é valor DECRESCENTE, em todos os níveis.
 */
interface NoDaUnidade<T> {
  chave: string;
  nome: string;
  cor?: string;
  valor: number;
  itens: T[];
  filhos: Array<NoDaUnidade<T>>;
}

/**
 * Agrupa os lançamentos em Empresa → Filial.
 *
 * A empresa não vem escrita no lançamento: o relatório devolve `empresa_id`, e
 * o nome e a cor saem da sessão, pela mesma tabela que pinta as faixas dos
 * indicadores. Resolver aqui, e não no servidor, é o que mantém a cor de cada
 * unidade igual nas quatro telas que abrem este detalhamento.
 */
function agruparPorUnidade<T>(
  itens: T[],
  somar: ((l: T) => number) | undefined,
  matrizes: Map<number, { nome: string; cor: string }>,
): Array<NoDaUnidade<T>> {
  const empresas = new Map<string, NoDaUnidade<T>>();
  for (const l of itens) {
    const linha = l as Record<string, unknown>;
    const id = linha.empresa_id as number | null | undefined;
    const matriz = id === null || id === undefined ? undefined : matrizes.get(id);
    const chaveE = String(id ?? 'sem-empresa');
    if (!empresas.has(chaveE)) {
      empresas.set(chaveE, {
        chave: chaveE,
        nome: matriz?.nome ?? 'Sem empresa',
        cor: matriz?.cor,
        valor: 0, itens: [], filhos: [],
      });
    }
    const empresa = empresas.get(chaveE)!;
    const valor = somar ? somar(l) : 0;
    empresa.valor += valor;
    empresa.itens.push(l);

    const nomeFilial = (linha.filial_nome as string) ?? 'Nível empresa';
    let filial = empresa.filhos.find((f) => f.nome === nomeFilial);
    if (!filial) {
      filial = { chave: `${chaveE}:${nomeFilial}`, nome: nomeFilial, cor: empresa.cor,
        valor: 0, itens: [], filhos: [] };
      empresa.filhos.push(filial);
    }
    filial.valor += valor;
    filial.itens.push(l);
  }
  const desc = (a: NoDaUnidade<T>, b: NoDaUnidade<T>) => b.valor - a.valor;
  const lista = [...empresas.values()].sort(desc);
  for (const e of lista) {
    e.filhos.sort(desc);
    for (const f of e.filhos) {
      if (somar) f.itens.sort((a, b) => somar(b) - somar(a));
    }
  }
  return lista;
}

/**
 * A tabela de um detalhamento — a lista em si, com o aviso de corte.
 *
 * Com `hierarquia`, as linhas vêm agrupadas em Empresa → Filial: duas linhas de
 * grupo, cada uma com o seu subtotal e o seu botão, e os lançamentos só abaixo
 * da filial. É a mesma leitura do artifact, e existe pelo mesmo motivo: uma
 * lista plana de duzentos lançamentos responde "quais são", não responde "de
 * onde vem o peso" — e é essa a pergunta de quem clicou num indicador.
 *
 * Os grupos nascem FECHADOS, como os níveis da árvore do artifact, e o teto de
 * linhas conta os lançamentos, não as linhas de grupo.
 *
 * Está num componente porque cada camada tem a sua, e as alças de ajuste de
 * coluna precisam de uma referência por tabela: uma só, no pai, ligaria as
 * alças sempre à primeira e deixaria as outras sem.
 */
function TabelaDoDetalhe<T>({ colunas, itens, contagem, cortada, hierarquia, somar }: {
  colunas: Array<ColunaDetalhe<T>>; itens: T[]; contagem: number; cortada: boolean;
  hierarquia?: boolean; somar?: (l: T) => number;
}) {
  const tabela = useRef<HTMLTableElement>(null);
  const { empresas } = useSessao();
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set());
  useEffect(() => ligarColunasAjustaveis(tabela.current), [colunas, itens]);

  const matrizes = useMemo(() => {
    const m = new Map<number, { nome: string; cor: string }>();
    for (const [id, v] of coresDasMatrizes(empresas)) m.set(id, { nome: v.nome, cor: v.cor });
    return m;
  }, [empresas]);
  const arvore = useMemo(
    () => (hierarquia ? agruparPorUnidade(itens, somar, matrizes) : []),
    [hierarquia, itens, somar, matrizes],
  );

  if (itens.length === 0) {
    return <p className="vazio">Nenhum registro compõe este número no recorte atual.</p>;
  }

  const alternar = (chave: string) =>
    setAbertos((a) => {
      const novo = new Set(a);
      if (novo.has(chave)) {
        // Fechar a empresa recolhe as filiais dela: uma filial aberta sob uma
        // empresa fechada seria uma árvore mentindo sobre si.
        novo.delete(chave);
        for (const c of [...novo]) if (c.startsWith(chave + ':')) novo.delete(c);
      } else novo.add(chave);
      return novo;
    });

  const linhaDeGrupo = (no: NoDaUnidade<T>, nivel: 1 | 2) => (
    <tr key={no.chave} className={`grupo-unidade nivel-${nivel}`}>
      <th colSpan={colunas.length} scope="rowgroup">
        <button
          type="button"
          className="arv-abrir"
          aria-expanded={abertos.has(no.chave)}
          aria-label={`${abertos.has(no.chave) ? 'Recolher' : 'Abrir'} ${no.nome}`}
          onClick={() => alternar(no.chave)}
        >
          {abertos.has(no.chave) ? '−' : '+'}
        </button>
        {no.cor && <i className="ponto-unidade" style={{ background: no.cor }} aria-hidden />}
        <span className="grupo-nome">{no.nome}</span>
        <span className="grupo-valor">
          {somar ? moeda(no.valor) : `${inteiro(no.itens.length)} registro(s)`}
        </span>
      </th>
    </tr>
  );

  const linhaDeItem = (l: T, chave: string) => (
    <tr key={chave}>
      {colunas.map((c) => (
        <td key={c.rotulo} className={c.n ? 'num' : c.texto ? 'texto' : undefined}>
          {c.valor(l) ?? '—'}
        </td>
      ))}
    </tr>
  );

  const corpo: ReactNode[] = [];
  if (hierarquia) {
    let desenhados = 0;
    for (const empresa of arvore) {
      corpo.push(linhaDeGrupo(empresa, 1));
      if (!abertos.has(empresa.chave)) continue;
      for (const filial of empresa.filhos) {
        corpo.push(linhaDeGrupo(filial, 2));
        if (!abertos.has(filial.chave)) continue;
        for (const [i, l] of filial.itens.entries()) {
          if (desenhados >= TETO) break;
          corpo.push(linhaDeItem(l, `${filial.chave}:${i}`));
          desenhados += 1;
        }
      }
    }
  } else {
    itens.slice(0, TETO).forEach((l, i) => corpo.push(linhaDeItem(l, String(i))));
  }

  return (
    <>
      {/* A altura vem da tela flutuante, não de um teto fixo: esticar a
          janela precisa dar espaço à tabela. */}
      <div className="tabela-envolucro">
        <table ref={tabela}>
          <thead>
            <tr>
              {colunas.map((c) => (
                <th key={c.rotulo} className={c.n ? 'num' : undefined}>{c.rotulo}</th>
              ))}
            </tr>
          </thead>
          <tbody>{corpo}</tbody>
        </table>
      </div>
      {(itens.length > TETO || cortada) && (
        <p className="vazio" style={{ padding: 0, textAlign: 'left' }}>
          Exibindo {inteiro(Math.min(itens.length, TETO))} de {inteiro(contagem)} registro(s). Estreite o
          recorte para ver o resto.
        </p>
      )}
    </>
  );
}

/** Uma camada: cabeçalho fixo com título e valor, corpo que nasce fechado. */
function Camada({ id, rotulo, valor, children }: {
  id: string; rotulo: string; valor: ReactNode; children: () => ReactNode;
}) {
  const [aberta, setAberta] = useState(false);
  // Montado uma vez, o corpo fica: reabrir não refaz o trabalho de pintar
  // trezentas linhas, e fechar não joga fora o que já estava pronto.
  const [montada, setMontada] = useState(false);
  const idCorpo = `camada-${id}`;
  return (
    <section className="camada">
      <h4 className="camada-cab">
        <button
          type="button"
          className="camada-bt"
          aria-expanded={aberta}
          aria-controls={idCorpo}
          onClick={() => { setMontada(true); setAberta((a) => !a); }}
        >
          <span className="camada-seta" aria-hidden="true">{aberta ? '−' : '+'}</span>
          <span className="camada-rot">{rotulo}</span>
          <span className="camada-val">{valor}</span>
        </button>
      </h4>
      <div className="camada-corpo" id={idCorpo} hidden={!aberta}>
        {montada ? children() : null}
      </div>
    </section>
  );
}

export function Detalhamento<T>({ pedido, aoFechar }: { pedido: PedidoDetalhe<T>; aoFechar: () => void }) {
  const [estado, setEstado] = useState<{ itens: T[]; total: number; soma: number | null } | { erro: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    setEstado(null);
    api
      .get<unknown>(pedido.caminho, pedido.params)
      .then((r) => {
        if (!vivo) return;
        const extrair = pedido.extrair ?? ((x: unknown) => (x as { itens?: T[] }).itens ?? (x as T[]));
        const itens = extrair(r) ?? [];
        setEstado({
          itens,
          total: pedido.contarNaResposta ? pedido.contarNaResposta(r) : itens.length,
          soma: pedido.somaNaResposta ? pedido.somaNaResposta(r) : null,
        });
      })
      .catch((e) => {
        if (vivo) setEstado({ erro: e instanceof Error ? e.message : 'Não foi possível carregar os registros.' });
      });
    return () => {
      vivo = false;
    };
  }, [pedido]);

  const janela = useMemo(
    () => (pedido.comparativo ? janelaDoPedido(pedido.params) : null),
    [pedido],
  );

  // O mês em foco e o anterior, cada um numa consulta. O anterior nunca está
  // na resposta principal de um detalhamento de UM mês, e no de recorte a
  // lista pode vir cortada — derivá-la dali daria um total menor que o real.
  const [fatias, setFatias] = useState<
    { foco: Fatia<T> | null; anterior: Fatia<T> | null } | { erro: string } | null
  >(null);

  useEffect(() => {
    if (!janela) { setFatias(null); return undefined; }
    let vivo = true;
    setFatias(null);
    const extrair = pedido.extrair ?? ((x: unknown) => (x as { itens?: T[] }).itens ?? (x as T[]));
    const umMes = (mes: string): Promise<Fatia<T>> =>
      api
        .get<unknown>(pedido.caminho, { ...pedido.params, competencia_inicio: mes, competencia_fim: mes })
        .then((r) => {
          const itens = extrair(r) ?? [];
          const contagem = pedido.contarNaResposta ? pedido.contarNaResposta(r) : itens.length;
          const cortada = contagem > itens.length;
          const soma = pedido.somaNaResposta
            ? pedido.somaNaResposta(r)
            : cortada || !pedido.somar
              ? null
              : itens.reduce((s, l) => s + pedido.somar!(l), 0);
          return { itens, contagem, soma, cortada };
        });
    // Um detalhamento de UM mês já tem o mês em foco na resposta principal:
    // pedi-lo de novo seria a mesma consulta duas vezes.
    Promise.all([janela.multiMes ? umMes(janela.foco) : null, umMes(janela.anterior)])
      .then(([foco, anterior]) => { if (vivo) setFatias({ foco, anterior }); })
      .catch((e) => {
        if (vivo) {
          setFatias({
            erro: e instanceof Error
              ? `Não foi possível carregar ${competenciaExib(janela.anterior)} para comparar: ${e.message}`
              : `Não foi possível carregar ${competenciaExib(janela.anterior)} para comparar.`,
          });
        }
      });
    return () => { vivo = false; };
  }, [janela, pedido]);

  const itens = estado && 'itens' in estado ? estado.itens : [];
  const totalDeRegistros = estado && 'itens' in estado ? estado.total : 0;
  // A resposta veio cortada: a lista tem menos linhas do que o recorte inteiro.
  const cortada = totalDeRegistros > itens.length;
  const formatar = pedido.formatarTotal ?? ((v: number) => moeda(v));
  const somaDoServidor = estado && 'itens' in estado ? estado.soma : null;
  // Com a lista cortada, somar o que está à vista mediria a página, não o
  // recorte — a conferência então só vale com a soma vinda do servidor.
  const soma = cortada ? somaDoServidor : (pedido.somar ? itens.reduce((s, l) => s + pedido.somar!(l), 0) : somaDoServidor);
  const bate =
    pedido.total === null || pedido.total === undefined || soma === null ? null : Math.abs(soma - pedido.total) < 0.005;

  return (
    <Modal
      titulo={`Detalhamento — ${pedido.titulo}`}
      aberto
      aoFechar={aoFechar}
      // Todo detalhamento guarda o mesmo tamanho: é sempre a mesma leitura —
      // muitos registros, colunas de texto longo — e o gestor ajusta uma vez.
      tipo="detalhamento"
      acoes={
        <button type="button" className="botao" onClick={aoFechar}>
          Fechar
        </button>
      }
    >
      {pedido.subtitulo && <p className="vazio" style={{ padding: 0, textAlign: 'left' }}>{pedido.subtitulo}</p>}

      {estado === null ? (
        <Carregando />
      ) : 'erro' in estado ? (
        <Aviso tipo="erro">{estado.erro}</Aviso>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 'var(--esp-4)', flexWrap: 'wrap' }}>
            <Etiqueta
              texto={
                cortada
                  ? `${inteiro(itens.length)} de ${inteiro(totalDeRegistros)} registro(s)`
                  : `${inteiro(itens.length)} registro(s)`
              }
            />
            {soma !== null && <Etiqueta texto={`Soma: ${formatar(soma)}`} />}
            {bate !== null && (
              <Etiqueta
                texto={bate ? 'confere com o indicador' : `diverge do indicador (${formatar(pedido.total!)})`}
                tom={bate ? 'bom' : 'critico'}
              />
            )}
          </div>

          {janela ? (
            <CamadasComparativas
              pedido={pedido}
              janela={janela}
              fatias={fatias}
              recorte={{ itens, contagem: totalDeRegistros, soma, cortada }}
            />
          ) : (
            <TabelaDoDetalhe
              colunas={pedido.colunas}
              itens={itens}
              contagem={totalDeRegistros}
              cortada={cortada}
            />
          )}
        </>
      )}
    </Modal>
  );
}

/** Um nó da variação: quanto no mês em foco, quanto no anterior, e a diferença. */
interface NoDaVariacao<T> {
  id: string;
  nome: string;
  cor?: string;
  atual: number;
  anterior: number;
  nAtual: number;
  nAnterior: number;
  delta: number;
  itens: T[];
  filhos: Array<NoDaVariacao<T>>;
}

/**
 * A chave que faz o MESMO título dos dois meses virar UMA linha.
 *
 * Maiúsculas, sem acento e sem espaço repetido: a mesma despesa volta todo mês
 * digitada com variações que são de digitação, não de natureza, e sem
 * normalizar ela apareceria duas vezes — uma como despesa nova, outra como
 * despesa que cessou, quando é a mesma que continuou.
 */
const chaveDeTitulo = (t: unknown) =>
  String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * A variação na MESMA árvore da composição: tipo de despesa → empresa →
 * filial → título lançado.
 *
 * O total da camada diz QUANTO mudou; a árvore diz DE ONDE veio. A estrutura
 * repete a da camada 2 de propósito: quem desce uma não pode ter de reaprender
 * a outra. O que muda são as colunas — ali um valor, aqui os dois meses.
 *
 * Percorre a UNIÃO dos dois meses: uma despesa que havia e parou não está na
 * lista do mês filtrado, e é exatamente ela que precisa aparecer.
 */
function agruparVariacao<T>(
  doMes: T[],
  doAnterior: T[],
  somar: ((l: T) => number) | undefined,
  matrizes: Map<number, { nome: string; cor: string }>,
): Array<NoDaVariacao<T>> {
  type Cru = Omit<NoDaVariacao<T>, 'filhos' | 'delta'> & { filhos: Map<string, Cru> };
  const raiz = new Map<string, Cru>();

  const niveis = (l: T) => {
    const r = l as Record<string, unknown>;
    const id = r.empresa_id as number | null | undefined;
    const matriz = id === null || id === undefined ? undefined : matrizes.get(id);
    const tipo = String(r.tipo_despesa ?? 'Sem tipo');
    return [
      { chave: tipo, nome: tipo, cor: undefined as string | undefined },
      { chave: String(id ?? 'sem-empresa'), nome: matriz?.nome ?? 'Sem empresa', cor: matriz?.cor },
      { chave: String(r.filial_nome ?? 'Nível empresa'), nome: String(r.filial_nome ?? 'Nível empresa'), cor: undefined },
      { chave: chaveDeTitulo(r.descricao ?? r.fornecedor ?? tipo),
        nome: String(r.descricao ?? r.fornecedor ?? tipo), cor: undefined },
    ];
  };

  const acumular = (lista: T[], campo: 'atual' | 'anterior') => {
    for (const l of lista) {
      let mapa = raiz;
      let caminho = '';
      for (const n of niveis(l)) {
        caminho += `\u0000${n.chave}`;
        if (!mapa.has(n.chave)) {
          mapa.set(n.chave, { id: caminho, nome: n.nome, cor: n.cor,
            atual: 0, anterior: 0, nAtual: 0, nAnterior: 0, itens: [], filhos: new Map() });
        }
        const no = mapa.get(n.chave)!;
        no[campo] += somar ? somar(l) : 0;
        if (campo === 'atual') no.nAtual += 1; else no.nAnterior += 1;
        no.itens.push(l);
        mapa = no.filhos;
      }
    }
  };
  acumular(doMes, 'atual');
  acumular(doAnterior, 'anterior');

  // Ordem por variação ABSOLUTA em cada nível: o que mais mexeu vem primeiro,
  // caia para que lado cair.
  const fechar = (mapa: Map<string, Cru>): Array<NoDaVariacao<T>> =>
    [...mapa.values()]
      .map((no) => ({ ...no, delta: no.atual - no.anterior, filhos: fechar(no.filhos) }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.nome.localeCompare(b.nome, 'pt-BR'));
  return fechar(raiz);
}

/** A linha é deste mês? A competência chega como MM/AAAA ou AAAA-MM. */
const mesmaCompetencia = (l: unknown, mes: string) =>
  competenciaOrdem(String((l as Record<string, unknown>).competencia ?? '')) === competenciaOrdem(mes);

const SETA = { sobe: '↑', desce: '↓', zero: '=' } as const;
const sentidoDe = (delta: number) => (delta < 0 ? 'desce' : delta > 0 ? 'sobe' : 'zero');

function ArvoreDaVariacao<T>({ foco, anterior, janela, pedido, aoAbrir }: {
  foco: Fatia<T>;
  anterior: Fatia<T>;
  janela: NonNullable<ReturnType<typeof janelaDoPedido>>;
  pedido: PedidoDetalhe<T>;
  aoAbrir: (titulo: string, itens: T[]) => void;
}) {
  const { empresas } = useSessao();
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set());
  const matrizes = useMemo(() => {
    const m = new Map<number, { nome: string; cor: string }>();
    for (const [id, v] of coresDasMatrizes(empresas)) m.set(id, { nome: v.nome, cor: v.cor });
    return m;
  }, [empresas]);
  const arvore = useMemo(
    () => agruparVariacao(foco.itens, anterior.itens, pedido.somar, matrizes),
    [foco.itens, anterior.itens, pedido.somar, matrizes],
  );

  // Uma lista cortada mediria a página, não o mês: somar o que coube daria
  // deltas por unidade que não fecham com o total da camada.
  if (foco.cortada || anterior.cortada) {
    return (
      <p className="vazio" style={{ padding: 0, textAlign: 'left' }}>
        A lista de um dos dois meses veio cortada, e somar o que coube daria uma variação por
        unidade que não fecha com o total. Estreite o recorte de unidades acima para abrir a
        quebra.
      </p>
    );
  }
  if (!arvore.length) return <p className="vazio">Nenhum lançamento nos dois meses.</p>;

  const alternar = (id: string) =>
    setAbertos((a) => {
      const n = new Set(a);
      if (n.has(id)) {
        // Fechar um nó recolhe o que estava aberto abaixo: um neto visível sob
        // um pai fechado seria uma árvore mentindo sobre si.
        n.delete(id);
        for (const c of [...n]) if (c.startsWith(`${id}\u0000`)) n.delete(c);
      } else n.add(id);
      return n;
    });

  const fmt = (v: number) => moeda(v);

  const linha = (no: NoDaVariacao<T>, nivel: number, base: number) => {
    const s = sentidoDe(no.delta);
    const temFilhos = no.filhos.length > 0;
    const soEm = no.nAtual && !no.nAnterior ? 'novo' : !no.nAtual && no.nAnterior ? 'não veio' : '';
    return (
      <tr key={no.id} className={`var-linha nivel-${nivel}`}>
        <th scope="row" style={{ paddingLeft: `${(nivel - 1) * 18}px` }}>
          {temFilhos ? (
            <button
              type="button"
              className="arv-abrir"
              aria-expanded={abertos.has(no.id)}
              aria-label={`${abertos.has(no.id) ? 'Recolher' : 'Abrir'} ${no.nome}`}
              onClick={() => alternar(no.id)}
            >
              {abertos.has(no.id) ? '−' : '+'}
            </button>
          ) : (
            <span className="arv-vazio" aria-hidden />
          )}
          {no.cor && <i className="ponto-unidade" style={{ background: no.cor }} aria-hidden />}
          <span className="grupo-nome">{no.nome}</span>
          {soEm && <span className={soEm === 'novo' ? 'marca-novo' : 'marca-cessou'}>{soEm}</span>}
          {nivel === 4 && no.nAtual + no.nAnterior > 2 && (
            <span className="var-qtd">{inteiro(no.nAtual + no.nAnterior)} lançamentos</span>
          )}
        </th>
        <td className="num">{fmt(no.atual)}</td>
        <td className="num">{fmt(no.anterior)}</td>
        <td className="num">
          <span className={`delta ${s === 'zero' ? 'neutro' : s}`}>
            {SETA[s]} {fmt(Math.abs(no.delta))}
          </span>
        </td>
        <td>
          <span
            className="barra-variacao"
            title={`${no.nome}: ${fmt(no.atual)} em ${competenciaExib(janela.foco)} contra ${fmt(no.anterior)} em ${competenciaExib(janela.anterior)}`}
          >
            <span aria-hidden>
              <i
                style={{
                  width: `${base ? Math.min(100, (Math.abs(no.delta) / base) * 100) : 0}%`,
                  background: s === 'desce' ? 'var(--bom)' : s === 'sobe' ? 'var(--critico)' : 'var(--borda-forte)',
                }}
              />
            </span>
            <b>{percentual(base ? (Math.abs(no.delta) / base) * 100 : 0)}</b>
          </span>
        </td>
        <td>
          <button type="button" className="botao pequeno" onClick={() => aoAbrir(no.nome, no.itens)}>
            Ver
          </button>
        </td>
      </tr>
    );
  };

  // O peso é dentro do PAI, como na árvore da composição. A base é a soma dos
  // MÓDULOS dos irmãos, e não o delta líquido: com um irmão subindo e outro
  // caindo o líquido encolhe, e dividir por ele daria pesos acima de 100%.
  const desenhar = (nos: Array<NoDaVariacao<T>>, nivel: number): React.ReactNode[] => {
    const base = nos.reduce((acc, n) => acc + Math.abs(n.delta), 0);
    return nos.flatMap((no) => [
      linha(no, nivel, base),
      ...(abertos.has(no.id) ? desenhar(no.filhos, nivel + 1) : []),
    ]);
  };

  return (
    <div className="tabela-envolucro">
      <table className="tabela-variacao">
        <thead>
          <tr>
            <th>Tipo / empresa / filial / título</th>
            <th className="num">{competenciaExib(janela.foco)}</th>
            <th className="num">{competenciaExib(janela.anterior)}</th>
            <th className="num">Diferença</th>
            <th>Peso na variação</th>
            <th />
          </tr>
        </thead>
        <tbody>{desenhar(arvore, 1)}</tbody>
      </table>
    </div>
  );
}

/**
 * As camadas de um detalhamento comparativo.
 *
 * O cabeçalho diz o mês filtrado e o de comparação; cada camada diz o seu
 * total sem precisar abrir. A quarta só existe no detalhamento de RECORTE, e
 * é ela que fecha com o indicador: nesse caso o número da tela soma vários
 * meses, e a camada do mês sozinha somaria menos.
 */
function CamadasComparativas<T>({ pedido, janela, fatias, recorte }: {
  pedido: PedidoDetalhe<T>;
  janela: NonNullable<ReturnType<typeof janelaDoPedido>>;
  fatias: { foco: Fatia<T> | null; anterior: Fatia<T> | null } | { erro: string } | null;
  recorte: { itens: T[]; contagem: number; soma: number | null; cortada: boolean };
}) {
  const formatar = pedido.formatarTotal ?? ((v: number) => moeda(v));
  // O drill-down da variação abre EM LINHA, abaixo da árvore: uma segunda tela
  // flutuante por cima desta empilharia dois diálogos para uma leitura que é
  // continuação da primeira.
  const [aberto, setAberto] = useState<{ nome: string; itens: T[] } | null>(null);
  const carregando = fatias === null;
  const erro = fatias && 'erro' in fatias ? fatias.erro : null;
  const prontas = fatias && !('erro' in fatias) ? fatias : null;
  // Num detalhamento de um mês, o mês em foco É a resposta principal.
  const foco: Fatia<T> = (janela.multiMes ? prontas?.foco : recorte) ?? {
    itens: [], contagem: 0, soma: null, cortada: false,
  };
  const anterior = prontas?.anterior ?? null;

  const resumo = (f: Fatia<T> | null): ReactNode => {
    if (carregando) return <span className="camada-sem">carregando…</span>;
    if (!f) return <span className="camada-sem">indisponível</span>;
    return (
      <>
        {f.soma === null ? '—' : formatar(f.soma)}{' '}
        <span className="camada-qtd">{inteiro(f.contagem)} registro(s)</span>
      </>
    );
  };

  let valorDif: ReactNode = <span className="camada-sem">carregando…</span>;
  if (!carregando) {
    const base = anterior?.soma ?? null;
    const atual = foco.soma;
    if (base === null || atual === null) {
      valorDif = <span className="camada-sem">sem base de comparação</span>;
    } else {
      const delta = atual - base;
      // Gastar menos é bom: a queda é verde, a alta é vermelha. É a mesma
      // convenção de `.delta` nos indicadores — trocá-la aqui confundiria as duas.
      const sentido = delta < 0 ? 'desce' : delta > 0 ? 'sobe' : 'zero';
      valorDif = (
        <span className={`delta ${sentido === 'zero' ? 'neutro' : sentido}`}>
          {SETA_DELTA[sentido]} {formatar(Math.abs(delta))}
          {base !== 0 && ` · ${percentual(Math.abs((delta / base) * 100))}`}
        </span>
      );
    }
  }

  return (
    <div className="det-comp">
      <p className="det-comp-cab">
        Detalhamento ·{' '}
        <strong>
          {competenciaExib(janela.foco)} vs {competenciaExib(janela.anterior)}
        </strong>
        {janela.multiMes && (
          <span className="camada-qtd">
            {' '}recorte de {competenciaExib(janela.ini)} a {competenciaExib(janela.fim)} — a comparação é do
            último mês
          </span>
        )}
      </p>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Camada id="dif" rotulo="Diferença vs mês anterior" valor={valorDif}>
        {() =>
          anterior === null ? (
            <p className="vazio">
              Sem {competenciaExib(janela.anterior)} não há diferença a medir.
            </p>
          ) : (
            <>
              <ArvoreDaVariacao
                foco={foco}
                anterior={anterior}
                janela={janela}
                pedido={pedido}
                aoAbrir={(nome, itens) => setAberto({ nome, itens })}
              />
              {aberto && (
                <section className="var-drill">
                  <h5>
                    Variação de {aberto.nome}
                    <button type="button" className="botao pequeno" onClick={() => setAberto(null)}>
                      Fechar
                    </button>
                  </h5>
                  {/* Os dois meses na MESMA lista: duas tabelas separadas
                      obrigariam a guardar um total de cabeça para comparar com
                      o outro. A coluna Competência diz de qual mês é a linha. */}
                  <p className="vazio" style={{ padding: 0, textAlign: 'left' }}>
                    {inteiro(aberto.itens.filter((l) => mesmaCompetencia(l, janela.foco)).length)}{' '}
                    lançamento(s) em {competenciaExib(janela.foco)} e{' '}
                    {inteiro(aberto.itens.filter((l) => mesmaCompetencia(l, janela.anterior)).length)} em{' '}
                    {competenciaExib(janela.anterior)}.
                  </p>
                  <TabelaDoDetalhe
                    colunas={pedido.colunas}
                    itens={aberto.itens}
                    contagem={aberto.itens.length}
                    cortada={false}
                    somar={pedido.somar}
                  />
                </section>
              )}
            </>
          )
        }
      </Camada>

      <Camada id="veio" rotulo="O que veio no mês filtrado" valor={resumo(carregando ? null : foco)}>
        {() => (
          <TabelaDoDetalhe
            colunas={pedido.colunas}
            itens={foco.itens}
            contagem={foco.contagem}
            cortada={foco.cortada}
            hierarquia
            somar={pedido.somar}
          />
        )}
      </Camada>

      <Camada
        id="ant"
        rotulo="Mês anterior: o que veio × o que não veio"
        valor={resumo(anterior)}
      >
        {() =>
          anterior === null ? (
            <p className="vazio">{competenciaExib(janela.anterior)} não pôde ser carregado.</p>
          ) : (
            <TabelaDoDetalhe
              colunas={pedido.colunas}
              itens={anterior.itens}
              contagem={anterior.contagem}
              cortada={anterior.cortada}
              hierarquia
              somar={pedido.somar}
            />
          )
        }
      </Camada>

      {janela.multiMes && (
        <Camada
          id="recorte"
          rotulo="Recorte completo — o que o indicador soma"
          valor={resumo(recorte)}
        >
          {() => (
            <TabelaDoDetalhe
              colunas={pedido.colunas}
              itens={recorte.itens}
              contagem={recorte.contagem}
              cortada={recorte.cortada}
              hierarquia
              somar={pedido.somar}
            />
          )}
        </Camada>
      )}
    </div>
  );
}

/**
 * Número do chamado como link para o sistema de origem. O endereço vem pronto
 * do servidor (`url_externa`), que conhece a base configurada de cada
 * helpdesk — remontá-lo aqui faria a tela divergir da listagem.
 */
function linkDoChamado(registro: Record<string, unknown>, rotulo: string | null): ReactNode {
  if (!rotulo) return '—';
  const url = registro.url_externa as string | null;
  if (!url) return rotulo;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {rotulo}
    </a>
  );
}

// ------------------------------------------------- detalhamentos por domínio
//
// Cada um monta o pedido de um módulo. Os parâmetros vêm de quem chama, que é
// a tela que exibiu o número — é isso que mantém o recorte igual.

export function detalheDeLancamentos(
  titulo: string,
  params: Record<string, unknown>,
  total?: number | null,
  subtitulo?: string,
): PedidoDetalhe<Record<string, unknown>> {
  return {
    titulo,
    subtitulo,
    total,
    caminho: '/api/dashboards/relatorio/lancamentos',
    params,
    // Lançamento é somado por competência: o detalhamento abre comparando o
    // mês filtrado com o anterior. Quando o recorte não tem janela de
    // competência — a Conferência filtra por cenário —, `janelaDoPedido`
    // devolve nulo e a tela volta a ser a lista de sempre.
    comparativo: true,
    somar: (l) => Number(l.valor_centavos) / 100,
    colunas: [
      { rotulo: 'Competência', valor: (l) => String(l.competencia) },
      { rotulo: 'Filial', valor: (l) => String(l.filial_nome ?? 'Nível empresa') },
      { rotulo: 'Tipo', valor: (l) => String(l.tipo_despesa) },
      { rotulo: 'Descrição', valor: (l) => (l.descricao as string) ?? '—', texto: true },
      { rotulo: 'Fornecedor', valor: (l) => (l.fornecedor as string) ?? '—', texto: true },
      { rotulo: 'Origem do custo', valor: (l) => (l.origem_custo as string) ?? '—', texto: true },
      { rotulo: 'Destino', valor: (l) => (l.destino_pagamento as string) ?? '—', texto: true },
      // Uma coluna aqui aparece de uma vez em Conferência, Financeiro, Painel
      // Executivo e Relatório: as quatro abrem os registros por este pedido.
      // A etiqueta resolve a cor da empresa por conta própria (`useSessao`),
      // porque esta fábrica não alcança o estado da tela que a chamou.
      { rotulo: 'Consumo', valor: (l) => <EtiquetaConsumo lancamento={l as ComConsumoEEmpresa} />, texto: true },
      { rotulo: 'Procedência', valor: (l) => String(l.origem_rotulo) },
      { rotulo: 'Valor', valor: (l) => moeda(Number(l.valor_centavos) / 100), n: true },
    ],
  };
}

/**
 * OS CONTRATOS QUE A PROJEÇÃO CARREGA — a soma aberta por dono.
 *
 * Os demais detalhamentos listam LANÇAMENTOS: registros que existem. Este
 * lista o que ainda NÃO foi lançado — contratos recorrentes que seguem
 * valendo. Por isso ele tem fábrica própria em vez de reaproveitar a de
 * lançamentos: as colunas respondem outra pergunta.
 *
 * A coluna que importa é "Sem lançar há": um contrato projetado há meses sem
 * aparecer é o que precisa de vigência. Ordenada pelo servidor, a lista chega
 * como fila de trabalho.
 */
export function detalheDeContratosProjetados(
  titulo: string,
  params: Record<string, unknown>,
  total?: number | null,
  subtitulo?: string,
): PedidoDetalhe<Record<string, unknown>> {
  return {
    titulo,
    subtitulo,
    total,
    caminho: '/api/dashboards/contratos-projetados',
    params,
    somar: (c) => Number(c.total_projetado),
    colunas: [
      { rotulo: 'Fornecedor', valor: (c) => (c.fornecedor as string) ?? '—', texto: true },
      { rotulo: 'Descrição', valor: (c) => (c.descricao as string) ?? '—', texto: true },
      { rotulo: 'Tipo', valor: (c) => (c.tipo_despesa as string) ?? '—', texto: true },
      { rotulo: 'Desde', valor: (c) => String(c.primeira_ocorrencia) },
      { rotulo: 'Visto pela última vez', valor: (c) => String(c.ultima_ocorrencia) },
      {
        // Zero vira "neste mês" em vez de "0": o número cru aqui se lê como
        // ausência de informação, e é o oposto — é o contrato saudável.
        rotulo: 'Sem lançar há',
        valor: (c) =>
          Number(c.meses_sem_lancamento) === 0 ? 'neste mês' : `${inteiro(Number(c.meses_sem_lancamento))} mês(es)`,
        n: true,
      },
      {
        rotulo: 'Vigência',
        valor: (c) =>
          c.recorrencia_ate ? (
            String(c.recorrencia_ate)
          ) : (
            // Não é erro, e por isso não é vermelho: é a informação que falta
            // para a projeção saber parar.
            <Etiqueta texto="em aberto" cor="var(--serie-4)" />
          ),
        texto: true,
      },
      { rotulo: 'Valor/mês', valor: (c) => moeda(Number(c.valor_mes)), n: true },
      { rotulo: 'Meses projetados', valor: (c) => inteiro(Number(c.meses_projetados)), n: true },
      { rotulo: 'Total projetado', valor: (c) => moeda(Number(c.total_projetado)), n: true },
    ],
  };
}

/**
 * Registros de SLA — o que o painel de SLA conta. Cobre tanto o registro
 * agregado mensal quanto o chamado individual; `detalheDeChamados` abaixo é
 * do módulo de Suporte, restrito ao que veio de um helpdesk.
 */
export function detalheDeRegistrosSla(
  titulo: string,
  params: Record<string, unknown>,
  total?: number | null,
  subtitulo?: string,
): PedidoDetalhe<Record<string, unknown>> {
  return {
    titulo,
    subtitulo,
    total,
    caminho: '/api/sla',
    params,
    formatarTotal: inteiro,
    somar: (r) => Number(r.total_atendidos),
    colunas: [
      { rotulo: 'Competência', valor: (r) => String(r.competencia) },
      { rotulo: 'Filial', valor: (r) => (r.filial_nome as string) ?? 'Nível empresa' },
      { rotulo: 'Fila', valor: (r) => String(r.fila) },
      { rotulo: 'Tópico', valor: (r) => (r.topico_ajuda as string) ?? '—' },
      // O número abre o chamado no sistema de origem — é o caminho para quem
      // quer ver o atendimento inteiro, e não só a linha do relatório.
      { rotulo: 'Chamado', valor: (r) => linkDoChamado(r, r.ticket_id ? `#${r.numero ?? r.ticket_id}` : null) },
      { rotulo: 'Assunto', valor: (r) => (r.assunto as string) ?? '—', texto: true },
      { rotulo: 'Atendidos', valor: (r) => inteiro(Number(r.total_atendidos)), n: true },
      { rotulo: 'Dentro', valor: (r) => inteiro(Number(r.dentro_sla)), n: true },
      { rotulo: 'Fora', valor: (r) => inteiro(Number(r.fora_sla)), n: true },
    ],
  };
}

export function detalheDeChamados(
  titulo: string,
  params: Record<string, unknown>,
  total?: number | null,
  subtitulo?: string,
): PedidoDetalhe<Record<string, unknown>> {
  return {
    titulo,
    subtitulo,
    total,
    caminho: '/api/suporte/chamados',
    params: { limite: 500, ...params },
    formatarTotal: inteiro,
    somar: () => 1,
    // A listagem é paginada; a contagem honesta é a do servidor, não a da
    // página que coube no modal.
    contarNaResposta: (r) => Number((r as { paginacao?: { total?: number } }).paginacao?.total ?? 0),
    somaNaResposta: (r) => Number((r as { paginacao?: { total?: number } }).paginacao?.total ?? 0),
    colunas: [
      { rotulo: 'Chamado', valor: (c) => linkDoChamado(c, `#${c.numero ?? c.external_id}`) },
      { rotulo: 'Sistema', valor: (c) => (c.source_system === 'BITRIX24' ? 'Bitrix24' : 'OStick') },
      { rotulo: 'Setor', valor: (c) => (c.setor as string) ?? 'Não classificado' },
      { rotulo: 'Assunto', valor: (c) => (c.assunto as string) ?? '—', texto: true },
      { rotulo: 'Solicitante', valor: (c) => (c.solicitante as string) ?? '—' },
      { rotulo: 'Atendente', valor: (c) => (c.responsavel as string) ?? '—' },
      { rotulo: 'SLA', valor: (c) => (c.dentro_sla ? 'Dentro' : 'Fora') },
    ],
  };
}

/**
 * Projetos por trás de um indicador de contagem. Some 1 por projeto: o número
 * na tela é uma contagem, e é com ela que a conferência do modal tem de bater.
 */
export function detalheDeProjetos(
  titulo: string,
  params: Record<string, unknown>,
  total?: number | null,
  subtitulo?: string,
): PedidoDetalhe<Record<string, unknown>> {
  return {
    titulo,
    subtitulo,
    total,
    caminho: '/api/projetos',
    params,
    formatarTotal: inteiro,
    somar: () => 1,
    colunas: [
      { rotulo: 'Projeto', valor: (p) => String(p.nome), texto: true },
      { rotulo: 'Filial', valor: (p) => (p.filial_nome as string) ?? 'Nível empresa' },
      { rotulo: 'Situação', valor: (p) => ROTULO_STATUS_PROJETO[String(p.status)] ?? String(p.status) },
      { rotulo: 'Início', valor: (p) => String(p.mes_inicio) },
      { rotulo: 'Fim planejado', valor: (p) => String(p.mes_fim_planejado) },
      { rotulo: 'Fim real', valor: (p) => (p.mes_fim_real as string) ?? '—' },
      { rotulo: 'Tarefas', valor: (p) => `${inteiro(Number(p.tarefas_concluidas))}/${inteiro(Number(p.total_tarefas))}`, n: true },
      { rotulo: 'Atraso', valor: (p) => (p.atrasado ? `${inteiro(Number(p.meses_atraso))} mês(es)` : '—') },
    ],
  };
}

/** Tarefas por trás de um indicador ou de um item do ranking de carga. */
export function detalheDeTarefas(
  titulo: string,
  params: Record<string, unknown>,
  total?: number | null,
  subtitulo?: string,
): PedidoDetalhe<Record<string, unknown>> {
  return {
    titulo,
    subtitulo,
    total,
    caminho: '/api/projetos/tarefas',
    params,
    formatarTotal: inteiro,
    somar: () => 1,
    colunas: [
      { rotulo: 'Tarefa', valor: (t) => String(t.nome), texto: true },
      { rotulo: 'Projeto', valor: (t) => String(t.projeto_nome), texto: true },
      { rotulo: 'Filial', valor: (t) => (t.filial_nome as string) ?? 'Nível empresa' },
      { rotulo: 'Responsável', valor: (t) => (t.responsavel as string) || 'Não atribuído' },
      { rotulo: 'Situação', valor: (t) => ROTULO_STATUS_TAREFA[String(t.status)] ?? String(t.status) },
      { rotulo: 'Início', valor: (t) => String(t.mes_inicio) },
      { rotulo: 'Fim planejado', valor: (t) => String(t.mes_fim_planejado) },
      { rotulo: 'Fim real', valor: (t) => (t.mes_fim_real as string) ?? '—' },
      { rotulo: 'Atraso', valor: (t) => (t.atrasado ? `${inteiro(Number(t.meses_atraso))} mês(es)` : '—') },
    ],
  };
}
