# Shop Fase 2.8.5 — Intake editorial estruturado da vitrine piloto

**Data:** 2026-07-12  
**Modo:** Config + documentação — **sem** código de runtime, banco, migration, publicação ou deploy.  
**Catálogo público:** `SHOP_PUBLIC_CATALOG_ENABLED` permanece **OFF**.  
**Origem:** [shop-phase-2.8.4-editorial-pilot.md](./shop-phase-2.8.4-editorial-pilot.md) (commit `b7740df`).

---

## 1. Objetivo

Materializar os 8 produtos editoriais do piloto em um **JSON estruturado** que servirá de base para a Fase 2.9 (publication layer), **sem publicar** e **sem inventar FKs**.

## 2. Arquivo de intake

**Caminho:** `modules/shop/config/pilot-editorial-intake.json`

| Campo raiz | Valor |
|------------|--------|
| `version` | `1` |
| `phase` | `2.8.5` |
| `status` | `draft` |
| `catalog_public_enabled` | `false` |
| `products` | 8 itens |

### Por produto

| Campo | Conteúdo |
|-------|----------|
| `source_product_name` | Nome PDV |
| `editorial_name` | Nome comercial |
| `slug` | Slug público proposto |
| `category` | `camisetas` ou `calcas` |
| `price_label` | Preço ref. PDV (texto) |
| `featured` | boolean |
| `short_description` / `full_description` | Copy 2.8.4 |
| `tags` | Atributos comerciais |
| `photo_requirements` | Roles + arquivos sugeridos |
| `stock_notes` | Notas de grade |
| `publication_pending_checks` | Checklist pré-publicação |
| `needs_photo` | `true` |
| `needs_copy_review` | `true` |
| `needs_stock_review` | `true` |
| `needs_pdv_fk_mapping` | `true` |
| `product_id` / `variant_id` | **`null`** (sem FK inventada) |
| `status` | `draft` |

## 3. Os 8 produtos (resumo)

| Slot | Editorial | Slug | Preço | Featured |
|------|-----------|------|-------|----------|
| 1 | Camiseta Series Basic AEROSTORE | `camiseta-series-basic-aerostore` | R$ 129,90 | sim |
| 2 | Camiseta Basic AEROSTORE — Preta | `camiseta-basic-aerostore-preta` | R$ 79,90 | não |
| 3 | Camiseta Basic AEROSTORE — Off White | `camiseta-basic-aerostore-off-white` | R$ 79,90 | não |
| 4 | Camiseta Basic AEROSTORE — Branco | `camiseta-basic-aerostore-branco` | R$ 79,90 | não |
| 5 | Camiseta Basic AEROSTORE — Bege | `camiseta-basic-aerostore-bege` | R$ 79,90 | não |
| 6 | Camiseta Basic AEROSTORE — Brasil | `camiseta-basic-aerostore-brasil` | R$ 79,90 | não |
| 7 | Camiseta Pima AEROSTORE | `camiseta-pima-aerostore` | R$ 199,90 | sim |
| 8 | Calça Tech AEROSTORE 5 Pockets | `calca-tech-aerostore-5-pockets` | R$ 397,00 | sim |

`sort_order` no JSON segue a ordem de vitrine 2.8.4 (destaques Series → Pima → Tech, depois Basic).

## 4. O que esta fase NÃO faz

- Não lê o JSON no frontend/backend público (ainda não wired)
- Não altera `pilot-publications.json` de publicação
- Não liga catálogo público
- Não cria migration / tabelas `shop_*`
- Não inventa `product_id` / `variant_id`

## 5. Próximos passos (após aprovação)

1. Revisar copy/fotos/grade na loja  
2. Mapear FKs PDV reais (`needs_pdv_fk_mapping`)  
3. Só então Fase **2.9** (DDL + seed a partir deste intake)

## 6. Confirmações desta entrega

| Item | Status |
|------|--------|
| JSON criado | `modules/shop/config/pilot-editorial-intake.json` |
| Doc criado | este arquivo |
| Runtime / server / frontend | **Não alterado** |
| Banco / migration / deploy | **Não** |
| Commit | **Não** (aguardando aprovação) |
