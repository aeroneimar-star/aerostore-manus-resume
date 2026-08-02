"use strict";

const FORBIDDEN_KEYS = new Set([
  "cost", "cost_price", "supplier", "fornecedor", "margin", "margem",
  "available_qty", "reserved_qty", "physical_qty", "store_id", "barcode",
  "legacy_ai_product_id", "source", "notes", "audit", "history",
  "payment_method", "payment_status", "payment_id", "transaction_id",
  "pix_code", "pix_payload", "card_number", "card_token", "infinitepay_id"
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

function orderDto(o = {}) {
  return {
    id: o.id,
    orderNumber: o.order_number,
    fulfillmentType: o.fulfillment_type,
    addressId: o.address_id || null,
    pickupStoreId: o.pickup_store_id || null,
    shippingProvider: o.shipping_provider || "",
    shippingServiceCode: o.shipping_service_code || "",
    shippingQuoteCents: Number(o.shipping_quote_cents || 0),
    shippingQuoteCurrency: o.shipping_quote_currency || "BRL",
    subtotalCents: Number(o.subtotal_cents),
    totalCents: Number(o.total_cents),
    subtotalFormatted: formatCentsBrl(o.subtotal_cents),
    totalFormatted: formatCentsBrl(o.total_cents),
    status: o.status,
    snapshotJson: o.snapshot_json || null,
    expiresAt: o.expires_at || null,
    version: Number(o.version),
    createdAt: o.created_at,
    updatedAt: o.updated_at
  };
}

function orderItemDto(item = {}) {
  return {
    id: item.id,
    orderId: item.order_id,
    productId: item.product_id,
    variantId: item.variant_id,
    productName: item.product_name,
    variantName: item.variant_name,
    quantity: Number(item.quantity),
    unitPriceCents: Number(item.unit_price_cents),
    effectiveUnitPriceCents: Number(item.effective_unit_price_cents),
    promotionName: item.promotion_name || null,
    lineTotalCents: Number(item.line_total_cents),
    version: Number(item.version),
    createdAt: item.created_at
  };
}

function orderSummaryDto(input = {}) {
  return {
    orderNumber: input.orderNumber || "",
    status: input.status || "AWAITING_PAYMENT",
    fulfillmentType: input.fulfillmentType || null,
    items: input.items || [],
    subtotalCents: input.subtotalCents || 0,
    subtotalFormatted: formatCentsBrl(input.subtotalCents || 0),
    shippingPriceCents: input.shippingPriceCents || 0,
    shippingPriceFormatted: formatCentsBrl(input.shippingPriceCents || 0),
    totalCents: input.totalCents || 0,
    totalFormatted: formatCentsBrl(input.totalCents || 0),
    expiresAt: input.expiresAt || null,
    createdAt: input.createdAt || null
  };
}

function reservationDto(r = {}) {
  return {
    id: r.id,
    orderId: r.order_id,
    productId: r.product_id,
    variantId: r.variant_id,
    quantity: Number(r.quantity),
    status: r.status,
    reservedAt: r.reserved_at,
    expiresAt: r.expires_at,
    releasedAt: r.released_at || null,
    version: Number(r.version),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

function eventDto(e = {}) {
  return {
    id: e.id,
    orderId: e.order_id,
    eventType: e.event_type,
    details: e.details_json ? JSON.parse(e.details_json) : null,
    createdAt: e.created_at
  };
}

function envelope(data) {
  const response = { success: true, data, meta: { api_version: "v1" } };
  assertAllowList(response);
  return response;
}

function assertAllowList(value, path = "") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertAllowList(item, `${path}[${index}].`));
    return;
  }
  Object.entries(value).forEach(([key, nested]) => {
    if (FORBIDDEN_KEYS.has(String(key).toLowerCase())) {
      throw new Error(`APP_ORDER_FORBIDDEN_FIELD:${path}${key}`);
    }
    assertAllowList(nested, `${path}${key}.`);
  });
}

class AppOrderError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "AppOrderError";
    this.code = code;
    this.status = status || 400;
  }
}

module.exports = {
  FORBIDDEN_KEYS,
  orderDto,
  orderItemDto,
  orderSummaryDto,
  reservationDto,
  eventDto,
  formatCentsBrl,
  envelope,
  assertAllowList,
  AppOrderError,
  pick
};
