"use strict";

const { all, get } = require("../../../db");
const { getActiveOperationalStoreOptions } = require("../../pdv/utils/pdvStoreUtils");
const { isValidNcm, isValidGtin } = require("../utils/fiscalValidators");
const { FiscalEstablishmentRepository } = require("../repositories/FiscalEstablishmentRepository");
const { FiscalTaxProfileRepository } = require("../repositories/FiscalTaxProfileRepository");
const { FiscalProductTaxRepository } = require("../repositories/FiscalProductTaxRepository");
const { resolveForSaleItem } = require("./FiscalTaxResolver");
const { getFiscalDefaultEnvironment } = require("../utils/fiscalConfig");

const establishmentRepository = new FiscalEstablishmentRepository();
const profileRepository = new FiscalTaxProfileRepository();
const productTaxRepository = new FiscalProductTaxRepository();

async function buildFiscalGapsReport(filters = {}) {
  const storeFilter = String(filters.store_id || filters.loja || "").trim();
  const establishmentFilter = Number(filters.establishment_id || 0) || null;
  const gapTypeFilter = String(filters.gap_type || filters.tipo || "").trim();
  const productFilter = String(filters.product || filters.q || "").trim().toLowerCase();

  const establishments = await establishmentRepository.list({ activeOnly: false });
  const storeOptions = getActiveOperationalStoreOptions();

  const establishmentGaps = [];
  for (const est of establishments) {
    const gaps = establishmentRepository.completenessGaps(est);
    if (!gaps.length) continue;
    if (establishmentFilter && est.id !== establishmentFilter) continue;
    establishmentGaps.push({
      type: "establishment",
      establishment_id: est.id,
      label: est.trade_name || est.legal_name || `EST-${est.id}`,
      gaps
    });
  }

  const storeGaps = [];
  for (const store of storeOptions) {
    if (storeFilter && store.value !== storeFilter) continue;
    const linked = await establishmentRepository.findActiveByStoreId(store.value, {
      environment: getFiscalDefaultEnvironment()
    });
    if (!linked) {
      storeGaps.push({
        type: "store_without_establishment",
        store_id: store.value,
        label: store.label,
        gaps: ["store_without_active_establishment"]
      });
    } else if (establishmentFilter && linked.id !== establishmentFilter) {
      continue;
    }
  }

  const productRows = await all(
    `SELECT p.id AS product_id, p.name, p.base_sku, p.legacy_ai_product_id, p.product_type,
            v.id AS variant_id, v.sku AS variant_sku, v.barcode
     FROM pdv_products_v2 p
     LEFT JOIN pdv_product_variants v ON v.product_id = p.id
     WHERE p.status != 'inativo'
     ORDER BY p.id ASC, v.id ASC
     LIMIT 500`
  ).catch(async () => {
    // fallback legado
    const legacy = await all(
      `SELECT id AS legacy_ai_product_id, name, sku AS base_sku, gtin_ean AS barcode, ncm
       FROM ai_products
       WHERE COALESCE(deleted_at,'') = ''
       ORDER BY id ASC
       LIMIT 500`
    );
    return legacy.map((row) => ({
      product_id: null,
      name: row.name,
      base_sku: row.base_sku,
      legacy_ai_product_id: row.legacy_ai_product_id,
      product_type: "legacy",
      variant_id: null,
      variant_sku: row.base_sku,
      barcode: row.barcode,
      legacy_ncm: row.ncm
    }));
  });

  const productGaps = [];
  for (const row of productRows) {
    const label = row.variant_sku || row.base_sku || row.name || `product-${row.product_id || row.legacy_ai_product_id}`;
    if (productFilter && !String(label).toLowerCase().includes(productFilter)
      && !String(row.name || "").toLowerCase().includes(productFilter)) {
      continue;
    }

    const resolved = await resolveForSaleItem({
      productId: row.product_id,
      variantId: row.variant_id || "",
      legacyAiProductId: row.legacy_ai_product_id,
      sku: row.variant_sku || row.base_sku || "",
      saleItem: {
        ncm: row.legacy_ncm || "",
        gtin_ean: row.barcode || "",
        nome: row.name || ""
      },
      storeId: storeFilter || "",
      establishment: establishmentFilter
        ? establishments.find((item) => item.id === establishmentFilter) || null
        : null,
      operationType: "sale_internal"
    });

    if (!resolved.gaps.length) continue;
    if (gapTypeFilter && !resolved.gaps.includes(gapTypeFilter)) continue;

    productGaps.push({
      type: "product",
      product_id: row.product_id,
      variant_id: row.variant_id,
      legacy_ai_product_id: row.legacy_ai_product_id,
      label,
      name: row.name || "",
      gaps: resolved.gaps,
      profile_id: resolved.profile_id,
      completeness: resolved.completeness
    });
  }

  // registros fiscais sem vínculo a catálogo ativo
  const orphanTax = await productTaxRepository.list({ limit: 200 });
  const orphanGaps = [];
  for (const item of orphanTax) {
    const localGaps = [];
    if (!item.ncm) localGaps.push("ncm_missing");
    else if (!isValidNcm(item.ncm)) localGaps.push("ncm_invalid");
    if (!item.origin && item.origin !== "0") localGaps.push("origin_missing");
    if (!item.unit) localGaps.push("unit_missing");
    if (!item.profile_id) localGaps.push("profile_missing");
    if (item.gtin_ean && !isValidGtin(item.gtin_ean)) localGaps.push("gtin_invalid");
    if (item.cest_required && !item.cest) localGaps.push("cest_missing_required");
    if (!localGaps.length) continue;
    if (gapTypeFilter && !localGaps.includes(gapTypeFilter)) continue;
    orphanGaps.push({
      type: "fiscal_product_tax",
      product_ref: item.product_ref,
      product_id: item.product_id,
      variant_id: item.variant_id,
      label: item.product_ref,
      gaps: localGaps
    });
  }

  const allItems = [...establishmentGaps, ...storeGaps, ...productGaps, ...orphanGaps];
  const counts = allItems.reduce((acc, item) => {
    for (const gap of item.gaps) {
      acc[gap] = (acc[gap] || 0) + 1;
    }
    return acc;
  }, {});

  return {
    generated_at: new Date().toISOString(),
    filters: {
      store_id: storeFilter || null,
      establishment_id: establishmentFilter,
      gap_type: gapTypeFilter || null,
      product: productFilter || null,
      // Filtro por categoria: NÃO implementado de forma confiável no Stage 2
      category: null,
      category_filter_supported: false
    },
    notes: [
      "Filtro por categoria de produto nao esta disponivel de forma confiavel no Stage 2.",
      "Marcadores certificate_configured/csc_configured/provider_configured nao comprovam configuracao operacional.",
      "Campo preenchido nao implica tributacao correta aprovada pela contabilidade.",
      "Este relatorio nao aplica correcao automatica."
    ],
    totals: {
      items: allItems.length,
      establishments: establishmentGaps.length,
      stores: storeGaps.length,
      products: productGaps.length,
      fiscal_product_tax: orphanGaps.length
    },
    counts_by_gap: counts,
    items: allItems
  };
}

module.exports = {
  buildFiscalGapsReport
};
