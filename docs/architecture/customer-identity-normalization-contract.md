# FASE 3.1-A — CONTRATO DE NORMALIZAÇÃO DE IDENTIDADE DO CLIENTE

## Escopo e limites

Esta fase entrega somente um contrato técnico isolado e executável. Ela não cria identidade
mestra, não grava no banco, não abre conexão SQLite, não altera schema, não adiciona rota,
não muda autenticação e não é consumida pelo CRM, PDV, mobile ou integrações externas.

As únicas fontes oficiais candidatas a um backfill futuro são `contacts` e `crm_contacts`.
Fontes auxiliares são evidências operacionais e nunca criam identidade mestra ou elegibilidade
automática. Endereços permanecem separados por fonte e nenhum endereço primário é eleito.

## Artefatos executáveis

- `modules/customers/master/normalization.js`: funções puras, determinísticas e sem I/O.
- `modules/customers/master/customerSourceInventory.js`: inventário estático derivado do texto
  de `db.js`, sem acesso ao banco.
- `modules/customers/master/fixtures/syntheticCustomerIdentityFixtures.js`: fixtures declaradas
  como sintéticas e sem dados reais de clientes.
- `modules/customers/master/__tests__`: contrato unitário e detecção de drift do schema.

O inventário confere literalmente colunas, chave primária e índices das duas fontes oficiais.
Uma alteração futura em `db.js` quebra o teste até que o contrato seja revisado conscientemente.
Ele também registra os serviços, normalizadores, rotas de leitura/escrita e riscos já existentes,
sem importar o novo contrato em nenhum desses pontos.

## Modelo comum

Normalizadores escalares retornam um objeto serializável com:

- `version`: `customer-identity-normalization/v1`;
- `rawValue`: entrada escalar preservada;
- `normalizedValue`: representação limpa, ainda não necessariamente confiável;
- `canonicalValue`: valor canônico somente quando a classificação é válida;
- `classification` e `isValid`;
- `reasons` e `warnings`: códigos estáveis, adequados a revisão e métricas;
- `maskedValue`: representação segura para diagnóstico.

Entradas vazias, malformadas e tipos não suportados são classificados; erros comuns não
geram exceções.

## Telefone

O contrato:

- aceita pontuação, espaços, `+55`, DDI 55 implícito e prefixo nacional de operadora;
- produz E.164 apenas para celular brasileiro de 9 dígitos, fixo brasileiro válido ou número
  internacional explicitamente iniciado por `+`;
- valida DDD brasileiro conhecido;
- não converte silenciosamente celular antigo de 8 dígitos: ele fica `AMBIGUOUS`;
- rejeita sequências repetidas, placeholders, comprimentos e padrões inválidos;
- não interpreta como internacional um número sem `+` que não satisfaça o contrato brasileiro.

## Documento

Valores de 11 dígitos são tratados como CPF e passam por rejeição de dígitos repetidos e
validação dos dois dígitos verificadores. Um valor de 14 dígitos é classificado conservadoramente
como `OTHER_DOCUMENT`, sem afirmar tipo ou validade. Outros comprimentos ficam `AMBIGUOUS`.

Não há índice único novo. Uma unicidade parcial de CPF só poderá ser avaliada depois de
limpeza, backfill controlado e comprovação de zero violações.

## E-mail, nome e endereço

E-mail é aparado, convertido para minúsculas e validado por sintaxe conservadora. Nome preserva
a forma de exibição, cria forma de busca sem acentos e não expande abreviações. Placeholders e
nomes curtos são classificados explicitamente.

Endereço é normalizado campo a campo, com CEP e UF validados. O identificador de origem é
preservado. Não há merge entre fontes, propagação ou escolha de endereço primário.

## Comparação com o legado

| Área | Comportamento legado | Contrato 3.1-A |
| --- | --- | --- |
| Telefone | Normalizadores diferentes em `server.js`, serviço unificado e consolidação PDV | Um contrato puro, versionado, com DDD, E.164, ambiguidade e códigos estáveis |
| Documento | Serviço unificado aceita qualquer sequência com 11 ou mais dígitos | CPF tem tamanho exato e checksum; outros documentos não viram CPF |
| Consolidação | União transitiva por CPF, telefone, e-mail e chaves fracas | Nenhuma consolidação é executada nesta fase |
| Precedência | Valores maiores/mais longos podem vencer | Nenhum valor de uma fonte sobrescreve outra |
| ID unificado | Índice de leitura `U...`, instável | Nenhum ID mestre é criado |
| Conflito | Detectado depois do agrupamento | Somente o contrato de classificação é preparado; revisão estrutural futura é de Admin |

`modules/customers/customerUnifiedService.js` continua existindo como leitura legada e não é
declarado fonte da verdade por este trabalho.

## Contrato para consolidação futura

Uma fase futura poderá consumir os resultados somente em shadow-read. O mínimo necessário será:

1. manter referências de origem imutáveis;
2. impedir união por um único sinal fraco;
3. separar equivalência, conflito e ausência de evidência;
4. restringir conflitos estruturais a fluxo administrativo;
5. medir divergências sem propagar alterações;
6. definir retenção com validação jurídica antes de persistir histórico sensível.

Esses itens são documentação de fronteira, não implementação de merge, backfill ou identidade
mestra.

## Execução dos testes

```powershell
node --test modules/customers/master/__tests__/*.test.js
```

Os testes usam apenas módulos nativos do Node.js, fixtures sintéticas e leitura do arquivo
`db.js`. Não usam rede, banco de dados ou dados operacionais.
