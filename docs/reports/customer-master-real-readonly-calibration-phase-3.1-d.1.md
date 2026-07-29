# FASE 3.1-D.1 — CALIBRAÇÃO REAL READ-ONLY

## 1. Objetivo

**DECISÃO APROVADA PELO PROPRIETÁRIO:** calibrar o motor da Fase 3.1-D contra
uma única base local real, sem backfill, persistência, merge, rota, consumidor ou
decisão de acesso.

## 2. Banco utilizado

O candidato selecionado foi identificado somente como
`official-main-worktree/data/<database>`. Ele pertence ao worktree principal
registrado pelo Git na branch oficial `wa-meta-api`, já existia antes da execução
e não foi baixado, copiado ou criado nesta etapa.

Outros arquivos localizados pertenciam a worktrees de teste, integração ou
revisão e não foram abertos.

## 3. Prova de read-only

O wrapper exigiu caminho explícito, raiz autorizada e `--read-only`. A biblioteca
abriu a conexão com `sqlite3.OPEN_READONLY`; `PRAGMA query_only` retornou `1`.
O wrapper não expõe `run` e bloqueia DML, DDL, `VACUUM`, `ATTACH` e `DETACH`
antes de chegarem ao SQLite.

## 4. Quick check

`PRAGMA quick_check` retornou `ok` em 8.660 ms. Nenhuma verificação destrutiva ou
`integrity_check` completo foi executado.

## 5. Volumes

| Fonte | Total | Inativos | Excluídos | Status desconhecido | Timestamp inválido |
|---|---:|---:|---:|---:|---:|
| `contacts` | 36.502 | 2 | 6 | 0 | 0 |
| `crm_contacts` | 22.641 | 72 | 0 | 0 | 0 |
| **Total** | **59.143** | **74** | **6** | **0** | **0** |

O volume total é 11,83 vezes o limite atual de 5.000 registros.

## 6. Qualidade dos dados

Identificadores, nomes e endereços não foram paginados nem normalizados porque o
Gate 6 interrompeu a execução antes da leitura integral. Portanto, essas métricas
permanecem **NÃO AVALIADAS**, sem amostragem ou extrapolação apresentada como
resultado real.

## 7. Candidatos

Candidatos isolados, seguros, em revisão e conflitantes permanecem **NÃO
AVALIADOS**. O motor não executou parcialmente e não produziu grupos.

## 8. Conflitos

Contagens por tipo permanecem **NÃO AVALIADAS**. Nenhum participante, source ID
ou identificador foi incluído neste relatório.

## 9. Elegibilidade simulada

Permanece **NÃO AVALIADA**. Nenhum cliente foi considerado aprovado para o app e
nenhuma decisão real de acesso foi produzida.

## 10. Endereços

Presença, completude e divergência permanecem **NÃO AVALIADAS**. Nenhum conteúdo
de endereço foi lido para relatório ou persistido.

## 11. Performance

A etapa agregada completa, incluindo quick check e dois snapshots, levou 8.863
ms. O dry-run de identidade não foi executado, portanto não há tempo real por
1.000 registros nem medição real das fases de normalização, candidatos,
conflitos e fingerprint.

## 12. Memória

Não houve medição de memória do conjunto real porque as páginas não foram
carregadas. Uma projeção linear simples baseada na fixture sintética pequena
indica ordem de grandeza superior ao orçamento de 20 MiB, mas ela não é medição
real e não deve ser usada como SLA.

## 13. Operações

O piso linear estimado é 118.286 operações para 59.143 registros, antes de
comparações por bucket e conflitos. Ele fica abaixo de 200.000 apenas como piso;
não prova que o orçamento completo seja suficiente.

## 14. Limites

Os limites permaneceram inalterados: página 250, máximo de página 500, 5.000
registros, cluster 50, 2.000 conflitos, evidence 1 KiB, 200.000 operações e 20
MiB aproximados. Nenhum limite foi elevado silenciosamente.

Resultado do gate: `CALIBRATION_LIMIT_EXCEEDED`.

## 15. Fingerprint

`fingerprint = null`, conforme a regra obrigatória para execução não integral.
O hash estrutural do schema permaneceu igual antes e depois, mas ele não é
fingerprint de dry-run.

## 16. Concorrência

Não houve `SQLITE_BUSY`, erro de I/O, mudança de schema, alteração de contagens
ou surgimento de WAL/SHM/journal durante a execução. Não ocorreu retry.

## 17. Ausência de escrita

Antes e depois permaneceram idênticos:

- tamanho do arquivo principal: 141.336.576 bytes;
- timestamp de modificação;
- `schema_version`: 332;
- `user_version`: 0;
- total de tabelas: 81;
- contagens das duas fontes;
- hash estrutural do schema;
- ausência de WAL, SHM e journal.

As oito tabelas mestre não existem nessa base; portanto nenhuma foi populada.
A conexão registrou somente SELECTs e PRAGMAs de leitura.

## 18. Ausência de PII

Este documento contém apenas contagens, métricas, versões e classificações.
Não contém nomes, source IDs, telefones, documentos, e-mails, endereços, hashes
por cliente, payloads ou caminho absoluto do banco.

## 19. Limitações

A calibração confirmou volume, estados agregados, integridade e invariantes, mas
não mediu qualidade de identificadores, candidatos, clusters, conflitos,
endereços ou custo integral do motor. Não houve comparação operacional com o
serviço legado.

## 20. Riscos

- P0: mitigado por `OPEN_READONLY`, `query_only=1`, seleção única e invariantes.
- P1: volume excede o limite; memória, clusters e conflitos reais são desconhecidos.
- P2: projeções de performance e memória ainda são imprecisas.
- P3: percentuais e apresentação podem ser refinados posteriormente.

## 21. Conclusão

Classificação de avanço: `TUNING_REQUIRED_BEFORE_BACKFILL`.

Classificação de performance: `PERFORMANCE_REQUIRES_TUNING`.

Veredito: `CUSTOMER_MASTER_REAL_READONLY_TUNING_REQUIRED`.

## 22. Recomendação para 3.1-E

**RECOMENDAÇÃO TÉCNICA:** não iniciar a Fase 3.1-E. Primeiro deve ser planejada e
aprovada uma estratégia de calibração integral que controle memória e explosão de
buckets para 59.143 registros, com limites explícitos e novos testes sintéticos
no volume correspondente.

**DECISÃO PENDENTE:** escolher entre processamento integral com orçamento
recalibrado ou execução diagnóstica em lotes que preserve uma única decisão
global de clusters e fingerprint.

## 23. Ações proibidas

Continuam proibidos apply, backfill real, persistência, merge, resolução,
migration, alteração das fontes, schema, rota, consumidor, app/mobile, servidor,
worker, scheduler, rede, VPS, push, PR, merge remoto, deploy e início da Fase
3.1-E.
