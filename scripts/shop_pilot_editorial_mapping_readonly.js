"use strict";

/**
 * Fase 2.8.6 — Mapeamento read-only: intake editorial → PDV.
 * NÃO grava banco. NÃO altera pilot-editorial-intake.json.
 * NÃO preenche product_id/variant_id no intake.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  listPdvPublicationCandidates
} = require("../modules/shop/services/shopPublicationService");

const ROOT = path.join(__dirname, "..");
const INTAKE_PATH = path.join(ROOT, "modules", "shop", "config", "pilot-editorial-intake.json");
const REPORT_JSON_PATH = path.join(ROOT, "docs", "architecture", "shop-phase-2.8.6-mapping-report.json");

const STOP_TOKENS = new Set([
  "camiseta",
  "calca",
  "calça",
  "aerostore",
  "cores",
  "tecnologica",
  "tecnológica",
  "five",
  "pocket",
  "pockets",
  "de",
  "da",
  "do",
  "e",
  "a",
  "o",
  "com"
]);

function normalizeKey(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value = "") {
  return normalizeKey(value)
    .split(" ")
    .map((token) => token.toLowerCase())
    .filter((token) => token && !STOP_TOKENS.has(token));
}

function fileSha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function priceLabelToCents(label = "") {
  const match = String(label || "").replace(/\./g, "").match(/(\d+),(\d{2})/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 100 + Number(match[2]);
}

function jaccard(a = [], b = []) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (!setA.size && !setB.size) {
    return 0;
  }
  let inter = 0;
  setA.forEach((token) => {
    if (setB.has(token)) {
      inter += 1;
    }
  });
  const union = new Set([...setA, ...setB]).size;
  return union ? inter / union : 0;
}

function extractColorHint(editorial = {}) {
  const fromField = normalizeKey(editorial.color_editorial || "");
  if (fromField) {
    return fromField;
  }
  const source = normalizeKey(editorial.source_product_name || "");
  const colors = ["PRETO", "OFF WHITE", "BRANCO", "BEGE", "BRASIL", "VERDE", "CINZA", "MARSALA"];
  return colors.find((color) => source.includes(color)) || "";
}

function scoreCandidate(editorial = {}, candidate = {}) {
  const sourceKey = normalizeKey(editorial.source_product_name);
  const editorialKey = normalizeKey(editorial.editorial_name);
  const pdvKey = normalizeKey(candidate.name);
  const sourceTokens = tokenize(editorial.source_product_name);
  const editorialTokens = tokenize(editorial.editorial_name);
  const pdvTokens = tokenize(candidate.name);
  const colorHint = extractColorHint(editorial);
  const expectedCents = priceLabelToCents(editorial.price_label)
    || Number(editorial.price_cents_ref || 0)
    || null;
  const candidateCents = Number(candidate.price_cents || 0);

  let score = 0;
  const reasons = [];

  if (pdvKey && sourceKey && pdvKey === sourceKey) {
    score += 100;
    reasons.push("nome PDV idêntico ao source_product_name");
  } else if (pdvKey && sourceKey && (pdvKey.includes(sourceKey) || sourceKey.includes(pdvKey))) {
    score += 70;
    reasons.push("nome PDV contém / está contido em source_product_name");
  }

  const sourceOverlap = jaccard(sourceTokens, pdvTokens);
  const editorialOverlap = jaccard(editorialTokens, pdvTokens);
  score += Math.round(sourceOverlap * 40);
  score += Math.round(editorialOverlap * 20);
  if (sourceOverlap >= 0.8) {
    reasons.push(`tokens source overlap ${(sourceOverlap * 100).toFixed(0)}%`);
  }

  if (colorHint) {
    if (pdvKey.includes(colorHint)) {
      score += 25;
      reasons.push(`cor alinhada: ${colorHint}`);
    } else {
      score -= 20;
      reasons.push(`cor esperada ausente no nome PDV: ${colorHint}`);
    }
  }

  if (expectedCents && candidateCents) {
    const delta = Math.abs(expectedCents - candidateCents);
    if (delta === 0) {
      score += 15;
      reasons.push("preço idêntico");
    } else if (delta <= 100) {
      score += 5;
      reasons.push("preço próximo");
    } else {
      score -= 10;
      reasons.push("preço divergente");
    }
  }

  // Prefer potentially publishable / sellable as soft signal only
  if (candidate.is_potentially_publishable) {
    score += 5;
    reasons.push("potencialmente publicável");
  } else if (candidate.sellable) {
    score += 2;
  }

  let confidence = "low";
  if (score >= 90) {
    confidence = "high";
  } else if (score >= 55) {
    confidence = "medium";
  }

  return {
    score,
    confidence,
    reasons
  };
}

function summarizeVariants(variants = []) {
  const list = Array.isArray(variants) ? variants : [];
  return {
    variant_count: list.length,
    active_variant_count: list.filter((v) => String(v.pdv_status || "").toLowerCase() === "ativo").length,
    colors: Array.from(new Set(list.map((v) => v.color).filter(Boolean))),
    sizes: Array.from(new Set(list.map((v) => v.size).filter(Boolean))),
    sellable_variants: list.filter((v) => v.sellable).length,
    availabilities: Array.from(new Set(list.map((v) => v.availability).filter(Boolean)))
  };
}

function buildHumanNote(editorial = {}, ranked = [], mappingStatus = "") {
  if (mappingStatus === "no_match") {
    return "Sem candidato PDV claro — revisar nome no PDV ou intake.";
  }
  if (mappingStatus === "ambiguous") {
    return "Mais de um candidato plausível — revisão humana obrigatória antes de preencher FK.";
  }
  const top = ranked[0];
  if (!top) {
    return "Sem candidato.";
  }
  if (top.confidence === "high") {
    return "Match forte por nome/preço — candidato sugerido apenas no relatório (intake permanece sem FK).";
  }
  if (top.confidence === "medium") {
    return "Match parcial — confirmar manualmente antes de mapear FK.";
  }
  return "Match fraco — não usar sem revisão humana.";
}

function classifyMapping(ranked = []) {
  const highs = ranked.filter((item) => item.confidence === "high");
  const mediums = ranked.filter((item) => item.confidence === "medium");
  if (!ranked.length || (highs.length === 0 && mediums.length === 0 && ranked[0].score < 40)) {
    return "no_match";
  }
  if (highs.length > 1) {
    return "ambiguous";
  }
  if (highs.length === 1) {
    const second = ranked[1];
    if (second && second.confidence === "high") {
      return "ambiguous";
    }
    if (second && second.confidence === "medium" && second.score >= highs[0].score - 15) {
      return "ambiguous";
    }
    return "high";
  }
  if (mediums.length > 1 && mediums[0].score - mediums[1].score < 12) {
    return "ambiguous";
  }
  if (mediums.length >= 1) {
    return "medium";
  }
  return "low";
}

async function loadAllCandidates() {
  // Paginate to cover full catalog (limit max 200 per page in service)
  const pageSize = 200;
  let page = 1;
  let total = Infinity;
  const items = [];
  while ((page - 1) * pageSize < total) {
    const result = await listPdvPublicationCandidates({
      page,
      limit: pageSize,
      include_test_candidates: "false"
    });
    total = Number(result.total || 0);
    const batch = Array.isArray(result.items) ? result.items : [];
    items.push(...batch);
    if (!batch.length) {
      break;
    }
    page += 1;
    if (page > 50) {
      break;
    }
  }
  return { items, total };
}

function mapEditorialToCandidates(editorial = {}, catalog = []) {
  const ranked = catalog
    .map((candidate) => {
      const scored = scoreCandidate(editorial, candidate);
      const variantSummary = summarizeVariants(candidate.variants);
      return {
        pdv_product_id: Number(candidate.pdv_product_ref || 0) || null,
        pdv_name: candidate.name,
        pdv_status: candidate.pdv_status,
        price_cents: candidate.price_cents,
        sellable: Boolean(candidate.sellable),
        availability: candidate.availability,
        is_potentially_publishable: Boolean(candidate.is_potentially_publishable),
        block_reason_primary: candidate.block_reason_primary || "",
        variant_summary: variantSummary,
        score: scored.score,
        confidence: scored.confidence,
        match_reasons: scored.reasons
      };
    })
    .filter((item) => item.score >= 35)
    .sort((a, b) => b.score - a.score || String(a.pdv_name).localeCompare(String(b.pdv_name)))
    .slice(0, 8);

  const mappingStatus = classifyMapping(ranked);
  const top = ranked[0] || null;

  return {
    slot: editorial.slot,
    sort_order: editorial.sort_order,
    slug: editorial.slug,
    source_product_name: editorial.source_product_name,
    editorial_name: editorial.editorial_name,
    price_label: editorial.price_label,
    category: editorial.category,
    featured: Boolean(editorial.featured),
    intake_product_id: editorial.product_id,
    intake_variant_id: editorial.variant_id,
    mapping_status: mappingStatus,
    suggested_confidence: top ? top.confidence : "none",
    suggested_pdv_product_id: mappingStatus === "high" || mappingStatus === "medium"
      ? (top?.pdv_product_id || null)
      : null,
    human_note: buildHumanNote(editorial, ranked, mappingStatus),
    candidates: ranked
  };
}

async function main() {
  if (!fs.existsSync(INTAKE_PATH)) {
    throw new Error(`Intake não encontrado: ${INTAKE_PATH}`);
  }

  const intakeHashBefore = fileSha256(INTAKE_PATH);
  const intake = JSON.parse(fs.readFileSync(INTAKE_PATH, "utf8"));
  const products = Array.isArray(intake.products) ? intake.products : [];
  if (products.length !== 8) {
    throw new Error(`Esperado 8 produtos no intake, encontrado ${products.length}`);
  }

  const { items: catalog, total } = await loadAllCandidates();
  const mappings = products.map((product) => mapEditorialToCandidates(product, catalog));

  const summary = {
    high: mappings.filter((m) => m.mapping_status === "high").length,
    medium: mappings.filter((m) => m.mapping_status === "medium").length,
    ambiguous: mappings.filter((m) => m.mapping_status === "ambiguous").length,
    low: mappings.filter((m) => m.mapping_status === "low").length,
    no_match: mappings.filter((m) => m.mapping_status === "no_match").length
  };

  const intakeHashAfter = fileSha256(INTAKE_PATH);
  if (intakeHashAfter !== intakeHashBefore) {
    throw new Error("ABORT: pilot-editorial-intake.json foi alterado durante a execução");
  }

  const environmentNote = catalog.length < 8
    ? "Banco PDV local não contém os 8 produtos piloto AEROSTORE (curadoria VPS). Reexecutar este script no ambiente com o PDV real (ex.: VPS) antes de preencher FKs."
    : "Catálogo PDV lido com volume suficiente para matching.";

  const report = {
    phase: "2.8.6",
    mode: "read_only",
    generated_at: new Date().toISOString(),
    intake_path: "modules/shop/config/pilot-editorial-intake.json",
    intake_sha256: intakeHashBefore,
    intake_unchanged: true,
    catalog_public_enabled: intake.catalog_public_enabled === false ? false : intake.catalog_public_enabled,
    environment_note: environmentNote,
    pdv_candidates_scanned: catalog.length,
    pdv_candidates_total: total,
    wrote_to_database: false,
    wrote_to_intake: false,
    summary,
    mappings
  };

  // Persist report JSON only under docs/architecture (gitignored) — never touch intake or DB
  fs.mkdirSync(path.dirname(REPORT_JSON_PATH), { recursive: true });
  fs.writeFileSync(REPORT_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("SHOP_PILOT_EDITORIAL_MAPPING_READONLY_OK");
  console.log(JSON.stringify({
    summary,
    pdv_candidates_scanned: catalog.length,
    intake_unchanged: true,
    wrote_to_database: false,
    wrote_to_intake: false,
    report_json: "docs/architecture/shop-phase-2.8.6-mapping-report.json",
    mappings: mappings.map((m) => ({
      slot: m.slot,
      slug: m.slug,
      mapping_status: m.mapping_status,
      suggested_pdv_product_id: m.suggested_pdv_product_id,
      suggested_confidence: m.suggested_confidence,
      top_candidate: m.candidates[0]
        ? {
          pdv_product_id: m.candidates[0].pdv_product_id,
          pdv_name: m.candidates[0].pdv_name,
          score: m.candidates[0].score,
          confidence: m.candidates[0].confidence
        }
        : null
    }))
  }, null, 2));
}

main().catch((error) => {
  console.error("SHOP_PILOT_EDITORIAL_MAPPING_READONLY_FAIL", error.message || error);
  process.exitCode = 1;
});
