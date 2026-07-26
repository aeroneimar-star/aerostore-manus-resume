# Shop Fase 2.9D.8 — Hardening SQL (P2-1 / P2-2)

**Branch:** `fix/shop-29d-sql-hardening`
**Base:** `wa-meta-api` @ `b091e071850ebb1c34362179172c1b32cac5a942`
**Escopo:** leitura admin de publicação, sem frontend e sem P2-3

---

## Correções

### P2-1 — `shop_product_images` ausente
`loadPublicationMapByProductIds` e `listPublicationRecords` passam a checar `isTableReady("shop_product_images")` e usam `0 AS image_count` quando a tabela não existe.

### P2-2 — `metadata_json` inválido
O aggregate `needs_photo` em `getPublicationLayerStats` extrai JSON apenas via:

```sql
CASE
  WHEN json_valid(p.metadata_json)
  THEN json_extract(p.metadata_json, '$.needs_photo')
  ELSE NULL
END
```

JSON inválido/NULL/vazio não aborta a query; o fallback continua coerente com ausência de flag + ausência de imagem.

## Fora desta fase
P2-3 (falha de `/api/shop/publications` mascarada como lista vazia) permanece backlog.

## Smoke
```text
node scripts/shop_phase_2_9d8_sql_hardening_smoke.js
→ SHOP_PHASE_2_9D8_SQL_HARDENING_OK
```
