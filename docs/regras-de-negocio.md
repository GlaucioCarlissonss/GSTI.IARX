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

### Relatório com drill-down

Reproduz a tabela dinâmica que o gestor já monta no Excel: **meses nas
colunas**, hierarquia nas linhas, **Total Geral** nas duas pontas. Três níveis:

| nível | mostra | como |
| --- | --- | --- |
| 1 — macro | filiais e seus totais por mês | **padrão: recolhido**, como no anexo |
| 2 — categoria | os tipos de despesa da filial | expandir a filial |
| 3 — lançamento | os lançamentos daquele recorte | expandir o tipo; **carregados sob demanda** |

O nível 3 é lazy porque trazer todos os lançamentos de todos os meses de todas
as filiais junto do macro tornaria a primeira tela lenta pelo que quase nunca é
olhado. Na versão hospedada a base já está em memória, mas as linhas só são
montadas quando abertas, pelo mesmo motivo.

**O que não pode sumir ao rolar fica preso.** São até 24 colunas de mês e
centenas de linhas: rolando, o gestor perdia de vista de que competência era a
coluna e quanto dava o total. Ficam fixos o **cabeçalho** (no topo), a linha de
**Total Geral** (na base) e a **coluna de rótulos** (à esquerda, para a rolagem
lateral não levar junto o nome da filial).

Para isso a tabela precisa de caixa própria de rolagem, com altura limitada:
sem altura, quem rola é a página, e não há de que grudar. A célula presa também
precisa de fundo opaco — senão o número da coluna seguinte passa por baixo dela
— e de sombra no lugar da borda, porque `border-collapse: collapse` descola a
borda de quem está preso.

**Tela cheia** (botão no cabeçalho do relatório, `Esc` para sair): a mesa
inteira ocupa a janela, sem o cabeçalho do sistema. Os fixos continuam valendo
lá dentro, que é justamente onde há mais linha para rolar.

**A soma do detalhe aparece ao lado do total da linha**, com um aviso explícito
quando diverge. Não é decoração: é onde uma divergência entre macro e detalhe
apareceria, em vez de passar despercebida.

**Origem do custo e destino do pagamento** são campos do lançamento — de onde o
custo veio (fornecedor, setor, centro de custo) e para onde o pagamento foi
(conta, beneficiário), mais o documento vinculado. **Não confundir com
`origem`**, que é a *procedência do dado*: de onde o registro entrou no sistema,
não de onde o dinheiro saiu. Parcelas herdam os três do lançamento de origem —
é o mesmo contrato, parcelado —, e corrigir o valor não apaga nenhum deles.

O tooltip de cada lançamento traz a descrição completa com origem e destino; o
clique abre o registro inteiro.

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

**A tarefa principal se escolhe numa lista, nunca se digita.** O campo é um
seletor que traz as tarefas existentes do projeto, indentadas pelo nível em que
estão — a indentação mostra se a escolha vai criar um segundo ou um terceiro
nível, o que uma lista plana de nomes não diz. O valor guardado é o **id**, não
o nome.

Foi um defeito de verdade, relatado pelo gestor: com um campo de texto livre,
errar um acento ou um espaço devolvia *"não existe uma tarefa X neste projeto"*
para uma tarefa que existe. E num projeto ainda **sem tarefa nenhuma** o campo
continuava pedindo um nome que não havia como fornecer — hoje o seletor aparece
desabilitado, com a opção *nenhuma* explicando que a tarefa fica no primeiro
nível.

O seletor oferece só quem ainda cabe um nível abaixo, e nunca a própria tarefa
que está sendo reagrupada: oferecer as demais seria oferecer um erro. Reagrupar
uma tarefa existente usa o mesmo seletor, agora numa janela própria — antes era
um `prompt` do navegador pedindo o nome digitado.

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

### O registro agregado é editável, e não some atrás dos chamados

O total digitado à mão para o mês é um registro como outro qualquer: dá para
**editar** e não só excluir. Sem edição, corrigir um número significava excluir
e recriar — o que a trilha de auditoria registra como duas operações, quando
foi uma correção.

Mudar a competência de um registro é tirá-lo de um mês e pô-lo em outro: os
**dois** meses precisam estar abertos, e a checagem vale para os dois.

A tela de chamados mostra **as duas listas**: os chamados importados e os
registros agregados. Antes mostrava uma ou outra, e o registro digitado à mão
desaparecia sempre que houvesse um único chamado importado no recorte — o
gestor registrava o mês e não via o que havia acabado de gravar.

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

### Sistemas de suporte (OStick e Bitrix24)

Os dois sistemas descrevem a mesma coisa com nomes diferentes, e no SaaS viram
**o mesmo registro**: um chamado é um registro de SLA com `total = 1`, o que faz
toda a agregação existente valer sem uma linha de mudança. As duas telas do
submenu *Sistemas de Suporte* são **a mesma tela**, mudando só o recorte por
`source_system` — duplicar componente e consulta para dizer a mesma coisa duas
vezes seria duplicar manutenção.

**Identidade e idempotência.** A chave é `(empresa, source_system, external_id)`.
A empresa entra porque o sistema é multi-tenant por regra: duas empresas podem
usar instâncias separadas do mesmo helpdesk, cujos ids colidem sem nenhuma
relação entre si. Reentregar o mesmo chamado — o que toda fila de integração
pode fazer — **atualiza** o registro; nunca cria um segundo.

**Normalização.** Status e prioridade de cada origem caem num vocabulário único
(`open | in_progress | resolved | closed`, `low | medium | high | urgent`).
Status que não casa com nada vira **`open`**: um chamado incompreensível está
em aberto até prova em contrário, e tratá-lo como fechado esconderia trabalho
pendente. Prioridade ausente vira `medium`.

**Setor.** É a área da empresa que fez a solicitação, e é obrigatório. Quando a
origem não informa, o chamado entra como **"Não classificado"** e o recebimento
fica registrado em log para revisão — recusar o chamado na porta perderia
justamente o registro que o webhook veio entregar. Setor novo entra no catálogo
da empresa, como os demais cadastros.

### Integrações: o operador não depende do N8N para diagnosticar

Cada empresa tem uma **conexão por sistema de origem**, com endereço, segredo e
interruptor próprios. O que sustenta a tela de Integrações é o **log de
eventos**: o payload entra nele **antes** de ser interpretado, e é de lá que
sai o diagnóstico de uma falha — e o reprocessamento, sem depender de a origem
reenviar.

O pipeline de cada recebimento, nesta ordem:

| passo | o que faz |
| --- | --- |
| 1 | grava o payload bruto no log, com status `received` |
| 2 | valida os campos obrigatórios; recusa vira `error` com o motivo legível |
| 3 | normaliza para o modelo único de chamado |
| 4 | faz o upsert por `(empresa, sistema, external_id)` |
| 5 | fecha o evento (`processed` ou `error`) e atualiza a conexão (último evento, último erro) |

**O segredo é guardado como hash, e o valor em claro aparece uma única vez** —
no instante em que é gerado. É o mesmo trato de uma chave de API: quem tem o
banco não tem a chave, e quem perdeu o segredo gera outro. A tela diz isso em
voz alta, porque a alternativa — guardar em texto para poder reexibir — troca
uma conveniência por um vazamento.

Girar o segredo **invalida o anterior na hora**. Não há janela de convivência:
duas chaves válidas ao mesmo tempo é o que se quer evitar ao girar.

**Três recusas distintas, e não uma só:**

| situação | resposta | por quê |
| --- | --- | --- |
| segredo ausente ou errado | **401** | é o caso de autenticação |
| conexão desligada de propósito | **403** | 401 mandaria o operador caçar um segredo que está certo |
| nenhum segredo configurado | **503** | um deploy que esqueceu a variável não vira porta sem tranca |

Sem segredo por empresa, vale o da **variável de ambiente** — é o que sustenta
uma instalação de um tenant só, sem passar pela tela.

**A versão hospedada não recebe o POST do N8N.** Nenhum endereço dela é
chamável de fora: quem recebe webhook é o servidor local. A tela de Integrações
dela faz o que dá para fazer sem servidor — cadastra a conexão de cada origem,
publica o **contrato do payload** campo a campo, e passa o que for colado nela
pelo mesmo tratamento do webhook de verdade: normaliza, valida e grava por
`(empresa, sistema, id externo)`. É o que permite provar o contrato antes de o
fluxo entrar no ar, com o erro aparecendo ali e não em produção. Segredo nenhum
é guardado nela.

**O payload de teste percorre exatamente o mesmo caminho** do webhook: mesmo
pipeline, mesmo upsert, mesmo log. Um teste que seguisse caminho próprio
deixaria de provar o que a produção faz. O chamado de teste entra marcado como
tal, para dar para achá-lo depois sem caçar por assunto.

**Reprocessar só vale para evento com erro.** Refazer o que deu certo criaria
escrita sem motivo e faria a auditoria mostrar duas operações onde houve uma.

`GET /api/health` responde **sem autenticação**: um monitor não tem credencial,
e a resposta não conta nada que já não se saiba de fora.

### Webhooks (N8N → SaaS)

`POST /api/webhooks/ostick/tickets` e `POST /api/webhooks/bitrix24/tickets`,
fora do router protegido por sessão: quem chama é uma automação, não um usuário
logado.

| aspecto | regra |
| --- | --- |
| Autenticação | header `X-Webhook-Secret`, valor em `WEBHOOK_SECRET`. Comparação em **tempo constante** — um `===` vaza o tamanho do prefixo correto pelo tempo de resposta |
| Sem segredo configurado | **503**, não 200: um deploy que esqueceu a variável não pode virar uma porta sem tranca |
| Empresa | header `X-Empresa-Id` (ou `empresa_id` no corpo). Adivinhar pelo conteúdo criaria vazamento entre empresas |
| Tamanho | corpo acima de 256 KiB é recusado antes de ser interpretado |
| Taxa | janela deslizante por IP, `WEBHOOK_RATE_LIMIT` por minuto (padrão 600) |
| Lote | aceita um chamado ou uma lista; a linha inválida entra no relatório sem derrubar as boas |
| Respostas | `200 { received: true, ticket_id, tickets[] }` · `422` com o motivo de cada recusa · `401` sem autenticação |
| Observabilidade | uma linha JSON por recebimento, com origem, empresa, contagens e erros |

O payload como chegou fica gravado no registro (`raw_payload`), junto do momento
da sincronização: dá para reconferir contra a origem sem depender de log, que
rotaciona.

## Tooltips e drill-down

Vale para **todo gráfico e todo indicador**, nos dois aplicativos.

**Tooltip.** Passar o ponteiro mostra o contexto do ponto: período, valor,
categoria, série e a participação no total. Nos elementos que não são SVG (as
barras do Gantt, as linhas do relatório) o mesmo papel cabe ao `title` nativo,
que ainda funciona com leitor de tela.

Nos **indicadores** o tooltip diz o que o número mede — de onde ele sai e o que
entra na conta. Na versão hospedada é o mesmo balão dos gráficos, e não o
`title` do navegador: o `title` demora a aparecer, não segue o tema e some no
toque. O balão acompanha também o **foco do teclado**, porque quem navega por
teclado não passa o ponteiro; o `title` permanece no elemento como a descrição
que o leitor de tela encontra.

**Drill-down.** Clicar abre os registros que compõem aquele número — **com o
mesmo recorte que o produziu**. Essa é a garantia que faz o detalhamento valer:
se ele viesse de outra consulta, poderia divergir do que está na tela, e o
gestor não teria como saber qual dos dois está certo. Por isso o detalhamento
mostra, junto:

- a contagem de registros;
- a **soma**, calculada sobre os registros exibidos;
- a marca **"confere com o indicador"** — ou, em vermelho, **"diverge do
  indicador"**, com o valor esperado;
- o **recorte aplicado** (empresa, filial, competência, cenário, base).

**Nem todo número vira botão.** Uma mediana, um percentual isolado ou uma
contagem de cadastro não tem registros por trás; oferecer drill-down neles
seria prometer o que não existe. O indicador sem detalhamento continua com
tooltip. Hoje são quatro, e por estes motivos:

| indicador | por que não abre |
| --- | --- |
| Peso do acréscimo (Conferência) | razão entre dois números que já têm o próprio detalhamento |
| Filas monitoradas (SLA) | contagem de cadastro, e o apoio já nomeia as filas |
| Mediana de atendimento (SLA) | mediana não é soma de registros |
| Conformidade de SLA sem tickets (Painel executivo) | abre só quando há chamado na competência; sem nenhum, não há o que listar |

**Indicador cujo número é zero não abre.** Um detalhamento vazio faria o gestor
duvidar do número em vez de esclarecê-lo.

**Lista cortada não acusa divergência.** A listagem de chamados é paginada, e o
recorte pode ter mais linhas do que cabe no detalhamento. Nesse caso a
conferência passa a usar a contagem que o **servidor** informa para o recorte
inteiro, e não a soma das linhas visíveis — somar o que está à vista mediria a
página, não o número clicado, e a tela acusaria uma divergência que não existe.
O rodapé então diz quantos de quantos estão à mostra.

**Tarefa sem responsável.** O ranking de carga agrupa essas tarefas sob um
rótulo próprio, e o detalhamento as pede com o sentinela `sem`. Um parâmetro
vazio não serviria: o cliente descarta string vazia por convenção, e o filtro
chegaria ausente — o que significa "sem filtro" e devolveria **todas** as
tarefas. É o mesmo padrão do filtro de tópico de ajuda, que usa `sem` para o
tópico ausente.

**O número do chamado é link para o sistema de origem**, também dentro do
detalhamento — é o caminho para quem quer ver o atendimento inteiro, e não só a
linha do relatório. O endereço é montado **no servidor**, a partir da base
configurada de cada helpdesk, e vai pronto no registro (`url_externa`). Antes
cada tela remontava a URL por conta própria, e o detalhamento simplesmente não
trazia link nenhum. Sem base configurada não há link: um endereço adivinhado
levaria o gestor a uma página que não existe.

**Acessibilidade.** O gatilho é sempre `role="button"` com `tabindex="0"`,
`aria-label` que diz o que vai abrir, foco visível e Enter/Espaço. Um `div` com
`onclick` não é nada disso.

**Carga sob demanda.** Na versão local o detalhamento só consulta o servidor
quando abre, com estados de carregando, vazio e erro. Na versão hospedada os
registros já estão em memória, e o recorte é aplicado sobre a mesma lista que
produziu o número.

## Telas flutuantes

Toda tela flutuante — modal de detalhe, formulário, detalhamento de indicador —
é a mesma peça, e obedece às mesmas regras.

**Cabeçalho preso em cima, rodapé preso embaixo, só os dados rolando.** O
título carrega o recorte (*"Detalhamento — Despesa · 08/2026"*) e as ações
levam a fechar ou salvar: nenhum dos dois pode sair de vista enquanto se
percorre trezentos registros. As ações que vivem dentro de um `<form>` não
podem sair dele — o `submit` depende disso —, então em vez de mudarem de lugar
elas grudam no fundo da área de dados, com o mesmo efeito.

**O tamanho fica na mão de quem usa.** Arrastar a borda direita, a de baixo ou
o canto entre as duas; ou tela cheia de uma vez, pelo botão do cabeçalho. A
esquerda e o topo ficam de fora de propósito: a tela é centralizada, e arrastar
por lá a faria andar em vez de crescer. Mínimo de 320×240 — abaixo disso ela não
serve para nada — e máximo na janela.

**O tamanho escolhido persiste, por espécie de tela.** O detalhamento de um
indicador quer largura; um formulário de cadastro, não. A chave é o `tipo`
declarado por quem abre a tela, e a escolha vai para o navegador de quem usa —
é preferência de quem olha, não dado do sistema.

**Coluna ajustável, e texto longo que deixa de ser cortado.** Cada cabeçalho
tem alça de largura, e as colunas de texto (Assunto, Descrição, Origem do
custo) quebram em linha em vez de cortar: esticar a tela dá espaço a elas.

Dois detalhes que só aparecem ao fazer:

- A alça da coluna fica **dentro** da célula, não sobre a divisa. A caixa de
  rolagem recorta o que passa da borda, e a alça ficava inalcançável pelo
  ponteiro — existia no HTML e não dava para pegar.
- A tabela passa a valer **a soma das suas colunas**, e não 100% da caixa. Com
  `width: 100%` e `table-layout: fixed`, alargar uma coluna faz o navegador
  devolver o ganho encolhendo as outras, e a coluna não cresce de fato. Quem
  absorve o excesso é a rolagem horizontal, como deve ser.

**O cabeçalho da tabela também fica preso** dentro da tela flutuante: rolar
centenas de registros sem os nomes das colunas é ler número sem rótulo.

**Barra de rolagem no tom do tema.** A do navegador entra branca no escuro e
corta o fundo da tela flutuante.

**Acessibilidade.** `Esc` fecha (e com telas empilhadas, só a de cima); o botão
de tela cheia é um `aria-pressed` que diz se vai expandir ou restaurar; cada
alça é um `separator` com `aria-label` dizendo o que arrastar muda. O arrasto
mexe em estilo, fora do ciclo de repintura, justamente para não perder o foco
do teclado no meio do movimento.

## Navegação

O sistema se apresenta pelos módulos do negócio, não pela lista de telas. São
três, mais um lugar para o que atravessa todos eles:

| módulo | o que reúne |
| --- | --- |
| **Controle Financeiro** | painel executivo, dashboard, lançamentos, fechamento mensal e conferência de origem |
| **Gestão de Projetos** | dashboard com Gantt, projetos e tarefas |
| **Gestão de Suporte TI** | indicadores de SLA, a lista de chamados e uma entrada por sistema de origem |
| **Sistema** | importação/exportação, cadastros e trilha de auditoria |

**Uma entrada por sistema de origem.** *Sistema OStick* e *Sistema Bitrix24*
são a **mesma tela** de chamados com a origem fixada — os dois helpdesks
descrevem a mesma coisa com nomes diferentes, e duplicar a tela por origem só
criaria duas cópias para manter em paridade. A aba que fixa o sistema não
desenha o filtro de Sistema: ele seria redundante, e mexer nele contradiria a
aba. O identificador da aba é o próprio `source_system`, então um terceiro
helpdesk vira aba sem uma segunda lista para manter em dia.

A aba *Chamados* continua existindo e mostra todas as origens juntas, com o
filtro de Sistema disponível: é a leitura de quem quer o quadro completo.

Origem sem chamado no recorte não some da navegação — a aba abre com um estado
vazio que diz por onde os chamados daquele sistema entram. Esconder a aba faria
parecer que o sistema não existe, quando ele só não tem registro ainda.

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

### O filtro não decide se dá para registrar

Botão de criar registro **nunca** fica desabilitado por causa do recorte em
tela. O filtro do topo diz o que o gestor está **olhando**; se ele pode ou não
lançar é outra pergunta, e trancar o botão por causa da primeira é responder a
errada — o gestor via o botão cinza sem saber o que fazer para destravá-lo.

A empresa do registro se escolhe **dentro do formulário**, já sugerida pela do
recorte quando há uma só. Quem decide é o formulário, que é onde o registro
ganha dono.

**Uma despesa pode nascer em várias filiais de uma vez.** Ao criar, o campo
Filial aceita marcar mais de uma, e cada filial recebe um lançamento. O valor
**não é dividido**: cada uma recebe o lançamento cheio, e o formulário mostra a
conta em voz alta — *"3 lançamentos, um por filial, de R$ 1.000,00 cada — R$
3.000,00 no total"*. Sem essa linha, a leitura oposta (um rateio) seria igual
de plausível, e o gestor só descobriria a diferença depois de gravar.

Ao **editar**, a filial volta a ser uma só: o registro tem uma filial, e
transformá-lo em vários na edição seria criar registros no lugar de alterar um.

Trocar a empresa no formulário repinta filial, tipo de despesa, fila e cenário:
são cadastros de cada empresa, e oferecer o de uma para o registro de outra
gravaria um vínculo que não existe.

## Dashboards

Os três dashboards, mais uma visão executiva consolidada, sempre devolvem o
escopo consultado junto dos números (empresa, filial e competência), de modo que
nenhum indicador aparece sem contexto.

Sem competência informada, o painel abre no **último mês encerrado com
movimento**, e não no mês corrente: comparar um mês em curso com um mês completo
produziria variações enganosas.

### Planilha de chamados

Fluxo próprio, separado do template geral, porque o chamado tem outra
identidade: a chave é `(source_system, external_id)` — a **mesma** do webhook.
Um único mecanismo serve aos dois caminhos, e é isso que faz reimportar um
arquivo já importado **atualizar** em vez de duplicar.

O arquivo tem duas abas. `Tickets` carrega os dados, com as treze colunas do
contrato; `Instruções` explica cada coluna, os valores aceitos e um exemplo —
sem ela, quem preenche à mão descobre as regras errando, uma linha por vez.
Cabeçalho congelado e filtro nativo do Excel vêm do escritor compartilhado.

**A exportação leva o recorte da tela.** Um arquivo com a base inteira, quando
a tela mostrava um recorte, não é o que o gestor pediu ao clicar em exportar.

**A importação nunca grava direto: primeiro mostra a prévia.** Linha a linha,
com o que é válido, o motivo de cada recusa e o efeito de cada linha boa —
*criar* ou *atualizar*. É a diferença entre um relatório do que aconteceu e um
aviso do que vai acontecer; só depois de ver isso é que o gestor confirma.

| regra | recusa quando |
| --- | --- |
| `external_id`, `source_system`, `title` | vazios |
| `source_system` | fora de OSTICK / BITRIX24 |
| `status` | fora de open, in_progress, resolved, closed |
| `priority` | fora de low, medium, high, urgent |
| `requester_email` | preenchido e sem formato de e-mail |
| `created_at` | preenchido e ilegível (aceita ISO 8601 e dd/mm/aaaa hh:mm) |
| `external_id` repetido **no arquivo** | a segunda ocorrência, apontando a linha da primeira |

A duplicata dentro do arquivo é erro, e não upsert: das duas linhas, o sistema
não tem como saber qual é a boa.

**Linha inválida é rejeitada sem derrubar as boas.** Recusar o arquivo inteiro
por um erro de digitação faria o gestor refazer o trabalho todo. O relatório
final diz quantas foram criadas, atualizadas e rejeitadas, e oferece um arquivo
só com as recusadas — para corrigir e reenviar apenas elas.

Campo em branco cai no padrão em vez de recusar: `status` vira `open`,
`priority` vira `medium`, `sector` vira "Não classificado". `synced_at` e
`last_sync_status` são de leitura: saem preenchidos na exportação e são
ignorados na importação.

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

## Acesso: usuários, perfis e permissões

**O login é por `username`.** O e-mail sai da autenticação e passa a servir só
à recuperação de senha: quem sabe o e-mail de alguém não deve, por isso, saber
como essa pessoa entra no sistema. Contas que já existiam ganharam um
identificador derivado do e-mail — um prefixo curto demais é completado com o
domínio, porque `a@b.com` daria um nome de um caractere.

A recusa de login é **sempre a mesma frase**, exista a conta ou não: uma
mensagem que distingue "usuário não existe" de "senha errada" é uma lista de
usuários válidos entregue a quem tenta adivinhar. Cinco erros e a conta fica
quinze minutos fora (contagem em memória, por processo).

Senha: mínimo de 8 caracteres, com letras **e** números, guardada com bcrypt.

### As três camadas da permissão

| camada | pergunta |
| --- | --- |
| **módulo** | esta pessoa vê Financeiro? |
| **ação** | dentro dele, pode criar, editar, excluir, exportar, importar? |
| **campo** | editando, pode mexer em `valor`? |

As três valem **no servidor**. O que o front esconde é conveniência; a regra é
o `exigir(modulo, acao)` das rotas, e uma recusa vira **403** e entra na
auditoria — saber o que foi tentado e recusado é metade do valor de ter
permissão.

**Sem ver o módulo, as demais ações dele não valem.** Marcar "criar" com "ver"
desmarcado daria uma matriz que mente; a gravação corrige isso na entrada.

**Campo bloqueado é a exceção, não a regra.** Sem nenhuma linha para o módulo,
valem todos os campos — exigir a lista completa transformaria cada campo novo
numa permissão esquecida. A alteração devolve o que foi retirado, para a tela
dizer o que não foi salvo em vez de fingir que salvou tudo.

### O perfil fica no vínculo com a empresa

E não no usuário. O sistema é multi-tenant por regra, e o mesmo usuário já
podia ser gestor numa empresa e leitor em outra; um perfil por usuário faria
quem é administrador numa empresa virar administrador em todas.

Sem perfil atribuído, o **papel antigo** responde: gestor edita, leitor lê. É o
que impede a migração de tirar acesso de quem já tinha — um sistema que tranca
o próprio dono na atualização não é mais seguro, é só inútil.

Dois perfis padrão por empresa. *Somente Visualização* vê o **conteúdo** e não
escreve nada — nem exporta, que é escrita nenhuma mas é saída de dado — e **não
vê os módulos administrativos** (Usuários e Integrações): quem tem acesso, com
que e-mail e papel, e o endereço de cada integração são informação de
administração, não conteúdo. *Edição* faz tudo, menos administrar acessos: dar
permissão a si mesmo é o caminho mais curto para o perfil deixar de significar
alguma coisa.

O perfil padrão não é renomeado nem excluído — a leitura de quem ainda não tem
perfil atribuído cai nele pelo nome. Para variar, **duplique**. Perfil em uso
não é excluído em silêncio.

**O gestor da empresa administra acessos por definição.** Fosse preciso um
perfil para isso, uma configuração errada trancaria todo mundo para fora da
própria tela de acessos.

### Na versão hospedada, o cadastro existe; a barreira, não

A versão hospedada roda **sem servidor próprio**: não há identidade de quem
visualiza para autenticar contra. Fingir um login ali seria teatro — qualquer
pessoa que abre a página lê a base de qualquer jeito.

O que ela oferece é o que faz sentido sem servidor, e é onde está o trabalho do
gestor: o **cadastro** de usuários, perfis e da matriz de permissões que governa
o servidor local, e a **pré-visualização** — escolher um perfil e ver a
navegação e os botões se comportarem como se comportam para quem o tem. A faixa
no topo diz que é pré-visualização e sai num clique; nada no acesso de quem
está usando muda.

**Quem recusa requisição continua sendo o servidor local.** A tela diz isso em
voz alta: prometer barreira onde não há seria pior do que não ter a tela.

### O front pergunta ao servidor o que o perfil permite

`GET /api/acesso/minhas-permissoes` é o que o app local consulta ao entrar e a
cada troca de empresa — o perfil mora no vínculo com a empresa, e a resposta da
empresa anterior não vale para a nova. O menu esconde o módulo que o perfil não
vê e os botões de escrita olham a permissão do módulo, não o papel antigo.

**Enquanto a resposta não chega, nada é escondido.** Esconder antes de saber
deixaria o menu vazio por um instante para todo mundo, e quem recusa de verdade
é o servidor — não a ausência do botão.

### Recuperação de senha

Token aleatório, guardado como **hash**, de uso único e com prazo (45 minutos
por padrão). Guardar em texto faria de um vazamento do banco um vazamento de
contas. Um pedido novo invalida os anteriores: dois links válidos ao mesmo
tempo dobram a janela de quem interceptar um.

Token inexistente, usado e vencido dão **a mesma recusa** — distinguir os três
contaria a quem tenta adivinhar quão perto chegou.

**Redefinir a senha derruba as sessões abertas.** O carimbo da troca é gravado
com milissegundos de propósito: `datetime('now')` tem resolução de um segundo,
e trocar a senha no mesmo segundo do login deixava a sessão antiga de pé —
justamente o caso de quem acabou de tomar a conta.

**Sem SMTP configurado, o sistema não diz que enviou.** A mensagem fica
registrada, com o motivo, e a tela de acesso avisa que o envio não está de pé,
sugerindo pedir a um gestor. Dizer que enviou sem ter enviado é pior do que não
enviar. O corpo do e-mail **não entra no log**: ele carrega o link. Para ligar
o envio de verdade, defina `SMTP_URL` e `SMTP_DE`.

## Expansões previstas

O modelo já acomoda novos tipos de despesa, filiais, empresas, filas e tópicos
sem migração. Ficam para etapas seguintes: multimoeda, centro de custo, fluxo de
aprovações, integração com ERP/helpdesk, API pública e webhooks.
