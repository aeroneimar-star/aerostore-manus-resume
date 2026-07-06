"use strict";

function parseArgoxAgentSafeTestMode(agentStatus = null) {
  const value = agentStatus?.safe_test_mode;
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    if (raw === "true") return true;
    if (raw === "false") return false;
  }
  return false;
}

function buildArgoxAgentSafeTestWarning(totalLabels = 0) {
  const total = Math.max(0, Number(totalLabels || 0));
  return `Modo seguro ativo: a impressão real será limitada a 1 etiqueta, mesmo que o plano tenha ${total}.`;
}

function shouldShowArgoxSafeTestWarning(agentStatus = null) {
  return parseArgoxAgentSafeTestMode(agentStatus);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseArgoxAgentSafeTestMode,
    buildArgoxAgentSafeTestWarning,
    shouldShowArgoxSafeTestWarning
  };
}

if (typeof window !== "undefined") {
  window.parseArgoxAgentSafeTestMode = parseArgoxAgentSafeTestMode;
  window.buildArgoxAgentSafeTestWarning = buildArgoxAgentSafeTestWarning;
  window.shouldShowArgoxSafeTestWarning = shouldShowArgoxSafeTestWarning;
}
