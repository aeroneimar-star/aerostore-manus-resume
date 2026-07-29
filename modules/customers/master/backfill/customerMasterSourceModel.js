"use strict";

const crypto = require("node:crypto");
const {
  NORMALIZATION_VERSION,
  normalizePhone,
  normalizeDocument,
  normalizeEmail,
  normalizeName,
  normalizeAddress
} = require("../normalization");

const SOURCE_MODEL_VERSION = "customer-master-source-model/v1";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeTimestamp(value) {
  const text = String(value || "").trim();
  if (!text || !Number.isFinite(Date.parse(text))) {
    return { value: null, warning: "SOURCE_UPDATED_AT_INVALID_OR_MISSING" };
  }
  return { value: text, warning: null };
}

function normalizeBirthDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text
    ? text
    : null;
}

function maskExternalId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `${"*".repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

function buildPhoneResults(row, sourceType) {
  const values = sourceType === "contacts"
    ? [row.mobile_normalized, row.mobile, row.phone, row.phone_fixed]
    : [row.mobile, row.phone];
  const seen = new Set();
  return values
    .filter((value) => String(value || "").trim())
    .map(normalizePhone)
    .filter((item) => {
      const key = `${item.classification}:${item.canonicalValue || item.normalizedValue || item.rawValue}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function identifierFromResult(type, normalized) {
  return {
    type,
    canonicalValue: normalized.canonicalValue,
    maskedValue: normalized.maskedValue,
    classification: normalized.classification,
    valid: normalized.isValid,
    reasons: [...normalized.reasons],
    warnings: [...normalized.warnings]
  };
}

function buildSourceRecord(sourceType, row = {}) {
  if (!["contacts", "crm_contacts"].includes(sourceType)) {
    throw new Error("CUSTOMER_MASTER_DRY_RUN_INVALID_SOURCE_TYPE");
  }
  const sourceId = String(row.id ?? "").trim();
  const name = normalizeName(row.name || row.fantasy_name || "");
  const phones = buildPhoneResults(row, sourceType);
  const document = normalizeDocument(row.document || "");
  const email = normalizeEmail(row.email || "");
  const address = normalizeAddress({
    source: `${sourceType}:${sourceId}`,
    address: row.address,
    number: row.number,
    complement: row.complement,
    neighborhood: row.neighborhood,
    zipcode: row.zipcode,
    city: row.city,
    state: row.state
  });
  const timestamp = normalizeTimestamp(row.updated_at);
  const status = String(row.status || "").trim();
  const normalizedStatus = status.toLowerCase();
  const deleted = sourceType === "contacts" && Boolean(String(row.deleted_at || "").trim());
  const inactive = deleted || ["inativo", "inactive", "deleted", "suspended", "suspenso", "bloqueado"].includes(normalizedStatus);
  const externalValues = sourceType === "crm_contacts"
    ? [row.external_id, row.external_code].map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const identifiers = [
    ...phones.map((phone) => identifierFromResult("PHONE", phone)),
    identifierFromResult("CPF", document),
    identifierFromResult("EMAIL", email),
    ...externalValues.map((value) => ({
      type: "EXTERNAL_ID",
      canonicalValue: value,
      maskedValue: maskExternalId(value),
      classification: "EXTERNAL_ID_PRESENT",
      valid: true,
      reasons: [],
      warnings: []
    }))
  ];
  const warnings = Array.from(new Set([
    timestamp.warning,
    !sourceId ? "SOURCE_ID_MISSING" : "",
    !status ? "SOURCE_STATUS_UNKNOWN" : "",
    ...identifiers.flatMap((identifier) => [...identifier.reasons, ...identifier.warnings]),
    ...address.reasons
  ].filter(Boolean)));
  const rawBirthDate = String(row.birth_date || "").trim();
  const birthDate = normalizeBirthDate(rawBirthDate);
  if (rawBirthDate && !birthDate) warnings.push("BIRTH_DATE_INVALID");
  const sourceHashPayload = {
    sourceType,
    sourceId,
    status: normalizedStatus,
    deleted,
    name: name.searchValue,
    birthDate,
    identifiers: identifiers.map((identifier) => ({
      type: identifier.type,
      canonicalValue: identifier.canonicalValue,
      classification: identifier.classification,
      valid: identifier.valid
    })),
    address: address.fields
  };

  return {
    modelVersion: SOURCE_MODEL_VERSION,
    normalizationVersion: NORMALIZATION_VERSION,
    sourceType,
    sourceId,
    sourceUpdatedAt: timestamp.value,
    sourceStatus: status,
    sourceDeleted: deleted,
    sourceInactive: inactive,
    sourceHash: sha256(stableStringify(sourceHashPayload)),
    rawIdentity: {
      name: row.name || row.fantasy_name || "",
      phone: row.phone || "",
      mobile: row.mobile || "",
      document: row.document || "",
      email: row.email || "",
      address: row.address || ""
    },
    normalizedIdentity: {
      name,
      identifiers,
      birthDate,
      externalValues,
      address
    },
    warnings
  };
}

module.exports = {
  SOURCE_MODEL_VERSION,
  stableStringify,
  sha256,
  normalizeTimestamp,
  normalizeBirthDate,
  buildSourceRecord
};
