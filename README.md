# GSTI.IARX — SaaS de Gestão para Gestores de TI

Plataforma multi-tenant que reúne, em um único ambiente, os três domínios que o
gestor de TI precisa acompanhar por empresa e por filial:

| Módulo | O que entrega |
| --- | --- |
| **Financeiro** | Lançamentos por tipo, natureza e classificação contábil, com projeção automática de parcelas, recorrências, cenários de projeção e fechamento mensal. |
| **Projetos** | Projetos, tarefas e envolvidos com cronograma Gantt mensal, cálculo automático de atraso e desvio entre planejado e real. |
| **SLA** | Tickets atendidos por fila (Infraestrutura, Sistema, Dados) e por tópico de ajuda, com indicadores de conformidade. |

Todo registro pertence a uma **empresa** e, opcionalmente, a uma **filial**.
Nenhuma consulta ou escrita ocorre fora desse contexto organizacional.

## Começando a usar

A aplicação inteira — API e interface — sobe em um processo só:

```bash
npm ci
npm run iniciar             # configura, compila e sobe em http://localhost:3333
```

`npm run iniciar` gera o `.env` com um segredo de sessão aleatório na primeira
execução. Nas vezes seguintes, `npm start` basta. O passo a passo completo —
instalar o Node, carregar as planilhas, backup e solução de problemas — está em
[`docs/instalacao-local.md`](docs/instalacao-local.md).

Abra o endereço e a tela pedirá para **criar a conta do gestor**: é a primeira
do ambiente e, assim que existe, o auto-cadastro se fecha sozinho (novos
usuários passam a entrar por convite de um gestor, ou mantenha
`REGISTRO_ABERTO=true` se preferir o contrário). Em seguida você cadastra a
primeira empresa, que já nasce com os nove tipos de despesa padrão.

A partir daí há dois caminhos para popular o ambiente:

1. **Planilha** — em *Importar / Exportar*, baixe o template do módulo, preencha
   e envie. `Validar sem gravar` mostra o relatório antes de qualquer escrita.
2. **Tela** — lance direto em *Lançamentos*, *Projetos e tarefas* ou
   *Registros de tickets*.

### Com Docker

```bash
cp .env.example .env        # JWT_SECRET é obrigatório
docker compose up -d        # http://localhost:3333
```

O banco fica em um volume (`gsti-dados`), então o contêiner é descartável e os
dados não. O caminho sem Docker foi verificado ponta a ponta; a imagem segue o
padrão de build em dois estágios, mas não foi construída no ambiente em que o
projeto foi desenvolvido (sem daemon Docker disponível).

### Durante o desenvolvimento

```bash
npm run dev                 # API em :3333, front-end com recarga em :5173
npm test                    # regras de negócio (40 testes)
npm run seed -- --recriar   # carga inicial a partir de dados-origem/
```

## Arquitetura

```
server/               API Node + Express 5 + SQLite (better-sqlite3)
  src/domain/         regras de negócio, independentes de HTTP
  src/routes/         camada HTTP fina sobre o domínio
  src/db/             schema, conexão e carga inicial
  test/               testes das regras (node:test)
web/                  SPA React + Vite, gráficos em SVG próprio
docs/                 regras de negócio e notas da carga inicial
dados-origem/         planilhas do cliente (fora do controle de versão)
```

O domínio não conhece Express: as rotas apenas traduzem HTTP para chamadas de
domínio, o que mantém as regras testáveis sem subir servidor.

### Decisões que sustentam as regras

- **Competência** é gravada como `AAAA-MM` (ordenável) e exposta como `MM/AAAA`.
- **Valores** são inteiros em centavos; o rateio de parcelas fecha exatamente no
  total contratado, sem centavos perdidos.
- **Isolamento multi-tenant** é verificado em todas as consultas e validado por
  teste — filiais, tipos de despesa e tópicos de outra empresa são rejeitados.
- **Nada é excluído em silêncio**: exclusões são lógicas e registram autor,
  momento e conteúdo anterior na trilha de auditoria.
- **Importação idempotente**: a deduplicação compara o conteúdo do registro, de
  modo que reimportar uma exportação não duplica nem perde nada — inclusive
  registros criados pela interface.

Detalhes das regras em [`docs/regras-de-negocio.md`](docs/regras-de-negocio.md);
o mapeamento das bases reais em [`docs/carga-inicial.md`](docs/carga-inicial.md).

## API

Toda rota sob `/api` (exceto `/api/auth/*` e `/api/saude`) exige o cabeçalho
`Authorization: Bearer <token>` e `X-Empresa-Id: <id>`.

| Grupo | Rotas |
| --- | --- |
| Sessão | `POST /api/auth/registrar` · `POST /api/auth/login` · `GET /api/auth/eu` · `POST /api/auth/empresas` |
| Cadastros | `/api/filiais` · `/api/tipos-despesa` · `/api/topicos-ajuda` · `/api/filas` |
| Financeiro | `/api/lancamentos` · `/api/lancamentos/:id/serie` · `/api/lancamentos/:id/reclassificar` · `/api/lancamentos/cenarios/lista` |
| Fechamento | `/api/fechamentos` · `/api/fechamentos/reabrir` |
| Projetos | `/api/projetos` · `/api/projetos/:id/tarefas` · `/api/projetos/:id/envolvidos` |
| SLA | `/api/sla` |
| Dashboards | `/api/dashboards/{executivo,financeiro,projetos,sla}` |
| Planilhas | `/api/planilhas/templates` · `/api/planilhas/importacao/:modulo` · `/api/planilhas/exportacao/:modulo.xlsx` |
| Auditoria | `/api/auditoria` |

Os dashboards aceitam `filial_id` (`nenhuma` para o nível empresa),
`competencia` e, no financeiro, `cenario`.

## Importação e exportação

Um único template serve para importar e exportar, o que permite backup, migração
e reimportação sem perda. O layout é versionado (`_meta` na planilha) e o leitor
aceita apelidos de cabeçalho, de modo que planilhas antigas continuam válidas.

- Linhas inválidas entram em um relatório de erros **sem abortar o lote**.
- `Validar sem gravar` roda a importação inteira em transação desfeita.
- Tipos de despesa, tópicos e filiais ausentes podem ser criados na importação.

## Levando a base para outra instância

A exportação usa o mesmo layout da importação, então mover ou restaurar um
ambiente é uma operação de duas etapas:

1. Em *Importar / Exportar*, baixe **Base — Base completa** de cada empresa.
2. Na instância de destino, crie a empresa e importe o arquivo pelo módulo
   `completo`.

A reimportação é idempotente e reconstrói filiais, tipos de despesa, cenários,
lançamentos (com as séries de parcelas religadas), projetos, tarefas,
envolvidos, tópicos e registros de SLA. Repetir a importação não duplica nada.

## Segurança e privacidade

As bases de origem contêm dados de pessoas (nomes, matrículas, salários) e
valores contratuais. Elas ficam em `dados-origem/`, **ignorada pelo Git**, e o
banco gerado (`data/`) também não é versionado. O repositório contém apenas
código.
