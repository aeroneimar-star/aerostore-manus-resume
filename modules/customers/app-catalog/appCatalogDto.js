"use strict";

const FORBIDDEN_KEYS = new Set([
  "cost", "cost_price", "cost_price_cents", "supplier", "fornecedor", "margin", "margem",
  "available_qty", "reserved_qty", "physical_qty", "store_id", "barcode", "variant_id",
  "legacy_ai_product_id", "source", "notes", "audit", "history"
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

function listItemDto(product = {}) {
  return {
    ...pick(product, [
      "id", "sku", "slug", "title", "short_description", "brand", "category_slug",
      "category_label", "price_cents", "compare_at_price_cents", "featured", "availability",
      "variant_count", "colors", "color_slugs", "sizes", "action_label", "status_copy",
      "badge_label", "updated_at"
    ]),
    primary_image: product.primary_image ? imageDto(product.primary_image) : null,
    images: Array.isArray(product.images) ? product.images.map(imageDto) : []
  };
}

function detailDto(product = {}) {
  return {
    ...pick(product, [
      "id", "sku", "slug", "title", "short_description", "description", "brand",
      "category_slug", "category_label", "price_cents", "compare_at_price_cents",
      "featured", "availability", "updated_at"
    ]),
    images: Array.isArray(product.images) ? product.images.map(imageDto) : [],
    colors: Array.isArray(product.colors) ? product.colors : [],
    sizes: Array.isArray(product.sizes) ? product.sizes : [],
    variants: Array.isArray(product.variants) ? product.variants.map(variantDto) : []
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
      throw new Error(`APP_CATALOG_FORBIDDEN_FIELD:${path}${key}`);
    }
    assertAllowList(nested, `${path}${key}.`);
  });
}

function envelope(data) {
  const response = { success: true, data, meta: { api_version: "v1" } };
  assertAllowList(response);
  return response;
}

module.exports = { FORBIDDEN_KEYS, listItemDto, detailDto, assertAllowList, envelope };
