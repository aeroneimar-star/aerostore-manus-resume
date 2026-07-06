"use strict";

const LABEL_BARCODE_ERROR = "Produto sem código de barras válido para etiqueta.";
const CODE128_PREFERRED_MAX_LENGTH = 14;

function normalizeText(value = "") {
  return String(value ?? "").trim();
}

function digitsOnly(value = "") {
  return normalizeText(value).replace(/\D/g, "");
}

function validateEan13Checksum(value = "") {
  const ean = digitsOnly(value);
  if (!/^\d{13}$/.test(ean)) {
    return false;
  }
  const digits = ean.split("").map((item) => Number(item));
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += digits[index] * (index % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === digits[12];
}

function sanitizeCode128Value(value = "") {
  const raw = normalizeText(value);
  if (!raw) {
    return "";
  }
  const cleaned = raw.replace(/[^\x20-\x7E]/g, "").trim();
  if (!cleaned || cleaned.length > 48) {
    return "";
  }
  return cleaned;
}

function isShortCode128Value(value = "") {
  const cleaned = sanitizeCode128Value(value);
  return Boolean(cleaned && cleaned.length <= CODE128_PREFERRED_MAX_LENGTH);
}

function deriveShortVariationScanCode(variationId = "") {
  const raw = normalizeText(variationId).toUpperCase();
  if (!raw) {
    return "";
  }
  const body = raw.startsWith("VAR_") ? raw.slice(4) : raw;
  const compact = body.replace(/[^A-Z0-9]/g, "");
  if (!compact) {
    return "";
  }
  return compact.slice(0, 10);
}

function resolveLabelBarcodeHumanText(source = {}) {
  const sku = sanitizeCode128Value(
    source.barcode_human_text
    || source.label_barcode_human_text
    || source.variant_sku
    || source.sku_variacao
    || source.sku
    || source.codigo
    || ""
  );
  if (sku) {
    return sku;
  }
  const encodedFallback = sanitizeCode128Value(source.barcode_encoded_value || source.label_barcode_value || "");
  return encodedFallback || deriveShortVariationScanCode(source.variation_id);
}

function resolveLabelBarcodeEncoded(source = {}, options = {}) {
  const requireBarcode = options.requireBarcode === true;
  const variationId = normalizeText(source.variation_id || "");
  const hasVariation = Boolean(variationId);

  const eanCandidates = hasVariation
    ? [source.variant_barcode, source.variantBarcode]
    : [
      source.barcode,
      source.gtin_ean,
      source.gtin,
      source.ean,
      source.codigo_barras,
      source.variant_barcode,
      source.variantBarcode
    ];

  for (const candidate of eanCandidates) {
    const digits = digitsOnly(candidate);
    if (digits.length === 13 && validateEan13Checksum(digits)) {
      return {
        encoded_value: digits,
        symbology: "ean13",
        source_field: hasVariation ? "variation_ean13" : "ean13"
      };
    }
  }

  const shortCode128Candidates = hasVariation
    ? [
      source.variant_barcode,
      source.variantBarcode,
      source.variant_sku,
      source.sku_variacao,
      source.barcode,
      source.codigo_interno,
      source.codigo,
      deriveShortVariationScanCode(variationId)
    ]
    : [
      source.barcode,
      source.variant_barcode,
      source.sku,
      source.codigo,
      source.sku_variacao,
      source.codigo_interno,
      source.variant_sku,
      source.code,
      source.variation_id
    ];

  const seen = new Set();
  for (const candidate of shortCode128Candidates) {
    const cleaned = sanitizeCode128Value(candidate);
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    if (digitsOnly(cleaned).length === 13 && validateEan13Checksum(digitsOnly(cleaned))) {
      continue;
    }
    if (!isShortCode128Value(cleaned)) {
      continue;
    }
    return {
      encoded_value: cleaned,
      symbology: "code128",
      source_field: hasVariation
        ? (cleaned === deriveShortVariationScanCode(variationId) ? "variation_scan_code" : "variation_code128")
        : "code128"
    };
  }

  if (hasVariation) {
    const scanCode = deriveShortVariationScanCode(variationId);
    if (scanCode) {
      return {
        encoded_value: scanCode,
        symbology: "code128",
        source_field: "variation_scan_code"
      };
    }
  }

  const fallbackCandidates = hasVariation
    ? [source.variant_sku, source.sku_variacao, source.sku, source.codigo]
    : [source.sku, source.codigo, source.sku_variacao, source.variation_id];

  for (const candidate of fallbackCandidates) {
    const cleaned = sanitizeCode128Value(candidate);
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    if (digitsOnly(cleaned).length === 13 && validateEan13Checksum(digitsOnly(cleaned))) {
      continue;
    }
    return {
      encoded_value: cleaned,
      symbology: "code128",
      source_field: hasVariation ? "variation_fallback_code128" : "code128"
    };
  }

  if (requireBarcode) {
    const error = new Error(LABEL_BARCODE_ERROR);
    error.statusCode = 400;
    throw error;
  }

  return null;
}

function resolveLabelBarcodePair(source = {}, options = {}) {
  const encoded = resolveLabelBarcodeEncoded(source, options);
  if (!encoded) {
    return null;
  }
  const humanText = resolveLabelBarcodeHumanText(source);
  return {
    ...encoded,
    human_text: humanText,
    display_value: humanText,
    encoded_value: encoded.encoded_value
  };
}

function resolveLabelBarcode(source = {}, options = {}) {
  const pair = resolveLabelBarcodePair(source, options);
  if (!pair) {
    return null;
  }
  return {
    value: pair.encoded_value,
    symbology: pair.symbology,
    source_field: pair.source_field,
    display_value: pair.human_text,
    human_text: pair.human_text,
    encoded_value: pair.encoded_value
  };
}

function assertValidLabelBarcode(product = {}, request = {}) {
  if (request.show_barcode === false) {
    return null;
  }
  return resolveLabelBarcode(product, { requireBarcode: true });
}

function buildLabelBarcodeSourceFromProduct(product = {}) {
  const hasVariation = Boolean(normalizeText(product.variation_id || ""));
  return {
    variation_id: product.variation_id,
    variant_barcode: product.variant_barcode || (hasVariation ? product.barcode : ""),
    variant_sku: product.variant_sku || product.sku,
    barcode_human_text: product.label_barcode_human_text || product.barcode_human_text,
    barcode: hasVariation ? (product.variant_barcode || product.barcode) : product.barcode,
    sku: product.sku,
    sku_variacao: product.sku,
    codigo: product.codigo,
    codigo_interno: product.codigo_interno,
    ...(hasVariation
      ? {}
      : {
        gtin_ean: product.gtin_ean,
        ean: product.ean,
        codigo_barras: product.codigo_barras
      })
  };
}

function applyLabelBarcodeToProduct(product = {}, request = {}) {
  if (request.show_barcode === false) {
    return product;
  }
  const resolved = resolveLabelBarcodePair(buildLabelBarcodeSourceFromProduct(product), { requireBarcode: true });
  return {
    ...product,
    barcode: resolved.encoded_value,
    label_barcode_value: resolved.encoded_value,
    label_barcode_human_text: resolved.human_text,
    barcode_encoded_value: resolved.encoded_value,
    barcode_human_text: resolved.human_text,
    label_barcode_symbology: resolved.symbology,
    label_barcode_source: resolved.source_field,
    barcode_source: resolved.symbology === "ean13" ? "ean13" : "code128"
  };
}

function applyLabelBarcodeToAgentItem(item = {}) {
  if (item.show_barcode === false) {
    return item;
  }
  const resolved = resolveLabelBarcodePair({
    variation_id: item.variation_id,
    variant_barcode: item.variant_barcode || item.codigo_barras,
    variant_sku: item.sku_variacao || item.sku,
    barcode_human_text: item.barcode_human_text || item.sku_variacao || item.sku,
    sku: item.sku_variacao || item.sku,
    sku_variacao: item.sku_variacao,
    codigo: item.sku_variacao || item.sku
  }, { requireBarcode: true });
  return {
    ...item,
    codigo_barras: resolved.encoded_value,
    label_barcode_value: resolved.encoded_value,
    label_barcode_human_text: resolved.human_text,
    barcode_encoded_value: resolved.encoded_value,
    barcode_human_text: resolved.human_text,
    label_barcode_symbology: resolved.symbology,
    barcode_symbology: resolved.symbology,
    label_barcode_source: resolved.source_field
  };
}

module.exports = {
  LABEL_BARCODE_ERROR,
  CODE128_PREFERRED_MAX_LENGTH,
  validateEan13Checksum,
  deriveShortVariationScanCode,
  resolveLabelBarcodeHumanText,
  resolveLabelBarcodeEncoded,
  resolveLabelBarcodePair,
  resolveLabelBarcode,
  assertValidLabelBarcode,
  applyLabelBarcodeToProduct,
  applyLabelBarcodeToAgentItem
};
