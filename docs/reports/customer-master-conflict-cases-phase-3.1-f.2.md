# FASE 3.1-F.2 — CASOS DE CONFLITO E FILAS DE GOVERNANÇA

## Escopo

HEAD inicial e `codeVersion`:
`3588d696c99d65e07d09cd1c087354aa84b9b1f1`.

Foi criada somente a camada persistente de casos administrativos. Não houve
resolução, merge, split, mudança de elegibilidade, liberação de cliente, rota,
tela, app, consumidor operacional ou alteração nas origens.

## Schema

Quatro tabelas expansivas:

- `customer_identity_cases`;
- `customer_identity_case_conflicts`;
- `customer_identity_case_entities`;
- `customer_identity_case_events`.

O schema admite os estados `OPEN`, `UNDER_REVIEW`, `RESOLVED`, `ARCHIVED` e
`REOPENED`, as prioridades `CRITICAL`, `HIGH`, `MEDIUM` e `LOW`, e as filas
`IDENTITY_ELIGIBILITY`, `DATA_HYGIENE` e `HISTORICAL`.

O backfill criou somente casos `OPEN` e eventos `CREATED`. O writer aceita
somente `INSERT OR IGNORE` nas quatro tabelas novas; `UPDATE`, comandos
destrutivos e tabelas existentes são bloqueados.

## Agrupamento determinístico

Bucket composto: conjunto ordenado e exato de participantes persistidos.
Buckets distintos nunca são misturados. Conflito sem participantes usa caso
individual conservador.

Precedência de fila:

1. `HISTORICAL` quando todos os conflitos do bucket são históricos;
2. `IDENTITY_ELIGIBILITY` quando existe conflito bloqueante;
3. `DATA_HYGIENE` nos demais buckets.

O trio `PHONE_DUPLICATE`, `PHONE_SHARED` e
`MULTIPLE_ELIGIBLE_CUSTOMERS` no mesmo bucket gera um único caso
`PHONE_IDENTITY_COMPOSITE`.

CPF inválido/duplicado sem bloqueio de identidade permanece em
`DATA_HYGIENE`. Nenhuma hipótese de telefone reciclado foi inferida.

## Dry-run real

- status: `DRY_RUN_OK`;
- conexão: `OPEN_READONLY`, `query_only=1`;
- `quick_check=ok`;
- conflitos lidos: 34.051;
- participantes lidos: 143.200;
- casos: 17.285;
- invariantes inalterados: sim;
- sanitização: aprovada;
- duração: 13.122 ms.

Fingerprint do plano:

`fbbb7362797f4b4fee0059c259b94864a332d7e861844cc877901dcd430d842e`

Fingerprint dos conflitos originais:

`4765fd5dbb3721ee8c0531a40d127b185cfdc799ec246b2a137e92e9e29e901d`

## Casos persistidos

Total: **17.285**.

Por fila:

- `IDENTITY_ELIGIBILITY`: 7.784;
- `DATA_HYGIENE`: 9.428;
- `HISTORICAL`: 73.

Por prioridade:

- `CRITICAL`: 7.539;
- `HIGH`: 102;
- `MEDIUM`: 9.585;
- `LOW`: 59.

Impacto:

- conflitos vinculados: 34.051;
- mestres afetados: 41.619;
- fontes afetadas: 52.335;
- vínculos caso-entidade: 101.958;
- casos compostos: 8.654;
- casos individuais: 8.631;
- eventos de criação: 17.285.

## Divergência frente à estimativa

O total coincidiu exatamente com a estimativa: 17.285.

- `DATA_HYGIENE`: delta 0;
- `IDENTITY_ELIGIBILITY`: delta +7;
- `HISTORICAL`: delta -7.

A divergência é pequena e explicável: sete conjuntos de participantes contêm
evidência histórica junto de conflito bloqueante. Como a regra determina que
somente conflitos **apenas históricos** vão para `HISTORICAL`, esses sete
casos permanecem em `IDENTITY_ELIGIBILITY`. Não há divergência material.

## Apply, verify e idempotência

Primeiro apply:

- status: `APPLY_OK`;
- lotes: 343;
- 17.285 casos criados;
- 34.051 vínculos de conflitos criados;
- 101.958 vínculos de entidades criados;
- 17.285 eventos criados;
- duração: 198.268 ms.

Verify independente:

- status: `VERIFY_OK`;
- ausentes: 0;
- inesperados: 0;
- fingerprint observado igual ao planejado;
- `quick_check=ok`.

Fingerprint do estado persistido:

`d99f0a2d2b756e57c66550eba58f6c6e2924649fb3060094abf8cf416d608274`

Segunda execução:

- status: `APPLY_OK`;
- casos criados: 0; inalterados: 17.285;
- vínculos de conflitos criados: 0; inalterados: 34.051;
- vínculos de entidades criados: 0; inalterados: 101.958;
- eventos criados: 0; inalterados: 17.285;
- duração: 108.913 ms;
- idempotência: comprovada.

## Dados originais e segurança

Antes e depois permaneceram idênticos:

- 34.051 conflitos, todos `OPEN`;
- 143.200 participantes;
- fingerprint integral dos conflitos;
- fingerprint dos mestres e elegibilidade;
- fingerprint dos vínculos de origem;
- `contacts`: 36.502;
- `crm_contacts`: 22.641;
- histórico de merge: 0.

Os casos armazenam somente resumo agregado e sanitizado. IDs internos aparecem
apenas nas tabelas relacionais necessárias; não há CPF, telefone, e-mail,
nome ou endereço integral em `summary_json` ou nos eventos.

Dois backups integrais e validados foram mantidos fora do Git: pré-apply e
pré-idempotência. Nenhum banco ou sidecar foi adicionado ao repositório.

## Testes

- testes específicos F.2: 6/6 verdes;
- suíte completa 3.1-A–F.2: 89/89 verdes;
- parsing dos módulos, script, `server.js` e `public/app.js`: verde.

## Veredito

`CUSTOMER_MASTER_CONFLICT_CASES_OK`

Sem push, PR, deploy, VPS, rota, tela ou início de resolução dos casos.
