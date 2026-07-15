"use strict";

const FISCAL_STATUSES = Object.freeze({
  NOT_REQUESTED: "NOT_REQUESTED",
  PENDING: "PENDING",
  QUEUED: "QUEUED",
  PROCESSING: "PROCESSING",
  AUTHORIZED: "AUTHORIZED",
  REJECTED: "REJECTED",
  ERROR_RETRYABLE: "ERROR_RETRYABLE",
  ERROR_FINAL: "ERROR_FINAL",
  CANCELLATION_PENDING: "CANCELLATION_PENDING",
  CANCELLED: "CANCELLED"
});

/**
 * Transições permitidas na máquina v1.
 * NOT_REQUESTED só existe conceitualmente (antes do registro); a criação grava PENDING.
 */
const FISCAL_STATUS_TRANSITIONS = Object.freeze({
  [FISCAL_STATUSES.NOT_REQUESTED]: [FISCAL_STATUSES.PENDING],
  [FISCAL_STATUSES.PENDING]: [
    FISCAL_STATUSES.QUEUED,
    FISCAL_STATUSES.PROCESSING,
    FISCAL_STATUSES.REJECTED,
    FISCAL_STATUSES.ERROR_RETRYABLE,
    FISCAL_STATUSES.ERROR_FINAL,
    FISCAL_STATUSES.CANCELLED
  ],
  [FISCAL_STATUSES.QUEUED]: [
    FISCAL_STATUSES.PROCESSING,
    FISCAL_STATUSES.ERROR_RETRYABLE,
    FISCAL_STATUSES.ERROR_FINAL,
    FISCAL_STATUSES.CANCELLED
  ],
  [FISCAL_STATUSES.PROCESSING]: [
    FISCAL_STATUSES.AUTHORIZED,
    FISCAL_STATUSES.REJECTED,
    FISCAL_STATUSES.ERROR_RETRYABLE,
    FISCAL_STATUSES.ERROR_FINAL
  ],
  [FISCAL_STATUSES.AUTHORIZED]: [
    FISCAL_STATUSES.CANCELLATION_PENDING
  ],
  [FISCAL_STATUSES.REJECTED]: [
    FISCAL_STATUSES.PENDING,
    FISCAL_STATUSES.ERROR_FINAL,
    FISCAL_STATUSES.CANCELLED
  ],
  [FISCAL_STATUSES.ERROR_RETRYABLE]: [
    FISCAL_STATUSES.QUEUED,
    FISCAL_STATUSES.PROCESSING,
    FISCAL_STATUSES.ERROR_FINAL,
    FISCAL_STATUSES.CANCELLED
  ],
  [FISCAL_STATUSES.ERROR_FINAL]: [
    FISCAL_STATUSES.CANCELLED
  ],
  [FISCAL_STATUSES.CANCELLATION_PENDING]: [
    FISCAL_STATUSES.CANCELLED,
    FISCAL_STATUSES.ERROR_RETRYABLE,
    FISCAL_STATUSES.AUTHORIZED
  ],
  [FISCAL_STATUSES.CANCELLED]: []
});

function normalizeFiscalStatus(value = "") {
  const normalized = String(value || "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(FISCAL_STATUSES, normalized)
    ? FISCAL_STATUSES[normalized]
    : "";
}

function isValidFiscalStatus(value = "") {
  return Boolean(normalizeFiscalStatus(value));
}

function canTransitionFiscalStatus(fromStatus, toStatus) {
  const from = normalizeFiscalStatus(fromStatus);
  const to = normalizeFiscalStatus(toStatus);
  if (!from || !to) {
    return false;
  }
  const allowed = FISCAL_STATUS_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

function assertFiscalStatusTransition(fromStatus, toStatus) {
  const from = normalizeFiscalStatus(fromStatus) || String(fromStatus || "").trim() || "(vazio)";
  const to = normalizeFiscalStatus(toStatus) || String(toStatus || "").trim() || "(vazio)";
  if (!canTransitionFiscalStatus(fromStatus, toStatus)) {
    const error = new Error(`Transicao fiscal invalida: ${from} -> ${to}`);
    error.code = "FISCAL_INVALID_STATUS_TRANSITION";
    error.statusCode = 400;
    error.from_status = from;
    error.to_status = to;
    throw error;
  }
  return {
    from_status: normalizeFiscalStatus(fromStatus),
    to_status: normalizeFiscalStatus(toStatus)
  };
}

module.exports = {
  FISCAL_STATUSES,
  FISCAL_STATUS_TRANSITIONS,
  normalizeFiscalStatus,
  isValidFiscalStatus,
  canTransitionFiscalStatus,
  assertFiscalStatusTransition
};
