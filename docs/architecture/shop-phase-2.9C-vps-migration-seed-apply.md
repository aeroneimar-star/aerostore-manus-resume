# Shop Fase 2.9C — Aplicação real da migration + seed na VPS

**Data:** 2026-07-23 / 2026-07-24 UTC  
**Modo:** aplicação controlada no banco real de staging — **sem** deploy, **sem** restart PM2, **sem** catálogo público.  
**Commits de referência (repo):**  
- `62e7925` — `feat(shop): prepare publication migration and seed`  
- `552900c` — `test(shop): validate publication migration and seed locally`

---

## 1. Contexto

| Item | Valor |
|------|--------|
| Ambiente | VPS staging `/opt/aerostore/aerostore-crm-pdv-staging` |
| Branch VPS | `ui-dark-premium-polish` |
| HEAD VPS | `f37e369` |
| Working tree | limpa (sem pull/checkout/cherry-pick nesta fase) |
| Banco real | `/opt/aerostore/aerostore-crm-pdv-staging/data/aerostore-crm.sqlite` |
| Catálogo público | **OFF** (`SHOP_PUBLIC_CATALOG_ENABLED` unset / default false) |
| Artefato temporário | `/tmp/shop-29c-preflight/` (extraído de `origin/wa-meta-api@552900c`, depois removido) |

Subfases:

| Subfase | Resultado |
|---------|-----------|
| 2.9C.1 Preflight | status `ready:false`, dry-run OK, backup criado |
| 2.9C.2 Apply | DDL + seed draft no banco real |
| 2.9C.3 Pós-apply read-only | contagens/rotas/PM2/git OK |
| Limpeza `/tmp` | `/tmp/shop-29c-preflight/` removido |

---

## 2. Backup

| Campo | Valor |
|-------|--------|
| Path | `/opt/aerostore/_backups/shop-2.9C/aerostore-crm.pre-2.9C.1-20260724-011538.sqlite` |
| SHA256 | `4dc5da2e8ad11d1903c9883a154d7cc3b376893e075da57b9fd11a1012e16a8e` |
| `PRAGMA quick_check` antes | `ok` |
| `PRAGMA quick_check` depois | `ok` |

Backup **preservado** (não apagar).

---

## 3. Migration aplicada

DDL aditiva via scripts em `/tmp/shop-29c-preflight/` com:

```text
SHOP_APPLY_MIGRATION=true
DATABASE_PATH=/opt/aerostore/aerostore-crm-pdv-staging/data/aerostore-crm.sqlite
```

Tabelas criadas:

- `shop_product_publications`
- `shop_variant_publications`
- `shop_product_images`
- `shop_catalog_settings`

**Não** criada: `shop_stock_reservations`.

Schema `pdv_*` inalterado (hash de schema igual antes/depois na 2.9C.2).

---

## 4. Seed aplicado

Uma única execução real:

```text
SHOP_SEED_CONFIRM=true node scripts/shop_seed_pilot_publications.js --apply
```

| Tabela / regra | Resultado |
|----------------|-----------|
| `shop_product_publications` | **8** |
| `status = draft` | **8** |
| `product_id` | **62, 63, 65, 66, 68, 72, 74, 75** |
| `shop_variant_publications` | **0** |
| `shop_product_images` | **0** |
| `shop_catalog_settings` | **1** (`vila` / `botanico` / `sul`, TTL 30 via settings) |
| Catálogo público | **OFF** (`catalog_public_still_off: true`) |

Fonte: `modules/shop/config/pilot-editorial-intake.json` (origem `origin/wa-meta-api`).

---

## 5. Validação pós-apply (2.9C.3)

| Check | Resultado |
|-------|-----------|
| `git status --short` | limpo |
| HEAD / branch | `f37e369` / `ui-dark-premium-polish` |
| PM2 | sem restart — pid **414706**, restarts **68**, online |
| `https://aerostore.site/catalogo` | **404** |
| `https://aerostore.site/public-api/catalog` | **404** + body `SHOP_PUBLIC_CATALOG_DISABLED` |
| `https://crm.aerostore.site/pdv` | **200** |
| `https://crm.aerostore.site/shop/publicacao` | **200** (shell CRM interno) |

---

## 6. Decisões desta fase

- Produtos entram como **`draft`** — sem publish.
- Catálogo público **não** foi ligado.
- Imagens ficam **pendentes** (`needs_photo` / 0 rows).
- Variantes ficam para fase futura (`variant_id` null no intake).
- Reserva de estoque / TTL operacional fica **fora** da 2.9C (só setting TTL no singleton).
- Sem deploy do código Shop 2.9A/B no working tree da VPS — aplicação via extract em `/tmp` + `DATABASE_PATH`.

---

## 7. Próximos passos sugeridos

1. Revisar tela interna `/shop/publicacao` agora que o schema `shop_*` existe no banco real.
2. Preparar fase de upload / vínculo de imagens editoriais.
3. Preparar ativação controlada futura do catálogo público — ainda sem reservas.
4. Planejar `shop_stock_reservations` + TTL em fase separada (checkout/pedidos).
5. Quando autorizado: alinhar working tree da VPS com commits Shop (`wa-meta-api`) via fluxo de deploy explícito — **não** feito nesta fase.

---

## 8. Não feito nesta fase

- Deploy / PM2 restart  
- Pull / checkout / cherry-pick no staging  
- Ligar `SHOP_PUBLIC_CATALOG_ENABLED`  
- Segunda execução de seed na VPS  
- Criação de reservas  
- Commit automático desta documentação (requer aprovação)
