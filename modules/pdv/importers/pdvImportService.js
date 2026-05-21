"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");
const { get, all } = require("../../../db");
const { getPdvImportTypeConfig, PDV_IMPORT_TYPES } = require("../utils/pdvImportConfig");

const pdvImportPreviews = new Map();
const pdvDataDir = path.join(process.cwd(), "data", "imports", "pdv");
const pdvIncomingDir = path.join(pdvDataDir, "incoming");
const pdvProcessedDir = path.join(pdvDataDir, "processed");
const pdvErrorsDir = path.join(pdvDataDir, "errors");
const pdvLogsDir = path.join(pdvDataDir, "logs");
const pdvBatchesDir = path.join(pdvDataDir, "batches");
const pdvBackupsDir = path.join(pdvDataDir, "backups");
const pdvDatasetsDir = path.join(pdvDataDir, "datasets");
const pdvHistoryPath = path.join(pdvDataDir, "import-history.json");

const COMMIT_STATUS = {
  UPLOADED: "UPLOADED",
  VALIDATED: "VALIDATED",
  CONFIRMED: "CONFIRMED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED"
};

function ensurePdvImportDirs() {
  [
    pdvDataDir,
    pdvIncomingDir,
    pdvProcessedDir,
    pdvErrorsDir,
    pdvLogsDir,
    pdvBatchesDir,
    pdvBackupsDir,
    pdvDatasetsDir
  ].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  if (!fs.existsSync(pdvHistoryPath)) {
    fs.writeFileSync(pdvHistoryPath, "[]", "utf8");
  }
}

function sanitizeFilename(name = "") {
  return String(name || "")
    .replace(/[^\p{L}\p{N}._() -]+/gu, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeader(value = "") {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[()]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toLowerCase()
    .trim();
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeLookupText(value = "") {
  return normalizeHeader(value).replace(/_/g, "");
}

function normalizeDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhone(value = "") {
  let digits = normalizeDigits(value);
  if (digits.startsWith("55") && digits.length > 11) {
    digits = digits.slice(2);
  }
  return digits;
}

function normalizeDocument(value = "") {
  return normalizeDigits(value);
}

function parsePtBrNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const raw = String(value).trim();
  if (!raw) {
    return 0;
  }
  const normalized = raw
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(/,(?=\d{1,2}(\D|$)|$)/g, ".")
    .replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePtBrDate(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y) {
      const month = String(parsed.m || 1).padStart(2, "0");
      const day = String(parsed.d || 1).padStart(2, "0");
      return `${parsed.y}-${month}-${day}`;
    }
  }
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const slashMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashMatch) {
    const day = slashMatch[1].padStart(2, "0");
    const month = slashMatch[2].padStart(2, "0");
    const year = slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3];
    return `${year}-${month}-${day}`;
  }
  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) {
    return iso.toISOString().slice(0, 10);
  }
  return raw;
}

function splitCsvLine(line, delimiter) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current);
  return result.map((item) => item.trim());
}

function readSpreadsheetRows(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".csv") {
    const buffer = fs.readFileSync(filePath);
    const csvText = buffer.toString("latin1").replace(/^\uFEFF/, "");
    const lines = csvText.split(/\r?\n/).filter((line) => line.trim() !== "");
    const firstLine = lines[0] || "";
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    const delimiter = semicolonCount >= commaCount ? ";" : ",";
    return {
      sourceType: "csv",
      delimiter,
      sheetName: "CSV",
      rows: lines.map((line) => splitCsvLine(line, delimiter))
    };
  }
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: ""
  });
  return {
    sourceType: "spreadsheet",
    delimiter: "",
    sheetName,
    rows
  };
}

function detectColumnIndexes(headerRow, aliases = {}) {
  const originalHeaders = (headerRow || []).map((value) => String(value ?? ""));
  const normalizedHeaders = originalHeaders.map(normalizeHeader);
  const normalizedLookup = originalHeaders.map(normalizeLookupText);
  const indexes = {};

  Object.entries(aliases).forEach(([field, fieldAliases]) => {
    const accepted = Array.from(new Set(
      [field, ...(fieldAliases || [])]
        .map((item) => normalizeHeader(item))
        .filter(Boolean)
    ));
    const acceptedLookup = accepted.map((item) => item.replace(/_/g, ""));
    let index = normalizedHeaders.findIndex((header) => accepted.includes(header));
    if (index < 0) {
      index = normalizedLookup.findIndex((header) => acceptedLookup.includes(header));
    }
    indexes[field] = index >= 0 ? index : null;
  });

  return {
    originalHeaders,
    normalizedHeaders,
    indexes
  };
}

function getCell(row, index) {
  if (index === null || index === undefined || index < 0) {
    return "";
  }
  return row[index] ?? "";
}

function buildPreviewKey(type, record) {
  switch (type) {
    case "produtos":
      return normalizeText(record.sku || record.codigo || `${record.nome}|${record.marca}|${record.cor}|${record.tamanho}`);
    case "clientes":
      return normalizePhone(record.telefone);
    case "vendas":
      return normalizeText(`${record.data_venda}|${normalizePhone(record.telefone)}|${record.valor_total}|${record.vendedor}|${record.loja}`);
    case "curva-abc":
      return normalizeText(`${normalizePhone(record.telefone)}|${record.classe_abc}|${record.total_comprado}|${record.ticket_medio}`);
    case "cashback":
      return normalizeText(`${normalizePhone(record.telefone)}|${record.saldo_cashback}`);
    default:
      return crypto.createHash("sha1").update(JSON.stringify(record)).digest("hex");
  }
}

function getDatasetPath(type) {
  return path.join(pdvDatasetsDir, `${type}.json`);
}

function loadDataset(type) {
  ensurePdvImportDirs();
  const filePath = getDatasetPath(type);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return [];
  }
}

function saveDataset(type, rows) {
  ensurePdvImportDirs();
  fs.writeFileSync(getDatasetPath(type), JSON.stringify(rows, null, 2), "utf8");
}

function loadImportHistory() {
  ensurePdvImportDirs();
  try {
    return JSON.parse(fs.readFileSync(pdvHistoryPath, "utf8"));
  } catch (error) {
    return [];
  }
}

function saveImportHistory(items) {
  ensurePdvImportDirs();
  fs.writeFileSync(pdvHistoryPath, JSON.stringify(items, null, 2), "utf8");
}

function appendImportHistory(entry) {
  const history = loadImportHistory();
  history.unshift(entry);
  saveImportHistory(history);
}

async function findStrategicHints(record) {
  const phone = normalizePhone(record.telefone || record.phone || "");
  const document = normalizeDocument(record.cpf || record.document || "");
  const name = normalizeText(record.nome || record.cliente || "");
  const hints = {
    crmContactId: null,
    crmContactName: "",
    aerointelCustomerKey: "",
    aerointelCustomerName: ""
  };

  try {
    if (phone) {
      const crmContact = await get(
        `SELECT id, name FROM crm_contacts WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(mobile, '+', ''), '(', ''), ')', ''), '-', ''), ' ', '') = ? LIMIT 1`,
        [phone]
      );
      if (crmContact) {
        hints.crmContactId = Number(crmContact.id || 0);
        hints.crmContactName = crmContact.name || "";
      }
    }
    if (document) {
      const aerointel = await get(
        `SELECT customer_key, customer_name FROM commercial_customer_profile WHERE REPLACE(REPLACE(REPLACE(customer_document, '.', ''), '-', ''), '/', '') = ? LIMIT 1`,
        [document]
      );
      if (aerointel) {
        hints.aerointelCustomerKey = aerointel.customer_key || "";
        hints.aerointelCustomerName = aerointel.customer_name || "";
      }
    } else if (name) {
      const normalizedName = normalizeLookupText(name);
      const rows = await all(
        `SELECT customer_key, customer_name FROM commercial_customer_profile LIMIT 5000`
      );
      const match = rows.find((item) => normalizeLookupText(item.customer_name || "") === normalizedName);
      if (match) {
        hints.aerointelCustomerKey = match.customer_key || "";
        hints.aerointelCustomerName = match.customer_name || "";
      }
    }
  } catch (error) {
    return hints;
  }

  return hints;
}

function buildBaseSummary(typeConfig) {
  return {
    importType: typeConfig.key,
    importLabel: typeConfig.label,
    filesProcessed: 0,
    totalRows: 0,
    validRows: 0,
    invalidRows: 0,
    duplicateRows: 0,
    warningRows: 0,
    recognizedHeaders: {},
    files: [],
    errors: [],
    alerts: []
  };
}

async function normalizeRecordByType(type, row, indexes, source) {
  const record = {
    source_row: source.sourceRow,
    source_file: source.sourceFile
  };

  if (type === "produtos") {
    record.codigo = normalizeText(getCell(row, indexes.codigo));
    record.sku = normalizeText(getCell(row, indexes.sku)) || record.codigo;
    record.nome = normalizeText(getCell(row, indexes.nome));
    record.descricao = normalizeText(getCell(row, indexes.descricao));
    record.marca = normalizeText(getCell(row, indexes.marca));
    record.categoria = normalizeText(getCell(row, indexes.categoria));
    record.tipo = normalizeText(getCell(row, indexes.tipo));
    record.cor = normalizeText(getCell(row, indexes.cor));
    record.tamanho = normalizeText(getCell(row, indexes.tamanho));
    record.preco_venda = parsePtBrNumber(getCell(row, indexes.preco_venda));
    record.preco_custo = parsePtBrNumber(getCell(row, indexes.preco_custo));
    record.estoque = parsePtBrNumber(getCell(row, indexes.estoque));
    record.status = normalizeText(getCell(row, indexes.status));
    record.sku_or_codigo = record.sku || record.codigo;
    return record;
  }

  if (type === "clientes") {
    record.nome = normalizeText(getCell(row, indexes.nome));
    record.telefone = normalizePhone(getCell(row, indexes.telefone));
    record.cpf = normalizeDocument(getCell(row, indexes.cpf));
    record.email = normalizeText(getCell(row, indexes.email)).toLowerCase();
    record.data_nascimento = parsePtBrDate(getCell(row, indexes.data_nascimento));
    record.cidade = normalizeText(getCell(row, indexes.cidade));
    record.loja_origem = normalizeText(getCell(row, indexes.loja_origem));
    return record;
  }

  if (type === "vendas") {
    record.data_venda = parsePtBrDate(getCell(row, indexes.data_venda));
    record.cliente = normalizeText(getCell(row, indexes.cliente));
    record.telefone = normalizePhone(getCell(row, indexes.telefone));
    record.vendedor = normalizeText(getCell(row, indexes.vendedor));
    record.loja = normalizeText(getCell(row, indexes.loja));
    record.valor_total = parsePtBrNumber(getCell(row, indexes.valor_total));
    record.forma_pagamento = normalizeText(getCell(row, indexes.forma_pagamento));
    record.produtos = normalizeText(getCell(row, indexes.produtos));
    record.observacao = normalizeText(getCell(row, indexes.observacao));
    return record;
  }

  if (type === "curva-abc") {
    record.cliente = normalizeText(getCell(row, indexes.cliente));
    record.telefone = normalizePhone(getCell(row, indexes.telefone));
    record.classe_abc = normalizeText(getCell(row, indexes.classe_abc)).toUpperCase();
    record.total_comprado = parsePtBrNumber(getCell(row, indexes.total_comprado));
    record.quantidade_compras = parsePtBrNumber(getCell(row, indexes.quantidade_compras));
    record.ticket_medio = parsePtBrNumber(getCell(row, indexes.ticket_medio));
    record.ultima_compra = parsePtBrDate(getCell(row, indexes.ultima_compra));
    return record;
  }

  if (type === "cashback") {
    record.cliente = normalizeText(getCell(row, indexes.cliente));
    record.telefone = normalizePhone(getCell(row, indexes.telefone));
    record.saldo_cashback = parsePtBrNumber(getCell(row, indexes.saldo_cashback));
    record.validade = parsePtBrDate(getCell(row, indexes.validade));
    record.origem = normalizeText(getCell(row, indexes.origem)) || "CRM_BONUS";
    record.tipo = "MIGRACAO";
    record.observacao = "Saldo inicial migrado do CRM Bônus";
    return record;
  }

  return record;
}

function validateRecord(typeConfig, record) {
  const errors = [];
  const warnings = [];
  const requiredFields = typeConfig.requiredFields || [];

  requiredFields.forEach((field) => {
    const value = record[field];
    const empty = value === null || value === undefined || value === "" || value === 0 && !["preco_venda", "valor_total", "saldo_cashback", "quantidade_compras", "ticket_medio", "total_comprado"].includes(field);
    if (empty) {
      errors.push(`Campo obrigatório ausente: ${field}`);
    }
  });

  if (typeConfig.key === "produtos") {
    if (record.preco_venda <= 0) {
      errors.push("Preço de venda precisa ser maior que zero.");
    }
    if (!record.sku_or_codigo) {
      errors.push("Produto sem SKU ou código confiável.");
    }
    if (!record.status) {
      warnings.push("Status não informado; será tratado como ativo na base operacional do PDV.");
    }
  }

  if (typeConfig.key === "clientes") {
    if (!record.telefone) {
      errors.push("Telefone normalizado é obrigatório para a chave anti-duplicidade.");
    }
  }

  if (typeConfig.key === "vendas") {
    if (record.valor_total <= 0) {
      errors.push("Valor total precisa ser maior que zero.");
    }
    if (!record.data_venda) {
      errors.push("Data da venda inválida.");
    }
  }

  if (typeConfig.key === "curva-abc") {
    if (!["A", "B", "C"].includes(record.classe_abc)) {
      errors.push("Classe ABC inválida. Use A, B ou C.");
    }
    if (!record.telefone) {
      warnings.push("Telefone ausente; o vínculo futuro com cliente existente pode ficar parcial.");
    }
  }

  if (typeConfig.key === "cashback") {
    if (!record.telefone) {
      errors.push("Cashback sem telefone confiável não pode ser importado.");
    }
    if (record.saldo_cashback < 0) {
      errors.push("Saldo de cashback não pode ser negativo.");
    }
  }

  return { errors, warnings };
}

function mergeRecord(existing, incoming) {
  const output = { ...(existing || {}) };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    const current = output[key];
    const isCurrentEmpty = current === null || current === undefined || current === "" || current === 0;
    const isIncomingFilled = value !== null && value !== undefined && value !== "";
    if (isCurrentEmpty && isIncomingFilled) {
      output[key] = value;
      return;
    }
    if (typeof value === "number" && value > 0 && Number(current || 0) !== value) {
      output[key] = value;
      return;
    }
    if (typeof value === "string" && value && String(current || "").trim() !== value.trim() && String(current || "").trim().length < value.trim().length) {
      output[key] = value;
    }
  });
  return output;
}

function getExistingKey(type, row) {
  if (type === "produtos") {
    return normalizeText(row.sku_or_codigo || row.sku || row.codigo || "");
  }
  if (type === "clientes" || type === "vendas" || type === "curva-abc" || type === "cashback") {
    return normalizePhone(row.telefone || "");
  }
  return "";
}

function summarizeRecognizedHeaders(indexes) {
  const recognized = {};
  Object.entries(indexes || {}).forEach(([key, value]) => {
    recognized[key] = value !== null && value !== undefined && value >= 0;
  });
  return recognized;
}

async function parsePdvImportFile(type, file) {
  const typeConfig = getPdvImportTypeConfig(type);
  if (!typeConfig) {
    throw new Error("Tipo de importação do PDV não encontrado.");
  }

  const spreadsheet = readSpreadsheetRows(file.path);
  const rows = spreadsheet.rows || [];
  const headerRow = rows[0] || [];
  const dataRows = rows.slice(1);
  const detection = detectColumnIndexes(headerRow, typeConfig.aliases);
  const summary = buildBaseSummary(typeConfig);
  summary.filesProcessed = 1;
  summary.totalRows = dataRows.length;
  summary.files = [{
    filename: sanitizeFilename(file.originalname || file.filename || ""),
    rows: dataRows.length,
    sheetName: spreadsheet.sheetName || ""
  }];
  summary.recognizedHeaders = summarizeRecognizedHeaders(detection.indexes);

  const existingDataset = loadDataset(type);
  const existingKeys = new Set(existingDataset.map((item) => getExistingKey(type, item)).filter(Boolean));
  const seenPreviewKeys = new Set();
  const previewRows = [];
  const invalidRows = [];
  const alerts = [];
  const examples = [];
  const classBuckets = { A: [], B: [], C: [] };

  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index];
    const sourceRow = index + 2;
    const normalized = await normalizeRecordByType(type, row, detection.indexes, {
      sourceRow,
      sourceFile: sanitizeFilename(file.originalname || file.filename || "")
    });
    const strategicHints = await findStrategicHints(normalized);
    normalized.strategic_hints = strategicHints;
    const validation = validateRecord(typeConfig, normalized);
    const previewKey = buildPreviewKey(type, normalized);
    let action = "create";

    if (previewKey && seenPreviewKeys.has(previewKey)) {
      validation.warnings.push("Duplicidade detectada dentro do mesmo arquivo.");
      action = "skip_duplicate";
      summary.duplicateRows += 1;
    } else if (previewKey && existingKeys.has(getExistingKey(type, normalized) || previewKey)) {
      validation.warnings.push("Registro já existente na base do PDV; será tratado como atualização/enriquecimento.");
      action = "update";
      summary.duplicateRows += 1;
    }

    if (previewKey) {
      seenPreviewKeys.add(previewKey);
    }

    if (validation.errors.length) {
      summary.invalidRows += 1;
      invalidRows.push({
        source_row: sourceRow,
        data: normalized,
        errors: validation.errors,
        warnings: validation.warnings
      });
      continue;
    }

    summary.validRows += 1;
    if (validation.warnings.length) {
      summary.warningRows += 1;
    }

    if (type === "curva-abc" && classBuckets[normalized.classe_abc]) {
      classBuckets[normalized.classe_abc].push(normalized);
    }

    previewRows.push({
      ...normalized,
      action,
      errors: validation.errors,
      warnings: validation.warnings
    });

    if (examples.length < 10) {
      examples.push({
        source_row: sourceRow,
        ...normalized
      });
    }
  }

  if (type === "produtos") {
    summary.productsRecognized = previewRows.length;
    summary.productsWithSku = previewRows.filter((row) => row.sku_or_codigo).length;
  }
  if (type === "clientes") {
    summary.contactsWithPhone = previewRows.filter((row) => row.telefone).length;
    summary.contactsWithDocument = previewRows.filter((row) => row.cpf).length;
    summary.contactsWithEmail = previewRows.filter((row) => row.email).length;
  }
  if (type === "vendas") {
    summary.totalRevenue = Number(previewRows.reduce((sum, row) => sum + Number(row.valor_total || 0), 0).toFixed(2));
  }
  if (type === "curva-abc") {
    summary.classACount = classBuckets.A.length;
    summary.classBCount = classBuckets.B.length;
    summary.classCCount = classBuckets.C.length;
    summary.totalAbcValue = Number(previewRows.reduce((sum, row) => sum + Number(row.total_comprado || 0), 0).toFixed(2));
  }
  if (type === "cashback") {
    summary.totalCashbackBalance = Number(previewRows.reduce((sum, row) => sum + Number(row.saldo_cashback || 0), 0).toFixed(2));
  }

  if (invalidRows.length) {
    alerts.push(`${invalidRows.length} linha(s) com erro precisam de correção antes da confirmação.`);
  }
  if (summary.warningRows) {
    alerts.push(`${summary.warningRows} linha(s) possuem alertas ou enriquecimentos previstos.`);
  }

  return {
    type,
    typeConfig,
    sourceType: spreadsheet.sourceType,
    delimiter: spreadsheet.delimiter,
    worksheetName: spreadsheet.sheetName,
    headerAnalysis: detection,
    summary: {
      ...summary,
      alerts
    },
    previewRows,
    invalidRows,
    diagnostics: {
      headersOriginais: detection.originalHeaders,
      headersNormalizados: detection.normalizedHeaders,
      detectedIndexes: detection.indexes,
      exemplos: examples
    }
  };
}

function buildTopRows(rows, valueKey, limit = 20) {
  return [...rows]
    .sort((a, b) => Number(b[valueKey] || 0) - Number(a[valueKey] || 0))
    .slice(0, limit);
}

function buildHistoryEntry(type, fileName, parsed, userEmail = "") {
  const id = crypto.randomUUID();
  return {
    id,
    tipo_importacao: type,
    arquivo_nome: sanitizeFilename(fileName),
    total_linhas: Number(parsed.summary?.totalRows || 0),
    linhas_validas: Number(parsed.summary?.validRows || 0),
    linhas_com_erro: Number(parsed.summary?.invalidRows || 0),
    status: COMMIT_STATUS.VALIDATED,
    criado_em: new Date().toISOString(),
    confirmado_em: "",
    usuario_responsavel: userEmail,
    resumo_json: parsed.summary || {},
    source_type: parsed.sourceType || "",
    worksheet_name: parsed.worksheetName || "",
    rollback_available: false,
    backup_path: "",
    preview_id: ""
  };
}

async function createPdvImportPreview(type, file, user = {}) {
  ensurePdvImportDirs();
  const parsed = await parsePdvImportFile(type, file);
  const previewId = crypto.randomUUID();
  const historyEntry = buildHistoryEntry(type, file.originalname || file.filename || "", parsed, user?.email || user?.name || "");
  historyEntry.preview_id = previewId;
  appendImportHistory(historyEntry);
  pdvImportPreviews.set(previewId, {
    previewId,
    type,
    filePath: file.path,
    fileName: sanitizeFilename(file.originalname || file.filename || ""),
    parsed,
    historyEntry
  });
  return {
    previewId,
    headersOriginais: parsed.headerAnalysis.originalHeaders,
    headersNormalizados: parsed.headerAnalysis.normalizedHeaders,
    detectedIndexes: parsed.headerAnalysis.indexes,
    summary: {
      ...parsed.summary,
      topRows: buildTopRows(parsed.previewRows, type === "curva-abc" ? "total_comprado" : type === "vendas" ? "valor_total" : type === "cashback" ? "saldo_cashback" : "preco_venda")
    },
    preview: parsed.previewRows.slice(0, 300),
    invalidRows: parsed.invalidRows.slice(0, 100),
    diagnostics: parsed.diagnostics
  };
}

function updateHistoryEntry(batchId, updater) {
  const history = loadImportHistory();
  const index = history.findIndex((item) => item.id === batchId);
  if (index < 0) {
    return null;
  }
  history[index] = typeof updater === "function" ? updater(history[index]) : updater;
  saveImportHistory(history);
  return history[index];
}

function writeBatchLog(batchId, payload) {
  ensurePdvImportDirs();
  const logPath = path.join(pdvBatchesDir, `${batchId}.json`);
  fs.writeFileSync(logPath, JSON.stringify(payload, null, 2), "utf8");
  return logPath;
}

function writeBackupSnapshot(batchId, type, dataset) {
  ensurePdvImportDirs();
  const backupPath = path.join(pdvBackupsDir, `${batchId}-${type}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(dataset, null, 2), "utf8");
  return backupPath;
}

async function commitPdvImportPreview(type, previewId, user = {}) {
  ensurePdvImportDirs();
  const preview = pdvImportPreviews.get(previewId);
  if (!preview || preview.type !== type) {
    throw new Error("Preview do PDV não encontrado ou expirado.");
  }

  const typeConfig = getPdvImportTypeConfig(type);
  const currentDataset = loadDataset(type);
  const originalDataset = JSON.parse(JSON.stringify(currentDataset));
  const batchId = preview.historyEntry.id;
  const now = new Date().toISOString();
  let created = 0;
  let updated = 0;
  let skippedDuplicates = 0;
  let errors = 0;
  const applied = [];

  const datasetIndex = new Map();
  currentDataset.forEach((item, index) => {
    const key = getExistingKey(type, item);
    if (key) {
      datasetIndex.set(key, index);
    }
  });

  for (const row of preview.parsed.previewRows) {
    try {
      const key = getExistingKey(type, row) || buildPreviewKey(type, row);
      if (!key) {
        errors += 1;
        continue;
      }
      const existingIndex = datasetIndex.has(key) ? datasetIndex.get(key) : -1;
      if (row.action === "skip_duplicate" && existingIndex < 0) {
        skippedDuplicates += 1;
        continue;
      }
      if (existingIndex >= 0) {
        const existing = currentDataset[existingIndex];
        const merged = mergeRecord(existing, {
          ...row,
          updated_at: now,
          last_import_batch_id: batchId,
          strategic_hints: row.strategic_hints || existing.strategic_hints || {}
        });
        const before = JSON.stringify(existing);
        const after = JSON.stringify(merged);
        if (before === after) {
          skippedDuplicates += 1;
          continue;
        }
        currentDataset[existingIndex] = merged;
        updated += 1;
        applied.push({ action: "updated", key, row: merged });
        continue;
      }
      const normalized = {
        ...row,
        id: crypto.randomUUID(),
        import_batch_id: batchId,
        created_at: now,
        updated_at: now
      };
      currentDataset.push(normalized);
      datasetIndex.set(key, currentDataset.length - 1);
      created += 1;
      applied.push({ action: "created", key, row: normalized });
    } catch (error) {
      errors += 1;
    }
  }

  const backupPath = writeBackupSnapshot(batchId, type, originalDataset);
  saveDataset(type, currentDataset);
  const batchLog = {
    id: batchId,
    type,
    committed_at: now,
    confirmed_by: user?.email || user?.name || "",
    source_file: preview.fileName,
    summary: {
      created,
      updated,
      skippedDuplicates,
      errors,
      totalContactsProcessed: preview.parsed.previewRows.length,
      filesProcessed: 1
    },
    applied,
    invalidRows: preview.parsed.invalidRows
  };
  const batchLogPath = writeBatchLog(batchId, batchLog);

  updateHistoryEntry(batchId, (entry) => ({
    ...entry,
    status: errors ? COMMIT_STATUS.FAILED : COMMIT_STATUS.CONFIRMED,
    confirmado_em: now,
    usuario_responsavel: user?.email || user?.name || entry.usuario_responsavel || "",
    rollback_available: true,
    backup_path: backupPath,
    log_path: batchLogPath,
    resumo_json: {
      ...(entry.resumo_json || {}),
      created,
      updated,
      skippedDuplicates,
      errors
    }
  }));

  const processedPath = path.join(pdvProcessedDir, `${batchId}-${preview.fileName}`);
  try {
    if (preview.filePath && fs.existsSync(preview.filePath)) {
      fs.copyFileSync(preview.filePath, processedPath);
    }
  } catch (error) {
    // manter commit isolado mesmo se a cópia do arquivo falhar
  }

  pdvImportPreviews.delete(previewId);

  return {
    created,
    updated,
    skippedDuplicates,
    conflicts: preview.parsed.summary?.duplicateRows || 0,
    errors,
    totalContactsProcessed: preview.parsed.previewRows.length,
    filesProcessed: 1,
    batchId
  };
}

function listPdvImportHistory(type = "") {
  const history = loadImportHistory();
  const filtered = type ? history.filter((item) => item.tipo_importacao === type) : history;
  return filtered;
}

function getPdvImportSummary(type = "") {
  const history = listPdvImportHistory(type);
  return {
    totalImports: history.length,
    confirmed: history.filter((item) => item.status === COMMIT_STATUS.CONFIRMED).length,
    validated: history.filter((item) => item.status === COMMIT_STATUS.VALIDATED).length,
    failed: history.filter((item) => item.status === COMMIT_STATUS.FAILED).length,
    cancelled: history.filter((item) => item.status === COMMIT_STATUS.CANCELLED).length,
    lastImport: history[0] || null
  };
}

function getPdvImportDatasetsOverview() {
  return PDV_IMPORT_TYPES.map((type) => {
    const dataset = loadDataset(type.key);
    return {
      type: type.key,
      label: type.label,
      totalRecords: dataset.length
    };
  });
}

function rollbackPdvImportBatch(batchId, user = {}) {
  const history = loadImportHistory();
  const entry = history.find((item) => item.id === batchId);
  if (!entry) {
    throw new Error("Lote do PDV não encontrado.");
  }
  if (!entry.rollback_available || !entry.backup_path || !fs.existsSync(entry.backup_path)) {
    throw new Error("Rollback não disponível para este lote.");
  }
  const restored = JSON.parse(fs.readFileSync(entry.backup_path, "utf8"));
  saveDataset(entry.tipo_importacao, restored);
  updateHistoryEntry(batchId, (current) => ({
    ...current,
    status: COMMIT_STATUS.CANCELLED,
    rollback_available: false,
    cancelled_em: new Date().toISOString(),
    rollback_by: user?.email || user?.name || "",
    resumo_json: {
      ...(current.resumo_json || {}),
      rollback: true
    }
  }));
  return {
    success: true,
    batchId,
    type: entry.tipo_importacao,
    restoredRecords: restored.length
  };
}

module.exports = {
  ensurePdvImportDirs,
  createPdvImportPreview,
  commitPdvImportPreview,
  listPdvImportHistory,
  getPdvImportSummary,
  getPdvImportDatasetsOverview,
  rollbackPdvImportBatch,
  pdvImportPreviews,
  COMMIT_STATUS
};
