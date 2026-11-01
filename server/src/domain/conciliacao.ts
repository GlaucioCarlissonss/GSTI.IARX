/**
 * Conciliação assistida: o que o arquivo diz × o que o cliente já tem cadastrado.
 *
 * A carga de setembro é o motivo deste arquivo existir. Cinco dos oito centros
 * de custo da base do cliente diferem do cadastro só por acento, espaço ou um
 * erro de digitação ("Serviços de Desencolvimento"). Importar sem conferir
 * criaria cinco cadastros duplicados e deixaria 95 das 110 despesas penduradas
 * neles — cada carga seguinte repetiria o estrago.
 *
 * O motor NÃO decide nada: ele classifica e sugere. Quem importa é que resolve
 * item por item, e nada é criado sem esse aval. É a diferença entre um
 * importador que ajuda e um que polui a base sozinho.
 */
import { db } from '../db/index.js';
import type { Contexto } from './contexto.js';
import type { LinhaFoc } from './carga-foc.js';

export type Situacao = 'IGUAL' | 'DIVERGENTE' | 'NOVO' | 'INVALIDO';

/** As dimensões que se conferem, na ordem em que a tela as mostra. */
export type Dimensao = 'centro_custo' | 'tipo' | 'grupo_gasto' | 'grupo' | 'unidade' | 'fornecedor';

/**
 * `permiteCriar` diz se um valor novo pode virar cadastro pela importação.
 *
 * Matriz e tipo ficam de fora de propósito. Matriz é decisão de estrutura do
 * contratante, não consequência de uma planilha; e o tipo (a natureza do
 * lançamento) é um vocabulário fechado do sistema, não um cadastro livre. Nos
 * dois casos, um nome desconhecido é sinal de arquivo errado — deixar criar
 * transformaria um engano de digitação em estrutura nova.
 */
export const DIMENSOES: Array<{ chave: Dimensao; rotulo: string; obrigatoria: boolean; permiteCriar: boolean }> = [
  { chave: 'centro_custo', rotulo: 'Centro de Custo', obrigatoria: true, permiteCriar: true },
  { chave: 'tipo', rotulo: 'Tipo', obrigatoria: true, permiteCriar: false },
  { chave: 'grupo_gasto', rotulo: 'Grupo de Gasto', obrigatoria: false, permiteCriar: true },
  { chave: 'grupo', rotulo: 'Grupo (matriz)', obrigatoria: true, permiteCriar: false },
  { chave: 'unidade', rotulo: 'Unidade (filial)', obrigatoria: true, permiteCriar: true },
  { chave: 'fornecedor', rotulo: 'Fornecedor', obrigatoria: false, permiteCriar: true },
];

export interface Candidato {
  id: number | null;
  nome: string;
}

export interface ItemConciliacao {
  /** O valor exatamente como veio no arquivo. */
  valor: string;
  situacao: Situacao;
  /** Quantas linhas do arquivo usam este valor — é o peso da decisão. */
  ocorrencias: number;
  /** Primeiras linhas onde aparece, para a tela conseguir apontar. */
  linhas: number[];
  /** O cadastro parecido, quando há. `null` em NOVO e INVALIDO. */
  sugestao: (Candidato & { confianca: number; motivo: 'grafia' | 'semelhanca' }) | null;
}

export interface BlocoConciliacao {
  dimensao: Dimensao;
  rotulo: string;
  obrigatoria: boolean;
  permiteCriar: boolean;
  itens: ItemConciliacao[];
  /** Quantos itens exigem decisão (DIVERGENTE ou NOVO). */
  pendentes: number;
  /** Candidatos do cadastro, para o vínculo manual na tela. */
  candidatos: Candidato[];
}

/**
 * Chave de comparação: sem acento, sem caixa e sem pontuação.
 *
 * É ela que faz "Licenças de Softwares" e "Licencas de Softwares" caírem no
 * mesmo lugar, e também "Telefonia/Internet" e "Telefonia / Internet" — as duas
 * diferenças mais comuns entre a base do cliente e o cadastro.
 */
export function chaveComparacao(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Distância de edição (Levenshtein), com duas linhas em vez da matriz toda. */
export function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(atual[j - 1]! + 1, anterior[j]! + 1, anterior[j - 1]! + custo);
    }
    anterior = atual;
  }
  return anterior[b.length]!;
}

/** 1 = idêntico, 0 = nada a ver. */
export function similaridade(a: string, b: string): number {
  const maior = Math.max(a.length, b.length);
  return maior === 0 ? 1 : 1 - distancia(a, b) / maior;
}

/**
 * Limiar da sugestão por semelhança.
 *
 * Alto de propósito: sugerir demais é pior que não sugerir. Uma sugestão errada
 * que a pessoa aceita no automático junta duas despesas que não são a mesma
 * coisa, e isso não aparece em conferência nenhuma depois.
 */
const SIMILARIDADE_MINIMA = 0.82;
const DISTANCIA_MAXIMA = 3;

/** Classifica um valor do arquivo contra os candidatos do cadastro. */
export function classificar(valor: string, candidatos: Candidato[]): ItemConciliacao {
  const base: Omit<ItemConciliacao, 'situacao' | 'sugestao'> = { valor, ocorrencias: 0, linhas: [] };
  if (!valor.trim()) return { ...base, situacao: 'INVALIDO', sugestao: null };

  // Igual de verdade: mesmo texto, sem tolerância nenhuma.
  if (candidatos.some((c) => c.nome === valor)) return { ...base, situacao: 'IGUAL', sugestao: null };

  const chave = chaveComparacao(valor);

  // Mesma coisa escrita diferente — acento, caixa ou espaçamento.
  const porGrafia = candidatos.find((c) => chaveComparacao(c.nome) === chave);
  if (porGrafia) {
    return {
      ...base,
      situacao: 'DIVERGENTE',
      sugestao: { ...porGrafia, confianca: 1, motivo: 'grafia' },
    };
  }

  // Parecido o bastante para ser erro de digitação na origem.
  let melhor: (Candidato & { confianca: number }) | null = null;
  for (const c of candidatos) {
    const outra = chaveComparacao(c.nome);
    const conf = similaridade(chave, outra);
    if (conf >= SIMILARIDADE_MINIMA && distancia(chave, outra) <= DISTANCIA_MAXIMA) {
      if (!melhor || conf > melhor.confianca) melhor = { ...c, confianca: conf };
    }
  }
  if (melhor) {
    return { ...base, situacao: 'DIVERGENTE', sugestao: { ...melhor, motivo: 'semelhanca' } };
  }

  return { ...base, situacao: 'NOVO', sugestao: null };
}

// --------------------------------------------------------------- cadastros

/** Naturezas aceitas pelo lançamento, com os nomes que a base do cliente usa. */
const NATUREZAS: Candidato[] = [
  { id: null, nome: 'FIXO' },
  { id: null, nome: 'PONTUAL UNICA' },
  { id: null, nome: 'PONTUAL PARCELADA' },
];

/** O que o cliente já tem cadastrado, por dimensão. */
export function candidatosDoCliente(ctx: Contexto, dimensao: Dimensao, escopo?: number[]): Candidato[] {
  // O escopo da carga recorta os candidatos: oferecer como vínculo uma unidade
  // fora do que a pessoa escolheu seria contradizer o próprio seletor.
  const doCliente = ctx.empresaIds.length ? ctx.empresaIds : [ctx.empresaId];
  const empresas = escopo && escopo.length ? escopo : doCliente;
  const vagas = empresas.map(() => '?').join(',');

  switch (dimensao) {
    case 'centro_custo':
      // Os tipos de despesa são por matriz; o cliente enxerga a união deles,
      // porque é contra o cadastro DELE que a base precisa bater.
      return db()
        .prepare(
          `SELECT MIN(id) AS id, nome FROM tipos_despesa
            WHERE empresa_id IN (${vagas}) AND ativo = 1 GROUP BY nome ORDER BY nome`,
        )
        .all(...empresas) as Candidato[];
    case 'grupo':
      return db()
        .prepare(`SELECT id, nome FROM empresas WHERE id IN (${vagas}) ORDER BY nome`)
        .all(...empresas) as Candidato[];
    case 'unidade':
      return db()
        .prepare(
          `SELECT id, nome FROM filiais WHERE empresa_id IN (${vagas}) AND ativo = 1 ORDER BY nome`,
        )
        .all(...empresas) as Candidato[];
    case 'tipo':
      return NATUREZAS;
    case 'fornecedor':
    case 'grupo_gasto': {
      // Não há cadastro próprio: o que vale como "conhecido" é o que já entrou
      // em carga anterior deste cliente. Na primeira carga tudo é NOVO, e é
      // isso mesmo — ninguém tinha visto aqueles nomes antes.
      const coluna = dimensao === 'fornecedor' ? 'fornecedor' : 'grupo_gasto';
      return db()
        .prepare(
          `SELECT NULL AS id, ${coluna} AS nome FROM lancamentos
            WHERE cliente_id = ? AND ${coluna} IS NOT NULL AND ${coluna} <> ''
            GROUP BY ${coluna} ORDER BY ${coluna}`,
        )
        .all(ctx.clienteId) as Candidato[];
    }
  }
}

/** O valor daquela dimensão numa linha do arquivo. */
export function valorDaLinha(linha: LinhaFoc, dimensao: Dimensao): string {
  switch (dimensao) {
    case 'centro_custo':
      return linha.centroCusto;
    case 'tipo':
      return linha.tipo;
    case 'grupo_gasto':
      return linha.grupoGasto;
    case 'grupo':
      return linha.grupo;
    case 'unidade':
      return linha.unidade;
    case 'fornecedor':
      return linha.fornecedor;
  }
}

/**
 * Monta os blocos de conciliação do arquivo inteiro.
 *
 * Um item por VALOR DISTINTO, não por linha: decidir "Licencas de Softwares"
 * uma vez resolve as 41 linhas que o usam. Era esse o ponto de a tela agrupar.
 */
export function conciliar(ctx: Contexto, linhas: LinhaFoc[], escopo?: number[]): BlocoConciliacao[] {
  return DIMENSOES.map(({ chave, rotulo, obrigatoria, permiteCriar }) => {
    const candidatos = candidatosDoCliente(ctx, chave, escopo);
    const porValor = new Map<string, ItemConciliacao>();

    for (const linha of linhas) {
      const valor = valorDaLinha(linha, chave);
      let item = porValor.get(valor);
      if (!item) {
        item = classificar(valor, candidatos);
        porValor.set(valor, item);
      }
      item.ocorrencias += 1;
      if (item.linhas.length < 20) item.linhas.push(linha.linha);
    }

    // Primeiro o que exige decisão, e dentro disso o que pesa mais.
    const ordem: Record<Situacao, number> = { INVALIDO: 0, NOVO: 1, DIVERGENTE: 2, IGUAL: 3 };
    const itens = [...porValor.values()].sort(
      (a, b) => ordem[a.situacao] - ordem[b.situacao] || b.ocorrencias - a.ocorrencias,
    );

    return {
      dimensao: chave,
      rotulo,
      obrigatoria,
      permiteCriar,
      itens,
      pendentes: itens.filter((i) => i.situacao === 'DIVERGENTE' || i.situacao === 'NOVO').length,
      candidatos,
    };
  });
}

/** O que a pessoa decidiu para um valor do arquivo. */
export interface Decisao {
  dimensao: Dimensao;
  valor: string;
  /** `criar` cadastra o valor como veio; `vincular` aponta para um existente. */
  acao: 'criar' | 'vincular';
  /** Nome do cadastro alvo, quando `vincular`. */
  alvo?: string;
}

/** Erro de uma decisão que não fecha, em linguagem de quem importa. */
export interface PendenciaDecisao {
  dimensao: Dimensao;
  valor: string;
  mensagem: string;
}

/**
 * Confere se as decisões cobrem tudo o que precisa de decisão.
 *
 * É a trava do botão "Prosseguir": enquanto esta lista não estiver vazia, nada
 * é gravado. A conferência vive aqui, e não na tela, porque a tela pode ser
 * contornada — o servidor é quem responde pela base.
 */
export function pendencias(blocos: BlocoConciliacao[], decisoes: Decisao[]): PendenciaDecisao[] {
  const tomadas = new Map(decisoes.map((d) => [`${d.dimensao}\u0000${d.valor}`, d]));
  const faltando: PendenciaDecisao[] = [];

  for (const bloco of blocos) {
    for (const item of bloco.itens) {
      if (item.situacao === 'IGUAL') continue;
      if (item.situacao === 'INVALIDO') {
        if (bloco.obrigatoria) {
          faltando.push({
            dimensao: bloco.dimensao,
            valor: item.valor,
            mensagem: `${bloco.rotulo}: há linha sem valor, e esta informação é obrigatória. Corrija o arquivo e envie de novo.`,
          });
        }
        continue;
      }
      const decisao = tomadas.get(`${bloco.dimensao}\u0000${item.valor}`);
      if (!decisao) {
        faltando.push({
          dimensao: bloco.dimensao,
          valor: item.valor,
          mensagem: `${bloco.rotulo}: falta decidir o que fazer com "${item.valor}".`,
        });
        continue;
      }
      if (decisao.acao === 'criar' && !bloco.permiteCriar) {
        faltando.push({
          dimensao: bloco.dimensao,
          valor: item.valor,
          mensagem:
            `${bloco.rotulo}: "${item.valor}" não existe e não pode ser criado por importação. ` +
            'Escolha um item existente ou corrija o arquivo.',
        });
      } else if (decisao.acao === 'vincular') {
        if (!decisao.alvo) {
          faltando.push({
            dimensao: bloco.dimensao,
            valor: item.valor,
            mensagem: `${bloco.rotulo}: "${item.valor}" foi marcado para vincular, mas nenhum cadastro foi escolhido.`,
          });
        } else if (!bloco.candidatos.some((c) => c.nome === decisao.alvo)) {
          faltando.push({
            dimensao: bloco.dimensao,
            valor: item.valor,
            mensagem: `${bloco.rotulo}: "${decisao.alvo}" não existe no cadastro deste cliente.`,
          });
        }
      }
    }
  }
  return faltando;
}

/**
 * O nome final de cada valor do arquivo, depois das decisões.
 *
 * Vincular troca o nome pelo do cadastro; criar mantém o do arquivo. É este
 * mapa que a gravação consulta — ela não volta a olhar o texto original.
 */
export function mapaDeDestino(blocos: BlocoConciliacao[], decisoes: Decisao[]): Map<string, string> {
  const destino = new Map<string, string>();
  for (const bloco of blocos) {
    for (const item of bloco.itens) {
      destino.set(`${bloco.dimensao}\u0000${item.valor}`, item.valor);
    }
  }
  for (const d of decisoes) {
    if (d.acao === 'vincular' && d.alvo) destino.set(`${d.dimensao}\u0000${d.valor}`, d.alvo);
  }
  return destino;
}
