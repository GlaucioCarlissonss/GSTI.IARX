/**
 * Kit de gráficos em SVG.
 *
 * Regras aplicadas em todos: marca fina, grade em fio de cabelo, topo de barra
 * arredondado em 4px ancorado na linha de base, 2px de respiro entre fatias,
 * legenda sempre presente quando há duas ou mais séries, tooltip no hover e
 * visão em tabela como alternativa acessível ao canal de cor.
 */
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';

export interface Serie {
  chave: string;
  nome: string;
  cor: string;
}

export interface PontoCategoria {
  rotulo: string;
  valores: Record<string, number>;
}

interface DicaEstado {
  x: number;
  y: number;
  titulo: string;
  linhas: Array<{ nome: string; valor: string; cor?: string }>;
}

function Dica({ estado }: { estado: DicaEstado | null }) {
  if (!estado) return null;
  const estilo = {
    left: Math.min(estado.x + 14, window.innerWidth - 220),
    top: Math.max(estado.y - 12, 8),
  };
  return (
    <div className="dica" style={estilo} role="tooltip">
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

// ==========================================================================
// Indicador (o número é o gráfico)
// ==========================================================================

/** Uma fatia do número consolidado: de quem é, quanto, e com que cor. */
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
 * Meta vs Resultado — o alvo ao lado do número.
 *
 * Um indicador que mostra só o resultado obriga quem lê a saber de cabeça o
 * que era esperado. A barra é a mesma leitura do termômetro que o artifact já
 * usa: preenchimento proporcional ao resultado e um traço no alvo.
 *
 * Sem resultado (nenhum atendimento no mês, nenhuma tarefa entregue) a barra
 * não aparece: uma barra vazia diria "0%", que é diferente de "não houve".
 */
function MetaVsResultado({ meta }: { meta: LeituraMeta }) {
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
  meta?: LeituraMeta | null;
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
