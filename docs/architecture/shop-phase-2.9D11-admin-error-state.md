# Shop Fase 2.9D.11 — Estado de erro da admin de publicação

**Branch:** `fix/shop-29d-admin-publications-error`
**Base:** `wa-meta-api` @ `9885c2f015258249995253172016e02655efe950`

---

## Problema (P2-3)

`GET /api/shop/publications` com falha era capturado como `null` e a faixa SQL renderizava:

```text
Nenhum draft em shop_product_publications.
```

## Correção

Estados separados para a faixa de drafts:

- **error** — falha HTTP/rede/JSON/contrato
- **empty** — sucesso com coleção vazia
- **drafts** — sucesso com itens
- **schema_absent** — schema shop_* indisponível

Candidates e publications carregam de forma independente.

## Smoke

```text
node scripts/shop_phase_2_9d11_admin_error_state_smoke.js
→ SHOP_PHASE_2_9D11_ADMIN_ERROR_STATE_OK
```
