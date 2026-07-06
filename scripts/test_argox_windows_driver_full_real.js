"use strict";

const path = require("path");
const { buildFullLabelImageSpec } = require("../agente-impressao-argox/lib/fullLabelDriver");
const { renderAndPrintLabel, isTransportAvailable } = require("../agente-impressao-argox/lib/windowsDriverPrint");

const OUTPUT_DIR = path.join(__dirname, "..", "agente-impressao-argox", "output");

function resolveConfirmRealPrint() {
  return String(process.env.ARGOX_CONFIRM_REAL_PRINT || "").trim().toLowerCase() === "true";
}

function resolveSafeTestMode() {
  return String(process.env.ARGOX_SAFE_TEST_MODE || "true").trim().toLowerCase() === "true";
}

function main() {
  if (!resolveConfirmRealPrint()) {
    console.error("Impressao real bloqueada. Defina ARGOX_CONFIRM_REAL_PRINT=true para continuar.");
    process.exit(1);
  }
  if (!resolveSafeTestMode()) {
    console.error("Safe test mode deve estar ativo. Defina ARGOX_SAFE_TEST_MODE=true.");
    process.exit(1);
  }
  if (!isTransportAvailable()) {
    console.error("WINDOWS_DRIVER disponivel apenas no Windows.");
    process.exit(1);
  }

  process.env.ARGOX_LABEL_GRID = "1x1";
  process.env.ARGOX_PRINT_TRANSPORT = process.env.ARGOX_PRINT_TRANSPORT || "WINDOWS_DRIVER";
  process.env.ARGOX_DRIVER_DEBUG_BORDER = "false";
  process.env.ARGOX_LABEL_HEIGHT_MM = process.env.ARGOX_LABEL_HEIGHT_MM || "60";
  process.env.ARGOX_LABEL_PRICE_BAND_MM = process.env.ARGOX_LABEL_PRICE_BAND_MM || "12";
  process.env.ARGOX_DRIVER_SCALE_X = process.env.ARGOX_DRIVER_SCALE_X || "1";
  process.env.ARGOX_DRIVER_SCALE_Y = process.env.ARGOX_DRIVER_SCALE_Y || "1";
  process.env.ARGOX_DRIVER_OFFSET_X_MM = process.env.ARGOX_DRIVER_OFFSET_X_MM || "0";
  process.env.ARGOX_DRIVER_OFFSET_Y_MM = process.env.ARGOX_DRIVER_OFFSET_Y_MM || "0";
  process.env.ARGOX_DRIVER_DEBUG_BORDER = "false";

  const printerName = String(process.env.ARGOX_PRINTER_NAME || "").trim();
  if (!printerName) {
    console.error("Defina ARGOX_PRINTER_NAME com o nome exato da fila Windows.");
    process.exit(1);
  }

  const { imageSpec, quantity_received, quantity_final, safe_test_mode, grid } = buildFullLabelImageSpec({
    config: {
      label_grid: "1x1",
      print_cell: "top-left",
      allow_multi_cell_grid: false,
      debug_border: false,
      safe_test_mode: true
    }
  });

  if (imageSpec.widthPx !== 320 || imageSpec.heightPx !== 480) {
    console.error(`Canvas invalido: ${imageSpec.widthPx}x${imageSpec.heightPx}. Esperado 320x480.`);
    process.exit(1);
  }

  const result = renderAndPrintLabel(printerName, imageSpec, {
    outputDir: OUTPUT_DIR,
    prefix: "full-driver-real",
    saveOnly: false,
    copies: 1,
    forceSingleCopy: true,
    debug_border: false
  });

  console.log("Impressao full WINDOWS_DRIVER enviada:", JSON.stringify({
    impressora: printerName,
    print_transport: "WINDOWS_DRIVER",
    quantidade_recebida: quantity_received,
    quantidade_final: quantity_final,
    copies: result.copies || 1,
    pages_printed: result.pages_printed || 1,
    safe_test_mode,
    metodo: result.metodo,
    bytes: result.bytes,
    job_id: result.jobId,
    imagem_path: result.imagem_path,
    width_px: result.width_px,
    height_px: result.height_px,
    canvas: `${imageSpec.widthPx}x${imageSpec.heightPx}`,
    label_grid: grid.grid,
    page_bounds: result.page_bounds || null,
    driver_options: result.driver_options || null
  }, null, 2));
}

main();
