"use strict";

const assert = require("assert");
const {
  parseArgoxAgentSafeTestMode,
  buildArgoxAgentSafeTestWarning,
  shouldShowArgoxSafeTestWarning
} = require("../public/pdvLabelPrintAgentStatus");

function buildSafeTestWarningHtml(printPlan, agentStatus) {
  if (!shouldShowArgoxSafeTestWarning(agentStatus)) {
    return "";
  }
  return buildArgoxAgentSafeTestWarning(printPlan?.total_labels || 0);
}

const printPlanWithServerSafeOn = {
  total_labels: 12,
  safe_test_mode: true,
  safe_test_warning: "Modo seguro ativo: a impressão real será limitada a 1 etiqueta, mesmo que o plano tenha 12."
};

assert.strictEqual(parseArgoxAgentSafeTestMode({ safe_test_mode: false }), false);
assert.strictEqual(parseArgoxAgentSafeTestMode({ safe_test_mode: "false" }), false);
assert.strictEqual(parseArgoxAgentSafeTestMode({ safe_test_mode: true }), true);
assert.strictEqual(parseArgoxAgentSafeTestMode({ safe_test_mode: "true" }), true);
assert.strictEqual(parseArgoxAgentSafeTestMode(null), false);
assert.strictEqual(parseArgoxAgentSafeTestMode({ safe_test_mode: "FALSE" }), false);
assert.strictEqual(parseArgoxAgentSafeTestMode({ safe_test_mode: "TRUE" }), true, "TRUE maiusculo normalizado para true");

assert.strictEqual(
  buildSafeTestWarningHtml(printPlanWithServerSafeOn, { safe_test_mode: false }),
  "",
  "agente com safe false nao deve exibir aviso mesmo com print_plan.safe_test_mode true"
);

assert.strictEqual(
  buildSafeTestWarningHtml(printPlanWithServerSafeOn, { safe_test_mode: "false" }),
  "",
  "string false do agente nao deve exibir aviso"
);

assert.match(
  buildSafeTestWarningHtml(printPlanWithServerSafeOn, { safe_test_mode: true }),
  /Modo seguro ativo/i,
  "agente com safe true deve exibir aviso"
);

assert.match(
  buildSafeTestWarningHtml({ total_labels: 3, safe_test_mode: false }, { safe_test_mode: "true" }),
  /limitada a 1 etiqueta/i,
  "agente string true deve exibir aviso"
);

assert.strictEqual(
  buildSafeTestWarningHtml({ total_labels: 1, safe_test_mode: true }, { safe_test_mode: false }),
  "",
  "agente safe false nunca mostra aviso"
);

console.log(JSON.stringify({ ok: true, cases: 12 }, null, 2));
