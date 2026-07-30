# FASE 3.1-E — BACKFILL CONTROLADO

## Baseline oficial

O pré-apply foi executado duas vezes contra o banco local aprovado, sempre com:

- `codeVersion`: `99b6caa4cc8a9b9e7d35c221b52fd64954cf48e9`;
- conexão `OPEN_READONLY`;
- `PRAGMA query_only=1`;
- `quick_check=ok`;
- perfil opt-in `synthetic-59143-v1`.

As duas execuções produziram o mesmo fingerprint:

`2447d8f03967bd52407f13e35c4648afcaf91ecc22443828c93f1bb8da024be9`

Esse é o baseline oficial e reproduzível da Fase 3.1-E.

O fingerprint anterior da D.3,
`43ea26f9e217c5c92b94367da16197d13f1b06f9043d3f06367bd6f600353a8c`,
ficou irreproduzível exclusivamente porque usou o rótulo transitório
`LOCAL_6810838_CONFLICT_AGGREGATE_V2` como `codeVersion`, sem persistir esse
valor como identidade de um commit. Não houve tentativa de brute force nem
alteração das regras para recuperar o fingerprint anterior.

## Pré-apply read-only

- registros: 59.143;
- `contacts`: 36.502;
- `crm_contacts`: 22.641;
- conflitos: 34.051;
- conflitos bloqueantes: 20.986;
- amostra sanitizada: 2.000;
- maior cluster: 6;
- clusters acima do limite: 0;
- operações: 280.199;
- memória estrutural aproximada: 101.628.790 bytes;
- duração da execução confirmatória: 36.910 ms;
- banco, schema e contagens inalterados;
- SQL bloqueado: 0;
- erros: 0.

## Proteção operacional

Antes do primeiro apply foi criado e validado um backup integral fora do Git:

- tamanho: 141.336.576 bytes;
- SHA-256: `e5457174396fb5734e258a72816872722b30b8f6f74dce3aa65bb6a6a3f8efba`;
- origem permaneceu inalterada durante a cópia;
- WAL, SHM e journal ausentes.

Antes da prova de idempotência foi criado um segundo backup integral do estado
pós-apply:

- tamanho: 422.682.624 bytes;
- SHA-256: `64837bb6ccb3a92edcd1dfb4840941e95b973af3c5184ecf79095c0bedf67b9f`.

Os backups não foram adicionados ao repositório.

## Correções operacionais mínimas

Duas tentativas iniciais foram bloqueadas antes de qualquer DDL ou persistência.
O estado read-only confirmou schema mestre ausente e origens intactas após os
bloqueios.

Foram corrigidos somente gates do executor:

- criação autorizada das tabelas mestre deixou de ser confundida com drift do
  schema legado;
- `ON DELETE RESTRICT` no DDL aprovado deixou de ser confundido com comando
  `DELETE`;
- `quick_check`, `schema_version` e `user_version` passaram a ser aceitos
  somente como PRAGMAs de leitura.

Continuam bloqueados comandos destrutivos, tabelas fora da camada mestre,
mudança de `user_version` e mudança de journal. Não houve alteração de
normalização, candidatos, conflitos, elegibilidade, limites ou regras de merge.

## Apply controlado

Resultado: `APPLY_OK`.

- registros lidos: 59.143;
- lotes: 779;
- mestres criados: 47.928;
- vínculos de origem criados: 59.143;
- identificadores criados: 103.907;
- conflitos criados: 34.051;
- participantes de conflitos criados: 143.200;
- checkpoints criados: 2;
- jobs: 1;
- histórico de merge: 0;
- falhas: 0;
- conflitos bloqueantes persistidos: 20.986;
- fontes atualizadas: 0;
- duração: 550.532 ms;
- pico de RSS: 1.178.173.440 bytes.

O fingerprint do estado persistido foi:

`0111d094a41506da4077b676324d771f6f1c9ed542ab39515e54c76dd21aa925`

## Verify independente

Resultado: `VERIFY_OK`.

- fingerprint observado igual ao planejado;
- linhas ausentes: 0;
- linhas inesperadas: 0;
- hashes de origem divergentes: 0;
- vínculos de origem duplicados: 0;
- clientes liberados: 0;
- histórico de merge: 0;
- `contacts` antes/depois: 36.502;
- `crm_contacts` antes/depois: 22.641;
- duração: 65.583 ms.

## Segunda execução idempotente

Resultado: `APPLY_OK`, estritamente idempotente.

- mestres: 0 criados, 47.928 inalterados;
- vínculos: 0 criados, 0 atualizados, 59.143 inalterados;
- identificadores: 0 criados, 103.907 inalterados;
- conflitos: 0 criados, 34.051 inalterados;
- participantes: 0 criados, 143.200 inalterados;
- checkpoints: 0 criados, 0 atualizados, 2 inalterados;
- falhas: 0;
- fingerprint do estado persistido inalterado;
- duração: 228.263 ms.

## Auditoria final read-only

- `quick_check=ok`;
- `query_only=1`;
- job único com status `COMPLETED`;
- `codeVersion` e fingerprint oficial persistidos;
- `NOT_EVALUATED`: 3.904;
- `REVIEW_REQUIRED`: 44.024;
- clientes liberados: 0;
- `user_version`: 0;
- WAL, SHM e journal ausentes;
- contagens e schema das origens preservados.

O aumento de `schema_version` de 332 para 364 corresponde exclusivamente à
criação autorizada das oito tabelas e índices da camada mestre.

## Resultado

`CUSTOMER_MASTER_CONTROLLED_BACKFILL_OK`

Classificação: `PHASE_3_1_E_COMPLETE`.

Não houve rota, consumidor operacional, conta de aplicativo, merge, push, PR,
deploy ou avanço automático.
