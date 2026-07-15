"use strict";

const { run, get, all } = require("../../../db");
const { listDefaultReadinessRules } = require("../domain/fiscalReadinessRules");
const { FISCAL_READINESS_SEVERITIES } = require("../domain/fiscalReadinessStatuses");

function nowIso() {
  return new Date().toISOString();
}

function mapRule(row = null) {
  if (!row) return null;
  return {
    code: row.code || "",
    severity: row.severity || FISCAL_READINESS_SEVERITIES.WARNING,
    entity_scope: row.entity_scope || "product",
    description: row.description || "",
    active: Number(row.active) === 1,
    updated_by: row.updated_by || "",
    created_at: row.created_at || "",
    updated_at: row.updated_at || ""
  };
}

class FiscalReadinessRulesRepository {
  async ensureDefaults() {
    const stamp = nowIso();
    for (const rule of listDefaultReadinessRules()) {
      const existing = await get(
        `SELECT code FROM fiscal_readiness_rules WHERE UPPER(code) = UPPER(?)`,
        [rule.code]
      );
      if (existing) continue;
      await run(
        `INSERT INTO fiscal_readiness_rules
          (code, severity, entity_scope, description, active, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'system', ?, ?)`,
        [rule.code, rule.severity, rule.entity_scope, rule.description, stamp, stamp]
      );
    }
  }

  async list({ activeOnly = false } = {}) {
    await this.ensureDefaults();
    const rows = await all(
      activeOnly
        ? `SELECT * FROM fiscal_readiness_rules WHERE active = 1 ORDER BY code ASC`
        : `SELECT * FROM fiscal_readiness_rules ORDER BY code ASC`
    );
    return rows.map(mapRule);
  }

  async findByCode(code) {
    await this.ensureDefaults();
    const row = await get(
      `SELECT * FROM fiscal_readiness_rules WHERE UPPER(code) = UPPER(?)`,
      [String(code || "")]
    );
    return mapRule(row);
  }

  async getSeverityMap() {
    const rules = await this.list({ activeOnly: true });
    return rules.reduce((acc, rule) => {
      acc[String(rule.code).toUpperCase()] = rule.severity;
      return acc;
    }, {});
  }

  async updateSeverity(code, severity, user = {}) {
    const allowed = Object.values(FISCAL_READINESS_SEVERITIES);
    if (!allowed.includes(severity)) {
      const error = new Error(`severity invalida: ${severity}`);
      error.code = "FISCAL_READINESS_RULE_INVALID";
      error.statusCode = 400;
      throw error;
    }
    await this.ensureDefaults();
    const current = await this.findByCode(code);
    if (!current) {
      const error = new Error("Regra de prontidao nao encontrada.");
      error.code = "FISCAL_READINESS_RULE_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }
    await run(
      `UPDATE fiscal_readiness_rules
       SET severity = ?, updated_by = ?, updated_at = ?
       WHERE UPPER(code) = UPPER(?)`,
      [
        severity,
        String(user.name || user.email || "sistema"),
        nowIso(),
        code
      ]
    );
    return this.findByCode(code);
  }
}

module.exports = {
  FiscalReadinessRulesRepository,
  mapRule
};
