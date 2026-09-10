export interface Contexto {
  /** Empresa (tenant) sobre a qual a operação é executada. Nunca é opcional. */
  empresaId: number;
  usuarioId: number;
  usuarioEmail: string;
  papel: 'gestor' | 'leitor';
}
