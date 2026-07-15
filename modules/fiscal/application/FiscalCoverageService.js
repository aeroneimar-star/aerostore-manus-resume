"use strict";

const { all } = require("../../../db");
const { getActiveOperationalStoreOptions } = require("../../pdv/utils/pdvStoreUtils");
const { FiscalEstablishmentRepository } = require("../repositories/FiscalEstablishmentRepository");
const { FiscalTaxProfileRepository } = require("../repositories/FiscalTaxProfileRepository");
const { FiscalPaymentMappingRepository } = require("../repositories/FiscalPaymentMappingRepository");
const { evaluateEstablishment, evaluateSaleItem } = require("./FiscalReadinessService");
const { FISCAL_READINESS_STATUSES } = require("../domain/fiscalReadinessStatuses");
const { getFiscalDefaultEnvironment } = require("../utils/fiscalConfig");
const { PAYMENT_MAPPING_STATUSES } = require("../domain/fiscalPaymentReadiness");

const establishmentRepository = new FiscalEstablishmentRepository();
const profileRepository = new FiscalTaxProfileRepository();
const paymentMappingRepository = new FiscalPaymentMappingRepository();

async function buildFiscalCoverageReport(filters = {}) {
  const storeFilter = String(filters.store_id || filters.loja || "").trim();
  const statusFilter = String(filters.status || "").trim().toUpperCase();
  const gapTypeFilter = String(filters.gap_type || filters.tipo || "").trim().toUpperCase();
  const productFilter = String(filters.product || filters.q || "").trim().toLowerCase();
  const productKind = String(filters.product_kind || "").trim().toLowerCase(); // simple|variable|""
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 300);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  const establishments = await establishmentRepository.list({ activeOnly: false });
  const storeOptions = getActiveOperationalStoreOptions();
  const profiles = await profileRepository.list({ includeTest: true });
  const payments = await paymentMappingRepository.list();

  const storeCoverage = [];
  for (const store of storeOptions) {
    if (storeFilter && store.value !== storeFilter) continue;
    const linked = await establishmentRepository.findActiveByStoreId(store.value, {
      environment: getFiscalDefaultEnvironment()
    });
    storeCoverage.push({
      store_id: store.value,
      label: store.label,
      has_establishment: Boolean(linked),
      establishment_id: linked?.id || null
    });
  }

  const establishmentResults = [];
  for (const est of establishments) {
    const evaluated = await evaluateEstablishment(est);
    establishmentResults.push({
      establishment_id: est.id,
      label: est.trade_name || est.legal_name,
      status: evaluated.status,
      blocking_count: evaluated.blocking_errors.length,
      warning_count: evaluated.warnings.length
    });
  }

  const profileCoverage = profiles.map((profile) => {
    const incomplete = !profile.cfop || (!profile.csosn && !profile.cst_icms)
      || !profile.pis_cst || !profile.cofins_cst;
    return {
      id: profile.id,
      code: profile.code,
      is_test_profile: profile.is_test_profile,
      active: profile.active,
      status: !profile.active
        ? FISCAL_READINESS_STATUSES.BLOCKED
        : (incomplete ? FISCAL_READINESS_STATUSES.WARNING : FISCAL_READINESS_STATUSES.READY),
      incomplete
    };
  });

  const paymentCoverage = {
    confirmed: payments.filter((p) => p.mapping_status === PAYMENT_MAPPING_STATUSES.CONFIRMED).length,
    pending: payments.filter((p) => p.mapping_status === PAYMENT_MAPPING_STATUSES.PENDING_ACCOUNTING).length,
    ambiguous: payments.filter((p) => p.mapping_status === PAYMENT_MAPPING_STATUSES.AMBIGUOUS).length,
    blocked: payments.filter((p) => p.mapping_status === PAYMENT_MAPPING_STATUSES.BLOCKED_FOR_EMIT).length,
    items: payments
  };

  const productRows = await all(
    `SELECT p.id AS product_id, p.name, p.base_sku, p.legacy_ai_product_id, p.product_type,
            v.id AS variant_id, v.sku AS variant_sku
     FROM pdv_products_v2 p
     LEFT JOIN pdv_product_variants v ON v.product_id = p.id
     WHERE COALESCE(p.status,'') != 'inativo'
     ORDER BY p.id ASC, v.id ASC
     LIMIT 800`
  ).catch(async () => []);

  let rows = productRows;
  if (!rows.length) {
    const legacy = await all(
      `SELECT id AS legacy_ai_product_id, name, sku AS base_sku
       FROM ai_products
       WHERE COALESCE(deleted_at,'') = ''
       ORDER BY id ASC LIMIT 500`
    ).catch(() => []);
    rows = legacy.map((row) => ({
      product_id: null,
      name: row.name,
      base_sku: row.base_sku,
      legacy_ai_product_id: row.legacy_ai_product_id,
      product_type: "legacy",
      variant_id: null,
      variant_sku: null
    }));
  }

  // Inclui cadastros fiscais órfãos (product_tax sem linha de catálogo)
  const taxRows = await all(
    `SELECT product_ref, product_id, variant_id, legacy_ai_product_id, ncm
     FROM fiscal_product_tax
     WHERE active = 1
     ORDER BY id ASC
     LIMIT 300`
  ).catch(() => []);
  for (const tax of taxRows) {
    const already = rows.some((row) => (
      (tax.variant_id && row.variant_id === tax.variant_id)
      || (tax.product_id && row.product_id === tax.product_id && !row.variant_id)
      || (tax.legacy_ai_product_id && row.legacy_ai_product_id === tax.legacy_ai_product_id && !row.variant_id)
    ));
    if (already) continue;
    rows.push({
      product_id: tax.product_id,
      name: tax.product_ref,
      base_sku: tax.product_ref,
      legacy_ai_product_id: tax.legacy_ai_product_id,
      product_type: "fiscal_product_tax",
      variant_id: tax.variant_id || null,
      variant_sku: tax.variant_id || null
    });
  }

  const productItems = [];
  for (const row of rows) {
    const isVariable = Boolean(row.variant_id);
    if (productKind === "simple" && isVariable) continue;
    if (productKind === "variable" && !isVariable) continue;
    const label = row.variant_sku || row.base_sku || row.name || "";
    if (productFilter && !String(label).toLowerCase().includes(productFilter)
      && !String(row.name || "").toLowerCase().includes(productFilter)) {
      continue;
    }
    const evaluated = await evaluateSaleItem({
      productId: row.product_id,
      variantId: row.variant_id || "",
      legacyAiProductId: row.legacy_ai_product_id,
      sku: row.variant_sku || row.base_sku || "",
      saleItem: { nome: row.name || "" },
      storeId: storeFilter || "",
      operationType: "sale_internal"
    });
    if (statusFilter && evaluated.status !== statusFilter) continue;
    if (gapTypeFilter) {
      const codes = evaluated.findings.map((f) => f.code);
      if (!codes.includes(gapTypeFilter)) continue;
    }
    productItems.push({
      product_id: row.product_id,
      variant_id: row.variant_id,
      legacy_ai_product_id: row.legacy_ai_product_id,
      label,
      name: row.name || "",
      kind: isVariable ? "variable" : "simple",
      status: evaluated.status,
      blocking_errors: evaluated.blocking_errors,
      warnings: evaluated.warnings,
      cest_status: evaluated.extras?.cest_status || null
    });
  }

  const page = productItems.slice(offset, offset + limit);
  const readyCount = productItems.filter((i) => i.status === FISCAL_READINESS_STATUSES.READY).length;
  const blockedCount = productItems.filter((i) => i.status === FISCAL_READINESS_STATUSES.BLOCKED).length;
  const warningCount = productItems.filter((i) => i.status === FISCAL_READINESS_STATUSES.WARNING).length;
  const variantItems = productItems.filter((i) => i.kind === "variable");
  const simpleItems = productItems.filter((i) => i.kind === "simple");

  const coveragePct = productItems.length
    ? Number(((readyCount / productItems.length) * 100).toFixed(2))
    : 0;

  return {
    generated_at: new Date().toISOString(),
    filters: {
      store_id: storeFilter || null,
      status: statusFilter || null,
      gap_type: gapTypeFilter || null,
      product: productFilter || null,
      product_kind: productKind || null,
      category_filter_supported: false,
      brand_filter_supported: false,
      limit,
      offset
    },
    notes: [
      "Filtro por categoria/marca ainda nao e confiavel no Stage 3.",
      "Campo preenchido nao implica tributacao correta.",
      "Marcadores de certificado/CSC/provedor nao entram na cobertura cadastral como bloqueio.",
      "Mapeamento de pagamentos permanece pendente da contabilidae por padrao."
    ],
    summary: {
      products_total: productItems.length,
      products_ready: readyCount,
      products_blocked: blockedCount,
      products_warning: warningCount,
      variants_total: variantItems.length,
      variants_ready: variantItems.filter((i) => i.status === FISCAL_READINESS_STATUSES.READY).length,
      variants_blocked: variantItems.filter((i) => i.status === FISCAL_READINESS_STATUSES.BLOCKED).length,
      simple_total: simpleItems.length,
      stores_with_establishment: storeCoverage.filter((s) => s.has_establishment).length,
      stores_without_establishment: storeCoverage.filter((s) => !s.has_establishment).length,
      profiles_ready: profileCoverage.filter((p) => p.status === FISCAL_READINESS_STATUSES.READY).length,
      profiles_incomplete: profileCoverage.filter((p) => p.incomplete || p.status !== FISCAL_READINESS_STATUSES.READY).length,
      payments_confirmed: paymentCoverage.confirmed,
      payments_pending: paymentCoverage.pending + paymentCoverage.ambiguous + paymentCoverage.blocked,
      coverage_percent: coveragePct
    },
    stores: storeCoverage,
    establishments: establishmentResults,
    profiles: profileCoverage,
    payments: paymentCoverage,
    products: {
      total: productItems.length,
      limit,
      offset,
      items: page
    }
  };
}

module.exports = {
  buildFiscalCoverageReport
};
