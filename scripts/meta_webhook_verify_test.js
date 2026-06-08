"use strict";

const assert = require("assert");

const {
  verifyMetaWebhookChallenge,
  buildMetaCredentialsStatus
} = require("../src/whatsapp/metaWebhookUtils");

function runVerifyTests() {
  const verifyToken = "TOKEN_TESTE_SUPER_SECRETO";

  const success = verifyMetaWebhookChallenge({
    query: {
      "hub.mode": "subscribe",
      "hub.verify_token": verifyToken,
      "hub.challenge": "123456"
    },
    expectedVerifyToken: verifyToken
  });
  assert.strictEqual(success.ok, true);
  assert.strictEqual(success.status, 200);
  assert.strictEqual(success.body, "123456");
  assert.strictEqual(success.safeLog.verifyTokenMatch, true);
  assert.strictEqual(success.safeLog.hasChallenge, true);
  assert.ok(!JSON.stringify(success).includes(verifyToken));

  const wrongToken = verifyMetaWebhookChallenge({
    query: {
      "hub.mode": "subscribe",
      "hub.verify_token": "TOKEN_ERRADO",
      "hub.challenge": "123456"
    },
    expectedVerifyToken: verifyToken
  });
  assert.strictEqual(wrongToken.ok, false);
  assert.strictEqual(wrongToken.status, 403);
  assert.ok(!JSON.stringify(wrongToken).includes(verifyToken));
  assert.ok(!JSON.stringify(wrongToken).includes("TOKEN_ERRADO"));

  const wrongMode = verifyMetaWebhookChallenge({
    query: {
      "hub.mode": "unsubscribe",
      "hub.verify_token": verifyToken,
      "hub.challenge": "123456"
    },
    expectedVerifyToken: verifyToken
  });
  assert.strictEqual(wrongMode.ok, false);
  assert.strictEqual(wrongMode.status, 403);

  const missingChallenge = verifyMetaWebhookChallenge({
    query: {
      "hub.mode": "subscribe",
      "hub.verify_token": verifyToken
    },
    expectedVerifyToken: verifyToken
  });
  assert.strictEqual(missingChallenge.ok, false);
  assert.strictEqual(missingChallenge.status, 403);
  assert.strictEqual(missingChallenge.safeLog.hasChallenge, false);
}

function runCredentialStatusTests() {
  const status = buildMetaCredentialsStatus({
    token: "TOKEN_REAL_NAO_VAZA",
    phoneNumberId: "123456789",
    businessAccountId: "987654321",
    verifyToken: "VERIFY_REAL_NAO_VAZA",
    appSecret: "APP_SECRET_REAL_NAO_VAZA",
    notificationDryRun: "true",
    cloudEnabled: "false"
  });
  assert.strictEqual(status.provider, "meta_cloud");
  assert.strictEqual(status.hasToken, true);
  assert.strictEqual(status.hasPhoneNumberId, true);
  assert.strictEqual(status.hasBusinessAccountId, true);
  assert.strictEqual(status.hasVerifyToken, true);
  assert.strictEqual(status.hasAppSecret, true);
  assert.strictEqual(status.phoneNumberIdMasked, "***6789");
  assert.strictEqual(status.businessAccountIdMasked, "***4321");
  assert.strictEqual(status.dryRun, true);
  assert.strictEqual(status.cloudEnabled, false);
  assert.strictEqual(status.canSendRealMessage, false);
  assert.ok(!JSON.stringify(status).includes("TOKEN_REAL_NAO_VAZA"));
  assert.ok(!JSON.stringify(status).includes("VERIFY_REAL_NAO_VAZA"));
  assert.ok(!JSON.stringify(status).includes("APP_SECRET_REAL_NAO_VAZA"));
  assert.ok(!JSON.stringify(status).includes("123456789"));
  assert.ok(!JSON.stringify(status).includes("987654321"));
}

runVerifyTests();
runCredentialStatusTests();
console.log("meta_webhook_verify_test: OK");
