"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  PDV_CONSOLIDATION_EVENT_TYPES,
  PDV_CONSOLIDATION_PRIORITY
} = require("../utils/pdvConsolidationConfig");

const pdvRootDir = path.join(process.cwd(), "data", "imports", "pdv");
const pdvDatasetDir = path.join(pdvRootDir, "datasets");
const pdvConsolidationDir = path.join(pdvRootDir, "consolidation");
const pdvOperationalRootDir = path.join(process.cwd(), "data", "pdv", "operational");
const pdvSalesRootDir = path.join(process.cwd(), "data", "pdv", "sales");
const pdvConsolidationHistoryPath = path.join(pdvConsolidationDir, "history.json");
const pdvConsolidationLogsPath = path.join(pdvConsolidationDir, "logs.json");
const pdvConsolidatedCustomersPath = path.join(pdvConsolidationDir, "master-customers.json");
const pdvConsolidatedEventsPath = path.join(pdvConsolidationDir, "events.json");
const pdvConsolidationQualityPath = path.join(pdvConsolidationDir, "quality-report.json");
const pdvConsolidationSummaryPath = path.join(pdvConsolidationDir, "summary.json");
const pdvFallbackFiles = {
  sales: path.join(pdvSalesRootDir, "sales.json"),
  cashback: path.join(pdvSalesRootDir, "cashback-ledger.json"),
  sessions: path.join(pdvOperationalRootDir, "customer-sessions.json"),
  quickCustomers: path.join(pdvOperationalRootDir, "quick-customers.json")
};

function ensurePdvConsolidationDirs() {
  [pdvRootDir, pdvDatasetDir, pdvConsolidationDir].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  if (!fs.existsSync(pdvConsolidationHistoryPath)) {
    fs.writeFileSync(pdvConsolidationHistoryPath, "[]", "utf8");
  }
  if (!fs.existsSync(pdvConsolidationLogsPath)) {
    fs.writeFileSync(pdvConsolidationLogsPath, "[]", "utf8");
  }
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function readJsonArray(filePath) {
  return toArray(readJsonFile(filePath, []));
}

function formatPaymentMethods(paymentList = []) {
  return toArray(paymentList)
    .filter((item) => toNumber(item?.amount) > 0)
    .map((item) => normalizeText(item?.method || ""))
    .filter(Boolean)
    .join(", ");
}

function buildFallbackClientesDataset() {
  const rows = new Map();
  const pushRow = (seed = {}) => {
    const name = normalizeText(seed.nome || seed.cliente || "");
    const phone = normalizePhone(seed.telefone || "");
    const document = normalizeDocument(seed.cpf || seed.document || "");
    const email = normalizeText(seed.email || "").toLowerCase();
    const city = normalizeText(seed.cidade || "");
    const store = normalizeText(seed.loja_origem || seed.loja || "");
    const key = document || phone || normalizeNameKey(name);
    if (!key) {
      return;
    }
    const existing = rows.get(key) || {
      nome: "",
      telefone: "",
      cpf: "",
      email: "",
      cidade: "",
      loja_origem: "",
      source_row: 0,
      source_file: ""
    };
    existing.nome = pickBetterString(existing.nome, name);
    existing.telefone = pickBetterString(existing.telefone, phone);
    existing.cpf = pickBetterString(existing.cpf, document);
    existing.email = pickBetterString(existing.email, email);
    existing.cidade = pickBetterString(existing.cidade, city);
    existing.loja_origem = pickBetterString(existing.loja_origem, store);
    existing.source_row = existing.source_row || seed.source_row || 0;
    existing.source_file = existing.source_file || seed.source_file || "";
    rows.set(key, existing);
  };

  readJsonArray(pdvFallbackFiles.sales).forEach((sale, index) => {
    const customer = sale?.customer || {};
    pushRow({
      nome: customer.name || customer.nome || "",
      telefone: customer.phone || customer.telefone || "",
      cpf: customer.document || customer.cpf || "",
      email: customer.email || "",
      cidade: customer.city || customer.cidade || "",
      loja_origem: sale.loja || sale.cash_register_store || "",
      source_row: index + 1,
      source_file: "data/pdv/sales/sales.json"
    });
  });

  readJsonArray(pdvFallbackFiles.sessions).forEach((session, index) => {
    const customer = session?.customer || {};
    pushRow({
      nome: customer.name || customer.nome || "",
      telefone: customer.phone || customer.telefone || "",
      cpf: customer.document || customer.cpf || "",
      email: customer.email || "",
      cidade: customer.city || customer.cidade || "",
      loja_origem: session.loja || "",
      source_row: index + 1,
      source_file: "data/pdv/operational/customer-sessions.json"
    });
  });

  readJsonArray(pdvFallbackFiles.quickCustomers).forEach((customer, index) => {
    pushRow({
      nome: customer.name || customer.nome || "",
      telefone: customer.phone || customer.telefone || "",
      cpf: customer.document || customer.cpf || "",
      email: customer.email || "",
      cidade: customer.city || customer.cidade || "",
      loja_origem: customer.store || customer.loja || "",
      source_row: index + 1,
      source_file: "data/pdv/operational/quick-customers.json"
    });
  });

  readJsonArray(pdvFallbackFiles.cashback).forEach((entry, index) => {
    pushRow({
      nome: entry.customer_name || entry.cliente || "",
      telefone: entry.customer_phone || entry.telefone || "",
      loja_origem: "",
      source_row: index + 1,
      source_file: "data/pdv/sales/cashback-ledger.json"
    });
  });

  return Array.from(rows.values()).filter((row) => row.nome || row.telefone || row.cpf);
}

function buildFallbackVendasDataset() {
  return readJsonArray(pdvFallbackFiles.sales)
    .filter((sale) => String(sale?.status || "").toUpperCase() !== "CANCELLED")
    .map((sale, index) => {
      const customer = sale?.customer || {};
      return {
        cliente: customer.name || customer.nome || "",
        telefone: customer.phone || customer.telefone || "",
        data_venda: sale.data_hora || sale.created_at || "",
        valor_total: toNumber(sale.total_final || sale.subtotal),
        vendedor: normalizeText(sale.vendedor || sale.created_by || ""),
        loja: normalizeText(sale.loja || sale.cash_register_store || ""),
        forma_pagamento: formatPaymentMethods(sale.pagamentos),
        produtos: toArray(sale.items).map((item) => normalizeText(item?.nome || "")).filter(Boolean).join(", "),
        observacao: normalizeText(sale.observacoes || ""),
        source_row: index + 1,
        source_file: "data/pdv/sales/sales.json"
      };
    })
    .filter((row) => row.cliente || row.telefone || row.valor_total > 0);
}

function buildFallbackCashbackDataset() {
  const grouped = new Map();
  readJsonArray(pdvFallbackFiles.cashback)
    .filter((entry) => ["AVAILABLE", "PENDING"].includes(String(entry?.status || "").toUpperCase()))
    .forEach((entry, index) => {
      const name = normalizeText(entry.customer_name || entry.cliente || "");
      const phone = normalizePhone(entry.customer_phone || entry.telefone || "");
      const key = phone || normalizeNameKey(name) || `cashback-${index}`;
      const current = grouped.get(key) || {
        cliente: name,
        telefone: phone,
        saldo_cashback: 0,
        validade: "",
        origem: "",
        tipo: "",
        observacao: "",
        source_row: index + 1,
        source_file: "data/pdv/sales/cashback-ledger.json"
      };
      current.cliente = pickBetterString(current.cliente, name);
      current.telefone = pickBetterString(current.telefone, phone);
      current.saldo_cashback = Number((toNumber(current.saldo_cashback) + toNumber(entry.amount)).toFixed(2));
      current.validade = pickBetterString(current.validade, entry.expires_at || entry.available_at || "");
      current.origem = pickBetterString(current.origem, normalizeText(entry.source || "PDV_AEROSTORE"));
      current.tipo = pickBetterString(current.tipo, normalizeText(entry.status || ""));
      current.observacao = pickBetterString(current.observacao, normalizeText(entry.notes || ""));
      grouped.set(key, current);
    });
  return Array.from(grouped.values()).filter((row) => row.cliente || row.telefone);
}

function buildFallbackCurvaAbcDataset() {
  const grouped = new Map();
  buildFallbackVendasDataset().forEach((row) => {
    const key = normalizePhone(row.telefone || "") || normalizeNameKey(row.cliente || "");
    if (!key) {
      return;
    }
    const current = grouped.get(key) || {
      cliente: normalizeText(row.cliente || ""),
      telefone: normalizePhone(row.telefone || ""),
      total_comprado: 0,
      quantidade_compras: 0,
      ultima_compra: ""
    };
    current.total_comprado = Number((current.total_comprado + toNumber(row.valor_total)).toFixed(2));
    current.quantidade_compras += 1;
    current.ultima_compra = pickBetterString(current.ultima_compra, row.data_venda || "");
    grouped.set(key, current);
  });
  const rows = Array.from(grouped.values()).sort((a, b) => b.total_comprado - a.total_comprado);
  const total = rows.length || 1;
  return rows.map((row, index) => ({
    cliente: row.cliente,
    telefone: row.telefone,
    classe_abc: index < Math.ceil(total * 0.2) ? "A" : index < Math.ceil(total * 0.5) ? "B" : "C",
    total_comprado: row.total_comprado,
    quantidade_compras: row.quantidade_compras,
    ticket_medio: row.quantidade_compras > 0 ? Number((row.total_comprado / row.quantidade_compras).toFixed(2)) : 0,
    ultima_compra: row.ultima_compra,
    source_row: index + 1,
    source_file: "data/pdv/sales/sales.json"
  }));
}

function buildFallbackDataset(type) {
  if (type === "clientes") {
    return buildFallbackClientesDataset();
  }
  if (type === "vendas") {
    return buildFallbackVendasDataset();
  }
  if (type === "cashback") {
    return buildFallbackCashbackDataset();
  }
  if (type === "curva-abc") {
    return buildFallbackCurvaAbcDataset();
  }
  return [];
}

function loadDataset(type) {
  ensurePdvConsolidationDirs();
  const importedRows = readJsonArray(path.join(pdvDatasetDir, `${type}.json`));
  if (importedRows.length) {
    return importedRows;
  }
  return buildFallbackDataset(type);
}

function loadConsolidationHistory() {
  ensurePdvConsolidationDirs();
  return readJsonFile(pdvConsolidationHistoryPath, []);
}

function saveConsolidationHistory(rows) {
  ensurePdvConsolidationDirs();
  writeJsonFile(pdvConsolidationHistoryPath, rows);
}

function appendConsolidationHistory(entry) {
  const history = loadConsolidationHistory();
  history.unshift(entry);
  saveConsolidationHistory(history);
}

function loadConsolidationLogs() {
  ensurePdvConsolidationDirs();
  return readJsonFile(pdvConsolidationLogsPath, []);
}

function saveConsolidationLogs(rows) {
  ensurePdvConsolidationDirs();
  writeJsonFile(pdvConsolidationLogsPath, rows.slice(0, 5000));
}

function normalizeDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhone(value = "") {
  let digits = normalizeDigits(value);
  if (digits.startsWith("55") && digits.length > 11) {
    digits = digits.slice(2);
  }
  return digits;
}

function normalizeDocument(value = "") {
  return normalizeDigits(value);
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeNameKey(value = "") {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function uniqueArray(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoDate(value = "") {
  const raw = normalizeText(value);
  if (!raw) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return "";
}

function diffDays(fromDate, toDate = new Date()) {
  if (!fromDate) {
    return null;
  }
  const parsed = new Date(fromDate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return Math.max(0, Math.round((toDate.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24)));
}

function average(list) {
  const values = (list || []).filter((value) => Number.isFinite(value));
  if (!values.length) {
    return null;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function mode(list) {
  const counts = new Map();
  (list || []).filter(Boolean).forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  let bestValue = "";
  let bestCount = 0;
  counts.forEach((count, value) => {
    if (count > bestCount) {
      bestValue = value;
      bestCount = count;
    }
  });
  return bestValue;
}

function pickBetterString(current, incoming) {
  const currentText = normalizeText(current);
  const incomingText = normalizeText(incoming);
  if (!currentText) return incomingText;
  if (!incomingText) return currentText;
  return incomingText.length > currentText.length ? incomingText : currentText;
}

function scoreToLevel(master) {
  if (master.documents.length || (master.phones.length && master.sourceTypes.size >= 2)) {
    return "ALTO";
  }
  if (master.phones.length || (master.names.length > 1 && master.sourceTypes.size >= 2)) {
    return "MEDIO";
  }
  return "BAIXO";
}

function createMasterRecord(seed) {
  const keySeed = [
    normalizeDocument(seed.document),
    normalizePhone(seed.phone),
    normalizeNameKey(seed.name),
    Date.now(),
    crypto.randomBytes(4).toString("hex")
  ].join("|");
  return {
    master_customer_id: `MC_${crypto.createHash("sha1").update(keySeed).digest("hex").slice(0, 12).toUpperCase()}`,
    master_key: normalizeDocument(seed.document) || normalizePhone(seed.phone) || normalizeNameKey(seed.name),
    name: normalizeText(seed.name),
    email: normalizeText(seed.email || "").toLowerCase(),
    city: normalizeText(seed.city || ""),
    store_origin: normalizeText(seed.store || ""),
    documents: uniqueArray([normalizeDocument(seed.document)]),
    phones: uniqueArray([normalizePhone(seed.phone)]),
    names: uniqueArray([normalizeText(seed.name)]),
    sourceTypes: new Set(),
    linked_records: [],
    timeline: [],
    sales: [],
    cashback_entries: [],
    abc_entries: [],
    imported_clients: [],
    metrics: {
      total_comprado: 0,
      ticket_medio: 0,
      quantidade_compras: 0,
      ultima_compra: "",
      recorrencia_media: null,
      dias_desde_ultima_compra: null,
      tempo_medio_recompra: null,
      saldo_cashback: 0,
      classe_abc: "",
      vendedor_favorito: "",
      loja_favorita: ""
    },
    quality: {
      score: "BAIXO",
      conflicts: [],
      score_reasons: []
    }
  };
}

function snapshotMaster(master) {
  return {
    master_customer_id: master.master_customer_id,
    name: master.name,
    email: master.email,
    city: master.city,
    store_origin: master.store_origin,
    documents: [...master.documents],
    phones: [...master.phones],
    names: [...master.names],
    sourceTypes: Array.from(master.sourceTypes),
    linked_records_count: master.linked_records.length,
    timeline_count: master.timeline.length,
    metrics: { ...master.metrics },
    quality: {
      score: master.quality.score,
      conflicts: [...master.quality.conflicts],
      score_reasons: [...master.quality.score_reasons]
    }
  };
}

function mergeMasters(target, source, context) {
  target.documents = uniqueArray([...target.documents, ...source.documents]);
  target.phones = uniqueArray([...target.phones, ...source.phones]);
  target.names = uniqueArray([...target.names, ...source.names]);
  target.name = pickBetterString(target.name, source.name);
  target.email = pickBetterString(target.email, source.email);
  target.city = pickBetterString(target.city, source.city);
  target.store_origin = pickBetterString(target.store_origin, source.store_origin);
  source.linked_records.forEach((item) => target.linked_records.push(item));
  source.timeline.forEach((item) => target.timeline.push(item));
  source.sales.forEach((item) => target.sales.push(item));
  source.cashback_entries.forEach((item) => target.cashback_entries.push(item));
  source.abc_entries.forEach((item) => target.abc_entries.push(item));
  source.imported_clients.forEach((item) => target.imported_clients.push(item));
  source.sourceTypes.forEach((item) => target.sourceTypes.add(item));
  target.quality.conflicts.push(`Consolidação automática entre ${target.master_customer_id} e ${source.master_customer_id}`);
  context.logs.push({
    type: "MERGE_MASTER",
    at: new Date().toISOString(),
    lote: context.batchId,
    before: {
      target: snapshotMaster(target),
      source: snapshotMaster(source)
    },
    after: {
      target: snapshotMaster(target)
    }
  });
}

function pushTimelineEvent(master, event) {
  if (!PDV_CONSOLIDATION_EVENT_TYPES.includes(event.event_type)) {
    return;
  }
  master.timeline.push({
    event_type: event.event_type,
    event_at: event.event_at || "",
    source_type: event.source_type || "",
    title: normalizeText(event.title || event.event_type),
    description: normalizeText(event.description || ""),
    amount: toNumber(event.amount),
    seller: normalizeText(event.seller || ""),
    store: normalizeText(event.store || "")
  });
}

function attachRecordToMaster(master, sourceType, row, context) {
  master.sourceTypes.add(sourceType);
  master.linked_records.push({
    source_type: sourceType,
    source_row: row.source_row || 0,
    source_file: row.source_file || "",
    phone: normalizePhone(row.telefone || ""),
    document: normalizeDocument(row.cpf || row.document || ""),
    name: normalizeText(row.nome || row.cliente || "")
  });

  const name = normalizeText(row.nome || row.cliente || "");
  const phone = normalizePhone(row.telefone || "");
  const document = normalizeDocument(row.cpf || row.document || "");
  if (name) {
    master.names = uniqueArray([...master.names, name]);
    master.name = pickBetterString(master.name, name);
  }
  if (phone) {
    master.phones = uniqueArray([...master.phones, phone]);
  }
  if (document) {
    master.documents = uniqueArray([...master.documents, document]);
  }
  if (row.email) {
    master.email = pickBetterString(master.email, String(row.email || "").toLowerCase());
  }
  if (row.cidade) {
    master.city = pickBetterString(master.city, row.cidade);
  }
  if (row.loja_origem || row.loja) {
    master.store_origin = pickBetterString(master.store_origin, row.loja_origem || row.loja);
  }

  if (sourceType === "clientes") {
    master.imported_clients.push({
      name,
      phone,
      document,
      city: normalizeText(row.cidade || ""),
      store_origin: normalizeText(row.loja_origem || ""),
      source_file: row.source_file || ""
    });
    pushTimelineEvent(master, {
      event_type: "IMPORT",
      event_at: "",
      source_type: sourceType,
      title: "Cliente migrado para a base do PDV",
      description: row.source_file || ""
    });
  }

  if (sourceType === "vendas") {
    const sale = {
      date: toIsoDate(row.data_venda || ""),
      amount: toNumber(row.valor_total),
      seller: normalizeText(row.vendedor || ""),
      store: normalizeText(row.loja || ""),
      payment_method: normalizeText(row.forma_pagamento || ""),
      products: normalizeText(row.produtos || ""),
      observation: normalizeText(row.observacao || "")
    };
    master.sales.push(sale);
    pushTimelineEvent(master, {
      event_type: "SALE",
      event_at: sale.date,
      source_type: sourceType,
      title: "Compra importada para o PDV",
      description: sale.products || sale.payment_method || "Venda histórica importada",
      amount: sale.amount,
      seller: sale.seller,
      store: sale.store
    });
  }

  if (sourceType === "cashback") {
    const cashback = {
      balance: toNumber(row.saldo_cashback),
      validity: toIsoDate(row.validade || ""),
      origin: normalizeText(row.origem || "CRM_BONUS"),
      type: normalizeText(row.tipo || "MIGRACAO"),
      observation: normalizeText(row.observacao || "Saldo inicial migrado do CRM Bônus")
    };
    master.cashback_entries.push(cashback);
    pushTimelineEvent(master, {
      event_type: "CASHBACK_GRANTED",
      event_at: cashback.validity,
      source_type: sourceType,
      title: "Cashback migrado para o PDV",
      description: `${cashback.origin} • ${cashback.observation}`,
      amount: cashback.balance
    });
  }

  if (sourceType === "curva-abc") {
    const abc = {
      class: normalizeText(row.classe_abc || "").toUpperCase(),
      total: toNumber(row.total_comprado),
      quantity: toNumber(row.quantidade_compras),
      ticket: toNumber(row.ticket_medio),
      lastPurchase: toIsoDate(row.ultima_compra || "")
    };
    master.abc_entries.push(abc);
    pushTimelineEvent(master, {
      event_type: "IMPORT",
      event_at: abc.lastPurchase,
      source_type: sourceType,
      title: `Curva ABC atualizada (${abc.class || "-"})`,
      description: "Indicador estratégico consolidado para o PDV"
    });
  }

  if ((phone && phone.length < 10) || !phone && (sourceType === "clientes" || sourceType === "cashback")) {
    context.quality.invalidPhones.push({
      source_type: sourceType,
      source_row: row.source_row || 0,
      name,
      phone
    });
  }
}

function buildConsolidationContext(batchId) {
  return {
    batchId,
    masterMap: new Map(),
    docIndex: new Map(),
    phoneIndex: new Map(),
    nameIndex: new Map(),
    logs: [],
    quality: {
      invalidPhones: [],
      incompleteRecords: [],
      salesWithoutCustomer: [],
      cashbackWithoutLink: [],
      productsWithoutCategory: [],
      duplicateCandidates: [],
      inconsistencies: []
    }
  };
}

function setIndexesForMaster(context, master) {
  master.documents.forEach((item) => item && context.docIndex.set(item, master.master_customer_id));
  master.phones.forEach((item) => item && context.phoneIndex.set(item, master.master_customer_id));
  master.names.forEach((item) => {
    const key = normalizeNameKey(item);
    if (key) {
      context.nameIndex.set(key, master.master_customer_id);
    }
  });
}

function getMasterCandidates(context, seed) {
  const ids = new Set();
  const document = normalizeDocument(seed.document);
  const phone = normalizePhone(seed.phone);
  const nameKey = normalizeNameKey(seed.name);
  if (document && context.docIndex.has(document)) {
    ids.add(context.docIndex.get(document));
  }
  if (phone && context.phoneIndex.has(phone)) {
    ids.add(context.phoneIndex.get(phone));
  }
  if (nameKey && context.nameIndex.has(nameKey)) {
    ids.add(context.nameIndex.get(nameKey));
  }
  return Array.from(ids)
    .map((id) => context.masterMap.get(id))
    .filter(Boolean);
}

function choosePrimaryMaster(candidates, seed) {
  const document = normalizeDocument(seed.document);
  const phone = normalizePhone(seed.phone);
  if (document) {
    const byDocument = candidates.find((item) => item.documents.includes(document));
    if (byDocument) return byDocument;
  }
  if (phone) {
    const byPhone = candidates.find((item) => item.phones.includes(phone));
    if (byPhone) return byPhone;
  }
  return candidates[0] || null;
}

function getOrCreateMaster(context, seed) {
  const candidates = getMasterCandidates(context, seed);
  let master = choosePrimaryMaster(candidates, seed);
  if (!master) {
    master = createMasterRecord(seed);
    context.masterMap.set(master.master_customer_id, master);
  }
  candidates
    .filter((candidate) => candidate.master_customer_id !== master.master_customer_id)
    .forEach((candidate) => {
      mergeMasters(master, candidate, context);
      context.masterMap.delete(candidate.master_customer_id);
    });
  setIndexesForMaster(context, master);
  return master;
}

function sortTimelineDesc(timeline) {
  return [...timeline].sort((a, b) => {
    const aDate = a.event_at ? new Date(a.event_at).getTime() : 0;
    const bDate = b.event_at ? new Date(b.event_at).getTime() : 0;
    return bDate - aDate;
  });
}

function calculateSalesRecurrence(sales) {
  const dates = (sales || [])
    .map((item) => toIsoDate(item.date))
    .filter(Boolean)
    .sort();
  if (dates.length < 2) {
    return null;
  }
  const diffs = [];
  for (let index = 1; index < dates.length; index += 1) {
    const current = new Date(dates[index]).getTime();
    const previous = new Date(dates[index - 1]).getTime();
    diffs.push(Math.round((current - previous) / (1000 * 60 * 60 * 24)));
  }
  return average(diffs);
}

function finalizeMaster(master, context) {
  master.documents = uniqueArray(master.documents);
  master.phones = uniqueArray(master.phones);
  master.names = uniqueArray(master.names);
  master.sourceTypes = uniqueArray(Array.from(master.sourceTypes));
  master.timeline = sortTimelineDesc(master.timeline);

  const totalBoughtFromSales = Number(master.sales.reduce((sum, item) => sum + toNumber(item.amount), 0).toFixed(2));
  const saleCount = master.sales.length;
  const abcLast = master.abc_entries[master.abc_entries.length - 1] || null;
  const cashbackBalance = Number(master.cashback_entries.reduce((sum, item) => sum + toNumber(item.balance), 0).toFixed(2));
  const saleDates = master.sales.map((item) => toIsoDate(item.date)).filter(Boolean).sort();
  const lastSale = saleDates[saleDates.length - 1] || (abcLast?.lastPurchase || "");
  const totalBought = totalBoughtFromSales > 0 ? totalBoughtFromSales : toNumber(abcLast?.total);
  const quantity = saleCount > 0 ? saleCount : toNumber(abcLast?.quantity);
  const avgTicket = quantity > 0 ? Number((totalBought / quantity).toFixed(2)) : toNumber(abcLast?.ticket);
  const recurrence = calculateSalesRecurrence(master.sales);

  master.metrics = {
    total_comprado: totalBought,
    ticket_medio: avgTicket,
    quantidade_compras: quantity,
    ultima_compra: lastSale,
    recorrencia_media: recurrence,
    dias_desde_ultima_compra: diffDays(lastSale),
    tempo_medio_recompra: recurrence,
    saldo_cashback: cashbackBalance,
    classe_abc: abcLast?.class || "",
    vendedor_favorito: mode(master.sales.map((item) => item.seller)),
    loja_favorita: mode(master.sales.map((item) => item.store))
  };

  if (master.names.length > 1) {
    master.quality.conflicts.push("Múltiplos nomes vinculados ao mesmo cliente mestre.");
    context.quality.duplicateCandidates.push({
      master_customer_id: master.master_customer_id,
      names: master.names
    });
  }
  if (master.documents.length > 1) {
    master.quality.conflicts.push("Mais de um documento associado ao mesmo cliente mestre.");
  }
  if (master.phones.length > 1) {
    master.quality.conflicts.push("Mais de um telefone associado ao mesmo cliente mestre.");
  }

  master.quality.score = scoreToLevel(master);
  master.quality.score_reasons = [
    master.documents.length ? "documento_confiavel" : "",
    master.phones.length ? "telefone_confiavel" : "",
    master.sourceTypes.length >= 2 ? "multiplas_fontes" : "",
    master.quality.conflicts.length ? "possui_conflitos" : ""
  ].filter(Boolean);

  setIndexesForMaster(context, master);
  return master;
}

function buildQualitySummary(context, datasets, masters) {
  const duplicateCandidates = context.quality.duplicateCandidates.slice(0, 20);
  const inconsistencies = masters
    .filter((item) => item.quality.conflicts.length)
    .slice(0, 20)
    .map((item) => ({
      master_customer_id: item.master_customer_id,
      name: item.name,
      conflicts: item.quality.conflicts
    }));

  return {
    duplicateCustomers: duplicateCandidates.length,
    invalidPhones: context.quality.invalidPhones.length,
    incompleteRecords: context.quality.incompleteRecords.length,
    salesWithoutCustomer: context.quality.salesWithoutCustomer.length,
    cashbackWithoutLink: context.quality.cashbackWithoutLink.length,
    productsWithoutCategory: datasets.products.filter((item) => !normalizeText(item.categoria || "")).length,
    inconsistenciesCount: inconsistencies.length,
    duplicateCandidates,
    invalidPhoneSamples: context.quality.invalidPhones.slice(0, 20),
    incompleteRecordSamples: context.quality.incompleteRecords.slice(0, 20),
    salesWithoutCustomerSamples: context.quality.salesWithoutCustomer.slice(0, 20),
    cashbackWithoutLinkSamples: context.quality.cashbackWithoutLink.slice(0, 20),
    inconsistencies
  };
}

function buildTimelineSamples(masters) {
  return masters
    .filter((item) => item.timeline.length)
    .slice(0, 6)
    .map((item) => ({
      master_customer_id: item.master_customer_id,
      name: item.name,
      timeline: item.timeline.slice(0, 5)
    }));
}

function buildSummaryPayload(masters, qualitySummary, historyEntry) {
  const totalCustomers = masters.length;
  const strategicCount = masters.filter((item) => String(item.classe_abc || "").toUpperCase() === "A").length;
  const withCashback = masters.filter((item) => toNumber(item.saldo_cashback) > 0).length;
  const withSales = masters.filter((item) => toNumber(item.total_comprado) > 0).length;
  const highConfidence = masters.filter((item) => String(item.consolidation_score || item?.quality?.score || "").toUpperCase() === "ALTO").length;
  const topCustomers = [...masters]
    .sort((a, b) => toNumber(b.total_comprado) - toNumber(a.total_comprado))
    .slice(0, 20)
    .map((item) => ({
      master_customer_id: item.master_customer_id,
      name: item.name,
      phone: item.phone || item.phones?.[0] || "",
      document: item.document || item.documents?.[0] || "",
      total_comprado: toNumber(item.total_comprado),
      ticket_medio: toNumber(item.ticket_medio),
      quantidade_compras: toNumber(item.quantidade_compras),
      ultima_compra: item.ultima_compra || "",
      saldo_cashback: toNumber(item.saldo_cashback),
      classe_abc: item.classe_abc || "",
      consolidation_score: item.consolidation_score || item?.quality?.score || ""
    }));

  return {
    generatedAt: new Date().toISOString(),
    run: historyEntry || null,
    metrics: {
      totalCustomers,
      strategicCount,
      withCashback,
      withSales,
      highConfidence,
      duplicateCustomers: qualitySummary.duplicateCustomers,
      inconsistencies: qualitySummary.inconsistenciesCount
    },
    topCustomers,
    timelineSamples: buildTimelineSamples(masters),
    quality: qualitySummary
  };
}

function buildCustomerRecord(master) {
  const abcClass = master.metrics.classe_abc || "";
  return {
    master_customer_id: master.master_customer_id,
    master_key: master.master_key,
    name: master.name,
    phone: master.phones[0] || "",
    phones: master.phones,
    document: master.documents[0] || "",
    documents: master.documents,
    email: master.email,
    city: master.city,
    store_origin: master.store_origin,
    total_comprado: master.metrics.total_comprado,
    ticket_medio: master.metrics.ticket_medio,
    quantidade_compras: master.metrics.quantidade_compras,
    ultima_compra: master.metrics.ultima_compra,
    recorrencia_media: master.metrics.recorrencia_media,
    dias_desde_ultima_compra: master.metrics.dias_desde_ultima_compra,
    tempo_medio_recompra: master.metrics.tempo_medio_recompra,
    saldo_cashback: master.metrics.saldo_cashback,
    classe_abc: abcClass,
    vendedor_favorito: master.metrics.vendedor_favorito,
    loja_favorita: master.metrics.loja_favorita,
    source_types: master.sourceTypes,
    linked_records_count: master.linked_records.length,
    consolidation_score: master.quality.score,
    customer_priority: PDV_CONSOLIDATION_PRIORITY[abcClass] || (master.quality.score === "ALTO" ? "relationship" : "monitor"),
    timeline: master.timeline,
    quality: master.quality
  };
}

function consolidatePdvData(user = {}) {
  ensurePdvConsolidationDirs();
  const batchId = `pdv-consolidation-${Date.now()}`;
  const context = buildConsolidationContext(batchId);
  const datasets = {
    products: loadDataset("produtos"),
    clients: loadDataset("clientes"),
    sales: loadDataset("vendas"),
    abc: loadDataset("curva-abc"),
    cashback: loadDataset("cashback")
  };

  datasets.clients.forEach((row) => {
    const name = normalizeText(row.nome || "");
    const phone = normalizePhone(row.telefone || "");
    const document = normalizeDocument(row.cpf || "");
    if (!name || !phone) {
      context.quality.incompleteRecords.push({
        source_type: "clientes",
        source_row: row.source_row || 0,
        name,
        phone
      });
    }
    const master = getOrCreateMaster(context, {
      name,
      phone,
      document,
      email: row.email,
      city: row.cidade,
      store: row.loja_origem
    });
    attachRecordToMaster(master, "clientes", row, context);
  });

  datasets.sales.forEach((row) => {
    const name = normalizeText(row.cliente || "");
    const phone = normalizePhone(row.telefone || "");
    if (!name && !phone) {
      context.quality.salesWithoutCustomer.push({
        source_type: "vendas",
        source_row: row.source_row || 0,
        amount: toNumber(row.valor_total)
      });
    }
    const master = getOrCreateMaster(context, {
      name,
      phone,
      store: row.loja
    });
    attachRecordToMaster(master, "vendas", row, context);
  });

  datasets.abc.forEach((row) => {
    const master = getOrCreateMaster(context, {
      name: row.cliente,
      phone: row.telefone
    });
    attachRecordToMaster(master, "curva-abc", row, context);
  });

  datasets.cashback.forEach((row) => {
    const phone = normalizePhone(row.telefone || "");
    if (!phone) {
      context.quality.cashbackWithoutLink.push({
        source_type: "cashback",
        source_row: row.source_row || 0,
        name: normalizeText(row.cliente || ""),
        balance: toNumber(row.saldo_cashback)
      });
    }
    const master = getOrCreateMaster(context, {
      name: row.cliente,
      phone
    });
    attachRecordToMaster(master, "cashback", row, context);
  });

  const finalizedMasters = Array.from(context.masterMap.values())
    .map((master) => finalizeMaster(master, context))
    .map((master) => buildCustomerRecord(master))
    .sort((a, b) => b.total_comprado - a.total_comprado || a.name.localeCompare(b.name, "pt-BR"));

  const fullEvents = finalizedMasters.flatMap((item) =>
    item.timeline.map((event) => ({
      master_customer_id: item.master_customer_id,
      customer_name: item.name,
      ...event
    }))
  );

  const qualitySummary = buildQualitySummary(context, datasets, finalizedMasters);
  const historyEntry = {
    id: batchId,
    action: "CONSOLIDATE_PDV_DATA",
    created_at: new Date().toISOString(),
    created_by: user?.name || user?.email || "sistema",
    processed: {
      imported_clients: datasets.clients.length,
      imported_sales: datasets.sales.length,
      imported_cashback: datasets.cashback.length,
      imported_abc: datasets.abc.length,
      imported_products: datasets.products.length
    },
    result: {
      total_master_customers: finalizedMasters.length,
      duplicate_candidates: qualitySummary.duplicateCustomers,
      invalid_phones: qualitySummary.invalidPhones,
      inconsistencies: qualitySummary.inconsistenciesCount
    }
  };
  const summary = buildSummaryPayload(finalizedMasters, qualitySummary, historyEntry);

  writeJsonFile(pdvConsolidatedCustomersPath, finalizedMasters);
  writeJsonFile(pdvConsolidatedEventsPath, fullEvents);
  writeJsonFile(pdvConsolidationQualityPath, qualitySummary);
  writeJsonFile(pdvConsolidationSummaryPath, summary);
  appendConsolidationHistory(historyEntry);
  saveConsolidationLogs([...context.logs, ...loadConsolidationLogs()]);

  return {
    batchId,
    summary,
    quality: qualitySummary,
    customers: finalizedMasters.slice(0, 100),
    events: fullEvents.slice(0, 200)
  };
}

function getPdvConsolidationManifest() {
  ensurePdvConsolidationDirs();
  return {
    module: "PDV AEROSTORE",
    stage: "1.5",
    route: "/pdv/consolidacao",
    title: "Consolidação estratégica do PDV",
    description: "Cliente mestre, timeline, recorrência, cashback consolidado, qualidade e sinais estratégicos para o ecossistema AEROSTORE.",
    eventTypes: PDV_CONSOLIDATION_EVENT_TYPES,
    scoreLevels: ["ALTO", "MEDIO", "BAIXO"]
  };
}

function getPdvConsolidationSummary() {
  ensurePdvConsolidationDirs();
  return {
    manifest: getPdvConsolidationManifest(),
    summary: readJsonFile(pdvConsolidationSummaryPath, null),
    quality: readJsonFile(pdvConsolidationQualityPath, null),
    history: loadConsolidationHistory().slice(0, 40),
    logs: loadConsolidationLogs().slice(0, 120)
  };
}

function listPdvConsolidatedCustomers({ search = "", score = "", abcClass = "" } = {}) {
  ensurePdvConsolidationDirs();
  const customers = readJsonFile(pdvConsolidatedCustomersPath, []);
  const normalizedSearch = normalizeNameKey(search);
  return customers.filter((item) => {
    if (score && String(item.consolidation_score || "") !== score) {
      return false;
    }
    if (abcClass && String(item.classe_abc || "") !== abcClass) {
      return false;
    }
    if (!normalizedSearch) {
      return true;
    }
    return [
      item.name,
      item.phone,
      item.document,
      item.city,
      item.vendedor_favorito,
      item.loja_favorita
    ].some((value) => normalizeNameKey(value).includes(normalizedSearch));
  });
}

function getPdvConsolidatedCustomer(masterCustomerId) {
  ensurePdvConsolidationDirs();
  const customers = readJsonFile(pdvConsolidatedCustomersPath, []);
  return customers.find((item) => item.master_customer_id === String(masterCustomerId || "").trim()) || null;
}

module.exports = {
  ensurePdvConsolidationDirs,
  consolidatePdvData,
  getPdvConsolidationManifest,
  getPdvConsolidationSummary,
  listPdvConsolidatedCustomers,
  getPdvConsolidatedCustomer
};
