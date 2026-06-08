# WhatsApp Meta Cloud API - setup local seguro

Este guia prepara validacao local da Meta WhatsApp Cloud API no AEROSTORE sem envio real.

## Regras desta etapa

- Nunca commitar `.env` ou `.env.local`.
- Manter `NOTIFICATION_DRY_RUN=true`.
- Manter `WHATSAPP_CLOUD_ENABLED=false`.
- Nao colocar token, app secret ou verify token em logs, prints ou tickets.
- Nao salvar secrets no banco.
- Nao ativar IA inbound.
- Nao iniciar WhatsApp Web durante testes Meta: use `WHATSAPP_WEB_ENABLED=false`.

## Envs locais

Preencha somente em arquivo local nao versionado:

```env
WHATSAPP_PROVIDER=meta_cloud
WHATSAPP_WEB_ENABLED=false
WHATSAPP_CLOUD_ENABLED=false
WHATSAPP_CLOUD_API_VERSION=v20.0
WHATSAPP_CLOUD_TOKEN=
WHATSAPP_CLOUD_PHONE_NUMBER_ID=
WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID=
WHATSAPP_CLOUD_VERIFY_TOKEN=
WHATSAPP_CLOUD_APP_SECRET=
NOTIFICATION_DRY_RUN=true
PORT=3000
```

## Validar credenciais sem vazar secrets

Com o servidor local em `http://localhost:3000`, faca login e consulte:

```txt
GET /api/whatsapp-provider/meta-credentials/status
```

A resposta deve mostrar apenas booleanos e IDs mascarados:

```json
{
  "provider": "meta_cloud",
  "hasToken": true,
  "hasPhoneNumberId": true,
  "hasBusinessAccountId": true,
  "hasVerifyToken": true,
  "hasAppSecret": true,
  "phoneNumberIdMasked": "***0000",
  "businessAccountIdMasked": "***0000",
  "dryRun": true,
  "cloudEnabled": false,
  "canSendRealMessage": false
}
```

`canSendRealMessage` deve continuar `false` nesta etapa.

## Validar webhook verify localmente

Sem URL publica, rode:

```bat
node scripts\meta_webhook_verify_test.js
```

Para testar HTTP local:

```txt
GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=SEU_VERIFY_TOKEN_LOCAL&hub.challenge=123456
```

Resposta esperada quando o token local bate:

```txt
123456
```

Com token errado, a resposta deve ser `403 Forbidden`.

## Etapa futura com tunel

Quando for expor para a Meta, use um tunel local temporario e configure a URL publica no painel da Meta. Antes disso:

- confirme `NOTIFICATION_DRY_RUN=true`;
- confirme `WHATSAPP_CLOUD_ENABLED=false`;
- confirme que logs mostram apenas `verifyTokenMatch`, `hasChallenge` e IDs mascarados;
- nunca cole token real em prompt, log, documento ou commit.
