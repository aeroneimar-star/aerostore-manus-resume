# DISCOVERY WHATSAPP MOTOR — STAGE 10.0A

## Status
Concluído em `2026-05-11` antes de qualquer implementação da autorização gerencial da Stage 10.0A.

## Escopo desta discovery
Mapear, com evidência do código, o motor oficial de WhatsApp já existente no CRM/PDV AEROSTORE e os blocos já prontos de autorização/PIN para não criar fluxo paralelo na Stage 10.0A.

## 1. Motor oficial de WhatsApp identificado
O motor oficial atual do CRM é `whatsapp-web.js` com sessão local persistida por `LocalAuth`.

Evidências:
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\package.json](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\package.json)
  - dependência: `whatsapp-web.js`
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js)
  - import: `const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');`
  - boot do cliente em `initializeWhatsAppClient()`
- diretórios locais usados pelo motor:
  - `.wwebjs_auth`
  - `.wwebjs_cache`

Conclusão:
- não existe evidência de Z-API, Cloud API oficial da Meta ou outro provedor externo como motor principal atual
- o envio oficial hoje depende do cliente local conectado ao WhatsApp Web

## 2. Estado e ciclo de vida do motor
O estado do WhatsApp fica centralizado em `whatsappState` no backend.

Campos principais:
- `status`
- `qrBase64`
- `lastQrRaw`
- `connectedNumber`
- `lastConnectedAt`
- `lastError`

Evidências:
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js)
  - `let whatsappClient = null;`
  - `let whatsappState = { ... }`
  - `initializeWhatsAppClient()`
  - eventos:
    - `whatsappClient.on('qr', ...)`
    - `whatsappClient.on('ready', ...)`
    - `whatsappClient.on('message', ...)`
    - `whatsappClient.on('disconnected', ...)`

## 3. Endpoints oficiais do motor WhatsApp
Endpoints identificados:

Admin/status:
- `GET /api/whatsapp/status`
- `GET /api/whatsapp/qr`
- `POST /api/whatsapp/reinitialize`
- `POST /api/whatsapp/disconnect`
- `POST /api/whatsapp/reset-session`

Envio:
- `POST /api/whatsapp/send`
- `POST /api/whatsapp/send-bulk`
- `POST /api/whatsapp/send-media`

Evidência:
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js)

## 4. Funções oficiais de envio
Funções principais de envio identificadas:

Texto:
- `sendWhatsAppTextMessage(phone, message, options = {})`
- `sendAutomatedMessage(phone, message)`
- `sendWhatsAppTextToChatId(chatId, message, options = {})`

Mídia:
- `sendAutomatedMediaMessage({ phone, media, caption, sendType })`
- `sendProductMediaSequenceToChatId(...)`
- `sendAiProductSuggestionToWhatsApp(...)`
- `sendAiProductSuggestionToChatId(...)`

Resolução de destino:
- `formatWhatsAppNumber(phone)`
- `resolveWhatsAppDestination(phone, options = {})`
- `normalizeWhatsAppSendError(...)`

Evidência:
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js)

Conclusão:
- o envio passa por `resolveWhatsAppDestination(...)`
- o backend usa `whatsappClient.getNumberId(...)` e `whatsappClient.sendMessage(...)`
- o motor já trata texto e mídia

## 5. Onde o CRM registra logs de mensagem
O log principal de mensagens da IA/WhatsApp fica em `ai_message_logs`.

Campos importantes encontrados:
- `phone`
- `phone_original`
- `inbound_chat_id`
- `sender_user_id`
- `customer_name`
- `customer_message`
- `direction`
- `source`
- `connected_number`
- `message_text`
- `intent`
- `needs_human`
- `auto_sent`
- `product_id`
- `media_id`
- `status`
- `error_message`
- `whatsapp_message_id`
- `debug_context`

Evidências:
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\db.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\db.js)
  - criação e `ensureColumn(...)` da tabela `ai_message_logs`
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js)
  - função `createAiMessageLog(...)`

## 6. Onde o CRM guarda estado/histórico recente da conversa
O estado curto da conversa fica em `ai_conversation_state`.

Campos importantes:
- `chat_id`
- `phone`
- `contact_id`
- `customer_name`
- `stage`
- `last_intent`
- `desired_product`
- `desired_category`
- `desired_color`
- `desired_size`
- `desired_gender`
- `desired_style`
- `last_question`
- `suggested_product_id`
- `suggested_product_ids`
- `photos_sent_count`
- `waiting_for`
- `last_customer_message`
- `last_ai_response`

Evidências:
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\db.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\db.js)
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js)
  - `getAiConversationState(...)`
  - `upsertAiConversationState(...)`
  - `getRecentConversationHistory(...)`
  - `handleInboundAiWhatsAppMessage(...)`

## 7. Fluxo inbound/outbound já existente
O CRM já tem um fluxo de conversa inbound com IA e resposta assistida.

Evidências:
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js)
  - `resolveInboundSender(...)`
  - `handleInboundAiWhatsAppMessage(...)`
  - `buildInboundAiConversationReply(...)`
  - `validateConversationalDecision(...)`
  - `searchConversationProducts(...)`
  - `extractConversationProductLookupCandidates(...)`
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\services\openaiService.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\services\openaiService.js)
  - prompt/sistema da IA conversacional

Conclusão:
- o motor de WhatsApp e o motor de IA já se conversam
- isso reforça a necessidade de não criar provedor paralelo na 10.0A

## 8. Sistema de PIN atual já existente
Existem dois blocos de PIN/autorização já prontos no projeto:

### 8.1 PIN do cashback por WhatsApp
Existe um fluxo completo de PIN de cashback, com geração, hash, expiração, validação, reenvio e envio via WhatsApp.

Evidências:
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js)
  - `randomPin()`
  - `hashCashbackPin(pin)`
  - `compareCashbackPin(...)`
  - `createAndSendCashbackPin(...)`
  - `validateCashbackPinForCashbackId(...)`
  - uso de `sendWhatsAppTextMessage(...)`
- rotas:
  - `POST /api/cashbacks/wizard/pin`
  - `POST /api/cashbacks/wizard/send-pin`
  - `POST /api/cashback/:id/validate-pin`
  - `POST /api/cashback/:id/resend-pin`
  - `POST /api/cashback/:id/cancel-pin`
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\db.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\db.js)
  - tabela `cashback_pin_tokens`
  - tabela `cashback_events`

### 8.2 PIN gerencial do PDV
Já existe um sistema de autorização gerencial do PDV separado do cashback.

Evidências:
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\modules\pdv\services\pdvControlService.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\modules\pdv\services\pdvControlService.js)
  - `issueAuthorizationPin(payload, user)`
  - `validateAuthorizationPin({ code, type, loja, context }, user)`
  - `validateSaleControls({ saleContext, authorization }, user)`

## 9. Tipos de autorização gerencial já suportados
O backend do PDV já suporta estes tipos:
- `DISCOUNT_OVERRIDE`
- `PERMUTA_APPROVAL`
- `SALE_CANCELLATION`
- `CASHBACK_ADJUSTMENT`
- `REOPEN_CASH_REGISTER`
- `REOPEN_SALE`

Evidência:
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\modules\pdv\services\pdvControlService.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\modules\pdv\services\pdvControlService.js)

Conclusão:
- o primeiro fluxo real da Stage 10.0A, `discount_override`, já existe no backend e deve ser reaproveitado

## 10. Regras atuais do `discount_override`
O backend do PDV já faz a validação real do desconto acima do limite.

Regras encontradas:
- limite padrão: `10%`
- se todos os itens da venda forem `premium`, limite sobe para `20%`
- acima do limite exige:
  - `authorization.pin`
  - `authorization.reason`
- motivos válidos:
  - `QUEIMA`
  - `CLIENTE_VIP`
  - `PECA_PARADA`
  - `DEFEITO`
  - `NEGOCIACAO`
  - `ACAO_GERENTE`
  - `OUTRO`

Evidências:
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\modules\pdv\services\pdvControlService.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\modules\pdv\services\pdvControlService.js)
  - `getDiscountLimitForSale(...)`
  - `validateSaleControls(...)`
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\modules\pdv\sales\pdvSalesService.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\modules\pdv\sales\pdvSalesService.js)
  - `finalizeSaleFromSession(...)` envia `authorization_pin` e `authorization_reason`

## 11. Roles e permissões identificados
Roles encontrados:
- `admin`
- `gerente`
- `vendedor`

Evidências:
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\db.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\db.js)
  - seeds de usuários
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js)
  - `isAdmin(user)`
  - `isManager(user)`
  - `requireAdmin(...)`
  - `requireManager(...)`
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\modules\pdv\services\pdvControlService.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\modules\pdv\services\pdvControlService.js)
  - `getPdvUserRole(user)`
  - `requireMinimumRole(user, role)`

Conclusão:
- somente `GERENTE` e `ADMIN` podem emitir PIN de autorização do PDV
- o backend já protege essa emissão

## 12. Audit logs existentes
Existem trilhas de auditoria já prontas para a parte gerencial do PDV.

Arquivos:
- `data/pdv/control/authorization-pins.json`
- `data/pdv/control/audit-logs.json`

Evidências:
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\modules\pdv\services\pdvControlService.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\modules\pdv\services\pdvControlService.js)
  - `appendAuditLog(...)`
  - `PIN_ISSUED`
  - `PIN_USED`
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\modules\pdv\routes\pdvControlRoutes.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\modules\pdv\routes\pdvControlRoutes.js)
  - `GET /api/pdv/control/audit`

Conclusão:
- a Stage 10.0A não precisa criar nova base de auditoria para `discount_override`

## 13. Frontend já existente para o PDV
O frontend já possui:
- painel de controle do caixa com emissão manual de PIN temporário
- campos de desconto, PIN e motivo dentro do fluxo da venda

Evidências:
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\public\index.html](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\public\index.html)
  - `#pdv-issue-pin-form`
  - `#pdv-pin-type`
  - `#pdv-sale-authorization-pin`
  - `#pdv-sale-authorization-reason`
  - drawer da venda com `PIN desconto` e `Motivo desconto`
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\public\app.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\public\app.js)
  - `issuePdvAuthorizationPin(...)`
  - `renderPdvSalesSummary()`

Conclusão:
- o backend do fluxo já está pronto
- o gap principal da 10.0A está em deixar o fluxo de `discount_override` claro, seguro e operacional no frontend, sem duplicar a autorização

## 14. URL pública para links de aprovação
Não encontrei configuração atual de URL pública para links gerenciais de aprovação.

Evidências:
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\.env.example](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\.env.example)
  - não há base URL pública para aprovação gerencial
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\server.js)
  - há `TERMS_LINK`, mas não há link público de aprovação gerencial

Conclusão:
- a infraestrutura atual é centrada em PIN/token e sessão local
- links públicos de aprovação não devem ser assumidos nesta stage

## 15. Limitações locais identificadas
- o motor depende de sessão local do WhatsApp Web
- há evidência de falha local por restrição de rede ao inicializar WhatsApp em alguns logs de ambiente
- não existe base URL pública configurada para aprovações externas
- o fluxo atual de envio é estável, mas explicitamente sensível a refatorações grandes

Evidências:
- [C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\STATUS-ESTAVEL-WHATSAPP.md](C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado\STATUS-ESTAVEL-WHATSAPP.md)
- logs em `data/server-*.log` com `ERR_NETWORK_ACCESS_DENIED` para `https://web.whatsapp.com/`

## 16. Recomendação obrigatória para a Parte 2 da Stage 10.0A
Não criar um novo sistema de autorização gerencial.

Recomendação segura:
1. reaproveitar `issueAuthorizationPin(...)`
2. reaproveitar `validateAuthorizationPin(...)`
3. reaproveitar `validateSaleControls(...)`
4. melhorar o frontend do fluxo de `discount_override`
5. manter auditoria em `authorization-pins.json` e `audit-logs.json`

## 17. Decisão operacional desta discovery
A Stage 10.0A Parte 2 deve:
- usar o motor oficial de WhatsApp já existente
- não trocar provedor
- não criar base paralela de PIN/autorização
- começar pelo fluxo real de `DISCOUNT_OVERRIDE` usando a base do PDV já pronta

