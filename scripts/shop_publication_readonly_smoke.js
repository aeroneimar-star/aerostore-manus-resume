"use strict";

/**
 * Smoke read-only — camada de publicação shop (Fase 2.7).
 * Não altera banco. Não expõe rotas públicas.
 */
const { listCatalog } = require("../modules/shop/services/shopCatalogService");
const { isPilotJsonEnabled } = require("../modules/shop/services/shopSettingsService");
const {
  listPdvPublicationCandidates,
  getShopPublicationSchemaStatus
} = require("../modules/shop/services/shopPublicationService");
const { FORBIDDEN_ADMIN_KEYS, assertNoForbiddenAdminKeys } = require("../modules/shop/dto/publicationAdminDto");
const { FORBIDDEN_KEYS } = require("../modules/shop/dto/publicProductDto");

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

async function main() {
  const schema = await getShopPublicationSchemaStatus();
  if (schema.ready) {
    console.warn("SHOP_PUBLICATION_READONLY_SMOKE_WARN: schema shop_* detectado (esperado não aplicado na Fase 2.7)");
  }

  if (!isPilotJsonEnabled()) {
    throw new Error("Pilot JSON deveria estar ativo como fallback");
  }

  const catalog = listCatalog({ limit: 5 });
  if (!catalog.success || !Array.isArray(catalog.items) || !catalog.items.length) {
    throw new Error("Catálogo piloto não retornou itens");
  }
  const publicForbidden = collectForbiddenKeys(catalog, FORBIDDEN_KEYS);
  if (publicForbidden.size) {
    throw new Error(`Catálogo piloto vazou campos proibidos: ${Array.from(publicForbidden).join(", ")}`);
  }

  const candidates = await listPdvPublicationCandidates({ limit: 5 });
  if (!candidates.success) {
    throw new Error("listPdvPublicationCandidates falhou");
  }
  if (!candidates.pilot_json_active) {
    throw new Error("pilot_json_active deveria ser true");
  }
  if (!candidates.stats || typeof candidates.stats.total_raw !== "number") {
    throw new Error("stats de curadoria ausente na resposta (Fase 2.8.2)");
  }
  if (candidates.include_test_candidates !== false) {
    throw new Error("include_test_candidates default deveria ser false");
  }

  const adminForbidden = collectForbiddenKeys(candidates, FORBIDDEN_ADMIN_KEYS);
  if (adminForbidden.size) {
    throw new Error(`Candidatos admin vazaram campos proibidos: ${Array.from(adminForbidden).join(", ")}`);
  }

  if (Array.isArray(candidates.items) && candidates.items.length) {
    const sample = candidates.items[0];
    if (sample.sku || sample.barcode || sample.cost_price_cents) {
      throw new Error("Candidato contém campo interno sensível");
    }
    if (!["in_stock", "low_stock", "out_of_stock"].includes(sample.availability)) {
      throw new Error("availability label inválido");
    }
    if (typeof sample.available_qty !== "undefined" || typeof sample.reserved_qty !== "undefined") {
      throw new Error("quantidade exata não deveria aparecer no candidato");
    }
    if (!Array.isArray(sample.block_reasons) || !sample.block_reason_primary) {
      throw new Error("block_reasons/block_reason_primary ausentes (Fase 2.8.2)");
    }
    if (typeof sample.is_test_candidate !== "boolean") {
      throw new Error("is_test_candidate ausente (Fase 2.8.2)");
    }
  }

  const withTests = await listPdvPublicationCandidates({ limit: 200, include_test_candidates: true });
  if (withTests.stats.clean_total !== withTests.stats.total_raw) {
    // when all are test, clean could be 0 - that's ok
  }
  if (withTests.total > withTests.stats.total_raw) {
    throw new Error("include_test_candidates não deveria inflar total bruto");
  }

  assertNoForbiddenAdminKeys(candidates);

  console.log("SHOP_PUBLICATION_READONLY_SMOKE_OK", {
    schema_ready: schema.ready,
    pilot_items: catalog.items.length,
    candidate_total: candidates.total,
    candidate_sample: candidates.items.length,
    stats: candidates.stats
  });
}

main().catch((error) => {
  console.error("SHOP_PUBLICATION_READONLY_SMOKE_FAIL", error.message);
  process.exit(1);
});
