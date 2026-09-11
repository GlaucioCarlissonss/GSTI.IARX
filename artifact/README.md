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

`testar.js` abre o HTML num Chromium com um `window.claude` simulado e confere
que as telas montam sem erro de console.

```sh
mkdir -p dados                 # baixe aqui os documentos com Artifact read_db
node montar-teste.js           # gera teste-local.html com o mock embutido
node testar.js
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
