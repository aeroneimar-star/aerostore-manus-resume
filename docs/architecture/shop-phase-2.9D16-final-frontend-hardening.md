# Shop Fase 2.9D.16 — Hardening final do frontend

**Branch:** `fix/shop-29d-final-frontend-hardening`
**Base:** `wa-meta-api` @ `dd6922fd32ae150e4788092475d75a2d60a17f6c`

---

## P2-1 — retry

`resolveDraftStripKind` prioriza:

```text
loading → error → schema_absent → drafts → empty
```

Retry pendente nunca renderiza empty falso.

## P2-2 — items inválidos

Contrato mínimo estrutural:

```text
objeto
não nulo
não array
```

Campos editoriais ausentes continuam legítimos.

- entradas inválidas são filtradas;
- mistos preservam válidos;
- somente inválidos → erro de contrato;
- sem exceção em `item.status`.

## Smoke

```text
node scripts/shop_phase_2_9d16_final_frontend_hardening_smoke.js
→ SHOP_PHASE_2_9D16_FINAL_FRONTEND_HARDENING_OK
```
