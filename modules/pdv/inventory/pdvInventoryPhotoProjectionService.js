"use strict";

const { all } = require("../../../db");

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeIdentity(value = "") {
  return normalizeText(value).toUpperCase();
}

function normalizeDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function getProductPreviewUrl(product = {}) {
  const mediaId = Number(product.main_media_id || product.media_id || 0);
  return normalizeText(product.preview_url || (mediaId ? `/api/uploads/media/${mediaId}/preview` : ""));
}

function appendIndex(index, value, product) {
  const key = normalizeIdentity(value);
  if (!key) return;
  const items = index.get(key) || [];
  if (!items.some((item) => Number(item.id || 0) === Number(product.id || 0))) {
    items.push(product);
    index.set(key, items);
  }
}

function buildPhotoProductIndexes(products = []) {
  const indexes = {
    productId: new Map(),
    sku: new Map(),
    code: new Map(),
    barcode: new Map()
  };
  (Array.isArray(products) ? products : []).forEach((product) => {
    if (!getProductPreviewUrl(product)) return;
    appendIndex(indexes.productId, product.id, product);
    appendIndex(indexes.productId, `AI_${product.id}`, product);
    appendIndex(indexes.sku, product.sku, product);
    appendIndex(indexes.code, product.codigo, product);
    const barcode = normalizeDigits(product.gtin_ean || product.barcode || product.codigo_barras || "");
    if (barcode) appendIndex(indexes.barcode, barcode, product);
  });
  return indexes;
}

function lookupUniqueProduct(index, values = [], matchBy = "", logger = console) {
  const uniqueProducts = new Map();
  values.map((value) => normalizeIdentity(value)).filter(Boolean).forEach((key) => {
    (index.get(key) || []).forEach((product) => uniqueProducts.set(Number(product.id || 0), product));
  });
  const matches = Array.from(uniqueProducts.values());
  if (matches.length === 1) {
    return { product: matches[0], matchBy };
  }
  if (matches.length > 1) {
    logger?.warn?.("[PDV STOCK PHOTO] Match ambiguo; foto do cadastro nao projetada.", {
      match_by: matchBy,
      values: values.map((value) => normalizeText(value)).filter(Boolean),
      product_ids: matches.map((product) => Number(product.id || 0)).filter(Boolean)
    });
    return { ambiguous: true, matchBy };
  }
  return null;
}

function resolveInventoryProductPhoto(item = {}, indexes = buildPhotoProductIndexes(), logger = console) {
  const ownPhoto = normalizeText(item.photo_preview_url || item.preview_url || item.image || "");
  if (ownPhoto) {
    return {
      ...item,
      photo_preview_url_resolved: ownPhoto,
      photo_source: "inventory_snapshot"
    };
  }

  const matchSteps = [
    {
      index: indexes.productId,
      values: [item.product_id, item.ai_product_id],
      matchBy: "product_id"
    },
    {
      index: indexes.sku,
      values: [item.sku],
      matchBy: "sku"
    },
    {
      index: indexes.code,
      values: [item.codigo_interno, item.codigo],
      matchBy: "codigo_interno"
    },
    {
      index: indexes.barcode,
      values: [normalizeDigits(item.codigo_barras || item.ean || item.barcode || "")],
      matchBy: "barcode"
    }
  ];

  for (const step of matchSteps) {
    const result = lookupUniqueProduct(step.index, step.values, step.matchBy, logger);
    if (result?.ambiguous) {
      return {
        ...item,
        photo_projection_status: "ambiguous",
        photo_projection_match_by: step.matchBy
      };
    }
    if (result?.product) {
      return {
        ...item,
        photo_preview_url_resolved: getProductPreviewUrl(result.product),
        photo_source: "product_profile",
        photo_projection_match_by: result.matchBy,
        photo_product_profile_id: Number(result.product.id || 0) || null
      };
    }
  }

  return item;
}

function projectInventoryProductPhotos(items = [], products = [], logger = console) {
  const indexes = buildPhotoProductIndexes(products);
  return (Array.isArray(items) ? items : []).map((item) => resolveInventoryProductPhoto(item, indexes, logger));
}

async function listProductPhotoProfiles() {
  return all(
    `SELECT id, sku, codigo, gtin_ean, main_media_id
     FROM ai_products
     WHERE COALESCE(deleted_at, '') = ''
       AND COALESCE(main_media_id, 0) > 0`
  );
}

async function projectInventoryPayloadPhotos(payload = {}, logger = console) {
  const products = await listProductPhotoProfiles();
  if (Array.isArray(payload.items)) {
    return {
      ...payload,
      items: projectInventoryProductPhotos(payload.items, products, logger)
    };
  }
  return resolveInventoryProductPhoto(payload, buildPhotoProductIndexes(products), logger);
}

module.exports = {
  buildPhotoProductIndexes,
  getProductPreviewUrl,
  listProductPhotoProfiles,
  projectInventoryPayloadPhotos,
  projectInventoryProductPhotos,
  resolveInventoryProductPhoto
};
