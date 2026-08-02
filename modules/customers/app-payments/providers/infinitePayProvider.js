"use strict";

const { PaymentProvider } = require("../PaymentProvider");
const { randomUUID } = require("crypto");

class InfinitePayProvider extends PaymentProvider {
  constructor(options = {}) {
    super("infinitepay");
    this._handle = options.handle || process.env.INFINITEPAY_HANDLE || null;
    this._secret = options.secret || null;
    this._webhookSecret = options.webhookSecret || process.env.INFINITEPAY_WEBHOOK_SECRET || null;
    this._redirectUrl = options.redirectUrl || process.env.INFINITEPAY_REDIRECT_URL || null;
    this._webhookUrl = options.webhookUrl || process.env.INFINITEPAY_WEBHOOK_URL || null;
    this._env = options.env || process.env.INFINITEPAY_ENV || "sandbox";
    this._mockMode = options.mockMode !== false;
  }

  _validateConfig() {
    if (!this._handle) throw new Error("INFINITEPAY_HANDLE_REQUIRED");
    if (!this._secret) throw new Error("INFINITEPAY_SECRET_REQUIRED");
  }

  async createPayment(payment) {
    if (this._mockMode) {
      return this._mockCreate(payment);
    }
    this._validateConfig();
    throw new Error("INFINITEPAY_NOT_CONFIGURED: live mode requires API credentials");
  }

  async cancelPayment(paymentId, reason) {
    if (this._mockMode) {
      return { id: paymentId, status: "CANCELLED", cancelReason: reason || "requested" };
    }
    this._validateConfig();
    throw new Error("INFINITEPAY_NOT_CONFIGURED");
  }

  async expirePayment(paymentId) {
    if (this._mockMode) {
      return { id: paymentId, status: "EXPIRED" };
    }
    this._validateConfig();
    throw new Error("INFINITEPAY_NOT_CONFIGURED");
  }

  async queryPayment(paymentId) {
    if (this._mockMode) {
      return { id: paymentId, status: "PENDING" };
    }
    this._validateConfig();
    throw new Error("INFINITEPAY_NOT_CONFIGURED");
  }

  async processWebhook(payload, signature) {
    if (this._mockMode) {
      return { webhookId: randomUUID(), action: "processed_mock", paymentId: payload?.payment_id };
    }
    const validation = await this.validateWebhook(payload, signature);
    if (!validation.valid) {
      return { webhookId: null, action: "rejected", reason: validation.reason };
    }
    this._validateConfig();
    throw new Error("INFINITEPAY_NOT_CONFIGURED");
  }

  async validateWebhook(payload, signature) {
    if (!this._webhookSecret) {
      return { valid: false, reason: "WEBHOOK_SECRET_NOT_CONFIGURED" };
    }
    if (!payload || !signature) {
      return { valid: false, reason: "MISSING_FIELDS" };
    }
    if (signature !== this._webhookSecret) {
      return { valid: false, reason: "INVALID_SIGNATURE" };
    }
    return { valid: true };
  }

  async health() {
    return {
      provider: "infinitepay",
      healthy: this._mockMode || !!this._handle,
      mockMode: this._mockMode,
      env: this._env,
      message: this._mockMode ? "Mock mode active" : (this._handle ? "Configured" : "Not configured")
    };
  }

  _mockCreate(payment) {
    const id = payment.id || randomUUID();
    return {
      id,
      status: "PENDING",
      amountCents: payment.amountCents || 0,
      createdAt: new Date().toISOString(),
      pixPayload: null,
      gatewayData: { mock_ref: `IP-${id.slice(0, 8)}` }
    };
  }
}

module.exports = { InfinitePayProvider };
