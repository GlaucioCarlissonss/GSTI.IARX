export interface Contexto {
  /**
   * Cliente (contratante) da operação. É o recorte mais externo: nenhuma
   * consulta de negócio o atravessa, e quem pede um cliente a que não está
   * vinculado é recusado com 403 — no servidor, não na tela.
   *
   * Anulável apenas enquanto a base histórica não tiver dono carimbado; a
   * migração preenche na primeira abertura, e daí em diante vem sempre.
   */
  clienteId: number | null;
  /** Empresa (matriz) sobre a qual a operação é executada. Nunca é opcional. */
  empresaId: number;
  usuarioId: number;
  usuarioEmail: string;
  papel: 'gestor' | 'leitor';
}
