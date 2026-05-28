const { all } = require("../../db");

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeLookup(value = "") {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeCustomerDocument(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 11 ? digits : "";
}

function normalizeCustomerEmail(value = "") {
  const email = normalizeText(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function hasInvalidRepeatedPhoneDigits(digits = "") {
  const national = String(digits || "").startsWith("55") ? String(digits || "").slice(2) : String(digits || "");
  return !national || /^(\d)\1+$/.test(national) || ["1234567890", "12345678901", "0123456789", "01234567890"].includes(national);
}

function normalizeCustomerPhone(value = "") {
  const raw = normalizeText(value);
  let digits = raw.replace(/\D/g, "");
  if (!digits) {
    return { raw, normalized: "", isValid: false, isMobile: false, isLandline: false, reason: "empty" };
  }

  digits = digits.replace(/^0+/, "");
  if (digits.startsWith("55")) {
    digits = `55${digits.slice(2).replace(/^0+/, "")}`;
  }

  const national = digits.startsWith("55") ? digits.slice(2) : digits;
  if (hasInvalidRepeatedPhoneDigits(digits)) {
    return { raw, normalized: "", isValid: false, isMobile: false, isLandline: false, reason: "placeholder" };
  }
  if (!/^\d{10,11}$/.test(national)) {
    return { raw, normalized: "", isValid: false, isMobile: false, isLandline: false, reason: "invalid_length" };
  }

  const ddd = national.slice(0, 2);
  const subscriber = national.slice(2);
  if (!/^[1-9]\d$/.test(ddd)) {
    return { raw, normalized: "", isValid: false, isMobile: false, isLandline: false, reason: "invalid_ddd" };
  }

  const isMobile = subscriber.length === 9 && subscriber.startsWith("9");
  const isLandline = subscriber.length === 8 && /^[2-5]/.test(subscriber);
  if (!isMobile && !isLandline) {
    return { raw, normalized: "", isValid: false, isMobile: false, isLandline: false, reason: "invalid_pattern" };
  }

  return { raw, normalized: `55${national}`, isValid: true, isMobile, isLandline, reason: "" };
}

function isGenericCustomerName(value = "") {
  const normalized = normalizeLookup(value);
  return !normalized || ["cliente", "consumidor final", "sem nome", "nao informado", "não informado", "cliente final"].includes(normalized);
}

function chooseBestName(values = []) {
  const candidates = values
    .map((value) => normalizeText(value))
    .filter((value) => value && !isGenericCustomerName(value))
    .sort((a, b) => b.length - a.length);
  return candidates[0] || normalizeText(values.find(Boolean) || "");
}

function chooseBestValue(values = []) {
  return values.map((value) => normalizeText(value)).filter(Boolean).sort((a, b) => b.length - a.length)[0] || "";
}

function namesLookConflicting(names = []) {
  const normalized = Array.from(new Set(names.map((name) => normalizeLookup(name)).filter((name) => name && !isGenericCustomerName(name))));
  if (normalized.length <= 1) return false;
  const tokenSets = normalized.map((name) => new Set(name.split(" ").filter((token) => token.length >= 3)));
  for (let i = 0; i < tokenSets.length; i += 1) {
    for (let j = i + 1; j < tokenSets.length; j += 1) {
      const intersection = Array.from(tokenSets[i]).filter((token) => tokenSets[j].has(token));
      if (!intersection.length) return true;
    }
  }
  return false;
}

function normalizeSourceRecord(row = {}, sourceTable = "contacts") {
  const phoneCandidates = sourceTable === "contacts"
    ? [row.mobile_normalized, row.mobile, row.phone, row.phone_fixed]
    : [row.mobile, row.phone];
  const phoneResults = phoneCandidates.map(normalizeCustomerPhone).filter((item) => item.isValid);
  const preferredPhone = phoneResults.find((item) => item.isMobile) || phoneResults[0] || null;
  const rawPhone = phoneCandidates.map((item) => normalizeText(item)).find(Boolean) || "";
  const document = normalizeCustomerDocument(row.document || "");
  const email = normalizeCustomerEmail(row.email || "");
  const name = normalizeText(row.name || row.fantasy_name || "");
  const city = normalizeText(row.city || "");
  const state = normalizeText(row.state || "");
  const externalCode = normalizeText(row.external_code || row.external_id || "");

  return {
    source_table: sourceTable,
    source_id: Number(row.id || 0),
    name,
    document,
    email,
    raw_phone: rawPhone,
    phone_normalized: preferredPhone?.normalized || "",
    phone_is_mobile: Boolean(preferredPhone?.isMobile),
    phone_is_landline: Boolean(preferredPhone?.isLandline),
    city,
    state,
    address: normalizeText(row.address || ""),
    store: normalizeText(row.preferred_store || row.store || ""),
    seller_name: normalizeText(row.preferred_seller || row.seller_name || ""),
    status: normalizeText(row.status || ""),
    source_label: sourceTable,
    external_code: externalCode,
    source_file: normalizeText(row.source_file || ""),
    created_at: normalizeText(row.created_at || ""),
    updated_at: normalizeText(row.updated_at || "")
  };
}

function buildCustomerUnifiedKey(record = {}) {
  if (record.document) return `document:${record.document}`;
  if (record.phone_normalized) return `phone:${record.phone_normalized}`;
  if (record.email) return `email:${record.email}`;
  if (record.external_code) return `external:${record.external_code}`;
  const name = normalizeLookup(record.name);
  const phoneTail = record.raw_phone.replace(/\D/g, "").slice(-4);
  if (name && phoneTail) return `name_phone:${name}:${phoneTail}`;
  return `single:${record.source_table}:${record.source_id}`;
}

function buildRecordKeys(record = {}) {
  const keys = [];
  if (record.document) keys.push(`document:${record.document}`);
  if (record.phone_normalized) keys.push(`phone:${record.phone_normalized}`);
  if (record.email) keys.push(`email:${record.email}`);
  if (record.external_code) keys.push(`external:${record.external_code}`);
  const name = normalizeLookup(record.name);
  const phoneTail = record.raw_phone.replace(/\D/g, "").slice(-4);
  if (!record.document && !record.phone_normalized && !record.email && name && phoneTail) {
    keys.push(`name_phone:${name}:${phoneTail}`);
  }
  return keys.length ? keys : [`single:${record.source_table}:${record.source_id}`];
}

function mergeCustomerRecordsReadOnly(records = [], index = 0) {
  const sourceTables = Array.from(new Set(records.map((record) => record.source_table))).sort();
  const names = records.map((record) => record.name).filter(Boolean);
  const documents = Array.from(new Set(records.map((record) => record.document).filter(Boolean)));
  const phones = Array.from(new Set(records.map((record) => record.phone_normalized).filter(Boolean)));
  const emails = Array.from(new Set(records.map((record) => record.email).filter(Boolean)));
  const conflictReasons = [];
  if (documents.length > 1) conflictReasons.push("document_conflict");
  if (documents.length === 1 && records.length > 1 && namesLookConflicting(names)) conflictReasons.push("document_name_conflict");
  if (phones.length > 1 && namesLookConflicting(names)) conflictReasons.push("phone_name_conflict");
  if (emails.length > 1 && documents.length > 1) conflictReasons.push("email_document_conflict");

  const confidence = documents.length === 1 && records.length > 1
    ? "high_document"
    : phones.length === 1 && records.length > 1
      ? "high_phone"
      : emails.length === 1 && records.length > 1
        ? "medium_email"
        : records.length > 1
          ? "low_name_phone"
          : "single_source";
  const conflict = conflictReasons.length > 0;
  const preferredPhoneRecord = records.find((record) => record.phone_is_mobile) || records.find((record) => record.phone_normalized) || {};

  return {
    unified_id: `U${String(index + 1).padStart(8, "0")}`,
    contact_id: records.find((record) => record.source_table === "contacts")?.source_id || null,
    crm_contact_id: records.find((record) => record.source_table === "crm_contacts")?.source_id || null,
    source_tables: sourceTables,
    sources: sourceTables,
    merge_confidence: conflict ? "conflict" : confidence,
    conflict,
    conflict_reason: conflictReasons.join(", "),
    needs_review: conflict,
    name: chooseBestName(names),
    phone_normalized: preferredPhoneRecord.phone_normalized || "",
    has_raw_phone: records.some((record) => record.raw_phone),
    has_valid_whatsapp: records.some((record) => record.phone_is_mobile),
    document: documents[0] || "",
    email: emails[0] || "",
    city: chooseBestValue(records.map((record) => record.city)),
    state: chooseBestValue(records.map((record) => record.state)),
    address: chooseBestValue(records.map((record) => record.address)),
    store: chooseBestValue(records.map((record) => record.store)),
    seller_name: chooseBestValue(records.map((record) => record.seller_name)),
    status: chooseBestValue(records.map((record) => record.status)),
    source_labels: Array.from(new Set(records.map((record) => record.source_label).filter(Boolean))),
    source_count: records.length,
    source_refs: records.map((record) => ({
      table: record.source_table,
      id: record.source_id
    }))
  };
}

function buildUnifiedCustomers(records = []) {
  const parent = records.map((_, index) => index);
  const find = (index) => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };
  const keyMap = new Map();
  records.forEach((record, index) => {
    buildRecordKeys(record).forEach((key) => {
      if (keyMap.has(key)) {
        union(index, keyMap.get(key));
      } else {
        keyMap.set(key, index);
      }
    });
  });

  const groups = new Map();
  records.forEach((record, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(record);
  });

  return Array.from(groups.values())
    .map((group, index) => mergeCustomerRecordsReadOnly(group, index))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
}

function applyUnifiedFilters(items = [], filters = {}) {
  const query = normalizeLookup(filters.q || "");
  const queryDigits = String(filters.q || "").replace(/\D/g, "");
  const source = normalizeLookup(filters.source || "");
  const city = normalizeLookup(filters.city || "");
  const state = normalizeLookup(filters.state || "");
  const hasWhatsapp = String(filters.has_whatsapp || "").toLowerCase();
  const hasDocument = String(filters.has_document || "").toLowerCase();
  const hasEmail = String(filters.has_email || "").toLowerCase();
  const conflict = String(filters.conflict || "").toLowerCase();

  return items.filter((item) => {
    if (query) {
      const haystack = normalizeLookup([
        item.name,
        item.email,
        item.city,
        item.state,
        item.store,
        item.seller_name,
        item.source_tables.join(" ")
      ].join(" "));
      const digitTargets = [item.phone_normalized, item.document].join(" ");
      if (!haystack.includes(query) && (!queryDigits || !digitTargets.includes(queryDigits))) return false;
    }
    if (source && !item.source_tables.some((table) => normalizeLookup(table) === source)) return false;
    if (city && !normalizeLookup(item.city).includes(city)) return false;
    if (state && normalizeLookup(item.state) !== state) return false;
    if (hasWhatsapp === "1" && !item.has_valid_whatsapp) return false;
    if (hasWhatsapp === "0" && item.has_valid_whatsapp) return false;
    if (hasDocument === "1" && !item.document) return false;
    if (hasDocument === "0" && item.document) return false;
    if (hasEmail === "1" && !item.email) return false;
    if (hasEmail === "0" && item.email) return false;
    if (conflict === "1" && !item.conflict) return false;
    if (conflict === "0" && item.conflict) return false;
    return true;
  });
}

function buildUnifiedStats(items = []) {
  const fromContactsOnly = items.filter((item) => item.source_tables.length === 1 && item.source_tables.includes("contacts")).length;
  const fromCrmOnly = items.filter((item) => item.source_tables.length === 1 && item.source_tables.includes("crm_contacts")).length;
  const mergedRecords = items.filter((item) => item.source_tables.length > 1).length;
  return {
    total_unified: items.length,
    from_contacts_only: fromContactsOnly,
    from_crm_contacts_only: fromCrmOnly,
    merged_records: mergedRecords,
    with_raw_phone: items.filter((item) => item.has_raw_phone).length,
    with_valid_whatsapp: items.filter((item) => item.has_valid_whatsapp).length,
    without_valid_whatsapp: items.filter((item) => !item.has_valid_whatsapp).length,
    with_document: items.filter((item) => item.document).length,
    with_email: items.filter((item) => item.email).length,
    conflicts: items.filter((item) => item.conflict).length,
    whatsapp_campaign_candidates: items.filter((item) => item.has_valid_whatsapp && !item.conflict).length
  };
}

function maskTail(value = "", visibleTail = 4) {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.length <= visibleTail) return "*".repeat(text.length);
  return `${"*".repeat(Math.max(3, text.length - visibleTail))}${text.slice(-visibleTail)}`;
}

function maskEmail(value = "") {
  const email = normalizeCustomerEmail(value);
  if (!email) return "";
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}***@${domain}`;
}

function serializeUnifiedCustomer(item = {}) {
  return {
    unified_id: item.unified_id,
    contact_id: item.contact_id,
    crm_contact_id: item.crm_contact_id,
    source_tables: item.source_tables,
    sources: item.sources,
    merge_confidence: item.merge_confidence,
    conflict: item.conflict,
    conflict_reason: item.conflict_reason,
    needs_review: item.needs_review,
    name: item.name,
    phone_masked: maskTail(item.phone_normalized),
    has_raw_phone: item.has_raw_phone,
    has_valid_whatsapp: item.has_valid_whatsapp,
    document_masked: maskTail(item.document),
    email_masked: maskEmail(item.email),
    city: item.city,
    state: item.state,
    address: item.address ? "Endereco informado" : "",
    store: item.store,
    seller_name: item.seller_name,
    status: item.status,
    source_labels: item.source_labels,
    source_count: item.source_count,
    source_refs: item.source_refs
  };
}

async function loadUnifiedSourceRecords() {
  const [contacts, crmContacts] = await Promise.all([
    all(`
      SELECT id, name, first_name, phone, mobile, mobile_normalized, phone_fixed, document, email, city, state,
             address, preferred_store, store, seller_name, preferred_seller, source, status, created_at, updated_at
      FROM contacts
      WHERE COALESCE(deleted_at, '') = ''
    `),
    all(`
      SELECT id, external_id, external_code, name, fantasy_name, document, phone, mobile, email, address,
             city, state, seller_name, contact_type, status, source_file, created_at, updated_at
      FROM crm_contacts
    `)
  ]);
  return [
    ...contacts.map((row) => normalizeSourceRecord(row, "contacts")),
    ...crmContacts.map((row) => normalizeSourceRecord(row, "crm_contacts"))
  ];
}

async function listUnifiedCustomers(filters = {}) {
  const page = Math.max(1, Number(filters.page || 1));
  const limit = Math.max(1, Math.min(100, Number(filters.limit || 50)));
  const sourceRecords = await loadUnifiedSourceRecords();
  const unified = buildUnifiedCustomers(sourceRecords);
  const filtered = applyUnifiedFilters(unified, filters);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const offset = (page - 1) * limit;
  const items = filtered.slice(offset, offset + limit).map(serializeUnifiedCustomer);
  return {
    items,
    pagination: {
      page,
      limit,
      total,
      total_pages: totalPages,
      totalPages,
      has_more: page < totalPages
    },
    stats: buildUnifiedStats(filtered)
  };
}

async function getUnifiedCustomerById(id = "") {
  const sourceRecords = await loadUnifiedSourceRecords();
  const unified = buildUnifiedCustomers(sourceRecords);
  const item = unified.find((record) => record.unified_id === id);
  return item ? serializeUnifiedCustomer(item) : null;
}

async function getUnifiedCustomerRawById(id = "") {
  const sourceRecords = await loadUnifiedSourceRecords();
  const unified = buildUnifiedCustomers(sourceRecords);
  return unified.find((record) => record.unified_id === id) || null;
}

async function getUnifiedCustomerStats(filters = {}) {
  const payload = await listUnifiedCustomers({ ...filters, page: 1, limit: 1 });
  return payload.stats;
}

function getDuplicateMatchReason(item = {}, lookup = {}) {
  if (lookup.document && item.document === lookup.document) return "document";
  if (lookup.phone && item.phone_normalized === lookup.phone) return "phone";
  if (lookup.email && item.email === lookup.email) return "email";
  return "";
}

async function findUnifiedCustomerDuplicateCandidates(input = {}) {
  const lookup = {
    document: normalizeCustomerDocument(input.document || input.cpf || ""),
    phone: normalizeCustomerPhone(input.mobile || input.phone || input.telefone || input.celular || "").normalized,
    email: normalizeCustomerEmail(input.email || "")
  };
  if (!lookup.document && !lookup.phone && !lookup.email) {
    return [];
  }

  const sourceRecords = await loadUnifiedSourceRecords();
  const unified = buildUnifiedCustomers(sourceRecords);
  return unified
    .map((item) => ({
      item,
      match_reason: getDuplicateMatchReason(item, lookup)
    }))
    .filter((entry) => entry.match_reason)
    .map((entry) => ({
      ...serializeUnifiedCustomer(entry.item),
      match_reason: entry.match_reason,
      match_confidence: entry.match_reason === "document"
        ? "high_document"
        : entry.match_reason === "phone"
          ? "high_phone"
          : "medium_email"
    }))
    .slice(0, 10);
}

module.exports = {
  normalizeCustomerPhone,
  normalizeCustomerDocument,
  normalizeCustomerEmail,
  buildCustomerUnifiedKey,
  mergeCustomerRecordsReadOnly,
  listUnifiedCustomers,
  getUnifiedCustomerById,
  getUnifiedCustomerRawById,
  getUnifiedCustomerStats,
  findUnifiedCustomerDuplicateCandidates
};
