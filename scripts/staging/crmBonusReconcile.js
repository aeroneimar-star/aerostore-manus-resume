#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DEFAULT_BASE = path.join("_crm_bonus_exports", "2026-05-15-readonly-extraction");
const DEFAULT_DB = path.join("data", "aerostore-crm.sqlite");

function parseArgs(argv) {
  const options = {
    base: DEFAULT_BASE
  };

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
    .replace(/[^\w@.]+/g, " ")
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
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  if (digits.length === 12 || digits.length === 13) {
    return digits.startsWith("55") ? digits : "";
  }
  return "";
}

function normalizeDocument(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizeEmail(value = "") {
  return normalizeText(value).toLowerCase();
}

function normalizeName(value = "") {
  return normalizeHeader(value).replace(/\s+/g, " ").trim();
}

function firstName(value = "") {
  return normalizeText(value).split(" ").filter(Boolean)[0] || "";
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

function safeDate(value = "") {
  const text = normalizeText(value);
  return text || "";
}

function compareIsoDates(left = "", right = "") {
  return safeDate(left).localeCompare(safeDate(right));
}

function latestDate(...dates) {
  return dates.filter(Boolean).sort(compareIsoDates).pop() || "";
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

function getCustomerKey(customer = {}) {
  if (customer.phone_normalized) return `phone:${customer.phone_normalized}`;
  if (customer.document) return `document:${customer.document}`;
  if (customer.email) return `email:${customer.email}`;
  return `name:${normalizeName(customer.customer_name)}|phone:${normalizeHeader(customer.phone_original)}`;
}

function detectActionSuggestion(match) {
  const exists = parseBoolean(match.crm_customer_exists);
  if (match.match_confidence === "high" && exists) {
    return "LINK_TO_EXISTING_CUSTOMER";
  }
  if (!exists && match.crm_bonus_phone_normalized) {
    return "CREATE_MINIMAL_CUSTOMER_LATER";
  }
  if (parseBoolean(match.needs_review)) {
    return "REVIEW_MANUALLY";
  }
  return "IGNORE";
}

function normalizeContactRow(row = {}) {
  const mobileNormalized = normalizePhoneBR(row.mobile_normalized || row.mobile || row.phone || "");
  return {
    crm_customer_id: row.id,
    crm_customer_name: normalizeText(row.name || ""),
    crm_customer_phone_normalized: mobileNormalized,
    crm_customer_document: normalizeDocument(row.document || ""),
    crm_customer_email: normalizeEmail(row.email || ""),
    crm_customer_status: normalizeText(row.status || ""),
    crm_customer_source: normalizeText(row.source || ""),
    deleted_at: normalizeText(row.deleted_at || ""),
    raw: row
  };
}

function buildIndexes(contacts) {
  const phoneIndex = new Map();
  const documentIndex = new Map();
  const emailIndex = new Map();
  const nameIndex = new Map();

  for (const contact of contacts) {
    if (contact.crm_customer_phone_normalized) {
      if (!phoneIndex.has(contact.crm_customer_phone_normalized)) {
        phoneIndex.set(contact.crm_customer_phone_normalized, []);
      }
      phoneIndex.get(contact.crm_customer_phone_normalized).push(contact);
    }
    if (contact.crm_customer_document) {
      if (!documentIndex.has(contact.crm_customer_document)) {
        documentIndex.set(contact.crm_customer_document, []);
      }
      documentIndex.get(contact.crm_customer_document).push(contact);
    }
    if (contact.crm_customer_email) {
      if (!emailIndex.has(contact.crm_customer_email)) {
        emailIndex.set(contact.crm_customer_email, []);
      }
      emailIndex.get(contact.crm_customer_email).push(contact);
    }
    const normalized = normalizeName(contact.crm_customer_name);
    if (normalized) {
      if (!nameIndex.has(normalized)) {
        nameIndex.set(normalized, []);
      }
      nameIndex.get(normalized).push(contact);
    }
  }

  return { phoneIndex, documentIndex, emailIndex, nameIndex };
}

function pickSingleMatch(matches = []) {
  if (matches.length === 1) return matches[0];
  return null;
}

function findContactMatch(bonusCustomer, indexes) {
  const notes = [];
  const phone = normalizePhoneBR(bonusCustomer.phone_normalized || bonusCustomer.crm_bonus_phone_normalized || bonusCustomer.phone_original || "");
  const document = normalizeDocument(bonusCustomer.document || bonusCustomer.crm_bonus_document || "");
  const email = normalizeEmail(bonusCustomer.email || bonusCustomer.crm_bonus_email || "");
  const normalizedName = normalizeName(bonusCustomer.customer_name || bonusCustomer.crm_bonus_customer_name || "");

  if (phone) {
    const phoneMatches = indexes.phoneIndex.get(phone) || [];
    const singlePhone = pickSingleMatch(phoneMatches);
    if (singlePhone) {
      return {
        crm_customer_exists: true,
        contact: singlePhone,
        match_method: "phone_normalized",
        match_confidence: "high",
        needs_review: false,
        notes: ""
      };
    }
    if (phoneMatches.length > 1) {
      notes.push(`Telefone vinculado a ${phoneMatches.length} clientes no CRM.`);
    }
  }

  if (document) {
    const docMatches = indexes.documentIndex.get(document) || [];
    const singleDocument = pickSingleMatch(docMatches);
    if (singleDocument) {
      return {
        crm_customer_exists: true,
        contact: singleDocument,
        match_method: "document",
        match_confidence: "high",
        needs_review: false,
        notes: notes.join(" ")
      };
    }
    if (docMatches.length > 1) {
      notes.push(`Documento vinculado a ${docMatches.length} clientes no CRM.`);
    }
  }

  if (email) {
    const emailMatches = indexes.emailIndex.get(email) || [];
    const singleEmail = pickSingleMatch(emailMatches);
    if (singleEmail) {
      return {
        crm_customer_exists: true,
        contact: singleEmail,
        match_method: "email",
        match_confidence: "medium",
        needs_review: false,
        notes: notes.join(" ")
      };
    }
    if (emailMatches.length > 1) {
      notes.push(`E-mail vinculado a ${emailMatches.length} clientes no CRM.`);
    }
  }

  if (normalizedName) {
    const nameMatches = indexes.nameIndex.get(normalizedName) || [];
    const singleName = pickSingleMatch(nameMatches);
    if (singleName) {
      return {
        crm_customer_exists: true,
        contact: singleName,
        match_method: "exact_name",
        match_confidence: "low",
        needs_review: true,
        notes: [notes.join(" "), "Match apenas por nome exato."].filter(Boolean).join(" ")
      };
    }
  }

  return {
    crm_customer_exists: false,
    contact: null,
    match_method: "",
    match_confidence: "none",
    needs_review: false,
    notes: notes.join(" ")
  };
}

function hasHighConfidenceMatch(match) {
  return parseBoolean(match.crm_customer_exists) && match.match_confidence === "high";
}

function buildCampaignSegment(summaryRow, match) {
  const totalLost = parseMoney(summaryRow.lost_amount || 0);
  const totalEvents = Number(summaryRow.total_events || 0);
  const lastLostDate = safeDate(summaryRow.last_event_date || "");

  if (totalLost >= 100) return "HIGH_VALUE_LOST";
  if (totalEvents >= 3) return "REPEATED_LOST";
  if (lastLostDate >= "2021-01-01") return "RECENT_LOST";
  if (match.crm_customer_exists) return "HAS_CRM_MATCH";
  if (!match.crm_customer_exists && normalizePhoneBR(summaryRow.phone_normalized || "")) return "NEW_FROM_CRM_BONUS";
  return "REVIEW_MANUAL_SEGMENT";
}

function buildMessageAngle(segment) {
  if (segment === "HIGH_VALUE_LOST") return "reativacao de beneficio";
  if (segment === "RECENT_LOST") return "cliente deixou bonus expirar";
  if (segment === "REPEATED_LOST") return "resgate de relacionamento";
  if (segment === "HAS_CRM_MATCH") return "condicao especial para voltar";
  if (segment === "NEW_FROM_CRM_BONUS") return "reativacao de beneficio";
  return "revisar abordagem manual";
}

function summarizeWarnings(rows) {
  const counts = new Map();
  for (const row of rows) {
    const reason = normalizeText(row.reason || "warning_sem_motivo");
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([reason, count]) => ({ reason, count }));
}

function asBoolText(value) {
  return value ? "true" : "false";
}

async function main() {
  const options = parseArgs(process.argv);
  const baseDir = path.resolve(options.base);
  const normalizedDir = path.join(baseDir, "normalized");
  const rejectedDir = path.join(baseDir, "rejected");
  const reconciliationDir = path.join(baseDir, "reconciliation");
  const dbPath = path.resolve(DEFAULT_DB);

  ensureDir(reconciliationDir);

  const requiredFiles = [
    path.join(normalizedDir, "crm_bonus_bonus_ledger.csv"),
    path.join(normalizedDir, "crm_bonus_customers.csv"),
    path.join(normalizedDir, "crm_bonus_bonus_summary_by_customer.csv"),
    path.join(rejectedDir, "warnings.csv")
  ];

  for (const filePath of requiredFiles) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo obrigatorio ausente: ${filePath}`);
    }
  }

  const ledgerCsv = parseCsv(path.join(normalizedDir, "crm_bonus_bonus_ledger.csv"));
  const customersCsv = parseCsv(path.join(normalizedDir, "crm_bonus_customers.csv"));
  const summaryCsv = parseCsv(path.join(normalizedDir, "crm_bonus_bonus_summary_by_customer.csv"));
  const warningsCsv = parseCsv(path.join(rejectedDir, "warnings.csv"));

  const db = await openReadOnlyDatabase(dbPath);
  let contactRows = [];
  try {
    contactRows = await allReadOnly(
      db,
      `SELECT id, name, mobile, mobile_normalized, phone, document, email, status, source, deleted_at
       FROM contacts`
    );
  } finally {
    await closeDatabase(db);
  }

  const contacts = contactRows
    .map(normalizeContactRow)
    .filter((row) => !row.deleted_at);
  const indexes = buildIndexes(contacts);

  const summaryByKey = new Map();
  for (const row of summaryCsv.rows) {
    summaryByKey.set(normalizeText(row.customer_key || ""), row);
  }

  const customerMatches = customersCsv.rows.map((row) => {
    const summary = summaryByKey.get(normalizeText(row.customer_key || "")) || {};
    const match = findContactMatch(row, indexes);
    const contact = match.contact || {};
    const customerPreview = {
      crm_bonus_customer_key: row.customer_key || "",
      crm_bonus_customer_name: row.customer_name || "",
      crm_bonus_phone_original: row.phone_original || "",
      crm_bonus_phone_normalized: normalizePhoneBR(row.phone_normalized || row.phone_original || ""),
      crm_bonus_document: normalizeDocument(row.document || ""),
      crm_bonus_email: normalizeEmail(row.email || ""),
      crm_bonus_available_amount: parseMoney(summary.available_amount || row.total_bonus_available || 0),
      crm_bonus_pending_amount: parseMoney(summary.pending_amount || row.total_bonus_pending || 0),
      crm_bonus_used_amount: parseMoney(summary.used_amount || row.total_bonus_used || 0),
      crm_bonus_expired_amount: parseMoney(summary.expired_amount || row.total_bonus_expired || 0),
      crm_bonus_lost_amount: parseMoney(summary.lost_amount || 0),
      crm_bonus_cancelled_amount: parseMoney(summary.cancelled_amount || row.total_bonus_cancelled || 0),
      crm_bonus_generated_amount: parseMoney(summary.generated_amount || row.total_bonus_generated || 0),
      crm_bonus_total_events: Number(summary.total_events || 0),
      crm_bonus_last_event_date: safeDate(summary.last_event_date || row.last_bonus_date || ""),
      campaign_reactivation_potential: normalizeText(summary.campaign_reactivation_potential || "LOW"),
      crm_customer_exists: asBoolText(match.crm_customer_exists),
      crm_customer_id: contact.crm_customer_id || "",
      crm_customer_name: contact.crm_customer_name || "",
      crm_customer_phone_normalized: contact.crm_customer_phone_normalized || "",
      crm_customer_document: contact.crm_customer_document || "",
      crm_customer_email: contact.crm_customer_email || "",
      crm_customer_status: contact.crm_customer_status || "",
      crm_customer_source: contact.crm_customer_source || "",
      match_method: match.match_method || "",
      match_confidence: match.match_confidence,
      needs_review: asBoolText(match.needs_review),
      action_suggested: "",
      notes: match.notes || ""
    };
    customerPreview.action_suggested = detectActionSuggestion(customerPreview);
    return customerPreview;
  });

  const customerMatchIndex = new Map();
  for (const row of customerMatches) {
    customerMatchIndex.set(normalizeText(row.crm_bonus_customer_key), row);
  }

  const importPreview = ledgerCsv.rows.map((row) => {
    const customerKey = getCustomerKey({
      phone_normalized: row.customer_phone_normalized || "",
      document: row.customer_document || "",
      email: row.customer_email || "",
      customer_name: row.customer_name || "",
      phone_original: row.customer_phone_original || ""
    });
    const match = customerMatchIndex.get(customerKey) || {
      crm_customer_exists: "false",
      crm_customer_id: "",
      match_method: "",
      match_confidence: "none",
      needs_review: "false",
      action_suggested: normalizePhoneBR(row.customer_phone_normalized || row.customer_phone_original || "")
        ? "CREATE_MINIMAL_CUSTOMER_LATER"
        : "REVIEW_MANUALLY",
      campaign_reactivation_potential: "LOW",
      notes: "Cliente nao localizado no resumo consolidado."
    };

    const bonusAmount = parseMoney(row.bonus_amount || 0);
    const normalizedStatus = normalizeText(row.normalized_status || "");
    const importReady =
      ["expired", "lost"].includes(normalizedStatus) &&
      bonusAmount > 0 &&
      hasHighConfidenceMatch(match);
    let importBlockReason = "";
    if (!["expired", "lost"].includes(normalizedStatus)) {
      importBlockReason = "status_not_lost_or_expired";
    } else if (!(bonusAmount > 0)) {
      importBlockReason = "invalid_bonus_amount";
    } else if (!hasHighConfidenceMatch(match)) {
      importBlockReason = "missing_high_confidence_customer_match";
    }

    return {
      source_file: row.source_file || "",
      source_row_number: Number(row.source_row_number || 0),
      crm_bonus_id: row.crm_bonus_id || "",
      customer_name: row.customer_name || "",
      customer_phone_original: row.customer_phone_original || "",
      customer_phone_normalized: normalizePhoneBR(row.customer_phone_normalized || row.customer_phone_original || ""),
      customer_document: normalizeDocument(row.customer_document || ""),
      customer_email: normalizeEmail(row.customer_email || ""),
      purchase_date: safeDate(row.purchase_date || ""),
      purchase_amount: parseMoney(row.purchase_amount || 0),
      bonus_amount: bonusAmount,
      bonus_balance: parseMoney(row.bonus_balance || 0),
      valid_from: safeDate(row.valid_from || ""),
      valid_until: safeDate(row.valid_until || ""),
      expired_at: safeDate(row.expired_at || ""),
      crm_bonus_status_original: row.crm_bonus_status_original || "",
      normalized_status: normalizedStatus,
      ledger_type: row.ledger_type || "",
      origin: row.origin || "",
      crm_customer_exists: match.crm_customer_exists,
      crm_customer_id: match.crm_customer_id || "",
      match_method: match.match_method || "",
      match_confidence: match.match_confidence || "none",
      needs_review: match.needs_review || "false",
      action_suggested: match.action_suggested || "",
      import_ready: asBoolText(importReady),
      import_block_reason: importBlockReason,
      campaign_reactivation_potential: match.campaign_reactivation_potential || "LOW",
      notes: match.notes || row.notes || ""
    };
  });

  const reactivationCandidates = customerMatches
    .filter((row) => normalizePhoneBR(row.crm_bonus_phone_normalized || row.crm_bonus_phone_original || ""))
    .map((row) => {
      const segment = buildCampaignSegment(row, row);
      return {
        customer_name: row.crm_bonus_customer_name,
        first_name: firstName(row.crm_bonus_customer_name),
        phone_normalized: row.crm_bonus_phone_normalized,
        document: row.crm_bonus_document,
        crm_customer_exists: row.crm_customer_exists,
        crm_customer_id: row.crm_customer_id,
        total_lost_amount: row.crm_bonus_lost_amount,
        lost_events_count: row.crm_bonus_total_events,
        last_lost_date: row.crm_bonus_last_event_date,
        highest_lost_bonus: Number(
          Math.max(
            parseMoney(row.crm_bonus_lost_amount || 0),
            parseMoney(row.crm_bonus_expired_amount || 0)
          ).toFixed(2)
        ),
        campaign_reactivation_potential: row.campaign_reactivation_potential,
        suggested_campaign_segment: segment,
        suggested_message_angle: buildMessageAngle(segment),
        match_confidence: row.match_confidence,
        needs_review: row.needs_review
      };
    })
    .sort((left, right) => Number(right.total_lost_amount || 0) - Number(left.total_lost_amount || 0));

  const warningSummary = summarizeWarnings(warningsCsv.rows);

  const matchedCustomers = customerMatches.filter((row) => row.crm_customer_exists === "true");
  const unmatchedCustomers = customerMatches.filter((row) => row.crm_customer_exists !== "true");
  const matchByPhone = customerMatches.filter((row) => row.match_method === "phone_normalized").length;
  const matchByDocument = customerMatches.filter((row) => row.match_method === "document").length;
  const matchByEmail = customerMatches.filter((row) => row.match_method === "email").length;
  const lowConfidenceMatches = customerMatches.filter((row) => row.match_confidence === "low").length;
  const eventsImportReady = importPreview.filter((row) => row.import_ready === "true").length;
  const eventsBlocked = importPreview.length - eventsImportReady;
  const totalLostAmount = importPreview.reduce((total, row) => total + Number(row.bonus_amount || 0), 0);
  const highReactivationCandidates = reactivationCandidates.filter(
    (row) => row.campaign_reactivation_potential === "HIGH"
  ).length;

  const blockReasonCounts = new Map();
  for (const row of importPreview) {
    const reason = row.import_block_reason || "";
    if (reason) {
      blockReasonCounts.set(reason, (blockReasonCounts.get(reason) || 0) + 1);
    }
  }
  const topBlockReasons = Array.from(blockReasonCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([reason, count]) => ({ reason, count }));

  const reportJson = {
    generated_at: new Date().toISOString(),
    total_crm_bonus_customers: customerMatches.length,
    total_lost_bonus_events: importPreview.length,
    total_lost_amount: Number(totalLostAmount.toFixed(2)),
    matched_customers: matchedCustomers.length,
    unmatched_customers: unmatchedCustomers.length,
    match_by_phone: matchByPhone,
    match_by_document: matchByDocument,
    match_by_email: matchByEmail,
    low_confidence_matches: lowConfidenceMatches,
    events_import_ready: eventsImportReady,
    events_blocked: eventsBlocked,
    high_reactivation_candidates: highReactivationCandidates,
    warnings_total: warningsCsv.rows.length,
    top_warning_reasons: warningSummary.slice(0, 10),
    top_block_reasons: topBlockReasons.slice(0, 10),
    database_written: false,
    import_called: false
  };

  const reportMd = `# Conciliacao CRM Bonus x CRM AEROSTORE

- Resumo executivo: conciliacao read-only de bonus perdidos do CRM Bonus com clientes da tabela contacts do CRM AEROSTORE.
- Total de clientes CRM Bonus: ${customerMatches.length}
- Total de eventos perdidos: ${importPreview.length}
- Total financeiro perdido: R$ ${reportJson.total_lost_amount.toFixed(2)}
- Clientes ja encontrados no CRM: ${matchedCustomers.length}
- Clientes nao encontrados: ${unmatchedCustomers.length}
- Matches por telefone: ${matchByPhone}
- Matches por documento: ${matchByDocument}
- Matches por e-mail: ${matchByEmail}
- Matches low confidence: ${lowConfidenceMatches}
- Eventos import_ready: ${eventsImportReady}
- Eventos bloqueados: ${eventsBlocked}
- Clientes HIGH de reativacao: ${highReactivationCandidates}

## Analise dos warnings
- Total de warnings: ${warningsCsv.rows.length}
${warningSummary.slice(0, 10).map((item) => `- ${item.reason}: ${item.count}`).join("\n")}

## Principais riscos
- Parte do recorte do CRM Bonus nao traz documento, e-mail, vendedor nem ticket real.
- O match por nome foi mantido como baixa confianca e exige revisao manual.
- Eventos sem match high confidence ainda nao devem ser importados no ledger novo.

## Eventos bloqueados
${topBlockReasons.slice(0, 10).map((item) => `- ${item.reason}: ${item.count}`).join("\n") || "- Nenhum"}

## Proximos passos recomendados
- Revisar os clientes sem match e decidir a politica de CREATE_MINIMAL_CUSTOMER_LATER.
- Validar se parte dos clientes pode ser conciliada por documento ou e-mail em nova rodada de export.
- So depois aprovar a importacao para customer_cashback_ledger.

Nenhum dado foi gravado no banco nesta etapa.
`;

  const importPlanMd = `# Proxima etapa de importacao CRM Bonus

1. Importar futuramente \`crm_bonus_lost_cashback_import_preview.csv\` apenas para linhas com \`import_ready = true\`.
2. Vincular cada evento a \`customer_id\` pelo cliente conciliado com \`match_confidence = high\`.
3. Para clientes nao encontrados:
   - manter \`CREATE_MINIMAL_CUSTOMER_LATER\` como etapa manual aprovada;
   - criar cliente minimo apenas se a politica operacional permitir.
4. Evitar duplicidade por chave composta:
   - \`crm_bonus_id + source_file + source_row_number\`
5. Marcar origem futura:
   - \`origin = crm_bonus_import\`
6. Exibir futuramente no cliente:
   - total perdido
   - historico de bonus perdido
   - potencial de reativacao
7. Usar em campanhas futuras:
   - \`HIGH_VALUE_LOST\`
   - \`RECENT_LOST\`
   - \`REPEATED_LOST\`
8. Validacoes pendentes antes de gravar:
   - revisar matches low confidence
   - confirmar politica para criar cliente minimo
   - revisar warnings de campos ausentes

Nenhum dado foi importado nesta etapa.
`;

  const readme = `# Reconciliation Output

Arquivos desta pasta foram gerados em modo read-only para reconciliar bonus perdidos do CRM Bonus com clientes existentes do CRM AEROSTORE.

- Nenhum INSERT/UPDATE/DELETE foi executado.
- Nenhum endpoint de importacao/commit foi chamado.
- A tabela \`contacts\` foi lida apenas por SELECT.
`;

  writeCsv(path.join(reconciliationDir, "crm_bonus_customer_match_preview.csv"), customerMatches, [
    "crm_bonus_customer_key",
    "crm_bonus_customer_name",
    "crm_bonus_phone_original",
    "crm_bonus_phone_normalized",
    "crm_bonus_document",
    "crm_bonus_email",
    "crm_bonus_available_amount",
    "crm_bonus_pending_amount",
    "crm_bonus_used_amount",
    "crm_bonus_expired_amount",
    "crm_bonus_lost_amount",
    "crm_bonus_cancelled_amount",
    "crm_bonus_generated_amount",
    "crm_bonus_total_events",
    "crm_bonus_last_event_date",
    "campaign_reactivation_potential",
    "crm_customer_exists",
    "crm_customer_id",
    "crm_customer_name",
    "crm_customer_phone_normalized",
    "crm_customer_document",
    "crm_customer_email",
    "crm_customer_status",
    "crm_customer_source",
    "match_method",
    "match_confidence",
    "needs_review",
    "action_suggested",
    "notes"
  ]);

  writeCsv(path.join(reconciliationDir, "crm_bonus_lost_cashback_import_preview.csv"), importPreview, [
    "source_file",
    "source_row_number",
    "crm_bonus_id",
    "customer_name",
    "customer_phone_original",
    "customer_phone_normalized",
    "customer_document",
    "customer_email",
    "purchase_date",
    "purchase_amount",
    "bonus_amount",
    "bonus_balance",
    "valid_from",
    "valid_until",
    "expired_at",
    "crm_bonus_status_original",
    "normalized_status",
    "ledger_type",
    "origin",
    "crm_customer_exists",
    "crm_customer_id",
    "match_method",
    "match_confidence",
    "needs_review",
    "action_suggested",
    "import_ready",
    "import_block_reason",
    "campaign_reactivation_potential",
    "notes"
  ]);

  writeCsv(path.join(reconciliationDir, "crm_bonus_reactivation_campaign_candidates.csv"), reactivationCandidates, [
    "customer_name",
    "first_name",
    "phone_normalized",
    "document",
    "crm_customer_exists",
    "crm_customer_id",
    "total_lost_amount",
    "lost_events_count",
    "last_lost_date",
    "highest_lost_bonus",
    "campaign_reactivation_potential",
    "suggested_campaign_segment",
    "suggested_message_angle",
    "match_confidence",
    "needs_review"
  ]);

  fs.writeFileSync(path.join(reconciliationDir, "crm_bonus_reconciliation_report.md"), reportMd, "utf8");
  writeJson(path.join(reconciliationDir, "crm_bonus_reconciliation_report.json"), reportJson);
  fs.writeFileSync(path.join(reconciliationDir, "crm_bonus_import_plan_next_step.md"), importPlanMd, "utf8");
  fs.writeFileSync(path.join(reconciliationDir, "README.md"), readme, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        totalCrmBonusCustomers: customerMatches.length,
        matchedCustomers: matchedCustomers.length,
        unmatchedCustomers: unmatchedCustomers.length,
        matchByPhone,
        matchByDocument,
        matchByEmail,
        lowConfidenceMatches,
        eventsImportReady,
        eventsBlocked,
        highReactivationCandidates,
        warningsTotal: warningsCsv.rows.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
