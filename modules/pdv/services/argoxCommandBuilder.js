"use strict";

const {
  DEFAULT_TEMPLATE_ID,
  buildArgoxPplbFromAgentItems,
  buildArgoxPplbMinimalCommand,
  fmtPreco,
  resolveArgoxLanguage,
  resolvePhysicalLanguage,
  validatePplbMinimalCommand
} = require("./argoxPplbGenerator");
const { resolveLabelHeaderText } = require("./argoxLabelStorePolicy");
const { applyLabelBarcodeToAgentItem } = require("./argoxLabelBarcode");
const {
  resolveSafeTestMode,
  resolveEffectiveQuantity,
  summarizeCommand,
  validatePplaCommand,
  buildArgoxPplaMinimalCommand
} = require("./argoxPplaEnvelope");

function normalizeText(value = "") {
  return String(value ?? "").trim();
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAgentPrice(value = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const formatted = fmtPreco(value);
  if (!formatted) return 0;
  return Number(formatted.replace(".", "").replace(",", ".")) || 0;
}

function formatPriceBR(value = 0, options = {}) {
  const priceWithCents = options.priceWithCents !== false;
  const amount = Math.round(parseAgentPrice(value) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return "";
  if (!priceWithCents) {
    return `R$ ${Math.round(amount).toLocaleString("pt-BR")}`;
  }
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function applySafeTestToItems(items = [], config = {}) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [items].filter(Boolean);
  const safeTestMode = resolveSafeTestMode(config, list[0] || {});
  const received = list.length;
  if (!safeTestMode) {
    return { items: list, received, final: received, safeTestMode: false };
  }
  return { items: list.slice(0, 1), received, final: 1, safeTestMode: true };
}

function assertValidAgentLabelPrice(item = {}) {
  const salePrice = parseAgentPrice(item.preco_venda);
  if (!item.nome) {
    const error = new Error("Campo obrigatorio ausente: nome.");
    error.statusCode = 400;
    throw error;
  }
  if (!Number.isFinite(salePrice) || salePrice <= 0) {
    const error = new Error("Produto sem preço válido para etiqueta.");
    error.statusCode = 400;
    throw error;
  }
  return salePrice;
}

function resolveAgentPriceMode(item = {}) {
  const salePrice = parseAgentPrice(item.preco_venda);
  const originalPrice = item.preco_original ? parseAgentPrice(item.preco_original) : salePrice;
  const hasCompare = Boolean(
    item.show_compare_price !== false
    && item.preco_original
    && fmtPreco(item.preco_original)
    && fmtPreco(item.preco_venda)
    && fmtPreco(item.preco_original) !== fmtPreco(item.preco_venda)
    && originalPrice > salePrice
  );
  return {
    salePrice,
    originalPrice,
    hasCompare,
    priceMode: hasCompare ? "promo_compare" : "normal"
  };
}

function mapAgentItemsToPrintContext(items = [], config = {}, meta = {}) {
  const list = (Array.isArray(items) ? items.filter(Boolean) : [items].filter(Boolean))
    .map((item) => applyLabelBarcodeToAgentItem(item));
  if (!list.length) {
    throw new Error("Nenhuma etiqueta enviada.");
  }
  const safeTestMode = meta.safeTestMode ?? resolveSafeTestMode(config, list[0] || {});
  const quantityReceived = meta.quantityReceived ?? list.length;
  const quantityFinal = meta.quantityFinal ?? list.length;
  const first = list[0] || {};
  assertValidAgentLabelPrice(first);
  const priceWithCents = first.price_with_cents !== false;
  const priceModeInfo = resolveAgentPriceMode(first);
  const salePrice = priceModeInfo.salePrice;
  const originalPrice = priceModeInfo.originalPrice;
  const hasCompare = priceModeInfo.hasCompare;

  const product = {
    name: first.nome || "PRODUTO",
    brand: resolveLabelHeaderText(first.loja || first.store_id || ""),
    store_id: first.loja || first.store_id || "",
    color: first.cor || "",
    size: first.tamanho || "",
    sku: first.sku_variacao || first.sku || "",
    codigo: first.sku_variacao || first.sku || "",
    variation_id: first.variation_id || "",
    variant_barcode: first.variant_barcode || first.codigo_barras || "",
    variant_sku: first.sku_variacao || first.sku || "",
    barcode: first.codigo_barras || first.sku_variacao || first.sku || "",
    label_barcode_value: first.label_barcode_value || first.codigo_barras || "",
    label_barcode_human_text: first.label_barcode_human_text || first.barcode_human_text || first.sku_variacao || first.sku || "",
    barcode_human_text: first.barcode_human_text || first.label_barcode_human_text || first.sku_variacao || first.sku || "",
    label_barcode_symbology: first.label_barcode_symbology || first.barcode_symbology || "",
    price: salePrice,
    normal_price: hasCompare ? originalPrice : salePrice,
    promotional_price: hasCompare ? salePrice : null,
    has_promotional_price: hasCompare
  };

  const request = {
    template_id: first.template_id || DEFAULT_TEMPLATE_ID,
    quantity: quantityFinal,
    show_barcode: first.show_barcode !== false,
    show_price: first.show_price !== false,
    show_sku: first.show_sku !== false,
    show_name: first.show_name !== false,
    show_brand: first.show_brand !== false,
    show_size_color: first.show_size_color !== false,
    show_store: false,
    show_compare_price: hasCompare,
    price_mode: hasCompare ? "promo_compare" : "normal",
    normal_price_label: formatPriceBR(originalPrice, { priceWithCents }),
    promotional_price_label: formatPriceBR(salePrice, { priceWithCents }),
    price_label: formatPriceBR(salePrice, { priceWithCents }),
    price_with_cents: priceWithCents
  };

  const mergedConfig = {
    dpi: normalizeNumber(config.dpi, 203),
    label_width_mm: normalizeNumber(config.label_width_mm, 40),
    label_height_mm: normalizeNumber(config.label_height_mm, 60),
    label_columns: safeTestMode
      ? 1
      : Math.max(1, Math.min(4, Math.floor(normalizeNumber(first.colunas || first.columns || config.label_columns, 2)))),
    label_gap_mm: normalizeNumber(config.label_gap_mm, 3),
    label_language: resolveArgoxLanguage(config, first),
    safe_test_mode: safeTestMode
  };

  return {
    product,
    request,
    config: mergedConfig,
    quantity_received: quantityReceived,
    quantity_final: quantityFinal,
    safe_test_mode: safeTestMode
  };
}

function isPplaCommand(command = "") {
  return typeof command === "string" && command.charCodeAt(0) === 0x02;
}

function isPplbCommand(command = "") {
  return typeof command === "string" && !isPplaCommand(command) && normalizeText(command).startsWith("N");
}

function buildArgoxCommandFromAgentItems(items = [], options = {}) {
  const list = Array.isArray(items) ? items : [items];
  const language = resolvePhysicalLanguage(options.config || {}, list[0] || {});
  const safe = applySafeTestToItems(list, options.config || {});

  if (language === "PPLA") {
    const { buildArgoxPplaCommand } = require("./pdvLabelPrintService");
    const context = mapAgentItemsToPrintContext(safe.items, options.config || {}, {
      safeTestMode: safe.safeTestMode,
      quantityReceived: safe.received,
      quantityFinal: safe.final
    });
    const command = buildArgoxPplaCommand(context.product, context.request, context.config, {
      safeTestMode: context.safe_test_mode
    });
    const validation = validatePplaCommand(command);
    return {
      command,
      language: "PPLA",
      quantity_received: context.quantity_received,
      quantity_final: context.quantity_final,
      safe_test_mode: context.safe_test_mode,
      command_summary: summarizeCommand(command),
      command_validation: validation
    };
  }

  const pplbItems = safe.safeTestMode ? safe.items.slice(0, 1) : safe.items;
  return {
    command: buildArgoxPplbFromAgentItems(pplbItems, {
      config: options.config || {},
      columns: safe.safeTestMode ? 1 : (options.columns || list[0]?.colunas || list[0]?.columns || 2)
    }),
    language: "PPLB",
    quantity_received: safe.received,
    quantity_final: safe.safeTestMode ? 1 : pplbItems.length,
    safe_test_mode: safe.safeTestMode,
    command_summary: null,
    command_validation: null
  };
}

function prepareRawBuffer(command = "", language = "PPLB") {
  const resolvedLanguage = language === "PPLA" || isPplaCommand(command) ? "PPLA" : "PPLB";
  if (resolvedLanguage === "PPLA") {
    return {
      buffer: Buffer.from(command, "ascii"),
      language: "PPLA"
    };
  }
  return {
    buffer: Buffer.from(String(command || "").replace(/\r\n/g, "\n"), "ascii"),
    language: "PPLB"
  };
}

function serializePrinterCommand(command = "", language = "PPLB") {
  return prepareRawBuffer(command, language).buffer;
}

module.exports = {
  mapAgentItemsToPrintContext,
  applySafeTestToItems,
  buildArgoxCommandFromAgentItems,
  buildArgoxPplaMinimalCommand,
  buildArgoxPplbMinimalCommand,
  prepareRawBuffer,
  serializePrinterCommand,
  isPplaCommand,
  isPplbCommand,
  resolveArgoxLanguage,
  resolvePhysicalLanguage,
  resolveSafeTestMode,
  summarizeCommand,
  validatePplaCommand,
  validatePplbMinimalCommand,
  parseAgentPrice,
  resolveAgentPriceMode,
  assertValidAgentLabelPrice
};
