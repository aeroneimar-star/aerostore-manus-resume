"use strict";

/**
 * Sanitiza resposta do provider removendo dados sensíveis.
 *
 * Remove ou redacta:
 * - access_token / token / api_key / secret
 * - card_number / card / credit_card
 * - cvv / cvc
 * - pix_qr_code_base64 (preserva se for URL pública)
 *
 * Preserva:
 * - url / checkout_url
 * - order_nsu / transaction_nsu
 * - amount / paid_amount
 * - status
 * - capture_method
 */

const SENSITIVE_KEYS = new Set([
  "access_token",
  "token",
  "api_key",
  "secret",
  "card_number",
  "card",
  "cvv",
  "cvc",
  "authorization_code",
  "pix_copia_e_cola_base64",
]);

function sanitizeResponse(data, path = "") {
  if (data === null || data === undefined) {
    return null;
  }
  if (typeof data === "string") {
    return data.length > 500 ? data.substring(0, 500) : data;
  }
  if (typeof data !== "object") {
    return data;
  }
  if (Array.isArray(data)) {
    return data.slice(0, 50).map((item) => sanitizeResponse(item, path));
  }
  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey)) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = sanitizeResponse(value, `${path}.${key}`);
    }
  }
  return sanitized;
}

function sanitizeFailureMessage(message) {
  if (!message || typeof message !== "string") {
    return "";
  }
  return message.substring(0, 255);
}

module.exports = {
  sanitizeResponse,
  sanitizeFailureMessage,
  SENSITIVE_KEYS,
};
