/** Cliente HTTP: injeta a sessão, o cliente e a matriz em foco em toda chamada. */

const CHAVE_TOKEN = 'gsti.token';
const CHAVE_EMPRESA = 'gsti.empresa';
const CHAVE_CLIENTE = 'gsti.cliente';

export class ErroApi extends Error {
  constructor(readonly status: number, mensagem: string, readonly detalhes?: unknown) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

export const sessaoLocal = {
  token: () => localStorage.getItem(CHAVE_TOKEN),
  definirToken: (t: string | null) =>
    t ? localStorage.setItem(CHAVE_TOKEN, t) : localStorage.removeItem(CHAVE_TOKEN),
  empresa: () => {
    const v = localStorage.getItem(CHAVE_EMPRESA);
    return v ? Number(v) : null;
  },
  definirEmpresa: (id: number | null) =>
    id ? localStorage.setItem(CHAVE_EMPRESA, String(id)) : localStorage.removeItem(CHAVE_EMPRESA),
  // O último cliente escolhido. Guardá-lo é o que faz a tela de boas-vindas
  // aparecer uma vez, e não a cada recarregamento de quem já escolheu.
  cliente: () => {
    const v = localStorage.getItem(CHAVE_CLIENTE);
    return v ? Number(v) : null;
  },
  definirCliente: (id: number | null) =>
    id ? localStorage.setItem(CHAVE_CLIENTE, String(id)) : localStorage.removeItem(CHAVE_CLIENTE),
};

function cabecalhos(comCorpo: boolean): HeadersInit {
  const h: Record<string, string> = {};
  if (comCorpo) h['Content-Type'] = 'application/json';
  const token = sessaoLocal.token();
  if (token) h.Authorization = `Bearer ${token}`;
  // O CLIENTE é o recorte da requisição: é contra ele que o servidor monta o
  // escopo de leitura. A empresa vai junto como matriz EM FOCO — o que escrever,
  // exportar ou importar precisa de uma só —, e o servidor recusa se ela não
  // for do cliente informado.
  const cliente = sessaoLocal.cliente();
  if (cliente) h['X-Cliente-Id'] = String(cliente);
  const empresa = sessaoLocal.empresa();
  if (empresa) h['X-Empresa-Id'] = String(empresa);
  return h;
}

async function tratar<T>(resposta: Response): Promise<T> {
  if (resposta.status === 204) return undefined as T;
  const texto = await resposta.text();
  const dados = texto ? JSON.parse(texto) : null;
  if (!resposta.ok && resposta.status !== 207) {
    throw new ErroApi(resposta.status, dados?.erro ?? `Falha na requisição (${resposta.status}).`, dados?.detalhes);
  }
  return dados as T;
}

export const api = {
  get: <T>(caminho: string, params?: Record<string, unknown>) => {
    const url = new URL(caminho, window.location.origin);
    for (const [chave, valor] of Object.entries(params ?? {})) {
      if (valor !== undefined && valor !== null && valor !== '') url.searchParams.set(chave, String(valor));
    }
    return fetch(url.pathname + url.search, { headers: cabecalhos(false) }).then(tratar<T>);
  },
  post: <T>(caminho: string, corpo?: unknown) =>
    fetch(caminho, { method: 'POST', headers: cabecalhos(true), body: JSON.stringify(corpo ?? {}) }).then(tratar<T>),
  put: <T>(caminho: string, corpo?: unknown) =>
    fetch(caminho, { method: 'PUT', headers: cabecalhos(true), body: JSON.stringify(corpo ?? {}) }).then(tratar<T>),
  patch: <T>(caminho: string, corpo?: unknown) =>
    fetch(caminho, { method: 'PATCH', headers: cabecalhos(true), body: JSON.stringify(corpo ?? {}) }).then(tratar<T>),
  remover: <T>(caminho: string, corpo?: unknown) =>
    fetch(caminho, { method: 'DELETE', headers: cabecalhos(true), body: JSON.stringify(corpo ?? {}) }).then(tratar<T>),
  enviarArquivo: <T>(caminho: string, arquivo: File, campos: Record<string, string> = {}) => {
    const dados = new FormData();
    dados.append('arquivo', arquivo);
    for (const [k, v] of Object.entries(campos)) dados.append(k, v);
    return fetch(caminho, { method: 'POST', headers: cabecalhos(false), body: dados }).then(tratar<T>);
  },
  /**
   * Download de um arquivo montado a partir de dados que só existem no
   * navegador — o relatório de erros da importação que acabou de rodar.
   * Guardá-lo no servidor para poder baixar por GET seria estado sem dono.
   */
  baixarComCorpo: async (caminho: string, corpo: unknown, nomeSugerido: string) => {
    const resposta = await fetch(caminho, {
      method: 'POST',
      headers: cabecalhos(true),
      body: JSON.stringify(corpo ?? {}),
    });
    if (!resposta.ok) throw new ErroApi(resposta.status, 'Não foi possível gerar o arquivo.');
    const blob = await resposta.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeSugerido;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  baixar: async (caminho: string, nomeSugerido: string) => {
    const resposta = await fetch(caminho, { headers: cabecalhos(false) });
    if (!resposta.ok) throw new ErroApi(resposta.status, 'Não foi possível gerar o arquivo.');
    const blob = await resposta.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeSugerido;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
