"use strict";

const fs = require("fs");
const path = require("path");
const { all } = require("../../../db");
const { searchInventoryProducts } = require("../inventory/pdvInventoryService");

const PAGE_LIMITS = new Set([25, 50, 100]);
const legacyProductsPath = path.join(__dirname, "..", "..", "..", "data", "imports", "pdv", "datasets", "produtos.json");
let legacyProductsCache = null;
let legacyProductsCacheMtime = 0;

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeLookup(value = "") {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function uniqueText(values = []) {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
}

function parseAttributes(value = "{}") {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function parseDelimited(value = "") {
  if (Array.isArray(value)) return uniqueText(value);
  return uniqueText(String(value || "").split(/[,;|]/));
}

function normalizeStatus(value = "") {
  const status = normalizeLookup(value);
  if (["hidden", "bloqueado", "bloqueado para venda", "bloqueado_para_venda"].includes(status)) {
    return "bloqueado_para_venda";
  }
  if (["inactive", "inativo", "deleted"].includes(status)) return "inativo";
  return "ativo";
}

function matchesQuery(item = {}, query = "") {
  const lookup = normalizeLookup(query);
  if (!lookup) return true;
  const digits = String(query || "").replace(/\D/g, "");
  const isCodeLikeQuery = Boolean(digits && /^[\d\s.\-_/]+$/.test(String(query || "")));
  const text = normalizeLookup([
    item.name,
    item.display_name,
    item.commercial_name,
    item.base_sku,
    item.sku,
    item.codigo,
    item.tiny_id,
    item.codigo_tiny,
    item.codigo_barras,
    item.barcode,
    item.brand,
    item.marca,
    item.category,
    item.categoria,
    item.color,
    item.cor,
    item.size,
    item.tamanho,
    ...(item.colors || []),
    ...(item.sizes || []),
    ...(item.variants || []).flatMap((variant) => [
      variant.sku,
      variant.barcode,
      variant.color,
      variant.size
    ])
  ].join(" "));
  if (text.includes(lookup)) return true;
  const tokens = lookup.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => text.includes(token))) return true;
  if (!isCodeLikeQuery) return false;
  return [
    item.codigo_barras,
    item.barcode,
    item.gtin_ean,
    item.ean,
    ...(item.variants || []).map((variant) => variant.barcode)
  ].some((value) => String(value || "").replace(/\D/g, "").includes(digits));
}

function mapInventoryProduct(item = {}) {
  const availableQty = toNumber(item.available_qty ?? item.estoque);
  const reservedQty = toNumber(item.reserved_qty);
  const physicalQty = availableQty + reservedQty;
  return {
    id: `inventory:${normalizeText(item.inventory_id || item.product_id || item.sku || item.codigo)}`,
    product_id: item.product_id || "",
    inventory_id: item.inventory_id || "",
    normalized_product: false,
    legacy_adapter: true,
    parent_sellable: false,
    name: item.nome || "Produto",
    display_name: item.nome || "Produto",
    commercial_name: item.nome || "Produto",
    product_type: "simple",
    status: normalizeStatus(item.status),
    base_sku: item.parent_sku || item.sku || item.codigo || "",
    sku: item.sku || item.codigo || item.codigo_interno || item.codigo_etiqueta || "",
    codigo: item.codigo || item.codigo_interno || item.codigo_etiqueta || item.sku || "",
    tiny_id: item.codigo_tiny || "",
    codigo_tiny: item.codigo_tiny || "",
    codigo_barras: item.codigo_barras || item.ean || "",
    barcode: item.codigo_barras || item.ean || "",
    gtin_ean: item.codigo_barras || item.ean || "",
    ean: item.ean || item.codigo_barras || "",
    price: toNumber(item.preco_venda),
    cost_price: toNumber(item.preco_custo),
    brand: item.marca || "",
    marca: item.marca || "",
    category: item.categoria || "",
    color: item.cor || "",
    colors: uniqueText([item.cor]),
    sizes: uniqueText([item.tamanho]),
    store: item.store_id || "",
    preview_url: item.photo_preview_url || item.media_url || item.foto || "",
    updated_at: item.updated_at || "",
    physical_qty: physicalQty,
    reserved_qty: reservedQty,
    available_qty: availableQty,
    stock: physicalQty,
    estoque_total: physicalQty,
    source: item.source || "pdv_inventory",
    variants: [{
      variation_id: "",
      sku: item.sku || item.codigo || "",
      barcode: item.codigo_barras || item.ean || "",
      status: normalizeStatus(item.status),
      attribute_key: "INVENTORY",
      is_default: true,
      color: item.cor || "",
      size: item.tamanho || "",
      store_id: item.store_id || "",
      physical_qty: physicalQty,
      reserved_qty: reservedQty,
      available_qty: availableQty
    }]
  };
}

function matchesFilters(item = {}, filters = {}) {
  const storeId = normalizeLookup(filters.storeId || filters.store);
  if (storeId && normalizeText(item.store) && normalizeLookup(item.store) !== storeId) return false;
  const status = normalizeStatus(filters.status);
  if (normalizeText(filters.status) && status !== normalizeStatus(item.status)) return false;
  const productType = normalizeLookup(filters.productType || filters.type);
  if (productType && productType !== "all") {
    const expected = ["grade", "variants", "variable"].includes(productType) ? "variable" : "simple";
    if (item.product_type !== expected) return false;
  }
  const exactFilters = [
    ["brand", item.brand || item.marca],
    ["category", item.category || item.categoria]
  ];
  if (exactFilters.some(([key, value]) => (
    normalizeText(filters[key])
    && normalizeLookup(value) !== normalizeLookup(filters[key])
  ))) return false;
  if (normalizeText(filters.color) && !(item.colors || []).some((value) => normalizeLookup(value) === normalizeLookup(filters.color))) return false;
  if (normalizeText(filters.size) && !(item.sizes || []).some((value) => normalizeLookup(value) === normalizeLookup(filters.size))) return false;
  const stockMode = normalizeLookup(filters.stockMode || filters.stock);
  if (stockMode === "with stock" || stockMode === "with_stock" || stockMode === "com estoque") {
    if (toNumber(item.available_qty) <= 0) return false;
  }
  if (stockMode === "without stock" || stockMode === "without_stock" || stockMode === "sem estoque") {
    if (toNumber(item.available_qty) > 0) return false;
  }
  if (stockMode === "reserved" || stockMode === "with_reserved" || stockMode === "com reservado") {
    if (toNumber(item.reserved_qty) <= 0) return false;
  }
  if (stockMode === "blocked" || stockMode === "bloqueado") {
    if (normalizeStatus(item.status) !== "bloqueado_para_venda"
      && !(item.variants || []).some((variant) => normalizeStatus(variant.status) === "bloqueado_para_venda")) return false;
  }
  if (stockMode === "low" || stockMode === "low_stock" || stockMode === "estoque baixo") {
    if (toNumber(item.available_qty) <= 0 || toNumber(item.available_qty) > 3) return false;
  }
  return true;
}

async function listNormalizedProducts({ storeId = "" } = {}) {
  const rows = await all(
    `SELECT
       p.id AS parent_product_id,
       p.legacy_ai_product_id,
       p.name,
       p.product_type,
       p.status AS product_status,
       p.base_sku,
       p.sale_price_cents,
       p.cost_price_cents,
       p.updated_at,
       a.commercial_name,
       a.category,
       a.marca,
       a.main_media_id,
       a.price AS catalog_price,
       a.promotional_price AS catalog_promotional_price,
       v.id AS variation_id,
       v.sku,
       v.barcode,
       v.status AS variation_status,
       v.attributes_json,
       v.attribute_key,
       v.is_default,
       v.sale_price_cents AS variation_sale_price_cents,
       v.cost_price_cents AS variation_cost_price_cents,
       b.store_id,
       b.available_qty AS physical_qty,
       b.reserved_qty
     FROM pdv_products_v2 p
     INNER JOIN pdv_product_variants v ON v.product_id = p.id
     LEFT JOIN ai_products a ON a.id = p.legacy_ai_product_id
     LEFT JOIN pdv_inventory_balances_v2 b
       ON b.variant_id = v.id
      AND (? = '' OR b.store_id = ? COLLATE NOCASE)
     ORDER BY p.updated_at DESC, p.id DESC, v.created_at, v.id`,
    [normalizeText(storeId), normalizeText(storeId)]
  );
  const parents = new Map();
  rows.forEach((row) => {
    if (!parents.has(row.parent_product_id)) {
      parents.set(row.parent_product_id, {
        id: String(row.legacy_ai_product_id || `normalized:${row.parent_product_id}`),
        normalized_parent_product_id: row.parent_product_id,
        legacy_ai_product_id: row.legacy_ai_product_id,
        normalized_product: true,
        legacy_adapter: false,
        parent_sellable: false,
        name: row.name,
        display_name: row.commercial_name || row.name,
        commercial_name: row.commercial_name || row.name,
        product_type: row.product_type,
        status: normalizeStatus(row.product_status),
        base_sku: row.base_sku,
        sku: row.base_sku,
        codigo: row.base_sku,
        price: toNumber(row.sale_price_cents) / 100,
        original_price: toNumber(row.catalog_price || row.sale_price_cents / 100) || null,
        compare_at_price: toNumber(row.catalog_price || row.sale_price_cents / 100) || null,
        promotional_price: toNumber(row.catalog_promotional_price || 0) || null,
        promotionalPrice: toNumber(row.catalog_promotional_price || 0) || null,
        cost_price: row.cost_price_cents === null ? null : toNumber(row.cost_price_cents) / 100,
        brand: row.marca || "",
        marca: row.marca || "",
        category: row.category || "",
        main_media_id: row.main_media_id || null,
        preview_url: row.main_media_id ? `/api/uploads/media/${Number(row.main_media_id)}/preview` : "",
        updated_at: row.updated_at,
        store: normalizeText(storeId),
        variants: [],
        _variantsById: new Map()
      });
    }
    const attributes = parseAttributes(row.attributes_json);
    const physicalQty = toNumber(row.physical_qty);
    const reservedQty = toNumber(row.reserved_qty);
    const parent = parents.get(row.parent_product_id);
    if (!parent._variantsById.has(row.variation_id)) {
      const variant = {
        variation_id: row.variation_id,
        sku: row.sku,
        barcode: row.barcode || "",
        status: normalizeStatus(row.variation_status),
        attribute_key: row.attribute_key,
        is_default: Boolean(row.is_default),
        color: normalizeText(attributes.color),
        size: normalizeText(attributes.size),
        store_id: row.store_id || normalizeText(storeId),
        price: toNumber(row.variation_sale_price_cents ?? row.sale_price_cents) / 100,
        cost_price: row.variation_cost_price_cents === null
          ? (row.cost_price_cents === null ? null : toNumber(row.cost_price_cents) / 100)
          : toNumber(row.variation_cost_price_cents) / 100,
        physical_qty: 0,
        reserved_qty: 0,
        available_qty: 0,
        balances: []
      };
      parent._variantsById.set(row.variation_id, variant);
      parent.variants.push(variant);
    }
    const variant = parent._variantsById.get(row.variation_id);
    if (row.store_id || storeId) {
      variant.balances.push({
        store_id: row.store_id || normalizeText(storeId),
        physical_qty: physicalQty,
        reserved_qty: reservedQty,
        available_qty: physicalQty - reservedQty
      });
    }
    variant.physical_qty = toNumber(variant.physical_qty) + physicalQty;
    variant.reserved_qty = toNumber(variant.reserved_qty) + reservedQty;
    variant.available_qty = variant.physical_qty - variant.reserved_qty;
  });
  return Array.from(parents.values()).map((parent) => {
    const physicalQty = parent.variants.reduce((sum, variant) => sum + variant.physical_qty, 0);
    const reservedQty = parent.variants.reduce((sum, variant) => sum + variant.reserved_qty, 0);
    const { _variantsById, ...publicParent } = parent;
    return {
      ...publicParent,
      colors: uniqueText(parent.variants.map((variant) => variant.color)),
      sizes: uniqueText(parent.variants.map((variant) => variant.size)),
      physical_qty: physicalQty,
      reserved_qty: reservedQty,
      available_qty: physicalQty - reservedQty,
      stock: physicalQty,
      estoque_total: physicalQty
    };
  });
}

async function listLegacySqliteProducts() {
  const rows = await all(
    `SELECT p.*, ab.brand AS brand_meta
     FROM ai_products p
     LEFT JOIN ai_product_brand_meta ab ON ab.product_id = p.id
     WHERE COALESCE(p.deleted_at, '') = ''
       AND NOT EXISTS (
         SELECT 1 FROM pdv_products_v2 normalized
         WHERE normalized.legacy_ai_product_id = p.id
       )
     ORDER BY CASE p.priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
              p.updated_at DESC,
              p.id DESC`
  );
  return rows.map((row) => {
    const physicalQty = toNumber(row.stock ?? row.estoque_total);
    return {
      id: String(row.id),
      legacy_ai_product_id: row.id,
      normalized_product: false,
      legacy_adapter: true,
      parent_sellable: false,
      name: row.name,
      display_name: row.commercial_name || row.name,
      commercial_name: row.commercial_name || row.name,
      product_type: "simple",
      status: normalizeStatus(row.status),
      base_sku: row.sku || row.codigo || "",
      sku: row.sku || row.codigo || "",
      codigo: row.codigo || row.sku || "",
      tiny_id: row.tiny_id || "",
      codigo_tiny: row.tiny_id || "",
      codigo_barras: row.gtin_ean || "",
      barcode: row.gtin_ean || "",
      price: toNumber(row.price),
      promotional_price: row.promotional_price,
      cost_price: row.cost_price,
      brand: row.brand_meta || row.marca || "",
      marca: row.brand_meta || row.marca || "",
      category: row.category || "",
      color: row.color || "",
      colors: uniqueText([row.color]),
      sizes: parseDelimited(row.sizes),
      store: row.store || "",
      main_media_id: row.main_media_id || null,
      preview_url: row.main_media_id ? `/api/uploads/media/${Number(row.main_media_id)}/preview` : "",
      updated_at: row.updated_at,
      physical_qty: physicalQty,
      reserved_qty: 0,
      available_qty: physicalQty,
      stock: physicalQty,
      estoque_total: physicalQty,
      variants: [{
        variation_id: "",
        sku: row.sku || row.codigo || "",
        barcode: row.gtin_ean || "",
        status: normalizeStatus(row.status),
        attribute_key: "LEGACY",
        is_default: true,
        color: row.color || "",
        size: normalizeText(row.sizes),
        store_id: row.store || "",
        physical_qty: physicalQty,
        reserved_qty: 0,
        available_qty: physicalQty
      }]
    };
  });
}

function loadLegacyJsonProducts() {
  const stat = fs.statSync(legacyProductsPath);
  if (legacyProductsCache && legacyProductsCacheMtime === stat.mtimeMs) return legacyProductsCache;
  legacyProductsCache = JSON.parse(fs.readFileSync(legacyProductsPath, "utf8"));
  legacyProductsCacheMtime = stat.mtimeMs;
  return legacyProductsCache;
}

function searchLegacyJsonProducts(query = "", storeId = "") {
  if (!normalizeText(query)) return [];
  return loadLegacyJsonProducts()
    .filter((row) => matchesQuery(row, query))
    .filter((row) => !storeId || !row.store_id || normalizeLookup(row.store_id) === normalizeLookup(storeId))
    .slice(0, 300)
    .map((row) => {
      const physicalQty = toNumber(row.estoque);
      return {
        id: `legacy:${row.product_id || row.sku || row.codigo}`,
        product_id: row.product_id || "",
        normalized_product: false,
        legacy_adapter: true,
        parent_sellable: false,
        name: row.nome,
        display_name: row.nome,
        commercial_name: row.nome,
        product_type: "simple",
        status: normalizeStatus(row.status),
        base_sku: row.sku || row.codigo || "",
        sku: row.sku || row.codigo || "",
        codigo: row.codigo || row.sku || "",
        tiny_id: row.codigo_tiny || "",
        codigo_tiny: row.codigo_tiny || "",
        codigo_barras: row.codigo_barras || row.ean || "",
        barcode: row.codigo_barras || row.ean || "",
        price: toNumber(row.preco_venda),
        cost_price: toNumber(row.preco_custo),
        brand: row.marca || "",
        marca: row.marca || "",
        category: row.categoria || "",
        color: row.cor || "",
        colors: uniqueText([row.cor]),
        sizes: uniqueText([row.tamanho]),
        store: row.store_id || "",
        preview_url: row.photo_preview_url || row.media_url || row.foto || "",
        updated_at: row.updated_at || row.created_at || "",
        physical_qty: physicalQty,
        reserved_qty: 0,
        available_qty: physicalQty,
        stock: physicalQty,
        estoque_total: physicalQty,
        variants: [{
          variation_id: "",
          sku: row.sku || row.codigo || "",
          barcode: row.codigo_barras || row.ean || "",
          status: normalizeStatus(row.status),
          attribute_key: "LEGACY",
          is_default: true,
          color: row.cor || "",
          size: row.tamanho || "",
          store_id: row.store_id || "",
          physical_qty: physicalQty,
          reserved_qty: 0,
          available_qty: physicalQty
        }]
      };
    });
}

function buildDedupeKeys(item = {}) {
  return uniqueText([
    item.legacy_ai_product_id ? `ai:${item.legacy_ai_product_id}` : "",
    item.base_sku ? `sku:${normalizeLookup(item.base_sku)}` : "",
    item.sku ? `sku:${normalizeLookup(item.sku)}` : "",
    item.codigo_tiny ? `tiny:${normalizeLookup(item.codigo_tiny)}` : "",
    item.tiny_id ? `tiny:${normalizeLookup(item.tiny_id)}` : "",
    item.codigo_barras ? `barcode:${String(item.codigo_barras).replace(/\D/g, "")}` : ""
  ]);
}

function dedupeProducts(items = []) {
  const result = [];
  const keyToIndex = new Map();
  items.forEach((item) => {
    const keys = buildDedupeKeys(item);
    const existingIndex = keys.map((key) => keyToIndex.get(key)).find((value) => value !== undefined);
    if (existingIndex !== undefined) {
      if (item.normalized_product && !result[existingIndex].normalized_product) {
        result[existingIndex] = item;
        keys.forEach((key) => keyToIndex.set(key, existingIndex));
      }
      return;
    }
    const index = result.length;
    result.push(item);
    keys.forEach((key) => keyToIndex.set(key, index));
  });
  return result;
}

async function listProductManagementCatalog(filters = {}) {
  const page = Math.max(1, Number(filters.page || 1));
  const limit = Number(filters.limit || 25);
  if (!PAGE_LIMITS.has(limit)) {
    throw new Error("A paginacao aceita somente 25, 50 ou 100 produtos por pagina.");
  }
  const query = normalizeText(filters.query || filters.q || filters.search || "");
  const storeId = normalizeText(filters.storeId || filters.store || "");
  const normalized = await listNormalizedProducts({ storeId });
  const legacySqlite = await listLegacySqliteProducts();
  let combined = dedupeProducts([...normalized, ...legacySqlite]);
  combined = combined
    .filter((item) => matchesQuery(item, query))
    .filter((item) => matchesFilters(item, filters));

  if (query && !combined.length) {
    const operational = searchInventoryProducts(query, { storeId, limit: 1000 }).map(mapInventoryProduct);
    combined = dedupeProducts([
      ...operational,
      ...searchLegacyJsonProducts(query, storeId)
    ])
      .filter((item) => matchesQuery(item, query))
      .filter((item) => matchesFilters(item, filters));
  }

  combined.sort((left, right) => {
    if (left.normalized_product !== right.normalized_product) return left.normalized_product ? -1 : 1;
    return String(right.updated_at || "").localeCompare(String(left.updated_at || ""));
  });
  const total = combined.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * limit;
  const items = combined.slice(offset, offset + limit);
  return {
    items,
    summary: {
      total,
      active: combined.filter((item) => item.status === "ativo").length,
      blocked: combined.filter((item) => item.status === "bloqueado_para_venda").length,
      inactive: combined.filter((item) => item.status === "inativo").length,
      simple: combined.filter((item) => item.product_type === "simple").length,
      variable: combined.filter((item) => item.product_type === "variable").length,
      with_stock: combined.filter((item) => item.available_qty > 0).length,
      without_stock: combined.filter((item) => item.available_qty <= 0).length,
      with_reserved: combined.filter((item) => item.reserved_qty > 0).length
    },
    pagination: {
      page: safePage,
      limit,
      total,
      totalPages,
      total_pages: totalPages,
      has_more: safePage < totalPages
    }
  };
}

async function listProductManagementMovements(productId, { storeId = "", limit = 100 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(200, Number(limit || 100)));
  const identifier = normalizeText(productId);
  const rows = await all(
    `SELECT
       m.id,
       m.variant_id,
       m.store_id,
       m.movement_type,
       m.quantity_delta,
       m.quantity_before,
       m.quantity_after,
       m.origin,
       m.reference_type,
       m.reference_id,
       m.actor_name,
       m.created_at,
       v.sku,
       v.barcode,
       v.attributes_json
     FROM pdv_inventory_movements_v2 m
     INNER JOIN pdv_product_variants v ON v.id = m.variant_id
     INNER JOIN pdv_products_v2 p ON p.id = v.product_id
     WHERE (
       CAST(p.id AS TEXT) = ?
       OR CAST(p.legacy_ai_product_id AS TEXT) = ?
       OR p.base_sku = ? COLLATE NOCASE
     )
       AND (? = '' OR m.store_id = ? COLLATE NOCASE)
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT ?`,
    [identifier, identifier, identifier, normalizeText(storeId), normalizeText(storeId), normalizedLimit]
  );
  return rows.map((row) => {
    const attributes = parseAttributes(row.attributes_json);
    return {
      ...row,
      color: normalizeText(attributes.color),
      size: normalizeText(attributes.size)
    };
  });
}

module.exports = {
  listProductManagementCatalog,
  listProductManagementMovements
};
