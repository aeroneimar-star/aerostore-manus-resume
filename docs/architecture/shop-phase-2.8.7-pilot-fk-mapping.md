# Shop Fase 2.8.7 — Aplicar mapeamento real (FK) no intake editorial

**Data:** 2026-07-13  
**Modo:** Atualização de config + documentação — **sem** banco, migration, publicação ou deploy.  
**Intake:** `modules/shop/config/pilot-editorial-intake.json`  
**Catálogo público:** `catalog_public_enabled: false` / `SHOP_PUBLIC_CATALOG_ENABLED` **OFF**.

---

## 1. Objetivo

Preencher `product_id` real dos **8 produtos piloto** no intake editorial, com base no relatório read-only da Fase 2.8.6 na VPS — **sem** publicar e **sem** escolher `variant_id` ainda.

## 2. Origem do mapeamento

| Item | Valor |
|------|--------|
| Ambiente | VPS read-only (`/tmp/shop-286-readonly/`) |
| Path staging | `/opt/aerostore/aerostore-crm-pdv-staging` |
| HEAD VPS | **`732cc1d`** |
| Branch VPS | **`ui-dark-premium-polish`** |
| Fase de matching | **2.8.6** |
| Resultado matching | **8 high** · 0 medium/low · 0 ambíguos · 0 sem match |
| Escritas na VPS | Nenhuma (repo limpo; só `/tmp`) |

## 3. Decisão

| Campo | Decisão |
|-------|---------|
| `product_id` | Preenchido (8/8) com IDs reais do PDV VPS |
| `variant_id` | Mantido **`null`** (grade multi-variante; seleção de variante fica para fase posterior) |
| `needs_pdv_fk_mapping` | **`false`** nos 8 |
| `status` | **`draft`** |
| `catalog_public_enabled` | **`false`** |
| Publicação / migration | **Não** |

## 4. Mapeamento aplicado

| Slot | Editorial | `product_id` | Nome PDV (ref.) | Availability ref. | Vars ref. |
|------|-----------|--------------|-----------------|-------------------|-----------|
| 1 | Camiseta Series Basic AEROSTORE | **72** | CAMISETA AEROSTORE SERIEs BASIC | in_stock | 32 |
| 2 | Camiseta Basic AEROSTORE — Preta | **63** | … BASIC CORES PRETO | in_stock | 5 |
| 3 | Camiseta Basic AEROSTORE — Off White | **65** | … OFF WHITE | in_stock | 5 |
| 4 | Camiseta Basic AEROSTORE — Branco | **66** | … BRANCO | in_stock | 5 |
| 5 | Camiseta Basic AEROSTORE — Bege | **62** | … BEGE | in_stock | 5 |
| 6 | Camiseta Basic AEROSTORE — Brasil | **68** | … BRASIL | in_stock | 8 |
| 7 | Camiseta Pima AEROSTORE | **74** | CAMISETA PIMA AEROSTORE CORES | **low_stock** | 4 |
| 8 | Calça Tech AEROSTORE 5 Pockets | **75** | CALÇA TECH … 5 FIVE POCKET | in_stock | 19 |

Metadados por produto (intake):

- `pdv_product_name`
- `mapping_confidence: "high"`
- `mapped_from_environment: "vps-readonly"`
- `mapped_from_phase: "2.8.6"`
- `availability_ref`
- `variants_count_ref`
- `mapping_review_required: false`

**Nota:** o PDV de Series Basic usa `SERIEs` (typo); o `source_product_name` editorial permanece `SERIES BASIC`.

## 5. O que esta fase NÃO faz

- Não liga catálogo público  
- Não cria/altera tabelas `shop_*`  
- Não altera backend/frontend/`server.js`  
- Não escolhe variante para impressão/venda web  
- Não faz deploy / restart / migration  

## 6. Próximos passos (após aprovação)

1. Commit do intake + esta doc (quando aprovado)  
2. Fotos / copy / grade (pendências editoriais restantes)  
3. Só então Fase **2.9** (DDL publication layer), com FKs já conhecidas  

## 7. Confirmações desta entrega

| Item | Status |
|------|--------|
| Intake atualizado | sim |
| Doc 2.8.7 | este arquivo |
| Banco / migration / deploy | **Não** |
| Commit | **Não** (aguardando aprovação) |
