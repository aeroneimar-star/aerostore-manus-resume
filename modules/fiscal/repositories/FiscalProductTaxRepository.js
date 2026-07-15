"use strict";

const { run, get, all } = require("../../../db");
const { normalizeText, normalizeDigits } = require("../utils/fiscalValidators");

function nowIso() {
  return new Date().toISOString();
}

function toNullableText(value) {
  const text = normalizeText(value || "");
  return text || null;
}

function buildProductRef({ productId = null, variantId = "", legacyAiProductId = null } = {}) {
  const variant = normalizeText(variantId || "");
  if (variant) {
    return `variant:${variant}`;
  }
  const product = Number(productId) || 0;
  if (product > 0) {
    return `product:${product}`;
  }
  const legacy = Number(legacyAiProductId) || 0;
  if (legacy > 0) {
    return `legacy:${legacy}`;
  }
  return "";
}

function mapProductTax(row = null) {
  if (!row) return null;
  return {
    id: Number(row.id),
    product_ref: row.product_ref || "",
    product_id: row.product_id == null ? null : Number(row.product_id),
    variant_id: row.variant_id || null,
    legacy_ai_product_id: row.legacy_ai_product_id == null ? null : Number(row.legacy_ai_product_id),
    ncm: row.ncm == null ? null : String(row.ncm),
    cest: row.cest == null ? null : String(row.cest),
    origin: row.origin == null ? null : String(row.origin),
    unit: row.unit == null ? null : String(row.unit),
    gtin_ean: row.gtin_ean == null ? null : String(row.gtin_ean),
    fiscal_description: row.fiscal_description == null ? null : String(row.fiscal_description),
    profile_id: row.profile_id == null ? null : Number(row.profile_id),
    cest_required: Number(row.cest_required || 0) === 1,
    inherit_from_parent: Number(row.inherit_from_parent ?? 1) === 1,
    active: Number(row.active) === 1,
    updated_by: row.updated_by || "",
    created_at: row.created_at || "",
    updated_at: row.updated_at || ""
  };
}

class FiscalProductTaxRepository {
  async upsert(payload = {}, user = {}) {
    const productRef = normalizeText(payload.product_ref || "")
      || buildProductRef({
        productId: payload.product_id ?? payload.productId,
        variantId: payload.variant_id ?? payload.variantId,
        legacyAiProductId: payload.legacy_ai_product_id ?? payload.legacyAiProductId
      });
    if (!productRef) {
      const error = new Error("product_ref ou product_id/variant_id e obrigatorio.");
      error.code = "FISCAL_PRODUCT_TAX_INVALID";
      error.statusCode = 400;
      throw error;
    }
    const existing = await this.findByProductRef(productRef);
    const stamp = nowIso();
    const actor = normalizeText(user.name || user.email || payload.updated_by || "sistema");
    const values = {
      product_ref: productRef,
      product_id: payload.product_id == null || payload.product_id === "" ? null : Number(payload.product_id),
      variant_id: toNullableText(payload.variant_id),
      legacy_ai_product_id: payload.legacy_ai_product_id == null || payload.legacy_ai_product_id === ""
        ? null
        : Number(payload.legacy_ai_product_id),
      ncm: toNullableText(normalizeDigits(payload.ncm || "") || payload.ncm),
      cest: toNullableText(normalizeDigits(payload.cest || "") || payload.cest),
      origin: payload.origin === 0 || payload.origin === "0"
        ? "0"
        : toNullableText(payload.origin),
      unit: toNullableText(payload.unit),
      gtin_ean: toNullableText(normalizeDigits(payload.gtin_ean || "")),
      fiscal_description: toNullableText(payload.fiscal_description),
      profile_id: payload.profile_id == null || payload.profile_id === ""
        ? null
        : Number(payload.profile_id),
      cest_required: payload.cest_required ? 1 : 0,
      inherit_from_parent: payload.inherit_from_parent === false || payload.inherit_from_parent === 0 ? 0 : 1,
      active: payload.active === false || payload.active === 0 ? 0 : 1,
      updated_by: actor
    };

    if (existing) {
      await run(
        `UPDATE fiscal_product_tax SET
          product_id = ?, variant_id = ?, legacy_ai_product_id = ?, ncm = ?, cest = ?,
          origin = ?, unit = ?, gtin_ean = ?, fiscal_description = ?, profile_id = ?,
          cest_required = ?, inherit_from_parent = ?, active = ?, updated_by = ?, updated_at = ?
         WHERE id = ?`,
        [
          values.product_id, values.variant_id, values.legacy_ai_product_id, values.ncm, values.cest,
          values.origin, values.unit, values.gtin_ean, values.fiscal_description, values.profile_id,
          values.cest_required, values.inherit_from_parent, values.active, values.updated_by, stamp,
          existing.id
        ]
      );
      return this.findById(existing.id);
    }

    const result = await run(
      `INSERT INTO fiscal_product_tax (
        product_ref, product_id, variant_id, legacy_ai_product_id, ncm, cest, origin, unit,
        gtin_ean, fiscal_description, profile_id, cest_required, inherit_from_parent, active,
        updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        values.product_ref, values.product_id, values.variant_id, values.legacy_ai_product_id,
        values.ncm, values.cest, values.origin, values.unit, values.gtin_ean,
        values.fiscal_description, values.profile_id, values.cest_required,
        values.inherit_from_parent, values.active, values.updated_by, stamp, stamp
      ]
    );
    return this.findById(result.lastID);
  }

  async findById(id) {
    const row = await get(`SELECT * FROM fiscal_product_tax WHERE id = ?`, [Number(id) || 0]);
    return mapProductTax(row);
  }

  async findByProductRef(productRef) {
    const row = await get(
      `SELECT * FROM fiscal_product_tax WHERE product_ref = ?`,
      [normalizeText(productRef || "")]
    );
    return mapProductTax(row);
  }

  async findByVariantId(variantId) {
    const row = await get(
      `SELECT * FROM fiscal_product_tax WHERE variant_id = ? AND active = 1`,
      [normalizeText(variantId || "")]
    );
    return mapProductTax(row);
  }

  async findByProductId(productId) {
    const row = await get(
      `SELECT * FROM fiscal_product_tax
       WHERE product_id = ? AND (variant_id IS NULL OR variant_id = '') AND active = 1
       ORDER BY id DESC LIMIT 1`,
      [Number(productId) || 0]
    );
    return mapProductTax(row);
  }

  async findByLegacyAiProductId(legacyId) {
    const row = await get(
      `SELECT * FROM fiscal_product_tax
       WHERE legacy_ai_product_id = ? AND (variant_id IS NULL OR variant_id = '') AND active = 1
       ORDER BY id DESC LIMIT 1`,
      [Number(legacyId) || 0]
    );
    return mapProductTax(row);
  }

  async list({ profileId = null, limit = 200, offset = 0 } = {}) {
    const clauses = [];
    const params = [];
    if (profileId != null && profileId !== "") {
      clauses.push("profile_id = ?");
      params.push(Number(profileId));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
    params.push(Math.max(Number(offset) || 0, 0));
    const rows = await all(
      `SELECT * FROM fiscal_product_tax ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      params
    );
    return rows.map(mapProductTax);
  }
}

module.exports = {
  FiscalProductTaxRepository,
  buildProductRef,
  mapProductTax
};
