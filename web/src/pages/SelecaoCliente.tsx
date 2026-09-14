/**
 * Tela de boas-vindas: qual cliente abrir.
 *
 * É a primeira coisa depois de entrar, e é deliberadamente de UM por vez. O
 * sistema não soma dois contratantes em lugar nenhum, então oferecer "todos"
 * aqui prometeria uma visão que nenhuma tela entrega.
 */
import { useSessao } from '../lib/sessao';
import { Aviso, Carregando } from '../components/base';

/** 29521159000214 → 29.521.159/0002-14. Documento curto ou vazio sai como veio. */
function formatarDocumento(bruto: string | null): string | null {
  const digitos = String(bruto ?? '').replace(/\D/g, '');
  if (digitos.length !== 14) return bruto?.trim() || null;
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
}

const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;

export function PaginaSelecaoCliente() {
  const { usuario, clientes, carregandoClientes, erroClientes, escolherCliente, recarregarClientes, sair } =
    useSessao();

  return (
    <div className="login">
      <div className="cartao" style={{ width: 'min(560px, 100%)' }}>
        <div>
          <h1 style={{ letterSpacing: '-0.03em', margin: 0 }}>Qual cliente você gostaria de acessar?</h1>
          <p style={{ color: 'var(--tinta-fraca)', margin: '6px 0 0' }}>
            Olá, {usuario?.nome}. Todo número que você vê a seguir é do cliente escolhido — dá para trocar a qualquer
            momento pelo menu.
          </p>
        </div>

        {carregandoClientes && <Carregando>Carregando seus clientes…</Carregando>}

        {/* Falha de rede e lista vazia dão a mesma tela em branco, e as saídas
            são opostas: uma pede repetir, a outra pede cadastro. */}
        {!carregandoClientes && erroClientes && (
          <>
            <Aviso tipo="erro">{erroClientes}</Aviso>
            <button type="button" className="botao primario" onClick={() => void recarregarClientes()}>
              Tentar de novo
            </button>
          </>
        )}

        {!carregandoClientes && !erroClientes && clientes.length === 0 && (
          <Aviso>
            Nenhum cliente está vinculado ao seu usuário. Peça a quem administra o sistema para liberar o acesso — o
            vínculo é feito em <strong>Usuários e acessos</strong>.
          </Aviso>
        )}

        {!carregandoClientes && !erroClientes && clientes.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {clientes.map((c) => {
              const documento = formatarDocumento(c.documento);
              return (
                <button
                  key={c.id}
                  type="button"
                  className="botao"
                  onClick={() => escolherCliente(c.id)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 2,
                    textAlign: 'left',
                    padding: '12px 14px',
                    height: 'auto',
                  }}
                >
                  <strong style={{ fontSize: 15 }}>{c.nome}</strong>
                  <small style={{ color: 'var(--tinta-fraca)' }}>
                    {plural(c.matrizes, 'matriz', 'matrizes')} · {plural(c.filiais, 'filial', 'filiais')}
                    {documento && ` · ${documento}`}
                  </small>
                </button>
              );
            })}
          </div>
        )}

        <button type="button" className="botao discreto" onClick={sair} style={{ alignSelf: 'flex-start' }}>
          Sair de {usuario?.email}
        </button>
      </div>
    </div>
  );
}
