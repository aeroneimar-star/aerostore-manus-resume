"use strict";

const fs = require("fs");
const path = require("path");

const { all, get, run } = require("../../../db");

const PILOT_AI_PRODUCT_ID = 10;
const DEFAULT_ACTOR = { id: null, name: "legacy_migration" };
const LEGACY_MANUAL_SIZE_STOCK_SOURCE = "pdv_manual_size_stock";
const NORMALIZED_PROJECTION_SOURCE = "pdv_product_v2";
const INVENTORY_FILE_PATH = path.join(__dirname, "..", "..", "..", "data", "pdv", "inventory", "inventory.json");

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeLookup(value = "") {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeColor(value = "") {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

function normalizeSize(value = "") {
  return normalizeText(value).toUpperCase().replace(/\s+/g, "");
}

function toMoneyCents(value = 0) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function parseArrayJson(value = []) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeSizeStockEntries(value = []) {
  const seen = new Set();
  return parseArrayJson(value).reduce((items, entry) => {
    const size = normalizeSize(entry?.size ?? entry?.tamanho ?? "");
    const quantity = Number(entry?.quantity ?? entry?.quantidade ?? 0);
    if (!size || seen.has(size) || !Number.isFinite(quantity) || quantity < 0) {
      return items;
    }
    seen.add(size);
    items.push({ size, quantity });
    return items;
  }, []);
}

function readInventoryRows() {
  return JSON.parse(fs.readFileSync(INVENTORY_FILE_PATH, "utf8"));
}

function writeInventoryRows(rows = []) {
  fs.writeFileSync(INVENTORY_FILE_PATH, JSON.stringify(rows, null, 2), "utf8");
}

function buildVariantId(aiProductId, size) {
  return `VAR_LEGACY_AI_${Number(aiProductId)}_${normalizeSize(size)}`;
}

function buildMovementId(aiProductId, storeId, size) {
  return `MOV_LEGACY_AI_${Number(aiProductId)}_${normalizeText(storeId).toUpperCase()}_${normalizeSize(size)}_IMPORT`;
}

function extractLegacyAiProductId(value = "") {
  const match = normalizeText(value).match(/^AI_(\d+)(?:__|$)/i);
  return match ? Number(match[1]) : null;
}

function buildInventoryIndex(rows = []) {
  const bySku = new Map();
  rows.forEach((row) => {
    const sku = normalizeLookup(row.sku || row.codigo || "");
    if (!sku) return;
    if (!bySku.has(sku)) bySku.set(sku, []);
    bySku.get(sku).push(row);
  });
  return bySku;
}

function isLegacyManualSizeStockRow(row = {}) {
  return normalizeLookup(row.source || "") === LEGACY_MANUAL_SIZE_STOCK_SOURCE;
}

function isPilotNormalizedProjectionRow(row = {}, aiProductId = PILOT_AI_PRODUCT_ID) {
  const productId = normalizeText(row.product_id || row.id || "");
  const sku = normalizeText(row.sku || row.codigo || "").toUpperCase();
  return productId.startsWith(`VAR_LEGACY_AI_${Number(aiProductId)}_`)
    || (
      normalizeLookup(row.source || "") === NORMALIZED_PROJECTION_SOURCE
      && sku.startsWith("AERO-000040-")
    );
}

function removePilotNormalizedInventoryProjection(aiProductId = PILOT_AI_PRODUCT_ID) {
  const rows = readInventoryRows();
  const kept = rows.filter((row) => !isPilotNormalizedProjectionRow(row, aiProductId));
  if (kept.length !== rows.length) {
    writeInventoryRows(kept);
  }
  return rows.length - kept.length;
}

async function loadLegacyProduct(aiProductId) {
  return get(
    `SELECT id, name, commercial_name, sku, codigo, gtin_ean, marca, category,
            color, sizes, store, estoque_total, size_stock_json, source, status,
            price, promotional_price, cost_price
       FROM ai_products
      WHERE id = ? AND COALESCE(deleted_at, '') = ''`,
    [Number(aiProductId)]
  );
}

async function findExistingNormalizedProduct(aiProductId) {
  return get(
    "SELECT * FROM pdv_products_v2 WHERE legacy_ai_product_id = ?",
    [Number(aiProductId)]
  );
}

async function buildMigrationPlan({ aiProductId = PILOT_AI_PRODUCT_ID } = {}) {
  const product = await loadLegacyProduct(aiProductId);
  if (!product) {
    return { eligible: false, reasons: ["produto legado nao encontrado"], product: null };
  }

  const reasons = [];
  const baseSku = normalizeText(product.sku || product.codigo || "");
  const color = normalizeText(product.color || "");
  const normalizedColor = normalizeColor(color);
  const sizeStock = normalizeSizeStockEntries(product.size_stock_json);
  const existing = await findExistingNormalizedProduct(aiProductId);
  const inventoryRows = readInventoryRows().filter(isLegacyManualSizeStockRow);
  const inventoryBySku = buildInventoryIndex(inventoryRows);

  if (Number(aiProductId) !== PILOT_AI_PRODUCT_ID) reasons.push("somente o piloto AERO-000040 esta autorizado neste ciclo");
  if (normalizeLookup(product.source) !== "manual") reasons.push("source nao e manual");
  if (!baseSku) reasons.push("SKU pai ausente");
  if (!color) reasons.push("cor estruturada ausente");
  if (!sizeStock.length) reasons.push("size_stock_json ausente ou invalido");
  if (existing) reasons.push("produto ja migrado em pdv_products_v2");

  const variants = sizeStock.map((entry) => {
    const size = normalizeSize(entry.size);
    const sku = `${baseSku}-${size}`;
    const rows = inventoryBySku.get(normalizeLookup(sku)) || [];
    if (!rows.length) reasons.push(`estoque legado nao encontrado para ${sku}`);
    return {
      id: buildVariantId(product.id, size),
      sku,
      size,
      color,
      normalized_color: normalizedColor,
      normalized_size: size,
      attribute_key: `${normalizedColor}::${size}`,
      legacy_product_id: `AI_${product.id}__SIZE__${size}`,
      legacy_inventory_ids: rows.map((row) => normalizeText(row.inventory_id || "")).filter(Boolean),
      inventory_rows: rows
    };
  });

  const existingSkus = await all(
    `SELECT sku FROM pdv_product_variants
      WHERE lower(sku) IN (${variants.map(() => "?").join(",") || "''"})`,
    variants.map((variant) => normalizeLookup(variant.sku))
  );
  existingSkus.forEach((row) => {
    reasons.push(`SKU ja existe normalizado: ${row.sku}`);
  });

  const salePrice = Number(product.promotional_price || 0) > 0
    && Number(product.price || 0) > 0
    && Number(product.promotional_price) < Number(product.price)
    ? Number(product.promotional_price)
    : Number(product.price || 0);

  const productPayload = {
    legacy_ai_product_id: Number(product.id),
    name: normalizeText(product.name || product.commercial_name || ""),
    product_type: "variable",
    status: normalizeLookup(product.status) === "ativo" ? "ativo" : "bloqueado_para_venda",
    base_sku: baseSku,
    sale_price_cents: toMoneyCents(salePrice),
    cost_price_cents: product.cost_price == null ? null : toMoneyCents(product.cost_price),
    source: "legacy_manual_migration"
  };

  const balances = variants.flatMap((variant) => variant.inventory_rows.map((row) => ({
    variant_id: variant.id,
    store_id: normalizeText(row.store_id || row.loja || ""),
    physical_qty: Number(row.available_qty ?? row.estoque ?? 0),
    reserved_qty: 0,
    available_qty: Number(row.available_qty ?? row.estoque ?? 0),
    legacy_inventory_id: normalizeText(row.inventory_id || ""),
    legacy_product_id: normalizeText(row.product_id || "")
  })));

  const movements = balances.map((balance) => {
    const size = balance.variant_id.replace(`VAR_LEGACY_AI_${Number(product.id)}_`, "");
    return {
      id: buildMovementId(product.id, balance.store_id, size),
      variant_id: balance.variant_id,
      store_id: balance.store_id,
      movement_type: "LEGACY_IMPORT",
      quantity_delta: balance.physical_qty,
      quantity_before: 0,
      quantity_after: balance.physical_qty,
      origin: "legacy_manual_migration",
      reference_type: "ai_products",
      reference_id: String(product.id),
      idempotency_key: `legacy-migration:ai:${product.id}:variant:${balance.variant_id}:store:${balance.store_id}:initial`,
      metadata: {
        source: "legacy_migration",
        legacy_ai_product_id: Number(product.id),
        legacy_inventory_id: balance.legacy_inventory_id,
        legacy_product_id: balance.legacy_product_id,
        legacy_sku_base: baseSku
      }
    };
  });

  return {
    eligible: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
    product: productPayload,
    variants,
    balances,
    movements
  };
}

async function dryRunLegacyManualProductMigration(options = {}) {
  return buildMigrationPlan(options);
}

async function loadMigratedProductAggregate(aiProductId) {
  const product = await findExistingNormalizedProduct(aiProductId);
  if (!product) return null;
  const variants = await all(
    "SELECT * FROM pdv_product_variants WHERE product_id = ? ORDER BY sku",
    [product.id]
  );
  return { product, variants };
}

async function applyLegacyManualProductMigration(options = {}) {
  const aiProductId = Number(options.aiProductId || PILOT_AI_PRODUCT_ID);
  const actor = { ...DEFAULT_ACTOR, ...(options.actor || {}) };
  const existing = await loadMigratedProductAggregate(aiProductId);
  if (existing) {
    return { status: "already_migrated", ...existing };
  }

  const plan = await buildMigrationPlan({ aiProductId });
  if (!plan.eligible) {
    const error = new Error(`Produto legado nao elegivel para migracao: ${plan.reasons.join("; ")}`);
    error.plan = plan;
    throw error;
  }

  const timestamp = nowIso();
  await run("BEGIN IMMEDIATE TRANSACTION");
  try {
    const replay = await findExistingNormalizedProduct(aiProductId);
    if (replay) {
      await run("COMMIT");
      return { status: "already_migrated", ...(await loadMigratedProductAggregate(aiProductId)) };
    }

    const insert = await run(
      `INSERT INTO pdv_products_v2
       (legacy_ai_product_id, name, product_type, status, base_sku, sale_price_cents,
        cost_price_cents, source, created_by_user_id, created_by_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        plan.product.legacy_ai_product_id,
        plan.product.name,
        plan.product.product_type,
        plan.product.status,
        plan.product.base_sku,
        plan.product.sale_price_cents,
        plan.product.cost_price_cents,
        plan.product.source,
        actor.id,
        actor.name,
        timestamp,
        timestamp
      ]
    );
    const productId = insert.lastID;

    for (const variant of plan.variants) {
      await run(
        `INSERT INTO pdv_product_variants
         (id, product_id, sku, barcode, status, attributes_json, attribute_key,
          is_default, sale_price_cents, cost_price_cents, operational_inventory_id,
          created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'ativo', ?, ?, 0, NULL, NULL, ?, ?, ?)`,
        [
          variant.id,
          productId,
          variant.sku,
          JSON.stringify({
            color: variant.color,
            normalized_color: variant.normalized_color,
            size: variant.size,
            normalized_size: variant.normalized_size,
            legacy_ai_product_id: plan.product.legacy_ai_product_id,
            legacy_product_id: variant.legacy_product_id,
            legacy_inventory_ids: variant.legacy_inventory_ids
          }),
          variant.attribute_key,
          variant.legacy_inventory_ids.join(","),
          timestamp,
          timestamp
        ]
      );
    }

    for (const balance of plan.balances) {
      await run(
        `INSERT INTO pdv_inventory_balances_v2
         (variant_id, store_id, available_qty, reserved_qty, version, updated_at)
         VALUES (?, ?, ?, 0, 1, ?)`,
        [balance.variant_id, balance.store_id, balance.physical_qty, timestamp]
      );
    }

    for (const movement of plan.movements) {
      await run(
        `INSERT INTO pdv_inventory_movements_v2
         (id, variant_id, store_id, movement_type, quantity_delta, quantity_before,
          quantity_after, origin, reference_type, reference_id, idempotency_key,
          actor_user_id, actor_name, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          movement.id,
          movement.variant_id,
          movement.store_id,
          movement.movement_type,
          movement.quantity_delta,
          movement.quantity_before,
          movement.quantity_after,
          movement.origin,
          movement.reference_type,
          movement.reference_id,
          movement.idempotency_key,
          actor.id,
          actor.name,
          JSON.stringify(movement.metadata),
          timestamp
        ]
      );
    }

    await run(
      `INSERT INTO pdv_product_audit_logs
       (product_id, variant_id, action_type, actor_user_id, actor_name, before_json, after_json, created_at)
       VALUES (?, NULL, 'LEGACY_MANUAL_PRODUCT_MIGRATED', ?, ?, '{}', ?, ?)`,
      [
        productId,
        actor.id,
        actor.name,
        JSON.stringify({
          legacy_ai_product_id: plan.product.legacy_ai_product_id,
          legacy_sku_base: plan.product.base_sku,
          migration_status: "migrated",
          migrated_at: timestamp
        }),
        timestamp
      ]
    );

    await run("COMMIT");
    return { status: "migrated", ...(await loadMigratedProductAggregate(aiProductId)) };
  } catch (error) {
    await run("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function rollbackLegacyManualProductMigration(options = {}) {
  const aiProductId = Number(options.aiProductId || PILOT_AI_PRODUCT_ID);
  if (aiProductId !== PILOT_AI_PRODUCT_ID) {
    throw new Error("Somente o rollback do piloto AERO-000040 esta autorizado neste ciclo.");
  }
  const existing = await findExistingNormalizedProduct(aiProductId);
  if (!existing) {
    const projectionRowsRemoved = removePilotNormalizedInventoryProjection(aiProductId);
    return { status: "not_migrated", projection_rows_removed: projectionRowsRemoved };
  }
  const variants = await all("SELECT id FROM pdv_product_variants WHERE product_id = ?", [existing.id]);
  const variantIds = variants.map((item) => item.id);
  await run("BEGIN IMMEDIATE TRANSACTION");
  try {
    for (const variantId of variantIds) {
      await run("DELETE FROM pdv_inventory_movements_v2 WHERE variant_id = ?", [variantId]);
      await run("DELETE FROM pdv_inventory_balances_v2 WHERE variant_id = ?", [variantId]);
    }
    await run("DELETE FROM pdv_product_audit_logs WHERE product_id = ?", [existing.id]);
    await run("DELETE FROM pdv_product_variants WHERE product_id = ?", [existing.id]);
    await run("DELETE FROM pdv_products_v2 WHERE id = ?", [existing.id]);
    await run("COMMIT");
    const projectionRowsRemoved = removePilotNormalizedInventoryProjection(aiProductId);
    return {
      status: "rolled_back",
      product_id: existing.id,
      variants_removed: variantIds.length,
      projection_rows_removed: projectionRowsRemoved
    };
  } catch (error) {
    await run("ROLLBACK").catch(() => {});
    throw error;
  }
}

function getLegacyAiProductIdFromOperationalRow(row = {}) {
  return extractLegacyAiProductId(row.product_id || row.id || row.manual_parent_product_id || "");
}

module.exports = {
  applyLegacyManualProductMigration,
  dryRunLegacyManualProductMigration,
  getLegacyAiProductIdFromOperationalRow,
  rollbackLegacyManualProductMigration
};
