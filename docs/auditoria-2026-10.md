# Auditoria do código-fonte — outubro de 2026

Diagnóstico medido, sem alteração de código. Todo número aqui foi contado por
varredura do repositório na data acima; onde a medida tem ressalva, ela está
escrita ao lado.

---

## 1. Inventário

O sistema tem **três superfícies**, e isso é a primeira coisa que o plano de
limpeza precisa tratar, porque elas não compartilham código:

| superfície | o que é | arquivos | linhas |
| --- | --- | ---: | ---: |
| `server/src` | API Express + SQLite, domínio e rotas | 72 | 20.842 |
| `web/src` | app React (Vite), consome a API | 40 | 16.412 |
| `artifact/` | o sistema inteiro num HTML, sobre o armazenamento do Claude | 72 | 26.822 |

**A versão hospedada é a maior das três** e é a que o gestor usa hoje. Ela é
montada por `montar.sh`, que concatena 22 arquivos `app-js*.js` num único
`<script>` — 970 KB em `sistema.html`.

### Os dez maiores arquivos

| linhas | arquivo |
| ---: | --- |
| 4.622 | `artifact/app-js17.js` (Indicadores Gerais) |
| 1.520 | `artifact/app-js21.js` (Projeto SpinCare) |
| 1.452 | `web/src/pages/Administracao.tsx` |
| 1.434 | `server/src/domain/importacao.ts` |
| 1.317 | `web/src/components/graficos.tsx` |
| 1.202 | `web/src/pages/Planilhas.tsx` |
| 1.133 | `server/src/domain/indicadores.ts` |
| 1.094 | `artifact/app-js20.js` |
| 1.058 | `artifact/app-js1.js` |
| 1.039 | `server/src/domain/financeiro.ts` |

---

## 2. Achados, por prioridade

### 🔴 CRÍTICO — 10 testes que o CI nunca executa

`npm test` dá **412 de 422** nesta máquina. O CI dá **verde**, rodando o mesmo
comando. As duas coisas são verdade ao mesmo tempo, e a explicação é o achado:

```
server/test/importacao-foc.test.ts:22
const semBase = { skip: existsSync(ARQUIVO) ? false : 'base real ausente...' };
```

Os dez testes da carga FOC só rodam **quando o arquivo real do cliente está
presente** em `dados-origem/`, que é ignorado pelo Git de propósito (contém
nome, matrícula e salário). No CI o diretório não existe: os dez são
**pulados**, e o verde não diz nada sobre eles.

Aqui eles rodam — e falham, todos pela mesma razão:

```
error: 'Alterações em competências passadas (09/2026) exigem justificativa.'
garantirCompetenciaEditavel (domain/fechamento.ts:38)
```

A planilha real é de **09/2026** e o relógio virou outubro. A regra está
certa; o teste é que supõe estar sempre dentro do mês do arquivo.

São **dois problemas empilhados**, e vale separá-los:

1. **Os dez testes mais caros do projeto — carga real de ponta a ponta — não
   são verificados por ninguém automaticamente.** Eles só rodam na máquina de
   quem tem a base do cliente, e lá quebram sozinhos com a virada do mês. Na
   prática, deixaram de ser rede de segurança.
2. **A suíte envelhece.** Três suítes do artifact (`testar-multi`,
   `testar-adequacao`, `testar-reducao`) têm o mesmo mal, e essas eu já tinha
   reportado como pré-existentes.

> **Os testes NÃO tocam a base real do cliente** — conferi: `test/apoio.ts`
> abre `:memory:`. O que vem de `dados-origem/` é só o arquivo de entrada da
> carga, lido para dentro de um banco descartável.

> **Correção proposta:** o teste deixa de supor o mês corrente — passa a
> informar justificativa onde a competência é passada, que é o que a regra
> pede, ou a derivar a competência do próprio arquivo. E a decisão maior, que
> é sua: ou se aceita que essa carga não é coberta pelo CI, ou se cria uma
> fixture anonimizada do FOC para que ela passe a ser — como já foi feito para
> o Contas a Pagar (`test/dados/contas-pagar-exemplo.csv`).

### 🔴 CRÍTICO — nenhum code splitting na web

`web/dist/assets/index-*.js` tem **546.716 bytes num único arquivo**. `App.tsx`
faz **22 imports estáticos** e `React.lazy` não aparece em lugar nenhum: abrir a
tela de Login baixa Relatório, Planilhas, Administração e tudo o mais.

`React.memo` também não aparece — há 27 `useMemo` e 29 `useCallback`, então a
memoização existe dentro dos componentes, mas nenhum componente é memoizado
como um todo.

### 🟡 MÉDIO — 17 símbolos sem nenhuma referência

Contados por varredura de ocorrência no repositório inteiro (declaração +
usos); entram aqui só os que aparecem **uma vez**, na própria declaração.

**Artifact (10):**

| arquivo | símbolo | observação |
| --- | --- | --- |
| `app-js1.js:417` | `filiaisDaTela` | |
| `app-js1.js:819` | `abrirBloco` | o vivo é `abrirBlocos`, que é helper de teste |
| `app-js1.js:849` | `filasDoEscopo` | 35 linhas |
| `app-js17.js:3972` | `sanfonaHtml` | substituída por `arvoreDeUnidadesHtml` |
| `app-js17.js:4165` | `ligarSanfonasDeUnidade` | idem |
| `app-js17.js:4299` | `COLUNAS_LANCAMENTO_SIMPLES` | |
| `app-js18.js:97` | `clienteGuardado` | **ficou morta na entrega da abertura** |
| `app-js18.js:295` | `ehMatrizCnpj` | |
| `app-js20.js:892` | `planosVigentes` | |
| `app-js22.js:58` | `horaDecimal` | **nasceu morta no motor de horas úteis** |

**Servidor (6):** `somenteGestor` (`middleware/index.ts:148`),
`ROTULO_MODULO_META`, `COLUNAS_USADAS`, `listarAcessosNegados`, `formatarBRL`,
`urlBaseDoCliente`.

**Web (1):** `Detalhavel` (`components/detalhamento.tsx:191`).

> Dois desses são meus e entraram nas últimas duas semanas. `clienteGuardado`
> ainda carrega um comentário meu dizendo que "serve ao cadastro" — **não
> serve**: ninguém a chama. O comentário está errado e sai junto.

### 🟡 MÉDIO — 74 tipos exportados sem uso externo

No servidor, 74 `export type` / `export interface` são usados só dentro do
próprio arquivo. Não é código morto — é superfície pública maior do que
precisa ser, o que faz qualquer refatoração parecer quebra de contrato.

### 🟡 MÉDIO — `zod` declarado e nunca importado

`server/package.json` traz `zod` nas dependências; não há um `import` sequer em
`server/src`. A validação é feita à mão.

### 🟡 MÉDIO — cinco caminhos para abrir "os registros por trás do número"

No artifact convivem cinco funções que fazem a mesma coisa com contratos
diferentes:

| função | chamadores | contrato de coluna |
| --- | ---: | --- |
| `abrirRegistros` (`app-js17`) | 16 | `{rotulo, campo\|valor, n, texto}` |
| `detalharChamados` (`app-js14`) | 11 | lista + total |
| `abrirDetalhe` (`app-js17`) | 6 | `{itens, esperado}` |
| `abrirDetalhamento` (`app-js14`) | 5 | `{colunas, linhas, total, somar}` |
| `abrirChamadosSla` (`app-js22`) | 5 | lista, ordenada por tempo |

A divergência já custou um defeito nesta sessão: `abrirRegistros` exigia
`valor` como função onde `abrirDetalhamento` aceitava o atalho `campo`, e o
drill-down quebrava com `c.valor is not a function`. **Todas as cinco montam
sobre `abrirModal`** — a consolidação é possível sem tocar em `abrirModal`.

### 🟡 MÉDIO — a mesma regra escrita duas e três vezes

| função | web | artifact | servidor |
| --- | --- | --- | --- |
| `pct` | `components/graficos.tsx` | `app-js1.js` | `domain/indicadores.ts` |
| `corCompartilhada` | `components/consumo.tsx` | `app-js1.js` | — |
| `leituraDeMeta` | — | `app-js1.js` | `domain/dashboards.ts` |
| `brl` | — | `app-js1.js` | `db/seed.ts` |

Isso é **estrutural**, não descuido: o artifact não importa do servidor por
construção. Unificar de verdade exigiria um pacote compartilhado, que é
mudança de arquitetura — fora do escopo de "limpeza". O que cabe aqui é
**documentar os pares** e acrescentar teste de coerência onde o número tem de
bater, como já existe para o rateio.

### 🟢 BAIXO — estilo inline e valores mágicos

| | ocorrências | arquivos |
| --- | ---: | ---: |
| `style={{...}}` na web | 346 | 28 |
| `style="..."` no artifact | 484 | 18 |
| `px` literal dentro de `style` inline (artifact) | 305 | — |
| cor hex crua fora de `app-head.html` | 3 | — |

A boa notícia: **as cores já estão tokenizadas** (só 3 hex cruas em 26 mil
linhas). O que está espalhado é **espaçamento e tamanho** — 305 `px` literais.
É exatamente o que a Entrega 3 pede para centralizar.

### 🟢 BAIXO — acessibilidade e estados

Já há base: 53 `aria-label` e 25 `aria-expanded` no artifact, 34 `aria-label` na
web, nenhum `<button>` vazio sem rótulo, 104 estados vazios tratados (`.vazio`).

O buraco é o **estado de carregando**: uma única ocorrência no artifact inteiro.
As telas pintam direto do armazenamento em memória, então quase nunca há espera
— mas a carga de planilha e o drill-down de 10 mil chamados têm, e hoje a tela
fica parada sem dizer nada.

### 🟢 BAIXO — tipografia

Hoje: **IBM Plex Sans + IBM Plex Mono**. A Entrega 4 pede fonte "distinta e
única" e proíbe genéricas (Arial, Inter, Roboto). IBM Plex não é genérica, mas
também não é memorável — e a mono já cumpre bem o papel de rótulo técnico.

---

## 2.1 Entrega 1.5 — executada

| | antes | depois |
| --- | --- | --- |
| `npm test` (servidor) | 412 / 422 | **422 / 422** |
| suítes do artifact | 38 verdes, 3 vermelhas | **41 verdes** |

**O conserto foi o mesmo nos dois lados: dizer em voz alta de quando a suíte
fala.** Nenhuma regra de negócio mudou, e nenhum número esperado foi relaxado
para caber no resultado.

- **Servidor** — `importacao-foc.test.ts` congela `Date` em 15/09/2026 com
  `mock.timers`. A planilha real é de setembro, a carga grava naquela
  competência, e a regra recusa escrita em competência passada sem
  justificativa. A suíte sempre pressupôs estar dentro do mês do arquivo; agora
  isso está escrito. Só `Date` é fingido — temporizadores seguem reais, e o
  SQLite calcula o `datetime('now')` dele por conta própria.
- **Artifact** — `congelarRelogio()` novo em `ajuda-testes.cjs`, aplicado a
  `testar-multi`, `testar-adequacao` e `testar-reducao`. O sistema escolhe a
  competência padrão como *a última encerrada* (`competenciaPadrao`), então em
  setembro o padrão era 08/2026 e em outubro virou 09/2026 — e as suítes
  passaram a comparar totais de meses diferentes. O relógio **anda**; o que se
  fixa é o ponto de partida, por deslocamento constante, para não quebrar
  animação, `setTimeout` nem a medição de "prazo estourado".

**Um defeito que esta entrega revelou e que era meu:** `testar-multi` lia o KPI
da tela inicial sem navegar até ela. Quando a abertura passou a cair em
Indicadores Gerais, a suíte passou a ler uma tela que não era a que ela
descrevia — e o sintoma virou `null` em cima de um erro que já existia. A suíte
passou a dizer a tela (`irPara('Painel')`) em vez de herdá-la.

**O que NÃO foi feito, e continua sendo decisão sua:** a carga FOC segue
coberta por dez testes que o CI **pula**, porque dependem do arquivo real em
`dados-origem/`. Criar uma fixture anonimizada do FOC — como existe para o
Contas a Pagar — é o que os traria para dentro do CI, e é trabalho de outra
ordem. Enquanto isso não acontece, o verde do CI não diz nada sobre essa carga.

---

## 2.2 Entrega 2 — limpeza de código morto (executada)

**Os 17 símbolos saíram**, e `node --check` mais a varredura de declarações
confirmam: **zero declarações de topo sem uso no artifact** (eram 10 de 619).

| superfície | removido | efeito medido |
| --- | --- | --- |
| artifact | 10 símbolos | `sistema.html` de 970.334 → **968.183 bytes** (−2.151) |
| servidor | 6 símbolos (≈56 linhas) + a dependência `zod` | 422/422 testes, `tsc` limpo |
| web | `Detalhavel` (33 linhas) | bundle **byte a byte idêntico** |

Dois resultados que merecem ser ditos em voz alta, porque contrariam o que se
esperaria:

- **O bundle da web não encolheu um byte.** `index-DKC7fpBb.js` saiu do build
  com 546.716 bytes e o mesmo hash de conteúdo de antes. O Vite já descartava
  `Detalhavel` por *tree-shaking*: a limpeza vale para quem lê o código, não
  para quem baixa a página. Qualquer promessa de "reduzir o bundle removendo
  código morto" seria falsa — o ganho de bundle virá do *code splitting*, na
  Entrega 6.
- **Dois dos dez símbolos do artifact eram meus**, das duas semanas
  anteriores: `horaDecimal` nasceu sem chamador no motor de horas úteis, e
  `clienteGuardado` ficou órfã quando a abertura passou a sempre perguntar —
  carregando um comentário meu que afirmava que ela "serve ao cadastro". Não
  servia. O comentário saiu junto com a função.

Outros dois eram **atalhos de compatibilidade cujos chamadores não existem
mais**: `sanfonaHtml` e `ligarSanfonasDeUnidade` apenas repassavam para
`arvoreDeUnidadesHtml` e `ligarArvoresDeUnidade`, com o comentário "para quem
o chama" — e ninguém chamava desde a entrega da árvore de três níveis.

**O que ficou de fora desta entrega, de propósito:** a consolidação dos cinco
caminhos de detalhamento. São 43 chamadores, e misturar isso com a remoção de
código morto tiraria de qualquer um dos dois a chance de ser verificado em
separado. Fica para uma entrega própria.

---

## 2.3 Entrega 3 — tokens de espaçamento e raio (executada, nas duas pontas)

**Escala única, com os mesmos nomes no artifact e na web**, declarada em
`artifact/app-head.html` e `web/src/estilos.css`:

```
--esp-1: 2px   --esp-2: 4px   --esp-3: 6px   --esp-4: 8px    --esp-5: 10px
--esp-6: 12px  --esp-7: 14px  --esp-8: 16px  --esp-9: 20px   --esp-10: 24px
--raio-p: 5px  --raio-m: 8px  --raio-g: 12px --raio-redondo: 999px
```

| | literais migrados | fora da escala (seguem literais) |
| --- | ---: | --- |
| artifact | **211** de 226 | 3, 5, 7, 18, 22, 26, 30, 34, 54 px |
| web | **121** | 3, 7, 9, 18, 26, 32, 54 px |

**Os valores são exatamente os de antes.** A escala saiu da medição, não de um
ideal: 10px aparecia 52 vezes, 12px 39, 8px 30, 14px 26. Apertar para
4/8/12/16/24 — o que um design system de verdade faria — move pixel em 23
telas, e isso é decisão de design: vai na Entrega 4, onde passa a ser **uma
linha** em vez de 332.

**Os 17 valores fora da escala seguem literais de propósito.** Essa lista *é* a
dívida de design, e enfiá-la num token não a pagaria — só a esconderia.

### A prova de que nada se moveu

Não basta o token resolver para o pixel certo; é preciso que o pixel seja o
mesmo de antes. Então: medi o estilo **computado** de todo elemento com
espaçamento inline em quatro telas, voltei o código ao estado anterior, medi de
novo e comparei.

    126 elementos comparados · 0 diferenças

### O que eu NÃO fiz, e por quê

O enunciado pede nomenclatura consistente, e os dois aplicativos têm
**vocabulários diferentes para os mesmos conceitos**:

| conceito | artifact | web |
| --- | --- | --- |
| superfície | `--sup`, `--sup2`, `--sup3` | `--superficie`, `--superficie-2` |
| texto | `--tinta`, `--tinta2`, `--tinta3` | `--tinta`, `--tinta-2`, `--tinta-fraca` |
| borda | `--linha`, `--linha2` | `--borda`, `--borda-forte` |
| cor da matriz | `--m1`…`--m8` | `--matriz-1`…`--matriz-8` |
| crítico / alerta | `--crit`, `--alerta` | `--critico`, `--atencao` |
| fonte | `--sans`, `--mono` | `--fonte` |

Unificar são **cerca de 1.000 substituições** (516 no artifact, 505 na web) que
**ninguém vê** e que podem quebrar qualquer tela em que eu escorregue. Juntar
isso à migração de espaçamento tiraria das duas a chance de serem verificadas
em separado — e a comparação de pixels acima, que é a rede de segurança desta
entrega, não cobre cor.

Fica como passo próprio, com a mesma disciplina: renomear de um lado por vez,
com varredura de contraste nas 23 telas antes e depois. **Diga se quer, e em
qual direção** — os nomes da web são mais descritivos, os do artifact mais
curtos.

---

## 2.4 Entrega 4 — design system e repaginada visual (executada, nas duas pontas)

### 4.1 Três vozes, as mesmas nos dois aplicativos

| papel | fonte | onde |
| --- | --- | --- |
| **display** | Space Grotesk | marca, `h1`–`h3`, número grande de cartão, total da rosca |
| **corpo** | IBM Plex Sans | todo texto corrido |
| **número** | IBM Plex Mono | cabeçalho de tabela, rótulo de campo, célula numérica, eixo |

O artifact já tinha Plex Sans e Plex Mono; **a web não tinha fonte nenhuma**
além da do sistema operacional, e nenhum token de monoespaçada. Era o que
fazia as duas metades do GSTI parecerem dois produtos. A voz de display é
nova nos dois.

Escala em tokens, igual nas duas pontas — `--txt-0` 9,5px a `--txt-7` 28px,
sete degraus com no mínimo 1,5px entre vizinhos; `--peso-reg/med/forte/max`;
`--alt-apertada` 1,2 e `--alt-normal` 1,5.

**A pilha de reserva é funcional.** Nada depende de a fonte ter chegado: sem
rede, a página cai em `system-ui` e continua legível.

### 4.2 Movimento

`--mov-rapido` 110ms (o que responde ao dedo), `--mov` 180ms (o que abre,
fecha ou levanta) e `--curva` `cubic-bezier(.2,.7,.3,1)`. Transições
**nominais** em botões, campos, abas, cartões e sanfonas — `transition:all`
animaria largura e altura, e uma tabela que recalcula coluna durante a
transição pisca.

`@media (prefers-reduced-motion:reduce)` **zera os tokens**, o que apaga toda
transição do sistema de uma vez, inclusive as que vierem depois desta entrega.

### 4.3 Contraste: 39 pares reprovados, medidos no navegador

Esta é a parte que não estava no enunciado e que a entrega encontrou. Duas
varreduras novas — `artifact/testar-contraste.cjs` e
`web/verificar-contraste.cjs` — percorrem **cada nó de texto visível** em 11
telas do artifact e 8 da web, nos dois temas, sobem até o primeiro fundo opaco
e aplicam a régua da WCAG (4,5:1 no texto comum, 3:1 no texto grande).

Elas acharam **39 pares reprovados, todos anteriores a esta entrega**:

| token | era | virou | o que ele carrega |
| --- | ---: | ---: | --- |
| `--tinta3` (artifact, claro) | 2,67:1 | 4,52:1 | TODO rótulo de 9,5–11,5px |
| `--tinta3` (artifact, escuro) | 3,76:1 | 4,63:1 | idem, sobre a superfície recuada |
| `--tinta-fraca` (web, claro) | 3,20:1 | 4,54:1 | idem |
| `--tinta-fraca` (web, escuro) | 4,38:1 | 4,60:1 | idem |
| `--alerta` (claro) | 3,61:1 | 4,66:1 | aviso, etiqueta, valor de cabeçalho |
| `--proj` (claro) | 1,76:1 | 3,11:1 | linha tracejada da projeção **e** o número do cartão |
| paleta de tipos (5 de 8) | 2,71:1 | 4,6:1 | valor de cartão pintado com a cor do tipo |
| botão de módulo ativo (3 de 4) | 2,10:1 | 4,6:1 | branco sobre a cor do módulo |
| link (`--s1`/`--serie-1`) | 3,94:1 | 4,60:1 | todo link de texto |
| botão primário (branco em cima) | 3,64:1 | 4,80:1 | a ação principal de cada tela |

**Três decisões de desenho saíram daí**, e as três estão no CSS por extenso:

1. **`--elo` e `--acao` ao lado de `--s1`.** Cor de série e cor de texto são
   réguas diferentes — 3:1 para uma barra, 4,5:1 para uma palavra —, e o mesmo
   azul servia às duas. A borda do botão primário é `--elo`, mais clara que o
   preenchimento: é ela que marca o limite do controle contra o fundo, porque
   um azul que atende o branco por dentro fica perto demais do fundo por fora.
2. **Rampa de TEXTO da paleta de tipos** (`--t1t`…`--t8t`), com a mesma matiz e
   a mesma ordem da rampa de preenchimento. Escurecer a rampa única resolveria
   o texto e deixaria os gráficos pesados. Separação reconferida depois de
   escurecer: **ΔE mínimo entre quaisquer duas é 14,4**, acima do piso de 8 que
   a rampa de preenchimento já cumpria. `corDeTexto()` faz a troca num ponto só.
3. **`--seta-select` como token.** A seta dos seletores é um data URI, e data
   URI não enxerga `currentColor`: a cor ficava cozida no SVG, num cinza-claro
   fixo que sumia no tema escuro.

**As cores por unidade não foram tocadas** — `--m1`…`--m8` são identidade do
cliente, e o enunciado pede preservá-las.

### 4.4 O que ficou medido

| | artifact | web |
| --- | --- | --- |
| telas varridas | 11 × 2 temas | 8 × 2 temas |
| pares abaixo da régua, antes | 21 | 18 |
| pares abaixo da régua, depois | **0** | **0** |

---

## 2.5 Entrega 5 — usabilidade (executada, nas duas pontas)

Como nas anteriores, a entrega começou medindo. Três varreduras novas em cada
superfície, e o que elas acharam decidiu o que foi feito — não o contrário.

### 5.1 Operabilidade: a varredura não achou nada

`artifact/testar-operavel.cjs` e `web/verificar-operavel.cjs` percorrem 17 e 21
telas fazendo três perguntas por elemento:

| pergunta | o que vira achado |
| --- | --- |
| responde ao teclado? | gesto de clique num elemento que não é focável nem tem papel de botão |
| tem nome? | controle operável cujo nome acessível sai vazio ou é só um glifo (`✕`, `⛶`) |
| dá para ver o foco? | parada de Tab que não ganha anel nem sombra |

**Zero achados nas duas superfícies.** A disciplina que o projeto já escreveu
em `regras-de-negocio.md` está de fato no código. As varreduras ficam como
rede: o próximo `<div onclick>` cai nelas.

> **Um erro meu, corrigido antes de virar conclusão.** A primeira versão da
> terceira pergunta usava `el.focus()` e comparava o estilo antes e depois —
> e acusou **290 controles** sem foco visível. O anel está lá: `:focus-visible`
> existe justamente para separar foco de teclado de foco de mouse ou de
> código, e foco de script não o casa. A checagem passou a pressionar **Tab de
> verdade**, e aí os 290 viraram zero.

### 5.2 Foco em modais: dois buracos reais, nas duas pontas

Aqui a varredura não alcançava, e a leitura do código achou:

1. **O Tab saía do diálogo.** `aria-modal="true"` promete que o resto da
   página está inerte; a terceira tabulação já estava no menu, mexendo numa
   tela que o diálogo diz estar bloqueada — e sem sinal nenhum, porque o modal
   continua desenhado por cima.
2. **Fechar não devolvia o foco.** Quem navega por teclado voltava ao começo
   da página a cada confirmação.
3. **Diálogo sem campo não recebia foco nenhum.** `querySelector('input,…')`
   é no-op numa confirmação de duas respostas, e o foco ficava atrás dela.

Os três corrigidos em `abrirModal` (artifact) e no componente `Modal` (web),
com a caixa recebendo `tabindex="-1"` para ser o destino quando não há campo.
`testar-foco-modal.cjs` e `verificar-foco-modal.cjs` cobrem o caminho, incluindo
**diálogos empilhados**: o Tab fica no de cima, e o Escape fecha um por vez.

### 5.3 Atalho de conteúdo e 390px

Antes do conteúdo há, em TODA tela, a marca, o cartão do cliente, o tema e a
navegação — doze paradas de Tab no artifact, dezenove itens de menu na web.
Agora a **primeira** parada é "Pular para o conteúdo", escondida fora do foco.
Ela move o **foco**, e não só a rolagem: sem `tabindex="-1"` no `<main>`, a
tabulação seguinte voltaria ao topo e o atalho não teria pulado nada.

**390px:** 16 telas do artifact e 21 da web, nenhuma com a PÁGINA rolando para
o lado. Tabela que rola dentro da caixa dela é desenho, e a varredura a
distingue — quando acha rolagem, ela nomeia o elemento culpado.

### 5.4 Estados vazios: duas causas, dois remédios

Uma tabela vazia tem duas causas e os remédios são opostos: não há nada
cadastrado (cadastre) ou o filtro excluiu tudo (afrouxe). Uma frase única
acerta metade das vezes, e a metade errada manda a pessoa cadastrar o que ela
já tem. `vazioHtml()` (artifact) e `<Vazio>` (web) recebem as **duas** frases e
o sinal que decide entre elas — em Lançamentos e na Auditoria, que são as
listagens com filtro de maior tráfego.

Os estados vazios de **cadastro** não têm duas causas: o que faltava neles era
dizer **onde** se cadastra. Sete foram reescritos nas duas pontas.

Cinco mensagens de erro do artifact diziam só que o valor era inválido
(`Valor inválido.`, `Mês inválido.`, os três do SLA) e passaram a dizer o
formato aceito. As da web já diziam.

### 5.5 O que ficou medido

| | artifact | web |
| --- | --- | --- |
| telas na varredura de operabilidade | 17 × 3 perguntas | 21 × 3 perguntas |
| achados de operabilidade | **0** | **0** |
| telas a 390px sem rolagem de página | 16 de 16 | 21 de 21 |
| suítes/varreduras novas | 3 | 3 |

---

## 3. Plano de ação

A ordem abaixo difere do enunciado em um ponto, e é de propósito: **a suíte
vermelha vem antes de tudo**. Limpar código com 13 testes falhando significa
não saber se a limpeza quebrou algo.

| # | entrega | o que entra | risco |
| --- | --- | --- | --- |
| **1.5** | **Destravar a verificação** | os 10 testes do FOC e as 3 suítes do artifact deixam de depender do mês corrente; decidir se a carga FOC ganha fixture anonimizada para entrar no CI | baixo — só teste |
| 2 | Limpeza | ✅ os 17 símbolos mortos e o `zod`. **Pendente:** os 74 `export` de tipo e a consolidação dos cinco caminhos de detalhamento | médio — o detalhamento tem 43 chamadores |
| 3 | Padronização | ✅ escala de espaçamento e raio nas duas pontas, 332 literais migrados. **Pendente:** unificar o vocabulário de cor e a camada de dados | baixo |
| 4 | Design system | tipografia, refino do dark mode, motion, componentes | médio — visual em 23 telas |
| 5 | UX | estado de carregando, feedback, foco, responsividade | baixo |
| 6 | Performance | `React.lazy` nas 17 rotas da web, `React.memo`, medir antes/depois | médio |
| 7 | Revisão | regressão zero, comparativo | — |

### Sobre o escopo das três superfícies

O enunciado fala em "todo o código-fonte", e as entregas citam *hooks*,
*services*, *bundle* e *memoização* — vocabulário do app **React**. Mas as
últimas seis séries de trabalho foram **só no artifact**, que é o que você abre.

As duas leituras levam a trabalhos de tamanhos bem diferentes:

- **Só o artifact** (26.822 linhas): a limpeza e a repaginada aparecem para
  você na próxima publicação.
- **As três superfícies** (64.076 linhas): inclui o app React, que só chega até
  você quando o PR #1 for mesclado e alguém subir o servidor.

**A Entrega 1.5 eu faço nas duas**, porque CI vermelho é problema de todo
mundo. Para as entregas 2 a 7, preciso que você diga qual escopo quer.
