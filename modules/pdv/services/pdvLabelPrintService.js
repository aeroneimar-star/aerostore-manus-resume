"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { get } = require("../../../db");
const { normalizeStoreKey, formatStoreLabel } = require("../utils/pdvStoreUtils");
const {
  buildArgoxPplbCommand,
  buildAgentPrintPayload
} = require("./argoxPplbGenerator");

const labelsTmpDir = path.join(process.cwd(), "tmp", "labels");
const labelLogsPath = path.join(process.cwd(), "data", "pdv", "label-print-logs.json");

const SUPPORTED_LANGUAGES = new Set(["PPLA", "PPLB", "ZPL", "EPL"]);
const DEFAULT_TEMPLATE_ID = "aerostore_tag_40x60_2c";

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value = "") {
  return String(value ?? "").trim();
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = normalizeText(value).toLowerCase();
  if (["1", "true", "sim", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "nao", "não", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function roundMoney(value = 0) {
  return Math.round(normalizeNumber(value, 0) * 100) / 100;
}

function buildId(prefix = "LBL") {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function ensureDirs() {
  fs.mkdirSync(labelsTmpDir, { recursive: true });
  fs.mkdirSync(path.dirname(labelLogsPath), { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function getArgoxLabelConfig() {
  const language = normalizeText(process.env.ARGOX_LABEL_LANGUAGE || "PPLB").toUpperCase();
  const width = normalizeNumber(process.env.ARGOX_LABEL_WIDTH_MM, 40);
  const height = normalizeNumber(process.env.ARGOX_LABEL_HEIGHT_MM, 60);
  const dpi = normalizeNumber(process.env.ARGOX_DPI, 203);
  const columns = Math.floor(normalizeNumber(process.env.ARGOX_LABEL_COLUMNS, 2));
  return {
    print_enabled: String(process.env.ARGOX_PRINT_ENABLED || "false").toLowerCase() === "true",
    printer_name: normalizeText(process.env.ARGOX_PRINTER_NAME || ""),
    printer_model: normalizeText(process.env.ARGOX_PRINTER_MODEL || "Argox OS-214plus"),
    label_language: SUPPORTED_LANGUAGES.has(language) ? language : "PPLA",
    dpi: dpi > 0 ? dpi : 203,
    label_width_mm: width > 0 ? width : 40,
    label_height_mm: height > 0 ? height : 60,
    label_columns: Math.max(1, Math.min(4, columns || 2)),
    label_gap_mm: Math.max(0, normalizeNumber(process.env.ARGOX_LABEL_GAP_MM, 3)),
    default_template: normalizeText(process.env.ARGOX_DEFAULT_TEMPLATE || DEFAULT_TEMPLATE_ID),
    agent_url: normalizeText(process.env.ARGOX_AGENT_URL || "http://localhost:4000"),
    direct_print_available: true,
    safe_mode: false,
    message: "Impressao fisica via Agente Argox local (PPLB RAW). PRN continua disponivel como fallback."
  };
}

function getLabelTemplates() {
  const config = getArgoxLabelConfig();
  return [
    {
      id: "aerostore_tag_40x60_2c",
      name: "AEROSTORE Tag Roupa 40x60 2 colunas",
      width_mm: 40,
      height_mm: 60,
      columns: 2,
      fields: ["nome", "marca", "sku", "tamanho_cor", "preco", "codigo_barras", "loja"],
      supported_languages: Array.from(SUPPORTED_LANGUAGES)
    },
    {
      id: "aerostore_price_tag",
      name: "Etiqueta preco padrao",
      width_mm: config.label_width_mm,
      height_mm: config.label_height_mm,
      columns: config.label_columns,
      fields: ["nome", "marca", "sku", "preco", "codigo_barras"],
      supported_languages: Array.from(SUPPORTED_LANGUAGES)
    },
    {
      id: "aerostore_no_price",
      name: "Etiqueta sem preco",
      width_mm: config.label_width_mm,
      height_mm: config.label_height_mm,
      columns: config.label_columns,
      fields: ["nome", "marca", "sku", "codigo_barras"],
      supported_languages: Array.from(SUPPORTED_LANGUAGES)
    },
    {
      id: "aerostore_stock_simple",
      name: "Etiqueta simples estoque",
      width_mm: config.label_width_mm,
      height_mm: config.label_height_mm,
      columns: config.label_columns,
      fields: ["sku", "cor", "tamanho", "codigo_barras"],
      supported_languages: Array.from(SUPPORTED_LANGUAGES)
    }
  ];
}

function findTemplate(templateId = "") {
  const templates = getLabelTemplates();
  return templates.find((item) => item.id === normalizeText(templateId)) || templates.find((item) => item.id === DEFAULT_TEMPLATE_ID) || templates[0];
}

function sanitizeLine(value = "", maxLength = 36) {
  const clean = normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\x00-\x1F\x7F"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.slice(0, Math.max(1, maxLength));
}

function formatPriceBR(value = 0, { priceWithCents = true } = {}) {
  const amount = roundMoney(value);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  if (!priceWithCents) {
    return `R$ ${Math.round(amount).toLocaleString("pt-BR")}`;
  }
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function mmToDots(value = 0, dpi = 203) {
  return Math.max(1, Math.round(normalizeNumber(value, 0) * (dpi / 25.4)));
}

function normalizeBarcodeValue(product = {}) {
  const raw = normalizeText(product.barcode || product.sku || product.codigo || "");
  return sanitizeLine(raw.replace(/[^A-Za-z0-9_-]/g, ""), 32);
}

function buildSizeColorLabel(product = {}) {
  return [product.color, product.size].map((item) => sanitizeLine(item, 18)).filter(Boolean).join(" / ");
}

function buildPreviewHtml(lines = []) {
  const safeLines = lines.map((line) => sanitizeLine(line, 48)).filter(Boolean);
  return safeLines.map((line) => `<span>${line}</span>`).join("");
}

function getAllowedStores(user = {}) {
  return Array.isArray(user.allowed_stores)
    ? user.allowed_stores.map((item) => normalizeStoreKey(item)).filter(Boolean)
    : [];
}

function userCanViewStore(user = {}, storeId = "") {
  const normalizedStore = normalizeStoreKey(storeId || "");
  if (!normalizedStore) return true;
  if (user?.permissions?.can_view_all_stores) return true;
  const role = normalizeText(user.role || "").toLowerCase();
  if (role === "admin") return true;
  const allowed = getAllowedStores(user);
  return !allowed.length || allowed.includes(normalizedStore);
}

async function findProductForLabel(payload = {}, user = {}) {
  const productId = normalizeText(payload.product_id || payload.productId || payload.id || "");
  const sku = normalizeText(payload.sku || payload.codigo || payload.code || "");
  const variationId = normalizeText(payload.variation_id || payload.variationId || "");
  let row = null;
  if (productId) {
    row = await get("SELECT * FROM ai_products WHERE id = ? AND COALESCE(deleted_at, '') = ''", [productId]);
  }
  if (!row && sku) {
    row = await get(
      `SELECT * FROM ai_products
       WHERE COALESCE(deleted_at, '') = ''
         AND (UPPER(COALESCE(sku, '')) = ? OR UPPER(COALESCE(codigo, '')) = ? OR UPPER(COALESCE(gtin_ean, '')) = ?)
       ORDER BY id DESC
       LIMIT 1`,
      [sku.toUpperCase(), sku.toUpperCase(), sku.toUpperCase()]
    );
  }
  if (!row) {
    const error = new Error("Produto nao encontrado para impressao de etiqueta.");
    error.statusCode = 404;
    throw error;
  }
  if (!userCanViewStore(user, row.store || "")) {
    const error = new Error("Acesso restrito a produtos da sua loja.");
    error.statusCode = 403;
    throw error;
  }
  const normalizedProduct = await get(
    `SELECT id, product_type
     FROM pdv_products_v2
     WHERE legacy_ai_product_id = ?
     LIMIT 1`,
    [row.id]
  );
  if (!normalizedProduct) return row;

  let variant = null;
  if (variationId) {
    variant = await get(
      `SELECT id AS variation_id, sku AS variant_sku, barcode AS variant_barcode,
              status AS variant_status, attributes_json, sale_price_cents
       FROM pdv_product_variants
       WHERE id = ? AND product_id = ? AND status <> 'inativo'
       LIMIT 1`,
      [variationId, normalizedProduct.id]
    );
    if (!variant) {
      const error = new Error("A variacao selecionada nao pertence a este produto.");
      error.statusCode = 400;
      throw error;
    }
  } else {
    const variantCount = await get(
      `SELECT COUNT(*) AS total
       FROM pdv_product_variants
       WHERE product_id = ? AND status <> 'inativo'`,
      [normalizedProduct.id]
    );
    if (Number(variantCount?.total || 0) > 1) {
      const error = new Error("Selecione uma variacao especifica para gerar a etiqueta.");
      error.statusCode = 400;
      throw error;
    }
    variant = await get(
      `SELECT id AS variation_id, sku AS variant_sku, barcode AS variant_barcode,
              status AS variant_status, attributes_json, sale_price_cents
       FROM pdv_product_variants
       WHERE product_id = ? AND status <> 'inativo'
       ORDER BY is_default DESC, created_at, id
       LIMIT 1`,
      [normalizedProduct.id]
    );
  }
  if (!variant) return row;

  let attributes = {};
  try {
    attributes = JSON.parse(variant.attributes_json || "{}") || {};
  } catch {
    attributes = {};
  }
  return {
    ...row,
    variation_id: variant.variation_id,
    sku: normalizeText(variant.variant_sku || row.sku || row.codigo || ""),
    gtin_ean: normalizeText(variant.variant_barcode || ""),
    color: normalizeText(attributes.color || row.color || row.cor || ""),
    sizes: normalizeText(attributes.size || row.sizes || row.tamanho || ""),
    price: variant.sale_price_cents === null || variant.sale_price_cents === undefined
      ? row.price
      : Number(variant.sale_price_cents) / 100
  };
}

function normalizeProductForLabel(row = {}) {
  const normalPrice = roundMoney(row.price);
  const promotionalPrice = row.promotional_price === null || row.promotional_price === undefined || row.promotional_price === ""
    ? 0
    : roundMoney(row.promotional_price);
  const hasPromotionalPrice = promotionalPrice > 0 && normalPrice > 0 && promotionalPrice < normalPrice;
  const barcode = normalizeText(row.gtin_ean || row.ean || row.codigo_barras || "");
  const sku = normalizeText(row.sku || row.codigo || "");
  return {
    product_id: normalizeText(row.id || row.product_id || ""),
    variation_id: normalizeText(row.variation_id || ""),
    sku,
    codigo: normalizeText(row.codigo || ""),
    barcode,
    barcode_source: barcode ? "barcode" : "sku_text",
    name: normalizeText(row.commercial_name || row.name || row.nome || ""),
    brand: normalizeText(row.marca || row.brand || ""),
    category: normalizeText(row.category || row.categoria || ""),
    color: normalizeText(row.color || row.cor || ""),
    size: normalizeText(row.sizes || row.tamanho || ""),
    price: normalPrice,
    normal_price: normalPrice,
    promotional_price: promotionalPrice > 0 ? promotionalPrice : null,
    has_promotional_price: hasPromotionalPrice,
    store_id: normalizeStoreKey(row.store || row.store_id || ""),
    store_label: formatStoreLabel(row.store || row.store_id || "")
  };
}

function resolveLabelRequest(payload = {}, product = {}) {
  const rawQuantity = payload.quantity ?? payload.quantidade ?? 1;
  const parsedQuantity = Math.floor(normalizeNumber(rawQuantity, 0));
  if (!Number.isFinite(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 500) {
    const error = new Error("Quantidade de etiquetas invalida. Informe um valor entre 1 e 500.");
    error.statusCode = 400;
    throw error;
  }
  const quantity = parsedQuantity;
  const showPrice = normalizeBoolean(payload.show_price, true);
  const showBarcode = normalizeBoolean(payload.show_barcode, true);
  const showSku = normalizeBoolean(payload.show_sku, true);
  const showName = normalizeBoolean(payload.show_name, true);
  const showBrand = normalizeBoolean(payload.show_brand, true);
  const showSizeColor = normalizeBoolean(payload.show_size_color, true);
  const showStore = normalizeBoolean(payload.show_store, false);
  const priceWithCents = normalizeBoolean(payload.price_with_cents, true);
  const requestedPriceMode = normalizeText(payload.price_mode || payload.priceMode || "").toLowerCase();
  const hasComparePrice = Boolean(product.has_promotional_price);
  const priceMode = requestedPriceMode === "promo_compare" && hasComparePrice ? "promo_compare" : "normal";
  const normalPriceLabel = formatPriceBR(product.normal_price ?? product.price, { priceWithCents });
  const promotionalPriceLabel = formatPriceBR(product.promotional_price, { priceWithCents });
  return {
    template_id: findTemplate(payload.template_id || payload.templateId || "").id,
    quantity,
    show_price: showPrice,
    show_barcode: showBarcode,
    show_sku: showSku,
    show_name: showName,
    show_brand: showBrand,
    show_size_color: showSizeColor,
    show_store: showStore,
    price_with_cents: priceWithCents,
    price_mode: priceMode,
    show_compare_price: priceMode === "promo_compare",
    normal_price_label: normalPriceLabel,
    promotional_price_label: promotionalPriceLabel,
    price_label: showPrice ? (priceMode === "promo_compare" ? promotionalPriceLabel : normalPriceLabel) : ""
  };
}

function buildPricePreviewLines(request = {}) {
  if (!request.show_price) return [];
  if (request.show_compare_price) {
    return [
      `DE ${request.normal_price_label || "-"}`,
      `POR ${request.promotional_price_label || request.price_label || "Preco sob consulta"}`
    ];
  }
  return [request.price_label || "Preco sob consulta"];
}

function buildPreviewLines(product = {}, request = {}) {
  const template = findTemplate(request.template_id);
  const lines = [];
  if (template.id === "aerostore_tag_40x60_2c") {
    const sizeColor = buildSizeColorLabel(product);
    if (request.show_brand) lines.push(product.brand || "AEROSTORE");
    if (request.show_name) lines.push(product.name || "Produto sem nome");
    if (request.show_size_color && sizeColor) lines.push(sizeColor);
    lines.push(...buildPricePreviewLines(request));
    if (request.show_sku) lines.push(`SKU ${product.sku || product.codigo || "-"}`);
    if (request.show_store && product.store_label) lines.push(product.store_label);
    if (request.show_barcode) lines.push(product.barcode ? `EAN ${product.barcode}` : `COD ${product.sku || "-"}`);
    return lines.filter(Boolean);
  }
  if (template.id === "aerostore_stock_simple") {
    lines.push(product.sku || "SEM SKU");
    lines.push([product.color, product.size].filter(Boolean).join(" / ") || "Sem grade");
    if (request.show_barcode) lines.push(product.barcode || product.sku || "Sem codigo");
    return lines.filter(Boolean);
  }
  if (request.show_name) lines.push(product.name || "Produto sem nome");
  if (request.show_brand) lines.push(product.brand || "AEROSTORE");
  if (request.show_size_color) {
    const sizeColor = buildSizeColorLabel(product);
    if (sizeColor) lines.push(sizeColor);
  }
  if (request.show_sku) lines.push(`SKU ${product.sku || product.codigo || "-"}`);
  lines.push(...buildPricePreviewLines(request));
  if (request.show_store && product.store_label) lines.push(product.store_label);
  if (request.show_barcode) lines.push(product.barcode ? `EAN ${product.barcode}` : `COD ${product.sku || "-"}`);
  return lines.filter(Boolean);
}

const TECHNICAL_TAG_PREVIEW_CSS = {
  widthPx: 268,
  heightPx: 402,
  bodyPaddingTopPx: 48,
  bodyPaddingXPx: 18,
  bodyGapPx: 7,
  bodyTextGapPx: 1,
  barcodeHeightPx: 52,
  barcodeMarginTopPx: 8,
  barcodeMarginBottomPx: 2,
  barcodePaddingXPx: 12,
  stubHeightRatio: 0.25,
  fontPx: {
    brand: 12.16,
    product: 13.12,
    meta: 10.88,
    price: 19.84,
    comparePrice: 16.32
  },
  lineHeight: {
    brand: 1,
    product: 1.2,
    meta: 1.1,
    price: 1
  }
};

function estimateMonospaceChars(widthPx = 0, fontSizePx = 10) {
  return Math.max(1, Math.floor(widthPx / Math.max(1, fontSizePx * 0.62)));
}

function splitPreviewVisualText(value = "", maxChars = 24, maxLines = 1) {
  const clean = sanitizeLine(value, 96);
  if (!clean) return [];
  const words = clean.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      return;
    }
    if (current) lines.push(current);
    current = word;
    while (current.length > maxChars) {
      const splitAt = Math.max(
        current.lastIndexOf("-", maxChars),
        current.lastIndexOf("/", maxChars),
        maxChars
      );
      lines.push(current.slice(0, splitAt).replace(/[-/]+$/g, ""));
      current = current.slice(splitAt).replace(/^[-/]+/g, "");
    }
  });
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

function buildLabelPreviewElements(product = {}, request = {}, config = {}) {
  const template = findTemplate(request.template_id);
  const dpi = config.dpi || 203;
  const labelWidthDots = mmToDots(template.width_mm || config.label_width_mm || 40, dpi);
  const labelHeightDots = mmToDots(template.height_mm || config.label_height_mm || 60, dpi);
  const gapDots = mmToDots(config.label_gap_mm || 3, dpi);
  const columns = Math.max(1, template.columns || config.label_columns || 1);
  const columnsToRender = Math.max(1, Math.min(columns, request.quantity || 1));
  const css = TECHNICAL_TAG_PREVIEW_CSS;
  const scaleX = labelWidthDots / css.widthPx;
  const scaleY = labelHeightDots / css.heightPx;
  const bodyLeft = Math.round(css.bodyPaddingXPx * scaleX);
  const bodyWidth = Math.round(labelWidthDots - (css.bodyPaddingXPx * 2 * scaleX));
  const bodyWidthPx = css.widthPx - css.bodyPaddingXPx * 2;
  const elements = [];

  const addElement = (column, item) => {
    const columnX = column * (labelWidthDots + gapDots);
    elements.push({
      type: item.type || "text",
      text: sanitizeLine(item.text || "", item.maxTextLength || 96),
      x: Math.round(columnX + bodyLeft),
      y: Math.round(item.y),
      width: item.width === undefined ? bodyWidth : Math.round(item.width),
      height: item.height === undefined ? Math.round(item.fontSize * scaleY) : Math.round(item.height),
      fontSize: Number(item.fontSize.toFixed(2)),
      align: item.align || "center",
      column,
      isBarcode: Boolean(item.isBarcode),
      role: item.role || item.type || "text",
      maxLines: item.maxLines || 1
    });
  };

  for (let col = 0; col < columnsToRender; col += 1) {
    const sizeColor = buildSizeColorLabel(product);
    const sku = sanitizeLine(product.sku || product.codigo || "-", 64);
    const barcodeValue = sanitizeLine(product.barcode || sku || "", 64);
    const yStart = css.bodyPaddingTopPx * scaleY;
    const bodyGap = css.bodyGapPx * scaleY;
    let cursorY = yStart;

    if (request.show_brand !== false) {
      const fontSize = css.fontPx.brand;
      addElement(col, {
        type: "text",
        role: "brand",
        text: product.brand || "AEROSTORE",
        y: cursorY,
        fontSize,
        maxTextLength: 32
      });
      cursorY += fontSize * css.lineHeight.brand * scaleY + bodyGap;
    }

    if (request.show_name !== false) {
      const fontSize = css.fontPx.product;
      const maxChars = estimateMonospaceChars(bodyWidthPx, fontSize);
      const visualLines = splitPreviewVisualText(product.name || "Produto sem nome", maxChars, 2);
      addElement(col, {
        type: "text",
        role: "name",
        text: product.name || "Produto sem nome",
        y: cursorY,
        fontSize,
        maxLines: 2,
        maxTextLength: 64
      });
      cursorY += Math.max(1, visualLines.length) * fontSize * css.lineHeight.product * scaleY + bodyGap;
    }

    if (request.show_size_color !== false && sizeColor) {
      const fontSize = css.fontPx.meta;
      addElement(col, {
        type: "text",
        role: "size_color",
        text: sizeColor,
        y: cursorY,
        fontSize,
        maxTextLength: 40
      });
      cursorY += fontSize * css.lineHeight.meta * scaleY + bodyGap;
    }

    if (request.show_sku !== false) {
      const fontSize = css.fontPx.meta;
      addElement(col, {
        type: "text",
        role: "sku",
        text: `SKU ${sku}`,
        y: cursorY,
        fontSize,
        maxTextLength: 72
      });
      cursorY += fontSize * css.lineHeight.meta * scaleY + bodyGap;
    }

    if (request.show_barcode !== false && barcodeValue) {
      cursorY += css.barcodeMarginTopPx * scaleY;
      addElement(col, {
        type: "barcode",
        role: "barcode",
        text: barcodeValue,
        y: cursorY,
        width: bodyWidth - Math.round(css.barcodePaddingXPx * 2 * scaleX),
        height: css.barcodeHeightPx * scaleY,
        fontSize: css.fontPx.meta,
        isBarcode: true,
        maxTextLength: 64
      });
      cursorY += css.barcodeHeightPx * scaleY + css.barcodeMarginBottomPx * scaleY + css.bodyTextGapPx * scaleY;
      addElement(col, {
        type: "text",
        role: "code",
        text: product.barcode ? barcodeValue : `COD ${sku}`,
        y: cursorY,
        fontSize: css.fontPx.meta,
        maxTextLength: 72
      });
    }

    if (request.show_price !== false) {
      const priceY = labelHeightDots * (1 - css.stubHeightRatio) + (labelHeightDots * css.stubHeightRatio) / 2 - (css.fontPx.price * scaleY) / 2;
      if (request.show_compare_price) {
        addElement(col, {
          type: "text",
          role: "compare_price",
          text: `DE ${request.normal_price_label || "-"}`,
          y: priceY - css.fontPx.meta * scaleY,
          fontSize: css.fontPx.meta,
          maxTextLength: 32
        });
        addElement(col, {
          type: "price",
          role: "price",
          text: `POR ${request.promotional_price_label || request.price_label || "Preco sob consulta"}`,
          y: priceY,
          fontSize: css.fontPx.comparePrice,
          maxTextLength: 40
        });
      } else {
        addElement(col, {
          type: "price",
          role: "price",
          text: request.price_label || "Preco sob consulta",
          y: priceY,
          fontSize: css.fontPx.price,
          maxTextLength: 32
        });
      }
    }
  }

  return elements.filter((item) => item.text);
}

function buildPplaCommand(product = {}, request = {}, config = {}) {
  return buildArgoxPplaCommand(product, request, config);
}

function padPplaNumber(value = 0, size = 3) {
  const normalized = Math.max(0, Math.floor(normalizeNumber(value, 0)));
  return String(normalized).padStart(size, "0").slice(-size);
}

function buildArgoxPplaStxCommand(command = "") {
  return `\x02${sanitizeLine(command, 16)}`;
}

function buildArgoxPplaText({
  x = 0,
  y = 0,
  text = "",
  direction = 1,
  font = 1,
  hScale = 1,
  vScale = 0,
  subFont = 0,
  maxLength = 24
} = {}) {
  const safeText = sanitizeLine(text, maxLength);
  if (!safeText) return "";
  const header = [
    padPplaNumber(direction, 1),
    padPplaNumber(font, 1),
    padPplaNumber(hScale, 1),
    padPplaNumber(vScale, 1),
    padPplaNumber(subFont, 3),
    padPplaNumber(y, 3),
    padPplaNumber(x, 4)
  ].join("");
  return `${header}${safeText}`;
}

function buildArgoxPplaBarcode() {
  // Barcode PPLA for OS-214 AP3.05 stays disabled until a physical barcode
  // command is validated. The caller still prints the code as text.
  return [];
}

function splitTextForPpla(value = "", maxLength = 18, maxLines = 2) {
  const clean = sanitizeLine(value, 80);
  if (!clean) return [];
  const words = clean.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxLength) {
      current = candidate;
      return;
    }
    if (current) lines.push(current);
    current = word;
    while (current.length > maxLength) {
      const breakpoint = Math.max(
        current.lastIndexOf("-", maxLength),
        current.lastIndexOf("/", maxLength)
      );
      const splitAt = breakpoint > 0 ? breakpoint : maxLength;
      lines.push(current.slice(0, splitAt).replace(/[-/]+$/g, ""));
      current = current.slice(splitAt).replace(/^[-/]+/g, "");
    }
  });
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

function addArgoxPplaTextLines(body = [], x = 0, y = 0, value = "", options = {}) {
  const {
    maxLength = 18,
    maxLines = 1,
    lineHeight = 28,
    font = 1,
    hScale = 1,
    vScale = 0
  } = options;
  splitTextForPpla(value, maxLength, maxLines).forEach((line, index) => {
    body.push(buildArgoxPplaText({
      x,
      y: y + index * lineHeight,
      text: line,
      font,
      hScale,
      vScale,
      maxLength
    }));
  });
}

function estimatePplaCharWidthDots(element = {}) {
  const fontSize = normalizeNumber(element.fontSize, TECHNICAL_TAG_PREVIEW_CSS.fontPx.meta);
  return Math.max(5, Math.round(fontSize * 0.72));
}

function buildArgoxPplaTextFromElement(element = {}) {
  const text = sanitizeLine(element.text || "", 96);
  if (!text || element.isBarcode) return [];
  const charWidth = estimatePplaCharWidthDots(element);
  const maxChars = Math.max(1, Math.floor(normalizeNumber(element.width, 120) / charWidth));
  const maxLines = Math.max(1, Math.floor(normalizeNumber(element.maxLines, 1)));
  const lines = splitPreviewVisualText(text, maxChars, maxLines);
  const lineHeight = Math.max(12, Math.round(normalizeNumber(element.fontSize, 11) * 1.25));
  const hScale = element.type === "price" ? 2 : 1;
  return lines.map((line, index) => {
    const lineWidth = line.length * charWidth * hScale;
    const alignedX = element.align === "center"
      ? normalizeNumber(element.x, 0) + Math.max(0, Math.round((normalizeNumber(element.width, 0) - lineWidth) / 2))
      : normalizeNumber(element.x, 0);
    return buildArgoxPplaText({
      x: alignedX,
      y: normalizeNumber(element.y, 0) + index * lineHeight,
      text: line,
      hScale,
      maxLength: 48
    });
  });
}

function buildArgoxPplaCommand(product = {}, request = {}, config = {}) {
  const template = findTemplate(request.template_id);
  const columns = Math.max(1, template.columns || config.label_columns || 1);
  const rows = Math.max(1, Math.ceil((request.quantity || 1) / columns));
  const body = [];
  const previewElements = buildLabelPreviewElements(product, request, config);

  previewElements.forEach((element) => {
    if (element.isBarcode) {
      body.push(...buildArgoxPplaBarcode({ element, product, request, config }));
      return;
    }
    body.push(...buildArgoxPplaTextFromElement(element));
  });

  return [
    buildArgoxPplaStxCommand("M0480"),
    buildArgoxPplaStxCommand("r1"),
    buildArgoxPplaStxCommand("L"),
    "D22",
    ...body.filter(Boolean),
    `Q${padPplaNumber(rows, 4)}`,
    "E"
  ].join("\r") + "\r";
}

function buildZplCommand(product = {}, request = {}, config = {}) {
  const template = findTemplate(request.template_id);
  const dotsPerMm = (config.dpi || 203) / 25.4;
  const labelWidth = Math.round((template.width_mm || config.label_width_mm || 40) * dotsPerMm);
  const gap = Math.round((config.label_gap_mm || 3) * dotsPerMm);
  const columns = Math.max(1, template.columns || config.label_columns || 1);
  const columnsToRender = Math.max(1, Math.min(columns, request.quantity || 1));
  const width = labelWidth * columns + gap * (columns - 1);
  const height = Math.round((template.height_mm || config.label_height_mm || 60) * dotsPerMm);
  const rows = Math.max(1, Math.ceil((request.quantity || 1) / columns));
  const lines = buildPreviewLines(product, request).map((item, index) => ({ text: sanitizeLine(item, 32), y: 18 + index * 28 }));
  const barcodeValue = normalizeBarcodeValue(product);
  const body = [];
  for (let col = 0; col < columnsToRender; col += 1) {
    const x = 18 + col * (labelWidth + gap);
    lines.forEach((line) => body.push(`^FO${x},${line.y}^A0N,22,22^FD${line.text}^FS`));
    if (request.show_barcode && barcodeValue) {
      body.push(`^FO${x},${Math.max(145, 18 + lines.length * 28)}^BY2^BCN,62,Y,N,N^FD${barcodeValue}^FS`);
    }
  }
  return ["^XA", `^PW${width}`, `^LL${height}`, ...body, `^PQ${rows}`, "^XZ"].join("\r\n") + "\r\n";
}

function buildEplCommand(product = {}, request = {}, config = {}) {
  const template = findTemplate(request.template_id);
  const dotsPerMm = (config.dpi || 203) / 25.4;
  const labelWidth = Math.round((template.width_mm || config.label_width_mm || 40) * dotsPerMm);
  const gap = Math.round((config.label_gap_mm || 3) * dotsPerMm);
  const columns = Math.max(1, template.columns || config.label_columns || 1);
  const columnsToRender = Math.max(1, Math.min(columns, request.quantity || 1));
  const rows = Math.max(1, Math.ceil((request.quantity || 1) / columns));
  const lines = buildPreviewLines(product, request).map((item, index) => ({ text: sanitizeLine(item, 32), y: 16 + index * 24 }));
  const barcodeValue = normalizeBarcodeValue(product);
  const body = [];
  for (let col = 0; col < columnsToRender; col += 1) {
    const x = 16 + col * (labelWidth + gap);
    lines.forEach((line) => body.push(`A${x},${line.y},0,2,1,1,N,"${line.text}"`));
    if (request.show_barcode && barcodeValue) {
      body.push(`B${x},${Math.max(125, 16 + lines.length * 24)},0,1,2,4,62,B,"${barcodeValue}"`);
    }
  }
  return ["N", ...body, `P${rows}`].join("\r\n") + "\r\n";
}

function buildPrinterCommand(product = {}, request = {}, config = {}) {
  const language = normalizeText(config.label_language || "PPLB").toUpperCase();
  const template = findTemplate(request.template_id);
  if (template.id === DEFAULT_TEMPLATE_ID || language === "PPLB") {
    return buildArgoxPplbCommand(product, request, config);
  }
  if (language === "ZPL") return buildZplCommand(product, request, config);
  if (language === "EPL") return buildEplCommand(product, request, config);
  return buildPplaCommand(product, request, config);
}

function isPplbCommand(command = "") {
  return normalizeText(command).startsWith("N");
}

function writePrnFile(command = "", product = {}, request = {}, options = {}) {
  ensureDirs();
  let filename = normalizeText(options.filename || "");
  if (!filename && request.template_id === "aerostore_tag_40x60_2c") {
    filename = "argox-aerostore-tag-40x60-2c.prn";
  }
  if (!filename) {
    filename = `${Date.now()}-${sanitizeLine(product.sku || product.product_id || "label", 20).replace(/[^A-Za-z0-9_-]/g, "_")}.prn`;
  }
  filename = path.basename(filename).replace(/[^A-Za-z0-9_.-]/g, "_");
  const filePath = path.join(labelsTmpDir, filename);
  const commandWithSafeTerminators = isPplbCommand(command)
    ? command.replace(/\r\n/g, "\n")
    : command.replace(/\n/g, "\r\n");
  const buffer = Buffer.from(commandWithSafeTerminators, "ascii");
  fs.writeFileSync(filePath, buffer);
  return {
    filename,
    file_path: filePath,
    download_url: `/api/pdv/labels/files/${encodeURIComponent(filename)}`
  };
}

function appendPrintLog(entry = {}) {
  ensureDirs();
  const current = readJson(labelLogsPath, []);
  current.unshift({
    id: buildId("LBLLOG"),
    ...entry,
    created_at: nowIso()
  });
  writeJson(labelLogsPath, current.slice(0, 1000));
}

async function buildLabelPreview(payload = {}, user = {}) {
  const product = normalizeProductForLabel(await findProductForLabel(payload, user));
  const request = resolveLabelRequest(payload, product);
  const config = getArgoxLabelConfig();
  const template = findTemplate(request.template_id);
  const previewElements = buildLabelPreviewElements(product, request, config);
  const command = buildPrinterCommand(product, request, config);
  return {
    success: true,
    mode: "preview",
    config,
    template,
    product,
    request,
    preview_lines: buildPreviewLines(product, request),
    preview_elements: previewElements,
    preview_html: buildPreviewHtml(buildPreviewLines(product, request)),
    command_preview: command,
    agent_payload: buildAgentPrintPayload(product, request, config),
    agent_url: config.agent_url,
    warnings: product.barcode ? [] : ["Produto sem codigo de barras. A etiqueta usara SKU/codigo como texto."]
  };
}

async function printLabel(payload = {}, user = {}) {
  const preview = await buildLabelPreview(payload, user);
  const prn = writePrnFile(preview.command_preview, preview.product, preview.request);
  const status = "agent_ready";
  const message = "Etiqueta PPLB pronta. Envie ao Agente Argox local ou baixe o PRN como fallback.";
  appendPrintLog({
    product_id: preview.product.product_id,
    sku: preview.product.sku,
    barcode: preview.product.barcode,
    template_id: preview.template.id,
    quantity: preview.request.quantity,
    store_id: preview.product.store_id,
    user_id: user?.id || user?.email || "",
    printer_name: preview.config.printer_name,
    status,
    error_message: "",
    file_name: prn.filename
  });
  return {
    ...preview,
    mode: "print",
    print_status: status,
    message,
    prn,
    agent_payload: preview.agent_payload,
    agent_url: preview.agent_url
  };
}

async function buildTestPrint(payload = {}, user = {}) {
  const config = getArgoxLabelConfig();
  const product = {
    product_id: "TEST",
    sku: "SKU TESTE",
    codigo: "SKU TESTE",
    barcode: normalizeText(payload.barcode || "7891234567895"),
    barcode_source: "barcode",
    name: "AEROSTORE TESTE",
    brand: "AEROSTORE",
    category: "Teste",
    color: "Preto",
    size: "M",
    price: 99.9,
    store_id: normalizeStoreKey(user?.store_id || user?.store || ""),
    store_label: formatStoreLabel(user?.store_id || user?.store || "")
  };
  const request = resolveLabelRequest({ ...payload, template_id: payload.template_id || DEFAULT_TEMPLATE_ID, quantity: payload.quantity || 1 }, product);
  const previewElements = buildLabelPreviewElements(product, request, config);
  const command = buildPrinterCommand(product, request, config);
  const prn = writePrnFile(command, product, request, { filename: "argox-test-label.prn" });
  appendPrintLog({
    product_id: product.product_id,
    sku: product.sku,
    barcode: product.barcode,
    template_id: request.template_id,
    quantity: request.quantity,
    store_id: product.store_id,
    user_id: user?.id || user?.email || "",
    printer_name: config.printer_name,
    status: "test_prn_ready",
    error_message: "",
    file_name: prn.filename
  });
  return {
    success: true,
    mode: "test_print",
    config,
    template: findTemplate(request.template_id),
    product,
    request,
    preview_lines: buildPreviewLines(product, request),
    preview_elements: previewElements,
    preview_html: buildPreviewHtml(buildPreviewLines(product, request)),
    command_preview: command,
    print_status: "test_prn_ready",
    message: "Arquivo de teste PRN gerado com AEROSTORE TESTE.",
    prn
  };
}

function getPrnFile(filename = "") {
  const safeName = path.basename(normalizeText(filename || ""));
  if (!safeName || !safeName.endsWith(".prn")) return null;
  const filePath = path.join(labelsTmpDir, safeName);
  if (!fs.existsSync(filePath)) return null;
  return {
    filename: safeName,
    file_path: filePath,
    content: fs.readFileSync(filePath, "utf8")
  };
}

module.exports = {
  getArgoxLabelConfig,
  getLabelTemplates,
  buildLabelPreviewElements,
  buildArgoxPplaText,
  buildArgoxPplaBarcode,
  buildArgoxPplaCommand,
  buildArgoxPplbCommand,
  buildAgentPrintPayload,
  buildLabelPreview,
  printLabel,
  buildTestPrint,
  getPrnFile
};
