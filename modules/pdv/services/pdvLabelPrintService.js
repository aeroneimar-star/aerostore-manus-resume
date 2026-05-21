"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { get } = require("../../../db");
const { normalizeStoreKey, formatStoreLabel } = require("../utils/pdvStoreUtils");

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
  const language = normalizeText(process.env.ARGOX_LABEL_LANGUAGE || "PPLA").toUpperCase();
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
    direct_print_available: false,
    safe_mode: true,
    message: "Impressao direta fica desabilitada ate configurar driver local da Argox. O modo seguro gera PRN 40x60 em 2 colunas."
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
  return [product.size, product.color].map((item) => sanitizeLine(item, 18)).filter(Boolean).join(" / ");
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
  return row;
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

function buildPplaCommand(product = {}, request = {}, config = {}) {
  const template = findTemplate(request.template_id);
  const dpi = config.dpi || 203;
  const labelWidthDots = mmToDots(template.width_mm || config.label_width_mm || 40, dpi);
  const labelHeightDots = mmToDots(template.height_mm || config.label_height_mm || 60, dpi);
  const gapDots = mmToDots(config.label_gap_mm || 3, dpi);
  const columns = Math.max(1, template.columns || config.label_columns || 1);
  const columnsToRender = Math.max(1, Math.min(columns, request.quantity || 1));
  const totalWidthDots = labelWidthDots * columns + gapDots * (columns - 1);
  const rows = Math.max(1, Math.ceil((request.quantity || 1) / columns));
  const barcodeValue = normalizeBarcodeValue(product);
  const sizeColor = buildSizeColorLabel(product);
  const header = [
    "\x02L",
    "D11",
    `H${gapDots}`,
    `Q${labelHeightDots}`,
    `q${totalWidthDots}`
  ];

  const text = (x, y, value, width = 32, wx = 1, wy = 1) => `A${x},${y},0,2,${wx},${wy},N,"${sanitizeLine(value, width)}"`;
  const barcode = (x, y, value) => `B${x},${y},0,1,2,5,70,N,"${sanitizeLine(value, 32)}"`;
  const body = [];
  for (let col = 0; col < columnsToRender; col += 1) {
    const x = 14 + col * (labelWidthDots + gapDots);
    const brand = request.show_brand ? (product.brand || "AEROSTORE") : "AEROSTORE";
    if (template.id === "aerostore_tag_40x60_2c") {
      body.push(text(x, 22, brand, 24, 1, 1));
      if (request.show_name) body.push(text(x, 58, product.name || "Produto sem nome", 28, 1, 1));
      if (request.show_size_color && sizeColor) body.push(text(x, 102, sizeColor, 24, 1, 1));
      if (request.show_sku) body.push(text(x, 140, `SKU ${product.sku || product.codigo || "-"}`, 26, 1, 1));
      if (request.show_store && product.store_label) body.push(text(x, 174, product.store_label, 24, 1, 1));
      if (request.show_barcode && barcodeValue) {
        body.push(barcode(x, 220, barcodeValue));
        body.push(text(x, 304, product.barcode ? barcodeValue : `COD ${product.sku || "-"}`, 28, 1, 1));
      }
      // The lower serrated stub is the official price area on the 40x60 clothing tag.
      if (request.show_compare_price) {
        body.push(text(x, 388, `DE ${request.normal_price_label || "-"}`, 24, 1, 1));
        body.push(text(x, 424, `POR ${request.promotional_price_label || "Preco sob consulta"}`, 24, 2, 2));
      } else if (request.show_price) {
        body.push(text(x, 414, request.price_label || "Preco sob consulta", 24, 2, 2));
      }
    } else {
      const lines = buildPreviewLines(product, request).map((item, index) => ({ text: sanitizeLine(item, 30), y: 18 + index * 24 }));
      lines.forEach((line) => body.push(text(x, line.y, line.text, 30, 1, 1)));
      if (request.show_barcode && barcodeValue) body.push(barcode(x, Math.max(120, 18 + lines.length * 24), barcodeValue));
    }
  }
  return [...header, ...body, `P${rows}`, "E"].join("\n") + "\n";
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
  return ["^XA", `^PW${width}`, `^LL${height}`, ...body, `^PQ${rows}`, "^XZ"].join("\n") + "\n";
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
  return ["N", ...body, `P${rows}`].join("\n") + "\n";
}

function buildPrinterCommand(product = {}, request = {}, config = {}) {
  const language = normalizeText(config.label_language || "PPLA").toUpperCase();
  if (language === "ZPL") return buildZplCommand(product, request, config);
  if (language === "EPL" || language === "PPLB") return buildEplCommand(product, request, config);
  return buildPplaCommand(product, request, config);
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
  fs.writeFileSync(filePath, command, "utf8");
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
  const command = buildPrinterCommand(product, request, config);
  return {
    success: true,
    mode: "preview",
    config,
    template,
    product,
    request,
    preview_lines: buildPreviewLines(product, request),
    preview_html: buildPreviewHtml(buildPreviewLines(product, request)),
    command_preview: command,
    warnings: product.barcode ? [] : ["Produto sem codigo de barras. A etiqueta usara SKU/codigo como texto."]
  };
}

async function printLabel(payload = {}, user = {}) {
  const preview = await buildLabelPreview(payload, user);
  const prn = writePrnFile(preview.command_preview, preview.product, preview.request);
  const status = preview.config.print_enabled && preview.config.printer_name
    ? "prn_ready_direct_print_not_configured"
    : "prn_ready";
  const message = preview.config.print_enabled && preview.config.printer_name
    ? "Arquivo PRN gerado. Impressao direta ainda esta em modo seguro aguardando validacao do modelo Argox."
    : "Impressora Argox nao configurada. Baixe o arquivo PRN ou configure ARGOX_PRINTER_NAME.";
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
    prn
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
  buildLabelPreview,
  printLabel,
  buildTestPrint,
  getPrnFile
};
