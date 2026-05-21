#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DEFAULT_BASE = path.join("_crm_bonus_exports", "2026-05-15-readonly-extraction");
const DEFAULT_FILE = path.join(DEFAULT_BASE, "raw", "customers_backup", "clientes_aerostore_CRM Bonus TOTAL.csv");
const DEFAULT_DB = path.join("data", "aerostore-crm.sqlite");

function parseArgs(argv) {
  const options = {
    base: DEFAULT_BASE,
    file: ""
  };

  for (let index = 2; index < argv.length; index += 1) {
    const part = argv[index];
    if (part === "--base" && argv[index + 1]) {
      options.base = argv[index + 1];
      index += 1;
      continue;
    }
    if (part === "--file" && argv[index + 1]) {
      options.file = argv[index + 1];
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
    .replace(/[^\w@/%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizePhoneBR(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;
  return "";
}

function normalizeDocument(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizeName(value = "") {
  return normalizeText(value)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNameKey(value = "") {
  return normalizeHeader(value).replace(/\s+/g, " ").trim();
}

function firstName(value = "") {
  return normalizeName(value).split(" ").filter(Boolean)[0] || "";
}

function chooseCsvEncoding(buffer) {
  if (buffer && buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return "utf8";
  }
  const utf8 = buffer.toString("utf8");
  return (utf8.match(/\uFFFD/g) || []).length > 0 ? "latin1" : "utf8";
}

function stripBomArtifacts(value = "") {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/^ï»¿/, "")
    .replace(/^Ã¯Â»Â¿/, "")
    .trim();
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

function parseCsv(filePath) {
  const buffer = fs.readFileSync(filePath);
  const encoding = chooseCsvEncoding(buffer);
  const content = buffer.toString(encoding).replace(/^\uFEFF/, "");
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) return { headers: [], rows: [] };
  const separator = lines[0].includes(",") ? "," : ";";
  const matrix = lines.map((line) => parseDelimitedLine(line, separator));
  const headers = matrix[0].map((header) => normalizeText(stripBomArtifacts(header)));
  const rows = matrix.slice(1).map((line) => {
    const row = {};
    headers.forEach((header, index) => {
      row[header] = normalizeText(line[index] || "");
    });
    return row;
  });
  return { headers, rows };
}

function stringifyCsvValue(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (/[,"\n;]/.test(text)) {
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

function openReadOnlyDatabase(dbFilePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbFilePath, sqlite3.OPEN_READONLY, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(db);
    });
  });
}

function allReadOnly(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

function closeDatabase(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function buildMap(rows, keyGetter) {
  const map = new Map();
  for (const row of rows) {
    const key = keyGetter(row);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(row);
  }
  return map;
}

function pickBestContact(candidates = []) {
  const ranked = [...candidates].sort((left, right) => {
    const leftScore = (
      (left.document_normalized ? 4 : 0) +
      (left.email_normalized ? 2 : 0) +
      (left.name_clean ? 2 : 0) +
      (left.is_active ? 2 : 0) +
      (left.deleted_at ? 0 : 3)
    );
    const rightScore = (
      (right.document_normalized ? 4 : 0) +
      (right.email_normalized ? 2 : 0) +
      (right.name_clean ? 2 : 0) +
      (right.is_active ? 2 : 0) +
      (right.deleted_at ? 0 : 3)
    );
    if (rightScore !== leftScore) return rightScore - leftScore;
    return String(right.updated_at || "").localeCompare(String(left.updated_at || ""));
  });
  return ranked[0] || null;
}

function flagsToString(flags = []) {
  return Array.from(new Set(flags.filter(Boolean))).join("|");
}

function booleanToText(value) {
  return value ? "true" : "false";
}

function createSuggestedActionForDuplicate(group = []) {
  const hasDocument = group.some((row) => row.document_normalized);
  const distinctNames = new Set(group.map((row) => normalizeNameKey(row.name_clean)).filter(Boolean)).size;
  if (hasDocument && distinctNames <= 1) return "KEEP_MOST_COMPLETE";
  if (distinctNames > 1) return "REVIEW_MANUALLY";
  return "IGNORE_DUPLICATE";
}

function escapeMarkdown(value = "") {
  return String(value || "").replace(/\|/g, "\\|");
}

async function main() {
  const options = parseArgs(process.argv);
  const baseDir = path.resolve(options.base || DEFAULT_BASE);
  const rawBackupDir = path.join(baseDir, "raw", "customers_backup");
  const outputDir = path.join(baseDir, "customers-backup-preview");
  const reconciliationDir = path.join(baseDir, "reconciliation");
  const dbPath = path.resolve(DEFAULT_DB);

  ensureDir(rawBackupDir);
  ensureDir(outputDir);

  let inputFile = options.file ? path.resolve(options.file) : path.resolve(DEFAULT_FILE);
  if (!fs.existsSync(inputFile)) {
    const fallback = fs.existsSync(rawBackupDir)
      ? fs.readdirSync(rawBackupDir)
        .map((name) => path.join(rawBackupDir, name))
        .find((candidate) => /\.csv$/i.test(candidate))
      : "";
    if (fallback) {
      inputFile = fallback;
    }
  }

  if (!inputFile || !fs.existsSync(inputFile)) {
    throw new Error(`Arquivo de backup nao encontrado. Informe --file ou coloque o CSV em ${rawBackupDir}`);
  }

  const parsed = parseCsv(inputFile);
  const headersMap = new Map(parsed.headers.map((header) => [normalizeHeader(header), header]));
  const nameHeader = headersMap.get("nome") || "Nome";
  const phoneHeader = headersMap.get("celular") || "Celular";
  const documentHeader = headersMap.get("cpf") || "CPF";

  const normalizedRows = parsed.rows.map((row, index) => {
    const nameOriginal = row[nameHeader] || row.Nome || "";
    const phoneOriginal = row[phoneHeader] || row.Celular || "";
    const documentOriginal = row[documentHeader] || row.CPF || "";
    const nameClean = normalizeName(nameOriginal);
    const phoneNormalized = normalizePhoneBR(phoneOriginal);
    const documentNormalized = normalizeDocument(documentOriginal);
    const qualityFlags = [];
    if (!nameClean) qualityFlags.push("missing_name");
    if (!phoneNormalized) qualityFlags.push("invalid_phone");
    if (!documentNormalized) qualityFlags.push("missing_document");

    return {
      source_file: path.basename(inputFile),
      source_row_number: index + 2,
      name_original: nameOriginal,
      name_clean: nameClean,
      first_name: firstName(nameClean),
      phone_original: phoneOriginal,
      phone_normalized: phoneNormalized,
      document_original: documentOriginal,
      document_normalized: documentNormalized,
      source_system: "crm_bonus",
      source: "crm_bonus_customer_backup",
      quality_flags: flagsToString(qualityFlags),
      raw_json: JSON.stringify(row)
    };
  });

  const phoneGroups = buildMap(normalizedRows, (row) => row.phone_normalized);
  const documentGroups = buildMap(normalizedRows, (row) => row.document_normalized);
  const namePhoneGroups = buildMap(normalizedRows, (row) => {
    const nameKey = normalizeNameKey(row.name_clean);
    return nameKey && row.phone_normalized ? `${nameKey}|${row.phone_normalized}` : "";
  });
  const nameDocumentGroups = buildMap(normalizedRows, (row) => {
    const nameKey = normalizeNameKey(row.name_clean);
    return nameKey && row.document_normalized ? `${nameKey}|${row.document_normalized}` : "";
  });

  const duplicateGroups = [];
  const duplicateKeysByRow = new Map();

  function registerDuplicateGroups(map, duplicateType) {
    for (const [key, group] of map.entries()) {
      if (!key || group.length <= 1) continue;
      duplicateGroups.push({
        duplicate_type: duplicateType,
        duplicate_key: key,
        rows: group.map((row) => row.source_row_number).join("|"),
        names: group.map((row) => row.name_clean || row.name_original || "-").join(" | "),
        phones: group.map((row) => row.phone_normalized || row.phone_original || "-").join(" | "),
        documents: group.map((row) => row.document_normalized || row.document_original || "-").join(" | "),
        suggested_action: createSuggestedActionForDuplicate(group),
        notes: `${group.length} linhas compartilham a mesma chave.`
      });
      for (const row of group) {
        const rowKey = String(row.source_row_number);
        if (!duplicateKeysByRow.has(rowKey)) duplicateKeysByRow.set(rowKey, new Set());
        duplicateKeysByRow.get(rowKey).add(duplicateType);
      }
    }
  }

  registerDuplicateGroups(phoneGroups, "duplicate_phone");
  registerDuplicateGroups(documentGroups, "duplicate_document");
  registerDuplicateGroups(namePhoneGroups, "duplicate_name_phone");
  registerDuplicateGroups(nameDocumentGroups, "duplicate_name_document");

  const db = await openReadOnlyDatabase(dbPath);
  let contacts = [];
  try {
    contacts = await allReadOnly(
      db,
      `SELECT id, name, mobile, mobile_normalized, phone, document, email, status, source, deleted_at, created_at, updated_at
       FROM contacts`
    );
  } finally {
    await closeDatabase(db);
  }

  const normalizedContacts = contacts.map((row) => ({
    id: Number(row.id || 0),
    name: normalizeName(row.name || ""),
    name_key: normalizeNameKey(row.name || ""),
    mobile: normalizeText(row.mobile || ""),
    mobile_normalized: normalizePhoneBR(row.mobile_normalized || row.mobile || row.phone || ""),
    phone: normalizeText(row.phone || ""),
    document: normalizeText(row.document || ""),
    document_normalized: normalizeDocument(row.document || ""),
    email: normalizeText(row.email || "").toLowerCase(),
    email_normalized: normalizeText(row.email || "").toLowerCase(),
    status: normalizeText(row.status || ""),
    source: normalizeText(row.source || ""),
    deleted_at: normalizeText(row.deleted_at || ""),
    created_at: normalizeText(row.created_at || ""),
    updated_at: normalizeText(row.updated_at || ""),
    is_active: normalizeText(row.status || "").toLowerCase() === "ativo" && !normalizeText(row.deleted_at || "")
  }));

  const contactsByPhone = buildMap(normalizedContacts, (row) => row.mobile_normalized);
  const contactsByDocument = buildMap(normalizedContacts, (row) => row.document_normalized);

  const duplicatePhoneGroupsInContacts = Array.from(contactsByPhone.entries())
    .filter(([key, group]) => key && group.filter((row) => !row.deleted_at).length > 1)
    .map(([key, group]) => {
      const sortedGroup = [...group].sort((left, right) => Number(left.id) - Number(right.id));
      const primary = pickBestContact(group);
      return {
        mobile_normalized: key,
        duplicate_count: group.length,
        contact_ids: sortedGroup.map((row) => row.id).join("|"),
        contact_names: sortedGroup.map((row) => row.name || "-").join(" | "),
        documents: sortedGroup.map((row) => row.document_normalized || "-").join(" | "),
        emails: sortedGroup.map((row) => row.email || "-").join(" | "),
        statuses: sortedGroup.map((row) => row.status || "-").join(" | "),
        sources: sortedGroup.map((row) => row.source || "-").join(" | "),
        created_dates: sortedGroup.map((row) => row.created_at || "-").join(" | "),
        updated_dates: sortedGroup.map((row) => row.updated_at || "-").join(" | "),
        suggested_resolution: primary ? "KEEP_MOST_COMPLETE" : "REVIEW_MANUALLY",
        notes: primary ? `Contato sugerido: #${primary.id} ${primary.name || "-"}` : "Sem contato principal claro."
      };
    });

  const previewRows = [];
  const safeToImportRows = [];
  const conflictRows = [];
  const reviewRows = [];

  for (const row of normalizedRows) {
    const rowFlags = new Set((row.quality_flags || "").split("|").filter(Boolean));
    const internalDuplicateTypes = Array.from(duplicateKeysByRow.get(String(row.source_row_number)) || []);
    for (const duplicateType of internalDuplicateTypes) {
      rowFlags.add(duplicateType);
    }

    const phoneMatches = row.phone_normalized ? (contactsByPhone.get(row.phone_normalized) || []) : [];
    const documentMatches = row.document_normalized ? (contactsByDocument.get(row.document_normalized) || []) : [];
    const allMatches = new Map();
    for (const match of [...phoneMatches, ...documentMatches]) {
      allMatches.set(String(match.id), match);
    }
    const matchList = Array.from(allMatches.values());

    let actionSuggested = "SAFE_CREATE_MINIMAL_CUSTOMER";
    let crmCustomerExists = false;
    let crmCustomerId = "";
    let crmCustomerName = "";
    let crmCustomerPhoneNormalized = "";
    let crmCustomerDocument = "";
    let matchMethod = "";
    let matchConfidence = "";
    let conflictReason = "";
    let importReady = true;
    let notes = "";

    if (!row.phone_normalized) {
      actionSuggested = "IGNORE_INVALID";
      importReady = false;
      conflictReason = "invalid_phone";
      notes = "Telefone invalido para importacao minima.";
    } else if (internalDuplicateTypes.includes("duplicate_phone") || internalDuplicateTypes.includes("duplicate_document")) {
      actionSuggested = "REVIEW_DUPLICATE_BACKUP";
      importReady = false;
      conflictReason = internalDuplicateTypes.includes("duplicate_phone") ? "duplicate_phone_in_backup" : "duplicate_document_in_backup";
      notes = "Duplicidade interna critica no backup.";
    } else if (phoneMatches.length > 1) {
      actionSuggested = "REVIEW_CONFLICT";
      importReady = false;
      crmCustomerExists = true;
      matchMethod = "phone_normalized";
      matchConfidence = "low";
      conflictReason = "duplicate_phone_in_contacts";
      notes = "Telefone encontrado em mais de um contato local.";
    } else if (documentMatches.length > 1) {
      actionSuggested = "REVIEW_CONFLICT";
      importReady = false;
      crmCustomerExists = true;
      matchMethod = "document";
      matchConfidence = "low";
      conflictReason = "duplicate_document_in_contacts";
      notes = "Documento encontrado em mais de um contato local.";
    } else if (phoneMatches.length === 1) {
      const match = phoneMatches[0];
      crmCustomerExists = true;
      crmCustomerId = String(match.id);
      crmCustomerName = match.name;
      crmCustomerPhoneNormalized = match.mobile_normalized;
      crmCustomerDocument = match.document_normalized;
      matchMethod = "phone_normalized";
      matchConfidence = "high";
      actionSuggested = "ALREADY_EXISTS";
      importReady = false;
      if (row.name_clean && match.name_key && normalizeNameKey(row.name_clean) !== match.name_key) {
        conflictReason = "phone_matches_different_name";
        notes = "Telefone bateu, mas o nome diverge da base local.";
      } else if (!match.is_active) {
        conflictReason = "matched_inactive_or_deleted_contact";
        notes = "Telefone bateu com contato inativo ou deletado.";
      } else {
        notes = "Cliente ja existe por telefone.";
      }
    } else if (documentMatches.length === 1) {
      const match = documentMatches[0];
      crmCustomerExists = true;
      crmCustomerId = String(match.id);
      crmCustomerName = match.name;
      crmCustomerPhoneNormalized = match.mobile_normalized;
      crmCustomerDocument = match.document_normalized;
      matchMethod = "document";
      matchConfidence = "high";
      actionSuggested = "ALREADY_EXISTS";
      importReady = false;
      if (row.phone_normalized && match.mobile_normalized && row.phone_normalized !== match.mobile_normalized) {
        conflictReason = "document_matches_different_phone";
        notes = "Documento bateu, mas o telefone diverge da base local.";
      } else if (!match.is_active) {
        conflictReason = "matched_inactive_or_deleted_contact";
        notes = "Documento bateu com contato inativo ou deletado.";
      } else {
        notes = "Cliente ja existe por documento.";
      }
    } else if (!row.name_clean && !row.document_normalized) {
      actionSuggested = "IGNORE_INVALID";
      importReady = false;
      conflictReason = "insufficient_identification";
      notes = "Linha sem nome limpo e sem documento.";
    } else {
      notes = "Cliente novo e seguro para futura criacao minima.";
    }

    if (!row.name_clean) {
      rowFlags.add("missing_name");
    }
    if (!row.document_normalized) {
      rowFlags.add("missing_document");
    }
    if (conflictReason === "matched_inactive_or_deleted_contact") {
      rowFlags.add("matched_inactive_or_deleted_contact");
    }
    if (conflictReason === "phone_matches_different_name" || conflictReason === "document_matches_different_phone") {
      rowFlags.add("conflict_with_contacts");
    }

    const previewRow = {
      backup_row_number: row.source_row_number,
      name_clean: row.name_clean,
      first_name: row.first_name,
      phone_normalized: row.phone_normalized,
      document_normalized: row.document_normalized,
      backup_quality_flags: flagsToString(Array.from(rowFlags)),
      crm_customer_exists: booleanToText(crmCustomerExists),
      crm_customer_id: crmCustomerId,
      crm_customer_name: crmCustomerName,
      crm_customer_phone_normalized: crmCustomerPhoneNormalized,
      crm_customer_document: crmCustomerDocument,
      match_method: matchMethod,
      match_confidence: matchConfidence,
      conflict_reason: conflictReason,
      action_suggested: actionSuggested,
      import_ready: booleanToText(importReady),
      notes
    };
    previewRows.push(previewRow);

    if (actionSuggested === "SAFE_CREATE_MINIMAL_CUSTOMER") {
      safeToImportRows.push({
        name: row.name_clean || row.phone_normalized || "Cliente CRM Bonus",
        first_name: row.first_name,
        mobile: row.phone_original,
        mobile_normalized: row.phone_normalized,
        document: row.document_normalized,
        source: "crm_bonus_customer_backup",
        status: "active",
        quality_flags: flagsToString(Array.from(rowFlags)),
        notes: "Cliente novo identificado em backup historico do CRM Bonus."
      });
    }

    if (actionSuggested === "REVIEW_CONFLICT" || conflictReason || (crmCustomerExists && !importReady && actionSuggested !== "ALREADY_EXISTS")) {
      const chosen = pickBestContact(matchList);
      conflictRows.push({
        backup_name: row.name_clean || row.name_original || "",
        backup_phone: row.phone_normalized || row.phone_original || "",
        backup_document: row.document_normalized || row.document_original || "",
        crm_customer_id: chosen ? chosen.id : "",
        crm_customer_name: chosen ? chosen.name : "",
        crm_customer_phone: chosen ? chosen.mobile_normalized : "",
        crm_customer_document: chosen ? chosen.document_normalized : "",
        conflict_type: conflictReason || actionSuggested,
        suggested_action: actionSuggested === "ALREADY_EXISTS" ? "REVIEW_EXISTING_MATCH" : actionSuggested,
        notes
      });
    }

    if (actionSuggested !== "SAFE_CREATE_MINIMAL_CUSTOMER" && actionSuggested !== "ALREADY_EXISTS") {
      reviewRows.push({
        backup_row_number: row.source_row_number,
        name_clean: row.name_clean,
        first_name: row.first_name,
        phone_normalized: row.phone_normalized,
        document_normalized: row.document_normalized,
        backup_quality_flags: flagsToString(Array.from(rowFlags)),
        crm_customer_exists: booleanToText(crmCustomerExists),
        crm_customer_id: crmCustomerId,
        crm_customer_name: crmCustomerName,
        crm_customer_phone_normalized: crmCustomerPhoneNormalized,
        crm_customer_document: crmCustomerDocument,
        match_method: matchMethod,
        match_confidence: matchConfidence,
        conflict_reason: conflictReason,
        action_suggested: actionSuggested,
        import_ready: booleanToText(importReady),
        notes
      });
    }
  }

  const reconciliationPreviewPath = path.join(reconciliationDir, "crm_bonus_customer_match_preview.csv");
  let unmatchedImpactCount = 0;
  let unmatchedImpactAmount = 0;
  if (fs.existsSync(reconciliationPreviewPath)) {
    const reconciliationRows = parseCsv(reconciliationPreviewPath).rows;
    const safePhones = new Set(safeToImportRows.map((row) => row.mobile_normalized).filter(Boolean));
    const safeDocuments = new Set(safeToImportRows.map((row) => row.document).filter(Boolean));
    for (const row of reconciliationRows) {
      const exists = normalizeText(row.crm_customer_exists || "").toLowerCase() === "true";
      if (exists) continue;
      const phone = normalizePhoneBR(row.crm_bonus_phone_normalized || row.crm_bonus_phone_original || "");
      const document = normalizeDocument(row.crm_bonus_document || "");
      if ((phone && safePhones.has(phone)) || (document && safeDocuments.has(document))) {
        unmatchedImpactCount += 1;
        const lost = Number(String(row.crm_bonus_lost_amount || "0").replace(",", ".")) || 0;
        unmatchedImpactAmount += lost;
      }
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    input_file: inputFile,
    total_rows: normalizedRows.length,
    valid_phones: normalizedRows.filter((row) => row.phone_normalized).length,
    invalid_phones: normalizedRows.filter((row) => !row.phone_normalized).length,
    documents_present: normalizedRows.filter((row) => row.document_normalized).length,
    documents_missing: normalizedRows.filter((row) => !row.document_normalized).length,
    missing_names: normalizedRows.filter((row) => !row.name_clean).length,
    internal_phone_duplicate_groups: Array.from(phoneGroups.values()).filter((group) => group.length > 1).length,
    internal_document_duplicate_groups: Array.from(documentGroups.values()).filter((group) => group.length > 1).length,
    already_exists: previewRows.filter((row) => row.action_suggested === "ALREADY_EXISTS").length,
    safe_to_import: safeToImportRows.length,
    conflicts: conflictRows.length,
    review_needed: reviewRows.length,
    estimated_unmatched_cashback_customers_recoverable: unmatchedImpactCount,
    estimated_unmatched_cashback_amount_recoverable: Number(unmatchedImpactAmount.toFixed(2))
  };

  const reportMd = `# Preview read-only do backup de clientes CRM Bonus

- Arquivo de entrada: ${path.basename(inputFile)}
- Total de linhas no backup: ${report.total_rows}
- Telefones validos: ${report.valid_phones}
- Telefones invalidos: ${report.invalid_phones}
- CPFs preenchidos: ${report.documents_present}
- CPFs vazios: ${report.documents_missing}
- Nomes vazios: ${report.missing_names}
- Duplicados internos por telefone: ${report.internal_phone_duplicate_groups}
- Duplicados internos por CPF: ${report.internal_document_duplicate_groups}
- Ja existentes no CRM: ${report.already_exists}
- Seguros para criar: ${report.safe_to_import}
- Conflitos: ${report.conflicts}
- Revisao manual: ${report.review_needed}

## Observacao critica de qualidade
- O backup veio com ${report.missing_names} nomes vazios.
- Isso significa que os clientes marcados como seguros sao seguros do ponto de vista de deduplicacao, mas ainda entram como cadastro minimo e pobre para UX.
- Recomendacao: tratar essa importacao futura como complemento de telefone/CPF, nao como cadastro rico de relacionamento.

## Impacto esperado na conciliacao dos cashbacks
- Clientes hoje nao conciliados que poderiam ser recuperados apos importacao segura: ${report.estimated_unmatched_cashback_customers_recoverable}
- Valor potencial de cashback perdido que poderia ganhar vinculo melhor: R$ ${report.estimated_unmatched_cashback_amount_recoverable.toFixed(2)}

## Proxima etapa recomendada
1. Importar apenas o arquivo safe_to_import em lote controlado.
2. Reprocessar a conciliacao do CRM Bonus contra contacts.
3. Revisar conflitos e duplicidades antes de qualquer merge manual.

Conclusao: Nenhum cliente foi criado nesta etapa.
`;

  const importPlanMd = `# Plano futuro de importacao do backup de clientes CRM Bonus

1. Importar somente as linhas de \`crm_bonus_customers_safe_to_import.csv\`.
2. Marcar \`source = crm_bonus_customer_backup\` e \`status = active\`.
3. Bloquear duplicidade por \`mobile_normalized\` e \`document\`.
4. Manter conflitos em fila manual, sem merge automatico.
5. Reprocessar a conciliacao dos cashbacks perdidos apos a importacao segura.
6. Como o backup veio praticamente sem nomes, tratar os novos registros como clientes minimos baseados em telefone/CPF.
7. Esperado: reduzir parte dos clientes nao encontrados e destravar parte da conciliacao futura dos bonus perdidos.
`;

  fs.writeFileSync(path.join(outputDir, "crm_bonus_customers_backup_report.md"), reportMd, "utf8");
  fs.writeFileSync(path.join(outputDir, "crm_bonus_customers_import_plan.md"), importPlanMd, "utf8");
  fs.writeFileSync(path.join(outputDir, "README.md"), "Preview read-only do backup de clientes CRM Bonus para comparacao com contacts do CRM AEROSTORE.\n", "utf8");
  writeJson(path.join(outputDir, "crm_bonus_customers_backup_report.json"), report);

  writeCsv(path.join(outputDir, "crm_bonus_customers_backup_normalized.csv"), normalizedRows, [
    "source_file",
    "source_row_number",
    "name_original",
    "name_clean",
    "first_name",
    "phone_original",
    "phone_normalized",
    "document_original",
    "document_normalized",
    "source_system",
    "source",
    "quality_flags",
    "raw_json"
  ]);

  writeCsv(path.join(outputDir, "crm_bonus_customers_duplicates_internal.csv"), duplicateGroups, [
    "duplicate_type",
    "duplicate_key",
    "rows",
    "names",
    "phones",
    "documents",
    "suggested_action",
    "notes"
  ]);

  writeCsv(path.join(outputDir, "crm_bonus_customers_import_preview.csv"), previewRows, [
    "backup_row_number",
    "name_clean",
    "first_name",
    "phone_normalized",
    "document_normalized",
    "backup_quality_flags",
    "crm_customer_exists",
    "crm_customer_id",
    "crm_customer_name",
    "crm_customer_phone_normalized",
    "crm_customer_document",
    "match_method",
    "match_confidence",
    "conflict_reason",
    "action_suggested",
    "import_ready",
    "notes"
  ]);

  writeCsv(path.join(outputDir, "crm_bonus_customers_conflicts_with_contacts.csv"), conflictRows, [
    "backup_name",
    "backup_phone",
    "backup_document",
    "crm_customer_id",
    "crm_customer_name",
    "crm_customer_phone",
    "crm_customer_document",
    "conflict_type",
    "suggested_action",
    "notes"
  ]);

  writeCsv(path.join(outputDir, "crm_bonus_customers_safe_to_import.csv"), safeToImportRows, [
    "name",
    "first_name",
    "mobile",
    "mobile_normalized",
    "document",
    "source",
    "status",
    "quality_flags",
    "notes"
  ]);

  writeCsv(path.join(outputDir, "crm_bonus_customers_review_needed.csv"), reviewRows, [
    "backup_row_number",
    "name_clean",
    "first_name",
    "phone_normalized",
    "document_normalized",
    "backup_quality_flags",
    "crm_customer_exists",
    "crm_customer_id",
    "crm_customer_name",
    "crm_customer_phone_normalized",
    "crm_customer_document",
    "match_method",
    "match_confidence",
    "conflict_reason",
    "action_suggested",
    "import_ready",
    "notes"
  ]);

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
