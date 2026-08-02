"use strict";

const { randomUUID } = require("crypto");
const { PaymentMachine, STATES, EVENTS } = require("./PaymentMachine");
const { paymentDto, PaymentError } = require("./appPaymentDto");

function iso(date) { return date.toISOString(); }
function clock() { return new Date(); }
function generateId() { return randomUUID(); }

function createReconciliationService(options = {}) {
  const db = options.dbApi;
  if (!db || ["run", "get", "all"].some((name) => typeof db[name] !== "function")) {
    throw new Error("APP_RECONCILIATION_DB_REQUIRED");
  }
  const provider = options.provider;
  if (!provider) throw new Error("APP_RECONCILIATION_PROVIDER_REQUIRED");
  const paymentEngine = options.paymentEngine;
  if (!paymentEngine) throw new Error("APP_RECONCILIATION_PAYMENT_ENGINE_REQUIRED");
  const recordAudit = options.recordAudit || (async () => null);

  async function reconcilePayment(paymentId) {
    const payment = await db.get("SELECT * FROM app_payments WHERE id = ?", [paymentId]);
    if (!payment) throw new PaymentError("PAYMENT_NOT_FOUND", 404);

    const reconciliationId = generateId();
    const startTime = clock();
    const report = {
      id: reconciliationId,
      paymentId,
      orderId: payment.order_id,
      startedAt: iso(startTime),
      discrepancies: [],
      corrections: [],
      status: "IN_PROGRESS"
    };

    let gatewayStatus = null;
    try {
      const gatewayResult = await provider.queryPayment(payment.gateway_payment_id || payment.id);
      gatewayStatus = gatewayResult?.status || null;
      report.gatewayStatus = gatewayStatus;
    } catch (err) {
      report.gatewayError = err.message.substring(0, 500);
      report.status = "PARTIAL";
      await recordAudit("reconciliation_gateway_error", { paymentId, error: report.gatewayError }, reconciliationId);
    }

    const localStatus = payment.status;
    const statusMap = {
      APPROVED: STATES.PAID,
      FAILED: STATES.PAYMENT_FAILED,
      CANCELLED: STATES.PAYMENT_CANCELLED,
      EXPIRED: STATES.PAYMENT_EXPIRED,
      PENDING: STATES.PAYMENT_PROCESSING
    };

    if (gatewayStatus && statusMap[gatewayStatus]) {
      const expectedStatus = statusMap[gatewayStatus];
      if (localStatus !== expectedStatus) {
        report.discrepancies.push({
          field: "status",
          local: localStatus,
          gateway: gatewayStatus,
          expected: expectedStatus
        });

        if (expectedStatus === STATES.PAID && localStatus !== STATES.PAID) {
          const machine = new PaymentMachine(localStatus);
          const transition = machine.transitionByEvent(EVENTS.PAYMENT_APPROVED, { paymentId, reconciliationId });
          if (transition.success) {
            const now = clock();
            await db.run(
              "UPDATE app_payments SET status = ?, updated_at = ? WHERE id = ?",
              [machine.state, iso(now), paymentId]
            );
            report.corrections.push({
              field: "status",
              from: localStatus,
              to: machine.state,
              reason: "reconciliation_approved"
            });
            await paymentEngine.recordPaymentEvent(paymentId, EVENTS.RECONCILIATION_COMPLETED, {
              reconciliationId,
              correction: "status_approved"
            });
          }
        }
      }
    }

    if (payment.amount_cents > 0) {
      try {
        const gatewayResult = await provider.queryPayment(payment.gateway_payment_id || payment.id);
        const gatewayAmount = gatewayResult?.amountCents || null;
        if (gatewayAmount !== null && gatewayAmount !== payment.amount_cents) {
          report.discrepancies.push({
            field: "amount_cents",
            local: payment.amount_cents,
            gateway: gatewayAmount
          });
        }
      } catch (err) {
      }
    }

    report.endedAt = iso(clock());
    report.durationMs = clock().getTime() - startTime.getTime();
    report.status = report.corrections.length > 0 ? "CORRECTED" : (report.discrepancies.length > 0 ? "DISCREPANCY" : "CLEAN");

    await recordAudit("reconciliation_completed", {
      reconciliationId,
      paymentId,
      status: report.status,
      discrepancies: report.discrepancies.length,
      corrections: report.corrections.length
    }, reconciliationId);

    return report;
  }

  async function reconcileAllPending() {
    const pendingPayments = await db.all(
      "SELECT * FROM app_payments WHERE status IN (?, ?) ORDER BY created_at DESC",
      [STATES.PAYMENT_PROCESSING, STATES.AWAITING_PAYMENT]
    );
    const results = [];
    for (const payment of pendingPayments) {
      try {
        const result = await reconcilePayment(payment.id);
        results.push(result);
      } catch (err) {
        results.push({ paymentId: payment.id, error: err.message });
      }
    }
    return results;
  }

  async function getReconciliationReport(paymentId) {
    const payment = await db.get("SELECT * FROM app_payments WHERE id = ?", [paymentId]);
    if (!payment) throw new PaymentError("PAYMENT_NOT_FOUND", 404);
    return await reconcilePayment(paymentId);
  }

  return {
    reconcilePayment,
    reconcileAllPending,
    getReconciliationReport
  };
}

module.exports = { createReconciliationService };
