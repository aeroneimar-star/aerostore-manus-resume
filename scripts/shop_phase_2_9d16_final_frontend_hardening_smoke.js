"use strict";

/**
 * Shop 2.9D.16 — hardening final do frontend da admin de publicação.
 * Usa a lógica real exportada por public/shopPublicationAdmin.js.
 *
 * Cobre:
 * - retry pendente nunca vira empty falso (P2-1)
 * - items com null/undefined não lançam exceção (P2-2)
 *
 * Uso:
 *   node scripts/shop_phase_2_9d16_final_frontend_hardening_smoke.js
 */

const {
  isStructurallyValidPublicationItem,
  normalizePublicationItems,
  resolvePublicationsLoad,
  resolveDraftStripKind
} = require("../public/shopPublicationAdmin.js");

function toArray(value) {
  return Array.isArray(value) ? value : [];
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

function stripKind(pubState) {
  return resolveDraftStripKind(pubState, toArray);
}

async function main() {
  const passed = [];

  passed.push(runCase("retry_error_pending_is_loading", () => {
    const kind = stripKind({
      loading: true,
      schemaReady: true,
      publications: [],
      publicationsError: ""
    });
    assert(kind === "loading", "pending após erro → loading");
    assert(kind !== "empty", "pending não pode ser empty");
  }));

  passed.push(runCase("retry_error_then_success", () => {
    const load = resolvePublicationsLoad({
      ok: true,
      data: { items: eightDrafts(), publication_layer: { draft: 8 } }
    });
    assert(load.status === "success", "sucesso");
    assert(load.items.length === 8, "8 drafts");
    assert(stripKind({
      loading: false,
      schemaReady: true,
      publications: load.items,
      publicationsError: ""
    }) === "drafts", "strip drafts");
  }));

  passed.push(runCase("retry_error_then_error", () => {
    const load = resolvePublicationsLoad({
      ok: false,
      error: { message: "HTTP 500" }
    });
    assert(load.status === "error", "erro");
    assert(stripKind({
      loading: false,
      schemaReady: true,
      publications: load.items,
      publicationsError: load.errorMessage
    }) === "error", "strip error");
  }));

  passed.push(runCase("retry_drafts_pending_is_loading", () => {
    assert(stripKind({
      loading: true,
      schemaReady: true,
      publications: eightDrafts(),
      publicationsError: ""
    }) === "loading", "drafts→pending → loading");
  }));

  passed.push(runCase("retry_empty_pending_is_loading", () => {
    assert(stripKind({
      loading: true,
      schemaReady: true,
      publications: [],
      publicationsError: ""
    }) === "loading", "empty→pending → loading");
  }));

  passed.push(runCase("success_empty_still_empty", () => {
    assert(stripKind({
      loading: false,
      schemaReady: true,
      publications: [],
      publicationsError: ""
    }) === "empty", "sucesso vazio permanece empty");
  }));

  const invalidPayloads = [
    { name: "items_null_entry", data: { items: [null] }, expect: "error" },
    { name: "items_undefined_entry", data: { items: [undefined] }, expect: "error" },
    { name: "items_empty_object", data: { items: [{}] }, expect: "empty" },
    { name: "items_string", data: { items: ["texto"] }, expect: "error" },
    { name: "items_zero", data: { items: [0] }, expect: "error" },
    { name: "items_false", data: { items: [false] }, expect: "error" },
    { name: "items_all_invalid", data: { items: [null, false, "x"] }, expect: "error" },
    { name: "items_empty_array", data: { items: [] }, expect: "empty" },
    { name: "items_absent", data: { success: true }, expect: "error" },
    { name: "items_null", data: { items: null }, expect: "error" },
    { name: "payload_null", data: null, expect: "error" }
  ];

  invalidPayloads.forEach((entry) => {
    passed.push(runCase(entry.name, () => {
      let threw = false;
      let kind = null;
      let load;
      try {
        load = resolvePublicationsLoad({ ok: true, data: entry.data });
        kind = stripKind({
          loading: false,
          schemaReady: true,
          publications: load.items,
          publicationsError: load.errorMessage
        });
      } catch (error) {
        threw = true;
        throw new Error(`${entry.name} lançou: ${error.message || error}`);
      }
      assert(!threw, "sem exceção");
      if (entry.expect === "error") {
        assert(load.status === "error" || kind === "error", `${entry.name} → error`);
        assert(kind !== "drafts", `${entry.name} não vira drafts`);
      } else if (entry.expect === "empty") {
        assert(load.status === "success", `${entry.name} success`);
        assert(kind === "empty", `${entry.name} → empty`);
      }
    }));
  });

  passed.push(runCase("mixed_draft_null_keeps_valid", () => {
    const draft = { status: "draft", pdv_product_ref: 62, public_title: "Ok" };
    const load = resolvePublicationsLoad({
      ok: true,
      data: { items: [draft, null] }
    });
    assert(load.status === "success", "mixed success");
    assert(load.items.length === 1, "1 válido");
    assert(load.items[0].pdv_product_ref === 62, "draft preservado");
    assert(stripKind({
      loading: false,
      schemaReady: true,
      publications: load.items,
      publicationsError: ""
    }) === "drafts", "strip drafts");
  }));

  passed.push(runCase("mixed_null_draft_keeps_valid", () => {
    const draft = { status: "draft", pdv_product_ref: 63, public_title: "Ok" };
    const load = resolvePublicationsLoad({
      ok: true,
      data: { items: [null, draft] }
    });
    assert(load.status === "success", "mixed success");
    assert(load.items.length === 1, "1 válido");
    assert(load.items[0].pdv_product_ref === 63, "draft preservado");
  }));

  passed.push(runCase("eight_valid_drafts_intact", () => {
    const load = resolvePublicationsLoad({
      ok: true,
      data: { items: eightDrafts() }
    });
    assert(load.items.length === 8, "8 drafts");
    assert(stripKind({
      loading: false,
      schemaReady: true,
      publications: load.items,
      publicationsError: ""
    }) === "drafts", "strip drafts");
  }));

  passed.push(runCase("structural_helpers", () => {
    assert(isStructurallyValidPublicationItem({ status: "draft" }) === true, "objeto ok");
    assert(isStructurallyValidPublicationItem(null) === false, "null inválido");
    assert(isStructurallyValidPublicationItem(["x"]) === false, "array inválido");
    const normalized = normalizePublicationItems([null, { status: "draft", pdv_product_ref: 1 }, "x"]);
    assert(normalized.accepted.length === 1, "1 aceito");
    assert(normalized.rejected === 2, "2 rejeitados");
  }));

  console.log("SHOP_PHASE_2_9D16_FINAL_FRONTEND_HARDENING_OK");
  console.log(JSON.stringify({ passed }, null, 2));
}

main().catch((error) => {
  console.error("SHOP_PHASE_2_9D16_FINAL_FRONTEND_HARDENING_FAIL", error.message || error);
  process.exitCode = 1;
});
