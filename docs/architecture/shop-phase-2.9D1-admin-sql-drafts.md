# Shop Fase 2.9D.1 — Admin consome drafts SQL (`shop_*`)

**Worktree:** `aerostore-shop-29d` · branch `work/shop-29d`  
**Modo:** integração read-only da admin `/shop/publicacao` com `shop_product_publications`  
**Catálogo público:** permanece **OFF**

---

## Objetivo

Fazer a tela interna de publicação enxergar os **8 drafts** da camada `shop_*`, sem publish, sem deploy e sem recriar tabelas.

## O que mudou

- `shopPublicationService` expõe `publication_layer` (draft/featured/needs_photo) e enriquece o overlay editorial.
- Drafts SQL sem produto PDV na base local entram como candidatos sintéticos (garante os 8 na UI).
- `GET /api/shop/publications?status=draft` passa a devolver copy/categoria/`needs_photo`/imagens.
- UI: KPIs SQL, faixa dos 8 rascunhos, filtro “Rascunhos Shop (SQL)”, detalhe editorial.
- Botões Publicar/Editar continuam desabilitados.

## Evidência local

```text
DATABASE_PATH=.../shop-phase-2.9B-validation.sqlite
node scripts/shop_phase_2_9d1_drafts_smoke.js
→ SHOP_PHASE_2_9D1_DRAFTS_OK
```

- 8 drafts · IDs 62/63/65/66/68/72/74/75  
- `public_catalog_enabled=false`  
- 0 published SQL  

## Fora desta fase

Deploy · VPS · migration · seed · upload de fotos · publish · reservas · pasta original suja
