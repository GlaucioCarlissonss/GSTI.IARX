/**
 * Cadastro de clientes, matrizes e filiais.
 *
 * A regra de onde uma unidade entra é do CNPJ — mesma raiz, mesma matriz — e
 * ela vive no servidor. Esta tela mostra o que a regra vai fazer ANTES de
 * enviar, porque descobrir depois, com a unidade já no lugar errado, custa uma
 * correção manual no organograma.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { Aviso, Campo, Carregando, Cartao, Etiqueta } from '../components/base';

interface ClienteLista {
  id: number;
  nome: string;
  documento: string | null;
  ativo: number;
  matrizes: number;
  filiais: number;
}

interface Unidade {
  id: number;
  nome: string;
  codigo: string | null;
  cnpj: string | null;
  endereco: string | null;
  cep: string | null;
}

interface Matriz extends Unidade {
  status: string;
  filiais: Array<Unidade & { cidade: string | null; uf: string | null; ativo: number }>;
}

const digitos = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '');
const raiz = (v: string | null | undefined) => digitos(v).slice(0, 8);

function cnpjExib(bruto: string | null): string {
  const d = digitos(bruto);
  if (d.length !== 14) return bruto?.trim() || '—';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

const UNIDADE_VAZIA = {
  tipo: 'MATRIZ' as 'MATRIZ' | 'FILIAL',
  matriz_pai_id: '',
  nome: '',
  codigo: '',
  cnpj: '',
  endereco: '',
  cep: '',
  cidade: '',
  uf: '',
};

export function PaginaClientes() {
  const { pode, cliente: clienteAberto, recarregarClientes } = useSessao();
  const podeCriar = pode('configuracoes', 'create');
  const podeEditar = pode('configuracoes', 'edit');

  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<number | null>(clienteAberto?.id ?? null);
  const [novoCliente, setNovoCliente] = useState({ nome: '', documento: '' });
  const [nova, setNova] = useState(UNIDADE_VAZIA);

  const clientes = useDados<ClienteLista[]>(() => api.get('/api/clientes'), []);
  const alvo = selecionado ?? clientes.dados?.[0]?.id ?? null;
  const estrutura = useDados<{ cliente: ClienteLista; matrizes: Matriz[] }>(
    () => (alvo ? api.get(`/api/clientes/${alvo}`) : Promise.resolve({ cliente: null as never, matrizes: [] })),
    [alvo],
  );

  const matrizes = estrutura.dados?.matrizes ?? [];

  /**
   * O que a regra do CNPJ fará com o que está digitado. É a mesma conta do
   * servidor, feita aqui só para avisar antes — quem decide continua sendo ele.
   */
  const previsao = useMemo(() => {
    const r = raiz(nova.cnpj);
    if (!r || r.length < 8) return null;
    const irma =
      matrizes.find((m) => raiz(m.cnpj) === r) ??
      matrizes.find((m) => m.filiais.some((f) => raiz(f.cnpj) === r)) ??
      null;
    return irma;
  }, [nova.cnpj, matrizes]);

  const criarCliente = async (evento: FormEvent) => {
    evento.preventDefault();
    setErro(null);
    setAviso(null);
    try {
      const criado = await api.post<ClienteLista>('/api/clientes', {
        nome: novoCliente.nome,
        documento: novoCliente.documento || null,
      });
      setNovoCliente({ nome: '', documento: '' });
      setSelecionado(criado.id);
      clientes.recarregar();
      await recarregarClientes();
      setAviso(`Cliente "${criado.nome}" cadastrado. Agora cadastre a matriz dele.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao cadastrar o cliente.');
    }
  };

  const criarUnidade = async (evento: FormEvent) => {
    evento.preventDefault();
    if (!alvo) return;
    setErro(null);
    setAviso(null);
    try {
      await api.post(`/api/clientes/${alvo}/unidades`, {
        tipo: nova.tipo,
        matriz_pai_id: nova.matriz_pai_id || null,
        nome: nova.nome,
        codigo: nova.codigo || null,
        cnpj: nova.cnpj || null,
        endereco: nova.endereco || null,
        cep: nova.cep || null,
        cidade: nova.cidade || null,
        uf: nova.uf || null,
      });
      setNova(UNIDADE_VAZIA);
      estrutura.recarregar();
      clientes.recarregar();
      await recarregarClientes();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao cadastrar a unidade.');
    }
  };

  const alternarAtivo = async (c: ClienteLista) => {
    setErro(null);
    try {
      await api.patch(`/api/clientes/${c.id}`, { ativo: c.ativo !== 1 });
      clientes.recarregar();
      await recarregarClientes();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao atualizar o cliente.');
    }
  };

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}

      <Cartao titulo="Clientes" descricao="O contratante. Toda matriz e toda filial pertencem a um.">
        {!clientes.dados ? (
          <Carregando />
        ) : clientes.dados.length === 0 ? (
          <p className="vazio">Nenhum cliente cadastrado.</p>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Documento</th>
                  <th className="num">Matrizes</th>
                  <th className="num">Filiais</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {clientes.dados.map((c) => (
                  <tr key={c.id} className={c.id === alvo ? 'ativo' : undefined}>
                    <td>
                      <button type="button" className="botao discreto pequeno" onClick={() => setSelecionado(c.id)}>
                        {c.nome}
                      </button>
                    </td>
                    <td>{cnpjExib(c.documento)}</td>
                    <td className="num">{c.matrizes}</td>
                    <td className="num">{c.filiais}</td>
                    <td>
                      <Etiqueta texto={c.ativo === 1 ? 'Ativo' : 'Inativo'} tom={c.ativo === 1 ? 'bom' : 'neutro'} />
                    </td>
                    <td>
                      {podeEditar && (
                        <button type="button" className="botao discreto pequeno" onClick={() => alternarAtivo(c)}>
                          {c.ativo === 1 ? 'Desativar' : 'Reativar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {podeCriar && (
          <form onSubmit={criarCliente} className="barra-filtros" style={{ marginTop: 12 }}>
            <Campo rotulo="Novo cliente">
              <input
                value={novoCliente.nome}
                onChange={(e) => setNovoCliente({ ...novoCliente, nome: e.target.value })}
                required
                style={{ minWidth: 220 }}
              />
            </Campo>
            <Campo rotulo="CNPJ (opcional)">
              <input
                value={novoCliente.documento}
                onChange={(e) => setNovoCliente({ ...novoCliente, documento: e.target.value })}
                style={{ width: 180 }}
              />
            </Campo>
            <button type="submit" className="botao primario">
              Cadastrar cliente
            </button>
          </form>
        )}
      </Cartao>

      <Cartao
        titulo={estrutura.dados?.cliente ? `Estrutura de ${estrutura.dados.cliente.nome}` : 'Estrutura'}
        descricao="Matriz é a pessoa jurídica; filial é a unidade dela. O CNPJ é quem diz qual é qual."
      >
        {estrutura.erro && <Aviso tipo="erro">{estrutura.erro}</Aviso>}
        {estrutura.carregando ? (
          <Carregando />
        ) : matrizes.length === 0 ? (
          <p className="vazio">Este cliente ainda não tem matriz cadastrada.</p>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Unidade</th>
                  <th>Tipo</th>
                  <th>Código</th>
                  <th>CNPJ</th>
                  <th>Endereço</th>
                  <th>CEP</th>
                </tr>
              </thead>
              <tbody>
                {matrizes.flatMap((m) => [
                  <tr key={`m${m.id}`}>
                    <td>
                      <strong>{m.nome}</strong>
                    </td>
                    <td>
                      <Etiqueta texto="Matriz" tom="neutro" />
                    </td>
                    <td>{m.codigo ?? '—'}</td>
                    <td>{cnpjExib(m.cnpj)}</td>
                    <td>{m.endereco ?? '—'}</td>
                    <td>{m.cep ?? '—'}</td>
                  </tr>,
                  ...m.filiais.map((f) => (
                    <tr key={`f${f.id}`}>
                      <td style={{ paddingLeft: 26, color: 'var(--tinta-2)' }}>{f.nome}</td>
                      <td>Filial</td>
                      <td>{f.codigo ?? '—'}</td>
                      <td>{cnpjExib(f.cnpj)}</td>
                      <td>{f.endereco ?? '—'}</td>
                      <td>{f.cep ?? '—'}</td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        )}

        {podeCriar && alvo && (
          <form onSubmit={criarUnidade} style={{ marginTop: 14 }}>
            <div className="barra-filtros">
              <Campo rotulo="Tipo">
                <select
                  value={nova.tipo}
                  onChange={(e) => setNova({ ...nova, tipo: e.target.value as 'MATRIZ' | 'FILIAL' })}
                >
                  <option value="MATRIZ">Matriz</option>
                  <option value="FILIAL">Filial</option>
                </select>
              </Campo>
              {nova.tipo === 'FILIAL' && (
                <Campo rotulo="Matriz" dica="Em branco, o CNPJ decide.">
                  <select
                    value={nova.matriz_pai_id}
                    onChange={(e) => setNova({ ...nova, matriz_pai_id: e.target.value })}
                  >
                    <option value="">Pelo CNPJ</option>
                    {matrizes.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome}
                      </option>
                    ))}
                  </select>
                </Campo>
              )}
              <Campo rotulo="Nome">
                <input
                  value={nova.nome}
                  onChange={(e) => setNova({ ...nova, nome: e.target.value })}
                  required
                  style={{ minWidth: 200 }}
                />
              </Campo>
              <Campo rotulo="Código">
                <input
                  value={nova.codigo}
                  onChange={(e) => setNova({ ...nova, codigo: e.target.value })}
                  style={{ width: 110 }}
                />
              </Campo>
              <Campo rotulo="CNPJ">
                <input
                  value={nova.cnpj}
                  onChange={(e) => setNova({ ...nova, cnpj: e.target.value })}
                  style={{ width: 175 }}
                />
              </Campo>
            </div>
            <div className="barra-filtros">
              <Campo rotulo="Endereço">
                <input
                  value={nova.endereco}
                  onChange={(e) => setNova({ ...nova, endereco: e.target.value })}
                  style={{ minWidth: 320 }}
                />
              </Campo>
              <Campo rotulo="CEP">
                <input
                  value={nova.cep}
                  onChange={(e) => setNova({ ...nova, cep: e.target.value })}
                  style={{ width: 110 }}
                />
              </Campo>
              {nova.tipo === 'FILIAL' && (
                <>
                  <Campo rotulo="Cidade">
                    <input
                      value={nova.cidade}
                      onChange={(e) => setNova({ ...nova, cidade: e.target.value })}
                      style={{ width: 160 }}
                    />
                  </Campo>
                  <Campo rotulo="UF">
                    <input
                      value={nova.uf}
                      onChange={(e) => setNova({ ...nova, uf: e.target.value })}
                      maxLength={2}
                      style={{ width: 60 }}
                    />
                  </Campo>
                </>
              )}
              <button type="submit" className="botao primario">
                Cadastrar unidade
              </button>
            </div>

            {/* O aviso vem ANTES do envio: descobrir depois, com a unidade já
                pendurada no lugar errado, custa correção manual. */}
            {previsao && (
              <Aviso tipo={nova.tipo === 'MATRIZ' ? 'erro' : 'info'}>
                Este CNPJ tem a mesma raiz de <strong>{previsao.nome}</strong>.{' '}
                {nova.tipo === 'MATRIZ'
                  ? 'Unidades da mesma raiz são a mesma pessoa jurídica — o cadastro será recusado como matriz.'
                  : `A filial entrará em ${previsao.nome}.`}
              </Aviso>
            )}
          </form>
        )}
      </Cartao>
    </>
  );
}
