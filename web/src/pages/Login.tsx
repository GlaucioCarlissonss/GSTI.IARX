import { useState, type FormEvent } from 'react';
import { useSessao } from '../lib/sessao';
import { Aviso, Campo } from '../components/base';

type Modo = 'entrar' | 'criar';

export function Login() {
  const { entrar, criarConta, instalacao } = useSessao();
  const primeiroAcesso = instalacao?.primeiro_acesso ?? false;
  const [modo, setModo] = useState<Modo>('entrar');
  const [form, setForm] = useState({ nome: '', email: '', senha: '' });
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Numa instalação nova não há conta alguma: a tela abre direto no cadastro.
  const modoEfetivo: Modo = primeiroAcesso ? 'criar' : modo;
  const podeCadastrar = instalacao?.registro_aberto ?? false;

  const submeter = async (evento: FormEvent) => {
    evento.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      if (modoEfetivo === 'criar') await criarConta(form);
      else await entrar(form.email, form.senha);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível continuar.');
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

        {primeiroAcesso && (
          <Aviso>
            Primeira execução desta instalação. Crie a conta do gestor — ela será a primeira do ambiente.
          </Aviso>
        )}

        {modoEfetivo === 'criar' && (
          <Campo rotulo="Seu nome">
            <input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              required
              autoFocus
              autoComplete="name"
            />
          </Campo>
        )}

        <Campo rotulo="E-mail">
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
            autoFocus={modoEfetivo === 'entrar'}
            autoComplete="email"
          />
        </Campo>

        <Campo rotulo="Senha" dica={modoEfetivo === 'criar' ? 'Mínimo de 8 caracteres' : undefined}>
          <input
            type="password"
            value={form.senha}
            onChange={(e) => setForm({ ...form, senha: e.target.value })}
            required
            minLength={modoEfetivo === 'criar' ? 8 : undefined}
            autoComplete={modoEfetivo === 'criar' ? 'new-password' : 'current-password'}
          />
        </Campo>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <button type="submit" className="botao primario" disabled={enviando}>
          {enviando ? 'Aguarde…' : modoEfetivo === 'criar' ? 'Criar conta e entrar' : 'Entrar'}
        </button>

        {!primeiroAcesso && podeCadastrar && (
          <button
            type="button"
            className="botao discreto"
            onClick={() => {
              setModo(modo === 'entrar' ? 'criar' : 'entrar');
              setErro(null);
            }}
          >
            {modo === 'entrar' ? 'Não tem conta? Criar uma' : 'Já tem conta? Entrar'}
          </button>
        )}
      </form>
    </div>
  );
}

/**
 * Passo seguinte ao cadastro: sem empresa em contexto não há operação possível,
 * então a conta recém-criada cadastra aqui a primeira empresa.
 */
export function PrimeiraEmpresa() {
  const { criarEmpresa, usuario, sair } = useSessao();
  const [form, setForm] = useState({ nome: '', cnpj: '' });
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const submeter = async (evento: FormEvent) => {
    evento.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      await criarEmpresa({ nome: form.nome, cnpj: form.cnpj || undefined });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar a empresa.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="login">
      <form className="cartao" onSubmit={submeter}>
        <div>
          <h1 style={{ letterSpacing: '-0.03em' }}>Cadastre a primeira empresa</h1>
          <p style={{ color: 'var(--tinta-fraca)', margin: '4px 0 0' }}>
            Todo lançamento, projeto e ticket pertence a uma empresa. A sua nasce já com os nove tipos de despesa
            padrão e com você como gestor.
          </p>
        </div>

        <Campo rotulo="Nome da empresa">
          <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required autoFocus />
        </Campo>
        <Campo rotulo="CNPJ (opcional)">
          <input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} />
        </Campo>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <button type="submit" className="botao primario" disabled={enviando}>
          {enviando ? 'Criando…' : 'Criar empresa e começar'}
        </button>
        <button type="button" className="botao discreto" onClick={sair}>
          Sair de {usuario?.email}
        </button>
      </form>
    </div>
  );
}
