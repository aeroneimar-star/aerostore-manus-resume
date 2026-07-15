"use strict";

/**
 * Saneamento fiscal manual — Stage 3.
 * Sem correção automática por nome/descrição.
 */

const { FiscalProductTaxRepository, buildProductRef } = require("../repositories/FiscalProductTaxRepository");
const { FiscalTaxProfileRepository } = require("../repositories/FiscalTaxProfileRepository");
const { recordFiscalAudit } = require("./fiscalAudit");
const {
  normalizeText,
  normalizeDigits,
  isValidNcm,
  isValidFiscalOrigin,
  isValidGtin
} = require("../utils/fiscalValidators");

const productTaxRepository = new FiscalProductTaxRepository();
const profileRepository = new FiscalTaxProfileRepository();
const MAX_CSV_ROWS = 500;

function parseCsv(text = "") {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const split = (line) => {
    const cells = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        cells.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  };
  const headers = split(lines[0]).map((h) => h.toLowerCase());
  const rows = lines.slice(1).map((line, index) => {
    const cells = split(line);
    const obj = { _line: index + 2 };
    headers.forEach((header, i) => {
      obj[header] = cells[i] ?? "";
    });
    return obj;
  });
  return { headers, rows };
}

function toCsv(rows = [], headers = []) {
  const escape = (value) => {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function previewBatchProfileApply({
  productRefs = [],
  profileId = null,
  profileCode = "",
  overwriteVariantOverrides = false
} = {}) {
  const refs = Array.isArray(productRefs) ? productRefs.map((r) => normalizeText(r)).filter(Boolean) : [];
  if (!refs.length) {
    const error = new Error("Selecione ao menos um product_ref para aplicacao em lote.");
    error.code = "FISCAL_SANITATION_INVALID";
    error.statusCode = 400;
    throw error;
  }
  let profile = null;
  if (profileId) profile = await profileRepository.findById(profileId);
  if (!profile && profileCode) profile = await profileRepository.findByCode(profileCode);
  if (!profile) {
    const error = new Error("Perfil tributario nao encontrado para o lote.");
    error.code = "FISCAL_TAX_PROFILE_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }

  const planned = [];
  const skipped = [];
  for (const productRef of refs) {
    const current = await productTaxRepository.findByProductRef(productRef);
    if (current?.variant_id && current.inherit_from_parent === false && !overwriteVariantOverrides) {
      skipped.push({
        product_ref: productRef,
        reason: "variant_override_protected",
        message: "Variacao com override nao sera sobrescrita sem autorizacao explicita"
      });
      continue;
    }
    planned.push({
      product_ref: productRef,
      before_profile_id: current?.profile_id || null,
      after_profile_id: profile.id,
      profile_code: profile.code,
      creates_row: !current
    });
  }

  return {
    preview: true,
    profile_id: profile.id,
    profile_code: profile.code,
    overwrite_variant_overrides: Boolean(overwriteVariantOverrides),
    planned_count: planned.length,
    skipped_count: skipped.length,
    planned,
    skipped
  };
}

async function applyBatchProfile({
  productRefs = [],
  profileId = null,
  profileCode = "",
  overwriteVariantOverrides = false,
  confirm = false,
  user = {}
} = {}) {
  if (!confirm) {
    const error = new Error("Aplicacao em lote exige confirm=true apos previa.");
    error.code = "FISCAL_SANITATION_CONFIRM_REQUIRED";
    error.statusCode = 400;
    throw error;
  }
  const preview = await previewBatchProfileApply({
    productRefs,
    profileId,
    profileCode,
    overwriteVariantOverrides
  });
  const applied = [];
  for (const item of preview.planned) {
    const current = await productTaxRepository.findByProductRef(item.product_ref);
    const payload = current
      ? { ...current, profile_id: preview.profile_id }
      : {
        product_ref: item.product_ref,
        profile_id: preview.profile_id,
        inherit_from_parent: !String(item.product_ref).startsWith("variant:")
      };
    if (String(item.product_ref).startsWith("variant:")) {
      payload.variant_id = item.product_ref.slice("variant:".length);
    } else if (String(item.product_ref).startsWith("product:")) {
      payload.product_id = Number(item.product_ref.slice("product:".length)) || null;
    } else if (String(item.product_ref).startsWith("legacy:")) {
      payload.legacy_ai_product_id = Number(item.product_ref.slice("legacy:".length)) || null;
    }
    const saved = await productTaxRepository.upsert(payload, user);
    applied.push(saved);
  }

  await recordFiscalAudit({
    action: "FISCAL_SANITATION_BATCH_PROFILE_APPLIED",
    user,
    message: `Lote perfil ${preview.profile_code}: ${applied.length} itens`,
    metadata: {
      profile_id: preview.profile_id,
      applied_count: applied.length,
      skipped_count: preview.skipped_count,
      overwrite_variant_overrides: Boolean(overwriteVariantOverrides)
    }
  });

  return {
    applied: true,
    profile_id: preview.profile_id,
    profile_code: preview.profile_code,
    applied_count: applied.length,
    skipped: preview.skipped,
    items: applied
  };
}

async function importProductTaxCsv({
  csvText = "",
  dryRun = true,
  confirm = false,
  user = {}
} = {}) {
  const raw = String(csvText || "");
  if (!raw.trim()) {
    const error = new Error("CSV vazio ou malformado.");
    error.code = "FISCAL_IMPORT_INVALID";
    error.statusCode = 400;
    throw error;
  }
  const { headers, rows } = parseCsv(raw);
  if (!headers.length) {
    const error = new Error("CSV malformado: cabecalho ausente.");
    error.code = "FISCAL_IMPORT_INVALID";
    error.statusCode = 400;
    throw error;
  }
  const requiredAny = ["product_ref", "sku", "product_id", "variant_id"];
  if (!headers.some((h) => requiredAny.includes(h))) {
    const error = new Error("CSV deve conter product_ref, sku, product_id ou variant_id.");
    error.code = "FISCAL_IMPORT_INVALID";
    error.statusCode = 400;
    throw error;
  }
  if (rows.length > MAX_CSV_ROWS) {
    const error = new Error(`CSV excede limite seguro de ${MAX_CSV_ROWS} linhas.`);
    error.code = "FISCAL_IMPORT_TOO_LARGE";
    error.statusCode = 400;
    throw error;
  }

  const errors = [];
  const planned = [];
  const seenRefs = new Set();
  for (const row of rows) {
    const lineErrors = [];
    let profileId = null;
    if (row.profile_code || row.profile_id) {
      const profile = row.profile_id
        ? await profileRepository.findById(row.profile_id)
        : await profileRepository.findByCode(row.profile_code);
      if (!profile) lineErrors.push("profile_not_found");
      else profileId = profile.id;
    }
    if (row.cest_status === "cest_not_applicable" && !normalizeText(row.cest_na_justification || "")) {
      lineErrors.push("cest_na_justification_required");
    }
    const productRef = normalizeText(row.product_ref || "")
      || buildProductRef({
        productId: row.product_id,
        variantId: row.variant_id,
        legacyAiProductId: row.legacy_ai_product_id
      });
    if (!productRef) lineErrors.push("product_ref_required");
    if (productRef && seenRefs.has(productRef)) lineErrors.push("duplicate_product_ref");
    if (productRef) seenRefs.add(productRef);

    if (row.ncm) {
      if (!isValidNcm(row.ncm)) lineErrors.push("ncm_invalid");
    }
    if (row.origem || row.origin) {
      const origin = row.origem || row.origin;
      if (!isValidFiscalOrigin(origin)) lineErrors.push("origin_invalid");
    }
    if (Object.prototype.hasOwnProperty.call(row, "inherit_from_parent") && row.inherit_from_parent !== "") {
      if (!["0", "1", "true", "false", "sim", "nao", "não"].includes(String(row.inherit_from_parent).toLowerCase())) {
        lineErrors.push("inherit_from_parent_invalid");
      }
    }
    const gtinRaw = row.gtin || row.gtin_ean || "";
    if (/sem\s*gtin/i.test(String(gtinRaw))) {
      lineErrors.push("gtin_sem_gtin_not_allowed_stage3");
    } else if (gtinRaw && !isValidGtin(gtinRaw)) {
      lineErrors.push("gtin_invalid");
    }

    if (lineErrors.length) {
      errors.push({ line: row._line, errors: lineErrors, row });
      continue;
    }
    const inheritRaw = String(row.inherit_from_parent || "1").toLowerCase();
    const originRaw = Object.prototype.hasOwnProperty.call(row, "origem")
      ? row.origem
      : (Object.prototype.hasOwnProperty.call(row, "origin") ? row.origin : "");
    const unitRaw = Object.prototype.hasOwnProperty.call(row, "unidade")
      ? row.unidade
      : (Object.prototype.hasOwnProperty.call(row, "unit") ? row.unit : "");
    planned.push({
      line: row._line,
      product_ref: productRef,
      product_id: row.product_id || null,
      variant_id: row.variant_id || null,
      legacy_ai_product_id: row.legacy_ai_product_id || null,
      ncm: row.ncm || null,
      cest: row.cest || null,
      // preservar origem "0" (nacional) — nao usar || que tambem e seguro para string, mas hasOwnProperty evita ambiguidade
      origin: originRaw === "" || originRaw == null ? null : String(originRaw),
      unit: unitRaw === "" || unitRaw == null ? null : String(unitRaw),
      gtin_ean: gtinRaw || null,
      profile_id: profileId,
      inherit_from_parent: !["0", "false", "nao", "não"].includes(inheritRaw),
      cest_status: row.cest_status || undefined,
      cest_na_justification: row.cest_na_justification || ""
    });
  }

  if (dryRun || !confirm) {
    return {
      dry_run: true,
      headers,
      planned_count: planned.length,
      error_count: errors.length,
      planned,
      errors,
      applied: false,
      max_rows: MAX_CSV_ROWS
    };
  }

  if (errors.length) {
    const error = new Error("Importacao recusada: existem erros de linha. Nenhuma alteracao aplicada.");
    error.code = "FISCAL_IMPORT_HAS_ERRORS";
    error.statusCode = 400;
    error.details = { errors, planned_count: planned.length };
    throw error;
  }

  const applied = [];
  for (const item of planned) {
    try {
      applied.push(await productTaxRepository.upsert(item, user));
    } catch (error) {
      const fail = new Error(
        `Importacao interrompida na linha/ref ${item.product_ref}. Nenhuma falha silenciosa; aplicados ate o momento: ${applied.length}.`
      );
      fail.code = "FISCAL_IMPORT_APPLY_ERRORS";
      fail.statusCode = 400;
      fail.details = {
        applied_count: applied.length,
        failed_ref: item.product_ref,
        error: error.message,
        code: error.code || "FISCAL_ERROR"
      };
      throw fail;
    }
  }

  await recordFiscalAudit({
    action: "FISCAL_SANITATION_CSV_IMPORTED",
    user,
    message: `Importacao fiscal: ${applied.length} linhas`,
    metadata: { applied_count: applied.length }
  });

  return {
    dry_run: false,
    applied: true,
    applied_count: applied.length,
    items: applied,
    errors: []
  };
}

function buildPendingExportRows(items = []) {
  return (items || []).map((item) => ({
    product_ref: item.product_ref || item.label || "",
    sku: item.label || "",
    nome: item.name || "",
    status: item.status || "",
    gaps: (item.blocking_errors || []).map((f) => f.code).concat((item.warnings || []).map((f) => f.code)).join("|"),
    ncm: "",
    cest: "",
    origem: "",
    unidade: "",
    gtin: "",
    profile_code: "",
    inherit_from_parent: "1",
    cest_status: item.cest_status || "cest_required_unknown",
    cest_na_justification: ""
  }));
}

function exportPendingCsv(items = []) {
  const headers = [
    "product_ref", "sku", "nome", "status", "gaps",
    "ncm", "cest", "origem", "unidade", "gtin",
    "profile_code", "inherit_from_parent", "cest_status", "cest_na_justification"
  ];
  return toCsv(buildPendingExportRows(items), headers);
}

module.exports = {
  previewBatchProfileApply,
  applyBatchProfile,
  importProductTaxCsv,
  exportPendingCsv,
  parseCsv
};
