/**
 * FERIADOS — os dias em que o relógio do SLA não corre.
 *
 * Prazo de SLA não corre em horas de relógio: corre dentro do expediente. Um
 * chamado aberto na sexta às 17h30 com 4 horas de prazo vence na segunda de
 * manhã, e medi-lo em horas corridas reprovaria a equipe pelo fim de semana.
 * Esta tela é o calendário dessa conta.
 *
 * O cadastro é do CLIENTE, e não da unidade: feriado municipal de uma filial
 * não tira o expediente da matriz em outro estado, mas uma lista por unidade
 * multiplicaria por dezessete algo que é quase sempre igual. Quem precisa de
 * um feriado local o inclui com a descrição dizendo de onde é.
 */
import { useState } from 'react';
import { Aviso, Carregando, Cartao, Etiqueta, Modal } from '../components/base';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { inteiro } from '../lib/formato';

interface Feriado {
  id: number;
  data: string;
  descricao: string;
  ativo: boolean;
  dia_da_semana: number;
  /** Sábado ou domingo: o feriado não tira hora útil nenhuma. */
  sem_efeito: boolean;
}

/** `AAAA-MM-DD` → `DD/MM/AAAA`. */
const diaExib = (iso: string) => (iso && iso.length >= 10
  ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
  : '—');

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira',
  'sexta-feira', 'sábado'];

/**
 * O dia da semana de uma data em AAAA-MM-DD.
 *
 * Montado com `new Date(ano, mês, dia)`, e nunca com `new Date('2026-12-25')`:
 * a segunda forma é lida como UTC, e no Brasil cairia no dia anterior — um
 * feriado de quinta apareceria como quarta.
 */
const diaDaSemana = (iso: string) => (iso && iso.length >= 10
  ? new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay()
  : -1);

const nomeDoDia = (iso: string) => DIAS[diaDaSemana(iso)] ?? '—';

const hojeISO = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function PaginaFeriados() {
  const { cliente, pode } = useSessao();
  const podeEditar = pode('configuracoes', 'edit');
  const consulta = useDados<Feriado[]>(() => api.get('/api/feriados'), [cliente]);

  const [emEdicao, setEmEdicao] = useState<Feriado | null>(null);
  const [criando, setCriando] = useState(false);
  const [data, setData] = useState('');
  const [descricao, setDescricao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const abrirNovo = () => {
    setEmEdicao(null); setData(''); setDescricao(''); setErro(null); setCriando(true);
  };
  const abrirEdicao = (f: Feriado) => {
    setEmEdicao(f); setData(f.data); setDescricao(f.descricao); setErro(null); setCriando(true);
  };

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      if (emEdicao) await api.patch(`/api/feriados/${emEdicao.id}`, { data, descricao });
      else await api.post('/api/feriados', { data, descricao });
      setCriando(false);
      consulta.recarregar();
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Não foi possível gravar o feriado.');
    } finally {
      setSalvando(false);
    }
  };

  const alternar = async (f: Feriado) => {
    try {
      await api.patch(`/api/feriados/${f.id}`, { ativo: !f.ativo });
      consulta.recarregar();
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Não foi possível mudar o feriado.');
    }
  };

  if (consulta.erro) return <Aviso tipo="erro">{consulta.erro}</Aviso>;
  if (!consulta.dados) return <Carregando />;

  const lista = consulta.dados;
  const hoje = hojeISO();
  const futuros = lista.filter((f) => f.data >= hoje);
  const contando = lista.filter((f) => f.ativo).length;

  return (
    <>
      <Aviso tipo="info">
        <strong>O relógio do SLA não corre em horas de relógio: corre dentro do expediente.</strong>{' '}
        Segunda a quinta das <strong>08:00 às 18:00</strong>, sexta das{' '}
        <strong>08:00 às 17:00</strong>. Fim de semana e os feriados desta lista não contam — um
        chamado aberto na sexta às 17h30 com 4 horas de prazo vence na segunda de manhã.
      </Aviso>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Cartao
        titulo="Feriados"
        descricao={`${inteiro(lista.length)} cadastrado(s) · ${inteiro(contando)} contando · ${
          inteiro(futuros.length)} ainda por vir`}
        padraoAberto
        acoes={podeEditar ? (
          <button type="button" className="botao primario" onClick={abrirNovo}>
            Novo feriado
          </button>
        ) : undefined}
      >
        {lista.length === 0 ? (
          <p className="vazio">
            Nenhum feriado cadastrado — só os fins de semana saem do cálculo.
          </p>
        ) : (
          <div className="tabela-envolucro">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Dia</th>
                  <th>Descrição</th>
                  <th>Situação</th>
                  {podeEditar && <th aria-label="Ações" />}
                </tr>
              </thead>
              <tbody>
                {lista.map((f) => (
                  <tr key={f.id} className={f.data < hoje ? 'passado' : undefined}>
                    <td><strong>{diaExib(f.data)}</strong></td>
                    <td>
                      {nomeDoDia(f.data)}
                      {f.sem_efeito && (
                        <span className="arv-comp" style={{ display: 'block' }}>
                          não tira hora útil
                        </span>
                      )}
                    </td>
                    <td>{f.descricao || '—'}</td>
                    <td>
                      <Etiqueta
                        texto={f.ativo ? 'Conta como feriado' : 'Desconsiderado'}
                        tom={f.ativo ? 'bom' : 'neutro'}
                      />
                    </td>
                    {podeEditar && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button type="button" className="botao" onClick={() => abrirEdicao(f)}>
                          Editar
                        </button>{' '}
                        <button type="button" className="botao" onClick={() => void alternar(f)}>
                          {f.ativo ? 'Desconsiderar' : 'Reativar'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="nota">
          Um feriado <strong>desconsiderado</strong> continua na lista mas volta a contar como dia
          útil — é como se corrige um cadastro errado sem apagar o registro de que ele existiu. Um
          prazo medido ontem saiu da lista de ontem, e apagar a linha tornaria aquele cálculo
          inexplicável.
        </p>
      </Cartao>

      <Modal
        titulo={emEdicao ? 'Editar feriado' : 'Novo feriado'}
        aberto={criando}
        aoFechar={() => setCriando(false)}
        tipo="feriado"
        acoes={(
          <>
            <button type="button" className="botao" onClick={() => setCriando(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="botao primario"
              disabled={salvando || !data || !descricao.trim()}
              onClick={() => void salvar()}
            >
              {salvando ? 'Gravando…' : 'Gravar'}
            </button>
          </>
        )}
      >
        <div className="campo">
          <label htmlFor="feriado-data">Data</label>
          <input
            id="feriado-data"
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
          {data && (
            <span className="dica-filtro">
              {nomeDoDia(data)}
              {/* Sábado e domingo já valem zero hora útil. Sem o aviso alguém
                  cadastraria o feriado esperando um efeito que não vem, e
                  depois culparia o cálculo. */}
              {[0, 6].includes(diaDaSemana(data))
                && ' — cai em fim de semana, e não tira hora útil nenhuma'}
            </span>
          )}
        </div>
        <div className="campo">
          <label htmlFor="feriado-descricao">Descrição</label>
          <input
            id="feriado-descricao"
            type="text"
            value={descricao}
            placeholder="Natal, Aniversário da cidade (Recife)…"
            onChange={(e) => setDescricao(e.target.value)}
          />
          <span className="dica-filtro">
            Obrigatória: sem ela ninguém sabe, meses depois, por que o dia saiu do cálculo.
            Feriado local, diga de onde é — a lista vale para o contratante inteiro.
          </span>
        </div>
      </Modal>
    </>
  );
}
