# SKILL-NEI â€” Frontend Operacional AEROSTORE

## Objetivo

Esta skill define o padrÃ£o obrigatÃ³rio para qualquer alteraÃ§Ã£o de frontend, UX, UI, layout, modais, drawers, tabelas, formulÃ¡rios, menus, cards, loading states e feedback visual no CRM/PDV AEROSTORE.

Prioridade absoluta:

1. Funcionar corretamente.
2. Ser usÃ¡vel por vendedor em loja real.
3. NÃ£o quebrar regra de negÃ³cio.
4. NÃ£o criar tela bonita, porÃ©m inutilizÃ¡vel.
5. Reaproveitar componentes existentes e estÃ¡veis.
6. Validar no navegador real.

Regra principal:

> Se o vendedor da loja nÃ£o consegue usar rÃ¡pido, a tela estÃ¡ errada.

---

## Filosofia

Design minimalista nÃ£o significa tela vazia, quebrada ou com Ã¡rea morta.

Design minimalista no CRM/PDV AEROSTORE significa:

- clareza;
- poucos elementos por vez;
- hierarquia visual Ã³bvia;
- botÃµes principais bem posicionados;
- formulÃ¡rios que cabem na tela;
- campos agrupados em blocos curtos;
- sem excesso de texto;
- sem scroll horizontal;
- sem drawer fora da viewport;
- sem overlay escuro sem conteÃºdo visÃ­vel;
- sem informaÃ§Ãµes importantes escondidas.

Funcional primeiro. Bonito depois.

---

## RestriÃ§Ãµes absolutas

NÃ£o instalar bibliotecas.

NÃ£o instalar frameworks.

NÃ£o migrar arquitetura.

NÃ£o instalar React.

NÃ£o instalar Tailwind.

NÃ£o instalar shadcn.

NÃ£o alterar backend sem escopo explÃ­cito.

NÃ£o alterar banco de dados sem escopo explÃ­cito.

NÃ£o alterar APIs sem escopo explÃ­cito.

NÃ£o alterar integraÃ§Ãµes sem escopo explÃ­cito.

NÃ£o alterar regras de negÃ³cio sem autorizaÃ§Ã£o.

NÃ£o mexer em recebimento, cashback, estoque, fiscal, Tiny, WhatsApp, PagBank ou AEROINTEL fora do escopo pedido.

Usar apenas:

- HTML existente;
- CSS existente;
- JavaScript existente;
- padrÃµes jÃ¡ presentes no projeto.

---

## Regra de ouro para entregas

Uma entrega de frontend sÃ³ Ã© vÃ¡lida se:

1. A tela abre no navegador real.
2. O conteÃºdo principal aparece.
3. O usuÃ¡rio consegue clicar.
4. O usuÃ¡rio consegue preencher.
5. O usuÃ¡rio consegue fechar drawer/modal.
6. NÃ£o hÃ¡ conteÃºdo fora da tela.
7. NÃ£o hÃ¡ scroll horizontal.
8. NÃ£o hÃ¡ Ã¡rea morta gigante.
9. NÃ£o hÃ¡ overlay bloqueando a tela sem formulÃ¡rio visÃ­vel.
10. O fluxo anterior continua funcionando.

Se qualquer item acima falhar, a entrega nÃ£o pode ser marcada como verde.

---

## Drawers

Drawers sÃ£o pontos crÃ­ticos do projeto.

Todo drawer deve seguir este padrÃ£o:

- abrir dentro da viewport;
- aparecer acima do overlay;
- ter largura controlada;
- ter altura controlada;
- nÃ£o ultrapassar a tela;
- ter header visÃ­vel;
- ter conteÃºdo rolÃ¡vel;
- ter footer fixo quando houver aÃ§Ãµes;
- ter botÃ£o fechar visÃ­vel;
- nÃ£o gerar scroll horizontal;
- nÃ£o deixar Ã¡rea morta grande;
- nÃ£o esconder campos importantes.

Estrutura recomendada:

```text
Drawer
â”œâ”€â”€ Header fixo
â”‚   â”œâ”€â”€ TÃ­tulo
â”‚   â”œâ”€â”€ SubtÃ­tulo curto
â”‚   â””â”€â”€ Fechar
â”œâ”€â”€ Body rolÃ¡vel
â”‚   â”œâ”€â”€ Bloco 1
â”‚   â”œâ”€â”€ Bloco 2
â”‚   â”œâ”€â”€ Bloco 3
â”‚   â””â”€â”€ Bloco 4
â””â”€â”€ Footer fixo, se houver aÃ§Ã£o
    â”œâ”€â”€ Cancelar
    â””â”€â”€ Salvar / Confirmar
```

Nunca entregar drawer que:

- nasce fora da tela;
- fica cortado Ã  direita;
- fica atrÃ¡s do overlay;
- tem apenas fundo escurecido;
- tem conteÃºdo invisÃ­vel;
- deixa um bloco verde/escuro gigante vazio;
- exige scroll da pÃ¡gina inteira para usar;
- gera barra horizontal.

---

## Modais

Modais sÃ³ devem ser usados quando forem realmente adequados.

Para cadastros longos, preferir drawer lateral amplo.

Modal pequeno nÃ£o deve ser usado para:

- cadastro de produto;
- cadastro de cliente;
- formulÃ¡rios com muitos campos;
- importaÃ§Ã£o de planilha;
- ediÃ§Ã£o operacional complexa.

---

## FormulÃ¡rios

FormulÃ¡rios devem ser divididos em blocos curtos.

Cada bloco deve ter:

- tÃ­tulo pequeno;
- descriÃ§Ã£o curta, se necessÃ¡rio;
- campos agrupados;
- espaÃ§amento consistente;
- labels claras.

Evitar formulÃ¡rio gigante sem hierarquia.

Evitar muitos campos em uma linha sÃ³.

Evitar campo importante fora da primeira dobra quando o fluxo Ã© rÃ¡pido.

Campos monetÃ¡rios devem usar padrÃ£o brasileiro:

```text
R$ 0,00
R$ 39,90
R$ 1.000,00
```

Datas devem ser legÃ­veis para operaÃ§Ã£o brasileira.

---

## Tabelas

Tabelas devem ser escaneÃ¡veis.

Toda tabela precisa ter:

- cabeÃ§alho claro;
- linhas com altura confortÃ¡vel;
- colunas Ãºteis;
- aÃ§Ãµes visÃ­veis;
- badges discretos;
- estado vazio;
- loading state;
- sem scroll horizontal sempre que possÃ­vel.

NÃ£o criar tabelas com colunas inÃºteis.

NÃ£o esconder dado importante em coluna estreita.

---

## Cards

Cards devem ser compactos.

NÃ£o criar cards gigantes para nÃºmeros simples.

Cards de resumo devem ter:

- tÃ­tulo curto;
- nÃºmero principal;
- descriÃ§Ã£o pequena;
- visual discreto.

Evitar excesso de negrito.

---

## Menus e navegaÃ§Ã£o

A navegaÃ§Ã£o deve refletir a operaÃ§Ã£o real.

Exemplo aprovado:

```text
OPERAÃ‡ÃƒO
- PDV AEROSTORE
- Cadastro
   - Produtos
   - Clientes
- ConfiguraÃ§Ãµes
```

Regras:

- produto e cliente sÃ£o cadastros operacionais;
- telas importantes nÃ£o podem depender de link manual;
- item ativo deve ficar claro;
- submenu expandido deve permanecer aberto quando uma subrota estÃ¡ ativa;
- nÃ£o exibir opÃ§Ãµes antigas/legadas como opÃ§Ã£o operacional ativa.

---

## Loading states

Toda aÃ§Ã£o que demora precisa indicar processamento.

Exemplos:

- carregando produtos;
- carregando clientes;
- finalizando venda;
- importando planilha;
- buscando cliente;
- gerando PIN;
- salvando cadastro.

O usuÃ¡rio nÃ£o pode ficar olhando para a tela sem saber se clicou ou nÃ£o.

BotÃ£o em processamento deve evitar duplo clique.

---

## Feedback visual

Mensagens devem ser operacionais, nÃ£o tÃ©cnicas.

Ruim:

```text
Cannot read property undefined
```

Bom:

```text
NÃ£o foi possÃ­vel carregar os clientes. Tente novamente ou verifique a conexÃ£o.
```

Ruim:

```text
Produto nÃ£o encontrado
```

Bom:

```text
Produto sem saldo disponÃ­vel em nenhuma loja cadastrada no sistema.
```

---

## Cadastro de produtos

Tela Produtos deve ser operacional e minimalista.

Deve permitir:

- buscar produto;
- cadastrar produto manualmente;
- importar planilha Tiny;
- revisar pendÃªncias;
- identificar produto por cÃ³digos.

Identificadores importantes:

- SKU;
- CÃ³digo Tiny;
- CÃ³digo da etiqueta;
- CÃ³digo de barras / EAN;
- CÃ³digo interno.

O PDV deve conseguir localizar produto por qualquer identificador disponÃ­vel.

Cadastro de produto deve ter:

- imagem principal;
- dados principais;
- identificadores;
- variaÃ§Ãµes;
- preÃ§o/custo/status;
- estoque inicial ou implantaÃ§Ã£o controlada.

---

## Cadastro de clientes

Tela Clientes deve reaproveitar a base Clientes / Contatos.

NÃ£o criar base paralela.

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
- observaÃ§Ãµes comerciais.

Medidas:

Parte de cima:

```text
PP, P, M, G, GG, XGG, XGGG
```

Parte de baixo:

```text
34, 36, 38, 40, 42, 44, 46, 48, 50
```

CalÃ§ado:

```text
33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45
```

Ficha rÃ¡pida no PDV deve ser compacta e Ãºtil:

```text
Nome
WhatsApp
Parte de cima
Parte de baixo
CalÃ§ado
Cashback disponÃ­vel
ObservaÃ§Ã£o/insight comercial
```

---

## Contagem de clientes

Contato bruto nÃ£o Ã© automaticamente cliente ativo.

Separar conceitos:

- contato;
- cliente;
- cliente ativo;
- cliente com cashback;
- perfil incompleto.

NÃ£o exibir â€œClientes ativosâ€ se a contagem representa apenas contatos brutos.

Deduplicar visualmente quando possÃ­vel por:

1. CPF;
2. telefone/WhatsApp;
3. ID consolidado;
4. nome + telefone.

NÃ£o apagar dados fÃ­sicos sem autorizaÃ§Ã£o.

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

Lojas antigas/legadas podem aparecer em histÃ³rico, mas nÃ£o como opÃ§Ã£o operacional ativa.

NÃ£o exibir como opÃ§Ã£o ativa:

- Bonfim;
- Camboriu;
- Vila genÃ©rico duplicado;
- Estoque geral como loja de venda/caixa.

Sul:

- Ã© loja oficial ativa;
- possui estoque fÃ­sico grande;
- estoque ainda pendente de cadastro/auditoria no sistema;
- nÃ£o deve receber rateio automÃ¡tico de estoque antigo;
- nÃ£o deve receber sobra de importaÃ§Ã£o antiga sem conferÃªncia.

---

## Estoque

Durante a implantaÃ§Ã£o, pode existir regra configurÃ¡vel para vender com estoque zerado/negativo.

Essa regra deve ser configurÃ¡vel, nÃ£o fixa.

Quando ativada:

- permitir venda;
- registrar alerta;
- marcar pendÃªncia de conferÃªncia.

Quando desativada:

- bloquear venda sem estoque conforme regra normal.

NÃ£o alterar essa regra sem escopo especÃ­fico.

---

## Teste obrigatÃ³rio no navegador

Toda alteraÃ§Ã£o visual precisa ser testada no navegador real.

Checklist mÃ­nimo:

```text
1. Tela abre.
2. Menu funciona.
3. BotÃ£o principal funciona.
4. Drawer/modal abre visÃ­vel.
5. Drawer/modal fecha.
6. Campos aparecem.
7. NÃ£o hÃ¡ scroll horizontal.
8. NÃ£o hÃ¡ Ã¡rea morta gigante.
9. Loading aparece quando necessÃ¡rio.
10. Fluxos protegidos nÃ£o quebraram.
```

Para Produto:

```text
- /pdv/produtos abre.
- + Novo produto abre drawer visÃ­vel.
- Importar Tiny abre drawer visÃ­vel.
```

Para Cliente:

```text
- /pdv/clientes abre.
- + Novo cliente abre drawer visÃ­vel.
- Busca funciona por nome/WhatsApp/CPF.
```

Para PDV:

```text
- recebimento continua funcionando;
- Restante continua funcionando;
- botÃ£o + continua funcionando;
- finalizar venda continua funcionando.
```

---

## Status final

SÃ³ usar `Verde` quando:

- testou no navegador real;
- nÃ£o hÃ¡ bug visual evidente;
- drawer/modal estÃ¡ utilizÃ¡vel;
- nÃ£o hÃ¡ rota quebrada;
- nÃ£o hÃ¡ `Failed to fetch`;
- nÃ£o hÃ¡ conteÃºdo fora da tela;
- nÃ£o quebrou fluxo protegido.

Usar `Amarelo controlado` quando:

- cÃ³digo foi ajustado;
- parsing passou;
- mas falta validaÃ§Ã£o visual real ou hÃ¡ limitaÃ§Ã£o conhecida.

Usar `Vermelho` quando:

- tela ainda abre quebrada;
- drawer continua fora da viewport;
- rota continua com erro;
- fluxo principal nÃ£o funciona.

---

## Entrega final obrigatÃ³ria

Toda entrega deve informar:

1. status final;
2. arquivos alterados;
3. funÃ§Ãµes/classes alteradas;
4. o que foi corrigido;
5. o que foi testado no navegador;
6. limitaÃ§Ãµes;
7. confirmaÃ§Ã£o de que nÃ£o alterou fluxos protegidos;
8. prÃ³ximos passos recomendados.

---

## Regras herdadas da UI/UX Pro Max adaptadas para AEROSTORE

Esta seção adapta somente o que é útil da antiga abordagem `ui-ux-pro-max` para o CRM/PDV AEROSTORE.

Não importar regras de React Native, Tailwind, shadcn, Flutter, SwiftUI, bibliotecas externas, CLI de design system ou stacks que não pertencem ao projeto.

A stack deste projeto continua sendo:

- HTML existente;
- CSS existente;
- JavaScript existente;
- padrões já presentes no projeto.

### Ordem obrigatória de prioridade

Toda alteração de frontend deve seguir esta ordem:

1. A tela precisa abrir.
2. O conteúdo principal precisa aparecer.
3. O usuário precisa conseguir clicar.
4. O usuário precisa conseguir preencher.
5. O usuário precisa conseguir salvar/confirmar ou fechar.
6. Não pode haver conteúdo fora da viewport.
7. Não pode haver scroll horizontal.
8. Não pode haver drawer/modal atrás do overlay.
9. Loading e erro precisam ser claros.
10. Só depois melhorar estética visual.

Bonito sem funcionar é entrega inválida.

### Acessibilidade prática

Aplicar sempre:

- campos com label visível;
- botões com texto claro;
- foco visível em inputs e botões;
- contraste suficiente no modo escuro;
- não usar somente cor para indicar erro, sucesso ou alerta;
- botões com área clicável confortável;
- ícones, se existirem, não podem substituir texto essencial;
- botão de fechar sempre visível em drawer/modal;
- ESC ou botão de fechar deve funcionar quando o padrão da tela permitir.

Não remover focus ring sem substituir por foco visual equivalente.

### Interação e feedback

Toda ação que pode demorar precisa dar retorno visual.

Obrigatório em ações como:

- salvar cliente;
- salvar produto;
- importar planilha;
- buscar cliente;
- buscar produto;
- gerar PIN;
- finalizar venda;
- abrir drawer pesado;
- carregar tabela.

Regras:

- botão clicado deve mostrar estado de carregamento quando houver espera;
- evitar duplo clique em ação crítica;
- mostrar sucesso ou erro depois da ação;
- erro precisa dizer o que aconteceu e como corrigir;
- não deixar o operador olhando para a tela sem saber se o clique funcionou.

Mensagem ruim:

“Failed to fetch”

Mensagem boa:

“Não foi possível carregar os clientes. Tente novamente ou verifique a conexão.”

### Layout e viewport

Toda tela deve respeitar a viewport.

Proibido:

- conteúdo cortado para fora da tela;
- drawer nascendo fora da direita;
- modal invisível;
- overlay escuro sem formulário visível;
- scroll horizontal;
- largura fixa quebrando a tela;
- área morta gigante;
- conteúdo importante escondido abaixo sem indicação.

Regras:

- usar largura máxima controlada;
- usar `max-width`;
- usar `height`/`max-height` compatível com viewport;
- body do drawer deve ser rolável;
- header/footer do drawer podem ser fixos;
- z-index precisa ser previsível;
- overlay deve ficar atrás do drawer;
- drawer deve ficar acima do overlay.

### Z-index e camadas

Definir raciocínio de camadas:

1. conteúdo base;
2. menu/sidebar;
3. overlay/scrim;
4. drawer/modal;
5. toast/alerta crítico, se existir.

O drawer/modal nunca pode ficar atrás do overlay.

Se a tela escureceu e o conteúdo não apareceu, a entrega é inválida.

### Formulários operacionais

Formulários de cadastro devem ser divididos em blocos curtos.

Cada bloco deve ter:

- título claro;
- campos relacionados;
- labels visíveis;
- helper text quando necessário;
- erro perto do campo;
- espaçamento consistente.

Evitar:

- formulário gigante sem divisão;
- campos importantes fora da viewport;
- placeholder como único label;
- validação agressiva a cada tecla;
- erro apenas no topo sem indicar campo;
- campos técnicos sem explicação.

Validação ideal:

- validar no blur ou no envio;
- erro perto do campo;
- foco no primeiro campo com erro;
- mensagem com causa e solução.

### Drawers de cadastro

Drawers de Produto e Cliente precisam seguir padrão fixo:

- header fixo;
- body rolável;
- footer fixo se houver botão de ação;
- botão fechar visível;
- largura dentro da viewport;
- sem scroll horizontal;
- sem área morta;
- campos visíveis;
- conteúdo não pode abrir fora da tela.

Checklist obrigatório:

- abre;
- mostra título;
- mostra subtítulo;
- mostra blocos;
- permite preencher;
- permite fechar;
- não fica cortado;
- não fica atrás do overlay;
- não deixa fundo escuro preso depois de fechar.

### Tabelas

Tabelas precisam ser escaneáveis.

Toda tabela deve ter:

- cabeçalho claro;
- linhas com altura confortável;
- dados principais visíveis;
- ações claras;
- badges discretos;
- loading state;
- empty state;
- sem colunas inúteis;
- sem cortar nome de cliente/produto a ponto de impedir identificação.

Valores monetários devem aparecer em formato brasileiro:

- R$ 0,00
- R$ 39,90
- R$ 1.000,00

Datas devem ser legíveis para operação brasileira.

### Cards de resumo

Cards devem ser compactos e honestos.

Não usar card gigante para número simples.

Não exibir métrica enganosa.

Exemplo:
Se a base tem contatos brutos, não chamar de “clientes ativos”.

Preferir:

- Total de contatos;
- Clientes com compra;
- Clientes com cashback;
- Perfil incompleto.

### Navegação

A navegação precisa refletir a operação real.

Padrão aprovado:

OPERAÇÃO
- PDV AEROSTORE
- Cadastro
   - Produtos
   - Clientes
- Configurações

Regras:

- telas importantes não podem depender de link manual;
- item ativo deve ficar claro;
- submenu deve continuar aberto quando a rota filha estiver ativa;
- não misturar lojas, cadastros e histórico como se fossem a mesma coisa;
- não esconder destino importante;
- se uma rota ainda não existe, mostrar destino provisório seguro ou estado claro.

### Loading states

Usar loading quando:

- carregar clientes;
- carregar produtos;
- buscar dados;
- importar planilha;
- salvar cadastro;
- gerar PIN;
- finalizar venda;
- abrir tabela pesada.

Tipos aceitáveis:

- skeleton simples;
- texto “Carregando...”;
- botão com “Processando...”;
- spinner discreto;
- empty state quando não houver dados.

Não deixar tela congelada.

### Estados vazios

Todo estado vazio precisa explicar o que fazer.

Exemplos:

Clientes:
“Nenhum cliente encontrado. Cadastre um novo cliente ou importe contatos.”

Produtos:
“Nenhum produto encontrado. Cadastre manualmente ou importe uma planilha Tiny.”

Cashback:
“Nenhum cashback válido encontrado para este cliente.”

Erro:
“Não foi possível carregar os dados. Tente novamente.”

### Animações

Usar animação apenas se ajudar a entender a ação.

Regras:

- duração curta, entre 150ms e 300ms;
- animar preferencialmente opacity e transform;
- não animar width/height se causar quebra;
- não bloquear clique durante animação;
- respeitar redução de movimento se já houver padrão;
- evitar firula.

### Performance operacional

Evitar travar a tela.

Regras:

- busca com debounce quando necessário;
- não renderizar milhares de linhas sem limite/paginação;
- imagens com fallback;
- tabelas grandes precisam ser paginadas, limitadas ou carregadas progressivamente;
- não carregar base gigante sem necessidade;
- não transformar contato bruto em cliente ativo sem critério.

### Teste obrigatório antes de marcar Verde

Antes de marcar uma entrega de frontend como `Verde`, validar no navegador real:

1. rota abre;
2. menu funciona;
3. botão principal funciona;
4. drawer/modal abre visível;
5. drawer/modal fecha;
6. tabela carrega;
7. busca principal funciona;
8. não há scroll horizontal;
9. não há conteúdo fora da viewport;
10. não há overlay preso;
11. não há `Failed to fetch` visível;
12. fluxos protegidos não quebraram.

Fluxos protegidos:

- recebimento do PDV;
- botão Restante;
- botão + de pagamento;
- auto-lançamento de drafts;
- cashback;
- estoque;
- fulfillment;
- fiscal;
- integrações externas.

### Critério para status

Usar `Verde` somente se:

- navegador real foi testado;
- tela não está quebrada;
- drawer/modal está usável;
- rota não dá erro;
- não há conteúdo fora da tela;
- fluxo principal funciona.

Usar `Amarelo controlado` se:

- código foi corrigido;
- parsing passou;
- mas falta teste visual real ou há limitação conhecida.

Usar `Vermelho` se:

- tela continua quebrada;
- drawer continua fora da viewport;
- rota continua com erro;
- usuário não consegue operar.
