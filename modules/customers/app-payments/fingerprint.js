"use strict";
const crypto = require("crypto");

/**
 * Gera fingerprint determinístico para idempotência.
 *
 * NÃO inclui Date.now() — o fingerprint deve ser 100% determinístico
 * para que retry idêntico gere o mesmo fingerprint.
 *
 * Fingerprint final composto por:
 *   order_id + order_version + total_cents + currency + method + reservation_fingerprint
 *
 * O fingerprint é hash SHA-256 em hex, truncado para 32 caracteres.
 */
function generateFingerprint(params = {}) {
  const {
    order_id,
    order_version,
    amount_cents,
    total_cents,
    currency,
    method,
    reservation_fingerprint,
    reservation_version,
  } = params;

  if (!order_id || (amount_cents === undefined && total_cents === undefined) || !currency || !method) {
    throw new Error("FINGERPRINT_MISSING_REQUIRED_PARAMS");
  }

  const normalized = [
    String(order_id).toUpperCase(),
    String(order_version || ""),
    String(Math.round(Number(total_cents ?? amount_cents) || 0)),
    String(currency || "BRL").toUpperCase(),
    String(method || "PIX").toUpperCase(),
    // Fingerprint real de reserva: canônico dos HOLDs + RELEASEs
    String(reservation_fingerprint || reservation_version || ""),
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
