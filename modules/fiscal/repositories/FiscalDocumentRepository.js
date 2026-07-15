"use strict";

const { run, get, all } = require("../../../db");

function nowIso() {
  return new Date().toISOString();
}

function parseSnapshot(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch (_error) {
    return null;
  }
}

function mapDocument(row = null) {
  if (!row) return null;
  return {
    id: Number(row.id),
    sale_id: row.sale_id || "",
    establishment_id: row.establishment_id === null || row.establishment_id === undefined
      ? null
      : Number(row.establishment_id),
    model: row.model || "65",
    purpose: row.purpose || "sale_emit",
    status: row.status || "PENDING",
    idempotency_key: row.idempotency_key || "",
    snapshot: parseSnapshot(row.snapshot_json),
    snapshot_json: row.snapshot_json || "",
    access_key: row.access_key || null,
    protocol: row.protocol || null,
    rejection_code: row.rejection_code || null,
    rejection_message: row.rejection_message || null,
    provider_ref: row.provider_ref || null,
    authorized_at: row.authorized_at || null,
    cancelled_at: row.cancelled_at || null,
    created_at: row.created_at || "",
    updated_at: row.updated_at || ""
  };
}

class FiscalDocumentRepository {
  async findById(id) {
    const row = await get(`SELECT * FROM fiscal_documents WHERE id = ?`, [Number(id) || 0]);
    return mapDocument(row);
  }

  async findByIdempotencyKey(idempotencyKey = "") {
    const row = await get(
      `SELECT * FROM fiscal_documents WHERE idempotency_key = ?`,
      [String(idempotencyKey || "").trim()]
    );
    return mapDocument(row);
  }

  async findBySaleModelPurpose(saleId, model = "65", purpose = "sale_emit") {
    const row = await get(
      `SELECT * FROM fiscal_documents
       WHERE sale_id = ? AND model = ? AND purpose = ?`,
      [String(saleId || "").trim(), String(model || "65"), String(purpose || "sale_emit")]
    );
    return mapDocument(row);
  }

  async listBySaleId(saleId) {
    const rows = await all(
      `SELECT * FROM fiscal_documents WHERE sale_id = ? ORDER BY id ASC`,
      [String(saleId || "").trim()]
    );
    return rows.map(mapDocument);
  }

  async list({ status = "", limit = 50, offset = 0 } = {}) {
    const clauses = [];
    const params = [];
    if (status) {
      clauses.push("status = ?");
      params.push(String(status).trim().toUpperCase());
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    params.push(safeLimit, safeOffset);
    const rows = await all(
      `SELECT * FROM fiscal_documents ${where}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      params
    );
    return rows.map(mapDocument);
  }

  async create({
    saleId,
    establishmentId = null,
    model = "65",
    purpose = "sale_emit",
    status = "PENDING",
    idempotencyKey,
    snapshot
  } = {}) {
    const stamp = nowIso();
    const snapshotJson = typeof snapshot === "string"
      ? snapshot
      : JSON.stringify(snapshot || {});
    try {
      const result = await run(
        `INSERT INTO fiscal_documents (
          sale_id, establishment_id, model, purpose, status, idempotency_key,
          snapshot_json, access_key, protocol, rejection_code, rejection_message,
          provider_ref, authorized_at, cancelled_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
        [
          String(saleId || "").trim(),
          establishmentId === null || establishmentId === undefined ? null : Number(establishmentId),
          String(model || "65"),
          String(purpose || "sale_emit"),
          String(status || "PENDING"),
          String(idempotencyKey || "").trim(),
          snapshotJson,
          stamp,
          stamp
        ]
      );
      return this.findById(result.lastID);
    } catch (error) {
      const message = String(error?.message || error || "");
      if (/UNIQUE constraint failed/i.test(message)) {
        const existing = await this.findByIdempotencyKey(idempotencyKey)
          || await this.findBySaleModelPurpose(saleId, model, purpose);
        if (existing) {
          const duplicate = new Error("Solicitacao fiscal ja existe para esta venda.");
          duplicate.code = "FISCAL_DOCUMENT_DUPLICATE";
          duplicate.statusCode = 409;
          duplicate.existing = existing;
          throw duplicate;
        }
      }
      throw error;
    }
  }

  async updateStatus(id, status, extra = {}) {
    const stamp = nowIso();
    const fields = ["status = ?", "updated_at = ?"];
    const params = [String(status || "").trim().toUpperCase(), stamp];
    if (Object.prototype.hasOwnProperty.call(extra, "rejection_code")) {
      fields.push("rejection_code = ?");
      params.push(extra.rejection_code);
    }
    if (Object.prototype.hasOwnProperty.call(extra, "rejection_message")) {
      fields.push("rejection_message = ?");
      params.push(extra.rejection_message);
    }
    if (Object.prototype.hasOwnProperty.call(extra, "access_key")) {
      fields.push("access_key = ?");
      params.push(extra.access_key);
    }
    if (Object.prototype.hasOwnProperty.call(extra, "protocol")) {
      fields.push("protocol = ?");
      params.push(extra.protocol);
    }
    if (Object.prototype.hasOwnProperty.call(extra, "provider_ref")) {
      fields.push("provider_ref = ?");
      params.push(extra.provider_ref);
    }
    if (Object.prototype.hasOwnProperty.call(extra, "authorized_at")) {
      fields.push("authorized_at = ?");
      params.push(extra.authorized_at);
    }
    if (Object.prototype.hasOwnProperty.call(extra, "cancelled_at")) {
      fields.push("cancelled_at = ?");
      params.push(extra.cancelled_at);
    }
    params.push(Number(id) || 0);
    await run(
      `UPDATE fiscal_documents SET ${fields.join(", ")} WHERE id = ?`,
      params
    );
    return this.findById(id);
  }
}

module.exports = {
  FiscalDocumentRepository
};
