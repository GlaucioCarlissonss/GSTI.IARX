# Versão hospedada (Artifact)

O mesmo sistema do `server/` + `web/`, reescrito como página única sobre o
armazenamento do Claude Artifact. Existe porque o gestor precisa **operar o
sistema sem instalar nada** — sem `localhost`, sem Node, sem porta liberada.

- **Onde roda:** https://claude.ai/code/artifact/decb67fb-6b2d-4869-9f53-8f39cb68e80f
- **Quem enxerga:** privado à conta que publicou, até que seja compartilhado.
- **O que guarda:** as mesmas entidades da base local (lançamentos, projetos,
  SLA, catálogos, fechamentos, trilha de auditoria), em documentos JSON.

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

Quatro suítes, todas contra um `window.claude` simulado num Chromium real:

| script | o que cobre |
|---|---|
| `testar.cjs` | fumaça: as abas montam, os seletores funcionam |
| `testar-completo.cjs` | as 5 empresas × 8 abas, tempo de render, erro de console, rolagem horizontal a 400 px |
| `testar-edicao.cjs` | criar, parcelar, reclassificar, excluir, fechar e reabrir competência, conferindo totais e trilha de auditoria |
| `testar-coerencia.cjs` | os números de cada tela fecham entre si: KPI × rankings, conferência por origem × mês a mês, rodapé × linhas |
| `testar-projetos-sla.cjs` | projetos (atraso e desvio derivados), SLA (percentual, recusa de `dentro > total`) e o ciclo de planilha do SLA |
| `testar-isolamento.cjs` | nada atravessa a empresa, inclusive com as cinco carregadas em memória; cadastros não vazam |
| `testar-dados.cjs` | exportar, reimportar sem duplicar, importar planilha quebrada sem derrubar o lote |

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
