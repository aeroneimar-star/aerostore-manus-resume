# Shop Fase 2.8 — UI admin read-only de candidatos

**Data:** 2026-07-10  
**Status:** entregue, **sem migration**, **sem deploy**, **sem commit automático**

## Objetivo

Tela interna CRM em `/shop/publicacao` para visualizar produtos reais do PDV elegíveis à publicação no e-commerce, **sem gravar nada**.

## Arquitetura

```
PDV (fonte de verdade)
    └── shopPublicationService (read-only)
            └── GET /api/shop/publication/candidates (auth CRM)
                    └── shopPublicationAdmin.js → UI premium dark
```

- Catálogo público **continua** em `pilot-publications.json`
- Rotas `/public-api/*` **inalteradas**
- Botões Publicar / Editar **disabled** (Fase 2.9+)

## Rota e permissões

| Item | Valor |
|------|-------|
| Rota CRM | `/shop/publicacao` |
| Section | `shop-publication` |
| Permissões | `can_manage_global_settings` ou role `admin` |
| API | `/api/shop/publication/status`, `/candidates`, `/candidates/:ref`, `/publications` |

## Campos exibidos na UI

| Campo | Origem |
|-------|--------|
| Nome do produto | PDV |
| Tipo (simples/grade) | PDV |
| Preço público | PDV |
| Qtd. variações | PDV |
| Cores / tamanhos agregados | Variações PDV |
| Vendável | Status PDV + estoque agregado |
| Disponibilidade | `in_stock` / `low_stock` / `out_of_stock` |
| Publicação | `Schema pendente` enquanto `schema_ready=false` |

## Campos nunca exibidos

SKU, barcode, Tiny ID, custo, margem, estoque exato por loja, IDs internos na UI.

## Filtros

- Busca por nome
- Tipo (simples / grade)
- Vendável (sim/não)
- Disponibilidade
- Status de publicação

## Arquivos

| Arquivo | Função |
|---------|--------|
| `public/shopPublicationAdmin.js` | UI read-only |
| `public/styles.css` | Estilos `.shop-pub-*` |
| `public/app.js` | Rota, menu, permissões |
| `public/index.html` | Section + script |
| `modules/shop/routes/shopAdminRoutes.js` | API GET autenticada |
| `server.js` | Registro pós-auth |

## Validação

```bash
npm run check
node scripts/shop_public_security_smoke.js
node scripts/shop_publication_readonly_smoke.js
node scripts/shop_publication_admin_api_smoke.js
```

## Próximo passo (Fase 2.9)

Aplicar DDL (após aprovação) + UI de escrita para criar rascunhos de publicação.
