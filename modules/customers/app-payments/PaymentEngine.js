"use strict";

const { randomUUID } = require("crypto");
const { PaymentMachine, STATES, EVENTS } = require("./PaymentMachine");
const { paymentDto, paymentAttemptDto, paymentEventDto, formatCentsBrl, envelope, PaymentError } = require("./appPaymentDto");

function iso(date) { return date.toISOString(); }
function clock() { return new Date(); }
function generateId() { return randomUUID(); }

function createPaymentEngine(options = {}) {
  const db = options.dbApi;
  if (!db || ["run", "get", "all"].some((name) => typeof db[name] !== "function")) {
    throw new Error("APP_PAYMENT_DB_REQUIRED");
  }
  const provider = options.provider;
  if (!provider) throw new Error("APP_PAYMENT_PROVIDER_REQUIRED");
  const recordAudit = options.recordAudit || (async () => null);
  const onPaymentApproved = options.onPaymentApproved || (async () => null);
  const onPaymentFailed = options.onPaymentFailed || (async () => null);

  function audit(action, metadata = {}, entityId = "") {
    return recordAudit({
      module: "app_payments",
      action,
      metadata,
      entityId,
      at: iso(clock())
    });
  }

  async function createPayment(input) {
    const paymentId = input.id || generateId();
    const machine = new PaymentMachine(STATES.AWAITING_PAYMENT);
    const now = clock();

    if (!input.orderId) throw new PaymentError("ORDER_ID_REQUIRED", 400);
    if (!input.amountCents || input.amountCents <= 0) throw new PaymentError("INVALID_AMOUNT", 400);
    if (input.amountCents > 50000000) throw new PaymentError("AMOUNT_EXCEEDS_LIMIT", 400);

    const pendingTransition = machine.transitionByEvent(EVENTS.PAYMENT_PENDING, { paymentId });
    if (!pendingTransition.success) throw new PaymentError("STATE_ERROR", 500);

    const row = {
      id: paymentId,
      order_id: input.orderId,
      amount_cents: input.amountCents,
      currency: input.currency || "BRL",
      description: input.description || `Pagamento pedido ${input.orderId}`,
      status: machine.state,
      payment_method: input.paymentMethod || "PIX",
      gateway_payment_id: null,
      gateway_data_json: null,
      pix_payload: null,
      pix_code: null,
      expires_at: input.expiresAt || iso(new Date(now.getTime() + 3600000)),
      attempt_count: 0,
      version: 1,
      created_at: iso(now),
      updated_at: iso(now)
    };

    await db.run(
      `INSERT INTO app_payments
       (id, order_id, amount_cents, currency, description, status, payment_method,
        gateway_payment_id, gateway_data_json, pix_payload, pix_code, expires_at,
        attempt_count, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.order_id, row.amount_cents, row.currency, row.description, row.status,
       row.payment_method, row.gateway_payment_id, row.gateway_data_json, row.pix_payload,
       row.pix_code, row.expires_at, row.attempt_count, row.version, row.created_at, row.updated_at]
    );

    await recordPaymentEvent(paymentId, EVENTS.PAYMENT_CREATED, { amountCents: input.amountCents });

    await audit("payment_created", { amountCents: input.amountCents, orderId: input.orderId }, paymentId);

    return paymentDto({ ...row, id: paymentId });
  }

  async function createPaymentAttempt(paymentId) {
    const payment = await db.get("SELECT * FROM app_payments WHERE id = ? AND status != 'PAYMENT_CANCELLED'", [paymentId]);
    if (!payment) throw new PaymentError("PAYMENT_NOT_FOUND", 404);
    if (payment.status === STATES.PAID) throw new PaymentError("PAYMENT_ALREADY_PAID", 400);

    const attemptId = generateId();
    const now = clock();

    const machine = new PaymentMachine(payment.status);
    const transition = machine.transitionByEvent(EVENTS.PAYMENT_PENDING, { paymentId, attemptId });
    if (!transition.success) throw new PaymentError("INVALID_STATE_FOR_ATTEMPT", 400);

    let gatewayResult = null;
    let gatewayError = null;
    try {
      gatewayResult = await provider.createPayment({
        id: attemptId,
        amountCents: payment.amount_cents,
        currency: payment.currency,
        description: payment.description,
        metadata: { payment_id: paymentId, order_id: payment.order_id }
      });
    } catch (err) {
      gatewayError = err.message;
    }

    const attemptRow = {
      id: attemptId,
      payment_id: paymentId,
      attempt_number: payment.attempt_count + 1,
      provider: provider.name || "unknown",
      provider_payment_id: gatewayResult?.id || null,
      gateway_data_json: gatewayResult ? JSON.stringify(gatewayResult) : null,
      gateway_error: gatewayError ? gatewayError.substring(0, 500) : null,
      status: gatewayResult ? "SUBMITTED" : "FAILED",
      amount_cents: payment.amount_cents,
      currency: payment.currency,
      created_at: iso(now),
      updated_at: iso(now)
    };

    await db.run(
      `INSERT INTO app_payment_attempts
       (id, payment_id, attempt_number, provider, provider_payment_id, gateway_data_json,
        gateway_error, status, amount_cents, currency, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [attemptRow.id, attemptRow.payment_id, attemptRow.attempt_number, attemptRow.provider,
       attemptRow.provider_payment_id, attemptRow.gateway_data_json, attemptRow.gateway_error,
       attemptRow.status, attemptRow.amount_cents, attemptRow.currency, attemptRow.created_at, attemptRow.updated_at]
    );

    const newAttemptCount = payment.attempt_count + 1;
    await db.run(
      "UPDATE app_payments SET attempt_count = ?, status = ?, updated_at = ? WHERE id = ?",
      [newAttemptCount, machine.state, iso(now), paymentId]
    );

    await recordPaymentEvent(paymentId, EVENTS.PAYMENT_PENDING, { attemptId, attemptNumber: newAttemptCount });
    await audit("payment_attempt", { attemptId, provider: provider.name }, paymentId);

    if (gatewayResult?.status === "APPROVED") {
      await handlePaymentApproved(paymentId, machine);
    }

    return paymentAttemptDto({ ...attemptRow, id: attemptId });
  }

  async function handlePaymentApproved(paymentId, machine) {
    const now = clock();
    const transition = machine.transitionByEvent(EVENTS.PAYMENT_APPROVED, { paymentId });
    if (!transition.success) throw new PaymentError("STATE_ERROR_ON_APPROVE", 500);

    await db.run(
      "UPDATE app_payments SET status = ?, updated_at = ? WHERE id = ?",
      [machine.state, iso(now), paymentId]
    );

    await recordPaymentEvent(paymentId, EVENTS.PAYMENT_APPROVED, { at: iso(now) });
    await audit("payment_approved", { paymentId }, paymentId);
    await onPaymentApproved(paymentId);
  }

  async function cancelPayment(paymentId, reason) {
    const payment = await db.get("SELECT * FROM app_payments WHERE id = ?", [paymentId]);
    if (!payment) throw new PaymentError("PAYMENT_NOT_FOUND", 404);

    const machine = new PaymentMachine(payment.status);
    const transition = machine.transitionByEvent(EVENTS.PAYMENT_CANCELLED, { paymentId, reason });
    if (!transition.success) {
      throw new PaymentError("CANNOT_CANCEL", 400, transition.message);
    }

    try {
      await provider.cancelPayment(payment.gateway_payment_id || payment.id, reason);
    } catch (err) {
      await audit("cancel_gateway_error", { error: err.message.substring(0, 200) }, paymentId);
    }

    const now = clock();
    await db.run(
      "UPDATE app_payments SET status = ?, updated_at = ? WHERE id = ?",
      [machine.state, iso(now), paymentId]
    );

    await recordPaymentEvent(paymentId, EVENTS.PAYMENT_CANCELLED, { reason: reason || "user_requested", at: iso(now) });
    await audit("payment_cancelled", { reason }, paymentId);

    return paymentDto({ ...payment, status: machine.state, updated_at: iso(now) });
  }

  async function expirePayment(paymentId) {
    const payment = await db.get("SELECT * FROM app_payments WHERE id = ?", [paymentId]);
    if (!payment) throw new PaymentError("PAYMENT_NOT_FOUND", 404);

    const machine = new PaymentMachine(payment.status);
    const transition = machine.transitionByEvent(EVENTS.PAYMENT_EXPIRED, { paymentId });
    if (!transition.success) {
      throw new PaymentError("CANNOT_EXPIRE", 400, transition.message);
    }

    try {
      await provider.expirePayment(payment.gateway_payment_id || payment.id);
    } catch (err) {
      await audit("expire_gateway_error", { error: err.message.substring(0, 200) }, paymentId);
    }

    const now = clock();
    await db.run(
      "UPDATE app_payments SET status = ?, updated_at = ? WHERE id = ?",
      [machine.state, iso(now), paymentId]
    );

    await recordPaymentEvent(paymentId, EVENTS.PAYMENT_EXPIRED, { at: iso(now) });
    await audit("payment_expired", { paymentId }, paymentId);

    return paymentDto({ ...payment, status: machine.state, updated_at: iso(now) });
  }

  async function queryPayment(paymentId) {
    const payment = await db.get("SELECT * FROM app_payments WHERE id = ?", [paymentId]);
    if (!payment) return null;

    try {
      const gatewayResult = await provider.queryPayment(payment.gateway_payment_id || payment.id);
      if (gatewayResult?.status === "APPROVED" && payment.status !== STATES.PAID) {
        const machine = new PaymentMachine(payment.status);
        await handlePaymentApproved(paymentId, machine);
        return paymentDto({ ...(await db.get("SELECT * FROM app_payments WHERE id = ?", [paymentId])), id: paymentId });
      }
    } catch (err) {
      await audit("query_gateway_error", { error: err.message.substring(0, 200) }, paymentId);
    }

    return paymentDto(payment);
  }

  async function getPayment(paymentId) {
    const payment = await db.get("SELECT * FROM app_payments WHERE id = ?", [paymentId]);
    if (!payment) return null;
    return paymentDto(payment);
  }

  async function getPaymentAttempts(paymentId) {
    const attempts = await db.all("SELECT * FROM app_payment_attempts WHERE payment_id = ? ORDER BY attempt_number DESC", [paymentId]);
    return attempts.map(a => paymentAttemptDto({ ...a, id: a.id }));
  }

  async function getPaymentEvents(paymentId) {
    const events = await db.all("SELECT * FROM app_payment_events WHERE payment_id = ? ORDER BY created_at DESC", [paymentId]);
    return events.map(e => paymentEventDto(e));
  }

  async function getPaymentsByOrder(orderId) {
    const payments = await db.all("SELECT * FROM app_payments WHERE order_id = ? ORDER BY created_at DESC", [orderId]);
    return payments.map(p => paymentDto({ ...p, id: p.id }));
  }

  async function recordPaymentEvent(paymentId, eventType, details) {
    const eventId = generateId();
    const now = clock();
    await db.run(
      `INSERT INTO app_payment_events (id, payment_id, event_type, details_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [eventId, paymentId, eventType, JSON.stringify(details || {}), iso(now)]
    );
    return { eventId, paymentId, eventType, details };
  }

  return {
    createPayment,
    createPaymentAttempt,
    cancelPayment,
    expirePayment,
    queryPayment,
    getPayment,
    getPaymentAttempts,
    getPaymentEvents,
    getPaymentsByOrder,
    handlePaymentApproved,
    recordPaymentEvent
  };
}

module.exports = { createPaymentEngine };
