"use strict";

const LABEL_LAYOUT_VERSION = 1;

const LABEL_ROLES = Object.freeze([
  "brand",
  "name",
  "size_color",
  "sku",
  "barcode",
  "barcode_text",
  "code",
  "compare_price",
  "price",
  "perforation_guide"
]);

const REQUIRED_ROLES = Object.freeze([
  "brand",
  "barcode",
  "barcode_text",
  "code",
  "price"
]);

const PENPOT_LAYER_PREFIX = "role:";

function normalizeText(value = "") {
  return String(value ?? "").trim();
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseRoleFromPenpotName(name = "") {
  const raw = normalizeText(name);
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower.startsWith(PENPOT_LAYER_PREFIX)) {
    return lower.slice(PENPOT_LAYER_PREFIX.length);
  }
  if (LABEL_ROLES.includes(lower)) {
    return lower;
  }
  return "";
}

function buildLabelLayoutDocument({
  id = "aerostore-tag-40x60",
  name = "AEROSTORE Tag 40x60",
  source = "code",
  canvas = {},
  constants = {},
  elements = [],
  notes = []
} = {}) {
  return {
    version: LABEL_LAYOUT_VERSION,
    id: normalizeText(id),
    name: normalizeText(name),
    source: normalizeText(source),
    canvas: {
      width_px: normalizeNumber(canvas.width_px, 320),
      height_px: normalizeNumber(canvas.height_px, 480),
      dpi: normalizeNumber(canvas.dpi, 203),
      label_width_mm: normalizeNumber(canvas.label_width_mm, 40),
      label_height_mm: normalizeNumber(canvas.label_height_mm, 60),
      price_band_mm: normalizeNumber(canvas.price_band_mm, 12)
    },
    constants,
    elements: Array.isArray(elements) ? elements : [],
    notes: Array.isArray(notes) ? notes : []
  };
}

function validateLabelLayoutDocument(doc = {}) {
  const errors = [];
  if (normalizeNumber(doc.version) !== LABEL_LAYOUT_VERSION) {
    errors.push(`version invalida: ${doc.version}`);
  }
  if (normalizeNumber(doc.canvas?.width_px) !== 320) {
    errors.push(`canvas.width_px deve ser 320, recebido ${doc.canvas?.width_px}`);
  }
  if (normalizeNumber(doc.canvas?.height_px) !== 480) {
    errors.push(`canvas.height_px deve ser 480, recebido ${doc.canvas?.height_px}`);
  }
  const roles = new Set((Array.isArray(doc.elements) ? doc.elements : []).map((item) => item.role));
  REQUIRED_ROLES.forEach((role) => {
    if (!roles.has(role)) {
      errors.push(`elemento obrigatorio ausente: ${role}`);
    }
  });
  return {
    ok: errors.length === 0,
    errors
  };
}

function elementFromPenpotShape(shape = {}) {
  const role = parseRoleFromPenpotName(shape.name);
  if (!role) {
    return null;
  }
  const element = {
    role,
    x: Math.round(normalizeNumber(shape.x)),
    y: Math.round(normalizeNumber(shape.y)),
    width: Math.round(normalizeNumber(shape.width)),
    height: Math.round(normalizeNumber(shape.height || 0)),
    align: normalizeText(shape.align || "center") || "center",
    fontFamily: normalizeText(shape.fontFamily || "Arial") || "Arial",
    fontSize: Math.round(normalizeNumber(shape.fontSize, 16)),
    bold: shape.bold !== false,
    maxLines: Math.max(1, Math.round(normalizeNumber(shape.maxLines, 1)))
  };
  if (role === "barcode") {
    element.isBarcode = true;
    element.renderBarcodeText = false;
  }
  if (role === "barcode_text") {
    element.fontFamily = normalizeText(shape.fontFamily || "Arial") || "Arial";
    element.bold = true;
  }
  if (role === "perforation_guide") {
    element.guideOnly = true;
  }
  return element;
}

module.exports = {
  LABEL_LAYOUT_VERSION,
  LABEL_ROLES,
  REQUIRED_ROLES,
  PENPOT_LAYER_PREFIX,
  parseRoleFromPenpotName,
  buildLabelLayoutDocument,
  validateLabelLayoutDocument,
  elementFromPenpotShape
};
