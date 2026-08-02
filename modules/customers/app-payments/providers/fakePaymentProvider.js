"use strict";

/**
 * FakePaymentProvider
 * Complementa o MockProvider simulando cenários próximos da produção:
 * - Timeout
 * - Webhooks duplicados
 * - Respostas fora de ordem
 * - Indisponibilidade do gateway
 * - Rate limit
 * - Latência variável
 * - Erros transitórios
 */

const { randomUUID } = require("crypto");

class PaymentProvider {
  constructor(name) {
    this.name = name;
  }

  async createPayment(payment) { throw new Error("NOT_IMPLEMENTED"); }
  async cancelPayment(paymentId, reason) { throw new Error("NOT_IMPLEMENTED"); }
  async expirePayment(paymentId) { throw new Error("NOT_IMPLEMENTED"); }
  async queryPayment(paymentId) { throw new Error("NOT_IMPLEMENTED"); }
  async processWebhook(payload, signature) { throw new Error("NOT_IMPLEMENTED"); }
  getMethods() { return ["PIX", "CREDIT_CARD", "BOLETO"]; }
}

const SCENARIOS = {
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  PENDING: "PENDING",
  TIMEOUT: "TIMEOUT",
  GATEWAY_UNAVAILABLE: "GATEWAY_UNAVAILABLE",
  RATE_LIMITED: "RATE_LIMITED",
  OUT_OF_ORDER: "OUT_OF_ORDER",
  DUPLICATE_WEBHOOK: "DUPLICATE_WEBHOOK",
  TRANSIENT_ERROR: "TRANSIENT_ERROR",
  HIGH_LATENCY: "HIGH_LATENCY"
};

function createFakePaymentProvider(options = {}) {
  const { scenario = SCENARIOS.APPROVED } = options;
  const payments = new Map();
  const webhookHistory = [];

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function createPayment(payment) {
    const id = payment.id || randomUUID();
    const amountCents = payment.amountCents;
    const currency = payment.currency || "BRL";

    switch (scenario) {
      case SCENARIOS.TIMEOUT:
        // Simula timeout do gateway (nunca responde)
        await delay(60000); // 60s timeout
        throw new Error("GATEWAY_TIMEOUT");

      case SCENARIOS.GATEWAY_UNAVAILABLE:
        await delay(100);
        throw new Error("GATEWAY_UNAVAILABLE: 503 Service Unavailable");

      case SCENARIOS.RATE_LIMITED:
        await delay(100);
        throw new Error("RATE_LIMITED: 429 Too Many Requests");

      case SCENARIOS.TRANSIENT_ERROR:
        await delay(100);
        // 50% chance de sucesso, 50% de erro transitório
        if (Math.random() < 0.5) {
          const entry = { id, status: "APPROVED", amountCents, currency };
          payments.set(id, entry);
          return entry;
        }
        throw new Error("TRANSIENT_ERROR: 500 Internal Server Error");

      case SCENARIOS.HIGH_LATENCY:
        await delay(5000); // 5s de latência
        const entry2 = { id, status: "APPROVED", amountCents, currency };
        payments.set(id, entry2);
        return entry2;

      case SCENARIOS.OUT_OF_ORDER:
        // Simula webhook chegando antes da resposta do createPayment
        const entry3 = { id, status: "APPROVED", amountCents, currency };
        payments.set(id, entry3);
        // Emite webhook antes de retornar
        webhookHistory.push({
          type: "PAYMENT_APPROVED",
          paymentId: id,
          timestamp: new Date().toISOString()
        });
        return entry3;

      case SCENARIOS.DUPLICATE_WEBHOOK:
        const entry4 = { id, status: "APPROVED", amountCents, currency };
        payments.set(id, entry4);
        // Simula envio duplicado de webhook
        webhookHistory.push({
          type: "PAYMENT_APPROVED",
          paymentId: id,
          timestamp: new Date().toISOString(),
          duplicate: true
        });
        webhookHistory.push({
          type: "PAYMENT_APPROVED",
          paymentId: id,
          timestamp: new Date().toISOString(),
          duplicate: true
        });
        return entry4;

      case SCENARIOS.REJECTED:
        await delay(500);
        const entry5 = { id, status: "REJECTED", amountCents, currency };
        payments.set(id, entry5);
        return entry5;

      case SCENARIOS.PENDING:
        await delay(500);
        const entry6 = { id, status: "PENDING", amountCents, currency };
        payments.set(id, entry6);
        return entry6;

      case SCENARIOS.APPROVED:
      default:
        await delay(100);
        const entry7 = { id, status: "APPROVED", amountCents, currency };
        payments.set(id, entry7);
        return entry7;
    }
  }

  async function cancelPayment(paymentId, reason) {
    const entry = payments.get(paymentId);
    if (!entry) throw new Error("PAYMENT_NOT_FOUND");
    if (entry.status === "CANCELLED") throw new Error("ALREADY_CANCELLED");
    entry.status = "CANCELLED";
    return { id: paymentId, status: "CANCELLED", reason };
  }

  async function expirePayment(paymentId) {
    const entry = payments.get(paymentId);
    if (!entry) throw new Error("PAYMENT_NOT_FOUND");
    if (entry.status === "EXPIRED") throw new Error("ALREADY_EXPIRED");
    entry.status = "EXPIRED";
    return { id: paymentId, status: "EXPIRED" };
  }

  async function queryPayment(paymentId) {
    const entry = payments.get(paymentId);
    if (!entry) return null;
    return {
      id: entry.id,
      status: entry.status,
      amountCents: entry.amountCents,
      currency: entry.currency
    };
  }

  async function processWebhook(payload, signature) {
    const webhookId = payload.webhook_id || randomUUID();
    const paymentId = payload.payment_id;
    const newStatus = payload.status;

    // Registrar no histórico
    webhookHistory.push({
      type: "WEBHOOK",
      webhookId,
      paymentId,
      newStatus,
      timestamp: new Date().toISOString()
    });

    const entry = payments.get(paymentId);
    if (entry) {
      entry.status = newStatus;
    }

    return {
      id: webhookId,
      paymentId,
      status: newStatus,
      processed: true
    };
  }

  function getWebhookHistory() {
    return [...webhookHistory];
  }

  function getMethods() {
    return ["PIX", "CREDIT_CARD", "BOLETO"];
  }

  // Herdar de PaymentProvider
  Object.setPrototypeOf({
    createPayment,
    cancelPayment,
    expirePayment,
    queryPayment,
    processWebhook,
    getWebhookHistory,
    getMethods
  }, PaymentProvider.prototype);

  return {
    name: "fake",
    createPayment,
    cancelPayment,
    expirePayment,
    queryPayment,
    processWebhook,
    getWebhookHistory,
    getMethods
  };
}

module.exports = { createFakePaymentProvider, SCENARIOS };
