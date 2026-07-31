# FASE 3.1-F.1 — PERFIL AGREGADO E SANITIZADO DOS CONFLITOS

## Escopo e segurança

Leitura exclusivamente read-only das tabelas `customer_master_*` e
`customer_identity_*` persistidas na Fase 3.1-E, no banco local oficial
(`official-main-worktree/data/<database>`), para produzir um perfil agregado
dos 34.051 conflitos e subsidiar a governança futura.

Prova de read-only: conexão `OPEN_READONLY`, `PRAGMA query_only=1`, wrapper que
bloqueia DML, DDL, `VACUUM`, `ATTACH`, `DETACH` e PRAGMAs mutáveis antes do
SQLite. Registro da execução real: 25 SELECTs, 12 PRAGMAs de leitura, 0 SQL
bloqueado/tentado.

Não houve resolução de conflitos, alteração de status, merge, split, tela,
rota, autenticação, autorização, liberação de clientes, alteração de
elegibilidade, normalização, regras de candidatos, novo backfill, modificação
de `contacts`/`crm_contacts`, push, PR, merge ou deploy.

## Invariantes antes/depois

Idênticos: arquivo principal (tamanho e timestamp), sidecars (WAL, SHM,
journal ausentes), `quick_check=ok`, `schema_version`, `user_version`, total
de tabelas, contagens de `contacts`, `crm_contacts` e das oito tabelas mestre,
hash estrutural do schema. Banco comprovadamente inalterado.

## Consistência dos dados persistidos

- conflitos: 34.051 (100% `status=OPEN`);
- participantes: 143.200;
- divergências entre `evidence_json.participantCount` e participantes
  persistidos: 0;
- conflitos sem participantes: 0;
- bloqueio indeterminável: 0 (todo conflito tem `blocking` persistido);
- duplicatas exatas (mesmo tipo + mesmo conjunto de participantes): 0.

## Distribuição por tipo (vocabulário persistido)

| Tipo | Conflitos |
|---|---:|
| PHONE_DUPLICATE | 7.426 |
| MULTIPLE_ELIGIBLE_CUSTOMERS | 7.423 |
| CPF_DUPLICATE | 6.157 |
| PHONE_SHARED | 5.614 |
| CPF_INVALID | 5.558 |
| MANUAL_REVIEW_REQUIRED | 1.262 |
| NAME_MISMATCH | 277 |
| EMAIL_DUPLICATE | 88 |
| TRANSITIVE_MATCH_CONFLICT | 80 |
| INACTIVE_SOURCE | 74 |
| CPF_MISMATCH | 57 |
| PHONE_MISMATCH | 29 |
| DELETED_SOURCE | 6 |

## Distribuição por severidade e bloqueio

- severidade: MEDIUM 13.254; CRITICAL 13.174; HIGH 7.535; LOW 88;
- bloqueantes: 20.986; não bloqueantes: 13.065; indeterminados: 0.

## Classificação primária (regra documentada, campos persistidos)

Prioridade exclusiva: `HISTORICAL_EVIDENCE` (tipos DELETED_SOURCE e
INACTIVE_SOURCE, evidência de estado histórico da origem) >
`REAL_ELIGIBILITY_BLOCK` (`blocking=true`) > `POTENTIAL_HUMAN_DECISION`
(`blocking=false`) > `NOT_DETERMINABLE`.

| Classe | Conflitos |
|---|---:|
| REAL_ELIGIBILITY_BLOCK | 20.906 |
| POTENTIAL_HUMAN_DECISION | 13.065 |
| HISTORICAL_EVIDENCE | 80 |
| NOT_DETERMINABLE | 0 |

## Impacto em mestres e origens

- origens afetadas: 52.335 de 59.143 (88,5%);
- mestres afetados: 41.619 de 47.928 (86,8%);
- conflitos que cruzam mais de um mestre: 17.309;
- conflitos que cruzam as duas fontes oficiais: 13.421.

Conflitos por mestre (histograma):

| Conflitos por mestre | Mestres |
|---:|---:|
| 1 | 2.429 |
| 2 | 4.234 |
| 3 | 31.005 |
| 4 | 3.707 |
| 5 | 156 |
| 6 | 49 |
| 7 | 24 |
| 8 | 10 |
| 9 | 4 |
| 10 | 1 |

Maior agrupamento: 10 conflitos em um único mestre; os 10 maiores agrupamentos
têm entre 8 e 10 conflitos.

Mestres por classe de conflito presente: 35.889 com ao menos um bloqueio real;
10.897 com ao menos uma decisão humana potencial; 40 somente com evidência
histórica; 0 indeterminados.

## Padrões repetidos

75% dos conflitos (25.420) pertencem a conjuntos de participantes que aparecem
em mais de um conflito (8.654 conjuntos repetidos). Conflitos por conjunto de
participantes: 1 conflito em 8.631 conjuntos; 2 em 2.055; 3 em 5.090; 4 em
1.505; 5 em 4.

Formas repetidas mais frequentes (tipo|severidade|bloqueio|participantes|fontes):

1. CPF_INVALID | MEDIUM | não bloqueante | 1 participante | crm_contacts — 5.546;
2. CPF_DUPLICATE | MEDIUM | não bloqueante | 2 participantes | crm_contacts — 3.863;
3. PHONE_DUPLICATE | HIGH | bloqueante | 3 participantes | ambas as fontes — 2.455;
4. PHONE_SHARED | CRITICAL | bloqueante | 3 participantes | ambas as fontes — 2.455;
5. MULTIPLE_ELIGIBLE_CUSTOMERS | CRITICAL | bloqueante | 3 participantes | ambas as fontes — 2.454;
6. MULTIPLE_ELIGIBLE_CUSTOMERS | CRITICAL | bloqueante | 11 participantes | contacts — 1.908;
7. PHONE_DUPLICATE | HIGH | bloqueante | 11 participantes | contacts — 1.908;
8. PHONE_SHARED | CRITICAL | bloqueante | 11 participantes | contacts — 1.908;
9. CPF_DUPLICATE | MEDIUM | não bloqueante | 3 participantes | ambas as fontes — 1.654;
10. MULTIPLE_ELIGIBLE_CUSTOMERS | CRITICAL | bloqueante | 2 participantes | crm_contacts — 1.303.

O trio PHONE_DUPLICATE + PHONE_SHARED + MULTIPLE_ELIGIBLE_CUSTOMERS descreve o
mesmo bucket de telefone sob três óticas: é a principal fonte de "duplicação
repetida do mesmo problema" (5.090 conjuntos com exatamente 3 conflitos).
Os grupos com 11 participantes em `contacts` (1.908 conjuntos × 3 tipos =
5.724 conflitos) indicam números compartilhados em massa (placeholder ou
telefone reciclado) e merecem investigação própria antes de qualquer regra de
matching futura.

## Estimativa de casos administrativos únicos

Base: conjuntos únicos de participantes (um caso administrativo por grupo de
origens). **34.051 conflitos NÃO equivalem a 34.051 decisões humanas.**

- casos administrativos únicos estimados: **17.285**;
  - com bloqueio real de elegibilidade: **7.777**;
  - decisão humana potencial (não bloqueantes): **9.428**;
  - evidência histórica (arquivável, sem ação de identidade): **80**;
  - NOT_DETERMINABLE: 0.

Leitura executiva: a fila real de governança é da ordem de 17,3 mil casos, e
não 34 mil; dentro dela, ~7,8 mil casos bloqueiam elegibilidade de fato e ~9,4
mil são triagem de qualidade de dados não bloqueante (dominada por CPF_INVALID
e CPF_DUPLICATE em `crm_contacts`).

## Recomendações técnicas (baseadas nos dados; nada implementado nesta fase)

1. Governar por **caso** (conjunto de participantes), não por conflito: cada
   caso deve render um único item de trabalho, agregando os tipos associados.
2. Priorizar a fila em três trilhas: (a) 7.777 casos bloqueantes para decisão
   de identidade; (b) 9.428 casos não bloqueantes para higiene de dados;
   (c) 80 casos históricos para arquivamento sem ação.
3. Tratar o trio de conflitos por bucket de telefone como uma única evidência
   composta, evitando tripla contagem em futuras telas e relatórios.
4. Investigar os 1.908 buckets de 11 participantes em `contacts` como suspeita
   de número placeholder/reciclado antes de qualquer afrouxamento de regra de
   candidatos.
5. Encaminhar os 5.546 casos de CPF inválido e os 3.863 de CPF duplicado em
   `crm_contacts` para saneamento na fonte de importação, e não para decisão
   de identidade.
6. Manter todos os 34.051 conflitos persistidos e `OPEN` até que uma fase
   futura, autorizada, defina o fluxo de resolução; esta fase não alterou
   nenhum status.

## Sanitização

Este relatório contém somente contagens e rótulos do vocabulário persistido.
Não contém CPF, telefone, e-mail, endereço, nome completo, IDs operacionais,
hashes ou payload bruto. A saída computada passou por auto-cheque de
sanitização (sem tokens de hash, sem prefixos de ID mestre, sem padrões de
CPF/e-mail): resultado `sanitized=true`.

## Testes

- `node --test modules/customers/master/__tests__/customerMasterConflictProfile.test.js`:
  6/6 verdes (agregações, classificação primária, impacto, duplicação, casos
  administrativos, consistência e sanitização, sobre fixtures sintéticas);
- suíte completa `modules/customers/master/__tests__/`: 83/83 verdes;
- `npm run check`: verde; `git diff --check`: verde.

## Arquivos alterados

Somente adições:

- `modules/customers/master/analysis/customerMasterConflictProfile.js`;
- `scripts/customer-master-conflict-profile.js`;
- `modules/customers/master/__tests__/customerMasterConflictProfile.test.js`;
- este relatório.

## Veredito

`CUSTOMER_MASTER_CONFLICT_PROFILE_OK`

Banco comprovadamente inalterado; nenhum push, PR, merge ou deploy.
