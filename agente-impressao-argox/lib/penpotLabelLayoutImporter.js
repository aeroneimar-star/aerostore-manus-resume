"use strict";

const {
  buildLabelLayoutDocument,
  elementFromPenpotShape,
  parseRoleFromPenpotName,
  validateLabelLayoutDocument
} = require("./labelLayoutSchema");

function normalizeText(value = "") {
  return String(value ?? "").trim();
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function walkPenpotObjects(node = {}, bucket = [], offsetX = 0, offsetY = 0) {
  if (!node || typeof node !== "object") {
    return bucket;
  }
  const x = offsetX + normalizeNumber(node.x);
  const y = offsetY + normalizeNumber(node.y);
  const width = normalizeNumber(node.width);
  const height = normalizeNumber(node.height);
  const name = normalizeText(node.name);
  const role = parseRoleFromPenpotName(name);
  if (role) {
    const typography = node.typography || node.content?.typography || {};
    bucket.push({
      name,
      role,
      x,
      y,
      width,
      height,
      fontFamily: normalizeText(typography.fontFamily || node.fontFamily || "Arial"),
      fontSize: normalizeNumber(typography.fontSize || node.fontSize, 16),
      bold: normalizeText(typography.fontWeight || node.fontWeight || "700") !== "400",
      align: normalizeText(node.align || "center") || "center",
      maxLines: normalizeNumber(node.maxLines, role === "name" ? 2 : 1)
    });
  }
  const children = Array.isArray(node.children) ? node.children : [];
  children.forEach((child) => walkPenpotObjects(child, bucket, x, y));
  return bucket;
}

function findPenpotCanvasBoard(fileData = {}) {
  const pages = fileData.pages || fileData.data?.pages || [];
  const pageList = Array.isArray(pages) ? pages : Object.values(pages || {});
  for (const page of pageList) {
    const objects = page.objects || page.shapes || {};
    const objectList = Array.isArray(objects) ? objects : Object.values(objects || {});
    const board = objectList.find((item) => {
      const name = normalizeText(item?.name).toLowerCase();
      return name === "label_canvas" || name === "label-canvas" || name === "canvas_320x480";
    });
    if (board) {
      return board;
    }
  }
  return null;
}

function importFromPenpotFlatExport(payload = {}, options = {}) {
  const shapes = Array.isArray(payload.shapes)
    ? payload.shapes
    : Array.isArray(payload.layers)
      ? payload.layers
      : [];
  const elements = shapes
    .map((shape) => elementFromPenpotShape(shape))
    .filter(Boolean)
    .sort((left, right) => left.y - right.y || left.x - right.x);

  const doc = buildLabelLayoutDocument({
    id: options.id || payload.id || "aerostore-tag-40x60",
    name: options.name || payload.name || "AEROSTORE Tag 40x60",
    source: "penpot-flat-export",
    canvas: {
      width_px: normalizeNumber(payload.canvas?.width_px, 320),
      height_px: normalizeNumber(payload.canvas?.height_px, 480),
      dpi: normalizeNumber(payload.canvas?.dpi, 203),
      label_width_mm: 40,
      label_height_mm: 60,
      price_band_mm: 12
    },
    constants: payload.constants || {},
    elements,
    notes: [
      "Importado de export flat do Penpot.",
      "Camadas devem usar prefixo role: (ex.: role:brand, role:barcode).",
      "Barcode e texto dinamico continuam renderizados pelo agente Argox."
    ]
  });
  const validation = validateLabelLayoutDocument(doc);
  if (!validation.ok) {
    const error = new Error(`label-layout.json invalido: ${validation.errors.join("; ")}`);
    error.validation = validation;
    throw error;
  }
  return doc;
}

function importFromPenpotGetFileResponse(fileData = {}, options = {}) {
  const board = findPenpotCanvasBoard(fileData);
  if (!board) {
    throw new Error("Board LABEL_CANVAS nao encontrado no arquivo Penpot.");
  }
  const flatShapes = walkPenpotObjects(board, [], 0, 0);
  return importFromPenpotFlatExport({
    id: options.id || "aerostore-tag-40x60",
    name: options.name || "AEROSTORE Tag 40x60",
    canvas: {
      width_px: normalizeNumber(board.width, 320),
      height_px: normalizeNumber(board.height, 480),
      dpi: 203
    },
    shapes: flatShapes
  }, options);
}

module.exports = {
  walkPenpotObjects,
  findPenpotCanvasBoard,
  importFromPenpotFlatExport,
  importFromPenpotGetFileResponse
};
