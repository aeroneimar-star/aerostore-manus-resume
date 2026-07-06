"use strict";

const { all, get } = require("../../../db");
const { normalizeStoreKey, formatStoreLabel } = require("../utils/pdvStoreUtils");
const { resolveSafeTestMode } = require("./argoxPplaEnvelope");

const PRINT_QUANTITY_MODES = {
  MANUAL: "manual",
  VARIANT_STOCK: "variant_stock",
  ALL_VARIANTS_STOCK: "all_variants_stock",
  ONE_PER_VARIANT: "one_per_variant"
};

const PRINT_QUANTITY_MODE_LABELS = {
  [PRINT_QUANTITY_MODES.MANUAL]: "Quantidade manual",
  [PRINT_QUANTITY_MODES.VARIANT_STOCK]: "Estoque da variação",
  [PRINT_QUANTITY_MODES.ALL_VARIANTS_STOCK]: "Todas as variações",
  [PRINT_QUANTITY_MODES.ONE_PER_VARIANT]: "1 por variação"
};

function normalizeText(value = "") {
  return String(value ?? "").trim();
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePrintQuantityMode(value = "") {
  const raw = normalizeText(value).toLowerCase();
  const aliases = {
    manual: PRINT_QUANTITY_MODES.MANUAL,
    quantidade_manual: PRINT_QUANTITY_MODES.MANUAL,
    variant_stock: PRINT_QUANTITY_MODES.VARIANT_STOCK,
    pelo_estoque: PRINT_QUANTITY_MODES.VARIANT_STOCK,
    pelo_estoque_disponivel: PRINT_QUANTITY_MODES.VARIANT_STOCK,
    all_variants_stock: PRINT_QUANTITY_MODES.ALL_VARIANTS_STOCK,
    todas_variacoes: PRINT_QUANTITY_MODES.ALL_VARIANTS_STOCK,
    todas_variacoes_disponiveis: PRINT_QUANTITY_MODES.ALL_VARIANTS_STOCK,
    one_per_variant: PRINT_QUANTITY_MODES.ONE_PER_VARIANT,
    uma_por_variacao: PRINT_QUANTITY_MODES.ONE_PER_VARIANT,
    uma_por_variacao_disponivel: PRINT_QUANTITY_MODES.ONE_PER_VARIANT
  };
  return aliases[raw] || PRINT_QUANTITY_MODES.MANUAL;
}

function parseNormalizedParentPrefix(productId = "") {
  const raw = normalizeText(productId);
  const normalizedParentMatch = raw.match(/^NORMALIZED_PARENT:(\d+)$/i);
  if (normalizedParentMatch) {
    return normalizedParentMatch[1];
  }
  const normalizedPrefixMatch = raw.match(/^normalized:(\d+)$/i);
  if (normalizedPrefixMatch) {
    return normalizedPrefixMatch[1];
  }
  return "";
}

function parseVariantAttributes(attributesJson = "") {
  try {
    return JSON.parse(attributesJson || "{}") || {};
  } catch {
    return {};
  }
}

function buildVariantLabel(variant = {}) {
  const parts = [variant.color, variant.size].map((item) => normalizeText(item || "")).filter(Boolean);
  if (parts.length) {
    return parts.join(" / ");
  }
  return normalizeText(variant.sku || variant.variation_id || "");
}

function mapVariantRow(row = {}) {
  const attributes = parseVariantAttributes(row.attributes_json);
  const reservedQty = normalizeNumber(row.reserved_qty, 0);
  const availableQty = Math.max(0, normalizeNumber(row.available_qty, 0));
  const physicalQty = availableQty + reservedQty;
  return {
    variation_id: row.variation_id,
    sku: normalizeText(row.sku || ""),
    barcode: normalizeText(row.barcode || ""),
    color: normalizeText(attributes.color || ""),
    size: normalizeText(attributes.size || ""),
    available_qty: availableQty,
    physical_qty: physicalQty,
    reserved_qty: reservedQty,
    variation_status: row.variation_status
  };
}

async function resolveProductIdentity(payload = {}) {
  const receivedProductId = normalizeText(payload.product_id || payload.productId || "");
  const explicitParent = normalizeText(
    payload.parent_product_id
    || payload.normalized_parent_product_id
    || payload.parentProductId
    || ""
  );
  const selectedVariationId = normalizeText(payload.variation_id || payload.variationId || "");
  let resolvedNormalizedProductId = "";
  let resolvedLegacyAiProductId = "";
  let resolutionPath = "";

  if (explicitParent && /^\d+$/.test(explicitParent)) {
    resolvedNormalizedProductId = explicitParent;
    resolutionPath = "payload_parent_product_id";
  }

  if (!resolvedNormalizedProductId) {
    const prefixedParent = parseNormalizedParentPrefix(receivedProductId);
    if (prefixedParent) {
      resolvedNormalizedProductId = prefixedParent;
      resolutionPath = "normalized_prefix";
    }
  }

  if (!resolvedNormalizedProductId && /^\d+$/.test(receivedProductId)) {
    const byPdvId = await get(
      `SELECT id, legacy_ai_product_id
       FROM pdv_products_v2
       WHERE id = ?
       LIMIT 1`,
      [receivedProductId]
    );
    if (byPdvId?.id) {
      resolvedNormalizedProductId = normalizeText(byPdvId.id);
      resolvedLegacyAiProductId = normalizeText(byPdvId.legacy_ai_product_id || "");
      resolutionPath = "pdv_products_v2.id";
    } else {
      const byLegacy = await get(
        `SELECT id, legacy_ai_product_id
         FROM pdv_products_v2
         WHERE legacy_ai_product_id = ?
         LIMIT 1`,
        [receivedProductId]
      );
      if (byLegacy?.id) {
        resolvedNormalizedProductId = normalizeText(byLegacy.id);
        resolvedLegacyAiProductId = normalizeText(byLegacy.legacy_ai_product_id || receivedProductId);
        resolutionPath = "legacy_ai_product_id";
      }
    }
  }

  if (!resolvedNormalizedProductId && selectedVariationId) {
    const variantAnchor = await get(
      `SELECT v.product_id, p.legacy_ai_product_id
       FROM pdv_product_variants v
       INNER JOIN pdv_products_v2 p ON p.id = v.product_id
       WHERE v.id = ?
         AND v.status <> 'inativo'
       LIMIT 1`,
      [selectedVariationId]
    );
    if (variantAnchor?.product_id) {
      resolvedNormalizedProductId = normalizeText(variantAnchor.product_id);
      resolvedLegacyAiProductId = normalizeText(variantAnchor.legacy_ai_product_id || "");
      resolutionPath = "variation_id";
    }
  }

  if (resolvedNormalizedProductId && !resolvedLegacyAiProductId) {
    const parentRow = await get(
      `SELECT legacy_ai_product_id
       FROM pdv_products_v2
       WHERE id = ?
       LIMIT 1`,
      [resolvedNormalizedProductId]
    );
    resolvedLegacyAiProductId = normalizeText(parentRow?.legacy_ai_product_id || "");
  }

  return {
    received_product_id: receivedProductId,
    resolved_normalized_product_id: resolvedNormalizedProductId,
    resolved_legacy_ai_product_id: resolvedLegacyAiProductId,
    selected_variation_id: selectedVariationId,
    resolution_path: resolutionPath
  };
}

async function loadVariantsWithStoreStock(pdvParentId = "", storeId = "") {
  const normalizedParentId = normalizeText(pdvParentId);
  const normalizedStore = normalizeStoreKey(storeId || "");
  if (!normalizedParentId || !normalizedStore) {
    return [];
  }
  const rows = await all(
    `SELECT
       v.id AS variation_id,
       v.sku,
       v.barcode,
       v.status AS variation_status,
       v.attributes_json,
       v.sale_price_cents,
       COALESCE(b.available_qty, 0) AS available_qty,
       COALESCE(b.reserved_qty, 0) AS reserved_qty
     FROM pdv_product_variants v
     LEFT JOIN pdv_inventory_balances_v2 b
       ON b.variant_id = v.id
      AND b.store_id = ? COLLATE NOCASE
     WHERE v.product_id = ?
       AND v.status <> 'inativo'
     ORDER BY v.is_default DESC, v.created_at, v.id`,
    [normalizedStore, normalizedParentId]
  );
  return rows.map(mapVariantRow);
}

async function loadSingleVariantWithStoreStock(variationId = "", storeId = "", pdvParentId = "") {
  const normalizedVariationId = normalizeText(variationId);
  const normalizedStore = normalizeStoreKey(storeId || "");
  const normalizedParentId = normalizeText(pdvParentId);
  if (!normalizedVariationId || !normalizedStore) {
    return null;
  }
  const params = [normalizedStore, normalizedVariationId];
  let parentClause = "";
  if (normalizedParentId) {
    parentClause = " AND v.product_id = ?";
    params.push(normalizedParentId);
  }
  const row = await get(
    `SELECT
       v.id AS variation_id,
       v.sku,
       v.barcode,
       v.status AS variation_status,
       v.attributes_json,
       v.sale_price_cents,
       COALESCE(b.available_qty, 0) AS available_qty,
       COALESCE(b.reserved_qty, 0) AS reserved_qty
     FROM pdv_product_variants v
     LEFT JOIN pdv_inventory_balances_v2 b
       ON b.variant_id = v.id
      AND b.store_id = ? COLLATE NOCASE
     WHERE v.id = ?
       AND v.status <> 'inativo'${parentClause}
     LIMIT 1`,
    params
  );
  return row ? mapVariantRow(row) : null;
}

function buildVariantsNotFoundError(identity = {}, storeId = "") {
  const error = new Error(
    `Não foi possível localizar variações para este produto. product_id=${identity.received_product_id || "-"}, legacy_ai_product_id=${identity.resolved_legacy_ai_product_id || "-"}, store_id=${storeId || "-"}`
  );
  error.statusCode = 400;
  return error;
}

function buildPlanSummaryLines(plan = {}) {
  const modeLabel = PRINT_QUANTITY_MODE_LABELS[plan.print_quantity_mode] || plan.print_quantity_mode;
  const lines = [
    `Modo: ${modeLabel}`,
    `Loja: ${plan.store_label || plan.store_id}`,
    `Total de etiquetas: ${plan.total_labels}`
  ];
  if (Array.isArray(plan.entries) && plan.entries.length) {
    lines.push("Variações:");
    plan.entries.forEach((entry) => {
      const label = buildVariantLabel(entry) || entry.sku || entry.variation_id;
      const qtyLabel = Number(entry.quantity) === 1 ? "etiqueta" : "etiquetas";
      lines.push(`- ${label} — ${entry.sku || "-"} — ${entry.quantity} ${qtyLabel}`);
    });
  }
  if (plan.manual_over_stock_warning) {
    lines.push(plan.manual_over_stock_message || "Quantidade maior que o estoque disponível.");
  }
  if (plan.safe_test_mode) {
    lines.push(plan.safe_test_warning || "Modo seguro ativo: impressão real limitada a 1 etiqueta.");
  }
  return lines;
}

function buildSafeTestWarning(totalLabels = 0) {
  const total = Math.max(0, Number(totalLabels || 0));
  return `Modo seguro ativo: a impressão real será limitada a 1 etiqueta, mesmo que o plano tenha ${total}.`;
}

const MANUAL_OVER_STOCK_MESSAGE = "Quantidade maior que o estoque disponível. Confirme se deseja imprimir mesmo assim.";

async function resolveSelectedVariant({
  variants = [],
  variationId = "",
  storeId = "",
  pdvParentId = ""
} = {}) {
  const normalizedVariationId = normalizeText(variationId);
  if (normalizedVariationId) {
    const fromList = variants.find((item) => item.variation_id === normalizedVariationId);
    if (fromList) {
      return fromList;
    }
    return loadSingleVariantWithStoreStock(normalizedVariationId, storeId, pdvParentId);
  }
  return variants[0] || null;
}

async function resolveLabelPrintPlan(payload = {}, user = {}) {
  const printQuantityMode = normalizePrintQuantityMode(
    payload.print_quantity_mode || payload.printQuantityMode || ""
  );
  const storeId = normalizeStoreKey(
    payload.store_id || payload.storeId || payload.loja || user?.store_id || user?.store || ""
  );
  if (!storeId) {
    const error = new Error("Selecione a loja operacional antes de imprimir etiquetas.");
    error.statusCode = 400;
    throw error;
  }

  const variationId = normalizeText(payload.variation_id || payload.variationId || "");
  const manualQuantity = Math.max(1, Math.min(500, Math.floor(normalizeNumber(payload.quantity ?? payload.manual_quantity, 1))));
  const identity = await resolveProductIdentity(payload);
  const pdvParentId = identity.resolved_normalized_product_id;
  const variants = pdvParentId ? await loadVariantsWithStoreStock(pdvParentId, storeId) : [];
  const stockRowsFound = variants.filter((variant) => Number(variant.available_qty || 0) > 0).length;
  const printPlanDebug = {
    received_product_id: identity.received_product_id,
    resolved_normalized_product_id: identity.resolved_normalized_product_id,
    resolved_legacy_ai_product_id: identity.resolved_legacy_ai_product_id,
    selected_variation_id: identity.selected_variation_id,
    resolved_store_id: storeId,
    variants_found: variants.length,
    stock_rows_found: stockRowsFound,
    resolution_path: identity.resolution_path,
    variants_table: "pdv_product_variants",
    stock_table: "pdv_inventory_balances_v2"
  };

  const config = (() => {
    try {
      const { getArgoxLabelConfig } = require("./pdvLabelPrintService");
      return getArgoxLabelConfig();
    } catch {
      return {};
    }
  })();
  const safeTestMode = resolveSafeTestMode(config, payload);

  let entries = [];
  const requiresVariation = [
    PRINT_QUANTITY_MODES.MANUAL,
    PRINT_QUANTITY_MODES.VARIANT_STOCK
  ].includes(printQuantityMode);
  if (requiresVariation && variants.length > 1 && !variationId) {
    const error = new Error("Selecione uma variação para este modo de impressão.");
    error.statusCode = 400;
    throw error;
  }

  if (printQuantityMode === PRINT_QUANTITY_MODES.MANUAL) {
    const variant = await resolveSelectedVariant({
      variants,
      variationId,
      storeId,
      pdvParentId
    });
    if (!variant && !variationId && variants.length === 0) {
      entries = [{ variation_id: "", quantity: manualQuantity, available_qty: null, sku: "", color: "", size: "" }];
    } else if (!variant) {
      const error = new Error("Variação selecionada não encontrada para a loja atual.");
      error.statusCode = 400;
      throw error;
    } else {
      entries = [{ ...variant, quantity: manualQuantity }];
    }
  } else if (printQuantityMode === PRINT_QUANTITY_MODES.VARIANT_STOCK) {
    const variant = await resolveSelectedVariant({
      variants,
      variationId,
      storeId,
      pdvParentId
    });
    if (!variant) {
      const error = new Error("Variação selecionada não encontrada para a loja atual.");
      error.statusCode = 400;
      throw error;
    }
    if (variant.available_qty <= 0) {
      const error = new Error(`Sem estoque disponível para ${buildVariantLabel(variant) || variant.sku} na loja ${formatStoreLabel(storeId)}.`);
      error.statusCode = 400;
      throw error;
    }
    entries = [{ ...variant, quantity: variant.available_qty }];
  } else if (printQuantityMode === PRINT_QUANTITY_MODES.ALL_VARIANTS_STOCK) {
    if (!variants.length) {
      throw buildVariantsNotFoundError(identity, storeId);
    }
    entries = variants
      .filter((variant) => variant.available_qty > 0)
      .map((variant) => ({ ...variant, quantity: variant.available_qty }));
    if (!entries.length) {
      const error = new Error(`Nenhuma variação com estoque disponível na loja ${formatStoreLabel(storeId)}.`);
      error.statusCode = 400;
      throw error;
    }
  } else if (printQuantityMode === PRINT_QUANTITY_MODES.ONE_PER_VARIANT) {
    if (!variants.length) {
      throw buildVariantsNotFoundError(identity, storeId);
    }
    entries = variants
      .filter((variant) => variant.available_qty > 0)
      .map((variant) => ({ ...variant, quantity: 1 }));
    if (!entries.length) {
      const error = new Error(`Nenhuma variação com estoque disponível na loja ${formatStoreLabel(storeId)}.`);
      error.statusCode = 400;
      throw error;
    }
  }

  const quantityRequested = entries.reduce((sum, entry) => sum + Math.max(0, Number(entry.quantity || 0)), 0);
  const quantityFinal = safeTestMode ? Math.min(1, quantityRequested) : quantityRequested;
  const manualOverStockWarning = printQuantityMode === PRINT_QUANTITY_MODES.MANUAL
    && entries.length === 1
    && entries[0].available_qty !== null
    && entries[0].available_qty !== undefined
    && Number(entries[0].quantity || 0) > Number(entries[0].available_qty || 0);
  const previewVariationId = variationId
    || entries[0]?.variation_id
    || variants[0]?.variation_id
    || "";

  const plan = {
    print_quantity_mode: printQuantityMode,
    print_quantity_mode_label: PRINT_QUANTITY_MODE_LABELS[printQuantityMode] || printQuantityMode,
    store_id: storeId,
    store_label: formatStoreLabel(storeId),
    pdv_parent_id: pdvParentId,
    preview_variation_id: previewVariationId,
    quantity_requested: quantityRequested,
    quantity_final: quantityFinal,
    total_labels: quantityRequested,
    total_labels_after_safe_mode: quantityFinal,
    safe_test_mode: safeTestMode,
    safe_test_warning: safeTestMode ? buildSafeTestWarning(quantityRequested) : "",
    manual_over_stock_warning: manualOverStockWarning,
    manual_over_stock_message: manualOverStockWarning ? MANUAL_OVER_STOCK_MESSAGE : "",
    entries: entries.map((entry) => ({
      variation_id: entry.variation_id,
      sku: entry.sku,
      color: entry.color,
      size: entry.size,
      available_qty: entry.available_qty,
      quantity: entry.quantity,
      variant_label: buildVariantLabel(entry)
    })),
    summary_lines: [],
    requires_confirmation: quantityRequested > 10,
    print_plan_debug: printPlanDebug
  };
  plan.summary_lines = buildPlanSummaryLines(plan);
  return plan;
}

module.exports = {
  PRINT_QUANTITY_MODES,
  PRINT_QUANTITY_MODE_LABELS,
  normalizePrintQuantityMode,
  resolveLabelPrintPlan,
  resolveProductIdentity,
  loadVariantsWithStoreStock,
  loadSingleVariantWithStoreStock,
  buildPlanSummaryLines,
  buildSafeTestWarning,
  MANUAL_OVER_STOCK_MESSAGE
};
