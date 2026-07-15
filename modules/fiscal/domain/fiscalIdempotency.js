"use strict";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function buildFiscalIdempotencyKey({
  saleId = "",
  model = "65",
  purpose = "sale_emit"
} = {}) {
  const sale = normalizeText(saleId);
  const docModel = normalizeText(model) || "65";
  const docPurpose = normalizeText(purpose) || "sale_emit";
  if (!sale) {
    const error = new Error("sale_id e obrigatorio para gerar idempotency_key fiscal.");
    error.code = "FISCAL_IDEMPOTENCY_SALE_REQUIRED";
    error.statusCode = 400;
    throw error;
  }
  return `sale:${sale}:model:${docModel}:purpose:${docPurpose}`;
}

module.exports = {
  buildFiscalIdempotencyKey
};
