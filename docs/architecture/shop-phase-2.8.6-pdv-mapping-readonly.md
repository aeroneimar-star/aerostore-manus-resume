# Shop Fase 2.8.6 — Mapeamento read-only intake editorial → PDV

**Data:** 2026-07-12  
**Modo:** Read-only — **sem** escrita em banco, **sem** alterar intake, **sem** publicação, **sem** migration.  
**Intake base:** `modules/shop/config/pilot-editorial-intake.json` (commit `f39e5c9`)  
**Catálogo público:** permanece **OFF**.

---

## 1. Objetivo

Comparar os **8 produtos editoriais** do intake com produtos reais do PDV (`pdv_products_v2` + variantes/estoque via serviço de curadoria), gerando relatório de candidatos e confiança — **sem gravar `product_id` / `variant_id` no JSON**.

## 2. Arquivos criados

| Arquivo | Papel |
|---------|--------|
| `scripts/shop_pilot_editorial_mapping_readonly.js` | Script read-only de matching |
| `docs/architecture/shop-phase-2.8.6-pdv-mapping-readonly.md` | Este relatório |
| `docs/architecture/shop-phase-2.8.6-mapping-report.json` | Saída estruturada da execução (artefato local; `docs/` gitignored) |

**Não alterados:** `pilot-editorial-intake.json`, backend, frontend, `server.js`, flags de catálogo.

## 3. Como o script funciona

1. Lê o intake (8 produtos, `status: draft`).  
2. Lista candidatos PDV via `listPdvPublicationCandidates` (paginado, sem candidatos QA/teste).  
3. Para cada editorial, pontua candidatos por:
   - igualdade / contenção de `source_product_name`
   - overlap de tokens fortes (`editorial_name` / source)
   - alinhamento de cor (Basic Preta, Off White, etc.)
   - proximidade de preço
   - sinal fraco de `sellable` / `is_potentially_publishable`
4. Classifica: `high` | `medium` | `ambiguous` | `low` | `no_match`.  
5. Emite relatório; **aborta** se o SHA-256 do intake mudar durante a execução.

### Confiança

| Nível | Uso |
|-------|-----|
| `high` | Candidato sugerido **só no relatório** — ainda exige aprovação humana antes de FK |
| `medium` | Revisar manualmente |
| `ambiguous` | Dois+ candidatos próximos — **não** auto-mapear |
| `no_match` / `low` | Sem FK sugerida |

`product_id` no relatório usa o campo admin `pdv_product_ref` — **nunca** escrito de volta no intake nesta fase.

## 4. Resultado da execução (ambiente local)

```text
SHOP_PILOT_EDITORIAL_MAPPING_READONLY_OK
pdv_candidates_scanned: 2
pdv_candidates_total (clean): 2
stats locais: total_raw 178 · hidden_test 176 · clean 2
intake_unchanged: true
wrote_to_database: false
wrote_to_intake: false
```

### Por que 8× `no_match` localmente?

O SQLite local **não contém** os produtos piloto AEROSTORE da VPS. Buscas por `SERIES BASIC`, `BASIC CORES`, `PIMA`, `TECH`, `AEROSTORE` retornaram **0** hits. Os 2 candidatos limpos locais são irrelevantes ao piloto (ex.: Bermuda Osklen; camiseta teste filtrada em outras queries).

**Conclusão:** o pipeline de matching está operacional; o **mapeamento real** só fecha ao rodar o mesmo script no ambiente cujo PDV tem o catálogo da loja (VPS / cópia do banco de produção).

### Resumo dos 8 mapeamentos (local)

| Slot | Editorial | Slug | Status | Match high | Ambíguo | Sem match |
|------|-----------|------|--------|------------|---------|-----------|
| 1 | Camiseta Series Basic AEROSTORE | `camiseta-series-basic-aerostore` | `no_match` | — | — | sim |
| 2 | Camiseta Basic AEROSTORE — Preta | `camiseta-basic-aerostore-preta` | `no_match` | — | — | sim |
| 3 | Camiseta Basic AEROSTORE — Off White | `camiseta-basic-aerostore-off-white` | `no_match` | — | — | sim |
| 4 | Camiseta Basic AEROSTORE — Branco | `camiseta-basic-aerostore-branco` | `no_match` | — | — | sim |
| 5 | Camiseta Basic AEROSTORE — Bege | `camiseta-basic-aerostore-bege` | `no_match` | — | — | sim |
| 6 | Camiseta Basic AEROSTORE — Brasil | `camiseta-basic-aerostore-brasil` | `no_match` | — | — | sim |
| 7 | Camiseta Pima AEROSTORE | `camiseta-pima-aerostore` | `no_match` | — | — | sim |
| 8 | Calça Tech AEROSTORE 5 Pockets | `calca-tech-aerostore-5-pockets` | `no_match` | — | — | sim |

### Contagens

| High confidence | Ambíguos | Sem match |
|-----------------|----------|-----------|
| **0** | **0** | **8** |

## 5. Próximo passo recomendado

1. Rodar no host com PDV real (VPS), sem deploy de catálogo:  
   `node scripts/shop_pilot_editorial_mapping_readonly.js`  
2. Anexar/atualizar o JSON de relatório com matches `high` / `ambiguous`.  
3. Revisão humana dos IDs sugeridos.  
4. **Só então** (fase posterior, com aprovação): preencher FKs no intake — ainda sem publicar.

## 6. Validações desta entrega

| Check | Resultado |
|-------|-----------|
| `node --check scripts/shop_pilot_editorial_mapping_readonly.js` | OK |
| Execução do script | OK (`…_MAPPING_READONLY_OK`) |
| Intake inalterado | OK (SHA verificado; FKs ainda `null`) |
| `catalog_public_enabled` | `false` |
| Escrita em banco | **Não** |
| `npm run check` | OK |
| Commit / deploy / migration | **Não** |

## 7. Confirmações

- Entrega **read-only**.  
- **Não** houve commit, deploy, banco ou migration nesta fase.  
- Intake **não** recebeu `product_id` / `variant_id`.  
- Nada publica no site.
