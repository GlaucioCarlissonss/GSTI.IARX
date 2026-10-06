/**
 * A barra de filtros de uma tela.
 *
 * Duas coisas moram aqui e as duas são regra do sistema.
 *
 * A primeira: o recorte é LOCAL. Estes campos valem nesta tela e em mais
 * nenhuma — mexer no período do Financeiro não pode recortar Projetos, e a
 * tela de Integrações não pode depender de um seletor de empresa.
 *
 * A segunda: todo filtro DIZ o que faz. "Empresa" sozinho não informa se
 * recorta os gráficos, a tabela ou os dois, nem o que acontece ao deixar vazio.
 * Cada campo abaixo leva uma linha de apoio com o que filtra, sobre quais dados
 * atua e o efeito esperado — em linguagem de quem usa, não de quem programou.
 */
import type { ReactNode } from 'react';
import { FichasSelecao, SeletorMulti, type ItemSelecao } from './seletor-multi';

/**
 * Textos de apoio dos filtros que se repetem no sistema.
 *
 * Ficam num lugar só porque a mesma pergunta aparece em sete telas, e sete
 * respostas ligeiramente diferentes ensinariam sete regras diferentes.
 */
export const EXPLICACAO = {
  empresa:
    'Escolhe as empresas (matrizes) deste cliente que entram na tela. Vazio traz todas as unidades juntas.',
  filial:
    'Restringe aos registros vinculados às filiais escolhidas. "Sem filial" traz o que foi lançado no nível da matriz.',
  periodo:
    'Filtra pelo mês/ano de competência (MM/AAAA). Afeta os gráficos e as tabelas desta tela.',
  competenciaIntervalo:
    'Intervalo de competência (MM/AAAA). Vazio traz todo o histórico disponível.',
  setor: 'Filtra os chamados pelo setor de origem registrado no sistema de suporte.',
  sistema:
    'Mostra apenas os chamados vindos do sistema escolhido (OStick ou Bitrix24). Vazio traz os dois.',
  status: 'Filtra pela situação atual do registro. Vazio traz todas as situações.',
  cenario:
    'Cenário de projeção financeira. "Oficial" é a projeção vigente; os demais convivem sem entrar nos totais oficiais.',
  tipoDespesa:
    'Filtra pelo tipo de despesa (centro de custo). Vazio soma todos os tipos.',
  origem:
    'Procedência do dado: planilha do cliente, folha de TI rateada, projeção ou lançado no sistema.',
  reconhecido:
    'Separa o que o gestor já conferiu do que falta conferir. Vazio traz os dois, que é o total de verdade.',
  busca: 'Procura no texto dos registros desta tela. Some com os demais filtros, não os substitui.',
} as const;

export function Filtro({
  rotulo,
  explicacao,
  children,
  largura,
}: {
  rotulo: string;
  /** O que filtra, sobre quais dados atua e o efeito esperado. */
  explicacao: string;
  children: ReactNode;
  largura?: number;
}) {
  return (
    <div className="campo filtro" style={largura ? { width: largura } : undefined}>
      <label title={explicacao}>{rotulo}</label>
      {children}
      <small className="dica-filtro">{explicacao}</small>
    </div>
  );
}

export interface UnidadeSelecionavel {
  id: number;
  nome: string;
}

/**
 * Matriz e filial, o par que quase toda tela recorta.
 *
 * Vazio significa o cliente inteiro — e isso está escrito, porque um seletor
 * vazio que traz tudo é exatamente o que confunde quem chega.
 */
export function FiltroUnidades({
  empresas,
  empresasSel,
  aoMudarEmpresas,
  filiais,
  filiaisSel,
  aoMudarFiliais,
  aoLimpar,
}: {
  empresas: UnidadeSelecionavel[];
  empresasSel: number[];
  aoMudarEmpresas: (v: number[]) => void;
  filiais?: Array<{ id: number; nome: string; uf?: string | null }>;
  filiaisSel?: Array<number | 'nenhuma'>;
  aoMudarFiliais?: (v: Array<number | 'nenhuma'>) => void;
  aoLimpar?: () => void;
}) {
  const itensEmpresa: ItemSelecao[] = empresas.map((e) => ({ valor: String(e.id), rotulo: e.nome }));
  const itensFilial: ItemSelecao[] = [
    { valor: 'nenhuma', rotulo: 'Sem filial (matriz)' },
    ...(filiais ?? []).map((f) => ({ valor: String(f.id), rotulo: f.uf ? `${f.nome} — ${f.uf}` : f.nome })),
  ];

  return (
    <>
      {/* Com uma matriz só, o seletor não teria escolha a oferecer: o cliente
          inteiro E a única unidade são a mesma coisa. */}
      {empresas.length > 1 && (
        <Filtro rotulo="Empresa (matriz)" explicacao={EXPLICACAO.empresa}>
          <SeletorMulti
            rotulo="Empresa (matriz)"
            largura={210}
            itens={itensEmpresa}
            selecionados={empresasSel.map(String)}
            aoMudar={(v) => aoMudarEmpresas(v.map(Number))}
          />
        </Filtro>
      )}

      {aoMudarFiliais && (
        <Filtro rotulo="Filial" explicacao={EXPLICACAO.filial}>
          <SeletorMulti
            rotulo="Filial"
            largura={200}
            itens={itensFilial}
            selecionados={(filiaisSel ?? []).map(String)}
            aoMudar={(v) => aoMudarFiliais(v.map((x) => (x === 'nenhuma' ? 'nenhuma' : Number(x))))}
          />
        </Filtro>
      )}

      {aoLimpar && (empresasSel.length > 0 || (filiaisSel?.length ?? 0) > 0) && (
        <button type="button" className="botao discreto pequeno" onClick={aoLimpar}>
          Limpar filtros
        </button>
      )}
    </>
  );
}

/** As fichas do que está marcado, abaixo da barra. */
export function FichasUnidades({
  empresas,
  empresasSel,
  aoMudarEmpresas,
  filiais,
  filiaisSel,
  aoMudarFiliais,
}: {
  empresas: UnidadeSelecionavel[];
  empresasSel: number[];
  aoMudarEmpresas: (v: number[]) => void;
  filiais?: Array<{ id: number; nome: string; uf?: string | null }>;
  filiaisSel?: Array<number | 'nenhuma'>;
  aoMudarFiliais?: (v: Array<number | 'nenhuma'>) => void;
}) {
  const grupos = [
    {
      chave: 'empresa',
      rotulo: 'Empresa',
      itens: empresas.map((e) => ({ valor: String(e.id), rotulo: e.nome })),
      selecionados: empresasSel.map(String),
      aoMudar: (v: string[]) => aoMudarEmpresas(v.map(Number)),
    },
    ...(aoMudarFiliais
      ? [
          {
            chave: 'filial',
            rotulo: 'Filial',
            itens: [
              { valor: 'nenhuma', rotulo: 'Sem filial (matriz)' },
              ...(filiais ?? []).map((f) => ({
                valor: String(f.id),
                rotulo: f.uf ? `${f.nome} — ${f.uf}` : f.nome,
              })),
            ],
            selecionados: (filiaisSel ?? []).map(String),
            aoMudar: (v: string[]) =>
              aoMudarFiliais(v.map((x) => (x === 'nenhuma' ? 'nenhuma' : Number(x)))),
          },
        ]
      : []),
  ];
  return <FichasSelecao grupos={grupos} />;
}

/**
 * A unidade EM FOCO — para as telas que operam sobre uma só.
 *
 * Cadastro, fechamento de competência, acessos, exportação e carga não são
 * consultas: cada uma escreve ou lê os dados de UMA matriz, e um recorte
 * múltiplo não teria significado ali. Antes essa escolha vinha do seletor
 * global do topo; agora ela é da tela, e diz na própria etiqueta o que governa.
 */
export function SeletorUnidadeFoco({
  empresas,
  empresaId,
  aoTrocar,
  explicacao,
}: {
  empresas: UnidadeSelecionavel[];
  empresaId: number | null;
  aoTrocar: (id: number) => void;
  /** O que esta escolha governa nesta tela. */
  explicacao: string;
}) {
  // Com uma unidade só não há escolha a fazer: o seletor seria um campo com uma
  // opção, e a frase abaixo dele já diz de quem são os dados.
  if (empresas.length <= 1) {
    return empresas.length === 1 ? (
      <p className="dica-filtro" style={{ margin: '0 0 8px' }}>
        Unidade: <strong>{empresas[0]!.nome}</strong>. {explicacao}
      </p>
    ) : null;
  }
  return (
    <Filtro rotulo="Unidade em foco" explicacao={explicacao}>
      <select
        aria-label="Unidade em foco"
        value={empresaId ?? ''}
        onChange={(e) => aoTrocar(Number(e.target.value))}
      >
        {empresas.map((e) => (
          <option key={e.id} value={e.id}>
            {e.nome}
          </option>
        ))}
      </select>
    </Filtro>
  );
}
