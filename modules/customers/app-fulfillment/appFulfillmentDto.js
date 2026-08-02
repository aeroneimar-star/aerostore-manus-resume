"use strict";

const FORBIDDEN_KEYS = new Set([
  "cost", "cost_price", "supplier", "fornecedor", "margin", "margem",
  "available_qty", "reserved_qty", "physical_qty", "store_id", "barcode",
  "legacy_ai_product_id", "source", "notes", "audit", "history"
]);

function pick(source = {}, keys = []) {
  return keys.reduce((result, key) => {
    if (source[key] !== undefined) result[key] = source[key];
    return result;
  }, {});
}

function fulfillmentDto(f = {}) {
  return {
    id: f.id,
    cartId: f.cart_id,
    fulfillmentType: f.fulfillment_type,
    addressId: f.address_id || null,
    pickupStoreId: f.pickup_store_id || null,
    shippingProvider: f.shipping_provider || "",
    shippingServiceCode: f.shipping_service_code || "",
    shippingQuoteCents: Number(f.shipping_quote_cents || 0),
    shippingQuoteCurrency: f.shipping_quote_currency || "BRL",
    shippingQuoteExpiresAt: f.shipping_quote_expires_at || null,
    shippingStatus: f.shipping_status || "PENDING",
    version: Number(f.version),
    updatedAt: f.updated_at
  };
}

function storeSummaryDto(store = {}) {
  return {
    id: store.id || "",
    name: store.name || "",
    city: store.city || "",
    state: store.state || "",
    address: store.address || "",
    distance: store.distance || null,
    recommended: Boolean(store.recommended),
    availabilityStatus: store.availabilityStatus || "AVAILABLE",
    openingHours: store.openingHours || null
  };
}

function deliverySummaryDto(input = {}) {
  return {
    fulfillmentType: input.fulfillmentType || null,
    addressSummary: input.addressSummary || null,
    pickupStoreSummary: input.pickupStoreSummary || null,
    shippingMethod: input.shippingMethod || null,
    shippingPriceCents: input.shippingPriceCents || 0,
    shippingPriceFormatted: formatCentsBrl(input.shippingPriceCents || 0),
    estimatedDelivery: input.estimatedDelivery || null,
    cartSubtotalCents: input.cartSubtotalCents || 0,
    cartSubtotalFormatted: formatCentsBrl(input.cartSubtotalCents || 0),
    estimatedTotalCents: (input.cartSubtotalCents || 0) + (input.shippingPriceCents || 0),
    estimatedTotalFormatted: "",
    blockingIssues: input.blockingIssues || [],
    canContinueToCheckoutFuture: input.canContinueToCheckoutFuture || false,
    updatedAt: input.updatedAt || null
  };
}

function formatCentsBrl(cents) {
  const value = Number(cents || 0) / 100;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function assertAllowList(value, path = "") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertAllowList(item, `${path}[${index}].`));
    return;
  }
  Object.entries(value).forEach(([key, nested]) => {
    if (FORBIDDEN_KEYS.has(String(key).toLowerCase())) {
      throw new Error(`APP_FULFILLMENT_FORBIDDEN_FIELD:${path}${key}`);
    }
    assertAllowList(nested, `${path}${key}.`);
  });
}

function envelope(data) {
  const response = { success: true, data, meta: { api_version: "v1" } };
  assertAllowList(response);
  return response;
}

module.exports = { FORBIDDEN_KEYS, fulfillmentDto, storeSummaryDto, deliverySummaryDto, formatCentsBrl, assertAllowList, envelope };
