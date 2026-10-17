/**
 * Conciliação da carga: o que o arquivo traz × o que o cliente já cadastrou.
 *
 * A tela existe para impedir um estrago específico. Na base de setembro, cinco
 * dos oito centros de custo diferem do cadastro só por acento ou espaço —
 * importar sem conferir criaria cinco cadastros duplicados e penduraria 95 das
 * 110 despesas neles.
 *
 * Por isso nada aqui decide sozinho: o sistema classifica, sugere, e espera.
 * "Prosseguir" só acende quando não sobra nenhuma divergência sem resposta — e
 * o servidor confere de novo, porque esta tela pode ser contornada.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Etiqueta } from './base';

export type Situacao = 'IGUAL' | 'DIVERGENTE' | 'NOVO' | 'INVALIDO';

export interface ItemConciliacao {
  valor: string;
  situacao: Situacao;
  ocorrencias: number;
  linhas: number[];
  sugestao: { id: number | null; nome: string; confianca: number; motivo: 'grafia' | 'semelhanca' } | null;
}

export interface BlocoConciliacao {
  dimensao: string;
  rotulo: string;
  obrigatoria: boolean;
  permiteCriar: boolean;
  itens: ItemConciliacao[];
  pendentes: number;
  candidatos: Array<{ id: number | null; nome: string }>;
}

export interface Analise {
  arquivo: string | null;
  arquivo_ja_importado: boolean;
  total_linhas: number;
  validas: number;
  invalidas: number;
  pendentes: number;
  blocos: BlocoConciliacao[];
  erros: Array<{ linha: number; campo: string; mensagem: string }>;
  avisos: Array<{ linha: number; campo: string; mensagem: string }>;
}

export interface Decisao {
  dimensao: string;
  valor: string;
  acao: 'criar' | 'vincular';
  alvo?: string;
}

const TOM: Record<Situacao, 'bom' | 'neutro' | 'atencao' | 'critico'> = {
  IGUAL: 'bom',
  DIVERGENTE: 'atencao',
  NOVO: 'atencao',
  INVALIDO: 'critico',
};

const ROTULO: Record<Situacao, string> = {
  IGUAL: 'Igual',
  DIVERGENTE: 'Divergente',
  NOVO: 'Novo',
  INVALIDO: 'Inválido',
};

const chave = (dimensao: string, valor: string) => `${dimensao}\u0000${valor}`;
const exigeDecisao = (i: ItemConciliacao) => i.situacao === 'DIVERGENTE' || i.situacao === 'NOVO';

export function PainelConciliacao({
  analise,
  enviando,
  aoImportar,
}: {
  analise: Analise;
  enviando: boolean;
  aoImportar: (decisoes: Decisao[]) => void;
}) {
  const [decisoes, setDecisoes] = useState<Record<string, Decisao>>({});

  const decidir = (d: Decisao) => setDecisoes((atual) => ({ ...atual, [chave(d.dimensao, d.valor)]: d }));
  const esquecer = (dimensao: string, valor: string) =>
    setDecisoes((atual) => {
      const proximo = { ...atual };
      delete proximo[chave(dimensao, valor)];
      return proximo;
    });

  /** Quantas decisões ainda faltam, e se há inválida obrigatória travando. */
  const { pendentes, travado } = useMemo(() => {
    let faltam = 0;
    let bloqueio = false;
    for (const bloco of analise.blocos) {
      for (const item of bloco.itens) {
        if (item.situacao === 'INVALIDO' && bloco.obrigatoria) bloqueio = true;
        if (exigeDecisao(item) && !decisoes[chave(bloco.dimensao, item.valor)]) faltam += 1;
      }
    }
    return { pendentes: faltam, travado: bloqueio };
  }, [analise.blocos, decisoes]);

  const podeProsseguir = pendentes === 0 && !travado && !enviando;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--esp-7)' }}>
      <BlocoDobravel titulo="Resumo da importação" contador={`${analise.total_linhas} linha(s)`} tom="neutro">
        <dl className="par">
          <dt>Linhas no arquivo</dt>
          <dd>{analise.total_linhas}</dd>
          <dt>Válidas</dt>
          <dd>{analise.validas}</dd>
          <dt>Recusadas</dt>
          <dd>{analise.invalidas}</dd>
          <dt>Avisos</dt>
          <dd>{analise.avisos.length}</dd>
          <dt>Decisões pendentes</dt>
          <dd>{pendentes}</dd>
          <dt>Arquivo</dt>
          <dd>
            {analise.arquivo ?? '—'}
            {analise.arquivo_ja_importado && ' — já importado antes; reenviar não duplica.'}
          </dd>
        </dl>
      </BlocoDobravel>

      {analise.blocos.map((bloco) => (
        <BlocoDivergencias
          key={bloco.dimensao}
          bloco={bloco}
          decisoes={decisoes}
          aoDecidir={decidir}
          aoEsquecer={esquecer}
        />
      ))}

      <BlocoDobravel titulo="Linhas válidas" contador={`${analise.validas} entram`} tom="bom">
        <p style={{ color: 'var(--tinta-2)', margin: 0, fontSize: 13 }}>
          {analise.validas} linha(s) passaram na leitura e entram assim que as decisões acima estiverem tomadas.
        </p>
        {analise.avisos.length > 0 && (
          <ul style={{ color: 'var(--tinta-2)', fontSize: 12.5, marginBottom: 0 }}>
            {analise.avisos.slice(0, 30).map((a, i) => (
              <li key={i}>
                Linha {a.linha} — {a.campo}: {a.mensagem}
              </li>
            ))}
            {analise.avisos.length > 30 && <li>… e mais {analise.avisos.length - 30} aviso(s).</li>}
          </ul>
        )}
      </BlocoDobravel>

      <BlocoDobravel
        titulo="Linhas inválidas"
        contador={analise.invalidas > 0 ? `${analise.invalidas} recusada(s)` : 'nenhuma'}
        tom={analise.invalidas > 0 ? 'critico' : 'bom'}
      >
        {analise.erros.length === 0 ? (
          <p style={{ color: 'var(--tinta-2)', margin: 0, fontSize: 13 }}>Nenhuma linha foi recusada na leitura.</p>
        ) : (
          <ul style={{ color: 'var(--tinta-2)', fontSize: 12.5, marginBottom: 0 }}>
            {analise.erros.slice(0, 40).map((e, i) => (
              <li key={i}>
                Linha {e.linha} — {e.campo}: {e.mensagem}
              </li>
            ))}
            {analise.erros.length > 40 && <li>… e mais {analise.erros.length - 40} linha(s).</li>}
          </ul>
        )}
      </BlocoDobravel>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--esp-6)', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="botao primario"
          disabled={!podeProsseguir}
          onClick={() => aoImportar(Object.values(decisoes))}
        >
          {enviando ? 'Importando…' : 'Prosseguir com a importação'}
        </button>
        <span style={{ fontSize: 12.5, color: pendentes > 0 || travado ? 'var(--atencao)' : 'var(--positivo-texto)' }}>
          {travado
            ? 'Há linha obrigatória inválida: corrija o arquivo e envie de novo.'
            : pendentes > 0
              ? `${pendentes} divergência(s) ainda sem decisão.`
              : 'Tudo decidido — pode importar.'}
        </span>
      </div>
    </div>
  );
}

/**
 * Bloco da tela de importação: fechado, com o contador no cabeçalho.
 *
 * Não reaproveita o `Cartao` porque aqui o estado NÃO pode ser lembrado entre
 * sessões — cada carga é uma conferência nova, e abrir um bloco porque ele
 * ficou aberto na carga passada esconderia o que mudou nesta.
 */
function BlocoDobravel({
  titulo,
  contador,
  tom,
  children,
}: {
  titulo: string;
  contador: string;
  tom: 'neutro' | 'bom' | 'critico' | 'atencao';
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <section className="cartao" style={{ padding: '12px 14px' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--esp-5)', marginBottom: aberto ? 12 : 0 }}>
        <h2 style={{ marginRight: 'auto' }}>
          <button type="button" className="cartao-dobra" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
            <span className="cartao-seta" aria-hidden>
              {aberto ? '−' : '+'}
            </span>
            {titulo}
          </button>
        </h2>
        <Etiqueta texto={contador} tom={tom} />
      </header>
      {aberto && children}
    </section>
  );
}

function BlocoDivergencias({
  bloco,
  decisoes,
  aoDecidir,
  aoEsquecer,
}: {
  bloco: BlocoConciliacao;
  decisoes: Record<string, Decisao>;
  aoDecidir: (d: Decisao) => void;
  aoEsquecer: (dimensao: string, valor: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const precisam = bloco.itens.filter(exigeDecisao);
  const faltam = precisam.filter((i) => !decisoes[chave(bloco.dimensao, i.valor)]).length;
  const listaId = `candidatos-${bloco.dimensao}`;

  return (
    <section className="cartao" style={{ padding: '12px 14px' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--esp-5)', marginBottom: aberto ? 12 : 0 }}>
        <h2 style={{ marginRight: 'auto' }}>
          <button
            type="button"
            className="cartao-dobra"
            aria-expanded={aberto}
            onClick={() => setAberto((a) => !a)}
          >
            <span className="cartao-seta" aria-hidden>
              {aberto ? '−' : '+'}
            </span>
            {bloco.rotulo}
          </button>
        </h2>
        <Etiqueta
          texto={faltam > 0 ? `${faltam} pendente(s)` : `${precisam.length} resolvida(s)`}
          tom={faltam > 0 ? 'atencao' : 'bom'}
        />
        <span style={{ fontSize: 12, color: 'var(--tinta-fraca)' }}>{bloco.itens.length} valor(es)</span>
      </header>

      {aberto && (
        <>
          {precisam.length > 1 && (
            <div style={{ display: 'flex', gap: 'var(--esp-4)', marginBottom: 'var(--esp-5)', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="botao discreto pequeno"
                onClick={() =>
                  precisam
                    .filter((i) => i.sugestao)
                    .forEach((i) =>
                      aoDecidir({ dimensao: bloco.dimensao, valor: i.valor, acao: 'vincular', alvo: i.sugestao!.nome }),
                    )
                }
              >
                Aceitar todas as sugestões
              </button>
              {bloco.permiteCriar && (
                <button
                  type="button"
                  className="botao discreto pequeno"
                  onClick={() =>
                    precisam
                      .filter((i) => i.situacao === 'NOVO')
                      .forEach((i) => aoDecidir({ dimensao: bloco.dimensao, valor: i.valor, acao: 'criar' }))
                  }
                >
                  Cadastrar todos os novos
                </button>
              )}
            </div>
          )}

          {/* Busca restrita ao cadastro deste cliente. */}
          <datalist id={listaId}>
            {bloco.candidatos.map((c) => (
              <option key={c.nome} value={c.nome} />
            ))}
          </datalist>

          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>No arquivo</th>
                  <th>Situação</th>
                  <th className="num">Linhas</th>
                  <th>Decisão</th>
                </tr>
              </thead>
              <tbody>
                {bloco.itens.map((item) => (
                  <LinhaItem
                    key={item.valor}
                    bloco={bloco}
                    item={item}
                    listaId={listaId}
                    decisao={decisoes[chave(bloco.dimensao, item.valor)]}
                    aoDecidir={aoDecidir}
                    aoEsquecer={aoEsquecer}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function LinhaItem({
  bloco,
  item,
  listaId,
  decisao,
  aoDecidir,
  aoEsquecer,
}: {
  bloco: BlocoConciliacao;
  item: ItemConciliacao;
  listaId: string;
  decisao: Decisao | undefined;
  aoDecidir: (d: Decisao) => void;
  aoEsquecer: (dimensao: string, valor: string) => void;
}) {
  const [alvo, setAlvo] = useState(item.sugestao?.nome ?? '');

  if (!exigeDecisao(item)) {
    return (
      <tr>
        <td>{item.valor || <em style={{ color: 'var(--tinta-fraca)' }}>(em branco)</em>}</td>
        <td>
          <Etiqueta texto={ROTULO[item.situacao]} tom={TOM[item.situacao]} />
        </td>
        <td className="num">{item.ocorrencias}</td>
        <td style={{ color: 'var(--tinta-fraca)', fontSize: 12.5 }}>
          {item.situacao === 'IGUAL'
            ? 'Já existe no cadastro — nada a decidir.'
            : bloco.obrigatoria
              ? 'Obrigatório e em branco: corrija o arquivo.'
              : 'Em branco; a carga segue sem esta informação.'}
        </td>
      </tr>
    );
  }

  return (
    <tr style={decisao ? undefined : { background: 'color-mix(in srgb, var(--atencao) 8%, transparent)' }}>
      <td>
        <strong>{item.valor}</strong>
        {item.sugestao && (
          <div style={{ fontSize: 11.5, color: 'var(--tinta-fraca)' }}>
            parecido com <strong>{item.sugestao.nome}</strong>
            {item.sugestao.motivo === 'grafia' ? ' (acento ou espaçamento)' : ' (grafia parecida)'}
          </div>
        )}
      </td>
      <td>
        <Etiqueta texto={ROTULO[item.situacao]} tom={TOM[item.situacao]} />
      </td>
      <td className="num" title={`Linhas ${item.linhas.slice(0, 10).join(', ')}`}>
        {item.ocorrencias}
      </td>
      <td>
        <div style={{ display: 'flex', gap: 'var(--esp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            list={listaId}
            value={alvo}
            onChange={(e) => setAlvo(e.target.value)}
            placeholder="vincular a…"
            style={{ width: 210 }}
            aria-label={`Vincular "${item.valor}" a um cadastro existente`}
          />
          <button
            type="button"
            className="botao pequeno"
            disabled={!alvo}
            onClick={() => aoDecidir({ dimensao: bloco.dimensao, valor: item.valor, acao: 'vincular', alvo })}
          >
            Vincular
          </button>
          {bloco.permiteCriar && (
            <button
              type="button"
              className="botao pequeno"
              onClick={() => aoDecidir({ dimensao: bloco.dimensao, valor: item.valor, acao: 'criar' })}
            >
              Criar novo
            </button>
          )}
          {decisao && (
            <>
              <Etiqueta
                texto={decisao.acao === 'criar' ? 'vai criar' : `vincula a ${decisao.alvo}`}
                tom="bom"
              />
              <button
                type="button"
                className="botao discreto pequeno"
                onClick={() => aoEsquecer(bloco.dimensao, item.valor)}
              >
                desfazer
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
