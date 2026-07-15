"use strict";

const FISCAL_OPERATION_TYPES = Object.freeze({
  SALE_INTERNAL: "sale_internal",
  SALE_INTERSTATE: "sale_interstate",
  RETURN_INTERNAL: "return_internal",
  RETURN_INTERSTATE: "return_interstate",
  TRANSFER: "transfer",
  PURCHASE_RETURN: "purchase_return",
  ADJUSTMENT: "adjustment"
});

/** Operações usadas operacionalmente no Stage 2. */
const FISCAL_OPERATION_TYPES_ACTIVE = Object.freeze([
  FISCAL_OPERATION_TYPES.SALE_INTERNAL
]);

function normalizeFiscalOperationType(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  const allowed = Object.values(FISCAL_OPERATION_TYPES);
  return allowed.includes(normalized) ? normalized : "";
}

function isActiveFiscalOperationType(value = "") {
  return FISCAL_OPERATION_TYPES_ACTIVE.includes(normalizeFiscalOperationType(value));
}

module.exports = {
  FISCAL_OPERATION_TYPES,
  FISCAL_OPERATION_TYPES_ACTIVE,
  normalizeFiscalOperationType,
  isActiveFiscalOperationType
};
