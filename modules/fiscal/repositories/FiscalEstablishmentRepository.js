"use strict";

const { run, get, all } = require("../../../db");
const { normalizeStoreKey } = require("../../pdv/utils/pdvStoreUtils");
const {
  normalizeText,
  normalizeDigits,
  normalizeUf,
  isValidCnpj,
  isValidUf
} = require("../utils/fiscalValidators");

function nowIso() {
  return new Date().toISOString();
}

function normalizeEnvironment(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "producao" || raw === "production" || raw === "prod") {
    return "producao";
  }
  return "homologacao";
}

function toBoolInt(value, fallback = true) {
  if (value === false || value === 0 || value === "0") return 0;
  if (value === true || value === 1 || value === "1") return 1;
  return fallback ? 1 : 0;
}

function mapEstablishment(row = null) {
  if (!row) return null;
  return {
    id: Number(row.id),
    code: row.code || "",
    legal_name: row.legal_name || "",
    trade_name: row.trade_name || "",
    cnpj: row.cnpj || "",
    ie: row.ie || "",
    im: row.im || "",
    crt: row.crt || "",
    tax_regime: row.tax_regime || "",
    cnae_principal: row.cnae_principal || "",
    street: row.street || "",
    number: row.number || "",
    complement: row.complement || "",
    district: row.district || "",
    city: row.city || "",
    city_ibge_code: row.city_ibge_code || "",
    uf: row.uf || "",
    zip: row.zip || "",
    phone: row.phone || "",
    environment: row.environment || "homologacao",
    active: Number(row.active) === 1,
    certificate_configured: Number(row.certificate_configured || 0) === 1,
    csc_configured: Number(row.csc_configured || 0) === 1,
    provider_configured: Number(row.provider_configured || 0) === 1,
    created_at: row.created_at || "",
    updated_at: row.updated_at || ""
  };
}

function validateEstablishmentPayload(payload = {}, { partial = false } = {}) {
  const errors = [];
  const cnpj = normalizeDigits(payload.cnpj || "");
  const uf = normalizeUf(payload.uf || "");
  if (!partial || Object.prototype.hasOwnProperty.call(payload, "cnpj")) {
    if (!cnpj) errors.push("cnpj_required");
    else if (!isValidCnpj(cnpj)) errors.push("cnpj_invalid");
  }
  if (!partial || Object.prototype.hasOwnProperty.call(payload, "legal_name")) {
    if (!normalizeText(payload.legal_name || "")) errors.push("legal_name_required");
  }
  if (!partial || Object.prototype.hasOwnProperty.call(payload, "uf")) {
    if (!uf) errors.push("uf_required");
    else if (!isValidUf(uf)) errors.push("uf_invalid");
  }
  // UF do endereço deve coincidir com UF fiscal quando ambas informadas
  if (uf && payload.address_uf) {
    const addressUf = normalizeUf(payload.address_uf);
    if (addressUf && addressUf !== uf) {
      errors.push("uf_address_mismatch");
    }
  }
  // CEP: se informado, exige 8 dígitos (não bloqueia homologação se vazio)
  if (Object.prototype.hasOwnProperty.call(payload, "zip") && payload.zip) {
    const zip = normalizeDigits(payload.zip);
    if (zip.length !== 8) errors.push("zip_invalid");
  }
  // IBGE: se informado, 7 dígitos
  if (Object.prototype.hasOwnProperty.call(payload, "city_ibge_code") && payload.city_ibge_code) {
    const ibge = normalizeDigits(payload.city_ibge_code);
    if (ibge.length !== 7) errors.push("city_ibge_code_invalid");
  }
  return errors;
}

function buildEstablishmentWriteValues(payload = {}) {
  return {
    code: normalizeText(payload.code || ""),
    legal_name: normalizeText(payload.legal_name || ""),
    trade_name: normalizeText(payload.trade_name || ""),
    cnpj: normalizeDigits(payload.cnpj || ""),
    ie: normalizeText(payload.ie || ""),
    im: normalizeText(payload.im || ""),
    crt: normalizeText(payload.crt || ""),
    tax_regime: normalizeText(payload.tax_regime || ""),
    cnae_principal: normalizeText(payload.cnae_principal || ""),
    street: normalizeText(payload.street || ""),
    number: normalizeText(payload.number || ""),
    complement: normalizeText(payload.complement || ""),
    district: normalizeText(payload.district || ""),
    city: normalizeText(payload.city || ""),
    city_ibge_code: normalizeDigits(payload.city_ibge_code || ""),
    uf: normalizeUf(payload.uf || ""),
    zip: normalizeDigits(payload.zip || ""),
    phone: normalizeText(payload.phone || ""),
    environment: normalizeEnvironment(payload.environment),
    active: toBoolInt(payload.active, true),
    certificate_configured: toBoolInt(payload.certificate_configured, false),
    csc_configured: toBoolInt(payload.csc_configured, false),
    provider_configured: toBoolInt(payload.provider_configured, false)
  };
}

class FiscalEstablishmentRepository {
  async create(payload = {}) {
    const errors = validateEstablishmentPayload(payload);
    if (errors.length) {
      const error = new Error(`Estabelecimento fiscal invalido: ${errors.join(", ")}`);
      error.code = "FISCAL_ESTABLISHMENT_INVALID";
      error.statusCode = 400;
      error.errors = errors;
      throw error;
    }
    const values = buildEstablishmentWriteValues(payload);
    const createdAt = nowIso();
    const result = await run(
      `INSERT INTO fiscal_establishments (
        code, legal_name, trade_name, cnpj, ie, im, crt, tax_regime, cnae_principal,
        street, number, complement, district, city, city_ibge_code, uf, zip, phone,
        environment, active, certificate_configured, csc_configured, provider_configured,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        values.code, values.legal_name, values.trade_name, values.cnpj, values.ie, values.im,
        values.crt, values.tax_regime, values.cnae_principal, values.street, values.number,
        values.complement, values.district, values.city, values.city_ibge_code, values.uf,
        values.zip, values.phone, values.environment, values.active,
        values.certificate_configured, values.csc_configured, values.provider_configured,
        createdAt, createdAt
      ]
    );
    return this.findById(result.lastID);
  }

  async update(id, payload = {}) {
    const current = await this.findById(id);
    if (!current) {
      const error = new Error("Estabelecimento fiscal nao encontrado.");
      error.code = "FISCAL_ESTABLISHMENT_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }
    const merged = { ...current, ...payload, cnpj: payload.cnpj ?? current.cnpj };
    const errors = validateEstablishmentPayload(merged);
    if (errors.length) {
      const error = new Error(`Estabelecimento fiscal invalido: ${errors.join(", ")}`);
      error.code = "FISCAL_ESTABLISHMENT_INVALID";
      error.statusCode = 400;
      error.errors = errors;
      throw error;
    }
    const values = buildEstablishmentWriteValues(merged);
    await run(
      `UPDATE fiscal_establishments SET
        code = ?, legal_name = ?, trade_name = ?, cnpj = ?, ie = ?, im = ?, crt = ?,
        tax_regime = ?, cnae_principal = ?, street = ?, number = ?, complement = ?,
        district = ?, city = ?, city_ibge_code = ?, uf = ?, zip = ?, phone = ?,
        environment = ?, active = ?, certificate_configured = ?, csc_configured = ?,
        provider_configured = ?, updated_at = ?
       WHERE id = ?`,
      [
        values.code, values.legal_name, values.trade_name, values.cnpj, values.ie, values.im,
        values.crt, values.tax_regime, values.cnae_principal, values.street, values.number,
        values.complement, values.district, values.city, values.city_ibge_code, values.uf,
        values.zip, values.phone, values.environment, values.active,
        values.certificate_configured, values.csc_configured, values.provider_configured,
        nowIso(), Number(id) || 0
      ]
    );
    return this.findById(id);
  }

  async findById(id) {
    const row = await get(`SELECT * FROM fiscal_establishments WHERE id = ?`, [Number(id) || 0]);
    return mapEstablishment(row);
  }

  async list({ activeOnly = false, environment = "" } = {}) {
    const clauses = [];
    const params = [];
    if (activeOnly) {
      clauses.push("active = 1");
    }
    if (environment) {
      clauses.push("environment = ?");
      params.push(normalizeEnvironment(environment));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await all(
      `SELECT * FROM fiscal_establishments ${where} ORDER BY id ASC`,
      params
    );
    return rows.map(mapEstablishment);
  }

  async linkStore(establishmentId, storeId, { active = true } = {}) {
    const estId = Number(establishmentId) || 0;
    const store = normalizeStoreKey(storeId);
    if (!estId || !store) {
      const error = new Error("establishment_id e store_id sao obrigatorios para vinculo fiscal.");
      error.code = "FISCAL_STORE_LINK_INVALID";
      error.statusCode = 400;
      throw error;
    }
    if (active) {
      const conflict = await get(
        `SELECT * FROM fiscal_establishment_stores
         WHERE store_id = ? AND active = 1 AND establishment_id != ?`,
        [store, estId]
      );
      if (conflict) {
        const error = new Error(
          `A loja '${store}' ja possui vinculo ativo com outro estabelecimento fiscal (id=${conflict.establishment_id}).`
        );
        error.code = "FISCAL_STORE_ACTIVE_LINK_CONFLICT";
        error.statusCode = 409;
        error.store_id = store;
        error.conflicting_establishment_id = Number(conflict.establishment_id);
        throw error;
      }
    }
    const existing = await get(
      `SELECT * FROM fiscal_establishment_stores
       WHERE establishment_id = ? AND store_id = ?`,
      [estId, store]
    );
    const stamp = nowIso();
    if (existing) {
      await run(
        `UPDATE fiscal_establishment_stores
         SET active = ?, updated_at = ?
         WHERE id = ?`,
        [active ? 1 : 0, stamp, existing.id]
      );
      return this.getStoreLink(estId, store);
    }
    try {
      await run(
        `INSERT INTO fiscal_establishment_stores (
          establishment_id, store_id, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)`,
        [estId, store, active ? 1 : 0, stamp, stamp]
      );
    } catch (error) {
      const message = String(error?.message || error || "");
      if (/UNIQUE constraint failed/i.test(message)) {
        const conflictError = new Error(
          `Vinculo ativo duplicado para a loja '${store}'. store_id nao pode apontar a dois estabelecimentos ativos.`
        );
        conflictError.code = "FISCAL_STORE_ACTIVE_LINK_CONFLICT";
        conflictError.statusCode = 409;
        conflictError.store_id = store;
        throw conflictError;
      }
      throw error;
    }
    return this.getStoreLink(estId, store);
  }

  async getStoreLink(establishmentId, storeId) {
    const row = await get(
      `SELECT * FROM fiscal_establishment_stores
       WHERE establishment_id = ? AND store_id = ?`,
      [Number(establishmentId) || 0, normalizeStoreKey(storeId)]
    );
    if (!row) return null;
    return {
      id: Number(row.id),
      establishment_id: Number(row.establishment_id),
      store_id: row.store_id,
      active: Number(row.active) === 1,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  async listStoreIds(establishmentId, { activeOnly = true } = {}) {
    const params = [Number(establishmentId) || 0];
    let sql = `SELECT store_id FROM fiscal_establishment_stores WHERE establishment_id = ?`;
    if (activeOnly) {
      sql += " AND active = 1";
    }
    sql += " ORDER BY store_id ASC";
    const rows = await all(sql, params);
    return rows.map((row) => row.store_id);
  }

  async listStoreLinks(establishmentId) {
    const rows = await all(
      `SELECT * FROM fiscal_establishment_stores
       WHERE establishment_id = ?
       ORDER BY store_id ASC`,
      [Number(establishmentId) || 0]
    );
    return rows.map((row) => ({
      id: Number(row.id),
      establishment_id: Number(row.establishment_id),
      store_id: row.store_id,
      active: Number(row.active) === 1,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  async findActiveByStoreId(storeId, { environment = "" } = {}) {
    const store = normalizeStoreKey(storeId);
    if (!store) return null;
    const params = [store];
    let envClause = "";
    if (environment) {
      envClause = " AND e.environment = ?";
      params.push(normalizeEnvironment(environment));
    }
    const row = await get(
      `SELECT e.*
       FROM fiscal_establishment_stores s
       INNER JOIN fiscal_establishments e ON e.id = s.establishment_id
       WHERE s.store_id = ?
         AND s.active = 1
         AND e.active = 1
         ${envClause}
       ORDER BY e.id ASC
       LIMIT 1`,
      params
    );
    return mapEstablishment(row);
  }

  completenessGaps(establishment = null) {
    if (!establishment) {
      return ["establishment_missing"];
    }
    const gaps = [];
    if (!establishment.legal_name) gaps.push("emitter_legal_name_missing");
    if (!establishment.cnpj || !isValidCnpj(establishment.cnpj)) gaps.push("emitter_cnpj_missing");
    if (!establishment.uf) gaps.push("emitter_uf_missing");
    if (!establishment.ie) gaps.push("emitter_ie_missing");
    if (!establishment.tax_regime && !establishment.crt) gaps.push("emitter_regime_missing");
    if (!establishment.city) gaps.push("emitter_city_missing");
    if (!establishment.street) gaps.push("emitter_street_missing");
    // Marcadores booleanos apenas — NÃO comprovam certificado/CSC/provedor reais.
    if (!establishment.certificate_configured) gaps.push("certificate_marker_unset");
    if (!establishment.csc_configured) gaps.push("csc_marker_unset");
    if (!establishment.provider_configured) gaps.push("provider_marker_unset");
    return gaps;
  }
}

module.exports = {
  FiscalEstablishmentRepository,
  validateEstablishmentPayload,
  mapEstablishment
};
