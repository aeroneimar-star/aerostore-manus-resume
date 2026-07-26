"use strict";

const B2C_API_VERSION = "v1";

const B2C_FORBIDDEN_KEYS = new Set([
  "id",
  "internal_id",
  "product_id",
  "pdv_product_ref",
  "publication_id",
  "variant_id",
  "legacy_ai_product_id",
  "tiny_id",
  "sku",
  "barcode",
  "cost",
  "cost_cents",
  "cost_price_cents",
  "store_id",
  "available_qty",
  "reserved_qty",
  "local_path",
  "metadata_json",
  "margin",
  "notes",
  "source"
]);

function pickDefined(source = {}, keys = []) {
  const result = {};
  for (const key of keys) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

function normalizeImage(image = {}) {
  return pickDefined(image, ["url", "alt", "sort_order", "role", "color_slug"]);
}

function normalizeVariant(variant = {}) {
  return pickDefined(variant, [
    "slug",
    "color",
    "color_slug",
    "size",
    "size_slug",
    "price_cents",
    "compare_at_price_cents",
    "availability"
  ]);
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value
      .filter((item) => typeof item === "string" || typeof item === "number")
      .map((item) => String(item))
    : [];
}

function normalizeListItem(item = {}) {
  const normalized = pickDefined(item, [
    "slug",
    "title",
    "short_description",
    "category_slug",
    "category_label",
    "price_cents",
    "compare_at_price_cents",
    "featured",
    "availability",
    "variant_count",
    "action_label",
    "status_copy",
    "badge_label"
  ]);
  normalized.colors = normalizeStringArray(item.colors);
  normalized.color_slugs = normalizeStringArray(item.color_slugs);
  normalized.sizes = normalizeStringArray(item.sizes);
  if (item.primary_image !== undefined) {
    normalized.primary_image = item.primary_image
      ? normalizeImage(item.primary_image)
      : item.primary_image;
  }
  return normalized;
}

function normalizeProduct(product = {}) {
  const normalized = pickDefined(product, [
    "slug",
    "title",
    "short_description",
    "description",
    "category_slug",
    "category_label",
    "price_cents",
    "compare_at_price_cents",
    "featured",
    "availability"
  ]);
  normalized.images = Array.isArray(product.images)
    ? product.images.map(normalizeImage)
    : [];
  normalized.variants = Array.isArray(product.variants)
    ? product.variants.map(normalizeVariant)
    : [];
  if (product.seo && typeof product.seo === "object" && !Array.isArray(product.seo)) {
    normalized.seo = pickDefined(product.seo, ["title", "description"]);
  }
  return normalized;
}

function normalizeFilter(filter = {}) {
  return pickDefined(filter, ["slug", "label", "count"]);
}

function assertNoB2cForbiddenKeys(value, path = "") {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoB2cForbiddenKeys(item, `${path}[${index}].`));
    return;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    if (B2C_FORBIDDEN_KEYS.has(String(key).toLowerCase())) {
      throw new Error(`Campo interno proibido no contrato B2C: ${path}${key}`);
    }
    assertNoB2cForbiddenKeys(nestedValue, `${path}${key}.`);
  }
}

function withMeta(payload) {
  const response = {
    success: true,
    data: payload,
    meta: {
      api_version: B2C_API_VERSION
    }
  };
  assertNoB2cForbiddenKeys(response);
  return response;
}

function toB2cCatalogResponse(sourcePayload = {}) {
  return withMeta({
    items: Array.isArray(sourcePayload.items)
      ? sourcePayload.items.map(normalizeListItem)
      : [],
    pagination: {
      page: Number(sourcePayload.page || 1),
      limit: Number(sourcePayload.limit || 0),
      total: Number(sourcePayload.total || 0),
      total_pages: Number(sourcePayload.total_pages || 0)
    },
    filters: {
      categories: Array.isArray(sourcePayload.filters?.categories)
        ? sourcePayload.filters.categories.map(normalizeFilter)
        : []
    }
  });
}

function toB2cFiltersResponse(sourcePayload = {}) {
  return withMeta({
    categories: Array.isArray(sourcePayload.categories)
      ? sourcePayload.categories.map(normalizeFilter)
      : [],
    colors: Array.isArray(sourcePayload.colors)
      ? sourcePayload.colors.map(normalizeFilter)
      : [],
    sizes: Array.isArray(sourcePayload.sizes)
      ? sourcePayload.sizes.map(normalizeFilter)
      : []
  });
}

function toB2cProductResponse(sourcePayload = {}) {
  return withMeta({
    product: normalizeProduct(sourcePayload.product || {})
  });
}

module.exports = {
  B2C_API_VERSION,
  B2C_FORBIDDEN_KEYS,
  assertNoB2cForbiddenKeys,
  toB2cCatalogResponse,
  toB2cFiltersResponse,
  toB2cProductResponse
};
