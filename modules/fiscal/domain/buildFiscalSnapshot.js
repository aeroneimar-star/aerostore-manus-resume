"use strict";

const { get } = require("../../../db");
const { normalizeStoreKey } = require("../../pdv/utils/pdvStoreUtils");

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function absent() {
  return null;
}

function pickFirst(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return null;
}

async function lookupProductFiscalHints(item = {}) {
  const sku = normalizeText(item.sku || item.codigo || item.product_sku || "");
  const productId = Number(item.product_id || item.selected_product_id || item.source_product_id || 0) || 0;
  let row = null;
  try {
    if (productId > 0) {
      row = await get(
        `SELECT id, sku, codigo, name, gtin_ean, ncm
         FROM ai_products
         WHERE id = ?
         LIMIT 1`,
        [productId]
      );
    }
    if (!row && sku) {
      row = await get(
        `SELECT id, sku, codigo, name, gtin_ean, ncm
         FROM ai_products
         WHERE UPPER(COALESCE(sku, '')) = UPPER(?)
            OR UPPER(COALESCE(codigo, '')) = UPPER(?)
         LIMIT 1`,
        [sku, sku]
      );
    }
  } catch (_error) {
    row = null;
  }
  return {
    catalog_product_id: row?.id || null,
    catalog_sku: normalizeText(row?.sku || "") || null,
    catalog_codigo: normalizeText(row?.codigo || "") || null,
    catalog_name: normalizeText(row?.name || "") || null,
    catalog_gtin_ean: normalizeDigits(row?.gtin_ean || "") || null,
    catalog_ncm: normalizeText(row?.ncm || "") || null
  };
}

function buildCustomerSnapshot(customer = null) {
  if (!customer || typeof customer !== "object") {
    return {
      identified: false,
      id: null,
      name: null,
      document: null,
      document_type: null,
      email: null,
      phone: null,
      address: null,
      city: null,
      state: null,
      zipcode: null,
      neighborhood: null,
      ie: absent(),
      ie_indicator: absent(),
      legal_name: absent(),
      gaps: ["customer_unidentified"]
    };
  }
  const document = normalizeDigits(customer.document || customer.cpf || customer.cnpj || "");
  const documentType = document.length === 14
    ? "CNPJ"
    : document.length === 11
      ? "CPF"
      : document
        ? "UNKNOWN"
        : null;
  const gaps = [];
  if (!document) gaps.push("customer_document_missing");
  if (!normalizeText(customer.name || customer.nome || "")) gaps.push("customer_name_missing");
  return {
    identified: true,
    id: customer.id || customer.contact_id || customer.customer_id || null,
    name: normalizeText(customer.name || customer.nome || "") || null,
    document: document || null,
    document_type: documentType,
    email: normalizeText(customer.email || "") || null,
    phone: normalizeText(customer.phone || customer.mobile || customer.mobile_normalized || "") || null,
    address: normalizeText(customer.address || "") || null,
    city: normalizeText(customer.city || "") || null,
    state: normalizeText(customer.state || "") || null,
    zipcode: normalizeDigits(customer.zipcode || customer.cep || "") || null,
    neighborhood: normalizeText(customer.neighborhood || customer.bairro || "") || null,
    ie: absent(),
    ie_indicator: absent(),
    legal_name: absent(),
    gaps
  };
}

function buildEmitterSnapshot(establishment = null, storeIds = []) {
  if (!establishment) {
    return {
      establishment_id: null,
      legal_name: null,
      trade_name: null,
      cnpj: null,
      ie: null,
      tax_regime: null,
      uf: null,
      environment: null,
      linked_store_ids: Array.isArray(storeIds) ? storeIds : [],
      gaps: ["establishment_missing"]
    };
  }
  const gaps = [];
  if (!normalizeDigits(establishment.cnpj || "")) gaps.push("emitter_cnpj_missing");
  if (!normalizeText(establishment.legal_name || "")) gaps.push("emitter_legal_name_missing");
  if (!normalizeText(establishment.uf || "")) gaps.push("emitter_uf_missing");
  return {
    establishment_id: establishment.id || null,
    legal_name: normalizeText(establishment.legal_name || "") || null,
    trade_name: normalizeText(establishment.trade_name || "") || null,
    cnpj: normalizeDigits(establishment.cnpj || "") || null,
    ie: normalizeText(establishment.ie || "") || null,
    tax_regime: normalizeText(establishment.tax_regime || "") || null,
    uf: normalizeText(establishment.uf || "").toUpperCase() || null,
    environment: normalizeText(establishment.environment || "") || null,
    linked_store_ids: Array.isArray(storeIds) ? storeIds : [],
    // Stage 1: sem CSC/certificado/credenciais
    csc: absent(),
    certificate: absent(),
    gaps
  };
}

function buildItemFiscalGaps(itemSnapshot) {
  const gaps = [];
  if (!itemSnapshot.ncm) gaps.push("ncm_missing");
  if (!itemSnapshot.origin && itemSnapshot.origin !== 0) gaps.push("origin_missing");
  if (!itemSnapshot.unit) gaps.push("unit_missing");
  if (!itemSnapshot.cfop) gaps.push("cfop_missing");
  if (!itemSnapshot.csosn && !itemSnapshot.cst && !itemSnapshot.cst_icms) gaps.push("csosn_or_cst_missing");
  if (!itemSnapshot.gtin_ean) gaps.push("gtin_optional_missing");
  return gaps;
}

async function buildItemSnapshot(item = {}, context = {}) {
  const hints = await lookupProductFiscalHints(item);
  const description = normalizeText(
    item.nome || item.name || item.product_name || hints.catalog_name || ""
  ) || null;
  const sku = normalizeText(item.sku || item.codigo || hints.catalog_sku || hints.catalog_codigo || "") || null;
  const quantity = toNumberOrNull(item.quantidade ?? item.quantity ?? item.qty) ?? 1;
  const unitPrice = toNumberOrNull(item.preco_unitario ?? item.unit_price ?? item.price ?? item.valor_unitario);
  const lineDiscount = toNumberOrNull(item.desconto ?? item.discount_amount ?? item.line_discount_amount) ?? 0;
  const lineTotal = toNumberOrNull(item.total ?? item.total_amount ?? item.line_total)
    ?? (unitPrice === null ? null : Number(((unitPrice * quantity) - lineDiscount).toFixed(2)));

  let resolved = null;
  try {
    const { resolveForSaleItem } = require("../application/FiscalTaxResolver");
    resolved = await resolveForSaleItem({
      establishment: context.establishment || null,
      storeId: context.storeId || "",
      productId: item.normalized_product_id || hints.catalog_product_id || null,
      variantId: item.variation_id || item.variant_id || "",
      legacyAiProductId: item.product_id || item.selected_product_id || hints.catalog_product_id || null,
      sku,
      saleItem: item,
      operationType: context.operationType || "sale_internal",
      originUf: context.originUf || "",
      destinationUf: context.destinationUf || ""
    });
  } catch (_error) {
    resolved = null;
  }

  const ncm = resolved?.product?.ncm
    || normalizeText(item.ncm || item.classificacao_fiscal || hints.catalog_ncm || "")
    || null;
  const cest = resolved?.product?.cest || normalizeText(item.cest || "") || null;
  const originRaw = resolved?.product?.origin ?? pickFirst(item.origem_fiscal, item.origem, item.origin);
  const origin = originRaw === null || originRaw === undefined || originRaw === ""
    ? null
    : (Number.isFinite(Number(originRaw)) ? Number(originRaw) : normalizeText(String(originRaw)));
  const unit = resolved?.product?.unit || normalizeText(item.unidade || item.unit || "") || null;
  const gtin = resolved?.product?.gtin_ean || normalizeDigits(
    item.gtin_ean || item.gtin || item.ean || item.barcode || item.codigo_barras || hints.catalog_gtin_ean || ""
  ) || null;

  const itemSnapshot = {
    item_id: item.item_id || null,
    product_id: item.product_id || item.selected_product_id || hints.catalog_product_id || null,
    variant_id: item.variation_id || item.variant_id || resolved?.variant_id || null,
    sku,
    description,
    quantity,
    unit_price: unitPrice,
    line_discount: lineDiscount,
    line_total: lineTotal,
    ncm,
    cest,
    origin,
    unit,
    gtin_ean: gtin,
    // Tributação resolvida do perfil — nunca inventada
    cfop: resolved?.tax?.cfop ?? absent(),
    cst: resolved?.tax?.cst_icms ?? absent(),
    cst_icms: resolved?.tax?.cst_icms ?? absent(),
    csosn: resolved?.tax?.csosn ?? absent(),
    pis_cst: resolved?.tax?.pis_cst ?? absent(),
    cofins_cst: resolved?.tax?.cofins_cst ?? absent(),
    ipi_cst: resolved?.tax?.ipi_cst ?? absent(),
    icms_rate: resolved?.tax?.icms_rate ?? absent(),
    pis_rate: resolved?.tax?.pis_rate ?? absent(),
    cofins_rate: resolved?.tax?.cofins_rate ?? absent(),
    ipi_rate: resolved?.tax?.ipi_rate ?? absent(),
    base_reduction_rate: resolved?.tax?.base_reduction_rate ?? absent(),
    fiscal_benefit: resolved?.tax?.benefit_code ?? absent(),
    additional_info: resolved?.tax?.additional_info ?? absent(),
    profile_id: resolved?.profile_id ?? null,
    profile_code: resolved?.profile_code ?? null,
    field_origins: {
      product: resolved?.product_field_origins || null,
      tax: resolved?.tax_field_origins || null,
      profile_source: resolved?.profile_source || null
    },
    tax_resolution: resolved
      ? {
        completeness: resolved.completeness,
        gaps: resolved.gaps,
        warnings: resolved.warnings || [],
        blocking_errors: resolved.blocking_errors || [],
        tax_correctness: resolved.tax_correctness || "unverified",
        invented_tax_fields: false
      }
      : null
  };
  itemSnapshot.fiscal_gaps = Array.from(new Set([
    ...buildItemFiscalGaps(itemSnapshot),
    ...(resolved?.gaps || [])
  ]));
  return itemSnapshot;
}

function buildPaymentsSnapshot(sale = {}) {
  const methods = Array.isArray(sale.pagamentos)
    ? sale.pagamentos
    : (Array.isArray(sale.payments) ? sale.payments : []);
  return methods.map((payment) => ({
    method: normalizeText(payment.method || payment.payment_method || "") || null,
    amount: toNumberOrNull(payment.amount ?? payment.valor) ?? 0,
    installments: toNumberOrNull(payment.installments) ?? 1,
    nfce_tpag: absent(),
    nfce_tpag_mapping_status: "not_mapped_stage2"
  }));
}

/**
 * Gera snapshot fiscal imutável a partir da venda já concluída.
 * Usa FiscalTaxResolver; não inventa CFOP/CSOSN/CST/alíquotas.
 */
async function buildFiscalSnapshot({
  sale = {},
  establishment = null,
  linkedStoreIds = [],
  model = "65",
  purpose = "sale_emit"
} = {}) {
  const storeId = normalizeStoreKey(
    sale.loja || sale.loja_venda || sale.store_id || sale.store_context?.store_id || ""
  );
  const items = Array.isArray(sale.items) ? sale.items : [];
  const itemSnapshots = [];
  const resolveContext = {
    establishment,
    storeId,
    operationType: "sale_internal",
    originUf: establishment?.uf || "",
    destinationUf: establishment?.uf || ""
  };
  for (const item of items) {
    itemSnapshots.push(await buildItemSnapshot(item, resolveContext));
  }

  const customer = buildCustomerSnapshot(sale.customer || null);
  const emitter = buildEmitterSnapshot(establishment, linkedStoreIds);

  const globalGaps = [
    ...emitter.gaps,
    ...customer.gaps,
    ...itemSnapshots.flatMap((item) => item.fiscal_gaps || [])
  ];

  return {
    version: 2,
    generated_at: new Date().toISOString(),
    model: String(model || "65"),
    purpose: String(purpose || "sale_emit"),
    sale_id: normalizeText(sale.sale_id || "") || null,
    store_id: storeId || null,
    sale_status: normalizeText(sale.status || "") || null,
    sale_datetime: normalizeText(sale.data_hora || sale.created_at || "") || null,
    emitter,
    customer,
    items: itemSnapshots,
    totals: {
      subtotal: toNumberOrNull(sale.subtotal ?? sale.gross_amount),
      item_discount: toNumberOrNull(sale.item_discount_amount) ?? 0,
      general_discount: toNumberOrNull(sale.general_discount_amount ?? sale.desconto_extra) ?? 0,
      discount_total: toNumberOrNull(sale.discount_amount ?? sale.desconto_extra) ?? 0,
      total_final: toNumberOrNull(sale.total_final ?? sale.net_amount),
      paid_amount: toNumberOrNull(sale.paid_amount)
    },
    payments: buildPaymentsSnapshot(sale),
    benefits: {
      cashback_used: toNumberOrNull(sale.cashback_usado ?? sale.cashback_used_amount) ?? 0,
      cashback_generated: toNumberOrNull(sale.cashback_generated?.generated_amount || sale.cashback_generated?.amount) ?? 0,
      cashback_generated_id: sale.cashback_generated?.cashback_id || null,
      exchange_credit_used: toNumberOrNull(sale.credito_troca_usado) ?? 0,
      gift_card_used: toNumberOrNull(sale.vale_presente_usado) ?? 0,
      permuta_used: toNumberOrNull(sale.permuta_usada) ?? 0
    },
    fiscal_gaps: Array.from(new Set(globalGaps)),
    notes: {
      stage: 2,
      transmission: "disabled",
      invented_tax_fields: false,
      tax_resolver: "FiscalTaxResolver.resolveForSaleItem"
    }
  };
}

module.exports = {
  buildFiscalSnapshot,
  buildCustomerSnapshot,
  buildEmitterSnapshot
};
