# Fase 2.5 — Entrega: primeira vitrine real (preparação)

**Status:** template + estrutura + render condicional · **sem commit** · **sem deploy** · **sem banco**

---

## Entregáveis

| # | Item | Arquivo |
|---|------|---------|
| 1 | Template 10 produtos (preenchimento) | `modules/shop/config/real-catalog-intake.template.json` |
| 2 | Pasta fotos reais + README | `public/shop/assets/img/products/` |
| 3 | Render descrição/cuidados/medidas | `shopPageRenderer.js`, `product.css` |
| 4 | Este relatório | `shop-phase-2.5-delivery.md` |

---

## Lote mínimo (10 slots)

| Categoria | Slots |
|-----------|-------|
| Camisetas | 2 |
| Polos | 2 |
| Calças | 2 |
| Bermudas | 1 |
| Calçados | 2 |
| Acessórios | 1 |

Template com campos vazios — **não inventa produto, preço ou estoque**.

---

## Página de produto — render condicional

Blocos aparecem **somente** quando o campo existe no DTO:

| Bloco | Campo | Piloto 2.3 |
|-------|-------|------------|
| Lead (acima do fold) | `short_description` ou `description` | ✅ inalterado |
| Sobre a peça | `description_full` (se ≠ lead) | oculto |
| Composição | `composition` | oculto |
| Cuidados | `care_instructions[]` | oculto |
| Medidas | `size_guide` | oculto |
| Galeria | `images[]` | ✅ já existia |

Catálogo visual **não redesenhado**.

---

## Fotos

- Piloto: `public/shop/assets/img/pilot/` — **intacto**
- Reais: `public/shop/assets/img/products/{categoria}/`
- Padrão: `{slug}--{cor}--{role}--{seq}.webp`

---

## Segurança API

`publicProductDto.js` inalterado nesta fase — `FORBIDDEN_KEYS` mantém bloqueio de SKU, custo, Tiny ID, estoque por loja, etc.

---

## Como preencher

1. Edite `real-catalog-intake.template.json` com dados reais validados na loja
2. Fotografe/exporte imagens na pasta `img/products/{categoria}/`
3. Após sua aprovação, migre para `pilot-publications.json` (Fase 2.6 ou sob demanda)

---

## Arquivos alterados

- `modules/shop/config/real-catalog-intake.template.json` (novo)
- `modules/shop/services/shopPageRenderer.js`
- `public/shop/assets/css/product.css`
- `public/shop/assets/img/products/README.md` (novo)
- `public/shop/assets/img/products/*/.gitkeep` (novo)
- `docs/architecture/shop-phase-2.5-delivery.md` (novo)
- `docs/architecture/shop-prototype-visual.md` (atualizado)
- `modules/shop/README.md` (atualizado)

**Não alterado:** `pilot-publications.json`, PDV, Argox, WhatsApp, cashback, `public/app.js`, landing, banco.
