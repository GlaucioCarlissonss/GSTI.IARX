import { useState } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { SeletorUnidadeFoco } from '../components/filtro-escopo';
import { Aviso, Campo, Cartao, Etiqueta } from '../components/base';
import { dataHora, inteiro } from '../lib/formato';

interface ResultadoImportacao {
  template_versao: string;
  arquivo: string | null;
  arquivo_ja_importado: boolean;
  total_linhas: number;
  importadas: number;
  duplicadas: number;
  com_erro: number;
  abas_processadas: string[];
  abas_ignoradas: string[];
  cadastros_criados: { tipos_despesa: string[]; topicos_ajuda: string[]; filiais: string[] };
  avisos: string[];
  erros: Array<{ aba: string; linha: number; mensagem: string }>;
}

interface Importacao {
  id: number;
  modulo: string;
  modo: 'inicial' | 'incremental';
  status: 'concluida' | 'recusada';
  mensagem: string | null;
  template_versao: string;
  arquivo_nome: string | null;
  total_linhas: number;
  importadas: number;
  duplicadas: number;
  com_erro: number;
  criado_em: string;
  usuario: string | null;
}

interface Mapeamento {
  id: number;
  aba: string;
  coluna: string;
  apelido: string;
}

interface Adaptador {
  cliente_id: number | null;
  abas: Record<string, string[]>;
  mapeamentos: Mapeamento[];
}

interface Templates {
  versao: string;
  modulos: Record<string, Array<{ aba: string; colunas: string[]; obrigatorias: string[] }>>;
}

const MODULOS = [
  { chave: 'financeiro', rotulo: 'Financeiro' },
  { chave: 'projetos', rotulo: 'Projetos' },
  { chave: 'sla', rotulo: 'SLA' },
  { chave: 'completo', rotulo: 'Base completa' },
];

export function PaginaPlanilhas() {
  const { empresa, empresas, trocarEmpresa, pode } = useSessao();
  // O perfil governa o que a tela oferece; quem recusa de fato é o servidor.
  const podeEditar = pode('configuracoes', 'import');
  const [modulo, setModulo] = useState('financeiro');
  const [modo, setModo] = useState<'inicial' | 'incremental'>('incremental');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [criarCadastros, setCriarCadastros] = useState(true);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [precisaConfirmar, setPrecisaConfirmar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [novoMapa, setNovoMapa] = useState({ aba: 'Financeiro', coluna: '', apelido: '' });
  const [erroMapa, setErroMapa] = useState<string | null>(null);

  const templates = useDados<Templates>(() => api.get('/api/planilhas/templates'), []);
  // O histórico é do CLIENTE: quem pergunta "por que os dados não entraram?"
  // não sabe de antemão em qual unidade a carga foi feita.
  const historico = useDados<Importacao[]>(() => api.get('/api/planilhas/importacoes'), [empresa?.id]);
  const adaptador = useDados<Adaptador>(() => api.get('/api/planilhas/mapeamentos'), [empresa?.id]);

  const importar = async (simular: boolean, confirmar = false) => {
    if (!arquivo) return setErro('Selecione uma planilha .xlsx ou .csv.');
    setEnviando(true);
    setErro(null);
    setResultado(null);
    try {
      const r = await api.enviarArquivo<ResultadoImportacao>(`/api/planilhas/importacao/${modulo}`, arquivo, {
        criar_cadastros: String(criarCadastros),
        simular: String(simular),
        modo,
        confirmar: String(confirmar),
        // A unidade da carga vai explícita: o arquivo traz as filiais e os tipos
        // de despesa DELA, e reimportá-lo precisa voltar para a mesma.
        ...(empresa ? { empresas: String(empresa.id) } : null),
      });
      setResultado(r);
      setPrecisaConfirmar(false);
      if (!simular) historico.recarregar();
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : 'Falha na importação.';
      setErro(mensagem);
      // A recusa da carga inicial não é um beco: ela existe para a confirmação
      // ser informada, e o botão de confirmar vem junto do motivo.
      setPrecisaConfirmar(/carga foi marcada como INICIAL/i.test(mensagem));
      if (!simular) historico.recarregar();
    } finally {
      setEnviando(false);
    }
  };

  const criarMapa = async () => {
    setErroMapa(null);
    try {
      await api.post('/api/planilhas/mapeamentos', novoMapa);
      setNovoMapa({ ...novoMapa, apelido: '' });
      adaptador.recarregar();
    } catch (e) {
      setErroMapa(e instanceof Error ? e.message : 'Falha ao cadastrar o cabeçalho.');
    }
  };

  const removerMapa = async (id: number) => {
    setErroMapa(null);
    try {
      await api.remover(`/api/planilhas/mapeamentos/${id}`);
      adaptador.recarregar();
    } catch (e) {
      setErroMapa(e instanceof Error ? e.message : 'Falha ao remover.');
    }
  };

  const abas = templates.dados?.modulos[modulo] ?? [];

  return (
    <>
      <div className="barra-filtros">
        <SeletorUnidadeFoco
          empresas={empresas}
          empresaId={empresa?.id ?? null}
          aoTrocar={trocarEmpresa}
          explicacao="Exportar e importar são de UMA unidade: o arquivo traz as filiais, os tipos de despesa e os cenários dela, e reimportá-lo volta para a mesma."
        />
      </div>

      <div className="grade c2">
        <Cartao
          titulo="Importar planilha"
          descricao={`Template versão ${templates.dados?.versao ?? '—'}`}
        >
          {!podeEditar ? (
            <Aviso>Somente gestores podem importar dados nesta empresa.</Aviso>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="grade c2">
                <Campo rotulo="Módulo">
                  <select value={modulo} onChange={(e) => setModulo(e.target.value)}>
                    {MODULOS.map((m) => (
                      <option key={m.chave} value={m.chave}>
                        {m.rotulo}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Campo
                  rotulo="Tipo de carga"
                  dica={
                    modo === 'inicial'
                      ? 'O histórico inteiro, de uma vez. Sobre um módulo já povoado, pede confirmação.'
                      : 'O arquivo do período, somado ao que já existe.'
                  }
                >
                  <select value={modo} onChange={(e) => setModo(e.target.value as 'inicial' | 'incremental')}>
                    <option value="incremental">Incremental (arquivo do período)</option>
                    <option value="inicial">Inicial (histórico completo)</option>
                  </select>
                </Campo>
              </div>
              <div className="grade c2">
                <Campo rotulo="Arquivo (.xlsx ou .csv)">
                  <input
                    type="file"
                    accept=".xlsx,.csv"
                    onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                  />
                </Campo>
              </div>

              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={criarCadastros} onChange={(e) => setCriarCadastros(e.target.checked)} />
                Cadastrar automaticamente tipos de despesa, tópicos e filiais ausentes
              </label>

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="botao" disabled={enviando || !arquivo} onClick={() => importar(true)}>
                  Validar sem gravar
                </button>
                <button
                  type="button"
                  className="botao primario"
                  disabled={enviando || !arquivo}
                  onClick={() => importar(false)}
                >
                  {enviando ? 'Processando…' : 'Importar'}
                </button>
              </div>

              <Aviso>
                A importação é idempotente: reenviar o mesmo arquivo não duplica registros. Linhas inválidas entram no
                relatório de erros sem abortar o lote.
              </Aviso>
              {erro && <Aviso tipo="erro">{erro}</Aviso>}
              {precisaConfirmar && (
                <button type="button" className="botao" disabled={enviando} onClick={() => importar(false, true)}>
                  Confirmar a carga inicial mesmo assim
                </button>
              )}
            </div>
          )}
        </Cartao>

        <Cartao titulo="Exportar" descricao="Mesmo layout da importação — serve de backup e migração">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {MODULOS.map((m) => (
                <button
                  key={m.chave}
                  type="button"
                  className="botao"
                  onClick={() =>
                    api.baixar(
                      `/api/planilhas/exportacao/${m.chave}.xlsx?empresas=${empresa?.id ?? ''}`,
                      `gsti-${m.chave}.xlsx`,
                    )
                  }
                >
                  Base — {m.rotulo}
                </button>
              ))}
            </div>
            <div style={{ borderTop: '1px solid var(--grade)', paddingTop: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--tinta-fraca)', marginBottom: 8 }}>
                Template em branco (mesmas colunas, sem dados)
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {MODULOS.map((m) => (
                  <button
                    key={m.chave}
                    type="button"
                    className="botao pequeno"
                    onClick={() =>
                      api.baixar(
                        `/api/planilhas/templates/${m.chave}.xlsx?empresas=${empresa?.id ?? ''}`,
                        `template-${m.chave}.xlsx`,
                      )
                    }
                  >
                    {m.rotulo}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Cartao>
      </div>

      {resultado && (
        <Cartao
          titulo="Relatório da importação"
          descricao={`${resultado.arquivo ?? 'arquivo'} · template ${resultado.template_versao}`}
        >
          <div className="grade c4" style={{ marginBottom: 14 }}>
            <div className="indicador">
              <span className="rotulo">Linhas lidas</span>
              <span className="numero">{inteiro(resultado.total_linhas)}</span>
            </div>
            <div className="indicador">
              <span className="rotulo">Importadas</span>
              <span className="numero" style={{ color: 'var(--positivo-texto)' }}>
                {inteiro(resultado.importadas)}
              </span>
            </div>
            <div className="indicador">
              <span className="rotulo">Duplicadas (ignoradas)</span>
              <span className="numero">{inteiro(resultado.duplicadas)}</span>
            </div>
            <div className="indicador">
              <span className="rotulo">Com erro</span>
              <span className="numero" style={{ color: resultado.com_erro > 0 ? 'var(--critico)' : undefined }}>
                {inteiro(resultado.com_erro)}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {resultado.abas_processadas.map((a) => (
              <Etiqueta key={a} texto={`aba processada: ${a}`} tom="bom" />
            ))}
            {resultado.abas_ignoradas.map((a) => (
              <Etiqueta key={a} texto={`aba ignorada: ${a}`} />
            ))}
            {resultado.cadastros_criados.tipos_despesa.map((t) => (
              <Etiqueta key={t} texto={`tipo criado: ${t}`} tom="atencao" />
            ))}
            {resultado.cadastros_criados.filiais.map((f) => (
              <Etiqueta key={f} texto={`filial criada: ${f}`} tom="atencao" />
            ))}
            {resultado.cadastros_criados.topicos_ajuda.map((t) => (
              <Etiqueta key={t} texto={`tópico criado: ${t}`} tom="atencao" />
            ))}
          </div>

          {resultado.avisos.map((a) => (
            <Aviso key={a}>{a}</Aviso>
          ))}

          {resultado.erros.length > 0 && (
            <div className="tabela-envolucro" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Aba</th>
                    <th className="num">Linha</th>
                    <th>Motivo da rejeição</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.erros.slice(0, 100).map((e, i) => (
                    <tr key={`${e.aba}-${e.linha}-${i}`}>
                      <td>{e.aba}</td>
                      <td className="num">{e.linha}</td>
                      <td style={{ color: 'var(--critico)' }}>{e.mensagem}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Cartao>
      )}

      <Cartao
        titulo="Histórico de cargas"
        descricao="Toda tentativa entra aqui — inclusive a recusada, que é a que se investiga"
      >
        {(historico.dados ?? []).length === 0 ? (
          <p className="vazio">Nenhuma carga registrada nesta empresa.</p>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>Módulo</th>
                  <th>Tipo</th>
                  <th>Arquivo</th>
                  <th>Situação</th>
                  <th className="num">Lidas</th>
                  <th className="num">Importadas</th>
                  <th className="num">Duplicadas</th>
                  <th className="num">Erros</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(historico.dados ?? []).map((i) => (
                  <tr key={i.id}>
                    <td>{dataHora(i.criado_em)}</td>
                    <td>{i.usuario ?? '—'}</td>
                    <td>{i.modulo}</td>
                    <td>{i.modo === 'inicial' ? 'Inicial' : 'Incremental'}</td>
                    <td title={i.mensagem ?? undefined}>{i.arquivo_nome ?? '—'}</td>
                    <td>
                      <Etiqueta
                        texto={i.status === 'recusada' ? 'Recusada' : 'Concluída'}
                        tom={i.status === 'recusada' ? 'critico' : 'bom'}
                      />
                    </td>
                    <td className="num">{inteiro(i.total_linhas)}</td>
                    <td className="num">{inteiro(i.importadas)}</td>
                    <td className="num">{inteiro(i.duplicadas)}</td>
                    <td className="num">{inteiro(i.com_erro)}</td>
                    <td>
                      {i.com_erro > 0 && (
                        <button
                          type="button"
                          className="botao discreto pequeno"
                          onClick={() =>
                            api.baixar(
                              `/api/planilhas/importacoes/${i.id}/erros.xlsx`,
                              `erros-importacao-${i.id}.xlsx`,
                            )
                          }
                        >
                          Baixar erros
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* O motivo da recusa fica junto da linha, e não escondido num título:
            é a informação que a pessoa veio buscar ao abrir o histórico. */}
        {(historico.dados ?? [])
          .filter((i) => i.status === 'recusada' && i.mensagem)
          .slice(0, 3)
          .map((i) => (
            <Aviso key={i.id} tipo="erro">
              {dataHora(i.criado_em)} — {i.arquivo_nome ?? 'arquivo'}: {i.mensagem}
            </Aviso>
          ))}
      </Cartao>

      <Cartao
        titulo="Cabeçalhos deste cliente"
        descricao="O que a planilha dele chama de outro jeito. Vale para todas as matrizes do cliente."
      >
        <Aviso>
          Onde o template diz <strong>Valor</strong>, a planilha de um cliente pode dizer <em>Vlr Total</em>. Cadastrar
          a equivalência evita reescrever o cabeçalho do arquivo a cada carga — e o nome do template continua sendo
          aceito do mesmo jeito.
        </Aviso>

        {(adaptador.dados?.mapeamentos ?? []).length > 0 && (
          <div className="tabela-envolucro" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Aba</th>
                  <th>Coluna do template</th>
                  <th>Cabeçalho aceito</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(adaptador.dados?.mapeamentos ?? []).map((m) => (
                  <tr key={m.id}>
                    <td>{m.aba}</td>
                    <td>{m.coluna}</td>
                    <td>{m.apelido}</td>
                    <td>
                      {podeEditar && (
                        <button type="button" className="botao discreto pequeno" onClick={() => removerMapa(m.id)}>
                          Remover
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {podeEditar && (
          <div className="barra-filtros" style={{ marginTop: 12 }}>
            <Campo rotulo="Aba">
              <select
                value={novoMapa.aba}
                onChange={(e) => setNovoMapa({ ...novoMapa, aba: e.target.value, coluna: '' })}
              >
                {Object.keys(adaptador.dados?.abas ?? {}).map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Coluna do template">
              <select value={novoMapa.coluna} onChange={(e) => setNovoMapa({ ...novoMapa, coluna: e.target.value })}>
                <option value="">Escolha…</option>
                {(adaptador.dados?.abas?.[novoMapa.aba] ?? []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Cabeçalho na planilha do cliente">
              <input
                value={novoMapa.apelido}
                onChange={(e) => setNovoMapa({ ...novoMapa, apelido: e.target.value })}
                style={{ minWidth: 220 }}
              />
            </Campo>
            <button
              type="button"
              className="botao primario"
              disabled={!novoMapa.coluna || !novoMapa.apelido.trim()}
              onClick={criarMapa}
            >
              Cadastrar cabeçalho
            </button>
          </div>
        )}
        {erroMapa && <Aviso tipo="erro">{erroMapa}</Aviso>}
      </Cartao>

      <Cartao titulo="Layout do template" descricao={`Módulo ${modulo} — versão ${templates.dados?.versao ?? '—'}`}>
        {abas.map((aba) => (
          <div key={aba.aba} style={{ marginBottom: 14 }}>
            <h3>{aba.aba}</h3>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {aba.colunas.map((c) => (
                <Etiqueta key={c} texto={c} tom={aba.obrigatorias.includes(c) ? 'atencao' : 'neutro'} />
              ))}
            </div>
          </div>
        ))}
        <small style={{ color: 'var(--tinta-fraca)' }}>Colunas destacadas são obrigatórias.</small>
      </Cartao>
    </>
  );
}
