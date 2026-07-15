"use strict";

/**
 * Stage 3 — prontidão fiscal, cobertura, pagamentos e saneamento.
 * Sem SEFAZ/provedor/certificado/CSC/emissão.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const express = require("express");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aerostore-fiscal-stage3-"));
process.env.DATABASE_PATH = path.join(tempRoot, "test.sqlite");
process.env.FISCAL_MODULE_ENABLED = "false";
process.env.FISCAL_DEFAULT_ENVIRONMENT = "homologacao";
process.env.NODE_ENV = "test";

const crypto = require("crypto");
const { initializeDatabase, run, get, all } = require("../db");
const {
  FiscalEstablishmentRepository,
  FiscalTaxProfileRepository,
  FiscalProductTaxRepository,
  FiscalDocumentRepository,
  FiscalPaymentMappingRepository,
  FiscalReadinessRulesRepository,
  evaluateSale,
  evaluateSaleItem,
  evaluateEstablishment,
  evaluateCustomer,
  evaluatePayments,
  buildFiscalCoverageReport,
  previewBatchProfileApply,
  applyBatchProfile,
  importProductTaxCsv,
  exportPendingCsv,
  createFromCompletedSale,
  FISCAL_READINESS_STATUSES,
  DEFAULT_READINESS_RULES,
  fiscalRouter
} = require("../modules/fiscal");

const establishmentRepository = new FiscalEstablishmentRepository();
const profileRepository = new FiscalTaxProfileRepository();
const productTaxRepository = new FiscalProductTaxRepository();
const documentRepository = new FiscalDocumentRepository();
const paymentMappingRepository = new FiscalPaymentMappingRepository();
const readinessRulesRepository = new FiscalReadinessRulesRepository();

async function snapshotDomainCounts() {
  const tables = [
    "fiscal_documents",
    "fiscal_document_events",
    "fiscal_product_tax",
    "fiscal_tax_profiles",
    "fiscal_establishments",
    "fiscal_payment_mapping",
    "fiscal_readiness_rules"
  ];
  const counts = {};
  const hashes = {};
  for (const table of tables) {
    const row = await get(`SELECT COUNT(*) AS c FROM ${table}`);
    counts[table] = Number(row?.c || 0);
    const rows = await all(`SELECT * FROM ${table} ORDER BY 1`);
    hashes[table] = crypto
      .createHash("sha256")
      .update(JSON.stringify(rows))
      .digest("hex")
      .slice(0, 16);
  }
  return { counts, hashes };
}

function buildSale(overrides = {}) {
  return {
    sale_id: overrides.sale_id || "SAL_S3_001",
    status: "COMPLETED",
    loja: overrides.loja || "vila",
    customer: overrides.customer === undefined
      ? { id: 1, name: "Cliente", document: "52998224725" }
      : overrides.customer,
    items: overrides.items || [{
      item_id: "I1",
      product_id: 1,
      normalized_product_id: 200,
      sku: "SKU-S3",
      nome: "Camiseta",
      quantidade: 1,
      preco_unitario: 100,
      total: 100,
      ncm: "61091000",
      unidade: "UN",
      origem_fiscal: "0",
      gtin_ean: "7891234567890"
    }],
    subtotal: 100,
    total_final: 100,
    paid_amount: 100,
    pagamentos: overrides.pagamentos || [{ method: "pix", amount: 100 }],
    cashback_usado: overrides.cashback_usado || 0,
    credito_troca_usado: overrides.credito_troca_usado || 0,
    ...overrides
  };
}

async function main() {
  await initializeDatabase();

  const incompleteEst = await establishmentRepository.create({
    code: "INC",
    legal_name: "Incompleto",
    cnpj: "11222333000181",
    uf: "SP",
    environment: "homologacao",
    active: true
  });
  const incompleteEval = await evaluateEstablishment(incompleteEst);
  assert.ok(["WARNING", "BLOCKED"].includes(incompleteEval.status));
  assert.ok(incompleteEval.informational.some((f) => f.code === "CERTIFICATE_MARKER_UNSET"));

  const completeEst = await establishmentRepository.create({
    code: "OK",
    legal_name: "AERO S3 LTDA",
    trade_name: "AERO S3",
    cnpj: "04252011000110",
    ie: "123456",
    crt: "1",
    tax_regime: "simples_nacional",
    uf: "SP",
    city: "Ribeirao Preto",
    city_ibge_code: "3543402",
    street: "Rua A",
    number: "10",
    environment: "homologacao",
    active: true
  });
  await establishmentRepository.linkStore(completeEst.id, "vila", { active: true });
  const completeEval = await evaluateEstablishment(completeEst, { storeId: "vila" });
  assert.ok([FISCAL_READINESS_STATUSES.READY, FISCAL_READINESS_STATUSES.WARNING].includes(completeEval.status));
  assert.strictEqual(completeEval.blocking_errors.length, 0);

  const profileIncomplete = await profileRepository.create({
    code: "INCOMPLETE_TEST",
    name: "Incompleto",
    operation_type: "sale_internal",
    is_test_profile: true
  });
  const profileReady = await profileRepository.create({
    code: "READY_TEST",
    name: "Pronto teste",
    operation_type: "sale_internal",
    is_test_profile: true,
    cfop: "5102",
    csosn: "102",
    pis_cst: "01",
    cofins_cst: "01"
  });

  // produto sem NCM
  await productTaxRepository.upsert({
    product_id: 201,
    origin: "0",
    unit: "UN",
    profile_id: profileReady.id
  }, { name: "qa" });
  const noNcm = await evaluateSaleItem({
    establishment: completeEst,
    productId: 201,
    operationType: "sale_internal",
    environment: "homologacao"
  });
  assert.ok(noNcm.blocking_errors.some((f) => f.code === "NCM_MISSING"));

  // produto completo
  await productTaxRepository.upsert({
    product_id: 200,
    ncm: "61091000",
    origin: "0",
    unit: "UN",
    gtin_ean: "7891234567890",
    profile_id: profileReady.id,
    cest_status: "cest_not_applicable",
    cest_na_justification: "moda sem CEST aplicavel conforme QA"
  }, { name: "qa" });
  const fullItem = await evaluateSaleItem({
    establishment: completeEst,
    productId: 200,
    operationType: "sale_internal",
    environment: "homologacao",
    originUf: "SP",
    destinationUf: "SP"
  });
  assert.strictEqual(fullItem.extras.cest_status, "cest_not_applicable");
  assert.ok(!fullItem.blocking_errors.some((f) => f.code === "NCM_MISSING"));

  // CEST desconhecido
  await productTaxRepository.upsert({
    product_id: 202,
    ncm: "64039990",
    origin: "0",
    unit: "UN",
    profile_id: profileReady.id,
    cest_status: "cest_required_unknown"
  }, { name: "qa" });
  const cestUnknown = await evaluateSaleItem({
    establishment: completeEst,
    productId: 202,
    operationType: "sale_internal",
    environment: "homologacao"
  });
  assert.ok(cestUnknown.warnings.some((f) => f.code === "CEST_REQUIRED_UNKNOWN")
    || cestUnknown.findings.some((f) => f.code === "CEST_REQUIRED_UNKNOWN"));

  // perfil de teste em producao
  const testInProd = await evaluateSaleItem({
    establishment: { ...completeEst, environment: "producao" },
    productId: 200,
    operationType: "sale_internal",
    environment: "producao"
  });
  assert.ok(testInProd.blocking_errors.some((f) => f.code === "TEST_PROFILE_IN_PRODUCTION"));

  // heranca / override
  await productTaxRepository.upsert({
    product_id: 200,
    variant_id: "VAR_S3_RED",
    ncm: "61099000",
    origin: "0",
    unit: "UN",
    profile_id: profileIncomplete.id,
    inherit_from_parent: false,
    cest_status: "cest_not_applicable",
    cest_na_justification: "teste"
  }, { name: "qa" });
  const variant = await evaluateSaleItem({
    establishment: completeEst,
    productId: 200,
    variantId: "VAR_S3_RED",
    operationType: "sale_internal",
    environment: "homologacao"
  });
  assert.ok(variant.blocking_errors.some((f) => f.code === "CFOP_MISSING"));

  // cliente
  const unidentified = evaluateCustomer(null);
  assert.strictEqual(unidentified.status, FISCAL_READINESS_STATUSES.READY);
  const badDoc = evaluateCustomer({ name: "X", document: "123" });
  assert.ok(badDoc.blocking_errors.some((f) => f.code === "CUSTOMER_DOCUMENT_INVALID"));

  // pagamentos
  const payPending = await evaluatePayments([{ method: "pix", amount: 100 }]);
  assert.ok(payPending.blocking_errors.some((f) => f.code === "PAYMENT_MAPPING_PENDING"));
  const payAmbiguous = await evaluatePayments([{ method: "cashback", amount: 10 }]);
  assert.ok(payAmbiguous.blocking_errors.some((f) => f.code === "PAYMENT_MAPPING_AMBIGUOUS"));

  // confirmed sem tPag deve ser recusado no repositorio
  let confirmedWithoutTpagRejected = false;
  try {
    await paymentMappingRepository.update("pix", {
      mapping_status: "confirmed",
      nfce_tpag: null,
      notes: "deve falhar"
    }, { name: "qa" });
  } catch (error) {
    confirmedWithoutTpagRejected = error.code === "FISCAL_PAYMENT_TPAG_REQUIRED";
  }
  assert.strictEqual(confirmedWithoutTpagRejected, true);

  // default permanece null — sem fallback 99/05
  const pixBefore = await paymentMappingRepository.findByMethod("pix");
  assert.strictEqual(pixBefore.nfce_tpag, null);
  assert.strictEqual(pixBefore.mapping_status, "pending_accounting");

  await paymentMappingRepository.update("pix", {
    mapping_status: "confirmed",
    nfce_tpag: "17",
    notes: "tPag de teste stage3 — confirmacao contabil simulada (nao e emissao)"
  }, { name: "qa" });
  const payConfirmed = await evaluatePayments([{ method: "pix", amount: 100 }]);
  assert.strictEqual(payConfirmed.blocking_errors.length, 0);
  assert.strictEqual(payConfirmed.extras.payments[0].nfce_tpag, "17");

  // metodos ambiguos / pendentes explicitos
  for (const method of ["cashback", "credito_troca", "vale_presente", "permuta", "desconto_folha"]) {
    const ev = await evaluatePayments([{ method, amount: 10 }]);
    assert.ok(
      ev.blocking_errors.some((f) => f.code === "PAYMENT_MAPPING_AMBIGUOUS" || f.code === "PAYMENT_MAPPING_PENDING"),
      `${method} deve bloquear prontidao ate decisao contabil`
    );
  }
  const linkPay = await evaluatePayments([{ method: "link_pagamento", amount: 10 }]);
  assert.ok(linkPay.blocking_errors.some((f) => f.code === "PAYMENT_MAPPING_PENDING"));

  // venda BLOCKED (pagamentos ainda podem bloquear se multiplos)
  const blockedSale = await evaluateSale("SAL_S3_BLOCK", {
    sale: buildSale({
      sale_id: "SAL_S3_BLOCK",
      pagamentos: [{ method: "cashback", amount: 100 }],
      items: [{
        item_id: "I1",
        normalized_product_id: 201,
        sku: "X",
        nome: "Sem NCM",
        quantidade: 1,
        preco_unitario: 100,
        total: 100,
        origem_fiscal: "0",
        unidade: "UN"
      }]
    }),
    audit: false
  });
  assert.strictEqual(blockedSale.status, FISCAL_READINESS_STATUSES.BLOCKED);
  assert.ok(blockedSale.blocking_errors.length >= 1);
  assert.strictEqual(blockedSale.extras.documents_created, false);
  assert.strictEqual(blockedSale.tax_correctness, "unverified");
  assert.strictEqual(blockedSale.extras.transmission, "disabled");

  // prova somente-leitura: evaluateSale nao muta dominio fiscal
  const beforeEval = await snapshotDomainCounts();
  const readyish = await evaluateSale("SAL_S3_READY", {
    sale: buildSale({ sale_id: "SAL_S3_READY" }),
    audit: false
  });
  const afterEval = await snapshotDomainCounts();
  assert.deepStrictEqual(afterEval.counts, beforeEval.counts);
  assert.deepStrictEqual(afterEval.hashes, beforeEval.hashes);
  assert.ok([FISCAL_READINESS_STATUSES.READY, FISCAL_READINESS_STATUSES.WARNING].includes(readyish.status));
  if (readyish.status === FISCAL_READINESS_STATUSES.WARNING) {
    assert.ok(readyish.warnings.length >= 1, "WARNING nunca vira READY silencioso");
    assert.strictEqual(readyish.blocking_errors.length, 0);
  }
  assert.ok(!readyish.blocking_errors.some((f) => f.code === "NCM_MISSING"));
  assert.strictEqual(readyish.tax_correctness, "unverified");
  assert.strictEqual(readyish.extras.documents_created, false);

  // multiplos pagamentos + credito troca
  const multi = await evaluateSale("SAL_S3_MULTI", {
    sale: buildSale({
      sale_id: "SAL_S3_MULTI",
      pagamentos: [
        { method: "pix", amount: 70 },
        { method: "credito_troca", amount: 20 },
        { method: "vale_presente", amount: 10 }
      ]
    }),
    audit: false
  });
  assert.strictEqual(multi.status, FISCAL_READINESS_STATUSES.BLOCKED);
  assert.ok(multi.blocking_errors.some((f) => f.code === "PAYMENT_MAPPING_AMBIGUOUS"));

  // idempotencia avaliacao
  const again = await evaluateSale("SAL_S3_READY", {
    sale: buildSale({ sale_id: "SAL_S3_READY" }),
    audit: false
  });
  assert.strictEqual(again.status, readyish.status);

  // snapshot existente nao alterado + nenhum doc criado pela avaliacao
  process.env.FISCAL_MODULE_ENABLED = "true";
  const created = await createFromCompletedSale("SAL_S3_DOC", {
    sale: buildSale({ sale_id: "SAL_S3_DOC" }),
    skipFeatureFlag: true
  });
  const frozen = created.document.snapshot_json;
  await evaluateSale("SAL_S3_DOC", {
    sale: buildSale({ sale_id: "SAL_S3_DOC" }),
    audit: false
  });
  const doc = await documentRepository.findById(created.document.id);
  assert.strictEqual(doc.snapshot_json, frozen);
  process.env.FISCAL_MODULE_ENABLED = "false";
  const skipped = await createFromCompletedSale("SAL_S3_OFF", {
    sale: buildSale({ sale_id: "SAL_S3_OFF" })
  });
  assert.strictEqual(skipped.skipped, true);

  // cobertura
  const coverage = await buildFiscalCoverageReport({ store_id: "vila", limit: 50 });
  assert.ok(coverage.summary.products_total >= 1);
  assert.strictEqual(coverage.filters.category_filter_supported, false);
  const denom = Number(coverage.summary.products_ready || 0)
    + Number(coverage.summary.products_warning || 0)
    + Number(coverage.summary.products_blocked || 0);
  if (Number(coverage.summary.products_total || 0) > 0 && denom > 0) {
    assert.strictEqual(denom, Number(coverage.summary.products_total));
  }

  // CEST quatro estados
  await productTaxRepository.upsert({
    product_id: 210,
    ncm: "61091000",
    origin: "0",
    unit: "UN",
    profile_id: profileReady.id,
    cest_status: "cest_required_unknown"
  }, { name: "qa" });
  await productTaxRepository.upsert({
    product_id: 211,
    ncm: "61091000",
    origin: "0",
    unit: "UN",
    profile_id: profileReady.id,
    cest: null,
    cest_required: 1,
    cest_status: "cest_required_missing"
  }, { name: "qa" });
  await productTaxRepository.upsert({
    product_id: 212,
    ncm: "61091000",
    origin: "0",
    unit: "UN",
    profile_id: profileReady.id,
    cest: "0100100",
    cest_status: "cest_present"
  }, { name: "qa" });
  const cestStates = {};
  for (const [pid, key] of [[210, "unknown"], [211, "missing"], [212, "present"], [200, "na"]]) {
    const ev = await evaluateSaleItem({
      establishment: completeEst,
      productId: pid,
      operationType: "sale_internal",
      environment: "homologacao"
    });
    cestStates[key] = ev.extras.cest_status;
  }
  assert.strictEqual(cestStates.unknown, "cest_required_unknown");
  assert.strictEqual(cestStates.missing, "cest_required_missing");
  assert.strictEqual(cestStates.present, "cest_present");
  assert.strictEqual(cestStates.na, "cest_not_applicable");
  // CEST unknown nao bloqueia universalmente (warning/info)
  const unknownEval = await evaluateSaleItem({
    establishment: completeEst,
    productId: 210,
    operationType: "sale_internal",
    environment: "homologacao"
  });
  assert.ok(!unknownEval.blocking_errors.some((f) => f.code === "CEST_REQUIRED_UNKNOWN"));

  // GTIN: invalido recusado na gravacao; ausente gera warning conforme matriz
  let invalidGtinRejected = false;
  try {
    await productTaxRepository.upsert({
      product_id: 220,
      ncm: "61091000",
      origin: "0",
      unit: "UN",
      profile_id: profileReady.id,
      gtin_ean: "123",
      cest_status: "cest_not_applicable",
      cest_na_justification: "qa gtin"
    }, { name: "qa" });
  } catch (error) {
    invalidGtinRejected = error.code === "FISCAL_PRODUCT_TAX_INVALID";
  }
  assert.strictEqual(invalidGtinRejected, true);

  await productTaxRepository.upsert({
    product_id: 220,
    ncm: "61091000",
    origin: "0",
    unit: "UN",
    profile_id: profileReady.id,
    gtin_ean: null,
    cest_status: "cest_not_applicable",
    cest_na_justification: "qa gtin ausente"
  }, { name: "qa" });
  const missingGtin = await evaluateSaleItem({
    establishment: completeEst,
    productId: 220,
    operationType: "sale_internal",
    environment: "homologacao"
  });
  assert.ok(
    missingGtin.warnings.some((f) => f.code === "GTIN_MISSING")
    || missingGtin.findings.some((f) => f.code === "GTIN_MISSING")
  );

  await productTaxRepository.upsert({
    product_id: 222,
    ncm: "61091000",
    origin: "0",
    unit: "UN",
    profile_id: profileReady.id,
    gtin_ean: "7891234567890",
    cest_status: "cest_not_applicable",
    cest_na_justification: "qa gtin ok"
  }, { name: "qa" });
  const okGtin = await evaluateSaleItem({
    establishment: completeEst,
    productId: 222,
    operationType: "sale_internal",
    environment: "homologacao"
  });
  assert.ok(!okGtin.findings.some((f) => f.code === "GTIN_INVALID" || f.code === "GTIN_MISSING"));

  const invalidViaSale = await evaluateSaleItem({
    establishment: completeEst,
    productId: 220,
    operationType: "sale_internal",
    environment: "homologacao",
    saleItem: { gtin_ean: "12345" }
  });
  assert.ok(
    invalidViaSale.warnings.some((f) => f.code === "GTIN_INVALID")
    || invalidViaSale.findings.some((f) => f.code === "GTIN_INVALID")
  );

  let semGtinRejected = false;
  try {
    await productTaxRepository.upsert({
      product_id: 221,
      ncm: "61091000",
      origin: "0",
      unit: "UN",
      profile_id: profileReady.id,
      gtin_ean: "SEM GTIN"
    }, { name: "qa" });
  } catch (error) {
    semGtinRejected = error.code === "FISCAL_PRODUCT_TAX_INVALID";
  }
  assert.strictEqual(semGtinRejected, true);

  // regras: codigos estaveis + severidade invalida
  const rules = await readinessRulesRepository.list();
  assert.ok(rules.length >= DEFAULT_READINESS_RULES.length);
  let badSeverity = false;
  try {
    await readinessRulesRepository.updateSeverity("NCM_MISSING", "critical", { name: "qa" });
  } catch (error) {
    badSeverity = error.code === "FISCAL_READINESS_RULE_INVALID";
  }
  assert.strictEqual(badSeverity, true);
  const beforeRulesHash = (await snapshotDomainCounts()).hashes.fiscal_product_tax;
  await readinessRulesRepository.updateSeverity("GTIN_MISSING", "informational", { name: "qa" });
  const afterRulesHash = (await snapshotDomainCounts()).hashes.fiscal_product_tax;
  assert.strictEqual(afterRulesHash, beforeRulesHash, "mudanca de regra nao altera product tax");

  // lote
  const preview = await previewBatchProfileApply({
    productRefs: ["product:200", "variant:VAR_S3_RED"],
    profileCode: "READY_TEST",
    overwriteVariantOverrides: false
  });
  assert.ok(preview.planned_count >= 1);
  assert.ok(preview.skipped.some((s) => s.reason === "variant_override_protected"));

  let emptyBatch = false;
  try {
    await previewBatchProfileApply({ productRefs: [], profileCode: "READY_TEST" });
  } catch (error) {
    emptyBatch = error.code === "FISCAL_SANITATION_INVALID";
  }
  assert.strictEqual(emptyBatch, true);

  let confirmRequired = false;
  try {
    await applyBatchProfile({
      productRefs: ["product:200"],
      profileCode: "READY_TEST",
      confirm: false
    });
  } catch (error) {
    confirmRequired = error.code === "FISCAL_SANITATION_CONFIRM_REQUIRED";
  }
  assert.strictEqual(confirmRequired, true);

  const applied = await applyBatchProfile({
    productRefs: ["product:200"],
    profileCode: "READY_TEST",
    confirm: true,
    user: { name: "qa" }
  });
  assert.strictEqual(applied.applied_count, 1);

  // retry lote nao duplica efeito indevido (mesmo perfil)
  const appliedAgain = await applyBatchProfile({
    productRefs: ["product:200"],
    profileCode: "READY_TEST",
    confirm: true,
    user: { name: "qa" }
  });
  assert.strictEqual(appliedAgain.applied_count, 1);
  const tax200 = await productTaxRepository.findByProductId(200);
  assert.strictEqual(tax200.profile_id, profileReady.id);

  // overwrite explicito de variacao
  const overwrite = await applyBatchProfile({
    productRefs: ["variant:VAR_S3_RED"],
    profileCode: "READY_TEST",
    overwriteVariantOverrides: true,
    confirm: true,
    user: { name: "qa" }
  });
  assert.strictEqual(overwrite.applied_count, 1);

  // import dry-run
  const dry = await importProductTaxCsv({
    csvText: "product_ref,ncm,origem,unidade,profile_code\nproduct:203,61091000,0,UN,READY_TEST\n",
    dryRun: true
  });
  assert.strictEqual(dry.planned_count, 1);
  assert.strictEqual(dry.applied, false);
  assert.strictEqual(dry.planned[0].origin, "0");
  assert.strictEqual(dry.planned[0].unit, "UN");
  const afterDry = await productTaxRepository.findByProductRef("product:203");
  assert.ok(!afterDry);

  const csvEscape = exportPendingCsv([{
    product_ref: 'product:1',
    label: 'sku,"com aspas"',
    name: "linha\nquebrada",
    status: "WARNING",
    blocking_errors: [{ code: "NCM_MISSING" }],
    warnings: []
  }]);
  assert.ok(csvEscape.includes('"sku,""com aspas"""') || csvEscape.includes('""'));
  assert.ok(Buffer.from(csvEscape, "utf8").toString("utf8") === csvEscape);

  const badCsv = await importProductTaxCsv({
    csvText: [
      "product_ref,ncm,origem,unidade,profile_code,gtin",
      "product:301,ABC,9,UN,READY_TEST,SEM GTIN",
      "product:301,61091000,0,UN,READY_TEST,",
      "product:302,61091000,0,UN,PERFIL_INEXISTENTE,"
    ].join("\n"),
    dryRun: true
  });
  assert.ok(badCsv.error_count >= 2);

  let oversized = false;
  try {
    const huge = ["product_ref,ncm"].concat(
      Array.from({ length: 501 }, (_, i) => `product:${1000 + i},61091000`)
    ).join("\n");
    await importProductTaxCsv({ csvText: huge, dryRun: true });
  } catch (error) {
    oversized = error.code === "FISCAL_IMPORT_TOO_LARGE";
  }
  assert.strictEqual(oversized, true);

  const appliedImport = await importProductTaxCsv({
    csvText: "product_ref,ncm,origem,unidade,profile_code\nproduct:203,61091000,0,UN,READY_TEST\n",
    dryRun: false,
    confirm: true,
    user: { name: "qa" }
  });
  assert.strictEqual(appliedImport.applied_count, 1);
  assert.ok(await productTaxRepository.findByProductRef("product:203"));

  let applyWithErrorsRejected = false;
  try {
    await importProductTaxCsv({
      csvText: "product_ref,ncm,origem,unidade,profile_code\nproduct:204,999,0,UN,READY_TEST\n",
      dryRun: false,
      confirm: true,
      user: { name: "qa" }
    });
  } catch (error) {
    applyWithErrorsRejected = ["FISCAL_IMPORT_HAS_ERRORS", "FISCAL_IMPORT_APPLY_ERRORS", "FISCAL_PRODUCT_TAX_INVALID"].includes(error.code)
      || error.code === "FISCAL_IMPORT_HAS_ERRORS";
  }
  // dry-run path: invalid ncm should appear as error_count; apply with errors throws
  const invalidNcmDry = await importProductTaxCsv({
    csvText: "product_ref,ncm,origem,unidade,profile_code\nproduct:205,99,0,UN,READY_TEST\n",
    dryRun: true
  });
  assert.ok(invalidNcmDry.error_count >= 1);
  try {
    await importProductTaxCsv({
      csvText: "product_ref,ncm,origem,unidade,profile_code\nproduct:205,99,0,UN,READY_TEST\n",
      dryRun: false,
      confirm: true,
      user: { name: "qa" }
    });
  } catch (error) {
    applyWithErrorsRejected = error.code === "FISCAL_IMPORT_HAS_ERRORS";
  }
  assert.strictEqual(applyWithErrorsRejected, true);

  // HTTP permissions — gestor nao aplica lote
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = String(req.headers["x-test-role"] || "seller");
    const users = {
      admin: { role: "admin", permissions: { can_view_fiscal: true, can_manage_fiscal: true } },
      manager: { role: "manager", permissions: { can_view_fiscal: true, can_manage_fiscal: false, can_manage_store_settings: true } },
      seller: { role: "seller", permissions: { can_view_fiscal: false } }
    };
    req.user = users[role] || users.seller;
    next();
  });
  app.use("/api/fiscal", fiscalRouter);

  function call(role, method, urlPath, body) {
    return new Promise((resolve, reject) => {
      const server = app.listen(0, "127.0.0.1", () => {
        const { port } = server.address();
        const payload = body == null ? null : JSON.stringify(body);
        const req = http.request({
          hostname: "127.0.0.1",
          port,
          path: urlPath,
          method,
          headers: {
            "Content-Type": "application/json",
            "x-test-role": role,
            ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
          }
        }, (res) => {
          let raw = "";
          res.on("data", (c) => { raw += c; });
          res.on("end", () => {
            server.close();
            let data = {};
            try { data = raw ? JSON.parse(raw) : {}; } catch (_e) { data = { raw }; }
            resolve({ status: res.statusCode, data });
          });
        });
        req.on("error", (err) => { server.close(); reject(err); });
        if (payload) req.write(payload);
        req.end();
      });
    });
  }

  const mgrCoverage = await call("manager", "GET", "/api/fiscal/coverage");
  assert.strictEqual(mgrCoverage.status, 200);
  const mgrExport = await call("manager", "GET", "/api/fiscal/sanitation/export.csv");
  assert.strictEqual(mgrExport.status, 200);
  const mgrBatch = await call("manager", "POST", "/api/fiscal/sanitation/batch-apply", {
    product_refs: ["product:200"],
    profile_code: "READY_TEST",
    confirm: true
  });
  assert.strictEqual(mgrBatch.status, 403);
  const mgrImport = await call("manager", "POST", "/api/fiscal/sanitation/import-apply", {
    csv: "product_ref,ncm\nproduct:999,61091000\n",
    confirm: true
  });
  assert.strictEqual(mgrImport.status, 403);
  const mgrRules = await call("manager", "PUT", "/api/fiscal/readiness/rules/GTIN_MISSING", {
    severity: "blocking"
  });
  assert.strictEqual(mgrRules.status, 403);
  const mgrPay = await call("manager", "PUT", "/api/fiscal/payments/mapping/pix", {
    mapping_status: "confirmed",
    nfce_tpag: "17"
  });
  assert.strictEqual(mgrPay.status, 403);

  const sellerCoverage = await call("seller", "GET", "/api/fiscal/coverage");
  assert.strictEqual(sellerCoverage.status, 403);
  const adminStatus = await call("admin", "GET", "/api/fiscal/status");
  assert.strictEqual(adminStatus.data.stage, 3);
  const adminCoverage = await call("admin", "GET", "/api/fiscal/coverage");
  assert.strictEqual(adminCoverage.status, 200);
  const adminDry = await call("admin", "POST", "/api/fiscal/sanitation/import-dry-run", {
    csv: "product_ref,ncm,origem,unidade,profile_code\nproduct:240,61091000,0,UN,READY_TEST\n"
  });
  assert.strictEqual(adminDry.status, 200);
  assert.strictEqual(adminDry.data.applied, false);
  const adminBatchPreview = await call("admin", "POST", "/api/fiscal/sanitation/batch-preview", {
    product_refs: ["product:200"],
    profile_code: "READY_TEST"
  });
  assert.strictEqual(adminBatchPreview.status, 200);
  assert.ok(adminBatchPreview.data.planned_count >= 1);

  // justificativa CEST NA obrigatoria
  let cestNaBlocked = false;
  try {
    await productTaxRepository.upsert({
      product_id: 204,
      ncm: "61091000",
      origin: "0",
      unit: "UN",
      profile_id: profileReady.id,
      cest_status: "cest_not_applicable",
      cest_na_justification: ""
    }, { name: "qa" });
  } catch (error) {
    cestNaBlocked = error.code === "FISCAL_PRODUCT_TAX_INVALID";
  }
  assert.strictEqual(cestNaBlocked, true);

  console.log(JSON.stringify({
    ok: true,
    tempRoot,
    checks: [
      "establishment_complete_incomplete",
      "product_missing_ncm_blocked",
      "product_complete",
      "cest_four_states",
      "gtin_invalid_and_sem_gtin_rejected",
      "test_profile_production_blocked",
      "variant_override",
      "customer_unidentified_and_invalid",
      "payment_pending_ambiguous_confirmed_tpag",
      "payment_methods_ambiguous_pending",
      "sale_blocked_readyish_multi",
      "eval_readonly_counts_hashes",
      "snapshot_immutable",
      "coverage_report",
      "rules_matrix_severity",
      "batch_preview_confirm_retry_overwrite",
      "import_dry_run_apply_csv_limits",
      "http_permissions_stage3"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error("[fiscal_stage3_readiness_test] FAILED", error);
  process.exitCode = 1;
});
