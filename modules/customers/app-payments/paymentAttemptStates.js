"use strict";

/**
 * Estados do Payment Attempt — máquina monotônica.
 *
 * Transições permitidas:
 *   CREATED → REQUESTING
 *   REQUESTING → PENDING | FAILED | EXPIRED
 *   PENDING → PAID | FAILED | EXPIRED | REVIEW_REQUIRED
 *   FAILED → CANCELLED
 *   EXPIRED → (terminal)
 *   PAID → (terminal)
 *   CANCELLED → (terminal)
 *   REVIEW_REQUIRED → PAID | CANCELLED | FAILED
 *
 * Transições PROIBIDAS:
 *   PAID → qualquer outro estado
 *   EXPIRED → qualquer outro estado (exceto via reconciliation)
 *   CANCELLED → qualquer outro estado
 */

const VALID_STATES = new Set([
  "CREATED",
  "REQUESTING",
  "PENDING",
  "FAILED",
  "EXPIRED",
  "PAID",
  "CANCELLED",
  "REVIEW_REQUIRED",
]);

const ALLOWED_TRANSITIONS = {
  CREATED: ["REQUESTING"],
  REQUESTING: ["PENDING", "FAILED", "EXPIRED"],
  PENDING: ["PAID", "FAILED", "EXPIRED", "REVIEW_REQUIRED"],
  FAILED: ["CANCELLED"],
  EXPIRED: [],
  PAID: [],
  CANCELLED: [],
  REVIEW_REQUIRED: ["PAID", "CANCELLED", "FAILED"],
};

function isValidState(state) {
  return VALID_STATES.has(String(state || "").toUpperCase());
}

function isAllowedTransition(from, to) {
  const fromUpper = String(from || "").toUpperCase();
  const toUpper = String(to || "").toUpperCase();
  if (!VALID_STATES.has(fromUpper) || !VALID_STATES.has(toUpper)) {
    return false;
  }
  if (fromUpper === toUpper) {
    return true; // mesma transição é permitida (idempotência)
  }
  const allowed = ALLOWED_TRANSITIONS[fromUpper];
  return Array.isArray(allowed) && allowed.includes(toUpper);
}

function isTerminalState(state) {
  return ["PAID", "EXPIRED", "CANCELLED"].includes(String(state || "").toUpperCase());
}

function isPayableStatus(status) {
  return String(status || "").toUpperCase() === "READY_FOR_PAYMENT";
}

module.exports = {
  VALID_STATES,
  ALLOWED_TRANSITIONS,
  isValidState,
  isAllowedTransition,
  isTerminalState,
  isPayableStatus,
};
