# Protótipo visual — Catálogo AEROSTORE (Fase 2.4)

**Status:** protótipo local / piloto — **não é produção definitiva**

## Fase 2.4 — preparação produtos reais

| Item | Estado |
|------|--------|
| Guia de fotos para packshots reais | ✅ `shop-product-photo-guide.md` |
| Blueprint vitrine real (10–16 peças) | ✅ `shop-real-catalog-blueprint.md` |
| Contrato JSON v4 (campos futuros) | ✅ `pilot-publication-schema.v4.json` |
| DTO público aceita campos v4 | ✅ API `/public-api/products/:slug` |
| Visual catálogo/produto | ✅ mantido da Fase 2.3 (sem redesign) |
| Fotos reais no repo | ⏳ aguarda sessão de fotos |
| Render cuidados/medidas/descrição longa | ⏳ Fase 2.5 |

## Fase 2.3 — vitrine piloto ampliada

| Item | Estado |
|------|--------|
| Produtos piloto | ✅ 10 peças (camisetas, polos, calças, bermudas, calçados, acessórios) |
| Categorias realistas | ✅ 6 categorias |
| Fotos piloto premium locais | ✅ provisórias — sem packshots reais no repo |
| Microcopy e CTA | ✅ mantidos |
| Visual premium Fase 2.2 | ✅ mantido |

## Fase 2.2 — vitrine piloto realista

| Item | Estado |
|------|--------|
| Produtos piloto com nomes/categorias/preços AEROSTORE | ✅ 3 peças |
| Fotos piloto premium locais (PNG) | ✅ substituem SVG genérico |
| Microcopy: Seleção AEROSTORE, Ver produto, Consultar disponibilidade | ✅ |
| Página produto: galeria, cores, tamanhos, CTA desabilitado | ✅ |
| Aviso: vitrine piloto, sem compra online | ✅ |

## O que é protótipo visual (implementado agora)

| Item | Estado |
|------|--------|
| `/catalogo` HTML premium | ✅ piloto |
| `/produto/:slug` HTML premium | ✅ piloto |
| `/public-api/catalog` | ✅ JSON sanitizado |
| `/public-api/catalog/filters` | ✅ JSON sanitizado |
| `/public-api/products/:slug` | ✅ JSON sanitizado |
| Produtos piloto | ✅ `pilot-publications.json` (3 peças) |
| Header/footer alinhados à landing | ✅ reutiliza `site.css` + tokens |
| Preview local em `localhost` | ✅ via `AEROSTORE_SHOP_LOCAL_PREVIEW` implícito em dev |

## O que é arquitetura futura (documentado, não implementado)

- Tabelas `shop_product_publications`, `shop_orders`, etc. → ver [shop-schema-design.md](./shop-schema-design.md)
- Publicação via CRM admin
- Estoque online calculado a partir do PDV
- Carrinho, checkout, pagamento, reserva, cashback, WhatsApp

## O que depende de banco / migration

- Publicação persistente SQL
- Estoque real por loja na API pública
- Pedidos online e auditoria
- Leads de interesse persistidos

## O que depende de decisão comercial

- Loja(s) de fulfillment online (config provisória em `shop-settings.json`)
- Política de estoque (`min_across_stores` vs dedicada)
- Quais produtos entram no catálogo público
- Fotos reais vs placeholders
- Copy de CTA antes do checkout

## Testar localmente

```powershell
node server.js
```

URLs:

- http://localhost:3000/catalogo
- http://localhost:3000/produto/polo-pima-marinho
- http://localhost:3000/public-api/catalog
- http://localhost:3000/public-api/catalog/filters
- http://localhost:3000/public-api/products/polo-pima-marinho

Smoke de segurança:

```powershell
node scripts/shop_public_security_smoke.js
```

## Arquivos do protótipo visual

```
modules/shop/services/shopPageRenderer.js   # HTML catálogo + produto
modules/shop/dto/catalogListDto.js          # resumo cores/tamanhos/CTA
public/shop/assets/css/shop.css             # shell shop
public/shop/assets/css/catalog.css            # grid e cards
public/shop/assets/css/product.css          # página produto
public/shop/assets/js/shop.js               # micro-motion cards
modules/shop/config/pilot-publications.json # dados piloto (sem SQL)
```

## Landing institucional

A landing em `public/site/` e `site-content.json` **não foi alterada no conteúdo**.
Compatibilidade visual: catálogo reutiliza header, tokens CSS e assets `/assets/*` da landing.
