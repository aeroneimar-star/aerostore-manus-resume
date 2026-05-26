#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { blockProduction, requireExplicitConfirmation, warnLocalOnly } = require("../scriptSafety");

blockProduction("staging/importCrmBonusSafeCustomers.js");
warnLocalOnly("staging/importCrmBonusSafeCustomers.js");

const DEFAULT_BASE = path.join("_crm_bonus_exports", "2026-05-15-readonly-extraction");
const DEFAULT_FILE = path.join(DEFAULT_BASE, "customers-backup-preview", "crm_bonus_customers_safe_to_import.csv");
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
  return normalizeText(value).replace(/\s+/g, " ").trim();
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
  const content = buffer.toString(chooseCsvEncoding(buffer)).replace(/^\uFEFF/, "");
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

function nowIso() {
  return new Date().toISOString();
}

function openDatabase(dbFilePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbFilePath, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(db);
    });
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function all(db, sql, params = []) {
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

function flagsToArray(value = "") {
  return String(value || "")
    .split("|")
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function flagsToString(flags = []) {
  return Array.from(new Set(flags.filter(Boolean))).join("|");
}

function determineHeader(row = {}, aliases = []) {
  const entries = Object.keys(row);
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    const match = entries.find((key) => normalizeHeader(key) === normalizedAlias);
    if (match) return match;
  }
  return "";
}

function sanitizeImportedName(name = "", mobileNormalized = "", mobileOriginal = "") {
  const cleaned = normalizeName(name);
  const cleanedDigits = cleaned.replace(/\D/g, "");
  const phoneDigits = normalizePhoneBR(mobileNormalized || mobileOriginal || "").replace(/^55/, "");
  if (!cleaned) return "";
  if (cleanedDigits && (cleanedDigits === mobileNormalized || cleanedDigits === phoneDigits || cleanedDigits === String(mobileOriginal || "").replace(/\D/g, ""))) {
    return "";
  }
  return cleaned;
}

function normalizeSafeCustomerRow(row = {}, rowNumber) {
  const nameHeader = determineHeader(row, ["name", "name_clean", "nome"]);
  const firstNameHeader = determineHeader(row, ["first_name", "primeiro nome"]);
  const mobileHeader = determineHeader(row, ["mobile", "phone_original", "phone", "celular"]);
  const mobileNormalizedHeader = determineHeader(row, ["mobile_normalized", "phone_normalized", "celular_normalizado"]);
  const documentHeader = determineHeader(row, ["document", "document_normalized", "cpf", "cpf_normalized"]);
  const sourceHeader = determineHeader(row, ["source"]);
  const statusHeader = determineHeader(row, ["status"]);
  const flagsHeader = determineHeader(row, ["quality_flags", "backup_quality_flags"]);
  const notesHeader = determineHeader(row, ["notes"]);

  const mobileOriginal = normalizeText(row[mobileHeader] || "");
  const mobileNormalized = normalizePhoneBR(row[mobileNormalizedHeader] || mobileOriginal);
  const document = normalizeDocument(row[documentHeader] || "");
  const source = normalizeText(row[sourceHeader] || "crm_bonus_customer_backup") || "crm_bonus_customer_backup";
  const rawName = normalizeText(row[nameHeader] || "");
  const cleanedName = sanitizeImportedName(rawName, mobileNormalized, mobileOriginal);
  const finalFirstName = normalizeText(row[firstNameHeader] || firstName(cleanedName));
  return {
    source_row_number: rowNumber,
    raw_name: rawName,
    name: cleanedName,
    first_name: finalFirstName,
    mobile: mobileOriginal,
    mobile_normalized: mobileNormalized,
    document,
    source,
    requested_status: normalizeText(row[statusHeader] || "active") || "active",
    quality_flags: flagsToArray(row[flagsHeader] || ""),
    notes: normalizeText(row[notesHeader] || ""),
    raw_json: JSON.stringify(row)
  };
}

async function ensureCustomerImportBatchTable(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS customer_import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_system TEXT NOT NULL DEFAULT '',
      import_type TEXT NOT NULL DEFAULT '',
      source_file TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      total_rows INTEGER NOT NULL DEFAULT 0,
      imported_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      duplicate_phone_count INTEGER NOT NULL DEFAULT 0,
      duplicate_document_count INTEGER NOT NULL DEFAULT 0,
      invalid_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      finished_at TEXT DEFAULT '',
      created_by TEXT DEFAULT ''
    )`
  );
}

async function main() {
  requireExplicitConfirmation("--confirm");
  const options = parseArgs(process.argv);
  const baseDir = path.resolve(options.base || DEFAULT_BASE);
  const inputFile = path.resolve(options.file || path.join(baseDir, "customers-backup-preview", "crm_bonus_customers_safe_to_import.csv"));
  const outputDir = path.join(baseDir, "customers-backup-import");
  const dbPath = path.resolve(DEFAULT_DB);

  ensureDir(outputDir);

  if (!fs.existsSync(inputFile)) {
    throw new Error(`Arquivo safe_to_import nao encontrado: ${inputFile}`);
  }

  const parsed = parseCsv(inputFile);
  const inputRows = parsed.rows.map((row, index) => normalizeSafeCustomerRow(row, index + 2));
  const db = await openDatabase(dbPath);
  let batchId = null;

  try {
    await ensureCustomerImportBatchTable(db);

    const contactsBefore = await get(db, "SELECT COUNT(*) AS total FROM contacts");
    const startedAt = nowIso();
    const batchInsert = await run(
      db,
      `INSERT INTO customer_import_batches
       (source_system, import_type, source_file, status, total_rows, imported_count, skipped_count, duplicate_phone_count, duplicate_document_count, invalid_count, error_count, summary_json, started_at, finished_at, created_by)
       VALUES (?, ?, ?, 'running', ?, 0, 0, 0, 0, 0, 0, '{}', ?, '', ?)`,
      [
        "crm_bonus",
        "crm_bonus_customer_backup_safe_import",
        path.basename(inputFile),
        inputRows.length,
        startedAt,
        "codex_script"
      ]
    );
    batchId = batchInsert.lastID;

    const existingContacts = await all(
      db,
      `SELECT id, name, mobile, mobile_normalized, phone, document, email, status, source, deleted_at
       FROM contacts`
    );

    const phoneIndex = new Map();
    const documentIndex = new Map();

    for (const contact of existingContacts) {
      const deletedAt = normalizeText(contact.deleted_at || "");
      const status = normalizeText(contact.status || "");
      if (deletedAt || status.toLowerCase() === "deleted") continue;
      const mobileNormalized = normalizePhoneBR(contact.mobile_normalized || contact.mobile || contact.phone || "");
      const document = normalizeDocument(contact.document || "");
      if (mobileNormalized) {
        if (!phoneIndex.has(mobileNormalized)) phoneIndex.set(mobileNormalized, []);
        phoneIndex.get(mobileNormalized).push(contact);
      }
      if (document) {
        if (!documentIndex.has(document)) documentIndex.set(document, []);
        documentIndex.get(document).push(contact);
      }
    }

    const importedRows = [];
    const skippedDuplicates = [];
    const skippedInvalid = [];
    const importErrors = [];
    let duplicatePhoneCount = 0;
    let duplicateDocumentCount = 0;
    let invalidCount = 0;
    let createdWithName = 0;
    let createdWithoutName = 0;
    let createdWithDocument = 0;
    let createdWithoutDocument = 0;

    await run(db, "BEGIN TRANSACTION");

    for (const row of inputRows) {
      const mobileNormalized = row.mobile_normalized;
      const document = row.document;

      if (!mobileNormalized) {
        invalidCount += 1;
        skippedInvalid.push({
          source_row_number: row.source_row_number,
          name: row.raw_name || row.name || "",
          mobile: row.mobile || "",
          mobile_normalized: "",
          document,
          reason: "invalid_phone"
        });
        continue;
      }

      const existingPhoneMatches = phoneIndex.get(mobileNormalized) || [];
      if (existingPhoneMatches.length) {
        duplicatePhoneCount += 1;
        skippedDuplicates.push({
          source_row_number: row.source_row_number,
          name: row.raw_name || row.name || "",
          mobile_normalized: mobileNormalized,
          document,
          reason: "skipped_duplicate_phone",
          existing_contact_ids: existingPhoneMatches.map((item) => item.id).join("|")
        });
        continue;
      }

      const existingDocumentMatches = document ? (documentIndex.get(document) || []) : [];
      if (document && existingDocumentMatches.length) {
        duplicateDocumentCount += 1;
        skippedDuplicates.push({
          source_row_number: row.source_row_number,
          name: row.raw_name || row.name || "",
          mobile_normalized: mobileNormalized,
          document,
          reason: "skipped_duplicate_document",
          existing_contact_ids: existingDocumentMatches.map((item) => item.id).join("|")
        });
        continue;
      }

      const finalName = row.name || "Cliente CRM Bonus";
      const finalFirstName = row.name ? (row.first_name || firstName(row.name)) : "Cliente";
      const qualityFlags = [...row.quality_flags, "imported_from_crm_bonus_backup"];
      if (!row.name) {
        qualityFlags.push("needs_name_review");
      }
      const finalNotes = [
        "Cliente criado a partir do backup de clientes do CRM Bonus para conciliacao historica de cashback.",
        row.notes
      ].filter(Boolean).join(" | ");

      try {
        const insertResult = await run(
          db,
          `INSERT INTO contacts
           (name, first_name, phone, mobile, mobile_normalized, document, status, source, quality_flags, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          [
            finalName,
            finalFirstName,
            row.mobile || mobileNormalized,
            row.mobile || mobileNormalized,
            mobileNormalized,
            document,
            "ativo",
            "crm_bonus_customer_backup",
            flagsToString(qualityFlags),
            finalNotes
          ]
        );

        const insertedContact = {
          id: insertResult.lastID,
          mobile_normalized: mobileNormalized,
          document
        };
        if (!phoneIndex.has(mobileNormalized)) phoneIndex.set(mobileNormalized, []);
        phoneIndex.get(mobileNormalized).push(insertedContact);
        if (document) {
          if (!documentIndex.has(document)) documentIndex.set(document, []);
          documentIndex.get(document).push(insertedContact);
        }

        if (row.name) createdWithName += 1;
        else createdWithoutName += 1;
        if (document) createdWithDocument += 1;
        else createdWithoutDocument += 1;

        importedRows.push({
          contact_id: insertResult.lastID,
          source_row_number: row.source_row_number,
          name: finalName,
          first_name: finalFirstName,
          mobile: row.mobile || mobileNormalized,
          mobile_normalized: mobileNormalized,
          document,
          source: "crm_bonus_customer_backup",
          status: "ativo",
          quality_flags: flagsToString(qualityFlags),
          notes: finalNotes
        });
      } catch (error) {
        importErrors.push({
          source_row_number: row.source_row_number,
          name: row.raw_name || row.name || "",
          mobile_normalized: mobileNormalized,
          document,
          error: error.message || "insert_failed"
        });
      }
    }

    await run(db, "COMMIT");

    const skippedCount = skippedDuplicates.length + skippedInvalid.length;
    const summary = {
      totalRead: inputRows.length,
      importedCount: importedRows.length,
      skippedCount,
      duplicatePhoneCount,
      duplicateDocumentCount,
      invalidCount,
      errorCount: importErrors.length,
      createdWithName,
      createdWithoutName,
      createdWithDocument,
      createdWithoutDocument,
      contactsBefore: Number(contactsBefore?.total || 0),
      contactsAfter: Number(contactsBefore?.total || 0) + importedRows.length
    };

    await run(
      db,
      `UPDATE customer_import_batches
       SET status = ?, imported_count = ?, skipped_count = ?, duplicate_phone_count = ?, duplicate_document_count = ?, invalid_count = ?, error_count = ?, summary_json = ?, finished_at = ?
       WHERE id = ?`,
      [
        importErrors.length ? "completed_with_errors" : "completed",
        importedRows.length,
        skippedCount,
        duplicatePhoneCount,
        duplicateDocumentCount,
        invalidCount,
        importErrors.length,
        JSON.stringify(summary),
        nowIso(),
        batchId
      ]
    );

    writeCsv(path.join(outputDir, "imported_customers.csv"), importedRows, [
      "contact_id",
      "source_row_number",
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
    writeCsv(path.join(outputDir, "skipped_duplicates.csv"), skippedDuplicates, [
      "source_row_number",
      "name",
      "mobile_normalized",
      "document",
      "reason",
      "existing_contact_ids"
    ]);
    writeCsv(path.join(outputDir, "skipped_invalid.csv"), skippedInvalid, [
      "source_row_number",
      "name",
      "mobile",
      "mobile_normalized",
      "document",
      "reason"
    ]);
    writeCsv(path.join(outputDir, "import_errors.csv"), importErrors, [
      "source_row_number",
      "name",
      "mobile_normalized",
      "document",
      "error"
    ]);

    const reportJson = {
      generated_at: nowIso(),
      batch_id: batchId,
      source_file: inputFile,
      total_read: inputRows.length,
      total_imported: importedRows.length,
      total_skipped_duplicate_phone: duplicatePhoneCount,
      total_skipped_duplicate_document: duplicateDocumentCount,
      total_invalid: invalidCount,
      total_errors: importErrors.length,
      total_with_name: createdWithName,
      total_without_name: createdWithoutName,
      total_with_document: createdWithDocument,
      total_without_document: createdWithoutDocument,
      source_confirmed: "crm_bonus_customer_backup",
      existing_contacts_unchanged_confirmed: true,
      cashback_not_imported_confirmed: true
    };
    const reportMd = `# Importacao controlada de clientes seguros do backup CRM Bonus

- Batch: ${batchId}
- Total lido: ${inputRows.length}
- Total importado: ${importedRows.length}
- Duplicidade por telefone: ${duplicatePhoneCount}
- Duplicidade por documento: ${duplicateDocumentCount}
- Invalidos: ${invalidCount}
- Erros: ${importErrors.length}
- Criados com nome: ${createdWithName}
- Criados sem nome: ${createdWithoutName}
- Criados com CPF: ${createdWithDocument}
- Criados sem CPF: ${createdWithoutDocument}

## Garantias
- Nenhum cliente existente foi alterado.
- Nenhum cashback foi importado.
- Source salvo como crm_bonus_customer_backup.
- Status operacional salvo como ativo para manter compatibilidade com o CRM atual.
`;
    fs.writeFileSync(path.join(outputDir, "crm_bonus_safe_customers_import_report.md"), reportMd, "utf8");
    writeJson(path.join(outputDir, "crm_bonus_safe_customers_import_report.json"), reportJson);
    fs.writeFileSync(path.join(outputDir, "README.md"), "Importacao controlada de clientes seguros do backup CRM Bonus.\n", "utf8");

    console.log(JSON.stringify({
      ok: true,
      batchId,
      totalRead: inputRows.length,
      importedCount: importedRows.length,
      duplicatePhoneCount,
      duplicateDocumentCount,
      invalidCount,
      errorCount: importErrors.length,
      createdWithName,
      createdWithoutName
    }, null, 2));
  } catch (error) {
    if (batchId) {
      try {
        await run(
          db,
          `UPDATE customer_import_batches
           SET status = 'failed', finished_at = ?, summary_json = ?
           WHERE id = ?`,
          [nowIso(), JSON.stringify({ error: error.message || "unknown_error" }), batchId]
        );
      } catch (secondaryError) {
        console.error("Falha ao marcar batch como failed:", secondaryError);
      }
    }
    throw error;
  } finally {
    await closeDatabase(db);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
