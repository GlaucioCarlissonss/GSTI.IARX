/**
 * A VISÃO MACRO — a virada de sistema de cada unidade.
 *
 * O indicador de tarefas responde "quanto do trabalho saiu no prazo". Esta
 * visão responde outra coisa, e é a que vai à diretoria: **a unidade virou no
 * dia combinado?**. As duas moram no mesmo módulo porque são do mesmo
 * programa, mas separadas, porque soltas lado a lado a tela não diria qual
 * pergunta cada número responde.
 *
 * O cronograma vem do servidor (`/api/indicadores/cronograma`), que o guarda
 * como código revisado e não como cadastro — é o mesmo que o artifact carrega
 * em `SPIN_ONDAS`. A tela não o recalcula nem o completa: o que ela não
 * recebe, ela diz que não sabe.
 *
 * A ENTREGA DA ONDA É UMA META. O alvo são TODAS as unidades planejadas dela,
 * e o resultado é quantas viraram. A onda que ainda não venceu aparece sem
 * resultado, e não com zero: zero afirmaria um fracasso que ninguém mediu.
 */
import { useState } from 'react';
import { Aviso, Cartao, Etiqueta } from './base';
import { api } from '../lib/api';
import { useDados } from '../lib/sessao';
import { inteiro, percentual } from '../lib/formato';

type Estado = 'CUMPRIDO' | 'NÃO CUMPRIDO' | 'PENDENTE';

interface UnidadeDaVirada {
  nome: string;
  onda: number;
  prazo: string;
  realizada: string | null;
  virou: boolean;
  estado: Estado;
}

interface OndaDoCronograma {
  onda: number;
  go_live: string;
  mes: string;
  unidades: string[];
  virada_realizada: string | null;
  planejadas: number;
  viradas: number;
  resultado: number | null;
  meta: number;
  venceu: boolean;
  estado: Estado;
  detalhe: UnidadeDaVirada[];
}

interface RespostaCronograma {
  competencia: string;
  pacientes: number;
  unidades: number;
  pacientes_por_onda_conhecido: boolean;
  ondas: OndaDoCronograma[];
}

const TOM: Record<Estado, 'bom' | 'critico' | 'neutro'> = {
  'CUMPRIDO': 'bom', 'NÃO CUMPRIDO': 'critico', 'PENDENTE': 'neutro',
};

/** `AAAA-MM-DD` → `DD/MM/AAAA`. */
const diaExib = (iso: string | null | undefined) => (iso && iso.length >= 10
  ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
  : '—');

export function VisaoMacro() {
  const consulta = useDados<RespostaCronograma>(() => api.get('/api/indicadores/cronograma'), []);
  const [abertas, setAbertas] = useState<Set<number>>(new Set());

  const alternar = (n: number) => setAbertas((atual) => {
    const proximo = new Set(atual);
    if (proximo.has(n)) proximo.delete(n); else proximo.add(n);
    return proximo;
  });

  if (consulta.erro) {
    return (
      <Cartao titulo="Visão Macro — Virada de Sistema" descricao="a unidade virou no dia planejado?">
        <Aviso tipo="erro">{consulta.erro}</Aviso>
      </Cartao>
    );
  }
  if (!consulta.dados) {
    return (
      <Cartao titulo="Visão Macro — Virada de Sistema" descricao="a unidade virou no dia planejado?">
        <p className="vazio">Carregando o cronograma…</p>
      </Cartao>
    );
  }
  const c = consulta.dados;

  return (
    <Cartao
      titulo="Visão Macro — Virada de Sistema"
      descricao="a unidade virou no dia planejado?"
      padraoAberto
    >
      <div className="grade c3">
        <div className="cartao">
          <div className="indicador">
            <span className="rotulo">Total de pacientes</span>
            <span className="numero">{inteiro(c.pacientes)}</span>
            <span className="apoio">
              nas {inteiro(c.unidades)} unidades do cronograma
              {c.pacientes_por_onda_conhecido ? '' : ' · a divisão por onda não veio no plano'}
            </span>
          </div>
        </div>
        <div className="cartao">
          <div className="indicador">
            <span className="rotulo">Unidades a migrar</span>
            <span className="numero">{inteiro(c.unidades)}</span>
            <span className="apoio">em {inteiro(c.ondas.length)} ondas</span>
          </div>
        </div>
        <div className="cartao">
          <div className="indicador">
            <span className="rotulo">Já em produção</span>
            <span className="numero">
              {inteiro(c.ondas.reduce((s, o) => s + o.viradas, 0))}
            </span>
            <span className="apoio">unidades com virada registrada</span>
          </div>
        </div>
      </div>

      <div className="tabela-envolucro">
        <table>
          <thead>
            <tr>
              <th>Onda</th>
              <th>Go-live</th>
              <th>Unidades a migrar</th>
              <th className="num">Entregas</th>
              <th className="num">Atingimento</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {c.ondas.map((o) => (
              <FragmentoDaOnda
                key={o.onda}
                onda={o}
                aberta={abertas.has(o.onda)}
                aoAlternar={() => alternar(o.onda)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="nota">
        <strong>A entrega da onda é uma meta:</strong> o alvo são <strong>todas</strong> as
        unidades planejadas dela, e o resultado é quantas viraram. A onda que ainda não venceu
        aparece sem resultado, e não com zero — zero afirmaria um fracasso que ninguém mediu.{' '}
        <strong>Tarefa pendente não muda esta resposta</strong>: uma unidade pode entrar em
        produção com pendências, e o que falta está na visão de execução, abaixo.
      </p>
    </Cartao>
  );
}

function FragmentoDaOnda({
  onda, aberta, aoAlternar,
}: {
  onda: OndaDoCronograma;
  aberta: boolean;
  aoAlternar: () => void;
}) {
  // Um id por LINHA, e `aria-controls` listando todos: repetir o mesmo id em
  // cada unidade seria HTML inválido, e o leitor de tela seguiria só o
  // primeiro — anunciando que o botão controla uma linha quando controla três.
  const idDaLinha = (i: number) => `crono-onda-${onda.onda}-u${i}`;
  const controla = onda.detalhe.map((_, i) => idDaLinha(i)).join(' ');
  return (
    <>
      <tr>
        <td>
          <button
            type="button"
            className="arv-abrir"
            aria-expanded={aberta}
            aria-controls={controla}
            aria-label={`${aberta ? 'Fechar' : 'Abrir'} as unidades da ${onda.onda}ª onda`}
            onClick={aoAlternar}
          >
            {aberta ? '−' : '+'}
          </button>{' '}
          <strong>{onda.onda}ª onda</strong>
          <div className="arv-comp">{inteiro(onda.unidades.length)} unidade(s)</div>
        </td>
        {/* O DIA, e não o mês: o plano publica a virada em data exata, e
            "virada em 11/2026" esconderia que a 2ª onda vira no dia 3. O mês
            fica como apoio, para situar quem lê por período. */}
        <td>
          <strong>{diaExib(onda.go_live)}</strong>
          <div className="arv-comp">{onda.mes}</div>
        </td>
        <td>{onda.unidades.join(' · ')}</td>
        <td className="num">
          <strong>{inteiro(onda.viradas)}</strong> de {inteiro(onda.planejadas)}
          <div className="arv-comp">unidade(s) virada(s)</div>
        </td>
        <td className="num">
          {onda.resultado === null ? (
            <span className="vazio">ainda não vence</span>
          ) : (
            <>
              <strong>{percentual(onda.resultado)}</strong>
              <div className="arv-comp">meta {percentual(onda.meta)}</div>
            </>
          )}
        </td>
        <td><Etiqueta texto={onda.estado} tom={TOM[onda.estado]} /></td>
      </tr>
      {/* As linhas existem SEMPRE, escondidas quando a onda está fechada: o
          `aria-controls` do botão precisa apontar para algo que exista, e
          desmontá-las deixaria a promessa apontando para o vazio. */}
      {onda.detalhe.map((u, i) => (
        // A LINHA DA UNIDADE FALA SÓ DE VIRADA. Contagem de atividade misturaria
        // as duas perguntas que esta tela existe para separar.
        <tr key={u.nome} id={idDaLinha(i)} hidden={!aberta}>
          <td style={{ paddingLeft: 34 }}>{u.nome}</td>
          <td>
            {diaExib(u.prazo)}
            <div className="arv-comp">
              {u.realizada ? `realizada ${diaExib(u.realizada)}` : 'sem virada registrada'}
            </div>
          </td>
          <td />
          <td className="num">
            {u.virou ? <strong>virou</strong>
              : (onda.venceu ? <span className="res-falhou">não virou</span>
                : <span className="vazio">aguarda</span>)}
          </td>
          <td className="num" />
          <td><Etiqueta texto={u.estado} tom={TOM[u.estado]} /></td>
        </tr>
      ))}
    </>
  );
}
