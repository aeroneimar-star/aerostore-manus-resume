"use strict";

const { PaymentProvider } = require("../PaymentProvider");
const { randomUUID } = require("crypto");

class MockProvider extends PaymentProvider {
  constructor(options = {}) {
    super("mock");
    this._payments = new Map();
    this._behavior = options.behavior || "APPROVED";
    this._delayMs = options.delay || 0;
  }

  setBehavior(behavior) {
    this._behavior = behavior;
  }

  async _simulateDelay(ms) {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  async createPayment(payment) {
    await this._simulateDelay(this._delayMs);
    const id = payment.id || randomUUID();
    const status = this._behavior;
    const entry = {
      id,
      amountCents: payment.amountCents || 0,
      currency: payment.currency || "BRL",
      description: payment.description || "",
      metadata: payment.metadata || {},
      status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      webhookId: null
    };
    this._payments.set(id, entry);
    return {
      id,
      status,
      amountCents: entry.amountCents,
      createdAt: entry.createdAt,
      gatewayData: status === "APPROVED" ? { mock_gateway_ref: `MOCK-${id.slice(0, 8)}` } : null,
      pixPayload: null
    };
  }

  async cancelPayment(paymentId, reason) {
    await this._simulateDelay(this._delayMs);
    const entry = this._payments.get(paymentId);
    if (!entry) throw new Error("MOCK_PAYMENT_NOT_FOUND");
    if (entry.status === "CANCELLED") throw new Error("MOCK_ALREADY_CANCELLED");
    entry.status = "CANCELLED";
    entry.updatedAt = new Date().toISOString();
    entry.cancelReason = reason || "requested_by_user";
    return { id: paymentId, status: "CANCELLED" };
  }

  async expirePayment(paymentId) {
    await this._simulateDelay(this._delayMs);
    const entry = this._payments.get(paymentId);
    if (!entry) throw new Error("MOCK_PAYMENT_NOT_FOUND");
    if (entry.status === "EXPIRED") throw new Error("MOCK_ALREADY_EXPIRED");
    entry.status = "EXPIRED";
    entry.updatedAt = new Date().toISOString();
    return { id: paymentId, status: "EXPIRED" };
  }

  async queryPayment(paymentId) {
    await this._simulateDelay(this._delayMs);
    const entry = this._payments.get(paymentId);
    if (!entry) return null;
    return { id: entry.id, status: entry.status, amountCents: entry.amountCents };
  }

  async processWebhook(payload, signature) {
    await this._simulateDelay(this._delayMs);
    const webhookId = payload.webhook_id || randomUUID();
    const paymentId = payload.payment_id;
    const newStatus = payload.status;
    const entry = this._payments.get(paymentId);
    if (!entry) return { webhookId, action: "ignored", reason: "PAYMENT_NOT_FOUND" };
    entry.status = newStatus;
    entry.updatedAt = new Date().toISOString();
    entry.webhookId = webhookId;
    return {
      webhookId,
      paymentId,
      previousStatus: null,
      newStatus,
      action: "processed"
    };
  }

  async validateWebhook(payload, signature) {
    if (!payload || !signature) return { valid: false, reason: "MISSING_FIELDS" };
    if (signature !== "MOCK_SECRET") return { valid: false, reason: "INVALID_SIGNATURE" };
    return { valid: true };
  }

  async health() {
    return {
      provider: "mock",
      healthy: true,
      message: "Mock provider is operational",
      paymentCount: this._payments.size,
      behavior: this._behavior
    };
  }

  reset() {
    this._payments.clear();
  }

  getPayment(id) {
    return this._payments.get(id) || null;
  }
}

module.exports = { MockProvider };
