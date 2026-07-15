"use strict";

/**
 * Stage 2 — estabelecimentos, perfis, produto fiscal, resolver e gaps.
 * Sem SEFAZ/provedor/certificado/CSC/emissão.
 * Executar: node scripts/fiscal_stage2_catalog_test.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aerostore-fiscal-stage2-"));
process.env.DATABASE_PATH = path.join(tempRoot, "test.sqlite");
process.env.FISCAL_MODULE_ENABLED = "false";
process.env.FISCAL_DEFAULT_ENVIRONMENT = "homologacao";
process.env.NODE_ENV = "test";

const { initializeDatabase, run, get } = require("../db");
const {
  isFiscalModuleEnabled,
  createFromCompletedSale,
  FiscalEstablishmentRepository,
  FiscalTaxProfileRepository,
  FiscalProductTaxRepository,
  FiscalDocumentRepository,
  resolveForSaleItem,
  buildFiscalGapsReport,
  buildFiscalSnapshot,
  buildProductRef
} = require("../modules/fiscal");

const establishmentRepository = new FiscalEstablishmentRepository();
const profileRepository = new FiscalTaxProfileRepository();
const productTaxRepository = new FiscalProductTaxRepository();
const documentRepository = new FiscalDocumentRepository();

function buildSale(overrides = {}) {
  return {
    sale_id: overrides.sale_id || "SAL_S2_001",
    status: "COMPLETED",
    loja: overrides.loja || "vila",
    data_hora: "2026-07-15T18:00:00.000Z",
    customer: { id: 1, name: "Cliente", document: "52998224725", phone: "16999990000" },
    items: overrides.items || [{
      item_id: "I1",
      product_id: 1,
      sku: "SKU-S2-001",
      nome: "Tenis QA",
      quantidade: 1,
      preco_unitario: 200,
      total: 200
    }],
    subtotal: 200,
    total_final: 200,
    paid_amount: 200,
    pagamentos: [{ method: "pix", amount: 200 }],
    ...overrides
  };
}

async function main() {
  assert.strictEqual(isFiscalModuleEnabled(), false);
  await initializeDatabase();

  await run(
    `INSERT INTO ai_products (name, sku, codigo, price, stock, store, status, gtin_ean, ncm, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["Tenis QA", "SKU-S2-001", "SKU-S2-001", 200, 5, "vila", "ativo", "7891234567890", "", new Date().toISOString(), new Date().toISOString()]
  );
  const product = await get(`SELECT * FROM ai_products WHERE sku = ?`, ["SKU-S2-001"]);

  // 1) Ribeirão: vila + botanico no mesmo estabelecimento
  const ribeirao = await establishmentRepository.create({
    code: "RP-01",
    legal_name: "AEROSTORE RIBEIRAO LTDA",
    trade_name: "AEROSTORE RP",
    cnpj: "11222333000181",
    ie: "123",
    tax_regime: "simples_nacional",
    crt: "1",
    uf: "SP",
    city: "Ribeirao Preto",
    street: "Rua A",
    environment: "homologacao",
    active: true
  });
  await establishmentRepository.linkStore(ribeirao.id, "vila", { active: true });
  await establishmentRepository.linkStore(ribeirao.id, "botanico", { active: true });

  // 2) Sul próprio
  const sul = await establishmentRepository.create({
    code: "SUL-01",
    legal_name: "AEROSTORE SUL LTDA",
    trade_name: "AEROSTORE SUL",
    cnpj: "04252011000110",
    ie: "456",
    uf: "SC",
    city: "Balneario Camboriu",
    street: "Rua B",
    environment: "homologacao",
    active: true
  });
  await establishmentRepository.linkStore(sul.id, "sul", { active: true });

  assert.strictEqual((await establishmentRepository.findActiveByStoreId("vila")).id, ribeirao.id);
  assert.strictEqual((await establishmentRepository.findActiveByStoreId("botanico")).id, ribeirao.id);
  assert.strictEqual((await establishmentRepository.findActiveByStoreId("sul")).id, sul.id);

  // 3) Duas vinculacoes ativas recusadas
  let conflict = false;
  try {
    await establishmentRepository.linkStore(sul.id, "vila", { active: true });
  } catch (error) {
    conflict = true;
    assert.strictEqual(error.code, "FISCAL_STORE_ACTIVE_LINK_CONFLICT");
  }
  assert.strictEqual(conflict, true);

  // 4) CNPJ invalido recusado
  let invalidCnpj = false;
  try {
    await establishmentRepository.create({
      legal_name: "X",
      cnpj: "123",
      uf: "SP"
    });
  } catch (error) {
    invalidCnpj = true;
    assert.strictEqual(error.code, "FISCAL_ESTABLISHMENT_INVALID");
  }
  assert.strictEqual(invalidCnpj, true);

  // 5) Perfis (teste only — sem inventar CFOP real de produção)
  const profileEmpty = await profileRepository.create({
    code: "MODA_PADRAO_TEST",
    name: "Moda padrao teste",
    operation_type: "sale_internal",
    is_test_profile: true
    // cfop/csosn propositalmente nulos
  });
  assert.strictEqual(profileEmpty.cfop, null);
  assert.strictEqual(profileEmpty.csosn, null);

  const profileFilled = await profileRepository.create({
    code: "CALCADOS_TEST",
    name: "Calcados teste",
    operation_type: "sale_internal",
    is_test_profile: true,
    // valores apenas de teste — nao sao regra contábil aprovada
    cfop: "5102",
    csosn: "102",
    pis_cst: "01",
    cofins_cst: "01"
  });
  const updatedProfile = await profileRepository.update(profileFilled.id, {
    additional_info: "perfil de teste stage2"
  });
  assert.strictEqual(updatedProfile.additional_info, "perfil de teste stage2");

  // 6) Produto pai + variação com herança/override
  const parentTax = await productTaxRepository.upsert({
    product_id: 100,
    legacy_ai_product_id: product.id,
    ncm: "64039990",
    origin: "0",
    unit: "UN",
    gtin_ean: "7891234567890",
    profile_id: profileFilled.id,
    inherit_from_parent: true
  }, { name: "qa" });
  assert.strictEqual(parentTax.product_ref, "product:100");

  const variantTax = await productTaxRepository.upsert({
    product_id: 100,
    variant_id: "VAR_S2_RED",
    ncm: "64041100",
    origin: "0",
    unit: "UN",
    profile_id: profileEmpty.id,
    inherit_from_parent: false
  }, { name: "qa" });
  assert.strictEqual(variantTax.product_ref, buildProductRef({ variantId: "VAR_S2_RED" }));

  // 7) Resolução sale_internal
  const resolvedParent = await resolveForSaleItem({
    establishment: ribeirao,
    storeId: "vila",
    productId: 100,
    legacyAiProductId: product.id,
    operationType: "sale_internal",
    originUf: "SP",
    destinationUf: "SP"
  });
  assert.strictEqual(resolvedParent.tax.cfop, "5102");
  assert.strictEqual(resolvedParent.tax.csosn, "102");
  assert.strictEqual(resolvedParent.product.ncm, "64039990");
  assert.strictEqual(resolvedParent.invented_tax_fields, false);

  const resolvedVariant = await resolveForSaleItem({
    establishment: ribeirao,
    storeId: "vila",
    productId: 100,
    variantId: "VAR_S2_RED",
    operationType: "sale_internal"
  });
  assert.strictEqual(resolvedVariant.product.ncm, "64041100");
  assert.strictEqual(resolvedVariant.profile_id, profileEmpty.id);
  assert.ok(resolvedVariant.gaps.includes("cfop_missing"));
  assert.ok(resolvedVariant.gaps.includes("csosn_or_cst_missing"));

  // 8) Perfil ausente gera gap
  const noProfile = await resolveForSaleItem({
    establishment: ribeirao,
    storeId: "vila",
    productId: 9999,
    saleItem: { ncm: "61091000", origem_fiscal: "0", unidade: "UN", nome: "X" },
    operationType: "sale_internal"
  });
  assert.ok(noProfile.gaps.includes("profile_missing"));
  assert.strictEqual(noProfile.tax.cfop, null);

  // 9) Snapshot usa resolver e permanece imutavel
  process.env.FISCAL_MODULE_ENABLED = "true";
  const sale = buildSale({
    sale_id: "SAL_S2_SNAP",
    loja: "vila",
    items: [{
      item_id: "I1",
      product_id: product.id,
      normalized_product_id: 100,
      sku: "SKU-S2-001",
      nome: "Tenis QA",
      quantidade: 1,
      preco_unitario: 200,
      total: 200,
      ncm: "",
      unidade: "",
      origem_fiscal: ""
    }]
  });
  const created = await createFromCompletedSale(sale.sale_id, {
    sale,
    skipFeatureFlag: true,
    user: { name: "qa" }
  });
  assert.strictEqual(created.created, true);
  assert.strictEqual(created.document.snapshot.version, 2);
  assert.strictEqual(created.document.snapshot.items[0].cfop, "5102");
  assert.strictEqual(created.document.snapshot.items[0].profile_code, "CALCADOS_TEST");
  assert.strictEqual(created.document.snapshot.notes.invented_tax_fields, false);
  const frozen = created.document.snapshot_json;

  await productTaxRepository.upsert({
    product_id: 100,
    ncm: "99999999",
    origin: "0",
    unit: "UN",
    profile_id: profileFilled.id
  }, { name: "qa" });
  const again = await createFromCompletedSale(sale.sale_id, { sale, skipFeatureFlag: true });
  assert.strictEqual(again.duplicated, true);
  assert.strictEqual(again.document.snapshot_json, frozen);
  assert.strictEqual(again.document.snapshot.items[0].ncm, "64039990");

  // 10) Relatorio de pendencias
  const gaps = await buildFiscalGapsReport({ store_id: "vila" });
  assert.ok(gaps.totals.items >= 1);
  assert.ok(typeof gaps.counts_by_gap === "object");

  // 11) Flag desligada nao cria documento
  process.env.FISCAL_MODULE_ENABLED = "false";
  const skipped = await createFromCompletedSale("SAL_S2_OFF", {
    sale: buildSale({ sale_id: "SAL_S2_OFF", loja: "sul" })
  });
  assert.strictEqual(skipped.skipped, true);
  assert.strictEqual((await documentRepository.listBySaleId("SAL_S2_OFF")).length, 0);

  // 12) Desativar vinculo nao apaga documento
  await establishmentRepository.linkStore(ribeirao.id, "vila", { active: false });
  const historical = await documentRepository.findById(created.document.id);
  assert.ok(historical);
  assert.strictEqual(historical.snapshot_json, frozen);

  // 13) Perfil de teste em producao e operation mismatch
  const testInProd = await resolveForSaleItem({
    establishment: { ...ribeirao, environment: "producao" },
    productId: 100,
    operationType: "sale_internal",
    environment: "producao",
    originUf: "SP",
    destinationUf: "SP"
  });
  assert.ok(testInProd.blocking_errors.includes("test_profile_in_production"));
  assert.strictEqual(testInProd.tax_correctness, "unverified");

  let invalidOpThrown = false;
  try {
    await profileRepository.create({
      code: "BAD_OP",
      name: "Bad",
      operation_type: "not_a_real_op"
    });
  } catch (error) {
    invalidOpThrown = error.code === "FISCAL_TAX_PROFILE_INVALID";
  }
  assert.strictEqual(invalidOpThrown, true);

  const interstateMismatch = await resolveForSaleItem({
    establishment: ribeirao,
    productId: 100,
    operationType: "sale_interstate",
    environment: "homologacao"
  });
  assert.ok(interstateMismatch.gaps.includes("profile_operation_mismatch"));

  assert.strictEqual(gaps.filters.category_filter_supported, false);

  console.log(JSON.stringify({
    ok: true,
    tempRoot,
    checks: [
      "shared_establishment_rp",
      "sul_own_establishment",
      "dual_active_link_blocked",
      "invalid_cnpj_blocked",
      "profile_create_update",
      "profile_null_tax_fields",
      "parent_variant_inheritance_override",
      "resolve_sale_internal",
      "gaps_without_profile_cfop_csosn",
      "snapshot_uses_resolver",
      "snapshot_immutable",
      "gaps_report",
      "flag_off_skips",
      "unlink_keeps_history",
      "test_profile_blocked_in_production",
      "invalid_operation_type_rejected",
      "profile_operation_mismatch"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error("[fiscal_stage2_catalog_test] FAILED", error);
  process.exitCode = 1;
});
