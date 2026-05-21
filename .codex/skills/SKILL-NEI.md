# SKILL-NEI — Frontend Operacional AEROSTORE

## Objetivo

Esta skill define o padrão obrigatório para qualquer alteração de frontend, UX, UI, layout, modais, drawers, tabelas, formulários, menus, cards, loading states e feedback visual no CRM/PDV AEROSTORE.

Prioridade absoluta:

1. Funcionar corretamente.
2. Ser usável por vendedor em loja real.
3. Não quebrar regra de negócio.
4. Não criar tela bonita, porém inutilizável.
5. Reaproveitar componentes existentes e estáveis.
6. Validar no navegador real.

Regra principal:

> Se o vendedor da loja não consegue usar rápido, a tela está errada.

---

## Filosofia

Design minimalista não significa tela vazia, quebrada ou com área morta.

Design minimalista no CRM/PDV AEROSTORE significa:

- clareza;
- poucos elementos por vez;
- hierarquia visual óbvia;
- botões principais bem posicionados;
- formulários que cabem na tela;
- campos agrupados em blocos curtos;
- sem excesso de texto;
- sem scroll horizontal;
- sem drawer fora da viewport;
- sem overlay escuro sem conteúdo visível;
- sem informações importantes escondidas.

Funcional primeiro. Bonito depois.

---

## Restrições absolutas

Não instalar bibliotecas.

Não instalar frameworks.

Não migrar arquitetura.

Não instalar React.

Não instalar Tailwind.

Não instalar shadcn.

Não alterar backend sem escopo explícito.

Não alterar banco de dados sem escopo explícito.

Não alterar APIs sem escopo explícito.

Não alterar integrações sem escopo explícito.

Não alterar regras de negócio sem autorização.

Não mexer em recebimento, cashback, estoque, fiscal, Tiny, WhatsApp, PagBank ou AEROINTEL fora do escopo pedido.

Usar apenas:

- HTML existente;
- CSS existente;
- JavaScript existente;
- padrões já presentes no projeto.

---

## Regra de ouro para entregas

Uma entrega de frontend só é válida se:

1. A tela abre no navegador real.
2. O conteúdo principal aparece.
3. O usuário consegue clicar.
4. O usuário consegue preencher.
5. O usuário consegue fechar drawer/modal.
6. Não há conteúdo fora da tela.
7. Não há scroll horizontal.
8. Não há área morta gigante.
9. Não há overlay bloqueando a tela sem formulário visível.
10. O fluxo anterior continua funcionando.

Se qualquer item acima falhar, a entrega não pode ser marcada como verde.

---

## Drawers

Drawers são pontos críticos do projeto.

Todo drawer deve seguir este padrão:

- abrir dentro da viewport;
- aparecer acima do overlay;
- ter largura controlada;
- ter altura controlada;
- não ultrapassar a tela;
- ter header visível;
- ter conteúdo rolável;
- ter footer fixo quando houver ações;
- ter botão fechar visível;
- não gerar scroll horizontal;
- não deixar área morta grande;
- não esconder campos importantes.

Estrutura recomendada:

```text
Drawer
├── Header fixo
│   ├── Título
│   ├── Subtítulo curto
│   └── Fechar
├── Body rolável
│   ├── Bloco 1
│   ├── Bloco 2
│   ├── Bloco 3
│   └── Bloco 4
└── Footer fixo, se houver ação
    ├── Cancelar
    └── Salvar / Confirmar
```

Nunca entregar drawer que:

- nasce fora da tela;
- fica cortado à direita;
- fica atrás do overlay;
- tem apenas fundo escurecido;
- tem conteúdo invisível;
- deixa um bloco verde/escuro gigante vazio;
- exige scroll da página inteira para usar;
- gera barra horizontal.

---

## Modais

Modais só devem ser usados quando forem realmente adequados.

Para cadastros longos, preferir drawer lateral amplo.

Modal pequeno não deve ser usado para:

- cadastro de produto;
- cadastro de cliente;
- formulários com muitos campos;
- importação de planilha;
- edição operacional complexa.

---

## Formulários

Formulários devem ser divididos em blocos curtos.

Cada bloco deve ter:

- título pequeno;
- descrição curta, se necessário;
- campos agrupados;
- espaçamento consistente;
- labels claras.

Evitar formulário gigante sem hierarquia.

Evitar muitos campos em uma linha só.

Evitar campo importante fora da primeira dobra quando o fluxo é rápido.

Campos monetários devem usar padrão brasileiro:

```text
R$ 0,00
R$ 39,90
R$ 1.000,00
```

Datas devem ser legíveis para operação brasileira.

---

## Tabelas

Tabelas devem ser escaneáveis.

Toda tabela precisa ter:

- cabeçalho claro;
- linhas com altura confortável;
- colunas úteis;
- ações visíveis;
- badges discretos;
- estado vazio;
- loading state;
- sem scroll horizontal sempre que possível.

Não criar tabelas com colunas inúteis.

Não esconder dado importante em coluna estreita.

---

## Cards

Cards devem ser compactos.

Não criar cards gigantes para números simples.

Cards de resumo devem ter:

- título curto;
- número principal;
- descrição pequena;
- visual discreto.

Evitar excesso de negrito.

---

## Menus e navegação

A navegação deve refletir a operação real.

Exemplo aprovado:

```text
OPERAÇÃO
- PDV AEROSTORE
- Cadastro
   - Produtos
   - Clientes
- Configurações
```

Regras:

- produto e cliente são cadastros operacionais;
- telas importantes não podem depender de link manual;
- item ativo deve ficar claro;
- submenu expandido deve permanecer aberto quando uma subrota está ativa;
- não exibir opções antigas/legadas como opção operacional ativa.

---

## Loading states

Toda ação que demora precisa indicar processamento.

Exemplos:

- carregando produtos;
- carregando clientes;
- finalizando venda;
- importando planilha;
- buscando cliente;
- gerando PIN;
- salvando cadastro.

O usuário não pode ficar olhando para a tela sem saber se clicou ou não.

Botão em processamento deve evitar duplo clique.

---

## Feedback visual

Mensagens devem ser operacionais, não técnicas.

Ruim:

```text
Cannot read property undefined
```

Bom:

```text
Não foi possível carregar os clientes. Tente novamente ou verifique a conexão.
```

Ruim:

```text
Produto não encontrado
```

Bom:

```text
Produto sem saldo disponível em nenhuma loja cadastrada no sistema.
```

---

## Cadastro de produtos

Tela Produtos deve ser operacional e minimalista.

Deve permitir:

- buscar produto;
- cadastrar produto manualmente;
- importar planilha Tiny;
- revisar pendências;
- identificar produto por códigos.

Identificadores importantes:

- SKU;
- Código Tiny;
- Código da etiqueta;
- Código de barras / EAN;
- Código interno.

O PDV deve conseguir localizar produto por qualquer identificador disponível.

Cadastro de produto deve ter:

- imagem principal;
- dados principais;
- identificadores;
- variações;
- preço/custo/status;
- estoque inicial ou implantação controlada.

---

## Cadastro de clientes

Tela Clientes deve reaproveitar a base Clientes / Contatos.

Não criar base paralela.

Cadastro de cliente deve ter:

- nome completo;
- WhatsApp;
- CPF;
- e-mail;
- data de nascimento;
- CEP;
- cidade;
- bairro;
- medidas;
- cashback/comercial;
- observações comerciais.

Medidas:

Parte de cima:

```text
PP, P, M, G, GG, XGG, XGGG
```

Parte de baixo:

```text
34, 36, 38, 40, 42, 44, 46, 48, 50
```

Calçado:

```text
33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45
```

Ficha rápida no PDV deve ser compacta e útil:

```text
Nome
WhatsApp
Parte de cima
Parte de baixo
Calçado
Cashback disponível
Observação/insight comercial
```

---

## Contagem de clientes

Contato bruto não é automaticamente cliente ativo.

Separar conceitos:

- contato;
- cliente;
- cliente ativo;
- cliente com cashback;
- perfil incompleto.

Não exibir “Clientes ativos” se a contagem representa apenas contatos brutos.

Deduplicar visualmente quando possível por:

1. CPF;
2. telefone/WhatsApp;
3. ID consolidado;
4. nome + telefone.

Não apagar dados físicos sem autorização.

---

## Lojas

Lojas oficiais atuais:

```text
Vila Masc.
Vila Fem/Infant.
Botanico
Sul
```

Dropdown operacional deve mostrar apenas lojas oficiais ativas.

Lojas antigas/legadas podem aparecer em histórico, mas não como opção operacional ativa.

Não exibir como opção ativa:

- Bonfim;
- Camboriu;
- Vila genérico duplicado;
- Estoque geral como loja de venda/caixa.

Sul:

- é loja oficial ativa;
- possui estoque físico grande;
- estoque ainda pendente de cadastro/auditoria no sistema;
- não deve receber rateio automático de estoque antigo;
- não deve receber sobra de importação antiga sem conferência.

---

## Estoque

Durante a implantação, pode existir regra configurável para vender com estoque zerado/negativo.

Essa regra deve ser configurável, não fixa.

Quando ativada:

- permitir venda;
- registrar alerta;
- marcar pendência de conferência.

Quando desativada:

- bloquear venda sem estoque conforme regra normal.

Não alterar essa regra sem escopo específico.

---

## Teste obrigatório no navegador

Toda alteração visual precisa ser testada no navegador real.

Checklist mínimo:

```text
1. Tela abre.
2. Menu funciona.
3. Botão principal funciona.
4. Drawer/modal abre visível.
5. Drawer/modal fecha.
6. Campos aparecem.
7. Não há scroll horizontal.
8. Não há área morta gigante.
9. Loading aparece quando necessário.
10. Fluxos protegidos não quebraram.
```

Para Produto:

```text
- /pdv/produtos abre.
- + Novo produto abre drawer visível.
- Importar Tiny abre drawer visível.
```

Para Cliente:

```text
- /pdv/clientes abre.
- + Novo cliente abre drawer visível.
- Busca funciona por nome/WhatsApp/CPF.
```

Para PDV:

```text
- recebimento continua funcionando;
- Restante continua funcionando;
- botão + continua funcionando;
- finalizar venda continua funcionando.
```

---

## Status final

Só usar `Verde` quando:

- testou no navegador real;
- não há bug visual evidente;
- drawer/modal está utilizável;
- não há rota quebrada;
- não há `Failed to fetch`;
- não há conteúdo fora da tela;
- não quebrou fluxo protegido.

Usar `Amarelo controlado` quando:

- código foi ajustado;
- parsing passou;
- mas falta validação visual real ou há limitação conhecida.

Usar `Vermelho` quando:

- tela ainda abre quebrada;
- drawer continua fora da viewport;
- rota continua com erro;
- fluxo principal não funciona.

---

## Entrega final obrigatória

Toda entrega deve informar:

1. status final;
2. arquivos alterados;
3. funções/classes alteradas;
4. o que foi corrigido;
5. o que foi testado no navegador;
6. limitações;
7. confirmação de que não alterou fluxos protegidos;
8. próximos passos recomendados.
