# Regras de negócio

Este documento descreve como cada regra do sistema está implementada e onde
verificá-la. Os nomes entre parênteses apontam o arquivo responsável.

## Regras globais

**Multi-tenant obrigatório.** Toda entidade carrega `empresa_id`; filial é
opcional e, quando ausente, o registro pertence ao nível empresa (consolidado).
O middleware `comEmpresa` (`server/src/middleware/index.ts`) resolve o tenant a
partir do cabeçalho `X-Empresa-Id` e recusa a requisição se o usuário não tiver
vínculo. Toda consulta do domínio filtra por `empresa_id`, e referências
cruzadas (filial, tipo de despesa, tópico) são validadas contra o tenant antes
de gravar — o teste *"o escopo de um tenant nunca vaza para outro"* cobre isso.

**Hierarquia Empresa → Filial.** Uma empresa tem zero ou mais filiais. Consultas
aceitam três escopos: consolidado (todas), uma filial específica, ou apenas o
nível empresa (`filial_id = nenhuma`).

**Competência.** O mês de referência é gravado como `AAAA-MM`, formato que
ordena e compara com operadores simples, e exposto na API e nas planilhas como
`MM/AAAA` (`domain/competencia.ts`). Valores fora do padrão são recusados na
entrada, não no banco.

**Auditabilidade.** Não há exclusão física: os registros recebem `excluido_em` e
saem das consultas. Toda operação relevante grava em `auditoria` quem alterou,
quando, o quê, o estado anterior e o posterior (`domain/auditoria.ts`).

**Idempotência de importação.** Descrita em *Importação e exportação*, adiante.

## Módulo financeiro

**Composição do lançamento.** Empresa/filial, tipo de despesa, competência,
valor, natureza e classificação. O valor é persistido em centavos inteiros
(`domain/dinheiro.ts`), o que elimina erro de ponto flutuante em somatórios.

**Tipos de despesa.** Toda empresa nasce com os nove tipos padrão (Pessoas,
Equipamentos de TI, Licenças de Softwares, Locação de Impressora, Materiais de
TI, Serviços Técnicos, Telefonia/Internet, Serviços de Desenvolvimento, Sistemas
Gerenciais) e aceita novos tipos sem limite.

**Naturezas.**

- `fixa` — recorrente. Informando *repetir até*, o sistema gera uma ocorrência
  por mês até o limite, todas ligadas ao lançamento de origem.
- `pontual_unica` — uma única ocorrência.
- `pontual_parcelada` — exige duas ou mais parcelas e projeta uma linha por mês
  subsequente.

**Parcelamento.** O valor informado pode ser o total do contrato (rateado) ou o
valor de cada parcela. No rateio, `ratear()` distribui o resto nas primeiras
parcelas, de modo que a soma fecha exatamente no total — propriedade verificada
por teste em vários totais e divisores. A parcela 1 é o lançamento de origem; as
demais apontam para ela em `lancamento_origem_id`, o que preserva a série.

**Classificação e reclassificação.** Todo lançamento é `despesa` ou
`investimento`. A troca é livre em competência futura; em competência corrente
ou passada exige justificativa registrada. Em séries parceladas a mudança
propaga-se, por padrão, às parcelas futuras do mesmo grupo, mantendo a série
coerente — não é possível deixar metade da série em cada classificação sem
pedir isso explicitamente.

**Alterações no passado.** Qualquer escrita em competência anterior à corrente
exige justificativa, que vai para a auditoria (`domain/fechamento.ts`).

**Fechamento mensal.** Uma competência fechada recusa qualquer escrita —
inclusive por importação — mesmo com justificativa. Reabrir exige justificativa
e fica registrado.

**Cenários de projeção.** Além do cenário `oficial`, que alimenta os dashboards
por padrão, uma empresa pode manter projeções alternativas (por exemplo, um
contrato com desconto condicionado). Os cenários convivem sem contaminar os
totais oficiais e são comparáveis lado a lado no dashboard.

## Módulo de projetos

Projeto tem nome, mês de início, fim planejado e fim real — este último só é
preenchido na conclusão, e um projeto marcado como concluído sem fim real é
recusado. Tarefas pertencem a um único projeto e têm responsável; envolvidos são
listados por projeto.

**Atraso é derivado, nunca digitado** (`calcularAtraso`): existe quando o mês
corrente ultrapassa o fim planejado sem fim real registrado. Quando há fim real,
o sistema deixa de acusar atraso e passa a registrar o **desvio** em meses, que
pode ser negativo (entrega adiantada). Itens cancelados não acusam atraso.

O cronograma é um Gantt de granularidade mensal, com a barra planejada e, quando
existe, a barra realizada logo abaixo, além do marcador do mês corrente.

## Módulo de SLA

Cada registro mensal traz total atendido, dentro e fora do SLA, por fila e
opcionalmente por tópico de ajuda. **A consistência é garantida na entrada e no
banco**: `dentro + fora = total` é validado no domínio e replicado como `CHECK`
no schema. Omitindo "fora", o sistema o deriva do total.

As filas nascem como Infraestrutura, Sistema e Dados, e o cadastro é expansível
sem migração dos dados existentes. Os tópicos de ajuda são cadastro livre.

Os indicadores derivados (% dentro, % fora, por fila, por tópico, por filial e
tendência mensal) são calculados na consulta, nunca armazenados — não há como
divergirem dos registros.

## Dashboards

Os três dashboards, mais uma visão executiva consolidada, sempre devolvem o
escopo consultado junto dos números (empresa, filial e competência), de modo que
nenhum indicador aparece sem contexto.

Sem competência informada, o painel abre no **último mês encerrado com
movimento**, e não no mês corrente: comparar um mês em curso com um mês completo
produziria variações enganosas.

## Importação e exportação

**Um único template** serve para importar e exportar, o que garante backup,
migração e reimportação sem perda. Cada planilha carrega uma aba `_meta` com a
versão do layout, e o leitor aceita apelidos de cabeçalho (`Competência`,
`competencia`, `mes`, `mês de competência`…), de modo que planilhas de versões
anteriores continuam importáveis.

**Validação.** Competência fora de `MM/AAAA`, valor inválido, natureza ou
classificação desconhecida e tipo de despesa inexistente são reportados linha a
linha, com o motivo — e as linhas válidas do mesmo lote entram normalmente.
Tipos, tópicos e filiais ausentes podem ser criados automaticamente, e o
relatório lista o que foi criado.

**Deduplicação.** A verificação compara o **conteúdo** do registro (empresa,
filial, competência, tipo, valor, natureza, classificação, parcela, cenário,
descrição e observações) contra o que já existe, e não uma chave gravada no
momento da importação. Isso é o que faz a reimportação de uma exportação
reconhecer também os registros criados pela interface. Linhas idênticas
repetidas no arquivo são legítimas — duas notas iguais no mesmo mês — e a
n-ésima repetição casa com a n-ésima já existente, preservando a contagem.

**Simulação.** `Validar sem gravar` executa a importação inteira dentro de uma
transação desfeita ao final: o relatório é real, o banco não muda.

## Expansões previstas

O modelo já acomoda novos tipos de despesa, filiais, empresas, filas e tópicos
sem migração. Ficam para etapas seguintes: multimoeda, centro de custo, fluxo de
aprovações, integração com ERP/helpdesk, API pública e webhooks.
