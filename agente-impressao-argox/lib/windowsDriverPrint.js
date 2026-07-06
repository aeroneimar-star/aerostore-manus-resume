"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { resolveDriverPrintOptions } = require("./driverPrintOptions");
const { attachBarcodeImagesToSpec, cleanupBarcodeImages } = require("./barcodeRenderer");

const RENDER_SCRIPT = path.join(__dirname, "..", "scripts", "render-label-image.ps1");
const PRINT_SCRIPT = path.join(__dirname, "..", "scripts", "print-driver-image.ps1");
const PRINT_IMAGES_SCRIPT = path.join(__dirname, "..", "scripts", "print-driver-images.ps1");
const COMPOSE_SCRIPT = path.join(__dirname, "..", "scripts", "compose-batch-row.ps1");
const { BATCH_ROW_LAYOUT, resolveDriverPrintJobs } = require("./batchRowPlan");

function runPowerShell(scriptPath, args = []) {
  return spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", scriptPath,
    ...args
  ], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  });
}

function isTransportAvailable() {
  return process.platform === "win32";
}

function parseJsonOutput(stdout = "") {
  const text = String(stdout || "").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function renderLabelImageSpec(spec = {}, outputPath = "") {
  if (!isTransportAvailable()) {
    throw new Error("WINDOWS_DRIVER disponivel apenas no Windows.");
  }
  if (!outputPath) {
    throw new Error("Caminho de saida da imagem nao informado.");
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const specPath = path.join(
    os.tmpdir(),
    `argox-label-spec-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  fs.writeFileSync(specPath, JSON.stringify(spec), "utf8");

  let barcodePaths = [];
  let renderSpec = spec;
  try {
    const attached = attachBarcodeImagesToSpec(spec, {
      tempDir: path.join(os.tmpdir(), "argox-label-barcodes")
    });
    renderSpec = attached.spec;
    barcodePaths = attached.attachedPaths;
    fs.writeFileSync(specPath, JSON.stringify(renderSpec), "utf8");
  } catch (error) {
    try {
      fs.unlinkSync(specPath);
    } catch {
      // ignore
    }
    throw error;
  }

  try {
    const result = runPowerShell(RENDER_SCRIPT, [
      "-SpecPath", specPath,
      "-OutputPath", outputPath
    ]);
    const stderr = String(result.stderr || "").trim();
    const payload = parseJsonOutput(result.stdout);
    if (result.status !== 0 || payload.ok !== true) {
      throw new Error(payload.erro || stderr || "Falha ao renderizar imagem da etiqueta.");
    }
    return {
      file_path: payload.file_path || outputPath,
      bytes: payload.bytes || fs.statSync(outputPath).size,
      width_px: payload.width_px,
      height_px: payload.height_px,
      metodo: "WINDOWS_DRIVER_RENDER"
    };
  } finally {
    cleanupBarcodeImages(barcodePaths);
    try {
      fs.unlinkSync(specPath);
    } catch {
      // ignore
    }
  }
}

function printImageFiles(printerName = "", imagePaths = [], options = {}) {
  if (!isTransportAvailable()) {
    throw new Error("WINDOWS_DRIVER disponivel apenas no Windows.");
  }
  if (!printerName) {
    throw new Error("Nome da impressora nao informado.");
  }
  const paths = (Array.isArray(imagePaths) ? imagePaths : [imagePaths])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  if (!paths.length) {
    throw new Error("Nenhuma imagem informada para impressao multipage.");
  }
  paths.forEach((imagePath) => {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Imagem nao encontrada: ${imagePath}`);
    }
  });

  const driverOptions = resolveDriverPrintOptions(options);
  const manifestPath = path.join(
    os.tmpdir(),
    `argox-print-manifest-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  fs.writeFileSync(manifestPath, JSON.stringify(paths), "utf8");

  try {
    const result = runPowerShell(PRINT_IMAGES_SCRIPT, [
      "-PrinterName", printerName,
      "-ImageListPath", manifestPath,
      "-Copies", "1",
      "-LabelWidthMm", String(Math.max(1, Math.round(Number(options.labelWidthMm || BATCH_ROW_LAYOUT.ROW_WIDTH_MM)))),
      "-LabelHeightMm", String(Math.max(1, Math.round(Number(options.labelHeightMm || BATCH_ROW_LAYOUT.ROW_HEIGHT_MM)))),
      "-ScaleX", String(driverOptions.scaleX),
      "-ScaleY", String(driverOptions.scaleY),
      "-OffsetXMm", String(driverOptions.offsetXMm),
      "-OffsetYMm", String(driverOptions.offsetYMm)
    ]);
    const stderr = String(result.stderr || "").trim();
    const payload = parseJsonOutput(result.stdout);
    if (result.status !== 0 || payload.ok !== true) {
      throw new Error(payload.erro || stderr || "Falha ao imprimir multipage via driver Windows.");
    }
    const totalBytes = paths.reduce((sum, imagePath) => sum + fs.statSync(imagePath).size, 0);
    return {
      jobId: payload.job_id || `DRV_MULTI_${Date.now()}`,
      bytes: payload.bytes || totalBytes,
      metodo: payload.metodo || "WINDOWS_DRIVER_MULTIPAGE",
      impressora: payload.impressora || printerName,
      copies: payload.copies || 1,
      pages_printed: payload.pages_printed || paths.length,
      images_count: payload.images_count || paths.length,
      driver_options: driverOptions,
      page_bounds: payload.page_bounds || null,
      image_paths: paths
    };
  } finally {
    try {
      fs.unlinkSync(manifestPath);
    } catch {
      // ignore
    }
  }
}

function printImageFile(printerName = "", imagePath = "", options = {}) {
  if (!isTransportAvailable()) {
    throw new Error("WINDOWS_DRIVER disponivel apenas no Windows.");
  }
  if (!printerName) {
    throw new Error("Nome da impressora nao informado.");
  }
  if (!imagePath || !fs.existsSync(imagePath)) {
    throw new Error(`Imagem nao encontrada: ${imagePath || "(vazio)"}`);
  }

  const driverOptions = resolveDriverPrintOptions(options);
  const effectiveCopies = 1;
  const result = runPowerShell(PRINT_SCRIPT, [
    "-PrinterName", printerName,
    "-ImagePath", imagePath,
    "-Copies", String(effectiveCopies),
    "-LabelWidthMm", String(Math.max(1, Math.round(Number(options.labelWidthMm || 40)))),
    "-LabelHeightMm", String(Math.max(1, Math.round(Number(options.labelHeightMm || 60)))),
    "-ScaleX", String(driverOptions.scaleX),
    "-ScaleY", String(driverOptions.scaleY),
    "-OffsetXMm", String(driverOptions.offsetXMm),
    "-OffsetYMm", String(driverOptions.offsetYMm)
  ]);
  const stderr = String(result.stderr || "").trim();
  const payload = parseJsonOutput(result.stdout);
  if (result.status !== 0 || payload.ok !== true) {
    throw new Error(payload.erro || stderr || "Falha ao imprimir via driver Windows.");
  }
  return {
    jobId: payload.job_id || `DRV_${Date.now()}`,
    bytes: payload.bytes || fs.statSync(imagePath).size,
    metodo: payload.metodo || "WINDOWS_DRIVER",
    impressora: payload.impressora || printerName,
    copies: payload.copies || effectiveCopies,
    pages_printed: payload.pages_printed || 1,
    driver_options: driverOptions,
    page_bounds: payload.page_bounds || null
  };
}

function assertSingleLabelCanvas(spec = {}, options = {}) {
  if (options.allowMultiCellGrid || spec.grid?.cols > 1 || spec.grid?.rows > 1) {
    return;
  }
  const widthPx = Number(spec.widthPx || 0);
  const heightPx = Number(spec.heightPx || 0);
  const expectedW = Number(spec.grid?.cellWidthPx || 320);
  const expectedH = Number(spec.grid?.cellHeightPx || 480);
  if (widthPx !== expectedW || heightPx !== expectedH) {
    throw new Error(
      `Canvas WINDOWS_DRIVER invalido: ${widthPx}x${heightPx}. Esperado ${expectedW}x${expectedH} (1x1 / 40x60mm).`
    );
  }
}

function composeBatchRowImage(leftImagePath = "", rightImagePath = "", outputPath = "", options = {}) {
  if (!isTransportAvailable()) {
    throw new Error("WINDOWS_DRIVER disponivel apenas no Windows.");
  }
  if (!outputPath) {
    throw new Error("Caminho de saida da linha de lote nao informado.");
  }
  const result = runPowerShell(COMPOSE_SCRIPT, [
    "-OutputPath", outputPath,
    "-WidthPx", String(options.widthPx || BATCH_ROW_LAYOUT.ROW_WIDTH_PX),
    "-HeightPx", String(options.heightPx || BATCH_ROW_LAYOUT.ROW_HEIGHT_PX),
    "-CellWidthPx", String(options.cellWidthPx || BATCH_ROW_LAYOUT.CELL_WIDTH_PX),
    "-Dpi", String(options.dpi || BATCH_ROW_LAYOUT.DPI),
    "-LeftImagePath", leftImagePath || "",
    "-RightImagePath", rightImagePath || ""
  ]);
  const stderr = String(result.stderr || "").trim();
  const payload = parseJsonOutput(result.stdout);
  if (result.status !== 0 || payload.ok !== true) {
    throw new Error(payload.erro || stderr || "Falha ao compor linha de lote 640x480.");
  }
  return {
    file_path: payload.file_path || outputPath,
    bytes: payload.bytes || fs.statSync(outputPath).size,
    width_px: payload.width_px || BATCH_ROW_LAYOUT.ROW_WIDTH_PX,
    height_px: payload.height_px || BATCH_ROW_LAYOUT.ROW_HEIGHT_PX,
    left_used: Boolean(payload.left_used),
    right_used: Boolean(payload.right_used),
    metodo: payload.metodo || "WINDOWS_DRIVER_BATCH_COMPOSE"
  };
}

function renderSingleLabelImage(spec = {}, options = {}) {
  const debugBorder = spec.debugBorder === true;
  const enrichedSpec = {
    ...spec,
    debugBorder,
    debugGrid: spec.debugGrid === true
  };
  assertSingleLabelCanvas(enrichedSpec, options);
  const outputDir = options.outputDir || path.join(__dirname, "..", "output");
  fs.mkdirSync(outputDir, { recursive: true });
  const prefix = options.prefix || "driver-label-cell";
  const imagePath = path.join(outputDir, `${prefix}-${Date.now()}.png`);
  const rendered = renderLabelImageSpec(enrichedSpec, imagePath);
  return {
    ...rendered,
    imagem: path.basename(imagePath),
    imagem_path: imagePath
  };
}

function renderBatchRow(leftSpec = null, rightSpec = null, options = {}) {
  const outputDir = options.outputDir || path.join(__dirname, "..", "output");
  fs.mkdirSync(outputDir, { recursive: true });
  const rowPrefix = options.prefix || "batch-row";
  const timestamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const leftRendered = leftSpec
    ? renderSingleLabelImage(leftSpec, {
      outputDir,
      prefix: `${rowPrefix}-left-${timestamp}`
    })
    : null;
  const rightRendered = rightSpec
    ? renderSingleLabelImage(rightSpec, {
      outputDir,
      prefix: `${rowPrefix}-right-${timestamp}`
    })
    : null;

  const rowImagePath = path.join(outputDir, `${rowPrefix}-${timestamp}.png`);
  const composed = composeBatchRowImage(
    leftRendered?.imagem_path || "",
    rightRendered?.imagem_path || "",
    rowImagePath,
    options.composeOptions || {}
  );

  if (leftRendered && leftRendered.width_px !== BATCH_ROW_LAYOUT.CELL_WIDTH_PX) {
    throw new Error(`Celula esquerda invalida: ${leftRendered.width_px}x${leftRendered.height_px}. Esperado 320x480.`);
  }
  if (rightRendered && rightRendered.width_px !== BATCH_ROW_LAYOUT.CELL_WIDTH_PX) {
    throw new Error(`Celula direita invalida: ${rightRendered.width_px}x${rightRendered.height_px}. Esperado 320x480.`);
  }
  if (composed.width_px !== BATCH_ROW_LAYOUT.ROW_WIDTH_PX || composed.height_px !== BATCH_ROW_LAYOUT.ROW_HEIGHT_PX) {
    throw new Error(`Linha de lote invalida: ${composed.width_px}x${composed.height_px}. Esperado 640x480.`);
  }

  return {
    ...composed,
    imagem: path.basename(rowImagePath),
    imagem_path: rowImagePath,
    left_cell_path: leftRendered?.imagem_path || null,
    right_cell_path: rightRendered?.imagem_path || null,
    width_px: composed.width_px,
    height_px: composed.height_px
  };
}

function printRenderedBatchRows(printerName = "", rowResults = [], options = {}) {
  const rows = Array.isArray(rowResults) ? rowResults.filter(Boolean) : [];
  if (!rows.length) {
    throw new Error("Nenhuma linha de lote renderizada para impressao.");
  }
  if (options.saveOnly) {
    return {
      jobId: `IMG_${Date.now()}`,
      metodo: "WINDOWS_DRIVER_SAVE",
      print_jobs: resolveDriverPrintJobs(rows.length, options.driver_columns || 2, { multipage: true }),
      pages_printed: rows.length,
      multipage_used: rows.length > 1,
      multipage_fallback: false,
      bytes: rows.reduce((sum, row) => sum + Number(row.bytes || 0), 0)
    };
  }

  const driverOptions = resolveDriverPrintOptions(options);
  const printOptions = {
    copies: 1,
    forceSingleCopy: true,
    labelWidthMm: BATCH_ROW_LAYOUT.ROW_WIDTH_MM,
    labelHeightMm: BATCH_ROW_LAYOUT.ROW_HEIGHT_MM,
    ...driverOptions
  };

  if (rows.length === 1) {
    const printed = printImageFile(printerName, rows[0].imagem_path, printOptions);
    return {
      ...printed,
      print_jobs: 1,
      pages_printed: 1,
      multipage_used: false,
      multipage_fallback: false
    };
  }

  const imagePaths = rows.map((row) => row.imagem_path).filter(Boolean);
  try {
    const printed = printImageFiles(printerName, imagePaths, printOptions);
    return {
      ...printed,
      print_jobs: 1,
      pages_printed: printed.pages_printed || rows.length,
      multipage_used: true,
      multipage_fallback: false
    };
  } catch (error) {
    const fallbackResults = [];
    imagePaths.forEach((imagePath, index) => {
      fallbackResults.push(printImageFile(printerName, imagePath, printOptions));
    });
    const lastFallback = fallbackResults[fallbackResults.length - 1] || {};
    return {
      ...lastFallback,
      print_jobs: rows.length,
      pages_printed: rows.length,
      multipage_used: false,
      multipage_fallback: true,
      multipage_error: error.message || String(error),
      metodo: "WINDOWS_DRIVER_FALLBACK_PER_ROW"
    };
  }
}

function renderAndPrintBatchRow(printerName = "", leftSpec = null, rightSpec = null, options = {}) {
  const row = renderBatchRow(leftSpec, rightSpec, options);
  if (options.saveOnly) {
    return {
      ...row,
      jobId: `IMG_${Date.now()}`,
      metodo: "WINDOWS_DRIVER_SAVE"
    };
  }

  const printed = printImageFile(printerName, row.imagem_path, {
    copies: 1,
    forceSingleCopy: true,
    labelWidthMm: BATCH_ROW_LAYOUT.ROW_WIDTH_MM,
    labelHeightMm: BATCH_ROW_LAYOUT.ROW_HEIGHT_MM,
    ...resolveDriverPrintOptions(options)
  });
  return {
    ...row,
    ...printed
  };
}
function renderAndPrintLabel(printerName = "", spec = {}, options = {}) {
  const rendered = renderSingleLabelImage(spec, options);
  const outputDir = options.outputDir || path.join(__dirname, "..", "output");
  const imagePath = rendered.imagem_path;

  if (options.saveOnly) {
    return {
      ...rendered,
      jobId: `IMG_${Date.now()}`,
      metodo: "WINDOWS_DRIVER_SAVE"
    };
  }

  const driverOptions = resolveDriverPrintOptions(options);
  const enrichedSpec = {
    ...spec,
    debugBorder: spec.debugBorder === true
  };
  const printed = printImageFile(printerName, imagePath, {
    copies: 1,
    forceSingleCopy: options.forceSingleCopy !== false,
    labelWidthMm: enrichedSpec.labelWidthMm || enrichedSpec.grid?.labelWidthMm || 40,
    labelHeightMm: enrichedSpec.labelHeightMm || enrichedSpec.grid?.labelHeightMm || 60,
    ...driverOptions
  });
  return {
    ...rendered,
    ...printed,
    layout_scale: enrichedSpec.layoutScale || null
  };
}

module.exports = {
  isTransportAvailable,
  renderLabelImageSpec,
  printImageFile,
  printImageFiles,
  composeBatchRowImage,
  renderSingleLabelImage,
  renderBatchRow,
  printRenderedBatchRows,
  renderAndPrintBatchRow,
  renderAndPrintLabel,
  BATCH_ROW_LAYOUT,
  resolveDriverPrintJobs
};
