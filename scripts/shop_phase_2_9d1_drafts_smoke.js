"use strict";

/**
 * Fase 2.9D.1 — validação local read-only da camada Shop drafts.
 * Uso:
 *   DATABASE_PATH=.../shop-phase-2.9B-validation.sqlite \
 *     node scripts/shop_phase_2_9d1_drafts_smoke.js
 */

const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEFAULT_DB = path.join(
  ROOT,
  "..",
  "crie-do-zero-um-sistema-chamado",
  "data",
  "shop-phase-2.9B-validation.sqlite"
);

if (!process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = DEFAULT_DB;
}

const {
  getShopPublicationSchemaStatus,
  getPublicationLayerStats,
  listPdvPublicationCandidates,
  listPublicationRecords
} = require("../modules/shop/services/shopPublicationService");
const { isShopPublicCatalogEnabled } = require("../modules/shop/services/shopSettingsService");

const EXPECTED_IDS = [62, 63, 65, 66, 68, 72, 74, 75];

async function main() {
  const schema = await getShopPublicationSchemaStatus();
  if (!schema.ready) {
    throw new Error(`schema_ready=false em ${process.env.DATABASE_PATH}`);
  }

  const layer = await getPublicationLayerStats();
  const publications = await listPublicationRecords({ status: "draft", limit: 50 });
  const candidates = await listPdvPublicationCandidates({ limit: 200, include_test_candidates: true });

  const draftIds = publications.items
    .map((item) => Number(item.pdv_product_ref))
    .sort((a, b) => a - b);
  const candidateDrafts = candidates.items.filter((item) => item.publication_status === "draft");
  const candidateDraftIds = candidateDrafts
    .map((item) => Number(item.pdv_product_ref))
    .sort((a, b) => a - b);

  const checks = {
    schema_ready: schema.ready,
    public_catalog_enabled: isShopPublicCatalogEnabled() === false,
    layer_draft_8: layer.draft === 8,
    publications_8: publications.items.length === 8,
    publication_ids_match: draftIds.join(",") === EXPECTED_IDS.join(","),
    candidates_overlay_8: candidateDraftIds.join(",") === EXPECTED_IDS.join(","),
    sample_has_editorial: Boolean(
      candidateDrafts[0]?.publication?.public_slug
      && candidateDrafts[0]?.publication?.public_title
    ),
    candidates_expose_layer: Number(candidates.publication_layer?.draft || 0) === 8,
    no_published_sql: layer.published === 0
  };

  const ok = Object.values(checks).every(Boolean);
  console.log(ok ? "SHOP_PHASE_2_9D1_DRAFTS_OK" : "SHOP_PHASE_2_9D1_DRAFTS_FAIL");
  console.log(JSON.stringify({
    database_path: process.env.DATABASE_PATH,
    layer,
    draftIds,
    candidateDraftIds,
    public_catalog_enabled: isShopPublicCatalogEnabled(),
    checks
  }, null, 2));
  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("SHOP_PHASE_2_9D1_DRAFTS_ERROR", error.message || error);
  process.exitCode = 1;
});
