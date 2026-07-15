"use strict";

const { run, get, all } = require("../../../db");
const {
  listDefaultPaymentMappings,
  normalizePaymentMethod,
  PAYMENT_MAPPING_STATUSES
} = require("../domain/fiscalPaymentReadiness");

function nowIso() {
  return new Date().toISOString();
}

function mapPayment(row = null) {
  if (!row) return null;
  return {
    method: row.method || "",
    label: row.label || "",
    mapping_status: row.mapping_status || PAYMENT_MAPPING_STATUSES.PENDING_ACCOUNTING,
    nfce_tpag: row.nfce_tpag == null ? null : String(row.nfce_tpag),
    brand: row.brand == null ? null : String(row.brand),
    acquirer_cnpj: row.acquirer_cnpj == null ? null : String(row.acquirer_cnpj),
    integration: row.integration == null ? null : String(row.integration),
    notes: row.notes || "",
    updated_by: row.updated_by || "",
    created_at: row.created_at || "",
    updated_at: row.updated_at || ""
  };
}

class FiscalPaymentMappingRepository {
  async ensureDefaults() {
    const stamp = nowIso();
    for (const item of listDefaultPaymentMappings()) {
      const existing = await get(
        `SELECT method FROM fiscal_payment_mapping WHERE LOWER(method) = LOWER(?)`,
        [item.method]
      );
      if (existing) continue;
      await run(
        `INSERT INTO fiscal_payment_mapping
          (method, label, mapping_status, nfce_tpag, brand, acquirer_cnpj, integration, notes, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?, 'system', ?, ?)`,
        [item.method, item.label, item.mapping_status, item.notes || "", stamp, stamp]
      );
    }
  }

  async list() {
    await this.ensureDefaults();
    const rows = await all(`SELECT * FROM fiscal_payment_mapping ORDER BY method ASC`);
    return rows.map(mapPayment);
  }

  async findByMethod(method) {
    await this.ensureDefaults();
    const normalized = normalizePaymentMethod(method);
    const row = await get(
      `SELECT * FROM fiscal_payment_mapping WHERE LOWER(method) = LOWER(?)`,
      [normalized]
    );
    return mapPayment(row);
  }

  async update(method, payload = {}, user = {}) {
    await this.ensureDefaults();
    const normalized = normalizePaymentMethod(method);
    const current = await this.findByMethod(normalized);
    if (!current) {
      const error = new Error(`Metodo de pagamento '${method}' nao encontrado no catalogo fiscal.`);
      error.code = "FISCAL_PAYMENT_MAPPING_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }
    const allowed = Object.values(PAYMENT_MAPPING_STATUSES);
    const nextStatus = payload.mapping_status || current.mapping_status;
    if (!allowed.includes(nextStatus)) {
      const error = new Error(`mapping_status invalido: ${nextStatus}`);
      error.code = "FISCAL_PAYMENT_MAPPING_INVALID";
      error.statusCode = 400;
      throw error;
    }

    const nextTpag = Object.prototype.hasOwnProperty.call(payload, "nfce_tpag")
      ? (payload.nfce_tpag == null || payload.nfce_tpag === ""
        ? null
        : String(payload.nfce_tpag).replace(/\D/g, "").slice(0, 2))
      : current.nfce_tpag;

    // Gate Stage 3: confirmed exige nfce_tpag valido (2 digitos). Nao inventa codigo.
    if (nextStatus === PAYMENT_MAPPING_STATUSES.CONFIRMED) {
      if (!nextTpag || !/^\d{2}$/.test(nextTpag)) {
        const error = new Error(
          "mapping_status=confirmed exige nfce_tpag valido (2 digitos) confirmado pela contabilidae."
        );
        error.code = "FISCAL_PAYMENT_TPAG_REQUIRED";
        error.statusCode = 400;
        throw error;
      }
    }

    // Nunca gravar fallback silencioso 99/05 — so aceita valor explicito acima.
    if (nextTpag && !/^\d{2}$/.test(nextTpag)) {
      const error = new Error("nfce_tpag invalido. Informe exatamente 2 digitos ou null.");
      error.code = "FISCAL_PAYMENT_TPAG_INVALID";
      error.statusCode = 400;
      throw error;
    }

    await run(
      `UPDATE fiscal_payment_mapping SET
        label = ?, mapping_status = ?, nfce_tpag = ?, brand = ?, acquirer_cnpj = ?,
        integration = ?, notes = ?, updated_by = ?, updated_at = ?
       WHERE LOWER(method) = LOWER(?)`,
      [
        String(payload.label ?? current.label ?? ""),
        nextStatus,
        nextStatus === PAYMENT_MAPPING_STATUSES.CONFIRMED ? nextTpag : (nextTpag || null),
        Object.prototype.hasOwnProperty.call(payload, "brand")
          ? (payload.brand ? String(payload.brand) : null)
          : current.brand,
        Object.prototype.hasOwnProperty.call(payload, "acquirer_cnpj")
          ? (payload.acquirer_cnpj ? String(payload.acquirer_cnpj) : null)
          : current.acquirer_cnpj,
        Object.prototype.hasOwnProperty.call(payload, "integration")
          ? (payload.integration ? String(payload.integration) : null)
          : current.integration,
        String(payload.notes ?? current.notes ?? ""),
        String(user.name || user.email || "sistema"),
        nowIso(),
        normalized
      ]
    );
    return this.findByMethod(normalized);
  }
}

module.exports = {
  FiscalPaymentMappingRepository,
  mapPayment
};
