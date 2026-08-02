"use strict";

const FORBIDDEN_KEYS = new Set([
  "cost", "cost_price", "cost_price_cents", "supplier", "fornecedor", "margin", "margem",
  "available_qty", "reserved_qty", "physical_qty", "store_id", "barcode",
  "legacy_ai_product_id", "source", "notes", "audit", "history", "product_snapshot_json",
  "removed_at"
]);

function pick(source = {}, keys = []) {
  return keys.reduce((result, key) => {
    if (source[key] !== undefined) result[key] = source[key];
    return result;
  }, {});
}

function imageDto(image = {}) {
  return pick(image, ["url", "alt", "sort_order", "role"]);
}

function variantDto(variant = {}) {
  return pick(variant, [
    "slug", "color", "color_slug", "size", "size_slug", "price_cents",
    "compare_at_price_cents", "availability"
  ]);
}

function cartItemDto(item = {}) {
  const snapshot = (() => {
    try { return JSON.parse(item.product_snapshot_json || "{}"); } catch { return {}; }
  })();
  return {
    id: item.id,
    product_id: item.product_id,
    variant_id: item.variant_id,
    quantity: Number(item.quantity),
    unit_price_cents: Number(item.unit_price_cents),
    promotional_price_cents: item.promotional_price_cents ? Number(item.promotional_price_cents) : null,
    effective_unit_price_cents: Number(item.effective_unit_price_cents),
    line_total_cents: Number(item.line_total_cents),
    availability: item.availability_status || "in_stock",
    version: Number(item.version),
    updated_at: item.updated_at,
    product: {
      id: item.product_id,
      title: snapshot.title || "",
      brand: snapshot.brand || "",
      category_label: snapshot.category_label || "",
      color: snapshot.color || "",
      size: snapshot.size || "",
      sku: snapshot.sku || "",
      primary_image: snapshot.primary_image ? imageDto(snapshot.primary_image) : null
    }
  };
}

function cartDto(cart = {}, items = []) {
  return {
    id: cart.id,
    status: cart.status,
    currency: cart.currency || "BRL",
    item_count: Number(cart.item_count),
    subtotal_cents: Number(cart.subtotal_cents),
    version: Number(cart.version),
    updated_at: cart.updated_at,
    items: items.map(cartItemDto)
  };
}

function assertAllowList(value, path = "") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertAllowList(item, `${path}[${index}].`));
    return;
  }
  Object.entries(value).forEach(([key, nested]) => {
    if (FORBIDDEN_KEYS.has(String(key).toLowerCase())) {
      throw new Error(`APP_CART_FORBIDDEN_FIELD:${path}${key}`);
    }
    assertAllowList(nested, `${path}${key}.`);
  });
}

function envelope(data) {
  const response = { success: true, data, meta: { api_version: "v1" } };
  assertAllowList(response);
  return response;
}

module.exports = { FORBIDDEN_KEYS, cartDto, cartItemDto, assertAllowList, envelope };
