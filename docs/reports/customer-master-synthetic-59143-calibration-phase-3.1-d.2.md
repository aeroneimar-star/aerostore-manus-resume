# FASE 3.1-D.2 — CALIBRAÇÃO SINTÉTICA COM 59.143 REGISTROS

## Escopo

Calibração determinística e exclusivamente sintética do motor da Fase 3.1-D.
Nenhum banco real, PII, persistência, migration, backfill, apply, rota ou
consumidor foi utilizado.

## Volume e proporção

- `contacts`: 36.502;
- `crm_contacts`: 22.641;
- total: 59.143.

A proporção usa somente as contagens agregadas da Fase 3.1-D.1.

## Cenário representativo

O conjunto contém 1.000 pares sintéticos controlados e registros restantes
isolados. Também reproduz somente as contagens agregadas conhecidas de 2 fontes
inativas em `contacts`, 6 soft-deleted em `contacts` e 72 inativas em
`crm_contacts`. As identidades são artificiais e usam domínios reservados.

Resultado após o ajuste:

- status: `COMPLETE`;
- duração: 26.194 ms;
- custo: 442,90 ms por 1.000 registros;
- memória inicial RSS: 31.944.704 bytes;
- pico RSS: 650.264.576 bytes;
- memória final RSS: 632.963.072 bytes;
- heap final após GC: 101.199.376 bytes;
- memória estrutural aproximada: 100.469.178 bytes;
- operações: 122.366;
- comparações: 1.000;
- páginas: 147 de `contacts` e 91 de `crm_contacts`;
- grupos: 58.143;
- isolados: 57.143;
- seguros: 0;
- revisão necessária: 0;
- conflitantes: 1.000;
- maior cluster: 2;
- conflitos: 2.080;
- fingerprint determinístico:
  `bf2d4cc8ef12bede3506f0a78ba870dcc13bb09d1518ea602b55700d37ed027f`.

Conflitos agregados:

- `CPF_DUPLICATE`: 1.000;
- `PHONE_MISMATCH`: 1.000;
- `INACTIVE_SOURCE`: 74;
- `DELETED_SOURCE`: 6.

## Único cenário de estresse

Um bucket sintético de CPF com 51 registros excedeu o guard de 50 e encerrou
com `CLUSTER_SIZE_LIMIT_EXCEEDED`, `fingerprint = null`, em 18.785 ms. O guard
interrompeu antes da materialização quadrática dos pares. O maior bucket foi 51,
o pico RSS foi 568.729.600 bytes, o RSS final foi 510.775.296 bytes e o heap
final após GC foi 67.490.912 bytes.

## Gargalo e ajuste mínimo

Não houve sinal de O(n²): 59.143 registros exigiram somente 1.000 comparações no
cenário completo. O gargalo comprovado foi o perfil conservador de limites.

Foi criado o perfil explícito `synthetic-59143-v1`, restrito à calibração
read-only:

- máximo de registros: 59.143;
- máximo de conflitos: 5.000;
- memória estrutural aproximada: 128 MiB.

Os limites gerais do motor permanecem inalterados. O perfil só pode ser usado
por opção explícita; nenhum banco real foi aberto nesta fase.

## Veredito

`CUSTOMER_MASTER_SYNTHETIC_59K_CALIBRATION_OK`

A Fase 3.1-E permanece não iniciada.
