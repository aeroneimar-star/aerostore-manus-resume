# Catálogo B2C v1 — contrato público read-only

## 1. Objetivo

Este pacote cria uma fachada pública e versionada para que o e-commerce web e os
futuros aplicativos Android e iOS consumam o mesmo contrato de catálogo.

O pacote é estritamente read-only. Não cria pedido, carrinho, reserva, venda,
pagamento, cashback, publicação ou movimento de estoque.

## 2. Consumidores

- e-commerce web AEROSTORE;
- aplicativo Android;
- aplicativo iOS.

Nenhum consumidor recebe segredo interno. A API pode ser chamada diretamente por
clientes públicos dentro das regras de CORS, rate limit e host/reverse proxy.

## 3. Arquitetura

```text
GET /b2c/v1/*
  -> b2cCatalogRoutes
  -> b2cCatalogService
  -> b2cCatalogDto (allow-list)
  -> PilotCatalogSource
  -> shopCatalogService
  -> pilot-publications.json (somente leitura)
```

A rota não conhece o formato do JSON piloto. O serviço não conhece detalhes de
persistência. O adaptador futuro de banco deverá implementar as mesmas operações:

```text
listCatalog(params)
getFilters()
getProductBySlug(slug)
```

Não existe registry, framework de plugins ou injeção de dependência global.

## 4. Rotas

```http
GET /b2c/v1/catalog
GET /b2c/v1/catalog/filters
GET /b2c/v1/products/:slug
```

`GET /b2c/v1/search` não faz parte desta versão.

Enquanto `SHOP_PUBLIC_CATALOG_ENABLED` estiver desabilitada, as três rotas
retornam `404 CATALOG_DISABLED`. O mount permanece presente para que ativar o
catálogo não exija mudar o contrato ou registrar novas rotas.

O gate é aplicado antes da leitura da fonte: catálogo, filtros e produto por slug
retornam o mesmo erro, sem expor itens, filtros, produto ou dados do piloto.

## 5. Parâmetros

### `GET /b2c/v1/catalog`

| Parâmetro | Regra |
|---|---|
| `page` | inteiro, mínimo 1, padrão 1 |
| `limit` | inteiro, mínimo 1, padrão 24, máximo 48 |
| `category` | slug público ASCII com hífens |
| `featured` ausente | todos os produtos publicados |
| `featured=true` | somente produtos publicados destacados |
| `featured=false` | somente produtos publicados não destacados |

O limite 48 e o padrão 24 vêm de `modules/shop/config/shop-settings.json`.

`color` e `size` não são aceitos na listagem v1. A fonte atual os produz como
dimensões de filtros, mas `shopCatalogService.listCatalog()` não os aplica à
listagem. Aceitá-los sem efeito criaria um contrato falso.

Categoria inexistente e página acima da última são resultados vazios legítimos,
não erros.

Quando `featured` está presente, o filtro B2C é aplicado sobre o conjunto
publicado completo antes da paginação. `total` e `total_pages` refletem o conjunto
filtrado. A semântica legada de `/public-api` não é alterada.

## 6. DTOs

### Envelope de sucesso

```json
{
  "success": true,
  "data": {},
  "meta": {
    "api_version": "v1"
  }
}
```

`source_mode` não é exposto. A fonte piloto é detalhe operacional e revelar esse
modo obrigaria consumidores a conhecer uma transição que deve ser transparente.

### Catálogo

```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "limit": 24,
      "total": 0,
      "total_pages": 1
    },
    "filters": {
      "categories": []
    }
  },
  "meta": {
    "api_version": "v1"
  }
}
```

Campos permitidos por item:

```text
slug
title
short_description
category_slug
category_label
price_cents
compare_at_price_cents
featured
availability
primary_image
variant_count
colors
color_slugs
sizes
action_label
status_copy
badge_label, quando existente
```

### Filtros

```text
categories[]
colors[]
sizes[]
```

Cada entrada usa apenas `slug`, `label` e `count`.

### Produto

Campos permitidos:

```text
slug
title
short_description
description
category_slug
category_label
price_cents
compare_at_price_cents
featured
availability
images
variants
seo
```

Imagens usam `url`, `alt`, `sort_order`, `role` e `color_slug` quando existentes.
Variantes usam slug público, cor, tamanho, preços públicos e estado editorial de
disponibilidade.

Campos editoriais extras do JSON piloto não entram automaticamente no contrato.
Sua inclusão futura exige versionamento compatível e evidência de necessidade.

## 7. Erros públicos

Envelope:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_PAGE",
    "message": "Mensagem pública estável."
  },
  "meta": {
    "api_version": "v1"
  }
}
```

| HTTP | Código |
|---:|---|
| 400 | `INVALID_PAGE` |
| 400 | `INVALID_LIMIT` |
| 400 | `INVALID_FILTER` |
| 404 | `PRODUCT_NOT_FOUND` |
| 404 | `CATALOG_DISABLED` |
| 503 | `CATALOG_SOURCE_UNAVAILABLE` |
| 500 | `INTERNAL_ERROR` |

`details` aparece somente para indicar de forma segura o filtro inválido ou o
limite máximo. Stack, exceção original, SQL, caminho local e configuração não são
serializados. Correlation ID não foi criado porque o repositório não possui uma
infraestrutura pública adequada e este pacote não deve ampliar esse escopo.

## 8. Segurança

O DTO B2C aplica allow-list e uma verificação recursiva. São bloqueados, entre
outros:

```text
id
internal_id
product_id
pdv_product_ref
publication_id
variant_id
SKU
barcode
cost
cost_cents
cost_price_cents
store_id
available_qty
reserved_qty
local_path
metadata_json
source
```

As rotas reutilizam os headers, CORS allow-list e rate limit do catálogo Shop.
Não foi adicionado CORS irrestrito nem token interno ao cliente.

O reverse proxy de produção também precisa permitir explicitamente `/b2c/v1/*`.
Esse ajuste operacional não faz parte deste commit e não deve ser executado antes
de uma autorização de deploy.

## 9. Compatibilidade

As rotas existentes continuam registradas e não chamam a fachada B2C:

```text
GET /public-api/catalog
GET /public-api/catalog/filters
GET /public-api/products/:slug
```

Seus payloads, status HTTP e comportamento de catálogo desabilitado permanecem
inalterados. O smoke compara a resposta HTTP legada com o serviço Shop real.

## 10. Fonte piloto

`PilotCatalogSource` delega a:

```text
shopCatalogService.listCatalog()
shopCatalogService.listCatalogFilters()
shopCatalogService.getProductBySlug()
```

Essas funções carregam somente publicações com `status = published`. O adaptador
não abre o banco, não grava JSON e não mantém cache persistente.

Embora as tabelas Shop contenham drafts administrativos, elas não alimentam esta
fachada nesta fase. O catálogo piloto e a publicação operacional permanecem
separados.

## 11. Futuro adaptador de banco

O adaptador futuro deverá:

1. ler apenas publicações efetivamente publicadas;
2. produzir os mesmos objetos intermediários da interface;
3. continuar ocultando IDs e quantidades internas;
4. respeitar a mesma paginação e semântica de filtros;
5. preservar códigos de erro;
6. passar o mesmo smoke de contrato;
7. ser trocado sem mudança nas rotas ou nos consumidores.

Essa substituição exigirá uma fase própria e confirmação do schema operacional.

## 12. Limitações

- fonte atual é o JSON piloto;
- catálogo público permanece desligado por padrão;
- não existe busca;
- não existe autenticação B2C;
- não existe carrinho ou pedido B2C;
- não existe integração transacional de disponibilidade;
- rate limit é local ao processo;
- liberação no host público depende do reverse proxy.

## 13. Ausência de garantia de estoque

`availability` é um estado público editorial já sustentado pelo DTO Shop. Ele não
representa:

- quantidade exata;
- reserva;
- loja de origem;
- garantia de checkout;
- disponibilidade transacional;
- prazo de expiração.

O contrato não expõe `available_qty` nem `reserved_qty`.

## 14. Critérios para inclusão de busca

Busca só poderá entrar após decisão explícita sobre:

- ranking;
- normalização;
- acentos;
- sinônimos;
- combinação de filtros;
- relevância;
- paginação;
- comportamento de termo vazio.

A busca deverá ser um pacote separado, com contrato e testes próprios.

## 15. Migração sem quebra

1. manter `/public-api` sem alterações;
2. publicar `/b2c/v1` inicialmente sobre o adaptador piloto;
3. implementar e testar o adaptador de banco separadamente;
4. executar paridade entre as duas fontes;
5. trocar apenas a composição da fonte;
6. manter DTO, envelope, rotas e erros;
7. monitorar antes de desativar o fallback piloto.

Nenhuma etapa desta estratégia autoriza migration, seed, ativação pública, deploy
ou alteração do banco operacional.
