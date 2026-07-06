"use strict";

const path = require("path");
const { mmToPx } = require("./labelImageSpec");
const { readEnvBoolean } = require(path.join(__dirname, "..", "..", "modules", "pdv", "services", "argoxEnvBoolean"));

const FINAL_LABEL_LAYOUT = Object.freeze({
  TOP_BLOCK_OFFSET_PX: 60,
  CANVAS_WIDTH_PX: 320,
  CANVAS_HEIGHT_PX: 480,
  GRID: "1x1",
  LABEL_WIDTH_MM: 40,
  LABEL_HEIGHT_MM: 60,
  PRICE_BAND_MM: 12,
  DPI: 203,
  BARCODE_BAR_HEIGHT_PX: 64,
  BARCODE_TEXT_HEIGHT_PX: 22,
  BARCODE_TEXT_GAP_PX: 3,
  BARCODE_FOOTER_GAP_MM: 3,
  BARCODE_BAR_LIFT_PX: 4
});

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveLabelGridConfig(config = {}) {
  const allowMultiCellGrid = config.allow_multi_cell_grid === true;
  const rawGrid = allowMultiCellGrid
    ? String(
      config.label_grid
      ?? config.grid
      ?? process.env.ARGOX_LABEL_GRID
      ?? "1x1"
    ).trim().toLowerCase()
    : "1x1";

  const match = rawGrid.match(/^(\d+)\s*x\s*(\d+)$/i);
  const cols = match ? Math.max(1, Math.min(4, Number(match[1]))) : 1;
  const rows = match ? Math.max(1, Math.min(4, Number(match[2]))) : 1;
  const dpi = normalizeNumber(config.dpi, 203);
  const labelWidthMm = normalizeNumber(config.label_width_mm ?? process.env.ARGOX_LABEL_WIDTH_MM, 40);
  const labelHeightMm = normalizeNumber(config.label_height_mm ?? process.env.ARGOX_LABEL_HEIGHT_MM, 60);
  const priceBandMm = normalizeNumber(config.label_price_band_mm ?? process.env.ARGOX_LABEL_PRICE_BAND_MM, 12);
  const cellWidthPx = mmToPx(labelWidthMm, dpi);
  const cellHeightPx = mmToPx(labelHeightMm, dpi);
  const mainAreaPx = mmToPx(labelHeightMm - priceBandMm, dpi);
  const priceBandPx = mmToPx(priceBandMm, dpi);

  return {
    cols,
    rows,
    dpi,
    labelWidthMm,
    labelHeightMm,
    priceBandMm,
    cellWidthPx,
    cellHeightPx,
    mainAreaPx,
    priceBandPx,
    pageWidthPx: cellWidthPx * cols,
    pageHeightPx: cellHeightPx * rows,
    grid: rawGrid
  };
}

function resolvePrintCell(config = {}) {
  const raw = String(
    config.print_cell
    ?? process.env.ARGOX_PRINT_CELL
    ?? "top-left"
  ).trim().toLowerCase();

  const map = {
    "top-left": { col: 0, row: 0, name: "top-left" },
    "top-right": { col: 1, row: 0, name: "top-right" },
    "bottom-left": { col: 0, row: 1, name: "bottom-left" },
    "bottom-right": { col: 1, row: 1, name: "bottom-right" }
  };
  return map[raw] || map["top-left"];
}

function formatCodText(text = "", fallback = "") {
  const raw = String(text || fallback || "").trim();
  if (!raw) return "";
  if (/^COD\.?\s/i.test(raw)) return raw.replace(/^COD\.?\s/i, "COD. ");
  if (/^COD\s/i.test(raw)) return raw.replace(/^COD\s/i, "COD. ");
  return `COD. ${raw.replace(/^COD\.?\s*/i, "")}`;
}

function formatDeText(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  if (/^DE:/i.test(raw)) return raw.replace(/^DE\s+/i, "DE: ");
  return raw.replace(/^DE\s+/i, "DE: ");
}

function formatPorText(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  if (/^POR:/i.test(raw)) return raw.replace(/^POR\s+/i, "POR: ");
  return raw.replace(/^POR\s+/i, "POR: ");
}

function formatNormalPriceText(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  return raw
    .replace(/^POR:\s*/i, "")
    .replace(/^DE:\s*/i, "")
    .trim();
}

function splitBarcodeHumanText(value = "") {
  const text = String(value || "").trim();
  if (!text) return [""];
  const parts = text.split("-").filter(Boolean);
  if (parts.length >= 4) {
    const mid = Math.ceil(parts.length / 2);
    return [parts.slice(0, mid).join("-"), parts.slice(mid).join("-")];
  }
  if (parts.length === 3 && text.length > 16) {
    return [parts.slice(0, 2).join("-"), parts.slice(2).join("-")];
  }
  if (text.length <= 20) return [text];
  const mid = Math.ceil(text.length / 2);
  for (let index = Math.max(1, mid - 5); index <= Math.min(text.length - 1, mid + 5); index += 1) {
    if (text[index] === "-") {
      return [text.slice(0, index), text.slice(index + 1)];
    }
  }
  return [text.slice(0, mid), text.slice(mid)];
}

function shouldUseTwoLineBarcodeHumanText(value = "") {
  const text = String(value || "").trim();
  const parts = text.split("-").filter(Boolean);
  return parts.length >= 4 || (parts.length === 3 && text.length > 16) || text.length > 22;
}

function resolveBarcodeHumanTextLayout(value = "") {
  const text = String(value || "").trim();
  const length = text.length;
  if (shouldUseTwoLineBarcodeHumanText(text)) {
    const textLines = splitBarcodeHumanText(text);
    const lineCount = Math.max(1, textLines.length);
    const lineHeight = 17;
    return {
      fontSize: 16,
      maxLines: lineCount,
      height: lineCount > 1 ? (lineHeight * lineCount) + 2 : 20,
      lineHeight,
      textLines
    };
  }
  if (length <= 13) {
    return {
      fontSize: 18,
      maxLines: 1,
      height: 22,
      lineHeight: 20,
      textLines: [text]
    };
  }
  return {
    fontSize: 16,
    maxLines: 1,
    height: 20,
    lineHeight: 18,
    textLines: [text]
  };
}

function resolveBarcodeHumanTextFontSize(value = "") {
  return resolveBarcodeHumanTextLayout(value).fontSize;
}

function layoutLabelElementsForCell(rawElements = [], config = {}) {
  const grid = resolveLabelGridConfig(config);
  const padX = 10;
  const bodyW = grid.cellWidthPx - padX * 2;
  const topX = padX - 15;
  const footerX = padX - 15;
  const barcodeX = padX;
  const mainH = grid.mainAreaPx;
  const bandStart = mainH;

  const FONT = {
    brand: 31,
    name: 24,
    sizeColor: 22,
    sku: 19,
    code: 18,
    comparePrice: 21,
    price: 28
  };

  const byRole = {};
  rawElements.forEach((element) => {
    byRole[element.role || element.type] = element;
  });

  const layout = [];
  const TOP_BLOCK_OFFSET_PX = FINAL_LABEL_LAYOUT.TOP_BLOCK_OFFSET_PX;
  let y = mmToPx(2, grid.dpi) + TOP_BLOCK_OFFSET_PX;

  if (byRole.brand) {
    layout.push({
      text: byRole.brand.text,
      x: topX,
      y,
      width: bodyW,
      fontSize: FONT.brand,
      align: "center",
      bold: true,
      fontFamily: "Arial",
      role: "brand",
      maxLines: 1
    });
    y += 34;
  }

  if (byRole.name) {
    layout.push({
      text: byRole.name.text,
      x: topX,
      y,
      width: bodyW,
      fontSize: FONT.name,
      align: "center",
      bold: true,
      fontFamily: "Arial",
      role: "name",
      maxLines: 2
    });
    y += 52;
  }

  if (byRole.size_color) {
    layout.push({
      text: byRole.size_color.text,
      x: topX,
      y,
      width: bodyW,
      fontSize: FONT.sizeColor,
      align: "center",
      bold: true,
      fontFamily: "Arial",
      role: "size_color",
      maxLines: 1
    });
    y += 26;
  }

  const skuRaw = byRole.sku?.text || "";
  const skuDisplay = skuRaw.replace(/^SKU\s+/i, "").trim();
  if (skuDisplay) {
    layout.push({
      text: skuDisplay,
      x: topX,
      y,
      width: bodyW,
      fontSize: FONT.sku,
      align: "center",
      bold: true,
      fontFamily: "Arial",
      role: "sku",
      maxLines: 1
    });
    y += 22;
  }

  const barcodeEncoded = byRole.barcode?.barcodeValue || byRole.barcode?.text || "";
  if (barcodeEncoded) {
    const barcodeHumanSource = String(
      byRole.barcode?.barcodeHumanText
      || byRole.barcode_text?.text
      || byRole.sku?.text?.replace(/^SKU\s+/i, "")
      || barcodeEncoded
    ).trim();
    const barcodeTextLayout = resolveBarcodeHumanTextLayout(barcodeHumanSource);
    const barcodeTextHeight = barcodeTextLayout.height;
    const barcodeTextGap = FINAL_LABEL_LAYOUT.BARCODE_TEXT_GAP_PX;
    const barcodeBarLiftPx = FINAL_LABEL_LAYOUT.BARCODE_BAR_LIFT_PX;
    const footerGap = mmToPx(FINAL_LABEL_LAYOUT.BARCODE_FOOTER_GAP_MM, grid.dpi);
    const maxBarHeight = FINAL_LABEL_LAYOUT.BARCODE_BAR_HEIGHT_PX;
    const barcodeBlockBottom = mainH - footerGap;
    const barcodeTextY = barcodeBlockBottom - barcodeTextHeight;
    const availableBarHeight = Math.max(
      mmToPx(5, grid.dpi),
      Math.min(
        maxBarHeight,
        barcodeTextY - barcodeTextGap - (y + 4) - barcodeBarLiftPx
      )
    );
    const barcodeBarY = Math.max(
      y + 4,
      barcodeTextY - barcodeTextGap - availableBarHeight - barcodeBarLiftPx
    );

    layout.push({
      text: barcodeEncoded,
      x: barcodeX,
      y: barcodeBarY,
      width: bodyW,
      height: availableBarHeight,
      fontSize: 10,
      align: "center",
      isBarcode: true,
      role: "barcode",
      maxLines: 1,
      barcodeValue: byRole.barcode?.barcodeValue || barcodeEncoded,
      barcodeHumanText: barcodeHumanSource,
      barcodeSymbology: byRole.barcode?.barcodeSymbology || "",
      renderBarcodeText: false
    });

    layout.push({
      text: barcodeHumanSource,
      textLines: barcodeTextLayout.textLines,
      x: barcodeX,
      y: barcodeTextY,
      width: bodyW,
      height: barcodeTextHeight,
      fontSize: barcodeTextLayout.fontSize,
      lineHeight: barcodeTextLayout.lineHeight,
      align: "center",
      bold: true,
      fontFamily: "Arial",
      role: "barcode_text",
      maxLines: barcodeTextLayout.maxLines
    });
  }

  const codText = formatCodText(skuDisplay);
  if (codText) {
    layout.push({
      text: codText,
      x: footerX,
      y: bandStart + 4,
      width: bodyW,
      fontSize: FONT.code,
      align: "center",
      bold: true,
      fontFamily: "Arial",
      role: "code",
      maxLines: 1
    });
  }

  if (byRole.compare_price) {
    layout.push({
      text: formatDeText(byRole.compare_price.text),
      x: footerX,
      y: bandStart + 28,
      width: bodyW,
      fontSize: FONT.comparePrice,
      align: "center",
      bold: true,
      fontFamily: "Arial",
      role: "compare_price",
      maxLines: 1
    });
  }

  if (byRole.price) {
    const hasPromoCompare = Boolean(byRole.compare_price);
    layout.push({
      text: hasPromoCompare
        ? formatPorText(byRole.price.text)
        : formatNormalPriceText(byRole.price.text),
      x: footerX,
      y: bandStart + 56,
      width: bodyW,
      fontSize: FONT.price,
      align: "center",
      bold: true,
      fontFamily: "Arial",
      role: "price",
      maxLines: 1
    });
  }

  return layout.filter((element) => element.text);
}

function validateFinalLabelLayout(spec = {}, options = {}) {
  if (options.allow_multi_cell_grid === true || spec.allowMultiCellGrid === true) {
    return { ok: true, skipped: true };
  }

  const errors = [];
  const widthPx = Number(spec.widthPx || 0);
  const heightPx = Number(spec.heightPx || 0);
  const cols = Number(spec.grid?.cols || 0);
  const rows = Number(spec.grid?.rows || 0);
  const roles = new Set((Array.isArray(spec.elements) ? spec.elements : []).map((item) => item.role));

  if (widthPx !== FINAL_LABEL_LAYOUT.CANVAS_WIDTH_PX) {
    errors.push(`width_px=${widthPx}, esperado ${FINAL_LABEL_LAYOUT.CANVAS_WIDTH_PX}`);
  }
  if (heightPx !== FINAL_LABEL_LAYOUT.CANVAS_HEIGHT_PX) {
    errors.push(`height_px=${heightPx}, esperado ${FINAL_LABEL_LAYOUT.CANVAS_HEIGHT_PX}`);
  }
  if (widthPx === 640 && heightPx === 960) {
    errors.push("regressao detectada: canvas 640x960 (grade 2x2) nao permitido no fluxo real");
  }
  if (cols !== 1 || rows !== 1) {
    errors.push(`grid=${cols}x${rows}, esperado 1x1`);
  }
  ["brand", "barcode", "barcode_text", "code", "price"].forEach((role) => {
    if (!roles.has(role)) {
      errors.push(`elemento obrigatorio ausente: ${role}`);
    }
  });

  if (errors.length) {
    throw new Error(`Layout final Argox invalido: ${errors.join("; ")}`);
  }

  return {
    ok: true,
    width_px: widthPx,
    height_px: heightPx,
    grid: "1x1",
    top_block_offset_px: FINAL_LABEL_LAYOUT.TOP_BLOCK_OFFSET_PX
  };
}

function buildGridImageSpec(rawElements = [], config = {}) {
  const grid = resolveLabelGridConfig(config);
  const printCell = resolvePrintCell({
    ...config,
    print_cell: grid.cols === 1 && grid.rows === 1 ? "top-left" : (config.print_cell || "top-left")
  });
  const cellElements = layoutLabelElementsForCell(rawElements, config);

  if (printCell.col >= grid.cols || printCell.row >= grid.rows) {
    throw new Error(`Celula ${printCell.name} invalida para grade ${grid.grid}.`);
  }

  if (config.allow_multi_cell_grid !== true && (grid.cols !== 1 || grid.rows !== 1)) {
    throw new Error(`WINDOWS_DRIVER exige grade 1x1. Recebido ${grid.grid}.`);
  }

  const offsetX = printCell.col * grid.cellWidthPx;
  const offsetY = printCell.row * grid.cellHeightPx;
  const placedElements = cellElements.map((element) => ({
    ...element,
    x: element.x + offsetX,
    y: element.y + offsetY,
    column: printCell.col,
    row: printCell.row
  }));

  const debugEnabled = readEnvBoolean(
    config.debug_border ?? config.debugBorder,
    false
  );

  const widthPx = config.allow_multi_cell_grid === true ? grid.pageWidthPx : grid.cellWidthPx;
  const heightPx = config.allow_multi_cell_grid === true ? grid.pageHeightPx : grid.cellHeightPx;

  const spec = {
    mode: config.allow_multi_cell_grid === true ? "grid" : "single",
    dpi: grid.dpi,
    labelWidthMm: grid.labelWidthMm,
    labelHeightMm: grid.labelHeightMm,
    priceBandMm: grid.priceBandMm,
    widthPx,
    heightPx,
    grid,
    printCell,
    elements: placedElements,
    debugBorder: debugEnabled,
    debugGrid: debugEnabled && config.allow_multi_cell_grid === true,
    layout: {
      top_block_offset_px: FINAL_LABEL_LAYOUT.TOP_BLOCK_OFFSET_PX,
      canvas: `${FINAL_LABEL_LAYOUT.CANVAS_WIDTH_PX}x${FINAL_LABEL_LAYOUT.CANVAS_HEIGHT_PX}`,
      grid: FINAL_LABEL_LAYOUT.GRID
    }
  };

  validateFinalLabelLayout(spec, config);
  return spec;
}

module.exports = {
  FINAL_LABEL_LAYOUT,
  resolveLabelGridConfig,
  resolvePrintCell,
  layoutLabelElementsForCell,
  buildGridImageSpec,
  validateFinalLabelLayout,
  formatCodText,
  formatDeText,
  formatPorText,
  formatNormalPriceText,
  resolveBarcodeHumanTextFontSize,
  resolveBarcodeHumanTextLayout,
  shouldUseTwoLineBarcodeHumanText,
  splitBarcodeHumanText
};
