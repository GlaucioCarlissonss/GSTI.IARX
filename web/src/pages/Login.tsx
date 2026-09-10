import { useState, type FormEvent } from 'react';
import { useSessao } from '../lib/sessao';
import { Aviso, Campo } from '../components/base';

export function Login() {
  const { entrar } = useSessao();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const submeter = async (evento: FormEvent) => {
    evento.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      await entrar(email, senha);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível entrar.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="login">
      <form className="cartao" onSubmit={submeter}>
        <div>
          <h1 style={{ letterSpacing: '-0.03em' }}>GSTI.IARX</h1>
          <p style={{ color: 'var(--tinta-fraca)', margin: '4px 0 0' }}>
            Finanças, projetos e SLA de TI em um único painel.
          </p>
        </div>
        <Campo rotulo="E-mail">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Campo>
        <Campo rotulo="Senha">
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </Campo>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <button type="submit" className="botao primario" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
