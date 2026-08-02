"use strict";

const FORBIDDEN_KEYS = new Set([
  "cvv", "card_number", "card_token", "card_full", "card_full_number",
  "infinitepay_secret", "access_token", "api_secret", "secret_key",
  "webhook_secret", "private_key", "encryption_key", "token",
  "raw_payload", "raw_response", "authorization_header"
]);

function pick(source = {}, keys = []) {
  return keys.reduce((result, key) => {
    if (source[key] !== undefined) result[key] = source[key];
    return result;
  }, {});
}

function formatCentsBrl(cents) {
  const value = Number(cents || 0) / 100;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function maskCardNumber(number) {
  if (!number || typeof number !== "string") return null;
  const clean = number.replace(/\D/g, "");
  if (clean.length < 12) return "****";
  return `****${clean.slice(-4)}`;
}

function paymentDto(p = {}) {
  return {
    id: p.id,
    orderId: p.order_id || p.orderId,
    amountCents: Number(p.amount_cents || p.amountCents || 0),
    amountFormatted: formatCentsBrl(p.amount_cents || p.amountCents || 0),
    currency: p.currency || "BRL",
    description: p.description || "",
    status: p.status,
    paymentMethod: p.payment_method || p.paymentMethod || "PIX",
    gatewayPaymentId: p.gateway_payment_id || p.gatewayPaymentId || null,
    gatewayData: p.gateway_data_json ? safeJsonParse(p.gateway_data_json) : null,
    pixPayload: maskPixPayload(p.pix_payload || p.pixPayload),
    pixCode: maskPixCode(p.pix_code || p.pixCode),
    expiresAt: p.expires_at || p.expiresAt || null,
    attemptCount: Number(p.attempt_count || p.attemptCount || 0),
    version: Number(p.version || 1),
    createdAt: p.created_at || p.createdAt || null,
    updatedAt: p.updated_at || p.updatedAt || null
  };
}

function paymentAttemptDto(a = {}) {
  return {
    id: a.id,
    paymentId: a.payment_id || a.paymentId,
    attemptNumber: Number(a.attempt_number || a.attemptNumber || 1),
    provider: a.provider || "unknown",
    providerPaymentId: a.provider_payment_id || a.providerPaymentId || null,
    gatewayData: a.gateway_data_json ? safeJsonParse(a.gateway_data_json) : null,
    gatewayError: a.gateway_error || a.gatewayError || null,
    status: a.status,
    amountCents: Number(a.amount_cents || a.amountCents || 0),
    amountFormatted: formatCentsBrl(a.amount_cents || a.amountCents || 0),
    currency: a.currency || "BRL",
    createdAt: a.created_at || a.createdAt || null,
    updatedAt: a.updated_at || a.updatedAt || null
  };
}

function paymentEventDto(e = {}) {
  return {
    id: e.id,
    paymentId: e.payment_id || e.paymentId,
    eventType: e.event_type || e.eventType,
    details: e.details_json ? safeJsonParse(e.details_json) : (e.details || null),
    createdAt: e.created_at || e.createdAt || null
  };
}

function safeJsonParse(json) {
  try {
    const parsed = JSON.parse(json);
    const sanitized = assertAllowList(parsed);
    return sanitized;
  } catch {
    return null;
  }
}

function assertAllowList(value, path = "") {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => assertAllowList(item, `${path}[${index}].`));
  }
  const result = {};
  Object.entries(value).forEach(([key, nested]) => {
    if (FORBIDDEN_KEYS.has(String(key).toLowerCase())) {
      throw new PaymentError("FORBIDDEN_FIELD", 500, `APP_PAYMENT_FORBIDDEN_FIELD:${path}${key}`);
    }
    result[key] = assertAllowList(nested, `${path}${key}.`);
  });
  return result;
}

function maskPixPayload(payload) {
  if (!payload) return null;
  if (typeof payload !== "string") return null;
  if (payload.length > 200) return `${payload.slice(0, 50)}...[${payload.length - 100} chars omitted]...${payload.slice(-20)}`;
  return payload;
}

function maskPixCode(code) {
  if (!code) return null;
  if (typeof code !== "string") return null;
  if (code.length > 50) return `${code.slice(0, 10)}****${code.slice(-4)}`;
  return code;
}

function envelope(data) {
  const response = { success: true, data, meta: { api_version: "v1" } };
  assertAllowList(response);
  return response;
}

class PaymentError extends Error {
  constructor(code, status, message) {
    super(message || code);
    this.name = "PaymentError";
    this.code = code;
    this.status = status || 400;
  }
}

module.exports = {
  FORBIDDEN_KEYS,
  paymentDto,
  paymentAttemptDto,
  paymentEventDto,
  formatCentsBrl,
  maskCardNumber,
  maskPixPayload,
  maskPixCode,
  safeJsonParse,
  assertAllowList,
  envelope,
  PaymentError,
  pick
};
