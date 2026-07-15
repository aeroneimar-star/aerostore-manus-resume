"use strict";

const { run, get, all } = require("../../../db");

function nowIso() {
  return new Date().toISOString();
}

function parseDetail(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch (_error) {
    return null;
  }
}

function mapEvent(row = null) {
  if (!row) return null;
  return {
    id: Number(row.id),
    fiscal_document_id: Number(row.fiscal_document_id),
    from_status: row.from_status || null,
    to_status: row.to_status || "",
    actor: row.actor || "",
    detail: parseDetail(row.detail_json),
    created_at: row.created_at || ""
  };
}

class FiscalDocumentEventRepository {
  async create({
    fiscalDocumentId,
    fromStatus = null,
    toStatus,
    actor = "",
    detail = null
  } = {}) {
    const stamp = nowIso();
    const detailJson = detail === null || detail === undefined
      ? null
      : (typeof detail === "string" ? detail : JSON.stringify(detail));
    const result = await run(
      `INSERT INTO fiscal_document_events (
        fiscal_document_id, from_status, to_status, actor, detail_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        Number(fiscalDocumentId) || 0,
        fromStatus || null,
        String(toStatus || "").trim().toUpperCase(),
        String(actor || "").trim(),
        detailJson,
        stamp
      ]
    );
    return this.findById(result.lastID);
  }

  async findById(id) {
    const row = await get(`SELECT * FROM fiscal_document_events WHERE id = ?`, [Number(id) || 0]);
    return mapEvent(row);
  }

  async listByDocumentId(fiscalDocumentId) {
    const rows = await all(
      `SELECT * FROM fiscal_document_events
       WHERE fiscal_document_id = ?
       ORDER BY id ASC`,
      [Number(fiscalDocumentId) || 0]
    );
    return rows.map(mapEvent);
  }
}

module.exports = {
  FiscalDocumentEventRepository
};
