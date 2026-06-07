"use strict";

const assert = require("assert");
const {
  syncManualProductSizeStock,
  getProductOperationalAvailability
} = require("../modules/pdv/inventory/pdvInventoryService");

function getSizeRecord(records, size) {
  return records.find((record) => (
    record.source === "PDV_MANUAL_SIZE_STOCK"
    && record.manual_size_key === size
  ));
}

function sync(records, sizeStock) {
  return syncManualProductSizeStock({
    product: {
      id: 987654,
      sku: "AERO-987654",
      codigo: "AERO-987654",
      name: "QA Grade operacional",
      commercial_name: "QA Grade operacional",
      category: "QA",
      color: "Preto",
      price: 129.9,
      source: "manual"
    },
    sizeStock,
    storeId: "vila_masc"
  }, {
    name: "QA Codex",
    role: "admin"
  }, {
    records,
    persist: false
  });
}

function main() {
  const records = [];

  sync(records, [
    { size: "P", quantity: 2 },
    { size: "M", quantity: 3 },
    { size: "G", quantity: 1 }
  ]);

  assert.strictEqual(getSizeRecord(records, "P").available_qty, 2);
  assert.strictEqual(getSizeRecord(records, "M").available_qty, 3);
  assert.strictEqual(getSizeRecord(records, "G").available_qty, 1);
  assert.strictEqual(getSizeRecord(records, "P").store_id, "vila");
  assert.strictEqual(getSizeRecord(records, "P").tamanho, "P");
  assert.strictEqual(
    getProductOperationalAvailability({ product_id: getSizeRecord(records, "P").product_id }, "vila", { records }).status,
    "AVAILABLE_LOCAL"
  );

  sync(records, [
    { size: "P", quantity: 4 },
    { size: "M", quantity: 3 }
  ]);

  assert.strictEqual(getSizeRecord(records, "P").available_qty, 4, "A edicao deve substituir 2 por 4, nao somar e virar 6.");
  assert.strictEqual(getSizeRecord(records, "M").available_qty, 3);
  assert.strictEqual(getSizeRecord(records, "G").available_qty, 0, "Tamanho removido deve ficar indisponivel.");

  sync(records, [
    { size: "P", quantity: 0 },
    { size: "M", quantity: 0 }
  ]);

  assert.strictEqual(getSizeRecord(records, "P").available_qty, 0);
  assert.strictEqual(getSizeRecord(records, "M").available_qty, 0);
  assert.strictEqual(getSizeRecord(records, "P").stock_count_confirmed, true);
  assert.strictEqual(getSizeRecord(records, "P").status, "OUT");
  assert.strictEqual(
    getProductOperationalAvailability({ product_id: getSizeRecord(records, "P").product_id }, "vila", { records }).status,
    "OUT_OF_STOCK_LOCAL"
  );

  console.log(JSON.stringify({
    ok: true,
    records: records.map((record) => ({
      product_id: record.product_id,
      sku: record.sku,
      size: record.tamanho,
      available_qty: record.available_qty,
      store_id: record.store_id,
      status: record.status
    }))
  }, null, 2));
}

main();
