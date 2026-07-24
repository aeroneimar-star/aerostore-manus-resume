"use strict";

const { get, all } = require("../../../db");
const {
  isPilotJsonEnabled,
  isShopPublicCatalogEnabled
} = require("./shopSettingsService");
const { getAvailabilityLabel, getFulfillmentConfig } = require("./shopStockService");
const {
  toPublicationCandidate,
  toPublicationCandidateList,
  toPublicationRecord,
  parseAttributes,
  assertNoForbiddenAdminKeys
} = require("../dto/publicationAdminDto");

const SHOP_PUBLICATION_TABLES = [
  "shop_product_publications",
  "shop_variant_publications",
  "shop_product_images",
  "shop_catalog_settings"
];

const TEST_NAME_PATTERNS = [
  /\bqa\b/i,
  /\bteste\b/i,
  /\btest\b/i,
  /manual normalizado/i,
  /grade api/i,
  /ciclo 2 api/i,
  /ciclo 3/i,
  /ciclo 4/i,
  /smoke/i,
  /sandbox/i,
  /\bmassa\b/i,
  /dummy/i,
  /fake/i
];

const BLOCK_REASON = {
  TEST: "Suspeito teste/QA",
  INACTIVE: "Produto inativo",
  NO_VARIANTS: "Sem variações",
  NO_ACTIVE_VARIANT: "Sem variação ativa",
  NO_POOL_STOCK: "Sem estoque no pool",
  LOW_STOCK: "Estoque baixo",
  SELLABLE: "Vendável",
  INCOMPLETE: "Dados incompletos para publicação"
};

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseIncludeTestCandidates(query = {}) {
  const raw = query.include_test_candidates;
  if (raw === undefined || raw === null || raw === "") {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function isTestCandidate(product = {}) {
  const name = normalizeText(product.name || product.product_name);
  if (!name) {
    return false;
  }
  return TEST_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

function hasValidPrice(priceCents = 0) {
  return Number(priceCents) > 0;
}

function resolveBestAvailability(variants = []) {
  return variants.reduce((best, variant) => {
    const order = { in_stock: 3, low_stock: 2, out_of_stock: 1 };
    return (order[variant.availability] || 0) > (order[best] || 0)
      ? variant.availability
      : best;
  }, "out_of_stock");
}

function buildCandidateDiagnostics({
  productRow = {},
  variants = [],
  sellable = false,
  availability = "out_of_stock"
} = {}) {
  const reasons = [];
  const productActive = normalizeText(productRow.product_status) === "ativo";
  const testCandidate = isTestCandidate(productRow);
  const activeVariants = variants.filter((variant) => normalizeText(variant.variation_status) === "ativo");
  const priceValid = hasValidPrice(productRow.sale_price_cents);

  if (testCandidate) {
    reasons.push(BLOCK_REASON.TEST);
  }
  if (!productActive) {
    reasons.push(BLOCK_REASON.INACTIVE);
  }
  if (!variants.length) {
    reasons.push(BLOCK_REASON.NO_VARIANTS);
  } else if (!activeVariants.length) {
    reasons.push(BLOCK_REASON.NO_ACTIVE_VARIANT);
  }
  if (productActive && activeVariants.length && !sellable) {
    reasons.push(BLOCK_REASON.NO_POOL_STOCK);
  }
  if (!priceValid) {
    reasons.push(BLOCK_REASON.INCOMPLETE);
  }
  if (sellable && availability === "low_stock") {
    reasons.push(BLOCK_REASON.LOW_STOCK);
  }
  if (sellable) {
    reasons.push(BLOCK_REASON.SELLABLE);
  }

  const uniqueReasons = Array.from(new Set(reasons));
  const primary = uniqueReasons.find((reason) => reason !== BLOCK_REASON.SELLABLE)
    || uniqueReasons[0]
    || BLOCK_REASON.INCOMPLETE;

  const isPotentiallyPublishable = !testCandidate
    && productActive
    && activeVariants.length > 0
    && sellable
    && (availability === "in_stock" || availability === "low_stock")
    && priceValid;

  return {
    is_test_candidate: testCandidate,
    block_reasons: uniqueReasons,
    block_reason_primary: primary,
    is_potentially_publishable: isPotentiallyPublishable
  };
}

function computeCandidateStats(items = []) {
  const cleanItems = items.filter((item) => !item.is_test_candidate);
  return {
    total_raw: items.length,
    hidden_test_count: items.filter((item) => item.is_test_candidate).length,
    clean_total: cleanItems.length,
    sellable: cleanItems.filter((item) => item.sellable).length,
    in_stock: cleanItems.filter((item) => item.availability === "in_stock").length,
    low_stock: cleanItems.filter((item) => item.availability === "low_stock").length,
    blocked: cleanItems.filter((item) => !item.sellable).length,
    potentially_publishable: cleanItems.filter((item) => item.is_potentially_publishable).length
  };
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

function parseMetadataJson(raw = "{}") {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function publicationNeedsPhoto(row = {}) {
  const metadata = parseMetadataJson(row.metadata_json);
  if (Object.prototype.hasOwnProperty.call(metadata, "needs_photo")) {
    return Boolean(metadata.needs_photo);
  }
  return Number(row.image_count || 0) <= 0;
}

async function loadPublicationMapByProductIds(productIds = []) {
  const ids = productIds.map((id) => Number(id)).filter((id) => id > 0);
  if (!ids.length || !(await isTableReady("shop_product_publications"))) {
    return new Map();
  }
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await all(
    `SELECT
       p.id,
       p.product_id,
       p.public_slug,
       p.status,
       p.public_title,
       p.public_short_description,
       p.public_category_slug,
       p.public_category_label,
       p.featured,
       p.sort_order,
       p.metadata_json,
       (
         SELECT COUNT(*) FROM shop_product_images i
         WHERE i.publication_id = p.id
       ) AS image_count
     FROM shop_product_publications p
     WHERE p.product_id IN (${placeholders})`,
    ids
  );
  const map = new Map();
  rows.forEach((row) => {
    map.set(Number(row.product_id), {
      id: row.id,
      product_id: row.product_id,
      public_slug: row.public_slug,
      status: row.status,
      public_title: row.public_title,
      public_short_description: row.public_short_description,
      public_category_slug: row.public_category_slug,
      public_category_label: row.public_category_label,
      featured: row.featured,
      sort_order: row.sort_order,
      metadata_json: row.metadata_json,
      image_count: Number(row.image_count || 0),
      needs_photo: publicationNeedsPhoto(row)
    });
  });
  return map;
}

async function getPublicationLayerStats() {
  if (!(await isTableReady("shop_product_publications"))) {
    return {
      total: 0,
      draft: 0,
      published: 0,
      archived: 0,
      featured: 0,
      needs_photo: 0,
      with_images: 0
    };
  }

  const statusRows = await all(
    `SELECT status, COUNT(*) AS c
     FROM shop_product_publications
     GROUP BY status`
  );
  const counts = { draft: 0, published: 0, archived: 0 };
  let total = 0;
  statusRows.forEach((row) => {
    const key = normalizeText(row.status);
    const value = Number(row.c || 0);
    total += value;
    if (Object.prototype.hasOwnProperty.call(counts, key)) {
      counts[key] = value;
    }
  });

  const featuredRow = await get(
    `SELECT COUNT(*) AS c FROM shop_product_publications WHERE featured = 1`
  );
  const imageReady = await isTableReady("shop_product_images");
  let withImages = 0;
  let needsPhoto = counts.draft + counts.published + counts.archived;
  if (imageReady) {
    const withImagesRow = await get(
      `SELECT COUNT(DISTINCT publication_id) AS c FROM shop_product_images`
    );
    withImages = Number(withImagesRow?.c || 0);
    const needsPhotoRow = await get(
      `SELECT COUNT(*) AS c
       FROM shop_product_publications p
       WHERE (
         json_extract(p.metadata_json, '$.needs_photo') = 1
         OR json_extract(p.metadata_json, '$.needs_photo') = 'true'
         OR (
           (json_extract(p.metadata_json, '$.needs_photo') IS NULL)
           AND NOT EXISTS (
             SELECT 1 FROM shop_product_images i WHERE i.publication_id = p.id
           )
         )
       )`
    );
    needsPhoto = Number(needsPhotoRow?.c || 0);
  }

  return {
    total,
    draft: counts.draft,
    published: counts.published,
    archived: counts.archived,
    featured: Number(featuredRow?.c || 0),
    needs_photo: needsPhoto,
    with_images: withImages
  };
}

function buildProductSearchClause(query = "") {
  const normalizedQuery = normalizeText(query).toLowerCase();
  const like = normalizedQuery ? `%${normalizedQuery}%` : null;
  const params = [];
  let whereClause = "1=1";
  if (like) {
    whereClause += " AND (LOWER(p.name) LIKE ? OR CAST(p.id AS TEXT) = ?)";
    params.push(like, normalizedQuery);
  }
  return { whereClause, params };
}

async function fetchAllPdvProductRows(query = "") {
  const { whereClause, params } = buildProductSearchClause(query);
  return all(
    `SELECT
       p.id AS product_id,
       p.name,
       p.product_type,
       p.status AS product_status,
       p.sale_price_cents
     FROM pdv_products_v2 p
     WHERE ${whereClause}
     ORDER BY p.updated_at DESC, p.id DESC`,
    params
  );
}

async function countPdvProductRows(query = "") {
  const { whereClause, params } = buildProductSearchClause(query);
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

function buildPublicationCandidateItem(productRow, variants, publication, fulfillment) {
  const productActive = normalizeText(productRow.product_status) === "ativo";
  const anySellable = variants.some((variant) => variant.sellable);
  const sellable = productActive && anySellable;
  const availability = resolveBestAvailability(variants);
  const diagnostics = buildCandidateDiagnostics({
    productRow,
    variants,
    sellable,
    availability
  });

  return toPublicationCandidate({
    ...productRow,
    id: productRow.product_id,
    status: productRow.product_status,
    sellable,
    availability,
    publication,
    publication_status: publication?.status || "none",
    variants,
    ...diagnostics
  }, variants, { threshold: fulfillment.low_stock_threshold });
}

function buildSyntheticPublicationCandidate(publication = {}) {
  const status = normalizeText(publication.status || "draft") || "draft";
  const title = normalizeText(publication.public_title || publication.pdv_name || publication.public_slug);
  return toPublicationCandidate({
    product_id: Number(publication.pdv_product_ref || publication.product_id || 0),
    name: title || `Produto #${publication.pdv_product_ref || "?"}`,
    product_type: "simple",
    status: "ativo",
    sale_price_cents: 0,
    sellable: false,
    availability: "out_of_stock",
    publication: {
      id: Number(publication.publication_id || publication.id || 0),
      public_slug: publication.public_slug,
      status,
      public_title: publication.public_title,
      public_short_description: publication.public_short_description,
      public_category_slug: publication.public_category_slug,
      public_category_label: publication.public_category_label,
      featured: publication.featured,
      sort_order: publication.sort_order,
      needs_photo: publication.needs_photo,
      image_count: publication.image_count
    },
    publication_status: status,
    is_test_candidate: false,
    block_reasons: [BLOCK_REASON.INCOMPLETE, "Draft SQL sem espelho PDV completo nesta base"],
    block_reason_primary: "Draft SQL sem espelho PDV completo nesta base",
    is_potentially_publishable: false
  }, []);
}

async function appendMissingPublicationCandidates(items = []) {
  if (!(await isTableReady("shop_product_publications"))) {
    return items;
  }
  const publications = await listPublicationRecords({ limit: 100 });
  const existing = new Set(
    items.map((item) => Number(item.pdv_product_ref)).filter((id) => id > 0)
  );
  const merged = [];
  publications.items.forEach((publication) => {
    const productId = Number(publication.pdv_product_ref || 0);
    if (!productId || existing.has(productId)) {
      return;
    }
    merged.push(buildSyntheticPublicationCandidate(publication));
    existing.add(productId);
  });
  return merged.concat(items);
}

function prioritizeShopPublications(items = []) {
  return items.slice().sort((left, right) => {
    const leftRank = left.publication_status && left.publication_status !== "none" ? 0 : 1;
    const rightRank = right.publication_status && right.publication_status !== "none" ? 0 : 1;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    const leftSort = Number(left.publication?.sort_order || Number.MAX_SAFE_INTEGER);
    const rightSort = Number(right.publication?.sort_order || Number.MAX_SAFE_INTEGER);
    if (leftSort !== rightSort) {
      return leftSort - rightSort;
    }
    return Number(left.pdv_product_ref || 0) - Number(right.pdv_product_ref || 0);
  });
}

async function listPdvPublicationCandidates(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(query.limit, 10) || 24));
  const offset = (page - 1) * limit;
  const search = normalizeText(query.q || query.query || "");
  const includeTestCandidates = parseIncludeTestCandidates(query);
  const schemaStatus = await getShopPublicationSchemaStatus();
  const fulfillment = getFulfillmentConfig();
  const publicationLayer = await getPublicationLayerStats();

  const productRows = await fetchAllPdvProductRows(search);
  const publicationMap = await loadPublicationMapByProductIds(productRows.map((row) => row.product_id));
  const variantsByProduct = await fetchVariantsWithBalances(
    productRows.map((row) => row.product_id),
    fulfillment.store_ids
  );

  let allItems = productRows.map((productRow) => buildPublicationCandidateItem(
    productRow,
    buildVariantCandidates(
      variantsByProduct.get(Number(productRow.product_id)) || [],
      productRow,
      fulfillment
    ),
    publicationMap.get(Number(productRow.product_id)) || null,
    fulfillment
  ));

  if (!search) {
    allItems = prioritizeShopPublications(await appendMissingPublicationCandidates(allItems));
  }

  const stats = computeCandidateStats(allItems);
  const visibleItems = includeTestCandidates
    ? allItems
    : allItems.filter((item) => !item.is_test_candidate);
  const paginatedItems = visibleItems.slice(offset, offset + limit);

  const payload = toPublicationCandidateList({
    schema_ready: schemaStatus.ready,
    pilot_json_active: isPilotJsonEnabled(),
    public_catalog_enabled: isShopPublicCatalogEnabled(),
    page,
    limit,
    total: visibleItems.length,
    include_test_candidates: includeTestCandidates,
    stats,
    publication_layer: publicationLayer,
    items: paginatedItems
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
  const item = buildPublicationCandidateItem(
    productRow,
    variants,
    publicationMap.get(productId) || null,
    fulfillment
  );

  return {
    success: true,
    schema_ready: (await getShopPublicationSchemaStatus()).ready,
    pilot_json_active: isPilotJsonEnabled(),
    public_catalog_enabled: isShopPublicCatalogEnabled(),
    publication_layer: await getPublicationLayerStats(),
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
      public_catalog_enabled: isShopPublicCatalogEnabled(),
      publication_layer: await getPublicationLayerStats(),
      items: [],
      message: "Tabelas shop_* ainda não aplicadas. Nenhuma publicação SQL disponível."
    };
  }
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 50));
  const statusFilter = normalizeText(query.status || query.publication_status || "");
  const params = [];
  let whereClause = "1=1";
  if (statusFilter) {
    whereClause += " AND p.status = ?";
    params.push(statusFilter);
  }
  params.push(limit);

  const rows = await all(
    `SELECT
       p.id,
       p.product_id,
       pdv.name AS pdv_name,
       p.public_slug,
       p.status,
       p.public_title,
       p.public_short_description,
       p.public_category_slug,
       p.public_category_label,
       p.featured,
       p.sort_order,
       p.metadata_json,
       p.published_at,
       p.updated_at,
       (
         SELECT COUNT(*) FROM shop_product_images i
         WHERE i.publication_id = p.id
       ) AS image_count
     FROM shop_product_publications p
     LEFT JOIN pdv_products_v2 pdv ON pdv.id = p.product_id
     WHERE ${whereClause}
     ORDER BY p.sort_order ASC, p.updated_at DESC
     LIMIT ?`,
    params
  );

  const items = rows.map((row) => toPublicationRecord({
    publication_id: row.id,
    pdv_product_ref: row.product_id,
    pdv_name: row.pdv_name,
    public_slug: row.public_slug,
    status: row.status,
    public_title: row.public_title,
    public_short_description: row.public_short_description,
    public_category_slug: row.public_category_slug,
    public_category_label: row.public_category_label,
    featured: row.featured,
    sort_order: row.sort_order,
    needs_photo: publicationNeedsPhoto(row),
    image_count: row.image_count,
    published_at: row.published_at,
    updated_at: row.updated_at
  }));
  assertNoForbiddenAdminKeys({ items });
  return {
    success: true,
    schema_ready: true,
    pilot_json_active: isPilotJsonEnabled(),
    public_catalog_enabled: isShopPublicCatalogEnabled(),
    publication_layer: await getPublicationLayerStats(),
    items
  };
}

module.exports = {
  SHOP_PUBLICATION_TABLES,
  BLOCK_REASON,
  TEST_NAME_PATTERNS,
  getShopPublicationSchemaStatus,
  getPublicationLayerStats,
  listPdvPublicationCandidates,
  getPdvPublicationCandidate,
  listPublicationRecords,
  aggregateSellableQty,
  resolveAvailabilityLabel,
  parseAttributes,
  isTestCandidate,
  buildCandidateDiagnostics,
  computeCandidateStats,
  parseIncludeTestCandidates
};
