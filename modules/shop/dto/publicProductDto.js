"use strict";

const {
  summarizeVariants,
  resolveActionLabel,
  resolveStatusCopy
} = require("./catalogListDto");

const FORBIDDEN_KEYS = new Set([
  "product_id",
  "variant_id",
  "legacy_ai_product_id",
  "tiny_id",
  "cost_price_cents",
  "sku",
  "barcode",
  "store_id",
  "available_qty",
  "reserved_qty",
  "margin",
  "notes",
  "source",
  "internal_id"
]);

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pickAllowed(obj = {}, allowedKeys = []) {
  const result = {};
  for (const key of allowedKeys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      result[key] = obj[key];
    }
  }
  return result;
}

function assertNoForbiddenKeys(obj = {}, path = "") {
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Campo interno proibido no DTO público: ${path}${key}`);
    }
    const value = obj[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      assertNoForbiddenKeys(value, `${path}${key}.`);
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === "object") {
          assertNoForbiddenKeys(item, `${path}${key}[${index}].`);
        }
      });
    }
  }
}

function toCatalogListItem(publication = {}) {
  const variants = Array.isArray(publication.variants) ? publication.variants : [];
  const summary = summarizeVariants(variants);
  const availability = normalizeText(publication.availability || "in_stock") || "in_stock";
  const item = {
    slug: normalizeText(publication.public_slug),
    title: normalizeText(publication.public_title),
    category_slug: normalizeText(publication.public_category_slug),
    category_label: normalizeText(publication.public_category_label || publication.public_category_slug),
    price_cents: Number(publication.price_cents || 0),
    compare_at_price_cents: publication.compare_at_price_cents ?? null,
    featured: Boolean(publication.featured),
    availability,
    primary_image: publication.primary_image || null,
    variant_count: variants.length,
    colors: summary.colors,
    color_slugs: summary.colorSlugs,
    sizes: summary.sizes,
    action_label: resolveActionLabel(availability),
    status_copy: resolveStatusCopy(availability)
  };
  assertNoForbiddenKeys(item);
  return item;
}

function toCatalogDetail(publication = {}) {
  const product = {
    slug: normalizeText(publication.public_slug),
    title: normalizeText(publication.public_title),
    description: normalizeText(publication.public_description),
    category_slug: normalizeText(publication.public_category_slug),
    category_label: normalizeText(publication.public_category_label || publication.public_category_slug),
    price_cents: Number(publication.price_cents || 0),
    compare_at_price_cents: publication.compare_at_price_cents ?? null,
    featured: Boolean(publication.featured),
    availability: normalizeText(publication.availability || "in_stock") || "in_stock",
    images: Array.isArray(publication.images) ? publication.images.map((image) => ({
      url: normalizeText(image.url),
      alt: normalizeText(image.alt || publication.public_title),
      sort_order: Number(image.sort_order || 0)
    })) : [],
    variants: Array.isArray(publication.variants) ? publication.variants.map((variant) => ({
      slug: normalizeText(variant.public_variant_slug),
      color: normalizeText(variant.color),
      color_slug: normalizeText(variant.color_slug),
      size: normalizeText(variant.size),
      size_slug: normalizeText(variant.size_slug),
      price_cents: Number(variant.price_cents || publication.price_cents || 0),
      availability: normalizeText(variant.availability || "in_stock") || "in_stock"
    })) : [],
    seo: publication.seo && typeof publication.seo === "object" ? {
      title: normalizeText(publication.seo.title),
      description: normalizeText(publication.seo.description)
    } : {
      title: `${normalizeText(publication.public_title)} | AEROSTORE`,
      description: normalizeText(publication.public_description)
    }
  };
  assertNoForbiddenKeys(product);
  return product;
}

function formatPriceBrl(cents = 0) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(cents || 0) / 100);
}

module.exports = {
  toCatalogListItem,
  toCatalogDetail,
  assertNoForbiddenKeys,
  formatPriceBrl,
  FORBIDDEN_KEYS
};
