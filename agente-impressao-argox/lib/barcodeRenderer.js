"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const LABEL_BARCODE_ERROR = "Produto sem código de barras válido para etiqueta.";
const RENDER_BARCODE_SCRIPT = path.join(__dirname, "..", "scripts", "render-barcode-png.js");

function normalizeBarcodeValue(value = "") {
  return String(value ?? "").trim();
}

function renderBarcodePngSync({
  value = "",
  symbology = "code128",
  outputPath = "",
  widthPx = 280,
  heightPx = 80,
  dpi = 203
} = {}) {
  if (!value) {
    throw new Error(LABEL_BARCODE_ERROR);
  }
  if (!outputPath) {
    throw new Error("Caminho de saida do barcode nao informado.");
  }

  const result = spawnSync(process.execPath, [
    RENDER_BARCODE_SCRIPT,
    "--value", value,
    "--symbology", symbology,
    "--output", outputPath,
    "--width", String(widthPx),
    "--height", String(heightPx),
    "--dpi", String(dpi)
  ], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true
  });

  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || "").trim()
      || "Falha ao gerar PNG do barcode.";
    throw new Error(message);
  }

  let payload = {};
  try {
    payload = JSON.parse(String(result.stdout || "").trim() || "{}");
  } catch {
    payload = { ok: fs.existsSync(outputPath) };
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error("PNG do barcode nao foi gerado.");
  }

  return {
    file_path: outputPath,
    bytes: payload.bytes || fs.statSync(outputPath).size,
    symbology: payload.symbology || symbology,
    value: payload.value || value,
    width_px: payload.width_px || 0,
    height_px: payload.height_px || 0
  };
}

function attachBarcodeImagesToSpec(spec = {}, options = {}) {
  const tempDir = options.tempDir || path.join(os.tmpdir(), "argox-label-barcodes");
  fs.mkdirSync(tempDir, { recursive: true });

  const attachedPaths = [];
  const elements = Array.isArray(spec.elements) ? spec.elements.map((element) => {
    if (!element || element.isBarcode !== true) {
      return element;
    }

    const encodedValue = normalizeBarcodeValue(element.barcodeValue || element.text);
    if (!encodedValue) {
      throw new Error(LABEL_BARCODE_ERROR);
    }
    const symbology = String(element.barcodeSymbology || "code128").toLowerCase() === "ean13"
      ? "ean13"
      : "code128";

    const outputPath = path.join(
      tempDir,
      `barcode-${symbology}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`
    );
    const rendered = renderBarcodePngSync({
      value: encodedValue,
      symbology,
      outputPath,
      widthPx: Number(element.width || 280),
      heightPx: Number(element.height || 80)
    });
    attachedPaths.push(outputPath);

    return {
      ...element,
      text: encodedValue,
      barcodeValue: encodedValue,
      barcodeSymbology: symbology,
      barcodeImagePath: rendered.file_path,
      barcodeNativeWidth: rendered.width_px || undefined,
      barcodeNativeHeight: rendered.height_px || undefined,
      renderBarcodeText: false
    };
  }) : [];

  return {
    spec: {
      ...spec,
      elements
    },
    attachedPaths
  };
}

function cleanupBarcodeImages(paths = []) {
  (Array.isArray(paths) ? paths : []).forEach((filePath) => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // ignore
    }
  });
}

module.exports = {
  renderBarcodePngSync,
  attachBarcodeImagesToSpec,
  cleanupBarcodeImages,
  LABEL_BARCODE_ERROR
};
