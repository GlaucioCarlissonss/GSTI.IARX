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

### 🔴 CRÍTICO — 10 testes de servidor falhando hoje

`npm test` dá **412 de 422**. As dez falhas são todas do mesmo mecanismo:

```
not ok 182 - com as decisões tomadas, as 110 linhas entram...
  error: 'Alterações em competências passadas (09/2026) exigem justificativa.'
  garantirCompetenciaEditavel (domain/fechamento.ts:38)
```

A fixture do FOC está presa a **09/2026** (`importacao-foc.test.ts`, linhas 156,
189, 210, 266). A regra de negócio recusa escrita em competência passada sem
justificativa — regra **certa**, que a suíte não acompanha: ela envelhece
sozinha quando o relógio passa do mês da fixture.

**O CI está verde no último commit** (`b7ae00d`, 01/10 15:49 UTC) e roda
exatamente este `npm test`. Como estas falhas são de calendário, **o próximo
push vai encontrar o CI vermelho** sem ninguém ter mudado uma linha. Vale
conferir isso antes de qualquer outra coisa: um CI que fica vermelho por conta
própria é um CI que as pessoas param de ler.

**Três suítes do artifact têm o mesmo mal** — `testar-multi`,
`testar-adequacao` e `testar-reducao` —, e já reportei que falhavam antes da
última entrega. A base de teste vai de 01/2026 a 12/2027, e elas comparam
contra totais de um mês fixo.

> **Correção proposta:** a fixture deixa de citar um mês e passa a derivá-lo do
> relógio (`mesHoje()`, ou o mês corrente do ambiente de teste). Onde o teste
> precisa de competência passada *de propósito*, ele passa a informar
> justificativa, que é o que a regra pede. É conserto de teste, não de regra.

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

## 3. Plano de ação

A ordem abaixo difere do enunciado em um ponto, e é de propósito: **a suíte
vermelha vem antes de tudo**. Limpar código com 13 testes falhando significa
não saber se a limpeza quebrou algo.

| # | entrega | o que entra | risco |
| --- | --- | --- | --- |
| **1.5** | **Destravar a verificação** | as 10 fixtures de servidor e as 3 suítes do artifact deixam de depender do mês corrente | baixo — só teste |
| 2 | Limpeza | os 17 símbolos mortos, o `zod`, os 74 `export` de tipo; consolidar os cinco caminhos de detalhamento num só contrato | médio — o detalhamento tem 43 chamadores |
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
