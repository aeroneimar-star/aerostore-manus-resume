"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPaymentContext, PaymentContextError } = require("../PaymentContext");
const { createPaymentPolicy } = require("../PaymentPolicy");
const { createPaymentOrchestrator } = require("../PaymentOrchestrator");
const { createFakePaymentProvider, SCENARIOS } = require("../providers/fakePaymentProvider");

// ============ PaymentContext ============

test("1. PaymentContext: creates with all required fields", () => {
  const ctx = createPaymentContext({
    orderId: "order-1",
    paymentId: "pay-1",
    accountId: "acc-1",
    channel: "MOBILE_APP",
    provider: "mock"
  });
  assert.equal(ctx.orderId, "order-1");
  assert.equal(ctx.paymentId, "pay-1");
  assert.equal(ctx.accountId, "acc-1");
  assert.equal(ctx.channel, "MOBILE_APP");
  assert.equal(ctx.provider, "mock");
  assert.ok(ctx.correlationId);
  assert.ok(ctx.idempotencyKey);
});

test("2. PaymentContext: throws on missing accountId", () => {
  assert.throws(
    () => createPaymentContext({ orderId: "o1" }),
    (err) => err.code === "ACCOUNT_ID_REQUIRED"
  );
});

test("3. PaymentContext: extend creates new context with merged fields", () => {
  const ctx = createPaymentContext({
    orderId: "order-1",
    paymentId: "pay-1",
    accountId: "acc-1",
    channel: "MOBILE_APP",
    provider: "mock"
  });
  const extended = ctx.extend({ provider: "infinitepay" });
  assert.equal(extended.accountId, "acc-1");
  assert.equal(extended.provider, "infinitepay");
  assert.equal(extended.correlationId, ctx.correlationId);
});

test("4. PaymentContext: toLogEntry returns structured log", () => {
  const ctx = createPaymentContext({
    orderId: "order-1",
    accountId: "acc-1",
    channel: "WEB"
  });
  const log = ctx.toLogEntry();
  assert.ok(log.correlationId);
  assert.equal(log.orderId, "order-1");
  assert.equal(log.channel, "WEB");
  assert.ok(log.timestamp);
});

test("5. PaymentContext: getOrderId throws when orderId is null", () => {
  const ctx = createPaymentContext({ accountId: "acc-1" });
  assert.throws(() => ctx.getOrderId(), (err) => err.code === "ORDER_ID_REQUIRED");
});

test("6. PaymentContext: getPaymentId throws when paymentId is null", () => {
  const ctx = createPaymentContext({ accountId: "acc-1" });
  assert.throws(() => ctx.getPaymentId(), (err) => err.code === "PAYMENT_ID_REQUIRED");
});

// ============ PaymentPolicy ============

test("7. PaymentPolicy: isValidAmount within range", () => {
  const policy = createPaymentPolicy();
  assert.ok(policy.isValidAmount(100));
  assert.ok(policy.isValidAmount(10000));
  assert.ok(policy.isValidAmount(50000000));
});

test("8. PaymentPolicy: isValidAmount rejects below minimum", () => {
  const policy = createPaymentPolicy();
  assert.equal(policy.isValidAmount(99), false);
  assert.equal(policy.isValidAmount(0), false);
});

test("9. PaymentPolicy: isValidAmount rejects above maximum", () => {
  const policy = createPaymentPolicy();
  assert.equal(policy.isValidAmount(50000001), false);
});

test("10. PaymentPolicy: canRetry within limit", () => {
  const policy = createPaymentPolicy();
  assert.ok(policy.canRetry(0));
  assert.ok(policy.canRetry(4));
  assert.equal(policy.canRetry(5), false);
  assert.equal(policy.canRetry(10), false);
});

test("11. PaymentPolicy: getMaxRetries returns configured value", () => {
  const policy = createPaymentPolicy();
  assert.equal(policy.getMaxRetries(), 5);
});

test("12. PaymentPolicy: isValidCancellationReason", () => {
  const policy = createPaymentPolicy();
  assert.ok(policy.isValidCancellationReason("CUSTOMER_CANCELLED"));
  assert.ok(policy.isValidCancellationReason("PAYMENT_FAILED"));
  assert.equal(policy.isValidCancellationReason("UNKNOWN_REASON"), false);
});

test("13. PaymentPolicy: getRetryDelayMs increases exponentially", () => {
  const policy = createPaymentPolicy();
  const delay1 = policy.getRetryDelayMs(1);
  const delay2 = policy.getRetryDelayMs(2);
  const delay3 = policy.getRetryDelayMs(3);
  assert.ok(delay2 > delay1);
  assert.ok(delay3 > delay2);
  assert.ok(delay3 <= 30000);
});

test("14. PaymentPolicy: isExpired returns true after timeout", () => {
  const policy = createPaymentPolicy({ paymentTimeoutMs: 1000 });
  assert.equal(policy.isExpired(new Date(Date.now() - 2000).toISOString()), true);
  assert.equal(policy.isExpired(new Date(Date.now() - 500).toISOString()), false);
});

test("15. PaymentPolicy: isQrCodeExpired returns true after QR expiry", () => {
  const policy = createPaymentPolicy({ qrCodeExpiryMs: 1000 });
  assert.equal(policy.isQrCodeExpired(new Date(Date.now() - 2000).toISOString()), true);
  assert.equal(policy.isQrCodeExpired(new Date().toISOString()), false);
});

test("16. PaymentPolicy: custom overrides work", () => {
  const policy = createPaymentPolicy({
    maxAttempts: 10,
    paymentTimeoutMs: 60000
  });
  assert.equal(policy.getMaxRetries(), 10);
  assert.ok(policy.canRetry(8));
  assert.equal(policy.canRetry(10), false);
});

// ============ PaymentOrchestrator ============

test("17. PaymentOrchestrator: registers and lists providers", () => {
  const orchestrator = createPaymentOrchestrator();
  const fake = createFakePaymentProvider();
  orchestrator.registerProvider("fake", fake);
  const list = orchestrator.listProviders();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "fake");
});

test("18. PaymentOrchestrator: selectStrategy with preferred provider", async () => {
  const orchestrator = createPaymentOrchestrator({ defaultProvider: "mock" });
  const fake = createFakePaymentProvider();
  orchestrator.registerProvider("fake", fake);
  const ctx = createPaymentContext({
    orderId: "o1",
    accountId: "acc-1",
    provider: "fake"
  });
  const result = await orchestrator.selectStrategy(ctx);
  assert.equal(result.providerName, "fake");
  assert.equal(result.strategy, "SELECTED");
});

test("19. PaymentOrchestrator: selectStrategy falls back to default when no provider specified", async () => {
  const orchestrator = createPaymentOrchestrator({ defaultProvider: "fake" });
  const fake = createFakePaymentProvider();
  orchestrator.registerProvider("fake", fake);
  // Create context without specifying a provider
  const ctx = createPaymentContext({
    orderId: "o1",
    accountId: "acc-1",
    provider: undefined
  });
  // Override the context to not have a provider set
  const ctxNoProvider = { ...ctx, provider: null };
  const result = await orchestrator.selectStrategy({ ...ctx, provider: null });
  assert.equal(result.providerName, "fake");
  assert.equal(result.strategy, "DEFAULT");
});

test("20. PaymentOrchestrator: throws on unregistered provider", () => {
  const orchestrator = createPaymentOrchestrator();
  assert.throws(
    () => orchestrator.getProvider("nonexistent"),
    /PROVIDER_NOT_REGISTERED/
  );
});

test("21. PaymentOrchestrator: throws on invalid provider interface", () => {
  const orchestrator = createPaymentOrchestrator();
  assert.throws(
    () => orchestrator.registerProvider("bad", { name: "bad" }),
    /INVALID_PROVIDER_INTERFACE/
  );
});

test("22. PaymentOrchestrator: cancelPayment delegates to provider", async () => {
  const orchestrator = createPaymentOrchestrator({ defaultProvider: "fake" });
  const fake = createFakePaymentProvider();
  orchestrator.registerProvider("fake", fake);

  // Create a payment first
  const result = await fake.createPayment({ id: "pay-1", amountCents: 1000, currency: "BRL" });
  assert.equal(result.status, "APPROVED");

  // Cancel it
  const cancelResult = await orchestrator.cancelPayment("fake", "pay-1", "CUSTOMER_CANCELLED");
  assert.equal(cancelResult.status, "CANCELLED");
});

test("23. PaymentOrchestrator: queryPayment delegates to provider", async () => {
  const orchestrator = createPaymentOrchestrator({ defaultProvider: "fake" });
  const fake = createFakePaymentProvider();
  orchestrator.registerProvider("fake", fake);

  await fake.createPayment({ id: "pay-1", amountCents: 1000, currency: "BRL" });
  const result = await orchestrator.queryPayment("fake", "pay-1");
  assert.equal(result.status, "APPROVED");
  assert.equal(result.amountCents, 1000);
});

// ============ FakePaymentProvider ============

test("24. FakePaymentProvider: APPROVED scenario", async () => {
  const provider = createFakePaymentProvider({ scenario: SCENARIOS.APPROVED });
  const result = await provider.createPayment({ id: "p1", amountCents: 1000, currency: "BRL" });
  assert.equal(result.status, "APPROVED");
});

test("25. FakePaymentProvider: REJECTED scenario", async () => {
  const provider = createFakePaymentProvider({ scenario: SCENARIOS.REJECTED });
  const result = await provider.createPayment({ id: "p1", amountCents: 1000, currency: "BRL" });
  assert.equal(result.status, "REJECTED");
});

test("26. FakePaymentProvider: PENDING scenario", async () => {
  const provider = createFakePaymentProvider({ scenario: SCENARIOS.PENDING });
  const result = await provider.createPayment({ id: "p1", amountCents: 1000, currency: "BRL" });
  assert.equal(result.status, "PENDING");
});

test("27. FakePaymentProvider: GATEWAY_UNAVAILABLE throws", async () => {
  const provider = createFakePaymentProvider({ scenario: SCENARIOS.GATEWAY_UNAVAILABLE });
  await assert.rejects(
    () => provider.createPayment({ id: "p1", amountCents: 1000, currency: "BRL" }),
    /GATEWAY_UNAVAILABLE/
  );
});

test("28. FakePaymentProvider: RATE_LIMITED throws", async () => {
  const provider = createFakePaymentProvider({ scenario: SCENARIOS.RATE_LIMITED });
  await assert.rejects(
    () => provider.createPayment({ id: "p1", amountCents: 1000, currency: "BRL" }),
    /RATE_LIMITED/
  );
});

test("29. FakePaymentProvider: TRANSIENT_ERROR sometimes fails", async () => {
  const provider = createFakePaymentProvider({ scenario: SCENARIOS.TRANSIENT_ERROR });
  const results = [];
  for (let i = 0; i < 20; i++) {
    try {
      await provider.createPayment({ id: `p${i}`, amountCents: 1000, currency: "BRL" });
      results.push("OK");
    } catch {
      results.push("ERR");
    }
  }
  // At least some should succeed and some should fail
  assert.ok(results.includes("OK"), "Should have some successes");
  assert.ok(results.includes("ERR"), "Should have some errors");
});

test("30. FakePaymentProvider: OUT_OF_ORDER emits webhook before response", async () => {
  const provider = createFakePaymentProvider({ scenario: SCENARIOS.OUT_OF_ORDER });
  const result = await provider.createPayment({ id: "p1", amountCents: 1000, currency: "BRL" });
  assert.equal(result.status, "APPROVED");
  const history = provider.getWebhookHistory();
  assert.ok(history.length > 0, "Webhook should be in history");
  assert.equal(history[0].type, "PAYMENT_APPROVED");
});

test("31. FakePaymentProvider: DUPLICATE_WEBHOOK emits multiple webhooks", async () => {
  const provider = createFakePaymentProvider({ scenario: SCENARIOS.DUPLICATE_WEBHOOK });
  const result = await provider.createPayment({ id: "p1", amountCents: 1000, currency: "BRL" });
  assert.equal(result.status, "APPROVED");
  const history = provider.getWebhookHistory();
  const duplicates = history.filter((h) => h.duplicate);
  assert.equal(duplicates.length, 2, "Should have 2 duplicate webhooks");
});

test("32. FakePaymentProvider: HIGH_LATENCY takes > 4s", async () => {
  const provider = createFakePaymentProvider({ scenario: SCENARIOS.HIGH_LATENCY });
  const start = Date.now();
  const result = await provider.createPayment({ id: "p1", amountCents: 1000, currency: "BRL" });
  const elapsed = Date.now() - start;
  assert.equal(result.status, "APPROVED");
  assert.ok(elapsed >= 4000, `Should take > 4s, took ${elapsed}ms`);
});

test("33. FakePaymentProvider: queryPayment returns null for unknown", async () => {
  const provider = createFakePaymentProvider();
  const result = await provider.queryPayment("nonexistent");
  assert.equal(result, null);
});

test("34. FakePaymentProvider: cancelPayment works", async () => {
  const provider = createFakePaymentProvider();
  await provider.createPayment({ id: "p1", amountCents: 1000, currency: "BRL" });
  const result = await provider.cancelPayment("p1", "CUSTOMER_CANCELLED");
  assert.equal(result.status, "CANCELLED");
});

test("35. FakePaymentProvider: expirePayment works", async () => {
  const provider = createFakePaymentProvider();
  await provider.createPayment({ id: "p1", amountCents: 1000, currency: "BRL" });
  const result = await provider.expirePayment("p1");
  assert.equal(result.status, "EXPIRED");
});

test("36. FakePaymentProvider: processWebhook records in history", async () => {
  const provider = createFakePaymentProvider();
  await provider.createPayment({ id: "p1", amountCents: 1000, currency: "BRL" });
  const result = await provider.processWebhook(
    { webhook_id: "wh-1", payment_id: "p1", status: "APPROVED" },
    "valid-signature"
  );
  assert.equal(result.processed, true);
  const history = provider.getWebhookHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].type, "WEBHOOK");
});
