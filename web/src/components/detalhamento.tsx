/**
 * Detalhamento — o drill-down padrão de todo gráfico e todo indicador.
 *
 * Um número numa tela é sempre a soma de registros. Clicar nele abre esses
 * registros, com o MESMO recorte que produziu o número — é essa a garantia que
 * faz o detalhamento valer: se viesse de outra consulta, poderia divergir do
 * que está na tela, e o gestor não teria como saber qual dos dois está certo.
 *
 * Os dados vêm sob demanda: a tela só busca quando o detalhamento abre.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { Aviso, Carregando, Etiqueta, Modal } from './base';
import { inteiro, moeda, ROTULO_STATUS_PROJETO, ROTULO_STATUS_TAREFA } from '../lib/formato';

/** Coluna do detalhamento. `n` alinha à direita, para números. */
export interface ColunaDetalhe<T> {
  rotulo: string;
  valor: (linha: T) => ReactNode;
  n?: boolean;
}

export interface PedidoDetalhe<T = Record<string, unknown>> {
  /** O que está sendo detalhado — vira o título do modal. */
  titulo: string;
  /** Uma linha de contexto: o recorte, a ressalva, o que for necessário. */
  subtitulo?: string;
  /** Caminho e parâmetros da consulta. Buscada só quando o modal abre. */
  caminho: string;
  params?: Record<string, unknown>;
  /** Lê os registros da resposta (formatos variam por módulo). */
  extrair?: (resposta: unknown) => T[];
  /**
   * Quantos registros existem no recorte, quando a resposta é paginada e traz
   * menos linhas do que o total. Sem isto, uma lista cortada somaria menos que
   * o indicador e a tela acusaria uma divergência que não existe.
   */
  contarNaResposta?: (resposta: unknown) => number;
  /**
   * A soma do recorte inteiro, calculada pelo servidor. Só é necessária quando
   * a lista pode vir cortada: aí a soma das linhas visíveis não serve de
   * conferência, mas a do servidor sim.
   */
  somaNaResposta?: (resposta: unknown) => number;
  /** O número que estava na tela, para a conferência ficar explícita. */
  total?: number | null;
  /** Como somar cada registro, para conferir com o total. */
  somar?: (linha: T) => number;
  formatarTotal?: (v: number) => string;
  colunas: Array<ColunaDetalhe<T>>;
}

/** Teto de linhas exibidas. Acima disso a tela some antes de ajudar. */
const TETO = 300;

export function Detalhamento<T>({ pedido, aoFechar }: { pedido: PedidoDetalhe<T>; aoFechar: () => void }) {
  const [estado, setEstado] = useState<{ itens: T[]; total: number; soma: number | null } | { erro: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    setEstado(null);
    api
      .get<unknown>(pedido.caminho, pedido.params)
      .then((r) => {
        if (!vivo) return;
        const extrair = pedido.extrair ?? ((x: unknown) => (x as { itens?: T[] }).itens ?? (x as T[]));
        const itens = extrair(r) ?? [];
        setEstado({
          itens,
          total: pedido.contarNaResposta ? pedido.contarNaResposta(r) : itens.length,
          soma: pedido.somaNaResposta ? pedido.somaNaResposta(r) : null,
        });
      })
      .catch((e) => {
        if (vivo) setEstado({ erro: e instanceof Error ? e.message : 'Não foi possível carregar os registros.' });
      });
    return () => {
      vivo = false;
    };
  }, [pedido]);

  const itens = estado && 'itens' in estado ? estado.itens : [];
  const totalDeRegistros = estado && 'itens' in estado ? estado.total : 0;
  // A resposta veio cortada: a lista tem menos linhas do que o recorte inteiro.
  const cortada = totalDeRegistros > itens.length;
  const formatar = pedido.formatarTotal ?? ((v: number) => moeda(v));
  const somaDoServidor = estado && 'itens' in estado ? estado.soma : null;
  // Com a lista cortada, somar o que está à vista mediria a página, não o
  // recorte — a conferência então só vale com a soma vinda do servidor.
  const soma = cortada ? somaDoServidor : (pedido.somar ? itens.reduce((s, l) => s + pedido.somar!(l), 0) : somaDoServidor);
  const bate =
    pedido.total === null || pedido.total === undefined || soma === null ? null : Math.abs(soma - pedido.total) < 0.005;

  return (
    <Modal titulo={`Detalhamento — ${pedido.titulo}`} aberto aoFechar={aoFechar}>
      {pedido.subtitulo && <p className="vazio" style={{ padding: 0, textAlign: 'left' }}>{pedido.subtitulo}</p>}

      {estado === null ? (
        <Carregando />
      ) : 'erro' in estado ? (
        <Aviso tipo="erro">{estado.erro}</Aviso>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Etiqueta
              texto={
                cortada
                  ? `${inteiro(itens.length)} de ${inteiro(totalDeRegistros)} registro(s)`
                  : `${inteiro(itens.length)} registro(s)`
              }
            />
            {soma !== null && <Etiqueta texto={`Soma: ${formatar(soma)}`} />}
            {bate !== null && (
              <Etiqueta
                texto={bate ? 'confere com o indicador' : `diverge do indicador (${formatar(pedido.total!)})`}
                tom={bate ? 'bom' : 'critico'}
              />
            )}
          </div>

          {itens.length === 0 ? (
            <p className="vazio">Nenhum registro compõe este número no recorte atual.</p>
          ) : (
            <>
              <div className="tabela-envolucro" style={{ maxHeight: '52vh', overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      {pedido.colunas.map((c) => (
                        <th key={c.rotulo} className={c.n ? 'num' : undefined}>
                          {c.rotulo}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {itens.slice(0, TETO).map((l, i) => (
                      <tr key={i}>
                        {pedido.colunas.map((c) => (
                          <td key={c.rotulo} className={c.n ? 'num' : undefined}>
                            {c.valor(l) ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(itens.length > TETO || cortada) && (
                <p className="vazio" style={{ padding: 0, textAlign: 'left' }}>
                  Exibindo {inteiro(Math.min(itens.length, TETO))} de {inteiro(totalDeRegistros)} registro(s). Estreite o
                  recorte para ver o resto.
                </p>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}

/**
 * Envolve um indicador ou item de gráfico, tornando-o um gatilho de
 * drill-down: clicável, alcançável por teclado e anunciado como botão. Um
 * `div` com `onClick` não é nada disso.
 */
export function Detalhavel({
  rotulo,
  aoAbrir,
  children,
}: {
  rotulo: string;
  aoAbrir: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="drill"
      role="button"
      tabIndex={0}
      aria-label={`${rotulo} — abrir os registros que compõem este número`}
      onClick={aoAbrir}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          aoAbrir();
        }
      }}
    >
      {children}
    </div>
  );
}

// ------------------------------------------------- detalhamentos por domínio
//
// Cada um monta o pedido de um módulo. Os parâmetros vêm de quem chama, que é
// a tela que exibiu o número — é isso que mantém o recorte igual.

export function detalheDeLancamentos(
  titulo: string,
  params: Record<string, unknown>,
  total?: number | null,
  subtitulo?: string,
): PedidoDetalhe<Record<string, unknown>> {
  return {
    titulo,
    subtitulo,
    total,
    caminho: '/api/dashboards/relatorio/lancamentos',
    params,
    somar: (l) => Number(l.valor_centavos) / 100,
    colunas: [
      { rotulo: 'Competência', valor: (l) => String(l.competencia) },
      { rotulo: 'Filial', valor: (l) => String(l.filial_nome ?? 'Nível empresa') },
      { rotulo: 'Tipo', valor: (l) => String(l.tipo_despesa) },
      { rotulo: 'Descrição', valor: (l) => (l.descricao as string) ?? '—' },
      { rotulo: 'Origem do custo', valor: (l) => (l.origem_custo as string) ?? '—' },
      { rotulo: 'Destino', valor: (l) => (l.destino_pagamento as string) ?? '—' },
      { rotulo: 'Procedência', valor: (l) => String(l.origem_rotulo) },
      { rotulo: 'Valor', valor: (l) => moeda(Number(l.valor_centavos) / 100), n: true },
    ],
  };
}

/**
 * Registros de SLA — o que o painel de SLA conta. Cobre tanto o registro
 * agregado mensal quanto o chamado individual; `detalheDeChamados` abaixo é
 * do módulo de Suporte, restrito ao que veio de um helpdesk.
 */
export function detalheDeRegistrosSla(
  titulo: string,
  params: Record<string, unknown>,
  total?: number | null,
  subtitulo?: string,
): PedidoDetalhe<Record<string, unknown>> {
  return {
    titulo,
    subtitulo,
    total,
    caminho: '/api/sla',
    params,
    formatarTotal: inteiro,
    somar: (r) => Number(r.total_atendidos),
    colunas: [
      { rotulo: 'Competência', valor: (r) => String(r.competencia) },
      { rotulo: 'Filial', valor: (r) => (r.filial_nome as string) ?? 'Nível empresa' },
      { rotulo: 'Fila', valor: (r) => String(r.fila) },
      { rotulo: 'Tópico', valor: (r) => (r.topico_ajuda as string) ?? '—' },
      { rotulo: 'Chamado', valor: (r) => (r.ticket_id ? `#${r.numero ?? r.ticket_id}` : '—') },
      { rotulo: 'Assunto', valor: (r) => (r.assunto as string) ?? '—' },
      { rotulo: 'Atendidos', valor: (r) => inteiro(Number(r.total_atendidos)), n: true },
      { rotulo: 'Dentro', valor: (r) => inteiro(Number(r.dentro_sla)), n: true },
      { rotulo: 'Fora', valor: (r) => inteiro(Number(r.fora_sla)), n: true },
    ],
  };
}

export function detalheDeChamados(
  titulo: string,
  params: Record<string, unknown>,
  total?: number | null,
  subtitulo?: string,
): PedidoDetalhe<Record<string, unknown>> {
  return {
    titulo,
    subtitulo,
    total,
    caminho: '/api/suporte/chamados',
    params: { limite: 500, ...params },
    formatarTotal: inteiro,
    somar: () => 1,
    // A listagem é paginada; a contagem honesta é a do servidor, não a da
    // página que coube no modal.
    contarNaResposta: (r) => Number((r as { paginacao?: { total?: number } }).paginacao?.total ?? 0),
    somaNaResposta: (r) => Number((r as { paginacao?: { total?: number } }).paginacao?.total ?? 0),
    colunas: [
      { rotulo: 'Chamado', valor: (c) => `#${c.numero ?? c.external_id}` },
      { rotulo: 'Sistema', valor: (c) => (c.source_system === 'BITRIX24' ? 'Bitrix24' : 'OStick') },
      { rotulo: 'Setor', valor: (c) => (c.setor as string) ?? 'Não classificado' },
      { rotulo: 'Assunto', valor: (c) => (c.assunto as string) ?? '—' },
      { rotulo: 'Solicitante', valor: (c) => (c.solicitante as string) ?? '—' },
      { rotulo: 'Atendente', valor: (c) => (c.responsavel as string) ?? '—' },
      { rotulo: 'SLA', valor: (c) => (c.dentro_sla ? 'Dentro' : 'Fora') },
    ],
  };
}

/**
 * Projetos por trás de um indicador de contagem. Some 1 por projeto: o número
 * na tela é uma contagem, e é com ela que a conferência do modal tem de bater.
 */
export function detalheDeProjetos(
  titulo: string,
  params: Record<string, unknown>,
  total?: number | null,
  subtitulo?: string,
): PedidoDetalhe<Record<string, unknown>> {
  return {
    titulo,
    subtitulo,
    total,
    caminho: '/api/projetos',
    params,
    formatarTotal: inteiro,
    somar: () => 1,
    colunas: [
      { rotulo: 'Projeto', valor: (p) => String(p.nome) },
      { rotulo: 'Filial', valor: (p) => (p.filial_nome as string) ?? 'Nível empresa' },
      { rotulo: 'Situação', valor: (p) => ROTULO_STATUS_PROJETO[String(p.status)] ?? String(p.status) },
      { rotulo: 'Início', valor: (p) => String(p.mes_inicio) },
      { rotulo: 'Fim planejado', valor: (p) => String(p.mes_fim_planejado) },
      { rotulo: 'Fim real', valor: (p) => (p.mes_fim_real as string) ?? '—' },
      { rotulo: 'Tarefas', valor: (p) => `${inteiro(Number(p.tarefas_concluidas))}/${inteiro(Number(p.total_tarefas))}`, n: true },
      { rotulo: 'Atraso', valor: (p) => (p.atrasado ? `${inteiro(Number(p.meses_atraso))} mês(es)` : '—') },
    ],
  };
}

/** Tarefas por trás de um indicador ou de um item do ranking de carga. */
export function detalheDeTarefas(
  titulo: string,
  params: Record<string, unknown>,
  total?: number | null,
  subtitulo?: string,
): PedidoDetalhe<Record<string, unknown>> {
  return {
    titulo,
    subtitulo,
    total,
    caminho: '/api/projetos/tarefas',
    params,
    formatarTotal: inteiro,
    somar: () => 1,
    colunas: [
      { rotulo: 'Tarefa', valor: (t) => String(t.nome) },
      { rotulo: 'Projeto', valor: (t) => String(t.projeto_nome) },
      { rotulo: 'Filial', valor: (t) => (t.filial_nome as string) ?? 'Nível empresa' },
      { rotulo: 'Responsável', valor: (t) => (t.responsavel as string) || 'Não atribuído' },
      { rotulo: 'Situação', valor: (t) => ROTULO_STATUS_TAREFA[String(t.status)] ?? String(t.status) },
      { rotulo: 'Início', valor: (t) => String(t.mes_inicio) },
      { rotulo: 'Fim planejado', valor: (t) => String(t.mes_fim_planejado) },
      { rotulo: 'Fim real', valor: (t) => (t.mes_fim_real as string) ?? '—' },
      { rotulo: 'Atraso', valor: (t) => (t.atrasado ? `${inteiro(Number(t.meses_atraso))} mês(es)` : '—') },
    ],
  };
}
