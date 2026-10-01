/**
 * Exportação e importação de chamados em XLSX.
 *
 * A importação nunca grava direto: primeiro mostra a PRÉVIA, linha a linha, com
 * o que é válido e o que vai acontecer com cada uma. Só depois de ver isso é
 * que o gestor confirma — é a diferença entre um relatório do que aconteceu e
 * um aviso do que vai acontecer.
 */
import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { Aviso, Cartao, Etiqueta, Modal } from './base';
import { inteiro } from '../lib/formato';

interface LinhaValidada {
  linha: number;
  valida: boolean;
  mensagem: string | null;
  external_id: string;
  source_system: string;
  title: string;
  efeito: 'criar' | 'atualizar' | null;
}

interface Previa {
  total: number;
  validas: number;
  invalidas: number;
  a_criar: number;
  a_atualizar: number;
  linhas: LinhaValidada[];
}

interface Resultado {
  total: number;
  criados: number;
  atualizados: number;
  rejeitados: number;
  erros: Array<{ linha: number; external_id: string; mensagem: string }>;
}

export function PlanilhaDeChamados({
  recorte,
  totalNoRecorte,
  podeImportar,
  aoImportar,
}: {
  /** Os filtros da tela: o arquivo leva o recorte que está à vista. */
  recorte: Record<string, unknown>;
  totalNoRecorte: number;
  podeImportar: boolean;
  aoImportar: () => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const limpar = () => {
    setArquivo(null);
    setPrevia(null);
    if (entrada.current) entrada.current.value = '';
  };

  const escolher = async (f: File | null) => {
    setErro(null);
    setResultado(null);
    setArquivo(f);
    setPrevia(null);
    if (!f) return;
    setOcupado(true);
    try {
      setPrevia(await api.enviarArquivo<Previa>('/api/suporte/chamados/importacao/previa', f));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
      limpar();
    } finally {
      setOcupado(false);
    }
  };

  const confirmar = async () => {
    if (!arquivo) return;
    setErro(null);
    setOcupado(true);
    try {
      setResultado(await api.enviarArquivo<Resultado>('/api/suporte/chamados/importacao', arquivo));
      limpar();
      aoImportar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível importar.');
    } finally {
      setOcupado(false);
    }
  };

  const baixar = async (caminho: string, nome: string) => {
    setErro(null);
    try {
      await api.baixar(caminho, nome);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível gerar o arquivo.');
    }
  };

  const parametros = new URLSearchParams(
    Object.entries(recorte)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();

  return (
    <Cartao titulo="Planilha de chamados" descricao="Exportar o recorte, ou importar em lote">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="botao"
          onClick={() =>
            baixar(
              `/api/suporte/chamados/exportacao.xlsx${parametros ? `?${parametros}` : ''}`,
              `chamados-${new Date().toISOString().slice(0, 10)}.xlsx`,
            )
          }
        >
          Exportar XLSX
        </button>
        <button
          type="button"
          className="botao"
          onClick={() => baixar('/api/suporte/chamados/modelo.xlsx', 'modelo-chamados.xlsx')}
        >
          Baixar modelo
        </button>
        {podeImportar && (
          <>
            <input
              ref={entrada}
              type="file"
              accept=".xlsx"
              aria-label="Arquivo XLSX para importar"
              onChange={(e) => void escolher(e.target.files?.[0] ?? null)}
              style={{ maxWidth: 260 }}
            />
            {ocupado && <Etiqueta texto="processando…" />}
          </>
        )}
      </div>
      <p className="vazio" style={{ padding: 0, textAlign: 'left' }}>
        A exportação leva os <strong>{inteiro(totalNoRecorte)}</strong> chamado(s) do recorte atual, com a aba{' '}
        <strong>Instruções</strong> explicando cada coluna. Na importação, a chave é{' '}
        <strong>(sistema de origem, external_id)</strong>: reenviar o mesmo arquivo atualiza, nunca duplica.
      </p>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {resultado && (
        <Aviso tipo={resultado.rejeitados > 0 ? 'erro' : 'ok'}>
          <strong>
            {inteiro(resultado.criados)} criado(s), {inteiro(resultado.atualizados)} atualizado(s),{' '}
            {inteiro(resultado.rejeitados)} rejeitado(s)
          </strong>{' '}
          de {inteiro(resultado.total)} linha(s).
          {resultado.rejeitados > 0 && (
            <>
              {' '}
              <button
                type="button"
                className="botao discreto pequeno"
                onClick={async () => {
                  try {
                    await api.baixarComCorpo(
                      '/api/suporte/chamados/importacao/erros.xlsx',
                      { erros: resultado.erros },
                      'erros-importacao.xlsx',
                    );
                  } catch (e) {
                    setErro(e instanceof Error ? e.message : 'Não foi possível gerar o arquivo de erros.');
                  }
                }}
              >
                Baixar as linhas recusadas
              </button>
            </>
          )}
        </Aviso>
      )}

      {previa && (
        <Modal
          titulo="Conferir antes de importar"
          aberto
          aoFechar={limpar}
          tipo="previa-importacao"
          acoes={
            <>
              <button type="button" className="botao" onClick={limpar}>
                Cancelar
              </button>
              <button
                type="button"
                className="botao primario"
                disabled={ocupado || previa.validas === 0}
                onClick={() => void confirmar()}
              >
                {previa.validas === 0
                  ? 'Nenhuma linha válida'
                  : `Importar ${inteiro(previa.validas)} linha(s)`}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Etiqueta texto={`${inteiro(previa.total)} linha(s) no arquivo`} />
            <Etiqueta texto={`${inteiro(previa.a_criar)} a criar`} tom={previa.a_criar > 0 ? 'bom' : 'neutro'} />
            <Etiqueta texto={`${inteiro(previa.a_atualizar)} a atualizar`} />
            <Etiqueta
              texto={`${inteiro(previa.invalidas)} com erro`}
              tom={previa.invalidas > 0 ? 'critico' : 'neutro'}
            />
          </div>
          <p className="vazio" style={{ padding: 0, textAlign: 'left' }}>
            Nada foi gravado ainda. As linhas com erro são recusadas; as demais entram ao confirmar.
          </p>

          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>external_id</th>
                  <th>Sistema</th>
                  <th>Assunto</th>
                  <th>Efeito</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {previa.linhas.map((l) => (
                  <tr key={l.linha}>
                    <td className="num">{l.linha}</td>
                    <td>{l.external_id || '—'}</td>
                    <td>{l.source_system || '—'}</td>
                    <td className="texto">{l.title || '—'}</td>
                    <td>{l.efeito === 'criar' ? 'Criar' : l.efeito === 'atualizar' ? 'Atualizar' : '—'}</td>
                    <td className="texto">
                      {l.valida ? (
                        <Etiqueta texto="válida" tom="bom" />
                      ) : (
                        <span style={{ color: 'var(--critico)' }}>{l.mensagem}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </Cartao>
  );
}
