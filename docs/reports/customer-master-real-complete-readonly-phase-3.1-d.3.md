# FASE 3.1-D.3 — DRY-RUN REAL READ-ONLY COMPLETO

## Escopo e segurança

Foi reutilizado exclusivamente o banco local já aprovado na Fase 3.1-D.1,
identificado como `official-main-worktree/data/<database>`.

A conexão usou `OPEN_READONLY`, `PRAGMA query_only=1` e o perfil explícito
`synthetic-59143-v1`. Não houve apply, persistência, migration, backfill, rota,
consumidor, rede, VPS ou exposição de PII.

## Integridade e volume

- `quick_check`: `ok`, em 4.593 ms;
- `contacts`: 36.502;
- `crm_contacts`: 22.641;
- total: 59.143;
- ativos: 59.063;
- inativos: 74;
- soft-deleted: 6;
- status desconhecido: 0;
- timestamp inválido: 0.

## Qualidade agregada

Telefones normalizados por classificação:

- celular brasileiro: 45.299;
- fixo brasileiro: 109;
- ambíguo: 1.974;
- inválido: 3.553;
- placeholder: 1.

CPF/documento por classificação:

- vazio: 35.576;
- CPF válido: 17.937;
- CPF inválido: 4.745;
- documento de outro tipo: 72;
- ambíguo: 813.

E-mail por classificação:

- vazio: 58.948;
- válido: 193;
- inválido: 2.

Nome por classificação:

- válido: 58.615;
- placeholder: 528.

Endereços:

- presentes: 17.101;
- ausentes: 42.042;
- completos: 15.135;
- incompletos: 1.966.

## Execução e limite

- status: `COMPLETE`;
- erros: 0;
- limite de operações aplicado: 400.000;
- operações: 280.199;
- comparações: 29.928;
- duração do dry-run: 30.132 ms;
- páginas de fonte: 238, sendo 147 de `contacts` e 91 de `crm_contacts`;
- SELECTs registrados: 250;
- PRAGMAs de leitura: 12;
- SQL bloqueado/tentado: 0;
- memória estrutural aproximada: 101.628.790 bytes;
- primeira amostra de memória do processo: 108.625.920 bytes;
- pico de memória do processo: 802.373.632 bytes;
- última amostra de memória: 375.525.376 bytes;
- fingerprint v2:
  `43ea26f9e217c5c92b94367da16197d13f1b06f9043d3f06367bd6f600353a8c`.

## Candidatos e clusters

- grupos candidatos: 47.928;
- isolados: 6.066;
- candidatos seguros: 4.670;
- revisão necessária: 1.262;
- candidatos conflitantes: 35.930;
- maior cluster: 6;
- clusters acima do limite 50: 0.

Histograma:

- tamanho 1: 37.992;
- tamanho 2: 8.732;
- tamanho 3: 1.140;
- tamanho 4: 55;
- tamanho 5: 7;
- tamanho 6: 2.

## Conflitos agregados

- `totalConflicts`: 34.051;
- `blockingConflictCount`: 20.986;
- `sampledConflictCount`: 2.000;
- `conflictsTruncated`: `true`.

Contagem por tipo:

- `CPF_DUPLICATE`: 6.157;
- `CPF_INVALID`: 5.558;
- `CPF_MISMATCH`: 57;
- `DELETED_SOURCE`: 6;
- `EMAIL_DUPLICATE`: 88;
- `INACTIVE_SOURCE`: 74;
- `MANUAL_REVIEW_REQUIRED`: 1.262;
- `MULTIPLE_ELIGIBLE_CUSTOMERS`: 7.423;
- `NAME_MISMATCH`: 277;
- `PHONE_DUPLICATE`: 7.426;
- `PHONE_MISMATCH`: 29;
- `PHONE_SHARED`: 5.614;
- `TRANSITIVE_MATCH_CONFLICT`: 80.

Contagem por severidade:

- `CRITICAL`: 13.174;
- `HIGH`: 7.535;
- `MEDIUM`: 13.254;
- `LOW`: 88.

A amostra é determinística, não participa do fingerprint e não contém
participantes, IDs, valores mascarados ou PII. As contagens representam todos
os 34.051 conflitos, sem truncamento agregado.

## Invariantes antes e depois

Permaneceram idênticos:

- arquivo principal: 141.336.576 bytes;
- timestamp de modificação;
- ausência de WAL, SHM e journal;
- `schema_version`: 332;
- `user_version`: 0;
- total de tabelas: 81;
- contagens de `contacts` e `crm_contacts`;
- ausência das oito tabelas mestre;
- hash estrutural do schema.

O wrapper registrou somente SELECTs e PRAGMAs de leitura. Nenhuma escrita foi
tentada ou executada.

## Correção mínima

O total de conflitos deixou de ser motivo de aborto. Todos os conflitos são
contados por tipo, severidade e bloqueio; somente a amostra detalhada é limitada
a 2.000 itens sanitizados. O fingerprint v2 usa os totais agregados e versões,
sem depender da amostra.

O perfil opt-in preserva 400.000 operações, cluster máximo 50 e memória
estrutural de 128 MiB. Os defaults gerais e todas as regras de normalização,
candidatos, conflitos e elegibilidade permanecem inalterados.

## Veredito

`CUSTOMER_MASTER_REAL_DRY_RUN_COMPLETE_OK`

Classificação: `READY_FOR_CONTROLLED_BACKFILL`.

Nenhum backfill persistente foi executado.
