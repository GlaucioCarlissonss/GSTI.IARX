# SYSTEM PROMPT — REWORK DO OBJETIVO 01: REDUÇÃO DE CUSTO (GRÁFICO DE BARRAS)

## PAPEL E MODO DE TRABALHO

Você trabalha no repositório **GSTI.IARX**, branch `iarx/dazzling-bell-8emtt8`.

Execute em **ENTREGAS SEQUENCIAIS R1 a R5**. Ao concluir cada uma:

1. `cd artifact && ./montar.sh && node montar-teste.cjs`
2. Rode as suítes afetadas (`CHROMIUM_BIN=/opt/pw-browsers/chromium node testar-*.cjs`)
3. Confira no navegador, nos **dois temas**
4. Commit e push na branch
5. **REPUBLIQUE O ARTIFACT** em `https://claude.ai/artifact/UWg6VvqWf7RYDokLDLgnMk`
   (`Artifact action:"read"` antes; `action:"publish"` com `url`, sem `capabilities`,
   sem `icon`, sem `contract` — omitir preserva a declaração guardada)
6. Apresente um resumo e **PARE**, aguardando OK explícito

> **A republicação não é opcional nem é um passo à parte.** O usuário valida
> **pela interface**, e a página no ar é a única superfície que ele enxerga.
> Uma entrega comitada e não publicada é, para ele, uma entrega que não existe —
> isso já aconteceu uma vez e custou uma rodada inteira.

**Por que R1–R5 e não E1–E5:** já existe um plano em andamento com Entregas 1 a 6
(E1 estrutura/filtros, E2 Objetivo 01, E3 Objetivo 02, E4–E6 os três Faróis), e as
E3 a E6 continuam pendentes. Reusar a numeração faria duas entregas diferentes
atenderem pelo mesmo nome.

---

## ESCOPO

**Só o `artifact/`.** O app React (`web/`) e o servidor (`server/`) ficam fora,
como foi decidido para as entregas anteriores deste indicador. Não mexa em
`server/src/domain/indicadores.ts` nem em `web/src/pages/IndicadoresGerais.tsx`.

**Arquivos que esta obra toca:**

| arquivo | o quê |
| --- | --- |
| `artifact/app-js17.js` | o cálculo e o card do Objetivo 01 (`calcularPlanoReducao`, `janelaDoObjetivo`, o bloco `chave: 'plano-reducao'`) |
| `artifact/app-js2.js` | `barras()`, `linhas()`, `mostrarDica`, `ligarDica` |
| `artifact/app-head.html` | CSS (tokens de cor, caixas fixas, legenda) |
| `artifact/testar-reducao.cjs` | a suíte do indicador |
| `docs/regras-de-negocio.md` | a seção "Objetivo 01: Redução de Custo — o indicador" |

---

## O QUE JÁ EXISTE (não reescreva)

**`barras(alvo, pontos, series, modo, fmt, fmtEixo, aoClicar)`** — `app-js2.js:82`.
Já entrega, pronto:

- empilhamento por série (`modo = 'empilhado'`), com `pathBarra` arredondando o topo;
- escala do eixo Y dinâmica, via `escalaBoa(max)`;
- **tooltip no hover com a cor de cada série ao lado do nome e do valor**, mais a
  linha de Total — é `mostrarDica(ev, p.rot, [{nome, cor, valor}])`;
- **clique com `role="button"`, `tabindex="0"`, Enter e Espaço** e `aria-label`;
- rótulo de mês no eixo X, ralado automaticamente acima de 13 pontos.

**Consequência para o plano:** R1, R2 e R3 são, em boa parte, **ligar este helper**
e alimentá-lo com uma série por tipo de despesa. O trabalho novo de verdade está em
R4 (projeção + linha de topo) e R5 (marcadores de meta), que exigem estender
`barras()` com uma camada de sobreposição.

Outras peças prontas, a reusar e não a duplicar:

- `abrirRegistros({titulo, tipo, colunas, itens, contagem, nota})` — a tela flutuante
  de drill-down, com cabeçalho preso, redimensionamento e tela cheia;
- `COLUNAS_LANCAMENTO_SIMPLES` — o conjunto de colunas de lançamento;
- `ligarDica(elemento, montar)` — hover com atraso de 180 ms, contenção de borda
  e foco de teclado;
- `ligarKpis(mapa)` — o `dica`/`abrir` de cada card, endereçado por `data-kpi`;
- `janelaDoObjetivo()` e `calcularPlanoReducao(r)` — a conta atual do indicador.

---

## DECISÕES QUE VOCÊ PRECISA TOMAR ANTES DE CODAR R1

Quatro pontos onde o enunciado não fecha sozinho. **Pergunte ao usuário** (uma
pergunta por ponto, com a sua recomendação em primeiro lugar) e só então comece.
Não escolha em silêncio: cada um muda o número na tela.

**1. A cor por tipo de despesa colide com a cor por empresa.**
As oito cores do sistema (`--m1`…`--m8`, via `corDaMatriz`) significam **empresa**, e
essa legenda já aparece em outros indicadores do mesmo bloco Financeiro. Pintar tipo
de despesa com elas faria a mesma cor dizer "HR-PE" num card e "Telefonia" no card
de cima. Opções: (a) paleta nova, própria para tipo de despesa, declarada em
`app-head.html` com contraste conferido nos dois temas; (b) reusar as oito e aceitar
a colisão. Recomende (a). Na base do cliente há **7 tipos de despesa fixa**; preveja
o caso de haver mais que a paleta, agrupando o excedente em "Outros" — que é a regra
que `corDaMatriz` já usa para a nona empresa.

**2. "Linha verde = metas e plano de redução" mistura duas unidades.**
No cadastro, `metas` guarda **percentual** (`alvoPct`, que é um TETO de variação do
custo fixo) e `planos_reducao` guarda **reais** (`valorAlvo`, mensal). O enunciado
descreve a verde como um valor que a vermelha "acompanha" — isto é, reais. Uma meta
percentual **não tem valor em reais por si só**: ela só vira reais quando aplicada
sobre o mês anterior (`custo do mês anterior × (1 + alvoPct/100)`). Proponha ao
usuário: a linha verde é o **teto mensal em reais**, derivado dos dois cadastros —
para a meta percentual, o teto aplicado ao mês anterior; para o plano, a soma dos
alvos mais o custo fixo que está fora do plano. Escreva a fórmula escolhida na tela
(nota do card) e em `docs/regras-de-negocio.md`. **Sem isso, "a vermelha seguiu a
verde" não é uma afirmação verificável.**

**3. Este rework se sobrepõe ao "Farol 3" ainda pendente.**
A E6 do plano em andamento pede, com estas palavras, um *"Custo recorrente Mês a Mês
com projeção futura, detalhe no hover e clique abrindo tela flutuante"*. É quase o
mesmo objeto. Pergunte se o Objetivo 01 **absorve** o Farol 3 (e a E6 sai do plano)
ou se os dois coexistem — e, nesse caso, qual é a diferença entre eles.

**4. As caixas fixas de meta vão se sobrepor.**
O enunciado pede uma caixa **fixa** (não tooltip) acima do ponto de cada mês com
meta, e admite **mais de uma meta no mesmo mês**. Com 12 meses na janela e duas metas
em alguns, as caixas se empilham em cima umas das outras e o gráfico some debaixo
delas. Proponha: caixa fixa **só nos meses com meta**, com no máximo N visíveis
(as de maior valor), colisão resolvida deslocando na vertical, e um "+2" que abre as
demais no hover. Se o usuário quiser todas sempre visíveis, faça — mas diga antes o
que acontece com a legibilidade.

---

## CONCEITO DE NEGÓCIO (a preservar em todas as entregas)

- **Vermelho = custo fixo REALIZADO** de todas as despesas fixas do mês.
- **Verde = o teto** que metas e plano de redução impõem àquele mês.
- Vermelho **igual ou abaixo** do verde no mês → meta **alcançada** naquele mês.
- Vermelho **acima** do verde → **não alcançada**.
- A leitura é **mês a mês**, e não uma única nota do período: dentro da mesma janela
  pode haver mais de uma meta vigente, cada uma regendo os seus meses.

**Regras do indicador que já valem e continuam valendo** (não as reabra nesta obra):

- só despesa de **natureza fixa** entra;
- tudo é **por mês** — o alvo cadastrado é custo mensal, não do período;
- a janela é a da **meta cadastrada**, e **não** a do filtro de período do bloco;
  o filtro de **filial** continua valendo (diz de quem é a leitura, não de quando);
- posição **1** da pilha do bloco Financeiro;
- título **"Objetivo 01: Redução de Custo"** e descrição recuada
  **"Plano de Redução de Custos sobre Despesas Fixas(Mensais)"**;
- sem meta ou sem plano cadastrado, o farol fica **cinza** — nunca vermelho.

---

## R1 — BARRAS MENSAIS EMPILHADAS POR TIPO DE DESPESA FIXA

Substituir o gráfico de linhas do card pelo de barras.

- **Uma barra por mês** da janela do objetivo (competência `AAAA-MM`, rotulada `MM/AAAA`).
- **Empilhada por tipo de despesa fixa**, uma cor por tipo, pela decisão do ponto 1.
- A **altura total da barra é o custo fixo do mês** — o mesmo número que o card já
  chama de `fixasDoMes`. Confira que fecha: a soma dos segmentos tem de ser
  exatamente a altura, em centavos, sem desvio de arredondamento.
- **Legenda por tipo** abaixo do gráfico, no molde de `legendaDeMatrizesHtml`, com o
  quadradinho de cor, o nome e o valor.
- A ordem dos segmentos dentro da barra é por **valor decrescente** no mês de
  referência, e **a mesma em todas as barras** — reordenar por mês faria a mesma cor
  saltar de posição e a comparação visual entre meses deixaria de existir.
- Eixo Y dinâmico (já vem de `escalaBoa`); dark mode e tema claro conferidos.

**Aceite:** uma barra por mês; segmentos por tipo; legenda coerente; soma dos
segmentos = custo fixo do mês; nada quebrado nos dois temas.

**[PARE E AGUARDE OK]**

---

## R2 — TOOLTIP NO HOVER

`barras()` já mostra `{nome, cor, valor}` por série mais o Total. O que falta:

- acrescentar o **mês/competência** ao título do balão (hoje é `p.rot`, confira que
  sai `MM/AAAA` e não a forma interna);
- **atraso de 180 ms** e contenção de borda — use `ligarDica`, que já tem os dois,
  em vez do `mousemove` cru que `barras()` usa hoje;
- **foco de teclado** dispara o mesmo balão, posicionado por `getBoundingClientRect`;
- segmento com valor zero **não aparece** no balão: uma linha "R$ 0,00" faz procurar
  uma despesa que não existe.

**Aceite:** hover em qualquer segmento mostra tipo + cor + valor + mês; o balão não
corta nas bordas; Tab até a barra abre o mesmo balão.

**[PARE E AGUARDE OK]**

---

## R3 — CLIQUE ABRE OS LANÇAMENTOS

- Clicar na barra (ou no segmento) abre `abrirRegistros`, a tela flutuante padrão.
- Lista os lançamentos **que compõem exatamente o número clicado** — clicar no
  segmento "Telefonia" de 04/2026 abre as despesas fixas de Telefonia de 04/2026,
  e não o mês inteiro.
- **Todas as informações do lançamento**: competência, empresa, filial, tipo,
  descrição, fornecedor, origem, natureza, classificação, valor, reconhecimento.
  Comece de `COLUNAS_LANCAMENTO_SIMPLES` e acrescente o que faltar.
- **Ordenação do MAIOR para o MENOR valor**, que é a regra da tela inteira.
- A tela declara o recorte no título e traz a **soma**, com a marca "confere com o
  indicador" — é o contrato de drill-down que o sistema já cumpre em todo card.
- Montagem sob demanda: nada de listar ao pintar o gráfico.

**Aceite:** clique abre a tela; os lançamentos são os do número clicado e somam ele;
ordenados por valor decrescente; todas as informações à vista.

**[PARE E AGUARDE OK]**

---

## R4 — PROJEÇÃO FUTURA E LINHA AZUL DE TOPO

- **Meses futuros** (depois do último mês realizado) ganham barra **projetada**,
  replicando a composição por tipo do **último mês realizado**.
- Defina e escreva na tela o que é "último mês realizado": é o **mês de referência**
  que o indicador já calcula (`plano.referencia`), o último com despesa fixa dentro
  da janela. O mês corrente não conta como realizado — ele está pela metade, e usar
  um mês incompleto como base da projeção jogaria a projeção inteira para baixo.
- **Projeção é visualmente distinta** do realizado: opacidade reduzida ou hachura,
  **mais** o rótulo "projetado" no balão e na legenda. A distinção nunca pode ser só
  a opacidade — é a regra de acessibilidade do projeto ("a cor nunca é o único canal").
- **Linha azul** contínua tocando o topo de cada barra, realizada e projetada, com um
  ponto por mês. Ela é o custo fixo total mês a mês, e serve à **tendência**: o
  objetivo dela é ligar os topos, não repetir a altura que a barra já mostra.
- No balão do mês, distinga "realizado" de "projetado" em palavras.

**Aceite:** barras futuras projetadas a partir do mês de referência e visivelmente
distintas, com rótulo em texto; linha azul tocando o topo de todas as barras.

**[PARE E AGUARDE OK]**

---

## R5 — MARCADORES DE META: CINZA, VERDE E VERMELHO

Para cada mês com **meta** e/ou **plano de redução** vigente:

- o ponto da linha azul vira **cinza** — é o marcador de "aqui há um compromisso";
- acima dele, uma **caixa fixa** (não tooltip) com o **tipo de despesa a reduzir**,
  o **valor da meta** (o teto em reais da decisão do ponto 2), o **valor realizado**
  e o **status**;
- **meta alcançada** (realizado ≤ teto) → ponto e caixa em **verde**;
- **não alcançada** (realizado > teto) → ponto e caixa em **vermelho**;
- **mês futuro**, cujo realizado ainda não existe: o ponto fica **cinza** e a caixa
  diz "a apurar". Pintar de verde ou vermelho um mês que não aconteceu seria afirmar
  um resultado inventado.
- **Mais de uma meta no mesmo mês**: uma caixa por meta, pela regra de colisão da
  decisão do ponto 4.
- **A linha verde permanece**, como teto mensal, para a comparação visual com o topo
  das barras — é ela que dá sentido à frase "a vermelha seguiu a verde".
- **A cor nunca decide sozinha**: junto vão o símbolo (✓ / ✗ / ·), a palavra
  ("alcançada" / "não alcançada" / "a apurar") e o `aria-label` com a frase inteira.
  Isto não é preferência: é a regra escrita do projeto, e os dois faróis do card já
  a cumprem.

**Aceite:** mês com meta tem ponto cinza e caixa fixa com o tipo de despesa;
alcançada pinta verde, não alcançada pinta vermelho, futuro fica cinza; duas metas
no mesmo mês aparecem juntas; a linha verde está no gráfico junto das barras.

**[PARE E AGUARDE OK]**

---

## REGRAS FINAIS

**Convenções deste código, que não são negociáveis:**

- competência interna `AAAA-MM`, exibida `MM/AAAA` — use `mesExib`, `mesInterno`,
  `mesSoma`, `mesHoje`, `ordenado`;
- **dinheiro em centavos inteiros** (`cent`, `reais`, `somaC`); nunca some reais
  em ponto flutuante;
- comentários em **português**, explicando **por que** e não o que;
- `montar.sh` aborta em erro de sintaxe (`node --check` sobre o pacote concatenado) —
  é a rede de segurança destas edições grandes em `app-js17.js`.

**Acessibilidade:** contraste AA nos dois temas, navegação por teclado em todo
gatilho, `aria-label` em todo gráfico e marcador, e a cor nunca como canal único.

**Desempenho:** montagem sob demanda no drill-down; não repinte o gráfico a cada
`render()` se os dados não mudaram.

**Escopo:** não altere funcionalidade fora das entregas. Em particular, não reabra a
janela do objetivo, a regra de "só fixa", a conta mensal nem a posição do card — são
decisões já validadas.

**Privacidade, que vale sempre:** nunca aponte script de verificação para
`data/gsti.sqlite` (tem dado real de cliente — pessoas, salários, contratos);
`dados-origem/`, `artifact/dados/`, `artifact/sistema.html` e
`artifact/teste-local.html` são gitignored de propósito; CSV real nunca é comitado,
e fixture de teste é anonimizada.

**Ao final das cinco entregas aprovadas**, faça uma revisão geral de consistência —
paleta por tipo, projeção, marcadores de meta, drill-down, ordem decrescente e os
dois temas — e reporte o resultado.
