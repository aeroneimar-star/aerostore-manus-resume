# Shop Fase 2.8.8 — Plano de migration/seed da camada de publicação (pré-2.9)

**Data:** 2026-07-13  
**Modo:** Documentação / plano técnico — **sem** DDL, **sem** banco, **sem** deploy, **sem** runtime.  
**Commit de referência:** `975d178` — `feat(shop): map pilot editorial intake to PDV products`  
**Catálogo público:** permanece **OFF** (`SHOP_PUBLIC_CATALOG_ENABLED` / `catalog_public_enabled: false`).

---

## 1. Objetivo

Definir **como** a futura **Fase 2.9** deve criar a publication layer `shop_*` e semear os **8 produtos piloto** a partir de:

`modules/shop/config/pilot-editorial-intake.json`

Sem aplicar nada agora. Esta fase é o contrato operacional entre editorial (2.8.4–2.8.7) e migration (2.9).

### Pré-requisitos já cumpridos

| Fase | Entrega |
|------|---------|
| 2.8.4 | Copy editorial + slugs + brief de fotos |
| 2.8.5 | Intake JSON estruturado (`draft`) |
| 2.8.6 | Matching read-only VPS (8/8 high) |
| 2.8.7 | `product_id` reais no intake; `variant_id: null` |

---

## 2. Tabelas alvo da futura 2.9

Alinhado a [shop-schema-design.md](./shop-schema-design.md) — **publication layer espelho**, não cópia do PDV.

### 2.1 Incluir na 2.9 (DDL aditiva)

| Tabela | Papel |
|--------|--------|
| `shop_product_publications` | Gate editorial por `product_id` (slug, título, descrição, categoria, status, featured, sort) |
| `shop_variant_publications` | Espelho opcional por variação — **piloto 2.9 pode criar 0 linhas** enquanto `variant_id` no intake for `null` |
| `shop_product_images` | Galeria editorial (URL/alt/ordem); seed inicial vazio se `needs_photo=true` |
| `shop_catalog_settings` | Singleton (fulfillment, política de estoque, TTL reserva, limiar low stock) |

### 2.2 Plano apenas — **não aplicar na 2.9** (salvo decisão explícita)

| Tabela | Motivo de adiar |
|--------|-----------------|
| `shop_stock_reservations` | Pedidos/checkout ainda não existem; reserva é Fase 7. Documentar DDL futura, **não** criar na 2.9 por padrão |
| `shop_orders` / items / events | Fora do escopo publication layer |

**Decisão pendente do dono (checklist §7):** incluir `shop_stock_reservations` na 2.9 como DDL vazia (só schema) **ou** manter em fase separada.

### 2.3 Princípio

```
PDV (fonte da verdade)          shop_* (espelho editorial)
───────────────────────         ──────────────────────────
pdv_products_v2.id       ──FK─► product_id
pdv_product_variants.id  ──FK─► variant_id (quando existir)
SKU / barcode / custo           NÃO copiar
estoque por loja                NÃO persistir; calcular na projeção
```

---

## 3. Uso do intake como seed / import manual

**Fonte:** `modules/shop/config/pilot-editorial-intake.json` (fase `2.8.7`).

### 3.1 Estratégia recomendada (2.9)

1. **DDL** em `db.js` / `initializeDatabase` — `CREATE TABLE IF NOT EXISTS` (idempotente).  
2. **Seed script** (ex.: `scripts/shop_seed_pilot_publications.js`) que:
   - lê o intake;
   - valida 8 `product_id` não-nulos e `variant_id` nulos;
   - upsert em `shop_product_publications` por `product_id` **ou** `public_slug` (único);
   - **não** marca `published`;
   - **não** liga `SHOP_PUBLIC_CATALOG_ENABLED`;
   - grava auditoria simples (log / `metadata_json.seed_phase`).
3. Seed **idempotente:** reexecutar não duplica (UNIQUE em `public_slug` / `product_id`).
4. Import **manual** permitido: operador pode popular via admin futuro; o JSON permanece fonte canônica do piloto até o SQL estar estável.

### 3.2 O que o seed NÃO faz

- Não altera `pdv_products_v2` / variantes / estoque  
- Não cria vendas / pedidos  
- Não sobe fotos automaticamente (só registra placeholders se houver)  
- Não publica (`status` permanece `draft`)

---

## 4. Mapeamento campo a campo (intake → SQL)

### 4.1 `shop_product_publications`

| Campo intake | Coluna SQL | Notas 2.9 |
|--------------|------------|-----------|
| `product_id` | `product_id` | FK obrigatória (já mapeada VPS) |
| `editorial_name` | `public_title` | Nome comercial |
| `slug` | `public_slug` | UNIQUE; kebab-case |
| `category` | `public_category_slug` | `camisetas` / `calcas` |
| `short_description` | `metadata_json.short_description` **ou** coluna dedicada futura | Preferir metadata na 2.9 se DDL mínima |
| `full_description` | `public_description` | Copy longa |
| `tags` | `metadata_json.tags` | Array JSON |
| `featured` | `featured` | 0/1 |
| `sort_order` | `sort_order` | Ordem de vitrine |
| `status: "draft"` | `status` | Sempre `draft` no seed |
| `price_cents_ref` | — | **Não** gravar como verdade; override só se `public_price_cents` for decidido depois |
| `variant_id: null` | — | Sem linha em `shop_variant_publications` no piloto inicial |
| `photo_requirements` / `needs_photo` | — | Sem imagens até upload; ver §4.2 |
| Mapping meta (`pdv_product_name`, `mapping_confidence`, …) | `metadata_json.mapping` | Auditoria; **não** expor na API pública |

### 4.2 `shop_product_images`

| Situação | Ação no seed 2.9 |
|----------|------------------|
| `needs_photo: true` (atual) | **0 rows** — publicação draft sem galeria |
| Após upload em `public/shop/assets/img/products/...` | Insert com `url`, `alt_text`, `sort_order` |

### 4.3 `shop_variant_publications`

| Situação | Ação |
|----------|------|
| Intake `variant_id: null` | **Não semear** variantes na 2.9 piloto |
| Pós-decisão de grade web | Seed separado: 1 linha por variante ativa escolhida, com `public_variant_slug`, `status` |

### 4.4 `shop_catalog_settings` (id=1)

Seed mínimo sugerido (valores atuais de curadoria):

| Campo | Valor proposto |
|-------|----------------|
| `fulfillment_store_ids_json` | `["vila","botanico","sul"]` (confirmar em `shop-settings.json`) |
| `stock_policy` | `min_across_stores` |
| `reservation_ttl_minutes` | `15` (design; sem uso até pedidos) |
| `low_stock_threshold` | `2` |

---

## 5. Regras de segurança (API / DTO)

Mesmo com tabelas criadas, a projeção pública permanece sob [public-api-contracts.md](./public-api-contracts.md):

### Nunca expor (allow-list only)

- SKU, barcode, custo, margem  
- `store_id`, quantidades exatas (`available_qty`, `reserved_qty`)  
- IDs internos crus além do necessário (preferir slug público)  
- `product_id` / `variant_id` na API **pública** (admin CRM pode ver refs internas)  
- Objeto PDV serializado com block-list — **proibido**

### Obrigatório

- DTO público montado campo a campo (`modules/shop/dto/`)  
- Novos campos CRM **não vazam** por padrão  
- Host-gate nginx + app: `aerostore.site` só `/public-api/*` autorizados  

---

## 6. Regras de publicação

| Regra | Detalhe |
|-------|---------|
| Seed | Todos os 8 entram como **`draft`** |
| Catálogo público | Continua **OFF** até checklist §7 + go/no-go explícito |
| Critério de aparecer no site | `status=published` **e** produto PDV `ativo` **e** flag pública ON |
| Fotos | Sem packshot 4:5 aprovado → **não** promover a `published` |
| Copy | Revisão humana de nome/slug/descrição antes de publicar |
| Estoque | Disponibilidade **calculada** no pool; nunca número exato na API |
| **Pima (`product_id` 74)** | `availability_ref: low_stock` — publicar só com grade mínima revisada e copy/foto ok; pode ficar `draft` mais tempo que as Basics |

### Ordem sugerida de promoção (pós-2.9, operacional)

1. Series Basic + Basics com foto  
2. Calça Tech (âncora)  
3. Pima por último (ticket + low_stock)

---

## 7. Plano de rollback da futura 2.9

| Princípio | Como |
|-----------|------|
| Migration **aditiva** | Só `CREATE TABLE IF NOT EXISTS` + índices; sem `ALTER` destrutivo em PDV |
| Sem alterar tabelas PDV | Zero `DROP`/`UPDATE` em `pdv_*` |
| Sem remover dados | Rollback = desligar feature flag + `status=draft` / `archived` |
| Seed idempotente | Upsert por slug/`product_id`; re-run seguro |
| Desativar sem apagar | `SHOP_PUBLIC_CATALOG_ENABLED=false` e/ou `status != published` |
| Rollback extremo | `DROP TABLE` só das `shop_*` novas, em ambiente controlado — **nunca** em PDV |

---

## 8. Checklist antes da 2.9 (go/no-go)

### Editorial / ops

- [ ] Aprovar nomes e slugs dos 8 (doc 2.8.4 + intake)  
- [ ] Fotos 4:5 (mín. 1 packshot/produto; Pima e Tech com detalhe)  
- [ ] Composição / cuidados (pelo menos nos 3 destaques)  
- [ ] Revisar cor **Brasil** (tom real vs expectativa)  
- [ ] Revalidar disponibilidade PDV (especialmente Pima `low_stock`)  

### Técnico / produto

- [ ] Confirmar fulfillment stores em `shop-settings.json`  
- [ ] Decidir: `shop_stock_reservations` na 2.9 (DDL vazia) **ou** fase posterior  
- [ ] Script de seed revisado + dry-run em staging  
- [ ] Testes de contrato DTO allow-list  
- [ ] Aprovação explícita para aplicar DDL (esta fase **não** autoriza)

### Explicitamente fora até go-live

- Carrinho, checkout, pagamento, reserva ativa  
- Ligar catálogo público  

---

## 9. Riscos principais antes da migration

| Risco | Mitigação |
|-------|-----------|
| Publicar sem foto | Seed só `draft`; gate de `published` exige imagem |
| Overselling Pima (low_stock) | Atraso na promoção; política `min_across_stores` |
| Duplicar dados PDV em `shop_*` | Schema espelho + review de colunas |
| Vazamento de campos internos | Allow-list DTO + smokes |
| Migration em VPS divergente | DDL idempotente; backup SQLite antes; sem restart até validar |
| Seed não-idempotente | UNIQUE slug/`product_id` + upsert |
| Incluir reservas cedo demais | Adiar `shop_stock_reservations` |

---

## 10. Sequência proposta (quando 2.9 for autorizada)

```text
1. Backup SQLite staging/produção
2. DDL aditiva shop_product_publications (+ images, settings, variant table vazia)
3. Seed 8 drafts a partir do intake (product_id 72,63,65,66,62,68,74,75)
4. Validar: schema ready, 8 drafts, catalog OFF, DTO seguro
5. NÃO publicar / NÃO ligar flag pública
6. Só depois: fotos → review → publish seletivo
```

---

## 11. Referências

- [shop-schema-design.md](./shop-schema-design.md)  
- [ecommerce-architecture.md](./ecommerce-architecture.md)  
- [public-api-contracts.md](./public-api-contracts.md)  
- [shop-phase-2.8.7-pilot-fk-mapping.md](./shop-phase-2.8.7-pilot-fk-mapping.md)  
- `modules/shop/config/pilot-editorial-intake.json`

---

## 12. Confirmações desta entrega (2.8.8)

| Item | Status |
|------|--------|
| Arquivo | `docs/architecture/shop-phase-2.8.8-migration-seed-plan.md` (**criado**) |
| Código / migration / banco | **Não** |
| Deploy | **Não** |
| Catálogo público | **OFF** |
| Commit | **Não** (aguardando aprovação) |
