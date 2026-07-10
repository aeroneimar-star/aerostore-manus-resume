# Contratos — API Pública E-commerce AEROSTORE

Namespace: `/public-api/*`  
Autenticação: nenhuma (sessão CRM não aplicável)  
Host: `aerostore.site`, `www.aerostore.site`  
Content-Type: `application/json; charset=utf-8`

## Convenções

- Valores monetários em **centavos** (`price_cents`).
- Disponibilidade: `in_stock` | `low_stock` | `out_of_stock` (nunca quantidade exata).
- Slugs públicos opacos — nunca expor `pdv_products_v2.id` ou SKU interno.
- Paginação: `page` (1-based), `limit` (max 48).
- Erros: `{ "error": "mensagem", "code": "ERROR_CODE" }`.

---

## GET /public-api/catalog

Lista paginada de produtos publicados (Fase 2).

### Query params

| Param | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `page` | integer | 1 | Página |
| `limit` | integer | 24 | Itens por página (max 48) |
| `category` | string | — | Filtrar por `category_slug` |
| `featured` | boolean | — | Apenas destaques |

### Response 200

```json
{
  "success": true,
  "page": 1,
  "limit": 24,
  "total": 3,
  "total_pages": 1,
  "items": [
    {
      "slug": "camiseta-premium-algodao",
      "title": "Camiseta Premium Algodão",
      "category_slug": "camisetas",
      "category_label": "Camisetas",
      "price_cents": 12990,
      "compare_at_price_cents": null,
      "featured": true,
      "availability": "in_stock",
      "primary_image": {
        "url": "/shop/assets/img/pilot/camiseta-premium.jpg",
        "alt": "Camiseta Premium Algodão"
      },
      "variant_count": 3
    }
  ],
  "filters": {
    "categories": [
      { "slug": "camisetas", "label": "Camisetas", "count": 2 }
    ]
  }
}
```

### Campos excluídos (nunca retornar)

`cost_price_cents`, `legacy_ai_product_id`, `tiny_id`, `product_id`, `variant_id`, `sku`, `barcode`, `store_id`, `available_qty`, `reserved_qty`, `margin`, `notes`, `source`.

### Headers

```
Cache-Control: public, max-age=120
X-Content-Type-Options: nosniff
```

---

## GET /public-api/catalog/filters

Facetas disponíveis no catálogo publicado (Fase 2).

### Response 200

```json
{
  "success": true,
  "categories": [
    { "slug": "camisetas", "label": "Camisetas", "count": 2 },
    { "slug": "calcas", "label": "Calças", "count": 1 }
  ],
  "colors": [
    { "slug": "preto", "label": "Preto", "count": 2 }
  ],
  "sizes": [
    { "slug": "m", "label": "M", "count": 2 },
    { "slug": "g", "label": "G", "count": 1 }
  ]
}
```

---

## GET /public-api/products/:slug

Detalhe de produto publicado (Fase 3; contrato definido antecipadamente).

### Path params

| Param | Descrição |
|-------|-----------|
| `slug` | Slug público (`shop_product_publications.public_slug`) |

### Response 200

```json
{
  "success": true,
  "product": {
    "slug": "camiseta-premium-algodao",
    "title": "Camiseta Premium Algodão",
    "description": "Camiseta em algodão premium, corte regular.",
    "category_slug": "camisetas",
    "category_label": "Camisetas",
    "price_cents": 12990,
    "compare_at_price_cents": null,
    "featured": true,
    "availability": "in_stock",
    "images": [
      {
        "url": "/shop/assets/img/pilot/camiseta-premium.jpg",
        "alt": "Camiseta Premium Algodão — frente",
        "sort_order": 0
      }
    ],
    "variants": [
      {
        "slug": "camiseta-premium-algodao-preto-m",
        "color": "Preto",
        "color_slug": "preto",
        "size": "M",
        "size_slug": "m",
        "price_cents": 12990,
        "availability": "in_stock"
      }
    ],
    "seo": {
      "title": "Camiseta Premium Algodão | AEROSTORE",
      "description": "Camiseta em algodão premium."
    }
  }
}
```

### Response 404

```json
{
  "error": "Produto não encontrado.",
  "code": "PRODUCT_NOT_FOUND"
}
```

---

## Rate limits (Fase 2+)

| Rota | Limite |
|------|--------|
| `GET /public-api/catalog*` | 60 req/min/IP |
| `GET /public-api/products/*` | 60 req/min/IP |
| `POST /public-api/*` (futuro) | 10 req/min/IP |

Resposta 429:

```json
{
  "error": "Muitas requisições. Tente novamente em instantes.",
  "code": "RATE_LIMITED",
  "retry_after_seconds": 60
}
```

---

## CORS

```
Access-Control-Allow-Origin: https://aerostore.site
Access-Control-Allow-Methods: GET, OPTIONS
```

(WWW alias incluído via config.)

---

## Evolução por fase

| Fase | Endpoints adicionais |
|------|---------------------|
| 4 | `POST /public-api/products/:slug/interest` |
| 5 | `GET/POST /public-api/cart` |
| 6 | `POST /public-api/orders`, `GET /public-api/orders/:token` |
| 7 | `POST /public-api/orders/:token/confirm` |
| 8 | `POST /public-api/orders/:token/pay`, webhook payment |

Contratos de pedidos documentados em [shop-schema-design.md](./shop-schema-design.md).
