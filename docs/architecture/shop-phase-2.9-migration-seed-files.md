# Shop Fase 2.9 (prep) — Arquivos de migration + seed

**Data:** 2026-07-13  
**Modo:** Arquivos criados localmente — **não** aplicados, **não** semeados, **sem** banco/VPS/deploy.  
**Plano de referência:** [shop-phase-2.8.8-migration-seed-plan.md](./shop-phase-2.8.8-migration-seed-plan.md)  
**Catálogo público:** permanece **OFF**.

---

## 1. O que foi criado

| Arquivo | Papel |
|---------|--------|
| `modules/shop/database/shop-publication-ddl.sql` | DDL aditiva (4 tabelas + índices) |
| `modules/shop/database/shopPublicationMigration.js` | Helper: status + apply (não ligado ao boot) |
| `scripts/shop_apply_publication_migration.js` | CLI migration (exige `SHOP_APPLY_MIGRATION=true`) |
| `scripts/shop_seed_pilot_publications.js` | Seed idempotente (padrão dry-run; apply com flags) |

**Não alterados:** `db.js`, `server.js`, runtime Shop, feature flags, VPS.

---

## 2. Tabelas na DDL (sem reservas)

Incluídas:

- `shop_product_publications`
- `shop_variant_publications`
- `shop_product_images`
- `shop_catalog_settings` (`reservation_ttl_minutes` default 15 — só setting)

**Fora deste pacote:** `shop_stock_reservations` (fase posterior).

---

## 3. Como aplicar no futuro (quando autorizado)

### 3.1 Status (somente leitura)

```bash
node scripts/shop_apply_publication_migration.js --status-only
```

### 3.2 Migration (grava schema)

```bash
SHOP_APPLY_MIGRATION=true node scripts/shop_apply_publication_migration.js
```

Sem a env var → exit 2, nada escrito.

### 3.3 Seed dry-run (padrão)

```bash
node scripts/shop_seed_pilot_publications.js
```

### 3.4 Seed apply (grava drafts)

```bash
SHOP_SEED_CONFIRM=true node scripts/shop_seed_pilot_publications.js --apply
```

Exige schema `shop_*` já presente. Sem flags → só dry-run.

---

## 4. Regras do seed

- Fonte: `modules/shop/config/pilot-editorial-intake.json` (8 produtos, `product_id` preenchidos)
- Upsert por `public_slug` ou `product_id` (idempotente)
- Insert com `status = draft`; update **não** rebaixa `published` → `draft`
- `variant_id` null → **0** linhas em `shop_variant_publications`
- `needs_photo` → **0** linhas em `shop_product_images`
- Não liga `SHOP_PUBLIC_CATALOG_ENABLED`
- Não cria `shop_stock_reservations`
- Settings singleton: `vila` / `botanico` / `sul` a partir de `shop-settings.json`

---

## 5. Boot do server

`shopPublicationMigration` **não** é chamado por `initializeDatabase` / `db.js`.  
Reiniciar o server **não** aplica esta DDL.

---

## 6. Rollback conceitual

- Feature flag de catálogo público permanece OFF
- Publicações em `draft` / `archived` não aparecem na API pública
- DDL é aditiva (`IF NOT EXISTS`); não altera tabelas `pdv_*`
- Remoção de tabelas `shop_*` só sob ordem explícita (não automatizada aqui)
