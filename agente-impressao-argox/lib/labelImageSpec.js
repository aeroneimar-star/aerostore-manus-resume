"use strict";

const path = require("path");
const { readEnvBoolean } = require(path.join(__dirname, "..", "..", "modules", "pdv", "services", "argoxEnvBoolean"));

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mmToPx(mm = 0, dpi = 203) {
  return Math.max(1, Math.round(normalizeNumber(mm, 0) * (dpi / 25.4)));
}

function buildMinimalImageSpec(config = {}) {
  const dpi = normalizeNumber(config.dpi, 203);
  const widthPx = mmToPx(config.label_width_mm || 40, dpi);
  const heightPx = mmToPx(config.label_height_mm || 60, dpi);
  const spec = {
    mode: "minimal",
    dpi,
    labelWidthMm: normalizeNumber(config.label_width_mm, 40),
    labelHeightMm: normalizeNumber(config.label_height_mm, 60),
    widthPx,
    heightPx,
    elements: [
      {
        text: "TESTE AEROSTORE",
        x: Math.round(widthPx * 0.08),
        y: Math.round(heightPx * 0.38),
        width: Math.round(widthPx * 0.84),
        fontSize: 16,
        align: "center",
        bold: true
      },
      {
        text: "COD 123456",
        x: Math.round(widthPx * 0.08),
        y: Math.round(heightPx * 0.52),
        width: Math.round(widthPx * 0.84),
        fontSize: 14,
        align: "center"
      }
    ]
  };
  return applyFullTagLayout(spec, config);
}

function buildImageSpecFromPreviewElements(elements = [], config = {}) {
  const dpi = normalizeNumber(config.dpi, 203);
  const widthPx = mmToPx(config.label_width_mm || 40, dpi);
  const heightPx = mmToPx(config.label_height_mm || 60, dpi);
  const columns = Math.max(1, normalizeNumber(config.label_columns, 1));
  const singleTag = columns === 1;

  const filtered = (Array.isArray(elements) ? elements : [])
    .filter(Boolean)
    .filter((element) => (singleTag ? Number(element.column || 0) === 0 : true));

  const mapped = filtered.map((element) => ({
    text: String(element.text || ""),
    x: Math.max(0, Math.round(normalizeNumber(element.x, 0))),
    y: Math.max(0, Math.round(normalizeNumber(element.y, 0))),
    width: Math.max(0, Math.round(normalizeNumber(element.width, widthPx))),
    fontSize: Math.max(8, Math.round(normalizeNumber(element.fontSize, 11))),
    align: element.align || "center",
    bold: element.type === "price" || element.role === "price",
    isBarcode: Boolean(element.isBarcode),
    role: element.role || element.type || "text",
    maxLines: Math.max(1, Math.floor(normalizeNumber(element.maxLines, 1)))
  }));

  const spec = {
    mode: "preview",
    dpi,
    labelWidthMm: normalizeNumber(config.label_width_mm, 40),
    labelHeightMm: normalizeNumber(config.label_height_mm, 60),
    widthPx,
    heightPx,
    elements: mapped
  };

  return applyFullTagLayout(spec, config);
}

function applyFullTagLayout(spec = {}, config = {}) {
  const dpi = normalizeNumber(spec.dpi, 203);
  const widthPx = normalizeNumber(spec.widthPx, mmToPx(40, dpi));
  const heightPx = normalizeNumber(spec.heightPx, mmToPx(60, dpi));
  const paddingXMm = normalizeNumber(config.layout_padding_x_mm, 2);
  const paddingYMm = normalizeNumber(config.layout_padding_y_mm, 3);
  const paddingX = mmToPx(paddingXMm, dpi);
  const paddingY = mmToPx(paddingYMm, dpi);
  const elements = Array.isArray(spec.elements) ? spec.elements.filter(Boolean) : [];
  if (!elements.length) {
    return {
      ...spec,
      widthPx,
      heightPx,
      debugBorder: readEnvBoolean(config.debug_border ?? process.env.ARGOX_DRIVER_DEBUG_BORDER, false)
    };
  }

  const minX = Math.min(...elements.map((element) => element.x));
  const maxRight = Math.max(...elements.map((element) => element.x + Math.max(element.width || 0, 1)));
  const minY = Math.min(...elements.map((element) => element.y));
  const maxBottom = Math.max(...elements.map((element) => element.y + Math.max(element.fontSize || 11, 8) * 2));
  const contentWidth = Math.max(1, maxRight - minX);
  const contentHeight = Math.max(1, maxBottom - minY);
  const targetWidth = Math.max(1, widthPx - paddingX * 2);
  const targetHeight = Math.max(1, heightPx - paddingY * 2);
  const scaleX = targetWidth / contentWidth;
  const scaleY = targetHeight / contentHeight;
  const widthScale = Math.min(Math.max(scaleX, 1), 1.45);
  const heightScale = Math.min(Math.max(scaleY, 1), 1.18);
  const fontScale = Math.min(Math.max(Math.sqrt(widthScale * heightScale), 1), 1.35);

  const scaledElements = elements.map((element) => ({
    ...element,
    x: Math.round(paddingX + (element.x - minX) * widthScale),
    y: Math.round(paddingY + (element.y - minY) * heightScale),
    width: Math.round(Math.max(element.width || targetWidth, 1) * widthScale),
    fontSize: Math.max(8, Math.round((element.fontSize || 11) * fontScale))
  }));

  return {
    ...spec,
    widthPx,
    heightPx,
    elements: scaledElements,
    layoutScale: { widthScale, heightScale, fontScale },
    debugBorder: readEnvBoolean(config.debug_border ?? process.env.ARGOX_DRIVER_DEBUG_BORDER, false)
  };
}

module.exports = {
  buildMinimalImageSpec,
  buildImageSpecFromPreviewElements,
  applyFullTagLayout,
  mmToPx
};
