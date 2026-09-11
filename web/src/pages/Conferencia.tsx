import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useDados, useSessao } from '../lib/sessao';
import { Aviso, Carregando, Cartao, Etiqueta } from '../components/base';
import { GraficoBarras, Indicador } from '../components/graficos';
import { inteiro, mesCurto, moeda, moedaCurta, percentual } from '../lib/formato';

/**
 * De onde vem cada real que o sistema mostra.
 *
 * O total do sistema não é o total das planilhas enviadas: sobre as linhas
 * importadas somam-se a folha de TI rateada e a projeção do novo ERP, que não
 * existiam como linha de despesa. Esta tela decompõe a diferença para que ela
 * possa ser conferida parcela por parcela, e não apenas contestada.
 */
interface Conferencia {
  cenario: string;
  base_enviada: number;
  acrescentado: number;
  total: number;
  peso_do_acrescimo: number;
  por_origem: Array<{
    origem: string;
    rotulo: string;
    lancamentos: number;
    valor: number;
    percentual: number;
    competencia_inicio: string | null;
    competencia_fim: string | null;
  }>;
  por_competencia: Array<Record<string, number | string> & { competencia: string; total: number }>;
}

const COR_ORIGEM: Record<string, string> = {
  planilha: 'var(--serie-1)',
  folha_ti: 'var(--serie-2)',
  projecao_spincare: 'var(--serie-3)',
  manual: 'var(--tinta-fraca)',
};
const NOTA_ORIGEM: Record<string, string> = {
  planilha: 'Linha importada das bases enviadas pelo gestor, sem alteração de valor.',
  folha_ti: 'Custo de pessoal de TI alocado ou rateado — não constava como linha nas planilhas de despesa.',
  projecao_spincare: 'Mensalidade projetada do novo ERP; ainda não realizada.',
  manual: 'Criado ou editado por um usuário aqui dentro.',
};
const CURTO_ORIGEM: Record<string, string> = {
  planilha: 'Planilha',
  folha_ti: 'Folha',
  projecao_spincare: 'Projeção',
  manual: 'Manual',
};

export function PaginaConferencia() {
  const { empresa } = useSessao();
  const consulta = useDados<Conferencia>(() => api.get('/api/dashboards/conferencia'), [empresa?.id]);

  if (consulta.erro) return <Aviso tipo="erro">{consulta.erro}</Aviso>;
  if (!consulta.dados) return <Carregando />;
  const c = consulta.dados;

  const usadas = c.por_origem.filter((o) => o.lancamentos > 0);
  const series = usadas.map((o) => ({ chave: o.origem, nome: CURTO_ORIGEM[o.origem] ?? o.rotulo, cor: COR_ORIGEM[o.origem]! }));
  const pontos = c.por_competencia.map((m) => ({
    rotulo: mesCurto(m.competencia),
    valores: Object.fromEntries(usadas.map((o) => [o.origem, Number(m[o.origem] ?? 0)])),
  }));

  return (
    <>
      <Aviso tipo="info">
        <strong>Por que o total do sistema difere da sua planilha.</strong> As linhas que você enviou entram
        sem alteração de valor; sobre elas o sistema soma duas coisas que não existiam como linha de despesa:
        o <strong>rateio da folha de TI</strong> e a <strong>projeção do novo ERP</strong>. Aqui cada parcela
        aparece separada, para conferir e decidir o que entra no número oficial.
      </Aviso>

      <div className="grade c4">
        <Indicador
          rotulo="Base enviada por você"
          valor={moeda(c.base_enviada)}
          apoio={`${inteiro(c.por_origem.find((o) => o.origem === 'planilha')?.lancamentos ?? 0)} linhas das planilhas`}
        />
        <Indicador rotulo="Acrescentado pelo sistema" valor={moeda(c.acrescentado)} apoio="folha rateada + projeção" />
        <Indicador rotulo="Total exibido nos painéis" valor={moeda(c.total)} apoio={`cenário ${c.cenario}`} />
        <Indicador rotulo="Peso do acréscimo" valor={percentual(c.peso_do_acrescimo)} apoio="do total consolidado" />
      </div>

      <Cartao titulo="Composição por origem" descricao={`Cenário ${c.cenario}, consolidado da empresa.`}>
        <div className="tabela-envolucro">
          <table>
            <thead>
              <tr>
                <th>Origem</th>
                <th>O que é</th>
                <th className="num">Lançamentos</th>
                <th className="num">Valor</th>
                <th className="num">% do total</th>
                <th>Período</th>
              </tr>
            </thead>
            <tbody>
              {c.por_origem.map((o) => (
                <tr key={o.origem} style={o.lancamentos ? undefined : { opacity: 0.45 }}>
                  <td>
                    <Etiqueta texto={o.rotulo} cor={COR_ORIGEM[o.origem]} />
                  </td>
                  <td style={{ maxWidth: 360, fontSize: 12, color: 'var(--tinta-fraca)' }}>{NOTA_ORIGEM[o.origem]}</td>
                  <td className="num">{inteiro(o.lancamentos)}</td>
                  <td className="num">{o.lancamentos ? moeda(o.valor) : '—'}</td>
                  <td className="num">{o.lancamentos ? percentual(o.percentual) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {o.competencia_inicio ? `${o.competencia_inicio} a ${o.competencia_fim}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                <td className="num">{inteiro(c.por_origem.reduce((s, o) => s + o.lancamentos, 0))}</td>
                <td className="num">{moeda(c.total)}</td>
                <td className="num">100,0%</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Cartao>

      <Cartao titulo="Mês a mês, por origem" descricao={`${inteiro(c.por_competencia.length)} competências.`}>
        <GraficoBarras dados={pontos} series={series} formatar={moeda} formatarEixo={moedaCurta} modo="empilhado" />
      </Cartao>

      <Aviso tipo="info">
        Discorda de alguma dessas parcelas? Em <Link to="/lancamentos">Lançamentos</Link> cada linha traz sua
        origem e pode ser editada ou excluída — toda alteração fica na trilha de auditoria.
      </Aviso>
    </>
  );
}
