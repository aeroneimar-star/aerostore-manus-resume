"use strict";

const { get } = require("../../../db");
const { normalizeStoreKey } = require("../../pdv/utils/pdvStoreUtils");
const {
  normalizeText,
  normalizeDigits,
  normalizeUf,
  isValidNcm,
  isValidGtin,
  isValidCfop,
  isValidFiscalOrigin
} = require("../utils/fiscalValidators");
const {
  FISCAL_OPERATION_TYPES,
  normalizeFiscalOperationType
} = require("../domain/fiscalOperations");
const { FiscalEstablishmentRepository } = require("../repositories/FiscalEstablishmentRepository");
const { FiscalTaxProfileRepository } = require("../repositories/FiscalTaxProfileRepository");
const { FiscalProductTaxRepository, buildProductRef } = require("../repositories/FiscalProductTaxRepository");
const { getFiscalDefaultEnvironment } = require("../utils/fiscalConfig");

const establishmentRepository = new FiscalEstablishmentRepository();
const profileRepository = new FiscalTaxProfileRepository();
const productTaxRepository = new FiscalProductTaxRepository();

function fieldOrigin(source, value) {
  return {
    value: value === undefined ? null : value,
    source: source || "missing"
  };
}

function pickResolved(fields) {
  const out = {};
  const origins = {};
  for (const [key, entry] of Object.entries(fields)) {
    out[key] = entry.value;
    origins[key] = entry.source;
  }
  return { values: out, origins };
}

async function loadCatalogHints({ productId = null, variantId = "", sku = "" } = {}) {
  let row = null;
  try {
    if (variantId) {
      row = await get(
        `SELECT v.id AS variant_id, v.sku, v.barcode, p.id AS product_id, p.legacy_ai_product_id,
                a.ncm AS legacy_ncm, a.gtin_ean AS legacy_gtin
         FROM pdv_product_variants v
         INNER JOIN pdv_products_v2 p ON p.id = v.product_id
         LEFT JOIN ai_products a ON a.id = p.legacy_ai_product_id
         WHERE v.id = ?
         LIMIT 1`,
        [normalizeText(variantId)]
      );
    }
    if (!row && productId) {
      row = await get(
        `SELECT NULL AS variant_id, p.base_sku AS sku, NULL AS barcode, p.id AS product_id,
                p.legacy_ai_product_id, a.ncm AS legacy_ncm, a.gtin_ean AS legacy_gtin
         FROM pdv_products_v2 p
         LEFT JOIN ai_products a ON a.id = p.legacy_ai_product_id
         WHERE p.id = ?
         LIMIT 1`,
        [Number(productId) || 0]
      );
    }
    if (!row && sku) {
      row = await get(
        `SELECT id AS legacy_ai_product_id, sku, codigo, ncm AS legacy_ncm, gtin_ean AS legacy_gtin
         FROM ai_products
         WHERE UPPER(COALESCE(sku,'')) = UPPER(?) OR UPPER(COALESCE(codigo,'')) = UPPER(?)
         LIMIT 1`,
        [sku, sku]
      );
    }
  } catch (_error) {
    row = null;
  }
  return row || {};
}

/**
 * Resolve configuração tributária de um item (sem calcular imposto / sem emitir).
 * Campo preenchido NÃO implica tributação correta — apenas configuração encontrada.
 */
async function resolveForSaleItem({
  establishment = null,
  storeId = "",
  productId = null,
  variantId = "",
  legacyAiProductId = null,
  sku = "",
  saleItem = null,
  operationType = FISCAL_OPERATION_TYPES.SALE_INTERNAL,
  originUf = "",
  destinationUf = "",
  environment = ""
} = {}) {
  const gaps = [];
  const warnings = [];
  const blockingErrors = [];
  const op = normalizeFiscalOperationType(operationType) || FISCAL_OPERATION_TYPES.SALE_INTERNAL;
  const env = String(environment || getFiscalDefaultEnvironment() || "homologacao").toLowerCase();
  const store = normalizeStoreKey(storeId || "");
  let resolvedEstablishment = establishment;
  if (!resolvedEstablishment && store) {
    resolvedEstablishment = await establishmentRepository.findActiveByStoreId(store, {
      environment: env
    });
  }
  if (!resolvedEstablishment) {
    gaps.push("establishment_missing");
    blockingErrors.push("establishment_missing");
  }

  const catalog = await loadCatalogHints({
    productId,
    variantId,
    sku: sku || saleItem?.sku || saleItem?.codigo || ""
  });

  const parentProductId = Number(productId || catalog.product_id || 0) || null;
  const resolvedVariantId = normalizeText(variantId || catalog.variant_id || saleItem?.variation_id || "");
  const legacyId = Number(legacyAiProductId || catalog.legacy_ai_product_id || saleItem?.product_id || 0) || null;

  if (!parentProductId && !resolvedVariantId && !legacyId && !sku && !saleItem) {
    gaps.push("item_unresolved");
    warnings.push("item_unresolved");
  }

  const variantTax = resolvedVariantId
    ? await productTaxRepository.findByVariantId(resolvedVariantId)
    : null;
  const parentTax = parentProductId
    ? await productTaxRepository.findByProductId(parentProductId)
    : (legacyId ? await productTaxRepository.findByLegacyAiProductId(legacyId) : null);

  const inherit = !variantTax || variantTax.inherit_from_parent !== false;

  function resolveProductField(field, { fromSaleItem = null, fromCatalog = null } = {}) {
    if (variantTax && variantTax[field] != null && variantTax[field] !== "") {
      return fieldOrigin("variant_override", variantTax[field]);
    }
    if (inherit && parentTax && parentTax[field] != null && parentTax[field] !== "") {
      return fieldOrigin("product_parent", parentTax[field]);
    }
    if (fromSaleItem != null && fromSaleItem !== "") {
      return fieldOrigin("sale_item", fromSaleItem);
    }
    if (fromCatalog != null && fromCatalog !== "") {
      return fieldOrigin("catalog", fromCatalog);
    }
    return fieldOrigin("missing", null);
  }

  const productFields = pickResolved({
    ncm: resolveProductField("ncm", {
      fromSaleItem: saleItem?.ncm,
      fromCatalog: catalog.legacy_ncm
    }),
    cest: resolveProductField("cest", { fromSaleItem: saleItem?.cest }),
    origin: resolveProductField("origin", {
      fromSaleItem: saleItem?.origem_fiscal ?? saleItem?.origem ?? saleItem?.origin
    }),
    unit: resolveProductField("unit", {
      fromSaleItem: saleItem?.unidade || saleItem?.unit
    }),
    gtin_ean: resolveProductField("gtin_ean", {
      fromSaleItem: saleItem?.gtin_ean || saleItem?.ean || saleItem?.barcode,
      fromCatalog: catalog.legacy_gtin || catalog.barcode
    }),
    fiscal_description: resolveProductField("fiscal_description", {
      fromSaleItem: saleItem?.nome || saleItem?.name || saleItem?.product_name
    })
  });

  const profileId = (variantTax && variantTax.profile_id)
    || (inherit && parentTax && parentTax.profile_id)
    || null;
  const profileSource = variantTax && variantTax.profile_id
    ? "variant_override"
    : (parentTax && parentTax.profile_id ? "product_parent" : "missing");

  let profile = profileId ? await profileRepository.findById(profileId) : null;
  if (profile && profile.active === false) {
    gaps.push("profile_inactive");
    blockingErrors.push("profile_inactive");
    profile = null;
  }
  if (profile && profile.operation_type && profile.operation_type !== op) {
    gaps.push("profile_operation_mismatch");
    blockingErrors.push("profile_operation_mismatch");
  }
  if (!profile) {
    gaps.push("profile_missing");
    blockingErrors.push("profile_missing");
  }

  if (profile && profile.is_test_profile && (env === "producao" || env === "production" || env === "prod")) {
    gaps.push("test_profile_in_production");
    blockingErrors.push("test_profile_in_production");
  } else if (profile && profile.is_test_profile) {
    warnings.push("test_profile_in_non_production");
  }

  const origin = normalizeUf(originUf || resolvedEstablishment?.uf || "");
  const destination = normalizeUf(destinationUf || origin);

  if (profile) {
    const profileOrigin = normalizeUf(profile.origin_uf || "");
    const profileDestination = normalizeUf(profile.destination_uf || "");
    if (profileOrigin && origin && profileOrigin !== origin) {
      gaps.push("profile_origin_uf_mismatch");
      warnings.push("profile_origin_uf_mismatch");
    }
    if (profileDestination && destination && profileDestination !== destination) {
      gaps.push("profile_destination_uf_mismatch");
      warnings.push("profile_destination_uf_mismatch");
    }
  }

  const taxFields = {
    cfop: fieldOrigin(profile?.cfop ? "profile" : "missing", profile?.cfop ?? null),
    csosn: fieldOrigin(profile?.csosn ? "profile" : "missing", profile?.csosn ?? null),
    cst_icms: fieldOrigin(profile?.cst_icms ? "profile" : "missing", profile?.cst_icms ?? null),
    pis_cst: fieldOrigin(profile?.pis_cst ? "profile" : "missing", profile?.pis_cst ?? null),
    cofins_cst: fieldOrigin(profile?.cofins_cst ? "profile" : "missing", profile?.cofins_cst ?? null),
    ipi_cst: fieldOrigin(profile?.ipi_cst ? "profile" : "missing", profile?.ipi_cst ?? null),
    icms_rate: fieldOrigin(profile?.icms_rate != null ? "profile" : "missing", profile?.icms_rate ?? null),
    pis_rate: fieldOrigin(profile?.pis_rate != null ? "profile" : "missing", profile?.pis_rate ?? null),
    cofins_rate: fieldOrigin(profile?.cofins_rate != null ? "profile" : "missing", profile?.cofins_rate ?? null),
    ipi_rate: fieldOrigin(profile?.ipi_rate != null ? "profile" : "missing", profile?.ipi_rate ?? null),
    base_reduction_rate: fieldOrigin(
      profile?.base_reduction_rate != null ? "profile" : "missing",
      profile?.base_reduction_rate ?? null
    ),
    benefit_code: fieldOrigin(profile?.benefit_code ? "profile" : "missing", profile?.benefit_code ?? null),
    additional_info: fieldOrigin(
      profile?.additional_info ? "profile" : "missing",
      profile?.additional_info ?? null
    )
  };
  const taxResolved = pickResolved(taxFields);

  if (!productFields.values.ncm) {
    gaps.push("ncm_missing");
    blockingErrors.push("ncm_missing");
  } else if (!isValidNcm(productFields.values.ncm)) {
    gaps.push("ncm_invalid");
    blockingErrors.push("ncm_invalid");
  }

  if (productFields.values.origin == null || productFields.values.origin === "") {
    gaps.push("origin_missing");
    blockingErrors.push("origin_missing");
  } else if (!isValidFiscalOrigin(productFields.values.origin)) {
    gaps.push("origin_invalid");
    warnings.push("origin_invalid");
  }

  if (!productFields.values.unit) {
    gaps.push("unit_missing");
    blockingErrors.push("unit_missing");
  }

  if (!taxResolved.values.cfop) {
    gaps.push("cfop_missing");
    blockingErrors.push("cfop_missing");
  } else if (!isValidCfop(taxResolved.values.cfop)) {
    gaps.push("cfop_invalid");
    blockingErrors.push("cfop_invalid");
  }

  // CSOSN (Simples) e CST ICMS (regime normal) — um dos dois basta; ambos preenchidos gera aviso.
  if (!taxResolved.values.csosn && !taxResolved.values.cst_icms) {
    gaps.push("csosn_or_cst_missing");
    blockingErrors.push("csosn_or_cst_missing");
  } else if (taxResolved.values.csosn && taxResolved.values.cst_icms) {
    warnings.push("csosn_and_cst_both_set");
  }

  if (!taxResolved.values.pis_cst) {
    gaps.push("pis_cst_missing");
    blockingErrors.push("pis_cst_missing");
  }
  if (!taxResolved.values.cofins_cst) {
    gaps.push("cofins_cst_missing");
    blockingErrors.push("cofins_cst_missing");
  }

  const cestRequired = Boolean(variantTax?.cest_required || parentTax?.cest_required);
  if (cestRequired && !productFields.values.cest) {
    gaps.push("cest_missing_required");
    blockingErrors.push("cest_missing_required");
  }

  if (!productFields.values.gtin_ean) {
    gaps.push("gtin_missing");
    warnings.push("gtin_missing");
  } else if (!isValidGtin(productFields.values.gtin_ean)) {
    gaps.push("gtin_invalid");
    warnings.push("gtin_invalid");
  }

  if (variantTax && variantTax.inherit_from_parent === false) {
    const overrideInsufficient = !variantTax.ncm || !variantTax.profile_id;
    if (overrideInsufficient) {
      gaps.push("variant_override_incomplete");
      warnings.push("variant_override_incomplete");
    }
  }

  const uniqueGaps = Array.from(new Set(gaps));
  const uniqueWarnings = Array.from(new Set(warnings));
  const uniqueBlocking = Array.from(new Set(blockingErrors));
  const complete = uniqueBlocking.length === 0;

  return {
    operation_type: op,
    environment: env,
    store_id: store || null,
    origin_uf: origin || null,
    destination_uf: destination || null,
    establishment_id: resolvedEstablishment?.id || null,
    product_ref: buildProductRef({
      productId: parentProductId,
      variantId: resolvedVariantId,
      legacyAiProductId: legacyId
    }) || null,
    product_id: parentProductId,
    variant_id: resolvedVariantId || null,
    legacy_ai_product_id: legacyId,
    profile_id: profile?.id || null,
    profile_code: profile?.code || null,
    profile_is_test: Boolean(profile?.is_test_profile),
    profile_source: profileSource,
    product: productFields.values,
    product_field_origins: productFields.origins,
    tax: taxResolved.values,
    tax_field_origins: taxResolved.origins,
    gaps: uniqueGaps,
    warnings: uniqueWarnings,
    blocking_errors: uniqueBlocking,
    completeness: complete ? "complete" : "incomplete",
    // Campo preenchido ≠ tributação correta/aprovada pela contabilidade
    tax_correctness: "unverified",
    invented_tax_fields: false,
    configuration_markers_are_not_operational_proof: true
  };
}

module.exports = {
  resolveForSaleItem
};
