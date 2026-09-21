/**
 * Kit de gráficos em SVG.
 *
 * Regras aplicadas em todos: marca fina, grade em fio de cabelo, topo de barra
 * arredondado em 4px ancorado na linha de base, 2px de respiro entre fatias,
 * legenda sempre presente quando há duas ou mais séries, tooltip no hover e
 * visão em tabela como alternativa acessível ao canal de cor.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { inteiro } from '../lib/formato';
import { useExpansao } from '../lib/expansao';
import type { MatrizComCor } from '../lib/cores';

export interface Serie {
  chave: string;
  nome: string;
  cor: string;
}

export interface PontoCategoria {
  rotulo: string;
  valores: Record<string, number>;
}

export interface DicaEstado {
  x: number;
  y: number;
  titulo: string;
  linhas: Array<{ nome: string; valor: string; cor?: string }>;
}

/**
 * O balão flutuante: o detalhe granular fica fora da visão principal e
 * aparece no hover.
 *
 * A contenção era por um número fixo (220 px de largura presumida) e só nas
 * bordas direita e superior. Agora ela MEDE o balão e cuida das quatro: perto
 * do topo ele cai para baixo do cursor em vez de cobrir o ponto que explica, e
 * um balão largo não vaza pela direita porque alguém supôs a largura errada.
 */
export function Dica({ estado }: { estado: DicaEstado | null }) {
  const alvo = useRef<HTMLDivElement | null>(null);
  const [caixa, setCaixa] = useState({ largura: 220, altura: 60 });
  useLayoutEffect(() => {
    if (!alvo.current) return;
    const r = alvo.current.getBoundingClientRect();
    // Só grava quando muda de verdade: gravar sempre faria o efeito pedir
    // outro render, que pediria outro, sem fim.
    setCaixa((c) =>
      Math.abs(c.largura - r.width) < 1 && Math.abs(c.altura - r.height) < 1
        ? c
        : { largura: r.width, altura: r.height },
    );
  }, [estado]);
  if (!estado) return null;
  const acima = estado.y - caixa.altura - 12;
  const estilo = {
    left: Math.max(8, Math.min(estado.x + 14, window.innerWidth - caixa.largura - 12)),
    top: acima >= 8 ? acima : Math.min(estado.y + 18, window.innerHeight - caixa.altura - 12),
  };
  return (
    <div className="dica" style={estilo} role="tooltip" ref={alvo}>
      <strong>{estado.titulo}</strong>
      {estado.linhas.map((l) => (
        <div className="linha" key={l.nome}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {l.cor && <i style={{ width: 9, height: 9, borderRadius: 3, background: l.cor, display: 'inline-block' }} />}
            {l.nome}
          </span>
          <b>{l.valor}</b>
        </div>
      ))}
    </div>
  );
}

export function Legenda({ series }: { series: Serie[] }) {
  if (series.length < 2) return null;
  return (
    <div className="legenda">
      {series.map((s) => (
        <span key={s.chave}>
          <i style={{ background: s.cor }} />
          {s.nome}
        </span>
      ))}
    </div>
  );
}

/** Escala "agradável": teto arredondado e passo legível para o eixo de valores. */
function escala(maximo: number, divisoes = 4) {
  if (maximo <= 0) return { teto: 1, marcas: [0, 1] };
  const bruto = maximo / divisoes;
  const magnitude = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((p) => p >= bruto) ?? 10 * magnitude;
  const teto = Math.ceil(maximo / passo) * passo;
  const marcas: number[] = [];
  for (let v = 0; v <= teto + passo / 2; v += passo) marcas.push(Number(v.toFixed(6)));
  return { teto, marcas };
}

/** Caminho de barra com o topo arredondado e a base reta na linha zero. */
function caminhoBarra(x: number, y: number, largura: number, altura: number, raio = 4) {
  const r = Math.max(0, Math.min(raio, largura / 2, altura));
  if (altura <= 0.5) return '';
  return `M${x},${y + altura} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + largura - r},${y} Q${x + largura},${y} ${x + largura},${y + r} L${x + largura},${y + altura} Z`;
}

function AlternarTabela({ aberta, alternar }: { aberta: boolean; alternar: () => void }) {
  return (
    <div className="alternar-tabela">
      <button type="button" className="botao discreto pequeno" onClick={alternar} aria-expanded={aberta}>
        {aberta ? 'Ocultar tabela' : 'Ver como tabela'}
      </button>
    </div>
  );
}

function TabelaDados({
  dados,
  series,
  formatar,
  rotuloCategoria,
}: {
  dados: PontoCategoria[];
  series: Serie[];
  formatar: (v: number) => string;
  rotuloCategoria: string;
}) {
  return (
    <div className="tabela-envolucro">
      <table>
        <thead>
          <tr>
            <th>{rotuloCategoria}</th>
            {series.map((s) => (
              <th key={s.chave} className="num">
                {s.nome}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dados.map((d) => (
            <tr key={d.rotulo}>
              <td>{d.rotulo}</td>
              {series.map((s) => (
                <td key={s.chave} className="num">
                  {formatar(d.valores[s.chave] ?? 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ==========================================================================
// Barras verticais (agrupadas ou empilhadas)
// ==========================================================================

export function GraficoBarras({
  dados,
  series,
  formatar,
  formatarEixo,
  modo = 'agrupado',
  altura = 240,
  rotuloCategoria = 'Competência',
  aoClicar,
}: {
  dados: PontoCategoria[];
  series: Serie[];
  formatar: (v: number) => string;
  formatarEixo?: (v: number) => string;
  modo?: 'agrupado' | 'empilhado';
  altura?: number;
  rotuloCategoria?: string;
  /** Com isto, cada barra vira gatilho de drill-down. */
  aoClicar?: (ponto: PontoCategoria, indice: number) => void;
}) {
  const [dica, setDica] = useState<DicaEstado | null>(null);
  const [tabela, setTabela] = useState(false);
  const idClip = useId();

  const margem = { topo: 12, direita: 12, base: 26, esquerda: 78 };
  const largura = 720;
  const alturaPlot = altura - margem.topo - margem.base;
  const larguraPlot = largura - margem.esquerda - margem.direita;

  const maximo = useMemo(() => {
    if (dados.length === 0) return 0;
    return Math.max(
      ...dados.map((d) =>
        modo === 'empilhado'
          ? series.reduce((s, serie) => s + (d.valores[serie.chave] ?? 0), 0)
          : Math.max(...series.map((serie) => d.valores[serie.chave] ?? 0), 0),
      ),
      0,
    );
  }, [dados, series, modo]);

  const { teto, marcas } = escala(maximo);
  const y = (v: number) => margem.topo + alturaPlot - (v / teto) * alturaPlot;
  const passoCategoria = larguraPlot / Math.max(dados.length, 1);
  const larguraGrupo = Math.min(passoCategoria * 0.66, 46);

  if (dados.length === 0) return <p className="vazio">Sem dados no período consultado.</p>;

  return (
    <>
      <Legenda series={series} />
      <svg
        viewBox={`0 0 ${largura} ${altura}`}
        style={{ width: '100%', height: 'auto', display: 'block', marginTop: 8 }}
        role="img"
        aria-label={`Gráfico de barras por ${rotuloCategoria.toLowerCase()}`}
        onMouseLeave={() => setDica(null)}
      >
        <clipPath id={idClip}>
          <rect x={margem.esquerda} y={0} width={larguraPlot} height={altura} />
        </clipPath>

        {marcas.map((m) => (
          <g key={m}>
            <line
              x1={margem.esquerda}
              x2={largura - margem.direita}
              y1={y(m)}
              y2={y(m)}
              stroke={m === 0 ? 'var(--eixo)' : 'var(--grade)'}
              strokeWidth={1}
            />
            <text x={margem.esquerda - 8} y={y(m) + 4} textAnchor="end" fontSize={10.5} fill="var(--tinta-fraca)">
              {(formatarEixo ?? formatar)(m)}
            </text>
          </g>
        ))}

        <g clipPath={`url(#${idClip})`}>
          {dados.map((d, i) => {
            const centro = margem.esquerda + passoCategoria * (i + 0.5);
            /**
             * Atributos que tornam a barra um gatilho acessível. Um `<g>` com
             * `onClick` não é alcançável por teclado nem anunciado como botão.
             */
            const gatilho = (ponto: PontoCategoria, indice: number) =>
              aoClicar
                ? {
                    role: 'button',
                    tabIndex: 0,
                    'aria-label': `${ponto.rotulo} — abrir os registros deste ponto`,
                    style: { cursor: 'pointer' },
                    onClick: () => {
                      setDica(null);
                      aoClicar(ponto, indice);
                    },
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDica(null);
                        aoClicar(ponto, indice);
                      }
                    },
                  }
                : {};
            const total = series.reduce((s, serie) => s + (d.valores[serie.chave] ?? 0), 0);
            const aoEntrar = (evento: React.MouseEvent) =>
              setDica({
                x: evento.clientX,
                y: evento.clientY,
                titulo: d.rotulo,
                linhas: [
                  ...series.map((s) => ({ nome: s.nome, valor: formatar(d.valores[s.chave] ?? 0), cor: s.cor })),
                  ...(series.length > 1 ? [{ nome: 'Total', valor: formatar(total) }] : []),
                ],
              });

            if (modo === 'empilhado') {
              let acumulado = 0;
              return (
                <g key={d.rotulo} onMouseMove={aoEntrar} {...gatilho(d, i)}>
                  <rect
                    x={centro - passoCategoria / 2}
                    y={margem.topo}
                    width={passoCategoria}
                    height={alturaPlot}
                    fill="transparent"
                  />
                  {series.map((s) => {
                    const valor = d.valores[s.chave] ?? 0;
                    const base = acumulado;
                    acumulado += valor;
                    const topo = y(acumulado);
                    // 2px de respiro na superfície separam as fatias sem contorno.
                    const alturaFatia = Math.max(y(base) - topo - 2, 0);
                    if (alturaFatia <= 0) return null;
                    return (
                      <path
                        key={s.chave}
                        d={caminhoBarra(centro - larguraGrupo / 2, topo, larguraGrupo, alturaFatia)}
                        fill={s.cor}
                      />
                    );
                  })}
                </g>
              );
            }

            const larguraBarra = Math.max((larguraGrupo - 2 * (series.length - 1)) / series.length, 3);
            return (
              <g key={d.rotulo} onMouseMove={aoEntrar} {...gatilho(d, i)}>
                <rect
                  x={centro - passoCategoria / 2}
                  y={margem.topo}
                  width={passoCategoria}
                  height={alturaPlot}
                  fill="transparent"
                />
                {series.map((s, j) => {
                  const valor = d.valores[s.chave] ?? 0;
                  const x = centro - larguraGrupo / 2 + j * (larguraBarra + 2);
                  return (
                    <path key={s.chave} d={caminhoBarra(x, y(valor), larguraBarra, y(0) - y(valor))} fill={s.cor} />
                  );
                })}
              </g>
            );
          })}
        </g>

        {dados.map((d, i) => (
          <text
            key={d.rotulo}
            x={margem.esquerda + passoCategoria * (i + 0.5)}
            y={altura - 8}
            textAnchor="middle"
            fontSize={10.5}
            fill="var(--tinta-fraca)"
          >
            {dados.length > 14 && i % 2 === 1 ? '' : d.rotulo}
          </text>
        ))}
      </svg>
      <Dica estado={dica} />
      <AlternarTabela aberta={tabela} alternar={() => setTabela((v) => !v)} />
      {tabela && <TabelaDados dados={dados} series={series} formatar={formatar} rotuloCategoria={rotuloCategoria} />}
    </>
  );
}

// ==========================================================================
// Linhas com crosshair
// ==========================================================================

export function GraficoLinhas({
  dados,
  series,
  formatar,
  formatarEixo,
  altura = 240,
  rotuloCategoria = 'Competência',
  sufixoEixo,
  aoClicar,
}: {
  dados: PontoCategoria[];
  series: Serie[];
  formatar: (v: number) => string;
  formatarEixo?: (v: number) => string;
  altura?: number;
  rotuloCategoria?: string;
  sufixoEixo?: string;
  /** Com isto, clicar no gráfico abre os registros do ponto mais próximo. */
  aoClicar?: (ponto: PontoCategoria, indice: number) => void;
}) {
  const [indice, setIndice] = useState<number | null>(null);
  const [dica, setDica] = useState<DicaEstado | null>(null);
  const [tabela, setTabela] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const margem = { topo: 12, direita: 34, base: 26, esquerda: 78 };
  const largura = 720;
  const alturaPlot = altura - margem.topo - margem.base;
  const larguraPlot = largura - margem.esquerda - margem.direita;

  const maximo = Math.max(...dados.flatMap((d) => series.map((s) => d.valores[s.chave] ?? 0)), 0);
  const { teto, marcas } = escala(maximo);
  const y = (v: number) => margem.topo + alturaPlot - (v / teto) * alturaPlot;
  const x = (i: number) => margem.esquerda + (dados.length <= 1 ? larguraPlot / 2 : (larguraPlot * i) / (dados.length - 1));

  if (dados.length === 0) return <p className="vazio">Sem dados no período consultado.</p>;

  const aoMover = (evento: React.MouseEvent) => {
    const caixa = svgRef.current?.getBoundingClientRect();
    if (!caixa) return;
    const relativo = ((evento.clientX - caixa.left) / caixa.width) * largura;
    const i = Math.round(
      ((relativo - margem.esquerda) / (larguraPlot || 1)) * Math.max(dados.length - 1, 1),
    );
    const alvo = Math.max(0, Math.min(dados.length - 1, i));
    setIndice(alvo);
    setDica({
      x: evento.clientX,
      y: evento.clientY,
      titulo: dados[alvo]!.rotulo,
      linhas: series.map((s) => ({ nome: s.nome, valor: formatar(dados[alvo]!.valores[s.chave] ?? 0), cor: s.cor })),
    });
  };

  return (
    <>
      <Legenda series={series} />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${largura} ${altura}`}
        style={{ width: '100%', height: 'auto', display: 'block', marginTop: 8, cursor: aoClicar ? 'pointer' : undefined }}
        role="img"
        aria-label={`Série temporal por ${rotuloCategoria.toLowerCase()}`}
        onMouseMove={aoMover}
        onMouseLeave={() => {
          setIndice(null);
          setDica(null);
        }}
        // Clica no ponto que o cursor já destacou: é o mesmo que o tooltip
        // está mostrando, então não há surpresa entre o que se vê e o que abre.
        onClick={aoClicar && indice !== null ? () => { setDica(null); aoClicar(dados[indice]!, indice); } : undefined}
      >
        {marcas.map((m) => (
          <g key={m}>
            <line
              x1={margem.esquerda}
              x2={largura - margem.direita}
              y1={y(m)}
              y2={y(m)}
              stroke={m === 0 ? 'var(--eixo)' : 'var(--grade)'}
              strokeWidth={1}
            />
            <text x={margem.esquerda - 8} y={y(m) + 4} textAnchor="end" fontSize={10.5} fill="var(--tinta-fraca)">
              {(formatarEixo ?? formatar)(m)}
              {sufixoEixo}
            </text>
          </g>
        ))}

        {indice !== null && (
          <line x1={x(indice)} x2={x(indice)} y1={margem.topo} y2={margem.topo + alturaPlot} stroke="var(--eixo)" strokeWidth={1} />
        )}

        {series.map((s) => {
          const caminho = dados
            .map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.valores[s.chave] ?? 0)}`)
            .join(' ');
          return (
            <g key={s.chave}>
              <path d={caminho} fill="none" stroke={s.cor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {dados.map((d, i) => (
                <circle
                  key={d.rotulo}
                  cx={x(i)}
                  cy={y(d.valores[s.chave] ?? 0)}
                  r={indice === i ? 5 : 3.5}
                  fill={s.cor}
                  stroke="var(--superficie)"
                  strokeWidth={2}
                />
              ))}
            </g>
          );
        })}

        {dados.map((d, i) => (
          <text
            key={d.rotulo}
            x={x(i)}
            y={altura - 8}
            // As pontas ancoram para dentro para não vazarem da área do gráfico.
            textAnchor={i === 0 ? 'start' : i === dados.length - 1 ? 'end' : 'middle'}
            fontSize={10.5}
            fill="var(--tinta-fraca)"
          >
            {dados.length > 14 && i % 2 === 1 ? '' : d.rotulo}
          </text>
        ))}
      </svg>
      <Dica estado={dica} />
      <AlternarTabela aberta={tabela} alternar={() => setTabela((v) => !v)} />
      {tabela && <TabelaDados dados={dados} series={series} formatar={formatar} rotuloCategoria={rotuloCategoria} />}
    </>
  );
}

// ==========================================================================
// Barras horizontais ranqueadas (uma série — a cor não codifica magnitude)
// ==========================================================================

export function GraficoRanking({
  itens,
  formatar,
  cor = 'var(--serie-1)',
  maximoItens = 10,
  rotuloCategoria = 'Categoria',
  rotuloValor = 'Valor',
  aoClicar,
}: {
  itens: Array<{ rotulo: string; valor: number; apoio?: string }>;
  formatar: (v: number) => string;
  cor?: string;
  maximoItens?: number;
  rotuloCategoria?: string;
  rotuloValor?: string;
  /** Com isto, cada item vira gatilho de drill-down. */
  aoClicar?: (item: { rotulo: string; valor: number; apoio?: string }) => void;
}) {
  const [tabela, setTabela] = useState(false);
  if (itens.length === 0) return <p className="vazio">Sem dados no período consultado.</p>;

  const ordenados = [...itens].sort((a, b) => b.valor - a.valor);
  const visiveis = ordenados.slice(0, maximoItens);
  const resto = ordenados.slice(maximoItens);
  // Nunca geramos uma nova cor: a cauda vira uma linha "Outros".
  const lista =
    resto.length > 0
      ? [...visiveis, { rotulo: `Outros (${resto.length})`, valor: resto.reduce((s, i) => s + i.valor, 0) }]
      : visiveis;
  const maximo = Math.max(...lista.map((i) => i.valor), 0) || 1;

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {lista.map((item) => {
          // "Outros" é a cauda agregada: não tem um recorte próprio para abrir.
          const clicavel = aoClicar && !item.rotulo.startsWith('Outros (');
          const dica =
            `${item.rotulo}\n${formatar(item.valor)} · ${((item.valor / (lista.reduce((s, i) => s + i.valor, 0) || 1)) * 100).toFixed(1)}% do exibido` +
            (item.apoio ? `\n${item.apoio}` : '') +
            (clicavel ? '\n\nClique para ver os registros que compõem este número.' : '');
          return (
            <div
              key={item.rotulo}
              className={clicavel ? 'drill' : undefined}
              title={dica}
              role={clicavel ? 'button' : undefined}
              tabIndex={clicavel ? 0 : undefined}
              aria-label={clicavel ? `${item.rotulo} — abrir os registros que compõem este número` : undefined}
              onClick={clicavel ? () => aoClicar!(item) : undefined}
              onKeyDown={
                clicavel
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        aoClicar!(item);
                      }
                    }
                  : undefined
              }
              style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, padding: clicavel ? '2px 4px' : undefined, borderRadius: 6 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, gridColumn: '1 / -1' }}>
                <span style={{ fontSize: 12.5, color: 'var(--tinta-2)' }}>{item.rotulo}</span>
                <span style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums', fontWeight: 550 }}>
                  {formatar(item.valor)}
                  {item.apoio && <em style={{ color: 'var(--tinta-fraca)', fontStyle: 'normal' }}> · {item.apoio}</em>}
                </span>
              </div>
              <div style={{ gridColumn: '1 / -1', height: 8, background: 'var(--superficie-2)', borderRadius: 4 }}>
                <div
                  style={{
                    width: `${Math.max((item.valor / maximo) * 100, 1)}%`,
                    height: '100%',
                    background: cor,
                    borderRadius: 4,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <AlternarTabela aberta={tabela} alternar={() => setTabela((v) => !v)} />
      {tabela && (
        <div className="tabela-envolucro">
          <table>
            <thead>
              <tr>
                <th>{rotuloCategoria}</th>
                <th className="num">{rotuloValor}</th>
              </tr>
            </thead>
            <tbody>
              {ordenados.map((i) => (
                <tr key={i.rotulo}>
                  <td>{i.rotulo}</td>
                  <td className="num">{formatar(i.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/**
 * Uma linha da quebra por unidade, como o servidor a devolve.
 *
 * Vive aqui, e não na página, porque duas telas leem a mesma quebra: o Painel
 * Executivo e Indicadores Gerais. Uma cópia por tela seria uma chance por tela
 * de as duas divergirem na primeira correção.
 */
export interface LinhaPorUnidade {
  empresa_id: number;
  empresa: string;
  filial_id: number | null;
  filial: string | null;
  valor: number;
  total?: number;
  dentro?: number;
}


/**
 * A quebra de um número em matriz → filial.
 *
 * O consolidado por matriz é a soma das filiais dela: é o que a sanfona mostra,
 * e é o que tem de bater com o número do card. Quando não bate, o problema está
 * na consulta — e é melhor que apareça aqui do que numa reunião.
 */
export function porMatriz(linhas: LinhaPorUnidade[], cores: Map<number, MatrizComCor>) {
  const mapa = new Map<number, { id: number; nome: string; cor: string; valor: number; filiais: LinhaPorUnidade[] }>();
  for (const l of linhas) {
    const atual = mapa.get(l.empresa_id) ?? {
      id: l.empresa_id,
      nome: l.empresa,
      cor: cores.get(l.empresa_id)?.cor ?? 'var(--tinta-fraca)',
      valor: 0,
      filiais: [] as LinhaPorUnidade[],
    };
    atual.valor += l.valor;
    atual.filiais.push(l);
    mapa.set(l.empresa_id, atual);
  }
  return [...mapa.values()]
    .map((m) => ({ ...m, filiais: m.filiais.sort((a, b) => b.valor - a.valor) }))
    .sort((a, b) => b.valor - a.valor);
}

/**
 * A tabela da sanfona. `conformidade` é a coluna de ✓/✗, só no SLA.
 *
 * O alvo vem de fora: era uma constante copiada aqui, e desde que a meta virou
 * cadastro a tela não tem como saber qual é sem perguntar ao servidor.
 */
export function TabelaPorUnidade({
  linhas,
  cores,
  formatar,
  rotuloValor,
  conformidade,
  alvo,
}: {
  linhas: LinhaPorUnidade[];
  cores: Map<number, MatrizComCor>;
  formatar: (v: number) => string;
  rotuloValor: string;
  conformidade?: boolean;
  /** O alvo de conformidade vigente. Ausente: a coluna não julga, só mostra. */
  alvo?: number | null;
}) {
  const grupos = porMatriz(linhas, cores);
  if (!grupos.length) return <p className="vazio">Nada neste recorte.</p>;
  const situacao = (l: { total?: number; dentro?: number }) => {
    const total = l.total ?? 0;
    if (!total) return <span>—</span>;
    const pct = Math.round(((l.dentro ?? 0) / total) * 1000) / 10;
    const fora = total - (l.dentro ?? 0);
    return alvo === null || alvo === undefined || pct >= alvo ? (
      <span className="dentro">✓ {pct.toLocaleString('pt-BR')}% · dentro</span>
    ) : (
      <span className="fora">✗ {pct.toLocaleString('pt-BR')}% · fora ({inteiro(fora)})</span>
    );
  };
  return (
    <table>
      <thead>
        <tr>
          <th>Empresa / filial</th>
          <th className="n">{rotuloValor}</th>
          {conformidade && <th>Conformidade</th>}
        </tr>
      </thead>
      <tbody>
        {grupos.map((m) => (
          <Fragment key={m.id}>
            <tr className="matriz">
              <td>
                <i
                  style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: m.cor, marginRight: 6 }}
                  aria-hidden
                />
                {m.nome}
              </td>
              <td className="n">{formatar(m.valor)}</td>
              {conformidade && (
                <td>
                  {situacao({
                    total: m.filiais.reduce((s, f) => s + (f.total ?? 0), 0),
                    dentro: m.filiais.reduce((s, f) => s + (f.dentro ?? 0), 0),
                  })}
                </td>
              )}
            </tr>
            {m.filiais.map((f) => (
              <tr className="filial" key={`${m.id}:${f.filial_id ?? 'matriz'}`}>
                <td>{f.filial ?? 'Sem filial (nível empresa)'}</td>
                <td className="n">{formatar(f.valor)}</td>
                {conformidade && <td>{situacao(f)}</td>}
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

// ==========================================================================
// Indicador (o número é o gráfico)
// ==========================================================================

/** Uma fatia do número consolidado: de quem é, quanto, e com que cor. */
/**
 * O balão com atraso, para quem passa o cursor de raspão.
 *
 * Sem atraso, atravessar uma tabela de vinte barras pisca vinte balões pelo
 * caminho. Com ele, o balão só aparece onde o cursor PAROU — que é onde havia
 * intenção de ler. 180 ms é o ponto em que o gesto deliberado já espera algo e
 * o de passagem ainda não.
 *
 * O foco do teclado NÃO espera: quem chegou ali por Tab já escolheu o
 * elemento, e um atraso seria só demora.
 */
export function useDica() {
  const [dica, setDica] = useState<DicaEstado | null>(null);
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fechar = useCallback(() => {
    if (relogio.current) clearTimeout(relogio.current);
    relogio.current = null;
    setDica(null);
  }, []);

  // Um balão pendurado num elemento que saiu da tela ficaria para sempre.
  useEffect(() => () => { if (relogio.current) clearTimeout(relogio.current); }, []);

  /** Os manipuladores prontos para espalhar num elemento. */
  const gatilho = useCallback(
    (montar: () => Omit<DicaEstado, 'x' | 'y'>) => ({
      onMouseEnter: (ev: { clientX: number; clientY: number }) => {
        const x = ev.clientX;
        const y = ev.clientY;
        if (relogio.current) clearTimeout(relogio.current);
        relogio.current = setTimeout(() => setDica({ x, y, ...montar() }), 180);
      },
      // Seguir o cursor só depois que o balão abriu: mover antes disso
      // reiniciaria o atraso a cada pixel e ele nunca chegaria ao fim.
      onMouseMove: (ev: { clientX: number; clientY: number }) =>
        setDica((atual) => (atual ? { ...atual, x: ev.clientX, y: ev.clientY } : atual)),
      onMouseLeave: fechar,
      onFocus: (ev: { currentTarget: Element }) => {
        const c = ev.currentTarget.getBoundingClientRect();
        setDica({ x: c.left + c.width / 2, y: c.bottom, ...montar() });
      },
      onBlur: fechar,
      tabIndex: 0,
    }),
    [fechar],
  );

  return { dica, gatilho, fechar };
}

export interface FatiaIndicador {
  nome: string;
  cor: string;
  valor: number;
  /** O valor já formatado, para o tooltip dizer "R$ 12 mil" e não "12000". */
  texto?: string;
}

/**
 * A divisão do número por empresa matriz, em faixa.
 *
 * O indicador continua CONSOLIDADO — é o pedido: um número só. A faixa diz de
 * quem é cada pedaço sem obrigar a abrir nada. Com uma matriz só ela não
 * aparece: não haveria o que distinguir, e uma barra de cor única viraria
 * enfeite.
 */
function FaixaDeMatrizes({ fatias }: { fatias: FatiaIndicador[] }) {
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  if (fatias.length < 2 || total <= 0) return null;
  return (
    <span className="faixa-matrizes" aria-hidden>
      {fatias.map((f) => (
        <i
          key={f.nome}
          style={{ background: f.cor, flexGrow: f.valor }}
          title={`${f.nome}: ${f.texto ?? f.valor.toLocaleString('pt-BR')}`}
        />
      ))}
    </span>
  );
}

export interface LeituraMeta {
  alvo: number;
  atingido: number | null;
  direcao: 'minimo' | 'maximo';
  atinge: boolean;
  distancia: number | null;
}

/**
 * A leitura quando o recorte atravessa vigências de meta.
 *
 * Um recorte é um PERÍODO e o cadastro tem vigência: 01/2026 a 01/2027 pode
 * cair sob duas metas. Uma barra contra um alvo único mentiria — não há um
 * alvo só para o período —, então o que se mostra é o placar de meses.
 */
export interface LeituraMetaMensal {
  varias: true;
  metas: Array<{ id: number; nome: string; alvo_pct: number; vigencia_inicio: string | null; vigencia_fim: string | null }>;
  meses: Array<{ competencia: string; alvo: number; valor: number; atinge: boolean }>;
  dentro: number;
  total: number;
  direcao: 'minimo' | 'maximo';
  atinge: boolean;
}

export type LeituraDeMeta = LeituraMeta | LeituraMetaMensal;

const ehMensal = (m: LeituraDeMeta): m is LeituraMetaMensal => 'varias' in m && m.varias === true;

/** "90% de 01/2026 a 08/2026" — a vigência legível ao lado do alvo. */
export function vigenciaDaMeta(m: LeituraMetaMensal['metas'][number]): string {
  const br = (c: string) => c.slice(5) + '/' + c.slice(0, 4);
  if (!m.vigencia_inicio && !m.vigencia_fim) return 'sempre';
  if (m.vigencia_inicio && !m.vigencia_fim) return `de ${br(m.vigencia_inicio)} em diante`;
  if (!m.vigencia_inicio && m.vigencia_fim) return `até ${br(m.vigencia_fim)}`;
  return `${br(m.vigencia_inicio!)} a ${br(m.vigencia_fim!)}`;
}

/** As metas do período em uma frase — para o cabeçalho do módulo. */
export function resumoDeMeta(meta: LeituraDeMeta | null | undefined): string {
  if (!meta) return '';
  if (ehMensal(meta)) {
    return meta.metas.map((m) => `${m.alvo_pct.toLocaleString('pt-BR')}% ${vigenciaDaMeta(m)}`).join(' · ');
  }
  return `meta de ${meta.alvo.toLocaleString('pt-BR')}%`;
}

/**
 * Meta vs Resultado — o alvo ao lado do número.
 *
 * Um indicador que mostra só o resultado obriga quem lê a saber de cabeça o
 * que era esperado. A barra é a mesma leitura do termômetro que o artifact já
 * usa: preenchimento proporcional ao resultado e um traço no alvo.
 *
 * Sem resultado (nenhum atendimento no mês, nenhuma tarefa entregue) a barra
 * não aparece: uma barra vazia diria "0%", que é diferente de "não houve".
 */
function MetaVsResultado({ meta }: { meta: LeituraDeMeta }) {
  // Recorte que atravessa vigências: o placar de meses e as metas nomeadas.
  if (ehMensal(meta)) {
    const lista = meta.metas
      .map((m) => `${m.nome} ${m.alvo_pct.toLocaleString('pt-BR')}% (${vigenciaDaMeta(m)})`)
      .join(' · ');
    if (!meta.total) {
      return (
        <span className="meta-indicador sem-dado">
          {meta.metas.length} metas no período · sem resultado mensal para comparar
        </span>
      );
    }
    const pct = Math.round((meta.dentro / meta.total) * 100);
    return (
      <span
        className={`meta-indicador ${meta.atinge ? 'dentro' : 'fora'}`}
        title={`Cada mês é medido contra a meta que rege aquele mês: ${lista}.`}
      >
        <span className="meta-barra" aria-hidden>
          <i style={{ width: `${pct}%` }} />
        </span>
        <span className="meta-texto">
          {meta.atinge ? '✓' : '✗'} {meta.dentro} de {meta.total}{' '}
          {meta.total === 1 ? 'mês dentro' : 'meses dentro'} da meta
        </span>
        <small style={{ color: 'var(--tinta-fraca)', fontSize: 10.5 }}>{lista}</small>
      </span>
    );
  }

  if (meta.atingido === null) {
    return <span className="meta-indicador sem-dado">meta {meta.alvo.toLocaleString('pt-BR')}% · sem resultado no período</span>;
  }
  const largura = Math.max(0, Math.min(100, meta.atingido));
  const alvo = Math.max(0, Math.min(100, meta.alvo));
  const comparador = meta.direcao === 'minimo' ? 'mínimo' : 'teto';
  return (
    <span
      className={`meta-indicador ${meta.atinge ? 'dentro' : 'fora'}`}
      title={`Resultado ${meta.atingido.toLocaleString('pt-BR')}% contra ${comparador} de ${meta.alvo.toLocaleString('pt-BR')}%.`}
    >
      <span className="meta-barra" aria-hidden>
        <i style={{ width: `${largura}%` }} />
        <b style={{ left: `${alvo}%` }} />
      </span>
      <span className="meta-texto">
        {meta.atinge ? '✓' : '✗'} {meta.atingido.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% ·{' '}
        {comparador} {meta.alvo.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
      </span>
    </span>
  );
}

/** Um lançamento na folha da árvore, como `/api/indicadores` o devolve. */
export interface FolhaDespesa {
  id: number;
  competencia: string;
  descricao: string;
  tipo_despesa: string;
  compartilhada: boolean;
  valor: number;
  pct_da_filial: number;
}

export interface NoFilial {
  filial_id: number | null;
  filial: string;
  valor: number;
  compartilhado: number;
  pct_da_empresa: number;
  itens: FolhaDespesa[];
}

export interface NoEmpresa {
  empresa_id: number;
  empresa: string;
  valor: number;
  compartilhado: number;
  pct_do_total: number;
  filiais: NoFilial[];
}

/**
 * A barra de representatividade: o peso de um nó dentro do pai.
 *
 * O percentual vai ESCRITO ao lado, e a barra é redundância visual — quem não
 * distingue a cor lê o número, e quem lê rápido vê a proporção.
 */
export function BarraRepresentatividade({
  pct,
  cor,
  dica,
  gatilho,
}: {
  pct: number;
  cor: string;
  dica: string;
  gatilho?: Record<string, unknown>;
}) {
  return (
    <span className="barra-rep" title={dica} {...gatilho}>
      <span aria-hidden>
        <i style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: cor }} />
      </span>
      <b>{pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</b>
    </span>
  );
}

/**
 * A legenda fixa dos dois tons de cada empresa.
 *
 * Vai no bloco que usa a distinção, e não uma vez na tela: quem rola até o
 * meio de uma tela longa precisa da chave de leitura ali.
 */
export function LegendaDeMatrizes({ fatias }: { fatias: FatiaIndicador[] }) {
  const visiveis = fatias.filter((f) => f.valor > 0);
  if (visiveis.length < 2) return null;
  return (
    <div className="legenda" style={{ marginTop: 8, fontSize: 11.5 }}>
      {visiveis.map((f) => (
        <span key={f.nome}>
          <i style={{ background: f.cor }} />
          {f.nome} · {f.texto ?? f.valor.toLocaleString('pt-BR')}
        </span>
      ))}
    </div>
  );
}

/**
 * A árvore de um indicador: empresa (nível 1) → filial (nível 2) →
 * lançamentos (nível 3), com o MESMO formato nos três níveis.
 *
 * `TabelaPorUnidade` continua servindo ao Painel Executivo, que é um resumo de
 * dois níveis. Aqui a leitura é outra: cada nó tem o seu controle, cada linha
 * tem a sua barra, e o terceiro nível existe.
 *
 * O nível 3 é montado só quando a filial abre — é o `lazy` do enunciado. Os
 * itens já vieram na resposta, então nada é reconsultado; o que se evita é
 * criar milhares de linhas no DOM por algo que quase ninguém abre.
 */
export function ArvoreDeUnidades({
  empresas,
  cores,
  formatar,
  rotuloValor,
  periodo,
  chaveEstado,
}: {
  empresas: NoEmpresa[];
  cores: Map<number, MatrizComCor>;
  formatar: (v: number) => string;
  rotuloValor: string;
  /** O recorte, para o tooltip dizer de quando é o número. */
  periodo?: string;
  /** Onde a expansão fica guardada. Telas diferentes não compartilham estado. */
  chaveEstado: string;
}) {
  const expansao = useExpansao(chaveEstado, 'recolhido');
  const { dica, gatilho } = useDica();
  if (!empresas.length) return <p className="vazio">Nada neste recorte.</p>;

  const corDe = (id: number) => cores.get(id)?.cor ?? 'var(--tinta-fraca)';
  const corEscuraDe = (id: number) => cores.get(id)?.corCompartilhada ?? 'var(--tinta-fraca)';
  const sufixo = periodo ? ` · ${periodo}` : '';

  return (
    <>
      <table className="arvore-unidades">
        <thead>
          <tr>
            <th>Empresa / filial</th>
            <th className="n">{rotuloValor}</th>
            <th>Representatividade</th>
          </tr>
        </thead>
        <tbody>
          {empresas.map((e) => {
            const chaveE = `e${e.empresa_id}`;
            const abertaE = expansao.expandido(chaveE);
            return (
              <Fragment key={e.empresa_id}>
                <tr className="nivel-1">
                  <td>
                    <button
                      type="button"
                      className="arv-abrir"
                      aria-expanded={abertaE}
                      aria-label={`${abertaE ? 'Recolher' : 'Expandir'} as filiais de ${e.empresa}`}
                      onClick={() => expansao.alternar(chaveE)}
                    >
                      <span aria-hidden>{abertaE ? '−' : '+'}</span>
                    </button>
                    <i className="ponto-matriz" style={{ background: corDe(e.empresa_id) }} aria-hidden />
                    {e.empresa}
                  </td>
                  <td className="n">{formatar(e.valor)}</td>
                  <td>
                    <BarraRepresentatividade
                      pct={e.pct_do_total}
                      cor={corDe(e.empresa_id)}
                      dica={`${e.empresa}: ${formatar(e.valor)} · ${e.pct_do_total.toLocaleString('pt-BR')}% do recorte${sufixo}`}
                      gatilho={gatilho(() => ({
                        titulo: e.empresa,
                        linhas: [
                          { nome: 'Valor', valor: formatar(e.valor) },
                          { nome: 'Peso no recorte', valor: `${e.pct_do_total.toLocaleString('pt-BR')}%`, cor: corDe(e.empresa_id) },
                          { nome: 'Compartilhada', valor: formatar(e.compartilhado), cor: corEscuraDe(e.empresa_id) },
                          { nome: 'Filiais', valor: inteiro(e.filiais.length) },
                          ...(periodo ? [{ nome: 'Período', valor: periodo }] : []),
                        ],
                      }))}
                    />
                  </td>
                </tr>
                {abertaE && e.filiais.length === 0 && (
                  <tr className="nivel-2">
                    <td colSpan={3} className="vazio-no">Esta empresa não tem filial no recorte.</td>
                  </tr>
                )}
                {abertaE &&
                  e.filiais.map((f) => {
                    const chaveF = `${chaveE}:f${f.filial_id ?? 'matriz'}`;
                    const abertaF = expansao.expandido(chaveF);
                    return (
                      <Fragment key={chaveF}>
                        <tr className="nivel-2">
                          <td>
                            {f.itens.length > 0 ? (
                              <button
                                type="button"
                                className="arv-abrir"
                                aria-expanded={abertaF}
                                aria-label={`${abertaF ? 'Recolher' : 'Expandir'} os lançamentos de ${f.filial}`}
                                onClick={() => expansao.alternar(chaveF)}
                              >
                                <span aria-hidden>{abertaF ? '−' : '+'}</span>
                              </button>
                            ) : (
                              <span className="arv-vazio" aria-hidden />
                            )}
                            {f.filial}
                          </td>
                          <td className="n">{formatar(f.valor)}</td>
                          <td>
                            <BarraRepresentatividade
                              pct={f.pct_da_empresa}
                              cor={corDe(e.empresa_id)}
                              dica={`${f.filial}: ${formatar(f.valor)} · ${f.pct_da_empresa.toLocaleString('pt-BR')}% de ${e.empresa}${sufixo}`}
                              gatilho={gatilho(() => ({
                                titulo: f.filial,
                                linhas: [
                                  { nome: 'Valor', valor: formatar(f.valor) },
                                  { nome: `Peso em ${e.empresa}`, valor: `${f.pct_da_empresa.toLocaleString('pt-BR')}%`, cor: corDe(e.empresa_id) },
                                  { nome: 'Compartilhada', valor: formatar(f.compartilhado), cor: corEscuraDe(e.empresa_id) },
                                  { nome: 'Empresa', valor: e.empresa },
                                  ...(periodo ? [{ nome: 'Período', valor: periodo }] : []),
                                ],
                              }))}
                            />
                          </td>
                        </tr>
                        {/* Carga sob demanda: as folhas só entram no DOM quando
                            a filial abre. Montá-las na pintura custaria
                            milhares de linhas por algo que quase ninguém abre. */}
                        {abertaF &&
                          f.itens.slice(0, 200).map((i) => (
                            <tr className="nivel-3" key={i.id}>
                              <td>
                                <span className="arv-vazio" aria-hidden />
                                <span className="arv-vazio" aria-hidden />
                                {i.descricao}
                                <span className="arv-comp">{i.competencia}</span>
                              </td>
                              <td className="n">{formatar(i.valor)}</td>
                              <td>
                                <BarraRepresentatividade
                                  pct={i.pct_da_filial}
                                  cor={i.compartilhada ? corEscuraDe(e.empresa_id) : corDe(e.empresa_id)}
                                  dica={`${i.descricao}: ${formatar(i.valor)} · ${i.pct_da_filial.toLocaleString('pt-BR')}% de ${f.filial} · ${i.competencia}${
                                    i.compartilhada ? ' · compartilhada com o grupo' : ''
                                  }`}
                                  gatilho={gatilho(() => ({
                                    titulo: i.descricao,
                                    linhas: [
                                      { nome: 'Valor', valor: formatar(i.valor) },
                                      { nome: `Peso em ${f.filial}`, valor: `${i.pct_da_filial.toLocaleString('pt-BR')}%` },
                                      { nome: 'Competência', valor: i.competencia },
                                      { nome: 'Tipo de despesa', valor: i.tipo_despesa },
                                      {
                                        nome: 'Consumo',
                                        valor: i.compartilhada ? 'Compartilhada no grupo' : '100% da filial',
                                        cor: i.compartilhada ? corEscuraDe(e.empresa_id) : corDe(e.empresa_id),
                                      },
                                    ],
                                  }))}
                                />
                              </td>
                            </tr>
                          ))}
                        {abertaF && f.itens.length > 200 && (
                          <tr className="nivel-3">
                            <td colSpan={3} className="vazio-no">
                              Exibindo os 200 maiores de {inteiro(f.itens.length)}. Estreite o recorte para ver o resto.
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <Dica estado={dica} />
    </>
  );
}

export function Indicador({
  rotulo,
  valor,
  apoio,
  delta,
  deltaBomQuandoCai = true,
  dica,
  aoDetalhar,
  fatias,
  meta,
  detalhePorUnidade,
}: {
  rotulo: string;
  valor: ReactNode;
  apoio?: ReactNode;
  delta?: number | null;
  deltaBomQuandoCai?: boolean;
  /** Contexto no hover: o que o número significa, de onde sai. */
  dica?: string;
  /**
   * Abre os registros que compõem o número. Sem isto o indicador segue só
   * informativo — nem todo número tem registros por trás (uma mediana, um
   * percentual isolado), e fingir que tem seria pior do que não oferecer.
   */
  aoDetalhar?: () => void;
  /** A divisão por empresa matriz, para a faixa de cores e a legenda. */
  fatias?: FatiaIndicador[];
  /** O alvo contra o qual este número é lido. Ausente: o card mostra só o resultado. */
  meta?: LeituraDeMeta | null;
  /**
   * A sanfona: o detalhamento hierárquico matriz → filial, revelado abaixo do
   * card. Fica num botão PRÓPRIO, e não no corpo: o corpo já abre o
   * detalhamento, e dois gestos no mesmo alvo brigariam.
   */
  detalhePorUnidade?: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const classe =
    delta === null || delta === undefined || Math.abs(delta) < 0.05
      ? 'neutro'
      : (delta > 0) === deltaBomQuandoCai
        ? 'sobe'
        : 'desce';
  const simbolo = delta === null || delta === undefined ? '' : delta > 0 ? '▲' : delta < 0 ? '▼' : '■';
  const conteudo = (
    <>
      <span className="rotulo">{rotulo}</span>
      <span className="numero">{valor}</span>
      {delta !== null && delta !== undefined && (
        <span className={`delta ${classe}`}>
          {simbolo} {Math.abs(delta).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs. mês anterior
        </span>
      )}
      {meta && <MetaVsResultado meta={meta} />}
      {apoio && <span className="apoio">{apoio}</span>}
      {fatias && <FaixaDeMatrizes fatias={fatias} />}
    </>
  );

  // A sanfona é um irmão do card, e não parte dele: dentro do card ela herdaria
  // o clique do drill-down, e abrir o detalhe por filial abriria o modal junto.
  const sanfona = detalhePorUnidade ? (
    <div className="indicador-unidades">
      <button
        type="button"
        className="botao discreto pequeno"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
      >
        {aberto ? '−' : '+'} por unidade
      </button>
      {aberto && <div className="indicador-unidades-corpo">{detalhePorUnidade}</div>}
    </div>
  ) : null;

  if (!aoDetalhar) {
    return (
      <div className="cartao indicador" title={dica}>
        {conteudo}
        {sanfona}
      </div>
    );
  }
  // Um `button` de verdade traria estilo e semântica de formulário no meio de
  // um cartão; `role`/`tabIndex`/teclado dão o mesmo comportamento sem isso.
  return (
    <div
      className="cartao indicador drill"
      role="button"
      tabIndex={0}
      title={dica ? `${dica}\n\nClique para ver os registros que compõem este número.` : 'Clique para ver os registros que compõem este número.'}
      aria-label={`${rotulo} — abrir os registros que compõem este número`}
      onClick={aoDetalhar}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          aoDetalhar();
        }
      }}
    >
      {conteudo}
      {/* O clique na sanfona não pode subir para o card: ele abriria o modal. */}
      {sanfona && (
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
          {sanfona}
        </div>
      )}
    </div>
  );
}
