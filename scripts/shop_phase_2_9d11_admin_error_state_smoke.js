"use strict";

/**
 * Shop 2.9D.11 — estados de erro vs vazio da admin de publicação.
 * Usa a lógica real exportada por public/shopPublicationAdmin.js.
 *
 * Uso:
 *   node scripts/shop_phase_2_9d11_admin_error_state_smoke.js
 */

const path = require("path");

const {
  isValidPublicationsPayload,
  resolvePublicationsLoad,
  resolveDraftStripKind
} = require("../public/shopPublicationAdmin.js");

function toArray(value) {
  if (Array.isArray(value)) return value;
  return [];
}

function eightDrafts() {
  return [62, 63, 65, 66, 68, 72, 74, 75].map((id) => ({
    status: "draft",
    pdv_product_ref: id,
    public_slug: `slug-${id}`,
    public_title: `Draft ${id}`
  }));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runCase(name, fn) {
  fn();
  return name;
}

async function main() {
  const passed = [];

  passed.push(runCase("success_with_8_drafts", () => {
    const load = resolvePublicationsLoad({
      ok: true,
      data: { success: true, items: eightDrafts(), publication_layer: { draft: 8 } }
    });
    assert(load.status === "success", "status success");
    assert(load.items.length === 8, "8 items");
    assert(!load.errorMessage, "no error message");
    const kind = resolveDraftStripKind({
      schemaReady: true,
      publications: load.items,
      publicationsError: load.errorMessage
    }, toArray);
    assert(kind === "drafts", "strip drafts");
  }));

  passed.push(runCase("success_empty", () => {
    const load = resolvePublicationsLoad({
      ok: true,
      data: { success: true, items: [], publication_layer: { draft: 0 } }
    });
    assert(load.status === "success", "status success");
    const kind = resolveDraftStripKind({
      schemaReady: true,
      publications: load.items,
      publicationsError: load.errorMessage
    }, toArray);
    assert(kind === "empty", "strip empty");
    assert(!load.errorMessage, "no error on empty success");
  }));

  passed.push(runCase("http_500", () => {
    const load = resolvePublicationsLoad({
      ok: false,
      error: { message: "Falha ao listar publicações shop." }
    });
    assert(load.status === "error", "status error");
    assert(load.items.length === 0, "no items");
    const kind = resolveDraftStripKind({
      schemaReady: true,
      publications: load.items,
      publicationsError: load.errorMessage,
      publicationLayer: { draft: 8 }
    }, toArray);
    assert(kind === "error", "strip error not empty");
    assert(kind !== "empty", "must not mask as empty");
  }));

  passed.push(runCase("network_failure", () => {
    const load = resolvePublicationsLoad({
      ok: false,
      error: new Error("fetch failed")
    });
    const kind = resolveDraftStripKind({
      schemaReady: true,
      publications: load.items,
      publicationsError: load.errorMessage
    }, toArray);
    assert(kind === "error", "network → error strip");
  }));

  passed.push(runCase("invalid_json_as_rejection", () => {
    const load = resolvePublicationsLoad({
      ok: false,
      error: { message: "Unexpected token < in JSON" }
    });
    const kind = resolveDraftStripKind({
      schemaReady: true,
      publications: [],
      publicationsError: load.errorMessage
    }, toArray);
    assert(kind === "error", "invalid json → error");
  }));

  passed.push(runCase("invalid_payload", () => {
    assert(isValidPublicationsPayload(null) === false, "null invalid");
    assert(isValidPublicationsPayload({ items: null }) === false, "null items invalid");
    const load = resolvePublicationsLoad({
      ok: true,
      data: { success: true, items: null }
    });
    assert(load.status === "error", "invalid payload → error");
    const kind = resolveDraftStripKind({
      schemaReady: true,
      publications: load.items,
      publicationsError: load.errorMessage
    }, toArray);
    assert(kind === "error", "invalid payload strip error");
  }));

  passed.push(runCase("candidates_ok_publications_error", () => {
    const publicationsLoad = resolvePublicationsLoad({
      ok: false,
      error: { message: "HTTP 500" }
    });
    const pubState = {
      schemaReady: true,
      publications: publicationsLoad.items,
      publicationsError: publicationsLoad.errorMessage,
      publicationLayer: { draft: 8, published: 0 },
      error: ""
    };
    const kind = resolveDraftStripKind(pubState, toArray);
    assert(kind === "error", "publications error independent");
    assert(Number(pubState.publicationLayer.draft) === 8, "candidates layer preserved");
    assert(!pubState.error, "candidates error empty");
  }));

  passed.push(runCase("candidates_error_publications_ok", () => {
    const publicationsLoad = resolvePublicationsLoad({
      ok: true,
      data: {
        success: true,
        schema_ready: true,
        items: eightDrafts(),
        publication_layer: { draft: 8 }
      }
    });
    const pubState = {
      schemaReady: true,
      publications: publicationsLoad.items,
      publicationsError: publicationsLoad.errorMessage,
      publicationLayer: publicationsLoad.publicationLayer,
      error: "Falha ao carregar candidatos PDV."
    };
    const kind = resolveDraftStripKind(pubState, toArray);
    assert(kind === "drafts", "drafts remain coherent");
    assert(pubState.error.includes("candidatos"), "candidates error separate");
    assert(!pubState.publicationsError, "no publications error");
  }));

  console.log("SHOP_PHASE_2_9D11_ADMIN_ERROR_STATE_OK");
  console.log(JSON.stringify({ passed }, null, 2));
}

main().catch((error) => {
  console.error("SHOP_PHASE_2_9D11_ADMIN_ERROR_STATE_FAIL", error.message || error);
  process.exitCode = 1;
});
