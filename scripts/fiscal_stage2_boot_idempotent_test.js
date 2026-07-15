"use strict";

/**
 * Gate Stage 2 — boot DDL idempotente 3x + dados Stage1/Stage2 intactos.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aerostore-fiscal-boot-"));
const tempDb = path.join(tempRoot, "test.sqlite");

process.env.DATABASE_PATH = tempDb;
process.env.FISCAL_MODULE_ENABLED = "false";
process.env.FISCAL_DEFAULT_ENVIRONMENT = "homologacao";
process.env.NODE_ENV = "test";

const { initializeDatabase, get, all } = require("../db");
const { ensureFiscalSchema } = require("../modules/fiscal/persistence/ensureFiscalSchema");
const { run: dbRun, get: dbGet, all: dbAll } = require("../db");
const {
  FiscalEstablishmentRepository,
  FiscalTaxProfileRepository,
  FiscalProductTaxRepository,
  FiscalDocumentRepository,
  createFromCompletedSale
} = require("../modules/fiscal");

async function main() {
  await initializeDatabase();
  const establishmentRepository = new FiscalEstablishmentRepository();
  const profileRepository = new FiscalTaxProfileRepository();
  const productTaxRepository = new FiscalProductTaxRepository();
  const documentRepository = new FiscalDocumentRepository();

  const ribeirao = await establishmentRepository.create({
    code: "RP_SHARED",
    legal_name: "Aero RP Homologacao Ltda",
    trade_name: "Aero RP",
    cnpj: "11222333000181",
    ie: "123456789",
    uf: "SP",
    city: "Ribeirao Preto",
    street: "Rua QA",
    environment: "homologacao",
    active: true
  });
  await establishmentRepository.linkStore(ribeirao.id, "vila", { active: true });
  await establishmentRepository.linkStore(ribeirao.id, "botanico", { active: true });

  const profile = await profileRepository.create({
    code: "MODA_PADRAO_TEST",
    name: "Moda teste",
    operation_type: "sale_internal",
    is_test_profile: true,
    cfop: "5102",
    csosn: "102",
    pis_cst: "01",
    cofins_cst: "01"
  });
  await productTaxRepository.upsert({
    product_id: 42,
    ncm: "61091000",
    origin: "0",
    unit: "UN",
    profile_id: profile.id
  }, { name: "boot" });

  process.env.FISCAL_MODULE_ENABLED = "true";
  const sale = {
    sale_id: "SAL_BOOT_S2_001",
    status: "COMPLETED",
    loja: "vila",
    data_hora: "2026-07-15T16:00:00.000Z",
    created_at: "2026-07-15T16:00:00.000Z",
    customer: { id: 1, name: "Cliente", document: "52998224725" },
    items: [{
      item_id: "1",
      product_id: 1,
      normalized_product_id: 42,
      sku: "SKU-BOOT",
      nome: "Item boot",
      quantidade: 1,
      preco_unitario: 50,
      total: 50,
      ncm: "61091000",
      unidade: "UN",
      origem_fiscal: "0",
      gtin_ean: "7891234567890"
    }],
    subtotal: 50,
    total_final: 50,
    paid_amount: 50,
    pagamentos: [{ method: "pix", amount: 50 }]
  };
  const created = await createFromCompletedSale(sale.sale_id, {
    sale,
    skipFeatureFlag: true
  });
  assert.ok(created.document);
  const snapshotVersion = created.document.snapshot?.version;
  assert.strictEqual(snapshotVersion, 2);
  const snapshotJson = JSON.stringify(created.document.snapshot);

  for (let i = 1; i <= 3; i += 1) {
    const result = await ensureFiscalSchema({ run: dbRun, get: dbGet, all: dbAll });
    assert.strictEqual(result.ready, true, `boot ${i} ready`);
  }

  // dados intactos
  const estCount = await get(`SELECT COUNT(*) AS c FROM fiscal_establishments`);
  assert.strictEqual(Number(estCount.c), 1);
  const linkCount = await get(`SELECT COUNT(*) AS c FROM fiscal_establishment_stores WHERE active = 1`);
  assert.strictEqual(Number(linkCount.c), 2);
  const profileCount = await get(`SELECT COUNT(*) AS c FROM fiscal_tax_profiles`);
  assert.strictEqual(Number(profileCount.c), 1);
  const taxCount = await get(`SELECT COUNT(*) AS c FROM fiscal_product_tax`);
  assert.strictEqual(Number(taxCount.c), 1);
  const docs = await documentRepository.list({ limit: 10 });
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(JSON.stringify(docs[0].snapshot), snapshotJson);

  // retry idempotente não altera snapshot
  const again = await createFromCompletedSale(sale.sale_id, { sale, skipFeatureFlag: true });
  assert.strictEqual(again.duplicated, true);
  assert.strictEqual(JSON.stringify(again.document.snapshot), snapshotJson);

  // sem DROP/TRUNCATE no DDL stage2
  const stage2Sql = fs.readFileSync(
    path.join(__dirname, "../modules/fiscal/persistence/fiscal-schema-stage2.sql"),
    "utf8"
  );
  assert.ok(!/\bDROP\b/i.test(stage2Sql));
  assert.ok(!/\bTRUNCATE\b/i.test(stage2Sql));
  assert.ok(!/\bDELETE\b/i.test(stage2Sql));

  // colunas stage2 presentes
  const cols = await all(`PRAGMA table_info(fiscal_establishments)`);
  const names = cols.map((c) => c.name);
  for (const col of ["code", "im", "crt", "street", "city", "certificate_configured", "csc_configured"]) {
    assert.ok(names.includes(col), `missing column ${col}`);
  }

  console.log(JSON.stringify({
    ok: true,
    boots: 3,
    snapshot_immutable: true,
    checks: ["ddl_idempotent_x3", "stage1_docs_intact", "no_destructive_ddl", "no_profile_dup"]
  }, null, 2));
}

main().catch((error) => {
  console.error("[fiscal_stage2_boot_idempotent_test] FAILED", error);
  process.exit(1);
});
