"use strict";

const { randomUUID } = require("crypto");
const { EVENTS, STATES } = require("./PaymentMachine");
const { paymentEventDto, PaymentError } = require("./appPaymentDto");

function iso(date) { return date.toISOString(); }
function clock() { return new Date(); }
function generateId() { return randomUUID(); }

const WEBHOOK_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

function createWebhookEngine(options = {}) {
  const db = options.dbApi;
  if (!db || ["run", "get", "all"].some((name) => typeof db[name] !== "function")) {
    throw new Error("APP_WEBHOOK_DB_REQUIRED");
  }
  const provider = options.provider;
  if (!provider) throw new Error("APP_WEBHOOK_PROVIDER_REQUIRED");
  const paymentEngine = options.paymentEngine;
  if (!paymentEngine) throw new Error("APP_WEBHOOK_PAYMENT_ENGINE_REQUIRED");
  const recordAudit = options.recordAudit || (async () => null);
  const onPaymentApproved = options.onPaymentApproved || (async () => null);

  function sanitizePayload(payload) {
    if (!payload || typeof payload !== "object") return {};
    const sanitized = {};
    const allowed = new Set(["webhook_id", "event_type", "payment_id", "status", "amount_cents", "timestamp", "metadata"]);
    for (const key of Object.keys(payload)) {
      if (allowed.has(key)) {
        sanitized[key] = payload[key];
      }
    }
    return sanitized;
  }

  async function handleWebhook(payload, signature) {
    const startTime = clock();
    const webhookId = payload.webhook_id || generateId();
    const sanitized = sanitizePayload(payload);

    if (!sanitized.payment_id || !sanitized.event_type) {
      await recordAudit("webhook_invalid", { reason: "MISSING_REQUIRED_FIELDS", webhookId }, webhookId);
      return { webhookId, action: "rejected", reason: "MISSING_REQUIRED_FIELDS" };
    }

    const validation = await provider.validateWebhook(payload, signature);
    if (!validation.valid) {
      await recordAudit("webhook_invalid_signature", { webhookId, reason: validation.reason }, webhookId);
      return { webhookId, action: "rejected", reason: "INVALID_SIGNATURE" };
    }

    const existing = await db.get("SELECT * FROM app_payment_events WHERE payment_id = ? AND event_type = ? AND details_json LIKE ?", [
      sanitized.payment_id,
      `WEBHOOK_${sanitized.event_type}`,
      `%${webhookId}%`
    ]);

    if (existing) {
      await recordAudit("webhook_duplicated", { webhookId, paymentId: sanitized.payment_id }, webhookId);
      return { webhookId, action: "duplicated", reason: "WEBHOOK_DUPLICATED" };
    }

    const duration = clock().getTime() - startTime.getTime();
    if (duration > WEBHOOK_TIMEOUT_MS) {
      await recordAudit("webhook_timeout", { webhookId, duration }, webhookId);
      return { webhookId, action: "timeout", reason: "WEBHOOK_TIMEOUT" };
    }

    const eventType = `WEBHOOK_${sanitized.event_type}`;
    const payment = await db.get("SELECT * FROM app_payments WHERE id = ?", [sanitized.payment_id]);

    if (!payment) {
      await recordAudit("webhook_unknown_payment", { webhookId, paymentId: sanitized.payment_id }, webhookId);
      return { webhookId, action: "ignored", reason: "PAYMENT_NOT_FOUND" };
    }

    const statusMap = {
      APPROVED: STATES.PAID,
      FAILED: STATES.PAYMENT_FAILED,
      CANCELLED: STATES.PAYMENT_CANCELLED,
      EXPIRED: STATES.PAYMENT_EXPIRED,
      PENDING: STATES.PAYMENT_PROCESSING
    };
    const targetState = statusMap[sanitized.status];
    if (!targetState) {
      await recordAudit("webhook_unknown_status", { webhookId, status: sanitized.status }, webhookId);
      return { webhookId, action: "ignored", reason: "UNKNOWN_STATUS" };
    }

    const { PaymentMachine } = require("./PaymentMachine");
    const machine = new PaymentMachine(payment.status);
    const transition = machine.transition(targetState, `webhook:${eventType}`, { webhookId });
    if (!transition.success) {
      await recordAudit("webhook_invalid_transition", { webhookId, from: payment.status, to: targetState }, webhookId);
      return { webhookId, action: "ignored", reason: "INVALID_TRANSITION" };
    }

    const now = clock();
    await db.run(
      "UPDATE app_payments SET status = ?, updated_at = ? WHERE id = ?",
      [machine.state, iso(now), sanitized.payment_id]
    );

    await paymentEngine.recordPaymentEvent(sanitized.payment_id, eventType, {
      webhookId,
      status: sanitized.status,
      at: iso(now)
    });

    await paymentEngine.recordPaymentEvent(sanitized.payment_id, EVENTS.WEBHOOK_RECEIVED, {
      webhookId,
      providerStatus: sanitized.status,
      at: iso(now)
    });

    await recordAudit("webhook_processed", { webhookId, paymentId: sanitized.payment_id, newStatus: machine.state }, webhookId);

    if (machine.state === STATES.PAID) {
      await onPaymentApproved(sanitized.payment_id);
    }

    return {
      webhookId,
      paymentId: sanitized.payment_id,
      previousStatus: payment.status,
      newStatus: machine.state,
      action: "processed"
    };
  }

  async function getWebhookLog(limit = 50) {
    const events = await db.all(
      "SELECT * FROM app_payment_events WHERE event_type LIKE 'WEBHOOK_%' ORDER BY created_at DESC LIMIT ?",
      [limit]
    );
    return events.map(e => paymentEventDto(e));
  }

  async function retryWebhook(webhookId) {
    const event = await db.get("SELECT * FROM app_payment_events WHERE id = ?", [webhookId]);
    if (!event) throw new PaymentError("WEBHOOK_NOT_FOUND", 404);
    return { webhookId, action: "retry_scheduled" };
  }

  return {
    handleWebhook,
    getWebhookLog,
    retryWebhook,
    sanitizePayload
  };
}

module.exports = { createWebhookEngine, WEBHOOK_TIMEOUT_MS, MAX_RETRIES };
