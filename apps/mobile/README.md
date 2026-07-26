# AEROSTORE Mobile — Fundação do catálogo

Primeira versão executável do aplicativo AEROSTORE. O pacote apresenta catálogo
e detalhe de produto com uma fonte local fiel ao contrato B2C V1. Não há login,
carrinho, pedido, checkout, pagamento, reserva ou publicação.

## Decisão de organização

Foi escolhida a opção **A — `apps/mobile`**, com `package.json`,
`package-lock.json` e `node_modules` próprios. O repositório atual não foi
convertido em workspace ou monorepo formal.

- `apps/mobile` mantém app e contrato B2C no mesmo histórico e facilita um
  compartilhamento futuro de tipos.
- O pacote próprio isola dependências e não altera os manifests do backend.
- `mobile` na raiz teria menos contexto arquitetural para outros clientes.
- Um repositório separado aumentaria a distância entre evolução do contrato e
  consumidor sem benefício operacional neste pacote.

O deploy legado continua partindo da raiz e não depende deste diretório.

## Stack e estrutura

- Expo SDK 57
- React Native 0.86
- React 19
- TypeScript estrito
- Expo Router
- Estado local do React e `fetch`
- Jest + Testing Library

```text
src/
  app/                 rotas /, /catalog e /product/[slug]
  catalog/
    contracts.ts       DTOs públicos B2C V1
    CatalogClient.ts   interface comum
    client.ts          seleção explícita da fonte
    mock/              dados e adaptador local
    http/              cliente fetch preparado
  components/          peças visuais reutilizáveis
  screens/             catálogo e detalhe
  theme/               tokens visuais centralizados
__tests__/             contrato, clientes e componentes
```

Expo Router foi escolhido porque o template oficial oferece TypeScript e
roteamento por arquivos com uma árvore mínima. O app possui somente o fluxo
`Catálogo → Produto`; não há abas vazias.

## Execução local

Requisitos: Node.js LTS e npm.

```powershell
cd apps/mobile
npm install
npm start
```

Para abrir diretamente no navegador:

```powershell
npm run web
```

Validações:

```powershell
npm run typecheck
npm test
npm run web:export
```

Android pode ser iniciado com `npm run android` quando houver emulador local.
iOS não é exigido nem suportado nativamente neste ambiente Windows.

## Fontes do catálogo

O padrão é o mock local:

```text
EXPO_PUBLIC_CATALOG_SOURCE=mock
```

Os dados cobrem produtos destacados e não destacados, categorias, cores,
tamanhos, desconto, múltiplas imagens e variantes, além de `in_stock`,
`low_stock` e `out_of_stock`.

Para inspecionar estados locais sem colocar comportamento de teste nos
componentes:

```text
EXPO_PUBLIC_MOCK_CATALOG_SCENARIO=success
EXPO_PUBLIC_MOCK_CATALOG_SCENARIO=empty
EXPO_PUBLIC_MOCK_CATALOG_SCENARIO=catalog_disabled
EXPO_PUBLIC_MOCK_CATALOG_SCENARIO=product_not_found
EXPO_PUBLIC_MOCK_CATALOG_SCENARIO=internal_error
```

O atraso intencional do adaptador mock permite validar o estado de carregamento.

## Fonte HTTP futura

Somente após autorização operacional:

```text
EXPO_PUBLIC_CATALOG_SOURCE=http
EXPO_PUBLIC_B2C_API_URL=https://host-autorizado
```

Reinicie o processo Expo após mudar a configuração. As telas não precisam ser
alteradas: ambas consomem `CatalogClient`.

O cliente usa exclusivamente:

```text
GET /b2c/v1/catalog
GET /b2c/v1/catalog/filters
GET /b2c/v1/products/:slug
```

Ele possui timeout de oito segundos, exige JSON e `meta.api_version = "v1"`,
interpreta os sete códigos aprovados e não faz retry infinito nem fallback
silencioso para mock. Nenhuma chamada HTTP ocorre na configuração padrão.

## Contrato e estados

Os tipos refletem apenas os campos aprovados do B2C V1. Campos internos como
IDs, SKU, barcode, custo e quantidade bruta não existem no mock ou nas telas.
O detalhe usa `availability`, pois `status_copy` pertence apenas ao item da
listagem no contrato integrado.

Estados implementados:

- carregamento;
- sucesso;
- vazio;
- erro recuperável;
- catálogo desligado;
- produto não encontrado.

Os únicos filtros enviados ao serviço são `category` e `featured`. Paginação é
feita por “Carregar mais”. Não há busca, ordenação ou filtros locais de preço,
cor e tamanho.

## Acessibilidade

Controles possuem rótulos, papéis e estados acessíveis; alvos interativos têm
altura mínima de 48 px; imagens possuem descrição; carregamento e erros são
anunciados; textos aceitam ampliação controlada e a paleta mantém contraste alto.

## Segurança e limitações

- Variáveis `EXPO_PUBLIC_*` são públicas por definição: nunca inserir token ou
  segredo.
- O cliente não envia autenticação.
- URLs das imagens do mock são editoriais e dependem de rede; dados e navegação
  permanecem locais.
- O catálogo HTTP real está desligado e não foi acessado.
- O projeto não utiliza cache persistente.
- Nenhuma seleção visual de variante representa reserva.
- Em 26/07/2026, `npm audit --omit=dev` reporta 35 ocorrências
  transitivas (10 moderadas, 25 altas, nenhuma crítica) na árvore oficial
  Expo/React Native. O reparo sugerido pelo npm exige downgrade incompatível
  com o SDK 57 e não foi aplicado. O `expo-doctor` permanece 20/20; essa árvore
  deve ser reavaliada quando o Expo publicar versões compatíveis corrigidas.

## Escopo explicitamente excluído

Login, cadastro, conta, busca, favoritos, carrinho, checkout, pedido, pagamento,
reserva, cashback, entrega, retirada, tracking, push, câmera, barcode, analytics,
Firebase, EAS Build e publicação em lojas.

## Próximo menor passo

Depois da autorização do staging, apontar uma build local para a URL B2C
autorizada, manter o catálogo OFF, comprovar a tela específica
`CATALOG_DISABLED` e só então executar QA de contrato com uma janela controlada
de catálogo publicado.
