"use strict";

/**
 * Sanitiza resposta do provider removendo dados sensíveis.
 *
 * Estratégia: ALLOWLIST de campos públicos + BLACKLIST de campos sensíveis.
 *
 * Campos SENSÍVEIS (redactados):
 * - access_token / token / api_key / secret
 * - card_number / card / credit_card
 * - cvv / cvc
 * - customer (objeto inteiro com PII aninhada)
 * - email
 * - phone_number / phone / celular
 * - address / endereco
 * - document / cpf / cnpj
 * - receipt data com PII
 * - headers de autenticação
 * - dados desconhecidos não permitidos
 *
 * Campos PÚBLICOS (preservados):
 * - url / checkout_url
 * - order_nsu / transaction_nsu / invoice_slug / slug
 * - amount / paid_amount / price
 * - status / paid / success
 * - capture_method
 * - items (sem dados sensíveis)
 */

const SENSITIVE_KEYS = new Set([
  "access_token",
  "token",
  "api_key",
  "secret",
  "card_number",
  "card",
  "credit_card",
  "cvv",
  "cvc",
  "authorization_code",
  "pix_copia_e_cola_base64",
  "customer",
  "email",
  "phone_number",
  "phone",
  "celular",
  "address",
  "endereco",
  "document",
  "cpf",
  "cnpj",
  "receipt",
  "authorization",
  "auth",
]);

const PUBLIC_KEYS = new Set([
  "url",
  "checkout_url",
  "order_nsu",
  "transaction_nsu",
  "invoice_slug",
  "slug",
  "amount",
  "paid_amount",
  "price",
  "status",
  "paid",
  "success",
  "capture_method",
  "installments",
  "items",
  "id",
  "created_at",
  "updated_at",
  "handle",
  "redirect_url",
  "webhook_url",
  "payment_method",
  "pix_copia_e_cola",
  "base64",
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

    // BLACKLIST: campos sensíveis
    if (SENSITIVE_KEYS.has(lowerKey)) {
      sanitized[key] = "[REDACTED]";
      continue;
    }

    // ALLOWLIST: apenas campos públicos conhecidos
    if (PUBLIC_KEYS.has(lowerKey)) {
      sanitized[key] = sanitizeResponse(value, `${path}.${key}`);
      continue;
    }

    // Campos desconhecidos: redactar por segurança
    sanitized[key] = "[UNKNOWN_FIELD_REDACTED]";
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
  PUBLIC_KEYS,
};
