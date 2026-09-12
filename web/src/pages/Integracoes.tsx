/**
 * Integrações — a conexão entre os sistemas de suporte e este SaaS.
 *
 * O fluxo é: OStick/Bitrix24 → N8N → webhook daqui → pipeline → banco. Esta
 * tela existe para o operador não depender do N8N para diagnosticar: ela tem o
 * endereço, o segredo, o interruptor, o disparo de teste e o log de eventos
 * com reprocessamento.
 */
import { useState } from 'react';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { Aviso, Campo, Carregando, Cartao, Etiqueta, Modal } from '../components/base';
import { SeletorMulti } from '../components/seletor-multi';
import { dataHora } from '../lib/formato';

type SistemaOrigem = 'OSTICK' | 'BITRIX24';

const ROTULO: Record<SistemaOrigem, string> = { OSTICK: 'Sistema OStick', BITRIX24: 'Sistema Bitrix24' };

interface Config {
  id: number;
  source_system: SistemaOrigem;
  webhook_path: string;
  tem_segredo: boolean;
  ativo: boolean;
  ultimo_evento_em: string | null;
  ultimo_erro: string | null;
}

interface Evento {
  id: number;
  source_system: SistemaOrigem;
  external_id: string | null;
  tipo: string;
  status: 'received' | 'processed' | 'error';
  erro: string | null;
  ticket_id: number | null;
  teste: boolean;
  criado_em: string;
  processado_em: string | null;
  payload: unknown;
}

const ROTULO_STATUS: Record<Evento['status'], string> = {
  received: 'Recebido',
  processed: 'Processado',
  error: 'Com erro',
};

/** Botão de copiar que diz que copiou. Sem retorno, ninguém sabe se pegou. */
function BotaoCopiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className="botao discreto pequeno"
      aria-label={`Copiar ${rotulo}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        } catch {
          // Área de transferência bloqueada: o texto está à vista para copiar à mão.
          setCopiado(false);
        }
      }}
    >
      {copiado ? 'Copiado' : 'Copiar'}
    </button>
  );
}

export function PaginaIntegracoes() {
  const { empresa, pode } = useSessao();
  // O perfil governa o que a tela oferece; quem recusa de fato é o servidor.
  const podeEditar = pode('integracoes', 'edit');
  const configs = useDados<Config[]>(() => api.get('/api/integracoes'), [empresa?.id]);

  const [status, setStatus] = useState<string[]>([]);
  const [sistemas, setSistemas] = useState<string[]>([]);
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [versao, setVersao] = useState(0);
  const eventos = useDados<{ itens: Evento[]; resumo: Record<string, number> }>(
    () => api.get('/api/integracoes/eventos', {
      status: status.join(','), sistema: sistemas.join(','),
      de: de || undefined, ate: ate || undefined, limite: 200,
    }),
    [empresa?.id, status, sistemas, de, ate, versao],
  );

  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  /** Segredo recém-gerado: existe só nesta tela, e some ao recarregar. */
  const [segredoNovo, setSegredoNovo] = useState<{ sistema: SistemaOrigem; valor: string } | null>(null);
  const [mostrarSegredo, setMostrarSegredo] = useState(false);
  const [payloadAberto, setPayloadAberto] = useState<Evento | null>(null);

  const recarregar = () => {
    configs.recarregar();
    setVersao((v) => v + 1);
  };

  const acao = async (fn: () => Promise<unknown>, sucesso?: string) => {
    setErro(null);
    setAviso(null);
    try {
      await fn();
      if (sucesso) setAviso(sucesso);
      recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir a ação.');
    }
  };

  const baseDaUrl = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <>
      <Cartao
        titulo="Integrações"
        descricao="OStick e Bitrix24 → N8N → webhook deste SaaS → chamados"
      >
        <p className="vazio" style={{ padding: 0, textAlign: 'left' }}>
          O N8N é quem consulta os sistemas de origem e entrega aqui. Este SaaS é o receptor: expõe o endereço,
          confere o segredo, normaliza e grava. Reentrega do mesmo chamado <strong>atualiza</strong>, nunca duplica.
        </p>
      </Cartao>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}

      {!configs.dados ? (
        <Carregando />
      ) : (
        <div className="grade c2">
          {configs.dados.map((c) => (
            <Cartao
              key={c.source_system}
              titulo={ROTULO[c.source_system]}
              acoes={
                <Etiqueta texto={c.ativo ? 'Ativa' : 'Desativada'} tom={c.ativo ? 'bom' : 'critico'} />
              }
            >
              <Campo rotulo="URL do webhook">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input readOnly value={baseDaUrl + c.webhook_path} style={{ flex: 1 }} />
                  <BotaoCopiar texto={baseDaUrl + c.webhook_path} rotulo="a URL do webhook" />
                </div>
              </Campo>

              <Campo rotulo="Segredo (header X-Webhook-Secret)">
                {segredoNovo?.sistema === c.source_system ? (
                  <>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        readOnly
                        data-segredo
                        aria-label="Segredo do webhook"
                        value={mostrarSegredo ? segredoNovo.valor : '•'.repeat(segredoNovo.valor.length)}
                        style={{ flex: 1, fontFamily: 'var(--mono, monospace)' }}
                      />
                      <button
                        type="button"
                        className="botao discreto pequeno"
                        data-mostrar
                        aria-pressed={mostrarSegredo}
                        aria-label={mostrarSegredo ? 'Ocultar o segredo' : 'Mostrar o segredo'}
                        onClick={() => setMostrarSegredo((v) => !v)}
                      >
                        {mostrarSegredo ? 'Ocultar' : 'Mostrar'}
                      </button>
                      <BotaoCopiar texto={segredoNovo.valor} rotulo="o segredo" />
                    </div>
                    <small style={{ color: 'var(--critico)' }}>
                      Copie agora. O segredo é guardado como hash e não será exibido de novo.
                    </small>
                  </>
                ) : (
                  <p className="vazio" style={{ padding: 0, textAlign: 'left' }}>
                    {c.tem_segredo
                      ? 'Há um segredo configurado. Ele é guardado como hash e não pode ser exibido — se você o perdeu, gere outro.'
                      : 'Sem segredo próprio: vale o da variável de ambiente do servidor. Gere um para esta conexão ter o seu.'}
                  </p>
                )}
              </Campo>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="botao"
                  disabled={!podeEditar}
                  onClick={() =>
                    acao(async () => {
                      const r = await api.post<{ segredo: string }>(
                        `/api/integracoes/${c.source_system.toLowerCase()}/segredo`,
                        {},
                      );
                      setSegredoNovo({ sistema: c.source_system, valor: r.segredo });
                      setMostrarSegredo(true);
                    })
                  }
                >
                  {c.tem_segredo ? 'Regenerar segredo' : 'Gerar segredo'}
                </button>
                <button
                  type="button"
                  className="botao"
                  disabled={!podeEditar}
                  aria-pressed={c.ativo}
                  onClick={() =>
                    acao(
                      () => api.patch(`/api/integracoes/${c.source_system.toLowerCase()}`, { ativo: !c.ativo }),
                      c.ativo ? `${ROTULO[c.source_system]} desativado.` : `${ROTULO[c.source_system]} ativado.`,
                    )
                  }
                >
                  {c.ativo ? 'Desativar' : 'Ativar'}
                </button>
                <button
                  type="button"
                  className="botao primario"
                  disabled={!podeEditar}
                  onClick={() =>
                    acao(async () => {
                      const r = await api.post<{ external_id: string }>(
                        `/api/integracoes/${c.source_system.toLowerCase()}/teste`,
                        {},
                      );
                      setAviso(
                        `Payload de teste processado: o chamado ${r.external_id} entrou em ${ROTULO[c.source_system]}.`,
                      );
                    })
                  }
                >
                  Enviar payload de teste
                </button>
              </div>

              <dl className="ficha">
                <dt>Último evento</dt>
                <dd>{c.ultimo_evento_em ? dataHora(c.ultimo_evento_em) : 'nenhum ainda'}</dd>
                <dt>Último erro</dt>
                <dd>{c.ultimo_erro ?? '—'}</dd>
              </dl>
            </Cartao>
          ))}
        </div>
      )}

      <Cartao
        titulo="Como configurar no N8N"
        descricao="O passo a passo com o endereço e o header desta empresa"
      >
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          <li>
            <strong>Trigger</strong> — um nó de webhook do OStick/Bitrix24, ou um agendamento que consulta a API
            do sistema de origem.
          </li>
          <li>
            <strong>Transform</strong> — mapeie os campos da origem. Obrigatórios: o identificador do chamado
            (<code>ticket_id</code> no OStick, <code>ID</code> no Bitrix24) e o assunto.
          </li>
          <li>
            <strong>HTTP Request</strong> — <code>POST</code> para a URL acima, com os headers{' '}
            <code>X-Webhook-Secret</code> (o segredo gerado) e <code>X-Empresa-Id</code> (
            {empresa?.id ?? '—'}).
          </li>
          <li>
            <strong>Retry</strong> — 3 tentativas com espera crescente em falha de rede ou 5xx. Reentregar o
            mesmo chamado não duplica: a chave é (sistema de origem, identificador externo).
          </li>
          <li>
            <strong>Monitoração</strong> — <code>GET {baseDaUrl}/api/health</code> responde sem autenticação e
            diz se o SaaS está de pé.
          </li>
        </ol>
      </Cartao>

      <Cartao
        titulo="Log de eventos"
        descricao={
          eventos.dados
            ? `${eventos.dados.resumo.processed} processado(s) · ${eventos.dados.resumo.error} com erro`
            : undefined
        }
      >
        <div className="filtros">
          <Campo rotulo="Sistema">
            <SeletorMulti
              rotulo="Sistema"
              itens={[
                { valor: 'OSTICK', rotulo: 'Sistema OStick' },
                { valor: 'BITRIX24', rotulo: 'Sistema Bitrix24' },
              ]}
              selecionados={sistemas}
              aoMudar={setSistemas}
            />
          </Campo>
          <Campo rotulo="Situação">
            <SeletorMulti
              rotulo="Situação"
              itens={[
                { valor: 'received', rotulo: 'Recebido' },
                { valor: 'processed', rotulo: 'Processado' },
                { valor: 'error', rotulo: 'Com erro' },
              ]}
              selecionados={status}
              aoMudar={setStatus}
            />
          </Campo>
          <Campo rotulo="De">
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </Campo>
          <Campo rotulo="Até">
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </Campo>
        </div>

        {eventos.erro && <Aviso tipo="erro">{eventos.erro}</Aviso>}
        {!eventos.dados ? (
          <Carregando />
        ) : eventos.dados.itens.length === 0 ? (
          <p className="vazio">
            Nenhum evento no recorte. Use <strong>Enviar payload de teste</strong> para validar o fluxo ponta a
            ponta sem depender do N8N.
          </p>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Sistema</th>
                  <th>Chamado</th>
                  <th>Tipo</th>
                  <th>Situação</th>
                  <th>Erro</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {eventos.dados.itens.map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{dataHora(e.criado_em)}</td>
                    <td>{ROTULO[e.source_system]}</td>
                    <td>
                      {e.external_id ?? '—'}
                      {e.teste && <Etiqueta texto="teste" />}
                    </td>
                    <td>{e.tipo}</td>
                    <td>
                      <Etiqueta
                        texto={ROTULO_STATUS[e.status]}
                        tom={e.status === 'processed' ? 'bom' : e.status === 'error' ? 'critico' : 'neutro'}
                      />
                    </td>
                    <td className="texto">{e.erro ?? '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="botao discreto pequeno" onClick={() => setPayloadAberto(e)}>
                        Payload
                      </button>
                      {e.status === 'error' && podeEditar && (
                        <button
                          type="button"
                          className="botao discreto pequeno"
                          onClick={() =>
                            acao(
                              () => api.post(`/api/integracoes/eventos/${e.id}/reprocessar`, {}),
                              `Evento ${e.id} reprocessado.`,
                            )
                          }
                        >
                          Reprocessar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      {payloadAberto && (
        <Modal
          titulo={`Payload — evento ${payloadAberto.id}`}
          aberto
          aoFechar={() => setPayloadAberto(null)}
          tipo="payload"
          acoes={
            <button type="button" className="botao" onClick={() => setPayloadAberto(null)}>
              Fechar
            </button>
          }
        >
          <p className="vazio" style={{ padding: 0, textAlign: 'left' }}>
            O payload como chegou da origem. É a partir dele que o reprocessamento refaz o caminho, sem depender
            de a origem reenviar.
          </p>
          <pre
            style={{
              background: 'var(--superficie-2)', padding: 12, borderRadius: 8,
              overflow: 'auto', fontSize: 12, margin: 0,
            }}
          >
            {JSON.stringify(payloadAberto.payload, null, 2)}
          </pre>
        </Modal>
      )}
    </>
  );
}
