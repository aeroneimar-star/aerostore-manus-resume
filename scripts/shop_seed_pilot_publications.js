"use strict";

/**
 * Seed idempotente dos 8 produtos piloto → shop_product_publications.
 *
 * Fonte: modules/shop/config/pilot-editorial-intake.json
 *
 * PADRÃO: dry-run (não grava).
 * Para gravar:
 *   SHOP_SEED_CONFIRM=true node scripts/shop_seed_pilot_publications.js --apply
 *
 * Regras:
 * - status draft no insert; no update não rebaixa published→draft
 * - variant_id null → não cria shop_variant_publications
 * - needs_photo → não cria shop_product_images
 * - não liga SHOP_PUBLIC_CATALOG_ENABLED
 * - não cria shop_stock_reservations
 * - exige schema shop_* já existente (migration prévia)
 */

const fs = require("fs");
const path = require("path");
const {
  getShopPublicationSchemaStatus
} = require("../modules/shop/database/shopPublicationMigration");

const ROOT = path.join(__dirname, "..");
const INTAKE_PATH = path.join(ROOT, "modules", "shop", "config", "pilot-editorial-intake.json");

function nowIso() {
  return new Date().toISOString();
}

function isApplyRequested() {
  return process.argv.includes("--apply")
    && String(process.env.SHOP_SEED_CONFIRM || "").trim().toLowerCase() === "true";
}

function loadIntake() {
  const raw = JSON.parse(fs.readFileSync(INTAKE_PATH, "utf8"));
  const products = Array.isArray(raw.products) ? raw.products : [];
  if (products.length !== 8) {
    throw new Error(`Intake deve ter 8 produtos; encontrado ${products.length}`);
  }
  for (const product of products) {
    if (!Number.isInteger(product.product_id) || product.product_id <= 0) {
      throw new Error(`product_id inválido no slug ${product.slug}`);
    }
    if (product.variant_id !== null && product.variant_id !== undefined) {
      throw new Error(`Piloto exige variant_id null (${product.slug})`);
    }
    if (product.status !== "draft") {
      throw new Error(`Intake status deve ser draft (${product.slug})`);
    }
  }
  if (raw.catalog_public_enabled !== false) {
    throw new Error("catalog_public_enabled deve ser false no intake");
  }
  return raw;
}

function buildMetadata(product = {}) {
  return {
    seed_phase: "2.9",
    seed_source: "pilot-editorial-intake.json",
    short_description: product.short_description || "",
    tags: Array.isArray(product.tags) ? product.tags : [],
    price_cents_ref: product.price_cents_ref || null,
    price_label_ref: product.price_label || null,
    mapping: {
      pdv_product_name: product.pdv_product_name || "",
      mapping_confidence: product.mapping_confidence || "",
      mapped_from_environment: product.mapped_from_environment || "",
      mapped_from_phase: product.mapped_from_phase || "",
      availability_ref: product.availability_ref || "",
      variants_count_ref: product.variants_count_ref || null
    },
    needs_photo: Boolean(product.needs_photo),
    needs_copy_review: Boolean(product.needs_copy_review),
    needs_stock_review: Boolean(product.needs_stock_review)
  };
}

function buildRow(product = {}) {
  const ts = nowIso();
  return {
    product_id: Number(product.product_id),
    public_slug: String(product.slug || "").trim(),
    status: "draft",
    public_title: String(product.editorial_name || "").trim(),
    public_short_description: String(product.short_description || "").trim(),
    public_description: String(product.full_description || "").trim(),
    public_category_slug: String(product.category || "").trim(),
    public_category_label: String(product.category_label || "").trim(),
    sort_order: Number(product.sort_order || 0),
    featured: product.featured ? 1 : 0,
    public_price_cents: null,
    metadata_json: JSON.stringify(buildMetadata(product)),
    created_at: ts,
    updated_at: ts
  };
}

async function upsertPublication(run, get, row) {
  const existing = await get(
    `SELECT id, status FROM shop_product_publications WHERE public_slug = ? COLLATE NOCASE`,
    [row.public_slug]
  );

  if (!existing) {
    const byProduct = await get(
      `SELECT id, status FROM shop_product_publications WHERE product_id = ?`,
      [row.product_id]
    );
    if (byProduct) {
      const result = await run(
        `UPDATE shop_product_publications SET
          public_slug = ?,
          public_title = ?,
          public_short_description = ?,
          public_description = ?,
          public_category_slug = ?,
          public_category_label = ?,
          sort_order = ?,
          featured = ?,
          metadata_json = ?,
          updated_at = ?
         WHERE product_id = ?`,
        [
          row.public_slug,
          row.public_title,
          row.public_short_description,
          row.public_description,
          row.public_category_slug,
          row.public_category_label,
          row.sort_order,
          row.featured,
          row.metadata_json,
          row.updated_at,
          row.product_id
        ]
      );
      return { action: "updated_by_product_id", id: byProduct.id, status_kept: byProduct.status, changes: result.changes };
    }

    const inserted = await run(
      `INSERT INTO shop_product_publications (
        product_id, public_slug, status, public_title, public_short_description,
        public_description, public_category_slug, public_category_label,
        sort_order, featured, public_price_cents, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.product_id,
        row.public_slug,
        row.status,
        row.public_title,
        row.public_short_description,
        row.public_description,
        row.public_category_slug,
        row.public_category_label,
        row.sort_order,
        row.featured,
        row.public_price_cents,
        row.metadata_json,
        row.created_at,
        row.updated_at
      ]
    );
    return { action: "inserted", id: inserted.lastID, status_kept: "draft", changes: inserted.changes };
  }

  const result = await run(
    `UPDATE shop_product_publications SET
      product_id = ?,
      public_title = ?,
      public_short_description = ?,
      public_description = ?,
      public_category_slug = ?,
      public_category_label = ?,
      sort_order = ?,
      featured = ?,
      metadata_json = ?,
      updated_at = ?
     WHERE id = ?`,
    [
      row.product_id,
      row.public_title,
      row.public_short_description,
      row.public_description,
      row.public_category_slug,
      row.public_category_label,
      row.sort_order,
      row.featured,
      row.metadata_json,
      row.updated_at,
      existing.id
    ]
  );
  return { action: "updated_by_slug", id: existing.id, status_kept: existing.status, changes: result.changes };
}

async function upsertCatalogSettings(run, get, shopSettings) {
  const fulfillment = shopSettings?.fulfillment || {};
  const storeIds = Array.isArray(fulfillment.store_ids) ? fulfillment.store_ids : ["vila", "botanico", "sul"];
  const stockPolicy = fulfillment.stock_policy || "min_across_stores";
  const lowStock = Number(fulfillment.low_stock_threshold || 2);
  const ttl = Number(fulfillment.reservation_ttl_minutes || 15);
  const ts = nowIso();

  const existing = await get(`SELECT id FROM shop_catalog_settings WHERE id = 1`);
  if (!existing) {
    await run(
      `INSERT INTO shop_catalog_settings (
        id, fulfillment_store_ids_json, stock_policy, reservation_ttl_minutes,
        low_stock_threshold, use_pilot_json_fallback, updated_at, updated_by
      ) VALUES (1, ?, ?, ?, ?, 1, ?, ?)`,
      [JSON.stringify(storeIds), stockPolicy, ttl, lowStock, ts, "shop_seed_pilot_publications"]
    );
    return { action: "inserted" };
  }

  await run(
    `UPDATE shop_catalog_settings SET
      fulfillment_store_ids_json = ?,
      stock_policy = ?,
      reservation_ttl_minutes = ?,
      low_stock_threshold = ?,
      updated_at = ?,
      updated_by = ?
     WHERE id = 1`,
    [JSON.stringify(storeIds), stockPolicy, ttl, lowStock, ts, "shop_seed_pilot_publications"]
  );
  return { action: "updated" };
}

async function main() {
  const apply = isApplyRequested();
  const intake = loadIntake();
  const rows = intake.products.map(buildRow);
  const shopSettings = JSON.parse(
    fs.readFileSync(path.join(ROOT, "modules", "shop", "config", "shop-settings.json"), "utf8")
  );

  const plan = {
    mode: apply ? "apply" : "dry_run",
    intake_path: INTAKE_PATH,
    catalog_public_enabled: intake.catalog_public_enabled,
    products: rows.map((row) => ({
      product_id: row.product_id,
      public_slug: row.public_slug,
      public_title: row.public_title,
      status: row.status,
      featured: row.featured,
      sort_order: row.sort_order,
      category: row.public_category_slug
    })),
    will_create_variants: false,
    will_create_images: false,
    will_enable_public_catalog: false
  };

  if (!apply) {
    console.log("SHOP_SEED_PILOT_DRY_RUN_OK");
    console.log(JSON.stringify(plan, null, 2));
    console.log("Para aplicar: SHOP_SEED_CONFIRM=true node scripts/shop_seed_pilot_publications.js --apply");
    return;
  }

  const { run, get } = require("../db");
  const schema = await getShopPublicationSchemaStatus(get);
  if (!schema.ready) {
    throw new Error(
      "Schema shop_* ausente. Aplique primeiro a migration (SHOP_APPLY_MIGRATION=true) antes do seed."
    );
  }

  const results = [];
  for (const row of rows) {
    results.push({
      product_id: row.product_id,
      public_slug: row.public_slug,
      ...(await upsertPublication(run, get, row))
    });
  }

  const settingsResult = await upsertCatalogSettings(run, get, shopSettings);

  console.log("SHOP_SEED_PILOT_APPLY_OK");
  console.log(JSON.stringify({
    mode: "apply",
    catalog_public_still_off: true,
    settings: settingsResult,
    results,
    note: "Seed idempotente. Sem variantes, sem imagens, sem reservas, sem publish."
  }, null, 2));
}

main().catch((error) => {
  console.error("SHOP_SEED_PILOT_FAIL", error.message || error);
  process.exitCode = 1;
});
