# Shop Fase 2.8.2 — Curadoria read-only dos candidatos

**Data:** 2026-07-11  
**Status:** Commitado localmente, sem deploy, sem migration, sem gravação no banco.

## Escopo

Curadoria read-only da tela/API admin de candidatos Shop (`/shop/publicacao`):

- Filtro QA/teste (`include_test_candidates`, default false)
- Coluna Motivo de bloqueio/indisponibilidade
- Filtros UI de curadoria (vendáveis, estoque, bloqueados, publicáveis potenciais)
- KPIs estendidos (total bruto, ocultos QA, limpos, vendáveis, etc.)
- Correção pool `vila_masc` → `vila` (read-only Shop)

## Arquivos

- `modules/shop/services/shopPublicationService.js`
- `modules/shop/dto/publicationAdminDto.js`
- `public/shopPublicationAdmin.js`
- `public/styles.css`
- `public/index.html`
- `modules/shop/config/shop-settings.json`
- `scripts/shop_publication_readonly_smoke.js`
- `scripts/shop_publication_admin_api_smoke.js`
- `scripts/shop_phase_282_validation.js`

## Confirmações

- Sem migration / tabelas shop (`schema_ready=false`)
- Sem gravação no banco
- `SHOP_PUBLIC_CATALOG_ENABLED` OFF
- `vila_masc` → `vila` afeta somente cálculo read-only Shop + futuro catálogo; PDV operacional inalterado

## KPIs local (pós 2.8.2)

| KPI | Valor |
|-----|-------|
| Total bruto PDV | 178 |
| Ocultos QA/teste | 176 |
| Candidatos limpos | 2 |
| Vendáveis (limpos) | 2 |
| Em estoque | 0 |
| Estoque baixo | 2 |
| Publicáveis potenciais | 2 |

## Smokes

```bash
npm run check
node scripts/shop_deploy_a1_smoke.js
node scripts/shop_publication_readonly_smoke.js
node scripts/shop_publication_admin_api_smoke.js
node scripts/shop_phase_282_validation.js
```
