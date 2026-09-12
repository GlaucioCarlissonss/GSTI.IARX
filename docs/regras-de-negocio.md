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

**Origem do lançamento.** Todo lançamento carrega a procedência do dado, porque
o total que o sistema mostra **não é** o total das planilhas enviadas pelo
gestor — e isso precisa ser verificável, não explicado:

| origem | significado |
|---|---|
| `planilha` | linha importada das bases enviadas, com o valor intocado |
| `folha_ti` | custo de pessoal de TI alocado ou rateado; não existia como linha de despesa nas planilhas |
| `projecao_spincare` | mensalidade projetada do novo ERP, ainda não realizada |
| `manual` | criado ou editado por um usuário dentro do sistema |

Editar um lançamento **não** muda sua origem: uma linha de planilha corrigida
continua sendo de planilha, e a alteração fica na trilha de auditoria. Arquivo
importado sem a coluna `Origem` entra como `planilha` — veio de fora, não foi
lançado aqui.

A tela **Conferência de origem** (`/conferencia`, endpoint
`/api/dashboards/conferencia`) decompõe o total por origem, mês a mês, e mostra
quanto do número consolidado é base enviada e quanto o sistema acrescentou.
Na base carregada das planilhas do grupo isso dá R$ 1.328.988,35 de planilha,
R$ 273.929,60 de folha rateada e R$ 426.720,00 de projeção.

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

### Tarefas hierárquicas

Uma tarefa pode ter uma **tarefa principal** (`parent_task_id`), sempre do mesmo
projeto. Quatro regras sustentam a hierarquia, todas validadas no domínio e com
mensagem que diz o motivo:

| regra | por quê |
| --- | --- |
| Nenhuma tarefa é a própria principal | o caso trivial de ciclo |
| Nenhuma tarefa é ascendente de si mesma | ciclo faz o Gantt entrar em laço infinito |
| Mesmo projeto | um cronograma não agrupa por fora de si |
| Até **3 níveis** (principal → subtarefa → subtarefa) | é o que o Gantt ainda mostra sem virar indentação ilegível; além disso, o caso já pede um projeto novo |

A profundidade é verificada considerando a **subárvore que vem junto**: mover
uma tarefa que já tem duas gerações abaixo dela para debaixo de outra raiz é
recusado, mesmo que a tarefa em si caiba.

**Excluir tarefa principal com subtarefas é bloqueado, não cascateado.** Em
cascata, uma confirmação de "excluir 1 tarefa" apagaria a subárvore inteira em
silêncio, que é exatamente o que a regra de auditoria não admite. A mensagem
lista as subtarefas e pede que sejam desagrupadas ou excluídas antes.

Tarefa cujo pai foi excluído logicamente volta ao primeiro nível na leitura, em
vez de sumir da tela.

### Gantt agrupável

O Gantt mostra o projeto como linha de grupo e, abaixo, as tarefas em ordem de
leitura — cada principal seguida das suas subtarefas, indentadas por nível.
Cada linha de grupo tem um botão **+ / −**:

- **Estado padrão: expandido.** O que fica guardado no navegador é o conjunto
  dos **comprimidos**, não o dos expandidos — assim um grupo criado depois nasce
  aberto, em vez de herdar o silêncio de uma lista que não o conhecia.
- Comprimir esconde a **subárvore inteira**, não só as filhas diretas.
- **A barra do grupo comprimido cobre o intervalo agregado** — do início mais
  cedo ao fim mais tarde da subárvore, o próprio pai incluído. Esconder as
  subtarefas não pode encolher o tempo que elas ocupam no cronograma. O
  "realizado" do grupo só aparece quando a subárvore inteira terminou.
- Acessibilidade: o controle é um `button` de verdade, com `aria-expanded`,
  `aria-label` que diz o que será expandido ou comprimido, foco visível e
  teclado (Enter/Espaço) de graça.
- Acima de 60 linhas o Gantt **virtualiza**: só as linhas na janela visível vão
  para o DOM, e espaçadores mantêm a barra de rolagem do tamanho da lista.

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

### Chamado como registro de SLA

Um registro pode representar **um chamado**, e não só um agregado mensal: basta
`total = 1` e `dentro = 0|1`. Toda a agregação já existente (por fila, tópico,
filial, percentual, tendência) continua valendo sem nenhuma mudança, e o
registro ainda guarda o detalhe — `ticketId`, número, assunto, solicitante,
responsável, nível, status, abertura, fechamento, prazo e horas.

Com `ticketId` preenchido, a tela de SLA passa a listar os chamados e o número
vira **link de volta para o osTicket**. O endereço base é configurável em
*Cadastros → Endereço do osTicket* (padrão
`https://www.suportehr.com.br/scp/tickets.php?id=`), porque o id compõe a URL do
chamado no sistema de origem.

### Carga da base do osTicket

`scripts/gerar-sla.cjs <csv> <pasta-de-saída>` converte a extração do osTicket
nos documentos de SLA. As decisões de mapeamento, todas confirmadas com o
gestor, ficam no topo do script:

| Decisão | Regra |
| --- | --- |
| Organização → empresa/filial | tabela `ORG`; `PB - Hospital Residencial` é **HR JP** |
| `HR - Urgência Emergência` e `indefinido` | entram em **RESIDENCIAL sem filial**; as demais organizações fora das 5 empresas são descartadas e listadas no relatório |
| Tópico → fila | `TI - Infra*`, `TI - Reset de Senha`, `TI - Segurança` e `TI - Aquisição` → **Infraestrutura**; `TI - IW/FOC/Sistemas` → **Sistema**; `TI - Dados` → **Dados**; demais `TI - *` → **Outros**; o resto → **Fora de TI** |
| Dentro do SLA | `fechamento − abertura ≤ 48h` |
| Chamado ainda aberto | medido contra o **momento da extração**, gravado em `extraidoEm`: um chamado vencido e sem fechar está **fora** do SLA, não "ainda dentro" |

**Por que não usar `est_duedate`.** A coluna de vencimento estimado da extração
só existe para os chamados fechados rápido (mediana de 1,3 h, 6,5 % acima de
48 h) e está ausente justamente nos 2.805 chamados em atraso (mediana de 240 h,
99,5 % acima de 48 h). Usá-la produziria um SLA perto de 100 %, que não descreve
a operação. O cálculo adotado é o mesmo "Padrão SLA" que a própria tela do
osTicket exibe como Data de Vencimento: abertura + 48 h.

A idempotência da carga vem da chave `ticket:<ticketId>`: reimportar o mesmo
arquivo atualiza o chamado, nunca o duplica.

## Navegação

O sistema se apresenta pelos módulos do negócio, não pela lista de telas. São
três, mais um lugar para o que atravessa todos eles:

| módulo | o que reúne |
| --- | --- |
| **Controle Financeiro** | painel executivo, dashboard, lançamentos, fechamento mensal e conferência de origem |
| **Gestão de Projetos** | dashboard com Gantt, projetos e tarefas |
| **Gestão de Suporte TI** | indicadores de SLA e a lista de chamados |
| **Sistema** | importação/exportação, cadastros e trilha de auditoria |

`Sistema` não é um quarto módulo de negócio: é onde ficam planilha, cadastro e
auditoria, que servem aos três e não pertencem a nenhum. Entrar num módulo abre
a primeira tela dele, e módulo de tela única não mostra barra de abas.

## Tema claro e escuro

Três estados, não dois: **tema do sistema** (segue o aparelho), **claro** e
**escuro**. O botão de alternar está no cabeçalho, presente em toda tela, e a
escolha fica no navegador de quem usa — é preferência de quem olha, não dado do
sistema, e por isso não vai para o banco nem para a auditoria.

A escolha explícita vence a preferência do aparelho nos dois sentidos, e é
aplicada antes do primeiro pixel: um script no topo do documento carimba o tema
antes de a página pintar, senão a tela abriria no tema do aparelho e trocaria
depois, com piscada visível.

## Filtros

Todo filtro aceita **mais de um valor**. Na tela isso são caixas de seleção,
com o que está marcado aparecendo em fichas removíveis; na API, listas
separadas por vírgula (`natureza=fixa,pontual_unica`), o parâmetro repetido, ou
o valor único de sempre — o contrato antigo continua válido, porque uma lista
de um item é o mesmo filtro.

Conjunto vazio significa "todos" onde isso faz sentido. Competência e cenário
têm mínimo de um: um painel sem competência nenhuma não mostraria número algum.

**Vários meses somam** e o painel passa a falar em período. A variação
percentual só aparece com um mês em foco — comparar um período de N meses com
o mês anterior mediria coisas de tamanhos diferentes.

**Cenário é a exceção que exige cuidado.** Cenários são alternativas: o
`spincare_desconto_12` contém as mesmas mensalidades do oficial, com desconto.
Marcar vários soma linhas que representam a mesma despesa, e por isso o seletor
avisa. Na versão hospedada o painel troca para comparação em vez de somar.

O nível empresa (lançamento sem filial) entra na lista de filiais como
`nenhuma` — em SQL é `IS NULL`, que não casa com `IN`, e por isso a cláusula é
montada em separado (`lib/consulta.ts`).

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

**Versões do template.** `1.0` é o layout original; `1.1` acrescentou a coluna
`Origem` à aba `Financeiro`; `1.2` acrescentou à aba `SLA` as colunas de detalhe
do chamado (`Ticket`, `Número`, `Assunto`, `Solicitante`, `Responsável`,
`Nível`, `Status`, `Origem`, `Aberto em`, `Fechado em`, `Prazo`, `Horas`). Um
arquivo `1.0` continua importável — a origem ausente vira `planilha` —, e um
arquivo de versão maior aberto por uma versão antiga apenas ignora as colunas a
mais. Na aba `SLA`, a linha com `Ticket` preenchido é deduplicada por
`ticket:<id>`; sem `Ticket`, pelo conteúdo, como nas demais abas.

## Expansões previstas

O modelo já acomoda novos tipos de despesa, filiais, empresas, filas e tópicos
sem migração. Ficam para etapas seguintes: multimoeda, centro de custo, fluxo de
aprovações, integração com ERP/helpdesk, API pública e webhooks.
