"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const {
  buildArgoxCommandFromAgentItems,
  prepareRawBuffer,
  resolveArgoxLanguage,
  resolvePhysicalLanguage,
  resolveSafeTestMode,
  applySafeTestToItems,
  summarizeCommand,
  assertValidAgentLabelPrice
} = require(path.join(__dirname, "..", "modules", "pdv", "services", "argoxCommandBuilder"));
const {
  isTransportAvailable,
  listPrinterNames,
  printRawBuffer
} = require(path.join(__dirname, "lib", "winspoolRaw"));
const { resolvePrintTransport, isWindowsDriverTransport } = require(path.join(__dirname, "lib", "printTransport"));
const { buildFullLabelImageSpec } = require(path.join(__dirname, "lib", "fullLabelDriver"));
const { renderAndPrintLabel, renderBatchRow, printRenderedBatchRows } = require(path.join(__dirname, "lib", "windowsDriverPrint"));
const { buildBatchPrintPlan, resolveDriverColumns, resolveDriverPrintJobs, BATCH_ROW_LAYOUT } = require(path.join(__dirname, "lib", "batchRowPlan"));
const { FINAL_LABEL_LAYOUT } = require(path.join(__dirname, "lib", "labelGridSpec"));
const { resolveLabelHeaderText } = require(path.join(__dirname, "..", "modules", "pdv", "services", "argoxLabelStorePolicy"));
const { readEnvBooleanFromProcess, getEnvRaw } = require(path.join(__dirname, "..", "modules", "pdv", "services", "argoxEnvBoolean"));

const AGENT_PACKAGE = require("./package.json");

const PORT = Number(process.env.ARGOX_AGENT_PORT || 4000);
const PRINTER_NAME = String(process.env.ARGOX_PRINTER_NAME || "").trim();
const DEFAULT_LANGUAGE = resolvePhysicalLanguage({}, {});
const CONFIGURED_LANGUAGE = resolveArgoxLanguage({}, {});
const RAW_ENV_DRY_RUN = getEnvRaw("ARGOX_AGENT_DRY_RUN");
const RAW_ENV_SAFE_TEST_MODE = getEnvRaw("ARGOX_SAFE_TEST_MODE");
const RAW_ENV_DRIVER_COLUMNS = getEnvRaw("ARGOX_DRIVER_COLUMNS");
const DRY_RUN = readEnvBooleanFromProcess("ARGOX_AGENT_DRY_RUN", false);
const SAFE_TEST_MODE = resolveSafeTestMode({}, {});
const DRIVER_COLUMNS = resolveDriverColumns({});
const PRINT_TRANSPORT = resolvePrintTransport({});
const OUTPUT_DIR = path.join(__dirname, "output");
const ALLOWED_ORIGIN_HINTS = String(process.env.ARGOX_AGENT_ORIGINS || "localhost,127.0.0.1,aerostore")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

let lastDryRunFile = null;
let lastPrintLog = null;
let lastAgentError = null;

function readPackageVersion() {
  const candidates = [
    path.join(__dirname, "..", "package-version.txt"),
    path.join(__dirname, "package-version.txt")
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return String(fs.readFileSync(candidate, "utf8")).trim();
      }
    } catch (_) {
      // ignore read errors
    }
  }
  return String(process.env.ARGOX_PACKAGE_VERSION || "").trim();
}

const RAW_TRANSPORT = isTransportAvailable() ? "WINSPOOL_RAW" : "UNAVAILABLE";
const ACTIVE_TRANSPORT = isWindowsDriverTransport({ print_transport: PRINT_TRANSPORT })
  ? "WINDOWS_DRIVER"
  : RAW_TRANSPORT;

function logPrintEvent(event = {}) {
  const entry = {
    at: new Date().toISOString(),
    ...event
  };
  if (event.sucesso === false) {
    lastAgentError = String(event.erro || event.error || "erro desconhecido");
  }
  lastPrintLog = entry;
  console.log(`[ARGOX IMPRIMIR] ${JSON.stringify(entry)}`);
}

function responder(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function isAllowedOrigin(origin = "") {
  const normalized = String(origin || "").trim().toLowerCase();
  if (!normalized) return true;
  return ALLOWED_ORIGIN_HINTS.some((hint) => normalized.includes(hint));
}

function applyCors(req, res) {
  const origin = req.headers.origin || "";
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function listPrintersSafe() {
  return listPrinterNames();
}

function findPrinterName() {
  if (DRY_RUN) return "SIMULADO (sem impressora)";
  if (PRINTER_NAME) return PRINTER_NAME;
  try {
    const match = listPrinterNames().find((name) => {
      const normalized = String(name || "").toLowerCase();
      return normalized.includes("argox")
        || normalized.includes("os-214")
        || normalized.includes("generic / text");
    });
    return match || null;
  } catch {
    return null;
  }
}

function resolvePrintLanguage(items = []) {
  const first = Array.isArray(items) ? items[0] : items;
  return resolvePhysicalLanguage({}, first || {});
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Payload excede 1MB."));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON invalido."));
      }
    });
    req.on("error", reject);
  });
}

function validateAgentItems(items = []) {
  const list = Array.isArray(items) ? items : [items];
  if (!list.length) {
    throw new Error("Nenhuma etiqueta enviada.");
  }
  assertValidAgentLabelPrice(list[0] || {});
  return list;
}

function savePrintOutput(command = "", language = "PPLB", prefix = "print") {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ext = String(language || "PPLB").toLowerCase();
  const filename = `${prefix}-${ext}-${Date.now()}.prn`;
  const filePath = path.join(OUTPUT_DIR, filename);
  const { buffer } = prepareRawBuffer(command, language);
  fs.writeFileSync(filePath, buffer);
  const summary = summarizeCommand(command);
  return {
    filename,
    file_path: filePath,
    bytes: buffer.length,
    language,
    command_summary: summary
  };
}

function saveDryRunOutput(command = "", language = "PPLB") {
  const saved = savePrintOutput(command, language, "dry-run");
  lastDryRunFile = saved;
  return {
    jobId: `DRY_${Date.now()}`,
    ...saved
  };
}

function assertSafeTestCopies(command = "") {
  if (!SAFE_TEST_MODE) return;
  const matches = String(command || "").match(/\bP(\d+)\b/g) || [];
  matches.forEach((token) => {
    const copies = Number(token.slice(1));
    if (Number.isFinite(copies) && copies > 1) {
      throw new Error(`ARGOX_SAFE_TEST_MODE bloqueia ${token}. Use P1.`);
    }
  });
}

function printRaw(command = "", printerName = "", language = "PPLB") {
  assertSafeTestCopies(command);
  const { buffer, language: resolvedLanguage } = prepareRawBuffer(command, language);
  if (DRY_RUN) {
    return Promise.resolve({
      jobId: `DRY_${Date.now()}`,
      metodo: "DRY_RUN_FILE",
      language: resolvedLanguage,
      bytes: buffer.length
    });
  }
  if (!isTransportAvailable()) {
    return Promise.reject(new Error("Transporte WINSPOOL_RAW disponivel apenas no Windows."));
  }
  try {
    const result = printRawBuffer(printerName, buffer);
    return Promise.resolve({
      jobId: result.jobId,
      metodo: result.metodo || RAW_TRANSPORT,
      language: resolvedLanguage,
      bytes: result.bytes || buffer.length
    });
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error || "Falha na impressao.")));
  }
}

function buildAgentLabelTrace(items = []) {
  const first = Array.isArray(items) ? (items[0] || {}) : (items || {});
  const storeId = String(first.loja || first.store_id || "").trim();
  return {
    store_id: storeId,
    loja: storeId,
    agent_payload_marca: String(first.marca || "").trim(),
    label_header: resolveLabelHeaderText(storeId)
  };
}

function buildDriverPrintContext(items = [], agentConfig = {}) {
  const built = buildFullLabelImageSpec({
    items,
    config: {
      ...agentConfig,
      label_grid: "1x1",
      print_cell: "top-left",
      label_columns: 1,
      allow_multi_cell_grid: false,
      debug_border: agentConfig.debug_border === true
    }
  });
  return {
    context: built.context,
    previewElements: built.previewElements,
    imageSpec: built.imageSpec,
    quantity_received: built.quantity_received,
    quantity_final: built.quantity_final,
    safe_test_mode: built.safe_test_mode
  };
}

function printViaWindowsDriver(items = [], printerName = "", agentConfig = {}) {
  const safe = applySafeTestToItems(items, agentConfig);
  const itemsToPrint = safe.items;
  if (!itemsToPrint.length) {
    throw new Error("Nenhuma etiqueta enviada.");
  }

  const driverColumns = resolveDriverColumns(agentConfig);
  const batchPlan = buildBatchPrintPlan(itemsToPrint, driverColumns);
  const results = [];

  if (driverColumns <= 1) {
    for (let index = 0; index < itemsToPrint.length; index += 1) {
      const item = itemsToPrint[index];
      const driverContext = buildDriverPrintContext([item], agentConfig);
      const result = renderAndPrintLabel(printerName, driverContext.imageSpec, {
        outputDir: OUTPUT_DIR,
        prefix: DRY_RUN ? `dry-run-driver-${index + 1}` : `print-driver-${index + 1}`,
        saveOnly: DRY_RUN,
        copies: 1,
        forceSingleCopy: true,
        debug_border: false,
        driver_columns: driverColumns
      });
      results.push(result);
    }
  } else {
    const rowResults = batchPlan.rows.map((rowItems, rowIndex) => {
      const leftItem = rowItems[0] || null;
      const rightItem = rowItems[1] || null;
      const leftContext = leftItem ? buildDriverPrintContext([leftItem], agentConfig) : null;
      const rightContext = rightItem ? buildDriverPrintContext([rightItem], agentConfig) : null;
      return renderBatchRow(
        leftContext?.imageSpec || null,
        rightContext?.imageSpec || null,
        {
          outputDir: OUTPUT_DIR,
          prefix: DRY_RUN ? `batch-row-dry-${rowIndex + 1}` : `batch-row-${rowIndex + 1}`,
          driver_columns: driverColumns
        }
      );
    });

    const printOutcome = printRenderedBatchRows(printerName, rowResults, {
      saveOnly: DRY_RUN,
      driver_columns: driverColumns
    });
    results.push({
      ...printOutcome,
      imagem: rowResults[rowResults.length - 1]?.imagem || "",
      imagem_path: rowResults[rowResults.length - 1]?.imagem_path || "",
      width_px: BATCH_ROW_LAYOUT.ROW_WIDTH_PX,
      height_px: BATCH_ROW_LAYOUT.ROW_HEIGHT_PX,
      batch_rows_rendered: rowResults
    });
  }

  const lastResult = results[results.length - 1] || {};
  const renderedRows = lastResult.batch_rows_rendered || results;
  const batchRows = (driverColumns <= 1 ? results : renderedRows).map((row, index) => ({
    row_index: index + 1,
    imagem: row.imagem || path.basename(row.imagem_path || ""),
    imagem_path: row.imagem_path || null,
    left_cell_path: row.left_cell_path || null,
    right_cell_path: row.right_cell_path || null,
    width_px: row.width_px,
    height_px: row.height_px,
    left_used: row.left_used,
    right_used: row.right_used
  }));
  const printJobs = driverColumns <= 1
    ? results.length
    : (lastResult.print_jobs || resolveDriverPrintJobs(batchPlan.total_rows, driverColumns, { multipage: true }));
  const pagesPrinted = driverColumns <= 1
    ? results.length
    : (lastResult.pages_printed || batchPlan.total_rows);
  const batchMeta = {
    total_labels: batchPlan.total_labels,
    driver_columns: batchPlan.driver_columns,
    labels_per_row: batchPlan.labels_per_row,
    total_rows: batchPlan.total_rows,
    batch_rows_count: batchRows.length,
    print_jobs: printJobs,
    pages_printed: pagesPrinted,
    multipage_used: Boolean(lastResult.multipage_used),
    multipage_fallback: Boolean(lastResult.multipage_fallback),
    multipage_error: lastResult.multipage_error || "",
    layout_mode: batchPlan.layout_mode,
    row_width_px: driverColumns >= 2 ? BATCH_ROW_LAYOUT.ROW_WIDTH_PX : BATCH_ROW_LAYOUT.CELL_WIDTH_PX,
    row_height_px: BATCH_ROW_LAYOUT.ROW_HEIGHT_PX
  };

  if (lastResult.multipage_fallback) {
    console.error(`[ARGOX IMPRIMIR] Multipage falhou, fallback 1 job por row: ${lastResult.multipage_error || "erro desconhecido"}`);
  }

  return Promise.resolve({
    jobId: lastResult.jobId,
    metodo: lastResult.metodo,
    bytes: lastResult.bytes,
    copies: 1,
    pages_printed: pagesPrinted,
    quantidade_recebida: safe.received,
    quantidade_final: safe.final,
    quantity_received: safe.received,
    quantity_final: safe.final,
    safe_test_mode: safe.safeTestMode,
    imagem: lastResult.imagem || path.basename(lastResult.imagem_path || ""),
    imagem_path: lastResult.imagem_path || lastResult.file_path,
    width_px: lastResult.width_px,
    height_px: lastResult.height_px,
    grid: FINAL_LABEL_LAYOUT.GRID,
    layout_mode: batchMeta.layout_mode,
    top_block_offset_px: FINAL_LABEL_LAYOUT.TOP_BLOCK_OFFSET_PX,
    preview_elements: results.length,
    labels_printed: safe.final,
    print_quantity_mode: items[0]?.print_quantity_mode || "",
    batch_rows: batchRows,
    batch_rows_count: batchRows.length,
    multipage_used: batchMeta.multipage_used,
    multipage_fallback: batchMeta.multipage_fallback,
    multipage_error: batchMeta.multipage_error,
    ...batchMeta,
    ...buildAgentLabelTrace(items)
  });
}

async function dispatchAgentPrint(items = [], printerName = "", agentConfig = {}) {
  if (isWindowsDriverTransport({ print_transport: PRINT_TRANSPORT })) {
    return printViaWindowsDriver(items, printerName, agentConfig);
  }

  const columns = Number(items[0]?.colunas || items[0]?.columns || 2);
  const built = buildArgoxCommandFromAgentItems(items, { config: agentConfig, columns });
  const language = built.language || DEFAULT_LANGUAGE;
  const commandSummary = built.command_summary || summarizeCommand(built.command);
  const savedOutput = savePrintOutput(built.command, language, DRY_RUN ? "dry-run" : "print");
  if (DRY_RUN) {
    lastDryRunFile = savedOutput;
  }
  const result = await printRaw(built.command, printerName, language);
  return {
    ...built,
    ...result,
    language,
    commandSummary,
    savedOutput
  };
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/status") {
    const printerName = findPrinterName();
    const language = DEFAULT_LANGUAGE;
    return responder(res, 200, {
      status: "online",
      versao: AGENT_PACKAGE.version,
      agent_version: AGENT_PACKAGE.version,
      package_version: readPackageVersion(),
      impressora: printerName,
      printer_name: printerName,
      conectada: Boolean(printerName),
      dry_run: DRY_RUN,
      raw_env_dry_run: RAW_ENV_DRY_RUN,
      simulado: DRY_RUN,
      safe_test_mode: SAFE_TEST_MODE,
      raw_env_safe_test_mode: RAW_ENV_SAFE_TEST_MODE,
      driver_columns: DRIVER_COLUMNS,
      raw_env_driver_columns: RAW_ENV_DRIVER_COLUMNS,
      plataforma: os.platform(),
      hostname: os.hostname(),
      linguagem: DEFAULT_LANGUAGE,
      language: DEFAULT_LANGUAGE,
      linguagem_configurada: CONFIGURED_LANGUAGE,
      linguagem_fisica: DEFAULT_LANGUAGE,
      print_transport: PRINT_TRANSPORT,
      transporte: ACTIVE_TRANSPORT,
      ultimo_arquivo: lastDryRunFile,
      ultimo_log: lastPrintLog,
      last_error: lastAgentError
    });
  }

  if (req.method === "POST" && req.url === "/imprimir") {
    const printerName = findPrinterName();
    let language = DEFAULT_LANGUAGE;
    try {
      const payload = await readJsonBody(req);
      const items = validateAgentItems(payload);
      language = resolvePrintLanguage(items);

      if (!printerName) {
        logPrintEvent({
          sucesso: false,
          impressora: null,
          linguagem: language,
          metodo: DRY_RUN ? "DRY_RUN_FILE" : ACTIVE_TRANSPORT,
          erro: "Impressora Argox nao encontrada"
        });
        return responder(res, 500, {
          erro: "Impressora Argox nao encontrada",
          solucao: DRY_RUN
            ? "Modo simulado deveria estar ativo. Verifique ARGOX_AGENT_DRY_RUN=true."
            : "Instale o driver Argox, configure ARGOX_PRINTER_NAME ou use ARGOX_AGENT_DRY_RUN=true.",
          impressoras: listPrintersSafe(),
          linguagem: language
        });
      }

      const columns = Number(items[0]?.colunas || items[0]?.columns || 2);
      const agentConfig = {
        label_columns: columns,
        driver_columns: DRIVER_COLUMNS,
        safe_test_mode: SAFE_TEST_MODE,
        print_transport: PRINT_TRANSPORT
      };
      const printResult = await dispatchAgentPrint(items, printerName, agentConfig);
      const usingDriver = isWindowsDriverTransport({ print_transport: PRINT_TRANSPORT });
      const labelTrace = buildAgentLabelTrace(items);

      if (usingDriver) {
        if (DRY_RUN) {
          lastDryRunFile = {
            filename: printResult.imagem,
            file_path: printResult.imagem_path,
            bytes: printResult.bytes,
            language: "BITMAP",
            metodo: printResult.metodo
          };
        }
        logPrintEvent({
          sucesso: true,
          impressora: printerName,
          linguagem: "BITMAP",
          print_transport: PRINT_TRANSPORT,
          quantidade_recebida: printResult.quantidade_recebida,
          quantidade_final: printResult.quantidade_final,
          safe_test_mode: printResult.safe_test_mode,
          copies: printResult.copies || 1,
          pages_printed: printResult.pages_printed || 1,
          total_labels: printResult.total_labels,
          driver_columns: printResult.driver_columns,
          labels_per_row: printResult.labels_per_row,
          total_rows: printResult.total_rows,
          batch_rows_count: printResult.batch_rows_count,
          print_jobs: printResult.print_jobs,
          multipage_used: printResult.multipage_used,
          multipage_fallback: printResult.multipage_fallback,
          multipage_error: printResult.multipage_error || undefined,
          width_px: printResult.width_px,
          height_px: printResult.height_px,
          grid: printResult.grid || FINAL_LABEL_LAYOUT.GRID,
          layout_mode: printResult.layout_mode || "single",
          top_block_offset_px: printResult.top_block_offset_px || FINAL_LABEL_LAYOUT.TOP_BLOCK_OFFSET_PX,
          bytes: printResult.bytes,
          metodo: printResult.metodo,
          dry_run: DRY_RUN,
          etiquetas_recebidas: items.length,
          etiquetas_enviadas: printResult.quantidade_final,
          job_id: printResult.jobId,
          imagem: printResult.imagem,
          imagem_path: printResult.imagem_path,
          preview_elements: printResult.preview_elements,
          batch_rows: printResult.batch_rows || [],
          ...labelTrace
        });

        return responder(res, 200, {
          sucesso: true,
          dry_run: DRY_RUN,
          simulado: DRY_RUN,
          etiquetas: items.length,
          quantidade_recebida: printResult.quantidade_recebida,
          quantidade_final: printResult.quantidade_final,
          safe_test_mode: printResult.safe_test_mode,
          copies: printResult.copies || 1,
          pages_printed: printResult.pages_printed || 1,
          total_labels: printResult.total_labels,
          driver_columns: printResult.driver_columns,
          labels_per_row: printResult.labels_per_row,
          total_rows: printResult.total_rows,
          batch_rows_count: printResult.batch_rows_count,
          print_jobs: printResult.print_jobs,
          multipage_used: printResult.multipage_used,
          multipage_fallback: printResult.multipage_fallback,
          multipage_error: printResult.multipage_error || undefined,
          width_px: printResult.width_px,
          height_px: printResult.height_px,
          grid: printResult.grid || FINAL_LABEL_LAYOUT.GRID,
          layout_mode: printResult.layout_mode || "single",
          top_block_offset_px: printResult.top_block_offset_px || FINAL_LABEL_LAYOUT.TOP_BLOCK_OFFSET_PX,
          job_id: printResult.jobId,
          label_debug: labelTrace,
          batch_rows: printResult.batch_rows || [],
          impressora: printerName,
          linguagem: "BITMAP",
          language: "BITMAP",
          print_transport: PRINT_TRANSPORT,
          bytes: printResult.bytes,
          metodo: printResult.metodo,
          imagem: printResult.imagem || null,
          imagem_path: printResult.imagem_path || null,
          mensagem: DRY_RUN
            ? "Simulacao OK (WINDOWS_DRIVER). Imagem salva localmente."
            : "Etiqueta enviada via driver Windows (bitmap)."
        });
      }

      language = printResult.language || language;
      const commandSummary = printResult.commandSummary || summarizeCommand(printResult.command);
      const savedOutput = printResult.savedOutput;

      logPrintEvent({
        sucesso: true,
        impressora: printerName,
        linguagem: language,
        print_transport: PRINT_TRANSPORT,
        quantidade_recebida: printResult.quantity_received,
        quantidade_final: printResult.quantity_final,
        safe_test_mode: printResult.safe_test_mode,
        bytes: printResult.bytes,
        metodo: printResult.metodo,
        dry_run: DRY_RUN,
        etiquetas_recebidas: items.length,
        etiquetas_enviadas: printResult.quantity_final,
        job_id: printResult.jobId,
        arquivo: savedOutput.filename,
        arquivo_path: savedOutput.file_path,
        command_first_lines: commandSummary.first_lines,
        command_last_lines: commandSummary.last_lines,
        command_validation: printResult.command_validation || null
      });

      return responder(res, 200, {
        sucesso: true,
        dry_run: DRY_RUN,
        simulado: DRY_RUN,
        etiquetas: items.length,
        quantidade_recebida: printResult.quantity_received,
        quantidade_final: printResult.quantity_final,
        safe_test_mode: printResult.safe_test_mode,
        job_id: printResult.jobId,
        impressora: printerName,
        linguagem: language,
        language,
        print_transport: PRINT_TRANSPORT,
        bytes: printResult.bytes,
        metodo: printResult.metodo,
        arquivo: savedOutput.filename || null,
        arquivo_path: savedOutput.file_path || null,
        command_first_lines: commandSummary.first_lines,
        command_last_lines: commandSummary.last_lines,
        command_validation: printResult.command_validation || null,
        mensagem: DRY_RUN
          ? `Simulacao OK (${language}). Arquivo salvo localmente.`
          : `Etiqueta ${language} enviada ao spooler Windows via RAW.`
      });
    } catch (error) {
      logPrintEvent({
        sucesso: false,
        impressora: printerName || null,
        linguagem: language,
        metodo: DRY_RUN ? "DRY_RUN_FILE" : "WINSPOOL_RAW",
        erro: error.message || "Falha na impressao"
      });
      const statusCode = error.example ? 400 : 500;
      return responder(res, statusCode, {
        erro: error.message || "Falha na impressao",
        exemplo: error.example || undefined,
        linguagem: language
      });
    }
  }

  if (req.method === "POST" && req.url === "/imprimir-raw") {
    const printerName = findPrinterName();
    let language = DEFAULT_LANGUAGE;
    try {
      const payload = await readJsonBody(req);
      const command = String(payload.command || payload.raw || "");
      language = resolveArgoxLanguage({}, payload);
      if (!command.trim()) {
        return responder(res, 400, { erro: "Campo command obrigatorio." });
      }
      if (!printerName) {
        return responder(res, 500, { erro: "Impressora Argox nao encontrada." });
      }
      const result = await printRaw(command, printerName, language);
      logPrintEvent({
        sucesso: true,
        impressora: printerName,
        linguagem: language,
        bytes: result.bytes,
        metodo: result.metodo,
        dry_run: DRY_RUN,
        job_id: result.jobId
      });
      return responder(res, 200, {
        sucesso: true,
        dry_run: DRY_RUN,
        job_id: result.jobId,
        impressora: printerName,
        linguagem: language,
        bytes: result.bytes,
        metodo: result.metodo,
        arquivo: result.filename || null,
        arquivo_path: result.file_path || null
      });
    } catch (error) {
      logPrintEvent({
        sucesso: false,
        impressora: printerName || null,
        linguagem: language,
        metodo: DRY_RUN ? "DRY_RUN_FILE" : "WINSPOOL_RAW",
        erro: error.message || "Falha na impressao RAW"
      });
      return responder(res, 500, { erro: error.message || "Falha na impressao RAW." });
    }
  }

  return responder(res, 404, { erro: "Rota nao encontrada" });
});

server.listen(PORT, () => {
  const printerName = findPrinterName();
  console.log("");
  console.log("Agente Argox AEROSTORE v2.2 (RAW + WINDOWS_DRIVER)");
  console.log(`Porta: ${PORT}`);
  console.log(`Transporte: ${ACTIVE_TRANSPORT}`);
  console.log(`Print transport: ${PRINT_TRANSPORT}`);
  console.log(`Driver columns: ${DRIVER_COLUMNS}`);
  console.log(`Linguagem padrao (fisica): ${DEFAULT_LANGUAGE}`);
  if (CONFIGURED_LANGUAGE !== DEFAULT_LANGUAGE) {
    console.log(`Linguagem configurada: ${CONFIGURED_LANGUAGE}`);
  }
  console.log(`Modo: ${DRY_RUN ? "SIMULADO (sem impressora)" : "IMPRESSAO REAL"}`);
  console.log(`Safe test mode: ${SAFE_TEST_MODE ? "ATIVO (max 1 copia)" : "inativo"}`);
  console.log("Status: GET /status");
  console.log("Imprimir: POST /imprimir");
  if (DRY_RUN) {
    console.log(`Saida simulada: ${OUTPUT_DIR}`);
  }
  console.log(`Impressora: ${printerName || "NAO ENCONTRADA"}`);
  if (!printerName && !DRY_RUN) {
    listPrintersSafe().forEach((name) => console.log(`  - ${name}`));
    if (!listPrintersSafe().length) {
      console.log("  Dica: em casa use ARGOX_AGENT_DRY_RUN=true");
    }
  }
});
