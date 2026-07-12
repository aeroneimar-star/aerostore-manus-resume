# ADR — Arquitetura E-commerce AEROSTORE

**Status:** Aprovado para implementação faseada  
**Data:** 2026-07-09 · **Revisão arquitetural:** 2026-07-11 (pré-Fase 2.9, somente docs)  
**Contexto:** Evoluir `aerostore.site` de landing institucional (Fase 1) para e-commerce enxuto integrado ao CRM/PDV.

## Decisão

Adotar o padrão **Publication Layer (espelho relacional) + Order Domain**:

- CRM/PDV permanece **fonte da verdade** para produto, variação, estoque físico, SKU, barcode, custo, margem e preço base.
- Camada `shop_*` guarda **somente** metadados editoriais/de publicação (`slug`, nome editorial, descrição, categoria web, fotos, SEO, override de preço, ordem, featured, status de publicação) + FKs (`product_id`, `variant_id`).
- Produto só aparece no site se publicado explicitamente **e** ativo no PDV.
- Pedido online é entidade própria (`shop_orders`) com **state machine dedicada** — nunca gravado diretamente em `sales.json`; conversão PDV só via `converted_to_pdv_sale`.
- API pública isolada em `/public-api/*` com **DTO por allow-list**, rate-limit e host-gating reforçado no edge (nginx).

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
2. **Publication layer não duplica** cadastro PDV — apenas espelha FK + camada editorial.
3. Estoque online é visão **calculada** (pool de fulfillment − reservas ativas) — não expõe saldo por loja na API pública.
4. Pedido online **não** é venda PDV comum; conversão exige transição `converted_to_pdv_sale` auditada.
5. Cliente online converge em `contacts` com dedup por CPF/telefone/e-mail (ver schema design).
6. Cashback/crédito/WhatsApp integra apenas na Fase 9.
7. Host público (`aerostore.site`) **não** expõe rotas internas do CRM — reforço no nginx, não só no Node.

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
| 7 | — | reserva estoque (design aprovado; impl. pendente) |
| 8 | pagamento | webhook shop dedicado |
| 9 | — | cashback/CRM/WhatsApp |

## Publication Layer — espelho vs duplicação

```
PDV (fonte da verdade)          Shop (espelho editorial)
─────────────────────────       ──────────────────────────
pdv_products_v2.id        ──FK── shop_product_publications.product_id
pdv_product_variants.id   ──FK── shop_variant_publications.variant_id
nome interno, SKU, barcode      public_title, public_slug, SEO
preço PDV                       public_price_cents (override opcional)
estoque por loja                (calculado na projeção, não copiado)
```

Curadoria da primeira vitrine: [shop-phase-2.8.3-pilot-selection.md](./shop-phase-2.8.3-pilot-selection.md) — 8 produtos Grupo A antes da Fase 2.9.

## Reserva de estoque (Fase 7 — design only)

Requisitos documentados em [shop-schema-design.md](./shop-schema-design.md):

- Atomicidade na criação/liberação de reserva
- TTL default **15 minutos** (configurável)
- Status: `active`, `expired`, `released`, `consumed`
- Disponibilidade online = pool físico − reservas `active`
- Estratégia anti-corrida com PDV via movimentos `origin='shop'`

### Decisão de negócio pendente (dono)

| Opção | Descrição | Risco principal |
|-------|-----------|-----------------|
| **A** | Reserva online **bloqueia** também o PDV físico | Peça reservada some do saldo loja; vendedor precisa visibilidade operacional |
| **B** | Reserva só segura **disponibilidade online**; pedido confirma na separação/conferência | Overselling se loja vender última unidade antes da separação |

**Não implementar** reserva até decisão explícita.

## Máquina de estados — pedido online

Estados iniciais: `draft` → `reserved` → `pending_payment` → `paid` → `awaiting_separation` → `ready_to_ship` → `converted_to_pdv_sale`; ramificações: `cancelled`, `expired`, `refunded`.

Diagrama e DDL em [shop-schema-design.md](./shop-schema-design.md). Regra: **proibido** inserir pedido web diretamente como venda PDV.

## Deduplicação cliente (site → CRM)

Ordem de matching: CPF (forte) → telefone normalizado (forte/média) → e-mail (média) → nome+telefone (fallback manual).

Auto-merge apenas com chave forte única; demais casos auditados. Detalhes no schema design.

## Host-gate e segurança perimetral

| Camada | Responsabilidade |
|--------|------------------|
| **nginx / reverse proxy (produção)** | `aerostore.site` → landing + shop público + `/public-api/*` apenas; **bloquear** `/api/*`, `/pdv/*`, CRM admin no host público |
| **`crm.aerostore.site`** | CRM/PDV interno; não servir shop público completo se não intencional |
| **Node (app)** | Host-gate por env como **camada adicional** — útil em dev/staging, **insuficiente sozinho** em produção |

**Não depender** apenas do header `Host` dentro do Express para segurança real.

## Riscos mitigados

| Risco | Mitigação |
|-------|-----------|
| Contaminação de relatórios PDV | `shop_orders` separado de `sales.json` |
| Auto-exposição de produtos | `shop_product_publications.status = 'published'` |
| Vazamento de dados internos | DTO público **allow-list**; nunca serializar objeto CRM cru com block-list |
| API interna no host público | nginx bloqueia `/api/*` em `aerostore.site` |
| Conflito de reservas PDV | `reference_type = 'shop_order'`, prefixo `SHOP-*`; modelo A vs B pendente |
| Webhook collision PagBank | Pedidos online usam `SHOP-*`, nunca `sale_id` PDV |

## Fases e escopo

Ver [public-api-contracts.md](./public-api-contracts.md) e [shop-schema-design.md](./shop-schema-design.md).

**Fase 2 (atual):** catálogo read-only, curadoria em `/shop/publicacao`, piloto editorial 8 produtos (2.8.3), sem carrinho/pedido/pagamento.

**Fase 2.9 (próxima técnica):** migration SQL da publication layer — **somente após** intake editorial 2.8.4 aprovado.

## Referências

- [DEPLOY_PUBLIC_SITE.md](../../DEPLOY_PUBLIC_SITE.md)
- [public-api-contracts.md](./public-api-contracts.md)
- [shop-schema-design.md](./shop-schema-design.md)
- [shop-real-catalog-blueprint.md](./shop-real-catalog-blueprint.md)
- [shop-phase-2.8.3-pilot-selection.md](./shop-phase-2.8.3-pilot-selection.md)
- [shop-settings.json](../../modules/shop/config/shop-settings.json)
