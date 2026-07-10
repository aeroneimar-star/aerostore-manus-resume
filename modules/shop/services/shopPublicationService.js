"use strict";

const { get, all } = require("../../../db");
const { isPilotJsonEnabled } = require("./shopSettingsService");
const { getAvailabilityLabel, getFulfillmentConfig } = require("./shopStockService");
const {
  toPublicationCandidate,
  toPublicationCandidateList,
  parseAttributes,
  assertNoForbiddenAdminKeys
} = require("../dto/publicationAdminDto");

const SHOP_PUBLICATION_TABLES = [
  "shop_product_publications",
  "shop_variant_publications",
  "shop_product_images",
  "shop_catalog_settings"
];

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function isTableReady(tableName = "") {
  const name = normalizeText(tableName);
  if (!name) {
    return false;
  }
  const row = await get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [name]
  );
  return Boolean(row?.name);
}

async function getShopPublicationSchemaStatus() {
  const checks = await Promise.all(
    SHOP_PUBLICATION_TABLES.map(async (table) => ({
      table,
      ready: await isTableReady(table)
    }))
  );
  const ready = checks.every((item) => item.ready);
  return {
    ready,
    tables: checks,
    message: ready
      ? "Schema shop publication disponível."
      : "Schema shop publication ainda não aplicado — serviço opera somente leitura PDV."
  };
}

function aggregateSellableQty(balances = [], storeIds = [], policy = "min_across_stores") {
  const pool = Array.isArray(storeIds) ? storeIds.filter(Boolean) : [];
  const relevant = balances.filter((row) => {
    if (!pool.length) {
      return true;
    }
    return pool.some((id) => normalizeText(id).toLowerCase() === normalizeText(row.store_id).toLowerCase());
  });
  if (!relevant.length) {
    return 0;
  }
  const sellableValues = relevant.map((row) => {
    const physical = Number(row.available_qty || 0);
    const reserved = Number(row.reserved_qty || 0);
    return Math.max(0, physical - reserved);
  });
  if (policy === "sum_selected") {
    return sellableValues.reduce((sum, qty) => sum + qty, 0);
  }
  return Math.min(...sellableValues);
}

function resolveAvailabilityLabel(sellableQty = 0, threshold = 2) {
  return getAvailabilityLabel(Math.max(0, Number(sellableQty || 0)), 0, threshold);
}

async function loadPublicationMapByProductIds(productIds = []) {
  const ids = productIds.map((id) => Number(id)).filter((id) => id > 0);
  if (!ids.length || !(await isTableReady("shop_product_publications"))) {
    return new Map();
  }
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await all(
    `SELECT id, product_id, public_slug, status, public_title, featured, sort_order
     FROM shop_product_publications
     WHERE product_id IN (${placeholders})`,
    ids
  );
  const map = new Map();
  rows.forEach((row) => {
    map.set(Number(row.product_id), row);
  });
  return map;
}

async function fetchPdvProductRows({ query = "", limit = 24, offset = 0 } = {}) {
  const normalizedQuery = normalizeText(query).toLowerCase();
  const like = normalizedQuery ? `%${normalizedQuery}%` : null;
  const params = [];
  let whereClause = "1=1";
  if (like) {
    whereClause += " AND (LOWER(p.name) LIKE ? OR CAST(p.id AS TEXT) = ?)";
    params.push(like, normalizedQuery);
  }
  params.push(Math.max(1, Number(limit || 24)), Math.max(0, Number(offset || 0)));

  return all(
    `SELECT
       p.id AS product_id,
       p.name,
       p.product_type,
       p.status AS product_status,
       p.sale_price_cents
     FROM pdv_products_v2 p
     WHERE ${whereClause}
     ORDER BY p.updated_at DESC, p.id DESC
     LIMIT ? OFFSET ?`,
    params
  );
}

async function countPdvProductRows(query = "") {
  const normalizedQuery = normalizeText(query).toLowerCase();
  const like = normalizedQuery ? `%${normalizedQuery}%` : null;
  const params = [];
  let whereClause = "1=1";
  if (like) {
    whereClause += " AND (LOWER(p.name) LIKE ? OR CAST(p.id AS TEXT) = ?)";
    params.push(like, normalizedQuery);
  }
  const row = await get(
    `SELECT COUNT(*) AS total FROM pdv_products_v2 p WHERE ${whereClause}`,
    params
  );
  return Number(row?.total || 0);
}

async function fetchVariantsWithBalances(productIds = [], storeIds = []) {
  const ids = productIds.map((id) => Number(id)).filter((id) => id > 0);
  if (!ids.length) {
    return new Map();
  }
  const placeholders = ids.map(() => "?").join(", ");
  const params = [...ids];
  let storeFilter = "";
  if (Array.isArray(storeIds) && storeIds.length) {
    const storePlaceholders = storeIds.map(() => "?").join(", ");
    storeFilter = ` AND (b.store_id IN (${storePlaceholders}) OR b.store_id IS NULL)`;
    params.push(...storeIds);
  }

  const rows = await all(
    `SELECT
       v.id AS variant_id,
       v.product_id,
       v.status AS variation_status,
       v.attributes_json,
       v.sale_price_cents,
       b.store_id,
       b.available_qty,
       b.reserved_qty
     FROM pdv_product_variants v
     LEFT JOIN pdv_inventory_balances_v2 b ON b.variant_id = v.id
     WHERE v.product_id IN (${placeholders})${storeFilter}
     ORDER BY v.product_id, v.created_at, v.id`,
    params
  );

  const byProduct = new Map();
  rows.forEach((row) => {
    const productId = Number(row.product_id);
    if (!byProduct.has(productId)) {
      byProduct.set(productId, []);
    }
    byProduct.get(productId).push(row);
  });
  return byProduct;
}

function buildVariantCandidates(rawRows = [], productRow = {}, fulfillment = {}) {
  const threshold = Number(fulfillment.low_stock_threshold || 2);
  const policy = fulfillment.stock_policy || "min_across_stores";
  const storeIds = fulfillment.store_ids || [];
  const variantMap = new Map();

  rawRows.forEach((row) => {
    const variantId = normalizeText(row.variant_id);
    if (!variantMap.has(variantId)) {
      variantMap.set(variantId, {
        variant_id: variantId,
        variation_status: row.variation_status,
        attributes_json: row.attributes_json,
        sale_price_cents: row.sale_price_cents,
        balances: []
      });
    }
    if (row.store_id != null) {
      variantMap.get(variantId).balances.push({
        store_id: row.store_id,
        available_qty: row.available_qty,
        reserved_qty: row.reserved_qty
      });
    }
  });

  const productActive = normalizeText(productRow.product_status) === "ativo";

  return Array.from(variantMap.values()).map((variant) => {
    const sellableQty = aggregateSellableQty(variant.balances, storeIds, policy);
    const variantActive = normalizeText(variant.variation_status) === "ativo";
    const sellable = productActive && variantActive && sellableQty > 0;
    return {
      ...variant,
      sellable,
      availability: resolveAvailabilityLabel(sellableQty, threshold)
    };
  });
}

async function listPdvPublicationCandidates(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 24));
  const offset = (page - 1) * limit;
  const search = normalizeText(query.q || query.query || "");
  const schemaStatus = await getShopPublicationSchemaStatus();
  const fulfillment = getFulfillmentConfig();

  const [total, productRows] = await Promise.all([
    countPdvProductRows(search),
    fetchPdvProductRows({ query: search, limit, offset })
  ]);
  const publicationMap = await loadPublicationMapByProductIds(
    productRows.map((row) => row.product_id)
  );

  const productIds = productRows.map((row) => row.product_id);
  const variantsByProduct = await fetchVariantsWithBalances(productIds, fulfillment.store_ids);

  const items = productRows.map((productRow) => {
    const variants = buildVariantCandidates(
      variantsByProduct.get(Number(productRow.product_id)) || [],
      productRow,
      fulfillment
    );
    const publication = publicationMap.get(Number(productRow.product_id)) || null;
    const productActive = normalizeText(productRow.product_status) === "ativo";
    const anySellable = variants.some((v) => v.sellable);
    const bestAvailability = variants.reduce((best, variant) => {
      const order = { in_stock: 3, low_stock: 2, out_of_stock: 1 };
      return (order[variant.availability] || 0) > (order[best] || 0)
        ? variant.availability
        : best;
    }, "out_of_stock");

    return toPublicationCandidate({
      ...productRow,
      id: productRow.product_id,
      status: productRow.product_status,
      sellable: productActive && anySellable,
      availability: bestAvailability,
      publication,
      publication_status: publication?.status || "none",
      variants
    }, variants, { threshold: fulfillment.low_stock_threshold });
  });

  const payload = toPublicationCandidateList({
    schema_ready: schemaStatus.ready,
    pilot_json_active: isPilotJsonEnabled(),
    page,
    limit,
    total,
    items
  });
  assertNoForbiddenAdminKeys(payload);
  return payload;
}

async function getPdvPublicationCandidate(productRef = "") {
  const productId = Number(productRef);
  if (!Number.isFinite(productId) || productId <= 0) {
    return null;
  }
  const fulfillment = getFulfillmentConfig();
  const productRow = await get(
    `SELECT id AS product_id, name, product_type, status AS product_status, sale_price_cents
     FROM pdv_products_v2 WHERE id = ?`,
    [productId]
  );
  if (!productRow) {
    return null;
  }
  const publicationMap = await loadPublicationMapByProductIds([productId]);
  const variantsByProduct = await fetchVariantsWithBalances([productId], fulfillment.store_ids);
  const variants = buildVariantCandidates(
    variantsByProduct.get(productId) || [],
    productRow,
    fulfillment
  );
  const publication = publicationMap.get(productId) || null;
  const productActive = normalizeText(productRow.product_status) === "ativo";
  const anySellable = variants.some((v) => v.sellable);
  const bestAvailability = variants.reduce((best, variant) => {
    const order = { in_stock: 3, low_stock: 2, out_of_stock: 1 };
    return (order[variant.availability] || 0) > (order[best] || 0)
      ? variant.availability
      : best;
  }, "out_of_stock");

  const item = toPublicationCandidate({
    ...productRow,
    id: productRow.product_id,
    status: productRow.product_status,
    sellable: productActive && anySellable,
    availability: bestAvailability,
    publication,
    publication_status: publication?.status || "none",
    variants
  }, variants, { threshold: fulfillment.low_stock_threshold });

  return {
    success: true,
    schema_ready: (await getShopPublicationSchemaStatus()).ready,
    pilot_json_active: isPilotJsonEnabled(),
    item
  };
}

async function listPublicationRecords(query = {}) {
  const schemaStatus = await getShopPublicationSchemaStatus();
  if (!schemaStatus.ready) {
    return {
      success: true,
      schema_ready: false,
      pilot_json_active: isPilotJsonEnabled(),
      items: [],
      message: "Tabelas shop_* ainda não aplicadas. Nenhuma publicação SQL disponível."
    };
  }
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 50));
  const rows = await all(
    `SELECT id, product_id, public_slug, status, public_title, public_category_slug,
            featured, sort_order, published_at, updated_at
     FROM shop_product_publications
     ORDER BY sort_order ASC, updated_at DESC
     LIMIT ?`,
    [limit]
  );
  const items = rows.map((row) => ({
    publication_id: Number(row.id),
    pdv_product_ref: Number(row.product_id),
    public_slug: normalizeText(row.public_slug),
    status: normalizeText(row.status),
    public_title: normalizeText(row.public_title),
    public_category_slug: normalizeText(row.public_category_slug),
    featured: Boolean(row.featured),
    sort_order: Number(row.sort_order || 0),
    published_at: row.published_at || null,
    updated_at: row.updated_at || null
  }));
  assertNoForbiddenAdminKeys({ items });
  return {
    success: true,
    schema_ready: true,
    pilot_json_active: isPilotJsonEnabled(),
    items
  };
}

module.exports = {
  SHOP_PUBLICATION_TABLES,
  getShopPublicationSchemaStatus,
  listPdvPublicationCandidates,
  getPdvPublicationCandidate,
  listPublicationRecords,
  aggregateSellableQty,
  resolveAvailabilityLabel,
  parseAttributes
};
