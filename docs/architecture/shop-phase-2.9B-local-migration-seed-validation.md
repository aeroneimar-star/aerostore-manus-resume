# Shop Fase 2.9B — Validação local da migration + seed

**Data:** 2026-07-22  
**Commit de referência:** `62e7925` — `feat(shop): prepare publication migration and seed`  
**Modo:** teste em **cópia local** do SQLite — **sem** VPS, **sem** deploy, **sem** catálogo público.  
**Catálogo público:** permanece **OFF** (`SHOP_PUBLIC_CATALOG_ENABLED` unset / default false).

---

## 1. Banco usado no teste

| Papel | Path |
|-------|------|
| SQLite principal (não modificado) | `data/aerostore-crm.sqlite` |
| Cópia de validação (única alvo de write) | `data/shop-phase-2.9B-validation.sqlite` |

Todas as operações de apply usaram:

```text
DATABASE_PATH=<repo>/data/shop-phase-2.9B-validation.sqlite
```

`db.js` resolve path via `process.env.DATABASE_PATH` — **nenhuma alteração** em `db.js` / boot / `server.js`.

---

## 2. Backup / cópia criada

| Arquivo | Notas |
|---------|--------|
| `backups/shop-2.9B/aerostore-crm.pre-2.9B-20260722-234907.sqlite` | Snapshot pré-teste (141 160 448 bytes; mtime origem 2026-07-16 20:24:49) |
| `data/shop-phase-2.9B-validation.sqlite` | Working copy usada para migration + seed |

**Prova de isolamento do principal:** após migration e seed, `data/aerostore-crm.sqlite` manteve  
`LastWriteTime = 16/07/2026 20:24:49` e tamanho `141160448`.  
A cópia cresceu para `141230080` (DDL + seed).

---

## 3. Status migration — antes / depois

### Antes (`--status-only` na cópia)

```json
{
  "ready": false,
  "tables": [
    { "table": "shop_product_publications", "ready": false },
    { "table": "shop_variant_publications", "ready": false },
    { "table": "shop_product_images", "ready": false },
    { "table": "shop_catalog_settings", "ready": false }
  ]
}
```

### Apply (somente cópia)

```text
SHOP_APPLY_MIGRATION=true DATABASE_PATH=.../shop-phase-2.9B-validation.sqlite \
  node scripts/shop_apply_publication_migration.js
```

Resultado: `SHOP_PUBLICATION_MIGRATION_OK` — `statements_executed: 9`, `after.ready: true`.

### Depois

```json
{
  "ready": true,
  "tables": [
    { "table": "shop_product_publications", "ready": true },
    { "table": "shop_variant_publications", "ready": true },
    { "table": "shop_product_images", "ready": true },
    { "table": "shop_catalog_settings", "ready": true }
  ]
}
```

**Sem** `shop_stock_reservations`.

---

## 4. Seed dry-run

```text
DATABASE_PATH=.../shop-phase-2.9B-validation.sqlite \
  node scripts/shop_seed_pilot_publications.js
```

Saída: `SHOP_SEED_PILOT_DRY_RUN_OK` / `mode: dry_run`  
8 produtos draft previstos; `will_create_variants: false`; `will_create_images: false`;  
`will_enable_public_catalog: false`; `catalog_public_enabled: false`.

---

## 5. Seed apply local (1ª execução)

Via runner seguro da fase:

```text
DATABASE_PATH=.../shop-phase-2.9B-validation.sqlite \
  node scripts/shop_phase_2_9b_local_validate.js --run-seed-apply
```

1ª execução (`SHOP_SEED_CONFIRM=true` + `--apply` na cópia):

- `settings.action: inserted`
- 8× `action: inserted`, `status_kept: draft`
- `catalog_public_still_off: true`

---

## 6. Idempotência (2ª execução)

Mesma cópia, segundo apply:

- `settings.action: updated`
- 8× `action: updated_by_slug`, mesmos `id` 1–8
- **sem** novos inserts / **sem** duplicar linhas
- contagem final permanece **8** publicações

---

## 7. Contagens finais (cópia)

| Tabela | Count |
|--------|------:|
| `shop_product_publications` | 8 |
| `shop_variant_publications` | 0 |
| `shop_product_images` | 0 |
| `shop_catalog_settings` | 1 |
| `pdv_products_v2` | 178 (igual baseline) |
| `pdv_product_variants` | 555 (igual baseline) |

Publicações: todos `status = draft`.  
`product_id`: **62, 63, 65, 66, 68, 72, 74, 75** (conjunto esperado).

`shop_catalog_settings`:

- `fulfillment_store_ids_json`: `["vila","botanico","sul"]`
- `stock_policy`: `min_across_stores`
- `reservation_ttl_minutes`: **30** (vindo de `shop-settings.json`, não do default DDL 15)
- `use_pilot_json_fallback`: 1
- catálogo público **não** ligado por esta tabela (flag continua env/default OFF)

---

## 8. Tabelas PDV

Baseline pré-migration na cópia: `pdv_products_v2=178`, `pdv_product_variants=555`.  
Pós seed: **iguais**. DDL/seed só tocam `shop_*`.

---

## 9. `db.js` dirty local

`git status` continua mostrando `M db.js` — **não** editado nesta fase, **não** incluído em commit.  
Scripts usaram apenas `DATABASE_PATH` já suportado.

---

## 10. VPS / deploy / flags

| Item | Status |
|------|--------|
| VPS | não acessada |
| Deploy | não feito |
| Migration no principal / VPS | não |
| `SHOP_PUBLIC_CATALOG_ENABLED` | unset (OFF) |
| Reservas | tabela inexistente |

---

## 11. Arquivos criados nesta fase (ainda sem commit)

| Arquivo | Tipo |
|---------|------|
| `docs/architecture/shop-phase-2.9B-local-migration-seed-validation.md` | documentação |
| `scripts/shop_phase_2_9b_local_validate.js` | validador (recusa path sem marker `shop-phase-2.9B-validation`) |
| `output/shop-phase-2.9B-validation.json` | relatório JSON da validação |
| `data/shop-phase-2.9B-validation.sqlite` | cópia local de teste (artefato local) |
| `backups/shop-2.9B/aerostore-crm.pre-2.9B-20260722-234907.sqlite` | backup pré-teste |

---

## 12. Como repetir (local only)

```powershell
$env:DATABASE_PATH = "$PWD\data\shop-phase-2.9B-validation.sqlite"
node scripts/shop_apply_publication_migration.js --status-only
# (se precisar recriar cópia a partir do principal, copiar de novo antes)
$env:SHOP_APPLY_MIGRATION = "true"
node scripts/shop_apply_publication_migration.js
Remove-Item Env:SHOP_APPLY_MIGRATION
node scripts/shop_seed_pilot_publications.js
node scripts/shop_phase_2_9b_local_validate.js --run-seed-apply
```

---

## 13. Commit

**Sem commit nesta fase** — aguardando aprovação explícita.
