import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useSessao } from '../lib/sessao';
import { Aviso, Campo } from '../components/base';

type Modo = 'entrar' | 'criar' | 'esqueci';

export function Login() {
  const { entrar, criarConta, instalacao } = useSessao();
  const primeiroAcesso = instalacao?.primeiro_acesso ?? false;
  const [modo, setModo] = useState<Modo>('entrar');
  const [form, setForm] = useState({ nome: '', usuario: '', email: '', senha: '' });
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Numa instalação nova não há conta alguma: a tela abre direto no cadastro.
  const modoEfetivo: Modo = primeiroAcesso ? 'criar' : modo;
  const podeCadastrar = instalacao?.registro_aberto ?? false;

  // Sem SMTP, prometer "enviaremos as instruções" seria mentira: a tela avisa.
  const [semEnvio, setSemEnvio] = useState(false);
  useEffect(() => {
    api
      .get<{ configurado: boolean }>('/api/auth/senha/situacao')
      .then((r) => setSemEnvio(!r.configurado))
      .catch(() => setSemEnvio(false));
  }, []);

  const submeter = async (evento: FormEvent) => {
    evento.preventDefault();
    setEnviando(true);
    setErro(null);
    setAviso(null);
    try {
      if (modoEfetivo === 'esqueci') {
        // A resposta é a mesma exista a conta ou não: quem pede não descobre
        // por aqui se o e-mail está cadastrado.
        const r = await api.post<{ aviso: string }>('/api/auth/senha/pedir', { email: form.email });
        setAviso(r.aviso);
      } else if (modoEfetivo === 'criar') {
        await criarConta(form);
      } else {
        await entrar(form.usuario, form.senha);
      }
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

        {/* O login é por USUÁRIO. O e-mail serve à recuperação de senha —
            quem sabe o e-mail de alguém não deve, por isso, saber como essa
            pessoa entra no sistema. */}
        {modoEfetivo === 'entrar' && (
          <Campo rotulo="Usuário">
            <input
              value={form.usuario}
              onChange={(e) => setForm({ ...form, usuario: e.target.value })}
              required
              autoFocus
              autoComplete="username"
              spellCheck={false}
            />
          </Campo>
        )}

        {modoEfetivo !== 'entrar' && (
          <Campo
            rotulo="E-mail"
            dica={modoEfetivo === 'criar' ? 'Usado só para recuperar a senha' : undefined}
          >
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              autoFocus={modoEfetivo === 'esqueci'}
              autoComplete="email"
            />
          </Campo>
        )}

        {modoEfetivo === 'criar' && (
          <Campo rotulo="Usuário" dica="É com ele que você vai entrar. Em branco, sai do seu e-mail.">
            <input
              value={form.usuario}
              onChange={(e) => setForm({ ...form, usuario: e.target.value })}
              autoComplete="username"
              spellCheck={false}
            />
          </Campo>
        )}

        {modoEfetivo !== 'esqueci' && (
          <Campo rotulo="Senha" dica={modoEfetivo === 'criar' ? 'Mínimo de 8 caracteres, com letras e números' : undefined}>
            <input
              type="password"
              value={form.senha}
              onChange={(e) => setForm({ ...form, senha: e.target.value })}
              required
              minLength={modoEfetivo === 'criar' ? 8 : undefined}
              autoComplete={modoEfetivo === 'criar' ? 'new-password' : 'current-password'}
            />
          </Campo>
        )}

        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
        {modoEfetivo === 'esqueci' && semEnvio && (
          <Aviso tipo="erro">
            O envio de e-mail não está configurado nesta instalação: o link de redefinição fica registrado no
            sistema, mas não é enviado. Peça a um gestor para redefinir a sua senha na tela de Usuários.
          </Aviso>
        )}

        <button type="submit" className="botao primario" disabled={enviando}>
          {enviando
            ? 'Aguarde…'
            : modoEfetivo === 'criar'
              ? 'Criar conta e entrar'
              : modoEfetivo === 'esqueci'
                ? 'Enviar instruções'
                : 'Entrar'}
        </button>

        {!primeiroAcesso && (
          <button
            type="button"
            className="botao discreto"
            onClick={() => {
              setModo(modoEfetivo === 'esqueci' ? 'entrar' : 'esqueci');
              setErro(null);
              setAviso(null);
            }}
          >
            {modoEfetivo === 'esqueci' ? 'Voltar para o acesso' : 'Esqueci minha senha'}
          </button>
        )}

        {!primeiroAcesso && podeCadastrar && modoEfetivo !== 'esqueci' && (
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
 * Tela do link de redefinição. Vive fora da sessão: quem chega aqui está
 * justamente sem conseguir entrar.
 */
export function RedefinirSenha() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [senha, setSenha] = useState('');
  const [repetida, setRepetida] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const submeter = async (evento: FormEvent) => {
    evento.preventDefault();
    setErro(null);
    if (senha !== repetida) {
      setErro('As duas senhas não são iguais.');
      return;
    }
    setEnviando(true);
    try {
      await api.post('/api/auth/senha/redefinir', { token, senha });
      setPronto(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível redefinir a senha.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="login">
      <form className="cartao" onSubmit={submeter}>
        <div>
          <h1 style={{ letterSpacing: '-0.03em' }}>Nova senha</h1>
          <p style={{ color: 'var(--tinta-fraca)', margin: '4px 0 0' }}>
            Escolha uma senha nova. Ao concluir, as sessões abertas nesta conta são encerradas.
          </p>
        </div>

        {!token && <Aviso tipo="erro">O link veio sem o código de redefinição. Peça um novo na tela de acesso.</Aviso>}

        {pronto ? (
          <>
            <Aviso tipo="ok">Senha redefinida. Entre com o seu usuário e a senha nova.</Aviso>
            <a className="botao primario" href="/" style={{ textAlign: 'center' }}>
              Ir para o acesso
            </a>
          </>
        ) : (
          <>
            <Campo rotulo="Nova senha" dica="Mínimo de 8 caracteres, com letras e números">
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
                minLength={8}
                autoFocus
                autoComplete="new-password"
              />
            </Campo>
            <Campo rotulo="Repita a senha">
              <input
                type="password"
                value={repetida}
                onChange={(e) => setRepetida(e.target.value)}
                required
                autoComplete="new-password"
              />
            </Campo>

            {erro && <Aviso tipo="erro">{erro}</Aviso>}

            <button type="submit" className="botao primario" disabled={enviando || !token}>
              {enviando ? 'Aguarde…' : 'Redefinir senha'}
            </button>
            <a className="botao discreto" href="/" style={{ textAlign: 'center' }}>
              Voltar para o acesso
            </a>
          </>
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
