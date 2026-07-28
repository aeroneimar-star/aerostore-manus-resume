# FASE 3.1-B — SCHEMA EXPANSIVO DA CAMADA MESTRE

## Objetivo

Criar somente a fundação persistente, vazia e reversível da futura Camada Mestre de Clientes.
A migration não está ligada ao bootstrap, não abre banco por conta própria e depende de uma API
SQLite explicitamente injetada. Não há backfill, seed, consumidor, rota ou troca de leitura.

**DECISÃO APROVADA PELO PROPRIETÁRIO:** `contacts` e `crm_contacts` permanecem fontes de origem
inalteradas. Não existe propagação automática, elegibilidade para o app ou endereço principal.

## Padrão adotado

O repositório combina bootstrap em `db.js` para módulos ativos com DDL isolada para fundações
ainda não ativadas. Esta fase segue o segundo padrão, equivalente à migration isolada da camada
Shop: arquivo SQL idempotente e helper CommonJS injetável, sem registro em `initializeDatabase`.

Versão lógica: `customer-master-schema/v1`.

## Tabelas

| Tabela | Finalidade |
| --- | --- |
| `customer_master_records` | ID estável em texto, estado, versão e futura avaliação de elegibilidade |
| `customer_master_sources` | Vínculo reversível entre mestre e origem heterogênea |
| `customer_master_identifiers` | Hash de busca, máscara e valor protegido opcional por origem |
| `customer_identity_conflicts` | Evidência segura e estado de ambiguidades estruturais |
| `customer_identity_conflict_participants` | Participantes polimórficos de um conflito |
| `customer_master_merge_history` | Eventos append-only conceituais de merge, split, relink e reversão |
| `customer_master_jobs` | Metadados de futuras execuções controladas |
| `customer_master_sync_checkpoints` | Cursor incremental futuro por tipo de origem |

Todas usam chave primária `TEXT`. Timestamps seguem o padrão textual do projeto. A migration não
gera UUID, timestamps ou registros.

## Relações e constraints

- Fonte, identificador e histórico apontam para o mestre com `ON DELETE RESTRICT`.
- Identificador pode apontar para um vínculo de origem com `ON DELETE RESTRICT`.
- Participante aponta somente para o conflito; referências polimórficas não usam FK falsa.
- Checkpoint pode apontar para job com `ON DELETE RESTRICT`.
- Histórico pode apontar para o evento que o reverteu.
- `(source_type, source_id)` é único porque representa a mesma linha de origem.
- `(source_link_id, identifier_type, lookup_hash)` é único apenas dentro do vínculo exato.
- Participante não pode repetir `(conflict_id, participant_type, participant_id)`.
- Checkpoint é único por `source_type`.

Não existe unique global para CPF, telefone, e-mail, nome ou hash.

## Índices

| Índice | Finalidade |
| --- | --- |
| `idx_customer_master_records_status` | Filtrar mestres pelo estado de ciclo de vida |
| `idx_customer_master_records_eligibility` | Medir e consultar futura elegibilidade |
| `idx_customer_master_records_updated` | Cursor e ordenação por atualização |
| `idx_customer_master_records_deleted` | Filtrar soft delete |
| `idx_customer_master_sources_master` | Recuperar todas as origens de um mestre |
| `idx_customer_master_sources_hash` | Detectar mudança de snapshot da origem |
| `idx_customer_master_sources_status` | Filtrar vínculos ativos ou revogados |
| `idx_customer_master_sources_updated` | Cursor de atualização dos vínculos |
| `idx_customer_master_identifiers_master` | Recuperar identificadores de um mestre |
| `idx_customer_master_identifiers_source` | Recuperar identificadores de uma origem |
| `idx_customer_master_identifiers_lookup` | Buscar hash dentro do tipo de identificador |
| `idx_customer_master_identifiers_active` | Filtrar identificadores ativos por tipo |
| `idx_customer_identity_conflicts_status` | Priorizar conflitos por estado, severidade e data |
| `idx_customer_identity_conflicts_updated` | Cursor de revisão de conflitos |
| `idx_customer_conflict_participants_target` | Encontrar conflitos de um participante |
| `idx_customer_master_history_primary` | Histórico cronológico do mestre primário |
| `idx_customer_master_history_secondary` | Histórico cronológico do mestre secundário |
| `idx_customer_master_history_source` | Histórico cronológico de um vínculo de origem |
| `idx_customer_master_history_correlation` | Agrupar eventos da mesma operação futura |
| `idx_customer_master_jobs_status` | Fila e auditoria de jobs por estado/data |
| `idx_customer_master_jobs_type` | Histórico de jobs por tipo/data |
| `idx_customer_master_jobs_fingerprint` | Localizar fingerprint de execução futura |
| `idx_customer_master_checkpoints_job` | Relacionar checkpoints à execução que os produziu |
| `idx_customer_master_checkpoints_updated` | Cursor de atualização dos checkpoints |

Não há índice em PII integral ou JSON. `lookup_hash` é pesquisável somente junto do tipo.
As constraints unique de origem, identificador por vínculo e checkpoint criam apenas os
autoíndices internos necessários do SQLite.

## Elegibilidade, conflitos e histórico

**DECISÃO APROVADA PELO PROPRIETÁRIO:** o default de elegibilidade é `NOT_EVALUATED`, que não
concede acesso ao aplicativo. Nenhuma conta do app é criada.

**RECOMENDAÇÃO TÉCNICA:** snapshots JSON futuros devem conter somente evidência mínima,
mascarada e necessária. O schema não consegue garantir conteúdo seguro de JSON sem uma camada
de aplicação.

O histórico é append-only por contrato arquitetural. Triggers são proibidos nesta fase; portanto,
essa regra será aplicada por serviço administrativo futuro e auditado.

## Compatibilidade

Validado com Node.js 20.20.2, pacote `sqlite3` 5.1.7 e SQLite 3.44.2. A migration habilita e
confirma `PRAGMA foreign_keys = ON`, usa transação `BEGIN IMMEDIATE`, DDL SQLite convencional e
`CREATE ... IF NOT EXISTS`. Nenhum índice parcial é necessário.

## Rollback

O helper de rollback exige simultaneamente `confirmEmptySchema: true` e
`temporaryDatabaseOnly: true`, verifica que todas as oito tabelas estão vazias e remove somente
as estruturas novas em ordem segura. Ele não está ligado a script ou boot.

Depois que houver dados, eventos ou consumidores, apagar tabelas deixa de ser rollback aceitável;
a estratégia deverá ser desativação e compensação.

## Decisões não implementadas

- **DECISÃO PENDENTE:** retenção definitiva depende de validação jurídica.
- **DECISÃO PENDENTE:** política operacional de merge/split e conteúdo mínimo dos snapshots.
- **DECISÃO PENDENTE:** algoritmo, segredo e rotação do HMAC de `lookup_hash`.
- **DECISÃO PENDENTE:** partial unique de CPF somente depois de backfill, saneamento e relatório
  com zero violações.
- **RECOMENDAÇÃO TÉCNICA:** futura ativação deve começar por shadow-read mensurado, em outra fase.

## Riscos

- P0 mitigado: migration isolada, sem consumidor, dados, unique global, cascade ou elegibilidade.
- P1 residual: JSON seguro e append-only dependerão da futura camada de aplicação.
- P2 residual: estados textuais são deliberadamente expansíveis e precisarão de governança.
- P3 futuro: índices poderão ser ajustados somente com métricas reais de consulta.

## Ações proibidas nesta fase

Backfill, seed, alteração das origens, conta do app, autenticação do app, rota administrativa,
serviço de leitura, shadow-read, scheduler, worker, trigger, sincronização, mobile, push, PR,
merge e deploy.

## Próximo passo

Nenhum próximo passo é executado aqui. Qualquer ativação, backfill ou shadow-read pertence a uma
fase posterior e exige autorização independente.
