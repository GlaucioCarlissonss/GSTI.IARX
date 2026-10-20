/**
 * Usuários e acessos.
 *
 * O acesso é do CLIENTE, não da matriz: concedido uma vez, vale em toda
 * unidade e filial dele — já foi por matriz individual, e o seletor que
 * sobraria não teria mais o que fazer (por isso esta tela não tem barra de
 * filtro nenhuma, ao lado de "Clientes e unidades" e "Auditoria").
 *
 * A tela esconde o que o perfil não permite — mas é conveniência, não defesa:
 * toda regra daqui é reaplicada no servidor, e uma chamada direta recusada
 * volta 403 e entra na auditoria.
 */
import { useState } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { Aviso, Campo, Carregando, Cartao, ConfirmarAcao, Etiqueta, Modal } from '../components/base';
import { dataHora } from '../lib/formato';

type Acao = 'view' | 'create' | 'edit' | 'delete' | 'export' | 'import';

const ROTULO_ACAO: Record<Acao, string> = {
  view: 'Ver',
  create: 'Criar',
  edit: 'Editar',
  delete: 'Excluir',
  export: 'Exportar',
  import: 'Importar',
};

interface Usuario {
  id: number;
  nome: string;
  username: string | null;
  email: string;
  ativo: boolean;
  ultimo_login_em: string | null;
  papel: string;
  perfil_id: number | null;
  perfil_nome: string | null;
}

interface Perfil {
  id: number;
  nome: string;
  tipo: 'VIEW_ONLY' | 'EDIT';
  padrao: boolean;
  permissoes: Record<string, Partial<Record<Acao, boolean>>>;
  campos_bloqueados: Record<string, string[]>;
}

interface Minhas {
  modulos: Array<{ id: string; rotulo: string }>;
  acoes: Acao[];
}

export function PaginaAcessos() {
  const { cliente } = useSessao();
  const usuarios = useDados<Usuario[]>(() => api.get('/api/acesso/usuarios'), [cliente?.id]);
  const perfis = useDados<Perfil[]>(() => api.get('/api/acesso/perfis'), [cliente?.id]);
  const meta = useDados<Minhas>(() => api.get('/api/acesso/minhas-permissoes'), [cliente?.id]);
  const email = useDados<{ configurado: boolean; aviso: string | null }>(
    () => api.get('/api/acesso/email/situacao'),
    [cliente?.id],
  );

  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [novoUsuario, setNovoUsuario] = useState(false);
  const [senhaDe, setSenhaDe] = useState<Usuario | null>(null);
  const [perfilAberto, setPerfilAberto] = useState<Perfil | null>(null);
  const [removendo, setRemovendo] = useState<Usuario | null>(null);

  const recarregar = () => {
    usuarios.recarregar();
    perfis.recarregar();
  };

  const acao = async (fn: () => Promise<unknown>, sucesso?: string) => {
    setErro(null);
    setAviso(null);
    try {
      await fn();
      if (sucesso) setAviso(sucesso);
      recarregar();
      return true;
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir a ação.');
      return false;
    }
  };

  if (usuarios.erro) return <Aviso tipo="erro">{usuarios.erro}</Aviso>;

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {email.dados && !email.dados.configurado && <Aviso tipo="erro">{email.dados.aviso}</Aviso>}

      <Cartao
        titulo="Usuários"
        descricao={`Concedido uma vez, o acesso vale em toda matriz e filial de ${cliente?.nome ?? 'este cliente'}`}
        acoes={
          <button type="button" className="botao primario" onClick={() => setNovoUsuario(true)}>
            Novo usuário
          </button>
        }
      >
        {!usuarios.dados ? (
          <Carregando />
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Usuário</th>
                  <th>E-mail</th>
                  <th>Papel</th>
                  <th>Perfil</th>
                  <th>Último acesso</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {usuarios.dados.map((u) => (
                  <tr key={u.id}>
                    <td className="texto">{u.nome}</td>
                    <td>{u.username ?? '—'}</td>
                    <td className="texto">{u.email}</td>
                    <td>
                      <select
                        value={u.papel}
                        aria-label={`Papel de ${u.nome}`}
                        onChange={(e) =>
                          void acao(
                            () => api.patch(`/api/acesso/usuarios/${u.id}`, { papel: e.target.value }),
                            `Papel de ${u.nome} atualizado.`,
                          )
                        }
                      >
                        <option value="gestor">Gestor</option>
                        <option value="leitor">Leitor</option>
                      </select>
                    </td>
                    <td>
                      <select
                        value={u.perfil_id ?? ''}
                        aria-label={`Perfil de ${u.nome}`}
                        onChange={(e) =>
                          void acao(
                            () =>
                              api.patch(`/api/acesso/usuarios/${u.id}`, {
                                perfil_id: e.target.value ? Number(e.target.value) : null,
                              }),
                            `Perfil de ${u.nome} atualizado.`,
                          )
                        }
                      >
                        <option value="">— pelo papel —</option>
                        {(perfis.dados ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nome}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {u.ultimo_login_em ? dataHora(u.ultimo_login_em) : 'nunca entrou'}
                    </td>
                    <td>
                      <Etiqueta texto={u.ativo ? 'Ativo' : 'Desativado'} tom={u.ativo ? 'bom' : 'critico'} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="botao discreto pequeno"
                        onClick={() =>
                          void acao(
                            () => api.patch(`/api/acesso/usuarios/${u.id}`, { ativo: !u.ativo }),
                            `${u.nome} ${u.ativo ? 'desativado' : 'ativado'}.`,
                          )
                        }
                      >
                        {u.ativo ? 'Desativar' : 'Ativar'}
                      </button>
                      <button type="button" className="botao discreto pequeno" onClick={() => setSenhaDe(u)}>
                        Redefinir senha
                      </button>
                      <button type="button" className="botao discreto pequeno" onClick={() => setRemovendo(u)}>
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      <Cartao
        titulo="Perfis"
        descricao="Módulos visíveis, ações permitidas e campos editáveis"
        acoes={
          <button
            type="button"
            className="botao"
            onClick={() =>
              setPerfilAberto({
                id: 0,
                nome: '',
                tipo: 'EDIT',
                padrao: false,
                permissoes: {},
                campos_bloqueados: {},
              })
            }
          >
            Novo perfil
          </button>
        }
      >
        {!perfis.dados ? (
          <Carregando />
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Perfil</th>
                  <th>Tipo</th>
                  <th>Módulos visíveis</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {perfis.dados.map((p) => {
                  const visiveis = Object.entries(p.permissoes)
                    .filter(([, a]) => a.view)
                    .map(([m]) => meta.dados?.modulos.find((x) => x.id === m)?.rotulo ?? m);
                  return (
                    <tr key={p.id}>
                      <td className="texto">
                        {p.nome} {p.padrao && <Etiqueta texto="padrão" />}
                      </td>
                      <td>{p.tipo === 'EDIT' ? 'Edição' : 'Somente visualização'}</td>
                      <td className="texto">{visiveis.join(', ') || 'nenhum'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button type="button" className="botao discreto pequeno" onClick={() => setPerfilAberto(p)}>
                          {p.padrao ? 'Ver' : 'Editar'}
                        </button>
                        <button
                          type="button"
                          className="botao discreto pequeno"
                          onClick={() =>
                            void acao(
                              () => api.post(`/api/acesso/perfis/${p.id}/duplicar`, { nome: `${p.nome} (cópia)` }),
                              'Perfil duplicado.',
                            )
                          }
                        >
                          Duplicar
                        </button>
                        {!p.padrao && (
                          <button
                            type="button"
                            className="botao discreto pequeno"
                            onClick={() =>
                              void acao(() => api.remover(`/api/acesso/perfis/${p.id}`), 'Perfil excluído.')
                            }
                          >
                            Excluir
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="vazio" style={{ padding: 0, textAlign: 'left' }}>
          Os perfis padrão não são renomeados nem excluídos — <strong>duplique</strong> para criar uma variação. O
          gestor do cliente administra acessos por definição: fosse preciso um perfil para isso, uma configuração
          errada trancaria todo mundo para fora.
        </p>
      </Cartao>

      {novoUsuario && (
        <FormUsuario
          perfis={perfis.dados ?? []}
          aoFechar={() => setNovoUsuario(false)}
          aoSalvar={async (dados) => {
            const deuCerto = await acao(() => api.post('/api/acesso/usuarios', dados), `${dados.nome} criado.`);
            if (deuCerto) setNovoUsuario(false);
          }}
        />
      )}

      {senhaDe && (
        <FormSenha
          usuario={senhaDe}
          aoFechar={() => setSenhaDe(null)}
          aoSalvar={async (senha) => {
            const deuCerto = await acao(
              () => api.post(`/api/acesso/usuarios/${senhaDe.id}/senha`, { senha }),
              `Senha de ${senhaDe.nome} redefinida. As sessões abertas dele foram encerradas.`,
            );
            if (deuCerto) setSenhaDe(null);
          }}
        />
      )}

      {perfilAberto && meta.dados && (
        <FormPerfil
          perfil={perfilAberto}
          modulos={meta.dados.modulos}
          acoes={meta.dados.acoes}
          aoFechar={() => setPerfilAberto(null)}
          aoSalvar={async (dados) => {
            const deuCerto = await acao(
              () =>
                perfilAberto.id
                  ? api.patch(`/api/acesso/perfis/${perfilAberto.id}`, dados)
                  : api.post('/api/acesso/perfis', dados),
              'Perfil salvo.',
            );
            if (deuCerto) setPerfilAberto(null);
          }}
        />
      )}

      {removendo && (
        <ConfirmarAcao
          titulo={`Remover o acesso de ${removendo.nome}`}
          mensagem={`A conta continua existindo e o acesso a outros clientes não muda. Só o acesso a ${
            cliente?.nome ?? 'este cliente'
          } — em todas as matrizes e filiais dele — é retirado.`}
          rotuloConfirmar="Remover acesso"
          aberto
          aoFechar={() => setRemovendo(null)}
          aoConfirmar={async () => {
            await acao(() => api.remover(`/api/acesso/usuarios/${removendo.id}`), 'Acesso removido.');
            setRemovendo(null);
          }}
        />
      )}
    </>
  );
}

function FormUsuario({
  perfis,
  aoFechar,
  aoSalvar,
}: {
  perfis: Perfil[];
  aoFechar: () => void;
  aoSalvar: (dados: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState({
    nome: '',
    username: '',
    email: '',
    senha: '',
    papel: 'leitor',
    perfil_id: '',
  });

  return (
    <Modal
      titulo="Novo usuário"
      aberto
      aoFechar={aoFechar}
      tipo="usuario"
      acoes={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button
            type="button"
            className="botao primario"
            onClick={() =>
              void aoSalvar({ ...form, perfil_id: form.perfil_id ? Number(form.perfil_id) : undefined })
            }
          >
            Criar usuário
          </button>
        </>
      }
    >
      <Campo rotulo="Nome">
        <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus />
      </Campo>
      <Campo rotulo="Usuário" dica="É com ele que a pessoa entra. Letras, números, ponto, hífen ou sublinhado.">
        <input
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          spellCheck={false}
        />
      </Campo>
      <Campo rotulo="E-mail" dica="Usado só para recuperar a senha — não serve como login.">
        <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Campo>
      <Campo rotulo="Senha inicial" dica="Mínimo de 8 caracteres, com letras e números.">
        <input
          type="password"
          value={form.senha}
          onChange={(e) => setForm({ ...form, senha: e.target.value })}
          autoComplete="new-password"
        />
      </Campo>
      <div className="grade c2">
        <Campo rotulo="Papel">
          <select value={form.papel} onChange={(e) => setForm({ ...form, papel: e.target.value })}>
            <option value="leitor">Leitor</option>
            <option value="gestor">Gestor</option>
          </select>
        </Campo>
        <Campo rotulo="Perfil">
          <select value={form.perfil_id} onChange={(e) => setForm({ ...form, perfil_id: e.target.value })}>
            <option value="">— pelo papel —</option>
            {perfis.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </Campo>
      </div>
    </Modal>
  );
}

function FormSenha({
  usuario,
  aoFechar,
  aoSalvar,
}: {
  usuario: Usuario;
  aoFechar: () => void;
  aoSalvar: (senha: string) => Promise<void>;
}) {
  const [senha, setSenha] = useState('');
  return (
    <Modal
      titulo={`Redefinir a senha de ${usuario.nome}`}
      aberto
      aoFechar={aoFechar}
      tipo="senha"
      acoes={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="button" className="botao primario" onClick={() => void aoSalvar(senha)}>
            Redefinir
          </button>
        </>
      }
    >
      <p className="vazio" style={{ padding: 0, textAlign: 'left' }}>
        As sessões abertas desta conta são encerradas: trocar a senha sem expulsar quem está dentro não troca nada
        de fato. Combine a senha nova por um canal seguro.
      </p>
      <Campo rotulo="Nova senha" dica="Mínimo de 8 caracteres, com letras e números.">
        <input
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          autoFocus
          autoComplete="new-password"
        />
      </Campo>
    </Modal>
  );
}

/** A matriz módulo × ação, mais os campos que o perfil não pode alterar. */
function FormPerfil({
  perfil,
  modulos,
  acoes,
  aoFechar,
  aoSalvar,
}: {
  perfil: Perfil;
  modulos: Array<{ id: string; rotulo: string }>;
  acoes: Acao[];
  aoFechar: () => void;
  aoSalvar: (dados: Record<string, unknown>) => Promise<void>;
}) {
  const [nome, setNome] = useState(perfil.nome);
  const [tipo, setTipo] = useState(perfil.tipo);
  const [matriz, setMatriz] = useState<Record<string, Partial<Record<Acao, boolean>>>>(
    Object.fromEntries(modulos.map((m) => [m.id, { ...(perfil.permissoes[m.id] ?? {}) }])),
  );
  const [campos, setCampos] = useState(
    Object.entries(perfil.campos_bloqueados ?? {})
      .map(([m, cs]) => `${m}: ${cs.join(', ')}`)
      .join('\n'),
  );

  const alternar = (modulo: string, acao: Acao) =>
    setMatriz((m) => ({ ...m, [modulo]: { ...m[modulo], [acao]: !m[modulo]?.[acao] } }));

  return (
    <Modal
      titulo={perfil.id ? `Perfil: ${perfil.nome}` : 'Novo perfil'}
      aberto
      aoFechar={aoFechar}
      tipo="perfil"
      acoes={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            {perfil.padrao ? 'Fechar' : 'Cancelar'}
          </button>
          {!perfil.padrao && (
            <button
              type="button"
              className="botao primario"
              onClick={() =>
                void aoSalvar({
                  nome,
                  tipo,
                  permissoes: matriz,
                  campos_bloqueados: Object.fromEntries(
                    campos
                      .split('\n')
                      .map((l) => l.split(':'))
                      .filter((p) => p.length >= 2 && p[0]!.trim())
                      .map((p) => [
                        p[0]!.trim(),
                        p.slice(1).join(':').split(',').map((c) => c.trim()).filter(Boolean),
                      ]),
                  ),
                })
              }
            >
              Salvar perfil
            </button>
          )}
        </>
      }
    >
      {perfil.padrao && (
        <Aviso>
          Perfil padrão: não é renomeado nem excluído, para não quebrar a leitura de quem ainda não tem perfil
          atribuído. Use <strong>Duplicar</strong> para criar uma variação.
        </Aviso>
      )}

      <div className="grade c2">
        <Campo rotulo="Nome">
          <input value={nome} onChange={(e) => setNome(e.target.value)} disabled={perfil.padrao} />
        </Campo>
        <Campo rotulo="Tipo">
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as Perfil['tipo'])}
            disabled={perfil.padrao}
          >
            <option value="VIEW_ONLY">Somente visualização</option>
            <option value="EDIT">Edição</option>
          </select>
        </Campo>
      </div>

      <div className="tabela-envolucro">
        <table>
          <thead>
            <tr>
              <th>Módulo</th>
              {acoes.map((a) => (
                <th key={a} style={{ textAlign: 'center' }}>
                  {ROTULO_ACAO[a]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modulos.map((m) => (
              <tr key={m.id}>
                <td className="texto">{m.rotulo}</td>
                {acoes.map((a) => (
                  <td key={a} style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={matriz[m.id]?.[a] === true}
                      disabled={perfil.padrao}
                      aria-label={`${ROTULO_ACAO[a]} em ${m.rotulo}`}
                      onChange={() => alternar(m.id, a)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="vazio" style={{ padding: 0, textAlign: 'left' }}>
        Sem <strong>Ver</strong>, as demais ações do módulo não valem: deixar as duas coisas desencontradas daria
        uma matriz que mente.
      </p>

      <Campo
        rotulo="Campos que este perfil NÃO pode alterar"
        dica="Uma linha por módulo, no formato «modulo: campo, campo». Em branco, todos os campos são editáveis."
      >
        <textarea
          value={campos}
          onChange={(e) => setCampos(e.target.value)}
          rows={4}
          disabled={perfil.padrao}
          placeholder="financeiro: valor, competencia"
        />
      </Campo>
    </Modal>
  );
}
