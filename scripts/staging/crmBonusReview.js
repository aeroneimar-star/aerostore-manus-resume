#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

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

function safeDate(value = "") {
  return normalizeText(value);
}

function compareIsoDates(left = "", right = "") {
  return safeDate(left).localeCompare(safeDate(right));
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

function summarizeCounts(rows, field) {
  const counts = new Map();
  for (const row of rows) {
    const key = normalizeText(row[field] || "") || "empty";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([name, count]) => ({ name, count }));
}

function normalizeContactRow(row = {}) {
  const phone = normalizePhoneBR(row.mobile_normalized || row.mobile || row.phone || "");
  return {
    id: row.id || "",
    name: normalizeText(row.name || ""),
    mobile_normalized: phone,
    mobile: normalizeText(row.mobile || row.phone || ""),
    document: normalizeDocument(row.document || ""),
    email: normalizeEmail(row.email || ""),
    status: normalizeText(row.status || ""),
    source: normalizeText(row.source || ""),
    deleted_at: normalizeText(row.deleted_at || ""),
    created_at: normalizeText(row.created_at || ""),
    updated_at: normalizeText(row.updated_at || ""),
    completeness_score: 0
  };
}

function computeCompleteness(contact) {
  let score = 0;
  if (contact.name) score += 3;
  if (contact.document) score += 3;
  if (contact.email) score += 2;
  if (contact.mobile_normalized) score += 2;
  if (contact.updated_at) score += 1;
  return score;
}

function suggestionForDuplicateGroup(group) {
  const sorted = [...group].sort((left, right) => {
    if (right.completeness_score !== left.completeness_score) {
      return right.completeness_score - left.completeness_score;
    }
    return compareIsoDates(right.updated_at || right.created_at || "", left.updated_at || left.created_at || "");
  });
  const top = sorted[0];
  const second = sorted[1];
  if (!second) return { suggested_resolution: "KEEP_MOST_COMPLETE", notes: `Contato principal sugerido: ${top.id}` };
  if (top.completeness_score >= second.completeness_score + 3) {
    return { suggested_resolution: "KEEP_MOST_COMPLETE", notes: `Contato principal sugerido: ${top.id}` };
  }
  if ((top.updated_at || top.created_at) && (second.updated_at || second.created_at)) {
    return { suggested_resolution: "KEEP_MOST_RECENT", notes: `Contato principal sugerido: ${top.id}` };
  }
  return { suggested_resolution: "REVIEW_MANUALLY", notes: "Grupo com completude parecida; revisar antes de mesclar." };
}

async function main() {
  const options = parseArgs(process.argv);
  const baseDir = path.resolve(options.base);
  const reconciliationDir = path.join(baseDir, "reconciliation");
  const reviewDir = path.join(baseDir, "review");
  const dbPath = path.resolve(DEFAULT_DB);

  ensureDir(reviewDir);

  const requiredFiles = [
    path.join(reconciliationDir, "crm_bonus_customer_match_preview.csv"),
    path.join(reconciliationDir, "crm_bonus_lost_cashback_import_preview.csv"),
    path.join(reconciliationDir, "crm_bonus_reactivation_campaign_candidates.csv"),
    path.join(reconciliationDir, "crm_bonus_reconciliation_report.json")
  ];

  for (const filePath of requiredFiles) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo obrigatorio ausente: ${filePath}`);
    }
  }

  const matchPreview = parseCsv(path.join(reconciliationDir, "crm_bonus_customer_match_preview.csv")).rows;
  const blockedPreview = parseCsv(path.join(reconciliationDir, "crm_bonus_lost_cashback_import_preview.csv")).rows;
  const campaignPreview = parseCsv(path.join(reconciliationDir, "crm_bonus_reactivation_campaign_candidates.csv")).rows;
  const reconciliationReport = JSON.parse(
    fs.readFileSync(path.join(reconciliationDir, "crm_bonus_reconciliation_report.json"), "utf8")
  );

  const db = await openReadOnlyDatabase(dbPath);
  let contactRows = [];
  try {
    contactRows = await allReadOnly(db, "SELECT * FROM contacts");
  } finally {
    await closeDatabase(db);
  }

  const contacts = contactRows.map(normalizeContactRow).filter((row) => !row.deleted_at);
  contacts.forEach((contact) => {
    contact.completeness_score = computeCompleteness(contact);
  });

  const unmatchedCustomers = matchPreview
    .filter((row) =>
      !parseBoolean(row.crm_customer_exists) ||
      normalizeText(row.action_suggested) === "CREATE_MINIMAL_CUSTOMER_LATER" ||
      (normalizeText(row.action_suggested) === "REVIEW_MANUALLY" && !row.crm_customer_id)
    )
    .map((row) => {
      const lostAmount = parseMoney(row.crm_bonus_lost_amount || 0);
      const hasPhone = Boolean(normalizePhoneBR(row.crm_bonus_phone_normalized || row.crm_bonus_phone_original || ""));
      const hasDocument = Boolean(normalizeDocument(row.crm_bonus_document || ""));
      let suggestedAction = "REVIEW_MANUALLY";
      let suggestedReason = "Dados insuficientes para vinculo automatico.";
      if (hasPhone && lostAmount > 0) {
        suggestedAction = "CREATE_MINIMAL_CUSTOMER_LATER";
        suggestedReason = "Cliente tem telefone valido e valor perdido positivo.";
      } else if (!hasPhone && !hasDocument) {
        suggestedAction = "REVIEW_MANUALLY";
        suggestedReason = "Sem telefone normalizado e sem documento.";
      } else if (lostAmount < 10 && !hasPhone) {
        suggestedAction = "IGNORE_LATER";
        suggestedReason = "Valor baixo com dados fracos.";
      }
      return {
        crm_bonus_customer_key: row.crm_bonus_customer_key,
        crm_bonus_customer_name: row.crm_bonus_customer_name,
        crm_bonus_phone_original: row.crm_bonus_phone_original,
        crm_bonus_phone_normalized: normalizePhoneBR(row.crm_bonus_phone_normalized || row.crm_bonus_phone_original || ""),
        crm_bonus_document: normalizeDocument(row.crm_bonus_document || ""),
        crm_bonus_email: normalizeEmail(row.crm_bonus_email || ""),
        crm_bonus_lost_amount: lostAmount,
        crm_bonus_total_events: Number(row.crm_bonus_total_events || 0),
        crm_bonus_last_event_date: safeDate(row.crm_bonus_last_event_date || ""),
        campaign_reactivation_potential: normalizeText(row.campaign_reactivation_potential || "LOW"),
        suggested_action: suggestedAction,
        suggested_reason: suggestedReason,
        create_minimal_customer_candidate: suggestedAction === "CREATE_MINIMAL_CUSTOMER_LATER" ? "true" : "false",
        notes: normalizeText(row.notes || "")
      };
    })
    .sort((left, right) => Number(right.crm_bonus_lost_amount || 0) - Number(left.crm_bonus_lost_amount || 0));

  const lowConfidenceMatches = matchPreview
    .filter((row) =>
      normalizeText(row.match_confidence) === "low" ||
      parseBoolean(row.needs_review) ||
      normalizeText(row.action_suggested) === "REVIEW_MANUALLY"
    )
    .map((row) => {
      const notes = normalizeText(row.notes || "");
      let ambiguityReason = "needs_manual_review";
      if (notes.toLowerCase().includes("telefone vinculado a")) {
        ambiguityReason = "ambiguous_phone";
      } else if (normalizeText(row.match_method) === "exact_name") {
        ambiguityReason = "name_only_match";
      }
      let suggestedAction = "REVIEW_MANUALLY";
      if (normalizeText(row.match_confidence) === "low" && row.crm_customer_id) {
        suggestedAction = "LINK_TO_EXISTING_AFTER_REVIEW";
      } else if (!row.crm_customer_id && normalizePhoneBR(row.crm_bonus_phone_normalized || "")) {
        suggestedAction = "CREATE_MINIMAL_CUSTOMER_LATER";
      } else if (parseMoney(row.crm_bonus_lost_amount || 0) < 10) {
        suggestedAction = "IGNORE_LATER";
      }
      return {
        crm_bonus_customer_key: row.crm_bonus_customer_key,
        crm_bonus_customer_name: row.crm_bonus_customer_name,
        crm_bonus_phone_normalized: normalizePhoneBR(row.crm_bonus_phone_normalized || ""),
        crm_bonus_document: normalizeDocument(row.crm_bonus_document || ""),
        crm_bonus_email: normalizeEmail(row.crm_bonus_email || ""),
        crm_bonus_lost_amount: parseMoney(row.crm_bonus_lost_amount || 0),
        crm_bonus_total_events: Number(row.crm_bonus_total_events || 0),
        crm_bonus_last_event_date: safeDate(row.crm_bonus_last_event_date || ""),
        campaign_reactivation_potential: normalizeText(row.campaign_reactivation_potential || "LOW"),
        crm_customer_id: row.crm_customer_id || "",
        crm_customer_name: row.crm_customer_name || "",
        crm_customer_phone_normalized: normalizePhoneBR(row.crm_customer_phone_normalized || ""),
        crm_customer_document: normalizeDocument(row.crm_customer_document || ""),
        crm_customer_email: normalizeEmail(row.crm_customer_email || ""),
        crm_customer_status: row.crm_customer_status || "",
        crm_customer_source: row.crm_customer_source || "",
        match_method: row.match_method || "",
        match_confidence: row.match_confidence || "",
        needs_review: row.needs_review || "false",
        ambiguity_reason: ambiguityReason,
        suggested_action: suggestedAction,
        notes
      };
    })
    .sort((left, right) => Number(right.crm_bonus_lost_amount || 0) - Number(left.crm_bonus_lost_amount || 0));

  const duplicateGroupsMap = new Map();
  for (const contact of contacts) {
    if (!contact.mobile_normalized) continue;
    if (!duplicateGroupsMap.has(contact.mobile_normalized)) {
      duplicateGroupsMap.set(contact.mobile_normalized, []);
    }
    duplicateGroupsMap.get(contact.mobile_normalized).push(contact);
  }

  const duplicatePhoneGroups = Array.from(duplicateGroupsMap.entries())
    .filter(([, group]) => group.length > 1)
    .map(([mobileNormalized, group]) => {
      const suggestion = suggestionForDuplicateGroup(group);
      return {
        mobile_normalized: mobileNormalized,
        duplicate_count: group.length,
        contact_ids: group.map((item) => item.id).join("|"),
        contact_names: group.map((item) => item.name || "-").join("|"),
        documents: group.map((item) => item.document || "-").join("|"),
        emails: group.map((item) => item.email || "-").join("|"),
        statuses: group.map((item) => item.status || "-").join("|"),
        sources: group.map((item) => item.source || "-").join("|"),
        created_dates: group.map((item) => item.created_at || "-").join("|"),
        updated_dates: group.map((item) => item.updated_at || "-").join("|"),
        suggested_resolution: suggestion.suggested_resolution,
        notes: suggestion.notes
      };
    })
    .sort((left, right) => right.duplicate_count - left.duplicate_count || left.mobile_normalized.localeCompare(right.mobile_normalized));

  const blockedEvents = blockedPreview
    .filter((row) =>
      !parseBoolean(row.import_ready) ||
      normalizeText(row.import_block_reason || "") ||
      parseBoolean(row.needs_review)
    )
    .map((row) => {
      const notes = normalizeText(row.notes || "");
      let reason = normalizeText(row.import_block_reason || "");
      if (!reason && !parseBoolean(row.crm_customer_exists)) {
        reason = "missing_customer";
      }
      if (notes.toLowerCase().includes("telefone vinculado a")) {
        reason = "ambiguous_phone";
      }
      if (!parseMoney(row.bonus_amount || 0)) {
        reason = reason || "missing_bonus_amount";
      }
      if (normalizeText(row.normalized_status || "") === "unknown") {
        reason = "unknown_status";
      }
      if (!reason) {
        reason = "other";
      }

      let suggestedAction = "REVIEW_MANUALLY";
      if (reason === "missing_high_confidence_customer_match" && normalizePhoneBR(row.customer_phone_normalized || "")) {
        suggestedAction = "LINK_TO_EXISTING_AFTER_REVIEW";
      } else if (!parseBoolean(row.crm_customer_exists) && normalizePhoneBR(row.customer_phone_normalized || "")) {
        suggestedAction = "CREATE_MINIMAL_CUSTOMER_LATER";
      } else if (reason === "missing_bonus_amount" || reason === "unknown_status") {
        suggestedAction = "IGNORE_LATER";
      }

      return {
        source_file: row.source_file || "",
        source_row_number: Number(row.source_row_number || 0),
        crm_bonus_id: row.crm_bonus_id || "",
        customer_name: row.customer_name || "",
        customer_phone_normalized: normalizePhoneBR(row.customer_phone_normalized || row.customer_phone_original || ""),
        bonus_amount: parseMoney(row.bonus_amount || 0),
        valid_until: safeDate(row.valid_until || ""),
        expired_at: safeDate(row.expired_at || ""),
        normalized_status: row.normalized_status || "",
        import_block_reason: reason,
        match_confidence: row.match_confidence || "",
        crm_customer_exists: row.crm_customer_exists || "false",
        crm_customer_id: row.crm_customer_id || "",
        suggested_action: suggestedAction,
        notes
      };
    })
    .sort((left, right) => Number(right.bonus_amount || 0) - Number(left.bonus_amount || 0));

  const manualResolutionTemplate = [];
  unmatchedCustomers.forEach((row) => {
    manualResolutionTemplate.push({
      review_type: "unmatched_customer",
      crm_bonus_customer_key: row.crm_bonus_customer_key,
      crm_bonus_customer_name: row.crm_bonus_customer_name,
      crm_bonus_phone_normalized: row.crm_bonus_phone_normalized,
      crm_bonus_lost_amount: row.crm_bonus_lost_amount,
      crm_bonus_total_events: row.crm_bonus_total_events,
      current_crm_customer_id: "",
      current_crm_customer_name: "",
      suggested_action: row.suggested_action,
      manual_decision: "",
      manual_customer_id: "",
      manual_notes: "",
      reviewed_by: "",
      reviewed_at: ""
    });
  });
  lowConfidenceMatches.forEach((row) => {
    manualResolutionTemplate.push({
      review_type: "low_confidence_match",
      crm_bonus_customer_key: row.crm_bonus_customer_key,
      crm_bonus_customer_name: row.crm_bonus_customer_name,
      crm_bonus_phone_normalized: row.crm_bonus_phone_normalized,
      crm_bonus_lost_amount: row.crm_bonus_lost_amount,
      crm_bonus_total_events: row.crm_bonus_total_events,
      current_crm_customer_id: row.crm_customer_id,
      current_crm_customer_name: row.crm_customer_name,
      suggested_action: row.suggested_action,
      manual_decision: "",
      manual_customer_id: "",
      manual_notes: "",
      reviewed_by: "",
      reviewed_at: ""
    });
  });
  duplicatePhoneGroups.forEach((row) => {
    manualResolutionTemplate.push({
      review_type: "duplicate_phone",
      crm_bonus_customer_key: "",
      crm_bonus_customer_name: row.contact_names,
      crm_bonus_phone_normalized: row.mobile_normalized,
      crm_bonus_lost_amount: "",
      crm_bonus_total_events: "",
      current_crm_customer_id: row.contact_ids,
      current_crm_customer_name: row.contact_names,
      suggested_action: row.suggested_resolution,
      manual_decision: "",
      manual_customer_id: "",
      manual_notes: "",
      reviewed_by: "",
      reviewed_at: ""
    });
  });
  blockedEvents.forEach((row) => {
    manualResolutionTemplate.push({
      review_type: "blocked_event",
      crm_bonus_customer_key: row.crm_bonus_id,
      crm_bonus_customer_name: row.customer_name,
      crm_bonus_phone_normalized: row.customer_phone_normalized,
      crm_bonus_lost_amount: row.bonus_amount,
      crm_bonus_total_events: 1,
      current_crm_customer_id: row.crm_customer_id,
      current_crm_customer_name: "",
      suggested_action: row.suggested_action,
      manual_decision: "",
      manual_customer_id: "",
      manual_notes: "",
      reviewed_by: "",
      reviewed_at: ""
    });
  });

  const blockedReasonSummary = summarizeCounts(blockedEvents, "import_block_reason");
  const duplicateContactsTotal = duplicatePhoneGroups.reduce((total, row) => total + Number(row.duplicate_count || 0), 0);
  const blockedAmount = blockedEvents.reduce((total, row) => total + Number(row.bonus_amount || 0), 0);
  const createMinimalCandidates = unmatchedCustomers.filter((row) => row.suggested_action === "CREATE_MINIMAL_CUSTOMER_LATER").length;
  const manualLinkCandidates = lowConfidenceMatches.filter((row) => row.suggested_action === "LINK_TO_EXISTING_AFTER_REVIEW").length;
  const ignoreLaterCandidates = [
    ...unmatchedCustomers.filter((row) => row.suggested_action === "IGNORE_LATER"),
    ...lowConfidenceMatches.filter((row) => row.suggested_action === "IGNORE_LATER"),
    ...blockedEvents.filter((row) => row.suggested_action === "IGNORE_LATER")
  ].length;

  const topUnmatchedByAmount = unmatchedCustomers.slice(0, 20);
  const topLowConfidenceByAmount = lowConfidenceMatches.slice(0, 20);
  const topDuplicatePhones = duplicatePhoneGroups.slice(0, 20);
  const mismatchNotes = [];
  if (Number(reconciliationReport.unmatched_customers || 0) !== unmatchedCustomers.length) {
    mismatchNotes.push(`unmatched_customers: review=${unmatchedCustomers.length} / reconciliation=${Number(reconciliationReport.unmatched_customers || 0)}`);
  }
  if (Number(reconciliationReport.low_confidence_matches || 0) !== lowConfidenceMatches.length) {
    mismatchNotes.push(`low_confidence_matches: review=${lowConfidenceMatches.length} / reconciliation=${Number(reconciliationReport.low_confidence_matches || 0)}`);
  }
  if (Number(reconciliationReport.events_blocked || 0) !== blockedEvents.length) {
    mismatchNotes.push(`events_blocked: review=${blockedEvents.length} / reconciliation=${Number(reconciliationReport.events_blocked || 0)}`);
  }

  const reportJson = {
    generated_at: new Date().toISOString(),
    unmatched_customers: unmatchedCustomers.length,
    low_confidence_matches: lowConfidenceMatches.length,
    duplicate_phone_groups: duplicatePhoneGroups.length,
    duplicate_contacts_total: duplicateContactsTotal,
    blocked_events: blockedEvents.length,
    blocked_amount: Number(blockedAmount.toFixed(2)),
    create_minimal_customer_candidates: createMinimalCandidates,
    manual_link_candidates: manualLinkCandidates,
    ignore_later_candidates: ignoreLaterCandidates,
    reconciliation_reference: {
      unmatched_customers: Number(reconciliationReport.unmatched_customers || 0),
      low_confidence_matches: Number(reconciliationReport.low_confidence_matches || 0),
      events_blocked: Number(reconciliationReport.events_blocked || 0),
      high_reactivation_candidates: Number(reconciliationReport.high_reactivation_candidates || 0)
    },
    reconciliation_alignment_ok: mismatchNotes.length === 0,
    reconciliation_alignment_notes: mismatchNotes,
    top_block_reasons: blockedReasonSummary.slice(0, 10),
    top_duplicate_phones: topDuplicatePhones.slice(0, 10).map((row) => ({
      mobile_normalized: row.mobile_normalized,
      duplicate_count: row.duplicate_count,
      contact_names: row.contact_names
    })),
    top_unmatched_by_amount: topUnmatchedByAmount.slice(0, 10).map((row) => ({
      crm_bonus_customer_name: row.crm_bonus_customer_name,
      crm_bonus_phone_normalized: row.crm_bonus_phone_normalized,
      crm_bonus_lost_amount: row.crm_bonus_lost_amount
    })),
    database_written: false,
    import_called: false
  };

  const reportMd = `# Revisao read-only CRM Bonus x contacts

- Resumo executivo: etapa de revisao dos clientes nao encontrados, matches de baixa confianca, duplicidades de telefone em contacts e eventos bloqueados.
- Total de clientes nao encontrados: ${unmatchedCustomers.length}
- Total de baixa confianca: ${lowConfidenceMatches.length}
- Total de grupos de telefone duplicado em contacts: ${duplicatePhoneGroups.length}
- Total de contatos envolvidos em duplicidade: ${duplicateContactsTotal}
- Total de eventos bloqueados: ${blockedEvents.length}
- Total financeiro bloqueado: R$ ${blockedAmount.toFixed(2)}
- Candidatos a criar cliente minimo: ${createMinimalCandidates}
- Candidatos para link manual: ${manualLinkCandidates}
- Candidatos a ignorar futuramente: ${ignoreLaterCandidates}

## Referencia da conciliacao
- Clientes nao encontrados na conciliacao: ${Number(reconciliationReport.unmatched_customers || 0)}
- Baixa confianca na conciliacao: ${Number(reconciliationReport.low_confidence_matches || 0)}
- Eventos bloqueados na conciliacao: ${Number(reconciliationReport.events_blocked || 0)}
- Candidatos HIGH na conciliacao: ${Number(reconciliationReport.high_reactivation_candidates || 0)}
${mismatchNotes.length ? `- Alerta de alinhamento: ${mismatchNotes.join(" | ")}` : "- Review alinhado com a conciliacao atual."}

## Top 20 clientes nao encontrados por valor perdido
${topUnmatchedByAmount.map((item, index) => `${index + 1}. ${item.crm_bonus_customer_name} | ${item.crm_bonus_phone_normalized || "-"} | R$ ${Number(item.crm_bonus_lost_amount || 0).toFixed(2)} | ${item.suggested_action}`).join("\n")}

## Top 20 baixa confianca por valor perdido
${topLowConfidenceByAmount.map((item, index) => `${index + 1}. ${item.crm_bonus_customer_name} | CRM ${item.crm_customer_id || "-"} | R$ ${Number(item.crm_bonus_lost_amount || 0).toFixed(2)} | ${item.ambiguity_reason}`).join("\n")}

## Top 20 telefones duplicados com mais contatos
${topDuplicatePhones.map((item, index) => `${index + 1}. ${item.mobile_normalized} | ${item.duplicate_count} contatos | ${item.suggested_resolution}`).join("\n")}

## Principais motivos de bloqueio
${blockedReasonSummary.slice(0, 10).map((item) => `- ${item.name}: ${item.count}`).join("\n")}

## Proximos passos recomendados
- Importar futuramente apenas os eventos marcados como import_ready na etapa anterior.
- Abrir fila manual com o template de resolucao antes de qualquer criacao de cliente minimo.
- Tratar duplicidade em contacts em tela propria de saneamento, sem merge automatico.
- Usar a revisao para decidir entre LINK_TO_EXISTING_AFTER_REVIEW, CREATE_MINIMAL_CUSTOMER_LATER e IGNORE_LATER.

Nenhum dado foi gravado no banco nesta etapa.
`;

  const nextPlanMd = `# Proxima resolucao recomendada

1. Dados que podem ser importados agora com seguranca:
   - eventos import_ready da etapa de conciliacao anterior
2. Dados que precisam revisao:
   - clientes nao encontrados
   - matches de baixa confianca
   - eventos bloqueados
3. Duplicidade em contacts deve ser tratada em tela de saneamento com:
   - selecao manual do contato principal
   - merge controlado posterior
   - sem alteracao automatica nesta fase
4. O arquivo manual_resolution_template.csv deve virar a fila inicial de decisao operacional.
5. Proxima stage sugerida:
   - importar somente import_ready
   - abrir fila de revisao dos bloqueados
   - nao criar cliente automatico ainda
6. Riscos de importar sem revisao:
   - vinculo do bonus perdido ao cliente errado
   - duplicidade maior em contacts
   - campanhas de reativacao para pessoa incorreta

Nenhum dado foi importado nesta etapa.
`;

  const readme = `# Review Output

Arquivos desta pasta foram gerados em modo read-only para revisar clientes ambigüos, nao encontrados e duplicidades de telefone antes de qualquer importacao futura de bonus perdido.

- Nenhum INSERT/UPDATE/DELETE foi executado.
- Nenhum endpoint de importacao/commit foi chamado.
- A tabela contacts foi lida apenas por SELECT.
`;

  writeCsv(path.join(reviewDir, "crm_bonus_unmatched_customers_review.csv"), unmatchedCustomers, [
    "crm_bonus_customer_key",
    "crm_bonus_customer_name",
    "crm_bonus_phone_original",
    "crm_bonus_phone_normalized",
    "crm_bonus_document",
    "crm_bonus_email",
    "crm_bonus_lost_amount",
    "crm_bonus_total_events",
    "crm_bonus_last_event_date",
    "campaign_reactivation_potential",
    "suggested_action",
    "suggested_reason",
    "create_minimal_customer_candidate",
    "notes"
  ]);

  writeCsv(path.join(reviewDir, "crm_bonus_low_confidence_matches_review.csv"), lowConfidenceMatches, [
    "crm_bonus_customer_key",
    "crm_bonus_customer_name",
    "crm_bonus_phone_normalized",
    "crm_bonus_document",
    "crm_bonus_email",
    "crm_bonus_lost_amount",
    "crm_bonus_total_events",
    "crm_bonus_last_event_date",
    "campaign_reactivation_potential",
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
    "ambiguity_reason",
    "suggested_action",
    "notes"
  ]);

  writeCsv(path.join(reviewDir, "crm_contacts_duplicate_phones_review.csv"), duplicatePhoneGroups, [
    "mobile_normalized",
    "duplicate_count",
    "contact_ids",
    "contact_names",
    "documents",
    "emails",
    "statuses",
    "sources",
    "created_dates",
    "updated_dates",
    "suggested_resolution",
    "notes"
  ]);

  writeCsv(path.join(reviewDir, "crm_bonus_blocked_events_review.csv"), blockedEvents, [
    "source_file",
    "source_row_number",
    "crm_bonus_id",
    "customer_name",
    "customer_phone_normalized",
    "bonus_amount",
    "valid_until",
    "expired_at",
    "normalized_status",
    "import_block_reason",
    "match_confidence",
    "crm_customer_exists",
    "crm_customer_id",
    "suggested_action",
    "notes"
  ]);

  writeCsv(path.join(reviewDir, "crm_bonus_manual_resolution_template.csv"), manualResolutionTemplate, [
    "review_type",
    "crm_bonus_customer_key",
    "crm_bonus_customer_name",
    "crm_bonus_phone_normalized",
    "crm_bonus_lost_amount",
    "crm_bonus_total_events",
    "current_crm_customer_id",
    "current_crm_customer_name",
    "suggested_action",
    "manual_decision",
    "manual_customer_id",
    "manual_notes",
    "reviewed_by",
    "reviewed_at"
  ]);

  fs.writeFileSync(path.join(reviewDir, "crm_bonus_review_report.md"), reportMd, "utf8");
  writeJson(path.join(reviewDir, "crm_bonus_review_report.json"), reportJson);
  fs.writeFileSync(path.join(reviewDir, "crm_bonus_next_resolution_plan.md"), nextPlanMd, "utf8");
  fs.writeFileSync(path.join(reviewDir, "README.md"), readme, "utf8");

  console.log(JSON.stringify({
    ok: true,
    unmatchedCustomers: unmatchedCustomers.length,
    lowConfidenceMatches: lowConfidenceMatches.length,
    duplicatePhoneGroups: duplicatePhoneGroups.length,
    duplicateContactsTotal,
    blockedEvents: blockedEvents.length,
    blockedAmount: Number(blockedAmount.toFixed(2)),
    createMinimalCandidates,
    manualLinkCandidates,
    ignoreLaterCandidates
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
