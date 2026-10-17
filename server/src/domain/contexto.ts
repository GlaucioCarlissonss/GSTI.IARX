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
  /**
   * TODAS as matrizes do cliente a que este usuário tem acesso — o escopo de
   * leitura de qualquer tela.
   *
   * É o que substitui o antigo "filtro global de empresa": a tela não pergunta
   * mais ao topo do sistema de quem são os números; ela lê o cliente inteiro e
   * aplica, por conta própria, o filtro local que a pessoa escolheu ali dentro.
   */
  empresaIds: number[];
  /**
   * Empresa (matriz) em foco para ESCRITA. Criar, editar e excluir precisam de
   * uma só — um registro não pertence a duas matrizes. A leitura não usa isto.
   */
  empresaId: number;
  usuarioId: number;
  usuarioEmail: string;
  papel: 'gestor' | 'leitor';
}
