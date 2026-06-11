"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aerostore-pdv-cash-"));
const originalCwd = process.cwd();

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function buildSale({ saleId, cashRegisterId, method, amount, store = "vila" }) {
  return {
    sale_id: saleId,
    status: "COMPLETED",
    loja: store,
    loja_venda: store,
    cash_register_id: cashRegisterId,
    cash_register_store: store,
    total_final: amount,
    paid_amount: amount,
    pagamentos: [{ method, amount, installments: 1 }],
    created_at: new Date().toISOString(),
    data_hora: new Date().toISOString()
  };
}

function buildSaleMovementPayload(sale) {
  return {
    sale_id: sale.sale_id,
    subtotal: sale.total_final,
    money_amount: sale.pagamentos[0].method === "dinheiro" ? sale.total_final : 0,
    pix_amount: sale.pagamentos[0].method === "pix" ? sale.total_final : 0,
    debito_amount: sale.pagamentos[0].method === "debito" ? sale.total_final : 0,
    credito_amount: sale.pagamentos[0].method === "credito" ? sale.total_final : 0,
    link_pagamento_amount: 0,
    cashback_amount: 0,
    vale_presente_amount: 0,
    credito_troca_amount: 0,
    permuta_amount: 0
  };
}

async function main() {
  process.chdir(tempRoot);

  const {
    openCashRegister,
    getOpenCashRegisterByStore,
    getCashRegisterById,
    listCashRegisters,
    registerCashMovement,
    computeCashRegisterExpected,
    closeCashRegister
  } = require(path.join(repoRoot, "modules", "pdv", "services", "pdvControlService"));

  const userA = {
    id: 1,
    name: "QA Caixa A",
    email: "qa-caixa-a@aerostore.local",
    role: "ADMIN"
  };
  const userB = {
    id: 2,
    name: "QA Caixa B",
    email: "qa-caixa-b@aerostore.local",
    role: "GERENTE"
  };

  const firstOpen = openCashRegister({
    loja: "vila",
    valor_inicial: 50,
    observacao: "Smoke de sessao de caixa"
  }, userA);
  const secondOpen = openCashRegister({
    loja: "Vila Masc",
    valor_inicial: 999,
    observacao: "Segunda chamada deve reutilizar o caixa"
  }, userB);

  assert.strictEqual(
    secondOpen.cash_register_id,
    firstOpen.cash_register_id,
    "Segunda abertura da mesma loja por outro usuario deve retornar a sessao existente."
  );
  assert.strictEqual(secondOpen.already_open, true, "Resposta deve informar que o caixa ja estava aberto.");
  assert.strictEqual(secondOpen.operador, userA.name, "Reabertura idempotente nao deve trocar o operador original.");
  assert.strictEqual(
    listCashRegisters().filter((register) => ["OPEN", "REOPENED"].includes(register.status)).length,
    1,
    "Segunda abertura da mesma loja nao pode criar outra sessao."
  );

  const statusOpen = getOpenCashRegisterByStore("vila");
  assert(statusOpen, "Status deve reconhecer o caixa aberto.");
  assert.strictEqual(statusOpen.cash_register_id, firstOpen.cash_register_id);

  const validSales = [
    buildSale({ saleId: "SALE_CASH_SMOKE_1", cashRegisterId: firstOpen.cash_register_id, method: "dinheiro", amount: 100 }),
    buildSale({ saleId: "SALE_CASH_SMOKE_2", cashRegisterId: firstOpen.cash_register_id, method: "pix", amount: 80 }),
    buildSale({ saleId: "SALE_CASH_SMOKE_3", cashRegisterId: firstOpen.cash_register_id, method: "credito", amount: 120 })
  ];
  const cancelledSale = {
    ...buildSale({
      saleId: "SALE_CASH_CANCELLED",
      cashRegisterId: firstOpen.cash_register_id,
      method: "dinheiro",
      amount: 90
    }),
    status: "CANCELLED"
  };
  const pendingSale = {
    ...buildSale({
      saleId: "SALE_CASH_PENDING",
      cashRegisterId: firstOpen.cash_register_id,
      method: "pix",
      amount: 70
    }),
    status: "PENDING"
  };
  const sales = [...validSales, cancelledSale, pendingSale];
  writeJson(path.join(tempRoot, "data", "pdv", "sales", "sales.json"), sales);

  for (const sale of [...validSales.slice(0, 2), cancelledSale]) {
    registerCashMovement({
      cashRegisterId: firstOpen.cash_register_id,
      type: "SALE",
      value: sale.total_final,
      reason: "Venda smoke concluida",
      payload: buildSaleMovementPayload(sale)
    }, userA);
  }

  const reconciledRegister = getCashRegisterById(firstOpen.cash_register_id);
  const linkedSaleMovements = (reconciledRegister.movements || [])
    .filter((movement) => String(movement.type || "").toUpperCase() === "SALE");
  const linkedSaleIds = linkedSaleMovements.map((movement) => movement.payload?.sale_id);
  const countedSalesTotal = linkedSaleMovements.reduce(
    (sum, movement) => sum + Number(movement.value || 0),
    0
  );
  assert.strictEqual(
    linkedSaleMovements.length,
    3,
    "Resumo deve contar somente as tres vendas validas vinculadas ao caixa."
  );
  assert.strictEqual(reconciledRegister.linked_sales, 3, "Contador de vendas deve refletir os vinculos reais.");
  assert.deepStrictEqual(
    validSales.map((sale) => sale.cash_register_id),
    [firstOpen.cash_register_id, firstOpen.cash_register_id, firstOpen.cash_register_id],
    "As tres vendas devem permanecer vinculadas ao mesmo caixa."
  );
  assert(!linkedSaleIds.includes(cancelledSale.sale_id), "Venda CANCELLED nao pode entrar no resumo do caixa.");
  assert(!linkedSaleIds.includes(pendingSale.sale_id), "Venda PENDING nao pode entrar no resumo do caixa.");
  assert.strictEqual(
    countedSalesTotal,
    300,
    "Total contabilizado no resumo deve conter somente R$ 300,00 em vendas validas."
  );
  assert.strictEqual(
    new Set(linkedSaleIds).size,
    linkedSaleMovements.length,
    "Venda com movimento existente e cash_register_id deve ser contada uma unica vez."
  );
  const persistedRegisters = JSON.parse(
    fs.readFileSync(path.join(tempRoot, "data", "pdv", "control", "cash-registers.json"), "utf8")
  );
  const persistedRegister = persistedRegisters.find(
    (register) => register.cash_register_id === firstOpen.cash_register_id
  );
  const persistedSaleIds = (persistedRegister?.movements || [])
    .filter((movement) => String(movement.type || "").toUpperCase() === "SALE")
    .map((movement) => movement.payload?.sale_id);
  assert(
    persistedSaleIds.includes(cancelledSale.sale_id),
    "Historico persistido deve permanecer intacto para auditoria."
  );
  assert(
    !persistedSaleIds.includes(validSales[2].sale_id),
    "Venda recuperada por cash_register_id deve existir somente na projecao de leitura."
  );

  const expected = computeCashRegisterExpected(reconciledRegister);
  assert.strictEqual(expected.dinheiro_esperado, 150);
  assert.strictEqual(expected.dinheiro_vendas, 100);
  assert.strictEqual(expected.pix, 80);
  assert.strictEqual(expected.credito, 120);

  const closed = closeCashRegister({
    cashRegisterId: firstOpen.cash_register_id,
    dinheiro_informado: 150,
    tickets_pix_conferi: true,
    tickets_credito_conferi: true
  }, userB);
  assert.strictEqual(closed.status, "CLOSED");
  assert.strictEqual(closed.close_summary.dinheiro_esperado, 150);
  assert.strictEqual(getOpenCashRegisterByStore("vila"), null, "Status deve mostrar fechado depois do fechamento.");

  const nextOpen = openCashRegister({
    loja: "vila",
    valor_inicial: 25,
    observacao: "Nova sessao apos fechamento"
  }, userB);
  assert.notStrictEqual(
    nextOpen.cash_register_id,
    firstOpen.cash_register_id,
    "Abertura apos fechamento deve criar uma nova sessao."
  );

  const otherStore = openCashRegister({
    loja: "botanico",
    valor_inicial: 10,
    observacao: "Caixa independente por loja"
  }, userA);
  assert.notStrictEqual(otherStore.cash_register_id, nextOpen.cash_register_id);
  assert.strictEqual(getOpenCashRegisterByStore("botanico").cash_register_id, otherStore.cash_register_id);
  assert.strictEqual(getOpenCashRegisterByStore("vila").cash_register_id, nextOpen.cash_register_id);

  const frontendSource = fs.readFileSync(path.join(repoRoot, "public", "app.js"), "utf8");
  assert(
    frontendSource.includes("openedRegister?.already_open"),
    "Frontend deve distinguir abertura nova de caixa ja existente."
  );
  assert(
    frontendSource.includes("Caixa ja estava aberto"),
    "Frontend deve informar claramente quando reutilizar a sessao aberta."
  );

  console.log(JSON.stringify({
    ok: true,
    operational_rule: "one_open_cash_register_per_store",
    first_cash_register_id: firstOpen.cash_register_id,
    idempotent_open_cash_register_id: secondOpen.cash_register_id,
    linked_sales: linkedSaleMovements.length,
    expected_cash: expected.dinheiro_esperado,
    total_sales: countedSalesTotal,
    next_cash_register_id: nextOpen.cash_register_id,
    other_store_cash_register_id: otherStore.cash_register_id
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
