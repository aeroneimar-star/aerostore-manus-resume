"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dbFile = path.join(os.tmpdir(), `aerostore-whatsapp-store-config-${Date.now()}.sqlite`);
process.env.DATABASE_PATH = dbFile;

const {
  ensureWhatsAppStoreConfigTable,
  seedDefaultWhatsAppStoreConfigs,
  listWhatsAppStoreConfigs,
  getWhatsAppStoreConfig,
  updateWhatsAppStoreConfig,
  resolveOperationalWhatsAppConfig
} = require("../src/whatsapp/whatsappStoreConfigService");
const { createWhatsAppProviderRegistry } = require("../src/whatsapp/WhatsAppProviderRegistry");
const { MetaWhatsAppCloudProvider } = require("../src/whatsapp/providers/MetaWhatsAppCloudProvider");

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
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(overrides)) {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      }
    });
}

async function run() {
  await ensureWhatsAppStoreConfigTable();
  await seedDefaultWhatsAppStoreConfigs();

  const stores = await listWhatsAppStoreConfigs();
  assert.deepStrictEqual(stores.map((item) => item.store_id).sort(), ["botanico", "sul", "vila"]);
  for (const store of stores) {
    assert.strictEqual(store.provider, "web");
    assert.strictEqual(store.enabled, false);
    assert.strictEqual(store.dryRun, true);
    assert.strictEqual(store.hasToken, false);
    assert.strictEqual(store.hasAppSecret, false);
    assert.strictEqual(store.hasVerifyToken, false);
    assert.ok(!JSON.stringify(store).includes("secret"));
    assert.ok(!JSON.stringify(store).includes("token_real"));
  }

  await assert.rejects(
    () => updateWhatsAppStoreConfig("vila", { provider: "telegram" }),
    /Provider WhatsApp invalido/
  );

  const updated = await updateWhatsAppStoreConfig("vila", {
    provider: "meta_cloud",
    enabled: true,
    dry_run: true,
    display_name: "Vila Meta Mock",
    phone_number_id: "123456789",
    business_account_id: "987654321",
    templates_json: { language: "pt_BR", cashback: "cashback_vila" },
    token: "token_real_nao_deve_ser_aceito",
    app_secret: "app_secret_real_nao_deve_ser_aceito",
    verify_token: "verify_token_real_nao_deve_ser_aceito"
  });
  assert.strictEqual(updated.provider, "meta_cloud");
  assert.strictEqual(updated.enabled, true);
  assert.strictEqual(updated.dryRun, true);
  assert.strictEqual(updated.phoneNumberIdMasked, "***6789");
  assert.strictEqual(updated.businessAccountIdMasked, "***4321");
  assert.strictEqual(updated.hasToken, false);
  assert.strictEqual(updated.hasAppSecret, false);
  assert.strictEqual(updated.hasVerifyToken, false);
  assert.ok(!JSON.stringify(updated).includes("token_real_nao_deve_ser_aceito"));
  assert.ok(!JSON.stringify(updated).includes("app_secret_real_nao_deve_ser_aceito"));
  assert.ok(!JSON.stringify(updated).includes("verify_token_real_nao_deve_ser_aceito"));

  await withEnv({
    WHATSAPP_PROVIDER: "web",
    WHATSAPP_CLOUD_ENABLED: "false",
    WHATSAPP_CLOUD_TOKEN: "env_token_must_not_leak",
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: "555555555",
    WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID: "444444444",
    NOTIFICATION_DRY_RUN: "true"
  }, async () => {
    const vilaConfig = await resolveOperationalWhatsAppConfig({ storeId: "vila" });
    assert.strictEqual(vilaConfig.provider, "meta_cloud");
    assert.strictEqual(vilaConfig.enabled, true);
    assert.strictEqual(vilaConfig.dryRun, true);
    assert.strictEqual(vilaConfig.phoneNumberId, "123456789");
    assert.strictEqual(vilaConfig.businessAccountId, "987654321");
    assert.strictEqual(vilaConfig.templates.cashback, "cashback_vila");
    assert.strictEqual(vilaConfig.token, "");

    const fallbackConfig = await resolveOperationalWhatsAppConfig({ storeId: "loja_sem_config" });
    assert.strictEqual(fallbackConfig.provider, "web");
    assert.strictEqual(fallbackConfig.phoneNumberId, "555555555");

    let realFetchCalled = false;
    const provider = new MetaWhatsAppCloudProvider({
      fetch: async () => {
        realFetchCalled = true;
        throw new Error("Meta real nao deveria ser chamada em dry-run");
      }
    });
    const registry = createWhatsAppProviderRegistry({ metaProvider: provider });
    const status = registry.getStatus(vilaConfig);
    assert.strictEqual(status.status, "dry_run");
    assert.strictEqual(status.enabled, true);
    assert.strictEqual(status.dryRun, true);
    const result = await registry.sendText(vilaConfig, {
      to: "5516999999999",
      message: "Mensagem privada nao deve vazar"
    });
    assert.strictEqual(result.status, "dry_run");
    assert.strictEqual(realFetchCalled, false);
    assert.ok(!JSON.stringify(result).includes("Mensagem privada"));
  });

  const botanico = await getWhatsAppStoreConfig("Botânico");
  assert.strictEqual(botanico.store_id, "botanico");
  assert.ok(botanico.display_name);

  console.log("whatsapp_store_config_test: OK");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    } catch (error) {
      // Arquivo temporario pode permanecer se o SQLite ainda estiver finalizando.
    }
  });
