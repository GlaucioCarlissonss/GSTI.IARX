# Versão hospedada (Artifact)

O mesmo sistema do `server/` + `web/`, reescrito como página única sobre o
armazenamento do Claude Artifact. Existe porque o gestor precisa **operar o
sistema sem instalar nada** — sem `localhost`, sem Node, sem porta liberada.

- **Onde roda:** https://claude.ai/code/artifact/decb67fb-6b2d-4869-9f53-8f39cb68e80f
- **Quem enxerga:** privado à conta que publicou, até que seja compartilhado.
  Por declarar a capacidade `db`, a página é **interna à organização** e não
  pode ser tornada pública: todo leitor é um membro assinado da organização de
  quem publicou.
- **O que guarda:** as mesmas entidades da base local (lançamentos, projetos,
  SLA, catálogos, fechamentos, trilha de auditoria), em documentos JSON.

## Compartilhar o link

O compartilhamento é por pessoa, e o nível escolhido ali é o que decide o que
ela pode fazer:

| nível no compartilhamento | o que a pessoa faz |
| --- | --- |
| **pode ver** | consulta tudo; não cria, não altera, não exclui e **não exporta** a base |
| **pode editar** | opera o sistema como quem publicou |

Isso não é promessa da interface: a versão publicada declara
`db: { rules: [{ path: "", read: "interact", write: "admin" }] }`, e é o
**armazenamento** que recusa a escrita de quem só pode ver. Quem publicou
atende a todo nível — para ele nada muda.

Como não existe capacidade de identidade do visualizador nesta conta, a página
não tem a quem perguntar em que nível está sendo aberta: ela **descobre
tentando**, com uma gravação de sonda em `sonda/escrita` na inicialização
(`apurarEscrita`, em `app-js16.js`). Recusada a sonda, a tela entra em modo
leitura — faixa no topo dizendo que o acesso é de consulta, sem botão de sair
que não sairia de nada, e os controles de escrita e de exportação
desabilitados. É a mesma maquinaria da pré-visualização de perfil, com uma
diferença que a faixa deixa clara: a pré-visualização é escolha de quem
administra e sai num clique; o modo leitura é imposto de fora.

Onde a trava deixou de ser cosmética, o controle se declara: `data-escreve`
nomeia a ação do botão ou do campo, e é por ele que `aplicarPreviaNaTela`
desabilita. O palpite pelo rótulo continua como rede embaixo, para o controle
que ninguém marcou — foi assim que a exportação da base escapou na primeira
tentativa, porque o botão se chama "Gerar arquivo".

**O que o link carrega junto.** A base é a real: lançamentos, chamados e
projetos das empresas, incluindo descrições de folha com nome de colaborador,
históricos bancários de pagamento, e nome de solicitante, atendente e assunto
de cada chamado. Compartilhar é dar acesso a isso — a decisão de com quem é de
quem publica.

## Montar

```sh
./montar.sh          # concatena em sistema.html e roda node --check
```

A ordem em `montar.sh` não é decorativa: `app-js7.js` carrega o IIFE de
inicialização e precisa vir por último, senão os `const` dos módulos
seguintes ficam em TDZ quando ele executa.

| arquivo | conteúdo |
|---|---|
| `app-head.html` | tokens de cor, tipografia e todo o CSS |
| `app-body.html` | casca: barra superior, abas, área de página |
| `app-js1.js` | helpers de competência/dinheiro, estado `E`, camada `Loja` |
| `app-js2.js` | gráficos SVG (barras, linhas, ranking) |
| `app-js3.js` | modal, confirmação e painel executivo |
| `app-js4.js` | lançamentos: filtros, formulário, parcelamento, reclassificação |
| `app-js5.js` | projetos: Gantt mensal, tarefas, envolvidos |
| `app-js6.js` | SLA, cadastros e trilha de auditoria |
| `app-js8.js` | conferência: de onde vem cada real |
| `app-js12.js` | seletor de múltipla escolha e as fichas do que está selecionado |
| `app-js13.js` | relatório em tabela dinâmica, com drill-down em três níveis |
| `app-js14.js` | detalhamento padrão: tooltip, drill-down e gatilho acessível |
| `app-js9.js` | codec de planilha: CSV e XLSX, sem biblioteca externa |
| `app-js10.js` | importação e exportação sobre o mesmo modelo |
| `app-js11.js` | aba Dados: a ponte com o Excel |
| `app-js15.js` | integrações: conexões, eventos e o contrato de payload |
| `app-js16.js` | usuários, perfis e o modo somente leitura |
| `app-js17.js` | Indicadores Gerais: financeiro, SLA e projetos |
| `app-js18.js` | clientes: a escolha do contratante, antes de qualquer tela |
| `app-js19.js` | tela de seleção de cliente e boas-vindas |
| `app-js20.js` | cadastros de leitura: metas, acordos de SLA, plano de redução, quem reconhece despesa, e a reclassificação de prioridade |
| `app-js7.js` | abas, seletores globais e inicialização |

## Testar

`testar.cjs` abre o HTML num Chromium com um `window.claude` simulado e confere
que as telas montam sem erro de console.

```sh
mkdir -p dados                 # baixe aqui os documentos com Artifact read_db
node montar-teste.cjs           # gera teste-local.html com o mock embutido
node testar.cjs
```

`dados/` fica fora do git: são os documentos reais do cliente (nomes de
colaboradores nas descrições de folha, valores contratuais).

O mock guarda a escolha de cliente no `localStorage` para as suítes abrirem
direto a tela que cada uma testa — a escolha do contratante é anterior a todas
elas. Com `?boasVindas=1` nada é guardado, que é como `testar-clientes.cjs`
exercita a tela de verdade. O atalho vive no `montar-teste.cjs`, não no sistema.

## Escolher o cliente

A primeira tela pergunta de qual contratante são os números, e só então a barra
de filtros e a navegação aparecem. O seletor de empresa passa a oferecer apenas
as matrizes daquele cliente — é o isolamento, e é o motivo de a camada existir.

As cinco matrizes que já estavam na base (ALIANÇA, MILAGRES, MOOVE, RESIDENCIAL,
UNION) foram adotadas pelo **Grupo Brasil Home Care**, que é de quem elas são.
A adoção vale em memória mesmo quando o armazenamento recusa escrita: quem abriu
o link só para ver enxerga o mesmo sistema, sem alterar a base.

## Carga de dados

Em **Sistema → Dados**. O tipo de carga é escolhido antes de processar:
**incremental** (o arquivo do período, padrão) ou **inicial** (o histórico
inteiro). A inicial sobre uma empresa que já tem dado é recusada com o número na
frente, e a tela oferece confirmar.

Toda carga entra no **histórico** logo abaixo — inclusive a recusada, que é a
que se investiga depois. A conferência ("só conferir") não entra: prévia não é
carga.

Quando a planilha do cliente chama uma coluna de outro jeito, cadastre a
equivalência em **Cabeçalhos deste cliente**. O apelido vale só para aquele
contratante e se soma ao nome do modelo, que continua sendo aceito.

## Cadastrar cliente, matriz e filial

Em **Sistema → Clientes e unidades**. Quem decide onde a unidade entra é o CNPJ:
mesma raiz (os oito primeiros dígitos), mesma matriz. A tela avisa disso
enquanto se digita, e cadastrar como **matriz** uma raiz já conhecida é
recusado, dizendo de qual matriz aquela unidade é.

A matriz que agrupa por operação não tem CNPJ próprio — a raiz está nas filiais
dela, e é lá que ela também é procurada. Limas IT e SoulCoop entram por um
botão, e não sozinhas ao abrir: escrever na base que todo mundo enxerga tem de
ser um ato de alguém.

## Tooltips e drill-down

`app-js14.js` concentra as três peças do padrão: o texto do tooltip, a abertura
do detalhamento e `comDrill()`, que torna um elemento gatilho acessível
(`role`, `tabindex`, `aria-label`, Enter/Espaço).

Todo indicador e todo item de gráfico que tem registros por trás abre esses
registros — **com o mesmo recorte que produziu o número**. O detalhamento
mostra a contagem, a soma, o recorte aplicado e a marca *confere com o
indicador* (ou *diverge*, em vermelho). Número sem registros por trás — uma
mediana, um percentual isolado — não vira botão: continua só com tooltip.

`barras()`, `linhas()` e `ranking()` ganharam um parâmetro `aoClicar` opcional;
sem ele, o gráfico segue apenas informativo, como antes.

## Relatório com drill-down

`app-js13.js` monta a tabela dinâmica do anexo do gestor: meses nas colunas,
filial e tipo de despesa nas linhas, Total Geral nas duas pontas. Abre
**recolhido** — ao contrário do Gantt, que abre expandido —, e por isso o que
fica em `localStorage` aqui são os **expandidos**. Guardar sempre a exceção ao
padrão é o que faz uma linha nova nascer no padrão da tela.

Expandir a categoria monta os lançamentos, com a **soma do detalhe ao lado do
total da linha**: é onde uma divergência apareceria. O tooltip traz origem do
custo e destino do pagamento; o clique abre o registro inteiro.

## Navegação por módulo

A barra superior tem dois níveis: o **módulo do negócio** e, dentro dele, a
tela. Quem trabalha com dinheiro não esbarra em chamado, e vice-versa.

| módulo | telas |
|---|---|
| **Controle Financeiro** | Painel · Lançamentos · Relatório · Conferência |
| **Gestão de Projetos** | Projetos |
| **Gestão de Suporte TI** | Indicadores · Chamados · Sistema OStick · Sistema Bitrix24 · Integrações |
| **Sistema** | Dados · Cadastros · Usuários e acessos · Auditoria |

`Sistema` existe porque planilha, cadastro e auditoria atravessam os três
módulos — não cabem dentro de nenhum. Entrar num módulo abre a primeira tela
dele; módulo de tela única não ganha barra de abas, que seria um botão sozinho.

## Tema claro e escuro

O botão no topo cicla **tema do sistema → claro → escuro**, e a escolha fica em
`localStorage`. O tema é aplicado por um `<script>` no começo do arquivo, antes
do resto da página pintar: sem isso a tela abre no tema do aparelho e troca
depois, e a piscada é visível.

Trocar o tema repinta a tela inteira, e não só as cores: os gráficos são SVG
desenhado com as cores resolvidas no momento da montagem, então sem repintar
ficariam com a paleta antiga.

## Filtros

Todo filtro é seleção múltipla com caixas, e o que está escolhido aparece em
fichas removíveis logo abaixo — a escolha fica na tela sem precisar reabrir o
seletor.

| filtro | vazio significa | observação |
|---|---|---|
| Empresa | — (mínimo 1) | com mais de uma o sistema consolida; para escrever, deixe uma só |
| Filial | todas | `(empresa)` é o nível sem filial |
| Base considerada | todas as procedências | substituiu os quatro recortes fixos |
| Competência | — (mínimo 1) | vários meses somam; o painel passa a falar em período |
| Cenário | — (mínimo 1) | vários **comparam**, não somam |
| Tipo, Natureza, Classificação | todos | em Lançamentos |

**Cenário é a exceção que precisa de cuidado.** Cenários são alternativas: o
`spincare_desconto_12` contém as mesmas mensalidades do oficial, com desconto.
Somá-los contaria a mesma despesa duas vezes. Com mais de um marcado o painel
entra em modo de comparação — um indicador por cenário, uma série por cenário
no gráfico, e os rankings saem de cena até sobrar um só.

**Escrita exige empresa única.** Criar, editar e excluir precisam saber a quem
o registro pertence. Com várias empresas marcadas, o botão de lançar fica
desabilitado e as abas Cadastros e Dados explicam o motivo em vez de falhar.

## Origem do lançamento

Cada lançamento carrega `origem`, e é ela que sustenta a aba **Conferência**:

| origem | significado |
|---|---|
| `planilha` | linha importada das bases enviadas pelo gestor, valor intocado |
| `folha_ti` | custo de pessoal de TI alocado ou rateado — não existia como linha de despesa |
| `projecao_spincare` | mensalidade projetada do novo ERP, ainda não realizada |
| `manual` | criado aqui dentro por um usuário |

O seletor **Base considerada**, na barra do topo, recorta todos os números do
sistema por esse campo. É o que permite responder à pergunta que motivou a
aba: *por que o total do sistema não é o total da minha planilha?*

## Gantt agrupável

O cronograma tem dois níveis de grupo: o projeto e, dentro dele, a tarefa
principal com as suas subtarefas (até 3 níveis). Cada grupo tem um botão
**+ / −**; o padrão é expandido, e o que fica em `localStorage` é o conjunto dos
**comprimidos** — assim um grupo novo nasce aberto.

Comprimir um grupo faz a barra do pai passar a mostrar o **intervalo agregado**
da subárvore: o que sumiu da tela não pode sumir do cronograma. Acima de 60
linhas o Gantt virtualiza, com espaçadores no lugar do que está fora da janela.

As regras da hierarquia (ciclo, profundidade, exclusão bloqueada) estão em
[`docs/regras-de-negocio.md`](../docs/regras-de-negocio.md#tarefas-hierárquicas)
e valem igual nas duas versões.

## Chamados (SLA)

Um registro de SLA com `total = 1` e `dentro = 0|1` é **um chamado**. Como toda
a agregação já trabalha em cima de `total` e `dentro`, os percentuais por fila,
tópico e filial continuam saindo da mesma conta — e o registro ainda carrega o
detalhe do chamado.

Quando há `ticketId`, a aba SLA lista os chamados e o número vira link para o
osTicket, porque o id compõe a URL de origem
(`…/scp/tickets.php?id=21734`). O endereço base fica em **Cadastros → Endereço
do osTicket**; a lista mostra no máximo 300 linhas e respeita os filtros.

A carga vem de `scripts/gerar-sla.cjs <csv> <saída>`, que converte a extração do
osTicket nos documentos do sistema. O mapeamento (organização → empresa/filial,
tópico → fila, o que é descartado, e por que o SLA é `fechamento − abertura ≤
48h` em vez da coluna `est_duedate` da extração) está em
[`docs/regras-de-negocio.md`](../docs/regras-de-negocio.md#carga-da-base-do-osticket).

## Sistemas de suporte

A tela de Chamados recorta por **sistema de origem** (Sistema OStick, Sistema
Bitrix24) e por **setor / área** da solicitação, além dos filtros que já tinha.
O chamado sem sistema informado é da carga original do osTicket, anterior à
integração, e conta como OStick; o sem setor aparece como **"Não
classificado"** em vez de ficar em branco.

Na versão local existem ainda os webhooks que recebem os chamados da automação
(N8N) — a versão hospedada não os tem, porque uma página no claude.ai não expõe
endpoint HTTP. Aqui os chamados chegam pela aba **Dados**, na planilha padrão.

## Importar e exportar

A aba **Dados** fecha o ciclo com o Excel, que é onde o gestor já trabalha.

- **Exportar** monta o arquivo pelo módulo escolhido (completo, financeiro,
  projetos ou SLA), em `.xlsx` ou `.csv`, e o entrega pela capability
  `downloads` — o sandbox do visualizador bloqueia `<a download>`, então não
  há outro caminho.
- **Importar** aceita `.xlsx` e `.csv`. Reconhece cabeçalhos por apelido
  (`centro de custo` vale por `tipo de despesa`), valores em `1.234,56`,
  `(1.234,56)` e `R$ 1.234,56`, competências em `MM/AAAA`, `AAAA-MM`,
  `dd/mm/aaaa` e na serial do Excel.
- **Nada aborta o lote:** cada linha inválida entra num relatório com o número
  da linha e o motivo; as boas passam.
- **Nada duplica:** a deduplicação é por conteúdo, com contador de ocorrência,
  igual à da versão local — a n-ésima linha repetida no arquivo casa com a
  n-ésima já existente. Duas notas legitimamente iguais no mês continuam
  valendo por duas; reimportar a própria exportação cria zero registros.
- **Só conferir** roda tudo sem gravar e mostra o que aconteceria.

`app-js9.js` traz o codec de planilha sem biblioteca externa: escrever `.xlsx`
é montar um zip de partes OOXML com entradas *stored*; ler usa
`DecompressionStream('deflate-raw')`, que o navegador já tem, porque arquivos
vindos do Excel chegam comprimidos. Não há CDN envolvido.

### Verificação

Vinte e uma suítes, todas contra um `window.claude` simulado num Chromium real:

| script | o que cobre |
|---|---|
| `testar.cjs` | fumaça: as abas montam, os seletores funcionam |
| `testar-completo.cjs` | as 5 empresas × todas as abas, tempo de render, erro de console, rolagem horizontal a 400 px |
| `testar-edicao.cjs` | criar, parcelar, reclassificar, excluir, fechar e reabrir competência, conferindo totais e trilha de auditoria |
| `testar-coerencia.cjs` | os números de cada tela fecham entre si: KPI × rankings, conferência por origem × mês a mês, rodapé × linhas |
| `testar-projetos-sla.cjs` | projetos (atraso e desvio derivados), SLA (percentual, recusa de `dentro > total`) e o ciclo de planilha do SLA |
| `testar-isolamento.cjs` | nada atravessa a empresa, inclusive com as cinco carregadas em memória; cadastros não vazam |
| `testar-multi.cjs` | filtros de múltipla escolha: somar meses, consolidar empresas, recortar por procedência, comparar cenários, fichas e mínimos |
| `testar-dados.cjs` | exportar, reimportar sem duplicar, importar planilha quebrada sem derrubar o lote |
| `testar-navegacao.cjs` | os quatro módulos e suas telas; o tema ciclando, persistindo e com contraste em todas as telas |
| `testar-hierarquia.cjs` | o que a hierarquia de tarefas recusa (ciclo, 4º nível, si mesma) e o Gantt agrupado: teclado, `aria-expanded`, barra agregada e persistência |
| `testar-suporte.cjs` | os dois sistemas de origem na mesma tabela, o recorte por sistema e por setor, e os indicadores acompanhando o recorte |
| `testar-relatorio.cjs` | o relatório contra **os números do anexo do gestor**, filial a filial e categoria a categoria, mais os três níveis do drill-down |
| `testar-drill.cjs` | tooltip em todo gráfico e drill-down em todo indicador: acessibilidade, teclado, e a soma do detalhe conferindo com o número clicado |
| `testar-modais.cjs` | telas flutuantes: alças de redimensionar, tela cheia, cabeçalho e rodapé presos, coluna ajustável e tamanho que persiste |
| `testar-acessos.cjs` | Integrações (contrato do payload, upsert por id externo, evento com erro e reprocessamento) e Acessos (perfis padrão, login separado do e-mail, matriz, pré-visualização de perfil) |
| `testar-clientes.cjs` | o cliente como recorte externo: árvore de unidades, troca de contratante, nada atravessando |
| `testar-carga.cjs` | carga inicial × incremental, adaptador de cabeçalho do cliente e o histórico de toda tentativa |
| `testar-indicadores.cjs` | Indicadores Gerais: indicadores empilhados em largura total, drill em todo card com número, cor por matriz e a árvore de três níveis (empresa → filial → lançamentos) com barra de representatividade |
| `testar-visao.cjs` | blocos que abrem e lembram, os três modos de ver os números e o selo de última atualização |
| `testar-metas.cjs` | o cadastro de metas e o Meta vs Resultado: base sem meta segue no 80, a meta cadastrada atravessa a tela, desativar volta ao padrão |
| `testar-reclassificacao.cjs` | a prioridade do chamado: começa indefinida (a extração não traz), exige cargo e nome de quem pediu, e o histórico fica na linha |
| `testar-rateio.cjs` | o rateio das compartilhadas: a soma das parcelas fecha exatamente, o grupo inteiro entra na tabela, e a leitura integral continua ao lado como o "antes" |
| `testar-reducao.cjs` | o plano de redução: sem cadastro o indicador diz isso, cadastrar muda o indicador do topo, e desativar devolve ao vazio |
| `testar-acordos.cjs` | o acordo de SLA que decide: a vigência escolhe pela abertura do chamado, a prévia não grava, a reaplicação vira dentro/fora, agregado e sem-prioridade ficam de fora, e mês fechado recusa |
| `testar-reconhecedores.cjs` | quem reconhece despesa: o mesmo nome escrito de outro jeito é a mesma pessoa, a prévia não grava, aplicar marca só quem o cadastro alcança, e desativar não desfaz o passado |

`testar-isolamento.cjs` exercita a regra multi-tenant no estado mais
arriscado, não no mais confortável: com **todas** as empresas carregadas ao
mesmo tempo, que é o que a aba Conferência provoca ao somar o grupo. É aí que
um vazamento apareceria.

`testar-coerencia.cjs` existe por um motivo específico: a reclamação que
originou a aba Conferência foi "os valores não estão coerentes". Um KPI que
não bate com o ranking logo abaixo dele é a mesma classe de problema, então
virou verificação automática em vez de cuidado manual.

### Testar o ciclo

```sh
node montar-teste.cjs
CHROMIUM_BIN=/caminho/chromium node testar-dados.cjs
```

O teste exporta, reimporta o próprio arquivo (esperado: zero criados, tudo
duplicata), depois importa um CSV com quatro linhas quebradas e confere que só
elas ficam de fora.
