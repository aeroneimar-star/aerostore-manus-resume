# Fase 2.4 — Entrega: produtos reais e padrão de fotos

**Status:** documentação + contrato JSON · **sem commit** · **sem banco**

---

## Entregáveis

| # | Entregável | Arquivo |
|---|------------|---------|
| 1 | Guia de fotos | [shop-product-photo-guide.md](./shop-product-photo-guide.md) |
| 2 | Blueprint vitrine real (10–16 produtos) | [shop-real-catalog-blueprint.md](./shop-real-catalog-blueprint.md) |
| 3 | Contrato JSON v4 (campos futuros) | [pilot-publication-schema.v4.json](../../modules/shop/config/pilot-publication-schema.v4.json) |
| 4 | Metadados piloto atualizados | [pilot-publications.json](../../modules/shop/config/pilot-publications.json) |
| 5 | Este documento (gaps + checklist) | shop-phase-2.4-delivery.md |

---

## Campos necessários para produtos reais

### Obrigatórios (publicação)
- `public_slug`, `status`, `public_title`
- `public_description` (e recomendado `public_short_description`)
- `public_category_slug`, `public_category_label`
- `price_cents`, `availability`, `sort_order`
- `primary_image` (url, alt)
- `variants[]` (cor, tamanho, preço, disponibilidade pública)

### Recomendados
- `images[]` com galeria (2+ fotos)
- `compare_at_price_cents` (promoção)
- `public_description_full`
- `featured`, `badge_label`
- `seo.title`, `seo.description`

### Opcionais (Fase 2.5 render)
- `composition`
- `care_instructions`
- `size_guide`
- `cta_label`
- `image.role`, `image.color_slug` (fotos por cor)

### Proibidos na API pública
`sku`, `product_id`, `variant_id`, `tiny_id`, `cost_price_cents`, `store_id`, `available_qty`, `reserved_qty`, `margin`, etc.

---

## Análise da página de produto (gap)

| Recurso | Estado atual | Ação Fase 2.4 |
|---------|--------------|---------------|
| Galeria de imagens | ✅ Implementado (thumbs se `images.length > 1`) | Manter; adicionar mais fotos no JSON quando houver reais |
| Variações por cor | ✅ Swatches + tabela | Manter |
| Tamanhos | ✅ Pills + tabela | Manter |
| Descrição curta | ✅ `public_description` no HTML | Manter |
| Descrição completa | ⚠️ Campo no DTO; **não renderiza** ainda | Fase 2.5 |
| Bloco cuidados/medidas | ❌ Não renderiza | Fase 2.5 (campos já no DTO) |
| Consultar disponibilidade | ✅ CTA desabilitado | Manter |
| Aviso compra em preparação | ✅ Presente | Manter |
| Imagens por cor | ❌ Não troca galeria ao clicar cor | Fase 2.5+ |
| Preço promocional | ✅ `compare_at_price_cents` no preço | Manter |

**Decisão Fase 2.4:** nenhuma alteração visual no renderer — direção 2.3 aprovada. Apenas DTO preparado para API consumir campos novos.

---

## Alterações de código (motivo)

| Arquivo | Motivo |
|---------|--------|
| `publicProductDto.js` | Expor campos v4 na API pública sem vazar dados internos |
| `pilot-publications.json` | Metadados v4 + referência ao schema; publicações 2.3 intactas |
| `pilot-publication-schema.v4.json` | Contrato documentado para produtos reais |

**Não alterado:** `shopPageRenderer.js`, CSS, PDV, Argox, cashback, landing.

---

## O que você precisa providenciar

### Fotos
- [ ] 10–16 produtos fotografados no padrão 4:5 (ver guia)
- [ ] Nome de arquivo conforme convenção
- [ ] Pasta futura: `public/shop/assets/products/{categoria}/`

### Conteúdo comercial
- [ ] Lista final de produtos que **existem** nas lojas
- [ ] Preço de venda (e promoção se houver)
- [ ] Cores e tamanhos reais por peça
- [ ] Descrição curta + completa
- [ ] Destaques e ordem na vitrine

### Opcional (melhora página)
- [ ] Composição do tecido
- [ ] Instruções de cuidado
- [ ] Tabela de medidas por tamanho

### Decisões (sem urgência de banco)
- [ ] Lote mínimo (10) vs vitrine completa (16)
- [ ] Quais categorias entram primeiro (recomendado: camisetas → polos → calças)

---

## Validação

```powershell
npm run check
node scripts/shop_public_security_smoke.js
```

---

## Próximo passo sugerido (Fase 2.5)

1. Sessão de fotos reais (lote piloto 10)
2. Preencher JSON com dados validados + novos campos
3. Renderizar `description_full`, cuidados e medidas na página
4. Ainda sem carrinho, checkout, banco ou deploy
