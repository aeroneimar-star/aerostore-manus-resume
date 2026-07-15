"use strict";

/**
 * Feature flag do módulo fiscal (Stage 1).
 * Desligada por padrão — nenhuma solicitação é criada em produção sem opt-in explícito.
 */
function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return Boolean(fallback);
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "sim", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "nao", "não", "off"].includes(normalized)) {
    return false;
  }
  return Boolean(fallback);
}

function isFiscalModuleEnabled() {
  return parseBooleanEnv(process.env.FISCAL_MODULE_ENABLED, false);
}

function getFiscalDefaultEnvironment() {
  const raw = String(process.env.FISCAL_DEFAULT_ENVIRONMENT || "homologacao").trim().toLowerCase();
  if (raw === "producao" || raw === "production" || raw === "prod") {
    return "producao";
  }
  return "homologacao";
}

function getFiscalDefaultModel() {
  const raw = String(process.env.FISCAL_DEFAULT_MODEL || "65").trim();
  return raw === "55" ? "55" : "65";
}

module.exports = {
  isFiscalModuleEnabled,
  getFiscalDefaultEnvironment,
  getFiscalDefaultModel,
  parseBooleanEnv
};
