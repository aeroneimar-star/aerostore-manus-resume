"use strict";

const assert = require("assert");

const {
  resolveCloudPhoneNumberId,
  resolveCloudBusinessAccountId,
  resolveCloudAccessToken,
  resolveCloudVerifyToken,
  resolveCloudAppSecret,
  resolveCloudAppId,
  resolveCloudBaseUrl,
  resolveCloudApiVersion,
  resolveWhatsAppConfig
} = require("../src/whatsapp/whatsappConfigService");
const { buildMetaCredentialsStatus } = require("../src/whatsapp/metaWebhookUtils");
const { MetaWhatsAppCloudProvider } = require("../src/whatsapp/providers/MetaWhatsAppCloudProvider");

const ALL_ENV_KEYS = [
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
  "WHATSAPP_WABA_ID",
  "WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID",
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_CLOUD_TOKEN",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_CLOUD_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_CLOUD_APP_SECRET",
  "WHATSAPP_APP_ID",
  "WHATSAPP_CLOUD_APP_ID",
  "WHATSAPP_CLOUD_BASE_URL",
  "WHATSAPP_CLOUD_API_VERSION",
  "NOTIFICATION_DRY_RUN",
  "WHATSAPP_CLOUD_ENABLED"
];

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of ALL_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      previous[key] = process.env[key];
      if (overrides[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = overrides[key];
      }
    }
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

function runSyncTests() {
  // 1. Aliases do PHONE_NUMBER_ID
  withEnv({
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: undefined,
    WHATSAPP_PHONE_NUMBER_ID: "1232321649963547"
  }, () => {
    assert.strictEqual(resolveCloudPhoneNumberId(), "1232321649963547");
  });
  withEnv({
    WHATSAPP_PHONE_NUMBER_ID: undefined,
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: "1049655531574423"
  }, () => {
    assert.strictEqual(resolveCloudPhoneNumberId(), "1049655531574423");
  });
  withEnv({
    WHATSAPP_PHONE_NUMBER_ID: "1232321649963547",
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: "1049655531574423"
  }, () => {
    assert.strictEqual(resolveCloudPhoneNumberId(), "1232321649963547", "atalho novo deve prevalecer");
  });

  // 2. Aliases do ACCESS_TOKEN
  withEnv({
    WHATSAPP_CLOUD_TOKEN: undefined,
    WHATSAPP_ACCESS_TOKEN: "EAAtk_alias_test"
  }, () => {
    assert.strictEqual(resolveCloudAccessToken(), "EAAtk_alias_test");
  });

  // 3. Aliases do WABA_ID
  withEnv({
    WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID: undefined,
    WHATSAPP_WABA_ID: "102749609167365"
  }, () => {
    assert.strictEqual(resolveCloudBusinessAccountId(), "102749609167365");
  });
  withEnv({
    WHATSAPP_WABA_ID: undefined,
    WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID: undefined,
    WHATSAPP_BUSINESS_ACCOUNT_ID: "102749609167365"
  }, () => {
    assert.strictEqual(resolveCloudBusinessAccountId(), "102749609167365");
  });

  // 4. Aliases do VERIFY_TOKEN
  withEnv({
    WHATSAPP_CLOUD_VERIFY_TOKEN: undefined,
    WHATSAPP_VERIFY_TOKEN: "aerostore_verify"
  }, () => {
    assert.strictEqual(resolveCloudVerifyToken(), "aerostore_verify");
  });

  // 5. Aliases do APP_SECRET
  withEnv({
    WHATSAPP_CLOUD_APP_SECRET: undefined,
    WHATSAPP_APP_SECRET: "abc_def_secret_test"
  }, () => {
    assert.strictEqual(resolveCloudAppSecret(), "abc_def_secret_test");
  });

  // 6. APP_ID e BASE_URL defaults
  withEnv({
    WHATSAPP_APP_ID: undefined,
    WHATSAPP_CLOUD_APP_ID: undefined
  }, () => {
    assert.strictEqual(resolveCloudAppId(), "");
  });
  withEnv({
    WHATSAPP_CLOUD_BASE_URL: undefined
  }, () => {
    assert.strictEqual(resolveCloudBaseUrl(), "https://graph.facebook.com");
  });
  withEnv({
    WHATSAPP_CLOUD_BASE_URL: "https://graph.facebook.com/"
  }, () => {
    assert.strictEqual(resolveCloudBaseUrl(), "https://graph.facebook.com", "deve remover barra final");
  });

  // 7. API_VERSION default v24.0
  withEnv({
    WHATSAPP_CLOUD_API_VERSION: undefined
  }, () => {
    assert.strictEqual(resolveCloudApiVersion(), "v24.0");
  });
  withEnv({
    WHATSAPP_CLOUD_API_VERSION: "v25.0"
  }, () => {
    assert.strictEqual(resolveCloudApiVersion(), "v25.0");
  });

  console.log("[ok] whatsapp cloud aliases sync tests");
}

function runShapeTests() {
  // 8. Shape do /cloud/status - dry-run ativo
  withEnv({
    WHATSAPP_CLOUD_ENABLED: "false",
    WHATSAPP_PHONE_NUMBER_ID: "1232321649963547",
    WHATSAPP_ACCESS_TOKEN: "FAKE_TOKEN_DO_NOT_LOG_123456",
    WHATSAPP_WABA_ID: "102749609167365",
    NOTIFICATION_DRY_RUN: "true"
  }, () => {
    const status = buildMetaCredentialsStatus();
    assert.strictEqual(typeof status.enabled, "boolean");
    assert.strictEqual(status.enabled, false);
    assert.strictEqual(typeof status.dryRun, "boolean");
    assert.strictEqual(status.dryRun, true);
    assert.strictEqual(typeof status.configured, "boolean");
    assert.strictEqual(status.configured, false);
    assert.strictEqual(typeof status.phoneNumberIdPresent, "boolean");
    assert.strictEqual(status.phoneNumberIdPresent, true);
    assert.strictEqual(typeof status.accessTokenPresent, "boolean");
    assert.strictEqual(status.accessTokenPresent, true);
    assert.strictEqual(typeof status.wabaIdPresent, "boolean");
    assert.strictEqual(status.wabaIdPresent, true);
    assert.strictEqual(status.apiVersion, "v24.0");
    // Token nunca deve aparecer
    const stringified = JSON.stringify(status);
    assert.ok(!stringified.includes("FAKE_TOKEN_DO_NOT_LOG"), "token nao pode vazar no status");
    assert.ok(!stringified.includes("123456"), "trechos do token nao podem vazar");
  });

  // 9. Shape do /cloud/status - tudo configurado
  withEnv({
    WHATSAPP_CLOUD_ENABLED: "true",
    WHATSAPP_PHONE_NUMBER_ID: "1232321649963547",
    WHATSAPP_ACCESS_TOKEN: "FAKE_TOKEN_FULL_ABCD",
    WHATSAPP_WABA_ID: "102749609167365",
    NOTIFICATION_DRY_RUN: "false"
  }, () => {
    const status = buildMetaCredentialsStatus();
    assert.strictEqual(status.enabled, true);
    assert.strictEqual(status.dryRun, false);
    assert.strictEqual(status.configured, true);
    assert.strictEqual(status.phoneNumberIdPresent, true);
    assert.strictEqual(status.accessTokenPresent, true);
    assert.strictEqual(status.wabaIdPresent, true);
    const stringified = JSON.stringify(status);
    assert.ok(!stringified.includes("FAKE_TOKEN_FULL"), "token nao pode vazar quando tudo configurado");
  });

  console.log("[ok] whatsapp cloud status shape tests");
}

function runProviderUrlTest() {
  // 10. URL construida com base URL + api version
  withEnv({
    WHATSAPP_CLOUD_ENABLED: "false",
    WHATSAPP_PHONE_NUMBER_ID: "1232321649963547",
    WHATSAPP_CLOUD_API_VERSION: undefined,
    WHATSAPP_CLOUD_BASE_URL: undefined,
    NOTIFICATION_DRY_RUN: "true"
  }, () => {
    const provider = new MetaWhatsAppCloudProvider({ fetch: () => { throw new Error("fetch nao deve ser chamado em dry-run"); } });
    const config = provider.getConfig({ provider: "meta_cloud", storeId: "vila" });
    const url = provider.getMessagesUrl(config);
    assert.strictEqual(url, "https://graph.facebook.com/v24.0/1232321649963547/messages");
  });

  // 11. Base URL custom
  withEnv({
    WHATSAPP_CLOUD_ENABLED: "false",
    WHATSAPP_PHONE_NUMBER_ID: "1232321649963547",
    WHATSAPP_CLOUD_API_VERSION: "v23.0",
    WHATSAPP_CLOUD_BASE_URL: "https://graph.facebook.com",
    NOTIFICATION_DRY_RUN: "true"
  }, () => {
    const provider = new MetaWhatsAppCloudProvider({ fetch: () => { throw new Error("fetch nao deve ser chamado em dry-run"); } });
    const config = provider.getConfig({ provider: "meta_cloud", storeId: "vila" });
    const url = provider.getMessagesUrl(config);
    assert.strictEqual(url, "https://graph.facebook.com/v23.0/1232321649963547/messages");
  });

  console.log("[ok] whatsapp cloud provider url tests");
}

function runConfigResolverTest() {
  // 12. resolveWhatsAppConfig deve propagar aliases sem remover campos legados
  withEnv({
    WHATSAPP_CLOUD_TOKEN: undefined,
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: undefined,
    WHATSAPP_PHONE_NUMBER_ID: "1232321649963547",
    WHATSAPP_ACCESS_TOKEN: "FAKE_FULL_TOKEN_TEST",
    WHATSAPP_WABA_ID: "102749609167365",
    WHATSAPP_VERIFY_TOKEN: "aerostore_verify",
    WHATSAPP_APP_SECRET: "abc_def_secret",
    WHATSAPP_CLOUD_API_VERSION: undefined,
    WHATSAPP_CLOUD_BASE_URL: undefined,
    NOTIFICATION_DRY_RUN: "true"
  }, () => {
    const config = resolveWhatsAppConfig({ provider: "meta_cloud", storeId: "vila" });
    assert.strictEqual(config.phoneNumberId, "1232321649963547");
    assert.strictEqual(config.businessAccountId, "102749609167365");
    assert.strictEqual(config.token, "FAKE_FULL_TOKEN_TEST");
    assert.strictEqual(config.verifyToken, "aerostore_verify");
    assert.strictEqual(config.appSecret, "abc_def_secret");
    assert.strictEqual(config.apiVersion, "v24.0");
    assert.strictEqual(config.baseUrl, "https://graph.facebook.com");
  });

  console.log("[ok] whatsapp cloud resolveWhatsAppConfig tests");
}

function main() {
  runSyncTests();
  runShapeTests();
  runProviderUrlTest();
  runConfigResolverTest();
  console.log("whatsapp_cloud_aliases_test: OK");
}

main();