#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const DEFAULT_BASE = path.join("_crm_bonus_exports", "2026-05-15-readonly-extraction");

const STATUS_RULES = [
  { aliases: ["disponivel", "disponível"], normalized_status: "available", ledger_type: "generated", description: "Bonus disponivel para uso" },
  { aliases: ["a receber"], normalized_status: "pending", ledger_type: "generated_pending", description: "Bonus pendente de liberacao" },
  { aliases: ["resgatado", "usado"], normalized_status: "used", ledger_type: "used", description: "Bonus resgatado pelo cliente" },
  { aliases: ["vencido", "expirado"], normalized_status: "expired", ledger_type: "expired", description: "Bonus expirado" },
  { aliases: ["perdido"], normalized_status: "lost", ledger_type: "expired", description: "Bonus perdido" },
  { aliases: ["cancelado"], normalized_status: "cancelled", ledger_type: "cancelled", description: "Bonus cancelado" },
  { aliases: ["reativado"], normalized_status: "reactivated", ledger_type: "reactivated", description: "Bonus reativado" },
  { aliases: ["antecipado"], normalized_status: "available", ledger_type: "anticipated", description: "Bonus antecipado" }
];

const COLUMN_ALIASES = {
  customer_name: ["cliente", "nome", "consumidor", "nome cliente"],
  customer_phone: ["celular", "telefone", "fone", "whatsapp", "contato"],
  customer_document: ["cpf", "cnpj", "cpf/cnpj", "documento"],
  customer_email: ["email", "e-mail"],
  store: ["loja", "unidade", "origem loja"],
  seller: ["vendedor", "responsavel", "responsável"],
  event_date: ["data", "data da compra", "data geracao", "data geração", "gerado em", "emissao", "emissão"],
  purchase_amount: ["venda", "valor da compra", "valor compra", "compra", "total venda", "ticket"],
  bonus_amount: ["bonus gerado", "bônus gerado", "valor bonus", "valor bônus", "bonus", "bônus", "bonus perdido", "bônus perdido"],
  bonus_balance: ["disponivel", "disponível", "saldo", "saldo bonus", "saldo bônus"],
  bonus_used_amount: ["bonus resgatado", "bônus resgatado", "resgatado", "usado", "valor usado"],
  valid_until: ["validade", "valido ate", "válido até", "valido até", "vencimento", "data vencimento"],
  crm_bonus_status_original: ["status", "situacao", "situação"],
  origin: ["origem", "tipo", "operacao", "operação"],
  crm_bonus_id: ["id", "codigo", "código", "codigo bonus", "código bônus", "id bonus", "id bônus"],
  nf: ["nf", "nota", "nota fiscal"]
};

function parseArgs(argv) {
  const options = { base: DEFAULT_BASE };
  for (let index = 2; index < argv.length; index += 1) {
    const part = argv[index];
    if (part === "--base" && argv[index + 1]) {
      options.base = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function stripAccents(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeHeader(value = "") {
  return stripAccents(value)
    .replace(/[^\w/%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function chooseCsvEncoding(buffer) {
  const utf8 = buffer.toString("utf8");
  return (utf8.match(/\uFFFD/g) || []).length > 0 ? "latin1" : "utf8";
}

function parseDelimitedLine(line, separator) {
  const values = [];
  let current = "";
  let insideQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      if (insideQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }
    if (char === separator && !insideQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function parseCsvFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const content = buffer.toString(chooseCsvEncoding(buffer)).replace(/^\uFEFF/, "");
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) return [];
  const separator = lines[0].includes(";") ? ";" : ",";
  return lines.map((line) => parseDelimitedLine(line, separator));
}

function parseWorkbookFile(filePath) {
  const workbook = XLSX.readFile(filePath, { raw: false, cellDates: false });
  const sheetName = workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
}

function parseHtmlFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const rowMatches = Array.from(content.matchAll(/<tr[\s\S]*?>([\s\S]*?)<\/tr>/gi));
  return rowMatches.map((match) => {
    const cells = Array.from(match[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)).map((cell) =>
      normalizeText(cell[1].replace(/<[^>]+>/g, " "))
    );
    return cells;
  }).filter((row) => row.length);
}

function readMatrix(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".csv") return parseCsvFile(filePath);
  if (extension === ".xls" || extension === ".xlsx") return parseWorkbookFile(filePath);
  if (extension === ".html" || extension === ".htm") return parseHtmlFile(filePath);
  return null;
}

function inferModuleFromFile(name = "", headers = []) {
  const normalizedName = normalizeHeader(name);
  const joinedHeaders = headers.map(normalizeHeader).join(" | ");
  if (normalizedName.includes("perdido") || joinedHeaders.includes("bonus perdido")) {
    return "gerenciar_bonus";
  }
  if (normalizedName.includes("cliente")) return "clientes";
  if (normalizedName.includes("resgat")) return "relatorio_bonus_resgatado";
  if (normalizedName.includes("gerado")) return "relatorio_bonus_gerado";
  if (normalizedName.includes("vencer")) return "relatorio_bonus_vencer";
  if (normalizedName.includes("cancel")) return "cancelamento";
  return "desconhecido";
}

function detectHeaderRow(matrix = []) {
  let bestIndex = -1;
  let bestScore = -1;
  for (let index = 0; index < Math.min(matrix.length, 10); index += 1) {
    const row = matrix[index].map((cell) => normalizeHeader(cell));
    const score = row.filter((header) =>
      Object.values(COLUMN_ALIASES).some((aliases) => aliases.some((alias) => normalizeHeader(alias) === header))
    ).length;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex >= 0 ? bestIndex : 0;
}

function buildHeaderMap(headers = []) {
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));
  const map = {};
  for (const [targetField, aliases] of Object.entries(COLUMN_ALIASES)) {
    const matchIndex = normalizedHeaders.findIndex((header) =>
      aliases.some((alias) => normalizeHeader(alias) === header)
    );
    if (matchIndex >= 0) {
      map[targetField] = { index: matchIndex, header: headers[matchIndex] };
    }
  }
  return map;
}

function getMappedValue(row = [], headerMap = {}, fieldName = "") {
  const match = headerMap[fieldName];
  return match ? normalizeText(row[match.index] || "") : "";
}

function parseDateBR(value = "") {
  const text = normalizeText(value);
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return "";
  const [, dd, mm, yyyy, hh = "00", mi = "00", ss = "00"] = match;
  if (hh === "00" && mi === "00" && ss === "00") {
    return `${yyyy}-${mm}-${dd}`;
  }
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}

function parseMoney(value = "") {
  const text = normalizeText(value);
  if (!text) return null;
  const sanitized = text
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function normalizePhoneBR(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  if (digits.length === 12 || digits.length === 13) {
    return digits.startsWith("55") ? digits : "";
  }
  return "";
}

function isValidPhone(normalized = "") {
  return /^55\d{10,11}$/.test(normalized);
}

function inferStatus(row, headerMap, moduleName) {
  const explicit = getMappedValue(row, headerMap, "crm_bonus_status_original");
  if (explicit) return explicit;
  if (moduleName === "gerenciar_bonus") {
    const rowText = row.map((cell) => normalizeHeader(cell)).join(" | ");
    if (rowText.includes("bonus perdido")) return "Perdido";
    return "Perdido";
  }
  return "";
}

function mapStatus(status = "") {
  const normalized = normalizeHeader(status);
  const found = STATUS_RULES.find((rule) => rule.aliases.some((alias) => normalizeHeader(alias) === normalized));
  if (!found) {
    return {
      crm_bonus_status_original: status || "Desconhecido",
      normalized_status: "unknown",
      ledger_type: "unknown",
      description: "Status nao mapeado"
    };
  }
  return {
    crm_bonus_status_original: status,
    normalized_status: found.normalized_status,
    ledger_type: found.ledger_type,
    description: found.description
  };
}

function getCustomerKey(entry = {}) {
  if (entry.phone_normalized) return `phone:${entry.phone_normalized}`;
  if (entry.document) return `document:${entry.document}`;
  return `name:${normalizeHeader(entry.customer_name)}|phone:${normalizeHeader(entry.phone_original)}`;
}

function firstName(name = "") {
  return normalizeText(name).split(" ").filter(Boolean)[0] || "";
}

function stringifyCsvValue(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (/[;"\n,]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function writeCsv(filePath, rows, headers) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => stringifyCsvValue(row[header])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function sumBy(rows, predicate, field) {
  return rows
    .filter(predicate)
    .reduce((total, row) => total + Number(row[field] || 0), 0);
}

function buildLedgerEntry({ fileName, moduleName, rowNumber, row, headerMap }) {
  const customerName = getMappedValue(row, headerMap, "customer_name");
  const phoneOriginal = getMappedValue(row, headerMap, "customer_phone");
  const phoneNormalized = normalizePhoneBR(phoneOriginal);
  const document = getMappedValue(row, headerMap, "customer_document");
  const email = getMappedValue(row, headerMap, "customer_email");
  const store = getMappedValue(row, headerMap, "store");
  const seller = getMappedValue(row, headerMap, "seller");
  const eventDate = parseDateBR(getMappedValue(row, headerMap, "event_date"));
  const purchaseAmount = parseMoney(getMappedValue(row, headerMap, "purchase_amount"));
  const bonusAmount = parseMoney(getMappedValue(row, headerMap, "bonus_amount"));
  const bonusBalance = parseMoney(getMappedValue(row, headerMap, "bonus_balance"));
  const bonusUsedAmount = parseMoney(getMappedValue(row, headerMap, "bonus_used_amount"));
  const explicitOrigin = getMappedValue(row, headerMap, "origin");
  const statusOriginal = inferStatus(row, headerMap, moduleName);
  const mappedStatus = mapStatus(statusOriginal);
  const notes = [];
  if (eventDate && mappedStatus.normalized_status === "lost") {
    notes.push("Data original interpretada como data do evento do bonus perdido.");
  }
  if (!customerName) {
    notes.push("Linha sem nome de cliente.");
  }
  if (phoneOriginal && !phoneNormalized) {
    notes.push("Telefone nao pode ser normalizado.");
  }
  return {
    source_system: "crm_bonus",
    source_module: moduleName,
    source_file: fileName,
    source_row_number: rowNumber,
    crm_bonus_id: getMappedValue(row, headerMap, "crm_bonus_id") || `${fileName}:${rowNumber}`,
    customer_name: customerName,
    customer_phone_original: phoneOriginal,
    customer_phone_normalized: phoneNormalized,
    customer_document: document,
    customer_email: email,
    store,
    seller,
    purchase_date: eventDate,
    purchase_amount: purchaseAmount,
    bonus_amount: bonusAmount,
    bonus_balance: bonusBalance,
    bonus_used_amount: bonusUsedAmount,
    valid_from: "",
    valid_until: parseDateBR(getMappedValue(row, headerMap, "valid_until")),
    used_at: mappedStatus.normalized_status === "used" ? eventDate : "",
    expired_at: ["expired", "lost"].includes(mappedStatus.normalized_status) ? eventDate : "",
    cancelled_at: mappedStatus.normalized_status === "cancelled" ? eventDate : "",
    reactivated_at: mappedStatus.normalized_status === "reactivated" ? eventDate : "",
    origin: "crm_bonus_import_staging",
    crm_bonus_status_original: mappedStatus.crm_bonus_status_original,
    normalized_status: mappedStatus.normalized_status,
    ledger_type: mappedStatus.ledger_type,
    notes: notes.join(" "),
    raw_json: JSON.stringify({
      row,
      explicitOrigin,
      headerMap
    })
  };
}

function main() {
  const options = parseArgs(process.argv);
  const baseDir = path.resolve(options.base);
  const exportsDir = path.join(baseDir, "raw", "exports");
  const normalizedDir = path.join(baseDir, "normalized");
  const reportsDir = path.join(baseDir, "reports");
  const rejectedDir = path.join(baseDir, "rejected");
  const htmlSnapshotsDir = path.join(baseDir, "raw", "html_snapshots");

  ensureDir(normalizedDir);
  ensureDir(reportsDir);
  ensureDir(rejectedDir);
  ensureDir(htmlSnapshotsDir);

  const allFiles = fs.existsSync(exportsDir)
    ? fs.readdirSync(exportsDir).filter((name) => !name.startsWith("~$"))
    : [];
  if (!allFiles.length) {
    throw new Error("Nenhum arquivo encontrado em raw/exports.");
  }

  const processedFiles = [];
  const ignoredFiles = [];
  const ledger = [];
  const missingCustomerRows = [];
  const invalidPhoneRows = [];
  const unknownStatusRows = [];
  const warnings = [];

  for (const fileName of allFiles) {
    const fullPath = path.join(exportsDir, fileName);
    const extension = path.extname(fileName).toLowerCase();
    if (extension === ".pdf") {
      ignoredFiles.push({ file: fileName, reason: "pdf_sem_parser_simples_nesta_stage" });
      continue;
    }
    const matrix = readMatrix(fullPath);
    if (!matrix) {
      ignoredFiles.push({ file: fileName, reason: `extensao_nao_suportada:${extension}` });
      continue;
    }
    const headerIndex = detectHeaderRow(matrix);
    const headerRow = matrix[headerIndex] || [];
    const headerMap = buildHeaderMap(headerRow);
    const moduleName = inferModuleFromFile(fileName, headerRow);
    const dataRows = matrix.slice(headerIndex + 1).filter((row) => row.some((cell) => normalizeText(cell)));
    processedFiles.push({
      file: fileName,
      module: moduleName,
      headerIndex: headerIndex + 1,
      headers: headerRow,
      totalRows: dataRows.length
    });
    if (extension === ".html" || extension === ".htm") {
      fs.writeFileSync(path.join(htmlSnapshotsDir, `${path.basename(fileName, extension)}.html`), fs.readFileSync(fullPath));
    }

    dataRows.forEach((row, index) => {
      const rowNumber = headerIndex + 2 + index;
      const entry = buildLedgerEntry({ fileName, moduleName, rowNumber, row, headerMap });
      ledger.push(entry);

      if (!entry.customer_name && !entry.customer_phone_normalized && !entry.customer_document) {
        missingCustomerRows.push({
          source_file: fileName,
          source_row_number: rowNumber,
          reason: "missing_customer_key",
          raw_json: entry.raw_json
        });
      }
      if (entry.customer_phone_original && !isValidPhone(entry.customer_phone_normalized)) {
        invalidPhoneRows.push({
          source_file: fileName,
          source_row_number: rowNumber,
          reason: "invalid_phone",
          raw_json: entry.raw_json
        });
      }
      if (entry.normalized_status === "unknown") {
        unknownStatusRows.push({
          source_file: fileName,
          source_row_number: rowNumber,
          reason: "unknown_status",
          raw_json: entry.raw_json
        });
      }
      if (entry.notes) {
        warnings.push({
          source_file: fileName,
          source_row_number: rowNumber,
          reason: entry.notes,
          raw_json: entry.raw_json
        });
      }
    });
  }

  const customerMap = new Map();
  ledger.forEach((entry) => {
    const customerKey = getCustomerKey({
      phone_normalized: entry.customer_phone_normalized,
      document: entry.customer_document,
      customer_name: entry.customer_name,
      phone_original: entry.customer_phone_original
    });
    const current = customerMap.get(customerKey) || {
      customer_key: customerKey,
      customer_name: entry.customer_name,
      first_name: firstName(entry.customer_name),
      phone_original: entry.customer_phone_original,
      phone_normalized: entry.customer_phone_normalized,
      document: entry.customer_document,
      email: entry.customer_email,
      store_preferred: entry.store,
      total_bonus_available: 0,
      total_bonus_pending: 0,
      total_bonus_used: 0,
      total_bonus_expired: 0,
      total_bonus_cancelled: 0,
      total_bonus_generated: 0,
      last_bonus_date: "",
      last_purchase_date: "",
      source_system: "crm_bonus",
      quality_flags: new Set(),
      raw_json: []
    };
    if (entry.normalized_status === "available") current.total_bonus_available += Number(entry.bonus_balance || entry.bonus_amount || 0);
    if (entry.normalized_status === "pending") current.total_bonus_pending += Number(entry.bonus_amount || 0);
    if (entry.normalized_status === "used") current.total_bonus_used += Number(entry.bonus_used_amount || entry.bonus_amount || 0);
    if (["expired", "lost"].includes(entry.normalized_status)) current.total_bonus_expired += Number(entry.bonus_amount || entry.bonus_balance || 0);
    if (entry.normalized_status === "cancelled") current.total_bonus_cancelled += Number(entry.bonus_amount || entry.bonus_balance || 0);
    current.total_bonus_generated += Number(entry.bonus_amount || 0);
    current.last_bonus_date = [current.last_bonus_date, entry.expired_at, entry.used_at, entry.purchase_date].filter(Boolean).sort().pop() || current.last_bonus_date;
    current.last_purchase_date = [current.last_purchase_date, entry.purchase_date].filter(Boolean).sort().pop() || current.last_purchase_date;
    if (!current.customer_name && entry.customer_name) current.customer_name = entry.customer_name;
    if (!current.phone_original && entry.customer_phone_original) current.phone_original = entry.customer_phone_original;
    if (!current.phone_normalized && entry.customer_phone_normalized) current.phone_normalized = entry.customer_phone_normalized;
    if (!current.document && entry.customer_document) current.document = entry.customer_document;
    if (!current.email && entry.customer_email) current.email = entry.customer_email;
    if (!current.store_preferred && entry.store) current.store_preferred = entry.store;
    if (!entry.customer_phone_normalized && entry.customer_phone_original) current.quality_flags.add("invalid_phone");
    if (!entry.customer_name || normalizeHeader(entry.customer_name) === "cliente") current.quality_flags.add("needs_name_review");
    current.raw_json.push(entry.raw_json);
    customerMap.set(customerKey, current);
  });

  const customers = Array.from(customerMap.values()).map((customer) => ({
    ...customer,
    quality_flags: Array.from(customer.quality_flags).join("|"),
    raw_json: `[${customer.raw_json.slice(0, 5).join(",")}]`
  }));

  const summaryByCustomer = customers.map((customer) => {
    const customerEvents = ledger.filter((entry) => getCustomerKey({
      phone_normalized: entry.customer_phone_normalized,
      document: entry.customer_document,
      customer_name: entry.customer_name,
      phone_original: entry.customer_phone_original
    }) === customer.customer_key);
    const lostAmount = sumBy(customerEvents, (entry) => entry.normalized_status === "lost", "bonus_amount");
    const expiredAmount = sumBy(customerEvents, (entry) => entry.normalized_status === "expired", "bonus_amount");
    const availableAmount = sumBy(customerEvents, (entry) => entry.normalized_status === "available", "bonus_balance");
    let campaignReactivationPotential = "LOW";
    if ((lostAmount + expiredAmount) >= 100) campaignReactivationPotential = "HIGH";
    else if ((lostAmount + expiredAmount) > 0 || availableAmount > 0) campaignReactivationPotential = "MEDIUM";
    return {
      customer_key: customer.customer_key,
      customer_name: customer.customer_name,
      phone_normalized: customer.phone_normalized,
      document: customer.document,
      available_amount: Number(customer.total_bonus_available.toFixed(2)),
      pending_amount: Number(customer.total_bonus_pending.toFixed(2)),
      used_amount: Number(customer.total_bonus_used.toFixed(2)),
      expired_amount: Number(expiredAmount.toFixed(2)),
      lost_amount: Number(lostAmount.toFixed(2)),
      cancelled_amount: Number(customer.total_bonus_cancelled.toFixed(2)),
      generated_amount: Number(customer.total_bonus_generated.toFixed(2)),
      total_events: customerEvents.length,
      available_events: customerEvents.filter((entry) => entry.normalized_status === "available").length,
      used_events: customerEvents.filter((entry) => entry.normalized_status === "used").length,
      expired_events: customerEvents.filter((entry) => ["expired", "lost"].includes(entry.normalized_status)).length,
      cancelled_events: customerEvents.filter((entry) => entry.normalized_status === "cancelled").length,
      last_event_date: customer.last_bonus_date,
      campaign_reactivation_potential: campaignReactivationPotential,
      notes: customer.quality_flags || ""
    };
  });

  const statusMappingRows = STATUS_RULES.flatMap((rule) =>
    rule.aliases.map((alias) => ({
      crm_bonus_status_original: alias,
      normalized_status: rule.normalized_status,
      ledger_type: rule.ledger_type,
      description: rule.description,
      notes: ""
    }))
  );
  const unknownStatuses = Array.from(new Set(ledger.filter((entry) => entry.normalized_status === "unknown").map((entry) => entry.crm_bonus_status_original)));
  unknownStatuses.forEach((status) => {
    statusMappingRows.push({
      crm_bonus_status_original: status,
      normalized_status: "unknown",
      ledger_type: "unknown",
      description: "Status nao mapeado",
      notes: "Revisar manualmente"
    });
  });

  writeCsv(path.join(normalizedDir, "crm_bonus_bonus_ledger.csv"), ledger, [
    "source_system", "source_module", "source_file", "source_row_number", "crm_bonus_id", "customer_name",
    "customer_phone_original", "customer_phone_normalized", "customer_document", "customer_email", "store",
    "seller", "purchase_date", "purchase_amount", "bonus_amount", "bonus_balance", "bonus_used_amount",
    "valid_from", "valid_until", "used_at", "expired_at", "cancelled_at", "reactivated_at", "origin",
    "crm_bonus_status_original", "normalized_status", "ledger_type", "notes", "raw_json"
  ]);

  writeCsv(path.join(normalizedDir, "crm_bonus_customers.csv"), customers, [
    "customer_key", "customer_name", "first_name", "phone_original", "phone_normalized", "document", "email",
    "store_preferred", "total_bonus_available", "total_bonus_pending", "total_bonus_used", "total_bonus_expired",
    "total_bonus_cancelled", "total_bonus_generated", "last_bonus_date", "last_purchase_date", "source_system",
    "quality_flags", "raw_json"
  ]);

  writeCsv(path.join(normalizedDir, "crm_bonus_bonus_summary_by_customer.csv"), summaryByCustomer, [
    "customer_key", "customer_name", "phone_normalized", "document", "available_amount", "pending_amount",
    "used_amount", "expired_amount", "lost_amount", "cancelled_amount", "generated_amount", "total_events",
    "available_events", "used_events", "expired_events", "cancelled_events", "last_event_date",
    "campaign_reactivation_potential", "notes"
  ]);

  writeCsv(path.join(normalizedDir, "crm_bonus_status_mapping.csv"), statusMappingRows, [
    "crm_bonus_status_original", "normalized_status", "ledger_type", "description", "notes"
  ]);

  writeCsv(path.join(rejectedDir, "rows_with_missing_customer.csv"), missingCustomerRows, [
    "source_file", "source_row_number", "reason", "raw_json"
  ]);
  writeCsv(path.join(rejectedDir, "rows_with_invalid_phone.csv"), invalidPhoneRows, [
    "source_file", "source_row_number", "reason", "raw_json"
  ]);
  writeCsv(path.join(rejectedDir, "rows_with_unknown_status.csv"), unknownStatusRows, [
    "source_file", "source_row_number", "reason", "raw_json"
  ]);
  writeCsv(path.join(rejectedDir, "warnings.csv"), warnings, [
    "source_file", "source_row_number", "reason", "raw_json"
  ]);

  const totals = {
    available: Number(sumBy(ledger, (entry) => entry.normalized_status === "available", "bonus_balance").toFixed(2)),
    pending: Number(sumBy(ledger, (entry) => entry.normalized_status === "pending", "bonus_amount").toFixed(2)),
    used: Number(sumBy(ledger, (entry) => entry.normalized_status === "used", "bonus_used_amount").toFixed(2)),
    expired_or_lost: Number(sumBy(ledger, (entry) => ["expired", "lost"].includes(entry.normalized_status), "bonus_amount").toFixed(2)),
    cancelled: Number(sumBy(ledger, (entry) => entry.normalized_status === "cancelled", "bonus_amount").toFixed(2)),
    reactivated: Number(sumBy(ledger, (entry) => entry.normalized_status === "reactivated", "bonus_amount").toFixed(2)),
    unknown: Number(sumBy(ledger, (entry) => entry.normalized_status === "unknown", "bonus_amount").toFixed(2)),
    generated_total: Number(sumBy(ledger, () => true, "bonus_amount").toFixed(2))
  };

  const countsByStatus = {
    available: ledger.filter((entry) => entry.normalized_status === "available").length,
    pending: ledger.filter((entry) => entry.normalized_status === "pending").length,
    used: ledger.filter((entry) => entry.normalized_status === "used").length,
    expired_or_lost: ledger.filter((entry) => ["expired", "lost"].includes(entry.normalized_status)).length,
    cancelled: ledger.filter((entry) => entry.normalized_status === "cancelled").length,
    reactivated: ledger.filter((entry) => entry.normalized_status === "reactivated").length,
    unknown: ledger.filter((entry) => entry.normalized_status === "unknown").length
  };

  const report = {
    generated_at: new Date().toISOString(),
    base_path: baseDir,
    files_found: allFiles.length,
    files_processed: processedFiles,
    files_ignored: ignoredFiles,
    total_rows_read: ledger.length,
    total_bonus_events: ledger.length,
    total_customers: customers.length,
    totals_by_status: countsByStatus,
    financial_totals: totals,
    valid_phones: customers.filter((customer) => isValidPhone(customer.phone_normalized)).length,
    invalid_phones: invalidPhoneRows.length,
    unknown_status_rows: unknownStatusRows.length,
    reactivation_high: summaryByCustomer.filter((item) => item.campaign_reactivation_potential === "HIGH").length,
    limitations: [
      "Os arquivos reais disponibilizados nesta rodada representam apenas bonus perdidos.",
      "Campos de vendedor, NF e ticket vieram majoritariamente como N/A.",
      "A data original foi interpretada como data do evento do bonus perdido."
    ],
    database_written: false,
    import_called: false
  };

  const reportMd = `# CRM Bonus -> Ledger AEROSTORE\n\n` +
    `- Data/hora: ${report.generated_at}\n` +
    `- Arquivos encontrados: ${allFiles.length}\n` +
    `- Arquivos processados: ${processedFiles.map((item) => `${item.file} (${item.totalRows})`).join(", ") || "-"}\n` +
    `- Arquivos ignorados: ${ignoredFiles.length ? ignoredFiles.map((item) => `${item.file} (${item.reason})`).join(", ") : "nenhum"}\n` +
    `- Total de linhas processadas: ${ledger.length}\n` +
    `- Total de eventos de bonus: ${ledger.length}\n` +
    `- Total de clientes identificados: ${customers.length}\n\n` +
    `## Totais por status\n` +
    `- Disponivel: ${countsByStatus.available}\n` +
    `- A receber: ${countsByStatus.pending}\n` +
    `- Usado/resgatado: ${countsByStatus.used}\n` +
    `- Vencido/perdido: ${countsByStatus.expired_or_lost}\n` +
    `- Cancelado: ${countsByStatus.cancelled}\n` +
    `- Reativado: ${countsByStatus.reactivated}\n` +
    `- Desconhecido: ${countsByStatus.unknown}\n\n` +
    `## Totais financeiros\n` +
    `- Total gerado: R$ ${totals.generated_total.toFixed(2)}\n` +
    `- Total disponivel: R$ ${totals.available.toFixed(2)}\n` +
    `- Total usado: R$ ${totals.used.toFixed(2)}\n` +
    `- Total vencido/perdido: R$ ${totals.expired_or_lost.toFixed(2)}\n` +
    `- Total cancelado: R$ ${totals.cancelled.toFixed(2)}\n\n` +
    `## Qualidade\n` +
    `- Telefones validos: ${report.valid_phones}\n` +
    `- Telefones invalidos: ${report.invalid_phones}\n` +
    `- Status desconhecidos: ${report.unknown_status_rows}\n` +
    `- Clientes com potencial HIGH de reativacao: ${report.reactivation_high}\n\n` +
    `## Limitacoes\n` +
    report.limitations.map((item) => `- ${item}`).join("\n") +
    `\n\n## Proximos passos\n- Revisar linhas com nome generico "Cliente".\n- Validar se a data representa evento perdido ou data original da compra.\n- Somente depois planejar importacao futura no ledger interno.\n`;

  fs.writeFileSync(path.join(reportsDir, "extraction_report.md"), reportMd, "utf8");
  writeJson(path.join(reportsDir, "extraction_report.json"), report);

  const fieldMapping = `# Field Mapping\n\n` +
    `- Data -> purchase_date / expired_at\n` +
    `- Cliente -> customer_name\n` +
    `- Celular -> customer_phone_original / customer_phone_normalized\n` +
    `- Bonus perdido -> bonus_amount\n` +
    `- Vendedor -> seller\n` +
    `- NF -> notes quando houver\n` +
    `- Ticket -> purchase_amount\n` +
    `- Status inferido Perdido -> normalized_status = lost, ledger_type = expired\n`;
  fs.writeFileSync(path.join(reportsDir, "field_mapping.md"), fieldMapping, "utf8");

  const futureImportPlan = `# Future Import Plan\n\n` +
    `- Importar crm_bonus_bonus_ledger.csv futuramente para customer_cashback_ledger.\n` +
    `- Vincular cliente por phone_normalized; fallback por document.\n` +
    `- Preservar source_system = crm_bonus e origin = crm_bonus_import_staging.\n` +
    `- Evitar duplicidade por crm_bonus_id + customer_key + purchase_date.\n` +
    `- Expor resumo historico no PDV apenas depois de conciliacao manual inicial.\n` +
    `- Nao executar importacao sem revisar rejected e warnings.\n`;
  fs.writeFileSync(path.join(reportsDir, "future_import_plan.md"), futureImportPlan, "utf8");

  console.log(JSON.stringify({
    ok: true,
    filesFound: allFiles.length,
    processedFiles: processedFiles.map((item) => item.file),
    ignoredFiles,
    ledgerEvents: ledger.length,
    customers: customers.length,
    countsByStatus,
    totals
  }, null, 2));
}

main();
