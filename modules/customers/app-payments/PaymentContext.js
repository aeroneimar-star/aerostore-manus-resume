"use strict";

/**
 * PaymentContext
 * Encapsula orderId, paymentId, accountId, channel, provider,
 * correlationId e idempotencyKey em todas as operações relevantes.
 */

const { randomUUID } = require("crypto");

class PaymentContextError extends Error {
  constructor(code, statusCode = 400) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function createPaymentContext(input = {}) {
  const {
    orderId,
    paymentId,
    accountId,
    channel = "MOBILE_APP",
    provider = "mock",
    correlationId = randomUUID(),
    idempotencyKey = randomUUID(),
    metadata = {}
  } = input;

  // Validações básicas
  if (!accountId) {
    throw new PaymentContextError("ACCOUNT_ID_REQUIRED");
  }

  function extend(extra = {}) {
    return createPaymentContext({
      orderId: extra.orderId || orderId,
      paymentId: extra.paymentId || paymentId,
      accountId: extra.accountId || accountId,
      channel: extra.channel || channel,
      provider: extra.provider || provider,
      correlationId: extra.correlationId || correlationId,
      idempotencyKey: extra.idempotencyKey || randomUUID(),
      metadata: { ...metadata, ...extra.metadata }
    });
  }

  function getOrderId() {
    if (!orderId) throw new PaymentContextError("ORDER_ID_REQUIRED");
    return orderId;
  }

  function getPaymentId() {
    if (!paymentId) throw new PaymentContextError("PAYMENT_ID_REQUIRED");
    return paymentId;
  }

  function getAccountId() {
    return accountId;
  }

  function getChannel() {
    return channel;
  }

  function getProvider() {
    return provider;
  }

  function getCorrelationId() {
    return correlationId;
  }

  function getIdempotencyKey() {
    return idempotencyKey;
  }

  function getMetadata() {
    return { ...metadata };
  }

  function toLogEntry() {
    return {
      correlationId,
      orderId: orderId || null,
      paymentId: paymentId || null,
      accountId,
      channel,
      provider,
      timestamp: new Date().toISOString()
    };
  }

  return {
    orderId,
    paymentId,
    accountId,
    channel,
    provider,
    correlationId,
    idempotencyKey,
    metadata,
    extend,
    getOrderId,
    getPaymentId,
    getAccountId,
    getChannel,
    getProvider,
    getCorrelationId,
    getIdempotencyKey,
    getMetadata,
    toLogEntry
  };
}

module.exports = { createPaymentContext, PaymentContextError };
