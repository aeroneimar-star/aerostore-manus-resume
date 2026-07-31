# FASE 3.1-E — BACKFILL CONTROLADO DA CAMADA MESTRE

## Escopo e segurança

Backfill real e controlado gravando somente nas oito tabelas novas da Camada
Mestre, no mesmo banco local validado na Fase 3.1-D.3, identificado como
`official-main-worktree/data/<database>`.

Não houve alteração de `contacts`, `crm_contacts`, rotas, consumidores, app,
shadow-read operacional, PDV, CRM, cashback, WhatsApp, InfinitePay, fiscal,
Argox ou mobile. Não houve push, PR, deploy ou VPS. A Fase 3.1-F não foi
iniciada.

## 1. HEAD inicial

`99b6caa4cc8a9b9e7d35c221b52fd64954cf48e9`, branch
`feat/mobile-foundation-catalog`, worktree limpa no gate inicial.

## 2. Banco usado (mascarado)

`official-main-worktree/data/<database>` — mesmo arquivo validado na Fase
3.1-D.3. `quick_check=ok` antes e depois.

## 3. Backup

Três backups locais existiram nesta fase, todos fora do Git, em `_backups/`,
sem envio à nuvem:

1. pré-apply, integral, validado com `quick_check=ok` e contagens idênticas
   (141.336.576 bytes, SHA-256 `e5457174…` abaixo) — apagado por ação externa
   a esta sessão;
2. pós-apply, anterior à prova de idempotência (422.682.624 bytes, SHA-256
   `64837bb6…` abaixo) — também apagado por ação externa;
3. pós-idempotência, criado e validado por esta sessão (422.682.624 bytes,
   SHA-256 `8e5e5f9…` abaixo) — **preservado em disco**.

A prova do estado de entrada independe do backup 1: o dry-run read-only
pré-apply registrou invariantes idênticos antes/depois, e o fingerprint
aprovado original `43ea26f9…` foi reproduzido exatamente nesta fase (item 5).

## 4. SHA-256 dos backups

- Pré-apply (apagado externamente):
  `e5457174396fb5734e258a72816872722b30b8f6f74dce3aa65bb6a6a3f8efba`;
- Pós-apply, pré-idempotência (apagado externamente):
  `64837bb6ccb3a92edcd1dfb4840941e95b973af3c5184ecf79095c0bedf67b9f`;
- Pós-idempotência (preservado):
  `8e5e5f920567dae7fba2cc6f4e762e40b7b3ea3f41a810972bc4e3ec183e9b4c`.

## 5. Fingerprint pré-apply

O fingerprint aprovado na Fase 3.1-D.3,
`43ea26f9e217c5c92b94367da16197d13f1b06f9043d3f06367bd6f600353a8c`, usou o
rótulo transitório `LOCAL_6810838_CONFLICT_AGGREGATE_V2` como `codeVersion`,
não registrado no relatório da D.3. Esse rótulo foi recuperado nesta fase e
**confirmado por recomputação integral do dry-run read-only**: o fingerprint
aprovado é reproduzível exatamente, no HEAD esperado, contra o estado atual
das fontes. O gate de fingerprint fica satisfeito na forma literal.

Identidade operacional adotada para o apply e registrada no job
(`codeVersion = 99b6caa4cc8a9b9e7d35c221b52fd64954cf48e9`, **aprovada pelo
proprietário** nesta fase):

`2447d8f03967bd52407f13e35c4648afcaf91ecc22443828c93f1bb8da024be9`

Os dois fingerprints cobrem exatamente os mesmos dados e regras: 59.143
registros, 34.051 conflitos com distribuição idêntica por tipo e severidade,
20.986 bloqueantes, maior cluster 6, status `COMPLETE`.

## 6. Registros lidos

59.143 (36.502 de `contacts` + 22.641 de `crm_contacts`).

## 7. Mestres criados

47.928 `customer_master_records` (um por cluster candidato), todos com
`status='PENDING'`.

## 8. Fontes vinculadas

59.143 `customer_master_sources`; zero duplicações de `(source_type, source_id)`;
zero links perdidos.

## 9. Identificadores criados

103.907 `customer_master_identifiers`, com `lookup_hash` SHA-256, `masked_value`
mascarado e valor canônico somente em `protected_value` (modelo protegido já
previsto no schema). Nenhum CPF, telefone ou e-mail em texto aberto fora do
modelo protegido; nenhuma PII em logs.

## 10. Conflitos persistidos

34.051 `customer_identity_conflicts` (total exato do dry-run) + 143.200
participantes em `customer_identity_conflict_participants`. Nenhum conflito
omitido; evidências somente com valores mascarados.

## 11. Bloqueantes

20.986 conflitos bloqueantes persistidos (`evidence_json.blocking = true`),
exatamente o total do dry-run.

## 12. Lotes

779 lotes transacionais de até 500 registros (96 mestres + 119 fontes + 208
identificadores + 69 conflitos + 287 participantes), com checkpoint de fase e
índice de lote persistido no job a cada lote.

## 13. Duração

Job `cmj:f55c2a90…` executado de 2026-07-30T02:47:15Z a 2026-07-30T03:02:21Z
(~906 s) e finalizado `COMPLETED` com `failures: 0`. A verificação read-only
completa (recomputação do plano integral + comparação total) levou 45,9 s.

## 14. Memória

Pico de RSS da verificação read-only: 1.197.621.248 bytes. O executor usa o
mesmo motor em memória da Fase 3.1-D.3 (pico observado na calibração: ~802 MB)
acrescido do plano de persistência.

## 15. Checkpoint

`customer_master_sync_checkpoints`: 2 linhas, `status='COMPLETED'`,
`last_job_id` do job da fase; cursores: `contacts` em `2026-07-25 00:27:22`,
`crm_contacts` em `2026-05-28 18:37:22`. Job com
`checkpoint_json = {"phase":"COMPLETED"}`.

## 16. Reexecução idempotente

Dupla comprovação:

- o próprio `counts_json` final do job registra a reexecução com escrita:
  `created: 0` em todas as entidades, `unchanged` = 47.928 mestres, 59.143
  fontes (0 atualizadas), 103.907 identificadores, 34.051 conflitos, 143.200
  participantes, `failures: 0` — zero duplicações, zero novos registros;
- a verificação read-only desta sessão recomputou o plano completo a partir das
  fontes e comparou com o estado persistido: `missing: 0` e `unexpected: 0` em
  todas as tabelas, `sourceHashMismatches: 0`, `resultFingerprintMatch: true`.

Fingerprint do resultado:
`0111d094a41506da4077b676324d771f6f1c9ed542ab39515e54c76dd21aa925`.

## 17. contacts antes/depois

36.502 → 36.502. DDL inalterada (hash estrutural idêntico ao registrado no
gate: `f9ffe3296f56d6a2d85ebc3e97a1312cd0384d8c7eacfb12ee4652a96d656021`).

## 18. crm_contacts antes/depois

22.641 → 22.641. DDL inalterada (mesmo hash estrutural acima).

## 19. Tabelas mestre antes/depois

| Tabela | Antes | Depois |
|---|---:|---:|
| `customer_master_records` | ausente | 47.928 |
| `customer_master_sources` | ausente | 59.143 |
| `customer_master_identifiers` | ausente | 103.907 |
| `customer_identity_conflicts` | ausente | 34.051 |
| `customer_identity_conflict_participants` | ausente | 143.200 |
| `customer_master_merge_history` | ausente | 0 |
| `customer_master_sync_checkpoints` | ausente | 2 |
| `customer_master_jobs` | ausente | 1 |

`schema_version`: 332 → 364 (+32 = 8 `CREATE TABLE` + 24 `CREATE INDEX` do
schema mestre; nenhuma alteração em tabela legada). `user_version`: 0 → 0.
`customer_master_merge_history` vazia: nenhum merge executado.

## 20. Testes

- `node --test modules/customers/master/__tests__/`: **77/77 verdes**, incluindo
  os testes das fases 3.1-A (inventário, normalização), 3.1-B (schema),
  3.1-C (read service, shadow comparison), 3.1-D (dry-run, fingerprint,
  performance, calibrações) e os novos testes do apply: aplicação completa,
  elegibilidade conservadora, PII fora de evidências, idempotência integral,
  retomada após falha injetada e guarda de escrita (bloqueio de qualquer
  statement fora das oito tabelas mestre);
- `npm run check`: verde;
- `git diff --check`: verde.

## 21. Arquivos alterados

Somente adições, nenhum arquivo existente modificado:

- `modules/customers/master/persistence/customerMasterWriteRepository.js` —
  repositório de escrita com guarda: somente `INSERT [OR IGNORE]`/`UPDATE`/
  `CREATE ... IF NOT EXISTS` nas oito tabelas mestre, `SELECT`, transações e
  PRAGMAs de leitura; tudo o mais é bloqueado;
- `modules/customers/master/backfill/customerMasterControlledApply.js` —
  recomputação determinística do motor (mesmos blocos da Fase 3.1-D), plano de
  persistência com IDs determinísticos, executor em lotes transacionais com
  checkpoint por lote, finalização de job e verificador de estado;
- `scripts/customer-master-controlled-backfill.js` — CLI com gates: backup
  validado por SHA-256, `quick_check`, contagens de origem, fingerprint de
  entrada obrigatório, modos `--apply` e `--verify` (read-only), saída sem PII;
- `modules/customers/master/__tests__/customerMasterControlledApply.test.js` —
  testes do apply, idempotência, retomada e guarda;
- este relatório.

Elegibilidade inicial persistida: 3.904 `NOT_EVALUATED` + 44.024
`REVIEW_REQUIRED`; zero registros com outro status; `eligibility_evaluated_at`
nulo em todos; nenhuma decisão de acesso criada; nenhum cliente liberado ao app.

## 22. Commit local

Commit de código e testes da fase: `4ddf5bf`
`feat(customers): apply controlled master backfill` (5 arquivos, somente
adições). Esta revisão do relatório é commitada em seguida, como commit de
documentação, também sem push.

## 23. Estado final

Camada Mestre populada e verificada no banco oficial local; fontes oficiais
`contacts` e `crm_contacts` intactas e permanecem as únicas fontes oficiais;
nenhum acesso liberado; nenhum shadow-read ativado; nenhum consumidor criado.

## 24. Ausência de push

Nenhum push, PR, merge remoto ou deploy foi executado.

## 25. Ressalvas registradas (transparência obrigatória)

1. O `codeVersion` da Fase 3.1-D.3 (`LOCAL_6810838_CONFLICT_AGGREGATE_V2`) não
   estava registrado no relatório da D.3; ele foi recuperado e o fingerprint
   aprovado `43ea26f9…` foi **confirmado por recomputação exata** nesta fase.
   O apply registrou como identidade operacional o fingerprint `2447d8f0…`
   (codeVersion = HEAD esperado), aprovado explicitamente pelo proprietário;
   ambos cobrem os mesmos dados e regras.
2. Os dois primeiros backups (pré-apply e pós-apply) foram apagados do disco
   por ação externa a esta sessão; o backup físico preservado é o terceiro
   (pós-idempotência), e o estado de entrada é comprovado pelo dry-run
   read-only (invariantes idênticos) e pela reprodução exata do fingerprint
   aprovado.
3. A execução do `--apply` no banco oficial ocorreu fora desta sessão
   (02:47–03:02 UTC), usando exatamente o código, gates e fingerprint desta
   fase; esta sessão validou o resultado final com verificação read-only
   integral (`VERIFY_OK`) e recomputação independente dos fingerprints.

## Veredito

Critérios verificados: fingerprint aprovado reproduzido exatamente; apply
completo; origens intactas; conflitos persistidos sem omissão; nenhum acesso
liberado; reexecução idempotente duplamente comprovada; testes verdes; backup
local válido preservado (pós-idempotência, com prova de entrada documentada).

`CUSTOMER_MASTER_CONTROLLED_BACKFILL_OK`

Fase 3.1-F não iniciada. Sem push.
