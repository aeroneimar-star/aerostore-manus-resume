# Contratos — API Pública E-commerce AEROSTORE

**Atualizado:** 2026-07-11 — allow-list explícita, host-gate (pré-Fase 2.9).

Namespace: `/public-api/*`  
Autenticação: nenhuma (sessão CRM não aplicável)  
Host: `aerostore.site`, `www.aerostore.site`  
Content-Type: `application/json; charset=utf-8`

## Princípio — DTO público por allow-list

A API pública **nunca** retorna objetos internos do CRM/PDV serializados com block-list.

| Abordagem | Status |
|-----------|--------|
| **Allow-list** (campos explicitamente mapeados para DTO público) | **Obrigatório** |
| Block-list (retornar objeto interno e remover campos sensíveis) | **Proibido** |

Novos campos adicionados ao CRM/PDV **não vazam** por padrão — só entram na API pública após revisão explícita do contrato e atualização do mapper/DTO.

Implementação: serviços em `modules/shop/dto/` montam resposta campo a campo; testes de contrato devem falhar se chave desconhecida aparecer na resposta.

## Host-gate e exposição

| Host | Permitido | Bloqueado (nginx + app) |
|------|-----------|-------------------------|
| `aerostore.site` / `www` | Landing, assets shop, `GET/POST /public-api/*` autorizados | `/api/*`, `/pdv/*`, painéis CRM, sessão admin |
| `crm.aerostore.site` | CRM, PDV, APIs internas autenticadas | Catálogo público completo (se separação desejada) |

O host-gate no Node (`modules/public-site/`, env) é **camada adicional** para dev/staging. **Produção real** deve reforçar no **nginx/reverse proxy** — não depender só do header `Host` dentro do Express.

Exemplo de intenção nginx (documentação, não deploy):

```nginx
# aerostore.site — bloquear API interna
location ^~ /api/ { return 404; }
location ^~ /pdv/ { return 404; }
# permitir /public-api/ e assets estáticos shop
```

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

### Allow-list — CatalogListItem (Fase 2)

Campos **permitidos** em cada item de `items[]`:

| Campo | Tipo | Origem na projeção |
|-------|------|-------------------|
| `slug` | string | `shop_product_publications.public_slug` |
| `title` | string | `public_title` (editorial) |
| `category_slug` | string | `public_category_slug` |
| `category_label` | string | taxonomia shop |
| `price_cents` | integer | override web ou preço PDV |
| `compare_at_price_cents` | integer \| null | promo editorial |
| `featured` | boolean | `featured` |
| `availability` | enum | calculado (estoque − reservas; Fase 7+) |
| `primary_image` | object | `{ url, alt }` |
| `variant_count` | integer | variações publicadas |

Campos internos (`product_id`, `variant_id`, `sku`, `barcode`, `cost_*`, `store_id`, quantidades exatas) **não fazem parte do contrato**.

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

### Headers (catálogo)

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

### Allow-list — ProductDetail (Fase 3)

Campos permitidos em `product`: `slug`, `title`, `description`, `category_slug`, `category_label`, `price_cents`, `compare_at_price_cents`, `featured`, `availability`, `images[]`, `variants[]` (cada variant: `slug`, `color`, `color_slug`, `size`, `size_slug`, `price_cents`, `availability`), `seo` (`title`, `description`).

**Proibido** na resposta pública: IDs numéricos PDV, SKU, barcode, estoque numérico, loja de fulfillment, custo.

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
