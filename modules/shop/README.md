# Shop — E-commerce AEROSTORE (Fase 2)

Módulo de e-commerce público integrado ao CRM/PDV.

## Escopo atual (Fase 2.5)

- Catálogo read-only em `/catalogo` (host `aerostore.site`)
- API pública sanitizada em `/public-api/catalog`
- 10 produtos piloto via `config/pilot-publications.json`
- Template vitrine real: `config/real-catalog-intake.template.json` (não publicado)
- Fotos reais: `public/shop/assets/img/products/` (vazio, aguarda upload)
- Sem carrinho, pedido, pagamento ou migrations SQL

## Estrutura

```
modules/shop/
  config/           shop-settings.json, pilot-publications.json,
                    real-catalog-intake.template.json, pilot-publication-schema.v4.json
  dto/              publicProductDto.js
  middleware/       rate-limit, CORS, cache headers
  routes/           shopPublicRoutes, shopPublicApiRoutes, shopAdminRoutes (stub)
  services/         shopCatalogService, shopStockService (stub)
  utils/            shopHost.js
```

## Documentação

- [docs/architecture/ecommerce-architecture.md](../../docs/architecture/ecommerce-architecture.md)
- [docs/architecture/public-api-contracts.md](../../docs/architecture/public-api-contracts.md)
- [docs/architecture/shop-schema-design.md](../../docs/architecture/shop-schema-design.md)
- [docs/architecture/shop-prototype-visual.md](../../docs/architecture/shop-prototype-visual.md) — **protótipo visual atual**

- [docs/architecture/shop-product-photo-guide.md](../../docs/architecture/shop-product-photo-guide.md)
- [docs/architecture/shop-real-catalog-blueprint.md](../../docs/architecture/shop-real-catalog-blueprint.md)
- [docs/architecture/shop-phase-2.5-delivery.md](../../docs/architecture/shop-phase-2.5-delivery.md)

## Testes locais

```bash
# Smoke de segurança e isolamento
node scripts/shop_public_security_smoke.js

# Catálogo via Host header
curl -H "Host: aerostore.site" http://localhost:3000/catalogo
curl -H "Host: aerostore.site" http://localhost:3000/public-api/catalog
```

## Próximos passos

1. Aprovar schema SQL em `shop-schema-design.md`
2. Migrar `pilot-publications.json` → `shop_product_publications`
3. Fase 3: página `/produto/:slug`
