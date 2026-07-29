# FASE 3.1-D.3 — DRY-RUN REAL READ-ONLY COMPLETO

## Escopo e segurança

Foi reutilizado exclusivamente o banco local já aprovado na Fase 3.1-D.1,
identificado como `official-main-worktree/data/<database>`.

A conexão usou `OPEN_READONLY`, `PRAGMA query_only=1` e o perfil explícito
`synthetic-59143-v1`. Não houve apply, persistência, migration, backfill, rota,
consumidor, rede, VPS ou exposição de PII.

## Integridade e volume

- `quick_check`: `ok`, em 484 ms;
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

- status: `INCOMPLETE`;
- causa concreta: `OPERATION_LIMIT_EXCEEDED`;
- operações observadas: 280.199;
- limite: 200.000;
- duração total: 43.556 ms;
- páginas de fonte: 238, derivadas de 147 páginas de `contacts` e 91 de
  `crm_contacts`, todas com página máxima de 250;
- SELECTs registrados: 250;
- PRAGMAs de leitura: 12;
- SQL bloqueado/tentado: 0;
- memória inicial do processo: 14.798.848 bytes;
- pico de memória do processo: 800.477.184 bytes;
- última amostra de memória: 149.000.192 bytes;
- fingerprint: `null`.

O limite foi atingido depois da leitura e normalização das fontes e antes da
formação final de candidatos, conflitos e clusters. Por isso permanecem não
avaliados:

- candidatos isolados;
- candidatos seguros;
- revisão necessária;
- conflitos por tipo;
- maior cluster;
- clusters bloqueados.

Nenhum resultado parcial foi tratado como completo.

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

O relatório agregado passou a preservar o código de erro sanitizado do dry-run
incompleto. Nenhum limite, regra de identidade ou comportamento operacional foi
alterado.

## Veredito

`BLOQUEADO_LIMITES_REAIS`

Não classificado como `READY_FOR_CONTROLLED_BACKFILL`.
