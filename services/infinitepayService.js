"use strict";

const INFINITEPAY_DEFAULT_BASE_URL = "https://api.checkout.infinitepay.io";
const INFINITEPAY_SUPPORTED_PROVIDERS = new Set(["infinitepay", "pagbank"]);
const INFINITEPAY_ALLOWED_CAPTURE_METHODS = new Set(["credit_card", "pix"]);
const INFINITEPAY_MIN_INSTALLMENTS = 1;
const INFINITEPAY_MAX_INSTALLMENTS = 12;
const INFINITEPAY_AMOUNT_TOLERANCE_CENTS = 1;

class InfinitePayError extends Error {
  constructor(message, { statusCode = 400, details = null } = {}) {
    super(message);
    this.name = "InfinitePayError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

function normalizeText(value = "", fallback = "") {
  return String(value || fallback || "").trim();
}

function toFiniteNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundMoney(value) {
  const numeric = toFiniteNumber(value);
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function toCents(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.round(numeric * 100);
}

function toSafeInteger(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const integer = Math.round(numeric);
  return Number.isFinite(integer) ? integer : 0;
}

function toCentsFromReais(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.round(numeric * 100);
}

function normalizePhone(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  if (digits.startsWith("55") && digits.length >= 12) {
    return `+${digits}`;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }
  return digits.startsWith("+") ? `+${digits.replace(/\D/g, "")}` : `+${digits}`;
}

function isInfinitePayReady() {
  return Boolean(getInfinitePayHandle() && getInfinitePayRedirectUrl() && getInfinitePayWebhookUrl());
}

function getActivePaymentProvider() {
  const raw = normalizeText(process.env.PAYMENT_PROVIDER || "pagbank").toLowerCase();
  if (raw === "infinitepay" && !isInfinitePayReady()) {
    return "pagbank";
  }
  return INFINITEPAY_SUPPORTED_PROVIDERS.has(raw) ? raw : "pagbank";
}

function getInfinitePayHandle() {
  const raw = normalizeText(process.env.INFINITEPAY_HANDLE || "").replace(/^\$/, "");
  return raw;
}

function getInfinitePayRedirectUrl() {
  return normalizeText(
    process.env.INFINITEPAY_REDIRECT_URL
    || process.env.PAGBANK_REDIRECT_URL
    || "http://localhost:3000/pdv/pagamento/infinitepay/retorno"
  );
}

function getInfinitePayWebhookUrl() {
  return normalizeText(
    process.env.INFINITEPAY_WEBHOOK_URL
    || "http://localhost:3000/api/pdv/payments/infinitepay/webhook"
  );
}

function getInfinitePayConfig() {
  return {
    provider: getActivePaymentProvider(),
    configured: getActivePaymentProvider() === "infinitepay",
    ready: isInfinitePayReady(),
    handle: getInfinitePayHandle(),
    redirectUrl: getInfinitePayRedirectUrl(),
    webhookUrl: getInfinitePayWebhookUrl(),
    baseUrl: INFINITEPAY_DEFAULT_BASE_URL
  };
}

function ensureInfinitePayHandle(message) {
  const handle = getInfinitePayHandle();
  if (!handle) {
    throw new InfinitePayError(message || "INFINITEPAY_HANDLE ausente. Configure a InfiniteTag antes de gerar link de pagamento.", {
      statusCode: 400,
      details: { reason: "missing_handle" }
    });
  }
  return handle;
}

function buildInfinitePayCustomer(customer = {}) {
  const name = normalizeText(customer.name) || "Cliente AEROSTORE";
  const email = normalizeText(customer.email);
  const phone = normalizePhone(customer.phone || customer.whatsapp || "");
  const payload = { name };
  if (email) {
    payload.email = email;
  }
  if (phone) {
    payload.phone_number = phone;
  }
  return payload;
}

function buildInfinitePayItems(items = []) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    throw new InfinitePayError("Adicione pelo menos 1 item antes de gerar o link InfinitePay.", { statusCode: 400 });
  }
  const built = [];
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index] || {};
    const quantity = Math.max(1, Math.round(toFiniteNumber(item.quantity || 1)));
    const unitPrice = roundMoney(toFiniteNumber(item.unitPrice || item.price || 0));
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      continue;
    }
    const description = normalizeText(item.name || item.description || item.sku || `Item ${index + 1}`).slice(0, 255) || `Item ${index + 1}`;
    const priceCents = toCentsFromReais(unitPrice);
    if (priceCents <= 0) {
      continue;
    }
    built.push({
      quantity,
      price: priceCents,
      description
    });
  }
  if (!built.length) {
    throw new InfinitePayError("Itens invalidos para gerar o link InfinitePay. Verifique valores e quantidades.", {
      statusCode: 400,
      details: { reason: "empty_items" }
    });
  }
  return built;
}

function computeInfinitePayItemsTotalCents(items = []) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const quantity = Math.max(1, Math.round(toFiniteNumber(item.quantity || 1)));
    const rawPrice = toFiniteNumber(item.price || item.unitPrice || 0);
    const priceAlreadyInCents = Math.abs(rawPrice) >= 100 && Number.isInteger(rawPrice);
    const priceCents = priceAlreadyInCents ? toSafeInteger(rawPrice) : toCentsFromReais(rawPrice);
    return sum + (quantity * priceCents);
  }, 0);
}

function buildInfinitePayPayload(input = {}) {
  const handle = ensureInfinitePayHandle("INFINITEPAY_HANDLE ausente. Configure a InfiniteTag antes de gerar link de pagamento.");
  const items = buildInfinitePayItems(input.items || []);
  const expectedTotalCents = toSafeInteger(input.expectedTotalCents || input.expected_total_cents || 0);
  const itemsTotalCents = computeInfinitePayItemsTotalCents(items);
  if (expectedTotalCents > 0 && Math.abs(expectedTotalCents - itemsTotalCents) > 1) {
    throw new InfinitePayError("Total dos itens diverge do total esperado da venda. Verifique valores antes de gerar o link.", {
      statusCode: 400,
      details: {
        reason: "total_mismatch",
        expected_total_cents: expectedTotalCents,
        items_total_cents: itemsTotalCents
      }
    });
  }
  const orderNsu = normalizeText(input.order_nsu || input.orderNsu || input.sale_id || "");
  if (!orderNsu) {
    throw new InfinitePayError("order_nsu obrigatorio para gerar o link InfinitePay (use o id da venda do PDV).", {
      statusCode: 400,
      details: { reason: "missing_order_nsu" }
    });
  }
  const payload = {
    handle,
    order_nsu: orderNsu,
    items,
    customer: buildInfinitePayCustomer(input.customer || {})
  };
  const redirectUrl = normalizeText(input.redirect_url || getInfinitePayRedirectUrl());
  if (redirectUrl) {
    payload.redirect_url = redirectUrl;
  }
  const webhookUrl = normalizeText(input.webhook_url || getInfinitePayWebhookUrl());
  if (webhookUrl) {
    payload.webhook_url = webhookUrl;
  }
  return {
    payload,
    itemsTotalCents
  };
}

function getInfinitePayHeaders() {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "AEROSTORE-OS/PDV"
  };
}

async function parseInfinitePayResponse(response) {
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (error) {
    json = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    body: json,
    rawText: text
  };
}

async function postInfinitePayLinks(payload) {
  const response = await fetch(`${INFINITEPAY_DEFAULT_BASE_URL}/links`, {
    method: "POST",
    headers: getInfinitePayHeaders(),
    body: JSON.stringify(payload)
  });
  const parsed = await parseInfinitePayResponse(response);
  return { response, parsed };
}

async function postInfinitePayPaymentCheck(payload) {
  const response = await fetch(`${INFINITEPAY_DEFAULT_BASE_URL}/payment_check`, {
    method: "POST",
    headers: getInfinitePayHeaders(),
    body: JSON.stringify(payload)
  });
  const parsed = await parseInfinitePayResponse(response);
  return { response, parsed };
}

function extractCheckoutUrl(parsed) {
  const body = parsed?.body;
  if (!body || typeof body !== "object") {
    return "";
  }
  return normalizeText(body.url || body.checkout_url || body.payment_url || body.link || "");
}

function buildInfinitePayErrorDetails(parsed = {}, sanitizedPayload = {}) {
  return {
    providerStatus: parsed.status || 0,
    providerBody: parsed.body || parsed.rawText || "",
    rawText: parsed.rawText || "",
    sanitizedPayload
  };
}

function normalizeInfinitePayWebhookPayload(payload = {}) {
  const body = payload && typeof payload === "object" ? payload : {};
  const nested = body.data && typeof body.data === "object" ? body.data : {};
  const pick = (...values) => {
    for (const value of values) {
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }
    return "";
  };
  const captureMethod = normalizeText(pick(body.capture_method, nested.capture_method)).toLowerCase();
  return {
    invoice_slug: normalizeText(pick(body.invoice_slug, nested.invoice_slug, body.slug, nested.slug)),
    amount_cents: toSafeInteger(pick(body.amount_cents, nested.amount_cents, toFiniteNumber(pick(body.amount, nested.amount)) * 100)),
    paid_amount_cents: toSafeInteger(pick(body.paid_amount_cents, nested.paid_amount_cents, toFiniteNumber(pick(body.paid_amount, nested.paid_amount)) * 100)),
    installments: normalizeSafeInstallments(pick(body.installments, nested.installments, 1)),
    capture_method: isAllowedCaptureMethod(captureMethod) ? captureMethod : "",
    transaction_nsu: normalizeText(pick(body.transaction_nsu, nested.transaction_nsu, body.transaction_id, nested.transaction_id)),
    order_nsu: normalizeText(pick(body.order_nsu, nested.order_nsu, body.order_id, nested.order_id)),
    receipt_url: normalizeText(pick(body.receipt_url, nested.receipt_url, body.receipt, nested.receipt)),
    status: normalizeText(pick(body.status, nested.status, body.payment_status, nested.payment_status)).toUpperCase(),
    items: Array.isArray(body.items) ? body.items : (Array.isArray(nested.items) ? nested.items : []),
    raw: body
  };
}

function isInfinitePaidStatus(status = "") {
  const normalized = String(status || "").toUpperCase();
  return ["PAID", "APPROVED", "AUTHORIZED", "COMPLETED", "SUCCEEDED", "RECEIVED"].includes(normalized);
}

function isAllowedCaptureMethod(method = "") {
  if (!method) {
    return false;
  }
  return INFINITEPAY_ALLOWED_CAPTURE_METHODS.has(String(method || "").toLowerCase());
}

function isInstallmentsInRange(value) {
  const numeric = Math.round(toFiniteNumber(value));
  return Number.isFinite(numeric)
    && numeric >= INFINITEPAY_MIN_INSTALLMENTS
    && numeric <= INFINITEPAY_MAX_INSTALLMENTS;
}

function normalizeSafeInstallments(value) {
  if (!isInstallmentsInRange(value)) {
    return 0;
  }
  return Math.round(toFiniteNumber(value));
}

async function createInfinitePayLink(input = {}) {
  const { payload, itemsTotalCents } = buildInfinitePayPayload(input);
  const sanitizedPayload = JSON.parse(JSON.stringify(payload));
  const { response, parsed } = await postInfinitePayLinks(payload);
  const url = extractCheckoutUrl(parsed);
  if (!parsed.ok || !url) {
    throw new InfinitePayError(
      "Nao foi possivel gerar o link InfinitePay. Verifique handle, dados enviados e status da API.",
      {
        statusCode: parsed.status || 502,
        details: buildInfinitePayErrorDetails(parsed, sanitizedPayload)
      }
    );
  }
  return {
    success: true,
    provider: "infinitepay",
    url,
    invoice_slug: normalizeText(parsed.body?.invoice_slug || parsed.body?.slug || ""),
    order_nsu: payload.order_nsu,
    amount_cents: itemsTotalCents,
    raw: parsed.body || {},
    payload: sanitizedPayload
  };
}

async function checkInfinitePayPayment(input = {}) {
  const handle = ensureInfinitePayHandle("INFINITEPAY_HANDLE ausente. Configure a InfiniteTag antes de consultar pagamento.");
  const payload = {};
  const orderNsu = normalizeText(input.order_nsu || input.orderNsu || "");
  const transactionNsu = normalizeText(input.transaction_nsu || input.transactionNsu || "");
  const slug = normalizeText(input.slug || input.invoice_slug || "");
  payload.handle = handle;
  if (orderNsu) payload.order_nsu = orderNsu;
  if (transactionNsu) payload.transaction_nsu = transactionNsu;
  if (slug) payload.slug = slug;
  if (!payload.order_nsu && !payload.transaction_nsu && !payload.slug) {
    throw new InfinitePayError("Informe order_nsu, transaction_nsu ou slug para consultar pagamento na InfinitePay.", {
      statusCode: 400,
      details: { reason: "missing_identifier" }
    });
  }
  const { response, parsed } = await postInfinitePayPaymentCheck(payload);
  if (!parsed.ok) {
    throw new InfinitePayError("Nao foi possivel consultar pagamento na InfinitePay.", {
      statusCode: parsed.status || 502,
      details: buildInfinitePayErrorDetails(parsed, payload)
    });
  }
  const body = parsed.body && typeof parsed.body === "object" ? parsed.body : {};
  const status = normalizeText(body.status || body.payment_status || "").toUpperCase();
  const paid = isInfinitePaidStatus(status);
  return {
    success: parsed.ok && Boolean(body),
    provider: "infinitepay",
    invoice_slug: normalizeText(body.invoice_slug || body.slug || slug),
    transaction_nsu: normalizeText(body.transaction_nsu || body.transaction_id || transactionNsu),
    order_nsu: normalizeText(body.order_nsu || orderNsu),
    receipt_url: normalizeText(body.receipt_url || body.receipt || ""),
    amount_cents: toSafeInteger(body.amount_cents || (toFiniteNumber(body.amount) * 100)),
    paid_amount_cents: toSafeInteger(body.paid_amount_cents || (toFiniteNumber(body.paid_amount) * 100)),
    installments: normalizeSafeInstallments(body.installments || 1),
    capture_method: isAllowedCaptureMethod(body.capture_method) ? String(body.capture_method).toLowerCase() : "",
    status,
    paid,
    raw: body
  };
}

module.exports = {
  InfinitePayError,
  INFINITEPAY_MIN_INSTALLMENTS,
  INFINITEPAY_MAX_INSTALLMENTS,
  INFINITEPAY_AMOUNT_TOLERANCE_CENTS,
  getActivePaymentProvider,
  getInfinitePayConfig,
  getInfinitePayHandle,
  getInfinitePayRedirectUrl,
  getInfinitePayWebhookUrl,
  isInfinitePayReady,
  isAllowedCaptureMethod,
  isInstallmentsInRange,
  normalizeSafeInstallments,
  computeInfinitePayItemsTotalCents,
  buildInfinitePayPayload,
  createInfinitePayLink,
  checkInfinitePayPayment,
  normalizeInfinitePayWebhookPayload,
  isInfinitePaidStatus
};