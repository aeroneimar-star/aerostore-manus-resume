"use strict";
const crypto = require("crypto");

/**
 * Gera fingerprint determinístico para idempotência.
 *
 * Combinação: order_id + amount_cents + currency + method + snapshot/version
 *
 * O fingerprint é hash SHA-256 em hex, truncado para 32 caracteres.
 * Garante que retry idêntico gera o mesmo fingerprint.
 */
function generateFingerprint(params = {}) {
  const {
    order_id,
    amount_cents,
    currency,
    method,
    order_version,
    reservation_version,
  } = params;

  if (!order_id || !amount_cents || !currency || !method) {
    throw new Error("FINGERPRINT_MISSING_REQUIRED_PARAMS");
  }

  const normalized = [
    String(order_id).toUpperCase(),
    String(Math.round(Number(amount_cents) || 0)),
    String(currency || "BRL").toUpperCase(),
    String(method || "PIX").toUpperCase(),
    String(order_version || ""),
    String(reservation_version || ""),
  ].join("::");

  const hash = crypto.createHash("sha256").update(normalized).digest("hex");
  return hash.substring(0, 32);
}

/**
 * Verifica se dois fingerprints são equivalentes.
 */
function fingerprintsMatch(fp1, fp2) {
  return String(fp1 || "").toUpperCase() === String(fp2 || "").toUpperCase();
}

module.exports = {
  generateFingerprint,
  fingerprintsMatch,
};
