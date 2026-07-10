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

function mapPublicImage(image = {}, fallbackTitle = "") {
  const mapped = {
    url: normalizeText(image.url),
    alt: normalizeText(image.alt || fallbackTitle),
    sort_order: Number(image.sort_order || 0)
  };
  const role = normalizeText(image.role);
  const colorSlug = normalizeText(image.color_slug);
  if (role) mapped.role = role;
  if (colorSlug) mapped.color_slug = colorSlug;
  return mapped;
}

function toCatalogListItem(publication = {}) {
  const variants = Array.isArray(publication.variants) ? publication.variants : [];
  const summary = summarizeVariants(variants);
  const availability = normalizeText(publication.availability || "in_stock") || "in_stock";
  const shortDescription = normalizeText(
    publication.public_short_description || publication.public_description
  );
  const item = {
    slug: normalizeText(publication.public_slug),
    title: normalizeText(publication.public_title),
    short_description: shortDescription,
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
  const badgeLabel = normalizeText(publication.badge_label);
  if (badgeLabel) {
    item.badge_label = badgeLabel;
  }
  assertNoForbiddenKeys(item);
  return item;
}

function toCatalogDetail(publication = {}) {
  const title = normalizeText(publication.public_title);
  const shortDescription = normalizeText(
    publication.public_short_description || publication.public_description
  );
  const product = {
    slug: normalizeText(publication.public_slug),
    title,
    short_description: shortDescription,
    description: normalizeText(publication.public_description),
    category_slug: normalizeText(publication.public_category_slug),
    category_label: normalizeText(publication.public_category_label || publication.public_category_slug),
    price_cents: Number(publication.price_cents || 0),
    compare_at_price_cents: publication.compare_at_price_cents ?? null,
    featured: Boolean(publication.featured),
    availability: normalizeText(publication.availability || "in_stock") || "in_stock",
    images: Array.isArray(publication.images)
      ? publication.images.map((image) => mapPublicImage(image, title))
      : [],
    variants: Array.isArray(publication.variants) ? publication.variants.map((variant) => {
      const mapped = {
        slug: normalizeText(variant.public_variant_slug),
        color: normalizeText(variant.color),
        color_slug: normalizeText(variant.color_slug),
        size: normalizeText(variant.size),
        size_slug: normalizeText(variant.size_slug),
        price_cents: Number(variant.price_cents || publication.price_cents || 0),
        availability: normalizeText(variant.availability || "in_stock") || "in_stock"
      };
      if (variant.compare_at_price_cents != null) {
        mapped.compare_at_price_cents = variant.compare_at_price_cents;
      }
      return mapped;
    }) : [],
    seo: publication.seo && typeof publication.seo === "object" ? {
      title: normalizeText(publication.seo.title),
      description: normalizeText(publication.seo.description)
    } : {
      title: `${title} | AEROSTORE`,
      description: normalizeText(publication.public_description)
    }
  };

  const descriptionFull = normalizeText(publication.public_description_full);
  const composition = normalizeText(publication.composition);
  const badgeLabel = normalizeText(publication.badge_label);
  const ctaLabel = normalizeText(publication.cta_label);
  const status = normalizeText(publication.status);
  const sortOrder = Number(publication.sort_order);

  if (descriptionFull) product.description_full = descriptionFull;
  if (composition) product.composition = composition;
  if (badgeLabel) product.badge_label = badgeLabel;
  if (ctaLabel) product.cta_label = ctaLabel;
  if (status) product.status = status;
  if (Number.isFinite(sortOrder)) product.sort_order = sortOrder;

  if (Array.isArray(publication.care_instructions) && publication.care_instructions.length) {
    product.care_instructions = publication.care_instructions
      .map((item) => normalizeText(item))
      .filter(Boolean);
  } else if (typeof publication.care_instructions === "string" && publication.care_instructions.trim()) {
    product.care_instructions = [normalizeText(publication.care_instructions)];
  }

  if (publication.size_guide && typeof publication.size_guide === "object") {
    const rows = Array.isArray(publication.size_guide.rows) ? publication.size_guide.rows : [];
    product.size_guide = {
      title: normalizeText(publication.size_guide.title || "Medidas"),
      rows: rows.map((row) => pickAllowed(row, Object.keys(row)))
    };
  }

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
