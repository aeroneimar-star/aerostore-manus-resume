"use strict";

const { run, get, all } = require("../../../db");
const { normalizeStoreKey } = require("../../pdv/utils/pdvStoreUtils");

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizeEnvironment(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "producao" || raw === "production" || raw === "prod") {
    return "producao";
  }
  return "homologacao";
}

function mapEstablishment(row = null) {
  if (!row) return null;
  return {
    id: Number(row.id),
    legal_name: row.legal_name || "",
    trade_name: row.trade_name || "",
    cnpj: row.cnpj || "",
    ie: row.ie || "",
    tax_regime: row.tax_regime || "",
    uf: row.uf || "",
    environment: row.environment || "homologacao",
    active: Number(row.active) === 1,
    created_at: row.created_at || "",
    updated_at: row.updated_at || ""
  };
}

class FiscalEstablishmentRepository {
  async create(payload = {}) {
    const createdAt = nowIso();
    const result = await run(
      `INSERT INTO fiscal_establishments (
        legal_name, trade_name, cnpj, ie, tax_regime, uf, environment, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizeText(payload.legal_name || ""),
        normalizeText(payload.trade_name || ""),
        normalizeDigits(payload.cnpj || ""),
        normalizeText(payload.ie || ""),
        normalizeText(payload.tax_regime || ""),
        normalizeText(payload.uf || "").toUpperCase(),
        normalizeEnvironment(payload.environment),
        payload.active === false || payload.active === 0 ? 0 : 1,
        createdAt,
        createdAt
      ]
    );
    return this.findById(result.lastID);
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
    // store_id nao e CNPJ: uma loja so pode ter um vinculo ativo por vez.
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

  /**
   * Resolve estabelecimento ativo para uma loja operacional.
   * store_id != CNPJ: o vínculo é via fiscal_establishment_stores.
   */
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
}

module.exports = {
  FiscalEstablishmentRepository
};
