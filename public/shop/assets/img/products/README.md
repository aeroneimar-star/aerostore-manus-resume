# Fotos reais — Catálogo AEROSTORE

**Fase 2.5** · Pasta reservada para packshots reais · **não substitui `img/pilot/`**

## Estrutura

```
public/shop/assets/img/products/
  camisetas/
  polos/
  calcas/
  bermudas/
  calcados/
  acessorios/
```

## Padrão de nome

```
{slug}--{cor}--{role}--{seq}.webp
```

| Parte | Exemplo | Notas |
|-------|---------|-------|
| `slug` | `polo-pima-marinho` | Igual ao `public_slug` |
| `cor` | `marinho` | Omitir se cor única |
| `role` | `primary` | `primary`, `gallery`, `detail`, `lifestyle` |
| `seq` | `01` | Dois dígitos |

Exemplos:

- `polo-pima-marinho--marinho--primary--01.webp`
- `calca-chino-slim--petroleo--gallery--02.webp`
- `cinto-couro--cognac--detail--01.webp`

## Especificações

Ver [shop-product-photo-guide.md](../../../../docs/architecture/shop-product-photo-guide.md):

- Proporção **4:5**
- Mínimo **1200 × 1500 px**
- Fundo escuro neutro, iluminação lateral suave

## URL pública

Após salvar o arquivo, a URL no JSON será:

```
/shop/assets/img/products/{categoria}/{arquivo}.webp
```

## Importante

- **Não apagar** fotos em `public/shop/assets/img/pilot/`
- **Não substituir** piloto sem aprovação explícita
- Preencher caminhos no template `modules/shop/config/real-catalog-intake.template.json`
