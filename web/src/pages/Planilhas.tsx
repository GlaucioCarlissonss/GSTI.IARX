import { useState } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
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
  template_versao: string;
  arquivo_nome: string | null;
  total_linhas: number;
  importadas: number;
  duplicadas: number;
  com_erro: number;
  criado_em: string;
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
  const { empresa, pode } = useSessao();
  // O perfil governa o que a tela oferece; quem recusa de fato é o servidor.
  const podeEditar = pode('configuracoes', 'import');
  const [modulo, setModulo] = useState('financeiro');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [criarCadastros, setCriarCadastros] = useState(true);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const templates = useDados<Templates>(() => api.get('/api/planilhas/templates'), []);
  const historico = useDados<Importacao[]>(() => api.get('/api/planilhas/importacoes'), [empresa?.id]);

  const importar = async (simular: boolean) => {
    if (!arquivo) return setErro('Selecione uma planilha .xlsx ou .csv.');
    setEnviando(true);
    setErro(null);
    setResultado(null);
    try {
      const r = await api.enviarArquivo<ResultadoImportacao>(`/api/planilhas/importacao/${modulo}`, arquivo, {
        criar_cadastros: String(criarCadastros),
        simular: String(simular),
      });
      setResultado(r);
      if (!simular) historico.recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha na importação.');
    } finally {
      setEnviando(false);
    }
  };

  const abas = templates.dados?.modulos[modulo] ?? [];

  return (
    <>
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
                  onClick={() => api.baixar(`/api/planilhas/exportacao/${m.chave}.xlsx`, `gsti-${m.chave}.xlsx`)}
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
                    onClick={() => api.baixar(`/api/planilhas/templates/${m.chave}.xlsx`, `template-${m.chave}.xlsx`)}
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

      <Cartao titulo="Histórico de importações">
        {(historico.dados ?? []).length === 0 ? (
          <p className="vazio">Nenhuma importação registrada nesta empresa.</p>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Módulo</th>
                  <th>Arquivo</th>
                  <th>Template</th>
                  <th className="num">Lidas</th>
                  <th className="num">Importadas</th>
                  <th className="num">Duplicadas</th>
                  <th className="num">Erros</th>
                </tr>
              </thead>
              <tbody>
                {(historico.dados ?? []).map((i) => (
                  <tr key={i.id}>
                    <td>{dataHora(i.criado_em)}</td>
                    <td>{i.modulo}</td>
                    <td>{i.arquivo_nome ?? '—'}</td>
                    <td>{i.template_versao}</td>
                    <td className="num">{inteiro(i.total_linhas)}</td>
                    <td className="num">{inteiro(i.importadas)}</td>
                    <td className="num">{inteiro(i.duplicadas)}</td>
                    <td className="num">{inteiro(i.com_erro)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
