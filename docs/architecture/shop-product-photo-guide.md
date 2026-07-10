# Guia de fotos — E-commerce AEROSTORE

**Fase 2.4** · Protótipo / preparação · **não é manual de produção final**

Este guia define o padrão visual para substituir as fotos piloto provisórias (Fase 2.3) por imagens reais da AEROSTORE, mantendo coerência com o catálogo premium já aprovado.

---

## Princípio editorial

A vitrine AEROSTORE não é marketplace genérico. As fotos devem parecer **boutique de moda masculina**: fundo controlado, luz suave, peça legível, sem poluição visual.

Referência visual atual: cards com proporção **4:5**, fundo escuro neutro, `object-fit: cover` no catálogo e `contain` na página de produto.

---

## Especificações técnicas recomendadas

| Item | Recomendação | Mínimo aceitável |
|------|--------------|------------------|
| **Proporção** | **4:5** (retrato) | 3:4 aceitável; evitar 16:9 em card |
| **Resolução** | 1600 × 2000 px | 1200 × 1500 px |
| **Formato** | WebP (primário) + PNG/JPG fallback | JPG 85% qualidade |
| **Peso** | ≤ 350 KB (WebP) | ≤ 600 KB |
| **Espaço de cor** | sRGB | — |
| **Fundo** | Cinza escuro neutro `#2a2a2e` a `#1a1a1e` ou superfície texturizada discreta | Sem fundo branco puro de estúdio genérico |
| **Iluminação** | Luz lateral suave, sombra leve para volume | Sem flash frontal estourado |
| **Enquadramento** | Peça centralizada, margem ~8–12% nas bordas | Sem cortar gola/cadarço/solado |

---

## Tipos de imagem por produto

| Tipo | `role` no JSON | Uso | Quantidade |
|------|----------------|-----|------------|
| **Principal** | `primary` | Card do catálogo + hero da página | 1 obrigatória |
| **Galeria** | `gallery` | Thumbs na página de produto | 0–4 recomendadas |
| **Detalhe** | `detail` | Textura, botão, costura, solado | 0–2 opcionais |
| **Lifestyle** | `lifestyle` | Look montado (sem rosto se possível) | 0–1 opcional |

Ordem sugerida na galeria: principal → frente/alternativa → detalhe → lifestyle.

---

## Variações por cor

Quando o produto tiver **cores diferentes com aparência distinta**, fotografar **pelo menos a cor principal** e, idealmente, cada cor com:

1. Uma foto `primary` da cor
2. Opcional: uma `gallery` da mesma cor

No JSON, associar imagens à cor via `color_slug` (ex.: `marinho`, `branco`).

Se as cores forem apenas swatch (mesma foto serve), usar **uma foto principal** e diferenciar só no bloco de cores — não duplicar arquivo sem necessidade.

---

## Padrão de nome de arquivo

Estrutura:

```
{slug-produto}--{cor?}--{role}--{seq}.{ext}
```

Exemplos:

```
polo-pima-marinho--marinho--primary--01.webp
polo-pima-marinho--marinho--detail--01.webp
calca-chino-slim--petroleo--primary--01.webp
tenis-nobuck--cognac--gallery--02.webp
```

Regras:

- Slug em minúsculas, hífens, sem acento
- `cor` omitida se única
- `seq` com dois dígitos (`01`, `02`)
- Salvar em `public/shop/assets/products/{categoria}/` quando forem fotos reais (futuro); piloto atual permanece em `public/shop/assets/img/pilot/`

---

## Enquadramento por categoria

### Camisetas e polos
- Peça estendida ou manequim invisível / flat lay premium
- Gola e punho visíveis
- Evitar amassados

### Calças e bermudas
- Dobrada com caimento legível **ou** perna inteira em gancho
- Bolso e cós visíveis na principal

### Calçados
- Par ou um sapato, ângulo 3/4 + lateral
- Solado visível em pelo menos uma foto `detail`

### Acessórios (cinto, carteira)
- Peça isolada, enquadramento central
- Fivela/metal com reflexo controlado

---

## Checklist antes de publicar uma foto

- [ ] Proporção 4:5
- [ ] Resolução ≥ 1200 × 1500
- [ ] Fundo coerente com vitrine dark premium
- [ ] Nome de arquivo segue padrão
- [ ] `alt` descritivo em português (sem “imagem de”)
- [ ] Sem marca d'água, preço ou texto na foto
- [ ] Não parece banco de imagens genérico

---

## O que você pode fazer na loja (sem estúdio)

1. **Cabo de recorte** ou superfície escura (MDF pintado, tecido cinza)
2. **Luz natural lateral** (janela) + rebatedor branco oposto
3. **Tripé + celular** em modo retrato, HDR desligado
4. **Consistência**: mesma superfície e distância para todo o lote
5. Exportar em WebP via Squoosh ou similar

---

## Relação com o protótipo atual

| Fase | Fotos |
|------|-------|
| 2.3 | Piloto geradas/editoriais em `img/pilot/` |
| 2.4 | Este guia + blueprint de vitrine real |
| 2.5+ | Substituir por fotos reais seguindo este padrão |

Não usar fotos da landing institucional (fachada, interior) como packshot de produto.

---

## Próximo passo operacional

Providenciar lote piloto de **8–12 produtos reais** (ver [shop-real-catalog-blueprint.md](./shop-real-catalog-blueprint.md)) fotografados neste padrão antes de trocar o JSON piloto.
