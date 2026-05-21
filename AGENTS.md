# AGENTS.md — AEROSTORE OS / CRM + PDV

## Visão do projeto

Este projeto é o ecossistema operacional da AEROSTORE.

O CRM é o cérebro estratégico.
O PDV é a operação de loja física.
Os dados são a inteligência.
O frontend é a experiência da marca.

O sistema não deve parecer um ERP antigo, fiscal ou poluído.
O sistema deve parecer uma operação premium, moderna e rápida para varejo de moda.

## Regra máxima

Nunca quebrar funcionalidades existentes.
Nunca alterar regra de negócio sem pedido explícito.
Nunca mexer em módulos externos sem autorização explícita.

Módulos protegidos:
- Tiny/Vitrine
- AEROINTEL
- PagBank
- WhatsApp atual
- campanhas atuais
- motor de mídia
- CRM legado

## Prioridade atual

A prioridade atual é estabilizar e refinar o frontend do PDV.

Antes de criar novas funcionalidades grandes:
- corrigir UX
- corrigir roteamento
- corrigir sessão/login
- corrigir botões mortos
- corrigir estados vazios
- corrigir tabelas espremidas
- corrigir valores cortados
- corrigir responsividade

## Skill obrigatória de frontend

Sempre que a tarefa envolver frontend, o Codex deve seguir a skill `frontend-design`, além das regras específicas deste projeto AEROSTORE OS.

A skill `frontend-design` deve ser usada especialmente em:
- /pdv/relatorios
- /pdv/venda
- /pdv/caixa
- /pdv/estoque
- /pdv/testes
- /pdv/clientes
- /pdv/importacoes
- /pdv/consolidacao
- /pdv/orcamentos
- /pdv/reservas
- /pdv/trocas
- /pdv/consumo
- /pdv/eventos
- telas do CRM que impactem experiência visual
- login
- menu lateral
- menu interno do PDV
- responsividade
- estados vazios
- loading
- feedback visual
- tabelas
- cards
- botões
- formulários

Regras:
- Antes de alterar frontend, consultar as instruções da skill frontend-design.
- Não criar telas com cara de ERP antigo.
- Não deixar tabelas espremidas.
- Não deixar valores cortados.
- Não deixar botão sem feedback.
- Não deixar rota visual quebrada.
- Manter padrão premium, limpo e operacional da AEROSTORE OS.

## Arquitetura visual

O CRM e o PDV devem ter separação visual clara.

CRM:
- painel principal
- contatos
- campanhas
- cashback
- relatórios
- automações

PDV:
- dashboard
- testes
- venda
- caixa
- estoque
- relatórios
- clientes
- importações
- consolidação
- orçamentos
- reservas
- trocas
- consumo
- eventos

O PDV deve ter shell próprio:
- título da rota
- menu interno
- conteúdo operacional
- estado vazio claro
- feedback visual

## Rotas do PDV

Estas rotas devem sempre renderizar o painel correto:

/pdv
/pdv/dashboard
/pdv/testes
/pdv/venda
/pdv/caixa
/pdv/estoque
/pdv/relatorios
/pdv/clientes
/pdv/importacoes
/pdv/consolidacao
/pdv/orcamentos
/pdv/reservas
/pdv/trocas
/pdv/consumo
/pdv/eventos

Quando window.location.pathname começar com /pdv:
- nunca renderizar o painel principal do CRM
- nunca cair em dashboard genérico do CRM
- sempre respeitar a subrota do PDV
- sempre manter menu interno do PDV

## Fundação do PDV

Os blocos de fundação do PDV só podem aparecer em:

/pdv
/pdv/dashboard

Blocos de fundação:
- Criado para loja física...
- Rotas base do PDV
- Fundação operacional
- Pagamentos preparados
- Importações seguras
- Segurança e crescimento
- Blueprint do banco

Esses blocos NÃO devem aparecer em:
- /pdv/testes
- /pdv/venda
- /pdv/caixa
- /pdv/estoque
- /pdv/relatorios
- /pdv/clientes
- /pdv/importacoes
- /pdv/consolidacao
- /pdv/orcamentos
- /pdv/reservas
- /pdv/trocas
- /pdv/consumo
- /pdv/eventos

## Menu interno do PDV

O PDV deve ter menu interno claro com:

- Dashboard
- Testes
- Venda
- Caixa
- Estoque
- Relatórios
- Clientes
- Importações
- Consolidação
- Orçamentos
- Reservas
- Trocas
- Consumo
- Eventos

O item ativo deve ficar destacado.
O clique deve atualizar URL e renderizar painel correto.
Não criar navegação quebrada.

## UX obrigatória

Toda ação assíncrona precisa ter:
- loading
- sucesso
- erro claro
- recuperação possível

Botão nunca pode parecer morto.

Exemplos obrigatórios:
- Gerar massa
- Limpar massa
- Atualizar status
- Atualizar estoque
- Abrir caixa
- Fechar caixa
- Buscar produto
- Finalizar venda
- Gerar cupom
- Atualizar relatórios

## Estados vazios obrigatórios

Sem massa:
“Gere uma massa de teste para popular o PDV.”

Sem estoque:
“Sem dados de estoque. Gere massa de teste ou importe produtos.”

Sem relatórios:
“Sem dados no período. Altere o filtro ou gere massa de teste.”

Sem caixa:
“Nenhum caixa aberto. Abra um caixa para iniciar vendas.”

Sem login:
“Faça login para carregar os dados do PDV.”

## Login e sessão

Não remover autenticação.
Não criar bypass inseguro.
Não desproteger endpoints.

Se estiver sem sessão:
- mostrar aviso útil
- permitir abrir login
- não deixar o usuário preso
- não mascarar erro como tela vazia

Login local esperado:
admin@aerostore.local
123456

O topo deve mostrar claramente:
- Sessão não iniciada
ou
- Admin AEROSTORE

## Visual premium

Direção visual:
- dark premium
- elegante
- minimalista
- varejo de moda
- leitura rápida
- espaçamento bom
- cards alinhados
- botões consistentes
- tabelas legíveis
- hierarquia clara

Evitar:
- ERP antigo
- visual fiscal
- dashboard técnico
- cards excessivos
- tabelas espremidas
- barras horizontais desnecessárias
- valores cortados com reticências
- botões sem feedback

## Relatórios

A tela /pdv/relatorios deve ser painel executivo.

Priorizar leitura de:
- venda líquida
- quantidade de vendas
- ticket médio
- desconto total
- cashback gerado
- cashback usado
- permuta
- vale emitido
- uso e consumo
- vendedores
- lojas
- clientes
- estoque
- pagamentos
- alertas
- insights
- vendas do período

Regras:
- valores financeiros nunca devem cortar
- evitar “R$ 0...”
- reduzir barras horizontais
- tabelas devem ser legíveis
- usar altura máxima e scroll vertical quando necessário
- mostrar top 10 quando a lista for muito grande
- exportação fica para lista completa

## Estoque

A tela /pdv/estoque deve mostrar:
- cards de saldo
- filtros
- produtos
- alertas
- movimentos
- ajuste manual
- transferência

Não deixar tabela explodir largura.
Não cortar nome de produto de forma inútil.
Não esconder informação crítica.

## Venda

A tela /pdv/venda deve parecer frente de caixa.

Layout recomendado:
- busca de produto em destaque
- cliente identificado
- cashback visível
- carrinho claro
- resumo financeiro
- pagamentos
- botão finalizar venda

Deve ser rápida para vendedor com cliente esperando.

## Caixa

A tela /pdv/caixa deve mostrar:
- caixa aberto/fechado
- abrir caixa
- fechar caixa
- sangria
- suprimento
- movimentações
- auditoria
- resumo por forma de pagamento

## Testes

A tela /pdv/testes deve mostrar:
- status da massa
- batch
- gerar massa
- limpar massa
- preview
- avisos de segurança

Dados de teste devem usar:
- is_seed_data
- batch_id

Limpeza nunca pode apagar dado real.

## Código frontend

Antes de alterar public/app.js:
- localizar função existente
- evitar duplicidade
- não criar função paralela sem necessidade
- não deixar listener duplicado
- usar bind idempotente quando necessário

Renderizações devem aceitar:
- null
- undefined
- array vazio
- objeto vazio
- data inválida
- número ausente
- preço ausente

Nunca usar .slice em dado de API sem normalizar com Array.isArray.

## Funções auxiliares

Datas:
- padrão brasileiro
- vazio retorna "-"

Dinheiro:
- formato R$ brasileiro
- vazio retorna R$ 0,00

Arrays:
- normalizar antes de map/slice/filter

Exemplo seguro:
function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  if (value && Array.isArray(value.data)) return value.data;
  if (value && Array.isArray(value.alerts)) return value.alerts;
  return [];
}

## Validação obrigatória

Depois de qualquer alteração, validar parsing de:

- public/app.js
- public/index.html
- public/styles.css, se alterado
- arquivos backend alterados, se houver

Confirmar no relatório:
- arquivos alterados
- funções alteradas
- rotas afetadas
- o que foi testado
- o que ainda depende de teste manual

## Execução local

Comando validado:

cmd /c "subst P: C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado && P: && node server.js"

Se P: já existir:

P:
node server.js

URL:
http://localhost:3000

## Objetivo final

Todo trabalho deve aproximar o sistema de uma AEROSTORE OS:

- CRM como cérebro
- PDV como operação
- dados como inteligência
- visual como marca premium
- experiência simples para loja física
- relatórios como painel do dono
- frente de caixa rápida para vendedor
