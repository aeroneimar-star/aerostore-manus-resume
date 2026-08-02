"use strict";

function pick(source = {}, keys = []) {
  const result = {};
  for (const k of keys) {
    if (source[k] !== undefined) result[k] = source[k];
  }
  return result;
}

function formatCentsBrl(cents) {
  if (typeof cents !== "number") return "0,00";
  return (cents / 100).toFixed(2).replace(".", ",");
}

function orderDto(o = {}) {
  return {
    id: o.id || null,
    order_number: o.order_number || null,
    account_id: o.account_id || null,
    fulfillment_type: o.fulfillment_type || null,
    address_id: o.address_id || null,
    pickup_store_id: o.pickup_store_id || null,
    shipping_provider: o.shipping_provider || null,
    shipping_service_code: o.shipping_service_code || null,
    shipping_quote_cents: o.shipping_quote_cents || null,
    subtotal_cents: o.subtotal_cents || 0,
    total_cents: o.total_cents || 0,
    status: o.status || null,
    created_at: o.created_at || null,
    updated_at: o.updated_at || null,
    expires_at: o.expires_at || null,
    expired_at: o.expired_at || null,
    failed_reason: o.failed_reason || null,
  };
}

function orderItemDto(item = {}) {
  return {
    id: item.id || null,
    order_id: item.order_id || null,
    product_id: item.product_id || null,
    variant_id: item.variant_id || null,
    quantity: item.quantity || 0,
    unit_price_cents: item.unit_price_cents || 0,
    effective_unit_price_cents: item.effective_unit_price_cents || 0,
    line_total_cents: item.line_total_cents || 0,
    availability_status: item.availability_status || "UNKNOWN",
    created_at: item.created_at || null,
  };
}

function orderSummaryDto(input = {}) {
  return {
    order_number: input.order_number || null,
    fulfillment_type: input.fulfillment_type || null,
    store_label: input.store_label || null,
    subtotal: formatCentsBrl(input.subtotal_cents),
    shipping: formatCentsBrl(input.shipping_quote_cents || 0),
    total: formatCentsBrl(input.total_cents),
    status: input.status || null,
    items_count: input.items_count || 0,
  };
}

function reservationDto(r = {}) {
  return {
    reservation_id: r.reservation_id || null,
    order_id: r.order_id || null,
    store_id: r.store_id || null,
    status: r.status || null,
    items: r.items || [],
  };
}

function eventDto(e = {}) {
  return {
    id: e.id || null,
    order_id: e.order_id || null,
    event_type: e.event_type || null,
    details_json: e.details_json || null,
    created_at: e.created_at || null,
  };
}

function envelope(data) {
  return { ok: true, data };
}

function assertAllowList(value, path = "") {
  return value || null;
}

module.exports = {
  pick,
  formatCentsBrl,
  orderDto,
  orderItemDto,
  orderSummaryDto,
  reservationDto,
  eventDto,
  envelope,
  assertAllowList,
};
