"use strict";

/**
 * Stage 1 — fundação do módulo fiscal (sem SEFAZ/provedor/certificado).
 * Executar: node scripts/fiscal_stage1_foundation_test.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aerostore-fiscal-stage1-"));
const tempDb = path.join(tempRoot, "test.sqlite");

process.env.DATABASE_PATH = tempDb;
process.env.FISCAL_MODULE_ENABLED = "false";
process.env.FISCAL_DEFAULT_ENVIRONMENT = "homologacao";
process.env.NODE_ENV = "test";

const { initializeDatabase, run, get } = require("../db");
const {
  isFiscalModuleEnabled,
  createFromCompletedSale,
  tryCreateFiscalRequestAfterCompletedSale,
  transitionDocumentStatus,
  assertFiscalStatusTransition,
  canTransitionFiscalStatus,
  FISCAL_STATUSES,
  FiscalEstablishmentRepository,
  FiscalDocumentRepository,
  FiscalDocumentEventRepository,
  getNoopProvider,
  buildFiscalIdempotencyKey
} = require("../modules/fiscal");

const establishmentRepository = new FiscalEstablishmentRepository();
const documentRepository = new FiscalDocumentRepository();
const eventRepository = new FiscalDocumentEventRepository();

function buildCompletedSale(overrides = {}) {
  return {
    sale_id: overrides.sale_id || "SAL_FISCAL_STAGE1_001",
    status: overrides.status || "COMPLETED",
    loja: overrides.loja || "vila",
    loja_venda: overrides.loja || "vila",
    data_hora: "2026-07-15T15:00:00.000Z",
    created_at: "2026-07-15T15:00:00.000Z",
    customer: overrides.customer === undefined
      ? {
        id: 10,
        name: "Cliente Teste",
        document: "52998224725",
        phone: "16999990000",
        email: "cliente@teste.local"
      }
      : overrides.customer,
    items: overrides.items || [
      {
        item_id: "ITEM1",
        product_id: 1,
        sku: "SKU-FISCAL-001",
        nome: "Camiseta QA Fiscal",
        quantidade: 1,
        preco_unitario: 100,
        total: 100,
        ncm: "61091000",
        gtin_ean: "7891234567890",
        unidade: "UN",
        origem_fiscal: "0"
      }
    ],
    subtotal: 100,
    desconto_extra: 0,
    discount_amount: 0,
    total_final: 100,
    paid_amount: 100,
    pagamentos: [{ method: "pix", amount: 100, installments: 1 }],
    cashback_usado: 0,
    credito_troca_usado: 0,
    vale_presente_usado: 0,
    permuta_usada: 0,
    cashback_generated: null,
    ...overrides
  };
}

async function seedProduct() {
  await run(
    `INSERT INTO ai_products (
      name, sku, codigo, price, stock, store, status, gtin_ean, ncm, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "Camiseta QA Fiscal",
      "SKU-FISCAL-001",
      "SKU-FISCAL-001",
      100,
      10,
      "vila",
      "ativo",
      "7891234567890",
      "61091000",
      new Date().toISOString(),
      new Date().toISOString()
    ]
  );
  return get(`SELECT * FROM ai_products WHERE sku = ?`, ["SKU-FISCAL-001"]);
}

async function seedEstablishments() {
  const ribeirao = await establishmentRepository.create({
    legal_name: "AEROSTORE COMERCIO DE ROUPAS LTDA",
    trade_name: "AEROSTORE Ribeirao",
    cnpj: "11222333000181",
    ie: "123456789",
    tax_regime: "simples_nacional",
    uf: "SP",
    environment: "homologacao",
    active: true
  });
  await establishmentRepository.linkStore(ribeirao.id, "vila", { active: true });
  await establishmentRepository.linkStore(ribeirao.id, "botanico", { active: true });

  const sul = await establishmentRepository.create({
    legal_name: "AEROSTORE SUL COMERCIO LTDA",
    trade_name: "AEROSTORE Sul",
    cnpj: "04252011000110",
    ie: "987654321",
    tax_regime: "simples_nacional",
    uf: "SC",
    environment: "homologacao",
    active: true
  });
  await establishmentRepository.linkStore(sul.id, "sul", { active: true });

  return { ribeirao, sul };
}

async function main() {
  await initializeDatabase();
  await seedProduct();
  const { ribeirao, sul } = await seedEstablishments();

  // 1) Flag desligada nao cria documento
  process.env.FISCAL_MODULE_ENABLED = "false";
  assert.strictEqual(isFiscalModuleEnabled(), false);
  const saleFlagOff = buildCompletedSale({ sale_id: "SAL_FLAG_OFF" });
  const flagOffResult = await createFromCompletedSale(saleFlagOff.sale_id, {
    sale: saleFlagOff,
    user: { name: "qa", email: "qa@test.local" }
  });
  assert.strictEqual(flagOffResult.skipped, true);
  assert.strictEqual(flagOffResult.reason, "feature_flag_disabled");
  assert.strictEqual(flagOffResult.document, null);
  const docsFlagOff = await documentRepository.listBySaleId("SAL_FLAG_OFF");
  assert.strictEqual(docsFlagOff.length, 0);

  // 2) Venda nao concluida e recusada
  process.env.FISCAL_MODULE_ENABLED = "true";
  assert.strictEqual(isFiscalModuleEnabled(), true);
  let refused = false;
  try {
    await createFromCompletedSale("SAL_OPEN", {
      sale: buildCompletedSale({ sale_id: "SAL_OPEN", status: "OPEN" }),
      skipFeatureFlag: true
    });
  } catch (error) {
    refused = true;
    assert.strictEqual(error.code, "FISCAL_SALE_NOT_COMPLETED");
  }
  assert.strictEqual(refused, true);

  // 3) Venda concluida cria PENDING + evento
  const saleOk = buildCompletedSale({ sale_id: "SAL_OK_001", loja: "vila" });
  const created = await createFromCompletedSale(saleOk.sale_id, {
    sale: saleOk,
    user: { name: "qa-fiscal", email: "qa-fiscal@test.local" },
    skipFeatureFlag: true
  });
  assert.strictEqual(created.created, true);
  assert.strictEqual(created.document.status, FISCAL_STATUSES.PENDING);
  assert.strictEqual(
    created.document.idempotency_key,
    buildFiscalIdempotencyKey({ saleId: "SAL_OK_001", model: "65", purpose: "sale_emit" })
  );
  assert.strictEqual(created.document.establishment_id, ribeirao.id);
  assert.ok(created.document.snapshot);
  assert.strictEqual(created.document.snapshot.sale_id, "SAL_OK_001");
  assert.strictEqual(created.document.snapshot.store_id, "vila");
  assert.strictEqual(created.document.snapshot.emitter.cnpj, "11222333000181");
  assert.strictEqual(created.document.snapshot.items[0].ncm, "61091000");
  assert.strictEqual(created.document.snapshot.items[0].cfop, null);
  assert.strictEqual(created.document.snapshot.items[0].csosn, null);
  assert.ok(Array.isArray(created.document.snapshot.fiscal_gaps));
  assert.ok(created.document.snapshot.notes.transmission === "disabled");

  const events = await eventRepository.listByDocumentId(created.document.id);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].from_status, FISCAL_STATUSES.NOT_REQUESTED);
  assert.strictEqual(events[0].to_status, FISCAL_STATUSES.PENDING);

  const frozenSnapshot = JSON.stringify(created.document.snapshot);

  // 4) Segunda tentativa retorna o mesmo documento (sem novo evento / sem sobrescrever snapshot)
  const again = await createFromCompletedSale(saleOk.sale_id, {
    sale: saleOk,
    user: { name: "qa-fiscal" },
    skipFeatureFlag: true
  });
  assert.strictEqual(again.created, false);
  assert.strictEqual(again.duplicated, true);
  assert.strictEqual(again.document.id, created.document.id);
  assert.strictEqual(JSON.stringify(again.document.snapshot), frozenSnapshot);
  const eventsAfterDup = await eventRepository.listByDocumentId(created.document.id);
  assert.strictEqual(eventsAfterDup.length, 1);

  // 5) Snapshot permanece igual apos alteracao posterior do cadastro
  await run(`UPDATE ai_products SET ncm = ? WHERE sku = ?`, ["99999999", "SKU-FISCAL-001"]);
  const reloaded = await documentRepository.findById(created.document.id);
  assert.strictEqual(reloaded.snapshot.items[0].ncm, "61091000");
  assert.notStrictEqual(reloaded.snapshot.items[0].ncm, "99999999");

  // 6) Lojas distintas no mesmo estabelecimento (vila + botanico)
  const saleBotanico = buildCompletedSale({ sale_id: "SAL_BOT_001", loja: "botanico" });
  const createdBot = await createFromCompletedSale(saleBotanico.sale_id, {
    sale: saleBotanico,
    skipFeatureFlag: true
  });
  assert.strictEqual(createdBot.document.establishment_id, ribeirao.id);
  assert.deepStrictEqual(
    createdBot.document.snapshot.emitter.linked_store_ids.sort(),
    ["botanico", "vila"]
  );

  // 7) Loja Sul aponta para estabelecimento separado
  const saleSul = buildCompletedSale({ sale_id: "SAL_SUL_001", loja: "sul" });
  const createdSul = await createFromCompletedSale(saleSul.sale_id, {
    sale: saleSul,
    skipFeatureFlag: true
  });
  assert.strictEqual(createdSul.document.establishment_id, sul.id);
  assert.strictEqual(createdSul.document.snapshot.emitter.cnpj, "04252011000110");
  assert.notStrictEqual(createdSul.document.establishment_id, ribeirao.id);

  // 8) Erro fiscal nao quebra finalizacao (hook isolado)
  const brokenSale = buildCompletedSale({ sale_id: "SAL_NO_EST", loja: "loja_inexistente_xyz" });
  const hookResult = await tryCreateFiscalRequestAfterCompletedSale(brokenSale, { name: "qa" });
  assert.strictEqual(hookResult.failed, true);
  assert.ok(hookResult.reason);
  // Simula que a venda continua concluida
  assert.strictEqual(brokenSale.status, "COMPLETED");

  // 9) Transicoes avancadas bloqueadas no Stage 1 (nao forjar AUTHORIZED/CANCELLED)
  assert.strictEqual(canTransitionFiscalStatus("PENDING", "AUTHORIZED"), false);
  let invalidBlocked = false;
  try {
    assertFiscalStatusTransition("PENDING", "AUTHORIZED");
  } catch (error) {
    invalidBlocked = true;
    assert.strictEqual(error.code, "FISCAL_INVALID_STATUS_TRANSITION");
  }
  assert.strictEqual(invalidBlocked, true);

  let authorizedBlocked = false;
  try {
    await transitionDocumentStatus(created.document.id, "AUTHORIZED", { user: { name: "qa" } });
  } catch (error) {
    authorizedBlocked = true;
    assert.strictEqual(error.code, "FISCAL_STAGE1_TRANSITION_BLOCKED");
  }
  assert.strictEqual(authorizedBlocked, true);

  let cancelledBlocked = false;
  try {
    await transitionDocumentStatus(created.document.id, "CANCELLED", { user: { name: "qa" } });
  } catch (error) {
    cancelledBlocked = true;
    assert.strictEqual(error.code, "FISCAL_STAGE1_TRANSITION_BLOCKED");
  }
  assert.strictEqual(cancelledBlocked, true);

  const stillPending = await documentRepository.findById(created.document.id);
  assert.strictEqual(stillPending.status, "PENDING");
  assert.strictEqual(
    (await eventRepository.listByDocumentId(created.document.id)).length,
    1,
    "tentativas bloqueadas nao geram eventos"
  );

  // 10) Nenhuma chamada externa (noop provider)
  const provider = getNoopProvider();
  const callsBefore = provider.externalCalls;
  let providerBlocked = false;
  try {
    provider.emit({});
  } catch (error) {
    providerBlocked = true;
    assert.strictEqual(error.code, "FISCAL_PROVIDER_BLOCKED");
  }
  assert.strictEqual(providerBlocked, true);
  assert.strictEqual(provider.externalCalls, callsBefore + 1);

  // 11) Snapshot sem segredos / sem campos inventados
  const snap = created.document.snapshot;
  assert.strictEqual(snap.emitter.csc, null);
  assert.strictEqual(snap.emitter.certificate, null);
  assert.strictEqual(snap.items[0].cfop, null);
  assert.strictEqual(snap.items[0].csosn, null);
  assert.strictEqual(snap.items[0].cst, null);
  assert.strictEqual(snap.payments[0].nfce_tpag, null);
  // Valores sensíveis nao podem aparecer (chaves csc/certificate com null sao marcadores de ausencia)
  const secretValues = [];
  JSON.stringify(snap, (key, value) => {
    if (/(password|senha|token|pfx|p12|api_key)/i.test(String(key)) && value) {
      secretValues.push(key);
    }
    if (/(csc|certificate)/i.test(String(key)) && value !== null && value !== undefined && value !== "") {
      secretValues.push(`${key}=present`);
    }
    return value;
  });
  assert.deepStrictEqual(secretValues, []);

  // 12) Loja nao pode ter dois vinculos ativos; desativar nao apaga historico
  let dualActiveBlocked = false;
  try {
    await establishmentRepository.linkStore(sul.id, "vila", { active: true });
  } catch (error) {
    dualActiveBlocked = true;
    assert.strictEqual(error.code, "FISCAL_STORE_ACTIVE_LINK_CONFLICT");
  }
  assert.strictEqual(dualActiveBlocked, true);

  await establishmentRepository.linkStore(ribeirao.id, "vila", { active: false });
  const vilaAfterDeactivate = await establishmentRepository.findActiveByStoreId("vila", {
    environment: "homologacao"
  });
  assert.strictEqual(vilaAfterDeactivate, null);
  const historicalDoc = await documentRepository.findById(created.document.id);
  assert.ok(historicalDoc);
  assert.strictEqual(historicalDoc.establishment_id, ribeirao.id);
  assert.strictEqual(historicalDoc.status, "PENDING");
  assert.strictEqual(JSON.stringify(historicalDoc.snapshot), frozenSnapshot);
  // reativa para nao quebrar leituras posteriores do teste
  await establishmentRepository.linkStore(ribeirao.id, "vila", { active: true });

  // 13) Mutacoes HTTP so em NODE_ENV=test
  const {
    allowFiscalTestOnlyMutations,
    rejectMutationOutsideTest
  } = require("../modules/fiscal/routes/fiscalRoutes");
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  assert.strictEqual(allowFiscalTestOnlyMutations(), false);
  const fakeRes = {
    statusCode: 0,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; }
  };
  let nextCalled = false;
  rejectMutationOutsideTest({}, fakeRes, () => { nextCalled = true; });
  assert.strictEqual(fakeRes.statusCode, 404);
  assert.strictEqual(fakeRes.payload.code, "FISCAL_MUTATION_ROUTE_DISABLED");
  assert.strictEqual(nextCalled, false);
  process.env.NODE_ENV = "test";
  assert.strictEqual(allowFiscalTestOnlyMutations(), true);
  const fakeResTest = {
    statusCode: 0,
    status(code) { this.statusCode = code; return this; },
    json() { return this; }
  };
  let nextCalledTest = false;
  rejectMutationOutsideTest({}, fakeResTest, () => { nextCalledTest = true; });
  assert.strictEqual(nextCalledTest, true);
  process.env.NODE_ENV = previousNodeEnv || "test";

  // 14) Boot repetido do schema (3x) nao e destrutivo
  const { ensureFiscalSchema } = require("../modules/fiscal/persistence/ensureFiscalSchema");
  const { run: dbRun, get: dbGet, all: dbAll } = require("../db");
  const docCountBefore = (await dbAll(`SELECT id FROM fiscal_documents`)).length;
  const linkCountBefore = (await dbAll(`SELECT id FROM fiscal_establishment_stores`)).length;
  const snapBeforeBoot = (await documentRepository.findById(created.document.id)).snapshot_json;
  for (let i = 0; i < 3; i += 1) {
    const result = await ensureFiscalSchema({ run: dbRun, get: dbGet, all: dbAll });
    assert.strictEqual(result.ready, true);
  }
  assert.strictEqual((await dbAll(`SELECT id FROM fiscal_documents`)).length, docCountBefore);
  assert.strictEqual((await dbAll(`SELECT id FROM fiscal_establishment_stores`)).length, linkCountBefore);
  assert.strictEqual(
    (await documentRepository.findById(created.document.id)).snapshot_json,
    snapBeforeBoot
  );
  const ddlText = require("fs").readFileSync(
    require("path").join(__dirname, "../modules/fiscal/persistence/fiscal-schema.sql"),
    "utf8"
  );
  assert.doesNotMatch(ddlText, /\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i);

  // Flag off no hook pos-venda
  process.env.FISCAL_MODULE_ENABLED = "false";
  const hookOff = await tryCreateFiscalRequestAfterCompletedSale(
    buildCompletedSale({ sale_id: "SAL_HOOK_OFF" }),
    {}
  );
  assert.strictEqual(hookOff.skipped, true);
  assert.strictEqual(hookOff.reason, "feature_flag_disabled");

  console.log(JSON.stringify({
    ok: true,
    tempRoot,
    checks: [
      "flag_off_skips",
      "non_completed_refused",
      "completed_creates_pending",
      "idempotent_duplicate",
      "snapshot_immutable",
      "shared_establishment_vila_botanico",
      "sul_separate_establishment",
      "fiscal_error_isolated",
      "stage1_authorized_cancelled_blocked",
      "noop_provider_blocks_emit",
      "event_created_on_request",
      "snapshot_no_secrets_no_invented_tax",
      "dual_active_store_link_blocked",
      "deactivate_link_keeps_history",
      "mutation_routes_404_outside_test",
      "schema_boot_idempotent_x3"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error("[fiscal_stage1_foundation_test] FAILED", error);
  process.exitCode = 1;
});
