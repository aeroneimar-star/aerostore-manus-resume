"use strict";

/**
 * PaymentPolicy
 * Centraliza regras de expiração, tentativas, cancelamentos e limites.
 */

const DEFAULT_POLICY = {
  maxAttempts: 5,
  paymentTimeoutMs: 30 * 60 * 1000,       // 30 minutos
  qrCodeExpiryMs: 10 * 60 * 1000,         // QR Code expira em 10 minutos
  webhookTimeoutMs: 60 * 1000,             // Webhook deve ser processado em 60s
  retryDelayMs: 2000,                      // Delay entre retries
  retryMaxDelayMs: 30000,                  // Delay máximo entre retries (exponential backoff)
  reconciliationIntervalMs: 5 * 60 * 1000, // Conciliação a cada 5 minutos
  cancellationReasons: [
    "CUSTOMER_CANCELLED",
    "STOCK_UNAVAILABLE",
    "PAYMENT_FAILED",
    "PAYMENT_EXPIRED",
    "DUPLICATE_ORDER",
    "SYSTEM_ERROR",
    "FRAUD_SUSPECTED"
  ],
  refundReasons: [
    "CUSTOMER_REQUESTED",
    "ORDER_CANCELLED",
    "ITEM_UNAVAILABLE",
    "FRAUD_REVERSAL",
    "DUPLICATE_CHARGE"
  ],
  amountLimits: {
    minCents: 100,      // R$ 1,00
    maxCents: 50000000  // R$ 500.000,00
  }
};

function createPaymentPolicy(overrides = {}) {
  const config = { ...DEFAULT_POLICY, ...overrides };

  function isExpired(createdAt) {
    const elapsed = Date.now() - new Date(createdAt).getTime();
    return elapsed > config.paymentTimeoutMs;
  }

  function isQrCodeExpired(createdAt) {
    const elapsed = Date.now() - new Date(createdAt).getTime();
    return elapsed > config.qrCodeExpiryMs;
  }

  function canRetry(attemptCount) {
    return attemptCount < config.maxAttempts;
  }

  function getMaxRetries() {
    return config.maxAttempts;
  }

  function isValidAmount(amountCents) {
    return amountCents >= config.amountLimits.minCents &&
           amountCents <= config.amountLimits.maxCents;
  }

  function isValidCancellationReason(reason) {
    return config.cancellationReasons.includes(reason);
  }

  function isValidRefundReason(reason) {
    return config.refundReasons.includes(reason);
  }

  function getRetryDelayMs(attemptNumber) {
    const delay = config.retryDelayMs * Math.pow(2, attemptNumber - 1);
    return Math.min(delay, config.retryMaxDelayMs);
  }

  function getExpirationTime(createdAt) {
    return new Date(new Date(createdAt).getTime() + config.paymentTimeoutMs).toISOString();
  }

  function getQrCodeExpirationTime(createdAt) {
    return new Date(new Date(createdAt).getTime() + config.qrCodeExpiryMs).toISOString();
  }

  return {
    config,
    isExpired,
    isQrCodeExpired,
    canRetry,
    getMaxRetries,
    isValidAmount,
    isValidCancellationReason,
    isValidRefundReason,
    getRetryDelayMs,
    getExpirationTime,
    getQrCodeExpirationTime
  };
}

module.exports = { createPaymentPolicy };
