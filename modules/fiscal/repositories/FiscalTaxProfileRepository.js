"use strict";

const { run, get, all } = require("../../../db");
const { normalizeText, normalizeUf, isValidUfOrEmpty } = require("../utils/fiscalValidators");
const { normalizeFiscalOperationType, FISCAL_OPERATION_TYPES } = require("../domain/fiscalOperations");

function nowIso() {
  return new Date().toISOString();
}

function toNullableText(value) {
  const text = normalizeText(value || "");
  return text || null;
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapProfile(row = null) {
  if (!row) return null;
  return {
    id: Number(row.id),
    code: row.code || "",
    name: row.name || "",
    description: row.description || "",
    establishment_id: row.establishment_id == null ? null : Number(row.establishment_id),
    operation_type: row.operation_type || FISCAL_OPERATION_TYPES.SALE_INTERNAL,
    origin_uf: row.origin_uf || "",
    destination_uf: row.destination_uf || "",
    cfop: row.cfop == null ? null : String(row.cfop),
    csosn: row.csosn == null ? null : String(row.csosn),
    cst_icms: row.cst_icms == null ? null : String(row.cst_icms),
    pis_cst: row.pis_cst == null ? null : String(row.pis_cst),
    cofins_cst: row.cofins_cst == null ? null : String(row.cofins_cst),
    ipi_cst: row.ipi_cst == null ? null : String(row.ipi_cst),
    icms_rate: row.icms_rate == null ? null : Number(row.icms_rate),
    pis_rate: row.pis_rate == null ? null : Number(row.pis_rate),
    cofins_rate: row.cofins_rate == null ? null : Number(row.cofins_rate),
    ipi_rate: row.ipi_rate == null ? null : Number(row.ipi_rate),
    base_reduction_rate: row.base_reduction_rate == null ? null : Number(row.base_reduction_rate),
    benefit_code: row.benefit_code == null ? null : String(row.benefit_code),
    additional_info: row.additional_info == null ? null : String(row.additional_info),
    active: Number(row.active) === 1,
    is_test_profile: Number(row.is_test_profile || 0) === 1,
    created_at: row.created_at || "",
    updated_at: row.updated_at || ""
  };
}

class FiscalTaxProfileRepository {
  async create(payload = {}) {
    const code = normalizeText(payload.code || "").toUpperCase();
    const name = normalizeText(payload.name || "");
    if (!code || !name) {
      const error = new Error("code e name sao obrigatorios no perfil tributario.");
      error.code = "FISCAL_TAX_PROFILE_INVALID";
      error.statusCode = 400;
      throw error;
    }
    const rawOp = String(payload.operation_type || "").trim();
    const operationType = rawOp
      ? normalizeFiscalOperationType(rawOp)
      : FISCAL_OPERATION_TYPES.SALE_INTERNAL;
    if (!operationType) {
      const error = new Error(`operation_type invalido: '${rawOp}'.`);
      error.code = "FISCAL_TAX_PROFILE_INVALID";
      error.statusCode = 400;
      throw error;
    }
    const originUf = normalizeUf(payload.origin_uf || "");
    const destinationUf = normalizeUf(payload.destination_uf || "");
    if (!isValidUfOrEmpty(originUf) || !isValidUfOrEmpty(destinationUf)) {
      const error = new Error("origin_uf/destination_uf devem ser UF brasileira valida ou vazios.");
      error.code = "FISCAL_TAX_PROFILE_INVALID";
      error.statusCode = 400;
      throw error;
    }
    const stamp = nowIso();
    try {
      const result = await run(
        `INSERT INTO fiscal_tax_profiles (
          code, name, description, establishment_id, operation_type, origin_uf, destination_uf,
          cfop, csosn, cst_icms, pis_cst, cofins_cst, ipi_cst,
          icms_rate, pis_rate, cofins_rate, ipi_rate, base_reduction_rate,
          benefit_code, additional_info, active, is_test_profile, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          code,
          name,
          normalizeText(payload.description || ""),
          payload.establishment_id == null || payload.establishment_id === ""
            ? null
            : Number(payload.establishment_id),
          operationType,
          originUf,
          destinationUf,
          toNullableText(payload.cfop),
          toNullableText(payload.csosn),
          toNullableText(payload.cst_icms),
          toNullableText(payload.pis_cst),
          toNullableText(payload.cofins_cst),
          toNullableText(payload.ipi_cst),
          toNullableNumber(payload.icms_rate),
          toNullableNumber(payload.pis_rate),
          toNullableNumber(payload.cofins_rate),
          toNullableNumber(payload.ipi_rate),
          toNullableNumber(payload.base_reduction_rate),
          toNullableText(payload.benefit_code),
          toNullableText(payload.additional_info),
          payload.active === false || payload.active === 0 ? 0 : 1,
          payload.is_test_profile ? 1 : 0,
          stamp,
          stamp
        ]
      );
      return this.findById(result.lastID);
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(String(error.message || ""))) {
        const dup = new Error(`Perfil tributario com code '${code}' ja existe.`);
        dup.code = "FISCAL_TAX_PROFILE_DUPLICATE";
        dup.statusCode = 409;
        throw dup;
      }
      throw error;
    }
  }

  async update(id, payload = {}) {
    const current = await this.findById(id);
    if (!current) {
      const error = new Error("Perfil tributario nao encontrado.");
      error.code = "FISCAL_TAX_PROFILE_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "operation_type")) {
      const normalizedOp = normalizeFiscalOperationType(payload.operation_type);
      if (!normalizedOp) {
        const error = new Error(`operation_type invalido: '${payload.operation_type}'.`);
        error.code = "FISCAL_TAX_PROFILE_INVALID";
        error.statusCode = 400;
        throw error;
      }
    }
    const nextOriginUf = normalizeUf(
      Object.prototype.hasOwnProperty.call(payload, "origin_uf") ? payload.origin_uf : current.origin_uf
    );
    const nextDestinationUf = normalizeUf(
      Object.prototype.hasOwnProperty.call(payload, "destination_uf")
        ? payload.destination_uf
        : current.destination_uf
    );
    if (!isValidUfOrEmpty(nextOriginUf) || !isValidUfOrEmpty(nextDestinationUf)) {
      const error = new Error("origin_uf/destination_uf devem ser UF brasileira valida ou vazios.");
      error.code = "FISCAL_TAX_PROFILE_INVALID";
      error.statusCode = 400;
      throw error;
    }
    const next = {
      ...current,
      ...payload,
      code: normalizeText(payload.code || current.code).toUpperCase(),
      name: normalizeText(payload.name ?? current.name),
      operation_type: Object.prototype.hasOwnProperty.call(payload, "operation_type")
        ? normalizeFiscalOperationType(payload.operation_type)
        : current.operation_type,
      origin_uf: nextOriginUf,
      destination_uf: nextDestinationUf
    };
    await run(
      `UPDATE fiscal_tax_profiles SET
        code = ?, name = ?, description = ?, establishment_id = ?, operation_type = ?,
        origin_uf = ?, destination_uf = ?, cfop = ?, csosn = ?, cst_icms = ?,
        pis_cst = ?, cofins_cst = ?, ipi_cst = ?, icms_rate = ?, pis_rate = ?,
        cofins_rate = ?, ipi_rate = ?, base_reduction_rate = ?, benefit_code = ?,
        additional_info = ?, active = ?, is_test_profile = ?, updated_at = ?
       WHERE id = ?`,
      [
        next.code,
        next.name,
        normalizeText(next.description || ""),
        next.establishment_id == null ? null : Number(next.establishment_id),
        next.operation_type,
        normalizeUf(next.origin_uf || ""),
        normalizeUf(next.destination_uf || ""),
        toNullableText(next.cfop),
        toNullableText(next.csosn),
        toNullableText(next.cst_icms),
        toNullableText(next.pis_cst),
        toNullableText(next.cofins_cst),
        toNullableText(next.ipi_cst),
        toNullableNumber(next.icms_rate),
        toNullableNumber(next.pis_rate),
        toNullableNumber(next.cofins_rate),
        toNullableNumber(next.ipi_rate),
        toNullableNumber(next.base_reduction_rate),
        toNullableText(next.benefit_code),
        toNullableText(next.additional_info),
        next.active === false || next.active === 0 ? 0 : 1,
        next.is_test_profile ? 1 : 0,
        nowIso(),
        Number(id) || 0
      ]
    );
    return this.findById(id);
  }

  async findById(id) {
    const row = await get(`SELECT * FROM fiscal_tax_profiles WHERE id = ?`, [Number(id) || 0]);
    return mapProfile(row);
  }

  async findByCode(code) {
    const row = await get(
      `SELECT * FROM fiscal_tax_profiles WHERE UPPER(code) = UPPER(?)`,
      [normalizeText(code || "")]
    );
    return mapProfile(row);
  }

  async list({ activeOnly = false, operationType = "", includeTest = true } = {}) {
    const clauses = [];
    const params = [];
    if (activeOnly) {
      clauses.push("active = 1");
    }
    if (operationType) {
      clauses.push("operation_type = ?");
      params.push(normalizeFiscalOperationType(operationType) || operationType);
    }
    if (!includeTest) {
      clauses.push("is_test_profile = 0");
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await all(
      `SELECT * FROM fiscal_tax_profiles ${where} ORDER BY code ASC`,
      params
    );
    return rows.map(mapProfile);
  }
}

module.exports = {
  FiscalTaxProfileRepository,
  mapProfile
};
