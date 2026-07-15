"use strict";

/**
 * Avaliação de prontidão fiscal — Stage 3.
 * Não cria fiscal_document, não transmite, não inventa tributação.
 */

const { normalizeStoreKey } = require("../../pdv/utils/pdvStoreUtils");
const { isValidCnpj, isValidUf, normalizeDigits, normalizeText } = require("../utils/fiscalValidators");
const { getFiscalDefaultEnvironment } = require("../utils/fiscalConfig");
const { resolveForSaleItem } = require("./FiscalTaxResolver");
const { FiscalEstablishmentRepository } = require("../repositories/FiscalEstablishmentRepository");
const { FiscalProductTaxRepository } = require("../repositories/FiscalProductTaxRepository");
const { FiscalReadinessRulesRepository } = require("../repositories/FiscalReadinessRulesRepository");
const { FiscalPaymentMappingRepository } = require("../repositories/FiscalPaymentMappingRepository");
const { FiscalDocumentRepository } = require("../repositories/FiscalDocumentRepository");
const {
  FISCAL_READINESS_STATUSES,
  FISCAL_READINESS_SEVERITIES,
  CEST_STATUSES,
  createFinding,
  buildReadinessResult,
  deriveStatusFromFindings
} = require("../domain/fiscalReadinessStatuses");
const { defaultSeverityForCode } = require("../domain/fiscalReadinessRules");
const { normalizePaymentMethod, PAYMENT_MAPPING_STATUSES } = require("../domain/fiscalPaymentReadiness");
const { recordFiscalAudit } = require("./fiscalAudit");

const establishmentRepository = new FiscalEstablishmentRepository();
const productTaxRepository = new FiscalProductTaxRepository();
const rulesRepository = new FiscalReadinessRulesRepository();
const paymentMappingRepository = new FiscalPaymentMappingRepository();
const documentRepository = new FiscalDocumentRepository();

const RESOLVER_GAP_TO_CODE = Object.freeze({
  ncm_missing: "NCM_MISSING",
  ncm_invalid: "NCM_INVALID",
  origin_missing: "ORIGIN_MISSING",
  origin_invalid: "ORIGIN_INVALID",
  unit_missing: "UNIT_MISSING",
  profile_missing: "PROFILE_MISSING",
  profile_inactive: "PROFILE_INACTIVE",
  profile_operation_mismatch: "PROFILE_OPERATION_MISMATCH",
  cfop_missing: "CFOP_MISSING",
  cfop_invalid: "CFOP_INVALID",
  csosn_or_cst_missing: "CSOSN_OR_CST_MISSING",
  pis_cst_missing: "PIS_CST_MISSING",
  cofins_cst_missing: "COFINS_CST_MISSING",
  test_profile_in_production: "TEST_PROFILE_IN_PRODUCTION",
  test_profile_in_non_production: "TEST_PROFILE_IN_NON_PRODUCTION",
  profile_origin_uf_mismatch: "PROFILE_ORIGIN_UF_MISMATCH",
  profile_destination_uf_mismatch: "PROFILE_DESTINATION_UF_MISMATCH",
  gtin_missing: "GTIN_MISSING",
  gtin_invalid: "GTIN_INVALID",
  cest_missing_required: "CEST_REQUIRED_MISSING",
  variant_override_incomplete: "VARIANT_OVERRIDE_INCOMPLETE",
  establishment_missing: "ESTABLISHMENT_MISSING",
  item_unresolved: "ITEM_UNRESOLVED"
});

async function resolveSeverity(code, severityMap = null) {
  const key = String(code || "").toUpperCase();
  if (severityMap && severityMap[key]) return severityMap[key];
  return defaultSeverityForCode(key);
}

async function loadSeverityMap() {
  try {
    return await rulesRepository.getSeverityMap();
  } catch (_error) {
    return {};
  }
}

function classifyCest({ productTax = null, resolvedCest = null } = {}) {
  if (resolvedCest || productTax?.cest) {
    return { status: CEST_STATUSES.PRESENT, code: null };
  }
  const status = productTax?.cest_status || CEST_STATUSES.REQUIRED_UNKNOWN;
  if (status === CEST_STATUSES.NOT_APPLICABLE) {
    return { status, code: "CEST_NOT_APPLICABLE" };
  }
  if (status === CEST_STATUSES.REQUIRED_MISSING || productTax?.cest_required) {
    return { status: CEST_STATUSES.REQUIRED_MISSING, code: "CEST_REQUIRED_MISSING" };
  }
  return { status: CEST_STATUSES.REQUIRED_UNKNOWN, code: "CEST_REQUIRED_UNKNOWN" };
}

async function evaluateEstablishment(establishmentOrId, { storeId = "", severityMap = null } = {}) {
  const map = severityMap || await loadSeverityMap();
  let establishment = establishmentOrId;
  if (typeof establishmentOrId === "number" || typeof establishmentOrId === "string") {
    establishment = await establishmentRepository.findById(establishmentOrId);
  }
  const findings = [];
  const checks = [];
  const entityRef = establishment?.id ? `establishment:${establishment.id}` : "establishment:missing";

  if (!establishment) {
    findings.push(createFinding({
      code: "ESTABLISHMENT_MISSING",
      severity: await resolveSeverity("ESTABLISHMENT_MISSING", map),
      message: "Estabelecimento fiscal ausente"
    }));
    return buildReadinessResult({
      entityType: "establishment",
      entityRef,
      checks,
      findings,
      extras: {
        readiness_layers: {
          cadastral: FISCAL_READINESS_STATUSES.BLOCKED,
          tax: FISCAL_READINESS_STATUSES.NOT_APPLICABLE,
          emission_future: FISCAL_READINESS_STATUSES.NOT_APPLICABLE
        }
      }
    });
  }

  checks.push("establishment_loaded");
  if (establishment.active === false) {
    findings.push(createFinding({
      code: "ESTABLISHMENT_INACTIVE",
      severity: await resolveSeverity("ESTABLISHMENT_INACTIVE", map),
      message: "Estabelecimento inativo"
    }));
  }
  if (!establishment.cnpj || !isValidCnpj(establishment.cnpj)) {
    findings.push(createFinding({
      code: "EMITTER_CNPJ_MISSING",
      severity: await resolveSeverity("EMITTER_CNPJ_MISSING", map),
      message: "CNPJ invalido ou ausente",
      field: "cnpj"
    }));
  } else checks.push("cnpj_valid");
  if (!normalizeText(establishment.legal_name || "")) {
    findings.push(createFinding({
      code: "EMITTER_LEGAL_NAME_MISSING",
      severity: await resolveSeverity("EMITTER_LEGAL_NAME_MISSING", map),
      message: "Razao social ausente",
      field: "legal_name"
    }));
  } else checks.push("legal_name_present");
  if (!establishment.uf || !isValidUf(establishment.uf)) {
    findings.push(createFinding({
      code: "EMITTER_UF_MISSING",
      severity: await resolveSeverity("EMITTER_UF_MISSING", map),
      message: "UF ausente/invalida",
      field: "uf"
    }));
  } else checks.push("uf_valid");
  if (!normalizeText(establishment.ie || "")) {
    findings.push(createFinding({
      code: "EMITTER_IE_MISSING",
      severity: await resolveSeverity("EMITTER_IE_MISSING", map),
      message: "IE ausente (pode ser exigida conforme regime)",
      field: "ie"
    }));
  } else checks.push("ie_present");
  if (!normalizeText(establishment.crt || "") && !normalizeText(establishment.tax_regime || "")) {
    findings.push(createFinding({
      code: "EMITTER_CRT_MISSING",
      severity: await resolveSeverity("EMITTER_CRT_MISSING", map),
      message: "CRT/regime tributario ausente",
      field: "crt"
    }));
  } else checks.push("crt_or_regime_present");
  if (!normalizeText(establishment.city || "")) {
    findings.push(createFinding({
      code: "EMITTER_CITY_MISSING",
      severity: await resolveSeverity("EMITTER_CITY_MISSING", map),
      message: "Municipio ausente",
      field: "city"
    }));
  } else checks.push("city_present");
  if (!normalizeDigits(establishment.city_ibge_code || "") || normalizeDigits(establishment.city_ibge_code || "").length !== 7) {
    findings.push(createFinding({
      code: "EMITTER_IBGE_MISSING",
      severity: await resolveSeverity("EMITTER_IBGE_MISSING", map),
      message: "Codigo IBGE ausente ou incompleto",
      field: "city_ibge_code"
    }));
  } else checks.push("ibge_present");
  if (!normalizeText(establishment.street || "")) {
    findings.push(createFinding({
      code: "EMITTER_ADDRESS_MISSING",
      severity: await resolveSeverity("EMITTER_ADDRESS_MISSING", map),
      message: "Endereco incompleto",
      field: "street"
    }));
  } else checks.push("address_present");

  // Marcadores — apenas informativos no Stage 3 (nao bloqueiam catalogo)
  if (!establishment.certificate_configured) {
    findings.push(createFinding({
      code: "CERTIFICATE_MARKER_UNSET",
      severity: FISCAL_READINESS_SEVERITIES.INFORMATIONAL,
      message: "Marcador de certificado nao setado — nao prova configuracao operacional"
    }));
  }
  if (!establishment.csc_configured) {
    findings.push(createFinding({
      code: "CSC_MARKER_UNSET",
      severity: FISCAL_READINESS_SEVERITIES.INFORMATIONAL,
      message: "Marcador de CSC nao setado — nao prova configuracao operacional"
    }));
  }
  if (!establishment.provider_configured) {
    findings.push(createFinding({
      code: "PROVIDER_MARKER_UNSET",
      severity: FISCAL_READINESS_SEVERITIES.INFORMATIONAL,
      message: "Marcador de provedor nao setado — nao prova configuracao operacional"
    }));
  }

  if (storeId) {
    const linked = await establishmentRepository.findActiveByStoreId(normalizeStoreKey(storeId), {
      environment: establishment.environment || getFiscalDefaultEnvironment()
    });
    if (!linked || linked.id !== establishment.id) {
      findings.push(createFinding({
        code: "STORE_WITHOUT_ACTIVE_ESTABLISHMENT",
        severity: await resolveSeverity("STORE_WITHOUT_ACTIVE_ESTABLISHMENT", map),
        message: `Loja '${storeId}' sem vinculo ativo com este estabelecimento`,
        meta: { store_id: storeId }
      }));
    } else checks.push("store_link_active");
  }

  const cadastralFindings = findings.filter((f) => ![
    "CERTIFICATE_MARKER_UNSET", "CSC_MARKER_UNSET", "PROVIDER_MARKER_UNSET"
  ].includes(f.code));

  return buildReadinessResult({
    entityType: "establishment",
    entityRef,
    checks,
    findings,
    extras: {
      establishment_id: establishment.id,
      environment: establishment.environment || null,
      readiness_layers: {
        cadastral: deriveStatusFromFindings(cadastralFindings),
        tax: FISCAL_READINESS_STATUSES.NOT_APPLICABLE,
        emission_future: FISCAL_READINESS_STATUSES.NOT_APPLICABLE
      },
      configuration_markers_are_not_operational_proof: true
    }
  });
}

async function evaluateSaleItem(input = {}, { severityMap = null } = {}) {
  const map = severityMap || await loadSeverityMap();
  const resolved = await resolveForSaleItem(input);
  const findings = [];
  const checks = [];
  const itemRef = resolved.product_ref || "item:unknown";

  for (const gap of resolved.gaps || []) {
    const code = RESOLVER_GAP_TO_CODE[gap] || String(gap || "").toUpperCase();
    if (!code) continue;
    // CEST tratado explicitamente abaixo
    if (gap === "cest_missing_required") continue;
    findings.push(createFinding({
      code,
      severity: await resolveSeverity(code, map),
      message: `Gap resolvido: ${gap}`,
      itemRef,
      meta: { resolver_gap: gap }
    }));
  }
  for (const warning of resolved.warnings || []) {
    if (warning === "csosn_and_cst_both_set") {
      findings.push(createFinding({
        code: "CSOSN_AND_CST_BOTH_SET",
        severity: await resolveSeverity("CSOSN_AND_CST_BOTH_SET", map),
        message: "CSOSN e CST ICMS coexistindo",
        itemRef
      }));
    }
  }

  let productTax = null;
  if (resolved.variant_id) {
    productTax = await productTaxRepository.findByVariantId(resolved.variant_id);
  }
  if (!productTax && resolved.product_id) {
    productTax = await productTaxRepository.findByProductId(resolved.product_id);
  }
  const cestInfo = classifyCest({ productTax, resolvedCest: resolved.product?.cest });
  checks.push(`cest_status:${cestInfo.status}`);
  if (cestInfo.code) {
    findings.push(createFinding({
      code: cestInfo.code,
      severity: await resolveSeverity(cestInfo.code, map),
      message: `Classificacao CEST: ${cestInfo.status}`,
      itemRef,
      field: "cest",
      meta: {
        cest_status: cestInfo.status,
        justification: productTax?.cest_na_justification || null
      }
    }));
  } else {
    checks.push("cest_present");
  }

  if (resolved.product?.ncm) checks.push("ncm_present");
  if (resolved.tax?.cfop) checks.push("cfop_present");
  if (resolved.profile_id) checks.push("profile_linked");

  return buildReadinessResult({
    entityType: resolved.variant_id ? "variant" : "product",
    entityRef: itemRef,
    checks,
    findings,
    extras: {
      resolution: resolved,
      cest_status: cestInfo.status,
      stock_ignored: true
    }
  });
}

function evaluateCustomer(customer = null, { severityMap = null, identifiedRequired = false } = {}) {
  const findings = [];
  const checks = [];
  if (!customer || typeof customer !== "object") {
    checks.push("consumer_unidentified_allowed_for_nfce");
    return buildReadinessResult({
      status: FISCAL_READINESS_STATUSES.READY,
      entityType: "customer",
      entityRef: "customer:unidentified",
      checks,
      findings: [],
      extras: { nfce_mode: "unidentified", nfe_mode: "not_applicable_stage3" }
    });
  }

  const document = normalizeDigits(customer.document || customer.cpf || customer.cnpj || "");
  const name = normalizeText(customer.name || customer.nome || "");
  const entityRef = document ? `customer:${document}` : `customer:${customer.id || "unknown"}`;

  if (!document) {
    checks.push("consumer_unidentified_allowed_for_nfce");
    return buildReadinessResult({
      status: identifiedRequired ? FISCAL_READINESS_STATUSES.BLOCKED : FISCAL_READINESS_STATUSES.READY,
      entityType: "customer",
      entityRef,
      checks,
      findings: identifiedRequired
        ? [createFinding({
          code: "CUSTOMER_DOCUMENT_INVALID",
          severity: FISCAL_READINESS_SEVERITIES.BLOCKING,
          message: "Documento obrigatorio para NFC-e identificada"
        })]
        : [],
      extras: { nfce_mode: "unidentified", nfe_mode: "not_applicable_stage3" }
    });
  }

  const isCpf = document.length === 11;
  const isCnpj = document.length === 14;
  if (!isCpf && !isCnpj) {
    findings.push(createFinding({
      code: "CUSTOMER_DOCUMENT_INVALID",
      severity: FISCAL_READINESS_SEVERITIES.BLOCKING,
      message: "Documento do cliente invalido",
      field: "document"
    }));
  } else {
    checks.push(isCpf ? "cpf_present" : "cnpj_present");
  }
  if (!name) {
    findings.push(createFinding({
      code: "CUSTOMER_NAME_MISSING_IDENTIFIED",
      severity: (severityMap && severityMap.CUSTOMER_NAME_MISSING_IDENTIFIED)
        || FISCAL_READINESS_SEVERITIES.WARNING,
      message: "Nome ausente em venda com documento",
      field: "name"
    }));
  } else checks.push("name_present");

  return buildReadinessResult({
    entityType: "customer",
    entityRef,
    checks,
    findings,
    extras: {
      nfce_mode: "identified",
      nfe_mode: "not_applicable_stage3",
      email: normalizeText(customer.email || "") || null
    }
  });
}

async function evaluatePayments(payments = [], { severityMap = null } = {}) {
  const map = severityMap || await loadSeverityMap();
  const list = Array.isArray(payments) ? payments : [];
  const findings = [];
  const checks = [];
  const details = [];

  if (!list.length) {
    findings.push(createFinding({
      code: "PAYMENT_MAPPING_PENDING",
      severity: await resolveSeverity("PAYMENT_MAPPING_PENDING", map),
      message: "Venda sem meios de pagamento"
    }));
  }

  for (const payment of list) {
    const method = normalizePaymentMethod(payment.method || payment.payment_method || "");
    const mapping = method
      ? await paymentMappingRepository.findByMethod(method)
      : null;
    const amount = Number(payment.amount ?? payment.valor ?? 0) || 0;
    const detail = {
      method: method || null,
      amount,
      mapping_status: mapping?.mapping_status || PAYMENT_MAPPING_STATUSES.PENDING_ACCOUNTING,
      nfce_tpag: mapping?.nfce_tpag ?? null
    };
    details.push(detail);

    if (!mapping || mapping.mapping_status === PAYMENT_MAPPING_STATUSES.PENDING_ACCOUNTING) {
      findings.push(createFinding({
        code: "PAYMENT_MAPPING_PENDING",
        severity: await resolveSeverity("PAYMENT_MAPPING_PENDING", map),
        message: `Pagamento '${method || "desconhecido"}' sem mapeamento confirmado pela contabilidae`,
        itemRef: method ? `payment:${method}` : "payment:unknown",
        meta: { amount }
      }));
    } else if (mapping.mapping_status === PAYMENT_MAPPING_STATUSES.AMBIGUOUS) {
      findings.push(createFinding({
        code: "PAYMENT_MAPPING_AMBIGUOUS",
        severity: await resolveSeverity("PAYMENT_MAPPING_AMBIGUOUS", map),
        message: `Pagamento '${method}' com natureza ambigua — nao mapear automaticamente`,
        itemRef: `payment:${method}`,
        meta: { amount }
      }));
    } else if (mapping.mapping_status === PAYMENT_MAPPING_STATUSES.BLOCKED_FOR_EMIT) {
      findings.push(createFinding({
        code: "PAYMENT_MAPPING_BLOCKED",
        severity: await resolveSeverity("PAYMENT_MAPPING_BLOCKED", map),
        message: `Pagamento '${method}' bloqueado para emissao futura`,
        itemRef: `payment:${method}`,
        meta: { amount }
      }));
    } else if (mapping.mapping_status === PAYMENT_MAPPING_STATUSES.CONFIRMED) {
      if (!mapping.nfce_tpag || !/^\d{2}$/.test(String(mapping.nfce_tpag))) {
        findings.push(createFinding({
          code: "PAYMENT_MAPPING_PENDING",
          severity: await resolveSeverity("PAYMENT_MAPPING_PENDING", map),
          message: `Pagamento '${method}' marcado confirmed sem nfce_tpag valido`,
          itemRef: `payment:${method}`,
          meta: { amount }
        }));
      } else {
        checks.push(`payment_confirmed:${method}`);
      }
    }
  }

  return buildReadinessResult({
    entityType: "payments",
    entityRef: "payments:sale",
    checks,
    findings,
    extras: { payments: details }
  });
}

function evaluateSaleTotals(sale = {}) {
  const findings = [];
  const checks = [];
  const totalFinal = Number(sale.total_final ?? sale.total ?? 0) || 0;
  const payments = Array.isArray(sale.pagamentos)
    ? sale.pagamentos
    : (Array.isArray(sale.payments) ? sale.payments : []);
  const paid = payments.reduce((acc, item) => acc + (Number(item.amount ?? item.valor ?? 0) || 0), 0);
  const cashback = Number(sale.cashback_usado ?? sale.cashback_used ?? 0) || 0;
  const exchangeCredit = Number(sale.credito_troca_usado ?? sale.exchange_credit_used ?? 0) || 0;
  const gift = Number(sale.vale_presente_usado ?? sale.gift_card_used ?? 0) || 0;

  checks.push("totals_inspected");
  // Tolerância mínima — inconsistência forte bloqueia
  if (Math.abs(paid - totalFinal) > 0.05 && payments.length) {
    findings.push(createFinding({
      code: "SALE_TOTALS_MISMATCH",
      severity: FISCAL_READINESS_SEVERITIES.BLOCKING,
      message: `Total da venda (${totalFinal}) diverge da soma dos pagamentos (${paid})`,
      meta: { total_final: totalFinal, payments_sum: paid, cashback, exchange_credit: exchangeCredit, gift }
    }));
  } else {
    checks.push("totals_consistent");
  }

  return buildReadinessResult({
    entityType: "sale_totals",
    entityRef: sale.sale_id ? `sale:${sale.sale_id}:totals` : "sale:totals",
    checks,
    findings,
    extras: { total_final: totalFinal, payments_sum: paid, cashback_used: cashback, exchange_credit_used: exchangeCredit, gift_card_used: gift }
  });
}

/**
 * Avalia prontidão de uma venda completa.
 * NÃO cria fiscal_document. NÃO altera status fiscal. NÃO enfileira transmissão.
 */
async function evaluateSale(saleId, options = {}) {
  const severityMap = await loadSeverityMap();
  const getSaleById = options.getSaleById || (() => {
    const { getSaleById: loader } = require("../../pdv/sales/pdvSalesService");
    return loader;
  })();
  const sale = options.sale || getSaleById(saleId);
  if (!sale || !sale.sale_id) {
    return buildReadinessResult({
      status: FISCAL_READINESS_STATUSES.BLOCKED,
      entityType: "sale",
      entityRef: `sale:${saleId || "missing"}`,
      findings: [createFinding({
        code: "ITEM_UNRESOLVED",
        severity: FISCAL_READINESS_SEVERITIES.BLOCKING,
        message: "Venda nao encontrada para avaliacao de prontidao"
      })]
    });
  }

  const storeId = normalizeStoreKey(sale.loja || sale.loja_venda || sale.store_id || "");
  const environment = options.environment || getFiscalDefaultEnvironment();
  const establishment = await establishmentRepository.findActiveByStoreId(storeId, { environment });

  const establishmentResult = await evaluateEstablishment(establishment, { storeId, severityMap });
  const customerResult = evaluateCustomer(sale.customer || null, { severityMap });
  const paymentsResult = await evaluatePayments(
    Array.isArray(sale.pagamentos) ? sale.pagamentos : sale.payments,
    { severityMap }
  );
  const totalsResult = evaluateSaleTotals(sale);

  const items = Array.isArray(sale.items) ? sale.items : [];
  const itemResults = [];
  for (const item of items) {
    itemResults.push(await evaluateSaleItem({
      establishment,
      storeId,
      productId: item.normalized_product_id || null,
      variantId: item.variation_id || item.variant_id || "",
      legacyAiProductId: item.product_id || item.selected_product_id || null,
      sku: item.sku || item.codigo || "",
      saleItem: item,
      operationType: "sale_internal",
      originUf: establishment?.uf || "",
      destinationUf: establishment?.uf || "",
      environment
    }, { severityMap }));
  }

  const allFindings = [
    ...(establishmentResult.findings || []),
    ...(customerResult.findings || []),
    ...(paymentsResult.findings || []),
    ...(totalsResult.findings || []),
    ...itemResults.flatMap((item) => item.findings || [])
  ];

  const result = buildReadinessResult({
    entityType: "sale",
    entityRef: `sale:${sale.sale_id}`,
    checks: [
      ...(establishmentResult.checks || []),
      ...(customerResult.checks || []),
      ...(paymentsResult.checks || []),
      ...(totalsResult.checks || []),
      `items_evaluated:${itemResults.length}`
    ],
    findings: allFindings,
    extras: {
      store_id: storeId || null,
      environment,
      establishment: establishmentResult,
      customer: customerResult,
      payments: paymentsResult,
      totals: totalsResult,
      items: itemResults,
      documents_created: false,
      transmission: "disabled",
      existing_fiscal_document_ids: []
    }
  });

  // Verifica se já existe documento — apenas reporta, não altera
  try {
    const existingDocs = await documentRepository.listBySaleId(sale.sale_id);
    result.extras.existing_fiscal_document_ids = (existingDocs || []).map((doc) => doc.id);
  } catch (_error) {
    result.extras.existing_fiscal_document_ids = [];
  }

  if (options.audit !== false) {
    await recordFiscalAudit({
      action: "FISCAL_READINESS_EVALUATED",
      saleId: sale.sale_id,
      storeId,
      user: options.user || {},
      message: `Prontidao ${result.status}`,
      metadata: {
        status: result.status,
        blocking_count: result.blocking_errors.length,
        warning_count: result.warnings.length,
        evaluator_version: result.evaluator_version
      }
    }).catch(() => null);
  }

  return result;
}

module.exports = {
  evaluateEstablishment,
  evaluateSaleItem,
  evaluateCustomer,
  evaluatePayments,
  evaluateSaleTotals,
  evaluateSale,
  classifyCest
};
