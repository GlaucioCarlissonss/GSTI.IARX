export const moeda = (valor: number) =>
  valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Valor compacto para eixos e cartões: R$ 1,3 mi / R$ 245 mil. */
export const moedaCurta = (valor: number) => {
  const abs = Math.abs(valor);
  if (abs >= 1_000_000) return `R$ ${(valor / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `R$ ${(valor / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  return `R$ ${valor.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
};

export const inteiro = (valor: number) => valor.toLocaleString('pt-BR');

export const percentual = (valor: number, casas = 1) =>
  `${valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

/** Data/hora legível. Ausência vira travessão: a tela não mostra "null". */
export const dataHora = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

/** "03/2026" -> "mar/26", para eixos apertados. */
const ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const mesCurto = (competencia: string) => {
  const [mes, ano] = competencia.split('/');
  const i = Number(mes) - 1;
  return ABREV[i] ? `${ABREV[i]}/${ano?.slice(2)}` : competencia;
};

export const ROTULO_NATUREZA: Record<string, string> = {
  fixa: 'Fixa',
  pontual_unica: 'Pontual única',
  pontual_parcelada: 'Pontual parcelada',
};

export const ROTULO_STATUS_PROJETO: Record<string, string> = {
  planejado: 'Planejado',
  em_andamento: 'Em andamento',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

export const ROTULO_STATUS_TAREFA: Record<string, string> = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

/** Competência corrente no formato MM/AAAA. */
export const competenciaAtual = () => {
  const hoje = new Date();
  return `${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
};

export const competenciaValida = (valor: string) => /^(0[1-9]|1[0-2])\/\d{4}$/.test(valor.trim());

/**
 * Competência para exibição. A maioria das consultas já devolve MM/AAAA, mas a
 * listagem de chamados devolve o formato interno `AAAA-MM` — o que é gravado, e
 * o que ordena. Esta função aceita os dois e sempre mostra MM/AAAA.
 */
export const competenciaExib = (valor: string | null | undefined) => {
  const texto = String(valor ?? '').trim();
  if (!texto) return '—';
  const interno = texto.match(/^(\d{4})-(\d{2})$/);
  return interno ? `${interno[2]}/${interno[1]}` : texto;
};
