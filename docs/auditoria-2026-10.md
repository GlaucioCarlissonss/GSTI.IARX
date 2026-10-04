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

## 3. Plano de ação

A ordem abaixo difere do enunciado em um ponto, e é de propósito: **a suíte
vermelha vem antes de tudo**. Limpar código com 13 testes falhando significa
não saber se a limpeza quebrou algo.

| # | entrega | o que entra | risco |
| --- | --- | --- | --- |
| **1.5** | **Destravar a verificação** | os 10 testes do FOC e as 3 suítes do artifact deixam de depender do mês corrente; decidir se a carga FOC ganha fixture anonimizada para entrar no CI | baixo — só teste |
| 2 | Limpeza | ✅ os 17 símbolos mortos e o `zod`. **Pendente:** os 74 `export` de tipo e a consolidação dos cinco caminhos de detalhamento | médio — o detalhamento tem 43 chamadores |
| 3 | Padronização | tokens de espaçamento e raio; os 305 `px` literais; camada de dados | baixo |
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
