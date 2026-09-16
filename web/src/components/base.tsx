import { useEffect, useRef, useState, type ReactNode } from 'react';
import { chaveDoBloco, useDobra } from '../lib/expansao';

/**
 * Bloco de conteúdo. Abre e fecha pelo título, e começa FECHADO.
 *
 * A tela passou a ter muitos blocos, e abrir tudo de uma vez enterrava o que
 * importa numa rolagem longa. Fechado por padrão, cada um decide o que quer
 * ver — e a escolha fica lembrada por bloco, então quem abre o mesmo cartão
 * todo dia o encontra aberto no dia seguinte.
 *
 * O conteúdo só é montado quando o bloco está aberto: com dezenas de blocos por
 * sessão, montar gráfico e tabela que ninguém pediu custaria caro à toa.
 *
 * Cartão sem título não dobra — não haveria onde clicar.
 */
export function Cartao({
  titulo,
  descricao,
  acoes,
  classe,
  children,
}: {
  titulo?: string;
  descricao?: ReactNode;
  acoes?: ReactNode;
  /** Classe extra no cartão — hoje só a tela cheia do relatório usa. */
  classe?: string;
  children: ReactNode;
}) {
  const chave = chaveDoBloco(titulo);
  const { aberto, alternar } = useDobra(chave);
  const idConteudo = chave ? `${chave}-conteudo` : undefined;

  return (
    <section className={[classe ? `cartao ${classe}` : 'cartao', aberto ? '' : 'dobrado'].join(' ').trim()}>
      {(titulo || acoes) && (
        <header>
          {titulo &&
            (chave ? (
              // O botão fica DENTRO do h2, e não em volta do cabeçalho: `acoes`
              // traz botões, e botão dentro de botão não é HTML válido.
              <h2>
                <button
                  type="button"
                  className="cartao-dobra"
                  aria-expanded={aberto}
                  aria-controls={idConteudo}
                  onClick={alternar}
                >
                  <span className="cartao-seta" aria-hidden>
                    {aberto ? '−' : '+'}
                  </span>
                  {titulo}
                </button>
              </h2>
            ) : (
              <h2>{titulo}</h2>
            ))}
          {descricao && <small>{descricao}</small>}
          {acoes}
        </header>
      )}
      {aberto && (
        <div id={idConteudo} className="cartao-corpo">
          {children}
        </div>
      )}
    </section>
  );
}

export function Campo({
  rotulo,
  children,
  dica,
}: {
  rotulo: string;
  children: ReactNode;
  dica?: string;
}) {
  return (
    <div className="campo">
      <label>{rotulo}</label>
      {children}
      {dica && <small style={{ color: 'var(--tinta-fraca)', fontSize: 11.5 }}>{dica}</small>}
    </div>
  );
}

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'erro' | 'ok'; children: ReactNode }) {
  if (!children) return null;
  return <div className={`aviso ${tipo === 'info' ? '' : tipo}`}>{children}</div>;
}

export function Etiqueta({
  texto,
  tom = 'neutro',
  cor,
}: {
  texto: string;
  tom?: 'neutro' | 'bom' | 'critico' | 'atencao';
  cor?: string;
}) {
  return (
    <span className={`etiqueta ${tom === 'neutro' ? '' : tom}`}>
      {cor && <i className="ponto" style={{ background: cor }} />}
      {texto}
    </span>
  );
}

/** Tamanho mínimo útil de uma tela flutuante: abaixo disto ela não serve. */
const MODAL_MINIMO = { largura: 320, altura: 240 };

interface TamanhoDeModal {
  largura?: number;
  altura?: number;
  cheia?: boolean;
}

/** Chave de persistência do tamanho. Sem `tipo`, cai no título. */
function chaveDoModal(tipo: string | undefined, titulo: string) {
  return (
    'iarx-modal-' +
    String(tipo || titulo)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40)
  );
}

function lerTamanho(chave: string): TamanhoDeModal {
  try {
    return JSON.parse(localStorage.getItem(chave) || '{}') as TamanhoDeModal;
  } catch {
    return {};
  }
}

function gravarTamanho(chave: string, dados: TamanhoDeModal) {
  try {
    localStorage.setItem(chave, JSON.stringify(dados));
  } catch {
    // Navegação privada: o tamanho vale só nesta sessão.
  }
}

/**
 * Tela flutuante. Cabeçalho e rodapé presos, área de dados rolando, e o
 * tamanho na mão de quem usa: arrastar as bordas, ou tela cheia de uma vez.
 *
 * `tipo` separa o tamanho guardado por espécie de tela — o detalhamento de um
 * indicador quer largura, um formulário de cadastro não.
 */
export function Modal({
  titulo,
  aberto,
  aoFechar,
  acoes,
  tipo,
  children,
}: {
  titulo: string;
  aberto: boolean;
  aoFechar: () => void;
  /** Ações primárias, presas no rodapé e sempre à vista. */
  acoes?: ReactNode;
  tipo?: string;
  children: ReactNode;
}) {
  const chave = chaveDoModal(tipo, titulo);
  const caixa = useRef<HTMLDivElement>(null);
  const [cheia, setCheia] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar();
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [aberto, aoFechar]);

  // O tamanho guardado é aplicado em estilo, e não em estado de React: quem
  // arrasta espera resposta a cada pixel, e repintar a árvore a cada pixel
  // perderia o foco do teclado no meio do arrasto.
  useEffect(() => {
    if (!aberto || !caixa.current) return;
    const guardado = lerTamanho(chave);
    if (guardado.largura) caixa.current.style.width = `${guardado.largura}px`;
    if (guardado.altura) caixa.current.style.height = `${guardado.altura}px`;
    setCheia(!!guardado.cheia);
  }, [aberto, chave]);

  const alternarCheia = () => {
    const nova = !cheia;
    setCheia(nova);
    gravarTamanho(chave, { ...lerTamanho(chave), cheia: nova });
  };

  /** Arrasto de uma borda. `lado` diz quais eixos o movimento afeta. */
  const puxar = (lado: 'dir' | 'baixo' | 'canto') => (ev: React.PointerEvent<HTMLDivElement>) => {
    const el = caixa.current;
    if (!el) return;
    ev.preventDefault();
    const alca = ev.currentTarget;
    const inicio = { x: ev.clientX, y: ev.clientY, l: el.offsetWidth, a: el.offsetHeight };
    alca.setPointerCapture(ev.pointerId);
    alca.classList.add('arrastando');

    const limitar = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
    const mover = (e: PointerEvent) => {
      // A tela é centralizada: cresce para os dois lados, e o ponteiro só anda
      // de um. Daí o dobro na largura.
      if (lado !== 'baixo') {
        el.style.width = `${limitar(inicio.l + (e.clientX - inicio.x) * 2, MODAL_MINIMO.largura, window.innerWidth - 28)}px`;
      }
      if (lado !== 'dir') {
        el.style.height = `${limitar(inicio.a + (e.clientY - inicio.y), MODAL_MINIMO.altura, window.innerHeight - 72)}px`;
      }
    };
    const soltar = () => {
      alca.classList.remove('arrastando');
      alca.removeEventListener('pointermove', mover);
      alca.removeEventListener('pointerup', soltar);
      alca.removeEventListener('pointercancel', soltar);
      gravarTamanho(chave, { largura: el.offsetWidth, altura: el.offsetHeight, cheia: false });
    };
    alca.addEventListener('pointermove', mover);
    alca.addEventListener('pointerup', soltar);
    alca.addEventListener('pointercancel', soltar);
  };

  if (!aberto) return null;
  return (
    <div className="sobreposicao" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div
        ref={caixa}
        className={cheia ? 'modal cheia' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
      >
        <header>
          <h2>{titulo}</h2>
          <button
            type="button"
            className="botao discreto"
            onClick={alternarCheia}
            aria-pressed={cheia}
            aria-label={cheia ? 'Restaurar o tamanho anterior' : 'Expandir para tela cheia'}
            title={cheia ? 'Restaurar' : 'Tela cheia'}
          >
            {cheia ? '⤡' : '⛶'}
          </button>
          <button type="button" className="botao discreto" onClick={aoFechar} aria-label="Fechar">
            ✕
          </button>
        </header>
        <div className="modal-corpo">{children}</div>
        {acoes && <div className="modal-acoes">{acoes}</div>}
        {!cheia && (
          <>
            <div className="puxador dir" onPointerDown={puxar('dir')} role="separator"
              aria-orientation="vertical" aria-label="Arraste para mudar a largura" />
            <div className="puxador baixo" onPointerDown={puxar('baixo')} role="separator"
              aria-orientation="horizontal" aria-label="Arraste para mudar a altura" />
            <div className="puxador canto" onPointerDown={puxar('canto')} role="separator"
              aria-label="Arraste para mudar largura e altura" />
          </>
        )}
      </div>
    </div>
  );
}

/** Confirmação para operações destrutivas ou em lote, com justificativa opcional. */
export function ConfirmarAcao({
  titulo,
  mensagem,
  exigirJustificativa,
  aberto,
  aoFechar,
  aoConfirmar,
  rotuloConfirmar = 'Confirmar',
}: {
  titulo: string;
  mensagem: ReactNode;
  exigirJustificativa?: boolean;
  aberto: boolean;
  aoFechar: () => void;
  aoConfirmar: (justificativa: string) => Promise<void> | void;
  rotuloConfirmar?: string;
}) {
  const [justificativa, setJustificativa] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (aberto) {
      setJustificativa('');
      setErro(null);
    }
  }, [aberto]);

  const confirmar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      await aoConfirmar(justificativa.trim());
      aoFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao executar a operação.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal titulo={titulo} aberto={aberto} aoFechar={aoFechar}>
      <p style={{ margin: 0, color: 'var(--tinta-2)' }}>{mensagem}</p>
      <Campo rotulo={exigirJustificativa ? 'Justificativa (obrigatória)' : 'Justificativa (opcional)'}>
        <textarea
          value={justificativa}
          onChange={(e) => setJustificativa(e.target.value)}
          placeholder="Registrada na trilha de auditoria"
        />
      </Campo>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="acoes">
        <button type="button" className="botao" onClick={aoFechar}>
          Cancelar
        </button>
        <button
          type="button"
          className="botao primario"
          onClick={confirmar}
          disabled={enviando || (exigirJustificativa && justificativa.trim().length === 0)}
        >
          {enviando ? 'Processando…' : rotuloConfirmar}
        </button>
      </div>
    </Modal>
  );
}

export function Carregando({ children = 'Carregando…' }: { children?: ReactNode }) {
  return <p className="vazio">{children}</p>;
}
