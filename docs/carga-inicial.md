# Carga inicial a partir das bases reais

`npm run seed -- --recriar` monta o ambiente a partir dos arquivos em
`dados-origem/` (diretório fora do controle de versão, por conter dados de
pessoas e valores contratuais). Este documento registra o que foi mapeado, as
premissas adotadas e o que ficou pendente.

## Arquivos de origem

| Arquivo | Aba | Conteúdo | Competências |
| --- | --- | --- | --- |
| `Despesas_TI_2026.xlsx` | `BASE TI` | 900 lançamentos de TI | jan–mai/2026 |
| `Despesas_de_TI_Junho_26.xlsx` | `base2` | 166 lançamentos | jun/2026 |
| `DESPESAS_TI_JULHO_26.xlsx` | `JULHO` | 179 lançamentos | jul/2026 |
| `Base_Despesas_Agosto__novo.xlsx` | `Despesas (2)` | base geral da empresa; filtrada por `GRUPO_GASTO = TECNOLOGIA DA INFORMACAO - TI` (212 de 16.725 linhas) | ago/2026 |
| `TI.xlsx` | `Geral` | equipe de TI: 8 colaboradores e custo médio com tributos | — |
| `spincare.json` | — | mensalidades do projeto de migração do ERP SpinCare, transcritas do documento enviado pelo gestor | set/2026–dez/2027 |

**Resultado:** 1.457 lançamentos realizados (R$ 1.328.988,35), 57 lançamentos de
folha (R$ 273.929,60) e 384 lançamentos projetados do SpinCare (R$ 806.556,48,
somando os dois cenários).

A diferença de R$ 0,03 em relação à soma bruta das planilhas (R$ 1.328.988,38)
vem do arredondamento para centavos de valores com mais de duas casas decimais
na origem (por exemplo, `0,82215`).

## Organograma

`GRUPO`/`GRP` vira **empresa** e `UNIDADE` vira **filial**. As bases usam duas
convenções para a mesma unidade; `server/src/db/organograma.ts` converge as duas
para um cadastro único:

| Empresa | Filiais (nome canônico ← apelido da base antiga) |
| --- | --- |
| ALIANÇA | AHC RN ← AHL - NAT · AHC SE |
| MILAGRES | HM AM ← HM - MAN · HM CE · HM DF ← HM - BSB · HM GO · HM MT · HM PB · HM RO |
| MOOVE | MOOVE ← MO - MOOVE |
| RESIDENCIAL | HR AL ← HR - MAC · HR BA ← HR - SAL · HR CG · HR JP · HR PE ← HR - REC · HR RN ← HR - NAT |
| UNION | UC RJ · UC SP |

Cidade e UF só foram preenchidas quando a própria base as identifica (o código
antigo `HR - REC` nomeia Recife, `HM - BSB` nomeia Brasília, e assim por
diante). Onde a origem não diz, o campo ficou vazio.

## Premissas de enquadramento contábil

As bases trazem `TIPO` (FIXO/VARIAVEL) e centro de custo, mas **não** trazem
classificação contábil nem distinguem aquisição pontual de recorrência. A carga
adota as regras abaixo; qualquer lançamento pode ser reclassificado depois pelo
gestor, com a mudança registrada em auditoria.

| Centro de custo | Natureza | Classificação |
| --- | --- | --- |
| Equipamentos de TI | pontual única | **investimento** |
| Materiais de TI | pontual única | despesa |
| Demais, com `TIPO = FIXO` | fixa | despesa |
| Demais, com `TIPO = VARIAVEL` | pontual única | despesa |

Também foi corrigida a grafia de origem `Serviços de Desencolvimento` para
`Serviços de Desenvolvimento`, e os nomes sem acento foram normalizados para os
tipos padrão do sistema (`Licencas de Softwares` → `Licenças de Softwares`).

## Folha da equipe de TI

Lançada como tipo **Pessoas**, natureza fixa, de jan/2026 a ago/2026, usando o
*custo médio do colaborador com tributos* e respeitando o mês de admissão de
cada um. A alocação segue a orientação do gestor:

- **Sara** e **Roberto** → MILAGRES / filial HM PB.
- **Kauã** → RESIDENCIAL / filial HR JP.
- **Demais colaboradores corporativos** → rateio mensal entre as cinco
  empresas, proporcional ao gasto de TI de cada grupo naquele mês, lançado no
  nível empresa (sem filial). O rateio fecha exatamente no total, e a observação
  de cada lançamento registra o percentual aplicado.

## Projeto de migração do ERP SpinCare

**Financeiro.** As mensalidades foram lançadas como despesa fixa do tipo
*Sistemas Gerenciais*, mês a mês, com o rateio por unidade informado no
documento:

| Unidade do documento | Destino no sistema |
| --- | --- |
| HM (Hospital Milagres) | MILAGRES, nível empresa |
| HR (Hospital Residencial) | RESIDENCIAL, nível empresa |
| LIFE | RESIDENCIAL / filial HR PE |
| NATAL | RESIDENCIAL / filial HR RN |
| ALIANÇA | ALIANÇA, nível empresa |
| UNION | UNION, nível empresa |

Dois cenários foram carregados, conforme solicitado:

- **Oficial** — R$ 9.006,00/mês de set a dez/2026 e R$ 32.558,00/mês em 2027.
- **SpinCare com desconto de 12%** — mesma projeção com a mensalidade de 2027 a
  R$ 28.651,04, condicionada à conclusão da implantação total até 28/02/2027.

O somatório de cada bloco é conferido durante a carga contra o total mensal
informado no documento; divergência acima de um centavo vira aviso.

**Projetos.** A implantação foi cadastrada como projeto *Migração do ERP
SpinCare* nas quatro empresas envolvidas, com fim planejado em 02/2027 — o prazo
que condiciona o desconto.

## Premissas assumidas e pendências

1. **Início das mensalidades.** O documento diz "mensalidades vincendas — até
   dezembro/2026" sem indicar o primeiro mês; foi adotado **09/2026**, o mês
   corrente na data da carga. Ajustar em `dados-origem/spincare.json` se o
   correto for outro.
2. **Início do projeto SpinCare.** Não informado; adotado 09/2026, o mês em que
   as mensalidades passam a vencer.
3. **Parcelas de implantação.** A tabela de parcelas de implantação aparece
   cortada no documento enviado — apenas as mensalidades foram carregadas. Assim
   que os valores forem informados, entram como despesa pontual parcelada e o
   sistema projeta as parcelas automaticamente.
4. **Módulo de SLA sem dados.** Nenhuma base de tickets foi fornecida; o módulo
   está funcional e vazio, pronto para receber os registros pela tela ou pela
   planilha padrão.
5. **Colaborador em substituição.** `Miqueias (SUBSTITUIÇÃO LIMAS)` está fora do
   subtotal da planilha de origem, mas entrou no rateio corporativo por ser
   custo efetivo da equipe.
