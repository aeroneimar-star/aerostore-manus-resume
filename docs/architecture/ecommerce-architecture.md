# ADR — Arquitetura E-commerce AEROSTORE

**Status:** Aprovado para implementação faseada  
**Data:** 2026-07-09  
**Contexto:** Evoluir `aerostore.site` de landing institucional (Fase 1) para e-commerce enxuto integrado ao CRM/PDV.

## Decisão

Adotar o padrão **Publication Layer + Order Domain**:

- CRM/PDV permanece fonte de verdade para produto, estoque físico, preço base e cliente.
- Camada `shop_*` é projeção intencional — produto só aparece no site se publicado explicitamente.
- Pedido online é entidade própria (`shop_orders`), nunca gravado diretamente em `sales.json`.
- API pública isolada em `/public-api/*` com DTO sanitizado, rate-limit e host-gating.

## Estado atual (baseline)

| Domínio | Modelo | Observação |
|---------|--------|------------|
| Produtos legado | `ai_products` | Flags `use_in_ai`, `use_in_pos` — **não** reutilizar como publicação web |
| Produtos PDV | `pdv_products_v2`, `pdv_product_variants` | Venda por variação |
| Estoque | `pdv_inventory_balances_v2` | Por `variant_id + store_id` |
| Clientes | `contacts`, `crm_contacts` | Unificação via `customerUnifiedService` |
| Vendas PDV | `data/pdv/sales/sales.json` | Sem `sale_channel` obrigatório |
| Site público | `modules/public-site/` | Host-gated; Fase 1 concluída |

## Princípios inegociáveis

1. Produto interno **não** aparece automaticamente no site.
2. Estoque online é visão calculada sobre pool de fulfillment — não expõe saldo por loja.
3. Pedido online **não** é venda PDV comum sem camada própria.
4. Cliente online converge em `contacts` com `source='ecommerce'`.
5. Cashback/crédito/WhatsApp integra apenas na Fase 9.

## Estrutura de módulos

```
modules/
  public-site/     # Landing (Fase 1 — intocável)
  shop/            # E-commerce (Fase 2+)
    routes/
    services/
    dto/
    config/
    utils/
public/
  site/            # Landing assets
  shop/            # Catálogo assets (Fase 2+)
docs/architecture/ # ADR, contratos, schema design
```

## Rotas públicas

| Fase | HTML | API |
|------|------|-----|
| 2 | `/catalogo` | `GET /public-api/catalog` |
| 3 | `/produto/:slug` | `GET /public-api/products/:slug` |
| 4 | + WhatsApp interesse | `POST /public-api/products/:slug/interest` |
| 5 | `/carrinho` | `/public-api/cart` |
| 6 | `/checkout` | `POST /public-api/orders` |
| 7 | — | reserva estoque |
| 8 | pagamento | webhook shop dedicado |
| 9 | — | cashback/CRM/WhatsApp |

## Riscos mitigados

| Risco | Mitigação |
|-------|-----------|
| Contaminação de relatórios PDV | `shop_orders` separado de `sales.json` |
| Auto-exposição de produtos | `shop_product_publications.status = 'published'` |
| Vazamento de dados internos | DTO público sem custo, SKU interno, Tiny ID |
| Conflito de reservas PDV | `reference_type = 'shop_order'`, prefixo `SHOP-*` |
| Webhook collision PagBank | Pedidos online usam `SHOP-*`, nunca `sale_id` PDV |

## Fases e escopo

Ver [public-api-contracts.md](./public-api-contracts.md) e [shop-schema-design.md](./shop-schema-design.md).

**Fase 2 (atual):** catálogo read-only, 3 produtos piloto via config JSON, sem carrinho/pedido/pagamento.

## Referências

- [DEPLOY_PUBLIC_SITE.md](../../DEPLOY_PUBLIC_SITE.md)
- [public-api-contracts.md](./public-api-contracts.md)
- [shop-schema-design.md](./shop-schema-design.md)
- [shop-settings.json](../../modules/shop/config/shop-settings.json)
