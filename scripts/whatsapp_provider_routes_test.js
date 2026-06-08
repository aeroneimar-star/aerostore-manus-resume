"use strict";

const assert = require("assert");

const { resolveWhatsAppConfig } = require("../src/whatsapp/whatsappConfigService");
const { createWhatsAppProviderRegistry } = require("../src/whatsapp/WhatsAppProviderRegistry");
const { MetaWhatsAppCloudProvider } = require("../src/whatsapp/providers/MetaWhatsAppCloudProvider");
const { normalizeMetaWebhookPayload } = require("../src/whatsapp/metaWebhookUtils");

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

async function run() {
  withEnv({
    WHATSAPP_PROVIDER: undefined,
    NOTIFICATION_DRY_RUN: "true"
  }, () => {
    const config = resolveWhatsAppConfig({ storeId: "vila" });
    assert.strictEqual(config.provider, "web");
    assert.strictEqual(config.storeId, "vila");
  });

  await withEnv({
    WHATSAPP_PROVIDER: "meta_cloud",
    WHATSAPP_CLOUD_ENABLED: "false",
    WHATSAPP_CLOUD_TOKEN: "",
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: "",
    NOTIFICATION_DRY_RUN: "true"
  }, async () => {
    let realFetchCalled = false;
    const provider = new MetaWhatsAppCloudProvider({
      fetch: async () => {
        realFetchCalled = true;
        throw new Error("fetch real nao deveria ser chamado em dry-run");
      }
    });
    const registry = createWhatsAppProviderRegistry({ metaProvider: provider });
    const selected = registry.getProvider({ provider: "meta_cloud" });
    assert.strictEqual(selected.provider, "meta_cloud");

    const textResult = await registry.sendText({ provider: "meta_cloud", storeId: "vila" }, {
      to: "5516999999999",
      message: "Mensagem privada de teste AEROSTORE"
    });
    assert.strictEqual(textResult.status, "dry_run");
    assert.strictEqual(textResult.toMasked, "***9999");
    assert.strictEqual(realFetchCalled, false);
    assert.ok(!JSON.stringify(textResult).includes("Mensagem privada"));

    const templateResult = await registry.sendTemplate({ provider: "meta_cloud", storeId: "vila" }, {
      to: "5516999999999",
      templateName: "cashback_notificacao",
      languageCode: "pt_BR",
      components: []
    });
    assert.strictEqual(templateResult.status, "dry_run");
    assert.strictEqual(templateResult.payloadSummary.template.name, "cashback_notificacao");
    assert.strictEqual(realFetchCalled, false);
  });

  const completeFakeMessage = "Mensagem fake completa para teste";
  const payload = {
    entry: [{
      changes: [{
        value: {
          metadata: {
            phone_number_id: "123456789",
            display_phone_number: "551633331111"
          },
          contacts: [{ wa_id: "5516999999999", profile: { name: "Cliente Teste" } }],
          messages: [{
            id: "wamid.fake",
            from: "5516999999999",
            timestamp: "1710000000",
            type: "text",
            text: { body: completeFakeMessage }
          }],
          statuses: [{
            id: "wamid.status",
            status: "delivered",
            recipient_id: "5516999999999",
            timestamp: "1710000010"
          }]
        }
      }]
    }]
  };
  const normalized = normalizeMetaWebhookPayload(payload);
  assert.strictEqual(normalized.messages.length, 1);
  assert.strictEqual(normalized.statuses.length, 1);
  assert.strictEqual(normalized.messages[0].fromMasked, "***9999");
  assert.strictEqual(normalized.statuses[0].recipientMasked, "***9999");
  assert.strictEqual(normalized.messages[0].hasText, true);
  assert.strictEqual(normalized.messages[0].textLength, completeFakeMessage.length);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(normalized.messages[0], "textPreview"), false);
  assert.ok(!JSON.stringify(normalized.messages).includes(completeFakeMessage));
  assert.ok(!JSON.stringify(normalized.safeSummary).includes("Mensagem fake"));

  console.log("whatsapp_provider_routes_test: OK");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
