# Shop — E-commerce AEROSTORE (Fase 2)

Módulo de e-commerce público integrado ao CRM/PDV.

## Escopo atual (Fase 2.7)

- Catálogo read-only em `/catalogo` (host `aerostore.site`)
- API pública sanitizada em `/public-api/catalog`
- 10 produtos piloto via `config/pilot-publications.json` (`use_pilot_json: true`)
- DDL proposto: `database/shop-publication-ddl.sql` (**não aplicado**)
- Seed vazio: `config/shop-publication-seed.json` (**não aplicado**)
- Serviço read-only: `services/shopPublicationService.js` (não ligado ao catálogo live)
- Template vitrine real: `config/real-catalog-intake.template.json` (não destino final)
- Sem carrinho, pedido, pagamento ou rotas admin HTTP ativas

## Estrutura

```
modules/shop/
  config/           shop-settings.json, pilot-publications.json,
                    shop-publication-seed.json, real-catalog-intake.template.json
  database/         shop-publication-ddl.sql (proposto, não aplicado)
  dto/              publicProductDto.js, publicationAdminDto.js
  middleware/       rate-limit, CORS, cache headers
  routes/           shopPublicRoutes, shopPublicApiRoutes, shopAdminRoutes (stub)
  services/         shopCatalogService, shopStockService, shopPublicationService
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
- [docs/architecture/shop-phase-2.6-integration-investigation.md](../../docs/architecture/shop-phase-2.6-integration-investigation.md)
- [docs/architecture/shop-phase-2.7-delivery.md](../../docs/architecture/shop-phase-2.7-delivery.md)

## Testes locais

```bash
# Smoke de segurança e isolamento
node scripts/shop_public_security_smoke.js

# Smoke read-only publicação (Fase 2.7)
node scripts/shop_publication_readonly_smoke.js

# Catálogo via Host header
curl -H "Host: aerostore.site" http://localhost:3000/catalogo
curl -H "Host: aerostore.site" http://localhost:3000/public-api/catalog
```

## Próximos passos

1. Aprovar e aplicar DDL manualmente (`shop-publication-ddl.sql` + backup)
2. Fase 2.9: UI admin CRM consumindo `shopPublicationService`
3. Desligar `use_pilot_json` quando publicações SQL estiverem prontas
