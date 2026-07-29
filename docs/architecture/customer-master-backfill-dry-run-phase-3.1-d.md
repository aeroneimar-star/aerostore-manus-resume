# FASE 3.1-D — DRY-RUN DE BACKFILL

## 1. Objetivo

**DECISÃO APROVADA PELO PROPRIETÁRIO:** esta fase cria somente um diagnóstico
reproduzível do futuro backfill. O motor lê, normaliza, agrupa conservadoramente,
detecta conflitos, simula elegibilidade e gera relatório e fingerprint em memória.
Ele não possui caminho de aplicação ou persistência.

## 2. Fontes oficiais

**DECISÃO APROVADA PELO PROPRIETÁRIO:** `contacts` e `crm_contacts` são as únicas
fontes oficiais. Nenhuma fonte auxiliar participa da identidade ou da elegibilidade.

## 3. Arquitetura

O desenho separa reader, modelo de origem, grafo de candidatos, detector de
conflitos, simulação de elegibilidade, relatório, fingerprint e comparação.
Todas as dependências são injetadas ou puras; não há conexão global, rota, worker,
scheduler, job ou checkpoint.

## 4. Reader

`customerMasterSourceReader.js` aceita uma API de banco com `get` e `all`. As
operações públicas contam as duas fontes, verificam seu schema e leem páginas com
colunas explícitas. Toda consulta passa pelo bloqueio de SQL somente leitura da
Fase 3.1-C. Não há `SELECT *`, interpolação de valores ou PRAGMA mutável.

## 5. Normalização

O modelo importa diretamente o contrato `customer-identity-normalization/v1` da
Fase 3.1-A. Telefone, documento, e-mail, nome e endereço não possuem
normalizadores paralelos. Identificadores vazios, inválidos e ambíguos preservam
classificação, warnings e reason codes.

## 6. Source hash

O source hash usa SHA-256 sobre serialização estável dos campos relevantes já
normalizados. Ele serve apenas à futura idempotência técnica: não é HMAC, não é
proteção de PII e não é exposto individualmente no relatório. Campos de importação
sem efeito semântico ficam fora do payload.

## 7. Candidatos

Cada linha começa como candidato individual determinístico
`dryrun:<source_type>:<source_id>`. Grupos continuam sendo IDs diagnósticos em
memória e nunca se tornam UUIDs mestre.

## 8. Regras de união

O grafo aceita somente: mesmo link de origem, external ID no mesmo namespace, CPF
válido com segundo sinal exato ou telefone canônico único no bucket com segundo
sinal exato. Segundo sinal pode ser nome normalizado exato, e-mail válido igual,
external ID consistente ou data de nascimento ISO válida. Nome, e-mail, CPF ou
telefone isolados não criam aresta; fuzzy match e cauda de telefone não existem.

## 9. Conflitos

São observados conflitos de telefone, CPF, e-mail, nome, source ID, estado da
fonte, múltiplos elegíveis e ponte transitiva. Participantes são referências de
origem e a evidence contém apenas tipo, contagem, fontes e valores mascarados.
`PHONE_RECYCLED` não é inferido por duplicidade; sem histórico, o relatório marca
que ele não é determinável.

## 10. Endereços

Cada endereço permanece dentro do seu registro de origem. O motor não escolhe
principal, não mistura campos, não preenche lacunas entre fontes e não usa endereço
como chave. O relatório expõe somente presença, completude e divergência por grupo.

## 11. Elegibilidade simulada

O teto é `SIMULATED_ELIGIBLE_SUBJECT_TO_PHONE_VERIFICATION`. Fonte inativa ou
excluída, falta de telefone válido ou conflito impedem esse estado. Em todos os
casos `accessDecision` é `NOT_AVAILABLE_IN_PHASE_3_1_D`; não há decisão real para
o aplicativo.

## 12. Fingerprint

O fingerprint inclui versões semânticas, versão de código, source type, source ID,
source hash, candidatos, conflitos, contagens e elegibilidade simulada em ordem
estável. Não inclui horário da execução, duração, caminho, hostname, usuário,
ordem incidental ou PII bruta. Relatórios incompletos recebem `fingerprint: null`.

## 13. Relatório

O relatório em memória é construído por allow-list. Ele contém fontes, páginas,
contagens, classificações, conflitos mascarados, elegibilidade simulada, warnings,
erros sanitizados, fingerprint e métricas técnicas. CPF, telefone, e-mail,
endereço, nome, lookup hash, protected value, source hash individual e payload
bruto não são serializados.

## 14. Segurança

**DECISÃO APROVADA PELO PROPRIETÁRIO:** não existe CLI nesta fase porque não é
necessária para a prova e ampliaria a superfície de abertura de arquivos. O motor
não importa banco global, `db.js`, `server.js`, módulo operacional, URL ou variável
de ambiente. Os testes obrigatórios usam somente SQLite `:memory:`.

## 15. Limites

Os defaults configuráveis são: página 250 (reader limitado a 500), 5.000 registros,
cluster 50, 2.000 conflitos, evidence 1 KiB, 200.000 operações lógicas e memória
aproximada 20 MiB. Excesso aborta com código seguro, status `INCOMPLETE` e sem
fingerprint válido. Não há truncamento silencioso.

## 16. Performance

O benchmark sintético cobre 0, 10, 100 e 1.000 isolados e duplicidade concentrada.
Buckets por identificador evitam comparação global O(n²); somente buckets
limitados geram pares. O orçamento inicial recomendado para 1.000 fixtures é
5 segundos e 20 MiB, exclusivamente como gate local, não SLA de produção.
Clusters acima do limite são interrompidos antes da explosão de pares.

## 17. Comparação com legado

A comparação recebe somente resumo/DTO sintético e resultados sanitizados do
shadow service 3.1-C. Ela compara grupos, fontes por grupo, tipos de identificador,
conflitos, mascaramento, estado e divergência de agrupamento. As classificações
são `MATCH`, `LEGACY_OVERMERGE_RISK`, `LEGACY_UNDERMERGE_RISK`,
`MASTER_REVIEW_REQUIRED`, `UNSAFE_TO_COMPARE` e `INVALID_INPUT`. Nenhuma delas
autoriza merge ou ação operacional.

## 18. Dry-run sintético

O cenário de integração cria as tabelas legadas e o schema mestre exclusivamente
em SQLite `:memory:`, insere fixtures sintéticas, captura contagens/timestamps,
executa o motor duas vezes e prova igualdade antes/depois e fingerprint estável.

## 19. Dry-run real não executado

**DECISÃO APROVADA PELO PROPRIETÁRIO:** nenhum arquivo SQLite operacional, banco
de produção ou staging foi aberto. Uma futura leitura real requer autorização
separada e abertura explicitamente read-only.

## 20. Ausência de escrita

O reader expõe apenas `get` e `all`, e todas as queries de produção começam por
`SELECT`. O código não oferece `apply`, persistência, backfill real, merge,
resolução, job ou checkpoint. Escritas existentes na suíte aparecem somente na
montagem isolada das fixtures `:memory:`.

## 21. Rollback

Como o motor não persiste nada, rollback significa encerrar a execução e descartar
o relatório e o banco em memória. Não há migration, tabela, arquivo ou registro a
reverter.

## 22. Riscos

- P0 mitigado: sem caminho de escrita, PII pública, acesso real ou fingerprint
  válido para execução incompleta.
- P1 mitigado: ordem explícita, hash/fingerprint determinísticos, buckets
  limitados, status e soft delete observados, transitividade conflitante.
- P2 residual: warnings e relatório podem crescer até os limites; thresholds
  precisarão de calibração com volume real autorizado.
- P3 residual: naming, métricas e apresentação podem evoluir sem alterar regras.

## 23. Próximo passo

**RECOMENDAÇÃO TÉCNICA:** submeter esta fase a revisão humana e, somente após
autorização específica futura, planejar a menor leitura read-only de volume e
distribuição para calibrar limites. Isso não autoriza apply nem inicia a Fase
3.1-E.

## 24. Ações proibidas

Continuam proibidos: apply, backfill real, persistência, merge, resolução,
migration, alteração de schema, banco real em escrita, rota, consumidor, worker,
scheduler, app/mobile, PDV, CRM operacional, push, PR, merge remoto, deploy, VPS e
início da próxima fase.

**DECISÃO PENDENTE:** qualquer execução contra banco real e qualquer desenho de
apply futuro dependem de nova autorização explícita.
