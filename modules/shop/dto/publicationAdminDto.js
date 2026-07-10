"use strict";

/**
 * DTO admin read-only — candidatos PDV + publicações.
 * Uso interno CRM (Fase 2.7+). Nunca expor na API pública /public-api/*.
 */
const FORBIDDEN_ADMIN_KEYS = new Set([
  "sku",
  "barcode",
  "base_sku",
  "cost_price_cents",
  "tiny_id",
  "legacy_ai_product_id",
  "margin",
  "store_id",
  "available_qty",
  "reserved_qty",
  "physical_qty",
  "notes",
  "source",
  "internal_id",
  "attributes_json"
]);

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function assertNoForbiddenAdminKeys(obj = {}, path = "") {
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_ADMIN_KEYS.has(key)) {
      throw new Error(`Campo interno proibido no DTO admin shop: ${path}${key}`);
    }
    const value = obj[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      assertNoForbiddenAdminKeys(value, `${path}${key}.`);
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === "object") {
          assertNoForbiddenAdminKeys(item, `${path}${key}[${index}].`);
        }
      });
    }
  }
}

function parseAttributes(raw = "{}") {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function slugifyColor(value = "") {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toPublicationCandidateVariant(variant = {}, productSalePriceCents = 0, threshold = 2) {
  const attrs = parseAttributes(variant.attributes_json);
  const priceCents = Number(
    variant.sale_price_cents ?? variant.variation_sale_price_cents ?? productSalePriceCents ?? 0
  );
  const item = {
    pdv_variant_ref: normalizeText(variant.variant_id || variant.id),
    color: normalizeText(attrs.color || variant.color || ""),
    color_slug: slugifyColor(attrs.color || variant.color || ""),
    size: normalizeText(attrs.size || variant.size || ""),
    size_slug: normalizeText(attrs.size || variant.size || "").toLowerCase(),
    price_cents: priceCents,
    pdv_status: normalizeText(variant.variation_status || variant.status || ""),
    sellable: Boolean(variant.sellable),
    availability: normalizeText(variant.availability || "out_of_stock") || "out_of_stock",
    publication_status: normalizeText(variant.publication_status || "none") || "none"
  };
  assertNoForbiddenAdminKeys(item);
  return item;
}

function toPublicationCandidate(product = {}, variants = [], options = {}) {
  const priceCents = Number(product.sale_price_cents ?? product.product_sale_price_cents ?? 0);
  const mappedVariants = variants.map((v) => toPublicationCandidateVariant(v, priceCents, options.threshold));
  const colors = Array.from(new Set(mappedVariants.map((v) => v.color).filter(Boolean)));
  const sizes = Array.from(new Set(mappedVariants.map((v) => v.size).filter(Boolean)));
  const anySellable = mappedVariants.some((v) => v.sellable);
  const availability = normalizeText(product.availability || "out_of_stock") || "out_of_stock";

  const item = {
    pdv_product_ref: Number(product.product_id || product.id || 0),
    name: normalizeText(product.name),
    product_type: normalizeText(product.product_type || "simple"),
    pdv_status: normalizeText(product.status || product.product_status || ""),
    price_cents: priceCents,
    sellable: Boolean(product.sellable ?? anySellable),
    availability,
    variant_count: mappedVariants.length,
    colors,
    sizes,
    variants: mappedVariants,
    publication: product.publication ? {
      id: Number(product.publication.id || 0),
      public_slug: normalizeText(product.publication.public_slug),
      status: normalizeText(product.publication.status),
      public_title: normalizeText(product.publication.public_title),
      featured: Boolean(product.publication.featured),
      sort_order: Number(product.publication.sort_order || 0)
    } : null,
    publication_status: normalizeText(product.publication_status || (product.publication ? product.publication.status : "none")) || "none"
  };

  assertNoForbiddenAdminKeys(item);
  return item;
}

function toPublicationCandidateList(payload = {}) {
  const result = {
    success: true,
    schema_ready: Boolean(payload.schema_ready),
    pilot_json_active: Boolean(payload.pilot_json_active),
    page: Number(payload.page || 1),
    limit: Number(payload.limit || 24),
    total: Number(payload.total || 0),
    items: Array.isArray(payload.items) ? payload.items : []
  };
  assertNoForbiddenAdminKeys(result);
  return result;
}

module.exports = {
  FORBIDDEN_ADMIN_KEYS,
  assertNoForbiddenAdminKeys,
  parseAttributes,
  slugifyColor,
  toPublicationCandidate,
  toPublicationCandidateVariant,
  toPublicationCandidateList
};
