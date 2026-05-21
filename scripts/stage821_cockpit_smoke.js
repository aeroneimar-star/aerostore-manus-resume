"use strict";

const {
  normalizeCockpitFilters,
  buildCockpitSummary,
  buildCockpitCurve,
  buildCockpitMargin,
  buildCockpitDecisionMap,
  buildCockpitTrends,
  buildCockpitAiContext
} = require("../modules/pdv/reports/pdvCockpitService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function logStep(label, data) {
  console.log(`\n[${label}]`);
  console.log(JSON.stringify(data, null, 2));
}

function run() {
  const scenarios = [
    { name: "summary 30d", run: () => buildCockpitSummary({ period: "30d" }) },
    { name: "curve 30d", run: () => buildCockpitCurve({ period: "30d" }) },
    { name: "margin 30d", run: () => buildCockpitMargin({ period: "30d" }) },
    { name: "decision-map 30d", run: () => buildCockpitDecisionMap({ period: "30d" }) },
    { name: "trends 30d", run: () => buildCockpitTrends({ period: "30d" }) },
    { name: "filters by loja", run: () => buildCockpitSummary({ period: "30d", store_id: "vila_masc" }) },
    { name: "filters by marca", run: () => buildCockpitCurve({ period: "30d", brand: "AEROSTORE TESTE" }) },
    { name: "filters by categoria", run: () => buildCockpitMargin({ period: "30d", category: "QA PDV" }) },
    { name: "periodo custom", run: () => buildCockpitSummary({ period: "custom", start_date: "2026-05-01", end_date: "2026-05-17" }) },
    { name: "cenario sem dados", run: () => buildCockpitSummary({ period: "custom", start_date: "2000-01-01", end_date: "2000-01-07" }) }
  ];

  scenarios.forEach((scenario) => {
    const payload = scenario.run();
    assert(payload && typeof payload === "object", `${scenario.name}: payload invalido`);
    assert(payload.filters, `${scenario.name}: filtros ausentes`);
    assert(Array.isArray(payload.warnings), `${scenario.name}: warnings ausentes`);
    if (scenario.name === "summary 30d") {
      assert(payload.metrics && payload.metrics.net_revenue, "summary 30d: metrics incompletas");
    }
    if (scenario.name === "curve 30d") {
      assert(Array.isArray(payload.items), "curve 30d: items ausentes");
      if (payload.items.length) {
        assert(Boolean(payload.items[0].curve), "curve 30d: classificacao ausente");
      }
    }
    if (scenario.name === "margin 30d") {
      assert(Array.isArray(payload.stores), "margin 30d: stores ausente");
      assert(payload.highlights && typeof payload.highlights === "object", "margin 30d: highlights ausentes");
    }
    if (scenario.name === "decision-map 30d") {
      assert(payload.groups && payload.groups.comprar_mais, "decision-map 30d: grupos ausentes");
    }
    if (scenario.name === "trends 30d") {
      assert(Array.isArray(payload.items), "trends 30d: items ausentes");
      assert(payload.alerts && typeof payload.alerts === "object", "trends 30d: alerts ausentes");
    }
  });

  const filters = normalizeCockpitFilters({ period: "30d" });
  const aiContext = buildCockpitAiContext(filters);
  assert(aiContext.summary && aiContext.decision_map && aiContext.trends, "AI context incompleto");

  logStep("summary sample", buildCockpitSummary({ period: "30d" }));
  logStep("curve sample", buildCockpitCurve({ period: "30d" }).items.slice(0, 5));
  logStep("decision map sample", buildCockpitDecisionMap({ period: "30d" }).groups);
  logStep("trends sample", buildCockpitTrends({ period: "30d" }).alerts);
  console.log("\n[status]");
  console.log("stage821 cockpit smoke: OK");
}

run();
