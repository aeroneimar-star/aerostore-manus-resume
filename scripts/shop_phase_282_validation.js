"use strict";

/**
 * Validação Fase 2.8.2 — curadoria read-only Shop.
 * Não grava banco. Não liga catálogo público.
 */
const { isShopPublicCatalogEnabled } = require("../modules/shop/services/shopSettingsService");
const {
  listPdvPublicationCandidates,
  isTestCandidate,
  TEST_NAME_PATTERNS
} = require("../modules/shop/services/shopPublicationService");
const { FORBIDDEN_ADMIN_KEYS } = require("../modules/shop/dto/publicationAdminDto");

const BASE =
  process.env.SHOP_SMOKE_BASE_URL ||
  process.env.AEROSTORE_SMOKE_BASE_URL ||
  "http://127.0.0.1:3000";

function collectForbiddenKeys(obj, forbiddenSet, found = new Set(), path = "") {
  if (!obj || typeof obj !== "object") {
    return found;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => collectForbiddenKeys(item, forbiddenSet, found, `${path}[${index}]`));
    return found;
  }
  for (const key of Object.keys(obj)) {
    if (forbiddenSet.has(key)) {
      found.add(`${path}${key}`);
    }
    collectForbiddenKeys(obj[key], forbiddenSet, found, `${path}${key}.`);
  }
  return found;
}

async function assertCandidatesApiRequiresAuth() {
  const response = await fetch(`${BASE}/api/shop/publication/candidates`, {
    headers: { Accept: "application/json" }
  });
  if (response.status !== 401 && response.status !== 403) {
    throw new Error(`API candidatos deveria exigir auth (401/403), recebeu ${response.status}`);
  }
}

async function assertPublicationPageOk() {
  const response = await fetch(`${BASE}/shop/publicacao`, {
    headers: { Accept: "text/html" }
  });
  if (!response.ok) {
    throw new Error(`/shop/publicacao deveria retornar 200, recebeu ${response.status}`);
  }
}

function assertStatsShape(stats) {
  const required = [
    "total_raw",
    "hidden_test_count",
    "clean_total",
    "sellable",
    "in_stock",
    "low_stock",
    "blocked",
    "potentially_publishable"
  ];
  for (const key of required) {
    if (typeof stats[key] !== "number") {
      throw new Error(`stats.${key} ausente ou inválido`);
    }
  }
}

function assertCandidateDiagnostics(item) {
  if (typeof item.is_test_candidate !== "boolean") {
    throw new Error("is_test_candidate ausente no candidato");
  }
  if (!Array.isArray(item.block_reasons)) {
    throw new Error("block_reasons ausente no candidato");
  }
  if (typeof item.block_reason_primary !== "string" || !item.block_reason_primary) {
    throw new Error("block_reason_primary ausente no candidato");
  }
  if (typeof item.is_potentially_publishable !== "boolean") {
    throw new Error("is_potentially_publishable ausente no candidato");
  }
}

async function main() {
  if (isShopPublicCatalogEnabled()) {
    throw new Error("SHOP_PUBLIC_CATALOG_ENABLED deveria estar OFF na Fase 2.8.2");
  }

  await assertCandidatesApiRequiresAuth();
  await assertPublicationPageOk();

  const hidden = await listPdvPublicationCandidates({ limit: 200, include_test_candidates: false });
  const included = await listPdvPublicationCandidates({ limit: 200, include_test_candidates: true });

  if (!hidden.success || !included.success) {
    throw new Error("listPdvPublicationCandidates falhou");
  }

  assertStatsShape(hidden.stats);
  assertStatsShape(included.stats);

  if (hidden.include_test_candidates !== false) {
    throw new Error("include_test_candidates default deveria ser false");
  }
  if (included.include_test_candidates !== true) {
    throw new Error("include_test_candidates=true não refletido na resposta");
  }

  if (hidden.stats.total_raw !== included.stats.total_raw) {
    throw new Error("total_raw deveria ser igual com/sem include_test_candidates");
  }

  if (hidden.stats.hidden_test_count !== included.stats.total_raw - included.stats.clean_total) {
    // hidden_test_count is global; clean_total when including all equals total_raw
    if (included.stats.clean_total !== included.stats.total_raw) {
      throw new Error("clean_total com include=true deveria igualar total_raw");
    }
  }

  if (hidden.total > hidden.stats.clean_total) {
    throw new Error("total paginado não deveria exceder clean_total quando QA oculto");
  }

  const adminForbidden = collectForbiddenKeys(hidden, FORBIDDEN_ADMIN_KEYS);
  if (adminForbidden.size) {
    throw new Error(`DTO admin vazou campos proibidos: ${Array.from(adminForbidden).join(", ")}`);
  }

  if (Array.isArray(hidden.items) && hidden.items.length) {
    hidden.items.forEach((item) => {
      assertCandidateDiagnostics(item);
      if (item.is_test_candidate) {
        throw new Error("Candidato QA não deveria aparecer com include_test_candidates=false");
      }
    });
  }

  if (Array.isArray(included.items) && included.items.length) {
    included.items.slice(0, 5).forEach(assertCandidateDiagnostics);
  }

  const testSample = { name: "QA Grade API produto", product_type: "grade" };
  if (!isTestCandidate(testSample)) {
    throw new Error("isTestCandidate deveria detectar QA Grade API");
  }

  console.log("SHOP_PHASE_282_VALIDATION_OK", {
    public_catalog_enabled: isShopPublicCatalogEnabled(),
    stats_hidden: hidden.stats,
    stats_included: included.stats,
    list_total_hidden: hidden.total,
    list_total_included: included.total,
    test_patterns: TEST_NAME_PATTERNS.length
  });
}

main().catch((error) => {
  console.error("SHOP_PHASE_282_VALIDATION_FAIL", error.message);
  process.exit(1);
});
