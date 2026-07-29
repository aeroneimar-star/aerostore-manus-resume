# FASE 3.1-C — SERVIÇO MESTRE EM SHADOW-READ

## Objetivo

Criar a primeira leitura isolada da Camada Mestre, sem alterar comportamento operacional.
Shadow-read significa execução explícita por testes ou futura instrumentação autorizada, sem
substituir resposta, decisão, autenticação, elegibilidade ou fonte da verdade.

**DECISÃO APROVADA PELO PROPRIETÁRIO:** `contacts` e `crm_contacts` continuam fontes oficiais.
A Camada Mestre ainda não substitui essas fontes e nenhum cliente pode ser liberado no app.

## Arquitetura

- `persistence/customerMasterReadRepository.js`: SQL exclusivamente de leitura com banco injetado.
- `dto/customerMasterDto.js`: DTOs allow-list e JSON sanitizado.
- `services/customerMasterReadService.js`: visão detalhada e elegibilidade observável.
- `services/customerMasterShadowComparisonService.js`: comparação pura em memória.
- `__tests__/customerMasterReadService.test.js`: SQLite `:memory:` e segurança de leitura.
- `__tests__/customerMasterShadowComparisonService.test.js`: contrato do comparador.

Não há singleton, conexão global, import de `db.js`, container ou framework novo.

## Operações suportadas

O serviço busca e lista mestres, lista fontes, identificadores e conflitos relacionados, monta
visão detalhada, localiza por source link, consulta candidatos por tipo/hash e interpreta o
snapshot de elegibilidade. O comparador recebe duas visões já fornecidas pelo chamador.

## Operações proibidas

Não cria, atualiza ou exclui mestre; não executa merge/split, backfill, job, checkpoint,
sincronização, resolução de conflito, schema, autenticação ou autorização. Não consulta origens
legadas diretamente e não grava comparação.

## Repository read-only

O repository aceita apenas `dbApi.get` e `dbApi.all`. Todas as queries usam colunas explícitas e
parâmetros posicionais. Um gate interno aceita somente `SELECT`/`WITH` e rejeita comandos de
escrita, DDL, attach/detach, vacuum e PRAGMA mutável. O módulo não expõe `run`, `execute`,
`insert`, `update`, `delete` ou função SQL genérica.

## DTOs e campos bloqueados

Mestre expõe ID, nome de exibição, estado, versão, snapshot observável de elegibilidade e datas.
Fonte expõe referência, tipo, estado e datas. Identificador expõe somente máscara, classificação,
validação, verificação e ciclo de vida. Conflito expõe classificação, evidência sanitizada,
estado resumido da resolução e datas.

Nunca são expostos `lookup_hash`, `protected_value`, `source_hash`, valor canônico integral,
HMAC, payload bruto ou PII integral. JSON inválido produz warning estável e conteúdo `null`/vazio,
sem retornar o texto original.

## Paginação e filtros

O padrão é 25 itens e o máximo é 100. A ordenação estável usa coluna allow-list mais `id`.
Filtros permitidos: status, eligibility status, soft-delete, `updated_at` e source type.
Ordenação, direção, source type e identifier type inválidos são rejeitados.

Não existe busca por PII bruta. Consulta por identificador recebe somente hash previamente
calculado por uma camada futura autorizada ou hash sintético de teste.

## Source link e identificadores

Source type aceita somente `contacts` e `crm_contacts`; a consulta lê exclusivamente
`customer_master_sources`. Vínculo revogado é retornado como tal.

Identifier type aceita `PHONE`, `CPF`, `EMAIL`, `EXTERNAL_ID` e `OTHER_DOCUMENT`. Zero, um ou
vários mestres podem ser retornados. Múltiplos resultados permanecem
`MULTIPLE_MASTER_CANDIDATES`; nenhuma unicidade global é inferida.

## Visão detalhada e conflitos

A visão combina mestre, fontes, identificadores mascarados, conflitos e elegibilidade observável.
Participantes de conflito podem referenciar mestre, source link ou identificador. Estados
`OPEN`, `UNDER_REVIEW` e `REOPENED` geram warning de revisão administrativa.

Endereço não existe no schema mestre v1 e, portanto, aparece somente como observação indisponível.
Nenhum endereço principal é escolhido.

## Elegibilidade observável

`NOT_EVALUATED` nunca concede acesso. Soft-delete bloqueia a observação; conflito aberto exige
revisão; fonte revogada não conta como ativa. Todo resultado usa:

`accessDecision: "NOT_AVAILABLE_IN_PHASE_3_1_C"`.

Esse objeto não é autorização e não participa de login ou aprovação.

## Comparação shadow

O comparador é puro, determinístico e não acessa banco. Compara presença, nome, identificadores
mascarados, contagens, conflitos, status, elegibilidade observável e disponibilidade de endereço
por origem. Retorna summary, diferenças sem valores, warnings, campos comparados, ignorados e
versão.

Classificações: `MATCH`, `DIFFERENT`, `MISSING_IN_MASTER`, `MISSING_IN_LEGACY`, `AMBIGUOUS`,
`UNSAFE_TO_COMPARE` e `INVALID_INPUT`.

## Compatibilidade com o legado

O adapter aceita somente o DTO público mascarado necessário. Não corrige o serviço unificado.
Incompatibilidades conhecidas: `unified_id` instável, merge por e-mail, união transitiva,
telefone não confirmado, CPF sem checksum, escolha por comprimento, redução de múltiplos
identificadores e conflitos detectados depois do merge.

## Segurança e consumidores

Não há rota, rede, servidor, banco real, schema automático, feature flag, import operacional ou
consumidor. Os testes aplicam a 3.1-B somente em SQLite `:memory:` e inserem sentinelas sintéticas.

## Testes

Os testes cobrem banco vazio, fontes isoladas e combinadas, múltiplos identificadores,
duplicidade de telefone/CPF, conflitos abertos e resolvidos, revogações, JSON inválido,
soft-delete, source/hash lookup, paginação, allow-lists, limites, determinismo, ausência de
mutação, campos proibidos e comparação divergente/ambígua.

## Rollback

Como não há consumidor ou alteração de banco real, rollback é retirar o commit local ou manter
os módulos sem import. Não existe script destrutivo e o schema 3.1-B não foi alterado.

## Limitações e decisões pendentes

- **DECISÃO PENDENTE:** retenção jurídica e conteúdo mínimo de evidência.
- **DECISÃO PENDENTE:** HMAC, segredo, rotação e camada autorizada de lookup.
- **DECISÃO PENDENTE:** métricas e orçamento de performance antes de qualquer consumidor.
- **RECOMENDAÇÃO TÉCNICA:** futura instrumentação deve continuar sem impacto na resposta até
  aprovação independente.

## Próximo passo

Nenhuma integração é iniciada aqui. Qualquer consumidor, rota, dry-run de backfill ou fase
posterior exige nova autorização explícita.
