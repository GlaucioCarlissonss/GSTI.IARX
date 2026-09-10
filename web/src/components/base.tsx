import { useEffect, useState, type ReactNode } from 'react';

export function Cartao({
  titulo,
  descricao,
  acoes,
  children,
}: {
  titulo?: string;
  descricao?: ReactNode;
  acoes?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="cartao">
      {(titulo || acoes) && (
        <header>
          {titulo && <h2>{titulo}</h2>}
          {descricao && <small>{descricao}</small>}
          {acoes}
        </header>
      )}
      {children}
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

export function Modal({
  titulo,
  aberto,
  aoFechar,
  children,
}: {
  titulo: string;
  aberto: boolean;
  aoFechar: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar();
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [aberto, aoFechar]);

  if (!aberto) return null;
  return (
    <div className="sobreposicao" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <header>
          <h2>{titulo}</h2>
          <button type="button" className="botao discreto" onClick={aoFechar} aria-label="Fechar">
            ✕
          </button>
        </header>
        {children}
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
