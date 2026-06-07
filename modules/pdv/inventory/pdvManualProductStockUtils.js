"use strict";

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeManualProductSize(value = "") {
  return normalizeText(value).toUpperCase();
}

function buildManualProductSizeToken(value = "") {
  return normalizeManualProductSize(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "UN";
}

function normalizeManualProductSizeStockEntries(value = []) {
  let source = value;
  if (typeof source === "string") {
    try {
      source = source.trim() ? JSON.parse(source) : [];
    } catch {
      source = [];
    }
  }
  if (!Array.isArray(source)) {
    return [];
  }
  const seen = new Set();
  return source.reduce((items, entry) => {
    const size = normalizeManualProductSize(entry?.size ?? entry?.tamanho ?? "");
    const quantity = Number(entry?.quantity ?? entry?.quantidade ?? 0);
    if (!size || seen.has(size) || !Number.isFinite(quantity) || quantity < 0) {
      return items;
    }
    seen.add(size);
    items.push({
      size,
      quantity: Number(quantity.toFixed(2))
    });
    return items;
  }, []);
}

function buildManualProductSizeVariantIdentity(product = {}, size = "") {
  const manualProductId = normalizeText(product.id || product.manual_product_id || "");
  const parentProductId = normalizeText(product.parent_product_id || product.product_id || (manualProductId ? `AI_${manualProductId}` : ""));
  const baseCode = normalizeText(
    product.base_code
    || product.sku
    || product.codigo
    || product.codigo_interno
    || (manualProductId ? `AERO-${manualProductId}` : parentProductId)
  );
  const sizeKey = normalizeManualProductSize(size);
  const sizeToken = buildManualProductSizeToken(sizeKey);
  return {
    manualProductId,
    parentProductId,
    baseCode,
    sizeKey,
    sizeToken,
    productId: `${parentProductId}__SIZE__${sizeToken}`,
    sku: `${baseCode}-${sizeToken}`
  };
}

module.exports = {
  normalizeManualProductSize,
  normalizeManualProductSizeStockEntries,
  buildManualProductSizeVariantIdentity
};
