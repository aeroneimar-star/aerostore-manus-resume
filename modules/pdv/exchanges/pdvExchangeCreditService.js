"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const exchangeCreditsRootDir = path.join(process.cwd(), "data", "pdv", "sales");
const exchangeCreditsFilePath = path.join(exchangeCreditsRootDir, "exchange-credits.json");

function ensureExchangeCreditFile() {
  fs.mkdirSync(exchangeCreditsRootDir, { recursive: true });
  if (!fs.existsSync(exchangeCreditsFilePath)) {
    fs.writeFileSync(exchangeCreditsFilePath, "[]", "utf8");
  }
}

function readExchangeCredits() {
  ensureExchangeCreditFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(exchangeCreditsFilePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function saveExchangeCredits(rows = []) {
  ensureExchangeCreditFile();
  fs.writeFileSync(exchangeCreditsFilePath, JSON.stringify(Array.isArray(rows) ? rows : [], null, 2), "utf8");
}

function buildId(prefix = "EXCR") {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizePhone(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhoneForOwnership(value = "") {
  let digits = normalizePhone(value || "");
  if (digits.startsWith("55") && digits.length > 11) {
    digits = digits.slice(2);
  }
  return digits;
}

function normalizeComparableName(value = "") {
  return normalizeText(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectCustomerIdentityIds(value = {}) {
  const candidates = [
    value.customer_id,
    value.exchange_customer_id,
    value.master_customer_id,
    value.contact_id,
    value.crm_contact_id,
    value.legacy_contact_id,
    value.id,
    value.customer?.customer_id,
    value.customer?.master_customer_id,
    value.customer?.contact_id,
    value.customer?.crm_contact_id,
    value.customer?.id
  ];
  const seen = new Set();
  return candidates
    .map((item) => normalizeText(item || ""))
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function hasCustomerNameConflict(leftName = "", rightName = "") {
  const left = normalizeComparableName(leftName);
  const right = normalizeComparableName(rightName);
  if (!left || !right || left === right || left.includes(right) || right.includes(left)) {
    return false;
  }
  const leftParts = left.split(" ").filter((part) => part.length > 2);
  const rightParts = right.split(" ").filter((part) => part.length > 2);
  if (!leftParts.length || !rightParts.length) {
    return false;
  }
  return !leftParts.some((part) => rightParts.includes(part));
}

function toNumber(value = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const normalized = String(value ?? "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value = 0) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function buildExchangeSourceKey(source = {}) {
  const item = source.returned_item || source.item || source;
  return [
    normalizeText(source.original_sale_id || source.origin_sale_id || item.original_sale_id || ""),
    normalizeText(item.sale_item_id || item.item_id || item.original_item_id || item.cart_item_id || item.id || ""),
    normalizeText(item.inventory_id || item.selected_inventory_id || ""),
    normalizeText(item.product_id || item.selected_product_id || ""),
    normalizeText(item.sku || item.selected_sku || item.codigo || item.selected_codigo || ""),
    normalizeText(item.cor || item.color || ""),
    normalizeText(item.tamanho || item.size || ""),
    String(roundMoney(item.unit_value || item.unit_price || item.original_unit_price || item.valor_unitario_pago || item.price || 0))
  ].join("|");
}

function isCreditActive(credit = {}) {
  const status = normalizeText(credit.status || "").toLowerCase();
  return ["ativo", "active"].includes(status) && roundMoney(credit.remaining_amount) > 0;
}

function compareCreditCreatedAt(left = {}, right = {}) {
  const leftTime = new Date(left.created_at || left.updated_at || 0).getTime() || 0;
  const rightTime = new Date(right.created_at || right.updated_at || 0).getTime() || 0;
  return leftTime - rightTime;
}

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getActorName(user = {}) {
  return normalizeText(user?.name || user?.email || "sistema");
}

function normalizeCreditOwner(customer = {}) {
  const customerId = normalizeText(
    customer.customer_id
    || customer.exchange_customer_id
    || customer.master_customer_id
    || customer.contact_id
    || customer.crm_contact_id
    || customer.legacy_contact_id
    || customer.id
    || ""
  );
  const phone = normalizeText(customer.phone || customer.telefone || customer.customer_phone || "");
  return {
    customer_id: customerId || normalizePhone(phone),
    customer_name: normalizeText(customer.name || customer.nome || customer.customer_name || ""),
    customer_phone: phone,
    customer_document: normalizeText(customer.document || customer.cpf || customer.cnpj || "")
  };
}

function isManualExchangeCredit(credit = {}) {
  const sourceType = normalizeText(credit.source_type || "").toLowerCase();
  const origin = normalizeText(credit.origin || "").toLowerCase();
  const sourceOrigin = normalizeManualCreditOrigin(credit.source_origin || "");
  return sourceType === "manual_exchange_credit"
    || origin === "credito_manual"
    || Boolean(sourceOrigin);
}

function checkExchangeCreditCustomerOwnership(credit = {}, customer = {}) {
  const owner = normalizeCreditOwner(customer || {});
  const creditIds = collectCustomerIdentityIds(credit);
  const ownerIds = collectCustomerIdentityIds(customer);
  const idMatch = creditIds.some((creditId) => ownerIds.includes(creditId));
  const hasIdMismatch = Boolean(creditIds.length && ownerIds.length && !idMatch);
  const creditPhone = normalizePhoneForOwnership(credit.customer_phone || credit.phone || "");
  const ownerPhone = normalizePhoneForOwnership(owner.customer_phone || customer.phone || customer.telefone || "");
  const phoneMatch = Boolean(creditPhone && ownerPhone && creditPhone === ownerPhone);
  const hasPhoneMismatch = Boolean(creditPhone && ownerPhone && creditPhone !== ownerPhone);
  const nameConflict = hasCustomerNameConflict(credit.customer_name || credit.name || "", owner.customer_name || customer.name || customer.nome || "");
  const manualCredit = isManualExchangeCredit(credit);

  if (idMatch) {
    return { belongs: true, reason: "id_match", idMatch, phoneMatch, nameConflict, manualCredit };
  }

  if (phoneMatch && !nameConflict && (manualCredit || !creditIds.length || !ownerIds.length)) {
    return { belongs: true, reason: manualCredit ? "manual_phone_match" : "phone_match", idMatch, phoneMatch, nameConflict, manualCredit };
  }

  if (hasPhoneMismatch) {
    return { belongs: false, reason: "phone_mismatch", idMatch, phoneMatch, nameConflict, manualCredit };
  }

  if (nameConflict && phoneMatch) {
    return { belongs: false, reason: "name_conflict", idMatch, phoneMatch, nameConflict, manualCredit };
  }

  if (hasIdMismatch) {
    return { belongs: false, reason: "customer_id_mismatch", idMatch, phoneMatch, nameConflict, manualCredit };
  }

  return { belongs: false, reason: "missing_customer_match", idMatch, phoneMatch, nameConflict, manualCredit };
}

function maskPhone(value = "") {
  const digits = normalizePhone(value || "");
  if (!digits) return "";
  return `********${digits.slice(-4)}`;
}

function normalizeManualCreditOrigin(value = "") {
  const origin = normalizeText(value || "").toLowerCase();
  if (["tiny", "tiny_legacy"].includes(origin)) return "tiny_legacy";
  if (["venda_externa", "external_sale", "externa"].includes(origin)) return "venda_externa";
  if (["ajuste_manual", "manual_adjustment", "ajuste"].includes(origin)) return "ajuste_manual";
  return "";
}

function normalizeCreditRow(row = {}) {
  const amount = roundMoney(row.amount || 0);
  const remaining = roundMoney(row.remaining_amount ?? amount);
  const used = roundMoney(row.used_amount ?? Math.max(0, amount - remaining));
  return {
    ...row,
    amount,
    remaining_amount: remaining,
    used_amount: used,
    status: normalizeText(row.status || (remaining > 0 ? "ativo" : "usado")) || "ativo",
    movements: Array.isArray(row.movements) ? row.movements : [],
    expires_at: row.expires_at ?? null
  };
}

function createExchangeCredit({ exchange = {}, owner = {}, amount = 0, user = {} } = {}) {
  const creditAmount = roundMoney(amount || exchange.credit_generated || exchange.returned_total || 0);
  if (creditAmount <= 0) {
    return null;
  }
  const normalizedOwner = normalizeCreditOwner(owner || exchange.exchange_customer || {});
  if (!normalizedOwner.customer_id || !normalizedOwner.customer_name || !normalizedOwner.customer_phone) {
    throw createHttpError("Selecione o cliente que recebera o Credito de Troca.");
  }
  const credits = readExchangeCredits().map(normalizeCreditRow);
  const existing = credits.find((item) => item.exchange_id === exchange.exchange_id && !["cancelado", "cancelled"].includes(normalizeText(item.status).toLowerCase()));
  if (existing) {
    return existing;
  }
  const returnedItems = Array.isArray(exchange.returned_items)
    ? exchange.returned_items.filter(Boolean)
    : (exchange.returned_item ? [exchange.returned_item] : []);
  const sourceItemKeys = returnedItems
    .map((returnedItem) => normalizeText(returnedItem.source_item_key || "") || buildExchangeSourceKey({ ...exchange, returned_item: returnedItem }))
    .filter(Boolean);
  const sourceItemKey = normalizeText(exchange.source_item_key || "") || sourceItemKeys.join("||") || buildExchangeSourceKey(exchange);
  const duplicateSource = sourceItemKeys.length
    ? credits.find((item) => {
      if (!isCreditActive(item)) return false;
      const creditKeys = Array.isArray(item.source_item_keys)
        ? item.source_item_keys.map((key) => normalizeText(key)).filter(Boolean)
        : [normalizeText(item.source_item_key || "")].filter(Boolean);
      return sourceItemKeys.some((key) => creditKeys.includes(key));
    })
    : null;
  if (duplicateSource) {
    throw createHttpError(`Este item ja gerou Credito de Troca. Credito existente: ${duplicateSource.credit_id}.`);
  }
  const returnedItem = returnedItems[0] || exchange.returned_item || {};
  const credit = normalizeCreditRow({
    credit_id: buildId("EXCR"),
    exchange_id: normalizeText(exchange.exchange_id || ""),
    source_type: "exchange",
    original_sale_id: normalizeText(exchange.original_sale_id || exchange.origin_sale_id || ""),
    source_item_key: sourceItemKey,
    source_item_keys: sourceItemKeys,
    returned_items: returnedItems,
    returned_sku: normalizeText(returnedItem.sku || returnedItem.codigo || ""),
    returned_product_id: normalizeText(returnedItem.product_id || returnedItem.selected_product_id || ""),
    returned_quantity: roundMoney(returnedItems.reduce((sum, item) => sum + roundMoney(item.quantity || item.quantidade || 1), 0) || 1),
    customer_id: normalizedOwner.customer_id,
    customer_name: normalizedOwner.customer_name,
    customer_phone: normalizedOwner.customer_phone,
    amount: creditAmount,
    remaining_amount: creditAmount,
    used_amount: 0,
    status: "ativo",
    origin: "troca",
    expires_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    created_by: getActorName(user),
    movements: []
  });
  credits.unshift(credit);
  saveExchangeCredits(credits);
  return credit;
}

function createManualExchangeCredit({ payload = {}, user = {} } = {}) {
  const amount = roundMoney(payload.amount || payload.valor || payload.credit_amount || 0);
  if (amount <= 0) {
    throw createHttpError("Informe um valor valido para o Credito de Troca manual.");
  }
  const owner = normalizeCreditOwner(payload.customer || payload.owner || payload);
  if (!owner.customer_id) {
    throw createHttpError("Selecione o cliente que recebera o Credito de Troca manual.");
  }
  if (!owner.customer_name) {
    throw createHttpError("Informe o nome do cliente favorecido.");
  }
  const reason = normalizeText(payload.reason || payload.motivo || "");
  if (!reason) {
    throw createHttpError("Informe o motivo do Credito de Troca manual.");
  }
  const notes = normalizeText(payload.notes || payload.observacao || payload.observation || "");
  if (notes.length < 20) {
    throw createHttpError("A observacao do Credito de Troca manual deve ter pelo menos 20 caracteres.");
  }
  const sourceOrigin = normalizeManualCreditOrigin(payload.source_origin || payload.origin || payload.origem || "");
  if (!sourceOrigin) {
    throw createHttpError("Informe a origem do credito manual: tiny_legacy, venda_externa ou ajuste_manual.");
  }
  const storeId = normalizeText(payload.store_id || payload.loja || "");
  if (!storeId) {
    throw createHttpError("Informe a loja do Credito de Troca manual.");
  }
  const sourceCustomer = payload.customer || payload.owner || payload;
  const masterCustomerId = normalizeText(sourceCustomer.master_customer_id || sourceCustomer.masterCustomerId || sourceCustomer.customer_id || sourceCustomer.id || "");
  const contactId = normalizeText(sourceCustomer.contact_id || sourceCustomer.contactId || sourceCustomer.operational_contact_id || "");
  const crmContactId = normalizeText(sourceCustomer.crm_contact_id || sourceCustomer.crmContactId || "");
  const legacyContactId = normalizeText(sourceCustomer.legacy_contact_id || sourceCustomer.legacyContactId || "");
  const actor = getActorName(user);
  const credit = normalizeCreditRow({
    credit_id: buildId("EXCR_MAN"),
    exchange_id: "",
    source_type: "manual_exchange_credit",
    source_origin: sourceOrigin,
    source_reference: normalizeText(payload.source_reference || payload.reference || payload.referencia || ""),
    original_sale_id: "",
    source_item_key: `manual|${sourceOrigin}|${storeId}|${crypto.randomBytes(8).toString("hex")}`,
    source_item_keys: [],
    returned_items: [],
    returned_sku: "",
    returned_product_id: "",
    returned_quantity: 0,
    customer_id: owner.customer_id,
    master_customer_id: masterCustomerId,
    contact_id: contactId,
    crm_contact_id: crmContactId,
    legacy_contact_id: legacyContactId,
    customer_name: owner.customer_name,
    customer_phone: owner.customer_phone,
    customer_document: owner.customer_document,
    amount,
    remaining_amount: amount,
    available_balance: amount,
    used_amount: 0,
    status: "ativo",
    origin: "credito_manual",
    store_id: storeId,
    reason,
    notes,
    expires_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    created_by: actor,
    approved_by: actor,
    created_by_user_id: normalizeText(user?.id || user?.user_id || ""),
    approved_by_user_id: normalizeText(user?.id || user?.user_id || ""),
    movements: [{
      movement_id: buildId("EXCMOV"),
      type: "criacao_manual",
      amount,
      before: 0,
      after: amount,
      source_origin: sourceOrigin,
      source_reference: normalizeText(payload.source_reference || payload.reference || payload.referencia || ""),
      reason,
      notes,
      store_id: storeId,
      customer_id: owner.customer_id,
      master_customer_id: masterCustomerId,
      contact_id: contactId,
      crm_contact_id: crmContactId,
      customer_phone_masked: maskPhone(owner.customer_phone),
      created_at: nowIso(),
      created_by: actor
    }]
  });
  const credits = readExchangeCredits().map(normalizeCreditRow);
  credits.unshift(credit);
  saveExchangeCredits(credits);
  return credit;
}

function listActiveExchangeCreditsForCustomer(customer = {}) {
  const rows = readExchangeCredits().map(normalizeCreditRow)
    .filter((credit) => {
      if (!isCreditActive(credit)) return false;
      return checkExchangeCreditCustomerOwnership(credit, customer).belongs;
    });
  const deduped = [...rows]
    .sort(compareCreditCreatedAt)
    .reduce((acc, credit) => {
      const key = normalizeText(credit.source_item_key || "") || `credit:${normalizeText(credit.credit_id || "")}`;
      if (!acc.seen.has(key)) {
        acc.seen.add(key);
        acc.items.push(credit);
      }
      return acc;
    }, { seen: new Set(), items: [] }).items;
  const total = deduped.reduce((sum, credit) => roundMoney(sum + roundMoney(credit.remaining_amount)), 0);
  return { items: deduped, total: roundMoney(total) };
}

function getExchangeCreditById(creditId = "") {
  const normalizedId = normalizeText(creditId || "");
  return readExchangeCredits().map(normalizeCreditRow).find((credit) => normalizeText(credit.credit_id || "") === normalizedId) || null;
}

function consumeExchangeCreditForSale({ creditId = "", amount = 0, saleId = "", customer = {}, user = {} } = {}) {
  const useAmount = roundMoney(amount);
  if (!creditId) {
    throw createHttpError("Informe o Credito de Troca.");
  }
  if (useAmount <= 0) {
    throw createHttpError("Informe um valor valido de Credito de Troca.");
  }
  const owner = normalizeCreditOwner(customer);
  const credits = readExchangeCredits().map(normalizeCreditRow);
  const index = credits.findIndex((credit) => normalizeText(credit.credit_id || "") === normalizeText(creditId));
  if (index < 0) {
    throw createHttpError("Credito de Troca nao encontrado.", 404);
  }
  const credit = credits[index];
  const status = normalizeText(credit.status).toLowerCase();
  if (!["ativo", "active"].includes(status)) {
    throw createHttpError("Este Credito de Troca nao esta ativo.");
  }
  const ownership = checkExchangeCreditCustomerOwnership(credit, customer);
  if (!ownership.belongs && ownership.reason === "phone_mismatch") {
    console.warn("[PDV][exchange-credit] ownership denied on consume", {
      credit_id: normalizeText(credit.credit_id || ""),
      customer_phone_masked: maskPhone(owner.customer_phone || customer.phone || ""),
      credit_phone_masked: maskPhone(credit.customer_phone || ""),
      reason: ownership.reason
    });
    throw createHttpError("Este Credito de Troca pertence a outro telefone.");
  }
  if (!ownership.belongs) {
    console.warn("[PDV][exchange-credit] ownership denied on consume", {
      credit_id: normalizeText(credit.credit_id || ""),
      customer_phone_masked: maskPhone(owner.customer_phone || customer.phone || ""),
      credit_phone_masked: maskPhone(credit.customer_phone || ""),
      reason: ownership.reason
    });
    throw createHttpError("Este Credito de Troca pertence a outro cliente.");
  }
  if (ownership.reason === "manual_phone_match") {
    console.info("[PDV][exchange-credit] manual ownership fallback", {
      credit_id: normalizeText(credit.credit_id || ""),
      customer_phone_masked: maskPhone(owner.customer_phone || customer.phone || ""),
      reason: ownership.reason
    });
  }
  const before = roundMoney(credit.remaining_amount);
  if (useAmount > before + 0.009) {
    throw createHttpError("O valor usado e maior que o saldo do Credito de Troca.");
  }
  const after = roundMoney(Math.max(0, before - useAmount));
  const movement = {
    movement_id: buildId("EXCMOV"),
    type: "uso_em_venda",
    sale_id: normalizeText(saleId || ""),
    amount: useAmount,
    before,
    after,
    created_at: nowIso(),
    created_by: getActorName(user)
  };
  credit.remaining_amount = after;
  credit.available_balance = after;
  credit.used_amount = roundMoney((credit.used_amount || 0) + useAmount);
  credit.status = after <= 0 ? "usado" : "ativo";
  credit.updated_at = nowIso();
  credit.movements = [...(Array.isArray(credit.movements) ? credit.movements : []), movement];
  credits[index] = credit;
  saveExchangeCredits(credits);
  return { credit, movement };
}

function cancelManualExchangeCredit({ creditId = "", reason = "", user = {} } = {}) {
  const normalizedId = normalizeText(creditId || "");
  if (!normalizedId) {
    throw createHttpError("Informe o Credito de Troca manual.");
  }
  const cancelReason = normalizeText(reason || "");
  if (cancelReason.length < 10) {
    throw createHttpError("Informe um motivo de cancelamento com pelo menos 10 caracteres.");
  }
  const credits = readExchangeCredits().map(normalizeCreditRow);
  const index = credits.findIndex((credit) => normalizeText(credit.credit_id || "") === normalizedId);
  if (index < 0) {
    throw createHttpError("Credito de Troca nao encontrado.", 404);
  }
  const credit = credits[index];
  if (normalizeText(credit.source_type || "") !== "manual_exchange_credit") {
    throw createHttpError("Apenas creditos manuais podem ser cancelados por este fluxo.");
  }
  if (roundMoney(credit.used_amount || 0) > 0.009) {
    throw createHttpError("Credito ja utilizado. Faca estorno manual supervisionado.");
  }
  const status = normalizeText(credit.status || "").toLowerCase();
  if (["cancelado", "cancelled", "canceled"].includes(status)) {
    return credit;
  }
  const before = roundMoney(credit.remaining_amount || 0);
  const movement = {
    movement_id: buildId("EXCMOV"),
    type: "cancelamento_manual",
    amount: before,
    before,
    after: 0,
    reason: cancelReason,
    created_at: nowIso(),
    created_by: getActorName(user)
  };
  credit.remaining_amount = 0;
  credit.available_balance = 0;
  credit.status = "cancelado";
  credit.cancel_reason = cancelReason;
  credit.cancelled_at = nowIso();
  credit.cancelled_by = getActorName(user);
  credit.updated_at = nowIso();
  credit.movements = [...(Array.isArray(credit.movements) ? credit.movements : []), movement];
  credits[index] = credit;
  saveExchangeCredits(credits);
  return credit;
}

module.exports = {
  createExchangeCredit,
  createManualExchangeCredit,
  listActiveExchangeCreditsForCustomer,
  getExchangeCreditById,
  checkExchangeCreditCustomerOwnership,
  cancelManualExchangeCredit,
  consumeExchangeCreditForSale,
  buildExchangeSourceKey
};
