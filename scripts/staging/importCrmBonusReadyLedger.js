#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { blockProduction, requireExplicitConfirmation, warnLocalOnly } = require("../scriptSafety");

blockProduction("staging/importCrmBonusReadyLedger.js");
warnLocalOnly("staging/importCrmBonusReadyLedger.js");

const DEFAULT_BASE = path.join("_crm_bonus_exports", "2026-05-15-readonly-extraction");
const DEFAULT_DB = path.join("data", "aerostore-crm.sqlite");

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

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizePhoneBR(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length === 12 || digits.length === 13) return digits.startsWith("55") ? digits : "";
  return "";
}

function normalizeDocument(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizeEmail(value = "") {
  return normalizeText(value).toLowerCase();
}

function parseMoney(value = "") {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
  }
  const text = normalizeText(value);
  if (!text) return 0;
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const direct = Number(text);
    return Number.isFinite(direct) ? Number(direct.toFixed(2)) : 0;
  }
  const sanitized = text
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  const text = normalizeText(value).toLowerCase();
  return text === "true" || text === "1" || text === "yes" || text === "sim";
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

function parseCsv(filePath) {
  const buffer = fs.readFileSync(filePath);
  const content = buffer.toString(chooseCsvEncoding(buffer)).replace(/^\uFEFF/, "");
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) return { headers: [], rows: [] };
  const separator = lines[0].includes(";") ? ";" : ",";
  const matrix = lines.map((line) => parseDelimitedLine(line, separator));
  const headers = matrix[0].map((header) => normalizeText(header));
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

async function ensureLedgerTables(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS customer_cashback_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      contact_id INTEGER,
      source_system TEXT NOT NULL DEFAULT '',
      source_import_id TEXT DEFAULT '',
      source_file TEXT NOT NULL DEFAULT '',
      source_row_number INTEGER NOT NULL DEFAULT 0,
      external_event_id TEXT DEFAULT '',
      external_customer_key TEXT DEFAULT '',
      customer_name_snapshot TEXT DEFAULT '',
      customer_phone_snapshot TEXT DEFAULT '',
      customer_document_snapshot TEXT DEFAULT '',
      customer_email_snapshot TEXT DEFAULT '',
      ledger_type TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL DEFAULT '',
      store TEXT DEFAULT '',
      seller TEXT DEFAULT '',
      purchase_date TEXT DEFAULT '',
      purchase_amount REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      balance_amount REAL NOT NULL DEFAULT 0,
      used_amount REAL NOT NULL DEFAULT 0,
      valid_from TEXT DEFAULT '',
      valid_until TEXT DEFAULT '',
      used_at TEXT DEFAULT '',
      expired_at TEXT DEFAULT '',
      cancelled_at TEXT DEFAULT '',
      reactivated_at TEXT DEFAULT '',
      match_method TEXT DEFAULT '',
      match_confidence TEXT DEFAULT '',
      import_ready INTEGER NOT NULL DEFAULT 0,
      import_batch_id INTEGER,
      reactivation_potential TEXT DEFAULT '',
      campaign_segment TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      raw_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT DEFAULT ''
    )`
  );
  await run(
    db,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_cashback_ledger_source_row ON customer_cashback_ledger(source_system, source_file, source_row_number)`
  );
  await run(db, `CREATE INDEX IF NOT EXISTS idx_customer_cashback_ledger_contact_id ON customer_cashback_ledger(contact_id)`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_customer_cashback_ledger_status ON customer_cashback_ledger(status)`);

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS cashback_import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_system TEXT NOT NULL DEFAULT '',
      import_type TEXT NOT NULL DEFAULT '',
      source_folder TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      total_rows INTEGER NOT NULL DEFAULT 0,
      import_ready_rows INTEGER NOT NULL DEFAULT 0,
      imported_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      blocked_count INTEGER NOT NULL DEFAULT 0,
      total_amount_imported REAL NOT NULL DEFAULT 0,
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
  const baseDir = path.resolve(options.base);
  const reconciliationDir = path.join(baseDir, "reconciliation");
  const importDir = path.join(baseDir, "import-ready-ledger-incremental");
  const dbPath = path.resolve(DEFAULT_DB);

  ensureDir(importDir);

  const previewPath = path.join(reconciliationDir, "crm_bonus_lost_cashback_import_preview.csv");
  const campaignPath = path.join(reconciliationDir, "crm_bonus_reactivation_campaign_candidates.csv");
  if (!fs.existsSync(previewPath)) {
    throw new Error(`Arquivo obrigatorio ausente: ${previewPath}`);
  }
  if (!fs.existsSync(campaignPath)) {
    throw new Error(`Arquivo obrigatorio ausente: ${campaignPath}`);
  }

  const previewRows = parseCsv(previewPath).rows;
  const campaignRows = parseCsv(campaignPath).rows;

  const campaignIndex = new Map();
  for (const row of campaignRows) {
    const key = normalizePhoneBR(row.phone_normalized || "");
    if (!key) continue;
    campaignIndex.set(key, row);
  }

  const eligibleRows = previewRows.filter((row) =>
    parseBoolean(row.import_ready) &&
    parseBoolean(row.crm_customer_exists) &&
    Number(row.crm_customer_id || 0) > 0 &&
    normalizeText(row.match_confidence || "") === "high" &&
    ["expired", "lost"].includes(normalizeText(row.normalized_status || "")) &&
    ["expired", "lost"].includes(normalizeText(row.ledger_type || row.normalized_status || "")) &&
    parseMoney(row.bonus_amount || 0) > 0 &&
    !normalizeText(row.import_block_reason || "") &&
    !parseBoolean(row.needs_review) &&
    !["REVIEW_MANUALLY", "CREATE_MINIMAL_CUSTOMER_LATER"].includes(normalizeText(row.action_suggested || ""))
  );

  const db = await openDatabase(dbPath);
  let batchId = null;
  try {
    await ensureLedgerTables(db);
    const startedAt = nowIso();
    const batchInsert = await run(
      db,
      `INSERT INTO cashback_import_batches
       (source_system, import_type, source_folder, status, total_rows, import_ready_rows, imported_count, skipped_count, error_count, blocked_count, total_amount_imported, summary_json, started_at, finished_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 0, '{}', ?, '', ?)`,
      [
        "crm_bonus",
        "lost_cashback_import_ready_incremental",
        baseDir,
        "running",
        previewRows.length,
        eligibleRows.length,
        Math.max(0, previewRows.length - eligibleRows.length),
        startedAt,
        "codex_script"
      ]
    );
    batchId = batchInsert.lastID;

    const existingRows = await all(
      db,
      `SELECT source_system, source_file, source_row_number
       FROM customer_cashback_ledger
       WHERE source_system = 'crm_bonus' AND COALESCE(deleted_at, '') = ''`
    );
    const existingKeys = new Set(existingRows.map((row) => `crm_bonus|${row.source_file}|${row.source_row_number}`));

    const importedRows = [];
    const skippedDuplicates = [];
    const importErrors = [];
    let totalImportedAmount = 0;
    const impactedCustomers = new Set();

    await run(db, "BEGIN TRANSACTION");
    for (const row of eligibleRows) {
      const duplicateKey = `crm_bonus|${row.source_file}|${row.source_row_number}`;
      if (existingKeys.has(duplicateKey)) {
        skippedDuplicates.push({
          source_file: row.source_file || "",
          source_row_number: Number(row.source_row_number || 0),
          crm_customer_id: Number(row.crm_customer_id || 0),
          customer_name: row.customer_name || "",
          bonus_amount: parseMoney(row.bonus_amount || 0),
          reason: "duplicate_source_row"
        });
        continue;
      }

      const contactId = Number(row.crm_customer_id || 0);
      const customerExists = await get(
        db,
        "SELECT id, name FROM contacts WHERE id = ? AND COALESCE(deleted_at, '') = ''",
        [contactId]
      );
      if (!customerExists) {
        importErrors.push({
          source_file: row.source_file || "",
          source_row_number: Number(row.source_row_number || 0),
          crm_customer_id: contactId,
          customer_name: row.customer_name || "",
          bonus_amount: parseMoney(row.bonus_amount || 0),
          error: "linked_customer_not_found"
        });
        continue;
      }

      const status = ["expired", "lost"].includes(normalizeText(row.normalized_status || "")) ? normalizeText(row.normalized_status || "") : "lost";
      const ledgerType = ["expired", "lost"].includes(status) ? status : "lost";
      const amount = parseMoney(row.bonus_amount || 0);
      const campaign = campaignIndex.get(normalizePhoneBR(row.customer_phone_normalized || row.customer_phone_original || "")) || {};
      const notes = [
        `CRM Bonus status original: ${normalizeText(row.crm_bonus_status_original || "-")}`,
        normalizeText(row.notes || ""),
        "Historico importado do CRM Bonus sem saldo utilizavel."
      ].filter(Boolean).join(" | ");

      const result = await run(
        db,
        `INSERT INTO customer_cashback_ledger
         (customer_id, contact_id, source_system, source_import_id, source_file, source_row_number, external_event_id, external_customer_key,
          customer_name_snapshot, customer_phone_snapshot, customer_document_snapshot, customer_email_snapshot,
          ledger_type, status, origin, store, seller, purchase_date, purchase_amount, amount, balance_amount, used_amount,
          valid_from, valid_until, used_at, expired_at, cancelled_at, reactivated_at, match_method, match_confidence, import_ready,
          import_batch_id, reactivation_potential, campaign_segment, notes, raw_json, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')`,
        [
          contactId,
          contactId,
          "crm_bonus",
          String(batchId),
          row.source_file || "",
          Number(row.source_row_number || 0),
          row.crm_bonus_id || "",
          normalizePhoneBR(row.customer_phone_normalized || row.customer_phone_original || "") || row.crm_bonus_id || "",
          row.customer_name || "",
          normalizePhoneBR(row.customer_phone_normalized || row.customer_phone_original || ""),
          normalizeDocument(row.customer_document || ""),
          normalizeEmail(row.customer_email || ""),
          ledgerType,
          status,
          "crm_bonus_import",
          "",
          "",
          normalizeText(row.purchase_date || ""),
          parseMoney(row.purchase_amount || 0),
          amount,
          parseMoney(row.bonus_balance || 0),
          0,
          normalizeText(row.valid_from || ""),
          normalizeText(row.valid_until || ""),
          "",
          normalizeText(row.expired_at || row.valid_until || ""),
          "",
          "",
          row.match_method || "",
          row.match_confidence || "",
          1,
          batchId,
          normalizeText(row.campaign_reactivation_potential || campaign.campaign_reactivation_potential || "LOW").toUpperCase(),
          normalizeText(campaign.suggested_campaign_segment || ""),
          notes,
          JSON.stringify(row),
          nowIso(),
          nowIso()
        ]
      );

      existingKeys.add(duplicateKey);
      totalImportedAmount += amount;
      impactedCustomers.add(contactId);
      importedRows.push({
        ledger_id: result.lastID,
        contact_id: contactId,
        customer_name: row.customer_name || "",
        customer_phone_normalized: normalizePhoneBR(row.customer_phone_normalized || row.customer_phone_original || ""),
        source_file: row.source_file || "",
        source_row_number: Number(row.source_row_number || 0),
        external_event_id: row.crm_bonus_id || "",
        status,
        ledger_type: ledgerType,
        amount,
        purchase_date: normalizeText(row.purchase_date || ""),
        valid_until: normalizeText(row.valid_until || ""),
        expired_at: normalizeText(row.expired_at || row.valid_until || ""),
        reactivation_potential: normalizeText(row.campaign_reactivation_potential || campaign.campaign_reactivation_potential || "LOW").toUpperCase(),
        campaign_segment: normalizeText(campaign.suggested_campaign_segment || ""),
        origin: "crm_bonus_import"
      });
    }
    await run(db, "COMMIT");

    const summary = {
      totalRead: previewRows.length,
      eligibleImportReady: eligibleRows.length,
      importedCount: importedRows.length,
      skippedDuplicates: skippedDuplicates.length,
      errorCount: importErrors.length,
      blockedCount: Math.max(0, previewRows.length - eligibleRows.length),
      totalAmountImported: Number(totalImportedAmount.toFixed(2)),
      impactedCustomers: impactedCustomers.size
    };

    await run(
      db,
      `UPDATE cashback_import_batches
       SET status = ?, imported_count = ?, skipped_count = ?, error_count = ?, blocked_count = ?, total_amount_imported = ?, summary_json = ?, finished_at = ?
       WHERE id = ?`,
      [
        importErrors.length ? "completed_with_errors" : "completed",
        importedRows.length,
        skippedDuplicates.length,
        importErrors.length,
        summary.blockedCount,
        summary.totalAmountImported,
        JSON.stringify(summary),
        nowIso(),
        batchId
      ]
    );

    const topCustomers = Array.from(
      importedRows.reduce((map, row) => {
        const current = map.get(String(row.contact_id)) || {
          contact_id: row.contact_id,
          customer_name: row.customer_name,
          total_amount: 0,
          events: 0
        };
        current.total_amount += Number(row.amount || 0);
        current.events += 1;
        map.set(String(row.contact_id), current);
        return map;
      }, new Map()).values()
    )
      .sort((left, right) => right.total_amount - left.total_amount)
      .slice(0, 20)
      .map((item) => ({
        ...item,
        total_amount: Number(item.total_amount.toFixed(2))
      }));

    writeCsv(path.join(importDir, "imported_events.csv"), importedRows, [
      "ledger_id",
      "contact_id",
      "customer_name",
      "customer_phone_normalized",
      "source_file",
      "source_row_number",
      "external_event_id",
      "status",
      "ledger_type",
      "amount",
      "purchase_date",
      "valid_until",
      "expired_at",
      "reactivation_potential",
      "campaign_segment",
      "origin"
    ]);
    writeCsv(path.join(importDir, "skipped_duplicates.csv"), skippedDuplicates, [
      "source_file",
      "source_row_number",
      "crm_customer_id",
      "customer_name",
      "bonus_amount",
      "reason"
    ]);
    writeCsv(path.join(importDir, "import_errors.csv"), importErrors, [
      "source_file",
      "source_row_number",
      "crm_customer_id",
      "customer_name",
      "bonus_amount",
      "error"
    ]);

    const reportJson = {
      generated_at: nowIso(),
      batch_id: batchId,
      total_read: previewRows.length,
      total_eligible_import_ready: eligibleRows.length,
      total_imported: importedRows.length,
      skipped_duplicates: skippedDuplicates.length,
      errors: importErrors.length,
      blocked_count: summary.blockedCount,
      total_amount_imported: summary.totalAmountImported,
      customers_impacted: summary.impactedCustomers,
      top_customers: topCustomers,
      blocked_not_imported_confirmed: true,
      source_system: "crm_bonus",
      import_type: "lost_cashback_import_ready_incremental"
    };
    const reportMd = `# Importacao CRM Bonus -> customer_cashback_ledger

- Batch: ${batchId}
- Total lido: ${previewRows.length}
- Total elegivel import_ready: ${eligibleRows.length}
- Total importado: ${importedRows.length}
- Duplicados pulados: ${skippedDuplicates.length}
- Erros: ${importErrors.length}
- Valor total importado: R$ ${summary.totalAmountImported.toFixed(2)}
- Clientes impactados: ${summary.impactedCustomers}
- Confirmacao: bloqueados nao foram importados.

## Top 20 clientes por valor perdido importado
${topCustomers.map((item, index) => `${index + 1}. #${item.contact_id} ${item.customer_name} - R$ ${Number(item.total_amount || 0).toFixed(2)} (${item.events} eventos)`).join("\n") || "- Nenhum"}

## Seguranca
- Nenhum cliente novo foi criado.
- A tabela contacts nao foi alterada.
- Os eventos importados entraram apenas como historico vencido/perdido.
- Nenhum valor foi convertido em saldo disponivel.
`;
    fs.writeFileSync(path.join(importDir, "crm_bonus_incremental_ledger_import_report.md"), reportMd, "utf8");
    writeJson(path.join(importDir, "crm_bonus_incremental_ledger_import_report.json"), reportJson);

    console.log(JSON.stringify({
      ok: true,
      batchId,
      totalRead: previewRows.length,
      eligibleImportReady: eligibleRows.length,
      importedCount: importedRows.length,
      skippedDuplicates: skippedDuplicates.length,
      errorCount: importErrors.length,
      blockedCount: summary.blockedCount,
      totalAmountImported: summary.totalAmountImported,
      impactedCustomers: summary.impactedCustomers
    }, null, 2));
  } catch (error) {
    if (batchId) {
      try {
        await run(
          db,
          `UPDATE cashback_import_batches
           SET status = 'failed', finished_at = ?, summary_json = ?
           WHERE id = ?`,
          [nowIso(), JSON.stringify({ error: error.message || "unknown_error" }), batchId]
        );
      } catch (secondaryError) {
        console.error("Falha ao atualizar batch como failed:", secondaryError);
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
