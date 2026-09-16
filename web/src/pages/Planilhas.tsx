import { useState } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import {
  EtapaOperacao,
  SeletorEscopo,
  consultaDoEscopo,
  escopoCompleto,
  parametrosDoEscopo,
  resumoEscopo,
  useEscopoOperacao,
} from '../components/escopo-operacao';
import { Aviso, Campo, Cartao, Etiqueta } from '../components/base';
import { PainelConciliacao, type Analise, type Decisao } from '../components/conciliacao';
import { dataHora, inteiro } from '../lib/formato';

interface Previa {
  lancamentos: number;
  competencias: string[];
  confirmacao_exigida: string | null;
}

interface ResultadoFoc {
  importadas: number;
  atualizadas: number;
  duplicadas: number;
  rejeitadas: number;
  cadastros_criados: { centros_custo: string[]; filiais: string[] };
}

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
  atualizadas: number | null;
  duplicadas: number;
  rejeitadas: number | null;
  com_erro: number;
  criado_em: string;
  usuario: string | null;
  usuario_id: number | null;
  escopo: string | null;
  /** JSON {empresas:[],filiais:[]} — o escopo REAL da carga, já expandido. */
  escopo_unidades: string | null;
}

interface Exportacao {
  id: number;
  modulo: string;
  formato: string;
  escopo: string | null;
  escopo_unidades: string | null;
  arquivo_nome: string | null;
  total_linhas: number;
  template_versao: string | null;
  criado_em: string;
  usuario: string | null;
  usuario_id: number | null;
  empresa: string | null;
}

const ROTULO_ESCOPO: Record<string, string> = {
  cliente: 'Cliente inteiro',
  empresas: 'Empresas',
  unidades: 'Unidades',
};

/** O escopo gravado, em texto — vira o título da célula, para não alargar a tabela. */
function unidadesDaCarga(bruto: string | null): string | undefined {
  if (!bruto) return undefined;
  try {
    const { empresas, filiais } = JSON.parse(bruto) as { empresas?: number[]; filiais?: number[] };
    const partes = [`${empresas?.length ?? 0} empresa(s)`];
    if (filiais?.length) partes.push(`${filiais.length} filial(is)`);
    return partes.join(', ');
  } catch {
    return undefined;
  }
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
  const { empresa, empresas, filiais, pode } = useSessao();
  // O perfil governa o que a tela oferece; quem recusa de fato é o servidor.
  const podeEditar = pode('configuracoes', 'import');
  // Um escopo só para importar e exportar: mudar num lugar e esquecer no outro
  // é justamente o engano que compartilhar o estado evita.
  const [escopo, setEscopo] = useEscopoOperacao();
  // Em que fase a operação está. Não é percentual: as fases de uma carga têm
  // duração muito desigual, e um número subindo sozinho mentiria sobre o resto.
  const [etapa, setEtapa] = useState<string | null>(null);
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

  // Carga da base do cliente: analisar primeiro, decidir, e só então gravar.
  const [arquivoFoc, setArquivoFoc] = useState<File | null>(null);
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [resultadoFoc, setResultadoFoc] = useState<ResultadoFoc | null>(null);
  const [erroFoc, setErroFoc] = useState<string | null>(null);
  const [enviandoFoc, setEnviandoFoc] = useState(false);

  // Limpeza da base: a contagem vem antes, e a confirmação é informada.
  const podeLimpar = pode('financeiro', 'delete');
  const [limpeza, setLimpeza] = useState({ de: '', ate: '' });
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [confirmacao, setConfirmacao] = useState('');
  const [erroLimpeza, setErroLimpeza] = useState<string | null>(null);
  const [limpando, setLimpando] = useState(false);

  // Mexer no período invalida a prévia: confirmar com a contagem de outro
  // recorte seria apagar o que ninguém viu.
  const trocarLimpeza = (campo: 'de' | 'ate', valor: string) => {
    setLimpeza((l) => ({ ...l, [campo]: valor }));
    setPrevia(null);
    setConfirmacao('');
  };

  const verPrevia = async () => {
    setErroLimpeza(null);
    setConfirmacao('');
    try {
      setPrevia(
        await api.get<Previa>('/api/planilhas/limpeza/previa', {
          de: limpeza.de || undefined,
          ate: limpeza.ate || undefined,
        }),
      );
    } catch (e) {
      setErroLimpeza(e instanceof Error ? e.message : 'Não foi possível contar os registros.');
    }
  };

  const executarLimpeza = async () => {
    setLimpando(true);
    setErroLimpeza(null);
    try {
      const r = await api.post<{ removidos: number }>('/api/planilhas/limpeza', {
        de: limpeza.de || null,
        ate: limpeza.ate || null,
        confirmacao: confirmacao || null,
      });
      setPrevia(null);
      setConfirmacao('');
      setErroLimpeza(null);
      historico.recarregar();
      alert(`${r.removidos} lançamento(s) apagado(s).`);
    } catch (e) {
      setErroLimpeza(e instanceof Error ? e.message : 'A limpeza não pôde ser concluída.');
    } finally {
      setLimpando(false);
    }
  };

  const analisar = async () => {
    if (!arquivoFoc) return;
    setEnviandoFoc(true);
    setErroFoc(null);
    setResultadoFoc(null);
    setEtapa('Lendo o arquivo e conciliando com o cadastro');
    try {
      setAnalise(
        await api.enviarArquivo<Analise>('/api/planilhas/foc/conciliacao', arquivoFoc, {
          ...parametrosDoEscopo(escopo),
        }),
      );
    } catch (e) {
      setErroFoc(e instanceof Error ? e.message : 'Não foi possível ler a planilha.');
    } finally {
      setEnviandoFoc(false);
      setEtapa(null);
    }
  };

  const importarFoc = async (decisoes: Decisao[]) => {
    if (!arquivoFoc) return;
    setEnviandoFoc(true);
    setErroFoc(null);
    setEtapa('Gravando os lançamentos');
    try {
      const r = await api.enviarArquivo<ResultadoFoc>('/api/planilhas/foc/carga', arquivoFoc, {
        decisoes: JSON.stringify(decisoes),
        ...parametrosDoEscopo(escopo),
      });
      setResultadoFoc(r);
      // Com a carga gravada, a conciliação daquele arquivo não descreve mais a
      // base: deixá-la na tela convidaria a importar de novo sobre o novo estado.
      setAnalise(null);
      historico.recarregar();
    } catch (e) {
      setErroFoc(e instanceof Error ? e.message : 'A importação não pôde ser concluída.');
    } finally {
      setEnviandoFoc(false);
      setEtapa(null);
    }
  };

  // Recorte do histórico: quem pergunta "por que não entrou?" já sabe mais ou
  // menos quando e quem, então é por aí que se procura.
  const [fHist, setFHist] = useState({ modo: '', status: '', usuario_id: '', de: '', ate: '', escopo: '' });
  const temFiltroHist = Object.values(fHist).some(Boolean);
  const trocarHist = (campo: keyof typeof fHist, valor: string) => setFHist((f) => ({ ...f, [campo]: valor }));
  const limparHist = () => setFHist({ modo: '', status: '', usuario_id: '', de: '', ate: '', escopo: '' });

  const templates = useDados<Templates>(() => api.get('/api/planilhas/templates'), []);
  // O histórico é do CLIENTE: quem pergunta "por que os dados não entraram?"
  // não sabe de antemão em qual unidade a carga foi feita.
  const historico = useDados<Importacao[]>(
    () =>
      api.get('/api/planilhas/importacoes', {
        modo: fHist.modo || undefined,
        status: fHist.status || undefined,
        usuario_id: fHist.usuario_id || undefined,
        de: fHist.de || undefined,
        ate: fHist.ate || undefined,
        escopo: fHist.escopo || undefined,
      }),
    [empresa?.id, JSON.stringify(fHist)],
  );

  // Os responsáveis saem do histórico SEM filtro: tirá-los da lista já
  // filtrada faria o seletor encolher para uma pessoa só assim que alguém
  // fosse escolhido — e aí não haveria como trocar para outra.
  const todasAsCargas = useDados<Importacao[]>(() => api.get('/api/planilhas/importacoes'), [empresa?.id]);
  const responsaveis = [
    ...new Map(
      (todasAsCargas.dados ?? [])
        .filter((i) => i.usuario_id && i.usuario)
        .map((i) => [i.usuario_id!, { id: i.usuario_id!, nome: i.usuario! }]),
    ).values(),
  ].sort((a, b) => a.nome.localeCompare(b.nome));
  // O ExportLog. Compartilha os filtros do histórico de cargas de propósito: a
  // pergunta é a mesma — "o que saiu e entrou desta base, quando e por quem?".
  const exportacoes = useDados<Exportacao[]>(
    () =>
      api.get('/api/planilhas/exportacoes', {
        // "Tipo" (inicial/incremental) é conceito de CARGA: não se aplica aqui.
        // Os demais filtros são os mesmos, porque a pergunta é a mesma.
        usuario_id: fHist.usuario_id || undefined,
        de: fHist.de || undefined,
        ate: fHist.ate || undefined,
        escopo: fHist.escopo || undefined,
      }),
    [empresa?.id, JSON.stringify(fHist)],
  );
  const adaptador = useDados<Adaptador>(() => api.get('/api/planilhas/mapeamentos'), [empresa?.id]);

  const importar = async (simular: boolean, confirmar = false) => {
    if (!arquivo) return setErro('Selecione uma planilha .xlsx ou .csv.');
    setEnviando(true);
    setErro(null);
    setResultado(null);
    setEtapa(simular ? 'Conferindo o arquivo' : 'Lendo o arquivo e gravando');
    try {
      const r = await api.enviarArquivo<ResultadoImportacao>(`/api/planilhas/importacao/${modulo}`, arquivo, {
        criar_cadastros: String(criarCadastros),
        simular: String(simular),
        modo,
        confirmar: String(confirmar),
        // O escopo vai explícito: é ele que decide para quais unidades as
        // linhas vão, e é ele que o servidor registra no histórico.
        ...parametrosDoEscopo(escopo),
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
      setEtapa(null);
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
        <SeletorEscopo
          escopo={escopo}
          aoMudar={setEscopo}
          empresas={empresas}
          filiais={filiais}
          explicacao="Vale para importar E exportar, nesta tela. O arquivo traz a coluna Empresa, então um arquivo só atende todas as unidades do escopo — e volta para elas na reimportação."
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
                <button
                  type="button"
                  className="botao"
                  disabled={enviando || !arquivo || !escopoCompleto(escopo)}
                  onClick={() => importar(true)}
                >
                  Validar sem gravar
                </button>
                <button
                  type="button"
                  className="botao primario"
                  disabled={enviando || !arquivo || !escopoCompleto(escopo)}
                  onClick={() => importar(false)}
                >
                  {enviando ? 'Processando…' : `Importar (${resumoEscopo(escopo, empresas, filiais)})`}
                </button>
              </div>
              <EtapaOperacao etapa={enviando ? etapa : null} />

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

        <Cartao
          titulo="Carga da base do cliente"
          descricao="A planilha que o cliente exporta do sistema dele, conferida contra o cadastro antes de entrar"
        >
          {erroFoc && <Aviso tipo="erro">{erroFoc}</Aviso>}
          {resultadoFoc && (
            <Aviso tipo="ok">
              <strong>{resultadoFoc.importadas}</strong> lançamento(s) importado(s)
              {resultadoFoc.duplicadas > 0 && ` · ${resultadoFoc.duplicadas} já existia(m)`}
              {resultadoFoc.rejeitadas > 0 && ` · ${resultadoFoc.rejeitadas} recusada(s)`}
              {resultadoFoc.cadastros_criados.centros_custo.length > 0 && (
                <div style={{ fontSize: 12.5, marginTop: 4 }}>
                  Centros de custo criados: {resultadoFoc.cadastros_criados.centros_custo.join(', ')}
                </div>
              )}
            </Aviso>
          )}

          <div className="barra-filtros" style={{ marginBottom: 12 }}>
            <Campo rotulo="Planilha do cliente (.xlsx)">
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => {
                  setArquivoFoc(e.target.files?.[0] ?? null);
                  setAnalise(null);
                  setResultadoFoc(null);
                  setErroFoc(null);
                }}
              />
            </Campo>
            <button
              type="button"
              className="botao"
              disabled={!arquivoFoc || enviandoFoc || !podeEditar || !escopoCompleto(escopo)}
              onClick={analisar}
            >
              {enviandoFoc && !analise ? 'Analisando…' : 'Analisar'}
            </button>
          </div>
          <EtapaOperacao etapa={enviandoFoc ? etapa : null} />

          {analise ? (
            <PainelConciliacao analise={analise} enviando={enviandoFoc} aoImportar={importarFoc} />
          ) : (
            <p style={{ color: 'var(--tinta-fraca)', fontSize: 13, margin: 0 }}>
              Analisar não grava nada: mostra o que a planilha traz de diferente do cadastro e espera a sua decisão em
              cada caso. Só depois disso a importação fica disponível.
            </p>
          )}
        </Cartao>

        {podeLimpar && (
          <Cartao
            titulo="Limpar base"
            descricao="Apaga lançamentos do cliente. Cadastro nenhum é tocado — centro de custo, filial e fornecedor ficam."
          >
            {erroLimpeza && <Aviso tipo="erro">{erroLimpeza}</Aviso>}
            <div className="barra-filtros" style={{ marginBottom: 10 }}>
              <Campo rotulo="De (MM/AAAA)" dica="Em branco nos dois campos = a base inteira do cliente.">
                <input value={limpeza.de} onChange={(e) => trocarLimpeza('de', e.target.value)} placeholder="09/2026" style={{ width: 100 }} />
              </Campo>
              <Campo rotulo="Até (MM/AAAA)">
                <input value={limpeza.ate} onChange={(e) => trocarLimpeza('ate', e.target.value)} placeholder="09/2026" style={{ width: 100 }} />
              </Campo>
              <button type="button" className="botao" onClick={verPrevia} disabled={limpando}>
                Ver o que será apagado
              </button>
            </div>

            {previa && (
              <>
                <Aviso tipo={previa.lancamentos > 0 ? 'erro' : 'info'}>
                  {previa.lancamentos === 0 ? (
                    'Nada a apagar neste recorte.'
                  ) : (
                    <>
                      Serão apagados <strong>{inteiro(previa.lancamentos)}</strong> lançamento(s)
                      {previa.competencias.length > 0 && ` · competência(s): ${previa.competencias.join(', ')}`}. Esta
                      ação não tem volta.
                    </>
                  )}
                </Aviso>
                {previa.lancamentos > 0 && (
                  <div className="barra-filtros">
                    {previa.confirmacao_exigida && (
                      <Campo
                        rotulo="Digite o nome do cliente para confirmar"
                        dica={`Exatamente: ${previa.confirmacao_exigida}`}
                      >
                        <input
                          value={confirmacao}
                          onChange={(e) => setConfirmacao(e.target.value)}
                          style={{ minWidth: 240 }}
                        />
                      </Campo>
                    )}
                    <button
                      type="button"
                      className="botao perigo"
                      disabled={
                        limpando ||
                        (!!previa.confirmacao_exigida && confirmacao.trim() !== previa.confirmacao_exigida)
                      }
                      onClick={executarLimpeza}
                    >
                      {limpando ? 'Apagando…' : `Apagar ${inteiro(previa.lancamentos)} lançamento(s)`}
                    </button>
                  </div>
                )}
              </>
            )}
          </Cartao>
        )}

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
                      `/api/planilhas/exportacao/${m.chave}.xlsx?${consultaDoEscopo(escopo)}`,
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
                        `/api/planilhas/templates/${m.chave}.xlsx?${consultaDoEscopo(escopo)}`,
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
        <div className="barra-filtros" style={{ marginBottom: 12 }}>
          <Campo rotulo="Tipo">
            <select value={fHist.modo} onChange={(e) => trocarHist('modo', e.target.value)}>
              <option value="">Todos</option>
              <option value="inicial">Inicial</option>
              <option value="incremental">Incremental</option>
            </select>
          </Campo>
          <Campo rotulo="Escopo">
            <select value={fHist.escopo} onChange={(e) => trocarHist('escopo', e.target.value)}>
              <option value="">Todos</option>
              <option value="cliente">Cliente inteiro</option>
              <option value="empresas">Empresas</option>
              <option value="unidades">Unidades</option>
            </select>
          </Campo>
          <Campo rotulo="Situação">
            <select value={fHist.status} onChange={(e) => trocarHist('status', e.target.value)}>
              <option value="">Todas</option>
              <option value="concluida">Concluída</option>
              <option value="recusada">Recusada</option>
            </select>
          </Campo>
          <Campo rotulo="Responsável">
            <select value={fHist.usuario_id} onChange={(e) => trocarHist('usuario_id', e.target.value)}>
              <option value="">Todos</option>
              {responsaveis.map((r) => (
                <option key={r.id} value={r.id}>{r.nome}</option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="De" dica="Data da carga.">
            <input type="date" value={fHist.de} onChange={(e) => trocarHist('de', e.target.value)} />
          </Campo>
          <Campo rotulo="Até">
            <input type="date" value={fHist.ate} onChange={(e) => trocarHist('ate', e.target.value)} />
          </Campo>
          {temFiltroHist && (
            <button type="button" className="botao discreto pequeno" onClick={limparHist}>
              Limpar filtros
            </button>
          )}
        </div>

        {(historico.dados ?? []).length === 0 ? (
          <p className="vazio">
            {temFiltroHist ? 'Nenhuma carga com estes filtros.' : 'Nenhuma carga registrada neste cliente.'}
          </p>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>Módulo</th>
                  <th>Tipo</th>
                  <th>Escopo</th>
                  <th>Arquivo</th>
                  <th>Situação</th>
                  <th className="num">Lidas</th>
                  <th className="num">Importadas</th>
                  <th className="num">Atualizadas</th>
                  <th className="num">Ignoradas</th>
                  <th className="num">Rejeitadas</th>
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
                    <td title={unidadesDaCarga(i.escopo_unidades)}>{ROTULO_ESCOPO[i.escopo ?? 'cliente'] ?? '—'}</td>
                    <td title={i.mensagem ?? undefined}>{i.arquivo_nome ?? '—'}</td>
                    <td>
                      <Etiqueta
                        texto={i.status === 'recusada' ? 'Recusada' : 'Concluída'}
                        tom={i.status === 'recusada' ? 'critico' : 'bom'}
                      />
                    </td>
                    <td className="num">{inteiro(i.total_linhas)}</td>
                    <td className="num">{inteiro(i.importadas)}</td>
                    <td className="num">{inteiro(i.atualizadas ?? 0)}</td>
                    <td className="num">{inteiro(i.duplicadas)}</td>
                    <td className="num">{inteiro(i.rejeitadas ?? 0)}</td>
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
        titulo="Histórico de exportações"
        descricao="Exportar não grava dado, mas é saída de dado — e o rastro diz o que saiu daqui"
      >
        {(exportacoes.dados ?? []).length === 0 ? (
          <Aviso>Nenhuma exportação registrada para este cliente ainda.</Aviso>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>Módulo</th>
                  <th>Formato</th>
                  <th>Escopo</th>
                  <th>Arquivo</th>
                  <th className="num">Linhas</th>
                </tr>
              </thead>
              <tbody>
                {(exportacoes.dados ?? []).map((x) => (
                  <tr key={x.id}>
                    <td>{dataHora(x.criado_em)}</td>
                    <td>{x.usuario ?? '—'}</td>
                    <td>{x.modulo}</td>
                    <td>{x.formato}</td>
                    <td title={unidadesDaCarga(x.escopo_unidades)}>{ROTULO_ESCOPO[x.escopo ?? 'cliente'] ?? '—'}</td>
                    <td>{x.arquivo_nome ?? '—'}</td>
                    <td className="num">{inteiro(x.total_linhas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
